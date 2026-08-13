#!/usr/bin/env bash
# =============================================================================
# Provision / reset / tear down the disposable web-uk journey environment.
# LOCAL DEVELOPMENT ONLY. See compose.webuk-e2e.yml for the rationale.
# =============================================================================
#
# 🔴 Safety invariants, checked at runtime below rather than trusted:
#   - operates ONLY on the `nexus_webuk_e2e` database
#   - REFUSES to run if the target database name is `nexus` or `nexus_test`
#   - seeds SYNTHETIC data only; never copies rows from `nexus`
#
# Usage:
#   bash scripts/webuk-e2e-env.sh up      provision database, seed, start containers
#   bash scripts/webuk-e2e-env.sh reset   drop + reload schema + reseed (fast wipe)
#   bash scripts/webuk-e2e-env.sh seed    reseed only, leaving schema in place
#   bash scripts/webuk-e2e-env.sh down    stop the containers (database survives)
#   bash scripts/webuk-e2e-env.sh status  report what is running and seeded
set -uo pipefail

ACTION="${1:-status}"
DB_NAME="nexus_webuk_e2e"
DB_CONTAINER="nexus-php-db"
APP_CONTAINER="nexus-webuk-e2e-app"
FRONTEND_CONTAINER="nexus-webuk-e2e-frontend"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE=(docker compose -f "$ROOT_DIR/compose.yml" -f "$ROOT_DIR/compose.webuk-e2e.yml" --profile webuk-e2e)

# The synthetic community these journeys run against.
E2E_TENANT_SLUG="e2e-community"
E2E_TENANT_NAME="E2E Test Community"

# A SECOND synthetic community. Its whole purpose is tenant-isolation testing: one
# community's member must never be able to read another's data, and a single-community
# fixture cannot demonstrate that either way.
E2E_TENANT2_SLUG="e2e-other"
E2E_TENANT2_NAME="E2E Other Community"

# 🔴 Hard stop. A typo here would wipe the production-derived snapshot.
if [[ "$DB_NAME" == "nexus" || "$DB_NAME" == "nexus_test" ]]; then
  echo "REFUSING: DB_NAME is '$DB_NAME'. This script must only ever touch a disposable database." >&2
  exit 1
fi

mysql_root() {
  docker exec -i "$DB_CONTAINER" mysql --skip-ssl -h 127.0.0.1 -uroot -pnexus_root_secret "$@" 2>/dev/null
}
mysql_e2e() {
  docker exec -i "$DB_CONTAINER" mysql --skip-ssl -h 127.0.0.1 -unexus -pnexus_secret "$DB_NAME" "$@" 2>/dev/null
}

require_db_container() {
  if ! docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
    echo "ERROR: $DB_CONTAINER is not running. Start the ordinary stack first." >&2
    exit 1
  fi
}

create_database() {
  echo "==> ensuring database $DB_NAME exists"
  mysql_root -e "CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
                 GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO 'nexus'@'%'; FLUSH PRIVILEGES;"
}

