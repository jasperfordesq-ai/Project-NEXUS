<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\TwoFactor;

use App\Services\TotpService;
use Illuminate\Support\Facades\DB;

/** P4 — recovery codes are hashed, single-use, and replaced only with a fresh authenticator code. */
class RecoveryCodeTest extends TwoFactorAuditTestCase
{
    public function test_recovery_codes_are_hashed_single_use_and_replaced_only_with_a_fresh_code(): void
    {
        $member = $this->member();
        $secret = $this->enrol($member);
        $codes = TotpService::generateBackupCodes($member->id, $member->tenant_id);
        $this->assertCount(10, $codes);

        $plain = array_map(static fn (string $c): string => str_replace('-', '', $c), $codes);
        foreach (DB::table('user_backup_codes')->where('user_id', $member->id)->pluck('code_hash') as $hash) {
            $this->assertStringStartsWith('$', $hash, 'recovery codes must be stored as password hashes');
            $this->assertNotContains($hash, $plain);
        }

        $first = $this->apiPost('/totp/verify', ['two_factor_token' => $this->challenge($member), 'code' => $codes[0], 'use_backup_code' => true]);
        $first->assertOk()->assertJsonPath('codes_remaining', 9);
        $this->apiPost('/totp/verify', ['two_factor_token' => $this->challenge($member), 'code' => $codes[0], 'use_backup_code' => true])->assertStatus(401);

        // Replacing the set needs a real authenticator code; a recovery code is not accepted as the proof.
        $headers = $this->bearer($member, true);
        $this->apiPost('/v2/auth/2fa/recovery-codes', ['code' => $plain[1]], $headers)->assertStatus(422);
        $fresh = $this->apiPost('/v2/auth/2fa/recovery-codes', ['code' => $this->code($secret)], $headers)->assertOk()->json('data.backup_codes');
        $this->assertCount(10, $fresh);
        $this->assertEmpty(array_intersect($fresh, $codes), 'a replacement set must not repeat old codes');

        // The old set is gone.
        $this->apiPost('/totp/verify', ['two_factor_token' => $this->challenge($member), 'code' => $codes[2], 'use_backup_code' => true])->assertStatus(401);
        // The new set works, once.
        $this->apiPost('/totp/verify', ['two_factor_token' => $this->challenge($member), 'code' => $fresh[0], 'use_backup_code' => true])->assertOk();
    }

    public function test_recovery_code_alphabet_and_length_give_roughly_forty_bits(): void
    {
        // 8 symbols from a 31-symbol alphabet ≈ 39.6 bits; guessing is further bounded by 5 tries per challenge and the 15-minute lockout.
        foreach (TotpService::generateBackupCodes($this->member()->id, $this->testTenantId) as $code) {
            $this->assertMatchesRegularExpression('/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/', $code);
        }
    }

    public function test_recovery_codes_are_scoped_to_their_owner(): void
    {
        $alice = $this->member();
        $bob = $this->member();
        $this->enrol($alice);
        $this->enrol($bob);
        $bobCodes = TotpService::generateBackupCodes($bob->id, $bob->tenant_id);

        $this->apiPost('/totp/verify', ['two_factor_token' => $this->challenge($alice), 'code' => $bobCodes[0], 'use_backup_code' => true])->assertStatus(401);
        $this->assertSame(0, DB::table('user_backup_codes')->where('user_id', $bob->id)->where('is_used', 1)->count(), "Alice's attempt must not burn Bob's code");
    }
}
