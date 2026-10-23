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
 * SitemapService — Generates XML sitemaps per the Sitemaps 0.9 protocol.
 *
 * Multi-tenant aware: produces a sitemap index listing per-tenant sitemaps,
 * and per-tenant sitemaps containing all public content URLs.
 *
 * Content URLs point to the React frontend (app.project-nexus.ie).
 * Sitemap XML is served from the API backend.
 *
 * Respects feature/module gates per tenant — only includes content types
 * that the tenant has enabled.
 */
class SitemapService
{
    private const CACHE_PREFIX = 'sitemap:';
    private const CACHE_TTL = 3600; // 1 hour
    private const MAX_URLS_PER_SITEMAP = 50000;

    // =========================================================================
    // Public API
    // =========================================================================

    /**
     * Generate the sitemap index XML listing all active tenant sitemaps.
     */
    public function generateIndex(): string
    {
        return Cache::remember(self::CACHE_PREFIX . 'index', self::CACHE_TTL, function () {
            $tenants = DB::select(
                "SELECT t.id, t.slug, t.domain, t.parent_id, t.updated_at,
                        p.domain as parent_domain
                 FROM tenants t
                 LEFT JOIN tenants p ON p.id = t.parent_id AND p.id <> 1 AND p.is_active = 1
                 WHERE t.is_active = 1 ORDER BY t.id"
            );

            $frontendBase = rtrim(env('FRONTEND_URL', 'https://app.project-nexus.ie'), '/');
            $sitemaps = [];

            foreach ($tenants as $tenant) {
                if (self::notListedReason((int) $tenant->id) !== null) {
                    continue;
                }
                $slug = (int) $tenant->id === 1 || empty($tenant->slug) ? 'main' : $tenant->slug;
                $target = self::targetFor((int) $tenant->id);
                if ($target !== null) {
                    // The sitemap file sits on the community's own host; the
                    // folder prefix belongs to its page addresses, not the file.
                    $sitemaps[] = [
                        'loc'     => self::targetOrigin($target) . "/sitemap-{$slug}.xml",
                        'lastmod' => $this->formatDate($tenant->updated_at),
                    ];
                    continue;
                }
                if (!empty($tenant->domain)) {
                    $base = 'https://' . rtrim($tenant->domain, '/');
                } elseif (!empty($tenant->parent_domain)) {
                    // Sub-tenant inheriting parent's domain — sitemap at parentdomain/slug
                    $base = 'https://' . rtrim($tenant->parent_domain, '/');
                } else {
                    $base = $frontendBase;
                }
                $sitemaps[] = [
                    'loc'     => "{$base}/sitemap-{$slug}.xml",
                    'lastmod' => $this->formatDate($tenant->updated_at),
                ];
            }

            return $this->buildSitemapIndexXml($sitemaps);
        });
    }

    /**
     * Generate sitemap XML for a specific tenant.
     * If $overrideBaseUrl is provided, use it instead of the tenant's domain.
     * This lets any domain serve a sitemap with its own URLs.
     */
    public function generateForTenant(int $tenantId, ?string $overrideBaseUrl = null): string
    {
        $version = (int) Cache::get($this->tenantVersionKey($tenantId), 1);
        $cacheKey = self::CACHE_PREFIX . "tenant:{$tenantId}:v{$version}" . ($overrideBaseUrl ? ':' . md5($overrideBaseUrl) : '');
        $generate = function () use ($tenantId, $overrideBaseUrl): string {
            $tenant = DB::selectOne(
                "SELECT id, slug, domain, parent_id, features, configuration FROM tenants WHERE id = ? AND is_active = 1",
                [$tenantId]
            );

            if (!$tenant) {
                return $this->buildUrlsetXml([]);
            }

            return $this->buildTenantSitemap($tenant, $overrideBaseUrl);
        };

        // Authoritative planners must observe their transaction's current DB
        // state without publishing uncommitted or rollback-prone bytes into
        // the public one-hour sitemap cache.
        if ((bool) config('prerender.runtime_bypass_sitemap_cache', false)) {
            return $generate();
        }
        if ((bool) config('prerender.runtime_force_fresh_sitemap', false)) {
            Cache::forget($cacheKey);
        }
        return Cache::remember($cacheKey, self::CACHE_TTL, $generate);
    }

