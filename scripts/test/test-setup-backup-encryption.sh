#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# F-123: scripts/setup-backup-encryption.sh writes the server's encryption
# config. The result must let EACH of the owner's two keys and the drill key
# open a backup on its own, must hold no owner private key, and must refuse
# input that would leave the owner with fewer than two keys.
#
# Run in a throwaway container:
#   MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD/scripts:/repo/scripts:ro" alpine:3.20 \
#     sh -c 'apk add -q bash age coreutils && bash /repo/scripts/test/test-setup-backup-encryption.sh'

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/setup-backup-encryption.sh"
WORK="$(mktemp -d -t nexus-enc-setup-XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
FAILURES=0
pass() { echo "  ok   $1"; }
failt() { echo "  FAIL $1" >&2; FAILURES=$((FAILURES + 1)); }

age-keygen -o "$WORK/a.txt" 2>/dev/null
age-keygen -o "$WORK/b.txt" 2>/dev/null
PUB_A="$(age-keygen -y "$WORK/a.txt")"
PUB_B="$(age-keygen -y "$WORK/b.txt")"

run_setup() {  # $1 case dir, rest = args
    local d="$1"; shift
    mkdir -p "$d"
    env BACKUP_AGE_RECIPIENTS_FILE="$d/recipients" \
        DRILL_IDENTITY_FILE="$d/drill-key" \
        BACKUP_ALERT_ENV="$d/alerts.env" \
        TELEGRAM_BOT_TOKEN="123:abc" TELEGRAM_CHAT_ID="42" \
        bash "$SCRIPT" "$@" < /dev/null > "$d/out.log" 2>&1
}

echo "case 1: two owner keys"
C="$WORK/ok"
if run_setup "$C" --owner-key "$PUB_A" --owner-key "$PUB_B"; then pass "setup exits 0"; else failt "setup failed"; cat "$C/out.log" >&2; fi
[ "$(grep -cE '^age1' "$C/recipients")" = "3" ] && pass "recipients file holds 3 public keys" || failt "recipients file key count wrong"
grep -q "AGE-SECRET-KEY" "$C/recipients" && failt "a private key was written to the recipients file" || pass "no private key in recipients file"
[ "$(stat -c %a "$C/recipients")" = "600" ] && pass "recipients file 0600" || failt "recipients file mode $(stat -c %a "$C/recipients")"
[ "$(stat -c %a "$C/drill-key")" = "600" ] && pass "drill key 0600" || failt "drill key mode $(stat -c %a "$C/drill-key")"
[ "$(stat -c %a "$C/alerts.env")" = "600" ] && pass "alerts file 0600" || failt "alerts file mode"
grep -qx "TELEGRAM_CHAT_ID=42" "$C/alerts.env" && pass "alerts file written" || failt "alerts file content wrong"
printf 'secret backup\n' > "$WORK/plain"
age -R "$C/recipients" -o "$WORK/enc" "$WORK/plain"
for k in "$WORK/a.txt" "$WORK/b.txt" "$C/drill-key"; do
    [ "$(age -d -i "$k" "$WORK/enc")" = "secret backup" ] && pass "$(basename "$k") opens a backup alone" || failt "$(basename "$k") cannot open a backup"
done
grep -q "$PUB_A" "$C/out.log" && pass "prints what it recorded" || failt "does not show the recorded keys"

echo "case 2: re-run keeps the existing drill key"
before="$(cat "$C/drill-key")"
run_setup "$C" --owner-key "$PUB_A" --owner-key "$PUB_B" || failt "re-run failed"
[ "$(cat "$C/drill-key")" = "$before" ] && pass "drill key unchanged" || failt "drill key regenerated on re-run"

echo "case 3: refusals"
for args in "--owner-key $PUB_A" "--owner-key $PUB_A --owner-key $PUB_A" "--owner-key $PUB_A --owner-key not-a-key" "--owner-key $PUB_A --owner-key $(cat "$WORK/b.txt" | grep AGE-SECRET)"; do
    d="$WORK/refuse-$RANDOM"
    # shellcheck disable=SC2086
    if run_setup "$d" $args; then failt "accepted: ${args:0:60}"; else pass "refused: ${args:0:60}…"; fi
    [ -e "$d/recipients" ] && failt "wrote a recipients file after refusing" || true
done

echo
if [ "$FAILURES" -gt 0 ]; then echo "FAILED: $FAILURES check(s)" >&2; exit 1; fi
echo "PASS: server encryption setup is safe"
