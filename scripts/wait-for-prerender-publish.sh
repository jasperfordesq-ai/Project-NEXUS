#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# wait-for-prerender-publish.sh — block until the server's detached post-deploy
# render for one commit has finished (published or given up), so that the
# crawler delivery probe in scripts/deploy.sh measures the NEW snapshots.
#
# WHY: the probe used to fire seconds after the traffic switch. The detached
# render (bluegreen-deploy.sh forks it after the switch + Cloudflare purge)
# takes five to forty minutes, so the probe measured the previous generation
# and reported the master tenant BLANK on two consecutive deploys where the
# render then succeeded. A probe that is always too early trains people to
# ignore it — and being ignored is how the two-month blank-shell outage lasted.
#
# Usage:   bash scripts/wait-for-prerender-publish.sh <full-commit-sha>
# Needs:   SSH_KEY, SSH_HOST (the same values scripts/deploy.sh already has)
# Tuning:  PRERENDER_WAIT_TIMEOUT_SECONDS (default 1500 = 25 min)
#          PRERENDER_WAIT_POLL_SECONDS    (default 30)
#          PRERENDER_WAIT_NOLOG_GRACE_SECONDS (default 180: how long to wait for
#          the log to appear at all before concluding no render was launched)
#
# Exit codes — it never fails a deploy and never signals anything on the server:
#   0  the render log recorded "Prerender background end" (any render exit code:
#      a failed render has still stopped writing, so probing now is meaningful)
#   2  timed out while the render was still running
#   3  no render log ever appeared for this commit (e.g. --skip-prerender)
#   64 bad arguments
set -uo pipefail

SHA="${1:-}"
if [[ ! "$SHA" =~ ^[0-9a-f]{12,40}$ ]]; then
    echo "[prerender-wait] usage: $0 <commit-sha> (12–40 hex chars); got: ${SHA:-<empty>}" >&2
    exit 64
fi
: "${SSH_KEY:?SSH_KEY is required}"
: "${SSH_HOST:?SSH_HOST is required}"

TIMEOUT="${PRERENDER_WAIT_TIMEOUT_SECONDS:-1500}"
POLL="${PRERENDER_WAIT_POLL_SECONDS:-30}"
NOLOG_GRACE="${PRERENDER_WAIT_NOLOG_GRACE_SECONDS:-180}"
SHORT="${SHA:0:12}"
REMOTE_LOG_DIR="${PRERENDER_REMOTE_LOG_DIR:-/opt/nexus-php/logs}"

# One remote round-trip per poll. The log name is fixed by bluegreen-deploy.sh:
#   $LOG_DIR/prerender-detached-<sha:0:12>-<timestamp>.log
# and the subshell that owns it writes "Prerender background end (exit=N)" as
# its last render line. Logs are root-owned, hence sudo (sudoers uses use_pty,
# hence RequestTTY=force — same as every other SSH in deploy.sh).
REMOTE_CMD="L=\$(sudo ls -t ${REMOTE_LOG_DIR}/prerender-detached-${SHORT}-*.log 2>/dev/null | head -n 1); \
if [ -z \"\$L\" ]; then echo NOLOG; \
elif sudo grep -q 'Prerender background end' \"\$L\"; then sudo grep -o 'Prerender background end (exit=[0-9]*)' \"\$L\" | tail -n 1; \
else echo RUNNING; fi"

START=$(date +%s)
while :; do
    ANSWER="$(ssh -i "$SSH_KEY" -o RequestTTY=force -o ConnectTimeout=20 "$SSH_HOST" "$REMOTE_CMD" 2>/dev/null \
        | tr -d '\r' | grep -E 'NOLOG|RUNNING|Prerender background end' | tail -n 1)"
    NOW=$(date +%s)
    ELAPSED=$(( NOW - START ))
    case "$ANSWER" in
        *"Prerender background end"*)
            echo "[prerender-wait] render for ${SHORT} finished after ${ELAPSED}s: ${ANSWER}"
            exit 0 ;;
        NOLOG)
            if [ "$ELAPSED" -ge "$NOLOG_GRACE" ]; then
                echo "[prerender-wait] no detached render log for ${SHORT} after ${ELAPSED}s — no render was launched for this deploy."
                exit 3
            fi
            echo "[prerender-wait] ...render log for ${SHORT} not there yet (${ELAPSED}s)." ;;
        RUNNING)
            echo "[prerender-wait] ...render for ${SHORT} still running (${ELAPSED}s)." ;;
        *)
            echo "[prerender-wait] ...could not read the render state (${ELAPSED}s); will retry." ;;
    esac
    if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
        echo "[prerender-wait] render for ${SHORT} still not finished after ${TIMEOUT}s — giving up waiting (it keeps running on the server)."
        exit 2
    fi
    sleep "$POLL"
done
