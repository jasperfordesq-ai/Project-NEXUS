#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Anomaly checker for the prerender event log.
#
# Reads new JSONL lines since the last invocation (tracked via cursor file)
# and reports counts of interesting events. Exits non-zero if anomalies are
# present, so a cron wrapper can fan out to Slack / Sentry / paging without
# this script having to know about any of them.
#
# Interesting events:
#   - supersede        : a deploy killed an in-flight prerender (expected
#                        occasionally; sustained > N/hr indicates instability)
#   - fail             : prerender produced no usable output (always interesting)
#   - partial          : some pages rendered, some failed
#   - reclaim_*_lock   : stale lock recovery (one-off ok; sustained = bug)
#   - skip_on_clean    : informational only, never an anomaly
#   - start / success  : informational only
#
# Cron wiring (every 5 min; stays silent unless something fires):
#   */5 * * * * bash /opt/nexus-php/scripts/prerender-events-check.sh > /tmp/nexus-prerender-alert 2>&1 || \
#       cat /tmp/nexus-prerender-alert | curl -X POST -H 'Content-Type: text/plain' --data-binary @- "$SLACK_WEBHOOK"
#
# Run manually:
#   bash scripts/prerender-events-check.sh                # since last run
#   bash scripts/prerender-events-check.sh --since 1h     # last hour
#   bash scripts/prerender-events-check.sh --reset        # clear cursor

set -uo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/nexus-php}"
EVENT_LOG="${PRERENDER_EVENT_LOG:-$DEPLOY_DIR/logs/prerender-events.jsonl}"
CURSOR_FILE="${PRERENDER_EVENTS_CURSOR:-$DEPLOY_DIR/logs/.prerender-events.cursor}"

# Anomaly thresholds — sustained rates that warrant alerting. Tuned for the
# expected normal operation; bump these as the platform's deploy frequency
# evolves.
SUPERSEDE_THRESHOLD="${SUPERSEDE_THRESHOLD:-3}"   # > 3 per window = unusual
FAIL_THRESHOLD="${FAIL_THRESHOLD:-1}"             # any fail is interesting
PARTIAL_THRESHOLD="${PARTIAL_THRESHOLD:-2}"       # > 2 partials is interesting
RECLAIM_THRESHOLD="${RECLAIM_THRESHOLD:-2}"       # > 2 stale-lock recoveries

SINCE=""
RESET=0
JSON_OUTPUT=0

while [ $# -gt 0 ]; do
    case "$1" in
        --since) SINCE="${2:-}"; shift 2 ;;
        --reset) RESET=1; shift ;;
        --json)  JSON_OUTPUT=1; shift ;;
        --help|-h)
            sed -n 's/^# //p; s/^#$//p' "$0" | head -40
            exit 0
            ;;
        *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
done

if [ "$RESET" -eq 1 ]; then
    rm -f "$CURSOR_FILE"
    echo "Cursor reset"
    exit 0
fi

if [ ! -f "$EVENT_LOG" ]; then
    [ "$JSON_OUTPUT" -eq 1 ] \
        && printf '{"status":"no_log","path":"%s"}\n' "$EVENT_LOG" \
        || echo "No event log at $EVENT_LOG (not yet emitted)"
    exit 0
fi

TOTAL_LINES="$(wc -l < "$EVENT_LOG" | tr -d ' ')"

if [ -n "$SINCE" ]; then
    # Time-based filter (e.g. --since 1h, 2d). Use awk to compare ISO timestamps.
    CUTOFF_EPOCH="$(date -d "-$SINCE" +%s 2>/dev/null || echo 0)"
    if [ "$CUTOFF_EPOCH" = "0" ]; then
        echo "Bad --since value: $SINCE (try 1h, 2d, 30m)" >&2
        exit 2
    fi
    EVENTS="$(awk -v cutoff="$CUTOFF_EPOCH" '
        match($0, /"ts":"[^"]+"/) {
            ts = substr($0, RSTART+6, RLENGTH-7)
            cmd = "date -d \"" ts "\" +%s 2>/dev/null"
            cmd | getline epoch
            close(cmd)
            if (epoch+0 >= cutoff) print
        }
    ' "$EVENT_LOG")"
    START_LINE="(time-filtered: --since $SINCE)"
