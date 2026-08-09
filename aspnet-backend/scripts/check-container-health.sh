#!/bin/bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# Container health check — detects memory pressure and OOMKill events.
# /health alone won't show containers being reaped by the kernel; this does.
#
# Usage:
#   # From local workstation (SSH into prod):
#   bash scripts/check-container-health.sh
#
#   # On the production server directly:
#   sudo LOCAL_MODE=1 bash scripts/check-container-health.sh
#
#   # As cron (every 15 min):
#   */15 * * * * sudo LOCAL_MODE=1 bash /opt/nexus-backend/scripts/check-container-health.sh \
#                  >> /opt/nexus-backend/logs/container-health.log 2>&1
#
# Exit codes:
#   0 = healthy (warnings allowed)
#   1 = at least one container OOMKilled or memory > threshold
#   2 = SSH/docker failure (could not collect data)

set -u

# Optional secrets file for SSH mode
[ -f "$(dirname "$0")/../.secrets.local/deploy.env" ] && . "$(dirname "$0")/../.secrets.local/deploy.env"

SSH_KEY="${SSH_KEY:-${PROD_SSH_KEY:-}}"
SSH_HOST="${SSH_HOST:-${PROD_SSH_HOST:-${NEXUS_DEPLOY_HOST:-}}}"
MEM_THRESHOLD_PCT="${MEM_THRESHOLD_PCT:-90}"
OOM_LOOKBACK="${OOM_LOOKBACK:-1h}"
CONTAINER_NAME_RE='nexus-backend-(api|db|rabbitmq|meilisearch)|nexus-react-prod|nexus-(blue|green)-(api|frontend)'

if [ "${LOCAL_MODE:-0}" != "1" ]; then
    if [ -z "$SSH_KEY" ] || [ -z "$SSH_HOST" ]; then
        echo "ERROR: SSH_HOST and SSH_KEY (or PROD_SSH_HOST/PROD_SSH_KEY/NEXUS_DEPLOY_HOST) must be set," >&2
        echo "       or run with LOCAL_MODE=1 on the prod server itself." >&2
        exit 1
    fi
fi
SSH_OPTS="-i \"$SSH_KEY\" -o RequestTTY=force -o StrictHostKeyChecking=accept-new"

if [ -t 1 ]; then
    RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
    CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
else
    RED=''; GREEN=''; YELLOW=''; CYAN=''; BOLD=''; NC=''
fi

