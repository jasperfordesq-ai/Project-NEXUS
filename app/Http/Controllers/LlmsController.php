<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers;

use App\Services\SitemapService;
use App\Services\TenantFeatureConfig;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * LlmsController — Serves per-tenant /llms.txt and /llms-full.txt.
 *
 * Convention: https://llmstxt.org/ — markdown-formatted, AI-readable summary
 * of the site. Crawlers (ChatGPT, Claude, Perplexity, Gemini) increasingly
 * fetch these instead of (or alongside) rendering JS.
 *
 * Tenant detection (2026-10-23) uses the same community address list as the
 * sitemap and the render engine (SitemapService::targetFor): the request host
 * plus, for a community in a folder (app.project-nexus.ie/slug/llms.txt,
 * parent-domain/slug/llms.txt), the folder nginx passes in X-Llms-Prefix.
 * Until then a folder community got the hub's or the platform's file.
 *   1. Custom domain (hour-timebank.ie)        → that tenant
 *   2. Frontend host (app.project-nexus.ie)    → marketing/master
 *   3. Anything else                            → master tenant
 */
class LlmsController
{
    private const CACHE_TTL = 3600;

    /** The file describes the community's accessible site (see resolveTenant). */
    private bool $accessiblePrimary = false;

    /**
     * Main-site page → its accessible-site address, where they differ
     * (react-frontend/src/lib/accessible-frontend.ts ACCESSIBLE_PAGE_MAP).
     */
    private const ACCESSIBLE_PATHS = ['/timebanking-guide' => '/guide'];

    private function link(string $baseUrl, string $path): string
    {
        if ($this->accessiblePrimary) {
            $path = self::ACCESSIBLE_PATHS[$path] ?? $path;
        }
        return $baseUrl . $path;
    }

    public function index(Request $request): Response
    {
        [$tenant, $baseUrl] = $this->resolveTenant($request);
        if ($hidden = $this->hiddenResponse($tenant)) {
            return $hidden;
        }
        $key = 'llms:short:v3:' . md5($baseUrl) . ':' . ($tenant->id ?? 0) . ':' . SitemapService::cacheVersion((int) ($tenant->id ?? 0));

        $body = Cache::remember($key, self::CACHE_TTL, fn () => $this->renderShort($tenant, $baseUrl));

        return $this->textResponse($body);
    }

    public function full(Request $request): Response
    {
        [$tenant, $baseUrl] = $this->resolveTenant($request);
        if ($hidden = $this->hiddenResponse($tenant)) {
            return $hidden;
        }
        $key = 'llms:full:v4:' . md5($baseUrl) . ':' . ($tenant->id ?? 0) . ':' . SitemapService::cacheVersion((int) ($tenant->id ?? 0));

        $body = Cache::remember($key, self::CACHE_TTL, fn () => $this->renderFull($tenant, $baseUrl));

        return $this->textResponse($body);
    }

    // -----------------------------------------------------------------

    /**
     * The community this request is for, and its public base address.
     *
     * nginx proxies /llms.txt to the API with the original host in
     * X-Sitemap-Host and, for /{slug}/llms.txt, the folder in X-Llms-Prefix.
     * A folder only counts when it is a real community on that host; anything
     * else falls back to the community at the host's root (the master on the
     * app host), so the file can never name another host.
     *
     * @return array{0: ?object, 1: string}
     */
    private function resolveTenant(Request $request): array
    {
        $host = strtolower((string) $request->header('X-Sitemap-Host', $request->getHost()));
        $prefix = '/' . trim((string) $request->header('X-Llms-Prefix', ''), '/');
        $prefix = $prefix === '/' ? '' : $prefix;

        $root = null;
        $folder = null;
        foreach (app(\App\Services\PrerenderService::class)->loadTenantTargets() as $t) {
            if ($t['host'] !== $host) {
                continue;
            }
            if ($t['prefix'] === '') {
                $root = $t;
            } elseif ($prefix !== '' && strcasecmp($t['prefix'], $prefix) === 0) {
                $folder = $t;
            }
        }
        $target = $folder ?? $root;

        $columns = 'id, name, slug, domain, tagline, description, meta_title, meta_description, features, configuration';
        if ($target !== null) {
            $tenant = DB::selectOne("SELECT {$columns} FROM tenants WHERE id = ? AND is_active = 1", [$target['tenant_id']]);
            // A community that chose its accessible site for search engines
            // (seo_primary_site) is described with its accessible addresses.
            $accessible = $tenant !== null && SitemapService::isAccessiblePrimary((int) $tenant->id)
                ? SitemapService::accessibleBase((int) $tenant->id)
                : null;
            $this->accessiblePrimary = $accessible !== null;
            return [$tenant, $accessible ?? (SitemapService::targetOrigin($target) . $target['prefix'])];
        }

        // Unknown host (the API host itself, say) → master, at the app address.
        $master = SitemapService::targetFor(1);
        $tenant = DB::selectOne("SELECT {$columns} FROM tenants WHERE id = 1 AND is_active = 1");
        return [$tenant, $master !== null ? SitemapService::targetOrigin($master) : 'https://' . $host];
    }

