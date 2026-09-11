<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Controllers;

use App\Core\TenantContext;
use App\Http\Controllers\Auth\SocialAuthController;
use App\Http\Controllers\Auth\SsoAuthController;
use App\Models\User;
use App\Services\Auth\SocialAuthService;
use App\Services\Auth\SsoOidcService;
use Illuminate\Http\Request;
use Mockery;
use Tests\Laravel\TestCase;

class AuthCallbackIssuanceTest extends TestCase
{
    private const BROWSER_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

    public function test_social_callback_restores_signed_tenant_and_delegates_locked_issuance(): void
    {
        $startedAt = time() - 10;
        $user = new User();
        $user->forceFill(['id' => 901, 'tenant_id' => $this->testTenantId]);

        $social = Mockery::mock(SocialAuthService::class);
        $social->shouldReceive('stateContext')
            ->once()
            ->with('signed-social-state')
            ->andReturn([
                'tenant_id' => $this->testTenantId,
                'authentication_started_at' => $startedAt,
                'intent' => 'login',
                'browser_challenge' => self::BROWSER_CHALLENGE,
            ]);
        $social->shouldReceive('handleCallback')
            ->once()
            ->with('google', 'signed-social-state')
            ->andReturn([
                'user' => $user,
                'is_new' => false,
                'tenant_id' => $this->testTenantId,
            ]);
        $social->shouldReceive('issueLoginCallbackCode')
            ->once()
            ->with(901, $this->testTenantId, 'google', false, $startedAt, self::BROWSER_CHALLENGE, null)
            ->andReturn(['status' => 'issued', 'callback_code' => 'social-once']);

        TenantContext::reset();
        $controller = new SocialAuthController($social);
        $response = $controller->callback(
            Request::create('/api/v2/auth/oauth/google/callback', 'GET', [
                'state' => 'signed-social-state',
            ]),
            'google'
        );

        $this->assertSame($this->testTenantId, TenantContext::getId());
        $query = $this->redirectQuery($response->getTargetUrl());
        $this->assertSame('social-once', $query['code']);
        $this->assertSame('google', $query['provider']);
        $this->assertSame(self::BROWSER_CHALLENGE, $query['flow']);
    }

    public function test_social_link_callback_defers_mutation_without_cross_site_cookie_dependency(): void
    {
        $startedAt = time() - 10;
        $user = new User();
        $user->forceFill(['id' => 904, 'tenant_id' => $this->testTenantId]);
        $identityLink = [
            'provider' => 'google',
            'provider_user_id' => 'google-link-subject',
            'provider_email' => 'linked@example.test',
            'avatar_url' => null,
            'raw_payload' => ['sub' => 'google-link-subject'],
            'authentication_started_at' => $startedAt,
            'expected_verified_email' => null,
        ];

        $social = Mockery::mock(SocialAuthService::class);
        $social->shouldReceive('stateContext')
            ->once()
            ->with('signed-link-state')
            ->andReturn([
                'tenant_id' => $this->testTenantId,
                'authentication_started_at' => $startedAt,
                'intent' => 'link',
                'browser_challenge' => self::BROWSER_CHALLENGE,
            ]);
        $social->shouldReceive('handleCallback')
            ->once()
            ->with('google', 'signed-link-state')
            ->andReturn([
                'user' => $user,
                'is_new' => false,
                'tenant_id' => $this->testTenantId,
                'identity_link' => $identityLink,
            ]);
        $social->shouldReceive('issuePendingLinkCallbackCode')
            ->once()
            ->with(
                904,
                $this->testTenantId,
                'google',
                $startedAt,
                self::BROWSER_CHALLENGE,
                $identityLink
            )
            ->andReturn(['status' => 'issued', 'callback_code' => 'link-once']);
        $social->shouldNotReceive('issueLoginCallbackCode');

        $request = Request::create(
            '/api/v2/auth/oauth/google/callback',
            'GET',
            ['state' => 'signed-link-state']
        );

        TenantContext::reset();
        $response = (new SocialAuthController($social))->callback($request, 'google');

        $query = $this->redirectQuery($response->getTargetUrl());
        $this->assertSame('link-once', $query['code']);
        $this->assertSame(self::BROWSER_CHALLENGE, $query['flow']);
        $this->assertFalse($response->headers->has('Set-Cookie'));
    }

    public function test_social_link_initiation_uses_browser_challenge_without_setting_api_cookie(): void
    {
        $user = new User();
        $user->forceFill(['id' => 905, 'tenant_id' => $this->testTenantId]);

        $social = Mockery::mock(SocialAuthService::class);
        $social->shouldReceive('redirectUrl')
            ->once()
            ->with(
                'google',
                $this->testTenantId,
                'link',
                905,
                self::BROWSER_CHALLENGE
            )
            ->andReturn([
                'url' => 'https://accounts.example.test/authorize',
                'state' => 'signed-link-state',
            ]);

        $request = Request::create('/api/v2/auth/oauth/google/link', 'POST', [
            'browser_challenge' => self::BROWSER_CHALLENGE,
        ]);
        $request->setUserResolver(static fn () => $user);

        $response = (new SocialAuthController($social))->link($request, 'google');
        $body = $response->getData(true);

        $this->assertTrue($body['success']);
        $this->assertSame('https://accounts.example.test/authorize', $body['redirect_url']);
        $this->assertFalse($response->headers->has('Set-Cookie'));
    }

