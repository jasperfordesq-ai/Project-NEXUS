<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * PrerenderService — inspects the pre-render snapshot cache and the job queue.
 *
 * Read paths (filesystem):
 *   - The Playwright worker writes snapshots into the named volume
 *     `nexus-php-prerendered`, mounted read/write into this container at
 *     PRERENDER_CACHE_PATH (default /var/www/html/storage/prerendered).
 *     Layout: {host}/{route}/index.html, plus `.last-run.json`,
 *     `.last-manifest.json`, `.failures.tsv`.
 *
 *   - The deploy phase writes a JSONL event log to PRERENDER_EVENT_LOG
 *     (default /var/www/html/storage/logs/host-logs/prerender-events.jsonl).
 *
 *   - Frontend build manifest under PRERENDER_ASSETS_PATH lists the
 *     currently-valid /assets/*.js|css filenames; used to flag snapshots
 *     that reference dead assets.
 *
 * Write paths (database):
 *   - prerender_jobs — queue + history. Rows here are picked up by the
 *     PrerenderProcessQueue artisan command which runs prerender-tenants.sh
 *     with the captured flags and writes results back.
 *
 * Realtime:
 *   - State changes on prerender_jobs broadcast via RealtimeService on
 *     channel `private-admin-prerender`, event `job.updated`. UI subscribes
 *     to replace polling.
 *
 * Filesystem reads inspect the published cache. Controlled mutation paths
 * quarantine stale tenant-owned snapshots, rotate the publisher epoch, and
 * coordinate authoritative rebuilds under the shared mutation lock; rendered
 * HTML is produced and published by the host worker, not by this service.
 */
class PrerenderService
{
    /**
     * @deprecated Use routesForTenant($tenant) — it filters by feature/module
     * flags per tenant. This flat list renders every feature-gated route for
     * every tenant, generating 404s for tenants that don't have e.g. marketplace,
     * jobs, or events enabled. Retained only for legacy Coverage callers that
     * compare against a global expected set; new code should always go through
     * the tenant-aware resolver.
     */
    public const EXPECTED_ROUTES = [
        '/', '/about', '/faq', '/contact', '/help', '/blog',
        '/terms', '/privacy', '/accessibility', '/cookies',
        '/community-guidelines', '/trust-and-safety', '/account-deletion', '/child-safety', '/acceptable-use',
        '/legal', '/terms/versions', '/privacy/versions', '/accessibility/versions',
        '/cookies/versions', '/community-guidelines/versions', '/acceptable-use/versions',
        '/timebanking-guide', '/regional-analytics', '/platform/terms', '/platform/privacy',
        '/platform/disclaimer', '/features', '/changelog', '/coupons',
        '/pilot-inquiry', '/pilot-apply', '/developers', '/developers/auth',
        '/developers/endpoints', '/developers/webhooks',
    ];

    /**
     * Always-public routes that exist for every tenant regardless of feature
     * flags. These cover the platform skeleton (homepage, contact, legal,
     * pilot funnel, etc.) and never produce a 404 when prerendered.
     *
     * Routes NOT in this list and NOT covered by routesForTenant()'s feature
     * gates should not be prerendered — the React 404 page will respond and
     * the worker will capture a `_status=404` sidecar, which is a waste of
     * CPU and clutters the inventory.
     */
    private const ALWAYS_PUBLIC_ROUTES = [
        '/', '/about', '/faq', '/contact', '/help',
        '/terms', '/privacy', '/accessibility', '/cookies',
        '/community-guidelines', '/trust-and-safety', '/account-deletion', '/child-safety', '/acceptable-use',
        '/legal', '/terms/versions', '/privacy/versions', '/accessibility/versions',
        '/cookies/versions', '/community-guidelines/versions', '/acceptable-use/versions',
        '/timebanking-guide', '/regional-analytics',
        '/platform/terms', '/platform/privacy', '/platform/disclaimer',
        '/features', '/changelog', '/developers', '/developers/auth',
        '/developers/endpoints', '/developers/webhooks',
        '/pilot-inquiry', '/pilot-apply',
    ];

    /**
     * Public routes whose React components redirect for every other tenant.
     * Planning them globally makes final-URL validation reject the snapshot.
     */
    private const TENANT_SLUG_ROUTES = [
        'hour-timebank' => [
            '/partner', '/social-prescribing', '/impact-summary',
            '/impact-report', '/strategic-plan',
        ],
    ];

    /**
     * Feature-gated static routes — included only when the named feature is
     * enabled on the tenant. Mirrors SitemapService::getStaticPageUrls() gating
     * so static + sitemap stay consistent.
     *
     * Format: feature_name => [route, route, ...]
     */
    private const FEATURE_GATED_ROUTES = [
        'blog'             => ['/blog'],
        'merchant_coupons' => ['/coupons'],
    ];

    /**
     * Module-gated static routes (modules live in tenants.configuration.modules,
     * features in tenants.features — different storage, same idea).
     */
    private const MODULE_GATED_ROUTES = [];

    public const STALE_AGE_SECONDS = 14 * 24 * 3600;
    public const WARN_AGE_SECONDS  = 7  * 24 * 3600;
    public const MAX_PLANNED_ROUTES_PER_TENANT = 50000;

    public const REALTIME_CHANNEL = 'private-admin-prerender';
    public const REALTIME_EVENT   = 'job.updated';

    private string $cachePath;
    private string $eventLogPath;
    private string $assetsPath;
    private ?bool $jobFenceSchemaCompatibleCache = null;

    public function __construct()
    {
        $this->cachePath = rtrim((string) env(
            'PRERENDER_CACHE_PATH',
            '/var/www/html/storage/prerendered'
        ), '/');
        $this->eventLogPath = (string) env(
            'PRERENDER_EVENT_LOG',
            '/var/www/html/storage/logs/host-logs/prerender-events.jsonl'
        );
        // Path to the live frontend asset directory inside the React container.
        // We never read it directly (different container) — instead the deploy
        // writes the active asset manifest into the snapshot dir as
        // `.assets-manifest.json` for cross-container introspection.
        $this->assetsPath = (string) env(
            'PRERENDER_ASSETS_MANIFEST',
            $this->cachePath . '/.assets-manifest.json'
        );
    }

    public function cachePath(): string    { return $this->cachePath; }
    public function eventLogPath(): string { return $this->eventLogPath; }
    public function cacheReadable(): bool  { return is_dir($this->cachePath) && is_readable($this->cachePath); }
    public function cacheWritable(): bool  { return is_dir($this->cachePath) && is_writable($this->cachePath); }

    // -------------------------------------------------------------------------
    // Summary / health
    // -------------------------------------------------------------------------

    /**
     * High-level health snapshot for the overview dashboard.
     *
     * @return array
     */
    public function summary(): array
    {
        $tenants = $this->loadTenantTargets();
        // Deep inventory so content_stale_count and asset_invalid_count are
        // truthful. Cached briefly to keep the dashboard cheap.
        $inventory = Cache::remember(
            'prerender:summary:inventory',
            60,
            fn () => $this->inventory(null, true)
        );
        $inventoryTruncated = count(array_filter(
            $inventory,
            fn ($row) => !empty($row['__truncated'])
        )) > 0;
        $inventoryRows = array_values(array_filter(
            $inventory,
            fn ($row) => empty($row['__truncated'])
        ));
        $coverage = $this->coverageFor($tenants, $inventoryRows);
        $expected = array_sum(array_column($coverage, 'expected'));
        $expectedPresent = array_sum(array_column($coverage, 'rendered'));
        $planErrorCount = count(array_filter(
            $coverage,
            fn (array $row) => !empty($row['plan_error'])
        ));
        $present = count($inventoryRows);

        $oldest = null; $newest = null; $stale = 0; $warn = 0; $totalSize = 0;
        foreach ($inventoryRows as $row) {
            $age = $row['age_s'];
            $totalSize += $row['size_bytes'];
            if ($oldest === null || $age > $oldest) $oldest = $age;
            if ($newest === null || $age < $newest) $newest = $age;
            if ($age >= self::STALE_AGE_SECONDS) $stale++;
            elseif ($age >= self::WARN_AGE_SECONDS) $warn++;
        }

        $lastRun = $this->readJsonFile($this->cachePath . '/.last-run.json');
        $failures = $this->readFailures();
        $events = $this->tailEvents(1);
        $contentStale = $this->contentStalenessCounts($inventoryRows);

        // Tolerate the prerender_jobs table being absent — the migration may
        // not have run yet (e.g. fresh deploys). Treat as "no jobs" instead of
        // hard-500'ing the admin dashboard.
        $activeJobs = 0;
        $queuedJobs = 0;
        if (\Illuminate\Support\Facades\Schema::hasTable('prerender_jobs')) {
            $activeJobs = (int) DB::table('prerender_jobs')->whereIn('status', ['claimed', 'running'])->count();
            $queuedQuery = DB::table('prerender_jobs')->where('status', 'queued');
            if ($this->hasJobFenceColumn()) {
                $queuedQuery->orWhere('fence_state', self::FENCE_STATE_PENDING);
            }
            $queuedJobs = (int) $queuedQuery->count();
        }

        return [
            'cache_readable'        => $this->cacheReadable(),
            'cache_writable'        => $this->cacheWritable(),
            'cache_path'            => $this->cachePath,
            'inventory_truncated'   => $inventoryTruncated,
            'inventory_hard_cap'    => self::INVENTORY_HARD_CAP,
            'total_snapshots'       => $present,
            'total_size_bytes'      => $totalSize,
            'oldest_age_s'          => $oldest,
            'newest_age_s'          => $newest,
            'stale_count'           => $stale,
            'warn_count'            => $warn,
            'missing_count'         => max(0, $expected - $expectedPresent),
            'expected_count'        => $expected,
            'expected_rendered_count' => $expectedPresent,
            'plan_error_count'      => $planErrorCount,
            'unexpected_count'      => max(0, $present - $expectedPresent),
            'coverage_pct'          => $expected > 0
                ? round((min($expectedPresent, $expected) / $expected) * 100, 1)
                : 0.0,
            'last_run'              => $lastRun,
            'recent_failures'       => count($failures),
            'active_jobs'           => $activeJobs,
            'queued_jobs'           => $queuedJobs,
            'last_event_at'         => $events[0]['ts'] ?? null,
            'build_commit'          => $events[0]['commit'] ?? null,
            'expected_routes'       => self::EXPECTED_ROUTES,
            'tenant_count'          => count($tenants),
            'content_stale_count'   => $contentStale['content_stale'],
            'asset_invalid_count'   => $this->countAssetInvalid($inventoryRows),
            'realtime_channel'      => self::REALTIME_CHANNEL,
            'realtime_event'        => self::REALTIME_EVENT,
        ];
    }

    // -------------------------------------------------------------------------
    // Inventory
    // -------------------------------------------------------------------------

    /**
     * Walk the snapshot cache. Two modes:
     *   $deep=false: cheap — sizes, mtimes, age, age-staleness only
     *   $deep=true:  parses each file's asset refs and validates against the
     *                live asset manifest. Adds content-staleness check.
     */
    /**
     * Safety cap to prevent a misbehaving Playwright run that wrote thousands
     * of files into one directory from hanging the admin summary. When hit,
     * `inventory()` returns a `__truncated => true` sentinel row at the front
     * of the array; UI displays a banner.
     */
    public const INVENTORY_HARD_CAP = 50_000;

    public function inventory(
        ?string $tenantSlug = null,
        bool $deep = true,
        ?callable $bundleFingerprintSelector = null
    ): array
    {
        if (!$this->cacheReadable()) return [];
        $cacheLock = $this->acquireCacheLock(LOCK_SH);
        try {

        $tenantTargets = $this->loadTenantTargets();
        $targetsByHost = $this->tenantTargetsByHost($tenantTargets);
        $tenantIdentityEnforced = is_file($this->cachePath . '/.tenant-identity-v1');
        $tenantFilter = null;
        if ($tenantSlug !== null && $tenantSlug !== '') {
            $tenantFilter = $this->tenantTargetFromList($tenantTargets, $tenantSlug);
            if ($tenantFilter === null) return [];
        }

        $now = time();
        $validAssets = $deep ? $this->loadValidAssets() : [];
        $tenantUpdated = $deep ? $this->loadTenantUpdatedAt() : [];
        $contentUpdated = $deep ? $this->loadContentUpdatedAt() : [];

        $rows = [];
        $truncated = false;
        $directory = new \RecursiveDirectoryIterator(
                $this->cachePath,
                \FilesystemIterator::SKIP_DOTS
        );
        $visibleTrees = new \RecursiveCallbackFilterIterator(
            $directory,
            static fn (\SplFileInfo $entry): bool => !(
                $entry->isDir() && str_starts_with($entry->getFilename(), '.')
            )
        );
        $it = new \RecursiveIteratorIterator(
            $visibleTrees
        );

        foreach ($it as $file) {
            if (count($rows) >= self::INVENTORY_HARD_CAP) {
                $truncated = true;
                break;
            }
            if (!$file->isFile() || $file->getFilename() !== 'index.html') continue;
            $absPath = $file->getPathname();
            $rel = str_replace('\\', '/', ltrim(substr($absPath, strlen($this->cachePath)), '/\\'));

            $firstSlash = strpos($rel, '/');
            if ($firstSlash === false) continue;
            // DNS hostnames are case-insensitive. Cache publication always
            // canonicalises them to lowercase, so attribution must do the
            // same even when an older directory used mixed case.
            $host = strtolower(substr($rel, 0, $firstSlash));
            $remainder = substr($rel, $firstSlash);
            $route = preg_replace('#/index\.html$#', '', $remainder) ?: '/';

            [$tenantTarget, $tenantRoute] = $this->tenantAttributionForRoute($host, $route, $targetsByHost);

            if ($tenantFilter !== null) {
                if ($host !== $tenantFilter['host']) continue;
                if ((int) ($tenantTarget['tenant_id'] ?? 0) !== (int) $tenantFilter['tenant_id']) continue;
            }

            $mtime = $file->getMTime();
            $age = $now - $mtime;
            $ageStaleness = $age >= self::STALE_AGE_SECONDS ? 'stale'
                          : ($age >= self::WARN_AGE_SECONDS ? 'warn' : 'fresh');

            $assetRefs = [];
            $assetIssues = [];
            $contentStale = false;
            $contentStaleReason = null;

            if ($deep) {
                [$assetRefs, $assetIssues] = $this->parseAssetRefs($absPath, $validAssets);
                [$contentStale, $contentStaleReason] = $this->checkContentStaleness(
                    $tenantTarget['tenant_id'] ?? null,
                    $tenantRoute,
                    $mtime,
                    $tenantUpdated,
                    $contentUpdated
                );
            }

            // Combined staleness — content beats age beats fresh.
            $staleness = $ageStaleness;
            if (!empty($assetIssues)) $staleness = 'stale';
            if ($contentStale && $staleness === 'fresh') $staleness = 'warn';
            if ($contentStale && $staleness === 'warn') $staleness = 'stale';

            $statusCode = $this->readStatusSidecar(dirname($absPath));
            $snapshotIdentity = $this->readTenantIdentitySidecar(dirname($absPath));
            $identityMissing = $snapshotIdentity === null;
            $identityMismatch = ($identityMissing && $tenantIdentityEnforced)
                || (!$identityMissing && (
                    (int) ($snapshotIdentity['tenant_id'] ?? 0) !== (int) ($tenantTarget['tenant_id'] ?? 0)
                    || (string) ($snapshotIdentity['tenant_slug'] ?? '') !== (string) ($tenantTarget['slug'] ?? '')
                ));

            $row = [
                'host'             => $host,
                'route'            => $route,
                'tenant_id'        => $tenantTarget['tenant_id'] ?? null,
                'tenant_slug'      => $tenantTarget['slug'] ?? null,
                'tenant_route'     => $tenantRoute,
                'cache_path'       => $rel,
                'size_bytes'       => $file->getSize(),
                'mtime'            => $mtime,
                'age_s'            => $age,
                'staleness'        => $staleness,
                'age_staleness'    => $ageStaleness,
                'asset_refs'       => $assetRefs,
                'asset_issues'     => $assetIssues,
                'content_stale'    => $contentStale,
                'content_stale_reason' => $contentStaleReason,
                'http_status'      => $statusCode,
                'snapshot_tenant_id' => $snapshotIdentity['tenant_id'] ?? null,
                'snapshot_tenant_slug' => $snapshotIdentity['tenant_slug'] ?? null,
                'tenant_identity_missing' => $identityMissing,
                'tenant_identity_enforced' => $tenantIdentityEnforced,
                'tenant_identity_mismatch' => $identityMismatch,
            ];
            if ($bundleFingerprintSelector !== null && $bundleFingerprintSelector($row)) {
                $row['_bundle_fingerprint'] = $this->snapshotBundleFingerprint($absPath);
            }
            $rows[] = $row;
        }

        usort($rows, fn($a, $b) => $b['mtime'] <=> $a['mtime']);
        if ($truncated) {
            array_unshift($rows, [
                '__truncated' => true,
                'cap'         => self::INVENTORY_HARD_CAP,
                'host'        => '',
                'route'       => '',
                'cache_path'  => '',
            ]);
        }
        return $rows;
        } finally {
            flock($cacheLock, LOCK_UN);
            fclose($cacheLock);
        }
    }

    /**
     * Deep inspection of a single snapshot. Uses DOMDocument for structured
     * parsing — not regex — so JSON-LD validity, canonical correctness, and
     * meta-tag presence are reliable.
     */
    public function inspect(string $cachePath): ?array
    {
        if (!$this->cacheReadable()) return null;
        $safe = $this->safeCachePath($cachePath);
        if ($safe === null) return null;

        $abs = $this->resolveExistingCacheFile($this->cachePath . '/' . $safe);
        if ($abs === null || !is_readable($abs)) return null;

        $html = (string) file_get_contents($abs);
        $mtime = (int) filemtime($abs);
        $size  = (int) filesize($abs);

        $dom = new \DOMDocument();
        // Suppress libxml warnings — bot snapshots may have minor HTML quirks.
        $previous = libxml_use_internal_errors(true);
        $loaded = @$dom->loadHTML('<?xml encoding="UTF-8">' . $html, LIBXML_NOWARNING | LIBXML_NOERROR);
        $libxmlErrors = libxml_get_errors();
        libxml_clear_errors();
        libxml_use_internal_errors($previous);

        $xp = $loaded ? new \DOMXPath($dom) : null;

        $title = $loaded
            ? trim($this->firstNodeValue($xp, '//title') ?? '')
            : '';

        $metaDescription = $loaded
            ? $this->firstAttr($xp, "//meta[@name='description']", 'content')
            : null;

        $canonical = $loaded
            ? $this->firstAttr($xp, "//link[@rel='canonical']", 'href')
            : null;

        $ogTags = [];
        if ($loaded) {
            foreach ($xp->query("//meta[starts-with(@property,'og:')]") as $node) {
                /** @var \DOMElement $node */
                $ogTags[$node->getAttribute('property')] = $node->getAttribute('content');
            }
        }

        $jsonLdBlocks = [];
        $jsonLdValid = true;
        if ($loaded) {
            foreach ($xp->query("//script[@type='application/ld+json']") as $node) {
                $raw = trim($node->textContent ?? '');
                $parsed = json_decode($raw, true);
                $valid = is_array($parsed) || $raw === '';
                if (!$valid) $jsonLdValid = false;
                $jsonLdBlocks[] = [
                    'valid' => $valid,
                    'size'  => strlen($raw),
                    'types' => is_array($parsed) ? $this->extractSchemaTypes($parsed) : [],
                ];
            }
        }

        $h1Texts = [];
        if ($loaded) {
            foreach ($xp->query('//h1') as $node) {
                $h1Texts[] = trim($node->textContent ?? '');
            }
        }

        $assetRefs = [];
        if ($loaded) {
            foreach ($xp->query("//script[@src] | //link[@rel='stylesheet']") as $node) {
                /** @var \DOMElement $node */
                $src = $node->getAttribute('src') ?: $node->getAttribute('href');
                if ($src && str_starts_with($src, '/assets/')) $assetRefs[] = $src;
            }
        }
        $validAssets = $this->loadValidAssets();
        $assetIssues = [];
        if (!empty($validAssets)) {
            foreach ($assetRefs as $ref) {
                $bare = explode('?', explode('#', $ref)[0])[0];
                if (!isset($validAssets[$bare])) $assetIssues[] = $bare;
            }
        }

        // Strip script bodies for the preview.
        $preview = substr(
            preg_replace('#<script\b[^>]*>.*?</script>#is', '<script>…</script>', $html) ?? $html,
            0, 16384
        );

        $hasNoscript = (bool) ($xp && $xp->query('//noscript')->length > 0);

        $statusCode = $this->readStatusSidecar(dirname($abs));
        $integrity = $this->verifyIntegrity($abs, $html);

        $result = [
            'cache_path'  => $safe,
            'size_bytes'  => $size,
            'mtime'       => $mtime,
            'age_s'       => time() - $mtime,
            'http_status' => $statusCode,
            'integrity'   => $integrity,
            'title'       => $title,
            'meta_description' => $metaDescription,
            'canonical'   => $canonical,
            'og_tags'     => $ogTags,
            'h1_texts'    => $h1Texts,
            'json_ld'     => [
                'blocks_count' => count($jsonLdBlocks),
                'all_valid'    => $jsonLdValid,
                'blocks'       => $jsonLdBlocks,
            ],
            'asset_refs'   => array_values(array_unique($assetRefs)),
            'asset_issues' => array_values(array_unique($assetIssues)),
            'flags' => [
                'parses'         => $loaded !== false,
                'has_h1'         => count($h1Texts) > 0,
                'multiple_h1'    => count($h1Texts) > 1,
                'has_meta_desc'  => $metaDescription !== null && $metaDescription !== '',
                'has_og'         => !empty($ogTags),
                'has_canonical'  => $canonical !== null && $canonical !== '',
                'has_jsonld'     => count($jsonLdBlocks) > 0,
                'jsonld_valid'   => $jsonLdValid,
                'has_noscript'   => $hasNoscript,
            ],
            'parse_warnings' => array_map(
                fn($e) => trim($e->message),
                array_slice($libxmlErrors, 0, 5)
            ),
            'preview' => $preview,
        ];
        $result['seo'] = $this->seoScore($result);
        return $result;
    }

