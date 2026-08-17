#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# Blue/green ROLLBACK rehearsal — disposable, no production, no Cloudflare, no
# systemctl. Run it by hand:  bash scripts/test/rehearse-bluegreen-rollback.sh
#
# Exercises the never-run crux of scripts/deploy/bluegreen-deploy.sh:
#   1. the Apache route-file swap (write_apache_routes) is accepted by a real
#      `apachectl configtest` and graceful reload
#   2. rolling BACK to the other colour actually moves live traffic there
#   3. a rollback to a PRE-web-uk release (no NEXUS_WEBUK_PORT Define) still
#      passes configtest via the <IfDefine !NEXUS_WEBUK_PORT> arm — the specific
#      assumption scripts/deploy/apache/nexus-accessible-vhost.include.example
#      records as "NOT confirmed against the production Apache build"
#   4. a BAD config is rejected and the previous route file is auto-restored,
#      leaving live traffic on the current colour
#
# It uses the REAL write_apache_routes()/ports_for_color()/webuk_* functions
# extracted from the deploy script (not a reimplementation) and the REAL
# accessible vhost template, driven against a throwaway httpd:2.4-alpine
# container that also hosts three tiny colour backends as its own vhosts.
#
# Caveat, stated honestly: this proves the Define/<IfDefine>/ProxyPass ${VAR}
# SEMANTICS on Apache 2.4. It does NOT run against the production Plesk Apache
# build, and does NOT exercise worker draining, health gating, the public-host
# smoke, or the Cloudflare purge in cmd_rollback. The final on-prod
# `apachectl configtest` remains a cutover step needing the owner's go-ahead.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$REPO/scripts/deploy/bluegreen-deploy.sh"
VHOST_TEMPLATE="$REPO/scripts/deploy/apache/nexus-accessible-vhost.include.example"
[ -f "$SRC" ] || { echo "cannot find $SRC"; exit 2; }
[ -f "$VHOST_TEMPLATE" ] || { echo "cannot find $VHOST_TEMPLATE"; exit 2; }

CONTAINER="${REHEARSAL_CONTAINER:-nexus-rollback-rehearsal}"
IMAGE="${REHEARSAL_IMAGE:-httpd:2.4-alpine}"
HOSTPORT="${REHEARSAL_HOSTPORT:-8899}"
WORK="$(mktemp -d)"
CONF="$WORK/nexus"; mkdir -p "$CONF/be/blue" "$CONF/be/green" "$CONF/be/php"
# Docker Desktop needs a Windows-resolvable mount source (mixed C:/... form),
# not the MSYS /tmp/... path mktemp returns. cygpath is a no-op on Linux/macOS.
CONF_DOCKER="$(cygpath -m "$CONF" 2>/dev/null || echo "$CONF")"