    public function test_sso_callback_uses_signed_initiation_time_for_locked_issuance(): void
    {
        $startedAt = time() - 12;
        $body = base64_encode((string) json_encode([
            't' => $this->testTenantId,
            'p' => 'entra',
            'n' => 'nonce',
            'x' => $startedAt,
            'b' => self::BROWSER_CHALLENGE,
        ]));
        $state = $body . '.verified-by-service';

        $user = new User();
        $user->forceFill(['id' => 902, 'tenant_id' => $this->testTenantId]);
        $identityLink = [
            'provider' => 'sso:' . $this->testTenantId . ':entra',
            'provider_user_id' => 'oidc-subject',
            'provider_email' => 'member@example.test',
            'avatar_url' => null,
            'raw_payload' => ['sub' => 'oidc-subject'],
            'authentication_started_at' => $startedAt,
            'expected_verified_email' => 'member@example.test',
        ];

        $sso = Mockery::mock(SsoOidcService::class);
        $sso->shouldReceive('tenantIdFromState')
            ->once()
            ->with($state)
            ->andReturn($this->testTenantId);
        $sso->shouldReceive('handleCallback')
            ->once()
            ->with($state, 'oidc-code')
            ->andReturn([
                'user' => $user,
                'is_new' => false,
                'tenant_id' => $this->testTenantId,
                'provider_key' => 'entra',
                'authentication_started_at' => $startedAt,
                'browser_challenge' => self::BROWSER_CHALLENGE,
                'identity_link' => $identityLink,
            ]);

        $social = Mockery::mock(SocialAuthService::class);
        $social->shouldReceive('issueLoginCallbackCode')
            ->once()
            // Since the MFA baseline the controller also forwards the upstream MFA
            // timestamp (none here) and the SSO provider context (empty here).
            ->with(902, $this->testTenantId, 'sso:entra', false, $startedAt, self::BROWSER_CHALLENGE, $identityLink, false, null, [])
            ->andReturn(['status' => 'issued', 'callback_code' => 'sso-once']);

        TenantContext::reset();
        $controller = new SsoAuthController($sso, $social);
        $response = $controller->callback(
            Request::create('/api/v2/auth/sso/callback', 'GET', [
                'state' => $state,
                'code' => 'oidc-code',
            ])
        );

        $query = $this->redirectQuery($response->getTargetUrl());
        $this->assertSame('sso-once', $query['code']);
        $this->assertSame('sso:entra', $query['provider']);
        $this->assertSame(self::BROWSER_CHALLENGE, $query['flow']);
    }

    public function test_sso_callback_rejects_identity_from_a_different_tenant(): void
    {
        $startedAt = time() - 5;
        $body = base64_encode((string) json_encode([
            't' => $this->testTenantId,
            'p' => 'entra',
            'n' => 'nonce',
            'x' => $startedAt,
            'b' => self::BROWSER_CHALLENGE,
        ]));
        $state = $body . '.verified-by-service';
        $otherTenantId = $this->testTenantId + 1;

        $user = new User();
        $user->forceFill(['id' => 903, 'tenant_id' => $otherTenantId]);

        $sso = Mockery::mock(SsoOidcService::class);
        $sso->shouldReceive('tenantIdFromState')->once()->andReturn($this->testTenantId);
        $sso->shouldReceive('handleCallback')->once()->andReturn([
            'user' => $user,
            'is_new' => false,
            'tenant_id' => $otherTenantId,
            'provider_key' => 'entra',
            'authentication_started_at' => $startedAt,
            'browser_challenge' => self::BROWSER_CHALLENGE,
        ]);

        $social = Mockery::mock(SocialAuthService::class);
        $social->shouldNotReceive('issueLoginCallbackCode');

        TenantContext::reset();
        $controller = new SsoAuthController($sso, $social);
        $response = $controller->callback(
            Request::create('/api/v2/auth/sso/callback', 'GET', [
                'state' => $state,
                'code' => 'oidc-code',
            ])
        );

        $query = $this->redirectQuery($response->getTargetUrl());
        $this->assertSame('sso_failed', $query['error']);
    }

    /** @return array<string, string> */
    private function redirectQuery(string $url): array
    {
        $query = parse_url($url, PHP_URL_QUERY);
        self::assertIsString($query);
        parse_str($query, $parameters);

        return array_map('strval', $parameters);
    }
}
