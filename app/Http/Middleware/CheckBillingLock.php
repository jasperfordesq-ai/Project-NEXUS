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
        // The three panels' own APIs. The Platform team panel and the super
        // admin panel are how a paused community gets restored, so they must
        // work from its address; every route under these prefixes carries its
        // own admin, super-admin or platform-team gate.
        '/api/v2/admin/',
        '/api/v2/platform-team/',
        '/api/v2/super-admin/',
        // Signing in. The sign-in page asks for a CSRF token and the
        // community's sign-in options before anything is typed, and a second
        // step or a passkey may follow; all of it has to work, or the
        // community's admins cannot get in to find out why it is paused.
        '/api/auth/',
        '/api/v2/auth/',
        '/api/csrf-token',
        '/api/v2/csrf-token',
        '/api/totp/',
        '/api/webauthn/',
        '/api/v2/tenant/bootstrap',
        '/api/v2/tenants',
        '/api/v2/messages/unread-count',
        '/api/v2/notifications/counts',
        '/api/v2/webhooks/',
        '/health.php',
        '/up',
        '/favicon.ico',
    ];

    /**
     * Open whatever the method, and only at exactly this address: the
     * unsubscribe links an email carries. A person must always be able to
     * stop emails, whatever the standing of the community that sent them, and
     * these change nothing but that person's own email choices. The token in
     * the link is the proof of who is asking; no sign-in is involved.
     *
     * The last one has no /api prefix: newsletters already sent point at it
     * (see RouteServiceProvider).
     *
     * Not here on purpose: a job alert is stopped from the member's own
     * signed-in pages, which are closed like every other member page.
     */
    private const OPEN_AT_EXACTLY = [
        '/api/v2/notifications/unsubscribe',
        '/api/v2/newsletter/unsubscribe',
        '/v2/newsletter/unsubscribe',
    ];

    /** Open for reading only, and only at exactly this address. */
    private const OPEN_READS = [
        '/api/v2/users/me',
    ];

    /**
     * Closed although an open prefix covers them. Checked first.
     * A paused community takes no new members.
     */
    private const CLOSED_ALTHOUGH_UNDER_AN_OPEN_PREFIX = [
        '/api/v2/auth/register',
    ];

    private static bool $failureReported = false;

    public function handle(Request $request, Closure $next): Response
    {
        if ($request->isMethod('OPTIONS')) {
            return $next($request);
        }

        $path = $request->getPathInfo();
        $exact = rtrim($path, '/');

        if (!in_array($exact, self::CLOSED_ALTHOUGH_UNDER_AN_OPEN_PREFIX, true)) {
            foreach (self::OPEN_PREFIXES as $prefix) {
                if (str_starts_with($path, $prefix)) {
                    return $next($request);
                }
            }

            if (in_array($exact, self::OPEN_AT_EXACTLY, true)) {
                return $next($request);
            }

            if (in_array($exact, self::OPEN_READS, true) && $request->isMethodSafe()) {
                return $next($request);
            }
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
