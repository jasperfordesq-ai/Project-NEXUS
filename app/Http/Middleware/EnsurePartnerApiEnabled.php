<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Services\PartnerApi\PartnerApiKillSwitch;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

/**
 * Blocks the AG60 Partner API when its platform kill switch is off.
 *
 * Applied to the whole /partner/v1 block rather than sitting inside
 * PartnerApiAuth, because the OAuth token and revoke endpoints deliberately
 * run without that middleware — gating only the authenticated routes would
 * leave the token mint open.
 */
class EnsurePartnerApiEnabled
{
    /** Seconds between repeated block-log lines for the same client. */
    private const LOG_THROTTLE_SECONDS = 300;

    private const RETRY_AFTER_SECONDS = 3600;

    public function __construct(
        private readonly PartnerApiKillSwitch $killSwitch,
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        if ($this->killSwitch->isEnabled()) {
            return $next($request);
        }

        $this->logBlocked($request);

        // 503 + Retry-After, matching the federation gate: the caller's token
        // is fine, the capability is temporarily withdrawn. A sustained 403
        // reads as permanent revocation and gets integrations switched off.
        return response()->json([
            'success' => false,
            'errors' => [[
                'code' => 'partner_api_disabled',
                'message' => __('api.partner_api.disabled'),
            ]],
        ], 503, [
            'API-Version' => '2.0',
            'Retry-After' => (string) self::RETRY_AFTER_SECONDS,
            'Cache-Control' => 'private, no-store',
        ]);
    }

    private function logBlocked(Request $request): void
    {
        $key = 'partner-api:blocked:' . (string) $request->ip();

        try {
            if (! Cache::add($key, 1, self::LOG_THROTTLE_SECONDS)) {
                return;
            }
        } catch (\Throwable) {
            // Cache unavailable — log anyway.
        }

        Log::warning('[PartnerApi] Blocked request — Partner API is disabled platform-wide', [
            'method' => $request->method(),
            'path' => '/' . ltrim($request->path(), '/'),
            'ip' => $request->ip(),
        ]);
    }
}