    /**
     * Generate a combined sitemap for app.project-nexus.ie.
     * Includes all tenants that don't have their own custom domain,
     * with URLs prefixed by /{tenant-slug}/.
     */
    public function generateForAppDomain(): string
    {
        return Cache::remember(self::CACHE_PREFIX . 'app-domain', self::CACHE_TTL, function () {
            $tenants = DB::select(
                "SELECT t.id, t.slug, t.domain, t.parent_id, t.features, t.configuration,
                        p.domain as parent_domain
                 FROM tenants t
                 LEFT JOIN tenants p ON p.id = t.parent_id AND p.id <> 1 AND p.is_active = 1
                 WHERE t.is_active = 1 ORDER BY t.id"
            );

            $frontendBase = rtrim((string) (config('app.frontend_url') ?: 'https://app.project-nexus.ie'), '/');
            $allUrls = [];

            // Every community served on the app host, at the address the render
            // engine uses (targetFor): the platform master at the root, the
            // rest under /{slug}. Until 2026-10-23 this skipped any tenant with
            // a domain, which dropped the master (its domain is the sales
            // site), and it ignored the "Automatic sitemap" switch.
            $appHost = strtolower((string) (parse_url($frontendBase, PHP_URL_HOST) ?? ''));
            foreach ($tenants as $tenant) {
                $target = self::targetFor((int) $tenant->id);
                if ($target === null || $target['host'] !== $appHost) {
                    continue;
                }
                if (self::notListedReason((int) $tenant->id) !== null) {
                    continue;
                }
                $urls = $this->collectTenantUrls($tenant, self::targetOrigin($target) . $target['prefix']);
                $allUrls = array_merge($allUrls, $urls);
            }

            if (count($allUrls) > self::MAX_URLS_PER_SITEMAP) {
                $allUrls = array_slice($allUrls, 0, self::MAX_URLS_PER_SITEMAP);
            }

            return $this->buildUrlsetXml($allUrls);
        });
    }

    /**
     * Clear cached sitemaps. If tenantId is null, clears everything.
     */
    public function clearCache(?int $tenantId = null): int
    {
        $cleared = 0;

        if ($tenantId !== null) {
            Cache::forget(self::CACHE_PREFIX . "tenant:{$tenantId}");
            $this->bumpTenantVersion($tenantId);
            $cleared++;
        } else {
            // Clear all tenant caches
            $tenants = DB::select("SELECT id FROM tenants WHERE is_active = 1");
            foreach ($tenants as $tenant) {
                Cache::forget(self::CACHE_PREFIX . "tenant:{$tenant->id}");
                $tid = (int) $tenant->id;
                $this->bumpTenantVersion($tid);
                $cleared++;
            }
        }

        Cache::forget(self::CACHE_PREFIX . 'index');
        Cache::forget(self::CACHE_PREFIX . 'app-domain');
        $cleared++;

        return $cleared;
    }

    /** Advance the version under a distributed lock so invalidations cannot collapse. */
    private function bumpTenantVersion(int $tenantId): void
    {
        $versionKey = $this->tenantVersionKey($tenantId);
        Cache::lock($versionKey . ':lock', 10)->block(5, function () use ($versionKey): void {
            $current = max(1, (int) Cache::get($versionKey, 1));
            Cache::forever($versionKey, $current + 1);
        });
    }

    /**
     * Get statistics about what would be in the sitemap for a tenant.
     */
    public function getStats(int $tenantId): array
    {
        $tenant = DB::selectOne(
            "SELECT id, slug, domain, features, configuration FROM tenants WHERE id = ? AND is_active = 1",
            [$tenantId]
        );

        if (!$tenant) {
            return ['total_urls' => 0, 'content_types' => []];
        }

        $baseUrl = $this->resolveBaseUrl($tenant);
        $stats = [];

        $contentMethods = $this->getContentMethods($tenant);
        foreach ($contentMethods as $label => $method) {
            $urls = $method($tenantId, $baseUrl);
            $stats[$label] = count($urls);
        }

        // Static pages
        $staticUrls = $this->getStaticPageUrls($tenant, $baseUrl);
        $stats['static_pages'] = count($staticUrls);

        return [
            'total_urls' => array_sum($stats),
            'content_types' => $stats,
        ];
    }

    // =========================================================================
    // Core sitemap builder
    // =========================================================================

