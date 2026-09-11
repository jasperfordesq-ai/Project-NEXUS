<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Support;

use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * TEST-ONLY global middleware, prepended by Tests\Laravel\TestCase::setUp().
 *
 * Since the MFA baseline (security register E-004, 11 September 2026) every
 * account that TwoFactorPolicy requires to hold a second factor — platform
 * administrators, tenant administrators, org admins, members of a tenant that
 * requires MFA — is refused with 401 AUTH_MFA_REQUIRED on the STATEFUL path,
 * because a session carries no MFA claims. Hundreds of feature tests sign
 * administrators in with `Sanctum::actingAs($admin)`, which is that stateful
 * path, and every one of them broke at once (108 failures in one CI shard).
 *
 * A real administrator never reaches the API that way: they complete the
 * two-factor challenge and hold a bearer token with `mfa_method` /
 * `mfa_verified_at` claims. This middleware gives the test actor exactly that
 * credential — minted by the real TokenService, validated by the real
 * Authenticate middleware — and lets everyone else stay on the stateful path
 * so that guard is still exercised. Nothing in app/ is changed.
 *
 * Opt out for a test that deliberately asserts the stateful refusal:
 *   ActingAsVerifiedAdministrator::$disabled = true;  (reset in tearDown)
 */
final class ActingAsVerifiedAdministrator
{
    public static bool $disabled = false;

    public function handle(Request $request, Closure $next): Response
    {
        if (self::$disabled || $request->bearerToken() !== null) {
            return $next($request);
        }

        $user = auth()->guard('sanctum')->user();
        if ($user === null || empty($user->id) || empty($user->tenant_id)) {
            return $next($request);
        }

        if (!app(TwoFactorPolicy::class)->required($user)) {
            return $next($request);
        }

        $token = app(TokenService::class)->generateToken(
            (int) $user->id,
            (int) $user->tenant_id,
            TwoFactorPolicy::claims('totp')
        );

        $request->headers->set('Authorization', 'Bearer ' . $token);
        $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $token;
        // Drop the stateful actor so Authenticate takes the bearer branch and
        // validates the token like any production request.
        auth()->forgetGuards();

        return $next($request);
    }
}
