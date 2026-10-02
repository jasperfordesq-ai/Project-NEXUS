#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# F-123: contract checks on the two interactive Google Drive setup scripts,
# which cannot be run end to end in CI (browser sign-in, ssh to production).
#
#   setup-rclone-local.sh  — must request the narrow `drive.file` scope (only
#                            files rclone itself creates), never full `drive`,
#                            and must send the server ONLY the backup remote's
#                            section, not the whole local rclone.conf.
#   setup-rclone-gdrive.sh — must not install anything by piping a download
#                            into a shell; rclone and age come from apt.
#
# Plain bash + grep; runs anywhere:  bash scripts/test/test-backup-setup-contract.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCAL="$REPO_ROOT/scripts/setup-rclone-local.sh"
SERVER="$REPO_ROOT/scripts/setup-rclone-gdrive.sh"
FAILURES=0
pass() { echo "  ok   $1"; }
failt() { echo "  FAIL $1" >&2; FAILURES=$((FAILURES + 1)); }

code() { grep -v '^[[:space:]]*#' "$1"; }   # ignore comment lines

if code "$LOCAL" | grep -qE 'rclone config create .*scope=drive\.file( |$)'; then
    pass "local setup creates the remote with scope=drive.file"
else
    failt "local setup does not request scope=drive.file"
fi
if code "$LOCAL" | grep -qE 'scope=drive([^.]|$)'; then
    failt "local setup still requests full-Drive scope=drive"
else
    pass "no full-Drive scope requested"
fi
if code "$LOCAL" | grep -qiE 'full access'; then
    failt "interactive fallback still tells the operator to choose full access"
else
    pass "interactive fallback no longer says 'full access'"
fi
if code "$LOCAL" | grep -qE 'scp .*"\$RCLONE_CONF"'; then
    failt "local setup uploads the whole rclone.conf (every remote's token)"
else
    pass "whole rclone.conf is not uploaded"
fi
if code "$LOCAL" | grep -qE 'rclone config show "\$\{?REMOTE_NAME\}?"'; then
    pass "only the backup remote's section is extracted for upload"
else
    failt "backup remote's section is not extracted with rclone config show"
fi

if code "$SERVER" | grep -qE '(curl|wget)[^|]*\|[[:space:]]*(sudo[[:space:]]+)?(ba|z)?sh'; then
    failt "server setup still pipes a download into a shell"
else
    pass "no curl|bash in server setup"
fi
if code "$SERVER" | grep -qE 'apt-get install -y[^#]*\brclone\b'; then
    pass "rclone installed from apt"
else
    failt "rclone not installed from apt"
fi
if code "$SERVER" | grep -qE 'apt-get install -y[^#]*\bage\b'; then
    pass "age installed from apt"
else
    failt "age not installed from apt"
fi

echo
if [ "$FAILURES" -gt 0 ]; then echo "FAILED: $FAILURES check(s)" >&2; exit 1; fi
echo "PASS: Drive setup scripts request the narrow scope and install from apt"
