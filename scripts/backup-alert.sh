#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# Telegram alerting for the host backup jobs (server-nightly-backup.sh,
# restore-drill.sh). Source it, then call:
#
#   backup_alert "TITLE" "message body"
#
# Credentials come from a root-only file on the server (never the repository):
#   /opt/nexus-php/.backup-alerts.env   (override with BACKUP_ALERT_ENV)
#     TELEGRAM_BOT_TOKEN=...
#     TELEGRAM_CHAT_ID=...
#
# The file is parsed, not sourced, so a bad line cannot run code as root. The
# bot token goes to curl on stdin (`-K -`), so it never appears in `ps`. The
# Telegram response is discarded, never echoed into a log.
#
# Returns non-zero when the alert could NOT be sent, and says so loudly on
# stderr: a backup failure nobody hears about is the failure mode this exists
# to prevent.

BACKUP_ALERT_ENV="${BACKUP_ALERT_ENV:-/opt/nexus-php/.backup-alerts.env}"

_backup_alert_value() {
    grep -E "^$1=" "$BACKUP_ALERT_ENV" 2>/dev/null | head -1 | cut -d= -f2- | tr -d "\"' \r"
}

backup_alert() {
    local title="$1" body="$2" token="" chat=""
    if [ -r "$BACKUP_ALERT_ENV" ]; then
        token="$(_backup_alert_value TELEGRAM_BOT_TOKEN)"
        chat="$(_backup_alert_value TELEGRAM_CHAT_ID)"
    fi
    if [ -z "$token" ] || [ -z "$chat" ]; then
        echo "CANNOT SEND ALERT: no TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID in $BACKUP_ALERT_ENV." >&2
        echo "Nobody is being told about this: \"$title\"" >&2
        return 1
    fi
    if ! printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$token" \
        | curl -sS --max-time 20 --retry 2 -K - \
            --data-urlencode "chat_id=${chat}" \
            --data-urlencode "text=${title}

${body}

host: $(hostname 2>/dev/null || echo unknown)" >/dev/null 2>&1; then
        echo "Telegram send failed for: \"$title\"" >&2
        return 1
    fi
    return 0
}
