<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Core\TenantContext;
use App\Support\Billing\BillingLock;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

/**
 * Closes the member side of a community that is paused for non-payment.
 *
 * Sits next to CheckMaintenanceMode, after ResolveTenant and BEFORE sign-in
 * is resolved, so it cannot ask "is this an admin?" — and does not need to.
 * It closes the member API for everyone, admins included, and leaves the
 * admin API open; the admin endpoints' own gates decide who is an admin,
 * including accounts whose admin level is a flag and not a role.
 *
 * What stays open for a paused community:
 *   - the admin API, so the community's admins can see why and act
 *   - sign-in and sign-out, the tenant bootstrap and the read-only "who am I"
 *     call, so the website can show the paused page to a signed-in member and
 *     let them sign out
 *   - webhooks and health checks, which are not about a community's members
 *
 * This is not maintenance mode (a community admin can switch that off) and
 * not `tenants.is_active` (which locks the admins out too).
 */
class CheckBillingLock
{
    public const CODE = 'COMMUNITY_PAUSED';

    /** Open whatever the method. Matched as a prefix of the request path. */
    private const OPEN_PREFIXES = [
        '/api/v2/admin/',
        '/admin/',
        '/super-admin/',
        '/api/auth/',
        '/api/v2/tenant/bootstrap',
        '/api/v2/tenants',
        '/api/v2/messages/unread-count',
        '/api/v2/notifications/counts',
        '/api/webauthn/auth-challenge',
        '/api/webauthn/auth-verify',
        '/api/v2/webhooks/',
        '/health.php',
        '/up',
        '/favicon.ico',
    ];

    /** Open for reading only, and only at exactly this address. */
    private const OPEN_READS = [
        '/api/v2/users/me',
    ];

    private static bool $failureReported = false;

    public function handle(Request $request, Closure $next): Response
    {
        if ($request->isMethod('OPTIONS')) {
            return $next($request);
        }

        $path = $request->getPathInfo();

        foreach (self::OPEN_PREFIXES as $prefix) {
            if (str_starts_with($path, $prefix)) {
                return $next($request);
            }
        }

        if (in_array(rtrim($path, '/'), self::OPEN_READS, true) && $request->isMethodSafe()) {
            return $next($request);
        }

        try {
            $tenantId = (int) TenantContext::getId();
            $locked = $tenantId > 1 && $this->isLocked($tenantId);
        } catch (\Throwable $e) {
            // An outage of this check must not take every community down, so
            // the request goes through — but never silently.
            if (!self::$failureReported) {
                self::$failureReported = true;
                Log::error('[CheckBillingLock] payment-standing check failed; request allowed', [
                    'error' => $e->getMessage(),
                ]);
            }

            return $next($request);
        }

        if (!$locked) {
            return $next($request);
        }

        return response()->json([
            'success' => false,
            'error' => __('api.community_paused'),
            'code' => self::CODE,
        ], 403);
    }

    /** Separate so a test can make the check fail. */
    protected function isLocked(int $tenantId): bool
    {
        return BillingLock::isLocked($tenantId);
    }
}
