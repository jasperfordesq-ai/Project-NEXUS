<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\PrerenderService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Continuous freshness loop. Walks the deep inventory, identifies snapshots
 * that are either content-stale (DB row newer than the snapshot) or TTL-stale
 * (older than config/prerender.php allows for their route), and enqueues
 * low-priority recache jobs grouped by tenant.
 *
 * Designed to run from cron every 15–30 minutes. The priority lane added in
 * Phase 1 keeps these jobs from starving urgent user-initiated runs.
 */
class PrerenderAutoRecache extends Command
{
    protected $signature = 'prerender:auto-recache '
        . '{--max-tenants= : Max tenants to enqueue this run} '
        . '{--max-routes= : Max routes per tenant per run} '
        . '{--min-stale-seconds= : Minimum staleness to consider} '
        . '{--include-ttl=1 : Also recache TTL-expired snapshots} '
        . '{--include-content=1 : Also recache content-stale snapshots} '
        . '{--dry-run : Print plan without enqueueing}';

    protected $description = 'Auto-enqueue prerender recache jobs for stale snapshots.';

    public function __construct(private readonly PrerenderService $service) {
        parent::__construct();
    }

    public function handle(): int
    {
        $cfg = config('prerender.auto_recache', []);
        $maxTenants = max(0, (int) ($this->option('max-tenants') ?? $cfg['max_tenants_per_run'] ?? 10));
        $maxRoutes  = max(0, (int) ($this->option('max-routes')  ?? $cfg['max_routes_per_tenant'] ?? 50));
        $minStale   = (int) ($this->option('min-stale-seconds') ?? $cfg['min_stale_seconds'] ?? 300);
        $includeTtl     = (int) $this->option('include-ttl') === 1;
        $includeContent = (int) $this->option('include-content') === 1;
        $dryRun = (bool) $this->option('dry-run');

        if (!Schema::hasTable('prerender_jobs')) {
            $this->error('prerender_jobs table is missing; run migrations before auto-recache can enqueue work.');
            return self::FAILURE;
        }

        // Walk the deep inventory (asset issues + content drift checks).
        $inventory = $this->service->inventory(null, true);
        if (empty($inventory)) {
            $this->info('Inventory empty; nothing to recache.');
            return self::SUCCESS;
        }

        // Resolve tenant slugs from snapshot host + route prefix. App-domain
        // tenants share a host, so host alone is not enough.
        $tenants = $this->service->loadTenantTargets();
        $targetsByHost = [];
        $targetsBySlug = [];
        foreach ($tenants as $t) {
            $targetsByHost[strtolower((string) $t['host'])][] = $t;
            $targetsBySlug[$t['slug']] = $t;
        }
        foreach ($targetsByHost as &$targets) {
            usort($targets, fn ($a, $b) => strlen($b['prefix']) <=> strlen($a['prefix']));
        }
        unset($targets);

        // Group stale routes by tenant slug.
        $byTenant = [];
        $reasons = [];
        $inventoryTruncated = false;
        foreach ($inventory as $row) {
            if (!empty($row['__truncated'])) {
                $inventoryTruncated = true;
                continue;
            }
            if ($row['age_s'] < $minStale) continue;
            $snapshotHost = strtolower((string) $row['host']);
            [$slug, $tenantLocalRoute] = $this->resolveSnapshotTenantRoute(
                $snapshotHost,
                $row['route'],
                $targetsByHost[$snapshotHost] ?? []
            );
            if ($slug === null || $tenantLocalRoute === null) continue; // Snapshot for a host we don't recognise.
            $tenantId = (int) ($targetsBySlug[$slug]['tenant_id'] ?? 0);
            if ($tenantId > 0 && !$this->service->tenantRouteCanBePrerendered($tenantId, $tenantLocalRoute, $targetsBySlug[$slug] ?? null)) {
                continue;
            }

            $stale = false;
            $why = null;
            if ($includeContent && !empty($row['content_stale'])) {
                $stale = true;
                $why = 'content';
            }
            if (!$stale && $includeTtl) {
                $ttl = $this->service->ttlForRoute($tenantLocalRoute);
                if ($row['age_s'] >= $ttl) {
                    $stale = true;
                    $why = 'ttl';
                }
            }
            if (!$stale) continue;

            $byTenant[$slug][] = $tenantLocalRoute;
            $reasons[$slug . ':' . $tenantLocalRoute] = $why;
        }

        if ($inventoryTruncated) {
            $this->error('Snapshot inventory hit its safety limit; freshness pass was incomplete.');
            return self::FAILURE;
        }

        if (empty($byTenant)) {
            $this->info('No stale snapshots above min-stale-seconds threshold.');
            return self::SUCCESS;
        }

        // Tenants with active jobs (queued/running) are skipped if configured.
        $skipActive = (bool) (config('prerender.auto_recache.skip_if_tenant_has_active_job', true));
        $activeTenants = [];
        if ($skipActive) {
            $activeTenants = DB::table('prerender_jobs as j')
                ->join('tenants as t', 't.id', '=', 'j.tenant_id')
                ->whereIn('j.status', ['queued', 'claimed', 'running'])
                ->pluck('t.slug')
                ->toArray();
        }
        $activeSet = array_flip($activeTenants);

        // 🔴 Skipping a busy tenant is correct; skipping one silently for ever
        // is not. A job that cannot be claimed removes its tenant from this
        // sweep AND from drift detection, so the tenant's snapshots freeze and
        // the only thing that would have unstuck them is the sweep it just
        // suppressed. Name the tenants that have been blocked past the
        // threshold and fail, so the freeze is visible from the first sweep
        // rather than from a crawler months later.
        $stuckBlocks = PrerenderService::stuckTenantBlocks();
        $stuckBySlug = [];
        foreach ($tenants as $t) {
            $blockedId = (int) ($t['tenant_id'] ?? 0);
            if ($blockedId > 0 && isset($stuckBlocks[$blockedId])) {
                $stuckBySlug[(string) $t['slug']] = $stuckBlocks[$blockedId];
            }
        }

        // Sort tenants by largest stale-route count first so the biggest
        // freshness wins land first when capped.
        uasort($byTenant, fn($a, $b) => count($b) <=> count($a));

        $enqueued = [];
        $skipped = [];
        $tenantCount = 0;
        foreach ($byTenant as $slug => $routes) {
            if ($tenantCount >= $maxTenants) {
                $skipped[$slug] = 'tenant_cap';
                continue;
            }
            if (isset($activeSet[$slug])) {
                $skipped[$slug] = isset($stuckBySlug[$slug])
                    ? 'active_job_stuck'
                    : 'active_job_exists';
                continue;
            }
            // Dedup + cap routes per tenant.
            $routes = array_values(array_unique($routes));
            if (count($routes) > $maxRoutes) $routes = array_slice($routes, 0, $maxRoutes);

            $tenantId = (int) DB::table('tenants')
                ->where('slug', $slug)->where('is_active', 1)->value('id');
            if ($tenantId === 0) {
                $skipped[$slug] = 'no_tenant_row';
                continue;
            }

            $jobIds = [];
            if (!$dryRun) {
                foreach ($this->chunkRoutes($routes) as $routesCsv) {
                    $jobIds[] = $this->service->enqueueJob(
                        $tenantId,
                        $routesCsv,
                        false,   // force (no — only stale routes get recached)
                        false,   // dry_run on the job itself
                        null,    // requested_by (system)
                        PrerenderService::PRIORITY_LOW
                    );
                }
            }
            $enqueued[$slug] = [
                'job_id' => $jobIds[0] ?? null,
                'job_ids' => $jobIds,
                'route_count' => count($routes),
                'sample_routes' => array_slice($routes, 0, 5),
            ];
            $tenantCount++;
        }

        // Report only the stuck tenants this sweep actually had work for —
        // a tenant with nothing stale is not being harmed by its blocked job.
        $reportableStuck = array_intersect_key($stuckBySlug, $skipped);

        // The human lines go first so the JSON report stays the last thing on
        // stdout and remains machine-readable as a whole.
        foreach ($reportableStuck as $slug => $block) {
            $this->error(sprintf(
                'Tenant %s has had prerender job #%d %s for %ds (limit %ds). Its snapshots have not been refreshed for that whole time and this sweep cannot reach them.',
                $slug,
                $block['job_id'],
                $block['status'],
                $block['age_seconds'],
                $block['threshold_seconds']
            ));
        }

        $this->line(json_encode([
            'dry_run'  => $dryRun,
            'enqueued' => $enqueued,
            'skipped'  => $skipped,
            'stuck_tenant_blocks' => $reportableStuck,
            'inventory_truncated' => $inventoryTruncated,
        ], JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
        return ($inventoryTruncated || $reportableStuck !== []) ? self::FAILURE : self::SUCCESS;
    }

    /** @param list<string> $routes @return list<string> */
    private function chunkRoutes(array $routes, int $maxBytes = 1900): array
    {
        $chunks = [];
        $current = [];
        $bytes = 0;
        foreach ($routes as $route) {
            $routeBytes = strlen($route);
            if ($routeBytes > $maxBytes) {
                throw new \RuntimeException("Prerender route exceeds {$maxBytes} bytes");
            }
            $added = $routeBytes + ($current === [] ? 0 : 1);
            if ($current !== [] && $bytes + $added > $maxBytes) {
                $chunks[] = implode(',', $current);
                $current = [];
                $bytes = 0;
                $added = $routeBytes;
            }
            $current[] = $route;
            $bytes += $added;
        }
        if ($current !== []) $chunks[] = implode(',', $current);
        return $chunks;
    }

    /**
     * @param list<array{slug:string,host:string,prefix:string}> $targets
     * @return array{0:?string,1:?string}
     */
    private function resolveSnapshotTenantRoute(string $host, string $route, array $targets): array
    {
        $host = strtolower($host);
        foreach ($targets as $target) {
            if (strtolower((string) ($target['host'] ?? '')) !== $host) continue;
            $prefix = (string) ($target['prefix'] ?? '');
            if ($prefix === '') {
                return [(string) $target['slug'], $route];
            }
            if ($route === $prefix) {
                return [(string) $target['slug'], '/'];
            }
            if (str_starts_with($route, $prefix . '/')) {
                return [(string) $target['slug'], substr($route, strlen($prefix)) ?: '/'];
            }
        }

        return [null, null];
    }
}
