#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# Pins scripts/check-tenant-content-writes.mjs in both directions: migrations
# that write a community's landing page or SEO settings are refused; schema
# changes, approved overwrites and unrelated tenant writes pass.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$(mktemp -d -t nexus-tenant-content-XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/database/migrations" "$TMP_DIR/migrations" "$TMP_DIR/.github"
cd "$TMP_DIR"
echo "[]" > .github/tenant-content-writes-baseline.json

# Must be refused.
printf '%s\n' "<?php" "DB::table('tenants')->where('id', 2)->update(['meta_title' => 'X']);" > database/migrations/a_php_tenants_update.php
printf '%s\n' "<?php" "DB::table('tenant_settings')->updateOrInsert(['tenant_id' => 2, 'setting_key' => 'landing_page.config'], ['setting_value' => '{}']);" > database/migrations/b_php_landing.php
printf '%s\n' "INSERT INTO tenant_settings (tenant_id, setting_key, setting_value) VALUES (2, 'seo_title_suffix', 'X');" > migrations/c_sql_seo.sql
printf '%s\n' "UPDATE tenants SET hero_intro = 'x' WHERE id = 2;" > migrations/d_sql_hero.sql
# Must pass.
printf '%s\n' "ALTER TABLE tenants ADD COLUMN meta_title VARCHAR(255) NULL;" > migrations/e_schema_only.sql
printf '%s\n' "<?php" "Schema::table('tenants', function (\$t) { \$t->string('meta_description')->nullable(); });" > database/migrations/f_schema_only.php
printf '%s\n' "-- tenant-content-overwrite: approved — owner asked, ticket HELP-1" "UPDATE tenants SET meta_title = 'x' WHERE id = 2;" > migrations/g_approved.sql
printf '%s\n' "UPDATE tenants SET name = 'x' WHERE id = 2;" > migrations/h_name_only.sql

set +e
out="$(node "$REPO_ROOT/scripts/check-tenant-content-writes.mjs" 2>&1)"
code=$?
set -e

fail=0
[ "$code" -eq 1 ] || { echo "FAIL: expected exit 1, got $code"; fail=1; }
for f in a_php_tenants_update.php b_php_landing.php c_sql_seo.sql d_sql_hero.sql; do
  grep -q "✗ .*$f" <<<"$out" || { echo "FAIL: $f was not refused"; fail=1; }
done
for f in e_schema_only.sql f_schema_only.php g_approved.sql h_name_only.sql; do
  ! grep -q "$f" <<<"$out" || { echo "FAIL: $f was refused but should pass"; fail=1; }
done

# A clean tree passes, and a baseline entry that no longer offends fails.
rm -f database/migrations/a_* database/migrations/b_* migrations/c_* migrations/d_*
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

[ "$fail" -eq 0 ] && echo "PASS: check-tenant-content-writes refuses overwrites and allows schema, approved and unrelated writes"
exit "$fail"
