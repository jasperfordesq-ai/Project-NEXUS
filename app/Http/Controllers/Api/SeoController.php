<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Services\SeoRedirectPublisher;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Illuminate\Support\Facades\DB;

/**
 * SeoController -- SEO metadata and redirect management.
 *
 * metadata() is public; redirects() requires admin.
 */
class SeoController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct() {}

    /** GET /api/v2/seo/metadata/{slug} */
    public function metadata(string $slug): JsonResponse
    {
        $tenantId = $this->getTenantId();

        // entity_type='page' with the slug path as an entity_id lookup
        $meta = DB::selectOne(
            "SELECT meta_title AS title, meta_description AS description,
                    og_image_url AS og_image, canonical_url,
                    CASE WHEN noindex = 1 THEN 'noindex, nofollow' ELSE 'index, follow' END AS robots
             FROM seo_metadata
             WHERE tenant_id = ? AND entity_type = 'page' AND entity_id = (
                 SELECT id FROM pages WHERE tenant_id = ? AND slug = ? LIMIT 1
             )",
            [$tenantId, $tenantId, $slug]
        );

        if ($meta === null) {
            return $this->respondWithData([
                'title' => null,
                'description' => null,
                'og_image' => null,
                'canonical_url' => null,
                'robots' => 'index, follow',
            ]);
        }

        return $this->respondWithData($meta);
    }

    /** GET /api/v2/seo/redirects */
    public function redirects(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $page = $this->queryInt('page', 1, 1);
        $perPage = $this->queryInt('per_page', 50, 1, 200);
        $offset = ($page - 1) * $perPage;

        $items = DB::select(
            'SELECT id, tenant_id, source_url, destination_url, hits, created_at
             FROM seo_redirects WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
            [$tenantId, $perPage, $offset]
        );
        $total = DB::selectOne(
            'SELECT COUNT(*) as cnt FROM seo_redirects WHERE tenant_id = ?',
            [$tenantId]
        )->cnt;

        return $this->respondWithPaginatedCollection($items, (int) $total, $page, $perPage);
    }

    /**
     * GET /v2/seo/resolve-redirect — reached only through nginx, for a page
     * request that has a redirect marker (SeoRedirectPublisher). The host and
     * path are the visitor's, forwarded by nginx in X-Nexus-Redirect-Host and
     * X-Nexus-Redirect-Path. The answer only ever points at a known community
     * address, so a caller who forges the headers gets no open redirect.
     */
    public function resolveRedirect(Request $request, SeoRedirectPublisher $publisher): Response
    {
        $host = (string) $request->header('X-Nexus-Redirect-Host', '');
        $path = (string) $request->header('X-Nexus-Redirect-Path', '');
        if ($host === '' || $path === '' || $path[0] !== '/') {
            return response('', 404);
        }

        $redirect = $publisher->resolve($host, $path);
        if ($redirect !== null) {
            try {
                DB::update('UPDATE seo_redirects SET hits = IFNULL(hits, 0) + 1 WHERE id = ?', [$redirect['id']]);
            } catch (\Throwable) {
                // A hit counter never blocks the redirect.
            }
            return response('', 301)
                ->header('Location', $redirect['location'])
                ->header('Cache-Control', 'no-store');
        }

        // A marker with no matching redirect (removed meanwhile): send the
        // visitor on to the page itself; nginx skips the marker check when it
        // sees nexus_rc=1, so this cannot loop.
        $known = array_filter(
            app(\App\Services\PrerenderService::class)->loadTenantTargets(),
            static fn (array $t) => $t['host'] === strtolower($host)
        );
        if ($known === []) {
            return response('', 404);
        }
        return response('', 307)
            ->header('Location', 'https://' . strtolower($host) . $path . '?nexus_rc=1')
            ->header('Cache-Control', 'no-store');
    }

    /**
     * POST /v2/seo/not-found — the app's "Page not found" screen reports the
     * address it could not show (2026-10-23). Until then nothing wrote to
     * error_404_log, so the super-admin 404 Tracking page was always empty.
     *
     * Stored: the full address (host + path, so the platform-wide log shows
     * which community) and the referring page without its query string. Not
     * stored: IP address, account or user agent. Only addresses on a known
     * community host are accepted, so the log cannot be filled with junk hosts.
     */
    public function recordNotFound(Request $request): JsonResponse
    {
        $host = strtolower((string) $request->getHost());
        $path = (string) $request->input('path', '');
        if ($path === '' || $path[0] !== '/' || mb_strlen($path) > 500
            || preg_match('#[\x00-\x1F\x7F]#', $path) || str_contains($path, '..')) {
            return $this->respondWithData(['recorded' => false]);
        }
        $path = (string) strtok($path, '?#');

        $known = array_filter(
            app(\App\Services\PrerenderService::class)->loadTenantTargets(),
            static fn (array $t) => $t['host'] === $host
        );
        if ($known === []) {
            return $this->respondWithData(['recorded' => false]);
        }

        $referrer = (string) $request->input('referrer', '');
        $referrer = $referrer !== '' && preg_match('#^https?://#i', $referrer)
            ? mb_substr((string) strtok($referrer, '?#'), 0, 1000)
            : null;
        $url = mb_substr('https://' . $host . $path, 0, 1000);

        try {
            $updated = DB::update(
                'UPDATE error_404_log SET hit_count = IFNULL(hit_count, 0) + 1, last_seen_at = NOW(),
                        referer = COALESCE(?, referer)
                 WHERE url = ? AND resolved = 0',
                [$referrer, $url]
            );
            if ($updated === 0) {
                DB::insert(
                    'INSERT INTO error_404_log (url, referer, hit_count, first_seen_at, last_seen_at, resolved)
                     VALUES (?, ?, 1, NOW(), NOW(), 0)',
                    [$url, $referrer]
                );
            }
        } catch (\Throwable $e) {
            report($e);
            return $this->respondWithData(['recorded' => false]);
        }

        return $this->respondWithData(['recorded' => true]);
    }
}
