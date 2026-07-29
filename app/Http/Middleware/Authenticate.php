<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Middleware;

use App\Core\ApiErrorCodes;
use App\Services\TokenService;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

/**
 * Authentication middleware for short-lived JWTs and stateful test/session
 * guards.
 *
 * User-login personal access tokens were retired when rotating refresh-token
 * families shipped. Bearer credentials must therefore validate as the current
 * short-lived JWT protocol; otherwise an old seven-day Sanctum token could
 * bypass the access-token lifetime and revocation guarantees.
 */
class Authenticate
{
    public function handle(Request $request, Closure $next, string ...$guards): Response
    {
        // Keep guard-based authentication for Laravel stateful requests and
        // Sanctum::actingAs() test fixtures, but never let a bearer personal
        // access token bypass the current JWT policy.
        $guards = empty($guards) ? ['sanctum'] : $guards;

        foreach ($request->bearerToken() === null ? $guards : [] as $guard) {
            try {
                $guardInstance = auth()->guard($guard);
                $guardAuthenticated = $guardInstance->check();
            } catch (\Throwable $e) {
                // Sanctum attempts to parse any bearer token before the legacy
                // JWT fallback below. A malformed/stale Sanctum token or schema
                // drift must not turn otherwise-valid JWT requests into 500s.
                Log::warning('[Auth] Guard check failed; trying legacy token fallback', [
                    'guard' => $guard,
                    'error' => $e->getMessage(),
                ]);
                continue;
            }

            if ($guardAuthenticated) {
                // Validate that the authenticated user belongs to the resolved tenant.
                // Without this check, Sanctum tokens work across any tenant since they
                // bypass the JWT tenant_id mismatch detection in TenantContext::resolve().
                $user = $guardInstance->user();
                $tenantId = \App\Core\TenantContext::getId();
                if ($user && $tenantId && (int) $user->tenant_id !== $tenantId) {
                    if (!$user->is_super_admin && !$user->is_god && !in_array($user->role ?? '', ['super_admin', 'god'], true)) {
                        \Illuminate\Support\Facades\Log::debug('[Auth] Sanctum user tenant mismatch', [
                            'user_id' => $user->id,
                            'user_tenant' => $user->tenant_id,
                            'request_tenant' => $tenantId,
                        ]);
                        return response()->json([
                            'errors' => [
                                ['code' => 'tenant_mismatch', 'message' => 'Your account does not belong to this community'],
                            ],
                            'success' => false,
                        ], 403, ['API-Version' => '2.0']);
                    }
                }

                // Validate the token's tenant_id matches the current tenant.
                // This prevents tokens issued for tenant A from being used against tenant B,
                // even when the user record itself is a super-admin allowed to cross tenants.
                // Tokens created before the tenant_id column existed will have null — those
                // are allowed through to avoid breaking existing sessions (nullable = graceful).
                if ($user && $request->bearerToken()) {
                    $tokenTenantId = $user->currentAccessToken()?->tenant_id ?? null;
                    $currentTenantId = \App\Core\TenantContext::getId();

                    if ($tokenTenantId !== null && $currentTenantId !== null
                        && (int) $tokenTenantId !== (int) $currentTenantId) {
                        if (!$user->is_super_admin && !$user->is_god && !in_array($user->role ?? '', ['super_admin', 'god'], true)) {
                            \Illuminate\Support\Facades\Log::debug('[Auth] Sanctum token tenant mismatch', [
                                'user_id'        => $user->id,
                                'token_tenant'   => $tokenTenantId,
                                'request_tenant' => $currentTenantId,
                            ]);
                            return response()->json([
                                'errors' => [
                                    ['code' => 'token_tenant_mismatch', 'message' => 'Token was not issued for this community'],
                                ],
                                'success' => false,
                            ], 403, ['API-Version' => '2.0']);
                        }
                    }
                }

                // Check user is active (not suspended/banned)
                if ($user && $user->status !== 'active') {
                    return response()->json([
                        'errors' => [
                            ['code' => 'account_suspended', 'message' => 'Your account has been suspended or deactivated'],
                        ],
                        'success' => false,
                    ], 403, ['API-Version' => '2.0']);
                }

                if ($user && !$this->isPrivilegedUser($user) && empty($user->is_approved)) {
                    return response()->json([
                        'errors' => [
                            [
                                'code' => ApiErrorCodes::AUTH_ACCOUNT_PENDING_APPROVAL,
                                'message' => __('svc_notifications_2.tenant_settings.pending_admin_approval'),
                            ],
                        ],
                        'success' => false,
                    ], 403, ['API-Version' => '2.0']);
                }

                auth()->shouldUse($guard);
                if ($user) {
                    Log::shareContext(['user_id' => (int) $user->id]);
                }
                // SetLocale ran in the api group, before this middleware, so it
                // could not see the member's saved language. Apply it now.
                SetLocale::applyUserPreference($request, $user);
                return $this->preventSharedCaching($next($request));
            }
        }

        // Bearer authentication uses the versioned, short-lived JWT contract.
        $token = $this->extractBearerToken($request);
        if ($token) {
            $validated = $this->validateLegacyToken($token);
            if ($validated) {
                // shouldUse AFTER setUser (setUser happens inside validateLegacyToken)
                auth()->shouldUse('sanctum');
                $user = auth()->guard('sanctum')->user();
                if ($user) {
                    Log::shareContext(['user_id' => (int) $user->id]);
                }
                // SetLocale ran in the api group, before the JWT was validated,
                // so it could not see the member's saved language. Apply it now.
                SetLocale::applyUserPreference($request, $user);
                return $this->preventSharedCaching($next($request));
            }
        }

        return response()->json([
            'errors' => [
                ['code' => 'auth_required', 'message' => 'Authentication required'],
            ],
            'success' => false,
        ], 401, [
            'API-Version' => '2.0',
        ]);
    }