pass=0; fail=0
ok(){ echo "  PASS  $*"; pass=$((pass+1)); }
no(){ echo "  FAIL  $*"; fail=$((fail+1)); }
cleanup(){ MSYS_NO_PATHCONV=1 docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

# ---- extract the REAL functions under test (same technique as the contract test) ----
FN="$WORK/functions.sh"
{
  sed -n '/^BLUE_API_PORT=/,/^WEBUK_COMPOSE_OVERLAY=/p' "$SRC"
  sed -n '/^ports_for_color() {/,/^}/p' "$SRC"
  sed -n '/^webuk_port_for_color() {/,/^}/p' "$SRC"
  sed -n '/^webuk_enabled() {/,/^}/p' "$SRC"
  sed -n '/^inactive_color() {/,/^}/p' "$SRC"
  sed -n '/^write_apache_routes() {/,/^}/p' "$SRC"
  cat <<'STUB'
log_info(){ echo "    apache: $*"; }
log_ok(){ echo "    apache: $*"; }
log_err(){ echo "    apache: $*"; }
log_warn(){ echo "    apache: $*"; }
write_deploy_status(){ :; }
STUB
} > "$FN"
# shellcheck disable=SC1090
source "$FN"

# module-level vars write_apache_routes relies on (defined elsewhere in SRC)
APACHE_ROUTES_FILE="$CONF/nexus-active-upstreams.conf"
STATE_FILE="$WORK/active-color"
APACHE_CONFIGTEST="MSYS_NO_PATHCONV=1 docker exec $CONTAINER httpd -f /nexus/httpd.conf -t"
APACHE_RELOAD="MSYS_NO_PATHCONV=1 docker exec $CONTAINER httpd -f /nexus/httpd.conf -k graceful"
CURRENT_ACTIVE=""; CURRENT_COMMIT=""

# ---- backend content (each colour returns its own label) ----
echo "COLOUR=blue-webuk"  > "$CONF/be/blue/index.html"
echo "COLOUR=green-webuk" > "$CONF/be/green/index.html"
echo "COLOUR=php-fallback (pre-web-uk rollback)" > "$CONF/be/php/index.html"

# ---- minimal, explicit httpd.conf: 3 backend vhosts + the REAL accessible vhost ----
cat > "$CONF/httpd.conf" <<'CONF'
ServerName rehearsal.local
Listen 80
Listen 3500
Listen 3600
Listen 8090
LoadModule mpm_event_module   modules/mod_mpm_event.so
LoadModule unixd_module       modules/mod_unixd.so
LoadModule authz_core_module  modules/mod_authz_core.so
LoadModule dir_module         modules/mod_dir.so
LoadModule mime_module        modules/mod_mime.so
LoadModule proxy_module       modules/mod_proxy.so
LoadModule proxy_http_module  modules/mod_proxy_http.so
User daemon
Group daemon
ErrorLog /proc/self/fd/2
DirectoryIndex index.html
<Directory "/nexus/be">
    Require all granted
</Directory>
# --- colour backends (stand-ins for the blue/green web-uk + php stacks) ---
<VirtualHost *:3500>
    DocumentRoot /nexus/be/blue
</VirtualHost>
<VirtualHost *:3600>
    DocumentRoot /nexus/be/green
</VirtualHost>
<VirtualHost *:8090>
    DocumentRoot /nexus/be/php
</VirtualHost>
# --- the route file the deploy script rewrites (Define NEXUS_*_PORT) ---
Include /nexus/nexus-active-upstreams.conf
# --- the REAL accessible vhost include under test ---
<VirtualHost *:80>
    ServerName accessible.local
    Include /nexus/nexus-accessible-vhost.include
</VirtualHost>
CONF

# real template, verbatim
cp "$VHOST_TEMPLATE" "$CONF/nexus-accessible-vhost.include"
# seed an initial route file (blue, web-uk enabled) so httpd starts cleanly
DEPLOY_WEBUK=1
cat > "$APACHE_ROUTES_FILE" <<RT
Define NEXUS_API_PORT 8090
Define NEXUS_FRONTEND_PORT 3000
Define NEXUS_WEBUK_PORT 3500
RT
echo blue > "$STATE_FILE"

probe(){ curl -s -m 5 -H 'Host: accessible.local' "http://127.0.0.1:$HOSTPORT/" 2>/dev/null; }

echo "=== boot throwaway Apache ($IMAGE) ==="
MSYS_NO_PATHCONV=1 docker run -d --name "$CONTAINER" -p "127.0.0.1:$HOSTPORT:80" \
  -v "$CONF_DOCKER:/nexus:ro" "$IMAGE" httpd -f /nexus/httpd.conf -DFOREGROUND >/dev/null
for _ in $(seq 1 20); do [ -n "$(probe)" ] && break; sleep 0.5; done
boot="$(probe)"
if echo "$boot" | grep -q 'blue-webuk'; then
  ok "Apache boots; accessible host serves the ACTIVE colour (blue)"
else
  no "Apache did not boot serving blue (got: '$boot')"
  MSYS_NO_PATHCONV=1 docker logs "$CONTAINER" 2>&1 | tail -20
  exit 1
fi

echo
echo "=== 1. write_apache_routes(blue) — configtest + reload accepted ==="
DEPLOY_WEBUK=1
if write_apache_routes blue >/dev/null 2>&1; then ok "route swap to blue accepted by real apachectl configtest + graceful reload"; else no "write_apache_routes blue failed configtest/reload"; fi
grep -q 'Define NEXUS_WEBUK_PORT 3500' "$APACHE_ROUTES_FILE" && ok "route file carries the web-uk arm (Define NEXUS_WEBUK_PORT 3500)" || no "route file missing web-uk Define"

echo
echo "=== 2. ROLLBACK: switch blue -> green moves LIVE traffic ==="
DEPLOY_WEBUK=1
write_apache_routes green >/dev/null 2>&1
r="$(probe)"
echo "$r" | grep -q 'green-webuk' && ok "live traffic now served by GREEN after rollback switch (got: $r)" || no "traffic did not move to green (got: '$r')"
[ "$(cat "$STATE_FILE")" = green ] && ok "state file records active colour = green" || no "state file not updated to green"

echo
echo "=== 3. ROLLBACK to a PRE-web-uk release (no NEXUS_WEBUK_PORT) — the documented open risk ==="
DEPLOY_WEBUK=0
if write_apache_routes blue >/dev/null 2>&1; then ok "configtest PASSES with no NEXUS_WEBUK_PORT Define (IfDefine fallback works)"; else no "configtest FAILED without web-uk Define — the rollback would abort itself"; fi
grep -q 'NEXUS_WEBUK_PORT' "$APACHE_ROUTES_FILE" && no "route file still has web-uk Define (should be absent)" || ok "route file has NO web-uk Define (pre-web-uk shape)"
r="$(probe)"
echo "$r" | grep -q 'php-fallback' && ok "fallback arm routes to the PHP/API port when web-uk absent (got: $r)" || no "fallback arm did not engage (got: '$r')"

echo
echo "=== 4. AUTO-REVERT: a bad config is rejected and the previous route file restored ==="
DEPLOY_WEBUK=1
write_apache_routes green >/dev/null 2>&1
before="$(cat "$APACHE_ROUTES_FILE")"
_saved_ct="$APACHE_CONFIGTEST"
APACHE_CONFIGTEST="false"   # simulate apachectl configtest rejecting the new config
if write_apache_routes blue >/dev/null 2>&1; then no "write_apache_routes returned success despite a failing configtest"; else ok "write_apache_routes returns non-zero when configtest rejects the config"; fi
APACHE_CONFIGTEST="$_saved_ct"
after="$(cat "$APACHE_ROUTES_FILE")"
[ "$before" = "$after" ] && ok "route file auto-restored to the previous (good) config — no half-applied switch" || no "route file left in a changed state after a rejected config"
r="$(probe)"
echo "$r" | grep -q 'green-webuk' && ok "live traffic unchanged (still GREEN) after the rejected switch" || no "live traffic changed despite rejected config (got: '$r')"

echo
echo "============================================================"
echo "REHEARSAL RESULT: $pass passed, $fail failed"
echo "============================================================"
[ "$fail" -eq 0 ]
