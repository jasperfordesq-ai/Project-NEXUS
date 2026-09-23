<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Middleware;

use App\Core\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * SeoRedirectMiddleware — Proper Laravel middleware for SEO 301 redirects.
 *
 * Replaces the legacy static RedirectMiddleware::handle() which used raw
 * PHP headers and exit(). This version integrates with Laravel's middleware
 * pipeline and uses the Request/Response pattern.
 *
 * Checks the seo_redirects table for a matching source_url and returns
 * a 301 redirect if found. Skips non-GET requests, admin paths, API paths,
 * auth pages, and static file extensions.
 */
class SeoRedirectMiddleware
{
    public function handle(Request $request, Closure $next): Response
    {
        // Only redirect GET/HEAD requests
        if (!$request->isMethod('GET') && !$request->isMethod('HEAD')) {
            return $next($request);
        }

        $path = $request->getPathInfo();

        // Skip admin, API, auth, and cron paths
        if (preg_match('#/(admin|api/|cron/|login|register|logout|password)(/|$)#', $path)) {
            return $next($request);
        }

        // F-061: never redirect API routes. Routes are served without an /api
        // prefix (/v2/...), and the old pattern above did not match /api/v2/...
        // either, so an admin-defined redirect could hijack any API GET.
        if (preg_match('#^/(api|v\d+)(/|$)#i', $path)) {
            return $next($request);
        }

        // Skip static file extensions
        $ext = pathinfo($path, PATHINFO_EXTENSION);
        if (in_array($ext, ['css', 'js', 'jpg', 'jpeg', 'png', 'gif', 'svg', 'ico', 'woff', 'woff2', 'ttf', 'xml', 'txt', 'pdf', 'map'], true)) {
            return $next($request);
        }

        // Check for redirect
        try {
            $tenantId = TenantContext::getId();
            $redirect = DB::selectOne(
                "SELECT destination_url, id FROM seo_redirects WHERE tenant_id = ? AND source_url = ? LIMIT 1",
                [$tenantId, $path]
            );

            // F-061: rows saved before destination validation existed may point
            // off-site; never follow them (no open redirect on this host).
            if ($redirect && $redirect->destination_url !== $path
                && self::isSafeDestination((string) $redirect->destination_url)) {
                // Increment hit counter asynchronously (non-blocking)
                DB::update("UPDATE seo_redirects SET hits = IFNULL(hits, 0) + 1 WHERE id = ?", [$redirect->id]);

                return redirect($redirect->destination_url, 301);
            }
        } catch (\Throwable $e) {
            // Silently fail — never block a request due to redirect lookup
            \Illuminate\Support\Facades\Log::debug('SEO redirect lookup failed', ['error' => $e->getMessage()]);
        }

        return $next($request);
    }

    /**
     * A redirect destination must be a same-host relative path: it starts with
     * exactly one "/" (not "//", which browsers treat as another host), has no
     * scheme, no backslash (browsers normalise a backslash to "/") and no
     * control or whitespace characters (browsers strip tab/newline, so a tab
     * between two slashes would become "//").
     */
    public static function isSafeDestination(string $destination): bool
    {
        return preg_match('#^/(?![/\\\\])[^\\\\\x00-\x20\x7F]*$#D', $destination) === 1;
    }
}
