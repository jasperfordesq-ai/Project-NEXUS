<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\Log;

/**
 * Tells crawlers that removed content is gone (HTTP 410), 2026-10-23.
 *
 * The render engine never saves a "not found" page (a failed render must not
 * get a real page marked missing), so a deleted, unpublished or renamed blog
 * post or CMS page used to reach crawlers as the app shell with 200 (and,
 * since the soft-404 fix, noindex). Now the observer leaves an empty marker in
 * the shared crawler-copy volume at
 *     .seo-gone/{host}{community folder}{path}/_g
 * and nginx answers crawlers 410 for that address (one stat(), no reload; see
 * nginx.bluegreen.conf). Publishing the content again removes the marker.
 * Visitors are never affected: nginx checks the marker on the crawler path only.
 */
class SeoGoneMarkers
{
    public const DIR = '.seo-gone';
    public const MARKER = '_g';

    private string $root;

    public function __construct(?string $root = null)
    {
        $this->root = rtrim($root ?? (string) config('prerender.cache_path', '/var/www/html/storage/prerendered'), '/');
    }

    /** @param array<int,string> $routes */
    public function mark(int $tenantId, array $routes): void
    {
        foreach ($this->paths($tenantId, $routes) as $file) {
            $dir = dirname($file);
            if ((is_dir($dir) || @mkdir($dir, 0775, true) || is_dir($dir)) && @file_put_contents($file, '') === false) {
                Log::warning('SEO gone marker: write failed', ['file' => $file]);
            }
        }
    }

    /** @param array<int,string> $routes */
    public function clear(int $tenantId, array $routes): void
    {
        foreach ($this->paths($tenantId, $routes) as $file) {
            if (is_file($file)) {
                @unlink($file);
            }
        }
    }

    /**
     * Remove every marker whose address is live again, i.e. listed in the
     * community's own sitemap. The safety net for content republished without
     * an Eloquent save (imports, raw DB fixes): a stale marker would otherwise
     * tell crawlers a live page is gone. Run hourly by seo:publish-redirects.
     */
    public function pruneLive(): int
    {
        $removed = 0;
        foreach (app(PrerenderService::class)->loadTenantTargets() as $t) {
            $base = $this->root . '/' . self::DIR . '/' . $t['host'] . $t['prefix'];
            if (!is_dir($base)) {
                continue;
            }
            try {
                $xml = app(SitemapService::class)->generateForTenant((int) $t['tenant_id']);
            } catch (\Throwable $e) {
                Log::warning('SEO gone markers: sitemap unavailable', ['tenant_id' => $t['tenant_id'], 'error' => $e->getMessage()]);
                continue;
            }
            preg_match_all('#<loc>([^<]+)</loc>#', $xml, $m);
            $live = [];
            foreach ($m[1] as $loc) {
                $path = (string) (parse_url(html_entity_decode($loc), PHP_URL_PATH) ?? '');
                if ($t['prefix'] !== '' && str_starts_with($path, $t['prefix'] . '/')) {
                    $path = substr($path, strlen($t['prefix']));
                }
                $live['/' . trim($path, '/')] = true;
            }
            $files = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($base, \FilesystemIterator::SKIP_DOTS));
            foreach ($files as $file) {
                if ($file->getFilename() !== self::MARKER) {
                    continue;
                }
                $route = '/' . trim(substr(dirname($file->getPathname()), strlen($base)), '/');
                if (isset($live[$route]) && @unlink($file->getPathname())) {
                    $removed++;
                }
            }
        }
        return $removed;
    }

    public function isMarked(int $tenantId, string $route): bool
    {
        $paths = $this->paths($tenantId, [$route]);
        return $paths !== [] && is_file($paths[0]);
    }

    /**
     * @param array<int,string> $routes
     * @return list<string>
     */
    private function paths(int $tenantId, array $routes): array
    {
        try {
            $target = SitemapService::targetFor($tenantId);
        } catch (\Throwable $e) {
            Log::warning('SEO gone marker: no community address', ['tenant_id' => $tenantId, 'error' => $e->getMessage()]);
            return [];
        }
        if ($target === null) {
            return [];
        }
        $out = [];
        foreach ($routes as $route) {
            $path = SeoRedirectPublisher::normaliseSource((string) $route);
            if ($path !== null) {
                $out[] = $this->root . '/' . self::DIR . '/' . $target['host'] . $target['prefix'] . $path . '/' . self::MARKER;
            }
        }
        return $out;
    }
}
