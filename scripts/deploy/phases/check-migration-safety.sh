#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# Migration Safety Gate (expand/contract enforcement).

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/../lib/common.sh"

RELEASE_DIR="${NEXUS_RELEASE_DIR:-$DEPLOY_DIR}"
APP_CONTAINER="${NEXUS_CANDIDATE_CONTAINER:-nexus-php-app}"
MIGRATIONS_DIR="$RELEASE_DIR/database/migrations"
ALLOW_FLAG="${DEPLOY_ALLOW_DESTRUCTIVE_MIGRATION:-0}"

log_step "=== Migration Safety Gate ==="

if [ ! -d "$MIGRATIONS_DIR" ]; then
    log_warn "$MIGRATIONS_DIR not found - skipping safety gate"
    exit 0
fi

pending_raw="$(docker_exec_app_user "$APP_CONTAINER" php /var/www/html/artisan migrate:status --pending 2>/dev/null || true)"
if echo "$pending_raw" | grep -qi "Nothing to migrate\|No pending migrations\|No migrations found"; then
    log_ok "No pending migrations - safety gate passes vacuously"
    exit 0
fi

pending_files=()
while IFS= read -r line; do
    if echo "$line" | grep -q "Pending"; then
        name="$(echo "$line" | awk '{for (i=NF;i>0;i--) if ($i ~ /^[0-9]{4}_/) { print $i; exit }}')"
        if [ -n "$name" ]; then
            pending_files+=("$MIGRATIONS_DIR/${name}.php")
        fi
    fi
done <<< "$pending_raw"

if [ "${#pending_files[@]}" -eq 0 ]; then
    log_err "Could not parse pending migration filenames from artisan output; refusing to skip safety gate"
    echo "$pending_raw" | sed 's/^/    /'
    exit 1
fi

log_info "${#pending_files[@]} pending migration(s) to lint:"
for f in "${pending_files[@]}"; do
    echo "  - $(basename "$f")"
done

DANGEROUS_PHP_PATTERNS='->drop(Column|ConstrainedForeignId|Morphs|NullableMorphs|Timestamps|TimestampsTz|SoftDeletes|SoftDeletesTz|RememberToken)\(|->rename(Column|Index)\(|->change\(\)|Schema::drop(IfExists)?\(|Schema::rename\(|->renameTo\(|->drop(Foreign|Primary|Unique|Index)\('
# 🔴 The DDL keywords are word-bounded (\b). Without the boundaries these match
# the SUBSTRING inside ordinary identifiers and string literals, so an entirely
# additive statement is reported as destructive. Real case, 2026-08-07: a
# deploy was blocked by
#   ALTER TABLE `account_relationship_events`
#     ADD CONSTRAINT `chk_ar_events_action` CHECK (`action` IN (…,'permissions_changed'))
# because "permissions_chang(e)" contains CHANGE — the reported match text
# literally ended mid-word. Any CHECK vocabulary containing dropped / renamed /
# modified / changed hits the same trap.
# The boundaries do NOT weaken the gate: ALTER…DROP/RENAME/CHANGE/MODIFY,
# DROP TABLE, TRUNCATE TABLE and RENAME TABLE are all still caught, in any case
# and with backtick-quoted identifiers. Verified against nine real destructive
# forms plus the false-positive cases before this line was changed.
RAW_DESTRUCTIVE_SQL_PATTERNS='DB::(statement|unprepared|affectingStatement)\([^;]*(ALTER[[:space:]]+TABLE[^;]*\b(DROP|RENAME|CHANGE|MODIFY)\b|\bDROP[[:space:]]+TABLE\b|\bTRUNCATE[[:space:]]+TABLE\b|\bRENAME[[:space:]]+TABLE\b)'
NON_NULL_WITHOUT_DEFAULT='->(string|char|text|mediumText|longText|integer|tinyInteger|smallInteger|mediumInteger|bigInteger|unsignedInteger|unsignedTinyInteger|unsignedSmallInteger|unsignedMediumInteger|unsignedBigInteger|float|double|decimal|boolean|date|dateTime|dateTimeTz|time|timeTz|timestamp|timestampTz|year|json|jsonb|uuid|ulid|foreignId|foreignIdFor|foreignUuid|foreignUlid|ipAddress|macAddress|enum|set|binary|morphs|uuidMorphs|ulidMorphs)\([^)]*\)(?!.*->nullable\(\))(?!.*->default\()'
PRETEND_DESTRUCTIVE_SQL='alter[[:space:]]+table.*[[:space:]](drop|rename|change|modify)[[:space:]]|drop[[:space:]]+table|truncate[[:space:]]+table|rename[[:space:]]+table'
PRETEND_NON_NULL_ADD='alter[[:space:]]+table.*[[:space:]]add(?!.*\bdefault\b).*[[:space:]]not[[:space:]]+null'

