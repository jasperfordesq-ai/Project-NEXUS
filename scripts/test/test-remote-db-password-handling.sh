#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# E-035 F-203 regression test: scripts/backup-production-db.sh and
# scripts/migrate-production.sh must never put the production database password
# on a command line (locally, in the ssh arguments, or in the server-side docker
# arguments) and must still hand it to the database client.
#
# Runs both scripts end to end against fake ssh / scp / sudo / docker on PATH;
# the fake ssh executes the "remote" command locally with /opt/nexus-php mapped
# into a temporary directory. Refuses to run unless the fakes are the ones found
# on PATH, so it can never reach a real server. Linux shell (e.g. nexus-php-app).
#
#   bash scripts/test/test-remote-db-password-handling.sh

set -uo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d -t nexus-f203.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

SECRET="f203-Secret-$$-value"
BIN="$WORK/bin"; ROOT="$WORK/root"; LOG="$WORK/log"
mkdir -p "$BIN" "$ROOT/opt/nexus-php" "$LOG"
printf 'DB_USER=nexus_app\nDB_PASS=%s\n' "$SECRET" > "$ROOT/opt/nexus-php/.env"

# Every fake records its own argv, one line per call.
cat > "$BIN/ssh" <<EOF
#!/usr/bin/env bash
printf '%s\n' "ssh \$*" >> "$LOG/argv"
# drop options and the host; the last argument is the remote command
while [ \$# -gt 1 ]; do case "\$1" in -i|-o) shift 2;; *) shift;; esac; done
cmd="\${1//\/opt\/nexus-php/$ROOT/opt/nexus-php}"
if [ "\$cmd" = "sudo sh -s" ]; then
  sed "s#/opt/nexus-php#$ROOT/opt/nexus-php#g" | sh -s
else
  sh -c "\$cmd"
fi
EOF
cat > "$BIN/scp" <<EOF
#!/usr/bin/env bash
printf '%s\n' "scp \$*" >> "$LOG/argv"
src=""; for a in "\$@"; do case "\$a" in -*|*ConnectTimeout*|*StrictHostKeyChecking*) ;; *:*) dst="\${a#*:}";; *) src="\$a";; esac; done
cp "\$src" "\$dst"
EOF
cat > "$BIN/sudo" <<EOF
#!/usr/bin/env bash
printf '%s\n' "sudo \$*" >> "$LOG/argv"
exec "\$@"
EOF
cat > "$BIN/docker" <<EOF
#!/usr/bin/env bash
printf '%s\n' "docker \$*" >> "$LOG/argv"
printf '%s\n' "\${MYSQL_PWD:-<unset>}" >> "$LOG/docker-env"
case " \$* " in
  *" mariadb-dump "*) echo "-- MariaDB dump"; echo "-- Dump completed on now";;
  *"SELECT COUNT(*)"*) echo 0;;
  *" exec -i "*) cat >/dev/null; echo ok;;
  *) echo ok;;   # like the real client, never read stdin without -i
esac
EOF
chmod +x "$BIN"/*

export PATH="$BIN:$PATH"
if [ "$(command -v ssh)" != "$BIN/ssh" ] || [ "$(command -v docker)" != "$BIN/docker" ]; then
  echo "FAIL: fake ssh/docker are not first on PATH — refusing to run"; exit 1
fi

export PROD_SSH_HOST="fake@example.invalid" PROD_SSH_KEY="$WORK/no-key" PROD_DB_NAME="nexus"
unset PROD_DB_PASS PROD_DB_USER
# The scripts source .secrets.local/deploy.env when present; run them from a
# copy of the repo layout so a developer's real secrets file is never read.
mkdir -p "$WORK/repo/scripts" "$WORK/repo/migrations"
cp "$REPO/scripts/backup-production-db.sh" "$REPO/scripts/migrate-production.sh" "$WORK/repo/scripts/"
# The script copies the migration to the "server's" /tmp; a unique name keeps
# it clear of anything else in a shared /tmp, and the script removes it.
MIG="nexus_f203_test_$$.sql"
printf 'SELECT 1;\n' > "$WORK/repo/migrations/$MIG"

fails=0
check() { if eval "$2"; then echo "  PASS  $1"; else echo "  FAIL  $1"; fails=$((fails+1)); fi; }

( cd "$WORK/repo" && bash scripts/backup-production-db.sh ) > "$LOG/backup.out" 2>&1
check "backup script completes" "grep -q 'BACKUP COMPLETE' '$LOG/backup.out'"
( cd "$WORK/repo" && bash scripts/migrate-production.sh "$MIG" ) > "$LOG/migrate.out" 2>&1
check "migration script completes" "grep -q 'PRODUCTION MIGRATION COMPLETE' '$LOG/migrate.out'"

check "the password appears in no command line (ssh, scp, sudo, docker)" "! grep -qF '$SECRET' '$LOG/argv'"
check "the password is not printed by either script" "! grep -qF '$SECRET' '$LOG/backup.out' '$LOG/migrate.out'"
check "docker is always called with a bare '-e MYSQL_PWD'" "! grep -E '^docker ' '$LOG/argv' | grep -q 'MYSQL_PWD='"
check "every database client call received the password" "[ -s '$LOG/docker-env' ] && ! grep -qv -xF '$SECRET' '$LOG/docker-env'"
# Files owner-only; the directory 0755 so the www-data scheduler's backup:verify
# can list it (F-205) — names and dates are not sensitive, contents are.
check "backup files are owner-only (0600), directory listable (0755)" "[ -z \"\$(find '$ROOT/opt/nexus-php/backups' -type f ! -perm 600)\" ] && [ \"\$(stat -c %a '$ROOT/opt/nexus-php/backups')\" = 755 ]"
PROD_DB_PASS=ignored-value bash -c "cd '$WORK/repo' && bash scripts/backup-production-db.sh" > "$LOG/override.out" 2>&1
check "a PROD_DB_PASS override is ignored, not transmitted" "grep -q 'PROD_DB_PASS is ignored' '$LOG/override.out' && ! grep -qF 'ignored-value' '$LOG/argv'"

echo
if [ $fails -eq 0 ]; then echo "RESULT: all checks passed"; else echo "RESULT: $fails check(s) failed"; exit 1; fi
