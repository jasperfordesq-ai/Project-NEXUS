<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Auth;

use App\Core\TotpEncryption;
use App\Models\User;
use App\Services\TokenService;
use App\Services\TotpService;
use App\Services\TwoFactorChallengeManager;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Mockery;
use OTPHP\TOTP;
use Tests\Laravel\TestCase;

class TwoFactorOperationalAuditTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
    }

    private function member(array $attributes = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active', 'is_approved' => true, 'email_verified_at' => now(),
        ], $attributes));
    }

    public function test_sso_preserves_historical_mfa_time_and_requires_local_mfa_when_time_is_unknown(): void
    {
        $admin = $this->member(['role' => 'admin']);
        $service = app(\App\Services\Auth\SocialAuthService::class);
        $method = new \ReflectionMethod($service, 'issueLoginCredentials');
        $historical = time() - 3600;
        $issued = $method->invoke($service, $admin->id, $admin->tenant_id, time(), null, true, $historical);
        $this->assertSame('credentials_issued', $issued['status']);
        $tokens = app(TokenService::class);
        $this->assertSame($historical, $tokens->validateToken($issued['access_token'])['mfa_verified_at']);
        $this->assertSame($historical, $tokens->validateRefreshToken($issued['refresh_token'])['mfa_verified_at']);
        $target = $this->member();
        $this->apiPost('/v2/admin/users/' . $target->id . '/reset-2fa', ['reason' => 'Verified recovery incident'],
            ['Authorization' => 'Bearer ' . $issued['access_token']])->assertStatus(403);
        foreach ([null, 0, time() + 3600] as $invalidTime) {
            $unknown = $method->invoke($service, $admin->id, $admin->tenant_id, time(), null, true, $invalidTime);
            $this->assertSame('mfa_challenge', $unknown['status']);
            $this->assertArrayNotHasKey('access_token', $unknown);
        }
    }

    public function test_privileged_sso_requires_host_approved_tenant_issuer_client_and_provider_binding(): void
    {
        $admin = $this->member(['role' => 'admin']);
        $service = app(\App\Services\Auth\SocialAuthService::class);
        $method = new \ReflectionMethod($service, 'issueLoginCredentials');
        $trusted = ['tenant_id' => $admin->tenant_id, 'provider_key' => 'council',
            'issuer_url' => 'https://identity.example.test', 'client_id' => 'approved-client'];
        config(['services.sso.privileged_providers' => [$trusted]]);
        foreach (['tenant_id' => 999999, 'provider_key' => 'attacker',
            'issuer_url' => 'https://attacker.example.test', 'client_id' => 'attacker-client'] as $field => $value) {
            try {
                $method->invoke($service, $admin->id, $admin->tenant_id, time(), null, true, time(), array_replace($trusted, [$field => $value]));
                $this->fail('An unapproved privileged SSO binding issued credentials.');
            } catch (\RuntimeException $exception) {
                $this->assertSame(__('api.sso_login_failed'), $exception->getMessage());
            }
        }
        $issued = $method->invoke($service, $admin->id, $admin->tenant_id, time(), null, true, time(), $trusted);
        $this->assertSame('credentials_issued', $issued['status']);
    }

    public function test_bearer_enrollment_rechecks_revocation_at_the_user_lock(): void
    {
        $user = $this->member(['role' => 'admin', 'totp_enabled' => false]);
        $tokens = app(TokenService::class);
        $access = $tokens->generateToken($user->id, $user->tenant_id, \App\Services\TwoFactorPolicy::claims('totp'));
        $armed = true;
        DB::listen(function ($query) use (&$armed, $tokens, $user): void {
            if ($armed && str_contains(strtolower($query->sql), 'for update')
                && str_contains($query->sql, '`users`') && in_array($user->id, $query->bindings)) {
                $armed = false;
                $tokens->revokeAllTokensForUser($user->id);
            }
        });
        $this->apiPost('/v2/auth/2fa/setup', [], ['Authorization' => 'Bearer ' . $access])->assertStatus(401);
        $this->assertFalse($armed, 'The test must reach the enrollment user lock.');
        $this->assertDatabaseMissing('user_totp_settings', ['user_id' => $user->id]);
    }

    public function test_admin_reset_rechecks_actor_revocation_at_the_user_lock(): void
    {
        $admin = $this->member(['role' => 'admin']);
        $target = $this->member(['totp_enabled' => true]);
        $tokens = app(TokenService::class);
        $access = $tokens->generateToken($admin->id, $admin->tenant_id, \App\Services\TwoFactorPolicy::claims('totp'));
        $armed = true;
        DB::listen(function ($query) use (&$armed, $tokens, $admin): void {
            if ($armed && str_contains(strtolower($query->sql), 'for update')
                && str_contains($query->sql, '`users`') && in_array($admin->id, $query->bindings)) {
                $armed = false;
                $tokens->revokeAllTokensForUser($admin->id);
            }
        });
        $this->apiPost('/v2/admin/users/' . $target->id . '/reset-2fa', ['reason' => 'Verified recovery incident'],
            ['Authorization' => 'Bearer ' . $access])->assertStatus(403);
        $this->assertFalse($armed, 'The test must reach the administrator user lock.');
        $this->assertDatabaseHas('users', ['id' => $target->id, 'totp_enabled' => true]);
        $this->assertDatabaseMissing('totp_admin_overrides', ['user_id' => $target->id]);
    }

    public function test_setup_retry_preserves_the_secret_already_scanned(): void
    {
        $user = $this->member();
        $first = TotpService::initializeSetup($user->id);
        $this->assertFalse(TotpService::completeSetup($user->id, 'not-a-code')['success']);
        $retry = TotpService::initializeSetup($user->id);
        $this->assertSame($first['secret'], $retry['secret']);
        $result = TotpService::completeSetup($user->id, TOTP::createFromSecret($first['secret'])->now());
        $this->assertTrue($result['success']);
        $this->assertCount(10, $result['backup_codes']);
        $this->assertTrue(TotpService::verifyBackupCode($user->id, $result['backup_codes'][0])['success']);
        $this->assertFalse(TotpService::verifyBackupCode($user->id, $result['backup_codes'][0])['success']);
    }

    public function test_setup_limits_are_per_validated_account_not_shared_accessible_server_ip(): void
    {
        $manager = app(TwoFactorChallengeManager::class);
        $lastChallenge = null;
        for ($i = 0; $i < 6; $i++) {
            $user = $this->member(['role' => 'admin']);
            $lastChallenge = $manager->create($user->id, ['totp_setup']);
            $this->apiPost('/v2/auth/2fa/setup', ['two_factor_token' => $lastChallenge])->assertOk();
        }
        for ($i = 0; $i < 4; $i++) {
            $this->apiPost('/v2/auth/2fa/setup', ['two_factor_token' => $lastChallenge])->assertOk();
        }
        $this->apiPost('/v2/auth/2fa/setup', ['two_factor_token' => $lastChallenge])->assertStatus(429);
    }

    public function test_sso_challenges_recheck_privileged_provider_trust_after_promotion(): void
    {
        config(['services.sso.privileged_providers' => []]);
        $user = $this->member();
        $manager = app(TwoFactorChallengeManager::class);
        $context = ['tenant_id' => $user->tenant_id, 'provider_key' => 'tenant-idp',
            'issuer_url' => 'https://idp.example.test', 'client_id' => 'client'];
        $setup = $manager->create($user->id, ['totp_setup'], $user->tenant_id, time(), null, $context);
        $verify = $manager->create($user->id, ['totp'], $user->tenant_id, time(), null, $context);
        DB::table('users')->where('id', $user->id)->update(['role' => 'admin']);
        $this->apiPost('/v2/auth/2fa/setup', ['two_factor_token' => $setup])->assertStatus(401);
        $this->apiPost('/totp/verify', ['two_factor_token' => $verify, 'code' => '123456'])->assertStatus(401);
        $this->assertDatabaseMissing('user_totp_settings', ['user_id' => $user->id]);
        $this->assertDatabaseMissing('refresh_token_sessions', ['user_id' => $user->id]);
    }

    public function test_used_authenticator_code_cannot_complete_another_login_challenge(): void
    {
        $user = $this->member();
        $secret = TotpService::generateSecret();
        DB::table('user_totp_settings')->insert([
            'user_id' => $user->id, 'tenant_id' => $this->testTenantId,
            'totp_secret_encrypted' => TotpEncryption::encrypt($secret),
            'is_enabled' => 1, 'is_pending_setup' => 0,
        ]);
        $manager = app(TwoFactorChallengeManager::class);
        $first = $manager->create($user->id);
        $second = $manager->create($user->id);
        $code = TOTP::createFromSecret($secret)->now();
        $this->apiPost('/totp/verify', ['two_factor_token' => $first, 'code' => $code])->assertOk();
        $this->apiPost('/totp/verify', ['two_factor_token' => $second, 'code' => $code])
            ->assertStatus(401)->assertJsonPath('errors.0.code', 'AUTH_2FA_INVALID');
    }

    public function test_admin_reset_revokes_access_refresh_and_pending_authentication(): void
    {
        $admin = $this->member(['role' => 'admin']);
        $user = $this->member(['totp_enabled' => 1, 'totp_setup_required' => 0]);
        $tokens = app(TokenService::class);
        $access = $tokens->generateToken($user->id, $this->testTenantId);
        $refresh = $tokens->generateRefreshToken($user->id, $this->testTenantId);
        $started = time();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
            $admin->id, $this->testTenantId, \App\Services\TwoFactorPolicy::claims('totp')
        )]);
        $this->apiPost('/v2/admin/users/' . $user->id . '/reset-2fa', ['reason' => 'Lost authenticator'])
            ->assertOk();
        $this->assertNull($tokens->validateToken($access));
        $this->assertNull($tokens->inspectRefreshTokenForRotation($refresh));
        $this->assertFalse($tokens->isAuthenticationStartValid($user->id, $started));
        $this->assertDatabaseHas('users', ['id' => $user->id, 'totp_setup_required' => 1]);
    }

    public function test_admin_reset_rolls_back_if_session_revocation_fails(): void
    {
        $admin = $this->member(['role' => 'admin']);
        $user = $this->member(['totp_enabled' => 1]);
        DB::table('user_totp_settings')->insert([
            'user_id' => $user->id, 'tenant_id' => $this->testTenantId,
            'totp_secret_encrypted' => 'preserve-on-failure', 'is_enabled' => 1,
        ]);
        $tokens = Mockery::mock(TokenService::class)->makePartial();
        $tokens->shouldReceive('revokeAllTokensForUser')->once()->andReturn(0);
        $this->app->instance(TokenService::class, $tokens);
        $this->withHeaders(['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
            $admin->id, $this->testTenantId, \App\Services\TwoFactorPolicy::claims('totp')
        )]);
        $this->apiPost('/v2/admin/users/' . $user->id . '/reset-2fa', ['reason' => 'Lost authenticator'])
            ->assertStatus(500);
        $this->assertDatabaseHas('user_totp_settings', ['user_id' => $user->id, 'is_enabled' => 1]);
        $this->assertDatabaseHas('users', ['id' => $user->id, 'totp_enabled' => 1]);
    }

    public function test_revoked_setup_challenge_cannot_mutate_enrollment(): void
    {
        $transport = $this->member();
        $target = $this->member(['role' => 'admin']);
        Sanctum::actingAs($transport);
        $challenge = app(TwoFactorChallengeManager::class)->create($target->id, ['totp_setup']);
        app(TokenService::class)->revokeAllTokensForUser($target->id, 'password_changed');
        $this->apiPost('/v2/auth/2fa/setup', ['two_factor_token' => $challenge])->assertStatus(401);
        $this->assertDatabaseMissing('user_totp_settings', ['user_id' => $target->id]);
    }

    public function test_recovery_invalidates_pending_secret_and_new_setup_rotates_it(): void
    {
        $user = $this->member();
        $first = TotpService::initializeSetup($user->id);
        app(TokenService::class)->revokeAllTokensForUser($user->id, 'password_changed');
        $this->assertFalse(TotpService::completeSetup($user->id, TOTP::createFromSecret($first['secret'])->now())['success']);
        $next = TotpService::initializeSetup($user->id);
        $this->assertNotSame($first['secret'], $next['secret']);
        $this->assertSame($next['secret'], TotpService::initializeSetup($user->id)['secret']);
        $this->assertTrue(TotpService::completeSetup($user->id, TOTP::createFromSecret($next['secret'])->now())['success']);
    }

    public function test_setup_completion_fails_closed_when_challenge_consumption_fails(): void
    {
        $transport = $this->member();
        $target = $this->member(['role' => 'admin']);
        Sanctum::actingAs($transport);
        $manager = app(TwoFactorChallengeManager::class);
        $challenge = $manager->create($target->id, ['totp_setup']);
        $setup = TotpService::initializeSetup($target->id);
        $blockedManager = Mockery::mock(TwoFactorChallengeManager::class)->makePartial();
        $blockedManager->shouldReceive('consume')->once()->with($challenge)->andReturn(false);
        $this->app->instance(TwoFactorChallengeManager::class, $blockedManager);
        $this->apiPost('/v2/auth/2fa/verify', [
            'two_factor_token' => $challenge, 'code' => TOTP::createFromSecret($setup['secret'])->now(),
        ])->assertStatus(401);
        $this->assertDatabaseHas('user_totp_settings', ['user_id' => $target->id, 'is_pending_setup' => 1, 'is_enabled' => 0]);
        $this->assertDatabaseMissing('user_backup_codes', ['user_id' => $target->id]);
        $this->assertDatabaseMissing('refresh_token_sessions', ['user_id' => $target->id]);
    }

    public function test_totp_accepts_one_period_clock_drift_but_not_two(): void
    {
        $this->travelTo(now()->startOfMinute()->addSeconds(15));
        $secret = TotpService::generateSecret();
        $totp = TOTP::createFromSecret($secret);
        $timestamp = now()->getTimestamp();
        $this->assertTrue(TotpService::verifyCode($secret, $totp->at($timestamp - 30)));
        $this->assertTrue(TotpService::verifyCode($secret, $totp->at($timestamp + 30)));
        $this->assertFalse(TotpService::verifyCode($secret, $totp->at($timestamp - 60)));
        $this->assertFalse(TotpService::verifyCode($secret, '12 3456'));
        $this->travelBack();
    }
}
