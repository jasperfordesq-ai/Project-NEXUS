<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use App\Core\TenantContext;
use App\Support\Tenancy\PlatformHostPolicy;
use Symfony\Component\HttpFoundation\Response;

class ResolveTenant
{
    /**
     * Paths that are exempt from tenant resolution (health checks, etc.).
     */
    private const EXEMPT_PATHS = [
        '/up',
        '/api/laravel/health',
        '/api/v2/sales/orders',
        '/api/v2/federation/external/webhooks/receive',
    ];

    public function handle(Request $request, Closure $next): Response
    {
        // Skip tenant resolution for exempt paths
        $path = $request->getPathInfo();
        foreach (self::EXEMPT_PATHS as $exempt) {
            if ($path === $exempt) {
                return $next($request);
            }
        }

        TenantContext::reset();
        $this->syncTenantServerVariables($request);

        // E-038 / F-035: an unrecognised Host used to be served the MASTER tenant,
        // so a deleted community's domain (or any name pointed at this origin)
        // kept answering as Project NEXUS. Refuse it with a plain not-found. The
        // policy only refuses public-looking names that are neither a community's
        // domain nor a platform host; internal callers are untouched.
        if (PlatformHostPolicy::shouldRefuse($request->getHost())) {
            Log::notice('Refused API request for an unrecognised host', [
                'host' => mb_substr($request->getHost(), 0, 255),
            ]);

            return response()->json([
                'errors' => [
                    ['code' => 'not_found', 'message' => 'Not found'],
                ],
                'success' => false,
            ], 404, ['API-Version' => '2.0']);
        }

        try {
            TenantContext::resolve();
        } catch (\Throwable $e) {
            return response()->json([
                'errors' => [
                    ['code' => 'tenant_resolution_failed', 'message' => 'Unable to resolve tenant'],
                ],
                'success' => false,
            ], 400, ['API-Version' => '2.0']);
        }

        // After resolution, verify we have a valid tenant ID
        $tenantId = TenantContext::getId();
        if (!$tenantId) {
            return response()->json([
                'errors' => [
                    ['code' => 'tenant_required', 'message' => 'A valid tenant context is required for this request'],
                ],
                'success' => false,
            ], 400, ['API-Version' => '2.0']);
        }

        // Bind tenant.id into Laravel's container for services that use app('tenant.id')
        app()->instance('tenant.id', $tenantId);
        Log::shareContext(['tenant_id' => $tenantId]);

        return $next($request);
    }

    private function syncTenantServerVariables(Request $request): void
    {
        $_SERVER['HTTP_X_TENANT_ID'] = $request->headers->get('X-Tenant-ID') ?? null;
        $_SERVER['HTTP_X_TENANT_SLUG'] = $request->headers->get('X-Tenant-Slug') ?? null;
        $_SERVER['HTTP_AUTHORIZATION'] = $request->headers->get('Authorization') ?? null;
        $_SERVER['HTTP_HOST'] = $request->getHost();
        $_SERVER['REQUEST_URI'] = $request->getRequestUri();
    }
}
