<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

use App\Services\SuperAdminAuditService;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * Add the four missing members to super_admin_audit_log.action_type, and repair
 * the rows already blanked by their absence.
 *
 * The enum shipped with 12 members while SuperAdminAuditService::log() could be
 * handed four more. The platform runs MariaDB with `strict => false`
 * (config/database.php) — Laravel sets `sql_mode='NO_ENGINE_SUBSTITUTION'`, which
 * removes STRICT_TRANS_TABLES — so an out-of-enum value was never rejected. It was
 * silently coerced to '' (warning 1265, which PDO does not raise) while the INSERT
 * reported success and log() returned true. The failure was therefore invisible to
 * every caller, exactly as with 'postmark' in
 * 2026_07_01_000001_add_postmark_to_email_log_provider_enum.php.
 *
 * Missing members and the code that writes them:
 *   - tenant_purged                → Services\TenantProvisioning\TenantPurgeService::purge()
 *   - global_super_admin_granted   → Http\Controllers\Api\AdminSuperController::grantGlobalSuperAdmin()
 *   - global_super_admin_revoked   → Http\Controllers\Api\AdminSuperController::revokeGlobalSuperAdmin()
 *   - unknown                      → the new fail-open sentinel in SuperAdminAuditService::log()
 *
 * Consequence: a permanent tenant purge — the platform's most destructive
 * operation — was recorded with a blank action_type, making it invisible to the
 * audit log's action filter and to getStats()['by_type']. Production carried
 * exactly one such row (id 2129: tenant 3 'Public Sector Demo', purged
 * 2026-07-05, 4,821 rows across 56 tables, 32 members) with its description,
 * actor, timestamp and old/new values intact. The backfill below relabels it.
 *
 * 🔴 New members are APPENDED, never inserted mid-list. MariaDB stores enums as
 * 1-based ordinals, so inserting 'tenant_purged' next to 'tenant_deleted' would
 * renumber the members after it and force ALGORITHM=COPY — a full table rebuild
 * during a blue/green deploy. Appending is a metadata-only change. Enum order has
 * no observable effect: getLog() orders by created_at and getStats() by COUNT(*).
 *
 * 🔴 Run this through `php artisan migrate`, NEVER by hand in the mysql client.
 * Under Laravel's non-strict session the ALTER's truncation warning for the
 * pre-existing '' rows is only a warning; under the server's own global
 * STRICT_TRANS_TABLES the identical statement is a hard error.
 *
 * 🔴 Deploy note: scripts/deploy/phases/check-migration-safety.sh flags every
 * `DB::statement(... ALTER TABLE ... MODIFY ...)` as destructive and will fail
 * this deploy once. Append-only enum widening does not rewrite the table and
 * cannot affect the active colour, so the intended handling is
 * DEPLOY_ALLOW_DESTRUCTIVE_MIGRATION=1 with no maintenance mode.
 */
return new class extends Migration {
    /**
     * Rows blanked by the missing enum members are identifiable from the literal
     * description templates in the calling code. Keyed by the value to restore.
     *
     * @var array<string,array{prefix:string,target_type:string}>
     */
    private const BACKFILL = [
        'tenant_purged' => [
            'prefix'      => 'Permanently purged tenant %',
            'target_type' => 'tenant',
        ],
        'global_super_admin_granted' => [
            'prefix'      => 'Granted global super admin to user #%',
            'target_type' => 'user',
        ],
        'global_super_admin_revoked' => [
            'prefix'      => 'Revoked global super admin from user #%',
            'target_type' => 'user',
        ],
    ];

    public function up(): void
    {
        if (!Schema::hasTable('super_admin_audit_log') || !Schema::hasColumn('super_admin_audit_log', 'action_type')) {
            return;
        }

        $col = DB::selectOne("SHOW COLUMNS FROM super_admin_audit_log WHERE Field = 'action_type'");
        if ($col && is_string($col->Type ?? null) && !str_contains($col->Type, "'tenant_purged'")) {
            DB::statement(
                "ALTER TABLE super_admin_audit_log MODIFY COLUMN action_type ENUM("
                . "'tenant_created','tenant_updated','tenant_deleted','tenant_moved','hub_toggled',"
                . "'super_admin_granted','super_admin_revoked','user_created','user_updated','user_moved',"
                . "'bulk_users_moved','bulk_tenants_updated',"
                . "'tenant_purged','global_super_admin_granted','global_super_admin_revoked','unknown'"
                . ") NOT NULL"
            );
        }

        // Repair history. MUST run after the ALTER — before it, each new literal
        // would truncate straight back to ''. Scoped to action_type = '' so this
        // is idempotent and cannot touch a correctly-labelled row.
        $repaired = [];
        foreach (self::BACKFILL as $actionType => $match) {
            $n = DB::table('super_admin_audit_log')
                ->where('action_type', '')
                ->where('target_type', $match['target_type'])
                ->where('description', 'like', $match['prefix'])
                ->update(['action_type' => $actionType]);

            if ($n > 0) {
                $repaired[$actionType] = $n;
            }
        }

        $residual = (int) DB::table('super_admin_audit_log')->where('action_type', '')->count();

        Log::warning('Repaired blank super_admin_audit_log.action_type values', [
            'repaired' => $repaired,
            'residual_blank_rows' => $residual,
        ]);
    }

    public function down(): void
    {
        if (!Schema::hasTable('super_admin_audit_log') || !Schema::hasColumn('super_admin_audit_log', 'action_type')) {
            return;
        }

        // Enum-shrink is lossy. For an audit log it is worse than lossy: remapping
        // a row to a neighbouring value (as a status column reasonably might) would
        // FALSIFY the record — a purge filed as a deletion — and shrinking while
        // rows still use the new members would blank them, recreating the very bug
        // this migration fixes. So: never touch data, and only shrink when nothing
        // depends on the new members.
        $inUse = DB::table('super_admin_audit_log')
            ->whereIn('action_type', array_merge(array_keys(self::BACKFILL), [SuperAdminAuditService::UNKNOWN_ACTION]))
            ->exists();

        if ($inUse) {
            return;
        }

        DB::statement(
            "ALTER TABLE super_admin_audit_log MODIFY COLUMN action_type ENUM("
            . "'tenant_created','tenant_updated','tenant_deleted','tenant_moved','hub_toggled',"
            . "'super_admin_granted','super_admin_revoked','user_created','user_updated','user_moved',"
            . "'bulk_users_moved','bulk_tenants_updated'"
            . ") NOT NULL"
        );
    }
};
