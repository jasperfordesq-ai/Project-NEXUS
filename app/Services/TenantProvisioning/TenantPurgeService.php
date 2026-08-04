<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\TenantProvisioning;

use App\Services\RedisCache;
use App\Services\SearchService;
use App\Services\StripeSubscriptionService;
use App\Services\SuperAdminAuditService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Log;

/**
 * TenantPurgeService — the inverse of {@see TenantProvisioningService}.
 *
 * Permanently and irreversibly removes a tenant and ALL of its data. This is a
 * god-only, high-stakes operation. Deactivation (is_active = 0) remains the
 * default reversible action; a purge is a deliberate second stage that only runs
 * on an ALREADY-DEACTIVATED tenant.
 *
 * What it removes:
 *   - Every row in every base table that has a `tenant_id` column (discovered
 *     dynamically from INFORMATION_SCHEMA, so it can't rot as tables are added).
 *   - The tenant's own members (platform super-admins are reassigned to the
 *     parent tenant instead of being deleted).
 *   - The `tenants` row itself.
 *   - External state: Stripe subscriptions + customer, the tenant's documents in
 *     the shared Meilisearch indices, Redis cache keys, and the on-disk upload
 *     directory.
 *
 * What it deliberately does NOT do (surfaced as manual follow-ups):
 *   - Remove the custom domain / Plesk vhost / DNS / SSL (managed outside Laravel).
 *   - Delete prerender snapshot files (bot-only; reaped by TTL, or force-purge via
 *     the prerender admin).
 *
 * The whole operation is idempotent and re-runnable: re-purging a partially-purged
 * tenant simply deletes whatever remains.
 */
class TenantPurgeService
{
    /** Rows deleted per statement — keeps locks/transaction size bounded on huge tables. */
    private const CHUNK = 5000;

