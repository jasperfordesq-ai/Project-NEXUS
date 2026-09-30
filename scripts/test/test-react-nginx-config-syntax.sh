#!/bin/bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# Validate that both React nginx configs are ones nginx will actually START on.
#
# WHY THIS EXISTS
# ---------------
# On 30 September 2026 the F-359 fix added `client_header_timeout 30s;` inside
# the `/api/` location of both configs. That directive is valid only at http or
# server level — headers are read before a location is chosen — so nginx refused
# to start with
#
#   [emerg] "client_header_timeout" directive is not allowed here
#
# Nothing in the repository caught it. `ProductionFrontendApiProxyTest` checks
# the configs by reading them as TEXT, which is the right tool for "is the
# policy still there" and the wrong one for "will this parse". CI found it three
# jobs later in E2E Smoke Tests, and a deploy of that commit would have left the
# React container unable to start on every community hostname.
#
# The deploy scripts do run `nginx -t`, but only inside a container that is
# already being built from these files — by which point the bad config is
# already on the way to production. This runs the same check against the
# committed files, before anything is built.
#
# WHAT IT DOES
# ------------
# Renders each config through the nginx image's own envsubst entrypoint (both
# are installed as `/etc/nginx/templates/default.conf.template`) and runs
# `nginx -t`. Include targets the configs reference are created empty first,
# because a missing include is a genuine `nginx -t` failure and not the thing
# under test here.
#
# The upstream hostnames the configs name are pointed at localhost with
# --add-host. nginx resolves an upstream at config-test time and refuses to
# start if it cannot, so without this the check would fail for a reason that
# has nothing to do with whether the config is valid.
#
# It also greps the RENDERED config for a directive both files are known to
# contain, as a tripwire: if the render ever silently fails again, the check
# fails loudly instead of validating the image's stock config.
#
# Needs Docker. When Docker is unavailable it reports UNAVAILABLE and exits 2 —
# never a pass. CI has Docker; the deploy gate does not depend on this.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROOT_POSIX="$ROOT"
# Docker Desktop needs a Windows-shaped host path for a bind mount; Git Bash's
# `pwd` gives /c/... which it silently fails to mount. `pwd -W` is the MSYS
# spelling and does not exist elsewhere, so this stays a no-op in CI.
case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
        ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -W)"
        export MSYS_NO_PATHCONV=1
        ;;
esac
IMAGE="nginx:alpine3.21"
CONFIGS=(nginx.conf nginx.bluegreen.conf)

if ! docker info >/dev/null 2>&1; then
    echo "UNAVAILABLE: Docker is not running — the React nginx configs were NOT validated." >&2
    echo "  This is not a pass. CI runs it." >&2
    exit 2
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
# Same reason as ROOT above: the include-target mounts need a Windows path too.
WORK_MOUNT="$WORK"
case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) WORK_MOUNT="$(cd "$WORK" && pwd -W)" ;;
esac

# The include targets. The Dockerfile creates these empty so nginx starts
# cleanly before any prerender snapshot exists; do the same here.
mkdir -p "$WORK/html/prerendered" "$WORK/nginx"
: > "$WORK/html/prerendered/.status-overrides.list"
: > "$WORK/html/prerendered/.maintenance-render-auth.list"
: > "$WORK/html/prerendered/.maintenance-render.htpasswd"
: > "$WORK/nginx/prerender-trusted-bot-ips.list"

failed=0

# Guard: the substitution list must stay complete. A new ${...} template
# variable would otherwise reach nginx unrendered and be reported as an unknown
# nginx variable — a confusing failure that looks like a config defect rather
# than a gap in this script.
EXPECTED_VARS='${NEXUS_API_UPSTREAM}
${NEXUS_CSP_EXTRA_ORIGINS}'
ACTUAL_VARS="$(grep -ohE '\$\{[A-Z_][A-Z0-9_]*\}' \
    "$ROOT_POSIX/react-frontend/nginx.conf" \
    "$ROOT_POSIX/react-frontend/nginx.bluegreen.conf" | sort -u)"
if [ "$ACTUAL_VARS" != "$EXPECTED_VARS" ]; then
    echo "FAIL: the nginx configs use template variables this check does not substitute." >&2
    echo "  expected:" >&2; echo "$EXPECTED_VARS" | sed 's/^/    /' >&2
    echo "  found:" >&2;    echo "$ACTUAL_VARS"   | sed 's/^/    /' >&2
    exit 1
fi


for conf in "${CONFIGS[@]}"; do
    printf '  %-24s ' "$conf"

    # 🔴 The template is rendered EXPLICITLY rather than by letting the image's
    # entrypoint do it. `20-envsubst-on-templates.sh` only renders when the
    # container's command is `nginx` with serving arguments, so
    # `/docker-entrypoint.sh nginx -t` silently leaves the stock default.conf in
    # place — and then validates THAT. The first version of this script did
    # exactly that and passed with the F-359 defect deliberately reintroduced,
    # which is the whole reason this file exists. Render, then test what was
    # rendered.
    #
    # The template is mounted under /etc/nginx/ rather than /tmp/ because Git Bash
    # rewrites a container path that also exists on the host, and /tmp does.
    #
    # Only the ${...} template variables are substituted, and the guard below
    # fails if a new one is ever added without being listed here. Everything
    # else in these files is an nginx runtime variable ($host, $uri,
    # $http_user_agent ...) and must survive verbatim.
    if output="$(docker run --rm \
        --add-host api:127.0.0.1 \
        --add-host nexus-php-app:127.0.0.1 \
        --add-host api.project-nexus.ie:127.0.0.1 \
        -e NEXUS_API_UPSTREAM=api \
        -e NEXUS_CSP_EXTRA_ORIGINS= \
        -v "$ROOT/react-frontend/$conf:/etc/nginx/nexus-template.conf:ro" \
        -v "$WORK_MOUNT/html:/usr/share/nginx/html" \
        -v "$WORK_MOUNT/nginx/prerender-trusted-bot-ips.list:/etc/nginx/prerender-trusted-bot-ips.list:ro" \
        --entrypoint sh "$IMAGE" -c \
        'envsubst "\$NEXUS_API_UPSTREAM \$NEXUS_CSP_EXTRA_ORIGINS" < /etc/nginx/nexus-template.conf > /etc/nginx/conf.d/default.conf \
         && grep -q "location \^~ /api/" /etc/nginx/conf.d/default.conf \
         && nginx -t' 2>&1)"; then
        echo "OK"
    else
        echo "FAILED"
        echo "$output" | sed 's/^/      /' >&2
        failed=1
    fi
done

echo

if [ "$failed" -ne 0 ]; then
    echo "FAIL: a React nginx config will not start." >&2
    echo "  A deploy of this would leave the React container down on every community hostname." >&2
    exit 1
fi

echo "PASS: both React nginx configs parse and nginx will start on them."
