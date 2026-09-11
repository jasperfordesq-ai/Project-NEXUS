<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\TwoFactor;

use App\Services\MemberDataExportService;
use App\Services\TotpService;
use Illuminate\Support\Facades\DB;

/** P10, P11 — limits are per account, and secrets stay where they belong. */
class LimitsAndLeakageTest extends TwoFactorAuditTestCase
{
    public function test_two_accounts_behind_one_ip_have_independent_code_limits(): void
    {
        $a = $this->member();
        $this->enrol($a);
        $b = $this->member();
        $this->enrol($b);

        $ta = $this->challenge($a);
        for ($i = 0; $i < 4; $i++) {
            $this->apiPost('/totp/verify', ['two_factor_token' => $ta, 'code' => '000000'])->assertStatus(401);
        }
        // B's first attempt from the same address is judged on its own merits, not blocked by A's burn.
        $this->apiPost('/totp/verify', ['two_factor_token' => $this->challenge($b), 'code' => '000000'])->assertStatus(401);
    }

    public function test_mfa_responses_are_never_cacheable_and_never_contain_the_secret_after_setup(): void
    {
        $this->allowEnrollment();
        $member = $this->member();
        $headers = $this->bearer($member);

        $setup = $this->apiPost('/v2/auth/2fa/setup', [], $headers)->assertOk();
        $this->assertStringContainsString('no-store', (string) $setup->headers->get('Cache-Control'));
        $secret = $setup->json('data.secret');
        $this->assertIsString($secret);

        $status = $this->apiGet('/v2/auth/2fa/status', $headers)->assertOk();
        $this->assertStringNotContainsString($secret, $status->getContent());
        $this->assertStringContainsString('no-store', (string) $status->headers->get('Cache-Control'));

        // A completed enrolment turns the next login into a challenge; that response carries the
        // challenge token, and its completion carries live credentials. Neither may be storable.
        $secretRow = DB::table('user_totp_settings')->where('user_id', $member->id)->first();
        $this->assertNotNull($secretRow);
        DB::table('user_totp_settings')->where('user_id', $member->id)->update(['is_enabled' => 1, 'is_pending_setup' => 0]);
        DB::table('users')->where('id', $member->id)->update(['totp_enabled' => 1, 'totp_setup_required' => 0]);

        $login = $this->apiPost('/auth/login', ['email' => $member->email, 'password' => 'test-password'])->assertOk();
        $this->assertStringContainsString('no-store', (string) $login->headers->get('Cache-Control'), 'challenge response');
        $completed = $this->apiPost('/totp/verify', ['two_factor_token' => $login->json('two_factor_token'), 'code' => $this->code($secret)])->assertOk();
        $this->assertStringContainsString('no-store', (string) $completed->headers->get('Cache-Control'), 'credential response');

        // Plain password login (no second factor) also returns credentials.
        $plain = $this->member();
        $plainLogin = $this->apiPost('/auth/login', ['email' => $plain->email, 'password' => 'test-password'])->assertOk();
        $this->assertStringContainsString('no-store', (string) $plainLogin->headers->get('Cache-Control'), 'token response');
    }

    public function test_totp_secret_is_encrypted_at_rest_and_absent_from_the_member_data_export(): void
    {
        $this->allowEnrollment();
        $member = $this->member();
        $secret = $this->apiPost('/v2/auth/2fa/setup', [], $this->bearer($member))->assertOk()->json('data.secret');
        $row = (string) DB::table('user_totp_settings')->where('user_id', $member->id)->value('totp_secret_encrypted');
        $this->assertNotSame('', $row);
        $this->assertStringNotContainsString($secret, $row);

        TotpService::generateBackupCodes($member->id, $member->tenant_id);
        $hashes = DB::table('user_backup_codes')->where('user_id', $member->id)->pluck('code_hash')->all();

        $archive = json_encode(app(MemberDataExportService::class)->buildJsonArchive($member->id), JSON_THROW_ON_ERROR);
        $this->assertStringNotContainsString($secret, $archive);
        $this->assertStringNotContainsString($row, $archive);
        foreach ($hashes as $hash) {
            $this->assertStringNotContainsString($hash, $archive);
        }
    }

    public function test_login_response_before_the_second_factor_carries_no_credential_and_no_full_email(): void
    {
        $member = $this->member();
        $this->enrol($member);
        $login = $this->apiPost('/auth/login', ['email' => $member->email, 'password' => 'test-password'])->assertOk();
        $login->assertJsonPath('requires_2fa', true)->assertJsonMissingPath('access_token')->assertJsonMissingPath('refresh_token')->assertJsonMissingPath('token');
        $this->assertStringNotContainsString($member->email, $login->getContent());
    }
}
