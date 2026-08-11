<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Middleware;

use App\Helpers\CorsHelper;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Ensures CORS headers are present on ALL responses, including errors.
 *
 * Laravel's HandleCors middleware normally handles CORS, but when inner
 * middleware (e.g., Authenticate) returns early with 401/403, the CORS
 * headers can be missing — causing browsers to report CORS errors instead
 * of the real HTTP status. This middleware runs as the outermost layer and
 * guarantees CORS headers on every response.
 */
class EnsureCorsHeaders
{
    public function handle(Request $request, Closure $next): Response
    {
        try {
            $response = $next($request);
        } catch (\Throwable $e) {
            // When inner middleware throws, Laravel's exception handler renders
            // a 500 response that bypasses this middleware's response phase.
            // Catch the exception, render it, and add CORS headers so the browser
            // can read the error instead of showing a misleading CORS block.
            $response = $this->renderException($request, $e);
        }

        return $this->addCorsHeaders($request, $response);
    }

    private function addCorsHeaders(Request $request, Response $response): Response
    {
        // Only add CORS headers to API paths (same paths as config/cors.php)
        $path = $request->path();
        if (!$this->isApiPath($path)) {
            return $response;
        }

        // If HandleCors already set the header, don't override it
        if ($response->headers->has('Access-Control-Allow-Origin')) {
            return $response;
        }

        // Check if the request origin is allowed
        $origin = $request->header('Origin');
        if (!$origin) {
            return $response;
        }

        // Federation endpoints (Komunitin + Credit Commons) are queried by external
        // partner instances from unknown origins.
        // GET (read-only) requests keep the permissive wildcard policy.
        // Write operations (POST, PUT, PATCH, DELETE) require the Origin to match a
        // registered, active remote partner in federation_external_partners to prevent
        // unauthorized mutations.
        if ($this->isFederationPath($path)) {
            $method = strtoupper($request->method());
            $isWriteMethod = in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true);

            if ($isWriteMethod && $origin) {
                if (!$this->isFederationOriginWhitelisted($origin)) {
                    return response()->json(['message' => 'Origin not in federation whitelist'], 403);
                }
                // Whitelisted write — reflect the specific origin
                $response->headers->set('Access-Control-Allow-Origin', $origin);
            } else {
                // Read-only or preflight — keep wildcard
                $response->headers->set('Access-Control-Allow-Origin', '*');
            }
            $response->headers->set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
            $response->headers->set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key, X-Requested-With, Accept, Accept-Language, X-Request-Id');
            $response->headers->set('Access-Control-Expose-Headers', 'X-Request-Id, X-Build');
            return $response;
        }

        if (CorsHelper::isOriginAllowed($origin)) {
            $response->headers->set('Access-Control-Allow-Origin', $origin);
            $response->headers->set('Access-Control-Allow-Credentials', 'true');
            $response->headers->set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
            // 🔴 Keep in step with config/cors.php's allowed_headers. A custom
            // header missing from EITHER list fails the preflight, and the
            // browser reports it as "unable to connect" rather than as a CORS
            // problem — which is how the per-feature event contract headers
            // silently took down the check-in and safety pages in production.
            $response->headers->set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key, X-Requested-With, X-CSRF-TOKEN, Accept, Accept-Language, X-Tenant-Id, X-Tenant-Slug, X-Trusted-Device, X-Timezone, X-Locale, X-Request-Id, X-Events-Contract, X-Event-Checkin-Contract, X-Event-Safety-Contract, X-Message-View-Purpose');
            $response->headers->set('Access-Control-Expose-Headers', 'X-Request-Id, X-Build, X-Events-Contract');
        }

        return $response;
    }

    private function isFederationPath(string $path): bool
    {
        return str_contains($path, 'federation/komunitin')
            || str_contains($path, 'federation/cc');
    }

    /**
     * Check whether the given origin belongs to a registered, active remote
     * federation partner.
     *
     * Remote partner servers are stored in federation_external_partners, keyed by
     * the partner's base URL (scheme + host, e.g. https://partner.example.com) with
     * a status of pending/active/suspended/failed. A federation write is only
     * permitted from a partner whose base_url matches the request Origin and whose
     * status is 'active'. (federation_tenant_whitelist is a separate concept — it is
     * the local-tenant approval list keyed by tenant_id and holds no remote URLs.)
     */
    private function isFederationOriginWhitelisted(string $origin): bool
    {
        // The Origin header is fully attacker-controlled on these server-to-server
        // federation calls, so it must NEVER be interpolated into a SQL LIKE
        // pattern: a crafted "https://%" (or "_" wildcards) would match every
        // active partner and bypass the whitelist entirely. Normalise both sides
        // to a scheme://host[:port] origin and require an exact, case-insensitive
        // match — no pattern semantics, no prefix matching.
        $needle = $this->normaliseOrigin($origin);
        if ($needle === null) {
            return false;
        }

        try {
            $baseUrls = \Illuminate\Support\Facades\DB::table('federation_external_partners')
                ->where('status', 'active')
                ->pluck('base_url');
        } catch (\Throwable) {
            // If the table doesn't exist or the query fails, deny by default.
            return false;
        }

        foreach ($baseUrls as $baseUrl) {
            if ($this->normaliseOrigin((string) $baseUrl) === $needle) {
                return true;
            }
        }

        return false;
    }

    /**
     * Reduce a URL to its case-insensitive origin (scheme://host[:port]), or null
     * if it has no scheme/host. Used to compare a request Origin against partner
     * base URLs by exact value, never as a SQL/LIKE pattern. Tolerates partner
     * base URLs that carry a trailing slash, path, or port.
     */
    private function normaliseOrigin(string $url): ?string
    {
        $parts = parse_url(trim($url));
        if ($parts === false || empty($parts['scheme']) || empty($parts['host'])) {
            return null;
        }

        $origin = strtolower($parts['scheme']) . '://' . strtolower($parts['host']);
        if (isset($parts['port'])) {
            $origin .= ':' . $parts['port'];
        }

        return $origin;
    }

    private function renderException(Request $request, \Throwable $e): Response
    {
        try {
            return app(\Illuminate\Contracts\Debug\ExceptionHandler::class)
                ->render($request, $e);
        } catch (\Throwable) {
            // If even the exception handler fails, return a minimal JSON 500
            return response()->json(['message' => 'Server Error'], 500);
        }
    }

    private function isApiPath(string $path): bool
    {
        return str_starts_with($path, 'api/')
            || str_starts_with($path, 'v2/')
            || str_starts_with($path, 'sanctum/')
            || str_starts_with($path, 'broadcasting/');
    }
}