load_schema() {
  # Loads the COMMITTED schema dump rather than running ~190 migrations: same result,
  # a few seconds instead of minutes, and it is the artefact CI already trusts.
  local dump="$ROOT_DIR/database/schema/mysql-schema.sql"
  if [[ ! -f "$dump" ]]; then
    echo "ERROR: schema dump missing at $dump" >&2
    exit 1
  fi
  echo "==> loading schema dump into $DB_NAME"
  mysql_e2e < "$dump"
  local tables
  tables=$(mysql_e2e -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DB_NAME';")
  echo "    $tables tables"
}

drop_all_tables() {
  echo "==> dropping all tables in $DB_NAME"
  # Generated DROP avoids DROP DATABASE, which would also drop the GRANT.
  local stmts
  stmts=$(mysql_e2e -N -e "SELECT CONCAT('DROP TABLE IF EXISTS \`', table_name, '\`;') FROM information_schema.tables WHERE table_schema='$DB_NAME';")
  if [[ -n "$stmts" ]]; then
    printf 'SET FOREIGN_KEY_CHECKS=0;\n%s\nSET FOREIGN_KEY_CHECKS=1;\n' "$stmts" | mysql_e2e
  fi
}

assert_laravel_targets_e2e_db() {
  # 🔴 FAIL CLOSED. Do not seed until Laravel itself confirms which database it resolved.
  #
  # This check exists because the first run of this script seeded the WRONG database.
  # `config/database.php` prefers `DB_DATABASE` over `DB_NAME`, and `APP_ENV=testing`
  # made Laravel load `.env.testing`, which sets `DB_DATABASE=nexus_test`. The container
  # env said one thing, the framework resolved another, and `db:seed` reported success.
  # Reading the value back out of the booted framework is the only trustworthy check.
  local resolved
  resolved=$(docker exec "$APP_CONTAINER" php -r '
    require "/var/www/html/vendor/autoload.php";
    $app = require "/var/www/html/bootstrap/app.php";
    $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
    echo config("database.connections.mysql.database");
  ' 2>/dev/null | tr -d '[:space:]')

  echo "==> Laravel resolved database: '${resolved:-<empty>}'"
  if [[ "$resolved" != "$DB_NAME" ]]; then
    echo "    🔴 REFUSING TO SEED. Expected '$DB_NAME'." >&2
    echo "    Laravel is pointed somewhere else — seeding now would write into it." >&2
    echo "    Check DB_DATABASE (not just DB_NAME) in compose.webuk-e2e.yml, and APP_ENV." >&2
    exit 1
  fi
}

seed_synthetic() {
  echo "==> seeding synthetic fixtures"
  if ! docker ps --format '{{.Names}}' | grep -qx "$APP_CONTAINER"; then
    echo "ERROR: $APP_CONTAINER is not running; start it with 'up' before seeding." >&2
    exit 1
  fi

  assert_laravel_targets_e2e_db

  # 1. The master tenant row the app expects, then our synthetic community.
  docker exec "$APP_CONTAINER" php artisan db:seed --class=TenantSeeder --force 2>&1 | tail -2

  # 2. A synthetic community. Written with SQL rather than a factory so the row shape
  #    is explicit and there is no chance of pulling a real tenant's configuration.
  #    🔴 The activity column is `is_active`, NOT `status` — `tenants` has no `status`.
  #    `path`/`depth` are the materialised-path columns the sub-tenant logic reads.
  ensure_tenant "$E2E_TENANT_SLUG" "$E2E_TENANT_NAME"
  ensure_tenant "$E2E_TENANT2_SLUG" "$E2E_TENANT2_NAME"

  local tenant_id tenant2_id
  tenant_id=$(tenant_id_for "$E2E_TENANT_SLUG")
  tenant2_id=$(tenant_id_for "$E2E_TENANT2_SLUG")
  echo "    synthetic tenants: $E2E_TENANT_SLUG=$tenant_id  $E2E_TENANT2_SLUG=$tenant2_id"

  # 3. Members + a listing in the primary community, via the existing idempotent seeder.
  docker exec -e E2E_TENANT_ID="$tenant_id" "$APP_CONTAINER" \
    php artisan db:seed --class=E2ETestDataSeeder --force 2>&1 | tail -2

  # 4. The SECOND community's own members. The seeder keys on (tenant_id, email), so it
  #    needs distinct addresses — reusing them would collide across communities.
  docker exec \
    -e E2E_TENANT_ID="$tenant2_id" \
    -e E2E_USER_EMAIL="e2e.other.a@project-nexus.local" \
    -e E2E_SECOND_USER_EMAIL="e2e.other.b@project-nexus.local" \
    -e E2E_ADMIN_EMAIL="e2e.other.admin@project-nexus.local" \
    "$APP_CONTAINER" php artisan db:seed --class=E2ETestDataSeeder --force 2>&1 | tail -2

  # 5. A broker in the primary community. 🔴 `broker` is NOT a junior admin — it is an
  #    operational role with its own application, deliberately refused generic
  #    /v2/admin/* by AdminTier. The seeder has no broker, and journeys cannot check
  #    that boundary without one. Cloned from member B so every login-gate column
  #    (email_verified_at, is_approved, status) is already correct.
  local broker_email="e2e.broker@project-nexus.local"
  if [[ "$(mysql_e2e -N -e "SELECT COUNT(*) FROM users WHERE tenant_id=$tenant_id AND email='$broker_email';")" == "0" ]]; then
    mysql_e2e -e "INSERT INTO users (tenant_id, email, first_name, last_name, name, password_hash, role, status,
                                     is_verified, email_verified_at, is_approved, balance, profile_type,
                                     onboarding_completed, created_at, updated_at)
                  SELECT tenant_id, '$broker_email', 'E2E', 'Broker', 'E2E Broker', password_hash, 'broker', status,
                         is_verified, email_verified_at, is_approved, 40, profile_type,
                         onboarding_completed, NOW(), NOW()
                  FROM users WHERE tenant_id=$tenant_id AND email='e2e.user.b@project-nexus.local' LIMIT 1;"
  fi
  echo "    roles present: $(mysql_e2e -N -e "SELECT GROUP_CONCAT(DISTINCT role ORDER BY role) FROM users WHERE tenant_id IN ($tenant_id,$tenant2_id);")"
}

ensure_tenant() {
  local slug="$1" name="$2"
  if [[ "$(mysql_e2e -N -e "SELECT COUNT(*) FROM tenants WHERE slug='$slug';")" == "0" ]]; then
    mysql_e2e -e "INSERT INTO tenants (name, slug, tenant_category, is_active, parent_id, depth, allows_subtenants, max_depth, created_at, updated_at)
                  VALUES ('$name', '$slug', 'community', 1, NULL, 0, 1, 3, NOW(), NOW());"
    # `path` is self-referential, so it can only be set once the id is known.
    mysql_e2e -e "UPDATE tenants SET path = CONCAT('/', id, '/') WHERE slug='$slug' AND (path IS NULL OR path='');"
  fi
}

tenant_id_for() {
  local id
  id=$(mysql_e2e -N -e "SELECT id FROM tenants WHERE slug='$1' LIMIT 1;")
  if [[ -z "$id" ]]; then
    echo "ERROR: could not create or find synthetic tenant '$1'." >&2
    exit 1
  fi
  printf '%s' "$id"
}

assert_no_real_data() {
  # 🔴 The claim this environment exists to support is "no real member data".
  # Assert it rather than assume it: every user must be a *.local synthetic address.
  local total foreign
  total=$(mysql_e2e -N -e "SELECT COUNT(*) FROM users;")
  foreign=$(mysql_e2e -N -e "SELECT COUNT(*) FROM users WHERE email NOT LIKE '%@project-nexus.local' AND email NOT LIKE '%@example.%';")
  echo "==> synthetic-data check: $total users, $foreign with a non-synthetic email"
  if [[ "${foreign:-0}" -gt 0 ]]; then
    echo "    🔴 FAIL: $foreign user(s) do not look synthetic. Do NOT screenshot or publish from this environment." >&2
    return 1
  fi
  echo "    OK — no real member data present"
}

case "$ACTION" in
  up)
    require_db_container
    create_database
    if [[ "$(mysql_e2e -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DB_NAME';")" == "0" ]]; then
      load_schema
    else
      echo "==> schema already present (use 'reset' to rebuild)"
    fi
    echo "==> starting containers"
    "${COMPOSE[@]}" up -d webuk-e2e-app webuk-e2e-frontend
    echo "==> waiting for Laravel on :8091"
    for _ in $(seq 1 60); do
      code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:8091/health.php || true)
      [[ "$code" == "200" ]] && break
      sleep 2
    done
    seed_synthetic
    assert_no_real_data || true
    echo
    echo "Laravel: http://127.0.0.1:8091    web-uk: http://127.0.0.1:5181"
    echo "Community slug: $E2E_TENANT_SLUG"
    ;;
  reset)
    require_db_container
    create_database
    drop_all_tables
    load_schema
    seed_synthetic
    assert_no_real_data || true
    ;;
  seed)
    require_db_container
    seed_synthetic
    assert_no_real_data || true
    ;;
  down)
    "${COMPOSE[@]}" stop webuk-e2e-app webuk-e2e-frontend
    echo "Containers stopped. The $DB_NAME database is left in place; use 'reset' to rebuild it."
    ;;
  status)
    require_db_container
    echo "database:  $DB_NAME"
    echo "tables:    $(mysql_e2e -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DB_NAME';" || echo '?')"
    echo "tenants:   $(mysql_e2e -N -e "SELECT COUNT(*) FROM tenants;" 2>/dev/null || echo '?')"
    echo "users:     $(mysql_e2e -N -e "SELECT COUNT(*) FROM users;" 2>/dev/null || echo '?')"
    for c in "$APP_CONTAINER" "$FRONTEND_CONTAINER"; do
      if docker ps --format '{{.Names}}' | grep -qx "$c"; then echo "running:   $c"; else echo "stopped:   $c"; fi
    done
    ;;
  *)
    echo "Usage: bash scripts/webuk-e2e-env.sh {up|reset|seed|down|status}" >&2
    exit 1
    ;;
esac
