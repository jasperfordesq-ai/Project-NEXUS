#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# deploy.sh — gated production deploy entrypoint. Run this from the dev machine
# instead of the raw SSH command, so every deploy is checked first.
#
#   1. Static-analysis gate (scripts/predeploy-check.sh) — stops the deploy if
#      the code has NEW errors (the job-offers class of bug). Override with
#      ALLOW_PHPSTAN_FAIL=1 if it ever misfires.
#   2. Pushes main to origin (the server deploys what's on origin/main).
#   3. GitHub check gate (scripts/predeploy-ci-check.sh) — waits until GitHub
#      has FULLY checked this exact commit, and refuses if it has not. Override
#      with ALLOW_UNVERIFIED_DEPLOY=1 in a genuine emergency.
#   4. Runs the zero-downtime blue/green deploy on the server (detached).
#
# Step 3 exists because steps 2 and 4 used to run back to back. Pushing is what
# STARTS the CI run, so the deploy and the checks began together and the deploy
# always won — nothing ever read the result. It also rejects a green tick that
# came from skipped jobs, which ci.yml's change-detection produces routinely.
#
# The static gate runs locally in the nexus-php-app container, so it adds only a
# couple of minutes and CANNOT break the server-side deploy machinery. If you
# ever need to bypass everything, the underlying command still works:
#   ssh ... "cd /opt/nexus-php && sudo bash scripts/deploy/bluegreen-deploy.sh deploy --detach"
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# --- warn on uncommitted changes (they won't be deployed) ---
if [ -n "$(git status --porcelain)" ]; then
    echo "[deploy] ⚠ You have uncommitted changes — the deploy ships origin/main, so they will NOT go live."
    echo "[deploy]   Commit + (the script will push) first if you want them included."
fi

# ---------------------------------------------------------------------------
# [0/5] Argument handling — FIRST, before anything with a side effect.
#
# 🔴 TWO FAULTS FIXED HERE, both found auditing this script's own web-uk support.
#
# 1. This loop had no `*)` arm, so an unrecognised argument was SILENTLY IGNORED.
#    `bash scripts/deploy.sh --with-web-uk` (one stray hyphen) set nothing, never
#    reached bluegreen-deploy.sh's own unknown-flag guard, and deployed WITHOUT
#    web-uk while reporting success. That is the same silent no-op the flag was
#    invented to replace — moved from an env var to a typo.
#
# 2. This block used to sit AFTER the push and after the CI wait. So a rejected
#    invocation had already pushed main to origin and burned several minutes
#    waiting for GitHub before refusing. A guard that fires after the
#    irreversible step is not a guard.
# ---------------------------------------------------------------------------
# 🔴 DEFAULT IS NOW `--with-webuk` (changed 2026-08-17). It used to be empty, so a
# routine `bash scripts/deploy.sh` with no flag sent NO flag to the server.
#
# That is not an outage, because the server refuses: the `.webuk-live` marker is
# present on production (written at the 2026-08-12 cutover) and
# `enforce_webuk_live_marker()` exits 2 rather than dropping web-uk. But it refuses
# in step [4/5] — AFTER this script has already pushed to origin and waited for
# GitHub to finish checking the commit. This file's own header says it: a guard
# that fires after the irreversible step is not a guard.
#
# Since 2026-08-14 there is no such thing as a correct flagless deploy. Blade is
# deleted, so excluding web-uk takes every accessible hostname OFFLINE rather than
# falling back to anything. The safe case is therefore the default, and the
# dangerous one has to be said out loud — which is the same shape as the
# server-side rule, not a new policy.
WEBUK_FLAG=" --with-webuk"
WEBUK_FLAG_EXPLICIT=0
for arg in "$@"; do
    case "$arg" in
        --with-webuk) WEBUK_FLAG=" --with-webuk"; WEBUK_FLAG_EXPLICIT=1 ;;
        --without-webuk) WEBUK_FLAG=" --without-webuk"; WEBUK_FLAG_EXPLICIT=1 ;;
        -h|--help)
            echo "Usage: bash scripts/deploy.sh [--with-webuk | --without-webuk]"
            echo ""
            echo "  --with-webuk     include the web-uk accessible frontend (THE DEFAULT)"
            echo "  --without-webuk  deliberately exclude it — this takes every accessible"
            echo "                   hostname OFFLINE, because the Blade frontend they used"
            echo "                   to fall back to was deleted on 2026-08-14"
            exit 0
            ;;
        *)
            echo "===> Unrecognised argument: $arg"
            echo "===> Nothing has been pushed or deployed."
            echo "===>"
            echo "===> Known arguments: --with-webuk, --without-webuk"
            echo "===> (a mistyped flag used to be ignored, and the deploy would"
            echo "===>  quietly proceed without web-uk while reporting success)"
            exit 2
            ;;
    esac
done
if [ -n "${NEXUS_DEPLOY_WEBUK:-}" ] && [ "$WEBUK_FLAG_EXPLICIT" = "0" ]; then
    # Refuse rather than silently ignoring it. Someone setting this variable
    # clearly INTENDS to deploy web-uk; dropping it quietly is the exact fault
    # this guard exists to prevent.
    #
    # 🔴 web-uk is opt-in, and it MUST travel as a FLAG. This script reaches the
    # server over SSH and runs the deploy under `sudo`. Neither forwards
    # environment variables, so `NEXUS_DEPLOY_WEBUK=1 bash scripts/deploy.sh`
    # deployed WITHOUT web-uk, succeeded, and reported success.
    echo "===> NEXUS_DEPLOY_WEBUK is set, but it CANNOT reach the server:"
    echo "===>   this script deploys over SSH under sudo, and neither forwards"
    echo "===>   environment variables. Use the flag instead:"
    echo "===>       bash scripts/deploy.sh --with-webuk"
    echo "===> Nothing has been pushed or deployed."
    exit 2
