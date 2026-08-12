#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# predeploy-ci-check.sh — refuse to deploy code GitHub has not fully checked.
#
# WHY THIS EXISTS
# ---------------
# scripts/deploy.sh used to push to origin/main and immediately launch the
# blue/green deploy. But pushing is the thing that STARTS the CI run, so the
# deploy and the checks began at the same instant and the deploy always
# finished first. Nothing ever read the result: if CI went red twenty minutes
# later, the code was already live.
#
# There is a second, subtler hole. ci.yml skips whole jobs when its `changes`
# filter decides an area was untouched, and a SKIPPED job counts as green in
# `release-gate`. Combined with `cancel-in-progress`, a commit can carry a
# green tick while its PHP or React suites never ran at all (run 30795897364
# on 7277682cd: green, 11 of 20 jobs skipped). "Green" is not "checked".
#
# HOW IT DECIDES (v2 — result inheritance)
# ----------------------------------------
# Evidence evaluation lives in scripts/predeploy-ci-verify.mjs. A required
# check counts as passed if EITHER it ran and passed on the exact commit being
# deployed, OR it ran and passed on an ancestor commit and none of the paths
# that check watches (per .github/ci-paths.yml — the same file CI's own skip
# logic reads) changed since. So a deploy needs no redundant full re-run when
# the evidence already covers every check; the nightly scheduled full run
# keeps that evidence at most ~24h old. A check that FAILED on the newest
# code it ran against always refuses — the walk never skips past a failure.
#
# This wrapper owns the orchestration: prerequisites, waiting for in-flight
# runs, and forcing a full run with --trigger. It fails CLOSED: no gh, no
# auth, no node, no evidence, commit not on origin/main — all refuse.
# "Unknown" is never treated as "fine".
#
# USAGE
#   bash scripts/predeploy-ci-check.sh                  # check HEAD, report only
#   bash scripts/predeploy-ci-check.sh --wait           # wait for an in-flight run
#   bash scripts/predeploy-ci-check.sh --trigger        # force a full run if needed, wait
#   bash scripts/predeploy-ci-check.sh --sha <sha>      # check a specific commit
#
# EXIT CODES
#   0  fully checked — safe to deploy
#   1  checked and NOT safe (failed, or required evidence is stale/missing)
#   2  could not determine (no gh/node, not logged in, not on origin, timeout)
#
# ENV
#   CI_POLL_SECONDS      seconds between polls while waiting   (default 30)
#   CI_WAIT_TIMEOUT_MIN  give up waiting after N minutes        (default 90)

set -uo pipefail

WORKFLOW="ci.yml"
SHA=""
WAIT=0
TRIGGER=0
POLL_SECONDS="${CI_POLL_SECONDS:-30}"
TIMEOUT_MIN="${CI_WAIT_TIMEOUT_MIN:-90}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

usage() { sed -n '40,52p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }
say()  { echo "[ci-check] $*"; }
fail() { echo "[ci-check] ✗ $*" >&2; }
ok()   { echo "[ci-check] ✓ $*"; }

while [ $# -gt 0 ]; do
    case "$1" in
        --sha)     SHA="${2:-}"; shift 2 ;;
        --wait)    WAIT=1; shift ;;
        --trigger) TRIGGER=1; WAIT=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) fail "unknown option: $1"; usage; exit 2 ;;
    esac
done

# --- prerequisites: every failure here is a REFUSAL, never a pass -----------

for tool in gh node git; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        fail "$tool is not installed, so I cannot tell whether the checks passed."
        fail "  Refusing to deploy."
        exit 2
    fi
done

if ! gh auth status >/dev/null 2>&1; then
    fail "GitHub CLI is not logged in, so I cannot tell whether the checks passed."
    fail "  Refusing to deploy. Run: gh auth login"
    exit 2
fi

if [ -z "$SHA" ]; then
    SHA="$(git rev-parse HEAD 2>/dev/null)"
fi
if [ -z "$SHA" ]; then
    fail "Could not work out which commit to check. Refusing to deploy."
    exit 2
fi
SHA="$(git rev-parse "$SHA" 2>/dev/null)" # normalise short refs to full SHA
SHORT="${SHA:0:9}"

