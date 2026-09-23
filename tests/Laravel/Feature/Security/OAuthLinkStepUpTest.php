<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Models\User;
use App\Services\Auth\SocialAuthService;
use App\Services\TokenService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * F-056 — starting a Google/Facebook link for the signed-in account must need
 * the same fresh security confirmation (POST /webauthn/security-confirm) that
 * passkey registration needs. A bearer token alone is not enough.
 */
final class OAuthLinkStepUpTest extends TestCase
{
    use DatabaseTransactions;

    private const CHALLENGE = 'f056-browser-challenge-abcdefghijklmnopqrstuvwxyz0123456789';

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create();
    }

    private function confirmationToken(User $user, ?int $tenantId = null): string
    {
        return $this->app->make(TokenService::class)->generateSecurityConfirmationToken(
            (int) $user->id,
            $tenantId ?? $this->testTenantId,
            'password'
        );
    }

    private function expectNoLinkStarted(): void
    {
        $social = Mockery::mock(SocialAuthService::class);
        $social->shouldNotReceive('redirectUrl');
        $this->app->instance(SocialAuthService::class, $social);
    }

    private function expectLinkStarted(User $user): void
    {
        $social = Mockery::mock(SocialAuthService::class);
        $social->shouldReceive('redirectUrl')
            ->once()
            ->with('google', $this->testTenantId, 'link', (int) $user->id, self::CHALLENGE)
            ->andReturn(['url' => 'https://accounts.example.test/o/oauth2/auth', 'state' => 'signed-state']);
        $this->app->instance(SocialAuthService::class, $social);
    }

    public function test_link_without_security_confirmation_is_refused(): void
    {
        $user = $this->member();
        $this->expectNoLinkStarted();
        Sanctum::actingAs($user);

        $this->apiPost('/v2/auth/oauth/google/link', ['browser_challenge' => self::CHALLENGE])
            ->assertStatus(403)
            ->assertJsonPath('errors.0.code', 'SECURITY_CONFIRMATION_REQUIRED')
            ->assertJsonMissingPath('redirect_url');
    }

    public function test_link_with_a_forged_or_foreign_confirmation_is_refused(): void
    {
        $user = $this->member();
        $other = $this->member();
        $this->expectNoLinkStarted();
        Sanctum::actingAs($user);

        $this->apiPost('/v2/auth/oauth/google/link', [
            'browser_challenge' => self::CHALLENGE,
            'security_confirmation_token' => 'not-a-token',
        ])->assertStatus(403);

        // Another member's proof does not unlock this account.
        $this->apiPost('/v2/auth/oauth/google/link', [
            'browser_challenge' => self::CHALLENGE,
            'security_confirmation_token' => $this->confirmationToken($other),
        ])->assertStatus(403);

        // A proof minted for a different community does not either.
        $this->apiPost('/v2/auth/oauth/google/link', [
            'browser_challenge' => self::CHALLENGE,
            'security_confirmation_token' => $this->confirmationToken($user, $this->testTenantId + 1000),
        ])->assertStatus(403);

        // An ordinary access token is not a security confirmation.
        $access = $this->app->make(TokenService::class)->generateToken((int) $user->id, $this->testTenantId);
        $this->apiPost('/v2/auth/oauth/google/link', [
            'browser_challenge' => self::CHALLENGE,
            'security_confirmation_token' => $access,
        ])->assertStatus(403);
    }

    public function test_link_with_a_fresh_confirmation_in_the_body_starts_the_flow(): void
    {
        $user = $this->member();
        $this->expectLinkStarted($user);
        Sanctum::actingAs($user);

        $this->apiPost('/v2/auth/oauth/google/link', [
            'browser_challenge' => self::CHALLENGE,
            'security_confirmation_token' => $this->confirmationToken($user),
        ])->assertStatus(200)
            ->assertJsonPath('success', true)
            ->assertJsonPath('redirect_url', 'https://accounts.example.test/o/oauth2/auth');
    }

    public function test_link_with_a_fresh_confirmation_in_the_header_starts_the_flow(): void
    {
        $user = $this->member();
        $this->expectLinkStarted($user);
        Sanctum::actingAs($user);

        $this->apiPost(
            '/v2/auth/oauth/google/link',
            ['browser_challenge' => self::CHALLENGE],
            ['X-Security-Confirmation' => $this->confirmationToken($user)]
        )->assertStatus(200)
            ->assertJsonPath('success', true);
    }
}
