<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\TenantFeatureConfig;
use App\Services\TokenService;
use App\Services\TwoFactorChallengeManager;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Mockery;
use OTPHP\TOTP;
use Tests\Laravel\TestCase;

/**
 * Feature tests for TwoFactorController — 2FA setup, verify, disable.
 */
class TwoFactorControllerTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        Cache::flush();
    }

    private function authenticatedUser(array $attributes = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $attributes));

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function setTwoFactorEnrollmentAllowed(bool $allowed, ?int $tenantId = null): void
    {
        $tenantId ??= $this->testTenantId;
        $features = TenantFeatureConfig::FEATURE_DEFAULTS;
        $features['two_factor_authentication'] = $allowed;

        DB::table('tenants')->where('id', $tenantId)->update([
            'features' => json_encode($features),
        ]);

        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
    }

    private function enableTwoFactorFor(User $user): void
    {
        DB::table('user_totp_settings')->insert([
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'totp_secret_encrypted' => 'not-read-by-these-tests',
            'is_enabled' => 1,
            'is_pending_setup' => 0,
        ]);

        DB::table('users')->where('id', $user->id)->update([
            'totp_enabled' => 1,
            'totp_setup_required' => 0,
        ]);
    }

    // ------------------------------------------------------------------
    //  GET /v2/auth/2fa/status
    // ------------------------------------------------------------------

    public function test_status_requires_auth(): void
    {
        $response = $this->apiGet('/v2/auth/2fa/status');

        $response->assertStatus(401);
    }

    public function test_status_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/auth/2fa/status');

        $response->assertStatus(200);
    }

    public function test_status_preserves_existing_two_factor_when_new_enrollment_is_disabled(): void
    {
        $user = $this->authenticatedUser();
        $this->enableTwoFactorFor($user);
        $this->setTwoFactorEnrollmentAllowed(false);

        $response = $this->apiGet('/v2/auth/2fa/status');

        $response->assertOk()
            ->assertJsonPath('data.enabled', true)
            ->assertJsonPath('data.enrollment_allowed', false);
    }

    // ------------------------------------------------------------------
    //  POST /v2/auth/2fa/setup
    // ------------------------------------------------------------------

    public function test_setup_requires_auth(): void
    {
        $response = $this->apiPost('/v2/auth/2fa/setup');

        $response->assertStatus(401);
    }

    public function test_setup_returns_qr_data(): void
    {
        $user = $this->authenticatedUser();
        $this->withHeader('Authorization', 'Bearer ' . app(TokenService::class)->generateToken($user->id, $this->testTenantId));
        $this->setTwoFactorEnrollmentAllowed(true);

        $response = $this->apiPost('/v2/auth/2fa/setup');

        $response->assertStatus(200);
    }

    public function test_cross_tenant_setup_challenge_issues_home_tenant_login_tokens(): void
    {
        // The forced-admin setup routes remain behind auth:sanctum while that
        // feature is paused. Authenticate a transport user so this regression
        // can exercise the challenge-bound controller path without changing
        // the intentionally disabled routing/frontend flow.
        $this->authenticatedUser();
        $user = User::factory()->forTenant(999)->create([
            'role' => 'god',
            'is_god' => true,
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);
        $this->setTwoFactorEnrollmentAllowed(true, 999);

        $challengeManager = app(TwoFactorChallengeManager::class);
        $challenge = $challengeManager->create((int) $user->id, ['totp_setup'], 999);
        $this->assertSame($this->testTenantId, TenantContext::getId());

        $setupResponse = $this->apiPost('/v2/auth/2fa/setup', [
            'two_factor_token' => $challenge,
        ]);
        $setupResponse->assertOk()
            ->assertJsonStructure(['data' => ['secret', 'qr_code_url']]);

        $secret = (string) $setupResponse->json('data.secret');
        $this->assertNotSame('', $secret);

        $verifyResponse = $this->apiPost('/v2/auth/2fa/verify', [
            'two_factor_token' => $challenge,
            'code' => TOTP::createFromSecret($secret)->now(),
        ]);
        $verifyResponse->assertOk()
            ->assertJsonPath('data.login_complete', true)
            ->assertJsonPath('data.token_type', 'Bearer')
            ->assertJsonPath('data.expires_in', 900)
            ->assertJsonStructure(['data' => ['access_token', 'refresh_token']]);

        $accessToken = (string) $verifyResponse->json('data.access_token');
        $refreshToken = (string) $verifyResponse->json('data.refresh_token');
        $this->assertNotSame('', $accessToken);
        $this->assertNotSame('', $refreshToken);

        $tokenService = app(TokenService::class);
        $accessPayload = $tokenService->validateToken($accessToken);
        $refreshPayload = $tokenService->validateRefreshToken($refreshToken);
        $this->assertNotNull($accessPayload);
        $this->assertNotNull($refreshPayload);
        $this->assertSame((int) $user->id, (int) $accessPayload['user_id']);
        $this->assertSame((int) $user->id, (int) $refreshPayload['user_id']);
        $this->assertSame(999, (int) $accessPayload['tenant_id']);
        $this->assertSame(999, (int) $refreshPayload['tenant_id']);
        $this->assertSame(900, (int) $accessPayload['exp'] - (int) $accessPayload['nbf']);

        $this->assertNull($challengeManager->get($challenge));
        $this->assertSame($this->testTenantId, TenantContext::getId());
        $this->assertDatabaseHas('user_totp_settings', [
            'user_id' => $user->id,
            'tenant_id' => 999,
            'is_enabled' => 1,
        ]);
    }

    public function test_setup_challenge_is_preserved_when_login_token_issuance_fails(): void
    {
        $this->authenticatedUser();
        $user = User::factory()->forTenant(999)->create([
            'role' => 'god',
            'is_god' => true,
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);
        $this->setTwoFactorEnrollmentAllowed(true, 999);

        $challengeManager = app(TwoFactorChallengeManager::class);
        $challenge = $challengeManager->create((int) $user->id, ['totp_setup'], 999);
        $setupResponse = $this->apiPost('/v2/auth/2fa/setup', [
            'two_factor_token' => $challenge,
        ]);
        $setupResponse->assertOk();

        $tokenService = Mockery::mock(TokenService::class)->makePartial();
        $tokenService->shouldReceive('generateToken')
            ->once()
            ->andThrow(new \RuntimeException('Simulated token issuance failure.'));
        $this->app->instance(TokenService::class, $tokenService);

        $this->apiPost('/v2/auth/2fa/verify', [
            'two_factor_token' => $challenge,
            'code' => TOTP::createFromSecret((string) $setupResponse->json('data.secret'))->now(),
        ])
            ->assertStatus(500)
            ->assertJsonPath('errors.0.code', 'SETUP_FAILED');

        $this->assertNotNull($challengeManager->get($challenge));
        $this->assertDatabaseHas('user_totp_settings', [
            'user_id' => $user->id, 'is_enabled' => 0, 'is_pending_setup' => 1,
        ]);
        $this->assertDatabaseMissing('user_backup_codes', ['user_id' => $user->id]);
        $this->assertSame($this->testTenantId, TenantContext::getId());
    }

    public function test_setup_and_setup_verification_are_blocked_when_new_enrollment_is_disabled(): void
    {
        $user = $this->authenticatedUser();
        $this->withHeader('Authorization', 'Bearer ' . app(TokenService::class)->generateToken($user->id, $this->testTenantId));
        $this->setTwoFactorEnrollmentAllowed(false);

        $this->apiPost('/v2/auth/2fa/setup')
            ->assertForbidden()
            ->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');

        $this->apiPost('/v2/auth/2fa/verify', ['code' => '123456'])
            ->assertForbidden()
            ->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');
    }

    // ------------------------------------------------------------------
    //  POST /v2/auth/2fa/verify
    // ------------------------------------------------------------------

    public function test_verify_requires_auth(): void
    {
        $response = $this->apiPost('/v2/auth/2fa/verify', ['code' => '123456']);

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  POST /v2/auth/2fa/disable
    // ------------------------------------------------------------------

    public function test_disable_requires_auth(): void
    {
        $response = $this->apiPost('/v2/auth/2fa/disable');

        $response->assertStatus(401);
    }

    public function test_existing_two_factor_can_be_disabled_when_new_enrollment_is_disabled(): void
    {
        $user = $this->authenticatedUser([
            'password_hash' => Hash::make('correct-password'),
        ]);
        $this->enableTwoFactorFor($user);
        $this->setTwoFactorEnrollmentAllowed(false);
        $tokens = app(TokenService::class);
        $accessToken = $tokens->generateToken((int) $user->id, $this->testTenantId);
        $refreshToken = $tokens->generateRefreshToken((int) $user->id, $this->testTenantId);

        $this->apiPost('/v2/auth/2fa/disable', ['password' => 'correct-password'])
            ->assertOk();

        $this->assertDatabaseMissing('user_totp_settings', [
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
        ]);
        $this->assertDatabaseHas('users', [
            'id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'totp_enabled' => 0,
            'totp_setup_required' => 1,
        ]);
        $this->assertNull($tokens->validateToken($accessToken));
        $this->assertNull($tokens->validateRefreshToken($refreshToken));
        $this->assertDatabaseHas('refresh_token_sessions', [
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'revocation_reason' => 'two_factor_disabled',
        ]);
    }

    public function test_disable_rolls_factor_removal_back_when_session_revocation_fails(): void
    {
        $user = $this->authenticatedUser([
            'password_hash' => Hash::make('correct-password'),
        ]);
        $this->enableTwoFactorFor($user);
        DB::table('user_backup_codes')->insert([
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'code_hash' => password_hash('ROLLBACK', PASSWORD_DEFAULT),
            'is_used' => 0,
        ]);

        $tokenService = Mockery::mock(TokenService::class);
        $tokenService->shouldReceive('revokeAllTokensForUser')
            ->once()
            ->with((int) $user->id, 'two_factor_disabled')
            ->andReturn(0);
        $this->app->instance(TokenService::class, $tokenService);

        $this->apiPost('/v2/auth/2fa/disable', ['password' => 'correct-password'])
            ->assertStatus(403);

        $this->assertDatabaseHas('user_totp_settings', [
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'is_enabled' => 1,
        ]);
        $this->assertDatabaseHas('user_backup_codes', [
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'is_used' => 0,
        ]);
        $this->assertDatabaseHas('users', [
            'id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'totp_enabled' => 1,
            'totp_setup_required' => 0,
        ]);
    }
}
