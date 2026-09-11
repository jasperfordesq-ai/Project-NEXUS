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
use App\Services\TwoFactorPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use OTPHP\TOTP;
use Tests\Laravel\TestCase;

class TwoFactorRecoveryTest extends TestCase
{
    use DatabaseTransactions;

    private function fixture(): array
    {
        Cache::flush();
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'admin', 'status' => 'active', 'is_approved' => true,
            'email_verified_at' => now(), 'totp_enabled' => true,
        ]);
        $secret = TotpService::generateSecret();
        DB::table('user_totp_settings')->insert([
            'user_id' => $user->id, 'tenant_id' => $user->tenant_id,
            'totp_secret_encrypted' => TotpEncryption::encrypt($secret), 'is_enabled' => 1, 'is_pending_setup' => 0,
        ]);
        $headers = ['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
            $user->id, $user->tenant_id, TwoFactorPolicy::claims('totp')
        )];
        return [$user, $secret, $headers];
    }

    public function test_fresh_code_replaces_lost_codes_and_rejects_replay(): void
    {
        [$user, $secret, $headers] = $this->fixture();
        $old = TotpService::generateBackupCodes($user->id);
        $code = TOTP::createFromSecret($secret)->now();
        $response = $this->apiPost('/v2/auth/2fa/recovery-codes', ['code' => $code], $headers)->assertOk();
        $new = $response->json('data.backup_codes');
        $this->assertCount(10, $new);
        $this->assertStringContainsString('no-store', $response->headers->get('Cache-Control'));
        $this->assertFalse(TotpService::verifyBackupCode($user->id, $old[0])['success']);
        $this->apiPost('/v2/auth/2fa/recovery-codes', ['code' => $code], $headers)->assertStatus(422);
        $this->assertTrue(TotpService::verifyBackupCode($user->id, $new[0])['success']);
    }

    public function test_bad_code_cannot_replace_existing_codes(): void
    {
        [$user, , $headers] = $this->fixture();
        $old = TotpService::generateBackupCodes($user->id);
        $this->apiPost('/v2/auth/2fa/recovery-codes', ['code' => ['invalid']], $headers)->assertStatus(422);
        $this->assertTrue(TotpService::verifyBackupCode($user->id, $old[0])['success']);
    }

    public function test_lost_enrollment_response_can_be_recovered_by_signing_in_and_replacing_codes(): void
    {
        [$user] = $this->fixture();
        DB::table('user_totp_settings')->where('user_id', $user->id)->where('tenant_id', $user->tenant_id)->delete();
        DB::table('users')->where('id', $user->id)->where('tenant_id', $user->tenant_id)->update([
            'totp_enabled' => 0, 'password_hash' => \Illuminate\Support\Facades\Hash::make('audit-password'),
        ]);
        $credentials = ['email' => $user->email, 'password' => 'audit-password'];
        $challenge = $this->apiPost('/auth/login', $credentials)->assertOk()->json('two_factor_token');
        $setup = $this->apiPost('/v2/auth/2fa/setup', ['two_factor_token' => $challenge])->assertOk();
        $totp = TOTP::createFromSecret($setup->json('data.secret'));
        // Adjacent periods model enrollment followed by two fresh ceremonies
        // without sleeping or weakening the replay state in the fixture.
        $enrolled = $this->apiPost('/v2/auth/2fa/verify', ['two_factor_token' => $challenge, 'code' => $totp->at(time() - 30)])->assertOk();
        $lostCodes = $enrolled->json('data.backup_codes');
        $login = $this->apiPost('/auth/login', $credentials)->assertOk()->assertJsonPath('requires_2fa', true);
        $verified = $this->apiPost('/totp/verify', ['two_factor_token' => $login->json('two_factor_token'), 'code' => $totp->now()])->assertOk();
        $replacement = $this->apiPost('/v2/auth/2fa/recovery-codes', ['code' => $totp->at(time() + 30)], [
            'Authorization' => 'Bearer ' . $verified->json('access_token'),
        ])->assertOk();
        $this->assertCount(10, $replacement->json('data.backup_codes'));
        $this->assertFalse(TotpService::verifyBackupCode($user->id, $lostCodes[0])['success']);
        $this->assertTrue(TotpService::verifyBackupCode($user->id, $replacement->json('data.backup_codes.0'))['success']);
    }

    public function test_forgetting_devices_is_scoped_to_the_current_identity(): void
    {
        [$user, , $headers] = $this->fixture();
        TotpService::trustDevice($user->id, str_repeat('a', 64), $user->tenant_id);
        $other = User::factory()->forTenant($this->testTenantId)->create();
        TotpService::trustDevice($other->id, str_repeat('b', 64), $other->tenant_id);
        $this->apiPost('/v2/auth/2fa/trusted-devices/revoke', [], $headers)->assertOk()->assertJsonPath('data.revoked_count', 1);
        $this->assertSame(0, TotpService::getTrustedDeviceCount($user->id));
        $this->assertSame(1, TotpService::getTrustedDeviceCount($other->id));
    }

    public function test_host_recovery_requires_explicit_execution_and_audits_revocation(): void
    {
        [$user, , $headers] = $this->fixture();
        DB::table('users')->where('id', $user->id)->where('tenant_id', $user->tenant_id)->update(['is_god' => 1]);
        $args = ['tenant' => $user->tenant_id, 'user' => $user->id];
        $this->artisan('security:recover-admin-mfa', $args)->assertSuccessful();
        $this->assertTrue(TotpService::isEnabled($user->id));
        $this->artisan('security:recover-admin-mfa', $args + ['--execute' => true])->assertFailed();
        $this->assertTrue(TotpService::isEnabled($user->id));
        $this->artisan('security:recover-admin-mfa', $args + [
            '--execute' => true, '--confirm-user' => (string) $user->id, '--operator' => 'test-operator',
            '--reason' => 'INC-123 identity checked using the approved offline procedure',
        ])->assertSuccessful();
        $this->assertFalse(TotpService::isEnabled($user->id));
        $this->assertTrue(app(TwoFactorPolicy::class)->required($user->fresh()));
        $this->apiGet('/v2/users/me', $headers)->assertStatus(401);
        $this->assertDatabaseHas('totp_admin_overrides', ['user_id' => $user->id, 'tenant_id' => $user->tenant_id, 'action_type' => 'reset']);
    }

    public function test_oauth_browser_exchange_continues_into_real_local_totp(): void
    {
        [$user, $secret] = $this->fixture();
        $verifier = str_repeat('a', 43);
        $binding = rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
        $issued = app(\App\Services\Auth\SocialAuthService::class)->issueLoginCallbackCode(
            $user->id, $user->tenant_id, 'google', false, time(), $binding
        );
        $this->assertSame('issued', $issued['status']);
        $this->apiPost('/v2/auth/oauth/exchange', ['code' => $issued['callback_code'], 'browser_verifier' => str_repeat('b', 43)])->assertStatus(400);
        $exchange = $this->apiPost('/v2/auth/oauth/exchange', ['code' => $issued['callback_code'], 'browser_verifier' => $verifier])
            ->assertOk()->assertJsonPath('requires_2fa', true);
        $this->assertNull($exchange->json('access_token'));
        $this->apiPost('/v2/auth/oauth/exchange', ['code' => $issued['callback_code'], 'browser_verifier' => $verifier])->assertStatus(400);
        $login = $this->apiPost('/totp/verify', ['two_factor_token' => $exchange->json('two_factor_token'), 'code' => TOTP::createFromSecret($secret)->now()])->assertOk();
        $this->apiGet('/v2/users/me', ['Authorization' => 'Bearer ' . $login->json('access_token')])->assertOk();
    }

    public function test_readiness_inventory_detects_broken_encryption_without_printing_secrets_or_identities(): void
    {
        [$user, $secret] = $this->fixture();
        DB::table('user_totp_settings')->where('user_id', $user->id)->where('tenant_id', $user->tenant_id)->update(['totp_secret_encrypted' => 'invalid-ciphertext']);
        $exit = \Illuminate\Support\Facades\Artisan::call('security:mfa-readiness', ['--tenant' => (string) $user->tenant_id]);
        $output = \Illuminate\Support\Facades\Artisan::output();
        $report = json_decode($output, true, 512, JSON_THROW_ON_ERROR);
        $this->assertSame(1, $exit);
        $this->assertGreaterThanOrEqual(1, $report['totp_decryption_failures']);
        $this->assertTrue($report['live_authenticator_and_idp_checks_required']);
        $this->assertStringNotContainsString($secret, $output);
        $this->assertStringNotContainsString($user->email, $output);
        $this->assertDatabaseHas('user_totp_settings', ['user_id' => $user->id, 'totp_secret_encrypted' => 'invalid-ciphertext']);
    }

    public function test_impersonation_of_required_accounts_is_read_only_and_follows_actor_revocation(): void
    {
        [$admin, , $headers] = $this->fixture();
        $target = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        \App\Services\AuthenticationConfigurationService::set('two_factor.require_members', true, $this->testTenantId);
        $tokens = app(TokenService::class);
        $actorClaims = $tokens->validateToken(substr($headers['Authorization'], 7));
        $proof = $tokens->generateImpersonationToken($target->id, $target->tenant_id, $admin->id, $actorClaims);
        $exchange = $this->apiPost('/v2/auth/impersonate/exchange', ['token' => $proof])->assertOk();
        $delegated = ['Authorization' => 'Bearer ' . $exchange->json('access_token')];
        $this->apiGet('/v2/users/me', $delegated)->assertOk();
        $messageId = DB::table('messages')->insertGetId([
            'tenant_id' => $this->testTenantId, 'sender_id' => $admin->id, 'receiver_id' => $target->id,
            'body' => 'Unread support test', 'is_read' => 0, 'is_federated' => 0, 'created_at' => now(),
        ]);
        $this->apiGet('/v2/messages/' . $admin->id, $delegated)->assertOk();
        $this->assertDatabaseHas('messages', ['id' => $messageId, 'is_read' => 0]);
        $this->apiGet('/v2/me/data-export', $delegated)->assertStatus(403);
        $this->apiPost('/v2/auth/2fa/recovery-codes', ['code' => '123456'], $delegated)->assertStatus(403);
        $tokens->revokeAllTokensForUser($admin->id, 'audit_test');
        $this->apiGet('/v2/users/me', $delegated)->assertStatus(401);
    }
}
