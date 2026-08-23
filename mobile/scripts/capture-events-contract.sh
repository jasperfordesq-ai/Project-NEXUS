#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Refresh lib/api/__contract__/*.json from a live local Laravel.
#
# 🔴 The point of these fixtures is that they are the SERVER's words, not the client's. Three
# defects on 2026-08-23 came from a test fixture written from the app's own type. So this
# script sends exactly the headers the client sends and saves whatever comes back.
#
# Usage:  EVENT_ID=164 bash scripts/capture-events-contract.sh
#
# Needs: docker compose up (Laravel on 127.0.0.1:8090) and the e2e fixture accounts.
set -euo pipefail

API="${API:-http://127.0.0.1:8090/api/v2}"
TENANT="${TENANT:-hour-timebank}"
EMAIL="${EMAIL:-e2e.user.a@project-nexus.local}"
PASSWORD="${PASSWORD:-TestPassword123!}"
EVENT_ID="${EVENT_ID:-164}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/lib/api/__contract__"

TOKEN=$(curl -sS -X POST "${API%/api/v2}/api/auth/login" \
  -H 'Content-Type: application/json' -H "X-Tenant-Slug: $TENANT" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  | python -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')

# The client's headers, verbatim: lib/api/events.ts and lib/api/eventOfflineCheckin.ts.
HDRS=(-H "X-Tenant-Slug: $TENANT" -H "Authorization: Bearer $TOKEN"
      -H 'X-Events-Contract: 2' -H 'X-Event-Checkin-Contract: 1')

fetch() {
  local name="$1" path="$2"
  local code
  code=$(curl -sS -o "$OUT/$name.json" -w '%{http_code}' "$API$path" "${HDRS[@]}")
  printf '%-24s %s\n' "$name" "$code"
  [ "$code" = "200" ] || echo "  !! not 200 — the fixture may be an error body" >&2
}

mkdir -p "$OUT"
fetch events-list          "/events?per_page=5"
fetch event-detail         "/events/$EVENT_ID"
fetch agenda               "/events/$EVENT_ID/agenda"
fetch analytics            "/events/$EVENT_ID/analytics"
fetch attendees            "/events/$EVENT_ID/attendees?per_page=10&status=all"
fetch people               "/events/$EVENT_ID/people?page=1&per_page=10&sort=name&direction=asc"
fetch broadcasts           "/events/$EVENT_ID/broadcasts?page=1&per_page=10"
fetch lifecycle-history    "/events/$EVENT_ID/lifecycle-history"
fetch offline-workspace    "/events/$EVENT_ID/offline-checkin"
fetch offline-conflicts    "/events/$EVENT_ID/offline-checkin/conflicts"
fetch registration-product "/events/$EVENT_ID/registration-product"
fetch safety               "/events/$EVENT_ID/safety"
fetch tickets              "/events/$EVENT_ID/tickets"
fetch templates            "/event-templates"
# 🔴 `?type=event` matters: without it the endpoint defaults to listing categories, whose
# `type` the event schema rightly refuses. Capturing it wrong once produced a false finding.
fetch categories           "/categories?type=event"
