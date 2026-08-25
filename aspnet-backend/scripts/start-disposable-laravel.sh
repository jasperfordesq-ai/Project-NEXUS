#!/usr/bin/env bash
# Copyright (c) 2024-2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# Stand up a DISPOSABLE Laravel backend for contract comparison.
#
# 🔴 Why this exists. The ordinary local Laravel database is a confidential,
# production-derived snapshot. It is read-only, and only unauthenticated GET/HEAD
# comparisons may be run against it. That ceiling is what stopped the response
# harness at signed-out page loads: most of the React corpus answers 401 on both
# backends, which proves the door is locked the same way and NOTHING about what
# is behind it.
#
# This builds a second Laravel from parts already in the repository:
#
#   - schema  : database/schema/mysql-schema.sql   (736 tables, committed)
#   - data    : Database\Seeders\E2ETestDataSeeder (synthetic, known passwords)
#
# so it contains **no real member data at all**. It is therefore safe to sign in
# to, write to, and destroy. It never touches `nexus-php-db`, the snapshot, or
# `nexus_test`: it is its own container, its own volume, its own port.
#
# Usage:
#   bash aspnet-backend/scripts/start-disposable-laravel.sh          # create/refresh
#   bash aspnet-backend/scripts/start-disposable-laravel.sh --down   # destroy
#
# Result: a Laravel API on http://127.0.0.1:8091 with the same code as the dev
# one, holding fixture data. Point the harness at it with --laravel.

set -euo pipefail

# 🔴 Required on Windows/Git Bash. Without it MSYS rewrites every argument that
# looks like a POSIX path, and `-v "$REPO_ROOT:/var/www/html:cached"` silently
# becomes a destination inside Git's own install directory, with the ":cached"
# flag folded into the path. The container then starts with NO source mounted
# and dies on a missing preload file, which reads like a PHP problem and is
# not one. Verify the mount, not the PHP error:
#   docker inspect <name> --format '{{range .Mounts}}{{.Source}} {{.Destination}}{{println}}{{end}}'
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NETWORK="nexus-internal"
DB_CONTAINER="nexus-laravel-throwaway-db"
APP_CONTAINER="nexus-laravel-throwaway-app"
APP_IMAGE="staging-app"
APP_PORT="8091"
MAIL_CONTAINER="nexus-e2e-mailhog"
DB_NAME="nexus"
DB_USER="nexus"
DB_PASS="nexus_secret"
DB_ROOT_PASS="throwaway_root"

# Fixed, non-secret test key — the same one phpunit.xml uses. A real 32-byte
# base64 key is required or anything touching Crypt throws "Unsupported cipher
# or incorrect key length"; the dev placeholder in .env is NOT a valid key.
APP_KEY_VALUE="base64:HfQEDtbtr90JIXhsaAhSFWnzIo1f31VZ2e5qLqKKnls="
JWT_SECRET_VALUE="throwaway-jwt-secret-not-a-real-credential"

say() { printf '\n=== %s\n' "$*"; }

if [[ "${1:-}" == "--down" ]]; then
  say "Destroying the disposable Laravel"
  docker rm -f "$APP_CONTAINER" "$DB_CONTAINER" >/dev/null 2>&1 || true
  docker volume rm nexus-throwaway-storage nexus-throwaway-cache >/dev/null 2>&1 || true
  echo "Gone. The snapshot database was never touched."
  exit 0
fi

# 🔴 Refuse to run if the names would collide with the real dev stack. Losing
# the snapshot to a careless container name is not a recoverable mistake.
for protected in nexus-php-db nexus-php-app nexus-php-redis; do
  if [[ "$DB_CONTAINER" == "$protected" || "$APP_CONTAINER" == "$protected" ]]; then
    echo "REFUSING: container name collides with the real dev stack ($protected)." >&2
    exit 1
  fi
done

if ! docker image inspect "$APP_IMAGE" >/dev/null 2>&1; then
  echo "Image '$APP_IMAGE' not found. Start the dev stack once so it is built:" >&2
  echo "  docker compose --profile docker-php up -d app" >&2
  exit 1
fi

say "Removing any previous disposable instance"
docker rm -f "$APP_CONTAINER" "$DB_CONTAINER" >/dev/null 2>&1 || true
docker volume rm nexus-throwaway-storage nexus-throwaway-cache >/dev/null 2>&1 || true

say "Starting a fresh MariaDB (no port published — reachable only inside Docker)"
docker run -d \
  --name "$DB_CONTAINER" \
  --network "$NETWORK" \
  -e MARIADB_ROOT_PASSWORD="$DB_ROOT_PASS" \
  -e MARIADB_DATABASE="$DB_NAME" \
  -e MARIADB_USER="$DB_USER" \
  -e MARIADB_PASSWORD="$DB_PASS" \
  mariadb:10.11 >/dev/null

