#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# list-accessible-domains — read-only inventory of the hostnames that serve the
# accessible frontend, and which frontend each one is CURRENTLY serving.
#
# Why this exists: cutover happened one vhost at a time, and a vhost that was
# missed kept serving the Blade accessible frontend at HTTP 200 indefinitely.
# Nothing else noticed. This is the checklist, and with --check it is also the
# drift alarm.
#
# 🔴 THE MEANING OF A SILENT HOST CHANGED ON 2026-08-14. The Blade accessible
# frontend was deleted, so a hostname that does not answer /version is no longer
# "still on the old frontend, at HTTP 200" — it is BROKEN. This matters because
# this script is what you reach for during an incident, and it used to label such
# a host `blade`, which reads as fine-but-old. It now labels it `DOWN`.
#
# 🔴 STRICTLY READ-ONLY. It runs SELECTs and GETs. It never writes, restarts or
# deploys anything.
#
# Usage:
#   bash scripts/list-accessible-domains.sh              # list from the local DB
#   bash scripts/list-accessible-domains.sh --production # list from production
#   bash scripts/list-accessible-domains.sh --check      # probe each /version
#   bash scripts/list-accessible-domains.sh --production --check

set -uo pipefail

MODE=local
CHECK=0
for arg in "$@"; do
    case "$arg" in
        --production) MODE=production ;;
        --check) CHECK=1 ;;
        -h|--help)
            sed -n '7,24p' "$0"
            exit 0
            ;;
        *)
            echo "Unknown argument: $arg" >&2
            exit 2
            ;;
    esac
done

# Only domains, and only for live communities. `accessible_domain` is already
# public (the tenant bootstrap endpoint exposes it), so this discloses nothing new
# — but there is no reason to pull anything else out of the table.
SQL="SELECT id, slug, COALESCE(NULLIF(accessible_domain, ''), '-') AS accessible_domain,
     COALESCE(NULLIF(domain, ''), '-') AS domain
     FROM tenants
     WHERE (accessible_domain IS NOT NULL AND accessible_domain <> '')
        OR (domain IS NOT NULL AND domain <> '')
     ORDER BY id;"

run_local () {
    # 🔴 stderr is NOT swallowed. It used to end in `2>/dev/null`, which is the same
    # fault that was fixed in run_production and left here: a container that is not
    # running, a renamed service or a credential change all became "no communities
    # have accessible domains", which reads as "nothing to do" on a cutover
    # checklist. A silently empty checklist is worse than no checklist.
    docker exec nexus-php-app sh -lc "mysql --skip-ssl -h db -unexus -pnexus_secret nexus -N -B -e \"$SQL\""
}