    /**
     * Extract Bearer token from Authorization header or cookie.
     */
    private function extractBearerToken(Request $request): ?string
    {
        $header = $request->header('Authorization', '');
        if (str_starts_with($header, 'Bearer ')) {
            return substr($header, 7);
        }

        // SECURITY NOTE: auth_token cookie must be set with HttpOnly=true, Secure=true, SameSite=Lax.
        // Verify the Set-Cookie header is correct when this token is issued.
        // Prefer Authorization: Bearer header over cookies for API authentication.
        // Cookie format: cookie('auth_token', $token, $minutes, '/', null, true, true, false, 'Lax')
        //                Parameters: name, value, minutes, path, domain, secure, httpOnly, raw, sameSite
        return $request->cookie('auth_token');
    }

    /**
     * Validate a legacy JWT token and set up the legacy auth context.
     *
     * The legacy system uses $_SESSION['user_id'] for auth checks,
     * and delegation controllers call legacy code that reads from session.
     */
    private function validateLegacyToken(string $token): bool
    {
        try {
            $tokenService = app(TokenService::class);
            $payload = $tokenService->validateToken($token);

            if (!$payload) {
                \Illuminate\Support\Facades\Log::debug('[Auth] Legacy token validation returned null');
                return false;
            }

            // Token payload uses 'user_id' (not 'sub')
            $userId = (int) ($payload['user_id'] ?? $payload['sub'] ?? 0);
            if (!$userId) {
                \Illuminate\Support\Facades\Log::debug('[Auth] No user_id/sub in payload', ['keys' => array_keys($payload)]);
                return false;
            }

            // Tenant is already resolved by ResolveTenant middleware (runs before this)

            // Also set Laravel's auth user for any code using auth()
            $eloquentUser = \App\Models\User::withoutGlobalScopes()->find($userId);
            if (!$eloquentUser) {
                \Illuminate\Support\Facades\Log::debug('[Auth] User not found in DB', ['user_id' => $userId]);
                return false;
            }

            // Validate user is active and belongs to the resolved tenant
            if ($eloquentUser->status !== 'active') {
                \Illuminate\Support\Facades\Log::debug('[Auth] User is not active', ['user_id' => $userId, 'status' => $eloquentUser->status]);
                return false;
            }

            if (!$this->isPrivilegedUser($eloquentUser) && empty($eloquentUser->is_approved)) {
                \Illuminate\Support\Facades\Log::debug('[Auth] User is not approved', ['user_id' => $userId]);
                return false;
            }

            $tenantId = \App\Core\TenantContext::getId();
            if ($tenantId && (int) $eloquentUser->tenant_id !== $tenantId) {
                // Allow platform super admins to access any tenant. Tenant
                // super-admins are still scoped to their own tenant.
                if (!$eloquentUser->is_super_admin && !$eloquentUser->is_god && !in_array($eloquentUser->role ?? '', ['super_admin', 'god'], true)) {
                    \Illuminate\Support\Facades\Log::debug('[Auth] User tenant mismatch', ['user_id' => $userId, 'user_tenant' => $eloquentUser->tenant_id, 'request_tenant' => $tenantId]);
                    return false;
                }
            }

            auth()->guard('sanctum')->setUser($eloquentUser);

            return true;
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::error('[Auth] Legacy token exception: ' . $e->getMessage());
            return false;
        }
    }

    private function isPrivilegedUser(object $user): bool
    {
        return !empty($user->is_super_admin)
            || !empty($user->is_god)
            || !empty($user->is_tenant_super_admin)
            || in_array($user->role ?? '', ['admin', 'tenant_admin', 'super_admin', 'god'], true);
    }

    /**
     * Authenticated API payloads can contain member identity and personalized
     * state. Never allow a browser, proxy, or CDN to reuse them for another
     * session, even if an individual controller forgets cache headers.
     */
    private function preventSharedCaching(Response $response): Response
    {
        $response->headers->set('Cache-Control', 'private, no-store, max-age=0');
        $response->headers->set('Pragma', 'no-cache');

        // Symfony represents an array passed to setVary() as separate header
        // values. HeaderBag::get() (and some proxy integrations) then exposes
        // only the first value, which can hide the Cookie cache dimension.
        // Preserve any controller-provided dimensions while emitting one
        // unambiguous, standards-compliant Vary field.
        $vary = $response->getVary();
        foreach (['Authorization', 'Cookie'] as $requiredHeader) {
            $existingHeaders = array_map('strtolower', array_map('trim', explode(',', implode(',', $vary))));
            if (!in_array(strtolower($requiredHeader), $existingHeaders, true)) {
                $vary[] = $requiredHeader;
            }
        }
        $response->headers->set('Vary', implode(', ', $vary));

        return $response;
    }
}