    private function buildTenantSitemap(object $tenant, ?string $overrideBaseUrl = null): string
    {
        $urls = $this->collectTenantUrls($tenant, $overrideBaseUrl);

        // Enforce protocol limit
        if (count($urls) > self::MAX_URLS_PER_SITEMAP) {
            Log::warning('Sitemap URL count exceeds limit', [
                'tenant_id' => (int) $tenant->id,
                'url_count' => count($urls),
                'max' => self::MAX_URLS_PER_SITEMAP,
            ]);
            // Public sitemap responses retain the protocol-compatible slice,
            // but authoritative/drift planning must never mistake that slice
            // for a complete tenant inventory and delete the omitted tail.
            if ((bool) config('prerender.runtime_force_fresh_sitemap', false)) {
                throw new \RuntimeException(sprintf(
                    'Tenant sitemap contains %d URLs and exceeds the %d-route authoritative safety limit',
                    count($urls),
                    self::MAX_URLS_PER_SITEMAP
                ));
            }
            $urls = array_slice($urls, 0, self::MAX_URLS_PER_SITEMAP);
        }

        return $this->buildUrlsetXml($urls);
    }

    /**
     * Collect all URLs for a tenant. Reusable by both single-tenant and app-domain sitemaps.
     */
    private function collectTenantUrls(object $tenant, ?string $overrideBaseUrl = null): array
    {
        $baseUrl = $overrideBaseUrl ?? $this->resolveBaseUrl($tenant);
        $tenantId = (int) $tenant->id;
        $urls = [];

        $urls = array_merge($urls, $this->getStaticPageUrls($tenant, $baseUrl));

        $contentMethods = $this->getContentMethods($tenant);
        foreach ($contentMethods as $method) {
            $urls = array_merge($urls, $method($tenantId, $baseUrl));
        }

        return $urls;
    }

    /**
     * Returns a map of label → callable for each enabled content type.
     */
    private function getContentMethods(object $tenant): array
    {
        $methods = [];

        // Published blog content is public and uses an author-free projection.
        if ($this->hasFeature($tenant, 'blog')) {
            $methods['blog_posts'] = fn (int $tid, string $base) => $this->getBlogUrls($tid, $base);
        }

        // Other member-authored feature pages require login and must never be
        // discoverable through a public sitemap. CMS pages remain public after
        // their separate content/consent review.
        $methods['cms_pages'] = fn (int $tid, string $base) => $this->getCmsPageUrls($tid, $base);

        if ($this->publicEventsOn($tenant)) {
            $methods['public_events'] = fn (int $tid, string $base) => $this->getPublicEventUrls($tid, $base);
        }

        return $methods;
    }

    // =========================================================================
    // Content URL generators
    // =========================================================================

