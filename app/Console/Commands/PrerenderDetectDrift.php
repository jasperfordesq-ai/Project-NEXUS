<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\PrerenderService;
use App\Services\SitemapService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Sitemap drift detector — the "the big names do this" layer.
 *
 * Walks every tenant's sitemap, compares each URL's <lastmod> against the
 * corresponding snapshot's mtime, and enqueues a HIGH-priority recache for
 * any URL whose source content has been updated more recently than its
 * snapshot was rendered.
 *
 * Why this exists alongside Eloquent observers:
 *   - Observers fire on Eloquent save/delete events. Raw DB inserts, queue
 *     jobs that use the query builder, migrations, and admin tools that
 *     bypass the model layer don't trigger them.
 *   - Without a drift detector, those code paths leave snapshots stale until
 *     the slow TTL sweep catches them — sometimes hours later. The drift
 *     detector runs every 2 minutes and closes that window.
 *
 * Designed to be cheap enough to run frequently:
 *   - One fresh sitemap build per tenant so raw DB/import writes cannot hide
 *     behind the public sitemap's one-hour response cache.
 *   - Walks the snapshot inventory once.
 *   - O(urls + snapshots) per pass, no DB writes for fresh routes.
 *
 * Cron entry (every 2 minutes):
 *   * /2 * * * *  cd /var/www/html && php artisan prerender:detect-drift
 */
class PrerenderDetectDrift extends Command
{
    protected $signature = 'prerender:detect-drift '
        . '{--max-tenants= : Cap tenants enqueued per pass} '
        . '{--max-routes= : Cap routes per tenant per pass} '
        . '{--min-drift-seconds=60 : Sitemap lastmod must lead snapshot mtime by at least this} '
        . '{--include-missing=1 : Also enqueue URLs in the sitemap with no snapshot at all} '
        . '{--purge-unexpected=1 : Remove snapshots no longer present in the exact tenant route plan} '
        . '{--priority=3 : Job priority (3=high, 5=normal, 7=low)} '
        . '{--dry-run : Print plan without enqueueing}';

    protected $description = 'Walk sitemaps, find snapshots stale vs their source content, enqueue HIGH-priority recache.';

    public function __construct(
        private readonly SitemapService $sitemap,
        private readonly PrerenderService $prerender,
    ) {
        parent::__construct();
    }

