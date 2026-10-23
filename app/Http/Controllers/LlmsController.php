<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers;

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
 * Tenant detection follows the same rules as SitemapController:
 *   1. Custom domain (hour-timebank.ie)        → that tenant
 *   2. Frontend host (app.project-nexus.ie)    → marketing/master
 *   3. Anything else                            → master tenant
 */
class LlmsController
{
    private const CACHE_TTL = 3600;

    public function index(Request $request): Response
    {
        $tenant = $this->resolveTenant($request);
        // nginx proxies /llms.txt to api.project-nexus.ie with the original
        // tenant host carried in X-Sitemap-Host (same pattern as the sitemap
        // proxy). Without this fallback, link URLs in the body resolve to
        // api.project-nexus.ie instead of the tenant domain.
        $host = $request->header('X-Sitemap-Host', $request->getHost());
        $key = "llms:short:{$host}:" . ($tenant->id ?? 0);

        $body = Cache::remember($key, self::CACHE_TTL, fn () => $this->renderShort($tenant, $host));

        return $this->textResponse($body);
    }

    public function full(Request $request): Response
    {
        $tenant = $this->resolveTenant($request);
        // nginx proxies /llms.txt to api.project-nexus.ie with the original
        // tenant host carried in X-Sitemap-Host (same pattern as the sitemap
        // proxy). Without this fallback, link URLs in the body resolve to
        // api.project-nexus.ie instead of the tenant domain.
        $host = $request->header('X-Sitemap-Host', $request->getHost());
        $key = "llms:full:v2:{$host}:" . ($tenant->id ?? 0);

        $body = Cache::remember($key, self::CACHE_TTL, fn () => $this->renderFull($tenant, $host));

        return $this->textResponse($body);
    }

    // -----------------------------------------------------------------

    private function resolveTenant(Request $request): ?object
    {
        $host = $request->header('X-Sitemap-Host', $request->getHost());

        $byDomain = DB::selectOne(
            "SELECT id, name, slug, domain, tagline, description, meta_title, meta_description, h1_headline, hero_intro, features, configuration
             FROM tenants WHERE domain = ? AND is_active = 1",
            [$host]
        );

        if ($byDomain) {
            return $byDomain;
        }

        // Frontend host or unknown → master tenant
        return DB::selectOne(
            "SELECT id, name, slug, domain, tagline, description, meta_title, meta_description, h1_headline, hero_intro, features, configuration
             FROM tenants WHERE (slug IS NULL OR slug = '') AND is_active = 1 ORDER BY id LIMIT 1"
        );
    }

    private function renderShort(?object $tenant, string $host): string
    {
        $name = $tenant->name ?? 'NEXUS';
        $tagline = trim((string) ($tenant->tagline ?? ''));
        $description = trim((string) ($tenant->meta_description ?? $tenant->description ?? ''));
        $baseUrl = 'https://' . $host;

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

        // Key public links
        $lines[] = '## Key pages';
        $lines[] = '';
        $lines[] = "- [Home]({$baseUrl}/): overview and how it works";
        $lines[] = "- [About]({$baseUrl}/about): mission and team";
        $lines[] = "- [How it works]({$baseUrl}/timebanking-guide): timebanking explained";
        $lines[] = "- [Browse listings]({$baseUrl}/listings): current skill exchanges";
        $lines[] = "- [Explore community]({$baseUrl}/explore): discover the network";
        $lines[] = "- [Blog]({$baseUrl}/blog): stories, updates, social impact";
        $lines[] = "- [Help]({$baseUrl}/help): support and FAQ";
        $lines[] = "- [Contact]({$baseUrl}/contact): get in touch";
        $lines[] = '';

        $features = json_decode($tenant->features ?? '{}', true) ?: [];
        $optional = [];
        if (($features['events'] ?? true)) {
            $optional[] = "- [Events]({$baseUrl}/events): upcoming community events";
        }
        if (($features['groups'] ?? true)) {
            $optional[] = "- [Groups]({$baseUrl}/groups): topic-based communities";
        }
        if (($features['volunteering'] ?? true)) {
            $optional[] = "- [Volunteering]({$baseUrl}/volunteering): opportunities to help";
        }
        if (($features['job_vacancies'] ?? true)) {
            $optional[] = "- [Jobs]({$baseUrl}/jobs): paid roles in the community";
        }
        if (($features['volunteering'] ?? true)) {
            $optional[] = "- [Organisations]({$baseUrl}/organisations): partner groups and charities";
        }
        if (!empty($optional)) {
            $lines[] = '## Optional';
            $lines[] = '';
            $lines = array_merge($lines, $optional);
            $lines[] = '';
        }

        $lines[] = '## Discovery';
        $lines[] = '';
        $lines[] = "- Sitemap: {$baseUrl}/sitemap.xml";
        $lines[] = "- Full LLM context: {$baseUrl}/llms-full.txt";
        $lines[] = '';

        return implode("\n", $lines);
    }

    private function renderFull(?object $tenant, string $host): string
    {
        $short = $this->renderShort($tenant, $host);
        $tenantId = $tenant->id ?? null;
        $baseUrl = 'https://' . $host;

        $lines = [$short, '## Recent blog posts', ''];

        if ($tenantId !== null) {
            try {
                $posts = DB::select(
                    "SELECT title, slug, COALESCE(excerpt, '') AS excerpt
                     FROM posts
                     WHERE tenant_id = ? AND status = 'published'
                       AND LOWER(CONCAT_WS(' ', title, excerpt, content)) NOT LIKE ?
                     ORDER BY COALESCE(updated_at, created_at) DESC
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

    private function textResponse(string $body, int $status = 200): Response
    {
        return response($body, $status)
            ->header('Content-Type', 'text/plain; charset=UTF-8')
            ->header('Cache-Control', 'public, max-age=3600')
            ->header('X-Robots-Tag', 'noindex');
    }
}