    // -------------------------------------------------------------------------
    // Coverage
    // -------------------------------------------------------------------------

    public function coverage(): array
    {
        $tenants = $this->loadTenantTargets();
        if (empty($tenants)) return [];
        return $this->coverageFor($tenants, $this->inventory(null, true));
    }

    /**
     * @param list<array<string,mixed>> $tenants
     * @param list<array<string,mixed>> $inventory
     * @return list<array<string,mixed>>
     */
    private function coverageFor(array $tenants, array $inventory): array
    {

        $byHost = [];
        foreach ($inventory as $row) {
            if (!empty($row['__truncated'])) continue;
            $byHost[$row['host']][$row['route']] = $row;
        }

        $rows = [];
        foreach ($tenants as $t) {
            $host = $t['host'];
            $prefix = $t['prefix'];
            // Resolve THIS tenant's expected static route set — features they
            // don't have aren't expected to be rendered.
            $planError = null;
            try {
                $tenantRoutes = $this->expectedRoutesForTenant(
                    $t,
                    self::MAX_PLANNED_ROUTES_PER_TENANT,
                    true
                );
            } catch (\Throwable $e) {
                $planError = substr($e->getMessage(), 0, 500);
                Log::warning('Prerender coverage route plan failed', [
                    'tenant_id' => $t['tenant_id'] ?? null,
                    'tenant_slug' => $t['slug'] ?? null,
                    'error' => $planError,
                ]);
                $tenantRoutes = $this->routesForTenant((object) $t);
            }

            $rendered = 0; $missing = []; $stale = []; $invalidAssets = [];
            foreach ($tenantRoutes as $route) {
                $expectedRoute = $route === '/' && $prefix !== '' ? $prefix : $prefix . $route;
                $found = $byHost[$host][$expectedRoute] ?? null;
                if ($found === null) { $missing[] = $route; continue; }
                $rendered++;
                if ($found['staleness'] !== 'fresh') $stale[] = $route;
                if (!empty($found['asset_issues'])) $invalidAssets[] = $route;
            }
            $rows[] = [
                'tenant_id'      => $t['tenant_id'],
                'slug'           => $t['slug'],
                'host'           => $host,
                'expected'       => count($tenantRoutes),
                'rendered'       => $rendered,
                'missing'        => count($missing),
                'missing_routes' => $missing,
                'stale_routes'   => $stale,
                'asset_invalid_routes' => $invalidAssets,
                'plan_error'     => $planError,
            ];
        }
        usort($rows, fn($a, $b) => strcmp($a['slug'], $b['slug']));
        return $rows;
    }

    /**
     * Human-readable tenant safety report for the admin inspector.
     *
     * @param list<string> $sitemapRoutes tenant-local dynamic/static routes from prerender:plan-routes
     */
    public function tenantSafetyReport(string $tenantSlug, array $sitemapRoutes = []): ?array
    {
        $targets = $this->loadTenantTargets();
        $target = $this->tenantTargetFromList($targets, $tenantSlug);
        if ($target === null) return null;

        $tenantObj = (object) [
            'features' => $target['features'] ?? null,
            'configuration' => $target['configuration'] ?? null,
        ];
        $staticRoutes = $this->routesForTenant($tenantObj);
        $expectedRoutes = array_values(array_unique(array_merge(
            $staticRoutes,
            array_values(array_filter($sitemapRoutes, fn ($route) => is_string($route) && $route !== '' && $route[0] === '/'))
        )));
        sort($expectedRoutes);

        $staticLookup = array_fill_keys($staticRoutes, true);
        $expectedLookup = array_fill_keys($expectedRoutes, true);
        $inventory = array_values(array_filter(
            $this->inventory($tenantSlug, true),
            fn ($row) => empty($row['__truncated'])
        ));
        $snapshotsByRoute = [];
        foreach ($inventory as $row) {
            $snapshotsByRoute[(string) ($row['tenant_route'] ?? $row['route'] ?? '')] = $row;
        }

        $missing = [];
        $stale = [];
        $assetInvalid = [];
        foreach ($expectedRoutes as $route) {
            $row = $snapshotsByRoute[$route] ?? null;
            if ($row === null) {
                $missing[] = $route;
                continue;
            }
            if (($row['staleness'] ?? 'fresh') !== 'fresh') $stale[] = $route;
            if (!empty($row['asset_issues'])) $assetInvalid[] = $route;
        }

        $unexpected = [];
        $explanations = [];
        foreach ($inventory as $row) {
            $route = (string) ($row['tenant_route'] ?? $row['route'] ?? '');
            $expected = isset($expectedLookup[$route]);
            if (!$expected) $unexpected[] = $route;
            $source = isset($staticLookup[$route])
                ? 'static'
                : ($expected ? 'sitemap' : 'unexpected');
            $explanations[] = [
                'route' => $route,
                'cache_path' => $row['cache_path'] ?? '',
                'host_route' => $row['route'] ?? $route,
                'source' => $source,
                'expected' => $expected,
                'reason' => $this->routeEligibilityReason($route, $tenantObj, $source),
                'staleness' => $row['staleness'] ?? 'fresh',
                'http_status' => $row['http_status'] ?? 200,
                'content_stale' => (bool) ($row['content_stale'] ?? false),
                'asset_issues' => $row['asset_issues'] ?? [],
            ];
        }
        usort($explanations, fn ($a, $b) => strcmp((string) $a['route'], (string) $b['route']));

        return [
            'tenant' => [
                'tenant_id' => $target['tenant_id'],
                'slug' => $target['slug'],
                'host' => $target['host'],
                'prefix' => $target['prefix'],
            ],
            'counts' => [
                'expected' => count($expectedRoutes),
                'static' => count($staticRoutes),
                'sitemap' => max(0, count($expectedRoutes) - count($staticRoutes)),
                'snapshots' => count($inventory),
                'missing' => count($missing),
                'stale' => count($stale),
                'asset_invalid' => count($assetInvalid),
                'unexpected' => count($unexpected),
            ],
            'static_routes' => $staticRoutes,
            'sitemap_routes' => array_values(array_diff($expectedRoutes, $staticRoutes)),
            'expected_routes' => $expectedRoutes,
            'missing_routes' => $missing,
            'stale_routes' => $stale,
            'asset_invalid_routes' => $assetInvalid,
            'unexpected_routes' => array_values(array_unique($unexpected)),
            'snapshots' => $explanations,
        ];
    }

    // -------------------------------------------------------------------------
    // Events / failures
    // -------------------------------------------------------------------------

