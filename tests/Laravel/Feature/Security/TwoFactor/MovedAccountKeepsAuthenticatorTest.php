<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\TwoFactor;

use App\Models\User;
use App\Services\TotpService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Moving an account to another community must not strand its authenticator.
 *
 * User::moveTenant() changed users.tenant_id (and kept users.totp_enabled = 1)
 * but left user_totp_settings, user_backup_codes and user_trusted_devices on the
 * OLD community. Every second-factor check is keyed (user_id, tenant_id), so
 * after a move the account's authenticator was invisible: the high-risk-action
 * prompt said "no authenticator app", and a staff account was sent to 2FA setup
 * that could never complete, because the setup upsert keeps the stale
 * tenant_id (user_totp_settings is unique on user_id alone).
 */
class MovedAccountKeepsAuthenticatorTest extends TwoFactorAuditTestCase
{
    private const DESTINATION = 996;

    protected function setUp(): void
    {
        parent::setUp();
        DB::table('tenants')->where('id', self::DESTINATION)->delete();
        DB::table('tenants')->insert([
            'id' => self::DESTINATION,
            'name' => 'Destination ' . self::DESTINATION,
            'slug' => 'mv-dest-' . Str::lower(Str::random(6)),
            'configuration' => json_encode([]),
            'path' => '/' . self::DESTINATION . '/',
            'depth' => 0,
            'allows_subtenants' => 1,
            'is_active' => 1,
        ]);
    }

    private function trustDevice(User $user): void
    {
        DB::table('user_trusted_devices')->insert([
            'user_id' => $user->id,
            'tenant_id' => $user->tenant_id,
            'device_token_hash' => hash('sha256', Str::random(40)),
            'device_name' => 'test',
            'ip_address' => '127.0.0.1',
            'expires_at' => now()->addDays(30),
            'trusted_at' => now(),
        ]);
    }

    public function test_the_authenticator_and_recovery_codes_move_with_the_account(): void
    {
        $user = $this->member();
        $secret = $this->enrol($user);
        TotpService::generateBackupCodes($user->id, $user->tenant_id);
        $this->trustDevice($user);

        $result = User::moveTenant($user->id, self::DESTINATION);
        $this->assertTrue($result['success'], json_encode($result));

        $this->assertTrue(TotpService::isEnabled($user->id, self::DESTINATION));
        $this->assertSame(
            0,
            DB::table('user_backup_codes')->where('user_id', $user->id)->where('tenant_id', '!=', self::DESTINATION)->count()
        );
        $this->assertGreaterThan(
            0,
            DB::table('user_backup_codes')->where('user_id', $user->id)->where('tenant_id', self::DESTINATION)->where('is_used', 0)->count()
        );
        $verified = TotpService::verifyLogin($user->id, $this->code($secret), self::DESTINATION);
        $this->assertTrue($verified['success'] ?? false, json_encode($verified));
    }

    public function test_remembered_devices_do_not_survive_the_move(): void
    {
        $user = $this->member();
        $this->enrol($user);
        $this->trustDevice($user);

        $this->assertTrue(User::moveTenant($user->id, self::DESTINATION)['success']);

        $this->assertSame(
            0,
            DB::table('user_trusted_devices')->where('user_id', $user->id)->where('is_revoked', 0)->count(),
            'A move is a security-boundary change: no remembered device may skip the code afterwards.'
        );
    }

    public function test_an_account_already_stranded_can_set_up_its_authenticator_again(): void
    {
        // The state a pre-fix move left behind: the factor row on the old community.
        $user = $this->member();
        $this->enrol($user);
        DB::table('user_totp_settings')->where('user_id', $user->id)->update(['tenant_id' => self::DESTINATION]);
        DB::table('users')->where('id', $user->id)->update(['totp_enabled' => 1]);

        $setup = TotpService::initializeSetup($user->id, $user->tenant_id);
        $done = TotpService::completeSetup($user->id, $this->code($setup['secret']), $user->tenant_id);

        $this->assertTrue($done['success'] ?? false, json_encode($done));
        $this->assertTrue(TotpService::isEnabled($user->id, $user->tenant_id));
    }
}
