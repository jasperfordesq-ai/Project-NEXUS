#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
# Prove the deploy engine behaves EXACTLY as before when web-uk is not enabled.
# Extracts the functions under test rather than sourcing the whole script, which
# would run main().
set -uo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/deploy/bluegreen-deploy.sh"
TMP=$(mktemp)

# Pull out the variable block and the four functions we care about.
{
  sed -n '/^BLUE_API_PORT=/,/^WEBUK_COMPOSE_OVERLAY=/p' "$SRC"
  sed -n '/^ports_for_color() {/,/^}/p' "$SRC"
  sed -n '/^webuk_port_for_color() {/,/^}/p' "$SRC"
  sed -n '/^webuk_enabled() {/,/^}/p' "$SRC"
  sed -n '/^compose_files_for_release() {/,/^}/p' "$SRC"
  sed -n '/^container_name() {/,/^}/p' "$SRC"
  echo 'log_err() { echo "ERR: $*"; }'
  echo 'log_info() { echo "INFO: $*"; }'
} > "$TMP"

# shellcheck disable=SC1090
source "$TMP"

fail=0
check () {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  PASS  $label"
  else
    echo "  FAIL  $label"
    echo "        expected: [$expected]"
    echo "        actual:   [$actual]"
    fail=$((fail + 1))
  fi
}

echo "=== 1. ports_for_color STILL returns exactly two fields ==="
# 🔴 The whole reason webuk_port_for_color is separate. Eight call sites do
# `read -r api_port frontend_port`, so a third field would be silently discarded.
for c in blue green; do
  out="$(ports_for_color "$c")"
  n=$(echo "$out" | wc -w)
  check "ports_for_color $c field count" "2" "$n"
done
check "ports_for_color blue" "8090 3000" "$(ports_for_color blue)"
check "ports_for_color green" "8190 3400" "$(ports_for_color green)"

echo
echo "=== 2. web-uk is OFF unless explicitly enabled ==="
if webuk_enabled; then echo "  FAIL  webuk_enabled true with NEXUS_DEPLOY_WEBUK unset"; fail=$((fail+1));
else echo "  PASS  webuk_enabled false by default"; fi

echo
echo "=== 3. compose file list is UNCHANGED when disabled ==="
out="$(compose_files_for_release /rel | tr '\n' ' ')"
check "compose files (disabled)" "-f /rel/compose.bluegreen.yml " "$out"

echo
echo "=== 4. dedicated port function ==="
check "webuk_port_for_color blue" "3500" "$(webuk_port_for_color blue)"
check "webuk_port_for_color green" "3600" "$(webuk_port_for_color green)"

echo
echo "=== 5. ports do not collide with anything already bound ==="
# 8090/8190 API, 3000/3400 frontend, 5180 web-uk dev. 3500/3600 must avoid all.
for p in 3500 3600; do
  case "$p" in
    8090|8190|3000|3400|3100|5180) echo "  FAIL  web-uk port $p collides"; fail=$((fail+1)) ;;
    *) echo "  PASS  web-uk port $p is distinct" ;;
  esac
done

echo
echo "=== 6. container_name knows webuk and still rejects nonsense ==="
check "container_name blue webuk" "nexus-blue-webuk" "$(container_name blue webuk)"
check "container_name green webuk" "nexus-green-webuk" "$(container_name green webuk)"
check "container_name blue app (unchanged)" "nexus-blue-php-app" "$(container_name blue app)"
if container_name blue nonsense >/dev/null 2>&1; then
  echo "  FAIL  container_name accepted an unknown service"; fail=$((fail+1))
else
  echo "  PASS  container_name still rejects an unknown service"
fi

echo
echo "=== 7. ENABLED: overlay is added, and refuses if the file is absent ==="
export NEXUS_DEPLOY_WEBUK=1
DEPLOY_WEBUK=1
if webuk_enabled; then echo "  PASS  webuk_enabled true when set to 1"; else echo "  FAIL  not enabled"; fail=$((fail+1)); fi

REL=$(mktemp -d)
touch "$REL/compose.bluegreen.yml" "$REL/compose.webuk.bluegreen.yml"
out="$(compose_files_for_release "$REL" | tr '\n' ' ')"
check "compose files (enabled, overlay present)" "-f $REL/compose.bluegreen.yml -f $REL/compose.webuk.bluegreen.yml " "$out"