    public function handle(): int
    {
        $cfg = config('prerender.auto_recache', []);
        $maxTenants = max(0, (int) ($this->option('max-tenants') ?? 20));
        $maxRoutes  = max(0, (int) ($this->option('max-routes')  ?? 100));
        $minDrift   = max(0, (int) ($this->option('min-drift-seconds') ?? 60));
        $includeMissing = (int) $this->option('include-missing') === 1;
        $purgeUnexpected = (int) $this->option('purge-unexpected') === 1;
        $priority   = max(1, min(9, (int) ($this->option('priority') ?? PrerenderService::PRIORITY_HIGH)));
        $dryRun     = (bool) $this->option('dry-run');

        if (!Schema::hasTable('prerender_jobs')) {
            $this->error('prerender_jobs table is missing; run migrations before drift detection can enqueue work.');
            return self::FAILURE;
        }

        // Stand aside while an authoritative platform-wide rebuild is in
        // flight — per-tenant recaches piled on top of it fight the rebuild.
        //
        // The guard is right; being unbounded in time was not. A global job
        // that can never finish converts this pause into a permanent stop, and
        // reporting SUCCESS keeps stamping the scheduler-liveness key, so the
        // health endpoint sees a drift sweep running happily every two minutes
        // while it is in fact doing nothing at all. That is exactly what
        // happened between roughly 2026-08-11 and 2026-09-06: jobs 4993, 4996
        // and 5001 sat 'queued' back to back because the host processor could
        // not claim work, and 972 snapshots went 28 days stale unnoticed.
        //
        // So: routine success while the block is young, an explicit failure
        // once it outlives prerender.authoritative_block_alert_seconds.
        $block = PrerenderService::blockingGlobalJob();
        if ($block !== null) {
            // The human line goes first so the JSON report stays the last
            // thing on stdout and remains machine-readable as a whole.
            if ($block['stale']) {
                $this->error(sprintf(
                    'Global prerender job #%d has been %s for %ds (limit %ds). Drift detection has been suppressed platform-wide for that whole time and no snapshot is being refreshed.',
                    $block['job_id'],
                    $block['status'],
                    $block['age_seconds'],
                    $block['threshold_seconds']
                ));
            }
            $this->line(json_encode([
                'dry_run' => $dryRun,
                'priority' => $priority,
                'enqueued' => [],
                'skipped' => ['*' => $block['stale']
                    ? 'authoritative_global_job_stuck'
                    : 'authoritative_global_job_exists'],
                'authoritative_block' => $block,
                'planning_errors' => 0,
                'inventory_truncated' => false,
                'snapshot_count' => 0,
            ], JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));

            return $block['stale'] ? self::FAILURE : self::SUCCESS;
        }

        if ($this->prerender->authoritativeRepairRequired()) {
            try {
                $jobId = $dryRun ? null : $this->prerender->enqueueJob(
                    null,
                    null,
                    true,
                    false,
                    null,
                    PrerenderService::PRIORITY_HIGH
                );
            } catch (\Throwable $e) {
                $this->error('Could not requeue required authoritative repair: ' . $e->getMessage());
                return self::FAILURE;
            }
            $this->line(json_encode([
                'dry_run' => $dryRun,
                'priority' => PrerenderService::PRIORITY_HIGH,
                'authoritative_repair_required' => true,
                'authoritative_job_id' => $jobId,
                'enqueued' => [],
                'skipped' => [],
                'planning_errors' => 0,
                'inventory_truncated' => false,
                'snapshot_count' => 0,
            ], JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
            return self::SUCCESS;
        }

        // Build a host → tenant lookup and a (host,route) → snapshot mtime map.
        $tenants = $this->prerender->loadTenantTargets();
        if (empty($tenants)) {
            $this->info('No active tenants.');
            try {
                $orphanPurge = $purgeUnexpected
                    ? $this->prerender->purgeUnexpectedSnapshots($dryRun)
                    : null;
                $this->line(json_encode([
                    'dry_run' => $dryRun,
                    'priority' => $priority,
                    'enqueued' => [],
                    'skipped' => [],
                    'planning_errors' => 0,
                    'inventory_truncated' => false,
                    'snapshot_count' => 0,
                    'orphan_purge' => $orphanPurge,
                ], JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
                return self::SUCCESS;
            } catch (\Throwable $e) {
                $this->error('Orphan snapshot purge failed: ' . $e->getMessage());
                return self::FAILURE;
            }
        }
        $targetsByHost = [];
        foreach ($tenants as $t) {
            $targetsByHost[strtolower((string) $t['host'])][] = $t;
        }
        foreach ($targetsByHost as &$targets) {
            usort($targets, fn ($a, $b) => strlen($b['prefix']) <=> strlen($a['prefix']));
        }
        unset($targets);

        // SHALLOW inventory — we only need mtimes, not asset/content drift flags.
        $inventory = $this->prerender->inventory(null, false);
        $snapMtime = [];
        $identityBackfill = [];
        $inventoryTruncated = false;
        $orphanSnapshotCount = 0;
        foreach ($inventory as $row) {
            if (!empty($row['__truncated'])) {
                $inventoryTruncated = true;
                continue;
            }
            if (!empty($row['tenant_identity_mismatch'])) {
                $orphanSnapshotCount++;
                continue;
            }
            $snapshotHost = strtolower((string) $row['host']);
            [$slug, $tenantLocalRoute] = $this->resolveSnapshotTenantRoute(
                $snapshotHost,
                $row['route'],
                $targetsByHost[$snapshotHost] ?? []
            );
            if ($slug === null || $tenantLocalRoute === null) {
                $orphanSnapshotCount++;
                continue;
            }
            $snapMtime[$slug][$tenantLocalRoute] = (int) $row['mtime'];
            if (!empty($row['tenant_identity_missing'])) {
                // Legacy snapshots remain last-known-good until the first
                // complete identity-bearing generation commits. Backfill them
                // with forced targeted renders; never classify absence alone
                // as cross-tenant ownership before the activation marker.
                $identityBackfill[$slug][$tenantLocalRoute] = true;
            }
        }
        if ($inventoryTruncated) {
            $this->error('Snapshot inventory hit its safety limit; drift pass was incomplete.');
            return self::FAILURE;
        }

        // Active-job skip list to avoid pile-up.
        $activeTenants = DB::table('prerender_jobs as j')
            ->join('tenants as t', 't.id', '=', 'j.tenant_id')
            ->whereIn('j.status', ['queued', 'claimed', 'running'])
            ->pluck('t.slug')
            ->toArray();
        $activeSet = array_flip($activeTenants);

        $now = time();
        $enqueued = [];
        $skipped = [];
        $tenantCount = 0;
        $planningErrors = 0;

        foreach ($tenants as $t) {
            if ($tenantCount >= $maxTenants) {
                $skipped[$t['slug']] = 'tenant_cap';
                continue;
            }
            if (isset($activeSet[$t['slug']])) {
                $skipped[$t['slug']] = 'active_job_exists';
                continue;
            }

            $tenantId = $t['tenant_id'];
            $host = $t['host'];
            $prefix = $t['prefix'];

            // Deliberately bypass the public one-hour sitemap cache. Raw DB
            // writes are the reason this reconciler exists and do not bump the
            // cache version the way Eloquent/admin invalidators do.
            try {
                $baseUrl = 'https://' . $host . $prefix;
                $xml = $this->generateFreshSitemap($tenantId, $baseUrl);
                $entries = $this->parseSitemap($xml, 'https://' . $host, $prefix);
            } catch (\Throwable $e) {
                $skipped[$t['slug']] = 'sitemap_error: ' . substr($e->getMessage(), 0, 80);
                $planningErrors++;
                continue;
            }

            if (empty($entries)) {
                $skipped[$t['slug']] = 'sitemap_empty';
                $planningErrors++;
                continue;
            }

            $staleRoutes = [];
            $missingRoutes = [];
            $identityBackfillRoutes = [];
            foreach ($entries as $route => $lastmodTs) {
                $snap = $snapMtime[$t['slug']][$route] ?? null;
                if ($snap === null) {
                    if ($includeMissing) $missingRoutes[] = $route;
                    continue;
                }
                if ($lastmodTs > 0 && $lastmodTs > $snap + $minDrift) {
                    $staleRoutes[] = $route;
                }
                if (isset($identityBackfill[$t['slug']][$route])) {
                    $identityBackfillRoutes[] = $route;
                }
                if (count(array_unique(array_merge(
                    $staleRoutes,
                    $missingRoutes,
                    $identityBackfillRoutes
                ))) >= $maxRoutes) break;
            }

            $unexpectedRoutes = [];
            if ($purgeUnexpected) {
                $expectedRoutes = array_fill_keys(array_merge(
                    $this->prerender->routesForTenant((int) $tenantId),
                    array_keys($entries)
                ), true);
                $unexpectedRoutes = array_values(array_diff(
                    array_keys($snapMtime[$t['slug']] ?? []),
                    array_keys($expectedRoutes)
                ));
            }
            if (count($unexpectedRoutes) > $maxRoutes) {
                $unexpectedRoutes = array_slice($unexpectedRoutes, 0, $maxRoutes);
            }

            $allRoutes = array_values(array_unique(array_merge(
                $staleRoutes,
                $missingRoutes,
                $identityBackfillRoutes
            )));

            // A tenant's sitemap (SitemapService) and its prerender route plan
            // (PrerenderService::routesForTenant) are two separately maintained
            // lists, so they can drift apart. When they do, enqueueJob() rejects
            // the route with InvalidArgumentException — and that used to escape
            // this loop, abandoning the sweep for every tenant after this one.
            // The sweep runs every 2 minutes, so it failed, restarted and failed
            // again on the same route until someone noticed.
            //
            // Ask the plan first and keep going. The plan is the authority on
            // what can actually be rendered, so a route it rejects is never
            // handed to enqueueJob; a genuinely malformed route still reaches
            // enqueueJob and still throws. The divergence is a real contract
            // bug, so it is reported per tenant AND counted as a planning error
            // rather than being quietly dropped.
            $unavailableRoutes = [];
            if ($allRoutes !== []) {
                $renderableRoutes = [];
                foreach ($allRoutes as $route) {
                    // Pass the tenant target we already loaded: without it every
                    // call re-queries the whole tenants table.
                    if ($this->prerender->tenantRouteCanBePrerendered((int) $tenantId, $route, $t)) {
                        $renderableRoutes[] = $route;
                    } else {
                        $unavailableRoutes[] = $route;
                    }
                }
                if ($unavailableRoutes !== []) {
                    $allRoutes = $renderableRoutes;
                    // force_render is driven by the identity-backfill set; drop
                    // any of those that the plan rejected so a tenant whose only
                    // backfill route is unavailable does not force a rebuild.
                    $identityBackfillRoutes = array_values(
                        array_intersect($identityBackfillRoutes, $renderableRoutes)
                    );
                    $planningErrors += count($unavailableRoutes);
                }
            }

            if (empty($allRoutes) && empty($unexpectedRoutes)) {
                if ($unavailableRoutes !== []) {
                    $skipped[$t['slug']] = 'routes_not_in_tenant_plan: '
                        . implode(',', array_slice($unavailableRoutes, 0, 5));
                }
                continue;
            }

            // Cap routes per tenant so we don't generate a giant single job.
            if (count($allRoutes) > $maxRoutes) {
                $allRoutes = array_slice($allRoutes, 0, $maxRoutes);
            }

            $jobIds = [];
            $purgedCount = 0;
            if (!$dryRun) {
                foreach ($this->chunkRoutes($allRoutes) as $routesCsv) {
                    $jobIds[] = $this->prerender->enqueueJob(
                        $tenantId,
                        $routesCsv,
                        $identityBackfillRoutes !== [],
                        false,
                        null,
                        $priority
                    );
                }
                if ($unexpectedRoutes !== []) {
                    $purgedCount = $this->prerender->invalidateRoutes(
                        (int) $tenantId,
                        $unexpectedRoutes,
                        false
                    );
                    if ($purgedCount !== count($unexpectedRoutes)) {
                        $planningErrors++;
                    }
                }
            } else {
                $purgedCount = count($unexpectedRoutes);
            }
            $enqueued[$t['slug']] = [
                'job_id'        => $jobIds[0] ?? null,
                'job_ids'       => $jobIds,
                'stale_routes'  => count($staleRoutes),
                'missing_routes'=> count($missingRoutes),
                'identity_backfill_routes' => count($identityBackfillRoutes),
                'unexpected_routes' => count($unexpectedRoutes),
                'purged_routes' => $purgedCount,
                'unavailable_routes' => count($unavailableRoutes),
                'unavailable_sample' => array_slice($unavailableRoutes, 0, 5),
                'sample'        => array_slice($allRoutes, 0, 5),
            ];
            $tenantCount++;
        }

        $orphanPurge = null;
        if ($purgeUnexpected && $orphanSnapshotCount > 0) {
            try {
                // Re-inventory and re-attribute through the service's hardened
                // deletion path. This catches retired custom-domain and
                // inactive/deleted-tenant trees that cannot be assigned to an
                // active tenant in the per-tenant loop above.
                $orphanPurge = $this->prerender->purgeUnexpectedSnapshots($dryRun);
            } catch (\Throwable $e) {
                $planningErrors++;
                $orphanPurge = ['error' => substr($e->getMessage(), 0, 200)];
            }
        }

        $this->line(json_encode([
            'dry_run'   => $dryRun,
            'priority'  => $priority,
            'enqueued'  => $enqueued,
            'skipped'   => $skipped,
            'planning_errors' => $planningErrors,
            'inventory_truncated' => $inventoryTruncated,
            'snapshot_count' => count($inventory),
            'orphan_snapshot_count' => $orphanSnapshotCount,
            'orphan_purge' => $orphanPurge,
        ], JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
        return $planningErrors === 0 ? self::SUCCESS : self::FAILURE;
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

    private function generateFreshSitemap(int $tenantId, string $baseUrl): string
    {
        $key = 'prerender.runtime_force_fresh_sitemap';
        $previous = config($key, false);
        $bypassKey = 'prerender.runtime_bypass_sitemap_cache';
        $previousBypass = config($bypassKey, false);
        config([$key => true, $bypassKey => true]);
        try {
            return $this->sitemap->generateForTenant($tenantId, $baseUrl);
        } finally {
            config([$key => $previous, $bypassKey => $previousBypass]);
        }
    }

    /**
     * Parse a sitemap into [route => lastmodTs]. Routes are tenant-local
     * (stripped of host + tenant prefix) to align with the snapshot inventory.
     *
     * @return array<string,int>
     */
    private function parseSitemap(string $xml, string $base, string $prefix): array
    {
        $out = [];
        if (!preg_match_all('#<url>\s*(.*?)\s*</url>#is', $xml, $blocks)) return $out;
        $baseParts = parse_url($base);
        $expectedHost = is_array($baseParts)
            ? PrerenderService::normalizeHost((string) ($baseParts['host'] ?? ''))
            : null;
        if ($expectedHost === null) {
            throw new \RuntimeException('Drift sitemap base URL has an invalid host');
        }

        $rejected = [];
        foreach ($blocks[1] as $block) {
            if (!preg_match('#<loc>([^<]+)</loc>#i', $block, $lm)) {
                $rejected[] = 'URL entry has no location';
                continue;
            }
            $loc = trim(html_entity_decode($lm[1], ENT_XML1 | ENT_QUOTES, 'UTF-8'));
            $parts = parse_url($loc);
            $locationHost = is_array($parts)
                ? PrerenderService::normalizeHost((string) ($parts['host'] ?? ''))
                : null;
            if (!is_array($parts)
                || ($parts['scheme'] ?? '') !== 'https'
                || $locationHost !== $expectedHost
                || isset($parts['query'])
                || isset($parts['fragment'])) {
                $rejected[] = "Invalid or off-host location: {$loc}";
                continue;
            }

            $path = (string) ($parts['path'] ?? '');
            if ($prefix !== '' && str_starts_with($path, $prefix . '/')) {
                $path = substr($path, strlen($prefix));
            } elseif ($prefix !== '' && $path === $prefix) {
                $path = '/';
            } elseif ($prefix !== '') {
                $rejected[] = "Location is outside the tenant prefix: {$loc}";
                continue;
            }
            if ($path === '') $path = '/';
            $path = PrerenderService::normalizeRoute($path);
            if ($path === null) {
                $rejected[] = "Location has an unsafe route: {$loc}";
                continue;
            }

            $lastmod = 0;
            if (preg_match('#<lastmod>([^<]+)</lastmod>#i', $block, $lmm)) {
                $lastmod = (int) strtotime(trim($lmm[1]));
            }
            // Multiple URL entries may collide on the same route after prefix
            // stripping (shouldn't, but defensive). Keep the newest lastmod.
            $out[$path] = max($out[$path] ?? 0, $lastmod);
        }

        if ($rejected !== []) {
            throw new \RuntimeException(sprintf(
                'Drift sitemap rejected %d route location(s); first: %s',
                count($rejected),
                mb_strimwidth($rejected[0], 0, 240, '…', 'UTF-8')
            ));
        }
        return $out;
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
            $prefix = (string) $target['prefix'];
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
