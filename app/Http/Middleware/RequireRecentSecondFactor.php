<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Middleware;

use App\Core\TenantContext;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Step-up check before a high-risk staff action (security register E-085).
 *
 * Staff may remember a device for up to 30 days, so a signed-in session no
 * longer proves that the person entered a second factor recently. Routes
 * behind this middleware pass only when either:
 *
 *  - the access token's second factor (TOTP, recovery code, passkey or
 *    upstream SSO MFA — never a remembered device) is younger than the
 *    window, or
 *  - the request carries a security-confirmation token minted by
 *    POST /api/webauthn/security-confirm from a second factor (TOTP, backup
 *    code, user-verified passkey or a fresh federated sign-in). A password
 *    alone is not a second factor and is refused here.
 *
 * Attach it after the route's own admission gate (`admin`, `broker-or-admin`,
 * `super-admin`) so a caller without the role is refused for that reason, not
 * prompted for a code. Usage: `step-up` (15 minutes) or `step-up:300`.
 */
class RequireRecentSecondFactor
{
    public const DEFAULT_WINDOW_SECONDS = 900;

    public const ERROR_CODE = 'AUTH_STEP_UP_REQUIRED';

    /** Confirmation methods that prove a second factor, not just a password. */
    private const SECOND_FACTOR_CONFIRMATIONS = ['totp', 'backup_code', 'passkey_uv', 'federated_login'];

    public function handle(Request $request, Closure $next, ?string $windowSeconds = null): Response
    {
        $window = $windowSeconds !== null && ctype_digit($windowSeconds) && (int) $windowSeconds > 0
            ? (int) $windowSeconds
            : self::DEFAULT_WINDOW_SECONDS;

        if (!self::passes($request, $window)) {
            return response()->json([
                'success' => false,
                'code' => self::ERROR_CODE,
                'errors' => [[
                    'code' => self::ERROR_CODE,
                    'message' => __('mfa.step_up_required'),
                    'field' => 'security_confirmation',
                ]],
            ], 403)->withHeaders([
                'Cache-Control' => 'private, no-store, max-age=0',
                'Pragma' => 'no-cache',
            ]);
        }

        $request->attributes->set('step_up_window', $window);

        return $next($request);
    }

    /**
     * Whether this request proves a recent second factor. Controllers that
     * re-check inside a transaction call this again with the same window.
     */
    public static function passes(Request $request, int $windowSeconds = self::DEFAULT_WINDOW_SECONDS): bool
    {
        $claims = $request->attributes->get('verified_auth_claims', []);
        if (!is_array($claims) || !empty($claims['impersonated_by'])) {
            return false;
        }

        $policy = app(TwoFactorPolicy::class);
        if ($policy->recentlyVerified($claims, $windowSeconds)) {
            return true;
        }

        // Bound the same way POST /api/webauthn/security-confirm binds it: the
        // signed-in user in the request's tenant context.
        $userId = (int) ($claims['user_id'] ?? $request->user()?->getAuthIdentifier() ?? 0);
        $tenantId = (int) (TenantContext::getId() ?? 0);
        if ($userId <= 0 || $tenantId <= 0) {
            return false;
        }

        $proof = $request->headers->get('X-Security-Confirmation')
            ?? $request->input('security_confirmation_token');
        if (!is_string($proof) || $proof === '') {
            return false;
        }

        $payload = app(TokenService::class)->validateSecurityConfirmationToken($proof, $userId, $tenantId);

        return is_array($payload)
            && in_array($payload['method'] ?? null, self::SECOND_FACTOR_CONFIRMATIONS, true);
    }
}