    public function tailEvents(int $limit = 200): array
    {
        if (!is_readable($this->eventLogPath)) return [];
        $limit = max(1, min(2000, $limit));
        $lines = @file($this->eventLogPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if (!$lines) return [];
        $tail = array_slice($lines, -$limit);
        $out = [];
        foreach (array_reverse($tail) as $line) {
            $row = json_decode($line, true);
            if (is_array($row)) $out[] = $row;
        }
        return $out;
    }

    public function readFailures(): array
    {
        $path = $this->cachePath . '/.failures.tsv';
        if (!is_readable($path)) return [];
        $now = time();
        $out = [];
        $fh = @fopen($path, 'r');
        if (!$fh) return [];
        while (($line = fgets($fh)) !== false) {
            $line = trim($line);
            if ($line === '') continue;
            $parts = explode("\t", $line);
            if (count($parts) < 2) continue;
            $out[] = [
                'cache_path' => $parts[1],
                'failed_at'  => (int) $parts[0],
                'age_s'      => $now - (int) $parts[0],
            ];
        }
        fclose($fh);
        usort($out, fn($a, $b) => $b['failed_at'] <=> $a['failed_at']);
        return $out;
    }

    // -------------------------------------------------------------------------
    // Crawler analytics (Phase 3.2)
    // -------------------------------------------------------------------------

    /**
     * Aggregate the bot-only JSONL access log written by nginx
     * (see nginx.bluegreen.conf — log_format prerender_bot_jsonl).
     *
     * Returns:
     *   total_hits, hits_by_status, hits_by_crawler, hits_by_host, top_uris,
     *   recent (last 100 rows).
     *
     * The log is line-bounded to the last MAX_BYTES from the tail to keep
     * memory predictable; rotation is the caller's responsibility (logrotate
     * or a cron tail-and-truncate).
     */
    public function crawlerAnalytics(?string $sinceIso = null, int $limit = 200): array
    {
        $logPath = $this->cachePath . '/.bot-access.jsonl';
        $empty = [
            'total_hits'      => 0,
            'verified_hits'   => 0,
            'spoofed_by_crawler' => [],
            'window_started_at' => $sinceIso,
            'hits_by_status'  => [],
            'hits_by_crawler' => [],
            'hits_by_host'    => [],
            'top_uris'        => [],
            'recent'          => [],
            'log_path'        => $logPath,
            'log_size_bytes'  => is_file($logPath) ? @filesize($logPath) : 0,
        ];
        if (!is_readable($logPath)) return $empty;

        $sinceTs = $sinceIso ? @strtotime($sinceIso) : (time() - 7 * 24 * 3600);
        if (!$sinceTs) $sinceTs = time() - 7 * 24 * 3600;

        // Tail up to 8 MB of log — typical bot traffic is well under that for
        // a week; if higher, increase or move to a rotated archive.
        $maxBytes = 8 * 1024 * 1024;
        $size = (int) @filesize($logPath);
        $offset = $size > $maxBytes ? $size - $maxBytes : 0;

        $byStatus = [];
        $byCrawler = [];
        $byHost = [];
        $uriCounts = [];
        $recent = [];
        $total = 0;
        $verifiedCount = 0;
        $spoofedByCrawler = [];

        $fh = @fopen($logPath, 'r');
        if (!$fh) return $empty;
        if ($offset > 0) @fseek($fh, $offset);
        // Discard the (likely partial) first line after a seek.
        if ($offset > 0) fgets($fh);

        while (($line = fgets($fh)) !== false) {
            $line = trim($line);
            if ($line === '') continue;
            $row = json_decode($line, true);
            if (!is_array($row)) continue;
            $ts = isset($row['ts']) ? (int) strtotime((string) $row['ts']) : 0;
            if ($ts < $sinceTs) continue;

            $total++;
            $status = (int) ($row['status'] ?? 0);
            $crawler = (string) ($row['crawler'] ?? 'other');
            $host = (string) ($row['host'] ?? '');
            $uri = (string) ($row['uri'] ?? '');

            $byStatus[$status] = ($byStatus[$status] ?? 0) + 1;
            $byCrawler[$crawler] = ($byCrawler[$crawler] ?? 0) + 1;
            if ($host !== '') $byHost[$host] = ($byHost[$host] ?? 0) + 1;
            $verified = (string) ($row['verified'] ?? '');
            if ($verified === '1') {
                $verifiedCount++;
            } else {
                // Only crawlers that SHOULD verify (i.e. major search engines).
                // Social unfurlers don't publish IP ranges so we don't expect
                // them to be in the trusted list.
                if (in_array($crawler, ['googlebot', 'bingbot', 'duckduckbot', 'applebot', 'google-extended'], true)) {
                    $spoofedByCrawler[$crawler] = ($spoofedByCrawler[$crawler] ?? 0) + 1;
                }
            }
            if ($uri !== '') {
                $key = $host . $uri;
                $uriCounts[$key] = ($uriCounts[$key] ?? 0) + 1;
            }

            if (count($recent) < $limit) {
                $recent[] = [
                    'ts'      => $row['ts'] ?? null,
                    'host'    => $host,
                    'uri'     => $uri,
                    'status'  => $status,
                    'crawler' => $crawler,
                    'ua'      => $row['ua'] ?? '',
                    'ip'      => $row['ip'] ?? '',
                ];
            }
        }
        fclose($fh);

        arsort($byStatus);
        arsort($byCrawler);
        arsort($byHost);
        arsort($uriCounts);

        // Keep recent in newest-first order.
        $recent = array_reverse($recent);

        $topUris = [];
        $i = 0;
        foreach ($uriCounts as $k => $n) {
            $topUris[] = ['url' => $k, 'hits' => $n];
            if (++$i >= 50) break;
        }

        return [
            'total_hits'      => $total,
            'verified_hits'   => $verifiedCount,
            'spoofed_by_crawler' => $spoofedByCrawler,
            'window_started_at' => date('c', $sinceTs),
            'hits_by_status'  => $byStatus,
            'hits_by_crawler' => $byCrawler,
            'hits_by_host'    => $byHost,
            'top_uris'        => $topUris,
            'recent'          => $recent,
            'log_path'        => $logPath,
            'log_size_bytes'  => $size,
        ];
    }

    // -------------------------------------------------------------------------
    // Content-change invalidation (Phase 2.3)
    // -------------------------------------------------------------------------

    /**
     * Invalidate (delete + enqueue recache) the snapshot for a specific route
     * across all tenants the route belongs to. Safe to call from model
     * observers in response to save/delete events.
     *
     * @param int $tenantId         The tenant whose snapshot should be touched.
     * @param array<int,string> $routes  Route paths to invalidate, e.g. ['/blog/foo', '/blog'].
     * @param bool $enqueueRecache  If true, also enqueue a low-priority recache job.
     */
    public function invalidateRoutes(int $tenantId, array $routes, bool $enqueueRecache = true): int
    {
        $target = $this->tenantTargetById($tenantId);
        if (!$target) return 0;
        $host = $target['host'];
        $prefix = $target['prefix'];

        $normalisedRoutes = [];
        foreach ($routes as $route) {
            if (!is_string($route)) continue;
            $normalised = self::normalizeRoute($route);
            if ($normalised !== null) $normalisedRoutes[] = $normalised;
        }
        $routes = array_values(array_unique($normalisedRoutes));
        if (empty($routes)) return 0;

        $recacheRoutes = array_values(array_filter(
            $routes,
            fn (string $route) => $this->tenantRouteCanBePrerendered($tenantId, $route, $target)
        ));

        // Serialize durable replacement intent and deletion with publication.
        // A fast worker may render immediately after enqueue, but it cannot
        // publish until this critical section has removed the old snapshot.
        return $this->withCacheMutationLock(function () use (
            $enqueueRecache,
            $recacheRoutes,
            $tenantId,
            $routes,
            $host,
            $prefix
        ): int {

        $statusBearingSnapshot = false;
        foreach ($routes as $route) {
            $outRoute = $route === '/' && $prefix !== '' ? $prefix : $prefix . $route;
            $rel = $outRoute === '/' ? $host . '/index.html' : $host . $outRoute . '/index.html';
            if ($this->hasCompiledStatusSidecar(dirname($this->cachePath . '/' . $rel))) {
                $statusBearingSnapshot = true;
                break;
            }
        }

        if ($statusBearingSnapshot) {
            // Nginx compiles status sidecars into a map that changes only on
            // reload. Targeted deletion/replacement would split HTML from its
            // HTTP status, so leave the live generation intact and schedule a
            // complete authoritative build instead.
            if ($enqueueRecache) {
                $this->enqueueJob(
                    null,
                    null,
                    true,
                    false,
                    null,
                    self::PRIORITY_HIGH
                );
            }
            return 0;
        }

        if ($enqueueRecache && $recacheRoutes !== []) {
            // Backpressure: bulk imports (e.g. seeding 5,000 blog posts) would
            // otherwise enqueue 5,000 distinct queued rows (each with a unique
            // per-post route, so the dedup key differs and they don't coalesce).
            // If we've fired more than the burst threshold for this tenant in
            // the last minute, drop the per-route precision and enqueue a
            // single tenant-wide row instead — the dedup probe in enqueueJob
            // then collapses subsequent bursts onto that one row.
            $burstKey   = "prerender:burst:tenant:{$tenantId}";
            $burstCount = (int) \Illuminate\Support\Facades\Cache::increment($burstKey);
            if ($burstCount === 1) {
                \Illuminate\Support\Facades\Cache::put($burstKey, 1, 60);
            }
            $routeChunks = $burstCount > 50
                ? [null]
                : $this->chunkRoutesForJobs($recacheRoutes);

            // NORMAL priority: a content save is a user-initiated event with a
            // human waiting for the public page to update. Background sweeps
            // run at LOW; observer-triggered work belongs ahead of them.
            foreach ($routeChunks as $routesArg) {
                $this->enqueueJob(
                    $tenantId,
                    $routesArg,
                    false,
                    false,
                    null,
                    self::PRIORITY_NORMAL
                );
            }
        }

        // Only remove the live snapshot after durable replacement intent has
        // been written. If enqueueing fails, the known-good (albeit stale)
        // page remains available instead of becoming a cache miss forever.
            $count = 0;
            foreach ($routes as $route) {
                $outRoute = $route === '/' && $prefix !== '' ? $prefix : $prefix . $route;
                $rel = $outRoute === '/' ? $host . '/index.html' : $host . $outRoute . '/index.html';
                $abs = $this->cachePath . '/' . $rel;
                if ($this->deleteSnapshotBundle($abs)) $count++;
            }
            return $count;
        });
    }

    /**
     * @param list<string> $routes
     * @return list<string>
     */
    private function chunkRoutesForJobs(array $routes, int $maxBytes = 1900): array
    {
        $chunks = [];
        $current = [];
        $bytes = 0;
        foreach ($routes as $route) {
            $routeBytes = strlen($route) + ($current === [] ? 0 : 1);
            if ($routeBytes > $maxBytes) {
                throw new \InvalidArgumentException("Prerender route exceeds the {$maxBytes}-byte chunk limit");
            }
            if ($current !== [] && $bytes + $routeBytes > $maxBytes) {
                $chunks[] = implode(',', $current);
                $current = [];
                $bytes = 0;
                $routeBytes = strlen($route);
            }
            $current[] = $route;
            $bytes += $routeBytes;
        }
        if ($current !== []) $chunks[] = implode(',', $current);
        return $chunks;
    }

    // -------------------------------------------------------------------------
    // Cache purge (wildcard)
    // -------------------------------------------------------------------------

    /**
     * Delete snapshot files whose route matches a glob pattern.
     *
     * Pattern uses fnmatch semantics:
     *   /blog/*           — every direct child of /blog
     *   /blog/**          — every descendant of /blog
     *   /listings/*       — direct children only (no nested)
     *   /                 — homepage only
     *
     * Optional $tenantSlug scopes the purge to one tenant. For shared-host
     * tenants, matching uses the tenant-local route after stripping the slug
     * prefix; a tenant purge of /blog/* therefore cannot touch a sibling's
     * /other-tenant/blog/* snapshot.
     *
     * Returns the list of cache_paths deleted. The caller is responsible for
     * enqueueing recache jobs if it wants the routes re-rendered.
     *
     * @return array{deleted:list<string>, dry_run:bool, pattern:string, tenant_slug:?string}
     */
    public function purgePattern(string $pattern, ?string $tenantSlug = null, bool $dryRun = false): array
    {
        $pattern = trim($pattern);
        if ($pattern === '' || $pattern[0] !== '/') {
            return ['deleted' => [], 'dry_run' => $dryRun, 'pattern' => $pattern, 'tenant_slug' => $tenantSlug];
        }

        $tenantTarget = null;
        if ($tenantSlug !== null && $tenantSlug !== '') {
            $tenantTarget = $this->tenantTargetBySlug($tenantSlug);
            if ($tenantTarget === null) {
                return ['deleted' => [], 'dry_run' => $dryRun, 'pattern' => $pattern, 'tenant_slug' => $tenantSlug];
            }
        }

        $allowDoubleStar = str_contains($pattern, '**');
        $globRegex = $this->globToRegex($pattern, $allowDoubleStar);
        $deleted = [];

        $inventory = $this->inventory($tenantSlug, false);
        if (count(array_filter($inventory, fn ($row) => !empty($row['__truncated']))) > 0) {
            throw new \RuntimeException('Snapshot inventory reached its safety cap; narrow the tenant scope before purging');
        }

        $deleteRows = function () use ($inventory, $tenantTarget, $globRegex, $dryRun, &$deleted): void {
            foreach ($inventory as $row) {
                if (!empty($row['__truncated'])) continue;
                if ($tenantTarget !== null
                    && (int) ($row['tenant_id'] ?? 0) !== (int) $tenantTarget['tenant_id']) continue;

                // Match tenant-local routes for both scoped and all-tenant purges.
                $matchRoute = (string) ($row['tenant_route'] ?? $row['route'] ?? '');
                if (!preg_match($globRegex, $matchRoute)) continue;

                $abs = $this->cachePath . '/' . $row['cache_path'];
                if (!$dryRun && is_file($abs) && !$this->deleteSnapshotBundle($abs)) continue;
                $deleted[] = $row['cache_path'];
            }
        };
        if ($dryRun) {
            $deleteRows();
        } else {
            $this->withCacheMutationLock($deleteRows);
        }

        return [
            'deleted'  => $deleted,
            'dry_run'  => $dryRun,
            'pattern'  => $pattern,
            'tenant_slug' => $tenantSlug,
        ];
    }

    private function deleteSnapshotBundle(string $indexPath): bool
    {
        // Resolve the existing file before deletion. This is an independent
        // containment boundary: route validation protects callers, while
        // realpath also defeats symlink escapes and future call sites that
        // accidentally concatenate an unsafe relative path.
        $indexPath = $this->resolveExistingCacheFile($indexPath);
        if ($indexPath === null || basename($indexPath) !== 'index.html') {
            return false;
        }

        $dir = dirname($indexPath);
        if ($this->hasCompiledStatusSidecar($dir)) {
            // `_status` is compiled into nginx's shared status map. Only the
            // authoritative publisher can change HTML + map + nginx reload as
            // one rollback-capable operation.
            return false;
        }
        $deleted = @unlink($indexPath);
        @unlink($dir . '/index.html.sha256');
        @unlink($dir . '/index.md');
        @unlink($dir . '/_status');
        @unlink($dir . '/_tenant.json');
        @rmdir($dir);

        if ($deleted) {
            Cache::forget('prerender:summary:inventory');
        }

        return $deleted && !is_file($indexPath);
    }

    /**
     * Remove the bytes for a status-bearing snapshot while deliberately
     * retaining `_status` for the authoritative publisher to replace with the
     * compiled nginx map. Any failed unlink is fatal: reporting a quarantine
     * that left cross-tenant HTML live would be worse than failing the action.
     */
    private function quarantineStatusSnapshotHtml(string $indexPath): bool
    {
        $indexPath = $this->resolveExistingCacheFile($indexPath);
        if ($indexPath === null || basename($indexPath) !== 'index.html') {
            return false;
        }

        $dir = dirname($indexPath);
        if (!$this->hasCompiledStatusSidecar($dir)) {
            return false;
        }

        $this->markAuthoritativeRepairRequired('status_snapshot_quarantined');

        foreach ([$indexPath, $dir . '/index.html.sha256', $dir . '/index.md', $dir . '/_tenant.json'] as $path) {
            if ((file_exists($path) || is_link($path)) && !@unlink($path)) {
                throw new \RuntimeException("Unable to quarantine prerender snapshot file: {$path}");
            }
        }
        if (is_file($indexPath)) {
            throw new \RuntimeException("Prerender snapshot remained after quarantine: {$indexPath}");
        }

        Cache::forget('prerender:summary:inventory');
        return true;
    }

    private function markAuthoritativeRepairRequired(string $reason): void
    {
        $path = $this->cachePath . '/.authoritative-repair-required';
        $temp = $path . '.tmp.' . bin2hex(random_bytes(8));
        $payload = json_encode([
            'version' => 1,
            'reason' => $reason,
            'marked_at' => gmdate(DATE_ATOM),
        ], JSON_UNESCAPED_SLASHES) . "\n";
        if (@file_put_contents($temp, $payload, LOCK_EX) === false
            || !@chmod($temp, 0664)
            || !@rename($temp, $path)) {
            @unlink($temp);
            throw new \RuntimeException('Could not persist authoritative prerender repair requirement');
        }
    }

    public function authoritativeRepairRequired(): bool
    {
        return is_file($this->cachePath . '/.authoritative-repair-required');
    }

    /**
     * Fingerprint the complete publishable bundle, not HTML alone. Ownership
     * and status sidecars are part of the snapshot's meaning; a destructive
     * preview must be invalidated if any of them changes before execution.
     */
    private function snapshotBundleFingerprint(string $indexPath): ?string
    {
        $indexPath = $this->resolveExistingCacheFile($indexPath);
        if ($indexPath === null || basename($indexPath) !== 'index.html') {
            return null;
        }

        $dir = dirname($indexPath);
        $parts = [];
        foreach (['index.html', 'index.html.sha256', 'index.md', '_status', '_tenant.json'] as $name) {
            $path = $dir . '/' . $name;
            if (!is_file($path) || is_link($path)) {
                $parts[$name] = null;
                continue;
            }
            $hash = @hash_file('sha256', $path);
            if (!is_string($hash)) {
                throw new \RuntimeException("Unable to fingerprint prerender snapshot file: {$path}");
            }
            $parts[$name] = [
                'bytes' => (int) filesize($path),
                'sha256' => $hash,
            ];
        }

        return hash('sha256', (string) json_encode($parts, JSON_UNESCAPED_SLASHES));
    }

    /** Serialize cache mutations with the host publisher's volume lock. */
    private function withCacheMutationLock(callable $operation, float $timeoutSeconds = 120.0): mixed
    {
        if (!is_dir($this->cachePath) && !@mkdir($this->cachePath, 0775, true) && !is_dir($this->cachePath)) {
            throw new \RuntimeException('Prerender cache root is unavailable for mutation');
        }
        $handle = $this->acquireCacheLock(LOCK_EX, $timeoutSeconds);
        try {
            return $operation();
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }

    /** @return resource */
    private function acquireCacheLock(int $mode, float $timeoutSeconds = 120.0)
    {
        $handle = @fopen($this->cachePath . '/.mutation.lock', 'c+');
        if ($handle === false) {
            throw new \RuntimeException('Prerender cache mutation lock is unavailable');
        }
        $deadline = microtime(true) + max(0.0, $timeoutSeconds);
        do {
            if (flock($handle, $mode | LOCK_NB)) return $handle;
            usleep(100_000);
        } while (microtime(true) < $deadline);
        fclose($handle);
        throw new \RuntimeException('Timed out acquiring the prerender cache lock');
    }

    private function globToRegex(string $glob, bool $allowDoubleStar): string
    {
        // Escape regex metacharacters except the glob wildcards we honour.
        $out = '';
        $i = 0;
        $len = strlen($glob);
        while ($i < $len) {
            $c = $glob[$i];
            if ($allowDoubleStar && $c === '*' && $i + 1 < $len && $glob[$i + 1] === '*') {
                $out .= '.*';
                $i += 2;
                continue;
            }
            if ($c === '*')      { $out .= '[^/]*'; }
            elseif ($c === '?')  { $out .= '[^/]';  }
            else                  { $out .= preg_quote($c, '#'); }
            $i++;
        }
        return '#^' . $out . '$#';
    }

    // -------------------------------------------------------------------------
    // Job queue
    // -------------------------------------------------------------------------

    /** Priority constants. Lower number wins. See migration for full table. */
    public const PRIORITY_HIGH   = 3;
    public const PRIORITY_NORMAL = 5;
    public const PRIORITY_LOW    = 7;

    private const FENCE_STATE_PENDING = 'pending';
    private const FENCE_STATE_READY = 'ready';
    private const FENCE_STATE_ACTIVATED = 'activated';
    // Existing blue/green workers claim only status='queued'. Keeping a
    // not-yet-fenced intent in an existing terminal enum state makes the
    // additive migration rolling-safe without altering the live status ENUM.
    private const FENCE_PENDING_STORAGE_STATUS = 'failed';

    /** Allowed character floor for public routes. Use isValidRoute(), which
     * also rejects traversal, ambiguous separators, and dangerous encodings. */
    public const ROUTE_REGEX = '#^/[A-Za-z0-9._~/%:@!$()*+,;=\-]*$#';

    public static function normalizeRoute(string $route): ?string
    {
        if ($route === '' || strlen($route) > 1024 || preg_match(self::ROUTE_REGEX, $route) !== 1) {
            return null;
        }

        // Treat a conventional trailing slash as the same route, but never
        // allow empty interior segments. This keeps CMS webhook payloads
        // friendly without letting aliases delete a snapshot and then miss
        // the matching recache eligibility check.
        if ($route !== '/') {
            $route = rtrim($route, '/');
        }
        if ($route === '') $route = '/';

        // Empty path segments and dot segments are ambiguous across URL,
        // proxy, framework, and filesystem normalisation layers.
        if (str_contains($route, '//')
            || preg_match('#(?:^|/)\.{1,2}(?:/|$)#', $route) === 1) {
            return null;
        }

        // Percent escapes must be well formed. Encoded NUL, percent, dot, or
        // path separators can be decoded by a downstream layer into a second
        // traversal or separator, so reject them at the protocol boundary.
        if (preg_match('/%(?![0-9A-Fa-f]{2})/', $route) === 1
            || preg_match('/%(?:00|25|2e|2f|5c)/i', $route) === 1) {
            return null;
        }

        return $route;
    }

    public static function isValidRoute(string $route): bool
    {
        return self::normalizeRoute($route) === $route;
    }

    /** Canonical filesystem/URL host form used by planners and cache keys. */
    public static function normalizeHost(string $host): ?string
    {
        $host = strtolower(rtrim(trim($host), '.'));
        if ($host === '' || strlen($host) > 253) return null;
        if ($host === 'localhost' || filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            return $host;
        }
        if (preg_match(
            '/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/',
            $host
        ) !== 1) {
            return null;
        }
        return $host;
    }

    public static function routeRequiresTenantScope(string $route): bool
    {
        static $patterns = [
            '#^/page/[^/]+$#',
            '#^/blog/[^/]+$#',
            '#^/listings/[^/]+$#',
            '#^/events/[^/]+$#',
            '#^/jobs/[^/]+$#',
            '#^/groups/[^/]+$#',
            '#^/organisations/[^/]+$#',
            '#^/ideation/[^/]+$#',
            '#^/kb/[^/]+$#',
            '#^/profile/[^/]+$#',
            '#^/volunteering/opportunities/[^/]+$#',
            '#^/marketplace/(?!free$|map$|category/)[^/]+$#',
            '#^/marketplace/category/[^/]+$#',
            '#^/courses/[^/]+$#',
        ];

        foreach ($patterns as $pattern) {
            if (preg_match($pattern, $route) === 1) {
                return true;
            }
        }

        return false;
    }

    /**
     * Member-authored feature routes require authentication and must never be
     * planned, queued, or restored as anonymous prerender snapshots.
     */
    public static function routeRequiresAuthentication(string $route): bool
    {
        return preg_match(
            '#^/(?:explore|listings|events|groups|jobs|volunteering|organisations|ideation|resources|kb|marketplace|courses|podcasts)(?:/|$)#',
            $route
        ) === 1;
    }

    public static function routeCanBeGlobalExplicit(string $route): bool
    {
        return in_array($route, self::ALWAYS_PUBLIC_ROUTES, true);
    }

    public function enqueueJob(
        ?int $tenantId,
        ?string $routes,
        bool $force,
        bool $dryRun,
        ?int $requestedBy,
        int $priority = self::PRIORITY_NORMAL
    ): int {
        $priority = max(1, min(9, $priority));
        if ($routes !== null) {
            $routes = trim($routes);
            if (strlen($routes) > 2000) {
                throw new \InvalidArgumentException('Prerender route set exceeds the 2000-byte job limit; split it into deterministic chunks');
            }
            if ($routes === '') {
                $routes = null;
            } else {
                // Defence in depth: every route token must match ROUTE_REGEX.
                // Observer-injected routes already go through routesFor() and
                // are static strings, but a future contributor adding a
                // dynamic routesFor() could land unsafe characters in a shell
                // eval. Reject those here.
                $tokens = array_filter(array_map('trim', explode(',', $routes)));
                $normalisedTokens = [];
                foreach ($tokens as $rawToken) {
                    $tok = self::normalizeRoute($rawToken);
                    if ($tok === null) {
                        throw new \InvalidArgumentException("Invalid route in enqueueJob: {$rawToken}");
                    }
                    if (
                        $tenantId === null
                        && (self::routeRequiresTenantScope($tok) || !self::routeCanBeGlobalExplicit($tok))
                    ) {
                        throw new \InvalidArgumentException("Route requires tenant scope in enqueueJob: {$tok}");
                    }
                    if ($tenantId !== null && !$this->tenantRouteCanBePrerendered($tenantId, $tok)) {
                        throw new \InvalidArgumentException("Route is not available for tenant in enqueueJob: {$tok}");
                    }
                    $normalisedTokens[] = $tok;
                }
                $routes = implode(',', array_values(array_unique($normalisedTokens)));
                if ($routes === '') $routes = null;
            }
        }

        // Transactional dedup. Two concurrent observers firing on the same
        // model save can both see "no queued row" and both insert; wrapping
        // the probe+insert in a transaction with lockForUpdate serialises
        // them through MariaDB row locks.
        return DB::transaction(function () use ($tenantId, $routes, $force, $dryRun, $requestedBy, $priority): int {
            $existing = DB::table('prerender_jobs')
                ->where('status', 'queued')
                ->where('tenant_id', $tenantId)
                ->where('routes', $routes)
                ->where('force_render', $force ? 1 : 0)
                ->where('dry_run', $dryRun ? 1 : 0)
                ->orderByDesc('id')
                ->lockForUpdate()
                ->first();
            if ($existing) {
                // If a higher-priority caller is enqueueing a dup, promote it.
                if ($priority < (int) ($existing->priority ?? self::PRIORITY_NORMAL)) {
                    DB::table('prerender_jobs')->where('id', $existing->id)->update(['priority' => $priority]);
                    $existingId = (int) $existing->id;
                    DB::afterCommit(fn () => $this->broadcastJob($existingId));
                }
                return (int) $existing->id;
            }

            $values = [
                'requested_by'  => $requestedBy,
                'tenant_id'     => $tenantId,
                'routes'        => $routes,
                'force_render'  => $force ? 1 : 0,
                'dry_run'       => $dryRun ? 1 : 0,
                'priority'      => $priority,
                'status'        => 'queued',
                'queued_at'     => date('Y-m-d H:i:s'),
            ];
            if ($this->hasJobFenceColumn()) {
                $values['fence_state'] = self::FENCE_STATE_READY;
                $values['fence_ready_at'] = date('Y-m-d H:i:s');
            }
            $id = (int) DB::table('prerender_jobs')->insertGetId($values);

            // Enqueue is frequently nested inside a content/configuration
            // transaction. Never publish a realtime job that can still roll
            // back and disappear from the database.
            DB::afterCommit(fn () => $this->broadcastJob($id));
            return $id;
        });
    }

    public function cancelJob(int $id): bool
    {
        $query = DB::table('prerender_jobs')
            ->where('id', $id)
            ->where(function ($state): void {
                if ($this->hasJobFenceColumn()) {
                    $state->where(function ($ordinary): void {
                        $ordinary->where('status', 'queued')
                            ->where('fence_state', '<>', self::FENCE_STATE_ACTIVATED);
                    })->orWhere('fence_state', self::FENCE_STATE_PENDING);
                    return;
                }
                $state->where('status', 'queued');
            });
        $values = [
            'status'        => 'cancelled',
            'finished_at'   => date('Y-m-d H:i:s'),
            'error_message' => 'cancelled by admin',
        ];
        if ($this->hasJobFenceColumn()) {
            $values['fence_state'] = self::FENCE_STATE_READY;
            $values['fence_ready_at'] = date('Y-m-d H:i:s');
        }
        $rows = $query->update($values);
        if ($rows > 0) $this->broadcastJob($id);
        return $rows > 0;
    }

    /**
     * Fence all older work and enqueue one authoritative, tenant-aware rebuild.
     * Existing snapshots remain live until the host worker has rendered and
     * validated the complete new plan; the shell then reconciles obsolete
     * routes only after a fully successful global force run.
     *
     * @return array{job_id:int,cancelled_jobs:int,cancelled_active_jobs:int,tenant_count:int,planned_routes:int}
     */
    public function resetAllSnapshots(
        ?int $requestedBy,
        ?string $ip = null,
        ?string $userAgent = null
    ): array
    {
        if (!Schema::hasTable('prerender_jobs')) {
            throw new \RuntimeException('Prerender job queue table is unavailable');
        }

        $targets = $this->loadTenantTargets();
        if ($targets === []) {
            throw new \RuntimeException('No active tenant render targets are available');
        }

        $plannedRoutes = 0;
        $previousFreshSetting = config('prerender.runtime_force_fresh_sitemap', false);
        $previousBypassSetting = config('prerender.runtime_bypass_sitemap_cache', false);
        config([
            'prerender.runtime_force_fresh_sitemap' => true,
            'prerender.runtime_bypass_sitemap_cache' => true,
        ]);
        try {
            foreach ($targets as $target) {
                $plannedRoutes += count($this->expectedRoutesForTenant(
                    $target,
                    self::MAX_PLANNED_ROUTES_PER_TENANT,
                    true
                ));
            }
        } finally {
            config([
                'prerender.runtime_force_fresh_sitemap' => $previousFreshSetting,
                'prerender.runtime_bypass_sitemap_cache' => $previousBypassSetting,
            ]);
        }
        if ($plannedRoutes <= 0) {
            throw new \RuntimeException('Authoritative route plan is empty');
        }

        $result = DB::transaction(function () use (
            $requestedBy,
            $ip,
            $userAgent,
            $targets,
            $plannedRoutes
        ): array {
            $intent = $this->enqueueAuthoritativeRebuildIntent($requestedBy);
            $result = [
                ...$intent,
                'tenant_count' => count($targets),
                'planned_routes' => $plannedRoutes,
            ];

            // A successful reset is an enterprise control-plane action: its
            // durable intent and success audit must either both commit or both
            // roll back. All other audit calls remain deliberately best-effort.
            $this->persistAudit(
                'reset_all',
                $requestedBy,
                null,
                $result['job_id'],
                'ok',
                $result,
                $ip,
                $userAgent
            );

            return $result;
        });

        DB::afterCommit(function (): void {
            try {
                app(SitemapService::class)->clearCache();
                Cache::forget('prerender:summary:inventory');
            } catch (\Throwable $e) {
                Log::warning('Post-commit reset sitemap invalidation failed', [
                    'error' => $e->getMessage(),
                ]);
            }
        });

        return $result;
    }

    /**
     * Write only the authoritative queue intent. This method is safe inside a
     * tenant/configuration transaction: filesystem lease revocation, the
     * publisher barrier, cache changes, and broadcasts are deferred until the
     * outermost database commit succeeds.
     *
     * @return array{job_id:int,cancelled_jobs:int,cancelled_active_jobs:int}
     */
    public function enqueueAuthoritativeRebuildIntent(?int $requestedBy): array
    {
        if (!Schema::hasTable('prerender_jobs')) {
            throw new \RuntimeException('Prerender job queue table is unavailable');
        }
        if (!$this->jobFenceSchemaCompatible()) {
            throw new \RuntimeException('Prerender fence activation migration is required');
        }

        $activeCount = 0;
        $cancelledActive = 0;
        $jobId = 0;

        DB::transaction(function () use (
            &$activeCount,
            &$cancelledActive,
            &$jobId,
            $requestedBy
        ): void {
            $rows = DB::table('prerender_jobs')
                ->where(function ($state): void {
                    $state->whereIn('status', ['queued', 'claimed', 'running'])
                        ->orWhere('fence_state', self::FENCE_STATE_PENDING);
                })
                ->lockForUpdate()
                ->get(['id', 'status', 'fence_state']);
            $activeCount = $rows->count();
            $cancelledActive = $rows->filter(
                fn ($row) => in_array($row->status, ['claimed', 'running'], true)
            )->count();

            $existing = DB::table('prerender_jobs')
                ->where('fence_state', self::FENCE_STATE_PENDING)
                ->whereNull('fence_ready_at')
                ->whereNull('tenant_id')
                ->whereNull('routes')
                ->where('force_render', 1)
                ->orderByDesc('id')
                ->lockForUpdate()
                ->first();
            if ($existing) {
                $jobId = (int) $existing->id;
                $activeCount = max(0, $activeCount - 1);
                return;
            }

            // A NULL fence timestamp is a durable, non-claimable outbox row.
            // No filesystem or existing-job state changes until the outermost
            // caller transaction commits successfully.
            $jobId = (int) DB::table('prerender_jobs')->insertGetId([
                'requested_by' => $requestedBy,
                'tenant_id' => null,
                'routes' => null,
                'force_render' => 1,
                'dry_run' => 0,
                'priority' => self::PRIORITY_HIGH,
                'status' => self::FENCE_PENDING_STORAGE_STATUS,
                'queued_at' => date('Y-m-d H:i:s'),
                'fence_state' => self::FENCE_STATE_PENDING,
                'fence_ready_at' => null,
                'error_message' => 'pending publisher fence activation',
            ]);
        });

        DB::afterCommit(function () use ($jobId): void {
            try {
                // The API must acknowledge the durable intent promptly even
                // when a publisher currently owns the volume lock. The host
                // queue worker retries pending activation with the normal
                // long lock budget before it claims ordinary work.
                $this->activatePendingAuthoritativeJob($jobId, 0.25);
            } catch (\Throwable $e) {
                DB::table('prerender_jobs')
                    ->where('id', $jobId)
                    ->where('fence_state', self::FENCE_STATE_PENDING)
                    ->whereNull('fence_ready_at')
                    ->update(['error_message' => substr(
                        'publisher fence activation deferred: ' . $e->getMessage(),
                        0,
                        1024
                    )]);
                Log::warning('Authoritative prerender fence activation deferred', [
                    'job_id' => $jobId,
                    'error' => $e->getMessage(),
                ]);
                $this->broadcastJob($jobId);
            }
        });

        return [
            'job_id' => $jobId,
            'cancelled_jobs' => $activeCount,
            'cancelled_active_jobs' => $cancelledActive,
        ];
    }

    /** Activate one committed authoritative outbox row under the volume fence. */
    private function activatePendingAuthoritativeJob(int $jobId, float $lockTimeoutSeconds = 120.0): bool
    {
        if ($jobId <= 0 || !$this->hasJobFenceColumn()) return false;
        $pending = DB::table('prerender_jobs')
            ->where('id', $jobId)
            ->where('fence_state', self::FENCE_STATE_PENDING)
            ->whereNull('fence_ready_at')
            ->exists();
        if (!$pending) return false;

        $cancelledIds = [];
        $cancelledActive = 0;
        $activated = false;
        $this->withCacheMutationLock(function () use (
            $jobId,
            &$cancelledIds,
            &$cancelledActive,
            &$activated
        ): void {
            DB::transaction(function () use (
                $jobId,
                &$cancelledIds,
                &$cancelledActive,
                &$activated
            ): void {
                $pending = DB::table('prerender_jobs')
                    ->where('id', $jobId)
                    ->where('fence_state', self::FENCE_STATE_PENDING)
                    ->whereNull('fence_ready_at')
                    ->lockForUpdate()
                    ->first();
                if (!$pending) return;

                // The row lock and volume lock are both held before epoch
                // rotation. Concurrent activation/cancellation cannot turn an
                // idempotent retry into an unrelated publisher fence.
                $this->rotatePublisherEpoch();

                $rows = DB::table('prerender_jobs')
                    ->where('id', '<>', $jobId)
                    ->where(function ($state): void {
                        $state->whereIn('status', ['queued', 'claimed', 'running'])
                            ->orWhere('fence_state', self::FENCE_STATE_PENDING);
                    })
                    ->lockForUpdate()
                    ->get(['id', 'status', 'fence_state']);
                $cancelledIds = $rows->pluck('id')->map(fn ($id) => (int) $id)->all();
                $cancelledActive = $rows->filter(
                    fn ($row) => in_array($row->status, ['claimed', 'running'], true)
                )->count();
                if ($cancelledIds !== []) {
                    DB::table('prerender_jobs')
                        ->whereIn('id', $cancelledIds)
                        ->where(function ($state): void {
                            $state->whereIn('status', ['queued', 'claimed', 'running'])
                                ->orWhere('fence_state', self::FENCE_STATE_PENDING);
                        })
                        ->update([
                            'status' => 'cancelled',
                            'fence_state' => self::FENCE_STATE_READY,
                            'fence_ready_at' => date('Y-m-d H:i:s'),
                            'finished_at' => date('Y-m-d H:i:s'),
                            'error_message' => 'superseded by authoritative reset',
                        ]);
                }
                $activated = DB::table('prerender_jobs')
                    ->where('id', $jobId)
                    ->where('fence_state', self::FENCE_STATE_PENDING)
                    ->whereNull('fence_ready_at')
                    ->update([
                        'status' => 'queued',
                        'fence_state' => self::FENCE_STATE_ACTIVATED,
                        'fence_ready_at' => date('Y-m-d H:i:s'),
                        'error_message' => null,
                    ]) === 1;
            });

            if ($activated) {
                foreach ($cancelledIds as $id) $this->releaseJobLease((int) $id);
            }
        }, $lockTimeoutSeconds);

        if (!$activated) return false;
        foreach ($cancelledIds as $id) $this->broadcastJob((int) $id);
        $this->broadcastJob($jobId);
        $this->resetBreaker();
        Cache::forget('prerender:summary:inventory');
        if ($cancelledActive > 0) {
            Log::info('Activated authoritative prerender fence', [
                'job_id' => $jobId,
                'cancelled_active_jobs' => $cancelledActive,
            ]);
        }
        return true;
    }

    private function rotatePublisherEpoch(): string
    {
        if (!is_dir($this->cachePath)
            && !@mkdir($this->cachePath, 0775, true)
            && !is_dir($this->cachePath)) {
            throw new \RuntimeException('Prerender cache root is unavailable for publisher fencing');
        }

        $epoch = bin2hex(random_bytes(16));
        $path = $this->cachePath . '/.publish-epoch';
        $temp = $path . '.tmp.' . bin2hex(random_bytes(8));
        if (@file_put_contents($temp, $epoch . "\n", LOCK_EX) === false
            || !@rename($temp, $path)) {
            @unlink($temp);
            throw new \RuntimeException('Could not atomically rotate the prerender publisher epoch');
        }
        return $epoch;
    }

    /**
     * Fingerprint cache paths while holding the publisher-compatible read lock.
     * The result is stored only in the short-lived, server-side purge preview.
     *
     * @param list<string> $cachePaths
     * @return array<string,string>
     */
    public function fingerprintCachePaths(array $cachePaths): array
    {
        $safePaths = $this->normaliseExactCachePaths($cachePaths);
        if ($safePaths === []) {
            return [];
        }

        $handle = $this->acquireCacheLock(LOCK_SH);
        try {
            $fingerprints = [];
            foreach (array_keys($safePaths) as $safe) {
                $resolved = $this->resolveExistingCacheFile($this->cachePath . '/' . $safe);
                if ($resolved === null || basename($resolved) !== 'index.html') {
                    continue;
                }
                $fingerprint = $this->snapshotBundleFingerprint($resolved);
                if ($fingerprint === null) {
                    throw new \RuntimeException('Unable to fingerprint a previewed snapshot');
                }
                $fingerprints[$safe] = $fingerprint;
            }
            return $fingerprints;
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }

    /**
     * Remove HTML whose persisted tenant identity no longer matches the
     * current host/prefix owner. Called only after a routing transaction
     * commits, before its authoritative rebuild is allowed to take over.
     *
     * Status-bearing rows keep `_status` until the authoritative publisher can
     * replace HTML and the compiled nginx map together, but their old HTML is
     * quarantined immediately so it cannot leak across tenants.
     *
     * @return array{quarantined:int,status_bearing:int}
     */
    public function quarantineMismatchedSnapshotOwnership(): array
    {
        $inventory = $this->inventory(null, false);
        if (count(array_filter($inventory, fn ($row) => !empty($row['__truncated']))) > 0) {
            throw new \RuntimeException('Snapshot inventory reached its safety cap; ownership quarantine was not applied');
        }

        $candidates = array_values(array_filter(
            $inventory,
            fn (array $row): bool => !empty($row['tenant_identity_mismatch'])
        ));
        if ($candidates === []) return ['quarantined' => 0, 'status_bearing' => 0];

        return $this->withCacheMutationLock(function () use ($candidates): array {
            $targetsByHost = $this->tenantTargetsByHost($this->loadTenantTargets());
            $quarantined = 0;
            $statusBearing = 0;

            // A routing-ownership mismatch always needs a complete host-tree
            // replacement, even when the affected page is ordinary HTTP 200.
            // Persist this before the first unlink so drift can self-heal if
            // the already-enqueued authoritative job later fails or cancels.
            $this->markAuthoritativeRepairRequired('tenant_ownership_quarantine');

            foreach ($candidates as $row) {
                $safe = $this->safeCachePath((string) ($row['cache_path'] ?? ''));
                if ($safe === null) continue;
                $indexPath = $this->resolveExistingCacheFile($this->cachePath . '/' . $safe);
                if ($indexPath === null || basename($indexPath) !== 'index.html') continue;

                $host = strtolower((string) ($row['host'] ?? ''));
                $route = (string) ($row['route'] ?? '/');
                [$currentTarget] = $this->tenantAttributionForRoute(
                    $host,
                    $route,
                    $targetsByHost
                );
                $identity = $this->readTenantIdentitySidecar(dirname($indexPath));
                $matches = $identity !== null
                    && (int) ($identity['tenant_id'] ?? 0) === (int) ($currentTarget['tenant_id'] ?? 0)
                    && (string) ($identity['tenant_slug'] ?? '') === (string) ($currentTarget['slug'] ?? '');
                if ($matches) continue;

                $dir = dirname($indexPath);
                if ($this->hasCompiledStatusSidecar($dir)) {
                    if ($this->quarantineStatusSnapshotHtml($indexPath)) {
                        $statusBearing++;
                        $quarantined++;
                    }
                    continue;
                }

                if ($this->deleteSnapshotBundle($indexPath)) $quarantined++;
            }

            if ($quarantined > 0) Cache::forget('prerender:summary:inventory');
            return ['quarantined' => $quarantined, 'status_bearing' => $statusBearing];
        });
    }

    /**
     * Delete only cache paths previously returned by a server-side preview.
     * Newly matching routes and same-path replacement snapshots can never be
     * swept into the live action.
     *
     * @param list<string> $cachePaths
     * @param array<string,string>|null $expectedFingerprints
     * @return list<string>
     */
    public function purgeExactCachePaths(
        array $cachePaths,
        ?array $expectedFingerprints = null,
        ?int &$authoritativeJobId = null
    ): array
    {
        $authoritativeJobId = null;
        $safePaths = $this->normaliseExactCachePaths($cachePaths);
        if ($safePaths === []) {
            return [];
        }

        $deleted = $this->withCacheMutationLock(function () use (
            $safePaths,
            $expectedFingerprints,
            &$authoritativeJobId
        ): array {
            if ($expectedFingerprints !== null) {
                // Validate the complete set before deleting anything so a
                // single concurrently refreshed snapshot makes the entire
                // one-use preview fail closed without a partial purge.
                foreach (array_keys($safePaths) as $safe) {
                    $expected = $expectedFingerprints[$safe] ?? null;
                    $resolved = $this->resolveExistingCacheFile($this->cachePath . '/' . $safe);
                    $current = $resolved !== null && basename($resolved) === 'index.html'
                        ? $this->snapshotBundleFingerprint($resolved)
                        : null;
                    if (!is_string($expected)
                        || preg_match('/^[a-f0-9]{64}$/', $expected) !== 1
                        || !is_string($current)
                        || !hash_equals($expected, $current)) {
                        throw new \UnexpectedValueException('A previewed snapshot changed before deletion');
                    }
                }
            }

            $statusBearingPaths = [];
            foreach (array_keys($safePaths) as $safe) {
                $resolved = $this->resolveExistingCacheFile($this->cachePath . '/' . $safe);
                if ($resolved !== null && $this->hasCompiledStatusSidecar(dirname($resolved))) {
                    $statusBearingPaths[$safe] = $resolved;
                }
            }
            if ($statusBearingPaths !== []) {
                // Commit durable repair intent before changing any bytes. The
                // cache lock prevents a fast worker from publishing until the
                // quarantine below has completed.
                $authoritativeJobId = $this->enqueueJob(
                    null,
                    null,
                    true,
                    false,
                    null,
                    self::PRIORITY_HIGH
                );
            }

            $deleted = [];
            foreach (array_keys($safePaths) as $safe) {
                if (isset($statusBearingPaths[$safe])) {
                    if ($this->quarantineStatusSnapshotHtml($statusBearingPaths[$safe])) {
                        $deleted[] = $safe;
                    }
                    continue;
                }
                if ($this->deleteSnapshotBundle($this->cachePath . '/' . $safe)) {
                    $deleted[] = $safe;
                }
            }
            return $deleted;
        });

        return $deleted;
    }

    /**
     * @param list<string> $cachePaths
     * @return array<string,true>
     */
    private function normaliseExactCachePaths(array $cachePaths): array
    {
        if (count($cachePaths) > self::INVENTORY_HARD_CAP) {
            throw new \RuntimeException('Exact purge exceeds the snapshot inventory safety cap');
        }

        $safePaths = [];
        foreach ($cachePaths as $cachePath) {
            if (!is_string($cachePath)) continue;
            $safe = $this->safeCachePath($cachePath);
            if ($safe === null) {
                throw new \InvalidArgumentException('Exact purge contains an unsafe cache path');
            }
            $safePaths[$safe] = true;
        }

        return $safePaths;
    }

    public function listJobs(int $limit = 50, ?string $status = null): array
    {
        if (!\Illuminate\Support\Facades\Schema::hasTable('prerender_jobs')) {
            return [];
        }
        $q = DB::table('prerender_jobs as j')
            ->leftJoin('users as u', 'u.id', '=', 'j.requested_by')
            ->leftJoin('tenants as t', 't.id', '=', 'j.tenant_id')
            ->select(
                'j.*',
                'u.first_name as user_first',
                'u.last_name as user_last',
                'u.email as user_email',
                't.slug as tenant_slug'
            )
            ->orderByDesc('j.id')
            ->limit(max(1, min(500, $limit)));
        if ($status !== null && $status !== '') {
            if ($status === 'pending_fence') {
                $this->hasJobFenceColumn()
                    ? $q->where('j.fence_state', self::FENCE_STATE_PENDING)
                    : $q->whereRaw('1 = 0');
            } else {
                $q->where('j.status', $status);
                if ($status === self::FENCE_PENDING_STORAGE_STATUS && $this->hasJobFenceColumn()) {
                    $q->where('j.fence_state', '<>', self::FENCE_STATE_PENDING);
                }
            }
        }
        return $q->get()->map(fn($r) => $this->normaliseJob((array) $r))->toArray();
    }

    public function getJob(int $id): ?array
    {
        $r = DB::table('prerender_jobs as j')
            ->leftJoin('users as u', 'u.id', '=', 'j.requested_by')
            ->leftJoin('tenants as t', 't.id', '=', 'j.tenant_id')
            ->where('j.id', $id)
            ->select(
                'j.*',
                'u.first_name as user_first',
                'u.last_name as user_last',
                'u.email as user_email',
                't.slug as tenant_slug'
            )
            ->first();
        if (!$r) return null;
        return $this->normaliseJob((array) $r);
    }

    // -------------------------------------------------------------------------
    // Circuit breaker
    // -------------------------------------------------------------------------
    //
    // If the worker fails N times in a row inside a short window, something is
    // wrong on the host (build broken, disk full, Playwright wedged) and
    // running more jobs just adds noise + uses CPU. We pause the queue for a
    // cooldown — claimNextJob returns null even when rows exist — and let
    // operators investigate. Auto-resumes when the cooldown elapses.

    public const BREAKER_FAILURE_THRESHOLD = 5;   // consecutive failures
    public const BREAKER_WINDOW_SECONDS    = 600; // within 10 minutes
    public const BREAKER_COOLDOWN_SECONDS  = 900; // pause queue 15 minutes
    public const BREAKER_CACHE_KEY         = 'prerender:breaker:tripped_until';

    public function breakerTrippedUntil(): ?int
    {
        $ts = (int) (\Illuminate\Support\Facades\Cache::get(self::BREAKER_CACHE_KEY) ?? 0);
        return $ts > time() ? $ts : null;
    }

    public function tripBreaker(?int $cooldownSeconds = null): int
    {
        $until = time() + ($cooldownSeconds ?? self::BREAKER_COOLDOWN_SECONDS);
        \Illuminate\Support\Facades\Cache::put(self::BREAKER_CACHE_KEY, $until, $until - time() + 60);
        Log::warning('Prerender breaker tripped', ['until' => date('c', $until)]);
        return $until;
    }

    public function resetBreaker(): void
    {
        \Illuminate\Support\Facades\Cache::forget(self::BREAKER_CACHE_KEY);
    }

    /**
     * Max concurrent running jobs per tenant. Keeps a single misbehaving
     * tenant (one with a slow homepage, say) from starving every other one.
     * Global concurrency is bounded by the host cron (1 tick = 1 job).
     */
    public const PER_TENANT_RUNNING_CAP = 1;

    /**
     * Atomically claim the next eligible queued job. Honours:
     *   - circuit breaker (returns null if tripped)
     *   - per-tenant concurrency cap (skips rows whose tenant already has
     *     a running/claimed sibling)
     *   - priority + FIFO order
     */
    public function claimNextJob(string $claimedBy): ?array
    {
        // A pending fence is an after-commit outbox. Never activate it from
        // this connection while an outer transaction is still open: the row
        // may subsequently roll back even though filesystem epoch rotation
        // cannot. Normal host workers run at transaction level zero and retry
        // any durable activation left behind by a prior process failure.
        if ($this->hasJobFenceColumn() && DB::transactionLevel() === 0) {
            $pendingId = (int) (DB::table('prerender_jobs')
                ->where('fence_state', self::FENCE_STATE_PENDING)
                ->whereNull('fence_ready_at')
                ->whereNull('tenant_id')
                ->where('force_render', 1)
                ->orderByDesc('id')
                ->value('id') ?? 0);
            if ($pendingId > 0) {
                try {
                    $this->activatePendingAuthoritativeJob($pendingId);
                } catch (\Throwable $e) {
                    Log::critical('Pending authoritative prerender activation retry failed', [
                        'job_id' => $pendingId,
                        'error' => $e->getMessage(),
                    ]);
                    return null;
                }
            }
        }

        // Authoritative fence recovery runs before this check because a reset
        // intentionally clears the breaker after superseding older work. A
        // crash between commit and activation must not strand that reset for
        // the remainder of the prior breaker's cooldown.
        if ($this->breakerTrippedUntil() !== null) {
            return null;
        }

        return DB::transaction(function () use ($claimedBy): ?array {
            // Tenants that already have a job in flight. Concurrency cap.
            $busy = DB::table('prerender_jobs')
                ->whereIn('status', ['claimed', 'running'])
                ->whereNotNull('tenant_id')
                ->groupBy('tenant_id')
                ->havingRaw('COUNT(*) >= ?', [self::PER_TENANT_RUNNING_CAP])
                ->pluck('tenant_id')
                ->all();

            $q = DB::table('prerender_jobs')
                ->where('status', 'queued')
                ->orderBy('priority')
                ->orderBy('queued_at')
                ->orderBy('id')
                ->lockForUpdate();

            if ($this->hasJobFenceColumn()) {
                $q->whereIn('fence_state', [self::FENCE_STATE_READY, self::FENCE_STATE_ACTIVATED])
                    ->whereNotNull('fence_ready_at');
            }

            if (!empty($busy)) {
                // Skip rows whose tenant is over the cap. NULL tenant_id
                // (all-tenants jobs) still claimable — those serialise via
                // the host worker lock.
                $q->where(function ($w) use ($busy) {
                    $w->whereNull('tenant_id')->orWhereNotIn('tenant_id', $busy);
                });
            }
            $row = $q->first();
            if (!$row) return null;

            DB::table('prerender_jobs')
                ->where('id', $row->id)
                ->update([
                    'status'     => 'claimed',
                    'claimed_at' => date('Y-m-d H:i:s'),
                    'claimed_by' => substr($claimedBy, 0, 128),
                ]);

            $this->broadcastJob((int) $row->id);
            return array_merge((array) $row, [
                'status' => 'claimed',
                'claimed_at' => date('Y-m-d H:i:s'),
                'claimed_by' => substr($claimedBy, 0, 128),
            ]);
        });
    }

    /**
     * Transition a claimed job to running. Used by the artisan command before
     * invoking the underlying prerender script.
     */
    public function markRunning(int $id, ?string $claimedBy = null): bool
    {
        $owner = $claimedBy ?? (string) DB::table('prerender_jobs')
            ->where('id', $id)
            ->where('status', 'claimed')
            ->value('claimed_by');
        if ($owner === '' || !$this->writeJobLease($id, $owner)) {
            return false;
        }

        $query = DB::table('prerender_jobs')
            ->where('id', $id)
            ->where('status', 'claimed')
            ->where('claimed_by', $owner);
        $now = date('Y-m-d H:i:s');
        $values = [
            'status'     => 'running',
            'started_at' => $now,
        ];
        if ($this->hasJobHeartbeatColumn()) $values['heartbeat_at'] = $now;
        $updated = $query->update($values);
        if ($updated === 0) {
            // A reset/reaper may have cancelled the claim after the token was
            // created. Remove only this owner's independently revocable token.
            $this->releaseJobLease($id, $owner);
            return false;
        }
        $this->broadcastJob($id);
        return true;
    }

    /**
     * Renew the lease for a running job.
     *
     * heartbeat_at is separate from the immutable started_at history field.
     * During a rolling migration the code falls back to started_at until the
     * nullable heartbeat column is available. Both the job id and immutable
     * claim owner must still match, so a superseded worker cannot keep a
     * cancelled or re-claimed job alive.
     */
    public function heartbeatJob(int $id, string $claimedBy): bool
    {
        if ($id <= 0 || $claimedBy === '') return false;

        $leaseColumn = $this->hasJobHeartbeatColumn() ? 'heartbeat_at' : 'started_at';
        $query = DB::table('prerender_jobs')
            ->where('id', $id)
            ->where('status', 'running')
            ->where('claimed_by', $claimedBy);
        $updated = (clone $query)->update([$leaseColumn => date('Y-m-d H:i:s')]);

        // MySQL reports zero affected rows when two heartbeats land within
        // the same timestamp second. Ownership still exists in that case.
        $owned = $updated > 0 || $query->exists();
        return $owned && $this->jobLeaseOwnedBy($id, $claimedBy);
    }

    private function hasJobHeartbeatColumn(): bool
    {
        return Schema::hasTable('prerender_jobs')
            && Schema::hasColumn('prerender_jobs', 'heartbeat_at');
    }

    private function hasJobFenceColumn(): bool
    {
        return Schema::hasTable('prerender_jobs')
            && Schema::hasColumn('prerender_jobs', 'fence_state')
            && Schema::hasColumn('prerender_jobs', 'fence_ready_at');
    }

    /**
     * The default values are part of the rolling-deploy contract: an old
     * writer omits both additive columns, yet its queued row must remain ready
     * and claimable by the new worker.
     */
    private function jobFenceSchemaCompatible(): bool
    {
        if ($this->jobFenceSchemaCompatibleCache !== null) {
            return $this->jobFenceSchemaCompatibleCache;
        }
        if (!$this->hasJobFenceColumn()) {
            return $this->jobFenceSchemaCompatibleCache = false;
        }

        try {
            if (DB::connection()->getDriverName() !== 'mysql') {
                return $this->jobFenceSchemaCompatibleCache = true;
            }
            $rows = DB::select(
                "SELECT COLUMN_NAME, COLUMN_DEFAULT, IS_NULLABLE
                   FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE()
                    AND TABLE_NAME = 'prerender_jobs'
                    AND COLUMN_NAME IN ('fence_state', 'fence_ready_at')"
            );
            $columns = [];
            foreach ($rows as $row) $columns[(string) $row->COLUMN_NAME] = $row;
            $stateDefault = trim((string) ($columns['fence_state']->COLUMN_DEFAULT ?? ''), "'\"");
            $readyDefault = strtolower((string) ($columns['fence_ready_at']->COLUMN_DEFAULT ?? ''));
            $readyNullable = strtoupper((string) ($columns['fence_ready_at']->IS_NULLABLE ?? '')) === 'YES';

            return $this->jobFenceSchemaCompatibleCache = $stateDefault === self::FENCE_STATE_READY
                && $readyNullable
                && str_contains($readyDefault, 'current_timestamp');
        } catch (\Throwable $e) {
            Log::warning('Could not verify prerender fence schema defaults', ['error' => $e->getMessage()]);
            return $this->jobFenceSchemaCompatibleCache = false;
        }
    }

    /**
     * Finalise a job from the artisan command. $status must be one of:
     * succeeded | partial | failed.
     */
    public function finaliseJob(
        int $id,
        string $status,
        ?int $planned,
        ?int $rendered,
        ?int $invalid,
        ?int $exitCode,
        int $durationS,
        ?string $logExcerpt,
        ?string $errorMessage = null,
        string $claimedBy = ''
    ): bool {
        if ($id <= 0 || $claimedBy === '') return false;
        $logExcerpt = $logExcerpt !== null ? substr($logExcerpt, -262_144) : null;
        $query = DB::table('prerender_jobs')
            ->where('id', $id)
            ->whereIn('status', ['claimed', 'running'])
            ->where('claimed_by', $claimedBy);
        $updated = $query->update([
                'status'         => $status,
                'planned_count'  => $planned,
                'rendered_count' => $rendered,
                'invalid_count'  => $invalid ?? 0,
                'duration_s'     => $durationS,
                'exit_code'      => $exitCode,
                'log_excerpt'    => $logExcerpt,
                'error_message'  => $errorMessage,
                'finished_at'    => date('Y-m-d H:i:s'),
            ]);
        if ($updated === 0) return false;
        $this->releaseJobLease($id, $claimedBy);
        $this->broadcastJob($id);

        // Circuit breaker. Count recent failures inside the window; trip if
        // we cross the threshold. A succeeded/partial job resets the streak.
        if ($status === 'failed') {
            $recentStatuses = DB::table('prerender_jobs')
                ->whereIn('status', ['succeeded', 'partial', 'failed'])
                ->where('finished_at', '>=', date('Y-m-d H:i:s', time() - self::BREAKER_WINDOW_SECONDS))
                ->orderByDesc('finished_at')
                ->orderByDesc('id')
                ->limit(self::BREAKER_FAILURE_THRESHOLD)
                ->pluck('status')
                ->all();
            if (
                count($recentStatuses) >= self::BREAKER_FAILURE_THRESHOLD
                && count(array_filter($recentStatuses, fn ($value) => $value === 'failed')) === self::BREAKER_FAILURE_THRESHOLD
            ) {
                $this->tripBreaker();
            }
        }
        return true;
    }

    // -------------------------------------------------------------------------
    // Prometheus metrics
    // -------------------------------------------------------------------------

    /**
     * Render Prometheus text-format metrics. Pull this from a scrape job or
     * grafana dashboard for long-term trend analysis.
     */
    public function prometheusMetrics(): string
    {
        $s = $this->summary();
        $lines = [];

        $g = function (string $name, $value, string $help, string $type = 'gauge') use (&$lines): void {
            array_push(
                $lines,
                "# HELP {$name} {$help}",
                "# TYPE {$name} {$type}",
                sprintf('%s %s', $name, is_bool($value) ? ($value ? 1 : 0) : $value)
            );
        };

        $g('nexus_prerender_cache_readable',     $s['cache_readable'], 'Cache mount reachable from app');
        $g('nexus_prerender_cache_writable',     $s['cache_writable'], 'Cache mount writable from app');
        $g('nexus_prerender_inventory_truncated',$s['inventory_truncated'], 'Inventory scan reached its safety cap');
        $g('nexus_prerender_plan_errors',        $s['plan_error_count'], 'Tenant route plans that could not be completed');
        $g('nexus_prerender_snapshots_total',    $s['total_snapshots'], 'Snapshot files on disk');
        $g('nexus_prerender_snapshots_expected', $s['expected_count'], 'Total tenant-specific planned routes');
        $g('nexus_prerender_snapshots_missing',  $s['missing_count'], 'Routes without a snapshot');
        $g('nexus_prerender_snapshots_stale',    $s['stale_count'], 'Snapshots older than stale threshold');
        $g('nexus_prerender_snapshots_aging',    $s['warn_count'], 'Snapshots older than warn threshold');
        $g('nexus_prerender_content_stale_total',$s['content_stale_count'], 'Snapshots older than their source content');
        $g('nexus_prerender_asset_invalid_total',$s['asset_invalid_count'], 'Snapshots referencing dead assets');
        $g('nexus_prerender_cache_bytes',        $s['total_size_bytes'], 'Total snapshot bytes on disk');
        $g('nexus_prerender_jobs_queued',        $s['queued_jobs'], 'Jobs awaiting processor');
        $g('nexus_prerender_jobs_active',        $s['active_jobs'], 'Jobs claimed or running');
        $g('nexus_prerender_failures_recent',    $s['recent_failures'], 'Cache paths inside failure-backoff window');
        $g('nexus_prerender_coverage_ratio',     $s['expected_count'] > 0 ? round(min(1, $s['expected_rendered_count'] / $s['expected_count']), 4) : 0,
           'Snapshots present / expected (0..1)');
        $hasJobsTable = Schema::hasTable('prerender_jobs');
        $g('nexus_prerender_job_table_available', $hasJobsTable ? 1 : 0, 'prerender_jobs table exists and can be queried');
        $g('nexus_prerender_job_fence_available', $this->jobFenceSchemaCompatible() ? 1 : 0, 'Durable authoritative publisher-fence activation is available');

        // Current per-status job populations. These can decrease as rows move
        // through the lifecycle, so Prometheus must treat them as gauges.
        $statusCounts = $hasJobsTable
            ? DB::table('prerender_jobs')
                ->select('status', DB::raw('COUNT(*) as n'))
                ->groupBy('status')
                ->pluck('n', 'status')
                ->toArray()
            : [];
        $pendingFenceCount = $hasJobsTable && $this->hasJobFenceColumn()
            ? (int) DB::table('prerender_jobs')
                ->where('fence_state', self::FENCE_STATE_PENDING)
                ->count()
            : 0;
        $statusCounts['pending_fence'] = $pendingFenceCount;
        $statusCounts[self::FENCE_PENDING_STORAGE_STATUS] = max(
            0,
            (int) ($statusCounts[self::FENCE_PENDING_STORAGE_STATUS] ?? 0) - $pendingFenceCount
        );
        $lines[] = '# HELP nexus_prerender_jobs_total Current job rows by status';
        $lines[] = '# TYPE nexus_prerender_jobs_total gauge';
        foreach (['pending_fence','queued','claimed','running','succeeded','partial','failed','cancelled'] as $st) {
            $n = (int) ($statusCounts[$st] ?? 0);
            $lines[] = sprintf('nexus_prerender_jobs_total{status="%s"} %d', $st, $n);
        }

        // Per-tenant coverage gauges
        $coverage = $this->coverage();
        $lines[] = '# HELP nexus_prerender_tenant_rendered Snapshots present per tenant';
        $lines[] = '# TYPE nexus_prerender_tenant_rendered gauge';
        foreach ($coverage as $row) {
            $lines[] = sprintf(
                'nexus_prerender_tenant_rendered{tenant_id="%d",slug="%s"} %d',
                $row['tenant_id'], $this->escapePromLabel($row['slug']), $row['rendered']
            );
        }
        $lines[] = '# HELP nexus_prerender_tenant_missing Routes missing a snapshot per tenant';
        $lines[] = '# TYPE nexus_prerender_tenant_missing gauge';
        foreach ($coverage as $row) {
            $lines[] = sprintf(
                'nexus_prerender_tenant_missing{tenant_id="%d",slug="%s"} %d',
                $row['tenant_id'], $this->escapePromLabel($row['slug']), $row['missing']
            );
        }

        // Last run duration
        $lastRun = $this->readJsonFile($this->cachePath . '/.last-run.json');
        if (is_array($lastRun) && isset($lastRun['duration_s'])) {
            $lines[] = '# HELP nexus_prerender_last_run_duration_seconds Duration of the most recent prerender run';
            $lines[] = '# TYPE nexus_prerender_last_run_duration_seconds gauge';
            $lines[] = sprintf('nexus_prerender_last_run_duration_seconds %d', (int) $lastRun['duration_s']);
        }

        // Round 2 metrics — circuit breaker + queue age + health rollup.
        $breakerUntil = $this->breakerTrippedUntil();
        $g('nexus_prerender_breaker_tripped', $breakerUntil !== null ? 1 : 0, 'Circuit breaker tripped (1) or closed (0)');
        $g('nexus_prerender_breaker_until_seconds', $breakerUntil ?? 0, 'Unix ts when breaker auto-resumes (0 = closed)');

        // Oldest queued job age in seconds — the most useful queue-health number.
        $oldestQueuedRaw = null;
        if ($hasJobsTable) {
            $oldestQueueQuery = DB::table('prerender_jobs')->where('status', 'queued');
            if ($this->hasJobFenceColumn()) {
                $oldestQueueQuery->orWhere('fence_state', self::FENCE_STATE_PENDING);
            }
            $oldestQueuedRaw = $oldestQueueQuery->min('queued_at');
        }
        $oldestQueuedAge = $oldestQueuedRaw ? max(0, time() - strtotime($oldestQueuedRaw)) : 0;
        $g('nexus_prerender_queue_oldest_age_seconds', $oldestQueuedAge, 'Age of the oldest queued job (0 if queue empty)');

        // Health rollup as a numeric so Grafana/alertmanager can use thresholds.
        $h = $this->health();
        $hVal = $h['status'] === 'green' ? 0 : ($h['status'] === 'yellow' ? 1 : 2);
        $g('nexus_prerender_health_status', $hVal, 'Engine health: 0=green, 1=yellow, 2=red');

        return implode("\n", $lines) . "\n";
    }

    // -------------------------------------------------------------------------
    // Realtime
    // -------------------------------------------------------------------------

    /**
     * Broadcast a job's current state on the admin realtime channel. Used at
     * every lifecycle transition. Failures are swallowed (broadcasting is best
     * effort; UI polls as fallback).
     */
    public function broadcastJob(int $id): void
    {
        try {
            $row = $this->getJob($id);
            if (!$row) return;
            // Pusher's HTTP API caps event payloads at 10 KiB. Drift-detector
            // jobs can carry 80+ routes plus 250 KiB log excerpts — well over
            // the limit. Strip / truncate fields the realtime UI doesn't need
            // for a status update; the inspect modal fetches the full row via
            // a separate REST call when the user clicks in.
            $broadcastRow = $row;
            unset($broadcastRow['log_excerpt']);
            if (isset($broadcastRow['routes']) && is_string($broadcastRow['routes']) && strlen($broadcastRow['routes']) > 400) {
                $broadcastRow['routes'] = substr($broadcastRow['routes'], 0, 400) . '…';
                $broadcastRow['routes_truncated'] = true;
            }
            $rt = app(RealtimeService::class);
            $rt->broadcast(self::REALTIME_CHANNEL, self::REALTIME_EVENT, [
                'job' => $broadcastRow,
                'ts'  => time(),
            ]);
        } catch (\Throwable $e) {
            Log::warning('PrerenderService::broadcastJob failed', ['id' => $id, 'error' => $e->getMessage()]);
        }
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /**
     * Resolve the per-tenant static-route floor based on tenants.features and
     * tenants.configuration.modules. Mirrors SitemapService gating so the
     * prerender engine and the published sitemap agree on what exists.
     *
     * Accepts either a stdClass row (with `features` + `configuration` JSON
     * strings) or a tenant_id + lazy fetch.
     *
     * @return list<string>
     */
    public function routesForTenant(int|object $tenant): array
    {
        if (is_int($tenant)) {
            $row = DB::table('tenants')
                ->where('id', $tenant)
                ->where('is_active', 1)
                ->select('id', 'slug', 'features', 'configuration')
                ->first();
            if (!$row) return [];
            $tenant = $row;
        }

        $features = TenantFeatureConfig::mergeFeatures(
            $this->decodeJsonColumn($tenant->features ?? null)
        );
        $configuration = $this->decodeJsonColumn($tenant->configuration ?? null);
        $modules = TenantFeatureConfig::mergeModules(
            is_array($configuration['modules'] ?? null) ? $configuration['modules'] : []
        );

        $routes = self::ALWAYS_PUBLIC_ROUTES;

        $slug = strtolower(trim((string) ($tenant->slug ?? '')));
        foreach (self::TENANT_SLUG_ROUTES[$slug] ?? [] as $route) {
            $routes[] = $route;
        }

        foreach (self::FEATURE_GATED_ROUTES as $feature => $featureRoutes) {
            if (($features[$feature] ?? false) === true) {
                foreach ($featureRoutes as $r) $routes[] = $r;
            }
        }
        foreach (self::MODULE_GATED_ROUTES as $module => $moduleRoutes) {
            if (($modules[$module] ?? false) === true) {
                foreach ($moduleRoutes as $r) $routes[] = $r;
            }
        }

        return array_values(array_unique($routes));
    }

    private function jobLeasePath(int $id, string $claimedBy): string
    {
        $ownerKey = rtrim(strtr(base64_encode($claimedBy), '+/', '-_'), '=');
        return $this->cachePath . '/.leases/' . $id . '.' . $ownerKey . '.token';
    }

    private function writeJobLease(int $id, string $claimedBy): bool
    {
        if ($id <= 0 || $claimedBy === '' || !preg_match('/^[A-Za-z0-9_.:-]+$/', $claimedBy)) return false;
        $dir = $this->cachePath . '/.leases';
        if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) return false;
        $path = $this->jobLeasePath($id, $claimedBy);
        $tmp = @tempnam($dir, '.lease-');
        if ($tmp === false) return false;
        $ok = @file_put_contents($tmp, $claimedBy . "\n", LOCK_EX) !== false
            && @chmod($tmp, 0664)
            && @rename($tmp, $path);
        if (!$ok) @unlink($tmp);
        return $ok;
    }

    private function jobLeaseOwnedBy(int $id, string $claimedBy): bool
    {
        $path = $this->jobLeasePath($id, $claimedBy);
        return is_file($path) && trim((string) @file_get_contents($path)) === $claimedBy;
    }

    /** Remove a shared publication fence, optionally only for its owner. */
    public function releaseJobLease(int $id, ?string $claimedBy = null): void
    {
        if ($id <= 0) return;
        if ($claimedBy !== null) {
            $path = $this->jobLeasePath($id, $claimedBy);
            if (is_file($path) && trim((string) @file_get_contents($path)) === $claimedBy) {
                @unlink($path);
            }
            return;
        }

        // Job ids are never reused. Owner-qualified filenames let a reset
        // revoke active publishers without waiting for `.mutation.lock` and
        // without racing a different owner's token.
        foreach (glob($this->cachePath . '/.leases/' . $id . '.*.token') ?: [] as $path) {
            if (is_file($path)) @unlink($path);
        }
    }

    /**
     * Return the complete authoritative route plan for one tenant: the
     * feature/module-gated static floor plus every public URL in its sitemap.
     *
     * @param array{tenant_id:int,slug:string,host:string,prefix:string,features:mixed,configuration:mixed} $target
     * @return list<string>
     */
    public function expectedRoutesForTenant(
        array $target,
        int $limit = self::MAX_PLANNED_ROUTES_PER_TENANT,
        bool $strict = false
    ): array {
        $limit = max(1, min(self::MAX_PLANNED_ROUTES_PER_TENANT, $limit));
        $tenantObject = (object) [
            'slug' => $target['slug'] ?? null,
            'features' => $target['features'] ?? null,
            'configuration' => $target['configuration'] ?? null,
        ];
        $routes = array_fill_keys($this->routesForTenant($tenantObject), true);

        try {
            $host = strtolower(trim((string) ($target['host'] ?? '')));
            $prefix = rtrim((string) ($target['prefix'] ?? ''), '/');
            $tenantId = (int) ($target['tenant_id'] ?? 0);
            if ($host === '' || $tenantId <= 0) {
                throw new \RuntimeException('Tenant target is missing host or tenant id');
            }

            $xml = app(SitemapService::class)->generateForTenant(
                $tenantId,
                'https://' . $host . $prefix
            );
            if (!preg_match_all('#<loc>([^<]+)</loc>#i', $xml, $matches)) {
                $message = 'Tenant sitemap contains no route locations';
                if ($strict) throw new \RuntimeException($message);
                Log::warning($message, [
                    'tenant_id' => $tenantId,
                    'tenant_slug' => $target['slug'] ?? null,
                ]);
                return array_keys($routes);
            }

            $truncated = false;
            $acceptedSitemapRoutes = 0;
            $rejectedLocations = [];
            foreach ($matches[1] as $rawLocation) {
                $location = trim(html_entity_decode(
                    (string) $rawLocation,
                    ENT_XML1 | ENT_QUOTES,
                    'UTF-8'
                ));
                $parts = parse_url($location);
                $locationHost = is_array($parts)
                    ? self::normalizeHost((string) ($parts['host'] ?? ''))
                    : null;
                $path = is_array($parts) ? (string) ($parts['path'] ?? '') : '';
                if (!is_array($parts) || ($parts['scheme'] ?? '') !== 'https') {
                    $rejectedLocations[] = ['location' => $location, 'reason' => 'invalid or non-HTTPS URL'];
                    continue;
                }
                if ($locationHost !== $host || $path === '') {
                    $rejectedLocations[] = ['location' => $location, 'reason' => 'wrong host or empty path'];
                    continue;
                }

                if ($prefix !== '' && $path === $prefix) {
                    $path = '/';
                } elseif ($prefix !== '' && str_starts_with($path, $prefix . '/')) {
                    $path = substr($path, strlen($prefix));
                } elseif ($prefix !== '') {
                    $rejectedLocations[] = ['location' => $location, 'reason' => 'outside tenant path prefix'];
                    continue;
                }

                if ($path === '') $path = '/';
                $path = self::normalizeRoute($path);
                if ($path === null) {
                    $rejectedLocations[] = ['location' => $location, 'reason' => 'unsafe or unrepresentable route'];
                    continue;
                }
                if (self::routeRequiresAuthentication($path)) {
                    $rejectedLocations[] = ['location' => $location, 'reason' => 'route requires authentication'];
                    continue;
                }
                $routes[$path] = true;
                $acceptedSitemapRoutes++;
                if (count($routes) >= $limit) {
                    $truncated = true;
                    break;
                }
            }
            if ($rejectedLocations !== []) {
                $first = $rejectedLocations[0];
                $message = sprintf(
                    'Tenant sitemap rejected %d route location(s); first: %s (%s)',
                    count($rejectedLocations),
                    mb_strimwidth((string) $first['location'], 0, 240, '…', 'UTF-8'),
                    $first['reason']
                );
                if ($strict) throw new \RuntimeException($message);
                Log::warning($message, [
                    'tenant_id' => $tenantId,
                    'tenant_slug' => $target['slug'] ?? null,
                    'rejected_count' => count($rejectedLocations),
                ]);
            }
            if ($acceptedSitemapRoutes === 0) {
                $message = 'Tenant sitemap contains no routes for its canonical host';
                if ($strict) throw new \RuntimeException($message);
                Log::warning($message, [
                    'tenant_id' => $tenantId,
                    'tenant_slug' => $target['slug'] ?? null,
                    'host' => $host,
                ]);
            }
            if ($truncated) {
                $message = "Tenant route plan reached the {$limit}-route safety limit";
                if ($strict) throw new \RuntimeException($message);
                Log::warning($message, [
                    'tenant_id' => $tenantId,
                    'tenant_slug' => $target['slug'] ?? null,
                ]);
            }
        } catch (\Throwable $e) {
            if ($strict) throw $e;
            Log::warning('Prerender tenant sitemap planning failed', [
                'tenant_id' => $target['tenant_id'] ?? null,
                'tenant_slug' => $target['slug'] ?? null,
                'error' => $e->getMessage(),
            ]);
        }

        return array_keys($routes);
    }

    private function routeEligibilityReason(string $route, object $tenant, string $source): array
    {
        if ($source === 'sitemap') {
            return ['key' => 'sitemap', 'value' => null];
        }
        if ($source === 'unexpected') {
            return ['key' => 'unexpected', 'value' => null];
        }
        if (in_array($route, self::ALWAYS_PUBLIC_ROUTES, true)) {
            return ['key' => 'always_public', 'value' => null];
        }

        $features = TenantFeatureConfig::mergeFeatures(
            $this->decodeJsonColumn($tenant->features ?? null)
        );
        foreach (self::FEATURE_GATED_ROUTES as $feature => $routes) {
            if (!in_array($route, $routes, true)) continue;
            $enabled = ($features[$feature] ?? false) === true;
            return [
                'key' => $enabled ? 'feature_enabled' : 'feature_disabled',
                'value' => $feature,
            ];
        }

        $configuration = $this->decodeJsonColumn($tenant->configuration ?? null);
        $modules = TenantFeatureConfig::mergeModules(
            is_array($configuration['modules'] ?? null) ? $configuration['modules'] : []
        );
        foreach (self::MODULE_GATED_ROUTES as $module => $routes) {
            if (!in_array($route, $routes, true)) continue;
            $enabled = ($modules[$module] ?? false) === true;
            return [
                'key' => $enabled ? 'module_enabled' : 'module_disabled',
                'value' => $module,
            ];
        }

        return ['key' => 'expected', 'value' => null];
    }

    private function decodeJsonColumn(?string $raw): array
    {
        if (!is_string($raw) || $raw === '') return [];
        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : [];
    }

    /**
     * @return list<array{tenant_id:int, slug:string, host:string, prefix:string}>
     */
    public function loadTenantTargets(): array
    {
        $appHost = $this->frontendHost();
        $rows = DB::table('tenants')
            ->leftJoin('tenants as p', function ($join) {
                $join->on('p.id', '=', 'tenants.parent_id')
                    ->where('p.id', '<>', 1)
                    ->where('p.is_active', '=', 1);
            })
            ->where('tenants.is_active', 1)
            ->where('tenants.id', '<>', 1)
            ->select(
                'tenants.id',
                'tenants.slug',
                DB::raw("COALESCE(tenants.domain, '') as domain"),
                DB::raw("COALESCE(p.domain, '') as parent_domain"),
                'tenants.features',
                'tenants.configuration'
            )
            ->orderBy('tenants.id')
            ->get();

        $out = [];
        foreach ($rows as $r) {
            $rawDomain = trim((string) $r->domain);
            $rawParentDomain = trim((string) ($r->parent_domain ?? ''));
            $domain = $rawDomain === '' ? '' : (self::normalizeHost($rawDomain) ?? strtolower($rawDomain));
            $parentDomain = $rawParentDomain === ''
                ? ''
                : (self::normalizeHost($rawParentDomain) ?? strtolower($rawParentDomain));
            if ($domain !== '') {
                $host = $domain;
                $prefix = '';
            } elseif ($parentDomain !== '') {
                $host = $parentDomain;
                $prefix = '/' . $r->slug;
            } else {
                $host = $appHost;
                $prefix = '/' . $r->slug;
            }
            $out[] = [
                'tenant_id'      => (int) $r->id,
                'slug'           => (string) $r->slug,
                'host'           => $host,
                'prefix'         => $prefix,
                // Pass the raw JSON through so callers can use routesForTenant
                // without a second DB query.
                'features'       => $r->features ?? null,
                'configuration'  => $r->configuration ?? null,
            ];
        }
        return $out;
    }

    /**
     * Sweep the snapshot cache for rows whose route is NOT in the tenant's
     * current expected set — typically 404 leftovers from before this code
     * went tenant-aware, or from a feature being turned off on a tenant.
     *
     * Returns the per-tenant list of deleted cache paths. Caller decides
     * whether to also enqueue recaches (none needed — the deleted snapshots
     * shouldn't exist for these tenants in the first place).
     *
     * @return array{deleted_total:int, by_tenant:array<string,list<string>>, cache_paths:list<string>, dry_run:bool, authoritative_job_id:?int}
     */
    public function purgeUnexpectedSnapshots(bool $dryRun = false, ?int $onlyTenantId = null): array
    {
        $tenants = $this->loadTenantTargets();
        if ($onlyTenantId !== null) {
            $tenants = array_values(array_filter(
                $tenants,
                fn (array $tenant) => (int) $tenant['tenant_id'] === $onlyTenantId
            ));
        }
        $expectedByTenant = [];
        $slugByTenant = [];
        $previousFreshSetting = config('prerender.runtime_force_fresh_sitemap', false);
        $previousBypassSetting = config('prerender.runtime_bypass_sitemap_cache', false);
        config([
            'prerender.runtime_force_fresh_sitemap' => true,
            'prerender.runtime_bypass_sitemap_cache' => true,
        ]);
        try {
            foreach ($tenants as $t) {
                $tenantId = (int) $t['tenant_id'];
                $slugByTenant[$tenantId] = (string) $t['slug'];
                $expectedByTenant[$tenantId] = array_fill_keys(
                    $this->expectedRoutesForTenant(
                        $t,
                        self::MAX_PLANNED_ROUTES_PER_TENANT,
                        true
                    ),
                    true
                );
            }
        } finally {
            config([
                'prerender.runtime_force_fresh_sitemap' => $previousFreshSetting,
                'prerender.runtime_bypass_sitemap_cache' => $previousBypassSetting,
            ]);
        }

        $byTenant = [];
        $cachePaths = [];
        $deletedTotal = 0;
        $inventorySlug = $onlyTenantId !== null && count($tenants) === 1
            ? (string) $tenants[0]['slug']
            : null;
        $isUnexpected = static function (array $row) use ($expectedByTenant, $onlyTenantId): bool {
            $tenantId = (int) ($row['tenant_id'] ?? 0);
            $orphaned = $tenantId <= 0 || !isset($expectedByTenant[$tenantId]);
            if ($orphaned && $onlyTenantId !== null) return false;
            $tenantRoute = (string) ($row['tenant_route'] ?? '');
            return $orphaned
                || !empty($row['tenant_identity_mismatch'])
                || $tenantRoute === ''
                || !isset($expectedByTenant[$tenantId][$tenantRoute]);
        };
        // Hash only destructive candidates while inventory still holds its
        // shared lock. A 50k-page healthy cache must not pay a full-volume
        // SHA-256 pass merely because the reconciler is running.
        $inventory = $this->inventory($inventorySlug, false, $isUnexpected);
        if (count(array_filter($inventory, fn ($row) => !empty($row['__truncated']))) > 0) {
            throw new \RuntimeException('Snapshot inventory reached its safety cap; purge-unexpected was not applied');
        }
        $authoritativeJobId = null;
        $process = function () use (
            $inventory,
            $expectedByTenant,
            $slugByTenant,
            $dryRun,
            $onlyTenantId,
            $isUnexpected,
            &$byTenant,
            &$cachePaths,
            &$deletedTotal,
            &$authoritativeJobId
        ): void {
            $candidates = [];
            foreach ($inventory as $row) {
                if (!$isUnexpected($row)) continue;
                $tenantId = (int) ($row['tenant_id'] ?? 0);
                $orphaned = $tenantId <= 0 || !isset($expectedByTenant[$tenantId]);
                $tenantRoute = (string) ($row['tenant_route'] ?? '');

                $slug = $orphaned
                    ? 'orphan@' . ((string) ($row['host'] ?? 'unknown-host'))
                    : ($slugByTenant[$tenantId] ?? '(unknown)');
                $byTenant[$slug][] = $tenantRoute !== '' ? $tenantRoute : (string) $row['route'];
                $cachePaths[] = (string) $row['cache_path'];
                $candidates[] = $row;
            }

            if ($dryRun) {
                $deletedTotal = count($candidates);
                return;
            }

            $statusBearingPaths = [];
            $requiresAuthoritative = false;
            foreach ($candidates as $row) {
                $safe = $this->safeCachePath((string) ($row['cache_path'] ?? ''));
                if ($safe === null) {
                    throw new \RuntimeException('Snapshot inventory produced an unsafe purge path');
                }
                $abs = $this->resolveExistingCacheFile($this->cachePath . '/' . $safe);
                $expected = $row['_bundle_fingerprint'] ?? null;
                $current = $abs !== null ? $this->snapshotBundleFingerprint($abs) : null;
                if (!is_string($expected) || !is_string($current) || !hash_equals($expected, $current)) {
                    throw new \UnexpectedValueException('A candidate snapshot changed during purge planning');
                }
                if ($this->hasCompiledStatusSidecar(dirname($abs))) {
                    $statusBearingPaths[$safe] = $abs;
                    $requiresAuthoritative = true;
                }
                if (!empty($row['tenant_identity_mismatch'])) $requiresAuthoritative = true;
            }

            if ($requiresAuthoritative) {
                // Make the only operation that can reconcile the compiled
                // status map durable before deleting any discoverable HTML.
                // The shared cache lock prevents the worker overtaking us.
                $authoritativeJobId = $this->enqueueJob(
                    null,
                    null,
                    true,
                    false,
                    null,
                    self::PRIORITY_HIGH
                );
                $this->markAuthoritativeRepairRequired('unexpected_snapshot_quarantine');
            }

            foreach ($candidates as $row) {
                $safe = (string) $row['cache_path'];
                $abs = $this->cachePath . '/' . $safe;
                if (isset($statusBearingPaths[$safe])) {
                    // Remove stale/cross-tenant bytes immediately. Keep the
                    // status sidecar/map until the authoritative job can swap
                    // the host tree and reload nginx transactionally.
                    if ($this->quarantineStatusSnapshotHtml($statusBearingPaths[$safe])) {
                        $deletedTotal++;
                    }
                    continue;
                }
                if ($this->deleteSnapshotBundle($abs)) $deletedTotal++;
            }
        };
        if ($dryRun) {
            $process();
        } else {
            $this->withCacheMutationLock($process);
        }

        return [
            'deleted_total' => $deletedTotal,
            'by_tenant'     => $byTenant,
            'cache_paths'   => array_values(array_unique($cachePaths)),
            'dry_run'       => $dryRun,
            'authoritative_job_id' => $authoritativeJobId,
        ];
    }

    private function cmsPageExistsForTenant(int $tenantId, string $tenantLocalRoute): bool
    {
        if ($tenantId <= 0) return false;
        if (!preg_match('#^/page/([^/]+)$#', $tenantLocalRoute, $m)) return true;

        return DB::table('pages')
            ->where('tenant_id', $tenantId)
            ->where('slug', $m[1])
            ->where('is_published', 1)
            ->exists();
    }

    public function tenantOwnedRouteExistsForTenant(int $tenantId, string $tenantLocalRoute): bool
    {
        if (preg_match('#^/page/[^/]+$#', $tenantLocalRoute) === 1) {
            return $this->cmsPageExistsForTenant($tenantId, $tenantLocalRoute);
        }

        if (preg_match('#^/blog/([^/]+)$#', $tenantLocalRoute, $m) === 1) {
            return Schema::hasTable('posts')
                && DB::table('posts')
                    ->where('tenant_id', $tenantId)
                    ->where('slug', $m[1])
                    ->where('status', 'published')
                    ->exists();
        }

        if (preg_match('#^/listings/([0-9]+)$#', $tenantLocalRoute, $m) === 1) {
            return Schema::hasTable('listings')
                && DB::table('listings')
                    ->where('tenant_id', $tenantId)
                    ->where('id', (int) $m[1])
                    ->where('status', 'active')
                    ->where(function ($q) {
                        $q->whereNull('expires_at')->orWhere('expires_at', '>', DB::raw('NOW()'));
                    })
                    ->exists();
        }

        if (preg_match('#^/events/([0-9]+)$#', $tenantLocalRoute, $m) === 1) {
            return Schema::hasTable('events')
                && DB::table('events')
                    ->where('tenant_id', $tenantId)
                    ->where('id', (int) $m[1])
                    ->where(function ($q) {
                        $q->whereNull('status')->orWhereIn('status', ['active', 'completed']);
                    })
                    ->exists();
        }

        if (preg_match('#^/groups/([0-9]+)$#', $tenantLocalRoute, $m) === 1) {
            return Schema::hasTable('groups')
                && DB::table('groups')
                    ->where('tenant_id', $tenantId)
                    ->where('id', (int) $m[1])
                    ->where('visibility', 'public')
                    ->where('status', \App\Enums\GroupStatus::Active->value)
                    ->exists();
        }

        if (preg_match('#^/jobs/([0-9]+)$#', $tenantLocalRoute, $m) === 1) {
            return Schema::hasTable('job_vacancies')
                && DB::table('job_vacancies')
                    ->where('tenant_id', $tenantId)
                    ->where('id', (int) $m[1])
                    ->where('status', 'open')
                    ->exists();
        }

        if (preg_match('#^/volunteering/opportunities/([0-9]+)$#', $tenantLocalRoute, $m) === 1) {
            return Schema::hasTable('vol_opportunities')
                && Schema::hasTable('vol_organizations')
                && DB::table('vol_opportunities as opp')
                    ->join('vol_organizations as org', function ($join) {
                        $join->on('org.id', '=', 'opp.organization_id')
                            ->whereColumn('org.tenant_id', 'opp.tenant_id');
                    })
                    ->where('opp.tenant_id', $tenantId)
                    ->where('opp.id', (int) $m[1])
                    ->whereIn('opp.status', VolunteerService::PUBLIC_OPPORTUNITY_STATUSES)
                    ->where('opp.is_active', 1)
                    ->whereIn('org.status', VolunteerService::PUBLIC_ORGANIZATION_STATUSES)
                    ->exists();
        }

        if (preg_match('#^/ideation/([0-9]+)$#', $tenantLocalRoute, $m) === 1) {
            return Schema::hasTable('ideation_challenges')
                && DB::table('ideation_challenges')
                    ->where('tenant_id', $tenantId)
                    ->where('id', (int) $m[1])
                    ->whereIn('status', ['open', 'voting', 'evaluating'])
                    ->exists();
        }

        if (preg_match('#^/kb/([0-9]+)$#', $tenantLocalRoute, $m) === 1) {
            return Schema::hasTable('knowledge_base_articles')
                && DB::table('knowledge_base_articles')
                    ->where('tenant_id', $tenantId)
                    ->where('id', (int) $m[1])
                    ->where('is_published', 1)
                    ->exists();
        }

        if (preg_match('#^/organisations/([0-9]+)$#', $tenantLocalRoute, $m) === 1) {
            return Schema::hasTable('vol_organizations')
                && DB::table('vol_organizations')
                    ->where('tenant_id', $tenantId)
                    ->where('id', (int) $m[1])
                    ->whereIn('status', VolunteerService::PUBLIC_ORGANIZATION_STATUSES)
                    ->exists();
        }

        if (preg_match('#^/profile/([0-9]+)$#', $tenantLocalRoute, $m) === 1) {
            return Schema::hasTable('users')
                && DB::table('users')
                    ->where('tenant_id', $tenantId)
                    ->where('id', (int) $m[1])
                    ->where('is_approved', 1)
                    ->exists();
        }

        if (preg_match('#^/marketplace/([0-9]+)$#', $tenantLocalRoute, $m) === 1) {
            return Schema::hasTable('marketplace_listings')
                && DB::table('marketplace_listings')
                    ->where('tenant_id', $tenantId)
                    ->where('id', (int) $m[1])
                    ->where('status', 'active')
                    ->where('moderation_status', 'approved')
                    ->exists();
        }

        if (preg_match('#^/marketplace/category/([^/]+)$#', $tenantLocalRoute, $m) === 1) {
            return Schema::hasTable('marketplace_categories')
                && DB::table('marketplace_categories')
                    ->where(function ($q) use ($tenantId) {
                        $q->where('tenant_id', $tenantId)->orWhereNull('tenant_id');
                    })
                    ->where('slug', $m[1])
                    ->where('is_active', 1)
                    ->exists();
        }

        if (preg_match('#^/courses/([^/]+)$#', $tenantLocalRoute, $m) === 1) {
            return Schema::hasTable('courses')
                && DB::table('courses')
                    ->where('tenant_id', $tenantId)
                    ->where(function ($query) use ($m) {
                        $query->where('slug', $m[1]);
                        if (ctype_digit($m[1])) $query->orWhere('id', (int) $m[1]);
                    })
                    ->where('status', 'published')
                    ->where('moderation_status', 'approved')
                    ->where('visibility', 'public')
                    ->exists();
        }

        return false;
    }

    public function tenantRouteCanBePrerendered(int $tenantId, string $tenantLocalRoute, ?array $tenantTarget = null): bool
    {
        if ($tenantId <= 0 || $tenantLocalRoute === '' || $tenantLocalRoute[0] !== '/') {
            return false;
        }
        if (self::routeRequiresAuthentication($tenantLocalRoute)) {
            return false;
        }
        if ($this->isUnsupportedPublicRoute($tenantLocalRoute)) {
            return false;
        }

        if ($tenantTarget === null) {
            $tenantTarget = $this->tenantTargetById($tenantId);
        }
        if ($tenantTarget === null) {
            return false;
        }

        if (!$this->dynamicRouteGateAllows($tenantLocalRoute, $tenantTarget)) {
            return false;
        }

        if (self::routeRequiresTenantScope($tenantLocalRoute)) {
            return $this->tenantOwnedRouteExistsForTenant($tenantId, $tenantLocalRoute);
        }

        $tenantObject = (object) [
            'slug' => $tenantTarget['slug'] ?? null,
            'features' => $tenantTarget['features'] ?? null,
            'configuration' => $tenantTarget['configuration'] ?? null,
        ];

        return in_array($tenantLocalRoute, $this->routesForTenant($tenantObject), true);
    }

    private function isUnsupportedPublicRoute(string $route): bool
    {
        // React has a public /resources listing and /resources/{id}/download API,
        // but no visible /resources/{id} page. Keep resource changes scoped to
        // the listing snapshot instead of queuing snapshots that can only 404.
        // Profiles are deliberately excluded from sitemaps because the current
        // profile model has no explicit public-SEO consent contract.
        return (bool) preg_match('#^/(?:resources|profile)/[^/]+$#', $route);
    }

    /**
     * Apply the same tenant feature/module gates to detail routes that we use
     * for their listing pages. Existing records must not keep a route public
     * after the owning feature is disabled.
     *
     * @param array<string,mixed> $tenantTarget
     */
    private function dynamicRouteGateAllows(string $route, array $tenantTarget): bool
    {
        $featurePrefixes = [
            'blog' => ['/blog/'],
            'events' => ['/events/'],
            'groups' => ['/groups/'],
            'job_vacancies' => ['/jobs/'],
            'volunteering' => ['/volunteering/', '/organisations/'],
            'ideation_challenges' => ['/ideation/'],
            'resources' => ['/kb/'],
            'marketplace' => ['/marketplace/'],
            'courses' => ['/courses/'],
        ];
        $features = TenantFeatureConfig::mergeFeatures(
            $this->decodeJsonColumn($tenantTarget['features'] ?? null)
        );
        foreach ($featurePrefixes as $feature => $prefixes) {
            foreach ($prefixes as $prefix) {
                if (str_starts_with($route, $prefix)) {
                    return ($features[$feature] ?? false) === true;
                }
            }
        }

        if (str_starts_with($route, '/listings/')) {
            $configuration = $this->decodeJsonColumn($tenantTarget['configuration'] ?? null);
            $modules = TenantFeatureConfig::mergeModules(
                is_array($configuration['modules'] ?? null) ? $configuration['modules'] : []
            );
            return ($modules['listings'] ?? false) === true;
        }

        return true;
    }

    private function frontendHost(): string
    {
        $url = (string) env('FRONTEND_URL', 'https://app.project-nexus.ie');
        $parts = parse_url($url);
        $host = (string) ($parts['host'] ?? 'app.project-nexus.ie');
        return self::normalizeHost($host) ?? 'app.project-nexus.ie';
    }

    private function resolveTenantHost(string $slug): ?string
    {
        $target = $this->tenantTargetBySlug($slug);
        return $target['host'] ?? null;
    }

    /**
     * @param list<array{tenant_id:int, slug:string, host:string, prefix:string}> $targets
     * @return array<string,list<array{tenant_id:int, slug:string, host:string, prefix:string}>>
     */
    private function tenantTargetsByHost(array $targets): array
    {
        $byHost = [];
        foreach ($targets as $target) {
            $target['host'] = strtolower(rtrim((string) $target['host'], '.'));
            $byHost[$target['host']][] = $target;
        }
        foreach ($byHost as &$hostTargets) {
            usort(
                $hostTargets,
                fn($a, $b) => strlen((string) $b['prefix']) <=> strlen((string) $a['prefix'])
            );
        }
        unset($hostTargets);
        return $byHost;
    }

    /**
     * @param list<array{tenant_id:int, slug:string, host:string, prefix:string}> $targets
     * @return array{tenant_id:int, slug:string, host:string, prefix:string}|null
     */
    private function tenantTargetFromList(array $targets, string $slug): ?array
    {
        foreach ($targets as $target) {
            if ($target['slug'] === $slug) return $target;
        }
        return null;
    }

    /**
     * @return array{tenant_id:int, slug:string, host:string, prefix:string}|null
     */
    private function tenantTargetBySlug(string $slug): ?array
    {
        return $this->tenantTargetFromList($this->loadTenantTargets(), $slug);
    }

    /**
     * @return array{tenant_id:int, slug:string, host:string, prefix:string}|null
     */
    private function tenantTargetById(int $tenantId): ?array
    {
        foreach ($this->loadTenantTargets() as $target) {
            if ((int) $target['tenant_id'] === $tenantId) return $target;
        }
        return null;
    }

    /**
     * @param array<string,list<array{tenant_id:int, slug:string, host:string, prefix:string}>> $targetsByHost
     * @return array{0:array{tenant_id:int, slug:string, host:string, prefix:string}|null,1:string}
     */
    private function tenantAttributionForRoute(string $host, string $route, array $targetsByHost): array
    {
        $host = strtolower(rtrim($host, '.'));
        foreach ($targetsByHost[$host] ?? [] as $target) {
            if ($this->routeMatchesTenantTarget($route, $target)) {
                return [$target, $this->tenantLocalRoute($route, $target)];
            }
        }
        return [null, $route];
    }

    /**
     * @param array{host:string, prefix:string} $target
     */
    private function routeMatchesTenantTarget(string $route, array $target): bool
    {
        $prefix = (string) ($target['prefix'] ?? '');
        if ($prefix === '') return true;
        return $route === $prefix || str_starts_with($route, $prefix . '/');
    }

    /**
     * @param array{prefix:string} $target
     */
    private function tenantLocalRoute(string $route, array $target): string
    {
        $prefix = (string) ($target['prefix'] ?? '');
        if ($prefix === '') return $route;
        if ($route === $prefix) return '/';
        if (str_starts_with($route, $prefix . '/')) {
            $local = substr($route, strlen($prefix));
            return $local === '' ? '/' : $local;
        }
        return $route;
    }

    private function safeCachePath(string $rel): ?string
    {
        $rel = ltrim(str_replace('\\', '/', $rel), '/');
        if ($rel === '' || str_contains($rel, '..')) return null;
        // Match the route regex used elsewhere so legitimate routes containing
        // : @ ~ ( ) + , ; = ! $ * don't 404 the inspect drawer. The .. check
        // above plus the /index.html suffix guarantee path safety.
        if (!preg_match('#^[A-Za-z0-9._~/%:@!$()+,;=\-]+/index\.html$#', $rel)) return null;
        return $rel;
    }

    /**
     * Resolve an existing cache file and prove its final target is contained
     * by the configured cache root. The trailing separator prevents a sibling
     * such as `/prerendered-evil` from satisfying the prefix check.
     */
    private function resolveExistingCacheFile(string $candidate): ?string
    {
        $root = realpath($this->cachePath);
        $resolved = realpath($candidate);
        if ($root === false || $resolved === false || !is_file($resolved)) {
            return null;
        }

        $root = rtrim($root, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
        if (!str_starts_with($resolved, $root)) {
            return null;
        }

        return $resolved;
    }

    /**
     * Look up the TTL (seconds) for a route based on config/prerender.php
     * patterns. Most specific match wins; falls back to `default`.
     *
     * Glob semantics:
     *   `/`          — exact match only
     *   `/blog/*`    — direct children
     *   `/blog/**`   — every descendant
     */
    public function ttlForRoute(string $route): int
    {
        return $this->describeTtlForRoute($route)['ttl_seconds'];
    }

    /**
     * Same TTL resolution as ttlForRoute but returns full diagnostics — the
     * matched pattern, every candidate pattern that also matched, and the
     * winning specificity score. Powers the admin TTL inspector.
     *
     * @return array{route:string, ttl_seconds:int, matched_pattern:?string,
     *               source:string, all_matches:list<array{pattern:string,ttl:int,specificity:int}>}
     */
    public function describeTtlForRoute(string $route): array
    {
        $patterns = config('prerender.ttl', []);
        $defaultTtl = is_array($patterns) ? (int) ($patterns['default'] ?? 7 * 24 * 3600) : 7 * 24 * 3600;
        if (!is_array($patterns)) {
            return [
                'route'          => $route,
                'ttl_seconds'    => $defaultTtl,
                'matched_pattern'=> null,
                'source'         => 'default',
                'all_matches'    => [],
            ];
        }

        $best = null;
        $bestPat = null;
        $bestSpecificity = -1;
        $allMatches = [];
        foreach ($patterns as $pat => $ttl) {
            if ($pat === 'default') continue;
            if (!$this->routeMatchesPattern($route, $pat)) continue;
            $literal = strpos($pat, '*');
            $specificity = $literal === false ? strlen($pat) * 100 : $literal * 10 - substr_count($pat, '*');
            $allMatches[] = ['pattern' => $pat, 'ttl' => (int) $ttl, 'specificity' => $specificity];
            if ($specificity > $bestSpecificity) {
                $bestSpecificity = $specificity;
                $best = (int) $ttl;
                $bestPat = $pat;
            }
        }

        // Stable order for the UI.
        usort($allMatches, fn($a, $b) => $b['specificity'] <=> $a['specificity']);

        return [
            'route'          => $route,
            'ttl_seconds'    => $best ?? $defaultTtl,
            'matched_pattern'=> $bestPat,
            'source'         => $bestPat !== null ? 'pattern' : 'default',
            'all_matches'    => $allMatches,
        ];
    }

    private function routeMatchesPattern(string $route, string $pattern): bool
    {
        if ($route === $pattern) return true;
        $allowDoubleStar = str_contains($pattern, '**');
        $re = $this->globToRegex($pattern, $allowDoubleStar);
        return (bool) preg_match($re, $route);
    }

    /**
     * Verify the snapshot's content matches its `.sha256` sidecar (written by
     * the worker at render time).
     *
     * @return array{status: 'ok'|'missing'|'mismatch'|'unreadable', expected:?string, actual:?string}
     *   status = 'missing'   when no sidecar exists (older snapshots predate this feature)
     *   status = 'unreadable' when the sidecar is malformed
     *   status = 'mismatch'  when bytes have changed (corruption / tamper / partial write)
     *   status = 'ok'        when bytes match the recorded sha256
     */
    public function verifyIntegrity(string $absHtmlPath, ?string $htmlBytes = null): array
    {
        $sidecar = $absHtmlPath . '.sha256';
        if (!is_file($sidecar) || !is_readable($sidecar)) {
            return ['status' => 'missing', 'expected' => null, 'actual' => null];
        }
        $raw = trim((string) @file_get_contents($sidecar));
        // Format: "<hex>  <bytecount>". Be tolerant — accept hex alone too.
        if (!preg_match('/^([a-f0-9]{64})/i', $raw, $m)) {
            return ['status' => 'unreadable', 'expected' => null, 'actual' => null];
        }
        $expected = strtolower($m[1]);
        $actual = strtolower(hash('sha256', $htmlBytes ?? (string) @file_get_contents($absHtmlPath)));
        return [
            'status'   => hash_equals($expected, $actual) ? 'ok' : 'mismatch',
            'expected' => $expected,
            'actual'   => $actual,
        ];
    }

    /**
     * Read the worker's `_status` sidecar for a snapshot directory. Returns
     * 200 if absent (the implicit default).
     */
    private function readStatusSidecar(string $dir): int
    {
        $path = $dir . '/_status';
        if (!is_readable($path)) return 200;
        $raw = trim((string) @file_get_contents($path, false, null, 0, 8));
        $n = (int) $raw;
        return ($n >= 100 && $n < 600) ? $n : 200;
    }

    /** True only for sidecars that the nginx status-map compiler serves. */
    private function hasCompiledStatusSidecar(string $dir): bool
    {
        $path = $dir . '/_status';
        return is_file($path)
            && !is_link($path)
            && in_array($this->readStatusSidecar($dir), [404, 410, 503], true);
    }

    /** @return array{tenant_id:int,tenant_slug:string}|null */
    private function readTenantIdentitySidecar(string $dir): ?array
    {
        $path = $dir . '/_tenant.json';
        if (!is_readable($path)) return null;
        $decoded = json_decode((string) @file_get_contents($path), true);
        if (!is_array($decoded)) return null;

        $tenantId = (int) ($decoded['tenantId'] ?? 0);
        $tenantSlug = (string) ($decoded['tenantSlug'] ?? '');
        if ($tenantId <= 0 || preg_match('/^[A-Za-z0-9_-]{1,64}$/', $tenantSlug) !== 1) {
            return null;
        }

        return ['tenant_id' => $tenantId, 'tenant_slug' => $tenantSlug];
    }

    private function readJsonFile(string $path): ?array
    {
        if (!is_readable($path)) return null;
        $raw = @file_get_contents($path);
        if ($raw === false) return null;
        $data = json_decode($raw, true);
        return is_array($data) ? $data : null;
    }

    /**
     * Load the active frontend asset manifest as ['/assets/index-HASH.js' => true].
     * Written by the deploy script alongside snapshots.
     */
    private function loadValidAssets(): array
    {
        $data = $this->readJsonFile($this->assetsPath);
        if (!is_array($data)) return [];
        $out = [];
        foreach ($data as $name) {
            if (!is_string($name)) continue;
            $bare = explode('?', explode('#', $name)[0])[0];
            $out[$bare] = true;
        }
        return $out;
    }

    private function parseAssetRefs(string $absPath, array $validAssets): array
    {
        $html = (string) @file_get_contents($absPath, false, null, 0, 524_288);
        preg_match_all('#/assets/[A-Za-z0-9._/\-]+\.(?:js|css)#', $html, $m);
        $refs = array_values(array_unique($m[0] ?? []));
        $issues = [];
        if (!empty($validAssets)) {
            foreach ($refs as $r) {
                if (!isset($validAssets[$r])) $issues[] = $r;
            }
        }
        return [$refs, $issues];
    }

    /**
     * Snapshot of tenants.updated_at to detect content drift. NULL → epoch.
     *
     * @return array<int,int> tenant id => unix ts
     */
    private function loadTenantUpdatedAt(): array
    {
        $rows = DB::table('tenants')
            ->where('tenants.is_active', 1)
            ->select(
                'tenants.id',
                'tenants.updated_at'
            )
            ->get();
        $out = [];
        foreach ($rows as $r) {
            $ts = $r->updated_at ? strtotime((string) $r->updated_at) : 0;
            $out[(int) $r->id] = (int) $ts;
        }
        return $out;
    }

    /**
     * Latest content update timestamp per (host, route). Coarse, but good
     * enough to flag snapshots that pre-date their underlying content.
     *
     * Routes are matched by route-prefix:
     *   /blog       — newest posts.updated_at across the tenant
     *   /events     — newest events.updated_at
     *   /listings   — newest listings.updated_at
     *
     * @return array<int, array<string,int>>  tenant id => route => unix ts
     */
    private function loadContentUpdatedAt(): array
    {
        $tenantIds = DB::table('tenants')
            ->where('tenants.is_active', 1)
            ->pluck('id')
            ->mapWithKeys(fn($id) => [(int) $id => true])
            ->all();

        $out = [];

        $queries = [
            ['route' => '/blog',          'table' => 'posts',                    'col' => 'updated_at'],
            ['route' => '/events',        'table' => 'events',                   'col' => 'updated_at'],
            ['route' => '/listings',      'table' => 'listings',                 'col' => 'updated_at'],
            ['route' => '/groups',        'table' => 'groups',                   'col' => 'updated_at'],
            ['route' => '/jobs',          'table' => 'job_vacancies',            'col' => 'updated_at'],
            ['route' => '/volunteering',  'table' => 'vol_opportunities',        'col' => 'updated_at'],
            ['route' => '/organisations', 'table' => 'vol_organizations',        'col' => 'updated_at'],
            ['route' => '/ideation',      'table' => 'ideation_challenges',      'col' => 'updated_at'],
            ['route' => '/kb',            'table' => 'knowledge_base_articles',  'col' => 'updated_at'],
            ['route' => '/marketplace',   'table' => 'marketplace_listings',     'col' => 'updated_at'],
            ['route' => '/courses',       'table' => 'courses',                  'col' => 'updated_at'],
            ['route' => '/courses',       'table' => 'course_sections',          'col' => 'updated_at'],
            ['route' => '/courses',       'table' => 'course_lessons',           'col' => 'updated_at'],
            ['route' => '/courses',       'table' => 'course_reviews',           'col' => 'updated_at'],
        ];

        foreach ($queries as $q) {
            $route = $q['route'];
            if (!Schema::hasTable($q['table'])) continue;
            if (!Schema::hasColumn($q['table'], $q['col'])) continue;
            $timestampExpr = Schema::hasColumn($q['table'], 'created_at')
                ? "MAX(COALESCE({$q['col']}, created_at)) as ts"
                : "MAX({$q['col']}) as ts";
            $rows = DB::table($q['table'])
                ->select('tenant_id', DB::raw($timestampExpr))
                ->groupBy('tenant_id')
                ->get();
            foreach ($rows as $row) {
                $tenantId = (int) $row->tenant_id;
                if (!isset($tenantIds[$tenantId])) continue;
                $ts = $row->ts ? strtotime((string) $row->ts) : 0;
                $out[$tenantId][$route] = max($out[$tenantId][$route] ?? 0, (int) $ts);
            }
        }

        return $out;
    }

    private function checkContentStaleness(
        ?int $tenantId,
        string $tenantRoute,
        int $snapshotMtime,
        array $tenantUpdated,
        array $contentUpdated
    ): array {
        if ($tenantId === null) {
            return [false, null];
        }

        // Tenant-level changes (logo, meta description, h1, etc) invalidate
        // every route for that tenant.
        $tenantTs = $tenantUpdated[$tenantId] ?? 0;
        if ($tenantTs > $snapshotMtime + 60) {
            return [true, 'tenant settings updated ' . $this->ago($tenantTs) . ' (snapshot older)'];
        }

        // Route-specific content. Match by prefix so "/blog" covers
        // "/blog/post-1" too.
        foreach ($contentUpdated[$tenantId] ?? [] as $contentRoute => $ts) {
            if ($ts > $snapshotMtime + 60 && (str_starts_with($tenantRoute, $contentRoute) || $tenantRoute === $contentRoute)) {
                return [true, "{$contentRoute} content updated " . $this->ago($ts)];
            }
        }
        return [false, null];
    }

    private function ago(int $ts): string
    {
        $sec = max(0, time() - $ts);
        if ($sec < 3600)   return floor($sec / 60) . 'm ago';
        if ($sec < 86400)  return floor($sec / 3600) . 'h ago';
        return floor($sec / 86400) . 'd ago';
    }

    private function contentStalenessCounts(array $inventory): array
    {
        $contentStale = 0;
        foreach ($inventory as $row) {
            if (!empty($row['content_stale'])) $contentStale++;
        }
        return ['content_stale' => $contentStale];
    }

    private function countAssetInvalid(array $inventory): int
    {
        $n = 0;
        foreach ($inventory as $row) {
            if (!empty($row['asset_issues'])) $n++;
        }
        return $n;
    }

    private function normaliseJob(array $r): array
    {
        $status = ($r['fence_state'] ?? null) === self::FENCE_STATE_PENDING
            ? 'pending_fence'
            : (string) $r['status'];
        $user = null;
        if (!empty($r['requested_by'])) {
            $user = [
                'id'    => (int) $r['requested_by'],
                'name'  => trim(($r['user_first'] ?? '') . ' ' . ($r['user_last'] ?? '')),
                'email' => $r['user_email'] ?? null,
            ];
        }
        return [
            'id'             => (int) $r['id'],
            'status'         => $status,
            'tenant_id'      => $r['tenant_id'] !== null ? (int) $r['tenant_id'] : null,
            'tenant_slug'    => $r['tenant_slug'] ?? null,
            'routes'         => $r['routes'] ?? null,
            'force'          => (bool) $r['force_render'],
            'dry_run'        => (bool) $r['dry_run'],
            'authoritative_reset' => in_array(
                $r['fence_state'] ?? null,
                [self::FENCE_STATE_PENDING, self::FENCE_STATE_ACTIVATED],
                true
            ),
            'priority'       => isset($r['priority']) ? (int) $r['priority'] : self::PRIORITY_NORMAL,
            'planned_count'  => $r['planned_count'] !== null ? (int) $r['planned_count'] : null,
            'rendered_count' => $r['rendered_count'] !== null ? (int) $r['rendered_count'] : null,
            'invalid_count'  => $r['invalid_count'] !== null ? (int) $r['invalid_count'] : null,
            'duration_s'     => $r['duration_s'] !== null ? (int) $r['duration_s'] : null,
            'exit_code'      => $r['exit_code'] !== null ? (int) $r['exit_code'] : null,
            'log_excerpt'    => $r['log_excerpt'] ?? null,
            'error_message'  => $r['error_message'] ?? null,
            'claimed_by'     => $r['claimed_by'] ?? null,
            'queued_at'      => $r['queued_at'] ?? null,
            'fence_ready_at' => $r['fence_ready_at'] ?? null,
            'claimed_at'     => $r['claimed_at'] ?? null,
            'started_at'     => $r['started_at'] ?? null,
            'finished_at'    => $r['finished_at'] ?? null,
            'requested_by'   => $user,
        ];
    }

    private function firstNodeValue(?\DOMXPath $xp, string $expr): ?string
    {
        if (!$xp) return null;
        $nodes = $xp->query($expr);
        if (!$nodes || $nodes->length === 0) return null;
        return $nodes->item(0)->textContent;
    }

    private function firstAttr(?\DOMXPath $xp, string $expr, string $attr): ?string
    {
        if (!$xp) return null;
        $nodes = $xp->query($expr);
        if (!$nodes || $nodes->length === 0) return null;
        /** @var \DOMElement $node */
        $node = $nodes->item(0);
        $v = $node->getAttribute($attr);
        return $v === '' ? null : $v;
    }

    /**
     * Compute a 0-100 SEO score for a snapshot from its parsed flags. The
     * weights are deliberately simple — this is a hygiene signal, not a
     * comprehensive audit. Heavy SEO work belongs in a dedicated audit tool.
     *
     * Scoring rubric (max 100):
     *    title present + length 10–70    : 15
     *    meta description 50–160 chars   : 10
     *    canonical present + absolute    : 10
     *    og:title + og:description       : 10
     *    og:image                        :  5
     *    exactly one h1                  : 10
     *    JSON-LD present + valid         : 15
     *    no asset issues                 : 10
     *    has noscript fallback           :  5
     *    title doesn't repeat across site:  (deferred — needs corpus)
     *    body text >= 800 chars          : 10
     *
     * @param array $insp Result of inspect()
     */
    public function seoScore(array $insp): array
    {
        $score = 0;
        $issues = [];
        $tips = [];

        $title = (string) ($insp['title'] ?? '');
        $titleLen = mb_strlen($title);
        if ($titleLen >= 10 && $titleLen <= 70) {
            $score += 15;
        } elseif ($titleLen > 0) {
            $score += 5;
            $tips[] = $titleLen < 10 ? 'Title too short (<10 chars)' : 'Title too long (>70 chars)';
        } else {
            $issues[] = 'Missing <title>';
        }

        $desc = (string) ($insp['meta_description'] ?? '');
        $descLen = mb_strlen($desc);
        if ($descLen >= 50 && $descLen <= 160) {
            $score += 10;
        } elseif ($descLen > 0) {
            $score += 4;
            $tips[] = $descLen < 50 ? 'Meta description too short (<50 chars)' : 'Meta description too long (>160 chars)';
        } else {
            $issues[] = 'Missing meta description';
        }

        $canonical = (string) ($insp['canonical'] ?? '');
        if ($canonical !== '' && (str_starts_with($canonical, 'http://') || str_starts_with($canonical, 'https://'))) {
            $score += 10;
        } elseif ($canonical !== '') {
            $score += 3;
            $tips[] = 'Canonical should be an absolute URL';
        } else {
            $issues[] = 'Missing canonical link';
        }

        $og = $insp['og_tags'] ?? [];
        $hasOgTitle = isset($og['og:title']) && $og['og:title'] !== '';
        $hasOgDesc  = isset($og['og:description']) && $og['og:description'] !== '';
        $hasOgImage = isset($og['og:image']) && $og['og:image'] !== '';
        if ($hasOgTitle && $hasOgDesc) $score += 10;
        else $issues[] = 'Open Graph title/description incomplete';
        if ($hasOgImage) $score += 5;
        else $tips[] = 'Add og:image for richer social cards';

        $h1Count = is_array($insp['h1_texts'] ?? null) ? count($insp['h1_texts']) : 0;
        if ($h1Count === 1) $score += 10;
        elseif ($h1Count === 0) $issues[] = 'No <h1> on page';
        else { $score += 4; $tips[] = "Multiple <h1> tags ({$h1Count}) — use exactly one"; }

        $jsonLd = $insp['json_ld'] ?? [];
        $blocks = (int) ($jsonLd['blocks_count'] ?? 0);
        $allValid = (bool) ($jsonLd['all_valid'] ?? true);
        if ($blocks > 0 && $allValid) $score += 15;
        elseif ($blocks > 0) { $score += 5; $issues[] = 'Invalid JSON-LD block'; }
        else $tips[] = 'No structured data — consider adding JSON-LD';

        $assetIssues = is_array($insp['asset_issues'] ?? null) ? count($insp['asset_issues']) : 0;
        if ($assetIssues === 0) $score += 10;
        else $issues[] = "{$assetIssues} dead asset reference(s)";

        if (!empty($insp['flags']['has_noscript'])) $score += 5;
        else $tips[] = 'No <noscript> fallback';

        // Rough body-content signal from the preview snippet.
        $previewText = strip_tags((string) ($insp['preview'] ?? ''));
        if (mb_strlen($previewText) >= 800) $score += 10;
        elseif (mb_strlen($previewText) >= 300) $score += 4;
        else $issues[] = 'Body content very thin (<300 chars of text)';

        $score = max(0, min(100, $score));

        $grade = $score >= 90 ? 'A'
               : ($score >= 80 ? 'B'
               : ($score >= 65 ? 'C'
               : ($score >= 50 ? 'D' : 'F')));

        return [
            'score'  => $score,
            'grade'  => $grade,
            'issues' => array_values($issues),
            'tips'   => array_values($tips),
        ];
    }

    private function extractSchemaTypes(array $json): array
    {
        $types = [];
        $walk = function ($node) use (&$walk, &$types) {
            if (!is_array($node)) return;
            if (isset($node['@type'])) {
                $t = $node['@type'];
                if (is_string($t)) $types[] = $t;
                elseif (is_array($t)) foreach ($t as $tt) if (is_string($tt)) $types[] = $tt;
            }
            foreach ($node as $v) if (is_array($v)) $walk($v);
        };
        $walk($json);
        return array_values(array_unique($types));
    }

    private function escapePromLabel(string $s): string
    {
        return str_replace(['\\', '"', "\n"], ['\\\\', '\\"', '\\n'], $s);
    }

    // -------------------------------------------------------------------------
    // Audit log
    // -------------------------------------------------------------------------

    /**
     * Persist a single audit entry. Keep details to 8 KiB — anything more
     * goes in log_excerpt on the job row instead.
     */
    public function audit(
        string $action,
        ?int $actorUserId,
        ?int $tenantId = null,
        ?int $jobId = null,
        string $outcome = 'ok',
        ?array $details = null,
        ?string $ip = null,
        ?string $userAgent = null
    ): void {
        try {
            $this->persistAudit(
                $action,
                $actorUserId,
                $tenantId,
                $jobId,
                $outcome,
                $details,
                $ip,
                $userAgent
            );
        } catch (\Throwable $e) {
            // Auditing failures must NEVER block the underlying operation.
            Log::warning('Prerender audit insert failed', ['error' => $e->getMessage()]);
        }
    }

    /**
     * Persist one audit row without swallowing storage failures. The reset-all
     * success path calls this inside its intent transaction; public audit()
     * wraps it to preserve best-effort behaviour everywhere else.
     */
    private function persistAudit(
        string $action,
        ?int $actorUserId,
        ?int $tenantId = null,
        ?int $jobId = null,
        string $outcome = 'ok',
        ?array $details = null,
        ?string $ip = null,
        ?string $userAgent = null
    ): void {
        $detailsJson = $details === null ? null : json_encode(
            $this->sanitiseAuditDetails($details),
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
        );
        if (is_string($detailsJson) && strlen($detailsJson) > 8192) {
            // Never byte-slice JSON: the audit UI would receive malformed
            // data. Preserve a bounded, valid structural summary instead.
            $detailsJson = json_encode([
                'truncated' => true,
                'original_bytes' => strlen($detailsJson),
                'keys' => array_slice(array_map('strval', array_keys($details ?? [])), 0, 100),
            ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        }
        if ($outcome === 'failed') $outcome = 'error';
        $this->insertAuditRow([
            'actor_user_id' => $actorUserId,
            'action'        => substr($action, 0, 64),
            'tenant_id'     => $tenantId,
            'job_id'        => $jobId,
            'outcome'       => in_array($outcome, ['ok', 'denied', 'error'], true) ? $outcome : 'ok',
            'details'       => $detailsJson,
            'ip'            => $ip !== null ? substr($ip, 0, 64) : null,
            'user_agent'    => $userAgent !== null ? substr($userAgent, 0, 255) : null,
            'created_at'    => date('Y-m-d H:i:s'),
        ]);
    }

    /** @param array<string, mixed> $row */
    protected function insertAuditRow(array $row): void
    {
        DB::table('prerender_audit_log')->insert($row);
    }

    /**
     * Drop any obvious secrets from the audit body. Belt-and-braces — the
     * controller already validates payloads but a future endpoint could
     * forward sensitive fields.
     */
    private function sanitiseAuditDetails(array $details): array
    {
        $forbidden = ['password', 'token', 'secret', 'api_key', 'authorization', 'bearer'];
        foreach ($details as $k => $v) {
            $lower = strtolower((string) $k);
            foreach ($forbidden as $needle) {
                if (str_contains($lower, $needle)) {
                    $details[$k] = '[REDACTED]';
                    continue 2;
                }
            }
            if (is_array($v)) {
                $details[$k] = $this->sanitiseAuditDetails($v);
            }
        }
        return $details;
    }

    /**
     * Recent audit entries for the admin UI.
     *
     * @return list<array<string,mixed>>
     */
    public function recentAudit(int $limit = 100, ?string $action = null): array
    {
        $q = DB::table('prerender_audit_log as a')
            ->leftJoin('users as u', 'u.id', '=', 'a.actor_user_id')
            ->leftJoin('tenants as t', 't.id', '=', 'a.tenant_id')
            ->select(
                'a.*',
                'u.first_name as actor_first',
                'u.last_name as actor_last',
                'u.email as actor_email',
                't.slug as tenant_slug'
            )
            ->orderByDesc('a.id')
            ->limit(max(1, min(500, $limit)));
        if (is_string($action) && $action !== '') $q->where('a.action', $action);
        return $q->get()->map(function ($r) {
            $r = (array) $r;
            if (!empty($r['details']) && is_string($r['details'])) {
                $decoded = json_decode($r['details'], true);
                if (is_array($decoded)) $r['details'] = $decoded;
            }
            return $r;
        })->all();
    }

    // -------------------------------------------------------------------------
    // Health endpoint
    // -------------------------------------------------------------------------

    /**
     * Traffic-light health for the prerender engine.
     *
     * Status:
     *   green  — queue draining, no breaker, all checks pass
     *   yellow — degraded (stale queue, recent failures, missing dirs)
     *   red    — broken (cache unreachable, breaker tripped, queue jammed)
     *
     * Each component lists exactly what's wrong + an actionable suggestion
     * so operators don't have to dig through metrics to decide what to do.
     *
     * @return array{status:string, checks: list<array<string,mixed>>}
     */
    public function health(): array
    {
        $checks = [];
        $worst = 'green';
        $bump = function (string $s) use (&$worst) {
            $rank = ['green' => 0, 'yellow' => 1, 'red' => 2];
            if ($rank[$s] > $rank[$worst]) $worst = $s;
        };

        // 1. Cache filesystem.
        if ($this->cacheReadable()) {
            $checks[] = ['name' => 'cache_readable', 'status' => 'green', 'detail' => $this->cachePath];
        } else {
            $checks[] = [
                'name'   => 'cache_readable',
                'status' => 'red',
                'detail' => 'Snapshot cache directory not readable',
                'action' => "ls -la {$this->cachePath} on the host; check the nexus-php-prerendered volume mount",
            ];
            $bump('red');
        }

        if ($this->cacheWritable()) {
            $checks[] = ['name' => 'cache_writable', 'status' => 'green', 'detail' => 'Snapshot cache accepts worker writes'];
        } else {
            $checks[] = [
                'name'   => 'cache_writable',
                'status' => 'red',
                'detail' => 'Snapshot cache directory is not writable',
                'action' => "Fix permissions on {$this->cachePath}; the worker cannot publish fresh snapshots",
            ];
            $bump('red');
        }

        // 2. Tenant-aware route planner. Sample live tenants so broken JSON
        // feature flags, schema drift, or a bad planner regression shows up as
        // an operator-facing health problem before the worker fans out.
        try {
            $targets = $this->loadTenantTargets();
            $sampled = array_slice($targets, 0, 5);
            $empty = [];
            foreach ($sampled as $target) {
                if ($this->expectedRoutesForTenant(
                    $target,
                    self::MAX_PLANNED_ROUTES_PER_TENANT,
                    true
                ) === []) {
                    $empty[] = $target['slug'];
                }
            }
            if ($targets === []) {
                $checks[] = [
                    'name'   => 'route_planner',
                    'status' => 'yellow',
                    'detail' => 'No active tenant targets found',
                    'action' => 'Confirm active tenants exist before expecting snapshots',
                ];
                $bump('yellow');
            } elseif ($empty !== []) {
                $checks[] = [
                    'name'   => 'route_planner',
                    'status' => 'red',
                    'detail' => 'No routes planned for: ' . implode(', ', $empty),
                    'action' => 'Inspect tenant feature/module configuration and rerun prerender:plan-routes',
                ];
                $bump('red');
            } else {
                $checks[] = [
                    'name'   => 'route_planner',
                    'status' => 'green',
                    'detail' => 'Tenant-aware planner returned routes for ' . count($sampled) . ' sampled tenant(s)',
                ];
            }
        } catch (\Throwable $e) {
            $checks[] = [
                'name'   => 'route_planner',
                'status' => 'red',
                'detail' => 'Tenant-aware planner failed: ' . $e->getMessage(),
                'action' => 'Run php artisan prerender:plan-routes --tenant=<slug> and inspect the exception',
            ];
            $bump('red');
        }

        $hasJobsTable = Schema::hasTable('prerender_jobs');
        if (!$hasJobsTable) {
            $checks[] = [
                'name'   => 'job_table',
                'status' => 'yellow',
                'detail' => 'prerender_jobs table is not available yet',
                'action' => 'Run migrations before enabling the worker',
            ];
            $bump('yellow');
        } elseif (!$this->jobFenceSchemaCompatible()) {
            $checks[] = [
                'name'   => 'job_fence_schema',
                'status' => 'red',
                'detail' => 'The authoritative publisher fence migration is not installed',
                'action' => 'Run database migrations before using Reset all and rebuild',
            ];
            $bump('red');
        } else {
            $checks[] = [
                'name'   => 'job_fence_schema',
                'status' => 'green',
                'detail' => 'Durable publisher-fence activation is available',
            ];
        }

        // 3. Circuit breaker.
        $breakerUntil = $this->breakerTrippedUntil();
        if ($breakerUntil !== null) {
            $checks[] = [
                'name'   => 'circuit_breaker',
                'status' => 'red',
                'detail' => 'Breaker tripped until ' . date('c', $breakerUntil),
                'action' => 'POST /api/v2/admin/prerender/reset-breaker after fixing the root cause (check the latest failed jobs)',
            ];
            $bump('red');
        } else {
            $checks[] = ['name' => 'circuit_breaker', 'status' => 'green', 'detail' => 'Closed (normal)'];
        }

        // 4. Queue draining. Oldest queued row should be < 5 minutes old.
        $oldestQueued = null;
        if ($hasJobsTable) {
            $oldestQueueQuery = DB::table('prerender_jobs')->where('status', 'queued');
            if ($this->hasJobFenceColumn()) {
                $oldestQueueQuery->orWhere('fence_state', self::FENCE_STATE_PENDING);
            }
            $oldestQueued = $oldestQueueQuery->min('queued_at');
        }
        if ($oldestQueued !== null) {
            $ageS = max(0, time() - strtotime($oldestQueued));
            if ($ageS > 600) {
                $checks[] = [
                    'name'   => 'queue_age',
                    'status' => 'red',
                    'detail' => "Oldest queued job is {$ageS}s old (>10m)",
                    'action' => 'Check the host cron is running: sudo systemctl status cron && cat /etc/cron.d/nexus-prerender-processor',
                ];
                $bump('red');
            } elseif ($ageS > 120) {
                $checks[] = [
                    'name'   => 'queue_age',
                    'status' => 'yellow',
                    'detail' => "Oldest queued job is {$ageS}s old (>2m)",
                    'action' => 'Investigate if this persists; the worker may be slow or backed up',
                ];
                $bump('yellow');
            } else {
                $checks[] = ['name' => 'queue_age', 'status' => 'green', 'detail' => "Oldest queued: {$ageS}s"];
            }
        } else {
            $checks[] = ['name' => 'queue_age', 'status' => 'green', 'detail' => 'Queue empty'];
        }

        // 5. Recent failure rate.
        $cutoff = date('Y-m-d H:i:s', time() - self::BREAKER_WINDOW_SECONDS);
        $recentFails = $hasJobsTable
            ? DB::table('prerender_jobs')->where('status', 'failed')->where('finished_at', '>=', $cutoff)->count()
            : 0;
        if ($recentFails >= self::BREAKER_FAILURE_THRESHOLD) {
            $checks[] = [
                'name'   => 'recent_failures',
                'status' => 'red',
                'detail' => "{$recentFails} failed jobs in last 10m",
                'action' => 'Inspect the latest failed job for root cause',
            ];
            $bump('red');
        } elseif ($recentFails > 0) {
            $checks[] = [
                'name'   => 'recent_failures',
                'status' => 'yellow',
                'detail' => "{$recentFails} failed jobs in last 10m",
                'action' => 'One-off or transient; tolerate up to ' . self::BREAKER_FAILURE_THRESHOLD,
            ];
            $bump('yellow');
        } else {
            $checks[] = ['name' => 'recent_failures', 'status' => 'green', 'detail' => 'No recent failures'];
        }

        // 6. Stuck claimed/running rows. heartbeat_at is the renewable lease;
        // COALESCE preserves compatibility for pre-migration running rows.
        $stuckCutoff = date('Y-m-d H:i:s', time() - 1800);
        $hasHeartbeat = $hasJobsTable && $this->hasJobHeartbeatColumn();
        $stuck = $hasJobsTable
            ? DB::table('prerender_jobs')
                ->where(function ($query) use ($stuckCutoff, $hasHeartbeat): void {
                    $query->where(function ($claimed) use ($stuckCutoff): void {
                        $claimed->where('status', 'claimed')
                            ->where('claimed_at', '<', $stuckCutoff);
                    })->orWhere(function ($running) use ($stuckCutoff, $hasHeartbeat): void {
                        $running->where('status', 'running')
                            ->where(function ($lease) use ($stuckCutoff, $hasHeartbeat): void {
                                if ($hasHeartbeat) {
                                    $lease->whereRaw(
                                        'COALESCE(heartbeat_at, started_at) < ?',
                                        [$stuckCutoff]
                                    )->orWhere(function ($missing): void {
                                        $missing->whereNull('heartbeat_at')->whereNull('started_at');
                                    });
                                } else {
                                    $lease->where('started_at', '<', $stuckCutoff)
                                        ->orWhereNull('started_at');
                                }
                            });
                    });
                })
                ->count()
            : 0;
        if ($stuck > 0) {
            $checks[] = [
                'name'   => 'stuck_jobs',
                'status' => 'yellow',
                'detail' => "{$stuck} jobs have not renewed their lease for >30m",
                'action' => 'Run: docker exec nexus-php-app php artisan prerender:reap-stale',
            ];
            $bump('yellow');
        } else {
            $checks[] = ['name' => 'stuck_jobs', 'status' => 'green', 'detail' => 'No stuck jobs'];
        }

        // 7. Last completed / failed job context. These are not health
        // degraders on their own; they make the banner useful during incident
        // triage by showing the latest tenant pass/failure when data exists.
        if ($hasJobsTable) {
            $lastSuccess = DB::table('prerender_jobs as j')
                ->leftJoin('tenants as t', 't.id', '=', 'j.tenant_id')
                ->whereIn('j.status', ['completed', 'succeeded', 'partial'])
                ->orderByDesc('j.finished_at')
                ->orderByDesc('j.id')
                ->select('j.id', 't.slug as tenant_slug', 'j.routes', 'j.finished_at')
                ->first();
            $lastFailure = DB::table('prerender_jobs as j')
                ->leftJoin('tenants as t', 't.id', '=', 'j.tenant_id')
                ->where('j.status', 'failed')
                ->orderByDesc('j.finished_at')
                ->orderByDesc('j.id')
                ->select('j.id', 't.slug as tenant_slug', 'j.routes', 'j.finished_at', 'j.error_message')
                ->first();
            if ($lastSuccess) {
                $checks[] = [
                    'name'   => 'last_successful_pass',
                    'status' => 'green',
                    'detail' => sprintf(
                        '#%s %s at %s%s',
                        $lastSuccess->id,
                        $lastSuccess->tenant_slug ?: 'all tenants',
                        $lastSuccess->finished_at ?: 'unknown time',
                        $lastSuccess->routes ? ' routes: ' . $lastSuccess->routes : ''
                    ),
                ];
            }
            if ($lastFailure) {
                $checks[] = [
                    'name'   => 'last_failed_pass',
                    'status' => 'yellow',
                    'detail' => sprintf(
                        '#%s %s at %s: %s',
                        $lastFailure->id,
                        $lastFailure->tenant_slug ?: 'all tenants',
                        $lastFailure->finished_at ?: 'unknown time',
                        trim((string) $lastFailure->error_message) ?: 'No error message recorded'
                    ),
                    'action' => 'Open the job detail panel and inspect the worker log tail',
                ];
            }
        }

        // 8. Scheduler liveness. Each prerender:* cron stamps a cache key on
        // success; if the gap exceeds 3× the expected interval, the scheduler
        // itself is probably wedged (Laravel queue worker / supervisord
        // problem) and the engine is degrading silently.
        $expectations = [
            'prerender-detect-drift'  => 120,    // every 2 min  → alert at 6 min
            'prerender-auto-recache'  => 1200,   // every 20 min → alert at 60 min
            'prerender-reap-stale'    => 300,    // every 5 min  → alert at 15 min
        ];
        foreach ($expectations as $name => $interval) {
            $lastOk = (int) \Illuminate\Support\Facades\Cache::get('prerender:sched:' . $name . ':last_ok_at', 0);
            if ($lastOk === 0) {
                $checks[] = [
                    'name'   => 'sched_' . $name,
                    'status' => 'yellow',
                    'detail' => 'No successful run recorded yet',
                    'action' => 'Normal during the first few minutes after a deploy or cache flush',
                ];
                $bump('yellow');
                continue;
            }
            $ageS = time() - $lastOk;
            if ($ageS > $interval * 3) {
                $remediation = $name === 'prerender-reap-stale'
                    ? 'Verify /etc/cron.d/nexus-prerender-processor and the host reaper log'
                    : 'Verify the Laravel scheduler is running (supervisord nexus-scheduler unit)';
                $checks[] = [
                    'name'   => 'sched_' . $name,
                    'status' => 'red',
                    'detail' => "Last successful run {$ageS}s ago (expected every {$interval}s)",
                    'action' => $remediation,
                ];
                $bump('red');
            } elseif ($ageS > $interval * 2) {
                $checks[] = [
                    'name'   => 'sched_' . $name,
                    'status' => 'yellow',
                    'detail' => "Last successful run {$ageS}s ago (expected every {$interval}s)",
                ];
                $bump('yellow');
            } else {
                $checks[] = [
                    'name'   => 'sched_' . $name,
                    'status' => 'green',
                    'detail' => "Last successful run {$ageS}s ago",
                ];
            }
        }

        return [
            'status'       => $worst,
            'checked_at'   => date('c'),
            'breaker_until'=> $breakerUntil,
            'checks'       => $checks,
        ];
    }
}