    private function getStaticPageUrls(object $tenant, string $baseUrl): array
    {
        // No <lastmod> for fixed pages (2026-10-23). They used to claim they
        // changed today, every day: Google learns to ignore a sitemap's dates
        // when they are always "now", which also cost the real dates on blog
        // posts their value. The drift detector treats a missing date as "no
        // change" and leaves these to the TTL refresh (config/prerender.php).
        $now = null;
        $urls = [];

        // Homepage (highest priority — refreshes daily)
        $urls[] = $this->url($baseUrl, '/', $now, 'daily', '1.0');

        // About, help, contact, FAQ (always present)
        $urls[] = $this->url($baseUrl, '/about', $now, 'monthly', '0.6');
        $urls[] = $this->url($baseUrl, '/help', $now, 'monthly', '0.5');
        $urls[] = $this->url($baseUrl, '/contact', $now, 'yearly', '0.4');
        $urls[] = $this->url($baseUrl, '/faq', $now, 'monthly', '0.5');
        // Install instructions ("Get the app") — a public help page members are
        // pointed at from the profile menu, so it should be findable.
        $urls[] = $this->url($baseUrl, '/install-app', $now, 'monthly', '0.4');
        // Legal pages
        foreach (['terms', 'privacy', 'cookies', 'accessibility', 'acceptable-use', 'community-guidelines'] as $page) {
            $urls[] = $this->url($baseUrl, "/{$page}", $now, 'yearly', '0.2');
        }
        // Trust & Safety — higher priority than the legal documents because
        // it's the prospective-member-facing safety page, not boilerplate.
        $urls[] = $this->url($baseUrl, '/trust-and-safety', $now, 'monthly', '0.6');
        $urls[] = $this->url($baseUrl, '/account-deletion', $now, 'monthly', '0.6');
        $urls[] = $this->url($baseUrl, '/child-safety', $now, 'monthly', '0.6');
        // Legal hub & version history
        $urls[] = $this->url($baseUrl, '/legal', $now, 'monthly', '0.3');
        foreach (['terms', 'privacy', 'cookies', 'accessibility', 'acceptable-use', 'community-guidelines'] as $page) {
            $urls[] = $this->url($baseUrl, "/{$page}/versions", $now, 'monthly', '0.2');
        }

        // Platform-level legal pages
        foreach (['platform/terms', 'platform/privacy', 'platform/disclaimer'] as $page) {
            $urls[] = $this->url($baseUrl, "/{$page}", $now, 'yearly', '0.2');
        }

        // Timebanking guide (public educational content)
        $urls[] = $this->url($baseUrl, '/timebanking-guide', $now, 'monthly', '0.5');
        $urls[] = $this->url($baseUrl, '/regional-analytics', $now, 'monthly', '0.5');
        $urls[] = $this->url($baseUrl, '/features', $now, 'monthly', '0.5');
        $urls[] = $this->url($baseUrl, '/changelog', $now, 'weekly', '0.4');

        // Public pilot pages are available for every tenant.
        foreach (['pilot-inquiry', 'pilot-apply'] as $page) {
            $urls[] = $this->url($baseUrl, "/{$page}", $now, 'monthly', '0.5');
        }

        // These pages are implemented behind React's hour-timebank slug gate.
        // Other tenants redirect to /about, so publishing them elsewhere would
        // create sitemap aliases and make final-URL validation fail.
        if (strtolower(trim((string) ($tenant->slug ?? ''))) === 'hour-timebank') {
            foreach (['partner', 'social-prescribing', 'impact-summary', 'impact-report', 'strategic-plan'] as $page) {
                $urls[] = $this->url($baseUrl, "/{$page}", $now, 'monthly', '0.5');
            }
        }

        // Public Partner API developer documentation.
        foreach (['developers', 'developers/auth', 'developers/endpoints', 'developers/webhooks'] as $page) {
            $urls[] = $this->url($baseUrl, "/{$page}", $now, 'monthly', '0.5');
        }

        // NOTE: /members and /leaderboard are PROTECTED routes (require auth).
        // Do NOT add them to the sitemap — crawlers cannot access them.

        // The sanitized blog index is public acquisition content.
        if ($this->hasFeature($tenant, 'blog')) {
            $urls[] = $this->url($baseUrl, '/blog', $now, 'daily', '0.8');
        }

        // Other member-authored modules are authenticated and intentionally
        // excluded. Coupons are organization-level public content.
        if ($this->hasFeature($tenant, 'merchant_coupons')) {
            $urls[] = $this->url($baseUrl, '/coupons', $now, 'daily', '0.6');
        }

        // Public events advertising ("What's On"), on only when the community
        // opted in with both switches — the same gate as the route and the API.
        if ($this->publicEventsOn($tenant)) {
            $urls[] = $this->url($baseUrl, '/whats-on', $now, 'daily', '0.7');
        }

        return $urls;
    }

    private function publicEventsOn(object $tenant): bool
    {
        return $this->hasFeature($tenant, 'events') && $this->hasFeature($tenant, 'public_events');
    }

    /**
     * Each event a community advertises publicly (/whats-on/{id}), using the
     * same rule as GET /v2/public/events/{id}: listed publicly, published,
     * and not in a private group (EventService::publicSitemapEntries).
     */
    private function getPublicEventUrls(int $tenantId, string $baseUrl): array
    {
        return array_map(
            fn (array $r) => $this->url($baseUrl, "/whats-on/{$r['id']}", $this->formatDate($r['lastmod']), 'weekly', '0.6'),
            EventService::publicSitemapEntries($tenantId)
        );
    }

    /**
     * Posts the admin marked "noindex" (seo_metadata) are left out (2026-10-23):
     * the page itself tells crawlers not to index it, so listing it here sent
     * search engines two contradicting signals.
     */
    private function getBlogUrls(int $tenantId, string $baseUrl): array
    {
        // Blog data lives in the `posts` table (not `blog_posts` which is empty).
        // The `posts` table has no `published_at` column — use updated_at/created_at.
        $rows = DB::select(
            "SELECT p.slug, COALESCE(p.updated_at, p.created_at) AS lastmod
             FROM posts p
             WHERE p.tenant_id = ? AND p.status = 'published'
               AND p.slug NOT IN ('aenean-sed-pulvinar-et-diam')
               AND LOWER(CONCAT_WS(' ', p.title, p.excerpt, p.content, p.html_render)) NOT LIKE ?
               AND NOT EXISTS (
                   SELECT 1 FROM seo_metadata sm
                    WHERE sm.tenant_id = p.tenant_id AND sm.entity_type = 'post'
                      AND sm.entity_id = p.id AND sm.noindex = 1
               )
             ORDER BY p.created_at DESC",
            [$tenantId, '%lorem ipsum%']
        );

        return array_map(
            fn ($r) => $this->url($baseUrl, "/blog/{$r->slug}", $this->formatDate($r->lastmod), 'weekly', '0.7'),
            $rows
        );
    }

