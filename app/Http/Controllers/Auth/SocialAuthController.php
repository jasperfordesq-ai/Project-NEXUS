<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Auth;

use Illuminate\Routing\Controller;
use App\Services\Auth\SocialAuthService;
use App\Core\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * SOC13 — Social login (OAuth) HTTP layer.
 *
 * Endpoints:
 *  GET    /api/v2/auth/oauth/{provider}/redirect   public — returns redirect URL
 *  GET    /api/v2/auth/oauth/{provider}/callback   public — OAuth callback
 *  POST   /api/v2/auth/oauth/{provider}/link       auth — initiate link flow for current user
 *  DELETE /api/v2/auth/oauth/{provider}/unlink     auth — remove a linked provider
 *  GET    /api/v2/auth/oauth/me/identities         auth — list current user's identities
 */
class SocialAuthController extends Controller
{
    public function __construct(
        private readonly SocialAuthService $social,
    ) {
    }

    /**
     * Public endpoint — returns the list of OAuth providers enabled for the
     * current tenant. Empty array when OAUTH_ENABLED env flag is off, or when
     * the tenant has explicitly disabled all providers. Frontend uses this to
     * decide whether to render vetted Google/Facebook buttons.
     */
    public function enabledProviders(Request $request): JsonResponse
    {
        $tenantId = TenantContext::getId() ?: (int) $request->input('tenant_id', 0);
        if ($tenantId <= 0) {
            return response()->json(['success' => true, 'providers' => []]);
        }
        return response()->json([
            'success' => true,
            'providers' => $this->social->enabledProviders($tenantId),
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
            $intent = (string) $request->input('intent', 'login');
            if (! in_array($intent, ['login', 'register'], true)) {
                $intent = 'login';
            }

            $requestedBrowserChallenge = $request->input('browser_challenge');
            $result = $this->social->redirectUrl(
                $provider,
                $tenantId,
                $intent,
                null,
                is_string($requestedBrowserChallenge) ? $requestedBrowserChallenge : null
            );

            if (! empty($result['error']) && $result['error'] === 'socialite_not_installed') {
                return response()->json([
                    'success' => false,
                    'error' => 'socialite_not_installed',
                    'message' => __('api.social_oauth_unavailable'),
                ], 503);
            }

            return response()->json([
                'success' => true,
                'redirect_url' => $result['url'],
                'state' => $result['state'],
                'provider' => $provider,
            ]);
        } catch (\Throwable $e) {
            Log::warning('[SocialAuth] redirect failed: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'error' => 'oauth_redirect_failed',
                'message' => __('api.social_oauth_redirect_failed'),
            ], 400);
        }
    }

    public function callback(Request $request, string $provider)
    {
        $frontend = rtrim(TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix(), '/');

        try {
            $state = (string) ($request->input('state') ?? '');
            if ($state === '') {
                throw new \RuntimeException('OAuth state missing.');
            }

            $stateContext = $this->social->stateContext($state);
            if ($stateContext === null) {
                throw new \RuntimeException('OAuth state is invalid or expired.');
            }

            // The provider round-trip may land on the tenant-less API host.
            // Restore the tenant only from the verified, signed state before
            // resolving the redirect target or issuing tenant-bound credentials.
            TenantContext::setById($stateContext['tenant_id']);
            $frontend = rtrim(TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix(), '/');

            $result = $this->social->handleCallback($provider, $state);
            /** @var \App\Models\User $user */
            $user = $result['user'];
            if ((int) $user->tenant_id !== $stateContext['tenant_id']) {
                throw new \RuntimeException('OAuth callback tenant mismatch.');
            }

            $browserChallenge = $stateContext['browser_challenge'];
            $identityLink = isset($result['identity_link']) && is_array($result['identity_link'])
                ? $result['identity_link']
                : null;
            if ($stateContext['intent'] === 'link') {
                if ($identityLink === null) {
                    throw new \RuntimeException('OAuth link callback identity is missing.');
                }
                $issuance = $this->social->issuePendingLinkCallbackCode(
                    (int) $user->id,
                    (int) $user->tenant_id,
                    $provider,
                    $stateContext['authentication_started_at'],
                    $browserChallenge,
                    $identityLink
                );
            } else {
                $issuance = $this->social->issueLoginCallbackCode(
                    (int) $user->id,
                    (int) $user->tenant_id,
                    $provider,
                    (bool) $result['is_new'],
                    $stateContext['authentication_started_at'],
                    $browserChallenge,
                    $identityLink
                );
            }
            if (($issuance['status'] ?? null) !== 'issued' || empty($issuance['callback_code'])) {
                throw new \RuntimeException(
                    'OAuth credential issuance rejected: ' . (string) ($issuance['status'] ?? 'unknown')
                );
            }
            $code = (string) $issuance['callback_code'];

            $callbackParams = [
                'code' => $code,
                'provider' => $provider,
            ];
            $callbackParams['flow'] = $browserChallenge;
            $params = http_build_query($callbackParams);
            return redirect($frontend . '/auth/oauth/callback?' . $params);
        } catch (\Throwable $e) {
            Log::warning('[SocialAuth] callback failed: ' . $e->getMessage());
            $params = http_build_query([
                'error' => 'oauth_failed',
                'message' => __('api.social_oauth_link_failed'),
                'provider' => $provider,
            ]);
            return redirect($frontend . '/auth/oauth/callback?' . $params);
        }
    }

