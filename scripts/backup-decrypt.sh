#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# Open an encrypted offsite backup with one of the owner's keys — run on YOUR
# OWN computer (F-123). Two uses:
#
#   Key check (do this after storing a key, and whenever you want reassurance):
#     download a nexus_keycheck_DATE.txt.age file from the Drive backups folder,
#       bash scripts/backup-decrypt.sh nexus_keycheck_DATE.txt.age
#     then type or paste the key from where you stored it (password manager, or
#     the paper copy — spaces and lower case are fine). PASS shows the text
#     inside; FAIL means that copy of the key does NOT open the backups.
#
#   Real restore:
#       bash scripts/backup-decrypt.sh nexus_db_DATE.sql.gz.age
#     writes nexus_db_DATE.sql.gz next to it (refuses to overwrite).
#     Optional second argument: a different output path in the same folder.
#
#   --key-file PATH reads the key from a file instead of asking for it.
#
# The key is read without being shown, is never written to disk, and is passed
# to age on stdin. On Windows (Git Bash) age runs in a throwaway Docker
# container, so nothing needs installing.
#
# Tests: scripts/test/test-backup-owner-tools.sh

set -euo pipefail
umask 077

# Docker image used on Windows. A supported Alpine release; any image with
# `apk add age` works if this one is ever withdrawn (override with AGE_IMAGE).
AGE_IMAGE="${AGE_IMAGE:-alpine:3.22}"

fail() { echo "FAIL: $1" >&2; exit 1; }

KEY_FILE=""
POS=()
while [ $# -gt 0 ]; do
    case "$1" in
        --key-file) [ $# -ge 2 ] || fail "--key-file needs a path"; KEY_FILE="$2"; shift 2 ;;
        -h|--help) sed -n '7,29p' "$0"; exit 0 ;;
        *) POS+=("$1"); shift ;;
    esac
done
[ "${#POS[@]}" -ge 1 ] || fail "usage: backup-decrypt.sh [--key-file PATH] FILE.age [OUTPUT]"
IN="${POS[0]}"
[ -f "$IN" ] || fail "no such file: $IN"
[ "$(head -c 21 "$IN")" = "age-encryption.org/v1" ] || fail "$IN is not an age-encrypted file"

DIR="$(cd "$(dirname "$IN")" && pwd)"
BASE="$(basename "$IN")"
SHOW=0
if [ "${#POS[@]}" -ge 2 ]; then
    OUT_NAME="$(basename "${POS[1]}")"
    [ "$(cd "$(dirname "${POS[1]}")" && pwd)" = "$DIR" ] || fail "the output must be in the same folder as the input"
elif [[ "$BASE" == nexus_keycheck_*.txt.age ]]; then
    SHOW=1
    OUT_NAME=".${BASE%.age}.$$"
else
    OUT_NAME="${BASE%.age}"
fi
[ "$OUT_NAME" != "$BASE" ] || fail "cannot work out an output name; pass one"
[ ! -e "$DIR/$OUT_NAME" ] || fail "$DIR/$OUT_NAME already exists — not overwriting it"
PARTIAL=".${OUT_NAME}.partial.$$"
trap 'rm -f "$DIR/$PARTIAL" "$DIR/.backup-decrypt-err.$$"; [ "$SHOW" = "1" ] && rm -f "$DIR/$OUT_NAME"' EXIT

if [ -n "$KEY_FILE" ]; then
    KEY="$(grep -m1 -i '^AGE-SECRET-KEY-' "$KEY_FILE" || true)"
elif [ -t 0 ]; then
    read -rsp "Type or paste your backup key (it will not be shown): " KEY
    echo
else
    read -r KEY || true
fi
# Accept the paper form: groups separated by spaces, any case.
KEY="$(printf '%s' "$KEY" | tr -d ' \t\r\n' | tr 'a-z' 'A-Z')"
[[ "$KEY" =~ ^AGE-SECRET-KEY-1[0-9A-Z]{58}$ ]] \
    || fail "that does not look like a backup key (it should start AGE-SECRET-KEY-1 and be 74 characters without spaces)"

case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) ON_WINDOWS=1 ;; *) ON_WINDOWS=0 ;; esac
ERR_FILE="$DIR/.backup-decrypt-err.$$"
rc=0
if [ "$ON_WINDOWS" = "0" ] && command -v age >/dev/null 2>&1; then
    printf '%s\n' "$KEY" | age -d -i /dev/stdin -o "$DIR/$PARTIAL" "$DIR/$BASE" 2>"$ERR_FILE" || rc=$?
else
    command -v docker >/dev/null 2>&1 || fail "needs age or Docker. Alternatively install age itself (https://age-encryption.org, or on Windows: winget install FiloSottile.age)."
    HOST_DIR="$(cd "$DIR" && (pwd -W 2>/dev/null || pwd))"
    # Exit 90 = age could not be installed inside the container (no internet,
    # package mirror down). That says nothing about the key.
    printf '%s\n' "$KEY" | MSYS_NO_PATHCONV=1 docker run -i --rm -v "$HOST_DIR:/w" "$AGE_IMAGE" \
        sh -c 'apk add -q age >/dev/null 2>&1 || exit 90; age -d -i /dev/stdin -o "/w/$1" "/w/$2" 2>"/w/$3"' \
        sh "$PARTIAL" "$BASE" "$(basename "$ERR_FILE")" || rc=$?
fi
KEY=""
if [ "$rc" -ne 0 ]; then
    AGE_ERR="$(head -c 400 "$ERR_FILE" 2>/dev/null || true)"
    rm -f "$ERR_FILE"
    if [ "$rc" -eq 90 ]; then
        fail "could not install the age tool in Docker (no internet connection?). This is NOT a problem with your key — try again when online, or install age directly (winget install FiloSottile.age)."
    fi
    if grep -qi "no identity matched" <<<"$AGE_ERR"; then
        fail "this key does NOT open $BASE (age: no identity matched)"
    fi
    fail "could not decrypt $BASE — this is not necessarily a problem with your key. The file may be damaged or incompletely downloaded; download it again and retry. age said: ${AGE_ERR:-no message}"
fi
rm -f "$ERR_FILE"
mv "$DIR/$PARTIAL" "$DIR/$OUT_NAME"

echo "PASS: this key opens $BASE"
if [ "$SHOW" = "1" ]; then
    echo "----- contents -----"
    cat "$DIR/$OUT_NAME"
    echo "--------------------"
else
    echo "Written: $DIR/$OUT_NAME"
fi
