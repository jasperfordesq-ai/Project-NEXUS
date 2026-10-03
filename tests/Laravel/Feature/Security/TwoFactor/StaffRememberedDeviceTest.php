<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\TwoFactor;

use App\Models\User;
use App\Services\AuthenticationConfigurationService as Settings;
use App\Services\TokenService;
use Illuminate\Support\Facades\DB;

/**
 * Security register E-085: staff may remember a device (own switch, at most
 * 30 days), the remembered sign-in still satisfies mandatory 2FA, and a device
 * remembered under one authority never carries into another.
 */
class StaffRememberedDeviceTest extends TwoFactorAuditTestCase
{
    private const NATIVE = ['X-Nexus-Mobile' => '1'];

    protected function setUp(): void
    {
        parent::setUp();
        Settings::set(Settings::CONFIG_TWO_FACTOR_ALLOW_TRUSTED_DEVICES, true, $this->testTenantId);
        Settings::set(Settings::CONFIG_TWO_FACTOR_ALLOW_STAFF_TRUSTED_DEVICES, true, $this->testTenantId);
        Settings::set(Settings::CONFIG_TWO_FACTOR_STAFF_TRUSTED_DEVICE_DAYS, 30, $this->testTenantId);
    }

    /** @return array{0: string, 1: string} secret, native device token */
    private function rememberNativeDevice(User $user): array
    {
        $secret = $this->enrol($user);
        $verify = $this->apiPost('/totp/verify', [
            'two_factor_token' => $this->challenge($user, self::NATIVE),
            'code' => $this->code($secret),
            'trust_device' => true,
        ], self::NATIVE)->assertOk();
        $device = $verify->json('trusted_device_token');
        $this->assertIsString($device, 'staff must be able to remember a device');

        return [$secret, $device];
    }

    private function login(User $user, string $device)
    {
        return $this->apiPost(
            '/auth/login',
            ['email' => $user->email, 'password' => 'test-password'],
            self::NATIVE + ['X-Trusted-Device' => $device]
        );
    }

    public function test_admin_challenge_offers_remembering_for_the_staff_days(): void
    {
        $admin = $this->member(['role' => 'admin']);
        $this->enrol($admin);
        Settings::set(Settings::CONFIG_TWO_FACTOR_STAFF_TRUSTED_DEVICE_DAYS, 14, $this->testTenantId);
        Settings::set(Settings::CONFIG_TWO_FACTOR_TRUSTED_DEVICE_DAYS, 90, $this->testTenantId);

        $this->apiPost('/auth/login', ['email' => $admin->email, 'password' => 'test-password'])
            ->assertOk()
            ->assertJsonPath('requires_2fa', true)
            ->assertJsonPath('allow_trusted_device', true)
            ->assertJsonPath('trusted_device_days', 14);
    }

    public function test_remembered_admin_signs_in_without_a_code_and_passes_mandatory_mfa(): void
    {
        $admin = $this->member(['role' => 'admin']);
        [, $device] = $this->rememberNativeDevice($admin);

        $login = $this->login($admin, $device)
            ->assertOk()->assertJsonPath('success', true)->assertJsonMissingPath('requires_2fa');
        $access = (string) $login->json('access_token');
        $claims = app(TokenService::class)->validateToken($access);
        $this->assertSame('trusted_device', $claims['mfa_method'] ?? null);
        $this->assertLessThanOrEqual(time(), $claims['mfa_verified_at']);

        // Mandatory 2FA is satisfied: an ordinary admin read is allowed.
        $this->apiGet('/v2/admin/users', ['Authorization' => 'Bearer ' . $access] + self::NATIVE)->assertOk();

        // The refresh token carries the same assurance, so the session survives
        // its first refresh instead of failing mandatory MFA.
        $refreshed = $this->apiPost('/auth/refresh-token', ['refresh_token' => $login->json('refresh_token')], self::NATIVE)->assertOk();
        $refreshedClaims = app(TokenService::class)->validateToken((string) $refreshed->json('access_token'));
        $this->assertSame('trusted_device', $refreshedClaims['mfa_method'] ?? null);
    }