    /**
     * Purge a tenant. With ['dry_run' => true] nothing is deleted and the returned
     * report contains the row counts / external resources that WOULD be removed.
     *
     * @param  array{dry_run?: bool}  $opts
     * @return array{
     *     success: bool, error?: string, dry_run: bool,
     *     tenant?: array{id:int,name:string,slug:string},
     *     tables?: array<string,int>, totals?: array{tables_touched:int,rows:int},
     *     members_to_delete?: int, members_deleted?: int, superadmins_reassigned?: int,
     *     external?: array<string,mixed>, warnings?: array<int,string>,
     *     manual_followups?: array<int,string>
     * }
     */
    public static function purge(int $tenantId, array $opts = []): array
    {
        $dryRun = (bool) ($opts['dry_run'] ?? false);

        $report = [
            'success'          => false,
            'dry_run'          => $dryRun,
            'tables'           => [],
            'external'         => [],
            'warnings'         => [],
            'manual_followups' => [],
        ];

        // ── Pre-flight guards ────────────────────────────────────────────────
        if ($tenantId === 1) {
            return ['success' => false, 'error' => 'Cannot purge the Master tenant (id 1).', 'dry_run' => $dryRun];
        }

        $tenant = DB::table('tenants')->where('id', $tenantId)->first();
        if (!$tenant) {
            return ['success' => false, 'error' => 'Tenant not found.', 'dry_run' => $dryRun];
        }

        // A real purge is only permitted on a deactivated tenant. The dry-run
        // preview is allowed on an active tenant so the operator can see the blast
        // radius before they deactivate.
        if (!$dryRun && (int) $tenant->is_active === 1) {
            return ['success' => false, 'error' => 'Deactivate the tenant before purging it. Purge is only permitted on a deactivated tenant.', 'dry_run' => $dryRun];
        }

        $childCount = DB::table('tenants')->where('parent_id', $tenantId)->count();
        if ($childCount > 0) {
            return ['success' => false, 'error' => "Tenant has {$childCount} sub-tenant(s). Move or delete them before purging.", 'dry_run' => $dryRun];
        }

        $slug = (string) ($tenant->slug ?: ('tenant-' . $tenantId));
        $report['tenant'] = ['id' => $tenantId, 'name' => (string) $tenant->name, 'slug' => $slug];

        $tables = self::tenantScopedTables();

        // ── Dry run: count only, delete nothing ─────────────────────────────
        if ($dryRun) {
            $totalRows = 0;
            $touched   = 0;
            foreach ($tables as $table) {
                if ($table === 'users') {
                    continue; // members are reported separately (members_to_delete)
                }
                try {
                    $count = DB::table($table)->where('tenant_id', $tenantId)->count();
                } catch (\Throwable $e) {
                    $report['warnings'][] = "Count failed for {$table}: " . $e->getMessage();
                    continue;
                }
                if ($count > 0) {
                    $report['tables'][$table] = $count;
                    $totalRows += $count;
                    $touched++;
                }
            }

            $totalUsers   = DB::table('users')->where('tenant_id', $tenantId)->count();
            $platformSas  = DB::table('users')->where('tenant_id', $tenantId)->where(self::platformSuperAdminScope())->count();
            $report['members_to_delete']       = max(0, $totalUsers - $platformSas);
            $report['superadmins_reassigned']  = $platformSas;

            $report['external']  = self::previewExternal($tenant, $slug);
            $report['totals']    = ['tables_touched' => $touched, 'rows' => $totalRows];
            $report['manual_followups'] = self::manualFollowups($tenant);
            $report['success']   = true;
            return $report;
        }

        // ── Real purge ──────────────────────────────────────────────────────
        Log::warning('TenantPurgeService: starting irreversible purge', ['tenant_id' => $tenantId, 'slug' => $slug]);

        // 1. External systems first (best-effort — a dead Stripe key or Meili
        //    outage records a warning but never strands the DB purge).
        self::purgeStripe($tenant, $report);
        self::purgeSearch($tenantId, $report);
        self::purgeRedis($tenantId, $report);
        self::purgeUploads($slug, $report);

        // 2. Members. Reassign platform super-admins to the parent so they stay
        //    functional; delete everyone else (ordinary members + tenant-scoped
        //    super-admins, who have no reason to exist once the tenant is gone).
        $parentId = (int) ($tenant->parent_id ?? 1) ?: 1;
        $reassigned = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where(self::platformSuperAdminScope())
            ->update(['tenant_id' => $parentId, 'updated_at' => now()]);
        $membersDeleted = DB::table('users')->where('tenant_id', $tenantId)->delete();
        $report['members_deleted']      = $membersDeleted;
        $report['superadmins_reassigned'] = $reassigned;
        if ($reassigned > 0) {
            $report['warnings'][] = "{$reassigned} platform super-admin account(s) were reassigned to parent tenant {$parentId} — review and move them to their correct community.";
        }

        // 3. Delete every tenant-scoped row. FK checks are disabled for THIS
        //    connection only (session-scoped) so we don't have to topologically
        //    sort ~600 tables; we are removing the tenant's data wholesale, so
        //    intra-tenant referential integrity is irrelevant.
        $totalRows = 0;
        DB::statement('SET FOREIGN_KEY_CHECKS=0');
        try {
            foreach ($tables as $table) {
                if ($table === 'users') {
                    continue; // handled above
                }
                try {
                    $rows = 0;
                    do {
                        $n = DB::table($table)->where('tenant_id', $tenantId)->limit(self::CHUNK)->delete();
                        $rows += $n;
                    } while ($n >= self::CHUNK);
                    if ($rows > 0) {
                        $report['tables'][$table] = $rows;
                        $totalRows += $rows;
                    }
                } catch (\Throwable $e) {
                    $report['warnings'][] = "Delete failed for {$table}: " . $e->getMessage();
                    Log::error('TenantPurgeService: table delete failed', ['table' => $table, 'tenant_id' => $tenantId, 'error' => $e->getMessage()]);
                }
            }

            // Finally, the tenant row itself.
            DB::table('tenants')->where('id', $tenantId)->delete();
        } finally {
            DB::statement('SET FOREIGN_KEY_CHECKS=1');
        }

        $report['totals'] = ['tables_touched' => count($report['tables']), 'rows' => $totalRows];
        $report['manual_followups'] = self::manualFollowups($tenant);

        // 4. Audit + cache invalidation.
        //    log() returns false when the entry was not recorded faithfully. A purge
        //    is irreversible and this row is its only record, so surface that rather
        //    than discarding the return value as every other call site does.
        $audited = SuperAdminAuditService::log(
            'tenant_purged',
            'tenant',
            $tenantId,
            (string) $tenant->name,
            ['is_active' => $tenant->is_active, 'slug' => $slug],
            ['rows_deleted' => $totalRows, 'members_deleted' => $membersDeleted, 'tables' => count($report['tables'])],
            "Permanently purged tenant '{$tenant->name}' ({$slug}) — {$totalRows} rows across " . count($report['tables']) . ' tables, ' . $membersDeleted . ' members deleted'
        );
        if (!$audited) {
            $report['warnings'][] = 'Audit entry for this purge was not recorded faithfully — check the application log.';
        }

        try {
            Cache::store('redis')->forget("t{$tenantId}:tenant_bootstrap");
            Cache::store('redis')->forget("t{$parentId}:tenant_bootstrap");
        } catch (\Throwable $e) {
            $report['warnings'][] = 'Bootstrap cache bust failed: ' . $e->getMessage();
        }

        Log::warning('TenantPurgeService: purge complete', ['tenant_id' => $tenantId, 'rows' => $totalRows, 'members_deleted' => $membersDeleted]);

        $report['success'] = true;
        return $report;
    }

