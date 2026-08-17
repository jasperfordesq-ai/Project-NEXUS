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
echo "=== 8a. EVERY parsed flag must survive the --detach relaunch ==="
# 🔴 The defect this covers, which shipped and was caught in production on
# 2026-08-12. `--detach` makes the script relaunch itself with `nohup bash "$0"` and
# a HAND-BUILT argument list. Any flag absent from that list is silently dropped: the
# parent parses it, echoes it, and the process that actually deploys never sees it.
#
# `--with-webuk` was missing, so `bash scripts/deploy.sh --with-webuk` printed the
# flag, survived ssh and sudo (fixed the day before), and the server log then said
# "web-uk: NOT included". `--no-migrate` was missing too, and worse: LARAVEL_MIGRATE
# defaults to 1, so a detached --no-migrate deploy RAN migrations.
#
# Compares the two lists mechanically so it cannot drift again.
PARSED=$(sed -n '/^parse_flags() {/,/^}/p' "$SRC" \
  | grep -oE -- '--[a-z-]+\)' | tr -d ')' | sort -u)
FORWARDED=$(sed -n '/^detach_if_requested() {/,/^}/p' "$SRC" \
  | grep -oE -- '"--[a-z-]+"' | tr -d '"' | sort -u)
# Deliberately not forwarded: --detach/-d (the child must not re-detach) and help.
NOT_FORWARDED=$'--detach\n--help'

missing=""
for flag in $PARSED; do
  echo "$NOT_FORWARDED" | grep -qx -- "$flag" && continue
  echo "$FORWARDED" | grep -qx -- "$flag" && continue
  missing="$missing $flag"
done

if [ -n "$missing" ]; then
  echo "  FAIL  these parsed flags are DROPPED by the detach relaunch:$missing"
  fail=$((fail+1))
else
  echo "  PASS  every parsed flag is forwarded to the detached child (or listed as deliberately not)"
fi

# And specifically the two that were broken, by name.
for flag in --with-webuk --without-webuk --no-migrate; do
  if echo "$FORWARDED" | grep -qx -- "$flag"; then
    echo "  PASS  $flag survives detach"
  else
    echo "  FAIL  $flag is dropped by detach"; fail=$((fail+1))
  fi
done

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

# An explicit --without-webuk is allowed, but must warn rather than pass quietly.
#
# 🔴 This assertion was STALE and had been FAILING since 2026-08-14, unnoticed
# because nothing in CI runs this file. It searched for 'fall back to the Blade
# frontend' — wording deliberately deleted when Blade was, because there is no
# fallback any more. The script's behaviour was right and the test was wrong, which
# is the dangerous way round: satisfying the old assertion would have meant
# reinstating a promise of a working site that does not exist. It now asserts the
# claim that actually matters.
DEPLOY_WEBUK=0; WEBUK_EXPLICITLY_DISABLED=1
if out="$( enforce_webuk_live_marker 2>&1 )"; then
  if echo "$out" | grep -q 'TAKE THE ACCESSIBLE HOSTNAMES OFFLINE'; then
    echo "  PASS  web-uk LIVE + --without-webuk: allowed, warning that it causes an outage"
  else
    echo "  FAIL  --without-webuk proceeded without warning that it takes the site offline"; fail=$((fail+1))
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

# 🔴 The DEFAULT must be --with-webuk (changed 2026-08-17). It used to be empty, so a
# routine flagless deploy sent no flag; the server then refused via the .webuk-live
# marker, but only after this script had pushed and waited for CI. Since Blade was
# deleted there is no correct flagless deploy, so the safe case is the default and
# the breaking one must be typed out.
if grep -q '^WEBUK_FLAG=" --with-webuk"' "$D"; then
  echo "  PASS  deploy.sh defaults to --with-webuk"
else
  echo "  FAIL  deploy.sh does not default to --with-webuk"; fail=$((fail+1))
fi
# The default must not swallow a deliberate --without-webuk.
if grep -q -- '--without-webuk) WEBUK_FLAG=" --without-webuk"; WEBUK_FLAG_EXPLICIT=1' "$D"; then
  echo "  PASS  deploy.sh still honours an explicit --without-webuk"
else
  echo "  FAIL  deploy.sh no longer honours --without-webuk"; fail=$((fail+1))
fi
# And it must say so, since that choice now causes an outage rather than a fallback.
if grep -q 'WILL TAKE THE ACCESSIBLE HOSTNAMES OFFLINE' "$D"; then
  echo "  PASS  deploy.sh warns that --without-webuk breaks the accessible site"
else
  echo "  FAIL  deploy.sh does not warn about --without-webuk"; fail=$((fail+1))
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

