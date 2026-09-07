#!/bin/bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# watchdog-queue.sh — restarts dead Horizon queue workers and alerts via log.
#
# Runs every 5 minutes via cron on the host. Checks both blue and green queue
# containers and restarts any that have exited. Skips containers that were
# intentionally stopped by the deploy script (restart policy = "no").
#
# The installed cron entry runs this file DIRECTLY, with no interpreter, so it
# only works while the file is executable. Git therefore tracks it as mode
# 100755, and scripts/check-host-cron-scripts.mjs keeps it that way.
#
# Do NOT "fix" a permission problem here with a chmod on the server.
# /opt/nexus-php is a git checkout with core.filemode=true, so the next deploy
# reverts it. That is exactly how this script came to be non-executable, and
# therefore silently dead, from 2026-05-22 to 2026-09-07: cron ran it every
# five minutes and got "Permission denied" roughly 31,000 times. Nothing
# noticed, because a watchdog that never runs reports nothing. On 2026-09-06 an
# apt upgrade of docker-ce restarted the container engine, the queue container
# did not come back, and with no watchdog the queue processed no jobs for
# almost five hours (Sentry NEXUS-PHP-2F / NEXUS-PHP-3J).
#
# Verify it is genuinely running — the log must hold something other than
# "Permission denied":
#   sudo tail -5 /opt/nexus-php/logs/watchdog-queue.log
#
# Install:
#   sudo cp scripts/watchdog-queue.sh /opt/nexus-php/scripts/watchdog-queue.sh
#   echo "*/5 * * * * root /opt/nexus-php/scripts/watchdog-queue.sh >> /opt/nexus-php/logs/watchdog-queue.log 2>&1" \
#     | sudo tee /etc/cron.d/nexus-watchdog-queue
#   sudo chmod 644 /etc/cron.d/nexus-watchdog-queue

set -euo pipefail

LOGFILE="/opt/nexus-php/logs/watchdog-queue.log"
CONTAINERS=("nexus-green-php-queue" "nexus-blue-php-queue" "nexus-green-php-scheduler" "nexus-blue-php-scheduler")
RESTARTED=()
SKIPPED=()
TIMESTAMP="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

for container in "${CONTAINERS[@]}"; do
    # Check if container exists at all
    if ! docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$container"; then
        continue
    fi

    # Read restart policy — skip containers intentionally stopped by deploy script
    restart_policy="$(docker inspect "$container" --format '{{.HostConfig.RestartPolicy.Name}}' 2>/dev/null || echo 'unknown')"
    if [ "$restart_policy" = "no" ] || [ "$restart_policy" = "unknown" ]; then
        SKIPPED+=("$container(policy=$restart_policy)")
        continue
    fi

    # Check if the container is currently running
    status="$(docker inspect "$container" --format '{{.State.Status}}' 2>/dev/null || echo 'missing')"
    if [ "$status" = "running" ]; then
        continue
    fi

    # Container exists, has a restart policy, but is NOT running — restart it
    echo "[$TIMESTAMP] WARNING: $container is '$status' (restart_policy=$restart_policy) — restarting" | tee -a "$LOGFILE"
    if docker start "$container" >/dev/null 2>&1; then
        echo "[$TIMESTAMP] OK: $container restarted" | tee -a "$LOGFILE"
        RESTARTED+=("$container")
    else
        echo "[$TIMESTAMP] ERROR: failed to restart $container" | tee -a "$LOGFILE"
    fi
done

if [ ${#RESTARTED[@]} -gt 0 ]; then
    echo "[$TIMESTAMP] WATCHDOG SUMMARY: restarted ${RESTARTED[*]}" | tee -a "$LOGFILE"
fi
