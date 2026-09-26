<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Middleware;

use App\Http\Middleware\BrowserRefreshCookie;
use App\Services\TokenService;
use Illuminate\Http\Request;
use Mockery;
use Tests\Laravel\TestCase;

class BrowserRefreshCookieTest extends TestCase
{
    private function request(array $headers = []): Request
    {
        return Request::create('https://community.example.test/api/auth/login', 'POST', [], [], [], [
            'HTTP_HOST' => 'community.example.test',
            ...$headers,
        ]);
    }

    private function issuedResponse(): \Illuminate\Http\JsonResponse
    {
        return response()->json([
            'success' => true,
            'access_token' => 'short-lived-access',
            'refresh_token' => 'long-lived-refresh',
            'refresh_expires_in' => 2592000,
        ]);
    }

    public function test_same_origin_browser_receives_only_an_http_only_host_cookie(): void
    {
        $tokens = Mockery::mock(TokenService::class);
        $tokens->shouldReceive('inspectRefreshTokenForRotation')
            ->once()->with('long-lived-refresh')->andReturn(['family_id' => 'family-123']);
        $tokens->shouldReceive('getExpiration')->once()->with('long-lived-refresh')
            ->andReturn(time() + 2592000);
        app()->instance(TokenService::class, $tokens);

        $request = $this->request(['HTTP_ORIGIN' => 'https://community.example.test']);
        $response = (new BrowserRefreshCookie())->handle($request, fn () => $this->issuedResponse());

        $this->assertTrue($request->attributes->get('nexus_browser_auth'));
        $body = $response->getData(true);
        $this->assertArrayNotHasKey('refresh_token', $body);
        $this->assertSame('short-lived-access', $body['access_token']);
        $this->assertSame(hash('sha256', 'family-123'), $body['session_binding']);
        $cookie = (string) $response->headers->getCookies()[0];
        $this->assertStringContainsString(
            BrowserRefreshCookie::cookieName(hash('sha256', 'family-123')) . '=long-lived-refresh',
            $cookie
        );
        $this->assertStringContainsString('secure', strtolower($cookie));
        $this->assertStringContainsString('httponly', strtolower($cookie));
        $this->assertStringContainsString('samesite=lax', strtolower($cookie));
        $this->assertStringContainsString('path=/', strtolower($cookie));
        $this->assertStringNotContainsString('domain=', strtolower($cookie));
    }

    public function test_native_request_retains_json_contract(): void
    {
        $response = (new BrowserRefreshCookie())->handle($this->request(), fn () => $this->issuedResponse());
        $this->assertSame('long-lived-refresh', $response->getData(true)['refresh_token']);
        $this->assertSame([], $response->headers->getCookies());
    }

    public function test_browser_two_factor_data_envelope_hides_refresh_credential(): void
    {
        $tokens = Mockery::mock(TokenService::class);
        $tokens->shouldReceive('inspectRefreshTokenForRotation')
            ->once()->with('long-lived-refresh')->andReturn(['family_id' => 'family-123']);
        $tokens->shouldReceive('getExpiration')->once()->with('long-lived-refresh')
            ->andReturn(time() + 2592000);
        app()->instance(TokenService::class, $tokens);

        $request = Request::create('https://community.example.test/api/v2/auth/2fa/verify', 'POST', [], [], [], [
            'HTTP_HOST' => 'community.example.test',
            'HTTP_ORIGIN' => 'https://community.example.test',
        ]);
        $response = (new BrowserRefreshCookie())->handle($request, fn () => response()->json([
            'success' => true,
            'data' => [
                'access_token' => 'short-lived-access',
                'refresh_token' => 'long-lived-refresh',
            ],
        ]));

        $body = $response->getData(true);
        $this->assertArrayNotHasKey('refresh_token', $body['data']);
        $this->assertSame('short-lived-access', $body['data']['access_token']);
        $this->assertSame(hash('sha256', 'family-123'), $body['data']['session_binding']);
        $this->assertCount(1, $response->headers->getCookies());
    }

    public function test_spoofed_mobile_header_cannot_restore_browser_json_credential(): void
    {
        $tokens = Mockery::mock(TokenService::class);
        $tokens->shouldReceive('inspectRefreshTokenForRotation')
            ->once()->andReturn(['family_id' => 'family-123']);
        $tokens->shouldReceive('getExpiration')->once()->andReturn(time() + 2592000);
        app()->instance(TokenService::class, $tokens);

        $request = $this->request([
            'HTTP_ORIGIN' => 'https://community.example.test',
            'HTTP_X_NEXUS_MOBILE' => '1',
        ]);
        $response = (new BrowserRefreshCookie())->handle($request, fn () => $this->issuedResponse());
        $this->assertArrayNotHasKey('refresh_token', $response->getData(true));
    }

