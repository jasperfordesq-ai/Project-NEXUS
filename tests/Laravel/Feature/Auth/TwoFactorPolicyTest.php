<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Auth;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\AuthenticationConfigurationService as Settings;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use OTPHP\TOTP;
use Tests\Laravel\TestCase;

class TwoFactorPolicyTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        Settings::set(Settings::CONFIG_TWO_FACTOR_REQUIRE_MEMBERS, false, $this->testTenantId);
    }

    private function member(array $attributes = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active', 'is_approved' => true, 'email_verified_at' => now(),
            'password_hash' => Hash::make('test-password'),
        ], $attributes));
    }

    private function bearer(User $user, bool $mfa = false): array
    {
        return ['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
            $user->id, $user->tenant_id, $mfa ? TwoFactorPolicy::claims('totp') : []
        )];
    }

    public function test_every_admin_representation_is_mandatory_without_a_tenant_opt_out(): void
    {
        $policy = app(TwoFactorPolicy::class);
        foreach (['admin', 'tenant_admin', 'super_admin', 'god', 'org_admin'] as $role) {
            $this->assertTrue($policy->required(['role' => $role, 'tenant_id' => $this->testTenantId]));
        }
        foreach (['is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god'] as $flag) {
            $this->assertTrue($policy->required(['role' => 'member', $flag => true, 'tenant_id' => $this->testTenantId]));
        }
        $this->assertFalse($policy->required(['role' => 'broker', 'is_admin' => true, 'tenant_id' => $this->testTenantId]));
    }

    public function test_operational_roles_with_platform_authority_cannot_use_password_only_sessions(): void
    {
        foreach (['broker', 'coordinator'] as $role) {
            foreach (['is_super_admin', 'is_god'] as $flag) {
                $user = $this->member(['role' => $role, $flag => true]);
                $this->assertTrue(app(TwoFactorPolicy::class)->required($user));
                $this->apiGet('/v2/users/me', $this->bearer($user))
                    ->assertStatus(401)->assertJsonPath('code', 'AUTH_MFA_REQUIRED');
                $this->apiGet('/v2/users/me', $this->bearer($user, true))->assertOk();
            }
        }
    }

    public function test_member_policy_is_tenant_scoped_and_does_not_remove_enrollment(): void
    {
        $member = $this->member(['totp_enabled' => true]);
        $policy = app(TwoFactorPolicy::class);
        $this->assertFalse($policy->required($member));
        Settings::set(Settings::CONFIG_TWO_FACTOR_REQUIRE_MEMBERS, true, $this->testTenantId);
        $this->assertTrue($policy->required($member));
        $this->assertFalse($policy->required(['role' => 'member', 'tenant_id' => 999999]));
        Settings::set(Settings::CONFIG_TWO_FACTOR_REQUIRE_MEMBERS, false, $this->testTenantId);
        $this->assertFalse($policy->required($member));
        $this->assertTrue((bool) $member->fresh()->totp_enabled);
    }

    public function test_existing_sessions_and_promotion_are_checked_against_current_policy(): void
    {
        $user = $this->member();
        $headers = $this->bearer($user);
        $this->apiGet('/v2/users/me', $headers)->assertOk();
        Settings::set(Settings::CONFIG_TWO_FACTOR_REQUIRE_MEMBERS, true, $this->testTenantId);
        $this->apiGet('/v2/users/me', $headers)->assertStatus(401)->assertJsonPath('code', 'AUTH_MFA_REQUIRED');
        Settings::set(Settings::CONFIG_TWO_FACTOR_REQUIRE_MEMBERS, false, $this->testTenantId);
        DB::table('users')->where('id', $user->id)->where('tenant_id', $user->tenant_id)->update(['role' => 'admin']);
        $user->refresh();
        $this->apiGet('/v2/users/me', $headers)->assertStatus(401);
        $this->apiGet('/v2/users/me', $this->bearer($user, true))->assertOk();
    }

    public function test_stateful_admin_without_verified_assurance_is_refused(): void
    {
        // The shared test base upgrades stateful administrators to a verified
        // bearer (they cannot exist in production otherwise); this test is the
        // one place that asserts the raw stateful refusal, so opt out here.
        \Tests\Laravel\Support\ActingAsVerifiedAdministrator::$disabled = true;
        try {
            Sanctum::actingAs($this->member(['role' => 'admin']));
            $this->apiGet('/v2/admin/config/authentication')->assertStatus(401);
        } finally {
            \Tests\Laravel\Support\ActingAsVerifiedAdministrator::$disabled = false;
        }
    }

    public function test_tenant_admin_can_change_member_enforcement_but_cannot_disable_admin_enforcement(): void
    {
        $admin = $this->member(['role' => 'admin']);
        $headers = $this->bearer($admin, true);
        $this->apiGet('/v2/admin/config/authentication', $headers)
            ->assertOk()->assertJsonPath('data.policy.administrators_required', true);
        $this->apiPut('/v2/admin/config/authentication/bulk', ['settings' => [Settings::CONFIG_TWO_FACTOR_REQUIRE_MEMBERS => true]], $headers)->assertOk();
        $this->assertTrue(app(TwoFactorPolicy::class)->required($this->member()));
        $this->apiPut('/v2/admin/config/authentication/bulk', ['settings' => ['two_factor.require_admins' => false]], $headers)->assertStatus(422);
        $this->apiPut('/v2/admin/config/authentication/bulk', ['settings' => [Settings::CONFIG_TWO_FACTOR_REQUIRE_MEMBERS => 'false']], $headers)->assertStatus(422);
        $this->apiPut('/v2/admin/config/authentication/bulk', ['settings' => [Settings::CONFIG_TWO_FACTOR_REQUIRE_MEMBERS => false]], $headers)->assertOk();
        $this->assertFalse(app(TwoFactorPolicy::class)->required($this->member()));
    }

    public function test_regular_member_cannot_change_policy(): void
    {
        $this->apiPut('/v2/admin/config/authentication/bulk', ['settings' => [Settings::CONFIG_TWO_FACTOR_REQUIRE_MEMBERS => true]], $this->bearer($this->member()))->assertStatus(403);
    }

    public static function enrollmentRoles(): array
    {
        return [['admin'], ['member']];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('enrollmentRoles')]
    public function test_enrollment_challenge_completes_without_a_bearer_even_when_optional_feature_is_off(string $role): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode(['two_factor_authentication' => false])]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
        $admin = $this->member(['role' => $role]);
        if ($role === 'member') Settings::set(Settings::CONFIG_TWO_FACTOR_REQUIRE_MEMBERS, true, $this->testTenantId);
        $login = $this->apiPost('/auth/login', ['email' => $admin->email, 'password' => 'test-password']);
        $login->assertOk()->assertJsonPath('requires_2fa_setup', true);
        $challenge = $login->json('two_factor_token');
        $this->apiGet('/v2/users/me', ['Authorization' => 'Bearer ' . $challenge])->assertStatus(401);
        $setup = $this->apiPost('/v2/auth/2fa/setup', ['two_factor_token' => $challenge])->assertOk();
        $this->apiPost('/v2/auth/2fa/verify', ['two_factor_token' => $challenge, 'code' => 'wrong'])->assertStatus(400);
        $retry = $this->apiPost('/v2/auth/2fa/setup', ['two_factor_token' => $challenge])->assertOk();
        $this->assertSame($setup->json('data.secret'), $retry->json('data.secret'));
        $verified = $this->apiPost('/v2/auth/2fa/verify', [
            'two_factor_token' => $challenge, 'code' => TOTP::createFromSecret($setup->json('data.secret'))->now(),
        ])->assertOk()->assertJsonPath('data.login_complete', true);
        $this->assertNotEmpty($verified->json('data.backup_codes'));
        $headers = ['Authorization' => 'Bearer ' . $verified->json('data.access_token')];
        $this->apiGet('/v2/users/me', $headers)->assertOk();
        $this->apiPost('/v2/auth/2fa/disable', ['password' => 'test-password'], $headers)->assertStatus(403);
        $refresh = $this->apiPost('/auth/refresh-token', ['refresh_token' => $verified->json('data.refresh_token')])->assertOk();
        $this->apiGet('/v2/users/me', ['Authorization' => 'Bearer ' . $refresh->json('access_token')])->assertOk();
    }

    public function test_refresh_cannot_upgrade_a_password_only_session(): void
    {
        $user = $this->member();
        $tokens = app(TokenService::class);
        $passwordOnly = $tokens->generateRefreshToken($user->id, $user->tenant_id);
        $verified = $tokens->generateRefreshToken($user->id, $user->tenant_id, false, TwoFactorPolicy::claims('totp'));
        Settings::set(Settings::CONFIG_TWO_FACTOR_REQUIRE_MEMBERS, true, $this->testTenantId);
        $this->assertNull($tokens->rotateRefreshToken($passwordOnly));
        $rotation = $tokens->rotateRefreshToken($verified);
        $this->assertTrue(app(TwoFactorPolicy::class)->satisfied($tokens->validateRefreshToken($rotation['refresh_token'])));
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('enrollmentRoles')]
    public function test_remembered_device_cannot_bypass_required_mfa(string $role): void
    {
        $user = $this->member(['role' => $role]);
        if ($role === 'member') Settings::set(Settings::CONFIG_TWO_FACTOR_REQUIRE_MEMBERS, true, $this->testTenantId);
        $setup = \App\Services\TotpService::initializeSetup($user->id);
        $this->assertTrue(\App\Services\TotpService::completeSetup($user->id, TOTP::createFromSecret($setup['secret'])->now())['success']);
        $trusted = \App\Services\TotpService::trustDevice($user->id);
        $this->assertNotEmpty($trusted);
        $this->apiPost('/auth/login', ['email' => $user->email, 'password' => 'test-password'], [
            'X-Stateless-Auth' => '1', 'X-Trusted-Device' => $trusted,
        ])->assertOk()->assertJsonPath('requires_2fa', true)->assertJsonPath('allow_trusted_device', false);
    }
}
