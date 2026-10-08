<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Services;

use App\Core\ApiErrorCodes;
use App\Core\TenantContext;
use App\Models\User;
use App\Services\RegistrationService;
use App\Services\TenantSettingsService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\Laravel\TestCase;

/**
 * B2 regression lock — self-serve activation lockout.
 *
 * On an `admin_approval=false` tenant a verified self-serve user must end up
 * `status='active'` AND `is_approved=1` so they can log in immediately. The two
 * email-verify paths used to diverge: the React path
 * (EmailVerificationController::verifyEmail) only activated already-approved
 * users and never wrote is_approved, and the accessible path
 * (RegistrationService::verifyEmail) flipped status to active but left
 * is_approved=0 — and login's approval gate then blocked the now-active user.
 * Either way a self-serve registrant was permanently stuck, unattended and
 * unrescuable. This test exercises BOTH paths and the real login gate.
 */
class RegistrationActivationLoginTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->app['auth']->forgetGuards();
        unset($_SESSION['user_id']);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
        Cache::flush(); // tenant_settings is cached; start each test clean
    }

    private function setAdminApproval(bool $required): void
    {
        app(TenantSettingsService::class)
            ->set($this->testTenantId, 'admin_approval', $required ? 'true' : 'false', 'boolean');
    }

    public function test_token_table_helper_keeps_the_test_transaction_open(): void
    {
        // CREATE TABLE commits implicitly on MariaDB even when IF NOT EXISTS
        // finds the table, which ends DatabaseTransactions' wrapper: every
        // later write in the test becomes permanent in nexus_test.
        $this->ensureTokenTable();

        $this->assertSame(
            1,
            (int) DB::selectOne('SELECT @@in_transaction AS t')->t,
            'the helper must not end the test transaction'
        );
    }

    private function ensureTokenTable(): void
    {
        // Check first: CREATE TABLE commits the test transaction implicitly,
        // even when IF NOT EXISTS finds the table already there.
        if (\Illuminate\Support\Facades\Schema::hasTable('email_verification_tokens')) {
            return;
        }

        DB::statement(
            "CREATE TABLE IF NOT EXISTS `email_verification_tokens` (
                `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                `user_id` INT UNSIGNED NOT NULL,
                `tenant_id` INT(11) NOT NULL,
                `token` VARCHAR(255) NOT NULL,
                `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                `expires_at` TIMESTAMP NOT NULL,
                INDEX `idx_tenant_user` (`tenant_id`, `user_id`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }

    /**
     * Create a "just self-serve registered" user: pending, unapproved, email
     * unverified, with a known password — exactly the state RegistrationService
     * leaves a new account in (status=pending, is_approved default 0).
     */
    private function createJustRegisteredUser(string $password = 'Self-Serve-2026!'): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'email'             => 'selfserve_' . uniqid() . '@example.com',
            'password_hash'     => Hash::make($password),
            'email_verified_at' => null,
            'is_verified'       => false,
            'is_approved'       => false,
            'status'            => 'pending',
        ]);
        TenantContext::setById($this->testTenantId);

        return $user;
    }

    // ==================================================================
    //  REACT / SPA PATH  (EmailVerificationController::verifyEmail)
    // ==================================================================

    public function test_self_serve_verify_activates_and_approves_then_login_succeeds(): void
    {
        $this->setAdminApproval(false);
        $this->ensureTokenTable();

        $password = 'Self-Serve-2026!';
        $user = $this->createJustRegisteredUser($password);

        $plaintext = bin2hex(random_bytes(32));
        DB::table('email_verification_tokens')->insert([
            'user_id'    => $user->id,
            'tenant_id'  => $this->testTenantId,
            'token'      => hash('sha256', $plaintext),
            'expires_at' => now()->addDay(),
        ]);

        TenantContext::setById($this->testTenantId);
        $verify = $this->apiPost('/auth/verify-email', ['token' => $plaintext]);
        $verify->assertOk();

        $row = DB::table('users')->where('id', $user->id)->first();
        $this->assertNotNull($row->email_verified_at, 'email must be verified');
        $this->assertSame('active', $row->status, 'self-serve verified user must be active');
        $this->assertEquals(1, (int) $row->is_approved, 'self-serve verified user must be approved (B2)');

        // The user can now actually log in — the whole point of B2.
        TenantContext::setById($this->testTenantId);
        $login = $this->apiPost('/auth/login', [
            'email'    => $row->email,
            'password' => $password,
        ]);
        $login->assertStatus(200);
        $this->assertArrayHasKey('access_token', $login->json());
    }

    public function test_admin_approval_tenant_verify_keeps_user_pending_and_login_blocked(): void
    {
        $this->setAdminApproval(true);
        $this->ensureTokenTable();

        $password = 'Needs-Approval-2026!';
        $user = $this->createJustRegisteredUser($password);

        $plaintext = bin2hex(random_bytes(32));
        DB::table('email_verification_tokens')->insert([
            'user_id'    => $user->id,
            'tenant_id'  => $this->testTenantId,
            'token'      => hash('sha256', $plaintext),
            'expires_at' => now()->addDay(),
        ]);

        TenantContext::setById($this->testTenantId);
        $verify = $this->apiPost('/auth/verify-email', ['token' => $plaintext]);
        $verify->assertOk();

        $row = DB::table('users')->where('id', $user->id)->first();
        $this->assertNotNull($row->email_verified_at, 'email is still confirmed');
        $this->assertSame('pending', $row->status, 'approval-required tenant must keep the user pending');
        $this->assertEquals(0, (int) $row->is_approved, 'verification must not self-approve when approval is required');

        // Login is blocked until an admin approves.
        TenantContext::setById($this->testTenantId);
        $login = $this->apiPost('/auth/login', [
            'email'    => $row->email,
            'password' => $password,
        ]);
        $login->assertStatus(403);
        $login->assertJsonPath('errors.0.code', ApiErrorCodes::AUTH_ACCOUNT_PENDING_APPROVAL);
    }

    // ==================================================================
    //  ACCESSIBLE / TOKEN PATH  (RegistrationService::verifyEmail)
    // ==================================================================

    public function test_accessible_path_verify_activates_and_approves_on_self_serve_tenant(): void
    {
        $this->setAdminApproval(false);

        $user = $this->createJustRegisteredUser();
        $token = bin2hex(random_bytes(16));
        DB::table('users')->where('id', $user->id)->update(['verification_token' => $token, 'status' => 'pending']);

        TenantContext::setById($this->testTenantId);
        $ok = app(RegistrationService::class)->verifyEmail($token);
        $this->assertTrue($ok, 'verifyEmail must succeed for a valid token');

        $row = DB::table('users')->where('id', $user->id)->first();
        $this->assertSame('active', $row->status, 'accessible self-serve verify must activate');
        $this->assertEquals(1, (int) $row->is_approved, 'accessible self-serve verify must approve (B2)');
    }

    public function test_accessible_path_verify_keeps_pending_when_approval_required(): void
    {
        $this->setAdminApproval(true);

        $user = $this->createJustRegisteredUser();
        $token = bin2hex(random_bytes(16));
        DB::table('users')->where('id', $user->id)->update(['verification_token' => $token, 'status' => 'pending']);

        TenantContext::setById($this->testTenantId);
        $ok = app(RegistrationService::class)->verifyEmail($token);
        $this->assertTrue($ok);

        $row = DB::table('users')->where('id', $user->id)->first();
        $this->assertSame('pending', $row->status, 'approval-required tenant must stay pending');
        $this->assertEquals(0, (int) $row->is_approved, 'must not self-approve when approval is required');
    }
}
