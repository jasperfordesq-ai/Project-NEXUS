#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# Contract test for scripts/deploy/phases/check-migration-safety.sh.
#
# The gate blocks production deploys, and on 2026-08-29 it gained an exemption:
# a raw ALTER carrying ALGORITHM=INSTANT is allowed through, because MariaDB
# refuses such a statement outright when it cannot be done as a metadata-only
# edit (verified: ERROR 1846 for an enum value inserted mid-list). An exemption
# in a blocking gate is worth exactly as much as the test that pins its edges,
# so this asserts BOTH directions — the exemption works, and everything it does
# not cover is still refused.
#
# No Docker needed: the gate reaches the container through `docker exec`, so a
# stub `docker` earlier on PATH supplies the artisan output.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE="$REPO_ROOT/scripts/deploy/phases/check-migration-safety.sh"
TMP_DIR="$(mktemp -d -t nexus-migration-gate-XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/bin" "$TMP_DIR/release/database/migrations"

# --- stub `docker` ------------------------------------------------------------
# `migrate:status --pending` must name the migration under test; `--pretend`
# echoes whatever PRETEND_SQL holds, which is how the emitted-SQL half of the
# gate is driven.
cat > "$TMP_DIR/bin/docker" <<'STUB'
#!/usr/bin/env bash
for arg in "$@"; do
    case "$arg" in
        migrate:status) echo "  Pending ...... ${MIGRATION_NAME}"; exit 0 ;;
        --pretend)      printf '%s\n' "${PRETEND_SQL:-}"; exit 0 ;;
    esac
done
exit 0
STUB
chmod +x "$TMP_DIR/bin/docker"

export PATH="$TMP_DIR/bin:$PATH"
export NEXUS_RELEASE_DIR="$TMP_DIR/release"
export DEPLOY_DIR="$TMP_DIR/release"
# Take the plain-echo branch in _log_out; the tee branch wants a $LOG_FILE.
export __NEXUS_DEPLOY_DETACHED__=1

FAILURES=0

# run_gate <name> <migration-body> <pretend-sql>; echoes "pass" or "block".
run_gate() {
    local name="$1" body="$2" pretend="$3"
    rm -f "$NEXUS_RELEASE_DIR"/database/migrations/*.php
    printf '%s\n' "$body" > "$NEXUS_RELEASE_DIR/database/migrations/${name}.php"
    MIGRATION_NAME="$name" PRETEND_SQL="$pretend" \
        DEPLOY_ALLOW_DESTRUCTIVE_MIGRATION=0 \
        bash "$GATE" >"$TMP_DIR/out.txt" 2>&1 && echo pass || echo block
}

expect() {
    local label="$1" want="$2" got="$3"
    if [ "$want" = "$got" ]; then
        echo "  ok    $label ($got)"
    else
        echo "  FAIL  $label — expected $want, got $got" >&2
        sed 's/^/        /' "$TMP_DIR/out.txt" >&2
        FAILURES=$((FAILURES + 1))
    fi
}

INSTANT_SQL="ALTER TABLE \`achievement_campaigns\` MODIFY \`status\` ENUM('draft','running','paused') NOT NULL DEFAULT 'draft', ALGORITHM=INSTANT, LOCK=NONE"
PLAIN_SQL="ALTER TABLE \`achievement_campaigns\` MODIFY \`status\` ENUM('draft','running','paused') NOT NULL DEFAULT 'draft'"

echo "=== migration safety gate ==="

# 1. The exemption: a proven-instant ALTER is allowed through.
expect "proven-instant ALTER passes" pass "$(run_gate 2026_01_01_000000_instant "<?php
return new class extends Migration {
    public function up(): void {
        DB::statement(\"$INSTANT_SQL\");
    }
};" "$INSTANT_SQL")"

# 2. The edge that matters most: drop the clause and it must block again.
expect "same ALTER without the clause blocks" block "$(run_gate 2026_01_01_000001_plain "<?php
return new class extends Migration {
    public function up(): void {
        DB::statement(\"$PLAIN_SQL\");
    }
};" "$PLAIN_SQL")"

# 3. Per-statement, not per-file: one exempt statement must not carry an
#    unqualified one through with it.
expect "mixed file blocks on the unqualified statement" block "$(run_gate 2026_01_01_000002_mixed "<?php
return new class extends Migration {
    public function up(): void {
        DB::statement(\"$INSTANT_SQL\");
        DB::statement(\"$PLAIN_SQL\");
    }
};" "$INSTANT_SQL
$PLAIN_SQL")"

# 4. The source lint and the --pretend lint must agree. A migration whose
#    source carries the clause but whose emitted SQL does not is still refused.
expect "clause in source but not in emitted SQL blocks" block "$(run_gate 2026_01_01_000003_pretend_only "<?php
return new class extends Migration {
    public function up(): void {
        DB::statement(\"$INSTANT_SQL\");
    }
};" "$PLAIN_SQL")"

# 5. The exemption is for raw SQL that spells the clause out. Laravel's
#    ->change() cannot demand INSTANT, so it carries no proof and stays blocked.
expect "schema-builder ->change() still blocks" block "$(run_gate 2026_01_01_000004_change "<?php
return new class extends Migration {
    public function up(): void {
        Schema::table('achievement_campaigns', function (Blueprint \$table) {
            \$table->string('status')->default('draft')->change();
        });
    }
};" "")"

# 6. A genuinely destructive statement is untouched by any of this.
expect "DROP TABLE still blocks" block "$(run_gate 2026_01_01_000005_drop "<?php
return new class extends Migration {
    public function up(): void {
        DB::statement('DROP TABLE \`achievement_campaigns\`');
    }
};" "DROP TABLE \`achievement_campaigns\`")"

# 7. An additive migration stays clean — the gate must not have become noisy.
expect "additive nullable column passes" pass "$(run_gate 2026_01_01_000006_additive "<?php
return new class extends Migration {
    public function up(): void {
        Schema::table('achievement_campaigns', function (Blueprint \$table) {
            \$table->string('note')->nullable();
        });
    }
};" "ALTER TABLE \`achievement_campaigns\` ADD \`note\` VARCHAR(255) NULL")"

if [ "$FAILURES" -ne 0 ]; then
    echo "migration safety gate: $FAILURES contract(s) broken" >&2
    exit 1
fi
echo "migration safety gate: OK — exemption holds and every edge around it still blocks."
