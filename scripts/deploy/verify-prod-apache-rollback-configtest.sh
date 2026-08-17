#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# On-prod confirmation of the blue/green rollback's Apache assumption.
# RUN THIS ON THE PRODUCTION SERVER, in a deploy window, with sudo:
#
#     sudo bash scripts/deploy/verify-prod-apache-rollback-configtest.sh
#
# Why it exists: the cheap rollback works by rewriting one Apache route file and
# reloading. A rollback to a release predating web-uk rewrites that file WITHOUT
# a `Define NEXUS_WEBUK_PORT`, and the accessible vhost include relies on an
# `<IfDefine !NEXUS_WEBUK_PORT>` arm so `apachectl configtest` still passes in
# that state — otherwise the rollback aborts itself. The logic is rehearsed off
# production by scripts/test/rehearse-bluegreen-rollback.sh (11/11), but that is
# stock Apache 2.4, not this Plesk build. This script confirms it HERE.
#
# It is SAFE: it only runs `apachectl configtest` (which parses config; it never
# reloads, restarts, or switches traffic). It edits the routes file transiently
# for the second test and restores it on EXIT via a trap — the running server is
# never touched. Do NOT run it while a deploy/rollback is actively in progress.
set -uo pipefail

ROUTES_FILE="${NEXUS_APACHE_ROUTES_FILE:-/etc/apache2/conf-enabled/nexus-active-upstreams.conf}"
CONFIGTEST="${NEXUS_APACHE_CONFIGTEST:-apachectl configtest}"

pass=0; fail=0
ok(){ echo "  PASS  $*"; pass=$((pass+1)); }
no(){ echo "  FAIL  $*"; fail=$((fail+1)); }

if [ ! -f "$ROUTES_FILE" ]; then
  echo "Routes file not found: $ROUTES_FILE"
  echo "Set NEXUS_APACHE_ROUTES_FILE to the real include path and retry."
  exit 2
fi

BACKUP="$(mktemp)"
cp -a "$ROUTES_FILE" "$BACKUP"
RESTORED=0
restore(){
  if [ "$RESTORED" = 0 ]; then
    install -m 0644 "$BACKUP" "$ROUTES_FILE"
    RESTORED=1
  fi
  rm -f "$BACKUP"
}
trap restore EXIT
trap 'echo "Interrupted — restoring routes file"; restore; exit 143' INT TERM HUP

echo "Routes file:  $ROUTES_FILE"
echo "Configtest:   $CONFIGTEST"
echo "Backed up to: $BACKUP"
echo

echo "=== State A: current config (web-uk arm, Define present) ==="
if bash -lc "$CONFIGTEST"; then ok "configtest PASSES as-is"; else no "configtest FAILS on the live config — investigate before any deploy"; fi

echo
echo "=== State B: rollback to a pre-web-uk release (Define NEXUS_WEBUK_PORT removed) ==="
if grep -q '^[[:space:]]*Define[[:space:]]\+NEXUS_WEBUK_PORT' "$ROUTES_FILE"; then
  tmp="$(mktemp)"
  grep -v '^[[:space:]]*Define[[:space:]]\+NEXUS_WEBUK_PORT' "$BACKUP" > "$tmp"
  install -m 0644 "$tmp" "$ROUTES_FILE"
  rm -f "$tmp"
  if bash -lc "$CONFIGTEST"; then ok "configtest PASSES with NEXUS_WEBUK_PORT absent (IfDefine fallback works on this Apache build)"; else no "configtest FAILS without NEXUS_WEBUK_PORT — a pre-web-uk rollback would abort itself; fix the vhost include BEFORE relying on rollback"; fi
else
  no "no 'Define NEXUS_WEBUK_PORT' line in the routes file — cannot test the fallback state (is web-uk actually deployed?)"
fi

echo
echo "=== Restore + confirm ==="
restore
if bash -lc "$CONFIGTEST"; then ok "routes file restored; configtest PASSES again — server config is back to normal"; else no "configtest FAILS after restore — the routes file may not have been restored cleanly; inspect $ROUTES_FILE NOW"; fi

echo
echo "============================================================"
echo "ON-PROD ROLLBACK CONFIGTEST: $pass passed, $fail failed"
echo "Record the result in the release ticket + PRODUCTION_RELEASE_RUNBOOK.md §6a."
echo "============================================================"
[ "$fail" -eq 0 ]
