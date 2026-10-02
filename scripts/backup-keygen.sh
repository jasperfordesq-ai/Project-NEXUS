#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# Make one backup decryption key — run on YOUR OWN computer, never the server
# (F-123). Run it twice, once per key:
#
#   bash scripts/backup-keygen.sh --save .secrets.local/backup-age-key-A.txt   # key A
#   bash scripts/backup-keygen.sh                                              # key B (paper)
#
# It prints:
#   - the PRIVATE key, which opens every offsite backup. Keep it secret. Store it
#     where you decided (password manager, paper in the safe). Anyone holding it
#     can read the backups; if every copy of every key is lost, so are the backups;
#   - the same private key in groups of four, easier to copy onto paper and to
#     type back in (scripts/backup-decrypt.sh accepts the spaces and any case);
#   - the PUBLIC key ("age1..."), which only locks. Give that to
#     scripts/setup-backup-encryption.sh on the server. It is safe to share.
#
# --save PATH also writes the private key to PATH (0600, refuses to overwrite).
#
# Uses a local age-keygen on Linux/macOS; on Windows (Git Bash) it runs age in a
# throwaway Docker container, so nothing needs installing. Nothing is sent over
# the network except Docker fetching the age package.
#
# Tests: scripts/test/test-backup-owner-tools.sh

set -euo pipefail
umask 077

SAVE=""
while [ $# -gt 0 ]; do
    case "$1" in
        --save) [ $# -ge 2 ] || { echo "--save needs a path" >&2; exit 1; }; SAVE="$2"; shift 2 ;;
        -h|--help) sed -n '7,27p' "$0"; exit 0 ;;
        *) echo "unknown argument: $1" >&2; exit 1 ;;
    esac
done
if [ -n "$SAVE" ] && [ -e "$SAVE" ]; then
    echo "✗ $SAVE already exists — refusing to overwrite a key" >&2
    exit 1
fi

case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) ON_WINDOWS=1 ;; *) ON_WINDOWS=0 ;; esac

if [ "$ON_WINDOWS" = "0" ] && command -v age-keygen >/dev/null 2>&1; then
    OUT="$(age-keygen 2>/dev/null)"
else
    command -v docker >/dev/null 2>&1 || { echo "✗ needs age-keygen or Docker" >&2; exit 1; }
    OUT="$(MSYS_NO_PATHCONV=1 docker run --rm alpine:3.20 sh -c 'apk add -q age >/dev/null 2>&1 && age-keygen 2>/dev/null')"
fi

SECRET="$(printf '%s\n' "$OUT" | grep -m1 '^AGE-SECRET-KEY-1')"
PUBLIC="$(printf '%s\n' "$OUT" | grep -m1 -oE 'age1[0-9a-z]{58}')"
[ -n "$SECRET" ] && [ -n "$PUBLIC" ] || { echo "✗ key generation failed" >&2; exit 1; }
GROUPED="AGE-SECRET-KEY-1 $(printf '%s' "${SECRET#AGE-SECRET-KEY-1}" | fold -w4 | paste -sd' ' -)"

if [ -n "$SAVE" ]; then
    mkdir -p "$(dirname "$SAVE")"
    printf '%s\n' "$OUT" > "$SAVE"
    chmod 600 "$SAVE"
fi

cat <<EOF

================  PRIVATE KEY — KEEP SECRET  ================
${SECRET}

Same key in groups of four (for the paper copy):
  ${GROUPED}
=============================================================

PUBLIC KEY — give this to the server (safe to share):
${PUBLIC}

EOF
if [ -n "$SAVE" ]; then
    echo "Private key also saved to: $SAVE (readable only by you)"
fi
cat <<'EOF'
Before relying on this key, prove the copy you stored works:
  bash scripts/backup-decrypt.sh <a nexus_keycheck_….txt.age file>
and type the key back in from where you stored it.
EOF
