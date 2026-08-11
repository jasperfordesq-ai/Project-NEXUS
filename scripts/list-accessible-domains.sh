#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# list-accessible-domains — read-only inventory of the hostnames that serve the
# accessible frontend, and which frontend each one is CURRENTLY serving.
#
# Why this exists: cutover happens one vhost at a time, and a vhost that was
# missed keeps serving the Blade accessible frontend at HTTP 200 indefinitely.
# Nothing else notices. This is the checklist, and with --check it is also the
# drift alarm.
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
    docker exec nexus-php-app sh -lc "mysql --skip-ssl -h db -unexus -pnexus_secret nexus -N -B -e \"$SQL\"" 2>/dev/null
}

run_production () {
    local host key
    if [ ! -f .secrets.local/deploy.env ]; then
        echo "ERROR: .secrets.local/deploy.env not found; cannot reach production." >&2
        exit 1
    fi
    # grep/cut rather than `source`: the file is not guaranteed to be safe to
    # evaluate, and this is the documented way to read it.
    host="$(grep -E '^PROD_SSH_HOST=' .secrets.local/deploy.env | cut -d= -f2- | tr -d '"'"'"'\r')"
    key="$(grep -E '^PROD_SSH_KEY=' .secrets.local/deploy.env | cut -d= -f2- | tr -d '"'"'"'\r')"
    ssh -i "$key" -o RequestTTY=force "$host" \
        "sudo docker exec nexus-php-app php -r '
            \$dsn = sprintf(\"mysql:host=%s;dbname=%s\", getenv(\"DB_HOST\"), getenv(\"DB_NAME\"));
            \$pdo = new PDO(\$dsn, getenv(\"DB_USER\"), getenv(\"DB_PASS\"));
            foreach (\$pdo->query(\"$SQL\") as \$r) {
                printf(\"%s\t%s\t%s\t%s\n\", \$r[\"id\"], \$r[\"slug\"], \$r[\"accessible_domain\"], \$r[\"domain\"]);
            }
        '" 2>/dev/null | tr -d '\r'
}

echo "Accessible-frontend hostname inventory (${MODE})"
echo

rows="$(if [ "$MODE" = production ]; then run_production; else run_local; fi)"

if [ -z "$rows" ]; then
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
echo "(web-uk answers /version with \"service\":\"nexus-webuk\"; Blade does not answer it at all)"
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
        # 🔴 Expected for every hostname until its vhost include is installed. It
        # is only drift once that hostname is supposed to have been cut over,
        # which is why this reports rather than fails.
        printf '  blade    %-40s (no /version — still the Blade frontend, or unreachable)\n' "$hostname"
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
echo "$drift hostname(s) are not yet served by web-uk."
echo "Before cutover that is the expected state. AFTER a hostname has been cut over,"
echo "any entry above that is not 'web-uk' is real drift and must be fixed —"
echo "a missed vhost serves the old frontend at HTTP 200 with nothing else noticing."
