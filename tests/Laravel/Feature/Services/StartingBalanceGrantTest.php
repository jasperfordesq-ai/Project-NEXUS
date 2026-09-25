<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Services;

use App\Models\User;
use App\Services\RegistrationService;
use App\Services\StartingBalanceService;
use App\Services\TenantSettingsService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * Feature tests for the starting-balance (welcome credits) grant wiring:
 *
 *  - StartingBalanceService::applyToNewUser grants the configured amount
 *    exactly once (idempotent, including against the admin '[Welcome Bonus]'
 *    grant path).
 *  - RegistrationService::verifyEmail grants on activation for self-serve
 *    tenants (admin approval OFF) and never grants while approval is pending.
 *  - A wallet failure never breaks email verification.
 */
class StartingBalanceGrantTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->clearStartingBalanceSettings();
    }

    protected function tearDown(): void
    {
        $this->clearStartingBalanceSettings();
        parent::tearDown();
    }

    /** Remove both setting keys and bust the settings cache for the test tenant. */
    private function clearStartingBalanceSettings(): void
    {
        DB::delete(
            "DELETE FROM tenant_settings WHERE tenant_id = ? AND setting_key IN ('wallet.starting_balance', 'general.welcome_credits', 'admin_approval')",
            [$this->testTenantId]
        );
        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);
    }

    private function setSetting(string $key, string $value, string $type = 'string'): void
    {
        app(TenantSettingsService::class)->set($this->testTenantId, $key, $value, $type);
    }

    private function makeUser(array $state = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'balance' => 0,
        ], $state));

        // Model-created listeners end with TenantContext::restoreAfterScopedListener(),
        // which in console (PHPUnit) RESETS the context; the next getId() then
        // auto-resolves to tenant 1. Re-pin the test tenant the way the HTTP
        // middleware would before any service call.
        \App\Core\TenantContext::setById($this->testTenantId);

        return $user;
    }

    private function balanceOf(User $user): int
    {
        return (int) DB::selectOne(
            "SELECT balance FROM users WHERE id = ? AND tenant_id = ?",
            [$user->id, $this->testTenantId]
        )->balance;
    }

    private function grantTransactionCount(User $user): int
    {
        return (int) DB::selectOne(
            "SELECT COUNT(*) AS c FROM transactions
             WHERE tenant_id = ? AND receiver_id = ? AND transaction_type = 'starting_balance'",
            [$this->testTenantId, $user->id]
        )->c;
    }

    // ------------------------------------------------------------------
    //  applyToNewUser — grant semantics
    // ------------------------------------------------------------------

    public function test_applyToNewUser_grants_configured_balance_exactly_once(): void
    {
        $this->setSetting('wallet.starting_balance', '7', 'float');
        $user = $this->makeUser();

        $first = StartingBalanceService::applyToNewUser((int) $user->id);

        $this->assertTrue($first['success']);
        $this->assertSame(7.0, $first['amount']);
        $this->assertSame('starting_balance', $first['source']);
        $this->assertSame(7, $this->balanceOf($user));
        $this->assertSame(1, $this->grantTransactionCount($user));

        // Retry (e.g. double-submitted verification) must be a no-op
        $second = StartingBalanceService::applyToNewUser((int) $user->id);

        $this->assertTrue($second['success']);
        $this->assertSame('already_applied', $second['source']);
        $this->assertSame(7, $this->balanceOf($user));
        $this->assertSame(1, $this->grantTransactionCount($user));
    }

    public function test_applyToNewUser_grants_platform_default_when_unset(): void
    {
        // Unconfigured tenants grant the platform default of 5 — the same
        // default grantWelcomeCredits uses on admin-approval tenants, so
        // both signup routes behave identically (Jasper, 2026-06-11).
        $user = $this->makeUser();

        $result = StartingBalanceService::applyToNewUser((int) $user->id);

        $this->assertTrue($result['success']);
        $this->assertSame(5.0, $result['amount']);
        $this->assertSame('starting_balance', $result['source']);
        $this->assertSame(5, $this->balanceOf($user));
        $this->assertSame(1, $this->grantTransactionCount($user));
    }

    public function test_applyToNewUser_grants_nothing_when_zero(): void
    {
        $this->setSetting('wallet.starting_balance', '0', 'float');
        $user = $this->makeUser();

        $result = StartingBalanceService::applyToNewUser((int) $user->id);

        $this->assertTrue($result['success']);
        $this->assertSame('none', $result['source']);
        $this->assertSame(0, $this->balanceOf($user));
        $this->assertSame(0, $this->grantTransactionCount($user));
    }

    public function test_applyToNewUser_falls_back_to_legacy_welcome_credits_key(): void
    {
        $this->setSetting('general.welcome_credits', '4', 'integer');
        $user = $this->makeUser();

        $result = StartingBalanceService::applyToNewUser((int) $user->id);

        $this->assertTrue($result['success']);
        $this->assertSame(4.0, $result['amount']);
        $this->assertSame(4, $this->balanceOf($user));
    }

    public function test_applyToNewUser_skips_when_admin_welcome_bonus_already_granted(): void
    {
        $this->setSetting('wallet.starting_balance', '7', 'float');
        $user = $this->makeUser();

        // Simulate the admin-approval grant path (AdminUsersController::grantWelcomeCredits)
        DB::insert(
            "INSERT INTO transactions (tenant_id, sender_id, receiver_id, amount, description, status, created_at)
             VALUES (?, ?, ?, ?, ?, 'completed', NOW())",
            [$this->testTenantId, $user->id, $user->id, 5, '[Welcome Bonus] New member welcome credits (approved by admin #1)']
        );

        $result = StartingBalanceService::applyToNewUser((int) $user->id);

        $this->assertTrue($result['success']);
        $this->assertSame('already_applied', $result['source']);
        $this->assertSame(0, $this->balanceOf($user));
        $this->assertSame(0, $this->grantTransactionCount($user));
    }

    // ------------------------------------------------------------------
    //  verifyEmail wiring
    // ------------------------------------------------------------------

    public function test_verifyEmail_grants_starting_balance_on_self_serve_tenant(): void
    {
        $this->setSetting('admin_approval', 'false', 'boolean');
        $this->setSetting('wallet.starting_balance', '5', 'float');

        $token = Str::random(64);
        $user = $this->makeUser([
            'status' => 'pending',
            'is_approved' => false,
            'verification_token' => $token,
        ]);

        $verified = app(RegistrationService::class)->verifyEmail($token);

        $this->assertTrue($verified);
        $this->assertSame(5, $this->balanceOf($user));
        $this->assertSame(1, $this->grantTransactionCount($user));
        $this->assertSame(
            'active',
            DB::selectOne("SELECT status FROM users WHERE id = ?", [$user->id])->status
        );
    }

    public function test_verifyEmail_does_not_grant_when_admin_approval_required(): void
    {
        $this->setSetting('admin_approval', 'true', 'boolean');
        $this->setSetting('wallet.starting_balance', '5', 'float');

        $token = Str::random(64);
        $user = $this->makeUser([
            'status' => 'pending',
            'is_approved' => false,
            'verification_token' => $token,
        ]);

        $verified = app(RegistrationService::class)->verifyEmail($token);

        $this->assertTrue($verified);
        // Account stays pending until an admin approves; the approval flow
        // (grantWelcomeCredits) is responsible for the credits there.
        $this->assertSame(0, $this->balanceOf($user));
        $this->assertSame(0, $this->grantTransactionCount($user));
    }

    public function test_verifyEmail_succeeds_even_if_starting_balance_grant_fails(): void
    {
        $token = Str::random(64);
        $user = $this->makeUser([
            'status' => 'pending',
            'is_approved' => false,
            'verification_token' => $token,
        ]);

        // Self-serve tenant whose settings backend blows up when the grant
        // reads the starting balance — verification must still succeed.
        $settings = Mockery::mock(TenantSettingsService::class);
        $settings->shouldReceive('requiresAdminApproval')->andReturn(false);
        // E-035 F-152: email verification also asks whether the registration
        // policy holds the account (identity check / waitlist); none here.
        $settings->shouldReceive('registrationActivationHold')->andReturn(null);
        $settings->shouldReceive('get')->andThrow(new \RuntimeException('settings backend down'));
        $settings->shouldReceive('clearCacheForTenant'); // tearDown cache bust
        $this->app->instance(TenantSettingsService::class, $settings);

        $verified = app(RegistrationService::class)->verifyEmail($token);

        $this->assertTrue($verified);
        $this->assertSame(0, $this->balanceOf($user));
        $this->assertSame(0, $this->grantTransactionCount($user));
        $this->assertSame(
            'active',
            DB::selectOne("SELECT status FROM users WHERE id = ?", [$user->id])->status
        );
    }
}
