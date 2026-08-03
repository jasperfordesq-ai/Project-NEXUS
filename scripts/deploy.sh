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

echo "===> [4/4] Blue/green deploy (zero-downtime, detached)"
ENV_FILE=".secrets.local/deploy.env"
[ -f "$ENV_FILE" ] || { echo "===> Missing $ENV_FILE — cannot reach the server."; exit 2; }
SSH_HOST=$(grep ^PROD_SSH_HOST "$ENV_FILE" | cut -d= -f2-)
SSH_KEY=$(grep ^PROD_SSH_KEY "$ENV_FILE" | cut -d= -f2-)
ssh -i "$SSH_KEY" -o RequestTTY=force "$SSH_HOST" \
    "cd /opt/nexus-php && sudo git fetch origin main && sudo git reset --hard origin/main && sudo bash scripts/deploy/bluegreen-deploy.sh deploy --detach"

echo ""
echo "===> Deploy launched. Watch it with:"
echo "       ssh -i \"\$PROD_SSH_KEY\" \"\$PROD_SSH_HOST\" \"cd /opt/nexus-php && sudo bash scripts/deploy/bluegreen-deploy.sh monitor\""
