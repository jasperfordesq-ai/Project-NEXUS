#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# all-gates.sh — run every blocking mobile gate locally, in CI's own order.
#
# 🔴 Why this exists. The eleven mobile gates live in three places: nine steps of
# `mobile-release` in .github/workflows/ci.yml, one root script shared with the i18n
# job, and `lint`, which CI does not run for mobile at all. Reconstructing that list by
# hand before every push is how a gate gets forgotten, and a forgotten gate is found by
# a red `main` twenty minutes later.
#
# 🔴 The order is CI's, not a preference. The cheap configuration checks run first so a
# release-config mistake fails in seconds instead of after a four-minute Jest run.
#
# 🔴 SKIPPED and UNAVAILABLE are NOT passes. A gate that could not run exits 2 and says
# so in words. Never report "all gates green" off an exit code you did not read.
#
# Usage:
#   bash scripts/all-gates.sh              # everything (slowest gate: budget:check)
#   bash scripts/all-gates.sh --fast       # skip budget:check — exits 2, never 0
#   bash scripts/all-gates.sh --only type-check,lint
#
# Exit codes: 0 every gate passed · 1 at least one failed · 2 nothing failed but at
# least one could not run.
set -uo pipefail

cd "$(dirname "$0")/.."

FAST=0
ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --fast) FAST=1 ;;
    --only) ONLY="${2:-}"; shift ;;
    --only=*) ONLY="${1#--only=}" ;;
    -h|--help) sed -n '8,26p' "$0"; exit 0 ;;
    *) echo "all-gates: unknown argument '$1'" >&2; exit 1 ;;
  esac
  shift
done

# name<TAB>command. Keep in step with .github/workflows/ci.yml's mobile-release job.
GATE_NAMES=(
  "verify:release"
  "verify:network-security"
  "type-check"
  "jest"
  "coverage:ratchet"
  "drift:check"
  "check:untranslated"
  "check:age-declaration"
  "check:date-locale"
  "budget:check"
  "lint"
)
GATE_COMMANDS=(
  "npm run verify:release"
  "npm run verify:network-security"
  "npm run type-check"
  "npm run test:coverage -- --runInBand"
  "npm run coverage:ratchet"
  "npm run drift:check"
  "npm run check:untranslated"
  "node ../scripts/check-age-declaration.mjs"
  "node scripts/check-date-locale.mjs"
  "npm run budget:check"
  "npm run lint"
)

declare -a RESULTS
FAILED=0
UNRUN=0

selected() {
  [ -z "$ONLY" ] && return 0
  case ",$ONLY," in
    *",$1,"*) return 0 ;;
    *) return 1 ;;
  esac
}

START_ALL=$(date +%s)
for i in "${!GATE_NAMES[@]}"; do
  name="${GATE_NAMES[$i]}"
  cmd="${GATE_COMMANDS[$i]}"

  if ! selected "$name"; then
    RESULTS+=("SKIPPED  $name  (not in --only)")
    UNRUN=1
    continue
  fi
  # coverage:ratchet reads coverage/ written by the jest gate. Running it without
  # that gate would grade a stale or absent report, so refuse rather than mislead.
  if [ "$name" = "coverage:ratchet" ] && ! selected "jest"; then
    RESULTS+=("SKIPPED  $name  (needs the jest gate in the same run)")
    UNRUN=1
    continue
  fi
  if [ "$name" = "budget:check" ] && [ "$FAST" = "1" ]; then
    RESULTS+=("SKIPPED  $name  (--fast; this is NOT a pass)")
    UNRUN=1
    continue
  fi

  echo ""
  echo "=============================================================="
  echo "GATE $((i + 1))/${#GATE_NAMES[@]}: $name"
  echo "  \$ $cmd"
  echo "=============================================================="
  start=$(date +%s)
  eval "$cmd"
  status=$?
  elapsed=$(( $(date +%s) - start ))

  if [ $status -eq 0 ]; then
    RESULTS+=("PASS     $name  (${elapsed}s)")
  else
    RESULTS+=("FAIL     $name  (exit $status, ${elapsed}s)")
    FAILED=1
  fi
done

echo ""
echo "=============================================================="
echo "MOBILE GATES — summary  ($(( $(date +%s) - START_ALL ))s total)"
echo "=============================================================="
for line in "${RESULTS[@]}"; do echo "  $line"; done
echo ""

if [ "$FAILED" = "1" ]; then
  echo "RESULT: FAILED — at least one gate is red. Do not push."
  exit 1
fi
if [ "$UNRUN" = "1" ]; then
  echo "RESULT: INCOMPLETE — nothing failed, but a gate did not run. This is not green."
  exit 2
fi
echo "RESULT: all ${#GATE_NAMES[@]} gates passed."
exit 0