echo
echo "=== 10. confirm-webuk-live arms the marker, and CANNOT arm it on a lie ==="
# 🔴 Why this subcommand exists. post_cutover_smoke latches the marker, but it runs
# DURING a deploy — and the Apache switch happens afterwards, by hand. So on the
# real cutover (2026-08-12) the probe correctly saw Blade, correctly declined to
# latch, and left the protection dormant for the whole window between the switch
# and the next deploy. That window is exactly when a flagless deploy silently undoes
# the switch. This is the arming step for that moment.

if grep -q 'confirm-webuk-live) shift; cmd_confirm_webuk_live' "$SRC"; then
  echo "  PASS  confirm-webuk-live is dispatched (not swallowed by the catch-all)"
else
  echo "  FAIL  confirm-webuk-live is not wired into the dispatch"; fail=$((fail+1))
fi

# Run the real function against a stubbed curl, in an isolated marker location, so
# each of the three responses is exercised for real rather than grepped for.
CTMP=$(mktemp)
MARKDIR=$(mktemp -d)
{
  echo 'WEBUK_LIVE_MARKER="'"$MARKDIR"'/.webuk-live"'
  sed -n '/^cmd_confirm_webuk_live() {/,/^}/p' "$SRC"
  echo 'log_err() { echo "ERR: $*"; }'
  echo 'log_info() { echo "INFO: $*"; }'
  echo 'log_ok() { echo "OK: $*"; }'
} > "$CTMP"

# Stub curl: FAKE_VERSION is what the "public host" answers.
curl() { printf '%s' "${FAKE_VERSION:-}"; }
export -f curl 2>/dev/null || true
# shellcheck disable=SC1090
source "$CTMP"

# (a) Silence must refuse. Blade serves no /version, so empty means "still Blade".
#
# 🔴 Mutation-tested, and the result is worth recording: defeating the `-z` check
# does NOT make this pass, because an empty string also fails the nexus-webuk grep
# below it. The two guards are genuinely redundant, which is fine. So this case is
# additionally asserted on the OPERATOR MESSAGE, which only the empty-response
# branch produces — otherwise the assertion could not tell the branches apart and
# would silently stop covering the one it names.
rm -f "$MARKDIR/.webuk-live"
FAKE_VERSION=""
out_empty="$(cmd_confirm_webuk_live example.test 2>&1)" && rc=0 || rc=1
if [ "$rc" -eq 0 ]; then
  echo "  FAIL  armed the marker on an EMPTY response"; fail=$((fail+1))
elif [ -f "$MARKDIR/.webuk-live" ]; then
  echo "  FAIL  wrote the marker despite refusing"; fail=$((fail+1))
elif ! echo "$out_empty" | grep -q 'No response from'; then
  echo "  FAIL  refused, but not via the empty-response branch (message missing)"; fail=$((fail+1))
  echo "        got: $out_empty"
else
  echo "  PASS  an empty /version refuses, writes nothing, and says why"
fi

# (b) A response from the WRONG service must refuse too.
FAKE_VERSION='{"service":"something-else","release":"abc"}'
if cmd_confirm_webuk_live example.test >/dev/null 2>&1; then
  echo "  FAIL  armed the marker for a non-webuk service"; fail=$((fail+1))
elif [ -f "$MARKDIR/.webuk-live" ]; then
  echo "  FAIL  wrote the marker for a non-webuk service"; fail=$((fail+1))
else
  echo "  PASS  a non-webuk service refuses and writes nothing"
fi

# (c) A real web-uk response arms it, and records the commit the host is SERVING.
FAKE_VERSION='{"service":"nexus-webuk","release":"7b39b1b79205","color":"blue"}'
if cmd_confirm_webuk_live example.test >/dev/null 2>&1 && [ -f "$MARKDIR/.webuk-live" ]; then
  if grep -q 'commit=7b39b1b79205' "$MARKDIR/.webuk-live" \
     && grep -q 'host=example.test' "$MARKDIR/.webuk-live"; then
    echo "  PASS  a confirmed web-uk host arms the marker with the served commit"
  else
    echo "  FAIL  marker written but without the served commit/host"; fail=$((fail+1))
    sed 's/^/        /' "$MARKDIR/.webuk-live"
  fi
else
  echo "  FAIL  a confirmed web-uk host did not arm the marker"; fail=$((fail+1))
fi

# (d) Idempotent: running it twice must succeed and not corrupt the record.
before="$(cat "$MARKDIR/.webuk-live")"
if cmd_confirm_webuk_live example.test >/dev/null 2>&1 \
   && [ "$before" = "$(cat "$MARKDIR/.webuk-live")" ]; then
  echo "  PASS  running it again is a no-op"
else
  echo "  FAIL  a second run failed or rewrote the marker"; fail=$((fail+1))
fi

unset -f curl
rm -rf "$CTMP" "$MARKDIR"

rm -rf "$REL" "$REL2" "$TMP"
echo
if [ "$fail" -eq 0 ]; then echo "ALL CHECKS PASSED"; else echo "$fail CHECK(S) FAILED"; exit 1; fi