fi

echo "===> [1/4] Pre-deploy static-analysis gate"
if ! bash scripts/predeploy-check.sh; then
    echo "===> Deploy ABORTED. Fix the errors above, or re-run as: ALLOW_PHPSTAN_FAIL=1 bash scripts/deploy.sh"
    exit 1
fi

echo "===> [2/4] Pushing main to origin"
git push origin main || { echo "===> Push failed — aborting deploy."; exit 1; }

echo "===> [3/4] Confirming GitHub has fully checked this commit"
if [ "${ALLOW_UNVERIFIED_DEPLOY:-0}" = "1" ]; then
    echo ""
    echo "    ⚠  ⚠  ⚠   ALLOW_UNVERIFIED_DEPLOY=1 is set."
    echo "    ⚠   Deploying code that GitHub has NOT confirmed as fully checked."
    echo "    ⚠   Only do this in a genuine emergency, and check the result yourself."
    echo ""
else
    if ! bash scripts/predeploy-ci-check.sh --trigger; then
        echo ""
        echo "===> Deploy ABORTED — this commit has not been fully checked."
        echo "===> Nothing was deployed. Your code IS pushed to origin/main."
        echo "===> Fix whatever failed above, push again, and re-run this script."
        echo "===> In a real emergency only: ALLOW_UNVERIFIED_DEPLOY=1 bash scripts/deploy.sh"
        exit 1
    fi
fi

echo "===> [4/5] Blue/green deploy (zero-downtime, detached)"
if [ "$WEBUK_FLAG_EXPLICIT" = "1" ]; then
    echo "===>       web-uk:$WEBUK_FLAG"
else
    echo "===>       web-uk:$WEBUK_FLAG (default — no flag was given)"
fi
if [ "$WEBUK_FLAG" = " --without-webuk" ]; then
    echo "===>"
    echo "===> ⚠  --without-webuk WILL TAKE THE ACCESSIBLE HOSTNAMES OFFLINE."
    echo "===>    accessible.project-nexus.ie, accessible-uk.timebank.global,"
    echo "===>    accessible-minehead-and-coast.timebank.global and /{slug}/accessible"
    echo "===>    have nothing to fall back to since Blade was deleted on 2026-08-14."
    echo "===>"
fi
ENV_FILE=".secrets.local/deploy.env"
[ -f "$ENV_FILE" ] || { echo "===> Missing $ENV_FILE — cannot reach the server."; exit 2; }
SSH_HOST=$(grep ^PROD_SSH_HOST "$ENV_FILE" | cut -d= -f2-)
SSH_KEY=$(grep ^PROD_SSH_KEY "$ENV_FILE" | cut -d= -f2-)
ssh -i "$SSH_KEY" -o RequestTTY=force "$SSH_HOST" \
    "cd /opt/nexus-php && sudo git fetch origin main && sudo git reset --hard origin/main && sudo bash scripts/deploy/bluegreen-deploy.sh deploy --detach$WEBUK_FLAG"

echo ""
echo "===> Deploy launched. Watch it with:"
echo "       ssh -i \"\$PROD_SSH_KEY\" \"\$PROD_SSH_HOST\" \"cd /opt/nexus-php && sudo bash scripts/deploy/bluegreen-deploy.sh monitor\""

# --- [5/5] post-deploy watch -------------------------------------------------
# The blue/green engine smoke-tests the candidate BEFORE the traffic switch,
# but nothing used to watch the minutes AFTER it. Wait for the deploy to
# finish, then watch production error rates for 30 minutes against the new
# release tag. On a spike it alarms and prints the rollback command — it never
# rolls back by itself. Skip with SKIP_POSTDEPLOY_WATCH=1 (e.g. when a second
# deploy will immediately supersede this one).
if [ "${SKIP_POSTDEPLOY_WATCH:-0}" = "1" ]; then
    echo "===> [5/5] Post-deploy watch SKIPPED (SKIP_POSTDEPLOY_WATCH=1)."
    exit 0
fi

echo "===> [5/5] Waiting for the deploy to finish, then watching error rates (~50 min total)"
DEPLOY_DEADLINE=$(( $(date +%s) + 45 * 60 ))
while :; do
    STATE=$(ssh -i "$SSH_KEY" -o RequestTTY=force -o ConnectTimeout=20 "$SSH_HOST" \
        "cd /opt/nexus-php && sudo bash scripts/deploy/bluegreen-deploy.sh status" 2>/dev/null \
        | grep '^status=' | head -1 | cut -d= -f2)
    case "$STATE" in
        success) echo "===> Deploy finished on the server. Starting the 30-minute error watch."; break ;;
        failed)  echo "===> Deploy FAILED on the server — see: bluegreen-deploy.sh logs. No watch needed."; exit 1 ;;
    esac
    if [ "$(date +%s)" -ge "$DEPLOY_DEADLINE" ]; then
        echo "===> Deploy still not finished after 45 minutes — check it manually. Skipping the watch."
        exit 1
    fi
    echo "     ...deploy ${STATE:-starting}. Checking again in 60s."
    sleep 60
done

if node scripts/postdeploy-watch.mjs; then
    echo "===> ✓ Deploy verified: error levels stayed normal after the switch."
else
    WATCH_RC=$?
    if [ "$WATCH_RC" = "1" ]; then
        echo "===> ⚠⚠⚠ ERROR SPIKE after this deploy — read the output above; the rollback command is printed there."
        exit 1
    fi
    echo "===> ⚠ The watch could not run (see above) — the deploy is live but UNVERIFIED."
fi
