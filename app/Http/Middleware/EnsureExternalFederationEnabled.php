<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Services\FederationFeatureService;
use App\Support\Federation\ExternalFederationResponse;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

/**
 * Blocks inbound traffic for an external federation protocol that is switched off.
 *
 * The protocol is passed as a middleware parameter rather than sniffed from the
 * request path, so the mapping is explicit at the route definition and cannot
 * drift when paths are renamed:
 *
 *     Route::middleware('federation.external:komunitin')->group(...)
 *
 * On the Komunitin/Credit Commons/Nexus-ingest group this middleware is nested
 * inside the existing `federation.api` group, so in practice the equivalent
 * backstop inside FederationApiMiddleware::authenticate() usually blocks those
 * requests first — before any key lookup, `last_used_at` write, or
 * `federation_api_logs` insert. This middleware is what covers the
 * unauthenticated surfaces (legacy v1, webhook receiver, hour transfer,
 * aggregates) and any route whose controller authenticates by itself.
 *
 * Blocked inbound traffic is therefore recorded in the application log only —
 * see logBlocked() — so log retention needs to cover the intended dark window.
 */
class EnsureExternalFederationEnabled
{
    /** Seconds between repeated block-log lines for the same protocol + client. */
    private const LOG_THROTTLE_SECONDS = 300;

    public function __construct(
        private readonly FederationFeatureService $federationFeatureService,
    ) {}

    public function handle(Request $request, Closure $next, string $protocol): Response
    {
        if ($this->federationFeatureService->isExternalProtocolEnabled($protocol)) {
            return $next($request);
        }

        $this->logBlocked($request, $protocol);

        return ExternalFederationResponse::blocked($request->path());
    }

    /**
     * Log at most one line per protocol + client IP per throttle window, so a
     * partner retrying in a tight loop cannot flood the log.
     */
    private function logBlocked(Request $request, string $protocol): void
    {
        $key = 'fed:ext:blocked:' . $protocol . ':' . (string) $request->ip();

        try {
            if (! Cache::add($key, 1, self::LOG_THROTTLE_SECONDS)) {
                return;
            }
        } catch (\Throwable) {
            // Cache unavailable — fall through and log; correctness beats volume.
        }

        Log::warning('[ExternalFederation] Blocked inbound request for disabled protocol', [
            'protocol' => $protocol,
            'method' => $request->method(),
            'path' => '/' . ltrim($request->path(), '/'),
            'ip' => $request->ip(),
            'platform_id' => $request->headers->get('X-Federation-Platform-ID'),
        ]);
    }
}
