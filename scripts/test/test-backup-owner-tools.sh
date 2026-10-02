#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# F-123: the owner's key tools. backup-keygen.sh must produce a key whose
# printed public half encrypts and whose private half (also as typed back from
# a paper copy: grouped with spaces, any case) decrypts. backup-decrypt.sh must
# say PASS for the right key, FAIL (non-zero) for a wrong one, and never leave
# a plaintext file behind on failure.
#
# Run in a throwaway container:
#   MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD/scripts:/repo/scripts:ro" alpine:3.20 \
#     sh -c 'apk add -q bash age coreutils && bash /repo/scripts/test/test-backup-owner-tools.sh'

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
KEYGEN="$REPO_ROOT/scripts/backup-keygen.sh"
DECRYPT="$REPO_ROOT/scripts/backup-decrypt.sh"
WORK="$(mktemp -d -t nexus-owner-tools-XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
FAILURES=0
pass() { echo "  ok   $1"; }
failt() { echo "  FAIL $1" >&2; FAILURES=$((FAILURES + 1)); }

echo "case 1: keygen --save"
bash "$KEYGEN" --save "$WORK/key-a.txt" > "$WORK/keygen.out" 2>&1 || { failt "keygen failed"; cat "$WORK/keygen.out" >&2; }
[ "$(stat -c %a "$WORK/key-a.txt")" = "600" ] && pass "saved key file is 0600" || failt "saved key file mode"
PUB="$(grep -oE 'age1[0-9a-z]{58}' "$WORK/keygen.out" | head -1)"
[ -n "$PUB" ] && pass "public key printed" || failt "no public key printed"
SECRET="$(grep -m1 '^AGE-SECRET-KEY-' "$WORK/key-a.txt")"
[ -n "$SECRET" ] && pass "saved file holds the private key" || failt "saved file has no private key"
[ "$(age-keygen -y "$WORK/key-a.txt")" = "$PUB" ] && pass "printed public key matches the saved private key" || failt "public/private mismatch"
GROUPED="$(grep -E '^ *AGE-SECRET-KEY-1 ' "$WORK/keygen.out" | head -1 || true)"
[ -n "$GROUPED" ] && pass "paper-friendly grouped form printed" || failt "no grouped form for the paper copy"

echo "case 2: decrypt with the key typed back from paper (spaces, lower case)"
printf 'Project NEXUS backup key check\nbackup date: 2026-10-02\n' > "$WORK/nexus_keycheck_2026-10-02.txt"
age -r "$PUB" -o "$WORK/nexus_keycheck_2026-10-02.txt.age" "$WORK/nexus_keycheck_2026-10-02.txt"
rm "$WORK/nexus_keycheck_2026-10-02.txt"
TYPED="$(printf '%s' "$GROUPED" | tr 'A-Z' 'a-z')"
if printf '%s\n' "$TYPED" | bash "$DECRYPT" "$WORK/nexus_keycheck_2026-10-02.txt.age" > "$WORK/dec.out" 2>&1; then
    pass "decrypt exits 0"
else
    failt "decrypt failed with the typed paper key"; cat "$WORK/dec.out" >&2
fi
grep -q "PASS" "$WORK/dec.out" && grep -q "Project NEXUS backup key check" "$WORK/dec.out" \
    && pass "says PASS and shows the key-check text" || failt "no PASS / key-check text shown"

echo "case 3: decrypt a backup to a file with --key-file"
printf 'dump contents\n' | gzip > "$WORK/nexus_db_2026-10-02.sql.gz"
age -r "$PUB" -o "$WORK/nexus_db_2026-10-02.sql.gz.age" "$WORK/nexus_db_2026-10-02.sql.gz"
mv "$WORK/nexus_db_2026-10-02.sql.gz" "$WORK/original.sql.gz"
bash "$DECRYPT" --key-file "$WORK/key-a.txt" "$WORK/nexus_db_2026-10-02.sql.gz.age" > "$WORK/dec2.out" 2>&1 || failt "decrypt to file failed"
cmp -s "$WORK/original.sql.gz" "$WORK/nexus_db_2026-10-02.sql.gz" && pass "writes nexus_db_….sql.gz identical to the original" || failt "decrypted file differs or missing"

echo "case 4: wrong key"
age-keygen -o "$WORK/wrong.txt" 2>/dev/null
rm -f "$WORK/nexus_db_2026-10-02.sql.gz"
if bash "$DECRYPT" --key-file "$WORK/wrong.txt" "$WORK/nexus_db_2026-10-02.sql.gz.age" > "$WORK/dec3.out" 2>&1; then
    failt "wrong key reported success"
else
    pass "wrong key exits non-zero"
fi
grep -q "FAIL" "$WORK/dec3.out" && pass "says FAIL" || failt "no FAIL message"
[ -e "$WORK/nexus_db_2026-10-02.sql.gz" ] && failt "left a partial output file behind" || pass "no output file left behind"

grep -q "does NOT open" "$WORK/dec3.out" && pass "wrong key is reported as a key problem" || failt "wrong key not reported as a key problem"

echo "case 4b: right key, but the downloaded file is damaged — must NOT blame the key"
head -c 120 "$WORK/nexus_db_2026-10-02.sql.gz.age" > "$WORK/nexus_db_2026-10-03.sql.gz.age"
if bash "$DECRYPT" --key-file "$WORK/key-a.txt" "$WORK/nexus_db_2026-10-03.sql.gz.age" > "$WORK/dec5.out" 2>&1; then
    failt "damaged file reported as success"
else
    pass "damaged file exits non-zero"
fi
grep -q "does NOT open" "$WORK/dec5.out" && failt "damaged file wrongly blamed on the key" || pass "damaged file not blamed on the key"
grep -qi "not necessarily" "$WORK/dec5.out" && pass "says it is not necessarily the key, and shows why" || failt "no explanation for a non-key failure"

echo "case 5: refuses to overwrite an existing file"
printf 'keep me\n' > "$WORK/nexus_db_2026-10-02.sql.gz"
if bash "$DECRYPT" --key-file "$WORK/key-a.txt" "$WORK/nexus_db_2026-10-02.sql.gz.age" > "$WORK/dec4.out" 2>&1; then
    failt "overwrote an existing file"
else
    pass "refuses to overwrite"
fi
[ "$(cat "$WORK/nexus_db_2026-10-02.sql.gz")" = "keep me" ] && pass "existing file untouched" || failt "existing file changed"

echo
if [ "$FAILURES" -gt 0 ]; then echo "FAILED: $FAILURES check(s)" >&2; exit 1; fi
echo "PASS: owner key tools work, including a key typed back from paper"
