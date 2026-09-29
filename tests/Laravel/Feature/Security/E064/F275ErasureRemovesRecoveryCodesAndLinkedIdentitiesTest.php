<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E064;

use App\Models\User;
use App\Services\Enterprise\GdprService;
use App\Services\TotpService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-275 (E-062 slice F, F-2): Article 17 erasure must remove the member's
 * two-factor recovery codes (which otherwise still verify against the erased
 * user id, and carry used_ip / used_user_agent) and their linked sign-in
 * identities (`oauth_identities` holds the provider's copy of the real email
 * and claim set in plaintext), exactly as the admin two-factor reset and
 * TotpService::disable() already delete `user_backup_codes`.
 */
class F275ErasureRemovesRecoveryCodesAndLinkedIdentitiesTest extends TestCase
{
    use DatabaseTransactions;

    private ?string $originalStoragePath = null;

    protected function setUp(): void
    {
        parent::setUp();
        $this->originalStoragePath = getenv('STORAGE_PATH') ?: null;
        putenv('STORAGE_PATH=' . rtrim(sys_get_temp_dir(), '/\\') . '/f275-erasure-' . getmypid());
    }

    protected function tearDown(): void
    {
        if ($this->originalStoragePath === null) {
            putenv('STORAGE_PATH');
        } else {
            putenv('STORAGE_PATH=' . $this->originalStoragePath);
        }
        parent::tearDown();
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'totp_enabled' => 1,
        ]);
    }

    private function giveTwoFactor(User $user, string $plainCode): void
    {
        DB::table('user_totp_settings')->insert([
            'user_id' => (int) $user->id,
            'tenant_id' => $this->testTenantId,
            'totp_secret_encrypted' => 'f275-fixture-secret',
            'is_enabled' => 1,
        ]);
        DB::table('user_backup_codes')->insert([
            'user_id' => (int) $user->id,
            'tenant_id' => $this->testTenantId,
            'code_hash' => password_hash($plainCode, PASSWORD_DEFAULT),
            'is_used' => 0,
        ]);
    }

    private function linkIdentity(User $user, string $email, int $tenantId): void
    {
        DB::table('oauth_identities')->insert([
            'user_id' => (int) $user->id,
            'tenant_id' => $tenantId,
            'provider' => 'google',
            'provider_user_id' => 'f275-' . bin2hex(random_bytes(6)),
            'provider_email' => $email,
            'avatar_url' => 'https://example.test/f275.png',
            'raw_payload' => json_encode(['email' => $email, 'name' => 'Realfirst Reallast']),
            'linked_at' => now(),
        ]);
    }

    public function test_recovery_codes_are_deleted_and_no_longer_verify(): void
    {
        $user = $this->member();
        $this->giveTwoFactor($user, 'F275CODE01');
        DB::table('user_backup_codes')->insert([
            'user_id' => (int) $user->id,
            'tenant_id' => $this->testTenantId,
            'code_hash' => password_hash('F275USED01', PASSWORD_DEFAULT),
            'is_used' => 1,
            'used_at' => now(),
            'used_ip' => '203.0.113.77',
            'used_user_agent' => 'F275-Fixture-Agent/1.0',
        ]);

        (new GdprService($this->testTenantId))->executeAccountDeletion((int) $user->id);

        // Control: the same step's existing work still happens.
        $this->assertSame(0, DB::table('user_totp_settings')->where('user_id', $user->id)->count());
        $this->assertSame(0, (int) DB::table('users')->where('id', $user->id)->value('totp_enabled'));

        $this->assertSame(
            0,
            DB::table('user_backup_codes')->where('user_id', $user->id)->where('tenant_id', $this->testTenantId)->count(),
            'recovery codes (and their used_ip / user agent) must not survive erasure'
        );
        $after = TotpService::verifyBackupCode((int) $user->id, 'F275CODE01', $this->testTenantId);
        $this->assertFalse((bool) ($after['success'] ?? false), 'a pre-erasure recovery code must not verify');
    }

    public function test_linked_sign_in_identities_are_deleted(): void
    {
        $user = $this->member();
        $realEmail = 'f275-idp-' . bin2hex(random_bytes(6)) . '@example.test';
        $this->linkIdentity($user, $realEmail, $this->testTenantId);

        (new GdprService($this->testTenantId))->executeAccountDeletion((int) $user->id);

        $this->assertSame(
            0,
            DB::table('oauth_identities')->where('user_id', $user->id)->where('tenant_id', $this->testTenantId)->count(),
            'the linked identity row (real email + provider claims) must not survive erasure'
        );
        $this->assertSame(0, DB::table('oauth_identities')->where('provider_email', $realEmail)->count());
    }

    public function test_control_bystanders_keep_their_codes_and_identities(): void
    {
        $victim = $this->member();
        $bystander = $this->member();
        $this->giveTwoFactor($victim, 'F275VICT01');
        $this->giveTwoFactor($bystander, 'F275BYST01');
        $bystanderEmail = 'f275-bystander-' . bin2hex(random_bytes(6)) . '@example.test';
        $this->linkIdentity($bystander, $bystanderEmail, $this->testTenantId);

        (new GdprService($this->testTenantId))->executeAccountDeletion((int) $victim->id);

        $ok = TotpService::verifyBackupCode((int) $bystander->id, 'F275BYST01', $this->testTenantId);
        $this->assertTrue((bool) ($ok['success'] ?? false), 'the bystander recovery code still works');
        $this->assertSame(1, DB::table('user_totp_settings')->where('user_id', $bystander->id)->count());
        $this->assertSame(1, DB::table('oauth_identities')->where('user_id', $bystander->id)->count());
        $this->assertSame($bystanderEmail, DB::table('oauth_identities')->where('user_id', $bystander->id)->value('provider_email'));
    }
}
