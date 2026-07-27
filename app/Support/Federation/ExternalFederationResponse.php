<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Federation;

use Illuminate\Http\JsonResponse;

/**
 * The single response shape for inbound traffic blocked by the external
 * federation kill switch.
 *
 * Shared by the route middleware (EnsureExternalFederationEnabled) and the
 * backstop inside FederationApiMiddleware::authenticate(). Either can fire
 * first depending on middleware order, so both must answer identically —
 * otherwise a partner's error handling would depend on which layer caught it.
 */
final class ExternalFederationResponse
{
    /** Advertised retry delay, in seconds. */
    public const RETRY_AFTER_SECONDS = 3600;

    public const ERROR_CODE = 'FEDERATION_EXTERNAL_DISABLED';

    /**
     * Build the 503 for a blocked request.
     *
     * 503 rather than 403: the caller's credentials are fine, the capability is
     * temporarily withdrawn. Federation clients commonly treat a sustained 403
     * as "our key was revoked" and disable the integration permanently, whereas
     * 503 + Retry-After is the standard "come back later".
     *
     * The body never names the protocol — that would let an unauthenticated
     * caller enumerate which protocols this installation supports. Detail goes
     * to the log instead.
     */
    public static function blocked(string $path): JsonResponse
    {
        $normalised = '/' . ltrim($path, '/');

        // Nexus V2 ingest speaks the canonical errors[] contract; every other
        // federation surface uses FederationApiMiddleware's error envelope.
        return str_contains($normalised, '/v2/federation/ingest/')
            ? self::withRetryAfter(response()->json([
                'errors' => [[
                    'code' => self::ERROR_CODE,
                    'message' => __('api.federation.external_protocol_disabled'),
                ]],
            ], 503, [
                'API-Version' => '2.0',
                'Cache-Control' => 'private, no-store',
                'Pragma' => 'no-cache',
            ]))
            : self::blockedLegacy();
    }

    /**
     * The legacy `error`/`code` envelope, matching FederationApiMiddleware::sendError().
     *
     * The authenticator backstop must always use this shape, even on ingest
     * paths: FederationApiAuth::normalizeIngestError() converts an
     * authenticate() failure into the errors[] contract by reading the
     * top-level `code`, and would fall back to FEDERATION_AUTH_FAILED if given
     * a body that has no such key.
     */
    public static function blockedLegacy(): JsonResponse
    {
        return self::withRetryAfter(response()->json([
            'error' => true,
            'code' => self::ERROR_CODE,
            'message' => __('api.federation.external_protocol_disabled'),
            'timestamp' => date('c'),
        ], 503));
    }

    private static function withRetryAfter(JsonResponse $response): JsonResponse
    {
        $response->headers->set('Retry-After', (string) self::RETRY_AFTER_SECONDS);

        return $response;
    }
}
