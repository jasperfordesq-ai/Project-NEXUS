<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Middleware;

use App\Services\TokenService;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Cookie;
use Symfony\Component\HttpFoundation\Response;

/**
 * Keep the long-lived browser refresh credential out of script-readable JSON.
 * Native clients without browser fetch metadata retain their existing contract.
 */
final class BrowserRefreshCookie
{
    private const COOKIE_PREFIX = '__Host-nexus_refresh_';

    public static function requestBinding(Request $request): ?string
    {
        $binding = $request->header('X-Nexus-Session-Binding');
        return is_string($binding) && preg_match('/^[a-f0-9]{64}$/D', $binding)
            ? $binding
            : null;
    }

    public static function cookieName(string $binding): string
    {
        return self::COOKIE_PREFIX . substr($binding, 0, 32);
    }

    public function handle(Request $request, Closure $next): Response
    {
        $origin = $request->headers->get('Origin');
        $hasBrowserMetadata = $origin !== null || $request->headers->has('Sec-Fetch-Site');
        $browserAuth = $hasBrowserMetadata && $this->isSameOrigin($request, $origin);

        // A browser can set X-Nexus-Mobile, but cannot remove its Origin or
        // Sec-Fetch-Site from a credential-issuing fetch. Never let that header
        // turn a browser response back into the native JSON token contract.
        if ($hasBrowserMetadata && !$browserAuth && $this->isCredentialRoute($request)) {
            return response()->json([
                'success' => false,
                'code' => 'AUTH_BROWSER_ORIGIN_INVALID',
                'message' => __('api.forbidden'),
            ], 403)->header('Cache-Control', 'private, no-store');
        }

        if ($browserAuth) {
            $request->attributes->set('nexus_browser_auth', true);
        }

        $response = $next($request);
        if (!$response instanceof JsonResponse) {
            return $response;
        }

        $body = $response->getData(true);
        if (!is_array($body)) {
            return $response;
        }

        // The mandatory 2FA setup response uses BaseApiController's `data`
        // envelope; the other sign-in issuers return top-level credentials.
        $nested = is_array($body['data'] ?? null)
            && is_string($body['data']['refresh_token'] ?? null);
        $refreshToken = $nested ? $body['data']['refresh_token'] : ($body['refresh_token'] ?? null);
        if ($hasBrowserMetadata && !$browserAuth && is_string($refreshToken)) {
            return response()->json([
                'success' => false,
                'code' => 'AUTH_BROWSER_ORIGIN_INVALID',
                'message' => __('api.forbidden'),
            ], 403)->header('Cache-Control', 'private, no-store');
        }
        if (!$browserAuth) {
            return $response;
        }
        if (is_string($refreshToken) && $refreshToken !== '') {
            $tokens = app(TokenService::class);
            $payload = $tokens->inspectRefreshTokenForRotation($refreshToken);
            $familyId = $payload['family_id'] ?? null;
            $expiresAt = $tokens->getExpiration($refreshToken);
            if (!is_string($familyId) || $familyId === '' || $expiresAt === null || $expiresAt <= time()) {
                return response()->json([
                    'success' => false,
                    'code' => 'AUTH_SESSION_ISSUANCE_FAILED',
                    'message' => __('api.forbidden'),
                ], 500)->header('Cache-Control', 'private, no-store');
            }
            if ($nested) {
                unset($body['data']['refresh_token']);
            } else {
                unset($body['refresh_token']);
            }
            // This is a non-secret continuity marker. A delayed response for
            // account A can overwrite B's cookie before JS sees it; the client
            // compares this marker before adopting a refreshed identity.
            $binding = hash('sha256', $familyId);
            if ($nested) {
                $body['data']['session_binding'] = $binding;
            } else {
                $body['session_binding'] = $binding;
            }
            $response->setData($body);
            $response->headers->setCookie($this->cookie($refreshToken, $expiresAt, $binding));
            $response->headers->set('Cache-Control', 'private, no-store');
        } elseif ($request->is('api/auth/logout') ||
            ($request->is('api/auth/refresh-token') && $response->getStatusCode() === 401)) {
            $binding = self::requestBinding($request);
            if ($binding !== null) {
                $response->headers->setCookie($this->cookie('', time() - 3600, $binding));
            }
            $response->headers->set('Cache-Control', 'private, no-store');
        }

        return $response;
    }

    private function cookie(string $value, int $expiresAt, string $binding): Cookie
    {
        return Cookie::create(self::cookieName($binding), $value)
            ->withExpires($expiresAt)
            ->withPath('/')
            ->withSecure(true)
            ->withHttpOnly(true)
            ->withSameSite(Cookie::SAMESITE_LAX);
    }

    private function isSameOrigin(Request $request, ?string $origin): bool
    {
        if ($origin === null || $origin === 'null' || preg_match('/\s/', $origin)) {
            return false;
        }
        $parts = parse_url($origin);
        if (!is_array($parts) || isset($parts['user']) || isset($parts['pass'])
            || isset($parts['path']) || isset($parts['query']) || isset($parts['fragment'])) {
            return false;
        }
        $scheme = $parts['scheme'] ?? '';
        $host = strtolower((string) ($parts['host'] ?? ''));
        $local = app()->environment(['local', 'testing'])
            && in_array($host, ['localhost', '127.0.0.1'], true);
        if ($scheme !== 'https' && !($local && $scheme === 'http')) {
            return false;
        }
        if ($host === '' || $host !== strtolower($request->getHost())) {
            return false;
        }
        $originPort = $parts['port'] ?? ($scheme === 'https' ? 443 : 80);
        $hostHeader = (string) $request->headers->get('Host', '');
        $hostPort = parse_url($scheme . '://' . $hostHeader, PHP_URL_PORT)
            ?? ($scheme === 'https' ? 443 : 80);
        return (int) $originPort === (int) $hostPort;
    }

    private function isCredentialRoute(Request $request): bool
    {
        return $request->is(
            'api/auth/login',
            'api/auth/refresh-token',
            'api/auth/logout',
            'api/totp/verify',
            'api/v2/auth/2fa/verify',
            'api/webauthn/auth-verify',
            'api/v2/auth/oauth/exchange',
            'api/v2/auth/register'
        );
    }
}
