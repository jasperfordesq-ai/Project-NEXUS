<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Auth;

use App\Core\TenantContext;
use App\Services\Auth\SocialAuthService;
use App\Services\Auth\SsoIdentityInUseException;
use App\Services\Auth\SsoLinkRequiredException;
use App\Services\Auth\SsoOidcService;
use App\Services\TokenService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
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
 *  POST   /api/v2/auth/sso/{provider}/link     auth — link a provider to the signed-in member
 *  DELETE /api/v2/auth/sso/{provider}/unlink   auth — remove a linked provider
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

        if ($stateTenantId !== null && $this->sso->isLinkState($state)) {
            return $this->linkCallback($request, $state, $code, $stateTenantId, $frontend);
        }

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
        } catch (SsoLinkRequiredException $e) {
            // F-244: an existing member must link this provider themselves.
            // The same code covers "provisioning disabled", so it does not
            // reveal whether the asserted email has an account.
            Log::info('[SSO] callback refused; member must link the provider from settings');
            $params = http_build_query([
                'error' => 'sso_link_required',
                'message' => __('api.sso_account_exists_link_required'),
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

    /**
     * POST /api/v2/auth/sso/{providerKey}/link — auth.
     *
     * Starts linking one of the member's own community's SSO providers to
     * the signed-in account. Mirrors SocialAuthController::link: linking adds
     * a permanent sign-in method, so it needs the F-056 fresh security
     * confirmation (body `security_confirmation_token` or the
     * X-Security-Confirmation header).
     */
    public function link(Request $request, string $providerKey): JsonResponse
    {
        $user = $request->user();
        if (! $user) {
            return response()->json(['success' => false, 'error' => 'unauthenticated'], 401);
        }
        $tenantId = (int) $user->tenant_id;

        $confirmation = $request->input('security_confirmation_token')
            ?? $request->headers->get('X-Security-Confirmation');
        if (
            ! is_string($confirmation)
            || $confirmation === ''
            || app(TokenService::class)->validateSecurityConfirmationToken($confirmation, (int) $user->id, $tenantId) === null
        ) {
            return response()->json([
                'success' => false,
                'error' => 'SECURITY_CONFIRMATION_REQUIRED',
                'code' => 'SECURITY_CONFIRMATION_REQUIRED',
                'message' => __('api.validation_failed'),
                'errors' => [[
                    'code' => 'SECURITY_CONFIRMATION_REQUIRED',
                    'message' => __('api.validation_failed'),
                    'field' => 'security_confirmation',
                ]],
            ], 403)->header('Cache-Control', 'no-store, private');
        }

        try {
            $browserChallenge = $request->input('browser_challenge');
            // The provider is looked up in the member's own community only.
            $redirect = $this->sso->linkRedirectUrl(
                $tenantId,
                $providerKey,
                (int) $user->id,
                is_string($browserChallenge) ? $browserChallenge : null
            );

            return response()->json([
                'success' => true,
                'redirect_url' => $redirect['url'],
                'state' => $redirect['state'],
                'provider' => $providerKey,
            ])->header('Cache-Control', 'no-store, private');
        } catch (\Throwable $e) {
            Log::warning('[SSO] link start failed: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'error' => 'sso_link_failed',
                'message' => __('api.sso_link_failed'),
            ], 400);
        }
    }

    /**
     * DELETE /api/v2/auth/sso/{providerKey}/unlink — auth.
     *
     * Same rules as SocialAuthController::unlink: refuses to remove the last
     * sign-in method, and revokes every session on success.
     */
    public function unlink(Request $request, string $providerKey): JsonResponse
    {
        $user = $request->user();
        if (! $user) {
            return response()->json(['success' => false, 'error' => 'unauthenticated'], 401);
        }
        try {
            $this->social->unlinkProvider(
                (int) $user->id,
                $this->sso->identityProviderString((int) $user->tenant_id, $providerKey)
            );
            return response()->json(['success' => true]);
        } catch (\Throwable $e) {
            Log::warning('SSO identity unlink failed', [
                'provider_key' => $providerKey,
                'user_id' => (int) $user->id,
                'error' => $e->getMessage(),
            ]);
            return response()->json([
                'success' => false,
                'error' => 'unlink_failed',
                'message' => __('api.social_oauth_unlink_failed'),
            ], 422);
        }
    }

    /**
     * Callback for a LINK state. Never signs anyone in and never matches by
     * email: the verified subject is bound to the member named in the signed
     * state, through the same browser-bound pending-link code the Google /
     * Facebook link flow uses. The member lands on the frontend callback page
     * with `intent=link`, which returns them to their account settings.
     */
    private function linkCallback(
        Request $request,
        string $state,
        string $code,
        int $stateTenantId,
        string $frontend
    ): RedirectResponse {
        try {
            if ($code === '') {
                $upstreamError = (string) $request->input('error_description', (string) $request->input('error', ''));
                throw new \RuntimeException($upstreamError !== '' ? $upstreamError : 'SSO link callback missing code.');
            }

            $result = $this->sso->handleLinkCallback($state, $code);
            /** @var \App\Models\User $user */
            $user = $result['user'];
            if ((int) $result['tenant_id'] !== $stateTenantId || (int) $user->tenant_id !== $stateTenantId) {
                throw new \RuntimeException('SSO link member does not belong to the signed state tenant.');
            }

            $issuance = $this->social->issuePendingLinkCallbackCode(
                (int) $user->id,
                (int) $user->tenant_id,
                'sso:' . $result['provider_key'],
                (int) $result['authentication_started_at'],
                (string) $result['browser_challenge'],
                $result['identity_link'],
                $result['sso_provider_context']
            );
            if (($issuance['status'] ?? null) !== 'issued' || empty($issuance['callback_code'])) {
                throw new \RuntimeException(
                    'SSO link issuance rejected: ' . (string) ($issuance['status'] ?? 'unknown')
                );
            }

            return redirect($frontend . '/auth/oauth/callback?' . http_build_query([
                'code' => (string) $issuance['callback_code'],
                'provider' => 'sso:' . $result['provider_key'],
                'flow' => $result['browser_challenge'],
                'intent' => 'link',
            ]));
        } catch (SsoIdentityInUseException $e) {
            Log::notice('[SSO] link refused: identity already linked to another account');
            return redirect($frontend . '/auth/oauth/callback?' . http_build_query([
                'error' => 'sso_identity_in_use',
                'message' => __('api.sso_identity_in_use'),
                'intent' => 'link',
            ]));
        } catch (\Throwable $e) {
            Log::warning('[SSO] link callback failed: ' . $e->getMessage());
            return redirect($frontend . '/auth/oauth/callback?' . http_build_query([
                'error' => 'sso_link_failed',
                'message' => __('api.sso_link_failed'),
                'intent' => 'link',
            ]));
        }
    }
}
