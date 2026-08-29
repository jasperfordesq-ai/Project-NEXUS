#!/usr/bin/env bash
# =============================================================================
# Provision the DISPOSABLE three-actor fixture for the Caring Community
# caregiver-consent browser journey. LOCAL DEVELOPMENT ONLY.
# =============================================================================
#
# The journey writes caregiver relationships, consent evidence and safeguarding
# decisions. It must therefore never touch the ordinary local stack, whose
# `nexus` database is a PRODUCTION-DERIVED snapshot of real members, and whose
# Vite on :5173 belongs to the developer.
#
# This script is a thin, idempotent layer over `scripts/webuk-e2e-env.sh`, which
# already builds exactly the fixture this journey needs:
#
#   - database `nexus_webuk_e2e`, synthetic accounts only
#   - community `e2e-community` (the three same-tenant actors)
#   - community `e2e-other`     (a fourth actor, for tenant-isolation checks)
#
# On top of that it does the two things the caregiver journey additionally
# needs, neither of which the base environment does:
#
#   1. runs `migrate`, because the base environment loads the COMMITTED schema
#      dump, which predates the caregiver-lifecycle migration — without this the
#      `rejected` status and every consent/approval column are simply absent;
#   2. enables `caring_community`, which defaults to FALSE
#      (TenantFeatureConfig::FEATURE_DEFAULTS), so the module is otherwise gated
#      off and every Caring route renders a "coming soon" placeholder.
#
# 🔴 Safety invariants, checked at runtime rather than trusted:
#   - operates ONLY on `nexus_webuk_e2e`
#   - reads the resolved database back OUT of the booted framework before
#     writing, because `DB_DATABASE` beats `DB_NAME` and `APP_ENV=testing` loads
#     `.env.testing` — the container env said one thing and the framework
#     resolved another once before, and seeded the wrong database
#   - refuses if any account in the target database is non-synthetic
#
# Usage:
#   bash scripts/caring-e2e-provision.sh          provision + report
#   bash scripts/caring-e2e-provision.sh --check  report only, change nothing
set -uo pipefail

MODE="${1:-provision}"
DB_NAME="nexus_webuk_e2e"
DB_CONTAINER="nexus-php-db"
APP_CONTAINER="nexus-webuk-e2e-app"
API_URL="http://127.0.0.1:8091"
FRONTEND_URL="http://127.0.0.1:5174"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# 🔴 Hard stop. A typo here would target the production-derived snapshot.
if [[ "$DB_NAME" == "nexus" || "$DB_NAME" == "nexus_test" ]]; then
  echo "REFUSING: DB_NAME is '$DB_NAME'." >&2
  exit 1
fi

mysql_e2e() {
  docker exec -i "$DB_CONTAINER" mysql --skip-ssl -h 127.0.0.1 -unexus -pnexus_secret "$DB_NAME" "$@" 2>/dev/null
}

fail() { echo "🔴 $1" >&2; exit 1; }

# --- 1. the base disposable environment must be up ---------------------------
docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER" \
  || fail "$DB_CONTAINER is not running. Start the ordinary stack first."

if ! docker ps --format '{{.Names}}' | grep -qx "$APP_CONTAINER"; then
  echo "==> $APP_CONTAINER not running; bringing the disposable environment up"
  bash "$ROOT_DIR/scripts/webuk-e2e-env.sh" up || fail "webuk-e2e-env.sh up failed"
fi