    public function test_cross_origin_and_opaque_browser_requests_cannot_receive_refresh_json(): void
    {
        foreach ([
            ['HTTP_ORIGIN' => 'https://other.example.test'],
            ['HTTP_ORIGIN' => 'null', 'HTTP_SEC_FETCH_SITE' => 'cross-site'],
            ['HTTP_SEC_FETCH_SITE' => 'same-origin'],
        ] as $headers) {
            $response = (new BrowserRefreshCookie())->handle(
                $this->request($headers), fn () => $this->issuedResponse()
            );
            $this->assertSame(403, $response->getStatusCode());
            $this->assertStringNotContainsString('long-lived-refresh', $response->getContent());
        }
    }

    /**
     * Run $fn with the application environment temporarily set to $env.
     * The suite always boots as "testing" (tests/bootstrap.php), which is on
     * every loopback allow-list, so the environment has to be switched to
     * exercise the gate at all.
     */
    private function inEnvironment(string $env, callable $fn): mixed
    {
        $previous = $this->app['env'];
        $this->app['env'] = $env;
        try {
            return $fn();
        } finally {
            $this->app['env'] = $previous;
        }
    }

    private function loopbackLogin(string $origin, string $host): \Symfony\Component\HttpFoundation\Response
    {
        $request = Request::create("http://{$host}/api/auth/login", 'POST', [], [], [], [
            'HTTP_HOST' => $host,
            'HTTP_ORIGIN' => $origin,
        ]);

        // A refused login (no credential issued) keeps this about the origin
        // gate alone — the cookie-issuing path is covered above.
        return (new BrowserRefreshCookie())->handle(
            $request,
            fn () => response()->json(['success' => false], 401)
        );
    }

    /**
     * E-036 / F-209: the documented local stack runs APP_ENV=development.
     * The plain-HTTP loopback allowance listed only local/testing, so every
     * browser sign-in on a developer's machine was refused with 403
     * AUTH_BROWSER_ORIGIN_INVALID before the password was checked.
     */
    public function test_development_environment_allows_plain_http_loopback_sign_in(): void
    {
        foreach ([
            ['http://localhost:5173', 'localhost:5173'],
            ['http://127.0.0.1:5173', '127.0.0.1:5173'],
        ] as [$origin, $host]) {
            $response = $this->inEnvironment('development', fn () => $this->loopbackLogin($origin, $host));

            $this->assertNotSame(403, $response->getStatusCode(), "{$origin} must reach the controller");
            $this->assertSame(401, $response->getStatusCode());
        }
    }

    public function test_plain_http_loopback_stays_refused_outside_developer_environments(): void
    {
        foreach (['production', 'staging'] as $env) {
            $response = $this->inEnvironment(
                $env,
                fn () => $this->loopbackLogin('http://localhost:5173', 'localhost:5173')
            );

            $this->assertSame(403, $response->getStatusCode(), "{$env} must not accept plain HTTP");
            $this->assertStringContainsString('AUTH_BROWSER_ORIGIN_INVALID', $response->getContent());
        }
    }

    public function test_development_allowance_is_loopback_only(): void
    {
        $response = $this->inEnvironment(
            'development',
            fn () => $this->loopbackLogin('http://community.example.test', 'community.example.test')
        );

        $this->assertSame(403, $response->getStatusCode());
    }

    public function test_logout_clears_only_the_bound_browser_cookie(): void
    {
        $binding = hash('sha256', 'family-123');
        $request = Request::create('https://community.example.test/api/auth/logout', 'POST', [], [], [], [
            'HTTP_HOST' => 'community.example.test',
            'HTTP_ORIGIN' => 'https://community.example.test',
            'HTTP_X_NEXUS_SESSION_BINDING' => $binding,
        ]);
        $response = (new BrowserRefreshCookie())->handle($request, fn () => response()->json(['success' => true]));
        $cookie = $response->headers->getCookies()[0];
        $this->assertSame(BrowserRefreshCookie::cookieName($binding), $cookie->getName());
        $this->assertNotSame(BrowserRefreshCookie::cookieName(hash('sha256', 'other-family')), $cookie->getName());
        $this->assertSame('', $cookie->getValue());
        $this->assertLessThan(time(), $cookie->getExpiresTime());
    }
}