# 🔴 The one form of raw column change that CANNOT lock the colour still serving.
#
# `ALGORITHM=INSTANT` is not a promise in a comment — the server enforces it.
# If the change cannot be made as a metadata-only edit, MariaDB REFUSES the
# whole statement rather than quietly falling back to a rebuild:
#
#   ALTER TABLE t MODIFY status ENUM(...,'paused') ..., ALGORITHM=INSTANT;
#     -> value appended at the END of the enum: accepted, instant, no rebuild
#     -> value inserted in the MIDDLE: ERROR 1846 (0A000) ALGORITHM=INSTANT is
#        not supported. Reason: Cannot change column type. Try ALGORITHM=COPY
#
# Both verified on MariaDB 10.11.18 — this platform's version — on 2026-08-29.
# A statement carrying the clause is therefore self-proving: it either does no
# rebuild, or it does not run at all. Exempting it is not a hole in the gate.
#
# WHY THIS EXISTS. Before it, the gate's only possible outcome for ANY column
# change was DEPLOY_ALLOW_DESTRUCTIVE_MIGRATION=1: it matched the word MODIFY
# and never looked at what the statement did, so an enum gaining one value was
# indistinguishable from a table rewrite. A gate whose only exit is the
# override teaches everyone to reach for the override, which is how a genuinely
# dangerous one eventually gets waved through. Real case, 2026-08-29:
# add_paused_to_achievement_campaign_status blocked a deploy over a 0-row table.
#
# 🔴 Keep this narrow if you edit it. It exempts ONLY raw SQL that spells the
# clause out. `->change()` stays in DANGEROUS_PHP_PATTERNS and stays blocked:
# Laravel's schema builder gives you no way to demand INSTANT, so a ->change()
# carries no proof of anything.
#
# Pinned in BOTH directions by scripts/test/test-migration-safety-gate.sh
# (7 contracts, no Docker needed). Its control is the one that matters: the
# same ALTER with the clause removed must block again, which is what proves a
# pass comes from the exemption rather than from the gate having gone blind.
# Run it after ANY edit here.
INSTANT_SAFE_DDL='ALGORITHM[[:space:]]*=[[:space:]]*INSTANT'

# 🔴 Collapse each PHP statement onto ONE line, prefixed with the line it started on.
#
# WHY. `NON_NULL_WITHOUT_DEFAULT` decides a column is dangerous using negative
# lookaheads for `->nullable()` and `->default(`. grep evaluates a pattern against
# one LINE at a time, so a fluent chain split across lines — which is this
# codebase's own style, and what any formatter produces — hides the `->nullable()`
# from the lookahead and the gate reports a violation that is not there.
#
# Measured on 2026-08-12: it blocked a production deploy over
# `2026_08_11_120000_add_hours_available_to_listings.php`, where the column is
# `->nullable()->default(null)` on the two lines FOLLOWING the `->decimal(...)`.
# Entirely safe, refused anyway. A gate that cries wolf gets overridden, and
# overriding this one risks breaking the colour still serving traffic — so the fix
# is to read statements, not lines.
#
# The line-number prefix keeps the diagnostics as useful as before.
join_statements() {
    awk '
        {
            if (buf == "") { start = NR }
            buf = (buf == "" ? $0 : buf " " $0)
            while (index(buf, ";") > 0) {
                pos = index(buf, ";")
                stmt = substr(buf, 1, pos)
                gsub(/[[:space:]]+/, " ", stmt)
                sub(/^ /, "", stmt)
                if (stmt ~ /[^[:space:];]/) { print start ": " stmt }
                buf = substr(buf, pos + 1)
                start = NR
            }
        }
        END {
            if (buf ~ /[^[:space:]]/) {
                gsub(/[[:space:]]+/, " ", buf)
                sub(/^ /, "", buf)
                print start ": " buf
            }
        }
    '
}

strip_schema_create_blocks() {
    awk '
        /Schema::create[[:space:]]*\(/ {
            in_create=1
            depth=0
        }
        in_create {
            opens=gsub(/\{/, "{")
            closes=gsub(/\}/, "}")
            depth += opens - closes
            if (depth <= 0 && $0 ~ /\}[[:space:]]*\)[[:space:]]*;/) {
                in_create=0
            }
            next
        }
        { print }
    '
}

