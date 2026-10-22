#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# Pins scripts/check-tenant-content-writes.mjs in both directions: migrations
# that overwrite or remove community-written content (landing page, SEO,
# branding, custom pages, menus) are refused; schema changes, new rows,
# insert-if-missing defaults, approved overwrites and operational writes pass.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$(mktemp -d -t nexus-tenant-content-XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/database/migrations" "$TMP_DIR/migrations" "$TMP_DIR/.github"
cd "$TMP_DIR"
echo "[]" > .github/tenant-content-writes-baseline.json

w() { printf '%s\n' "$@"; }

# Must be refused.
w "<?php" "DB::table('tenants')->where('id', 2)->update(['meta_title' => 'X']);" > database/migrations/a_php_tenants_update.php
w "<?php" "DB::table('tenant_settings')->updateOrInsert(['tenant_id' => 2, 'setting_key' => 'landing_page.config'], ['setting_value' => '{}']);" > database/migrations/b_php_landing.php
w "INSERT INTO tenant_settings (tenant_id, setting_key, setting_value) VALUES (2, 'seo_title_suffix', 'X') ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);" > migrations/c_sql_seo.sql
w "UPDATE tenants SET hero_intro = 'x' WHERE id = 2;" > migrations/d_sql_hero.sql
w "UPDATE pages SET content = 'x' WHERE id = 3;" > migrations/i_sql_pages_update.sql
w "<?php" "DB::table('menu_items')->where('menu_id', 1)->delete();" > database/migrations/j_php_menu_delete.php
w "UPDATE tenants SET name = 'x' WHERE id = 2;" > migrations/k_sql_tenant_name.sql
w "UPDATE tenants SET configuration = JSON_SET(configuration, '\$.footer_text', 'x') WHERE id = 2;" > migrations/l_sql_footer.sql

# Must pass.
w "ALTER TABLE tenants ADD COLUMN meta_title VARCHAR(255) NULL;" > migrations/e_schema_only.sql
w "<?php" "Schema::table('tenants', function (\$t) { \$t->string('meta_description')->nullable(); });" > database/migrations/f_schema_only.php
w "-- tenant-content-overwrite: approved — owner asked, ticket HELP-1" "UPDATE tenants SET meta_title = 'x' WHERE id = 2;" > migrations/g_approved.sql
w "INSERT INTO pages (tenant_id, title) VALUES (2, 'New page');" > migrations/m_sql_pages_insert.sql
w "<?php" "DB::table('tenant_settings')->insertOrIgnore(['tenant_id' => 2, 'setting_key' => 'seo_open_graph', 'setting_value' => '1']);" > database/migrations/n_php_seo_default.php
w "UPDATE tenants SET is_active = 1 WHERE id = 2;" > migrations/o_sql_operational.sql

REFUSED="a_php_tenants_update.php b_php_landing.php c_sql_seo.sql d_sql_hero.sql i_sql_pages_update.sql j_php_menu_delete.php k_sql_tenant_name.sql l_sql_footer.sql"
ALLOWED="e_schema_only.sql f_schema_only.php g_approved.sql m_sql_pages_insert.sql n_php_seo_default.php o_sql_operational.sql"

set +e
out="$(node "$REPO_ROOT/scripts/check-tenant-content-writes.mjs" 2>&1)"
code=$?
set -e

fail=0
[ "$code" -eq 1 ] || { echo "FAIL: expected exit 1, got $code"; fail=1; }
for f in $REFUSED; do
  grep -q "✗ .*$f" <<<"$out" || { echo "FAIL: $f was not refused"; fail=1; }
done
for f in $ALLOWED; do
  ! grep -q "$f" <<<"$out" || { echo "FAIL: $f was refused but should pass"; fail=1; }
done

# A clean tree passes, and a baseline entry that no longer offends fails.
for f in $REFUSED; do rm -f "database/migrations/$f" "migrations/$f"; done
echo '["migrations/gone.sql"]' > .github/tenant-content-writes-baseline.json
set +e
node "$REPO_ROOT/scripts/check-tenant-content-writes.mjs" >/dev/null 2>&1
stale=$?
echo "[]" > .github/tenant-content-writes-baseline.json
node "$REPO_ROOT/scripts/check-tenant-content-writes.mjs" >/dev/null 2>&1
clean=$?
set -e
[ "$stale" -eq 1 ] || { echo "FAIL: a stale baseline entry should fail (got $stale)"; fail=1; }
[ "$clean" -eq 0 ] || { echo "FAIL: a clean tree should pass (got $clean)"; fail=1; }

[ "$fail" -eq 0 ] && echo "PASS: check-tenant-content-writes refuses overwrites of landing, SEO, branding, pages and menus; allows schema, new rows, defaults, approved and operational writes"
exit "$fail"
