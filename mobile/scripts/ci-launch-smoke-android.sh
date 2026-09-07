#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Install the debug APK on the AVD that is already booted, and run one Maestro flow.
#
# 🔴 This is a FILE, called with a single line, on purpose.
# `reactivecircus/android-emulator-runner` executes its `script:` input one line at a
# time, each in its own `sh -c`. Two consequences bit the first version of
# .github/workflows/mobile-emulator.yml, and neither is obvious from the YAML:
#
#   - `cd mobile` on one line does not apply to the next one;
#   - a trailing `\` is NOT a line continuation. It is passed through as an argument.
#
# The result was `Flow path does not exist: /home/runner/work/.../Project-NEXUS/\` —
# Maestro invoked from the repo root with a single backslash as its flow path. Keeping
# the whole sequence in one script sidesteps the action's line handling entirely, and
# has the side benefit that it can be read and reasoned about on its own.
#
# Usage (from the repository root, with a device already booted):
#   bash mobile/scripts/ci-launch-smoke-android.sh [flow-path-relative-to-mobile]

set -euo pipefail

cd "$(dirname "$0")/.."

FLOW="${1:-.maestro/00-launch-smoke.yaml}"
APK="android/app/build/outputs/apk/debug/app-debug.apk"
OUT="${RUNNER_TEMP:-/tmp}"

if [ ! -f "${APK}" ]; then
  echo "no debug APK at ${APK} — did the Gradle step run?" >&2
  exit 1
fi

adb wait-for-device

# The platform's own crash/ANR sheets sit over a correctly rendered screen and read as
# a failure that is not ours. The login subflow already treats them as a platform
# condition; suppressing them is cheaper than working around them.
adb shell settings put global hide_error_dialogs 1 || true

# A debug build fetches its JavaScript from Metro on the HOST. `adb reverse` is device
# state, so it has to be set after the device exists and again after any reboot.
adb reverse tcp:8081 tcp:8081

adb install -r "${APK}"

# 🔴 logcat on the way out, while the device still exists. Collecting it in a later
# workflow step does not work: the emulator action tears the AVD down when this script
# returns, so `adb logcat` then has no device, hangs, and the job burns its timeout
# losing the very diagnostics the step existed to gather.
trap 'adb logcat -d > "${OUT}/logcat.txt" 2>&1 || true' EXIT

maestro test --format junit --output "${OUT}/maestro-report.xml" "${FLOW}"