    private function getListingUrls(int $tenantId, string $baseUrl): array
    {
        $rows = DB::select(
            "SELECT id, COALESCE(updated_at, created_at) AS lastmod
             FROM listings
             WHERE tenant_id = ? AND status = 'active'
               AND (expires_at IS NULL OR expires_at > NOW())
             ORDER BY created_at DESC",
            [$tenantId]
        );

        return array_map(
            fn ($r) => $this->url($baseUrl, "/listings/{$r->id}", $this->formatDate($r->lastmod), 'weekly', '0.6'),
            $rows
        );
    }

    private function getEventUrls(int $tenantId, string $baseUrl): array
    {
        // Include both future and past active/completed events for SEO archival value.
        // Exclude cancelled and draft events.
        $rows = DB::select(
            "SELECT id, COALESCE(updated_at, created_at) AS lastmod
             FROM events
             WHERE tenant_id = ? AND (status IS NULL OR status IN ('active', 'completed'))
             ORDER BY start_time DESC",
            [$tenantId]
        );

        return array_map(
            fn ($r) => $this->url($baseUrl, "/events/{$r->id}", $this->formatDate($r->lastmod), 'weekly', '0.7'),
            $rows
        );
    }

    private function getCourseUrls(int $tenantId, string $baseUrl): array
    {
        $rows = DB::select(
            "SELECT c.slug,
                    GREATEST(
                        COALESCE(c.updated_at, c.created_at),
                        COALESCE((SELECT MAX(s.updated_at) FROM course_sections s
                                  WHERE s.tenant_id = c.tenant_id AND s.course_id = c.id), c.created_at),
                        COALESCE((SELECT MAX(l.updated_at) FROM course_lessons l
                                  WHERE l.tenant_id = c.tenant_id AND l.course_id = c.id), c.created_at),
                        COALESCE((SELECT MAX(r.updated_at) FROM course_reviews r
                                  WHERE r.tenant_id = c.tenant_id
                                    AND r.course_id = c.id
                                    AND r.status = 'approved'), c.created_at)
                    ) AS lastmod
             FROM courses c
             WHERE c.tenant_id = ?
               AND c.status = 'published'
               AND c.moderation_status = 'approved'
               AND c.visibility = 'public'
             ORDER BY COALESCE(c.published_at, c.created_at) DESC",
            [$tenantId]
        );

        return array_map(
            fn ($r) => $this->url($baseUrl, "/courses/{$r->slug}", $this->formatDate($r->lastmod), 'weekly', '0.7'),
            $rows
        );
    }

    private function getGroupUrls(int $tenantId, string $baseUrl): array
    {
        $rows = DB::select(
            "SELECT id, COALESCE(updated_at, created_at) AS lastmod
             FROM `groups`
             WHERE tenant_id = ? AND visibility = 'public' AND is_active = 1
             ORDER BY COALESCE(updated_at, created_at) DESC",
            [$tenantId]
        );

        return array_map(
            fn ($r) => $this->url($baseUrl, "/groups/{$r->id}", $this->formatDate($r->lastmod), 'weekly', '0.6'),
            $rows
        );
    }

    private function getJobUrls(int $tenantId, string $baseUrl): array
    {
        $rows = DB::select(
            "SELECT id, COALESCE(updated_at, created_at) AS lastmod
             FROM job_vacancies
             WHERE tenant_id = ? AND status = 'open'
             ORDER BY created_at DESC",
            [$tenantId]
        );

        return array_map(
            fn ($r) => $this->url($baseUrl, "/jobs/{$r->id}", $this->formatDate($r->lastmod), 'daily', '0.7'),
            $rows
        );
    }

    private function getVolunteeringUrls(int $tenantId, string $baseUrl): array
    {
        $rows = DB::select(
            "SELECT opp.id, COALESCE(opp.updated_at, opp.created_at) AS lastmod
             FROM vol_opportunities opp
             JOIN vol_organizations org
               ON org.id = opp.organization_id
              AND org.tenant_id = opp.tenant_id
             WHERE opp.tenant_id = ?
               AND opp.status IN (?, ?)
               AND opp.is_active = 1
               AND org.status IN (?, ?)
             ORDER BY COALESCE(opp.updated_at, opp.created_at) DESC",
            [
                $tenantId,
                ...VolunteerService::PUBLIC_OPPORTUNITY_STATUSES,
                ...VolunteerService::PUBLIC_ORGANIZATION_STATUSES,
            ]
        );

        return array_map(
            fn ($r) => $this->url($baseUrl, "/volunteering/opportunities/{$r->id}", $this->formatDate($r->lastmod), 'weekly', '0.6'),
            $rows
        );
    }