    /**
     * A community that asked search engines not to index it publishes no AI
     * summary either (2026-10-23): 404, as its sitemap does. The cache key
     * carries SitemapService::cacheVersion, so a settings or content save
     * refreshes the file at once instead of after the hour's cache.
     */
    private function hiddenResponse(?object $tenant): ?Response
    {
        if ($tenant !== null && SitemapService::isNoindexTenant((int) $tenant->id)) {
            return $this->textResponse("# Not available\n", 404);
        }
        return null;
    }

    /** First non-empty: meta description, the /admin/seo default description, the tenant description. */
    private function description(?object $tenant): string
    {
        if ($tenant === null) {
            return '';
        }
        $setting = '';
        try {
            $setting = (string) (DB::table('tenant_settings')->where('tenant_id', (int) $tenant->id)
                ->where('setting_key', 'seo_meta_description')->value('setting_value') ?? '');
        } catch (\Throwable) {
        }
        foreach ([$tenant->meta_description ?? '', $setting, $tenant->description ?? ''] as $candidate) {
            $candidate = trim(strip_tags((string) $candidate));
            if ($candidate !== '') {
                return $candidate;
            }
        }
        return '';
    }

    private function hasFeature(?object $tenant, string $feature): bool
    {
        $features = json_decode($tenant->features ?? '{}', true) ?: [];
        return (TenantFeatureConfig::mergeFeatures($features)[$feature] ?? false) === true;
    }

    private function renderShort(?object $tenant, string $baseUrl): string
    {
        $name = $tenant->name ?? 'NEXUS';
        $tagline = trim((string) ($tenant->tagline ?? ''));
        // `??` let an empty meta description hide the others (2026-10-23).
        $description = $this->description($tenant);

        $lines = [];
        $lines[] = "# {$name}";
        $lines[] = '';
        if ($tagline !== '') {
            $lines[] = "> {$tagline}";
            $lines[] = '';
        }
        if ($description !== '') {
            $lines[] = $description;
            $lines[] = '';
        }

        // Only pages a signed-out reader can open (2026-10-23). The list used
        // to send AI crawlers to listings, events, groups, volunteering, jobs
        // and organisations, all of which are behind sign-in.
        $lines[] = '## Key pages';
        $lines[] = '';
        $lines[] = "- [Home](" . $this->link($baseUrl, '/') . "): overview and how it works";
        $lines[] = "- [About](" . $this->link($baseUrl, '/about') . "): mission and team";
        $lines[] = "- [How it works](" . $this->link($baseUrl, '/timebanking-guide') . "): timebanking explained";
        $lines[] = "- [Questions and answers](" . $this->link($baseUrl, '/faq') . "): common questions";
        $lines[] = "- [Help](" . $this->link($baseUrl, '/help') . "): guides for members";
        $lines[] = "- [Trust and safety](" . $this->link($baseUrl, '/trust-and-safety') . "): how members are kept safe";
        $lines[] = "- [Contact](" . $this->link($baseUrl, '/contact') . "): get in touch";
        $lines[] = '';

        $optional = [];
        if ($this->hasFeature($tenant, 'blog')) {
            $optional[] = "- [Blog](" . $this->link($baseUrl, '/blog') . "): stories, updates, social impact";
        }
        if ($this->hasFeature($tenant, 'events') && $this->hasFeature($tenant, 'public_events')) {
            $optional[] = "- [What's on](" . $this->link($baseUrl, '/whats-on') . "): events open to the public";
        }
        if ($this->hasFeature($tenant, 'merchant_coupons') && !$this->accessiblePrimary) {
            $optional[] = "- [Coupons](" . $this->link($baseUrl, '/coupons') . "): offers from local organisations";
        }
        if (!empty($optional)) {
            $lines[] = '## Optional';
            $lines[] = '';
            $lines = array_merge($lines, $optional);
            $lines[] = '';
        }

        $lines[] = '## Discovery';
        $lines[] = '';
        if ($tenant === null || !SitemapService::isSitemapSwitchedOff((int) $tenant->id)) {
            $lines[] = '- Sitemap: ' . $this->sitemapUrl($tenant, $baseUrl);
        }
        $lines[] = "- Full LLM context: {$baseUrl}/llms-full.txt";
        $lines[] = '';

        return implode("\n", $lines);
    }

