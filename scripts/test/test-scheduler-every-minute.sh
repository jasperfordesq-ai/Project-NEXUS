#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# The production scheduler must start a `schedule:run` pass in EVERY minute.
#
# Until 2026-11-17 its loop was `schedule:run; sleep 60`. A pass takes 7-26 s,
# so passes started every ~68 s and drifted: measured on production that
# morning, 20 of 151 minutes had no pass at all. A task due at one exact minute
# was skipped whenever its minute was one of them — that day `backup:verify`
# (09:30) did not run (passes at 09:29:53 and 09:31:01).
#
# The loop now sleeps to the start of the next minute, and runs at once when a
# long pass has already crossed into it. This test takes the scheduler's real
# command from compose.bluegreen.yml and runs its loop against stand-in `php`,
# `date` and `sleep` on a pretend clock (pass lengths taken from production,
# plus one longer than a minute). It checks that every minute gets exactly one
# pass, and — so the test is known to catch the fault — that the old loop,
# run the same way, misses minutes. No container, no real waiting.
#   bash scripts/test/test-scheduler-every-minute.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d -t nexus-scheduler-minute-XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
FAILURES=0
pass() { echo "  ok   $1"; }
failt() { echo "  FAIL $1" >&2; FAILURES=$((FAILURES + 1)); }

# ---------------------------------------------------------------------------
# The loop as the container's inner shell receives it: the single-quoted
# `sh -c '...'` handed to setpriv, after compose turns `$$` into `$` and the
# outer command's `\"` into `"`.
COMPOSE="$REPO_ROOT/compose.bluegreen.yml"
LINE="$(awk '/^  scheduler:/{s=1} s && /^    command:/{print; exit}' "$COMPOSE")"
INNER="${LINE#*--init-groups sh -c \'}"
INNER="${INNER%\'\"}"
INNER="${INNER//\$\$/\$}"
INNER="${INNER//\\\"/\"}"

echo "part 1: the scheduler command"
if [ -n "$LINE" ] && [ "$INNER" != "$LINE" ]; then
    pass "found the scheduler's loop in compose.bluegreen.yml"
else
    failt "could not find the scheduler's command in compose.bluegreen.yml"
    exit 1
fi
case "$INNER" in
    *"schedule:run"*) pass "the loop runs schedule:run (the healthcheck looks for it)" ;;
    *) failt "the loop no longer says schedule:run; the healthcheck greps PID 1 for it" ;;
esac
case "$INNER" in
    *"schedule:interrupt"*) pass "a stop still interrupts the running pass" ;;
    *) failt "the TERM/INT trap with schedule:interrupt is gone" ;;
esac
case "$INNER" in
    *"sleep 60"*) failt "the loop still sleeps a fixed 60 seconds after each pass" ;;
    *) pass "no fixed 60-second sleep after a pass" ;;
esac

# ---------------------------------------------------------------------------
# A pretend clock. `date +%s` reads it, `sleep N` moves it on N seconds, and
# `php artisan schedule:run` notes when it started and moves it on by the next
# pass length. After END the stand-in php stops the loop the way docker stop
# does (TERM to the shell), so the trap runs and the shell exits 0.
START=1700000013   # 13 seconds into a minute, as after a container start
END=$((START + 30 * 60))
# Lengths seen on production 17 Nov 2026 (7-12 s, 15-26 s on the quarter and
# the hour), plus one 70 s pass that runs into the next minute.
LENGTHS="7 8 7 26 7 12 8 7 70 7 8 17 7 7 11 8 7 23 7 8 7 7 12 8 7 15 7 8 7 7 8 7 26 7 8"

make_stubs() {
    local dir="$1"
    mkdir -p "$dir/bin"
    echo "$START" > "$dir/clock"
    : > "$dir/passes"
    echo "$LENGTHS" | tr ' ' '\n' > "$dir/lengths"
    cat > "$dir/bin/date" <<EOF
#!/bin/sh
[ "\${1:-}" = "+%s" ] || { echo "stub date: only +%s" >&2; exit 2; }
cat "$dir/clock"
EOF
    cat > "$dir/bin/sleep" <<EOF
#!/bin/sh
case "\$1" in ''|*[!0-9]*) echo "stub sleep: not a whole number: \$1" >&2; exit 2 ;; esac
echo \$((\$(cat "$dir/clock") + \$1)) > "$dir/clock"
EOF
    cat > "$dir/bin/php" <<EOF
