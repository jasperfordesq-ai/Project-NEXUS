#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/../lib/common.sh"

# Repos produced by every blue-green build. Their old builds are tagged by commit
# SHA, so they are NOT dangling and `docker image prune` never reclaims them — they
# accumulate ~1.4GB each per deploy and must be removed by explicit retention.
#
# Every repo a deploy tags by commit SHA MUST be listed here. `nexus-webuk` was
# added to the deploy on 2026-08-12 but not to this list, so 191 builds (53 GB)
# piled up on production before anyone noticed (found and cleared 2026-11-17).
RELEASE_IMAGE_REPOS="${RELEASE_IMAGE_REPOS:-nexus-php-app nexus-react-prod nexus-sales-site nexus-webuk}"
# Number of builds to keep per repo: active color + inactive color + rollback margin.
IMAGE_RETENTION_KEEP="${IMAGE_RETENTION_KEEP:-5}"

# Remove old release builds, keeping the newest IMAGE_RETENTION_KEEP per repo.
# Uses `docker rmi` WITHOUT -f: Docker refuses to delete an image still referenced
# by a running OR stopped container, so the live and rollback colors are protected
# automatically regardless of age. Images from other projects are never matched.
prune_release_images() {
    local repo victims kept
    for repo in $RELEASE_IMAGE_REPOS; do
        # Newest first by creation time; drop the newest KEEP; the rest are candidates.
        victims=$(docker images "$repo" --format '{{.CreatedAt}}\t{{.Repository}}:{{.Tag}}' \
            | sort -r | tail -n +"$((IMAGE_RETENTION_KEEP + 1))" | cut -f2-)
        if [ -n "$victims" ]; then
            echo "$victims" | xargs -r docker rmi >/dev/null 2>&1 || true
        fi
        kept=$(docker images "$repo" -q | wc -l | tr -d ' ')
        log_ok "$repo -- retained $kept image(s) (target: newest $IMAGE_RETENTION_KEEP; in-use builds always kept)"
    done
}

# Sweep any remaining dangling (untagged) layers left after retention.
prune_dangling_images() {
    local reclaimed
    reclaimed=$(docker image prune -f 2>&1 | grep 'Total reclaimed' || echo 'Total reclaimed space: 0B')
    log_ok "Dangling images removed -- $reclaimed"
}

log_step "=== Docker Image Cleanup ==="
prune_release_images
prune_dangling_images
