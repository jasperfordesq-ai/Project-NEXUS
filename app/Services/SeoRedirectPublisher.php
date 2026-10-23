<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Http\Middleware\SeoRedirectMiddleware;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Makes the admin "URL redirects" (seo_redirects) answer real 301s.
 *
 * Until 2026-10-23 they were never applied: SeoRedirectMiddleware runs only on
 * the API, and nginx serves every page request from the React build, so no
 * visitor or crawler ever reached it.
 *
 * Now each redirect leaves an empty marker file in the shared crawler-copy
 * volume (nexus-php-prerendered), at
 *     .seo-redirects/{host}{community folder}{source path}/_r
 * nginx stat()s that path on each page request (no reload needed) and, when
 * it exists, hands that one request to SeoController::resolveRedirect, which
 * answers the 301. A manifest per community lists the markers it wrote, so a
 * republish removes the ones that no longer apply.
 */
class SeoRedirectPublisher
{
    public const DIR = '.seo-redirects';
    public const MARKER = '_r';

    private string $root;

    public function __construct(?string $root = null)
    {
        $this->root = rtrim($root ?? (string) config('prerender.cache_path', '/var/www/html/storage/prerendered'), '/');
    }

    /**
     * The path part of a stored source, community-relative ("/old-page"), or
     * null when it cannot be matched (query strings, "..", control characters).
     */
    public static function normaliseSource(string $source): ?string
    {
        $s = trim($source);
        if ($s === '') {
            return null;
        }
        if (preg_match('#^https?://#i', $s)) {
            $s = (string) (parse_url($s, PHP_URL_PATH) ?? '');
        }
        if ($s === '' || $s[0] !== '/' || str_contains($s, '?') || str_contains($s, '#')) {
            return null;
        }
        if (preg_match('#(^|/)\.\.?(/|$)|[\\\\\x00-\x20\x7F]#', $s)) {
            return null;
        }
        $s = '/' . trim(preg_replace('#/+#', '/', $s), '/');
        return $s === '/' ? null : $s; // never redirect a community's home page
    }

    /** @return list<array{tenant_id:int, host:string, prefix:string}> */
    private function targetsFor(int $tenantId): array
    {
        return array_values(array_filter(
            app(PrerenderService::class)->loadTenantTargets(),
            static fn (array $t) => (int) $t['tenant_id'] === $tenantId
        ));
    }

    /** Rewrite every marker for one community. Never throws. */
    public function publishTenant(int $tenantId): void
    {
        try {
            $base = $this->root . '/' . self::DIR;
            if (!is_dir($base) && !@mkdir($base, 0775, true) && !is_dir($base)) {
                Log::warning('SEO redirects: cannot create marker directory', ['dir' => $base]);
                return;
            }

            $manifest = $base . '/_tenant-' . $tenantId . '.json';
            $old = is_file($manifest) ? (json_decode((string) file_get_contents($manifest), true) ?: []) : [];
            foreach ($old as $rel) {
                if (is_string($rel) && !str_contains($rel, '..')) {
                    @unlink($base . '/' . $rel);
                }
            }

            $rows = DB::table('seo_redirects')->where('tenant_id', $tenantId)
                ->select('source_url', 'destination_url')->get();
            $written = [];
            foreach ($this->targetsFor($tenantId) as $target) {
                foreach ($rows as $row) {
                    $path = self::normaliseSource((string) $row->source_url);
                    if ($path === null || !SeoRedirectMiddleware::isSafeDestination((string) $row->destination_url)) {
                        continue;
                    }
                    $rel = $target['host'] . $target['prefix'] . $path . '/' . self::MARKER;
                    $dir = dirname($base . '/' . $rel);
                    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
                        continue;
                    }
                    if (@file_put_contents($base . '/' . $rel, '') !== false) {
                        $written[] = $rel;
                    }
                }
            }
            @file_put_contents($manifest, json_encode(array_values(array_unique($written))));
        } catch (\Throwable $e) {
            Log::warning('SEO redirects: publish failed', ['tenant_id' => $tenantId, 'error' => $e->getMessage()]);
        }
    }

    /** Republish every community (deploys, and the command). */
    public function publishAll(): int
    {
        $ids = array_unique(array_map(
            static fn (array $t) => (int) $t['tenant_id'],
            app(PrerenderService::class)->loadTenantTargets()
        ));
        foreach ($ids as $id) {
            $this->publishTenant($id);
        }
        return count($ids);
    }

    /**
     * The redirect for a request, or null. Host and path come from nginx; the
     * host must be a known community address, so the answer never leaves the
     * platform's own sites.
     *
     * @return array{id:int, location:string}|null
     */
    public function resolve(string $host, string $path): ?array
    {
        $host = strtolower(trim($host));
        $best = null;
        foreach (app(PrerenderService::class)->loadTenantTargets() as $t) {
            if ($t['host'] !== $host) {
                continue;
            }
            $prefix = (string) $t['prefix'];
            if ($prefix !== '' && $path !== $prefix && !str_starts_with($path, $prefix . '/')) {
                continue;
            }
            if ($best === null || strlen($prefix) > strlen((string) $best['prefix'])) {
                $best = $t;
            }
        }
        if ($best === null) {
            return null;
        }

        $relative = self::normaliseSource(substr($path, strlen((string) $best['prefix'])) ?: '/');
        if ($relative === null) {
            return null;
        }

        foreach (DB::table('seo_redirects')->where('tenant_id', $best['tenant_id'])->get(['id', 'source_url', 'destination_url']) as $row) {
            if (self::normaliseSource((string) $row->source_url) !== $relative) {
                continue;
            }
            $dest = (string) $row->destination_url;
            if (!SeoRedirectMiddleware::isSafeDestination($dest) || $dest === $relative) {
                return null;
            }
            return ['id' => (int) $row->id, 'location' => 'https://' . $host . $best['prefix'] . $dest];
        }
        return null;
    }
}