    private function renderFull(?object $tenant, string $baseUrl): string
    {
        $short = $this->renderShort($tenant, $baseUrl);
        $tenantId = $tenant->id ?? null;

        $lines = [$short, '## Recent blog posts', ''];

        if ($tenantId !== null) {
            try {
                $posts = DB::select(
                    "SELECT p.title, p.slug, COALESCE(p.excerpt, '') AS excerpt
                     FROM posts p
                     WHERE p.tenant_id = ? AND p.status = 'published'
                       AND LOWER(CONCAT_WS(' ', p.title, p.excerpt, p.content)) NOT LIKE ?
                       AND NOT EXISTS (
                           SELECT 1 FROM seo_metadata sm
                            WHERE sm.tenant_id = p.tenant_id AND sm.entity_type = 'post'
                              AND sm.entity_id = p.id AND sm.noindex = 1
                       )
                     ORDER BY COALESCE(p.updated_at, p.created_at) DESC
                     LIMIT 30",
                    [$tenantId, '%lorem ipsum%']
                );

                foreach ($posts as $p) {
                    $excerpt = trim(strip_tags($p->excerpt));
                    if ($excerpt !== '') {
                        $excerpt = ': ' . mb_substr($excerpt, 0, 200);
                    }
                    $lines[] = "- [{$p->title}]({$baseUrl}/blog/{$p->slug}){$excerpt}";
                }
                if (empty($posts)) {
                    $lines[] = '_(no published posts yet)_';
                }
            } catch (\Throwable $e) {
                $lines[] = '_(blog posts unavailable)_';
            }
        }

        // No member listings (F-601, 23 Oct 2026). From 12 May 2026 this file
        // listed the 30 newest active listings — title, type, link and the
        // first 160 characters of the member's description — although listings
        // are member-only everywhere else and the sitemap deliberately omits
        // member-authored content. This file needs no sign-in and nginx routes
        // AI crawlers to it. Only public content belongs here.

        $lines[] = '';

        return implode("\n", $lines);
    }

    /** A folder community's sitemap is sitemap-{slug}.xml on its host, not {folder}/sitemap.xml. */
    private function sitemapUrl(?object $tenant, string $baseUrl): string
    {
        if ($this->accessiblePrimary) {
            return $baseUrl . '/sitemap.xml'; // web-uk serves the accessible sitemap
        }
        $origin = (string) preg_replace('#^(https?://[^/]+).*$#i', '$1', $baseUrl);
        if ($origin !== $baseUrl && !empty($tenant->slug)) {
            return $origin . '/sitemap-' . $tenant->slug . '.xml';
        }
        return $baseUrl . '/sitemap.xml';
    }

    private function textResponse(string $body, int $status = 200): Response
    {
        return response($body, $status)
            ->header('Content-Type', 'text/plain; charset=UTF-8')
            ->header('Cache-Control', 'public, max-age=3600')
            ->header('X-Robots-Tag', 'noindex');
    }
}
