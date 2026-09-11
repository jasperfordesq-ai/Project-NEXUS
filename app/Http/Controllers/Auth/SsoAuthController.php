<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Auth;

use App\Core\TenantContext;
use App\Services\Auth\SocialAuthService;
use App\Services\Auth\SsoOidcService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\Log;

/**
 * SSO engine (IT-Sec-05) — HTTP layer for tenant-configured OIDC
 * providers (Entra ID, Hivebrite, …).
 *
 * Endpoints:
 *  GET /api/v2/auth/sso/providers              public — enabled providers for tenant
 *  GET /api/v2/auth/sso/{provider}/redirect    public — upstream authorization URL
 *  GET /api/v2/auth/sso/callback               public — single OIDC redirect URI
 *
 * The callback hands off to the same frontend route and exchange
 * endpoint as social OAuth (/auth/oauth/callback + /v2/auth/oauth/exchange),
 * via SocialAuthService's one-time callback codes — no new frontend
 * token plumbing.
 */
class SsoAuthController extends Controller
{
    public function __construct(
        private readonly SsoOidcService $sso,
        private readonly SocialAuthService $social,
    ) {
    }

    public function providers(Request $request): JsonResponse
    {
        $tenantId = TenantContext::getId() ?: (int) $request->input('tenant_id', 0);
        if ($tenantId <= 0) {
            return response()->json(['success' => true, 'providers' => []]);
        }
        return response()->json([
            'success' => true,
            'providers' => $this->sso->enabledProviders($tenantId),
        ]);
    }

    public function redirect(Request $request, string $provider): JsonResponse
    {
        try {
            $tenantId = TenantContext::getId() ?: (int) $request->input('tenant_id', 0);
            if ($tenantId <= 0) {
                return response()->json([
                    'success' => false,
                    'error' => 'tenant_required',
                    'message' => __('api.social_tenant_required'),
                ], 400);
            }

            $browserChallenge = $request->input('browser_challenge');
            $result = $this->sso->redirectUrl(
                $tenantId,
                $provider,
                is_string($browserChallenge) ? $browserChallenge : null
            );

            return response()->json([
                'success' => true,
                'redirect_url' => $result['url'],
                'provider' => $provider,
            ]);
        } catch (\Throwable $e) {
            Log::warning('[SSO] redirect failed: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'error' => 'sso_redirect_failed',
                'message' => __('api.sso_redirect_failed'),
            ], 400);
        }
    }

    /**
     * Single redirect URI for every tenant + provider: the signed state
     * token carries tenant id and provider key. Identity providers are
     * registered with exactly this URL.
     */
    public function callback(Request $request)
    {
        $state = (string) $request->input('state', '');
        $code = (string) $request->input('code', '');

        // The OIDC round-trip lands on the tenant-less api host, so ambient
        // TenantContext would resolve to the default tenant. Re-establish the
        // tenant from the signed state token (its signature is verified) so
        // the post-login redirect — success AND error — targets the right
        // community's frontend, including custom-domain tenants.
        $stateTenantId = $this->sso->tenantIdFromState($state);
        if ($stateTenantId !== null) {
            TenantContext::setById($stateTenantId);
        }
        $frontend = rtrim(TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix(), '/');

        try {
            if ($state === '' || $code === '') {
                $upstreamError = (string) $request->input('error_description', (string) $request->input('error', ''));
                throw new \RuntimeException($upstreamError !== '' ? $upstreamError : 'SSO callback missing code or state.');
            }

            $result = $this->sso->handleCallback($state, $code);
            /** @var \App\Models\User $user */
            $user = $result['user'];
            if (
                $stateTenantId === null
                || (int) $result['tenant_id'] !== $stateTenantId
                || (int) $user->tenant_id !== $stateTenantId
            ) {
                throw new \RuntimeException('SSO identity tenant does not match signed state.');
            }

            $issuance = $this->social->issueLoginCallbackCode(
                (int) $user->id,
                (int) $user->tenant_id,
                'sso:' . $result['provider_key'],
                (bool) $result['is_new'],
                (int) $result['authentication_started_at'],
                (string) $result['browser_challenge'],
                isset($result['identity_link']) && is_array($result['identity_link'])
                    ? $result['identity_link']
                    : null,
                (bool) ($result['upstream_mfa_verified'] ?? false),
                $result['upstream_mfa_verified_at'] ?? null,
                $result['sso_provider_context'] ?? []
            );
            if (($issuance['status'] ?? null) !== 'issued' || empty($issuance['callback_code'])) {
                throw new \RuntimeException(
                    'SSO credential issuance rejected: ' . (string) ($issuance['status'] ?? 'unknown')
                );
            }
            $oneTimeCode = (string) $issuance['callback_code'];

            $params = http_build_query([
                'code' => $oneTimeCode,
                'provider' => 'sso:' . $result['provider_key'],
                'flow' => $result['browser_challenge'],
            ]);
            return redirect($frontend . '/auth/oauth/callback?' . $params);
        } catch (\Throwable $e) {
            Log::warning('[SSO] callback failed: ' . $e->getMessage());
            $params = http_build_query([
                'error' => 'sso_failed',
                'message' => __('api.sso_login_failed'),
            ]);
            return redirect($frontend . '/auth/oauth/callback?' . $params);
        }
    }
}