#!/bin/sh
[ "\$1" = artisan ] || exit 2
case "\$2" in
  optimize|schedule:interrupt) exit 0 ;;
  schedule:run)
    now=\$(cat "$dir/clock")
    echo "\$now" >> "$dir/passes"
    len=\$(head -n 1 "$dir/lengths"); [ -n "\$len" ] || len=7
    tail -n +2 "$dir/lengths" > "$dir/lengths.next"; mv "$dir/lengths.next" "$dir/lengths"
    now=\$((now + len)); echo "\$now" > "$dir/clock"
    if [ "\$now" -ge "$END" ]; then kill -TERM "\$PPID"; fi
    exit 0 ;;
  *) exit 2 ;;
esac
EOF
    chmod +x "$dir/bin/date" "$dir/bin/sleep" "$dir/bin/php"
}

run_loop() {   # $1 = dir, $2 = loop text
    local dir="$1" status=0
    PATH="$dir/bin:$PATH" timeout 60 sh -c "$2" > "$dir/out" 2>&1 || status=$?
    echo "$status"
}

# Minutes from the first pass to the last with no pass, and with two.
check_minutes() {   # $1 = passes file; prints "<missed> <doubled> <list of missed>"
    awk '{ m = int($1 / 60); seen[m]++; if (NR == 1) first = m; last = m }
         END {
           missed = 0; doubled = 0; list = ""
           for (m = first; m <= last; m++) {
             if (!(m in seen)) { missed++; list = list " " (m - first) }
             else if (seen[m] > 1) doubled++
           }
           print missed, doubled, list
         }' "$1"
}

# ---------------------------------------------------------------------------
echo "part 2: the loop in compose.bluegreen.yml, on a pretend clock"
NEW="$WORK/new"
make_stubs "$NEW"
STATUS="$(run_loop "$NEW" "$INNER")"
if [ "$STATUS" = 0 ]; then pass "stops cleanly on TERM (exit 0)"; else failt "did not stop cleanly on TERM (exit $STATUS): $(tail -3 "$NEW/out")"; fi
COUNT="$(wc -l < "$NEW/passes" | tr -d ' ')"
if [ "$COUNT" -ge 25 ]; then pass "$COUNT passes in 30 pretend minutes"; else failt "only $COUNT passes in 30 pretend minutes"; fi
read -r MISSED DOUBLED LIST <<< "$(check_minutes "$NEW/passes")"
if [ "$MISSED" = 0 ]; then pass "every minute has a pass"; else failt "$MISSED minute(s) with no pass (minutes:$LIST)"; fi
if [ "$DOUBLED" = 0 ]; then pass "no minute has two passes (a due task never runs twice)"; else failt "$DOUBLED minute(s) with two passes"; fi
# After a short pass the next one starts in the first second of its minute;
# only the pass after the 70 s one starts later (at once, mid-minute).
LATE_STARTS="$(awk '($1 % 60) > 1 { n++ } END { print n + 0 }' "$NEW/passes")"
if [ "$LATE_STARTS" -le 2 ]; then
    pass "passes start on the minute ($LATE_STARTS start later: the first, and the one after the 70 s pass)"
else
    failt "$LATE_STARTS passes started more than a second into their minute"
fi

# ---------------------------------------------------------------------------
echo "part 3: the old loop (sleep 60) misses minutes — the test can see the fault"
OLD="$WORK/old"
make_stubs "$OLD"
OLD_LOOP='umask 0002; trap "php artisan schedule:interrupt >/dev/null 2>&1 || true; exit 0" TERM INT; php artisan optimize && while true; do php artisan schedule:run --no-interaction; sleep 60 & wait $!; done'
run_loop "$OLD" "$OLD_LOOP" > /dev/null
read -r OLD_MISSED _ _ <<< "$(check_minutes "$OLD/passes")"
if [ "$OLD_MISSED" -ge 3 ]; then
    pass "the old loop misses $OLD_MISSED of 30 minutes here"
else
    failt "the old loop missed only $OLD_MISSED minutes; this test would not catch the fault"
fi

echo
if [ "$FAILURES" -gt 0 ]; then
    echo "test-scheduler-every-minute: $FAILURES failure(s)" >&2
    exit 1
fi
echo "test-scheduler-every-minute: all checks passed"