log_ok()   { echo -e "${GREEN}[PASS]${NC} $1"; }
log_info() { echo -e "${CYAN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_err()  { echo -e "${RED}[FAIL]${NC} $1"; }

run_remote() {
    local cmd="$1"
    if [ "${LOCAL_MODE:-0}" = "1" ]; then
        bash -c "$cmd"
    else
        # shellcheck disable=SC2086
        eval ssh $SSH_OPTS "$SSH_HOST" "'$cmd'"
    fi
}

FAIL=0
WARN=0

echo -e "${BOLD}Project NEXUS .NET Edition — Container Health Check${NC}"
MODE_LABEL=$([ "${LOCAL_MODE:-0}" = "1" ] && echo "local" || echo "ssh")
echo "Host: ${SSH_HOST:-localhost}  |  Mode: ${MODE_LABEL}"
echo "Mem threshold: ${MEM_THRESHOLD_PCT}%  |  OOM lookback: ${OOM_LOOKBACK}"
echo "============================================================"

# 1. Per-container memory + CPU
echo ""
echo -e "${BOLD}1. Container resource usage${NC}"

STATS_RAW=$(run_remote "sudo docker stats --no-stream --format '{{.Name}}|{{.MemUsage}}|{{.MemPerc}}|{{.CPUPerc}}' | grep -E '^(${CONTAINER_NAME_RE})\\|' || true") || {
    log_err "Could not collect docker stats (SSH or docker failed)"
    exit 2
}

if [ -z "$STATS_RAW" ]; then
    log_err "No Project NEXUS .NET Edition containers from the allowlist were found on host"
    exit 2
fi

printf "  %-28s %-22s %-10s %-10s %s\n" "CONTAINER" "MEM USAGE" "MEM%" "CPU%" "STATUS"
while IFS='|' read -r NAME MEM_USAGE MEM_PCT CPU_PCT; do
    [ -z "$NAME" ] && continue
    MEM_NUM="${MEM_PCT%\%}"
    MEM_INT=$(printf '%.0f' "${MEM_NUM:-0}" 2>/dev/null || echo 0)
    STATUS="${GREEN}OK${NC}"
    if [ "$MEM_INT" -ge "$MEM_THRESHOLD_PCT" ]; then
        STATUS="${RED}HIGH${NC}"
        FAIL=$((FAIL + 1))
    elif [ "$MEM_INT" -ge $((MEM_THRESHOLD_PCT - 15)) ]; then
        STATUS="${YELLOW}WARN${NC}"
        WARN=$((WARN + 1))
    fi
    printf "  %-28s %-22s %-10s %-10s ${STATUS}\n" "$NAME" "$MEM_USAGE" "$MEM_PCT" "$CPU_PCT"
done <<< "$STATS_RAW"

# 2. OOMKill / die events
echo ""
echo -e "${BOLD}2. OOMKill / die events (last ${OOM_LOOKBACK})${NC}"

OOM_EVENTS=$(run_remote "sudo docker events --since ${OOM_LOOKBACK} --until 0s --filter event=oom --filter event=die --format '{{.Time}} {{.Type}} {{.Action}} {{.Actor.Attributes.name}}' 2>/dev/null | grep -E ' (${CONTAINER_NAME_RE})\$' || true")

if [ -z "$OOM_EVENTS" ]; then
    log_ok "No OOM or die events in last ${OOM_LOOKBACK}"
else
    OOM_COUNT=$(echo "$OOM_EVENTS" | grep -c ' oom ' || true)
    DIE_COUNT=$(echo "$OOM_EVENTS" | grep -c ' die ' || true)
    if [ "$OOM_COUNT" -gt 0 ]; then
        log_err "Detected ${OOM_COUNT} OOMKill event(s):"
        echo "$OOM_EVENTS" | grep ' oom ' | sed 's/^/    /'
        FAIL=$((FAIL + 1))
    fi
    if [ "$DIE_COUNT" -gt 0 ]; then
        log_warn "Detected ${DIE_COUNT} die event(s) (may be routine restarts):"
        echo "$OOM_EVENTS" | grep ' die ' | sed 's/^/    /'
        WARN=$((WARN + 1))
    fi
fi

# 3. OOMKilled flag + restart count + policy
echo ""
echo -e "${BOLD}3. Container state (OOMKilled / RestartCount / Policy)${NC}"

CONTAINERS=$(run_remote "sudo docker ps --format '{{.Names}}' | grep -E '^(${CONTAINER_NAME_RE})\$' || true")
while read -r CNAME; do
    [ -z "$CNAME" ] && continue
    INSPECT=$(run_remote "sudo docker inspect $CNAME --format '{{.State.OOMKilled}}|{{.State.RestartCount}}|{{.HostConfig.RestartPolicy.Name}}|{{.State.Status}}' 2>/dev/null || echo 'ERR|0|none|unknown'")
    IFS='|' read -r OOMK RCOUNT POLICY STATE <<< "$INSPECT"
    LINE=$(printf "  %-28s OOMKilled=%-5s RestartCount=%-3s Policy=%-12s Status=%s" "$CNAME" "$OOMK" "$RCOUNT" "$POLICY" "$STATE")
    if [ "$OOMK" = "true" ]; then
        echo -e "${RED}${LINE}${NC}"
        FAIL=$((FAIL + 1))
    elif [ "${RCOUNT:-0}" -gt 3 ]; then
        echo -e "${YELLOW}${LINE}  (high restart count)${NC}"
        WARN=$((WARN + 1))
    else
        echo -e "${GREEN}${LINE}${NC}"
    fi
done <<< "$CONTAINERS"

echo ""
echo "============================================================"
if [ $FAIL -gt 0 ]; then
    log_err "Health check FAILED: ${FAIL} critical issue(s), ${WARN} warning(s)"
    echo ""
    echo "Runbook:"
    echo "  1. Inspect logs:   sudo docker logs --tail 200 <container-from-output>"
    echo "  2. Check limits:   grep -A2 'deploy:' compose.yml"
    echo "  3. Raise limit:    edit compose.yml -> deploy.resources.limits.memory"
    echo "  4. Redeploy:       bash scripts/deploy.sh"
    exit 1
elif [ $WARN -gt 0 ]; then
    log_warn "Health check passed with ${WARN} warning(s)"
    exit 0
else
    log_ok "All containers healthy"
    exit 0
fi