    public function exchange(Request $request): JsonResponse
    {
        try {
            $browserVerifier = $request->input('browser_verifier');
            $payload = $this->social->consumeCallbackCode(
                (string) $request->input('code', ''),
                is_string($browserVerifier) ? $browserVerifier : null
            );

            if (!empty($payload['requires_2fa']) || !empty($payload['requires_2fa_setup'])) {
                return response()->json(['success' => true, ...$payload])->header('Cache-Control', 'private, no-store');
            }
            return response()->json([
                'success' => true,
                'token' => $payload['token'],
                'access_token' => $payload['token'],
                'refresh_token' => $payload['refresh_token'],
                'expires_in' => $payload['expires_in'],
                'refresh_expires_in' => $payload['refresh_expires_in'],
                'token_type' => 'Bearer',
                'provider' => $payload['provider'],
                'is_new' => $payload['is_new'],
                'tenant_id' => $payload['tenant_id'],
            ]);
        } catch (\Throwable $e) {
            return response()->json([
                'success' => false,
                'error' => 'invalid_oauth_code',
                'message' => __('api.social_oauth_link_failed'),
            ], 400);
        }
    }

    public function link(Request $request, string $provider): JsonResponse
    {
        $user = $request->user();
        if (! $user) {
            return response()->json(['success' => false, 'error' => 'unauthenticated'], 401);
        }
        try {
            $tenantId = (int) $user->tenant_id;
            $browserChallenge = $request->input('browser_challenge');
            $redirect = $this->social->redirectUrl(
                $provider,
                $tenantId,
                'link',
                (int) $user->id,
                is_string($browserChallenge) ? $browserChallenge : null
            );
            if (! empty($redirect['error']) && $redirect['error'] === 'socialite_not_installed') {
                return response()->json([
                    'success' => false,
                    'error' => 'socialite_not_installed',
                ], 503);
            }
            return response()->json([
                'success' => true,
                'redirect_url' => $redirect['url'],
                'state' => $redirect['state'],
            ]);
        } catch (\Throwable $e) {
            return response()->json([
                'success' => false,
                'error' => 'oauth_link_failed',
                'message' => __('api.social_oauth_unlink_failed'),
            ], 400);
        }
    }

    public function unlink(Request $request, string $provider): JsonResponse
    {
        $user = $request->user();
        if (! $user) {
            return response()->json(['success' => false, 'error' => 'unauthenticated'], 401);
        }
        try {
            $this->social->unlinkProvider((int) $user->id, $provider);
            return response()->json(['success' => true]);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('Social OAuth unlink failed', [
                'provider' => $provider,
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

    public function identities(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user) {
            return response()->json(['success' => false, 'error' => 'unauthenticated'], 401);
        }
        $identities = $this->social->listIdentities((int) $user->id);
        $tenantId = (int) $user->tenant_id;
        $enabled = $this->social->enabledProviders($tenantId);
        return response()->json([
            'success' => true,
            'identities' => $identities,
            'enabled_providers' => $enabled,
            'supported_providers' => SocialAuthService::SUPPORTED_PROVIDERS,
        ]);
    }
}
