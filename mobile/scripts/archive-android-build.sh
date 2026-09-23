#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# archive-android-build.sh — file a finished, verified Android build in ONE place.
#
# 🔴 Why this exists. Until 2026-09-23 every Play bundle was copied out of Gradle's
# output folder BY HAND, into the root of mobile/, under whatever name the person
# doing it chose — `Timebank-Global-1.2.0-build-4.aab` and
# `timebank-global-1.4.0-build9.aab` sat side by side, a debug APK was named
# `.local-audit-current-debug.apk`, and nothing recorded which commit any of them
# came from. Gradle itself overwrites android/app/build/outputs/… on every build,
# so the only copy of an uploaded bundle was whichever hand-made copy survived.
#
# Everything now lands in mobile/releases/android/ (git-ignored):
#
#   play/timebank-global-<version>-build<code>.aab        what goes to Google Play
#   play/timebank-global-<version>-build<code>.aab.sha256
#   sideload/timebank-global-<version>-<live|local>-<yyyymmdd-hhmm>.apk
#   INDEX.tsv   one line per build: when, kind, version, code, commit, sha256, bytes, file, api
#
# Called by build-aab-play.sh and build-apk-local.sh after their guards pass, so
# only a verified artefact is ever filed. It can also be run by hand:
#
#   bash scripts/archive-android-build.sh play <file.aab> <version-code> [api-url]
#   bash scripts/archive-android-build.sh sideload <file.apk> [api-url]
#
# ARCHIVE_COMMIT and ARCHIVE_VERSION override the recorded commit and version, for
# filing a build made earlier ("unknown" is an honest commit when none was recorded).
set -euo pipefail

cd "$(dirname "$0")/.."

KIND="${1:-}"
SRC="${2:-}"
case "$KIND" in
  play)     CODE="${3:-}"; API_URL="${4:-}";;
  sideload) CODE="";       API_URL="${3:-}";;
  *) echo "usage: archive-android-build.sh <play|sideload> <file> [version-code] [api-url]" >&2; exit 2;;
esac
[ -f "$SRC" ] || { echo "ERROR: no file at $SRC" >&2; exit 1; }

VERSION="${ARCHIVE_VERSION:-$(node -e "process.stdout.write(require('./app.json').expo.version)")}"
COMMIT="${ARCHIVE_COMMIT:-$(git rev-parse --short=9 HEAD)}"
if [ -z "${ARCHIVE_COMMIT:-}" ] && [ -n "$(git status --porcelain -- . 2>/dev/null)" ]; then
  COMMIT="${COMMIT}+dirty"
fi
case "$API_URL" in
  *api.project-nexus.ie*) HOST_LABEL="live";;
  "")                     HOST_LABEL="unknown";;
  *)                      HOST_LABEL="local";;
esac

ROOT_DIR="releases/android"
mkdir -p "$ROOT_DIR/play" "$ROOT_DIR/sideload"
INDEX="$ROOT_DIR/INDEX.tsv"
[ -f "$INDEX" ] || printf 'filed_at\tkind\tversion\tcode\tcommit\tsha256\tbytes\tfile\tapi\n' > "$INDEX"

SHA="$(sha256sum "$SRC" | awk '{print toupper($1)}')"
BYTES="$(wc -c < "$SRC" | tr -d ' ')"

if [ "$KIND" = "play" ]; then
  [[ "$CODE" =~ ^[0-9]+$ ]] || { echo "ERROR: a play build needs its version code" >&2; exit 2; }
  DEST="$ROOT_DIR/play/timebank-global-${VERSION}-build${CODE}.aab"
  if [ -f "$DEST" ]; then
    OLD="$(sha256sum "$DEST" | awk '{print toupper($1)}')"
    if [ "$OLD" = "$SHA" ]; then
      echo "Filed already      : $DEST (identical)"
      exit 0
    fi
    # Two different files under one version code is how "which one did we upload?"
    # starts. Play refuses a repeated code anyway, so a rebuild of an uploaded code
    # is always a mistake; a rebuild of one that was never uploaded should replace
    # it deliberately.
    echo "ERROR: $DEST already exists with different contents." >&2
    echo "  filed   : $OLD" >&2
    echo "  new     : $SHA" >&2
    echo "If build ${CODE} was never uploaded, delete the old file and re-run:" >&2
    echo "  bash scripts/archive-android-build.sh play \"$SRC\" ${CODE} \"${API_URL}\"" >&2
    echo "If it WAS uploaded, this build needs a higher version code." >&2
    exit 1
  fi
else
  DEST="$ROOT_DIR/sideload/timebank-global-${VERSION}-${HOST_LABEL}-$(date +%Y%m%d-%H%M).apk"
fi

cp "$SRC" "$DEST"
printf '%s  %s\n' "$SHA" "$(basename "$DEST")" > "${DEST}.sha256"
printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$KIND" "$VERSION" "${CODE:--}" "$COMMIT" "$SHA" "$BYTES" \
  "$(basename "$DEST")" "${API_URL:--}" >> "$INDEX"

echo "Filed              : $(pwd)/$DEST"
echo "SHA-256            : $SHA"
