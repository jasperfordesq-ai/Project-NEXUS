#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# Nightly backup of the ASP.NET backend's PostgreSQL database.
#
# WHY THIS EXISTS
# The previous backup job failed 156 times out of 156 between 2026-03-08 and
# 2026-08-10 — 155 days, zero successes, nobody told. Its root cause was
# trivial: it ran `ssh-keyscan -H` against an EMPTY host variable and died
# before ever reaching the backup command. It had no verification and no
# alerting, so silence looked exactly like success.
#
# Every design decision below is a direct response to that:
#
#   1. `set -euo pipefail` plus explicit checks — the script cannot skip past a
#      failed step and still report success.
#   2. The dump is VERIFIED after writing (pg_restore must be able to read it,
#      and the table count must match the live database). A file of the right
#      name and a plausible size is not a backup.
#   3. Failure ALERTS on the same Telegram channel used for deploy drift. If
#      credentials are absent the script says so loudly and still exits
#      non-zero — it never degrades into quiet success.
#   4. A `last-success` marker is written, and a stale marker is itself an
#      alertable condition, so "the job stopped running" is detectable rather
#      than invisible.
#
# WHAT IT DOES NOT DO
# It only reads. pg_dump takes a consistent snapshot inside one transaction.
# Nothing is started, stopped, restarted, or written to the database.
#
# USAGE
#   sudo bash backup-aspnet-db.sh              # normal nightly run
#   sudo bash backup-aspnet-db.sh --check      # report freshness only, no dump
#
# Optional config, if present, supplies TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID:
#   /opt/nexus-backend/.backup-alerts.env

set -euo pipefail

CONTAINER="${BACKUP_CONTAINER:-nexus-backend-db}"
DB="${BACKUP_DB:-nexus_dev}"
DBUSER="${BACKUP_DBUSER:-postgres}"
OUTDIR="${BACKUP_OUTDIR:-/opt/nexus-backend/backups}"
RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-30}"
STALE_HOURS="${BACKUP_STALE_HOURS:-48}"
ALERT_ENV="${BACKUP_ALERT_ENV:-/opt/nexus-backend/.backup-alerts.env}"
MARKER="${OUTDIR}/.last-success"

log() { printf '%s  %s\n' "$(date -u '+%Y-%m-%d %H:%M:%SZ')" "$*"; }

alert() {
  local msg="$1"
  log "ALERT: ${msg}"

  # shellcheck disable=SC1090
  [ -f "$ALERT_ENV" ] && . "$ALERT_ENV"

  if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
    # 🔴 Deliberately loud. The old job's whole failure mode was being quiet.
    log "CANNOT SEND ALERT: no TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID."
    log "Set them in ${ALERT_ENV} so failures are not silent."
    return 0
  fi

  curl -sS --max-time 20 --retry 2 \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
    --data-urlencode "text=ASP.NET DATABASE BACKUP

${msg}

host: $(hostname)
db:   ${DB} (${CONTAINER})" >/dev/null 2>&1 || log "Telegram send failed"
}

fail() {
  alert "FAILED: $1"
  exit 1
}

freshness_report() {
  if [ ! -f "$MARKER" ]; then
    echo "NO SUCCESSFUL BACKUP HAS EVER BEEN RECORDED"
    return 1
  fi
  local last age_h
  last=$(cat "$MARKER")
  age_h=$(( ( $(date -u +%s) - $(date -u -d "$last" +%s) ) / 3600 ))
  echo "last success: ${last}  (${age_h}h ago)"
  [ "$age_h" -le "$STALE_HOURS" ]
}

# --- --check mode: report freshness, alert if stale, take no dump ------------
if [ "${1:-}" = "--check" ]; then
  if freshness_report; then
    log "OK: $(freshness_report)"
    exit 0
  fi
  alert "STALE: no successful backup in the last ${STALE_HOURS}h. $(freshness_report 2>&1 || true)"
  exit 1
fi

# --- preflight ---------------------------------------------------------------
docker ps --format '{{.Names}}' | grep -qx "$CONTAINER" \
  || fail "container ${CONTAINER} is not running"

mkdir -p "$OUTDIR"

AVAIL_KB=$(df -Pk "$OUTDIR" | awk 'NR==2 {print $4}')
[ "$AVAIL_KB" -ge 1048576 ] \
  || fail "less than 1 GB free in ${OUTDIR} — refusing to write a possibly truncated backup"

TABLES_LIVE=$(docker exec "$CONTAINER" psql -U "$DBUSER" -d "$DB" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'") \
  || fail "cannot query the live database"
[ "${TABLES_LIVE:-0}" -gt 0 ] || fail "live database reports 0 tables — refusing to overwrite good backups"

STAMP=$(date -u +%Y%m%d-%H%M%S)
BASE="aspnet-${DB}-${STAMP}"
log "starting: ${TABLES_LIVE} tables live, writing ${BASE}"

# --- dump --------------------------------------------------------------------
docker exec "$CONTAINER" pg_dump -U "$DBUSER" -d "$DB" \
  --format=custom --compress=9 --no-owner --no-privileges \
  > "${OUTDIR}/${BASE}.dump" 2>"${OUTDIR}/${BASE}.err" \
  || { cat "${OUTDIR}/${BASE}.err" >&2; rm -f "${OUTDIR}/${BASE}.dump"; fail "pg_dump failed"; }
rm -f "${OUTDIR}/${BASE}.err"

# --- verify (a dump that cannot be read is not a backup) ---------------------
TOC=$(docker exec -i "$CONTAINER" pg_restore --list < "${OUTDIR}/${BASE}.dump" 2>/dev/null | wc -l) \
  || fail "pg_restore could not read the dump it just wrote"
[ "$TOC" -ge 100 ] || fail "pg_restore listed only ${TOC} entries — dump looks truncated"

# Counts TABLE and TABLE DATA entries, so this is >= 2x the table count. Used as
# a floor, never as an equality check.
TABLES_DUMPED=$(docker exec -i "$CONTAINER" pg_restore --list < "${OUTDIR}/${BASE}.dump" 2>/dev/null \
  | grep -c ' TABLE ' || true)
[ "$TABLES_DUMPED" -ge "$TABLES_LIVE" ] \
  || fail "dump has ${TABLES_DUMPED} table entries but the database has ${TABLES_LIVE} tables"

sha256sum "${OUTDIR}/${BASE}.dump" > "${OUTDIR}/${BASE}.sha256"

SIZE=$(du -h "${OUTDIR}/${BASE}.dump" | cut -f1)
log "verified: ${SIZE}, ${TOC} catalogue entries, ${TABLES_LIVE} tables"

# --- retention ---------------------------------------------------------------
DELETED=$(find "$OUTDIR" -maxdepth 1 -name 'aspnet-*.dump' -mtime "+${RETAIN_DAYS}" -print -delete | wc -l)
find "$OUTDIR" -maxdepth 1 -name 'aspnet-*.sha256' -mtime "+${RETAIN_DAYS}" -delete 2>/dev/null || true
[ "$DELETED" -gt 0 ] && log "retention: removed ${DELETED} backup(s) older than ${RETAIN_DAYS} days"

# --- record success ----------------------------------------------------------
date -u '+%Y-%m-%dT%H:%M:%SZ' > "$MARKER"
KEPT=$(find "$OUTDIR" -maxdepth 1 -name 'aspnet-*.dump' | wc -l)
log "SUCCESS: ${BASE}.dump (${SIZE}); ${KEPT} backup(s) retained"
