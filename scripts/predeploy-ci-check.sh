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
# `release-gate` (that job only fails on "failure" or "cancelled"). Combined
# with `cancel-in-progress`, a commit can carry a green tick while its PHP or
# React suites never ran at all. This is not hypothetical: run 30795897364 on
# commit 7277682cd is green with 11 of 20 jobs skipped — every PHP test, every
# React test, the Docker build, E2E and accessibility.
#
# So "green" is not the same as "checked". This script requires BOTH:
#   1. a completed CI run for the EXACT commit being deployed, conclusion success
#   2. that every required job in it actually RAN — skipped is not good enough
#
# It fails CLOSED. If it cannot find gh, cannot authenticate, cannot reach the
# API, or cannot find a run, it refuses. "Unknown" is never treated as "fine".
#
# USAGE
#   bash scripts/predeploy-ci-check.sh                  # check HEAD, report only
#   bash scripts/predeploy-ci-check.sh --wait           # wait for an in-flight run
#   bash scripts/predeploy-ci-check.sh --trigger        # force a full run, wait for it
#   bash scripts/predeploy-ci-check.sh --sha <sha>      # check a specific commit
#
# EXIT CODES
#   0  fully checked — safe to deploy
#   1  checked and NOT safe (failed, cancelled, or required jobs were skipped)
#   2  could not determine (no gh, not logged in, commit not on origin, no run)
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

# ---------------------------------------------------------------------------
# The jobs that must have ACTUALLY RUN for a commit to count as fully checked.
#
# These are matched as name PREFIXES, because matrix jobs expand their names
# ("PHP Tests (shard 3)") when they run but keep the raw template
# ("PHP Tests (shard ${{ matrix.shard }})") when they are skipped.
#
# This list mirrors the `needs:` list of the `release-gate` job in ci.yml, plus
# release-gate itself. If ci.yml grows a job that is not listed here, the
# UNKNOWN-JOB check below makes that loud rather than silently unverified.
# ---------------------------------------------------------------------------
REQUIRED_JOBS=(
    "PHP Tests"
    "PHP Static Analysis"
    "PHP Checks"
    "React Build & Tests"
    "BLOCKING: API Contract Validation"
    "React Full Suite"
    "Docker Build Verify"
    "Dockerfile Drift Detection"
    "Migration Safety Gate"
    "Translation Drift Detection"
    "Documentation, Version, and Changelog Hygiene"
    "SPDX License Compliance"
    "Regression Pattern Detection"
    "E2E Smoke Tests"
    "Accessibility Audit"
    "Android Native Release Gate"
    "Accessible Frontend Release Gate"
    "Release Gate"
)

# Jobs that exist but are plumbing, not verification. Allowed to be anything.
INFORMATIONAL_JOBS=(
    "Detect changed areas"
    "i18n changed-files filter"
)

# ---------------------------------------------------------------------------

usage() {
    sed -n '7,46p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

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

if ! command -v gh >/dev/null 2>&1; then
    fail "GitHub CLI (gh) is not installed, so I cannot tell whether the checks passed."
    fail "  Refusing to deploy. Install gh, or override deliberately (see deploy.sh)."
    exit 2
fi

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

# Print "conclusion<TAB>name" for every job in a run.
run_jobs() {
    gh run view "$1" --json jobs --jq '.jobs[] | "\(.conclusion // "pending")\t\(.name)"' 2>/dev/null
}

is_informational() {
    local name="$1" info
    for info in "${INFORMATIONAL_JOBS[@]}"; do
        case "$name" in "$info"*) return 0 ;; esac
    done
    return 1
}

is_known_required() {
    local name="$1" req
    for req in "${REQUIRED_JOBS[@]}"; do
        case "$name" in "$req"*) return 0 ;; esac
    done
    return 1
}

