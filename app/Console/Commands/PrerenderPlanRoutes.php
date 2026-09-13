<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Console\Commands;

use App\Core\TenantContext;
use App\Services\PrerenderService;
use App\Services\SitemapService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Plan per-tenant route lists for prerender-tenants.sh.
 *
 * Combines the hardcoded EXPECTED_ROUTES (the static-page floor: /, /about,
 * /privacy, etc.) with the dynamic URLs SitemapService publishes (blog posts,
 * listings, events, jobs, KB articles, ...). Outputs JSON so the bash
 * orchestrator can read every (tenant, route) pair without re-implementing
 * the sitemap traversal in shell.
 *
 * Planning fails closed. The bash orchestrator must not substitute a generic
 * route list because that would omit tenant-owned content and can publish a
 * snapshot built with the wrong tenant configuration.
 */
class PrerenderPlanRoutes extends Command
{
    /** Hard cap to keep one tenant's plan from blowing up the run. */
    private const MAX_ROUTES_PER_TENANT = 50000;

    protected $signature = 'prerender:plan-routes '
        . '{--tenant= : Limit to a single tenant slug} '
        . '{--limit=' . self::MAX_ROUTES_PER_TENANT . ' : Max routes per tenant} '
        . '{--include-static=1 : Include the static-page floor} '
        . '{--include-sitemap=1 : Include sitemap-derived URLs}';

    protected $description = 'Emit JSON of (tenant, routes) pairs for the prerender orchestrator.';

    public function __construct(private readonly SitemapService $sitemap) {
        parent::__construct();
    }

    public function handle(): int
    {
        $tenantFilter = (string) ($this->option('tenant') ?? '');
        if ($tenantFilter !== '' && !preg_match('/^[A-Za-z0-9_-]+$/', $tenantFilter)) {
            $this->error('Invalid tenant slug.');
            return self::INVALID;
        }
        $limit = max(1, min(self::MAX_ROUTES_PER_TENANT, (int) $this->option('limit')));
        $includeStatic  = (int) $this->option('include-static') === 1;
        $includeSitemap = (int) $this->option('include-sitemap') === 1;

        $appHost = PrerenderService::normalizeHost((string) (
            parse_url((string) env('FRONTEND_URL', 'https://app.project-nexus.ie'), PHP_URL_HOST)
            ?: 'app.project-nexus.ie'
        ));
        if ($appHost === null) {
            $this->error('FRONTEND_URL contains an invalid host.');
            return self::FAILURE;
        }

        // 🔴 The platform master (id=1) IS prerendered. It was excluded here until
        // 2026-09-13, which meant `app.project-nexus.ie` — the master tenant's
        // public front page, the one that lists every community — had never been
        // prerendered at all, while still taking ~156 crawler visits a day and
        // serving every one of them the empty SPA shell.
        //
        // It is rendered at the APP HOST, never at its own `tenants.domain`.
        // Master's domain is `project-nexus.ie`, which Apache routes to the
        // separate sales-site container; snapshots written under that hostname
        // are never read by anything (48 such orphans were found and archived).
        $query = DB::table('tenants')
            ->where('is_active', 1)
            ->orderBy('id');
        if ($tenantFilter !== '') $query->where('slug', $tenantFilter);

        // Pull features + configuration so the resolver can gate routes
        // per-tenant without a second query loop.
        $prerender = app(PrerenderService::class);

        // Build a parent-domain lookup so sub-tenants (no own domain, has parent_id)
        // are prerendered at timebanking.uk/slug rather than app.project-nexus.ie/slug.
        $parentDomainMap = DB::table('tenants as p')
            ->join('tenants as c', 'c.parent_id', '=', 'p.id')
            ->where('p.id', '>', 1)          // exclude platform master (id=1)
            ->where('p.is_active', 1)
            ->where('c.is_active', 1)
            ->whereNotNull('p.domain')
            ->where('p.domain', '<>', '')
            ->where(function ($q) {
                $q->whereNull('c.domain')->orWhere('c.domain', '');
            })
            ->pluck('p.domain', 'c.id')
            ->map(fn ($d) => PrerenderService::normalizeHost((string) $d) ?? trim((string) $d))
            ->toArray(); // [child_id => parent_domain]

        $tenants = [];
        foreach ($query->get(['id', 'slug', 'domain', 'features', 'configuration']) as $t) {
            // Master is served at the app host root with no slug prefix, so its
            // slug never becomes a path segment and cannot collide with one.
            // Without this guard, renaming master's slug to any reserved word
            // would abort route planning for EVERY tenant, not just master.
            if ((int) $t->id !== 1 && TenantContext::isReservedPathSegment((string) $t->slug)) {
                $this->error("Route planning failed for tenant {$t->slug}: slug collides with a reserved platform path");
                return self::FAILURE;
            }
            $rawDomain = trim((string) ($t->domain ?? ''));
            $domain = $rawDomain === ''
                ? ''
                : (PrerenderService::normalizeHost($rawDomain) ?? $rawDomain);
            $parentDomain = $parentDomainMap[(int) $t->id] ?? '';
            if ((int) $t->id === 1) {
                // Master is reached at the app host with no slug prefix. Its own
                // `domain` belongs to the sales site — see the note on the query.
                $host   = $appHost;
                $prefix = '';
            } elseif ($domain !== '') {
                $host   = $domain;
                $prefix = '';
            } elseif ($parentDomain !== '') {
                $host   = $parentDomain;
                $prefix = '/' . $t->slug;
            } else {
                $host   = $appHost;
                $prefix = '/' . $t->slug;
            }
            $host = PrerenderService::normalizeHost((string) $host);
            if ($host === null) {
                $this->error("Route planning failed for tenant {$t->slug}: invalid canonical host");
                return self::FAILURE;
            }

            $routes = [];
            if ($includeStatic) {
                // Tenant-aware static floor — only routes whose feature/module
                // gate is on for this tenant. No more rendering /jobs for a
                // tenant with job_vacancies disabled.
                foreach ($prerender->routesForTenant($t) as $r) {
                    $routes[$r] = true;
                }
            }
            if ($includeSitemap) {
                try {
                    $sitemapRoutes = $this->routesFromSitemap((int) $t->id, $host, $prefix);
                } catch (\Throwable $e) {
                    $this->error("Route planning failed for tenant {$t->slug}: {$e->getMessage()}");
                    return self::FAILURE;
                }
                foreach ($sitemapRoutes as $r) {
                    if (!isset($routes[$r])) $routes[$r] = true;
                    if (count($routes) >= $limit) break;
                }
            }

            // SitemapService applies the protocol's 50,000-URL ceiling. Treat
            // reaching either that ceiling or an operator-supplied lower
            // limit as an incomplete plan rather than silently publishing a
            // partial tenant generation.
            if (count($routes) >= $limit) {
                $this->error(
                    "Route planning reached the {$limit}-route safety limit for tenant {$t->slug}; "
                    . 'refusing to emit a partial plan.'
                );
                return self::FAILURE;
            }

            $tenants[] = [
                'tenant_id' => (int) $t->id,
                'slug'      => (string) $t->slug,
                'host'      => $host,
                'prefix'    => $prefix,
                'routes'    => array_keys($routes),
            ];
        }

        $this->line(json_encode(
            ['tenants' => $tenants],
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
        ));
        return self::SUCCESS;
    }

