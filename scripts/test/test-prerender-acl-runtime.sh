#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENTRYPOINT="$ROOT_DIR/react-frontend/docker-entrypoint.d/20-ensure-prerender-state.sh"
AUTH_HELPER="$ROOT_DIR/react-frontend/runtime/maintenance-render-auth.sh"
PHP_DOCKERFILE="$ROOT_DIR/Dockerfile.bluegreen"
VOLUME="nexus-prerender-acl-test-$$"
CONTAINER="nexus-prerender-acl-test-$$"

cleanup() {
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    docker volume rm "$VOLUME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

sh -n "$ENTRYPOINT"

# The PHP image mounts this cache beneath its general storage volume. Generic
# startup permission repair must prune that nested mount or it can undo the
# root/nginx-only credential modes after the frontend has secured them.
[ "$(grep -Fc -- '-path /var/www/html/storage/prerendered -prune' "$PHP_DOCKERFILE")" -ge 4 ]
if grep -Fq 'chown -R www-data:www-data /var/www/html/storage /var/www/html/bootstrap/cache' "$PHP_DOCKERFILE"; then
    echo 'PHP startup recursively chowns the private prerender volume' >&2
    exit 1
fi
docker volume create "$VOLUME" >/dev/null

# Seed a pre-ACL snapshot tree and private root state to verify that startup
# repairs the former without broadening the latter.
docker run --rm \
    -v "$VOLUME:/usr/share/nginx/html/prerendered" \
    alpine:latest sh -ceu '
        root=/usr/share/nginx/html/prerendered
        mkdir -p "$root/legacy.test/about"
        printf "%s\n" LEGACY > "$root/legacy.test/about/index.html"
        chmod 0755 "$root/legacy.test" "$root/legacy.test/about"
        chmod 0644 "$root/legacy.test/about/index.html"
        printf "%s\n" root-only-token > "$root/.maintenance-render.token"
        chmod 0600 "$root/.maintenance-render.token"
    '

docker run -d --name "$CONTAINER" \
    -v "$VOLUME:/usr/share/nginx/html/prerendered" \
    -v "$ENTRYPOINT:/test-entrypoint.sh:ro" \
    -v "$AUTH_HELPER:/usr/local/bin/nexus-maintenance-render-auth:ro" \
    -e PRERENDER_PHP_UID=33 \
    nginx:1.30-alpine sh -ceu '
        apk add --no-cache acl apache2-utils util-linux >/dev/null
        /test-entrypoint.sh
        : > /tmp/acl-ready
        sleep 120
    ' >/dev/null

for _ in $(seq 1 120); do
    docker exec "$CONTAINER" test -f /tmp/acl-ready >/dev/null 2>&1 && break
    sleep 0.1
done
docker exec "$CONTAINER" test -f /tmp/acl-ready

# The credential transaction runs inside a directory with a permissive PHP
# default ACL. It must explicitly strip inherited named ACLs from the token
# and the reversible Authorization map.
docker exec "$CONTAINER" sh -ceu '
    cat > /tmp/fake-nginx <<"EOF"
#!/bin/sh
exit 0
EOF
    chmod 0755 /tmp/fake-nginx
    NGINX_BIN=/tmp/fake-nginx /usr/local/bin/nexus-maintenance-render-auth enable
  '
docker exec --user 33:33 "$CONTAINER" sh -ceu '
    root=/usr/share/nginx/html/prerendered
    test ! -r "$root/.maintenance-render.token"
    test ! -r "$root/.maintenance-render-auth.list"
    test ! -r "$root/.maintenance-render.htpasswd"
  '
docker exec --user nginx "$CONTAINER" sh -ceu '
    root=/usr/share/nginx/html/prerendered
    test ! -r "$root/.maintenance-render.token"
    test -r "$root/.maintenance-render-auth.list"
    test -r "$root/.maintenance-render.htpasswd"
  '
docker exec "$CONTAINER" sh -ceu \
    'NGINX_BIN=/tmp/fake-nginx /usr/local/bin/nexus-maintenance-render-auth disable'

# Laravel/PHP uid 33 can mutate legacy snapshots and coordinate through the
# same flock inode, but cannot read private root credential state.
docker exec --user 33:33 "$CONTAINER" sh -ceu '
    root=/usr/share/nginx/html/prerendered
    exec 8>"$root/.mutation.lock"
    flock -n 8
    rm "$root/legacy.test/about/index.html"
    printf "%s\n" PHP > "$root/legacy.test/about/php-created.html"
    test ! -e "$root/.maintenance-render.token"
    test ! -r "$root/.maintenance-render-auth.list"
    test ! -r "$root/.maintenance-render.htpasswd"
    flock -u 8
    exec 8>&-
    rm "$root/legacy.test/about/php-created.html"
    rmdir "$root/legacy.test/about"
    rmdir "$root/legacy.test"
  '

# Files created after startup inherit interoperable ACLs. Root represents the
# publisher; uid 33 represents Laravel; nginx must retain read access.
docker exec "$CONTAINER" sh -ceu '
    root=/usr/share/nginx/html/prerendered
    umask 077
    mkdir -p "$root/fresh.test/about"
    printf "%s\n" SNAPSHOT > "$root/fresh.test/about/index.html"
  '
docker exec --user nginx "$CONTAINER" grep -Fxq SNAPSHOT \
    /usr/share/nginx/html/prerendered/fresh.test/about/index.html
docker exec --user 33:33 "$CONTAINER" sh -ceu '
    route=/usr/share/nginx/html/prerendered/fresh.test/about
    mv "$route/index.html" "$route/index.previous.html"
    rm "$route/index.previous.html"
  '

# Invalid UID configuration and symlinked lock state must fail closed.
if docker exec -e PRERENDER_PHP_UID=not-a-uid "$CONTAINER" /test-entrypoint.sh >/dev/null 2>&1; then
    echo 'entrypoint accepted an invalid PHP uid' >&2
    exit 1
fi
docker exec "$CONTAINER" sh -ceu '
    root=/usr/share/nginx/html/prerendered
    rm -f "$root/.mutation.lock"
    ln -s /etc/passwd "$root/.mutation.lock"
  '
if docker exec -e PRERENDER_PHP_UID=33 "$CONTAINER" /test-entrypoint.sh >/dev/null 2>&1; then
    echo 'entrypoint accepted a symlinked mutation lock' >&2
    exit 1
fi

echo 'PASS: prerender cache ACLs support root publisher, PHP invalidation, nginx reads, legacy rollout, and private-state isolation'
