#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# check-docs-site-build — run CI's `mkdocs build --strict` locally, in a container.
#
# WHY THIS EXISTS. The docs-lint workflow's `docs-build` job was the one gate with
# no local equivalent, because this dev machine has no Python. So a documentation
# change could only be judged after a push — and a push touching docs/ republishes
# the public documentation site. Verifying first means a mistake is caught before
# the public site changes, not after.
#
# 🔴 WHAT THIS ACTUALLY CHECKS, precisely — it is NARROWER than it sounds:
#
#   ✅ a `nav:` entry in mkdocs.yml pointing at a file that does not exist
#   ✅ the site genuinely renders with its theme and markdown extensions
#   ✅ mkdocs.yml is valid
#
#   ❌ NOT broken links. mkdocs.yml deliberately sets `validation.links.not_found:
#      ignore` (plus absolute_links and unrecognized_links). `--strict` promotes
#      WARNINGS to errors, and with those set to `ignore` there is no warning to
#      promote. Verified 2026-08-11 by adding a link to a non-existent page: the
#      strict build passed.
#
#      Broken links are caught by `npm run check:docs`
#      (scripts/check-docs-hygiene.mjs), which fails with
#      "broken local link: ...". Run BOTH; neither covers the other.
#
# Python is not installed on the dev workstation, so this pins CI's exact three
# package versions in a throwaway image rather than changing the host.

set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" || exit 1

IMAGE=nexus-mkdocs:ci
DOCKERFILE=".github/mkdocs-strict.Dockerfile"

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo "Building $IMAGE (first run only)..."
    if ! docker build -f "$DOCKERFILE" -t "$IMAGE" "$(dirname "$DOCKERFILE")"; then
        echo "ERROR: could not build the MkDocs runner image." >&2
        exit 1
    fi
fi

# CI stages the API contract into docs/ before building, because the API reference
# page includes it. It is NOT tracked there, so it must be removed afterwards
# whatever happens — otherwise it turns up as an untracked file in the checkout.
cleanup () { rm -f docs/openapi.json; }
trap cleanup EXIT

cp openapi.json docs/openapi.json

# Absolute container path, and a doubled leading slash so Git Bash on Windows does
# not rewrite //repo into a host path.
echo "Running mkdocs build --strict ..."
if docker run --rm -v "//$(pwd | sed 's|^/||')://repo" "$IMAGE" build --clean --strict; then
    echo
    echo "docs site build OK (strict)."
    echo "🔴 Reminder: this does NOT check links. Run 'npm run check:docs' as well."
    exit 0
fi

echo
echo "docs site build FAILED (strict)." >&2
echo "A nav entry most likely points at a file that does not exist." >&2
exit 1
