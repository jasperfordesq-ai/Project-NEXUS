<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

use App\Services\SuperAdminAuditService;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * F-593: record which community each super-panel audit row is ABOUT.
 *
 * The log was scoped for a tenant super admin by `actor_tenant_id` — where the
 * acting account sat — so it showed rows about other communities and hid rows
 * about the caller's own subtree. `target_tenant_id` is the single community the
 * action affected, or for a move the lowest common ancestor of both ends, or
 * NULL (bulk rows, anything that cannot be pinned to one community), which is
 * platform-only. See SuperAdminAuditService::resolveTargetTenantId().
 *
 * Schema change: one appended NULLable column, `ALGORITHM=INSTANT` so MariaDB
 * refuses rather than rebuilds, plus an online index (`INPLACE, LOCK=NONE`).
 * The table is small (≈2,100 rows locally on 12 Oct 2026).
 *
 * Backfill, deliberately conservative: tenant rows take their target id (a
 * tenant_moved row takes the common ancestor of the old and new paths it
 * recorded); user rows take the tenant id(s) recorded in their old/new values.
 * A user row that recorded no tenant id is LEFT NULL rather than guessed from
 * the account's current community, because the account may have moved since —
 * guessing could show a tenant super admin history from another community.
 * Those rows stay visible to the platform owner only.
 */
return new class extends Migration {
    public function up(): void
    {
        if (! Schema::hasTable('super_admin_audit_log')) {
            return;
        }

        if (! Schema::hasColumn('super_admin_audit_log', 'target_tenant_id')) {
            DB::statement(
                'ALTER TABLE `super_admin_audit_log` '
                . 'ADD COLUMN `target_tenant_id` INT UNSIGNED NULL DEFAULT NULL, '
                . 'ALGORITHM=INSTANT'
            );
        }

        $hasIndex = DB::selectOne(
            "SELECT COUNT(*) AS c FROM information_schema.statistics
              WHERE table_schema = DATABASE()
                AND table_name = 'super_admin_audit_log'
                AND index_name = 'idx_target_tenant'"
        );
        if ((int) ($hasIndex->c ?? 0) === 0) {
            DB::statement(
                'ALTER TABLE `super_admin_audit_log` '
                . 'ADD INDEX `idx_target_tenant` (`target_tenant_id`), '
                . 'ALGORITHM=INPLACE, LOCK=NONE'
            );
        }

        DB::table('super_admin_audit_log')
            ->whereNull('target_tenant_id')
            ->where('target_type', '!=', 'bulk')
            ->orderBy('id')
            ->chunkById(500, function ($rows): void {
                foreach ($rows as $row) {
                    $old = is_string($row->old_values) ? json_decode($row->old_values, true) : null;
                    $new = is_string($row->new_values) ? json_decode($row->new_values, true) : null;

                    // For a user row pass no target id, so the resolver uses only
                    // the tenant ids the row itself recorded (see the header).
                    $targetId = $row->target_type === 'tenant' && $row->target_id !== null
                        ? (int) $row->target_id
                        : null;

                    $tenantId = SuperAdminAuditService::resolveTargetTenantId(
                        (string) $row->action_type,
                        (string) $row->target_type,
                        $targetId,
                        is_array($old) ? $old : null,
                        is_array($new) ? $new : null
                    );

                    if ($tenantId !== null) {
                        DB::table('super_admin_audit_log')
                            ->where('id', $row->id)
                            ->update(['target_tenant_id' => $tenantId]);
                    }
                }
            });
    }

    public function down(): void
    {
        if (! Schema::hasTable('super_admin_audit_log')
            || ! Schema::hasColumn('super_admin_audit_log', 'target_tenant_id')) {
            return;
        }

        DB::statement('ALTER TABLE `super_admin_audit_log` DROP INDEX `idx_target_tenant`');
        DB::statement('ALTER TABLE `super_admin_audit_log` DROP COLUMN `target_tenant_id`');
    }
};
