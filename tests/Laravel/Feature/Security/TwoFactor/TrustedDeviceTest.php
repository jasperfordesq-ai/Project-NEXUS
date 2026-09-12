<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\TwoFactor;

use App\Services\AuthenticationConfigurationService as Settings;
use Illuminate\Support\Facades\DB;

/** P5 — a remembered device is a convenience for optional MFA only, and it is revocable everywhere. */
class TrustedDeviceTest extends TwoFactorAuditTestCase
{
    private const NATIVE = ['X-Nexus-Mobile' => '1'];

    protected function setUp(): void
    {
        parent::setUp();
        Settings::set(Settings::CONFIG_TWO_FACTOR_REQUIRE_MEMBERS, false, $this->testTenantId);
        Settings::set(Settings::CONFIG_TWO_FACTOR_ALLOW_TRUSTED_DEVICES, true, $this->testTenantId);
    }

    /** @return array{0: \App\Models\User, 1: string, 2: string} member, secret, native device token */
    private function memberWithTrustedNativeDevice(): array
    {
        $member = $this->member();
        $secret = $this->enrol($member);
        $native = $this->apiPost('/totp/verify', [
            'two_factor_token' => $this->challenge($member, self::NATIVE),
            'code' => $this->code($secret),
            'trust_device' => true,
        ], self::NATIVE)->assertOk();
        $device = $native->json('trusted_device_token');
        $this->assertIsString($device);

        return [$member, $secret, $device];
    }

    public function test_browser_receives_only_an_httponly_cookie_and_native_receives_only_the_body_token(): void
    {
        $member = $this->member();
        $secret = $this->enrol($member);

        $browser = $this->apiPost('/totp/verify', [
            'two_factor_token' => $this->challenge($member), 'code' => $this->code($secret), 'trust_device' => true,
        ])->assertOk();
        $browser->assertJsonMissingPath('trusted_device_token');
        $cookie = collect($browser->headers->getCookies())->first(fn ($c) => $c->getName() === 'nexus_trusted_device');
        $this->assertNotNull($cookie, 'browser clients must get the remembered-device cookie');
        $this->assertTrue($cookie->isHttpOnly());
        $this->assertTrue($cookie->isSecure() || strtolower((string) $cookie->getSameSite()) !== 'none', 'SameSite=None requires Secure');
        $this->assertSame(64, strlen($cookie->getValue()), '32 random bytes, hex');

        $native = $this->apiPost('/totp/verify', [
            'two_factor_token' => $this->challenge($member, self::NATIVE), 'code' => $this->code($secret, +1), 'trust_device' => true,
        ], self::NATIVE)->assertOk();
        $this->assertSame(64, strlen((string) $native->json('trusted_device_token')));
        $this->assertEmpty(array_filter($native->headers->getCookies(), fn ($c) => $c->getName() === 'nexus_trusted_device'));

        // Stored hashed, never plain.
        $plain = [$cookie->getValue(), $native->json('trusted_device_token')];
        foreach (DB::table('user_trusted_devices')->where('user_id', $member->id)->pluck('device_token_hash') as $hash) {
            $this->assertNotContains($hash, $plain);
            $this->assertSame(64, strlen($hash));
        }
    }

    public function test_trusted_device_skips_the_challenge_only_for_optional_mfa(): void
    {
        [$member, , $device] = $this->memberWithTrustedNativeDevice();
        $headers = self::NATIVE + ['X-Trusted-Device' => $device];

        $this->apiPost('/auth/login', ['email' => $member->email, 'password' => 'test-password'], $headers)
            ->assertOk()->assertJsonPath('success', true)->assertJsonMissingPath('requires_2fa');

        Settings::set(Settings::CONFIG_TWO_FACTOR_REQUIRE_MEMBERS, true, $this->testTenantId);
        $this->apiPost('/auth/login', ['email' => $member->email, 'password' => 'test-password'], $headers)
            ->assertOk()->assertJsonPath('requires_2fa', true)->assertJsonPath('allow_trusted_device', false)->assertJsonMissingPath('access_token');
    }

    public function test_trusted_device_token_is_bound_to_its_owner(): void
    {
        [, , $device] = $this->memberWithTrustedNativeDevice();
        $other = $this->member();
        $this->enrol($other);

        $this->apiPost('/auth/login', ['email' => $other->email, 'password' => 'test-password'], self::NATIVE + ['X-Trusted-Device' => $device])
            ->assertOk()->assertJsonPath('requires_2fa', true);
    }

    public function test_member_revocation_and_tenant_switch_off_both_kill_existing_devices(): void
    {
        [$member, , $device] = $this->memberWithTrustedNativeDevice();
        $headers = self::NATIVE + ['X-Trusted-Device' => $device];

        $this->apiPost('/v2/auth/2fa/trusted-devices/revoke', [], $this->bearer($member, true))->assertOk()->assertJsonPath('data.revoked_count', 1);
        $this->apiPost('/auth/login', ['email' => $member->email, 'password' => 'test-password'], $headers)->assertJsonPath('requires_2fa', true);

        [$second, , $device2] = $this->memberWithTrustedNativeDevice();
        $superAdmin = $this->member(['role' => 'admin', 'is_tenant_super_admin' => true]);
        $this->apiPut('/v2/admin/config/authentication/bulk', ['settings' => [Settings::CONFIG_TWO_FACTOR_ALLOW_TRUSTED_DEVICES => false]], $this->bearer($superAdmin, true))->assertOk();
        $this->assertSame(0, DB::table('user_trusted_devices')->where('user_id', $second->id)->where('is_revoked', 0)->count());
        $this->apiPost('/auth/login', ['email' => $second->email, 'password' => 'test-password'], self::NATIVE + ['X-Trusted-Device' => $device2])->assertJsonPath('requires_2fa', true);
    }

    public function test_disabling_the_factor_revokes_remembered_devices(): void
    {
        [$member, $secret, $device] = $this->memberWithTrustedNativeDevice();
        // The device was trusted with this step's code; the next step is a fresh proof.
        $this->apiPost('/v2/auth/2fa/disable', ['password' => 'test-password', 'code' => $this->code($secret, 1)], $this->bearer($member, true))->assertOk();
        $this->assertSame(0, DB::table('user_trusted_devices')->where('user_id', $member->id)->where('is_revoked', 0)->count());
        $this->assertNotSame('', $device);
    }
}