# 🔴 A release that predates the overlay must fail LOUDLY, not silently deploy
# without web-uk while the operator believes it was included.
REL2=$(mktemp -d)
touch "$REL2/compose.bluegreen.yml"
if out="$(compose_files_for_release "$REL2" 2>&1)"; then
  echo "  FAIL  missing overlay did not cause a failure"; fail=$((fail+1))
else
  echo "  PASS  missing overlay fails loudly"
fi

echo
echo "=== 8. the --with-webuk FLAG works, because an env var cannot cross ssh+sudo ==="
# 🔴 The defect this covers: scripts/deploy.sh reaches the server over SSH and runs
# the deploy under sudo, neither of which forwards environment variables. So
# NEXUS_DEPLOY_WEBUK=1 deployed WITHOUT web-uk and reported success.
unset NEXUS_DEPLOY_WEBUK
DEPLOY_WEBUK=0
eval "$(sed -n '/^parse_flags() {/,/^}/p' "$SRC")"
usage () { :; }
parse_flags deploy --with-webuk
if [ "$DEPLOY_WEBUK" = "1" ]; then echo "  PASS  --with-webuk enables it"; else echo "  FAIL  --with-webuk did not enable it"; fail=$((fail+1)); fi
DEPLOY_WEBUK=1
parse_flags deploy --without-webuk
if [ "$DEPLOY_WEBUK" = "0" ]; then echo "  PASS  --without-webuk disables it"; else echo "  FAIL  --without-webuk did not disable it"; fail=$((fail+1)); fi

echo
echo "=== 8b. once web-uk is LIVE, a flagless deploy must REFUSE ==="
# 🔴 The defect this covers, and it is the worst one found in this arm of the work.
# DEPLOY_WEBUK lived only in the current invocation. Nothing remembered that web-uk
# was serving members. So one ordinary `bash scripts/deploy.sh` — no flag, exactly
# what a routine deploy looks like — rewrote the Apache routes file without
# Define NEXUS_WEBUK_PORT, the vhost's <IfDefine !…> arm took over, and every
# accessible hostname silently went back to Blade. At HTTP 200. And post_cutover_smoke
# waved it through, because Blade does not answer /version at all, so "no response"
# read as "not cut over yet".
MARKER_TMP=$(mktemp -d)
WEBUK_LIVE_MARKER="$MARKER_TMP/.webuk-live"
eval "$(sed -n '/^enforce_webuk_live_marker() {/,/^}/p' "$SRC")"
log_err () { echo "$*"; }
log_warn () { echo "$*"; }

# No marker yet (pre-cutover): a flagless deploy is fine, nothing to protect.
DEPLOY_WEBUK=0; WEBUK_EXPLICITLY_DISABLED=0
if ( enforce_webuk_live_marker ) >/dev/null 2>&1; then
  echo "  PASS  no marker: a flagless deploy proceeds"
else
  echo "  FAIL  no marker but the guard refused"; fail=$((fail+1))
fi

# Marker present — web-uk is live.
printf 'confirmed_at=now\n' > "$WEBUK_LIVE_MARKER"

DEPLOY_WEBUK=0; WEBUK_EXPLICITLY_DISABLED=0
if ( enforce_webuk_live_marker ) >/dev/null 2>&1; then
  echo "  FAIL  web-uk is LIVE and a flagless deploy was allowed — this is the original defect"; fail=$((fail+1))
else
  echo "  PASS  web-uk LIVE + no flag: refused"
fi

DEPLOY_WEBUK=1; WEBUK_EXPLICITLY_DISABLED=0
if ( enforce_webuk_live_marker ) >/dev/null 2>&1; then
  echo "  PASS  web-uk LIVE + --with-webuk: proceeds"
else
  echo "  FAIL  --with-webuk was refused"; fail=$((fail+1))
fi

# An explicit retreat to Blade is allowed, but must warn rather than pass quietly.
DEPLOY_WEBUK=0; WEBUK_EXPLICITLY_DISABLED=1
if out="$( enforce_webuk_live_marker 2>&1 )"; then
  if echo "$out" | grep -q 'fall back to the Blade frontend'; then
    echo "  PASS  web-uk LIVE + --without-webuk: allowed, with a warning"
  else
    echo "  FAIL  --without-webuk proceeded without warning about the fallback"; fail=$((fail+1))
  fi