    private function getIdeationUrls(int $tenantId, string $baseUrl): array
    {
        $rows = DB::select(
            "SELECT id, COALESCE(updated_at, created_at) AS lastmod
             FROM ideation_challenges
             WHERE tenant_id = ? AND status IN ('open', 'voting', 'evaluating')
             ORDER BY created_at DESC",
            [$tenantId]
        );

        return array_map(
            fn ($r) => $this->url($baseUrl, "/ideation/{$r->id}", $this->formatDate($r->lastmod), 'weekly', '0.6'),
            $rows
        );
    }

    private function getMarketplaceListingUrls(int $tenantId, string $baseUrl): array
    {
        if (!Schema::hasTable('marketplace_listings')) {
            return [];
        }

        $rows = DB::select(
            "SELECT id, COALESCE(updated_at, created_at) AS lastmod
             FROM marketplace_listings
             WHERE tenant_id = ? AND status = 'active' AND moderation_status = 'approved'
             ORDER BY created_at DESC",
            [$tenantId]
        );

        return array_map(
            fn ($r) => $this->url($baseUrl, "/marketplace/{$r->id}", $this->formatDate($r->lastmod), 'weekly', '0.7'),
            $rows
        );
    }

    private function getMarketplaceCategoryUrls(int $tenantId, string $baseUrl): array
    {
        if (!Schema::hasTable('marketplace_categories')) {
            return [];
        }

        $rows = DB::select(
            "SELECT slug, COALESCE(updated_at, created_at) AS lastmod
             FROM marketplace_categories
             WHERE (tenant_id = ? OR tenant_id IS NULL) AND is_active = 1
             ORDER BY sort_order ASC",
            [$tenantId]
        );

        return array_map(
            fn ($r) => $this->url($baseUrl, "/marketplace/category/{$r->slug}", $this->formatDate($r->lastmod), 'weekly', '0.6'),
            $rows
        );
    }

    private function getCmsPageUrls(int $tenantId, string $baseUrl): array
    {
        $rows = DB::select(
            "SELECT p.slug, COALESCE(p.updated_at, p.created_at) AS lastmod
             FROM pages p
             WHERE p.tenant_id = ? AND p.is_published = 1
               AND NOT EXISTS (
                   SELECT 1 FROM seo_metadata sm
                    WHERE sm.tenant_id = p.tenant_id AND sm.entity_type = 'page'
                      AND sm.entity_id = p.id AND sm.noindex = 1
               )
             ORDER BY p.created_at DESC",
            [$tenantId]
        );

        return array_map(
            fn ($r) => $this->url($baseUrl, "/page/{$r->slug}", $this->formatDate($r->lastmod), 'monthly', '0.5'),
            $rows
        );
    }

    private function getKbArticleUrls(int $tenantId, string $baseUrl): array
    {
        $rows = DB::select(
            "SELECT id, COALESCE(updated_at, created_at) AS lastmod
             FROM knowledge_base_articles
             WHERE tenant_id = ? AND is_published = 1
             ORDER BY created_at DESC",
            [$tenantId]
        );

        return array_map(
            fn ($r) => $this->url($baseUrl, "/kb/{$r->id}", $this->formatDate($r->lastmod), 'monthly', '0.6'),
            $rows
        );
    }

    private function getOrganizationUrls(int $tenantId, string $baseUrl): array
    {
        $rows = DB::select(
            "SELECT id, COALESCE(updated_at, created_at) AS lastmod
             FROM vol_organizations
             WHERE tenant_id = ? AND status IN (?, ?)
             ORDER BY COALESCE(updated_at, created_at) DESC",
            [$tenantId, ...VolunteerService::PUBLIC_ORGANIZATION_STATUSES]
        );

        return array_map(
            fn ($r) => $this->url($baseUrl, "/organisations/{$r->id}", $this->formatDate($r->lastmod), 'monthly', '0.5'),
            $rows
        );
    }

    private function getProfileUrls(int $tenantId, string $baseUrl): array
    {
        $rows = DB::select(
            "SELECT id, created_at AS lastmod
             FROM users
             WHERE tenant_id = ? AND is_approved = 1
             ORDER BY created_at DESC",
            [$tenantId]
        );

        return array_map(
            fn ($r) => $this->url($baseUrl, "/profile/{$r->id}", $this->formatDate($r->lastmod), 'monthly', '0.3'),
            $rows
        );
    }

