#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# Set up encryption for the offsite backups — run ON THE PRODUCTION SERVER as
# root (F-123). Safe to re-run.
#
#   sudo bash /opt/nexus-php/scripts/setup-backup-encryption.sh \
#       --owner-key age1...A --owner-key age1...B
#
# Writes, all root-only (0600):
#   /opt/nexus-php/.backup-age-recipients  the PUBLIC keys every offsite file is
#                                          encrypted to: the owner's two keys
#                                          plus the drill key
#   /opt/nexus-php/.backup-drill-key       the restore drill's private key,
#                                          generated here once and never replaced
#   /opt/nexus-php/.backup-alerts.env      Telegram bot token + chat id for the
#                                          backup and drill alerts (only if absent)
#
# The owner's PRIVATE keys never come near this server. Make them on your own
# computer with scripts/backup-keygen.sh; only the "age1..." public halves are
# passed here. A private key ("AGE-SECRET-KEY-...") is refused.
#
# Telegram values are read from TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID if set,
# otherwise asked for (the token is not echoed). --no-alerts skips that step.
#
# Tests: scripts/test/test-setup-backup-encryption.sh

set -euo pipefail
umask 077

RECIPIENTS_FILE="${BACKUP_AGE_RECIPIENTS_FILE:-/opt/nexus-php/.backup-age-recipients}"
DRILL_KEY="${DRILL_IDENTITY_FILE:-/opt/nexus-php/.backup-drill-key}"
ALERT_ENV="${BACKUP_ALERT_ENV:-/opt/nexus-php/.backup-alerts.env}"

fail() { echo "✗ $1" >&2; exit 1; }
ok()   { echo "✓ $1"; }

OWNER_KEYS=()
SKIP_ALERTS=0
while [ $# -gt 0 ]; do
    case "$1" in
        --owner-key) [ $# -ge 2 ] || fail "--owner-key needs a value"; OWNER_KEYS+=("$2"); shift 2 ;;
        --no-alerts) SKIP_ALERTS=1; shift ;;
        -h|--help) sed -n '7,30p' "$0"; exit 0 ;;
        *) fail "unknown argument: $1" ;;
    esac
done

command -v age >/dev/null 2>&1 && command -v age-keygen >/dev/null 2>&1 \
    || fail "age is not installed (apt-get install -y age)"

# 1. Validate the owner's public keys BEFORE touching anything.
[ "${#OWNER_KEYS[@]}" -ge 2 ] \
    || fail "give at least two owner keys (--owner-key age1... twice): one lost key must not lose the backups"
for k in "${OWNER_KEYS[@]}"; do
    case "$k" in
        AGE-SECRET-KEY-*) fail "that is a PRIVATE key. Never put a private key on the server — pass the public 'age1...' line" ;;
    esac
    [[ "$k" =~ ^age1[0-9a-z]{58}$ ]] || fail "not an age public key: ${k:0:20}..."
done
if [ "$(printf '%s\n' "${OWNER_KEYS[@]}" | sort -u | wc -l)" -ne "${#OWNER_KEYS[@]}" ]; then
    fail "the same key was given twice — the two keys must be different keys"
fi

# 2. Drill key: generate once, never replace (replacing it would make the
#    drill fail on every backup encrypted before the change).
if [ -s "$DRILL_KEY" ]; then
    ok "drill key already exists: $DRILL_KEY (kept)"
else
    age-keygen -o "$DRILL_KEY" 2>/dev/null
    ok "drill key generated: $DRILL_KEY"
fi
chmod 600 "$DRILL_KEY"
DRILL_PUB="$(age-keygen -y "$DRILL_KEY")"

# 3. Recipients file, written atomically.
TMP="$(mktemp "${RECIPIENTS_FILE}.XXXXXX")"
{
    echo "# Project NEXUS offsite backup recipients — PUBLIC keys only (F-123)."
    echo "# Written by scripts/setup-backup-encryption.sh on $(date -u '+%Y-%m-%d %H:%M UTC')."
    echo "# Any ONE matching private key opens every offsite backup."
    i=1
    for k in "${OWNER_KEYS[@]}"; do
        echo "# owner key $i"
        echo "$k"
        i=$((i + 1))
    done
    echo "# restore drill key (private half: $DRILL_KEY)"
    echo "$DRILL_PUB"
} > "$TMP"
chmod 600 "$TMP"
mv "$TMP" "$RECIPIENTS_FILE"
ok "recipients written: $RECIPIENTS_FILE"
grep -E '^age1' "$RECIPIENTS_FILE" | sed 's/^/    /'

# 4. Telegram alert credentials (only if not already present).
if [ "$SKIP_ALERTS" = "1" ]; then
    echo "⚠ alerts skipped (--no-alerts): the restore drill will FAIL until $ALERT_ENV exists"
elif [ -s "$ALERT_ENV" ]; then
    ok "alert credentials already exist: $ALERT_ENV (kept)"
else
    token="${TELEGRAM_BOT_TOKEN:-}"
    chat="${TELEGRAM_CHAT_ID:-}"
    if [ -z "$token" ]; then read -rsp "Telegram bot token (not shown): " token; echo; fi
    if [ -z "$chat" ];  then read -rp  "Telegram chat id: " chat; fi
    [ -n "$token" ] && [ -n "$chat" ] || fail "Telegram token and chat id are both needed (or pass --no-alerts)"
    printf 'TELEGRAM_BOT_TOKEN=%s\nTELEGRAM_CHAT_ID=%s\n' "$token" "$chat" > "$ALERT_ENV"
    chmod 600 "$ALERT_ENV"
    ok "alert credentials written: $ALERT_ENV"
fi

echo
echo "Done. Next: run the nightly backup once by hand and then the restore drill:"
echo "  sudo bash /opt/nexus-php/scripts/server-nightly-backup.sh"
echo "  sudo bash /opt/nexus-php/scripts/restore-drill.sh"