else
  echo "  FAIL  --without-webuk should be allowed as a deliberate choice"; fail=$((fail+1))
fi
rm -rf "$MARKER_TMP"

echo
echo "=== 8c. the empty-/version arm must be marker-aware, not an unconditional pass ==="
# The check existed to catch "silently fell back to Blade" and could not, because
# that case produces exactly the empty response the warn-and-pass arm accepted.
if grep -q 'if \[ -f "\$WEBUK_LIVE_MARKER" \]; then' "$SRC" \
   && awk '/accessible_version did NOT respond|did NOT respond, and web-uk is LIVE/{found=1} END{exit !found}' "$SRC"; then
  echo "  PASS  empty /version is a hard failure once the marker exists"
else
  echo "  FAIL  empty /version still passes unconditionally"; fail=$((fail+1))
fi
# And the marker must only ever be written from a POSITIVE observation.
if awk '/log_ok "Public accessible host confirmed as web-uk"/{c=1} c&&/WEBUK_LIVE_MARKER/{found=1} END{exit !found}' "$SRC"; then
  echo "  PASS  the marker is written only after a confirmed public hostname"
else
  echo "  FAIL  the marker is not written at the confirmation point"; fail=$((fail+1))
fi

echo
echo "=== 9. deploy.sh forwards the flag and REFUSES the env var ==="
D="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/deploy.sh"
if grep -q -- '--with-webuk) WEBUK_FLAG=' "$D"; then echo "  PASS  deploy.sh accepts --with-webuk"; else echo "  FAIL  deploy.sh does not accept the flag"; fail=$((fail+1)); fi
if grep -q 'deploy --detach$WEBUK_FLAG' "$D"; then echo "  PASS  deploy.sh forwards it to the server"; else echo "  FAIL  deploy.sh does not forward it"; fail=$((fail+1)); fi
# Refusing is the point: silently ignoring the variable is the original defect.
if grep -q 'NEXUS_DEPLOY_WEBUK is set, but it CANNOT reach the server' "$D"; then echo "  PASS  deploy.sh refuses the env var loudly"; else echo "  FAIL  deploy.sh does not refuse the env var"; fail=$((fail+1)); fi

# 🔴 A MISTYPED flag must not be silently ignored — that reproduces the very defect
# the flag replaced, just via a typo instead of an env var. Run it for real: it must
# exit non-zero and must NOT have pushed anything.
if out="$(bash "$D" --with-web-uk 2>&1)"; then
  echo "  FAIL  deploy.sh accepted a mistyped flag and continued"; fail=$((fail+1))
else
  if echo "$out" | grep -q 'Unrecognised argument' && echo "$out" | grep -q 'Nothing has been pushed'; then
    echo "  PASS  deploy.sh rejects a mistyped flag before pushing"
  else
    echo "  FAIL  deploy.sh exited non-zero but not for the right reason"; fail=$((fail+1))
  fi
fi

# 🔴 And the guards must sit BEFORE the push. A guard that fires after the
# irreversible step is not a guard: the original ordering pushed main to origin and
# waited minutes for GitHub before refusing.
push_line=$(grep -n 'git push origin main' "$D" | head -1 | cut -d: -f1)
guard_line=$(grep -n 'Unrecognised argument' "$D" | head -1 | cut -d: -f1)
envguard_line=$(grep -n 'NEXUS_DEPLOY_WEBUK is set, but it CANNOT reach' "$D" | head -1 | cut -d: -f1)
if [ -n "$push_line" ] && [ -n "$guard_line" ] && [ -n "$envguard_line" ] \
   && [ "$guard_line" -lt "$push_line" ] && [ "$envguard_line" -lt "$push_line" ]; then
  echo "  PASS  both argument guards run before the push (line $guard_line/$envguard_line < $push_line)"
else
  echo "  FAIL  an argument guard runs AFTER the push (guard=$guard_line env=$envguard_line push=$push_line)"; fail=$((fail+1))
fi

rm -rf "$REL" "$REL2" "$TMP"
echo
if [ "$fail" -eq 0 ]; then echo "ALL CHECKS PASSED"; else echo "$fail CHECK(S) FAILED"; exit 1; fi