# Strip the body of any down() method. up() and any helper methods it calls
# stay in scope (helpers can be private/protected and still own destructive
# ops we need to catch). down() only runs on manual migrate:rollback, never
# on forward deploy, so its drop*/rename* calls are not a deploy-time risk.
strip_down_methods() {
    awk '
        /function[[:space:]]+down[[:space:]]*\(/ {
            in_down=1
            depth=0
            seen_open=0
            next
        }
        in_down {
            opens=gsub(/\{/, "{")
            closes=gsub(/\}/, "}")
            depth += opens - closes
            if (opens > 0) seen_open=1
            if (seen_open && depth <= 0) {
                in_down=0
                seen_open=0
            }
            next
        }
        { print }
    '
}

violations=0
for f in "${pending_files[@]}"; do
    [ -f "$f" ] || continue

    body="$(awk '
        /\/\*/ { in_block=1 }
        /\*\// { in_block=0; next }
        in_block { next }
        { sub(/\/\/.*/, ""); print }
    ' "$f" | strip_down_methods)"
    alter_body="$(printf '%s\n' "$body" | strip_schema_create_blocks)"

    matches="$(printf '%s\n' "$body" | grep -niE -- "$DANGEROUS_PHP_PATTERNS" || true)"
    if [ -n "$matches" ]; then
        log_err "Destructive schema builder operation in $(basename "$f"):"
        echo "$matches" | sed 's/^/    /'
        violations=$((violations + 1))
    fi

    # Judged per STATEMENT, not on the whole file collapsed onto one line. Two
    # reasons. `grep -o` reported a fragment ending at the DDL keyword, so the
    # ALGORITHM clause that follows it was never inside the matched text and
    # could not be tested for. And a file mixing one proven-instant statement
    # with one unqualified statement must still fail on the second.
    # join_statements splits on `;`, so each DB::statement(...) is weighed on
    # its own and keeps its source line number. A stray `;` inside the SQL
    # splits the clause away from its ALTER, which LOSES the exemption rather
    # than granting it — the failure mode is a false block, never a false pass.
    raw_matches="$(printf '%s\n' "$body" | join_statements \
        | grep -iE -- "$RAW_DESTRUCTIVE_SQL_PATTERNS" \
        | grep -viE -- "$INSTANT_SAFE_DDL" || true)"
    if [ -n "$raw_matches" ]; then
        log_err "Raw destructive SQL in $(basename "$f"):"
        echo "$raw_matches" | sed 's/^/    /'
        violations=$((violations + 1))
    fi

    # Statement-joined, not line-by-line — see join_statements() for the false
    # alarm this fixes. Each joined line already carries its source line number, so
    # `grep -P` rather than `grep -nP`.
    nullable_matches="$(printf '%s\n' "$alter_body" | join_statements | grep -P -- "$NON_NULL_WITHOUT_DEFAULT" || true)"
    if [ -n "$nullable_matches" ]; then
        log_err "Non-nullable column add/change on an existing table without nullable() or default() in $(basename "$f"):"
        echo "$nullable_matches" | sed 's/^/    /'
        violations=$((violations + 1))
    fi
done

pretend_raw="$(docker_exec_app_user "$APP_CONTAINER" php /var/www/html/artisan migrate --pretend --force 2>/dev/null || true)"
if [ -n "$pretend_raw" ]; then
    # The same exemption on the SQL Laravel actually emits. The source lint
    # above and this one must agree, or a proven-instant migration passes one
    # and is blocked by the other.
    pretend_destructive="$(printf '%s\n' "$pretend_raw" \
        | grep -niE -- "$PRETEND_DESTRUCTIVE_SQL" \
        | grep -viE -- "$INSTANT_SAFE_DDL" || true)"
    if [ -n "$pretend_destructive" ]; then
        log_err "Destructive SQL detected in migrate --pretend output:"
        echo "$pretend_destructive" | sed 's/^/    /'
        violations=$((violations + 1))
    fi

    pretend_non_null="$(printf '%s\n' "$pretend_raw" | grep -niP -- "$PRETEND_NON_NULL_ADD" || true)"
    if [ -n "$pretend_non_null" ]; then
        log_err "Non-nullable column add without DEFAULT detected in migrate --pretend output:"
        echo "$pretend_non_null" | sed 's/^/    /'
        violations=$((violations + 1))
    fi
else
    log_warn "migrate --pretend produced no output; relying on source lint only"
fi

if [ "$violations" -gt 0 ]; then
    if [ "$ALLOW_FLAG" = "1" ]; then
        log_warn "$violations migration safety violation(s) found."
        log_warn "Proceeding because DEPLOY_ALLOW_DESTRUCTIVE_MIGRATION=1 is set."
        log_warn "Recommended path: enable maintenance mode for destructive deploys."
        exit 0
    fi

    log_err "$violations migration safety violation(s) found."
    log_err "These can break the active color while it is still serving traffic."
    log_err ""
    log_err "Options:"
    log_err "  1. Refactor as expand/contract (multi-deploy)."
    log_err "  2. Run blue-green with manually controlled maintenance mode:"
    log_err "       sudo bash scripts/maintenance.sh on"
    log_err "       DEPLOY_ALLOW_DESTRUCTIVE_MIGRATION=1 sudo bash scripts/deploy/bluegreen-deploy.sh deploy --detach"
    log_err "       sudo bash scripts/deploy/bluegreen-deploy.sh monitor"
    log_err "       sudo bash scripts/maintenance.sh off"
    log_err "  3. Override only with an accepted outage risk:"
    log_err "       DEPLOY_ALLOW_DESTRUCTIVE_MIGRATION=1 sudo bash scripts/deploy/bluegreen-deploy.sh deploy --detach"
    exit 1
fi

log_ok "All pending migrations look expand/contract-safe"
