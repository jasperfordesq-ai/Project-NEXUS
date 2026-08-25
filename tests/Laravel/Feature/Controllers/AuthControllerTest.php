<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Core\ApiErrorCodes;
use App\Core\TenantContext;
use App\Core\TotpEncryption;
use App\Models\User;
use App\Services\AuthenticationConfigurationService;
use App\Services\TenantFeatureConfig;
use App\Services\TokenService;
use App\Services\TotpService;
use App\Services\TwoFactorChallengeManager;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use OTPHP\TOTP;
use Tests\Laravel\TestCase;

/**
 * Feature tests for AuthController.
 *
 * Covers login, logout, refresh-token, heartbeat, and session endpoints.
 */
class AuthControllerTest extends TestCase
{
    use DatabaseTransactions;

    protected function tearDown(): void
    {
        AuthenticationConfigurationService::clearCache($this->testTenantId);
        AuthenticationConfigurationService::clearCache(999);
        parent::tearDown();
    }

    // ================================================================
    // LOGIN — Happy path
    // ================================================================

    public function test_login_returns_token_and_user_on_valid_credentials(): void
    {
        $email = 'auth_' . uniqid() . '@example.com';
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'email' => $email,
            'password_hash' => Hash::make('correct-password'),
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);

        $response = $this->apiPost('/auth/login', [
            'email' => $email,
            'password' => 'correct-password',
        ]);

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'success',
            'user' => ['id', 'first_name', 'last_name', 'email', 'tenant_id', 'role'],
            'access_token',
            'refresh_token',
            'token_type',
            'expires_in',
        ]);
        $response->assertJson(['success' => true]);
        $response->assertJsonPath('sanctum_token', null);
        $this->assertSame($response->json('access_token'), $response->json('token'));
        $this->assertDatabaseMissing('personal_access_tokens', [
            'tokenable_type' => User::class,
            'tokenable_id' => $user->id,
        ]);
        $this->assertArrayNotHasKey('user_id', $_SESSION ?? []);
    }

    public function test_disabled_trusted_devices_cannot_bypass_existing_two_factor_login(): void
    {
        $email = 'auth_2fa_' . uniqid() . '@example.com';
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'email' => $email,
            'password_hash' => Hash::make('correct-password'),
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);

        DB::table('user_totp_settings')->insert([
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'totp_secret_encrypted' => 'not-read-during-password-login',
            'is_enabled' => 1,
            'is_pending_setup' => 0,
        ]);

        $trustedToken = 'known-trusted-device-token-' . $user->id . '-' . uniqid('', true);
        DB::table('user_trusted_devices')->insert([
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'device_token_hash' => hash('sha256', $trustedToken),
            'device_name' => 'Existing trusted device',
            'ip_address' => '127.0.0.1',
            'expires_at' => now()->addDays(30),
            'is_revoked' => 0,
        ]);

        AuthenticationConfigurationService::set(
            AuthenticationConfigurationService::CONFIG_TWO_FACTOR_ALLOW_TRUSTED_DEVICES,
            false,
            $this->testTenantId
        );
        AuthenticationConfigurationService::set(
            AuthenticationConfigurationService::CONFIG_TWO_FACTOR_TRUSTED_DEVICE_DAYS,
            14,
            $this->testTenantId
        );

        $features = TenantFeatureConfig::FEATURE_DEFAULTS;
        $features['two_factor_authentication'] = false;
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode($features),
        ]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);

        $response = $this->apiPost('/auth/login', [
            'email' => $email,
            'password' => 'correct-password',
        ], [
            'X-Trusted-Device' => $trustedToken,
        ]);

        $response->assertOk()
            ->assertJsonPath('success', false)
            ->assertJsonPath('requires_2fa', true)
            ->assertJsonPath('allow_trusted_device', false)
            ->assertJsonPath('trusted_device_days', 14);
        $this->assertArrayNotHasKey('access_token', $response->json());
    }

    public function test_revocation_between_password_verification_and_challenge_creation_invalidates_completion(): void
    {
        $email = 'auth_2fa_race_' . uniqid() . '@example.com';
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'email' => $email,
            'password_hash' => Hash::make('correct-password'),
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);
        $secret = TotpService::generateSecret();
        DB::table('user_totp_settings')->insert([
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'totp_secret_encrypted' => TotpEncryption::encrypt($secret),
            'is_enabled' => 1,
            'is_pending_setup' => 0,
        ]);

        $realChallenges = new TwoFactorChallengeManager();
        $challengeManager = \Mockery::mock(TwoFactorChallengeManager::class)->makePartial();
        $challengeManager->shouldReceive('create')
            ->once()
            ->andReturnUsing(function (
                int $userId,
                array $methods,
                ?int $tenantId,
                ?int $authenticationStartedAt
            ) use ($realChallenges, $user): string {
                $this->assertSame((int) $user->id, $userId);
                $this->assertNotNull($authenticationStartedAt);
                $this->assertGreaterThan(
                    0,
                    app(TokenService::class)->revokeAllTokensForUser($userId, 'password_changed')
                );

                return $realChallenges->create(
                    $userId,
                    $methods,
                    $tenantId,
                    $authenticationStartedAt
                );
            });
        app()->instance(TwoFactorChallengeManager::class, $challengeManager);

        $login = $this->apiPost('/auth/login', [
            'email' => $email,
            'password' => 'correct-password',
        ]);
        $login->assertOk()
            ->assertJsonPath('requires_2fa', true);

        $this->apiPost('/totp/verify', [
            'two_factor_token' => $login->json('two_factor_token'),
            'code' => TOTP::createFromSecret($secret)->now(),
        ])->assertStatus(401)
            ->assertJsonPath('errors.0.code', 'AUTH_2FA_TOKEN_EXPIRED');

        $this->assertDatabaseMissing('refresh_token_sessions', [
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
        ]);
    }

    public function test_revocation_after_password_verification_prevents_direct_token_issuance(): void
    {
        $email = 'auth_direct_race_' . uniqid() . '@example.com';
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'email' => $email,
            'password_hash' => Hash::make('correct-password'),
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);

        $realSettings = app(\App\Services\TenantSettingsService::class);
        $settings = \Mockery::mock($realSettings)->makePartial();
        $settings->shouldReceive('checkLoginGatesForUser')
            ->once()
            ->andReturnUsing(function (array $resolvedUser) use ($user): ?array {
                $this->assertSame((int) $user->id, (int) $resolvedUser['id']);
                $this->assertGreaterThan(
                    0,
                    app(TokenService::class)->revokeAllTokensForUser(
                        (int) $user->id,
                        'logout_all'
                    )
                );

                return null;
            });
        app()->instance(\App\Services\TenantSettingsService::class, $settings);

        $this->apiPost('/auth/login', [
            'email' => $email,
            'password' => 'correct-password',
        ])->assertStatus(401)
            ->assertJsonPath('errors.0.code', ApiErrorCodes::AUTH_INVALID_CREDENTIALS)
            ->assertJsonMissingPath('access_token')
            ->assertJsonMissingPath('refresh_token');

        $this->assertDatabaseMissing('refresh_token_sessions', [
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
        ]);
    }

    public function test_login_rejects_pending_user_before_token_issue(): void
    {
        $email = 'auth_pending_' . uniqid() . '@example.com';
        User::factory()->forTenant($this->testTenantId)->create([
            'email' => $email,
            'password_hash' => Hash::make('correct-password'),
            'status' => 'pending',
            'is_approved' => false,
            'email_verified_at' => now(),
        ]);

        $response = $this->apiPost('/auth/login', [
            'email' => $email,
            'password' => 'correct-password',
        ]);

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', ApiErrorCodes::AUTH_ACCOUNT_PENDING_APPROVAL);
        $this->assertArrayNotHasKey('access_token', $response->json());
        $this->assertArrayNotHasKey('refresh_token', $response->json());
    }

    public function test_login_rejects_active_unapproved_member_before_token_issue(): void
    {
        $email = 'auth_unapproved_' . uniqid() . '@example.com';
        User::factory()->forTenant($this->testTenantId)->create([
            'email' => $email,
            'password_hash' => Hash::make('correct-password'),
            'status' => 'active',
            'is_approved' => false,
            'email_verified_at' => now(),
        ]);

        $response = $this->apiPost('/auth/login', [
            'email' => $email,
            'password' => 'correct-password',
        ]);

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', ApiErrorCodes::AUTH_ACCOUNT_PENDING_APPROVAL);
        $this->assertArrayNotHasKey('access_token', $response->json());
        $this->assertArrayNotHasKey('refresh_token', $response->json());
    }

    // ================================================================
    // LOGIN — Validation errors
    // ================================================================

    public function test_login_returns_400_when_email_missing(): void
    {
        $response = $this->apiPost('/auth/login', [
            'password' => 'secret',
        ]);

        $response->assertStatus(400);
    }

    public function test_login_returns_400_when_password_missing(): void
    {
        $response = $this->apiPost('/auth/login', [
            'email' => 'auth@example.com',
        ]);

        $response->assertStatus(400);
    }

    public function test_login_returns_400_when_both_fields_empty(): void
    {
        $response = $this->apiPost('/auth/login', []);

        $response->assertStatus(400);
    }

    // ================================================================
    // LOGIN — Invalid credentials (401)
    // ================================================================

    public function test_login_returns_401_with_wrong_password(): void
    {
        $email = 'auth_' . uniqid() . '@example.com';
        User::factory()->forTenant($this->testTenantId)->create([
            'email' => $email,
            'password_hash' => Hash::make('correct-password'),
            'status' => 'active',
            'email_verified_at' => now(),
        ]);

        $response = $this->apiPost('/auth/login', [
            'email' => $email,
            'password' => 'wrong-password',
        ]);

        $response->assertStatus(401);
    }

    public function test_login_returns_401_for_nonexistent_email(): void
    {
        $response = $this->apiPost('/auth/login', [
            'email' => 'no-such-user@example.com',
            'password' => 'irrelevant',
        ]);

        $response->assertStatus(401);
    }

    // ================================================================
    // LOGIN — Tenant isolation
    // ================================================================

    public function test_login_rejects_user_from_different_tenant(): void
    {
        // Seed a second tenant
        \Illuminate\Support\Facades\DB::table('tenants')->insertOrIgnore([
            'id' => 999,
            'name' => 'Other Timebank',
            'slug' => 'other-timebank',
            'is_active' => true,
            'depth' => 0,
            'allows_subtenants' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        User::factory()->forTenant(999)->create([
            'email' => 'other-tenant@example.com',
            'password_hash' => Hash::make('secret123'),
            'status' => 'active',
            'email_verified_at' => now(),
        ]);

        $response = $this->apiPost('/auth/login', [
            'email' => 'other-tenant@example.com',
            'password' => 'secret123',
        ]);

        $this->assertContains($response->getStatusCode(), [400, 401, 403]);
    }

    public function test_login_finds_god_account_across_tenant_context(): void
    {
        \Illuminate\Support\Facades\DB::table('tenants')->updateOrInsert(
            ['id' => 1],
            [
                'name' => 'Master Tenant',
                'slug' => null,
                'is_active' => true,
                'depth' => 0,
                'allows_subtenants' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );

        $email = 'god_' . uniqid() . '@example.com';
        User::factory()->forTenant(1)->create([
            'email' => $email,
            'password_hash' => Hash::make('correct-password'),
            'role' => 'god',
            'is_god' => true,
            'is_super_admin' => false,
            'is_tenant_super_admin' => false,
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);

        $response = $this->apiPost('/auth/login', [
            'email' => $email,
            'password' => 'correct-password',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('success', true);
        $response->assertJsonPath('user.email', $email);
        $response->assertJsonPath('user.role', 'god');
    }

    public function test_login_rejects_tenant_super_admin_from_different_tenant(): void
    {
        $email = 'tenant_admin_' . uniqid() . '@example.com';
        User::factory()->forTenant(999)->create([
            'email' => $email,
            'password_hash' => Hash::make('correct-password'),
            'role' => 'tenant_admin',
            'is_super_admin' => false,
            'is_tenant_super_admin' => true,
            'is_god' => false,
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);

        $response = $this->apiPost('/auth/login', [
            'email' => $email,
            'password' => 'correct-password',
        ]);

        $response->assertUnauthorized();
        $this->assertArrayNotHasKey('access_token', $response->json());
        $this->assertArrayNotHasKey('refresh_token', $response->json());
    }

    public function test_cross_tenant_platform_admin_login_uses_home_tenant_two_factor_settings(): void
    {
        $email = 'god_2fa_' . uniqid() . '@example.com';
        $user = User::factory()->forTenant(999)->create([
            'email' => $email,
            'password_hash' => Hash::make('correct-password'),
            'role' => 'god',
            'is_god' => true,
            'is_super_admin' => false,
            'is_tenant_super_admin' => false,
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);

        DB::table('user_totp_settings')->insert([
            'user_id' => $user->id,
            'tenant_id' => 999,
            'totp_secret_encrypted' => 'not-read-during-password-login',
            'is_enabled' => 1,
            'is_pending_setup' => 0,
        ]);

        $response = $this->apiPost('/auth/login', [
            'email' => $email,
            'password' => 'correct-password',
        ]);

        $response->assertOk()
            ->assertJsonPath('success', false)
            ->assertJsonPath('requires_2fa', true);
        $this->assertArrayNotHasKey('access_token', $response->json());

        $challenge = app(TwoFactorChallengeManager::class)
            ->get((string) $response->json('two_factor_token'));
        $this->assertNotNull($challenge);
        $this->assertSame((int) $user->id, $challenge['user_id']);
        $this->assertSame(999, $challenge['tenant_id']);
    }

    // ================================================================
    // LOGOUT
    // ================================================================

    public function test_logout_returns_success(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
        ]);
        Sanctum::actingAs($user, ['*']);

        $response = $this->apiPost('/auth/logout');

        $response->assertStatus(200);
        $response->assertJson(['success' => true]);
    }

    public function test_logout_revokes_refresh_family_after_access_identity_expires(): void
    {
        $tokens = \Mockery::mock(TokenService::class);
        $tokens->shouldReceive('revokeToken')
            ->once()
            ->with('still-valid-refresh-token', null)
            ->andReturn(true);
        app()->instance(TokenService::class, $tokens);

        $this->apiPost('/auth/logout', [
            'refresh_token' => 'still-valid-refresh-token',
        ])
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('refresh_token_revoked', true);
    }

    public function test_logout_revokes_the_presented_access_and_refresh_credentials(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);
        $tokens = app(TokenService::class);
        $access = $tokens->generateToken((int) $user->id, $this->testTenantId);
        $refresh = $tokens->generateRefreshToken((int) $user->id, $this->testTenantId);

        $this->apiPost('/auth/logout', [
            'refresh_token' => $refresh,
        ], [
            'Authorization' => 'Bearer ' . $access,
        ])->assertOk();

        $this->assertNull($tokens->validateToken($access));
        $this->assertNull($tokens->validateRefreshToken($refresh));
        $this->apiGet('/v2/users/me', [
            'Authorization' => 'Bearer ' . $access,
        ])->assertUnauthorized();
    }

    public function test_revoke_all_fails_closed_when_session_revocation_cannot_be_persisted(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);

        $tokens = \Mockery::mock(TokenService::class);
        $tokens->shouldReceive('revokeAllTokensForUser')
            ->once()
            ->with((int) $user->id)
            ->andReturn(0);
        app()->instance(TokenService::class, $tokens);

        $this->apiPost('/auth/revoke-all')
            ->assertStatus(500)
            ->assertJsonPath('errors.0.code', ApiErrorCodes::SERVER_INTERNAL_ERROR);
    }

    // ================================================================
    // REFRESH TOKEN — Validation
    // ================================================================

    public function test_refresh_token_returns_400_when_token_missing(): void
    {
        $response = $this->apiPost('/auth/refresh-token', []);

        $response->assertStatus(400);
    }

    public function test_refresh_token_returns_401_with_invalid_token(): void
    {
        $response = $this->apiPost('/auth/refresh-token', [
            'refresh_token' => 'invalid-bogus-token',
        ]);

        $response->assertStatus(401);
    }

    public function test_refresh_token_rejects_non_string_input_without_a_server_error(): void
    {
        $this->apiPost('/auth/refresh-token', [
            'refresh_token' => ['not', 'a', 'token'],
        ])->assertStatus(400)
            ->assertJsonPath('errors.0.code', ApiErrorCodes::AUTH_TOKEN_MISSING);
    }

    public function test_refresh_token_is_consumed_and_rotated_on_every_use(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);
        $tokens = app(TokenService::class);
        $refresh = $tokens->generateRefreshToken((int) $user->id, $this->testTenantId);

        $response = $this->apiPost('/auth/refresh-token', [
            'refresh_token' => $refresh,
        ]);

        $response->assertStatus(200)
            ->assertJsonPath('success', true)
            ->assertJsonPath('expires_in', 900);
        $successor = $response->json('refresh_token');
        $this->assertIsString($successor);
        $this->assertNotSame($refresh, $successor);
        $this->assertNull($tokens->validateRefreshToken($refresh));
        $this->assertNotNull($tokens->validateRefreshToken($successor));
        $this->assertLessThanOrEqual(2592000, (int) $response->json('refresh_expires_in'));
    }

    public function test_family_logout_invalidates_a_delayed_refreshed_access_token(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);
        $tokens = app(TokenService::class);
        $refresh = $tokens->generateRefreshToken((int) $user->id, $this->testTenantId);

        $response = $this->apiPost('/auth/refresh-token', [
            'refresh_token' => $refresh,
        ])->assertOk();
        $access = (string) $response->json('access_token');
        $successor = (string) $response->json('refresh_token');

        $this->assertNotSame('', $access);
        $this->assertNotNull($tokens->validateToken($access));
        $this->assertNotNull($tokens->validateRefreshToken($successor));
        $this->assertTrue($tokens->revokeToken($refresh));
        $this->assertNull($tokens->validateRefreshToken($successor));
        $this->assertNull($tokens->validateToken($access));
    }

    public function test_immediate_duplicate_refresh_returns_409_without_credentials_and_preserves_winner(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);
        $tokens = app(TokenService::class);
        $refresh = $tokens->generateRefreshToken((int) $user->id, $this->testTenantId);

        $winner = $this->apiPost('/auth/refresh-token', [
            'refresh_token' => $refresh,
        ]);
        $winner->assertOk();
        $successor = $winner->json('refresh_token');
        $this->assertIsString($successor);

        $loser = $this->apiPost('/auth/refresh-token', [
            'refresh_token' => $refresh,
        ]);
        $loser->assertStatus(409)
            ->assertJsonPath('success', false)
            ->assertJsonPath('errors.0.code', ApiErrorCodes::AUTH_REFRESH_SUPERSEDED);
        $this->assertArrayNotHasKey('access_token', $loser->json());
        $this->assertArrayNotHasKey('refresh_token', $loser->json());
        $this->assertArrayNotHasKey('retry_after', $loser->json());
        $this->assertNotNull($tokens->validateRefreshToken($successor));
        $this->assertSame(
            0,
            DB::table('refresh_token_sessions')
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', $user->id)
                ->whereNotNull('revoked_at')
                ->count()
        );
    }

    public function test_duplicate_refresh_outside_grace_is_a_replay_and_revokes_winner(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);
        $tokens = app(TokenService::class);
        $refresh = $tokens->generateRefreshToken((int) $user->id, $this->testTenantId);
        $payload = $this->decodeJwt($refresh);

        $winner = $this->apiPost('/auth/refresh-token', [
            'refresh_token' => $refresh,
        ]);
        $winner->assertOk();
        $successor = $winner->json('refresh_token');
        $this->assertIsString($successor);

        DB::table('refresh_token_sessions')
            ->where('jti_hash', hash('sha256', (string) $payload['jti']))
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->update(['consumed_at' => now()->subSeconds(6)]);

        $this->apiPost('/auth/refresh-token', [
            'refresh_token' => $refresh,
        ])->assertStatus(401)
            ->assertJsonPath('errors.0.code', ApiErrorCodes::AUTH_TOKEN_EXPIRED);
        $this->assertNull($tokens->validateRefreshToken($successor));
    }

    public function test_mobile_headers_cannot_extend_refreshed_credentials(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);
        $refresh = app(TokenService::class)->generateRefreshToken(
            (int) $user->id,
            $this->testTenantId
        );

        $response = $this->apiPost('/auth/refresh-token', [
            'refresh_token' => $refresh,
        ], [
            'User-Agent' => 'nexus-mobile',
            'X-Nexus-Mobile' => '1',
            'X-Capacitor-App' => '1',
        ]);

        $response->assertStatus(200)
            ->assertJsonPath('is_mobile', true)
            ->assertJsonPath('expires_in', 900);
        $this->assertLessThanOrEqual(2592000, (int) $response->json('refresh_expires_in'));
    }

    // ================================================================
    // HEARTBEAT — Authentication required
    // ================================================================

    public function test_heartbeat_returns_401_without_auth(): void
    {
        $response = $this->apiPost('/auth/heartbeat');

        $response->assertStatus(401);
    }

    public function test_restored_api_session_cannot_outlive_its_access_token_window(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);
        $access = app(TokenService::class)->generateToken(
            (int) $user->id,
            $this->testTenantId,
            ['role' => $user->role]
        );

        $this->apiPost('/auth/restore-session', [], [
            'Authorization' => 'Bearer ' . $access,
        ])->assertOk();

        $this->assertSame((int) $user->id, (int) ($_SESSION['user_id'] ?? 0));
        $this->assertSame(1, (int) ($_SESSION['_api_session_bridge_version'] ?? 0));

        $_SESSION['_api_access_expires_at'] = time() - 1;

        $this->apiGet('/auth/check-session')
            ->assertStatus(401)
            ->assertJsonPath('authenticated', false);
        $this->assertArrayNotHasKey('user_id', $_SESSION ?? []);
    }

    // ================================================================
    // CSRF TOKEN — Public endpoint
    // ================================================================

    public function test_csrf_token_endpoint_returns_200(): void
    {
        $response = $this->apiGet('/auth/csrf-token');

        $response->assertStatus(200);
    }

    // ================================================================
    // VALIDATE TOKEN
    // ================================================================

    public function test_validate_token_without_bearer_returns_error(): void
    {
        $response = $this->apiGet('/auth/validate-token');

        // Without a token it should indicate a missing token request error.
        $response->assertStatus(400);
    }

    /** @return array<string, mixed> */
    private function decodeJwt(string $token): array
    {
        $parts = explode('.', $token);

        return json_decode(
            base64_decode(strtr($parts[1], '-_', '+/')),
            true,
            512,
            JSON_THROW_ON_ERROR
        );
    }
}
