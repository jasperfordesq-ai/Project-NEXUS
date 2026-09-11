<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Support;

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
 * two-factor challenge and hold a bearer whose claims carry `mfa_method` and
 * `mfa_verified_at`. Authenticate reads those claims from the request attribute
 * `verified_auth_claims` (filled by its bearer branch; read by its stateful
 * branch since 2026-09-11). This middleware sets that attribute for a stateful
 * actor the policy requires — nothing else about the request changes, so routes
 * without the auth middleware, cross-tenant actors and in-memory model state all
 * behave exactly as they did before the MFA baseline. Members are left alone.
 *
 * An earlier version swapped the actor for a real bearer token. That broke three
 * classes of test for reasons unrelated to MFA (public routes resolve bearers as
 * Sanctum tokens only; the bearer path re-reads the user row; cross-tenant
 * tokens fail tenant resolution) and was replaced by this attribute-only form.
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

        // Same claim shape a real login mints for this account.
        $request->attributes->set('verified_auth_claims', [
            ...TwoFactorPolicy::claims('totp'),
            'user_id' => (int) $user->id,
            'tenant_id' => (int) $user->tenant_id,
            'role' => $user->role ?? 'member',
            'is_super_admin' => !empty($user->is_super_admin),
            'is_tenant_super_admin' => !empty($user->is_tenant_super_admin),
            'is_god' => !empty($user->is_god),
        ]);

        return $next($request);
    }
}