run_production () {
    local host key sql_b64
    if [ ! -f .secrets.local/deploy.env ]; then
        echo "ERROR: .secrets.local/deploy.env not found; cannot reach production." >&2
        exit 1
    fi
    # grep/cut rather than `source`: the file is not guaranteed to be safe to
    # evaluate, and this is the documented way to read it.
    host="$(grep -E '^PROD_SSH_HOST=' .secrets.local/deploy.env | cut -d= -f2- | tr -d '"'"'"'\r')"
    key="$(grep -E '^PROD_SSH_KEY=' .secrets.local/deploy.env | cut -d= -f2- | tr -d '"'"'"'\r')"

    # 🔴 THE WHOLE PHP PROGRAM TRAVELS AS BASE64, and three failures got us here.
    #
    # 1. The first version embedded the SQL in a `php -r '...'` argument inside a
    #    double-quoted SSH string. The SQL contains single quotes —
    #    NULLIF(accessible_domain, '') and '-' — which terminated the PHP argument
    #    early, so the command was always malformed.
    # 2. It ended in `2>/dev/null`, turning that into EMPTY OUTPUT that is
    #    indistinguishable from "no community has an accessible domain". This is the
    #    cutover checklist; a silently empty checklist reads as "nothing to do" and
    #    is worse than no checklist at all.
    # 3. Once stderr was visible, two more real faults appeared immediately: the
    #    documented container `nexus-php-app` IS NOT RUNNING on a blue/green host,
    #    and the running one has NO `mysql` client installed.
    #
    # Base64-ing the entire program — not just the query — removes every quoting
    # layer between here and the container: the payload is alphanumeric plus `+/=`,
    # and PHP reads the decoded program from stdin. Nothing is escaped, so nothing
    # can be mis-escaped.
    local php_program
    php_program="$(cat <<'PHPEOF'
<?php
$dsn = sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', getenv('DB_HOST'), getenv('DB_NAME'));
$pdo = new PDO($dsn, getenv('DB_USER'), getenv('DB_PASS'), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$sql = base64_decode(getenv('NEXUS_DOMAIN_SQL_B64'), true);
if ($sql === false) { fwrite(STDERR, "could not decode the query\n"); exit(1); }
foreach ($pdo->query($sql) as $row) {
    echo implode("\t", [$row['id'], $row['slug'], $row['accessible_domain'], $row['domain']]), "\n";
}
PHPEOF
)"
    sql_b64="$(printf '%s' "$SQL" | base64 -w0 2>/dev/null || printf '%s' "$SQL" | base64 | tr -d '\n')"
    local php_b64
    php_b64="$(printf '%s' "$php_program" | base64 -w0 2>/dev/null || printf '%s' "$php_program" | base64 | tr -d '\n')"

    # 🔴 THE CONTAINER NAME IS RESOLVED, NOT ASSUMED.
    #
    # The first version of this ran `docker exec nexus-php-app`, which is what the
    # documentation shows — and that container IS NOT RUNNING on this host. It is the
    # legacy single-colour container, left in `exited` state by the blue/green
    # migration. Production runs `nexus-blue-php-app` and `nexus-green-php-app`.
    #
    # Found only because the fix above stopped swallowing stderr. With `2>/dev/null`
    # this would have printed an empty inventory forever and been believed.
    #
    # The active colour is recorded in .bluegreen-active; fall back to the legacy
    # name so this still works on a host that predates blue/green.
    #
    # The container's own DB_* environment is used INSIDE the container, so no
    # credential is written on a command line here or on the remote host.
    # The query is handed to PHP through an environment variable set on the
    # `docker exec` line, so it never touches a shell quoting context either. The DB
    # credentials stay entirely inside the container.
    ssh -i "$key" -o RequestTTY=force "$host" \
        "APP_CONTAINER=\"nexus-\$(sudo cat /opt/nexus-php/.bluegreen-active 2>/dev/null || echo '')-php-app\"; \
         sudo docker ps --format '{{.Names}}' | grep -qx \"\$APP_CONTAINER\" || APP_CONTAINER=nexus-php-app; \
         sudo docker exec -e NEXUS_DOMAIN_SQL_B64=$sql_b64 \"\$APP_CONTAINER\" \
             sh -c 'echo $php_b64 | base64 -d | php'" \
        | tr -d '\r' | grep -vE '^\s*$'
}

echo "Accessible-frontend hostname inventory (${MODE})"
echo

# 🔴 The QUERY'S OWN EXIT STATUS IS CHECKED, and an empty production result is an
# ERROR rather than a reassuring message.
#
# Two related faults were fixed here. First, `run_production`'s `exit 1` for a
# missing `.secrets.local/deploy.env` only ever exited the command-substitution
# subshell, so the script sailed on. Second — and this is the one that mattered —
# whatever the cause (no secrets file, unreachable SSH, a failed `docker exec`), the
# script printed "No communities … were returned. For local runs this is normal…"
# and exited 0. In `--production` mode that is a cutover checklist reporting
# "nothing to do" because it could not read anything at all.
rows=""
query_status=0
if [ "$MODE" = production ]; then
    rows="$(run_production)" || query_status=$?