    public function test_device_remembered_as_a_member_does_not_survive_promotion(): void
    {
        $user = $this->member();
        [, $device] = $this->rememberNativeDevice($user);
        $this->login($user, $device)->assertOk()->assertJsonMissingPath('requires_2fa');

        DB::table('users')->where('id', $user->id)->update(['role' => 'admin']);

        $this->login($user, $device)->assertOk()->assertJsonPath('requires_2fa', true);
        $this->assertSame(
            'role_changed',
            DB::table('user_trusted_devices')->where('user_id', $user->id)->value('revoked_reason')
        );
    }

    public function test_any_change_of_staff_authority_forgets_the_device(): void
    {
        $broker = $this->member(['role' => 'broker']);
        [, $device] = $this->rememberNativeDevice($broker);
        $this->login($broker, $device)->assertOk()->assertJsonMissingPath('requires_2fa');

        DB::table('users')->where('id', $broker->id)->update(['is_tenant_super_admin' => 1]);

        $this->login($broker, $device)->assertOk()->assertJsonPath('requires_2fa', true);
    }

    public function test_legacy_device_without_a_fingerprint_is_never_honoured_for_staff(): void
    {
        $admin = $this->member(['role' => 'admin']);
        [, $device] = $this->rememberNativeDevice($admin);
        DB::table('user_trusted_devices')->where('user_id', $admin->id)->update(['role_fingerprint' => null]);

        $this->login($admin, $device)->assertOk()->assertJsonPath('requires_2fa', true);
    }

    public function test_staff_switch_off_stops_offering_and_honouring(): void
    {
        $admin = $this->member(['role' => 'admin']);
        [, $device] = $this->rememberNativeDevice($admin);

        Settings::set(Settings::CONFIG_TWO_FACTOR_ALLOW_STAFF_TRUSTED_DEVICES, false, $this->testTenantId);

        $this->login($admin, $device)->assertOk()
            ->assertJsonPath('requires_2fa', true)
            ->assertJsonPath('allow_trusted_device', false);
    }

    public function test_shortening_the_staff_limit_applies_to_devices_already_remembered(): void
    {
        $admin = $this->member(['role' => 'admin']);
        [, $device] = $this->rememberNativeDevice($admin);
        DB::table('user_trusted_devices')->where('user_id', $admin->id)
            ->update(['trusted_at' => now()->subDays(10)]);
        $this->login($admin, $device)->assertOk()->assertJsonMissingPath('requires_2fa');

        Settings::set(Settings::CONFIG_TWO_FACTOR_STAFF_TRUSTED_DEVICE_DAYS, 7, $this->testTenantId);

        $this->login($admin, $device)->assertOk()->assertJsonPath('requires_2fa', true);
    }

    public function test_staff_limit_cannot_exceed_thirty_days(): void
    {
        $this->assertTrue(Settings::isValidValue(Settings::CONFIG_TWO_FACTOR_STAFF_TRUSTED_DEVICE_DAYS, 30));
        $this->assertFalse(Settings::isValidValue(Settings::CONFIG_TWO_FACTOR_STAFF_TRUSTED_DEVICE_DAYS, 31));
        $this->assertFalse(Settings::isValidValue(Settings::CONFIG_TWO_FACTOR_STAFF_TRUSTED_DEVICE_DAYS, 0));
    }

    public function test_members_under_a_community_mandate_still_cannot_remember(): void
    {
        Settings::set(Settings::CONFIG_TWO_FACTOR_REQUIRE_MEMBERS, true, $this->testTenantId);
        $member = $this->member();
        $secret = $this->enrol($member);

        $this->apiPost('/auth/login', ['email' => $member->email, 'password' => 'test-password'])
            ->assertOk()->assertJsonPath('allow_trusted_device', false);

        $verify = $this->apiPost('/totp/verify', [
            'two_factor_token' => $this->challenge($member, self::NATIVE),
            'code' => $this->code($secret),
            'trust_device' => true,
        ], self::NATIVE)->assertOk();
        $verify->assertJsonMissingPath('trusted_device_token');
    }
}