    /**
     * Pull URLs from SitemapService and reduce them to tenant-local routes.
     * Strips the host and tenant prefix so prerender-tenants.sh can rebuild
     * full URLs the same way it does for the static floor.
     *
     * @return list<string>
     */
    private function routesFromSitemap(int $tenantId, string $host, string $prefix): array
    {
        // Build the sitemap as it would be served from the tenant's own base
        // URL. Failures propagate so the command cannot emit an incomplete,
        // static-only plan that would hide missing custom content.
        $baseUrl = 'https://' . $host . $prefix;
        $previousFreshSetting = config('prerender.runtime_force_fresh_sitemap', false);
        $previousBypassSetting = config('prerender.runtime_bypass_sitemap_cache', false);
        config([
            'prerender.runtime_force_fresh_sitemap' => true,
            'prerender.runtime_bypass_sitemap_cache' => true,
        ]);
        try {
            $xml = $this->sitemap->generateForTenant($tenantId, $baseUrl);
        } finally {
            config([
                'prerender.runtime_force_fresh_sitemap' => $previousFreshSetting,
                'prerender.runtime_bypass_sitemap_cache' => $previousBypassSetting,
            ]);
        }

        $routes = [];
        // Quick parse — Sitemaps are simple <loc> elements; XPath would also
        // work. Every valid tenant sitemap contains at least its homepage, so
        // no locations means the plan is incomplete and must fail closed.
        if (!preg_match_all('#<loc>([^<]+)</loc>#i', $xml, $m)) {
            throw new \RuntimeException('Tenant sitemap contains no route locations');
        }
        $rejected = [];
        foreach ($m[1] as $loc) {
            $loc = trim(html_entity_decode($loc, ENT_XML1 | ENT_QUOTES, 'UTF-8'));
            $parts = parse_url($loc);
            if (!is_array($parts)) {
                $rejected[] = [$loc, 'invalid URL'];
                continue;
            }
            $locHost = PrerenderService::normalizeHost((string) ($parts['host'] ?? ''));
            if (($parts['scheme'] ?? '') !== 'https' || $locHost !== $host) {
                $rejected[] = [$loc, 'wrong scheme or host'];
                continue;
            }
            $path = (string) ($parts['path'] ?? '/');
            // Strip tenant prefix; routes in the orchestrator are tenant-local
            // (the prefix gets re-applied during URL assembly).
            if ($prefix !== '' && str_starts_with($path, $prefix . '/')) {
                $path = substr($path, strlen($prefix));
            } elseif ($prefix !== '' && $path === $prefix) {
                $path = '/';
            } elseif ($prefix !== '') {
                $rejected[] = [$loc, 'outside tenant path prefix'];
                continue;
            }
            if ($path === '') $path = '/';
            $path = PrerenderService::normalizeRoute($path);
            if ($path === null) {
                $rejected[] = [$loc, 'unsafe or unrepresentable route'];
                continue;
            }
            if (PrerenderService::routeRequiresAuthentication($path)) {
                $rejected[] = [$loc, 'route requires authentication'];
                continue;
            }
            // Reject anything that has unsafe characters — the bash side
            // re-validates with the same regex.
            $routes[] = $path;
        }
        if ($rejected !== []) {
            [$firstLocation, $firstReason] = $rejected[0];
            throw new \RuntimeException(sprintf(
                'Tenant sitemap rejected %d route location(s); first: %s (%s)',
                count($rejected),
                mb_strimwidth((string) $firstLocation, 0, 240, '…', 'UTF-8'),
                $firstReason
            ));
        }
        $routes = array_values(array_unique($routes));
        if ($routes === []) {
            throw new \RuntimeException('Tenant sitemap contains no routes for its canonical host');
        }
        return $routes;
    }
}