else
    rows="$(run_local)" || query_status=$?
fi

if [ "$query_status" -ne 0 ]; then
    echo "ERROR: the domain query FAILED (exit $query_status). The list below would be incomplete." >&2
    if [ "$MODE" = production ]; then
        echo "       Do NOT use this run as a cutover checklist." >&2
    fi
    exit 1
fi

if [ -z "$rows" ]; then
    if [ "$MODE" = production ]; then
        # Production has communities with domains. An empty result here means the
        # query did not really run, not that there is nothing to cut over.
        echo "ERROR: production returned NO rows." >&2
        echo "       Production is known to have communities with domains, so this is almost" >&2
        echo "       certainly a failed query rather than an empty table — check the output" >&2
        echo "       above for the real error. Do NOT treat this as 'nothing to cut over'." >&2
        exit 1
    fi
    echo "No communities with a domain or accessible_domain were returned."
    echo "For local runs this is normal: local fixtures usually have neither set."
    exit 0
fi

printf '%-5s %-22s %-34s %s\n' ID SLUG ACCESSIBLE_DOMAIN DOMAIN
printf '%-5s %-22s %-34s %s\n' ----- ---------------------- ---------------------------------- ------
while IFS=$'\t' read -r id slug accessible domain; do
    [ -z "${id:-}" ] && continue
    printf '%-5s %-22s %-34s %s\n' "$id" "$slug" "$accessible" "$domain"
done <<< "$rows"

if [ "$CHECK" -eq 0 ]; then
    echo
    echo "Pass --check to probe each hostname's /version and see which frontend it serves."
    exit 0
fi

echo
echo "=== Which frontend is each hostname actually serving? ==="
echo "(web-uk answers /version with \"service\":\"nexus-webuk\". Nothing else serves these"
echo " hostnames any more — the Blade accessible frontend was deleted on 2026-08-14 — so"
echo " a hostname that does not answer is DOWN, not 'still on the old frontend'.)"
echo

drift=0
probe () {
    local hostname="$1" label="$2" body
    [ "$hostname" = "-" ] && return 0

    body="$(curl -sf --max-time 10 -H 'Cache-Control: no-cache' \
        "https://$hostname/version" 2>/dev/null || true)"

    if echo "$body" | grep -q '"service":"nexus-webuk"'; then
        local release
        release="$(echo "$body" | sed -n 's/.*"release":"\([^"]*\)".*/\1/p')"
        printf '  web-uk   %-40s release=%s\n' "$hostname" "${release:-unknown}"
    elif [ -z "$body" ]; then
        # 🔴 This arm printed `blade` until 2026-08-14, which was accurate then and is
        # actively misleading now: with Blade deleted there is no working frontend
        # behind a silent hostname. Reported rather than failed because this script is
        # strictly read-only and is often run against a partially-configured host.
        printf '  DOWN     %-40s no /version — nothing is serving this hostname\n' "$hostname"
        drift=$((drift + 1))
    else
        printf '  UNKNOWN  %-40s answered /version but did not identify as web-uk\n' "$hostname"
        printf '           body: %s\n' "${body:0:120}"
        drift=$((drift + 1))
    fi
}

while IFS=$'\t' read -r id slug accessible domain; do
    [ -z "${id:-}" ] && continue
    probe "$accessible" "$slug"
done <<< "$rows"

probe "accessible.project-nexus.ie" "platform default"

echo
echo "$drift hostname(s) are NOT served by web-uk."
echo "🔴 Since 2026-08-14 every one of those is a hostname with NOTHING serving it."
echo "The Blade accessible frontend that used to answer them at HTTP 200 has been"
echo "deleted, so any entry above that is not 'web-uk' is a live fault, not a"
echo "not-yet-migrated host. Fix it by deploying with --with-webuk and confirming"
echo "Define NEXUS_WEBUK_PORT is present in the Apache routes file."
