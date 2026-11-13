<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Middleware;

use App\Core\TenantContext;
use App\Services\OnboardingConfigService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Ensure the authenticated user has completed onboarding before allowing access
 * to "settled member" actions (creating listings, sending messages, transferring
 * credits, etc.). Without this gate, the onboarding wizard is purely a frontend
 * redirect and a user with a valid token can hit any API endpoint directly.
 *
 * Behavior:
 *  - Unauthenticated → 401 (matches the rest of the auth-required middleware family)
 *  - Onboarding switched off, or not mandatory, for this tenant → pass through
 *  - User has onboarding_completed = true → pass through
 *  - Admins/super-admins → pass through (so they can manage incomplete users)
 *  - Otherwise → 403 with code ONBOARDING_REQUIRED so the frontend can redirect
 */
class EnsureOnboardingComplete
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (!$user) {
            return response()->json([
                'errors' => [
                    ['code' => 'auth_required', 'message' => 'Authentication required'],
                ],
                'success' => false,
            ], 401, ['API-Version' => '2.0']);
        }

        // Admins bypass — they need to manage incomplete users
        $role = (string) ($user->role ?? '');
        $isAdmin = $user->is_admin
            || $user->is_super_admin
            || $user->is_tenant_super_admin
            || $user->is_god
            || in_array($role, ['admin', 'tenant_admin', 'super_admin'], true);
        if ($isAdmin) {
            return $next($request);
        }

        if (!empty($user->onboarding_completed)) {
            return $next($request);
        }

        // Honor the tenant config — if the welcome steps are switched off, or
        // are not mandatory, allow through
        try {
            if (!OnboardingConfigService::isMandatory(TenantContext::getId())) {
                return $next($request);
            }
        } catch (\Throwable $e) {
            // Config lookup failure is non-fatal; default to enforcing the gate
        }

        return response()->json([
            'errors' => [[
                'code'    => 'ONBOARDING_REQUIRED',
                'message' => 'Please complete onboarding to access this resource',
            ]],
            'success' => false,
        ], 403, ['API-Version' => '2.0']);
    }
}