else
    LAST_POS="$(cat "$CURSOR_FILE" 2>/dev/null || echo 0)"
    if ! [[ "$LAST_POS" =~ ^[0-9]+$ ]]; then LAST_POS=0; fi
    if [ "$LAST_POS" -ge "$TOTAL_LINES" ]; then
        EVENTS=""
    else
        EVENTS="$(tail -n +$((LAST_POS + 1)) "$EVENT_LOG")"
    fi
    START_LINE="(since cursor line $LAST_POS / total $TOTAL_LINES)"
    echo "$TOTAL_LINES" > "$CURSOR_FILE"
fi

if [ -z "$EVENTS" ]; then
    [ "$JSON_OUTPUT" -eq 1 ] \
        && echo '{"status":"no_new_events"}' \
        || echo "No new events $START_LINE"
    exit 0
fi

count_event() {
    printf '%s\n' "$EVENTS" | grep -c "\"event\":\"$1\"" || true
}

START_N=$(count_event start)
SUCCESS_N=$(count_event success)
PARTIAL_N=$(count_event partial)
FAIL_N=$(count_event fail)
SUPERSEDE_N=$(count_event supersede)
RECLAIM_STALE_N=$(count_event reclaim_stale_lock)
RECLAIM_ORPHAN_N=$(count_event reclaim_orphan_lock)
SKIP_CLEAN_N=$(count_event skip_on_clean)
WARMUP_OK_N=$(printf '%s\n' "$EVENTS" | grep -c '"event":"success".*"source":"warmup"' || true)
WARMUP_SKIP_N=$(printf '%s\n' "$EVENTS" | grep -c '"event":"skip","source":"warmup"' || true)

ANOMALIES=()
[ "$FAIL_N" -ge "$FAIL_THRESHOLD" ]                        && ANOMALIES+=("fail=$FAIL_N (threshold $FAIL_THRESHOLD)")
[ "$PARTIAL_N" -ge "$PARTIAL_THRESHOLD" ]                  && ANOMALIES+=("partial=$PARTIAL_N (threshold $PARTIAL_THRESHOLD)")
[ "$SUPERSEDE_N" -ge "$SUPERSEDE_THRESHOLD" ]              && ANOMALIES+=("supersede=$SUPERSEDE_N (threshold $SUPERSEDE_THRESHOLD)")
RECLAIM_TOTAL=$((RECLAIM_STALE_N + RECLAIM_ORPHAN_N))
[ "$RECLAIM_TOTAL" -ge "$RECLAIM_THRESHOLD" ]              && ANOMALIES+=("reclaim_lock=$RECLAIM_TOTAL (threshold $RECLAIM_THRESHOLD)")

if [ "$JSON_OUTPUT" -eq 1 ]; then
    printf '{"status":"%s","start":%d,"success":%d,"partial":%d,"fail":%d,"supersede":%d,"reclaim_stale":%d,"reclaim_orphan":%d,"skip_on_clean":%d,"warmup_ok":%d,"warmup_skip":%d,"anomalies":%d}\n' \
        "$([ ${#ANOMALIES[@]} -eq 0 ] && echo healthy || echo alert)" \
        "$START_N" "$SUCCESS_N" "$PARTIAL_N" "$FAIL_N" \
        "$SUPERSEDE_N" "$RECLAIM_STALE_N" "$RECLAIM_ORPHAN_N" \
        "$SKIP_CLEAN_N" "$WARMUP_OK_N" "$WARMUP_SKIP_N" \
        "${#ANOMALIES[@]}"
else
    echo "Prerender events $START_LINE:"
    echo "  start=$START_N success=$SUCCESS_N partial=$PARTIAL_N fail=$FAIL_N"
    echo "  supersede=$SUPERSEDE_N reclaim_stale=$RECLAIM_STALE_N reclaim_orphan=$RECLAIM_ORPHAN_N"
    echo "  skip_on_clean=$SKIP_CLEAN_N warmup_ok=$WARMUP_OK_N warmup_skip=$WARMUP_SKIP_N"
    if [ "${#ANOMALIES[@]}" -gt 0 ]; then
        echo ""
        echo "ANOMALIES:"
        for A in "${ANOMALIES[@]}"; do echo "  - $A"; done
    fi
fi

[ "${#ANOMALIES[@]}" -eq 0 ]