# The server deploys origin/main. A commit that is not on origin/main cannot
# have been checked, and would not be the thing that goes live anyway.
git fetch origin main --quiet 2>/dev/null
if ! git merge-base --is-ancestor "$SHA" origin/main 2>/dev/null; then
    fail "Commit $SHORT is not on origin/main."
    fail "  The server deploys origin/main, so this commit is not what would go live."
    fail "  Push first, then re-run. Refusing to deploy."
    exit 2
fi

say "Checking commit $SHORT against GitHub..."

# --- helpers ---------------------------------------------------------------

wait_for_run() {
    local run_id="$1"
    local deadline=$(( $(date +%s) + TIMEOUT_MIN * 60 ))
    local status concl
    while :; do
        status="$(gh run view "$run_id" --json status --jq '.status' 2>/dev/null)"
        if [ "$status" = "completed" ]; then
            concl="$(gh run view "$run_id" --json conclusion --jq '.conclusion' 2>/dev/null)"
            say "Run $run_id finished: $concl"
            return 0
        fi
        if [ "$(date +%s)" -ge "$deadline" ]; then
            fail "Still not finished after ${TIMEOUT_MIN} minutes. Refusing to deploy."
            fail "  Watch it: gh run watch $run_id"
            return 1
        fi
        say "  ...still running (${status:-unknown}). Checking again in ${POLL_SECONDS}s."
        sleep "$POLL_SECONDS"
    done
}

trigger_full_run() {
    say "Starting a full check of every job on this commit. This takes roughly half an hour."
    if ! gh workflow run "$WORKFLOW" --ref main >/dev/null 2>&1; then
        fail "Could not start the check run. Refusing to deploy."
        exit 2
    fi
    say "Waiting for the run to appear..."
    local new_run=""
    for _ in $(seq 1 20); do
        sleep 5
        new_run="$(gh run list --workflow="$WORKFLOW" --event workflow_dispatch --limit 10 \
            --json databaseId,headSha --jq \
            "[.[] | select(.headSha == \"$SHA\")] | .[0].databaseId // empty" 2>/dev/null)"
        [ -n "$new_run" ] && break
    done
    if [ -z "$new_run" ]; then
        fail "The check run did not appear within 100 seconds. Refusing to deploy."
        fail "  Check manually: gh run list --workflow=$WORKFLOW"
        exit 2
    fi
    say "Full check running: https://github.com/jasperfordesq-ai/Project-NEXUS/actions/runs/$new_run"
    wait_for_run "$new_run" || exit 2
}

# --- evaluate, waiting/triggering as allowed --------------------------------

TRIGGERED=0
while :; do
    OUT="$(node scripts/predeploy-ci-verify.mjs --sha "$SHA" 2>&1)"
    RC=$?
    echo "$OUT"

    case "$RC" in
        0)  ok "Commit $SHORT is fully checked — safe to deploy."
            exit 0 ;;
        3)  # A run for this commit is still in progress.
            RUN_ID="$(echo "$OUT" | sed -n 's/^IN_PROGRESS_RUN_ID=//p' | head -1)"
            if [ "$WAIT" -eq 1 ] && [ -n "$RUN_ID" ]; then
                say "Waiting for the in-flight run to finish."
                wait_for_run "$RUN_ID" || exit 2
                continue
            fi
            fail "A CI run for $SHORT is still in progress."
            fail "  Wait for it to finish, or re-run with --wait. Refusing to deploy."
            exit 2 ;;
        1)  if [ "$TRIGGER" -eq 1 ] && [ "$TRIGGERED" -eq 0 ]; then
                TRIGGERED=1
                trigger_full_run
                continue
            fi
            fail "Commit $SHORT has NOT been fully checked. Refusing to deploy."
            if [ "$TRIGGERED" -eq 1 ]; then
                fail "  A forced full run did not clear it — the failures above are real."
            else
                fail "  Start a full check with:  bash scripts/predeploy-ci-check.sh --trigger"
            fi
            exit 1 ;;
        *)  fail "Could not determine the check state (see above). Refusing to deploy."
            exit 2 ;;
    esac
done