    private function getHelpArticleUrls(int $tenantId, string $baseUrl): array
    {
        // React help center is at /help (list view only) — individual articles
        // are rendered inline within the help center, not as separate routes.
        // We include the help center listing page in static URLs instead.
        // No individual article URLs to generate.
        return [];
    }

    // =========================================================================
    // XML builders
    // =========================================================================

    private function buildUrlsetXml(array $urls): string
    {
        $xml = '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
        $xml .= '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';
        $xml .= ' xmlns:xhtml="http://www.w3.org/1999/xhtml">' . "\n";

        foreach ($urls as $entry) {
            $xml .= "  <url>\n";
            $xml .= "    <loc>" . $this->escapeXml($entry['loc']) . "</loc>\n";
            if (!empty($entry['lastmod'])) {
                $xml .= "    <lastmod>{$entry['lastmod']}</lastmod>\n";
            }
            if (!empty($entry['changefreq'])) {
                $xml .= "    <changefreq>{$entry['changefreq']}</changefreq>\n";
            }
            if (!empty($entry['priority'])) {
                $xml .= "    <priority>{$entry['priority']}</priority>\n";
            }
            $xml .= "  </url>\n";
        }

        $xml .= "</urlset>\n";

        return $xml;
    }

    /**
     * Public wrapper used by SitemapController for per-domain sitemap indexes.
     * @param list<array{loc: string, lastmod: ?string}> $sitemaps
     */
    public function buildSitemapIndexPublic(array $sitemaps): string
    {
        return $this->buildSitemapIndexXml($sitemaps);
    }