# --- 2. FAIL CLOSED on which database the framework actually resolved ---------
resolved=$(docker exec "$APP_CONTAINER" php -r '
  require "/var/www/html/vendor/autoload.php";
  $app = require "/var/www/html/bootstrap/app.php";
  $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
  echo config("database.connections.mysql.database");
' 2>/dev/null | tr -d '[:space:]')

echo "==> Laravel resolved database: '${resolved:-<empty>}'"
[[ "$resolved" == "$DB_NAME" ]] \
  || fail "REFUSING. Expected '$DB_NAME'. Laravel is pointed elsewhere; provisioning now would write into it."

# --- 3. no real member data --------------------------------------------------
foreign=$(mysql_e2e -N -e "SELECT COUNT(*) FROM users WHERE email NOT LIKE '%@project-nexus.local' AND email NOT LIKE '%@example.%';")
[[ "${foreign:-1}" == "0" ]] \
  || fail "$foreign non-synthetic account(s) present. Refusing to provision a journey that writes consent evidence."
echo "==> synthetic-data check: OK"

if [[ "$MODE" == "--check" ]]; then
  echo "==> --check: reporting only, no changes made"
fi

# --- 4. schema must include the caregiver lifecycle ---------------------------
pending=$(docker exec "$APP_CONTAINER" php artisan migrate:status 2>/dev/null | grep -c "Pending" || true)
if [[ "${pending:-0}" -gt 0 ]]; then
  if [[ "$MODE" == "--check" ]]; then
    echo "    ${pending} migration(s) PENDING — run without --check to apply"
  else
    echo "==> applying ${pending} pending migration(s)"
    docker exec "$APP_CONTAINER" php artisan migrate --force 2>&1 | tail -6
  fi
else
  echo "==> migrations: up to date"
fi

# The columns this journey depends on, named explicitly so a partial schema is
# reported as such rather than surfacing later as a confusing 500.
missing=$(mysql_e2e -N -e "
  SELECT GROUP_CONCAT(c.needed) FROM (
    SELECT 'recipient_confirmed_at' needed UNION ALL SELECT 'consent_verified_at'
    UNION ALL SELECT 'consent_evidence' UNION ALL SELECT 'approved_at'
    UNION ALL SELECT 'rejected_at' UNION ALL SELECT 'rejection_reason'
  ) c
  WHERE c.needed NOT IN (
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='$DB_NAME' AND table_name='caring_caregiver_links'
  );")
[[ -z "$missing" || "$missing" == "NULL" ]] \
  || fail "caring_caregiver_links is missing: $missing"

enum_ok=$(mysql_e2e -N -e "
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema='$DB_NAME' AND table_name='caring_caregiver_links'
    AND column_name='status' AND column_type LIKE '%rejected%';")
[[ "${enum_ok:-0}" == "1" ]] || fail "caring_caregiver_links.status has no 'rejected' value."
echo "==> caregiver lifecycle schema: OK"

# --- 5. the module gate ------------------------------------------------------
# `caring_community` defaults to FALSE, so without this every Caring route
# renders the "coming soon" placeholder and the journey has nothing to walk.
# Enabled on BOTH synthetic communities deliberately: if it were off in
# `e2e-other`, the cross-community checks would be satisfied by a module gate
# and would prove nothing about TENANT SCOPING, which is what they exist to test.
if [[ "$MODE" != "--check" ]]; then
  docker exec "$APP_CONTAINER" php -r '
    require "/var/www/html/vendor/autoload.php";
    $app = require "/var/www/html/bootstrap/app.php";
    $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
    if (config("database.connections.mysql.database") !== "nexus_webuk_e2e") { exit(1); }
    foreach (["e2e-community", "e2e-other"] as $slug) {
        $row = Illuminate\Support\Facades\DB::table("tenants")->where("slug", $slug)->first();
        if (! $row) { continue; }
        $f = json_decode($row->features ?? "{}", true) ?: [];
        $f["caring_community"] = true;
        Illuminate\Support\Facades\DB::table("tenants")->where("id", $row->id)->update(["features" => json_encode($f)]);
        echo "    {$slug} (id {$row->id}) caring_community=true\n";
    }
  ' 2>&1 | tail -5
fi

caring_on=$(mysql_e2e -N -e "SELECT COUNT(*) FROM tenants WHERE slug IN ('e2e-community','e2e-other') AND features LIKE '%\"caring_community\":true%';")
[[ "${caring_on:-0}" == "2" ]] || fail "caring_community is not enabled on both synthetic communities (got ${caring_on:-0}/2)."
echo "==> caring_community feature: enabled on both synthetic communities"

# --- 6. the three actors -----------------------------------------------------
echo "==> actors in e2e-community:"
mysql_e2e -e "SELECT id, email, role FROM users
              WHERE tenant_id=(SELECT id FROM tenants WHERE slug='e2e-community')
                AND email IN ('e2e.user.a@project-nexus.local','e2e.user.b@project-nexus.local','e2e.admin@project-nexus.local')
              ORDER BY id;"
actor_count=$(mysql_e2e -N -e "SELECT COUNT(*) FROM users
              WHERE tenant_id=(SELECT id FROM tenants WHERE slug='e2e-community')
                AND email IN ('e2e.user.a@project-nexus.local','e2e.user.b@project-nexus.local','e2e.admin@project-nexus.local');")
[[ "${actor_count:-0}" == "3" ]] \
  || fail "expected 3 same-community actors, found ${actor_count:-0}. Run: bash scripts/webuk-e2e-env.sh seed"

# --- 7. reachability ---------------------------------------------------------
api_code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$API_URL/health.php" || echo 000)
echo "==> disposable Laravel $API_URL/health.php => $api_code"
[[ "$api_code" == "200" ]] || fail "the disposable Laravel is not answering on $API_URL."

fe_code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$FRONTEND_URL/" || echo 000)
echo "==> frontend under test $FRONTEND_URL => $fe_code"

echo
if [[ "$fe_code" != "200" ]]; then
  echo "NEXT: start a Vite pointed at the DISPOSABLE API (not :5173 — that is yours):"
  echo
  echo "  cd react-frontend && VITE_API_URL=$API_URL \\"
  echo "    npx vite --port 5174 --strictPort --host 127.0.0.1"
  echo
fi
echo "Then run the journey:  npm run test:e2e:caring"