    /**
     * Every base table (not view) in the current database that has a `tenant_id`
     * column. Discovery-driven so new tables are covered automatically.
     *
     * @return array<int,string>
     */
    private static function tenantScopedTables(): array
    {
        return DB::table('information_schema.COLUMNS as c')
            ->join('information_schema.TABLES as t', function ($j) {
                $j->on('t.TABLE_SCHEMA', '=', 'c.TABLE_SCHEMA')
                  ->on('t.TABLE_NAME', '=', 'c.TABLE_NAME');
            })
            ->whereRaw('c.TABLE_SCHEMA = DATABASE()')
            ->where('c.COLUMN_NAME', 'tenant_id')
            ->where('t.TABLE_TYPE', 'BASE TABLE')
            ->pluck('c.TABLE_NAME')
            ->unique()
            ->values()
            ->all();
    }

    /**
     * Query scope matching PLATFORM super-admins (cross-tenant). Deliberately
     * excludes is_tenant_super_admin — those are scoped to this tenant and are
     * removed with it. Mirrors isPlatformSuperAdminUser() on the frontend.
     */
    private static function platformSuperAdminScope(): \Closure
    {
        return function ($q) {
            $q->where('is_super_admin', 1)
              ->orWhere('is_god', 1)
              ->orWhereIn('role', ['super_admin', 'god']);
        };
    }

    private static function purgeStripe(object $tenant, array &$report): void
    {
        if (empty($tenant->stripe_customer_id)) {
            $report['external']['stripe'] = 'no Stripe customer on record';
            return;
        }
        try {
            $report['external']['stripe'] = StripeSubscriptionService::cancelAllForCustomer((string) $tenant->stripe_customer_id);
        } catch (\Throwable $e) {
            $report['warnings'][] = 'Stripe cleanup failed: ' . $e->getMessage();
            $report['external']['stripe'] = 'FAILED — cancel/detach in the Stripe dashboard manually';
        }
    }

    private static function purgeSearch(int $tenantId, array &$report): void
    {
        try {
            $report['external']['meilisearch'] = SearchService::purgeTenant($tenantId);
        } catch (\Throwable $e) {
            $report['warnings'][] = 'Meilisearch cleanup failed: ' . $e->getMessage();
            $report['external']['meilisearch'] = 'FAILED';
        }
    }

    private static function purgeRedis(int $tenantId, array &$report): void
    {
        try {
            $report['external']['redis_keys_cleared'] = app(RedisCache::class)->clearTenant($tenantId);
        } catch (\Throwable $e) {
            $report['warnings'][] = 'Redis cleanup failed: ' . $e->getMessage();
            $report['external']['redis_keys_cleared'] = 0;
        }
    }

    private static function purgeUploads(string $slug, array &$report): void
    {
        // Defensive: never let a malformed slug escape the tenant uploads root.
        if ($slug === '' || str_contains($slug, '/') || str_contains($slug, '\\') || str_contains($slug, '..')) {
            $report['warnings'][] = "Refused to delete upload directory for unsafe slug '{$slug}'.";
            $report['external']['uploads'] = 'skipped (unsafe slug)';
            return;
        }

        $dir = base_path('httpdocs/uploads/tenants/' . $slug);
        if (!is_dir($dir)) {
            $report['external']['uploads'] = 'no upload directory';
            return;
        }
        try {
            $ok = File::deleteDirectory($dir);
            $report['external']['uploads'] = $ok ? "deleted {$dir}" : "FAILED to delete {$dir}";
            if (!$ok) {
                $report['warnings'][] = "Upload directory not fully removed: {$dir}";
            }
        } catch (\Throwable $e) {
            $report['warnings'][] = 'Upload directory delete failed: ' . $e->getMessage();
            $report['external']['uploads'] = 'FAILED';
        }
    }

    /**
     * External-resource preview for the dry run (read-only — checks presence only).
     *
     * @return array<string,mixed>
     */
    private static function previewExternal(object $tenant, string $slug): array
    {
        $dir = base_path('httpdocs/uploads/tenants/' . $slug);
        return [
            'stripe'      => empty($tenant->stripe_customer_id)
                ? 'no Stripe customer on record'
                : "will cancel subscriptions + detach customer {$tenant->stripe_customer_id}",
            'meilisearch' => 'will remove tenant documents from shared indices',
            'uploads'     => is_dir($dir) ? "will delete {$dir}" : 'no upload directory',
        ];
    }

    /**
     * Human-readable manual follow-ups that the purge cannot automate.
     *
     * @return array<int,string>
     */
    private static function manualFollowups(object $tenant): array
    {
        $out = [];
        $domains = array_filter([$tenant->domain ?? null, $tenant->accessible_domain ?? null]);
        if (!empty($domains)) {
            $out[] = 'Remove custom domain(s) ' . implode(', ', $domains)
                . ' manually — Plesk vhost, DNS records and SSL certificates are managed outside the platform.';
        }
        $out[] = 'Prerender snapshots (bot-only) are reaped by TTL; force-purge via /admin/prerender if you need them gone immediately.';
        return $out;
    }
}