# Evaluate one run. Echoes a human summary. Returns 0 only if fully checked.
evaluate_run() {
    local run_id="$1"
    local jobs missing=() skipped=() failed=() unknown=()
    jobs="$(run_jobs "$run_id")"

    if [ -z "$jobs" ]; then
        fail "Could not read the jobs for run $run_id."
        return 1
    fi

    # Any job present that we do not know about => the workflow changed and this
    # script's required list is stale. Refuse loudly rather than under-check.
    local concl name
    while IFS=$'\t' read -r concl name; do
        [ -z "$name" ] && continue
        if is_informational "$name"; then continue; fi
        if ! is_known_required "$name"; then unknown+=("$name"); fi
    done <<< "$jobs"

    # Each required job must be present AND have succeeded.
    local req
    for req in "${REQUIRED_JOBS[@]}"; do
        local seen=0 all_ok=1 any_skipped=0 any_failed=0
        while IFS=$'\t' read -r concl name; do
            [ -z "$name" ] && continue
            case "$name" in
                "$req"*)
                    seen=1
                    case "$concl" in
                        success) ;;
                        skipped) any_skipped=1; all_ok=0 ;;
                        *)       any_failed=1; all_ok=0 ;;
                    esac
                    ;;
            esac
        done <<< "$jobs"

        if [ "$seen" -eq 0 ]; then
            missing+=("$req")
        elif [ "$any_failed" -eq 1 ]; then
            failed+=("$req")
        elif [ "$any_skipped" -eq 1 ]; then
            skipped+=("$req")
        fi
    done

    local bad=0

    if [ "${#failed[@]}" -gt 0 ]; then
        bad=1
        fail "These checks did not pass:"
        printf '        - %s\n' "${failed[@]}" >&2
    fi
    if [ "${#skipped[@]}" -gt 0 ]; then
        bad=1
        fail "These checks were SKIPPED — they never ran on this code:"
        printf '        - %s\n' "${skipped[@]}" >&2
    fi
    if [ "${#missing[@]}" -gt 0 ]; then
        bad=1
        fail "These checks are missing from the run entirely:"
        printf '        - %s\n' "${missing[@]}" >&2
    fi
    if [ "${#unknown[@]}" -gt 0 ]; then
        bad=1
        fail "This run contains jobs this script does not know about:"
        printf '        - %s\n' "${unknown[@]}" >&2
        fail "  ci.yml has gained a job. Add it to REQUIRED_JOBS in this script."
    fi

    return "$bad"
}

# Wait for a run to finish. Returns 0 when completed, 1 on timeout.
wait_for_run() {
    local run_id="$1"
    local deadline=$(( $(date +%s) + TIMEOUT_MIN * 60 ))
    local status concl
    while :; do
        status="$(gh run view "$run_id" --json status --jq '.status' 2>/dev/null)"
        concl="$(gh run view "$run_id" --json conclusion --jq '.conclusion' 2>/dev/null)"
        if [ "$status" = "completed" ]; then
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

# --- find the best existing run for this commit ----------------------------

RUN_IDS="$(gh run list --workflow="$WORKFLOW" --commit "$SHA" --limit 20 \
    --json databaseId,status --jq '.[] | .databaseId' 2>/dev/null)"

BEST=""
if [ -n "$RUN_IDS" ]; then
    # Newest first. Accept the first run that is completely clean.
    for rid in $RUN_IDS; do
        st="$(gh run view "$rid" --json status --jq '.status' 2>/dev/null)"
        if [ "$st" != "completed" ]; then
            if [ "$WAIT" -eq 1 ]; then
                say "A run is still in progress for $SHORT. Waiting for it."
                wait_for_run "$rid" || exit 2
            else
                fail "A CI run for $SHORT is still in progress."
                fail "  Wait for it to finish, or re-run with --wait. Refusing to deploy."
                exit 2
            fi
        fi
        if evaluate_run "$rid" >/dev/null 2>&1; then
            BEST="$rid"
            break
        fi
    done
fi

if [ -n "$BEST" ]; then
    ok "Commit $SHORT is fully checked (run $BEST — every required check ran and passed)."
    exit 0
fi

# --- nothing clean exists --------------------------------------------------

if [ -z "$RUN_IDS" ]; then
    say "No CI run exists for commit $SHORT."
else
    say "A CI run exists for $SHORT, but it is not full coverage. Details:"
    set -- $RUN_IDS
    evaluate_run "$1" || true
fi

if [ "$TRIGGER" -eq 0 ]; then
    fail "Commit $SHORT has NOT been fully checked. Refusing to deploy."
    fail "  Start a full check with:  bash scripts/predeploy-ci-check.sh --trigger"
    exit 1
fi

# --- force a full run and wait ---------------------------------------------

say "Starting a full check of every job on this commit. This takes roughly half an hour."
if ! gh workflow run "$WORKFLOW" --ref main >/dev/null 2>&1; then
    fail "Could not start the check run. Refusing to deploy."
    exit 2
fi

say "Waiting for the run to appear..."
NEW_RUN=""
for _ in $(seq 1 20); do
    sleep 5
    NEW_RUN="$(gh run list --workflow="$WORKFLOW" --event workflow_dispatch --limit 10 \
        --json databaseId,headSha --jq \
        "[.[] | select(.headSha == \"$SHA\")] | .[0].databaseId // empty" 2>/dev/null)"
    [ -n "$NEW_RUN" ] && break
done

if [ -z "$NEW_RUN" ]; then
    fail "The check run did not appear within 100 seconds. Refusing to deploy."
    fail "  Check manually: gh run list --workflow=$WORKFLOW"
    exit 2
fi

say "Full check running: https://github.com/jasperfordesq-ai/nexus-v1/actions/runs/$NEW_RUN"
wait_for_run "$NEW_RUN" || exit 2

if evaluate_run "$NEW_RUN"; then
    ok "Commit $SHORT is fully checked (run $NEW_RUN — every required check ran and passed)."
    exit 0
fi

fail "Commit $SHORT did not pass the full check. Refusing to deploy."
exit 1