printf 'waiting for the database'
for _ in $(seq 1 90); do
  if docker exec "$DB_CONTAINER" mariadb -u"$DB_USER" -p"$DB_PASS" -e "SELECT 1" "$DB_NAME" >/dev/null 2>&1; then
    printf ' ready\n'
    break
  fi
  printf '.'
  sleep 2
done

say "Loading the committed schema (736 tables)"
docker exec -i "$DB_CONTAINER" mariadb -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" \
  < "$REPO_ROOT/database/schema/mysql-schema.sql"

TABLES=$(docker exec "$DB_CONTAINER" mariadb -u"$DB_USER" -p"$DB_PASS" -N -B -e \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DB_NAME'")
echo "tables created: $TABLES"

say "Starting the Laravel app on :$APP_PORT (same image and source as dev)"
if ! docker ps --filter "name=^${MAIL_CONTAINER}$" --format '{{.Names}}' | grep -q "^${MAIL_CONTAINER}$"; then
  if docker container inspect "$MAIL_CONTAINER" >/dev/null 2>&1; then
    docker start "$MAIL_CONTAINER" >/dev/null
  else
    docker run -d --name "$MAIL_CONTAINER" --network "$NETWORK" \
      -p 127.0.0.1:1025:1025 -p 127.0.0.1:8025:8025 \
      mailhog/mailhog:v1.0.1 >/dev/null
  fi
fi
docker run -d \
  --name "$APP_CONTAINER" \
  --network "$NETWORK" \
  -p "127.0.0.1:$APP_PORT:80" \
  -v "$REPO_ROOT:/var/www/html:cached" \
  -v nexus-vendor:/var/www/html/vendor \
  -v nexus-throwaway-storage:/var/www/html/storage \
  -v nexus-throwaway-cache:/var/www/html/bootstrap/cache \
  -e DB_TYPE=mysql \
  -e DB_HOST="$DB_CONTAINER" \
  -e DB_PORT=3306 \
  -e DB_NAME="$DB_NAME" \
  -e DB_USER="$DB_USER" \
  -e DB_PASS="$DB_PASS" \
  -e DB_DATABASE="$DB_NAME" \
  -e DB_USERNAME="$DB_USER" \
  -e DB_PASSWORD="$DB_PASS" \
  -e REDIS_HOST=nexus-php-redis \
  -e REDIS_PORT=6379 \
  -e APP_ENV=local \
  -e APP_DEBUG=true \
  -e APP_URL="http://127.0.0.1:$APP_PORT" \
  -e FRONTEND_URL="http://127.0.0.1:5198" \
  -e APP_KEY="$APP_KEY_VALUE" \
  -e JWT_SECRET="$JWT_SECRET_VALUE" \
  -e CACHE_DRIVER=array \
  -e SESSION_DRIVER=array \
  -e MAIL_MAILER=smtp \
  -e SMTP_HOST="$MAIL_CONTAINER" \
  -e SMTP_PORT=1025 \
  -e SMTP_ENCRYPTION=none \
  -e SMTP_FROM_EMAIL=noreply@project-nexus.invalid \
  -e SMTP_FROM_NAME="Project NEXUS certification" \
  -e MAIL_PLATFORM_PROVIDER=smtp \
  -e NEXUS_TEST_ACCESS_TOKEN_EXPIRY_SECONDS=5 \
  -e BROADCAST_CONNECTION=null \
  "$APP_IMAGE" >/dev/null

if ! docker ps --filter "name=$APP_CONTAINER" --format '{{.Names}}' | grep -q "$APP_CONTAINER"; then
  echo "The app container exited immediately. Last output:" >&2
  docker logs "$APP_CONTAINER" 2>&1 | tail -20 >&2
  echo "" >&2
  echo "Check the source mount first — on Windows a mangled -v is the usual cause:" >&2
  docker inspect "$APP_CONTAINER" --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"
"}}{{end}}' >&2
  exit 1
fi

say "Preparing Laravel's writable directories"
docker exec "$APP_CONTAINER" bash -lc '
  mkdir -p storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs bootstrap/cache
  chown -R www-data:www-data storage bootstrap/cache
  chmod -R 775 storage bootstrap/cache
' >/dev/null

printf 'waiting for the API'
for _ in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$APP_PORT/api/v2/health" || true)
  if [[ "$code" == "200" ]]; then printf ' ready\n'; break; fi
  printf '.'
  sleep 2
done

say "Seeding synthetic fixture data (no real member data is ever copied)"
docker exec "$APP_CONTAINER" bash -lc \
  'php artisan db:seed --class="Database\\Seeders\\E2ETestDataSeeder" --force' || {
    echo "Seeder failed — the API is still up; seed by hand and re-check." >&2
  }

say "Switching every optional feature ON for the fixture community"
# 🔴 Why. Fifteen features default OFF in Laravel (TenantFeatureConfig::
# FEATURE_DEFAULTS): marketplace, courses, member_premium, podcasts,
# local_advertising, caring_community, public_events and the rest. A fresh
# fixture tenant therefore answers 403 FEATURE_DISABLED on ~27 endpoints, which
# makes them uncomparable — the harness sees a status difference and never
# reaches the payload.
#
# This is a COMPARISON fixture, so it turns everything on to maximise the
# surface that can be compared. It does NOT mean features should default on.
# Testing that a gate REFUSES correctly is a separate check against a fixture
# with them off.
# 🔴 RELATIVE path, deliberately. `MSYS_NO_PATHCONV=1` above disables MSYS's path
# rewriting for the docker arguments, which means a POSIX "$REPO_ROOT/..." reaches
# Windows node UNCONVERTED and it resolves "/c/platforms/..." against the drive root
# as "C:\c\platforms\..." — MODULE_NOT_FOUND. Observed 2026-08-19: the script
# carried on (the failure is inside a $(...) so `set -e` does not stop it), left
# every optional feature OFF, and the next parity run would have measured ~27
# endpoints answering 403 FEATURE_DISABLED as if that were a contract difference.
# A relative path is resolved by node against its cwd on every platform.
FEATURES_JSON=$(cd "$REPO_ROOT" && node aspnet-backend/scripts/all-features-on.mjs)
if [ -z "$FEATURES_JSON" ]; then
  echo "🔴 all-features-on.mjs produced nothing — refusing to leave the fixture" >&2
  echo "   community with features OFF, which would corrupt the next measurement." >&2
  exit 1
fi
docker exec "$DB_CONTAINER" mariadb -u"$DB_USER" -p"$DB_PASS" "$DB_NAME"   -e "UPDATE tenants SET features = '$FEATURES_JSON' WHERE id = 1;"
echo "features switched on: $(node -e 'process.stdout.write(String(Object.keys(JSON.parse(process.argv[1])).length))' "$FEATURES_JSON")"

say "Opting the fixture members into federation"
# 🔴 Why. The ASP.NET demo seed opts every user into federation; a fresh Laravel
# fixture opts nobody in. Federation reads are gated on that choice on BOTH
# backends, so the two answer differently for a reason that is fixture state,
# not behaviour, and the harness reports a status difference it cannot see past.
# Making the two fixtures agree is what lets the PAYLOAD be compared.
#
# This is a comparison fixture only. Opting in is a real member decision and
# nothing here changes that: verifying the gate correctly REFUSES is a separate
# check, run against a fixture that has not opted in.
docker exec "$DB_CONTAINER" mariadb -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" -e "
  INSERT INTO federation_user_settings
      (user_id, federation_optin, profile_visible_federated, messaging_enabled_federated,
       appear_in_federated_search, show_skills_federated, opted_in_at)
  SELECT id, 1, 1, 1, 1, 1, NOW() FROM users
  ON DUPLICATE KEY UPDATE federation_optin = 1, opted_in_at = NOW();
" || echo "Could not set federation opt-in — federation endpoints stay uncomparable." >&2

say "Adding the contract-parity fixture rows"
# 🔴 Why. E2ETestDataSeeder leaves the fixture at 4 users, 1 listing and 8
# categories — no event, no group, no post, no transaction. The response harness
# therefore reported 39 endpoints as MATCH_BUT_LIST_EMPTY: the envelope agreed,
# but Laravel had no rows, so the contract of the ROWS INSIDE was never compared.
# Measured 2026-08-17, Laravel was the empty side in 35 of those 39.
#
# Adding rows makes MORE surface comparable, so a FALL in the identical count
# would be the measurement getting honest rather than a regression. Measured
# outcome on the 170-path React corpus: untestable 39 -> 17, differing 72 -> 92,
# identical 59 -> 61. The 20 endpoints that moved into "differing" are row-level
# defects that were previously invisible, not new breakage.
#
# Every filter the rows satisfy was read off the running Laravel's query log,
# not guessed — see the header of parity-fixture.sql.
docker exec -i "$DB_CONTAINER" mariadb -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" \
  < "$REPO_ROOT/aspnet-backend/scripts/parity-fixture.sql" \
  && echo "parity fixture applied" \
  || echo "🔴 Parity fixture FAILED — 39 endpoints stay row-untested. Fix before measuring." >&2

say "Ready"
cat <<EOF
Disposable Laravel : http://127.0.0.1:$APP_PORT
Database           : container '$DB_CONTAINER', not published to the host
Contains           : committed schema + synthetic fixtures only
Destroy with       : bash aspnet-backend/scripts/start-disposable-laravel.sh --down

Compare against it:
  node aspnet-backend/scripts/compare-live-responses.mjs \\
    --laravel http://127.0.0.1:$APP_PORT --paths <list> --json <out>
EOF