    private function buildSitemapIndexXml(array $sitemaps): string
    {
        $xml = '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
        $xml .= '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";

        foreach ($sitemaps as $entry) {
            $xml .= "  <sitemap>\n";
            $xml .= "    <loc>" . $this->escapeXml($entry['loc']) . "</loc>\n";
            if (!empty($entry['lastmod'])) {
                $xml .= "    <lastmod>{$entry['lastmod']}</lastmod>\n";
            }
            $xml .= "  </sitemap>\n";
        }

        $xml .= "</sitemapindex>\n";

        return $xml;
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    /**
     * Build a URL entry array.
     */
    private function url(string $baseUrl, string $path, ?string $lastmod, string $changefreq, string $priority): array
    {
        return [
            'loc' => rtrim($baseUrl, '/') . $path,
            'lastmod' => $lastmod,
            'changefreq' => $changefreq,
            'priority' => $priority,
        ];
    }

    /**
     * Resolve the frontend base URL for a tenant's content.
     * Includes the tenant slug prefix for non-master tenants.
     */
    private function resolveBaseUrl(object $tenant): string
    {
        // One answer for "where does this community live", shared with the
        // render engine, redirects and the sitemap routes (2026-10-23). The
        // fallback below differed for the master community (its own domain is
        // the sales site, not the app).
        $target = self::targetFor((int) $tenant->id);
        if ($target !== null) {
            return self::targetOrigin($target) . $target['prefix'];
        }

        // Custom domain takes priority
        if (!empty($tenant->domain)) {
            return 'https://' . rtrim($tenant->domain, '/');
        }

        // Sub-tenant: use parent's domain if available (e.g. timebanking.uk/cardiff)
        if (!empty($tenant->parent_id) && (int) $tenant->parent_id !== 1) {
            $parentDomain = DB::selectOne(
                "SELECT domain FROM tenants WHERE id = ? AND is_active = 1",
                [(int) $tenant->parent_id]
            )?->domain ?? '';
            if (!empty($parentDomain)) {
                return 'https://' . rtrim($parentDomain, '/') . '/' . $tenant->slug;
            }
        }

        $frontendBase = rtrim(
            env('FRONTEND_URL', 'https://app.project-nexus.ie'),
            '/'
        );

        // Master tenant (empty slug) has no prefix
        if (empty($tenant->slug)) {
            return $frontendBase;
        }

        return $frontendBase . '/' . $tenant->slug;
    }

    /**
     * The community's public address (host + folder prefix), as the render
     * engine sees it: PrerenderService::loadTenantTargets().
     *
     * @return array{tenant_id:int, slug:string, host:string, prefix:string}|null
     */
    public static function targetFor(int $tenantId): ?array
    {
        foreach (app(PrerenderService::class)->loadTenantTargets() as $t) {
            if ((int) $t['tenant_id'] === $tenantId) {
                return $t;
            }
        }
        return null;
    }

    /**
     * Whether the community told search engines not to index it
     * (tenants.robots_directive contains "noindex", set on /admin/seo or the
     * super-admin tenant form). Public sitemaps leave such a community out;
     * the render planners do not consult this.
     */
    public static function isNoindexTenant(int $tenantId): bool
    {
        try {
            $directive = (string) (DB::table('tenants')->where('id', $tenantId)->value('robots_directive') ?? '');
        } catch (\Throwable) {
            return false;
        }
        return stripos($directive, 'noindex') !== false;
    }

    /**
     * Scheme + host for a target. The app host keeps FRONTEND_URL's own scheme
     * and port (http://localhost:5173 locally); every community domain is https.
     *
     * @param array{host:string} $target
     */
    public static function targetOrigin(array $target): string
    {
        $frontend = rtrim((string) (config('app.frontend_url') ?: 'https://app.project-nexus.ie'), '/');
        $frontendHost = strtolower((string) (parse_url($frontend, PHP_URL_HOST) ?? ''));
        if ($frontendHost !== '' && $frontendHost === $target['host']) {
            return (string) preg_replace('#^(https?://[^/]+).*$#i', '$1', $frontend);
        }
        return 'https://' . $target['host'];
    }

    /**
     * Get the API backend base URL (where sitemaps are served from).
     */
    private function getApiBaseUrl(): string
    {
        return rtrim(env('APP_URL', 'https://api.project-nexus.ie'), '/');
    }

    /**
     * Check if a tenant has a specific feature enabled.
     * Features default to true per TenantFeatureConfig::FEATURE_DEFAULTS.
     */
    private function hasFeature(object $tenant, string $feature): bool
    {
        $features = json_decode($tenant->features ?? '{}', true) ?: [];
        $features = TenantFeatureConfig::mergeFeatures($features);

        return ($features[$feature] ?? false) === true;
    }

    /**
     * Check if a tenant has a specific module enabled.
     * Modules default to true.
     */
    private function hasModule(object $tenant, string $module): bool
    {
        $config = json_decode($tenant->configuration ?? '{}', true) ?: [];
        $modules = TenantFeatureConfig::mergeModules(
            is_array($config['modules'] ?? null) ? $config['modules'] : []
        );

        return ($modules[$module] ?? false) === true;
    }

    /**
     * Bumped on every clearCache() for the community (content saves, settings
     * saves, the observers). Other per-community caches built from the same
     * data (llms.txt) put it in their key so a save refreshes them too.
     */
    public static function cacheVersion(int $tenantId): int
    {
        return max(1, (int) Cache::get(self::CACHE_PREFIX . "tenant:{$tenantId}:version", 1));
    }

    /**
     * The "Automatic sitemap" switch on /admin/seo (`seo_auto_sitemap`, bare
     * key in tenant_settings, default on). Off means no public sitemap.
     */
    public static function isSitemapSwitchedOff(int $tenantId): bool
    {
        try {
            $value = DB::table('tenant_settings')
                ->where('tenant_id', $tenantId)
                ->where('setting_key', 'seo_auto_sitemap')
                ->value('setting_value');
        } catch (\Throwable) {
            return false;
        }
        return $value !== null && in_array(strtolower(trim((string) $value)), ['0', 'false', 'off', 'no'], true);
    }

    /** Why a community publishes no sitemap: 'noindex', 'switched_off', or null when it does. */
    public static function notListedReason(int $tenantId): ?string
    {
        if (self::isNoindexTenant($tenantId)) {
            return 'noindex';
        }
        return self::isSitemapSwitchedOff($tenantId) ? 'switched_off' : null;
    }

    private function tenantVersionKey(int $tenantId): string
    {
        return self::CACHE_PREFIX . "tenant:{$tenantId}:version";
    }

    /**
     * Format a date/datetime string as an ISO 8601 timestamp. Internal drift
     * detection relies on same-day edits retaining their time component.
     */
    private function formatDate(?string $datetime): ?string
    {
        if (empty($datetime)) {
            return null;
        }

        try {
            $timestamp = strtotime($datetime);
            if ($timestamp === false) return null;
            return date(DATE_ATOM, $timestamp);
        } catch (\Throwable $e) {
            Log::debug('[SitemapService] formatDate failed for value: ' . $e->getMessage());
            return null;
        }
    }

    /**
     * Escape special XML characters in a string.
     */
    private function escapeXml(string $value): string
    {
        return htmlspecialchars($value, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    }
}
