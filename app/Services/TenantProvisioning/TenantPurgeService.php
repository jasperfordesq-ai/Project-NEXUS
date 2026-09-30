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
 * Permanently and irreversibly removes a tenant and every row this schema can
 * connect to it — see "What it removes" and "What it deliberately does NOT do"
 * below, which are exhaustive and are meant to stay that way. This is a
 * god-only, high-stakes operation. Deactivation (is_active = 0) remains the
 * default reversible action; a purge is a deliberate second stage that only runs
 * on an ALREADY-DEACTIVATED tenant.
 *
 * What it removes:
 *   - Every row in every base table that has a `tenant_id` column (discovered
 *     dynamically from INFORMATION_SCHEMA, so it can't rot as tables are added).
 *   - The tenant's own members (platform super-admins are reassigned to the
 *     parent tenant instead of being deleted), and everything that hangs off a
 *     `users` row by an ON DELETE CASCADE foreign key.
 *   - Rows in tables that have NO `tenant_id` column of their own but DO hang
 *     off a tenant-scoped table by an ON DELETE CASCADE foreign key — private
 *     group chat messages, AI chat content, legal acceptances and the like.
 *     Also discovered dynamically. See purgeOrphanedCascadeChildren() and
 *     F-354 for why this needs its own pass.
 *   - The `tenants` row itself.
 *   - External state: Stripe subscriptions + customer, the tenant's documents in
 *     the shared Meilisearch indices, Redis cache keys, and the on-disk upload
 *     directory.
 *
 * What it deliberately does NOT do (surfaced as manual follow-ups):
 *   - Remove the custom domain / Plesk vhost / DNS / SSL (managed outside Laravel).
 *   - Delete prerender snapshot files (bot-only; reaped by TTL, or force-purge via
 *     the prerender admin).
 *   - 🔴 Reach a table that has NEITHER a `tenant_id` column NOR a foreign key
 *     into tenant-scoped data. Nothing in the schema connects such a row to a
 *     community, so this routine cannot identify it. That residue is reported
 *     as a manual follow-up rather than described as removed — the previous
 *     wording of this docblock ("a tenant and ALL of its data") was not true.
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
     * F-353: $opts['actor'] carries the admin who ORDERED the purge. The audit
     * row is written here, where the work happens — which in production is a
     * queue worker with no HTTP session and no super-panel access — so without
     * it the row names nobody.
     *
     * @param  array{dry_run?: bool, actor?: array{user_id?: int|null, tenant_id?: int|null, ip_address?: string|null, user_agent?: string|null}|null}  $opts
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
        $actor  = is_array($opts['actor'] ?? null) ? $opts['actor'] : null;

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

            // F-354: the children that have no tenant_id column of their own.
            foreach (self::orphanedCascadeChildren() as $target) {
                try {
                    $count = self::orphanedChildQuery($target, $tenantId)->count();
                } catch (\Throwable $e) {
                    $report['warnings'][] = "Count failed for {$target['child_table']}: " . $e->getMessage();
                    continue;
                }
                if ($count > 0) {
                    $report['tables'][$target['child_table']] = ($report['tables'][$target['child_table']] ?? 0) + $count;
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

        $totalRows = 0;

        // 2b. 🔴 F-354. Step 3 below disables FOREIGN_KEY_CHECKS, and with them
        //     off ON DELETE CASCADE never fires — so every table that has no
        //     `tenant_id` column of its own but hangs off one that does was
        //     left behind for ever: private group chat message bodies, AI chat
        //     content, and legal acceptances carrying the member's IP address
        //     and the user_id of a member whose `users` row had just been
        //     deleted. Clear those FIRST, while their parents still exist and
        //     referential integrity is still ON, so that (a) the parent id is
        //     still resolvable and (b) anything hanging off THEM in turn
        //     cascades away by itself.
        //
        //     Each delete is scoped by "this child's foreign key points at a
        //     parent row belonging to THIS tenant", so a community standing
        //     beside the one being purged cannot lose a row.
        foreach (self::orphanedCascadeChildren() as $target) {
            try {
                $rows = 0;
                do {
                    $n = self::orphanedChildQuery($target, $tenantId)->limit(self::CHUNK)->delete();
                    $rows += $n;
                } while ($n >= self::CHUNK);
                if ($rows > 0) {
                    $report['tables'][$target['child_table']] = ($report['tables'][$target['child_table']] ?? 0) + $rows;
                    $totalRows += $rows;
                }
            } catch (\Throwable $e) {
                $report['warnings'][] = "Delete failed for orphaned child {$target['child_table']}: " . $e->getMessage();
                Log::error('TenantPurgeService: orphaned child delete failed', [
                    'table' => $target['child_table'],
                    'tenant_id' => $tenantId,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        // 3. Delete every tenant-scoped row. FK checks are disabled for THIS
        //    connection only (session-scoped) so we don't have to topologically
        //    sort ~600 tables; we are removing the tenant's data wholesale, so
        //    intra-tenant referential integrity is irrelevant.
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
            ['stage' => 'completed', 'rows_deleted' => $totalRows, 'members_deleted' => $membersDeleted, 'tables' => count($report['tables'])],
            "Permanently purged tenant '{$tenant->name}' ({$slug}) — {$totalRows} rows across " . count($report['tables']) . ' tables, ' . $membersDeleted . ' members deleted',
            $actor
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
     * F-354: every single-column ON DELETE CASCADE foreign key from a table
     * WITHOUT a `tenant_id` column into a table WITH one.
     *
     * These are the rows the database would have removed by itself if the purge
     * did not disable referential integrity, and they are exactly the ones that
     * used to survive it. Discovered from INFORMATION_SCHEMA for the same reason
     * tenantScopedTables() is: a hand-maintained list of table names rots the
     * moment somebody adds a table, and this list would rot silently.
     *
     * Deliberate exclusions:
     *   - `users` as the parent. Members are deleted in step 2 with referential
     *     integrity still ON, so their ~99 cascade children go with them.
     *   - Composite (multi-column) foreign keys. None exist in this schema
     *     today; if one appears, skipping it is the safe direction — a row left
     *     behind is a retention defect, a row deleted on a half-matched key
     *     could belong to somebody else.
     *
     * @return list<array{child_table: string, child_column: string, parent_table: string, parent_column: string}>
     */
    private static function orphanedCascadeChildren(): array
    {
        // Memoised per process: the schema cannot change under a running purge,
        // and this reads INFORMATION_SCHEMA, which is expensive on a ~700-table
        // database. A CORRELATED subquery here (to count a constraint's columns
        // in SQL) measured >120 s on the test clone — the grouping is done in
        // PHP for that reason. Do not reintroduce one.
        static $cache = null;
        if (is_array($cache)) {
            return $cache;
        }

        $scoped = array_flip(self::tenantScopedTables());

        $rows = DB::select(
            'SELECT k.TABLE_NAME AS child_table,
                    k.COLUMN_NAME AS child_column,
                    k.CONSTRAINT_NAME AS constraint_name,
                    k.REFERENCED_TABLE_NAME AS parent_table,
                    k.REFERENCED_COLUMN_NAME AS parent_column
               FROM information_schema.KEY_COLUMN_USAGE k
               JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
                 ON rc.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
                AND rc.CONSTRAINT_NAME = k.CONSTRAINT_NAME
                AND rc.TABLE_NAME = k.TABLE_NAME
              WHERE k.TABLE_SCHEMA = DATABASE()
                AND k.REFERENCED_TABLE_NAME IS NOT NULL
                AND rc.DELETE_RULE = ?',
            ['CASCADE']
        );

        // Group by constraint so composite keys can be identified and skipped.
        $byConstraint = [];
        foreach ($rows as $row) {
            $byConstraint[$row->child_table . "\0" . $row->constraint_name][] = $row;
        }

        $targets = [];
        foreach ($byConstraint as $columns) {
            if (count($columns) !== 1) {
                continue;   // composite foreign key — see the note above
            }
            $row = $columns[0];
            $child = (string) $row->child_table;
            $parent = (string) $row->parent_table;

            if (isset($scoped[$child])) {
                continue;   // step 3 deletes it directly by tenant_id
            }
            if (!isset($scoped[$parent]) || $parent === 'users') {
                continue;   // not tenant-resolvable, or already handled in step 2
            }

            $targets[] = [
                'child_table'   => $child,
                'child_column'  => (string) $row->child_column,
                'parent_table'  => $parent,
                'parent_column' => (string) $row->parent_column,
            ];
        }

        $cache = $targets;

        return $targets;
    }

    /**
     * "Rows of this child whose foreign key points at a parent row owned by
     * THIS tenant." The tenant filter lives on the parent, which is what keeps
     * another community's rows out of the delete.
     *
     * @param  array{child_table: string, child_column: string, parent_table: string, parent_column: string}  $target
     */
    private static function orphanedChildQuery(array $target, int $tenantId): \Illuminate\Database\Query\Builder
    {
        return DB::table($target['child_table'])
            ->whereIn($target['child_column'], function ($query) use ($target, $tenantId): void {
                $query->select($target['parent_column'])
                    ->from($target['parent_table'])
                    ->where('tenant_id', $tenantId);
            });
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
        // F-354: stated on every run so the deletion claim stays honest. A table
        // with neither a tenant_id column nor a foreign key into tenant-scoped
        // data has nothing in the schema tying its rows to a community, so this
        // routine cannot find them.
        $out[] = 'Rows in tables that have neither a tenant_id column nor a foreign key into tenant-scoped data are NOT removed by this purge — nothing in the schema links them to a community. Review them by hand if the deletion has to be exhaustive.';
        return $out;
    }
}
