<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E075;

use App\Core\TenantContext;
use App\Services\SafeguardingInteractionPolicy;
use App\Services\StartingBalanceService;
use App\Services\WalletService;
use App\Support\SafeguardingInteractionDecision;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * F-474 — a new member's welcome time credits must not be deniable by another
 * member.
 *
 * Both grant paths decided "already granted" with
 *
 *   ... AND (transaction_type = 'starting_balance'
 *            OR description LIKE '[Welcome Bonus]%')
 *
 *   - StartingBalanceService::alreadyGranted()
 *   - AdminUsersController::grantWelcomeCredits()
 *
 * and `transactions.description` on an ordinary member-to-member transfer is
 * free text the SENDER supplies verbatim (WalletController::transfer() hands
 * `getAllInput()` to WalletService::transfer(), which trims it and writes it
 * to the ledger row). A new member sits at `status = 'pending'` until they
 * verify, and `pending` is deliberately not a non-receiving status — so any
 * signed-in member could send 0.01 credits with a description beginning
 * `[Welcome Bonus]` and both grant paths would conclude the welcome credits
 * had already been paid. The new member never got them, and nothing reported it.
 *
 * The grant is now identified by what the member could not forge. Today both
 * paths write `transaction_type = 'starting_balance'`; before `5eb2cacce` the
 * administrator path wrote a SELF-transfer (`sender_id = receiver_id`) with the
 * `[Welcome Bonus]` description and no transaction type, which is why the
 * description arm exists at all. That arm is now bound to `sender_id =
 * receiver_id`, and `WalletService::transfer()` refuses a self-transfer
 * outright, so no member-reachable path can produce a row that satisfies it.
 */
final class F474WelcomeCreditGrantCannotBePoisonedTest extends TestCase
{
    use DatabaseTransactions;

    /** The tenant-configured welcome grant used throughout this file. */
    private const WELCOME = 5.0;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        $this->allowSafeguarding();
        StartingBalanceService::setStartingBalance(self::WELCOME);
    }

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }

    // ------------------------------------------------------------------
    //  THE HARM — must now be refused
    // ------------------------------------------------------------------

    /**
     * CORRECT BEHAVIOUR — the self-serve grant. A member's 0.01-credit transfer
     * with a forged `[Welcome Bonus]` description must not suppress it.
     */
    public function test_a_members_transfer_cannot_deny_the_self_serve_welcome_grant(): void
    {
        $this->assertSame(
            self::WELCOME,
            StartingBalanceService::getStartingBalance(),
            'precondition: this community grants welcome credits',
        );

        $attacker = $this->makeUser(10.0, 'active');
        $victim = $this->makePendingNewMember();

        $this->wallet()->transfer($attacker, [
            'recipient' => $victim,
            'amount' => 0.01,
            'description' => '[Welcome Bonus] have a nice day',
        ]);

        $this->assertSame(0.01, $this->balanceOf($victim), 'the transfer itself landed');

        // The real call site: RegistrationService::verifyEmail() -> applyToNewUser().
        $grant = StartingBalanceService::applyToNewUser($victim);

        $this->assertSame(
            'starting_balance',
            $grant['source'],
            'the welcome grant was suppressed by a member-written row',
        );
        $this->assertSame(self::WELCOME, $grant['amount']);
        $this->assertEqualsWithDelta(
            self::WELCOME + 0.01,
            $this->balanceOf($victim),
            0.0001,
            'the new member did not receive their welcome credits',
        );
        $this->assertDatabaseHas('transactions', [
            'tenant_id' => $this->testTenantId,
            'receiver_id' => $victim,
            'transaction_type' => 'starting_balance',
        ]);
    }

    /**
     * CORRECT BEHAVIOUR — the administrator-approval grant reads the same
     * predicate and must be just as unforgeable.
     */
    public function test_a_members_transfer_cannot_deny_the_administrator_approval_grant(): void
    {
        $attacker = $this->makeUser(10.0, 'active');
        $victim = $this->makePendingNewMember();

        $this->wallet()->transfer($attacker, [
            'recipient' => $victim,
            'amount' => 0.01,
            'description' => '[Welcome Bonus] denied',
        ]);

        $awarded = $this->grantWelcomeCreditsAsAdminApproval($victim);

        $this->assertSame(
            (int) self::WELCOME,
            $awarded,
            'the administrator approval granted nothing',
        );
        $this->assertEqualsWithDelta(
            self::WELCOME + 0.01,
            $this->balanceOf($victim),
            0.0001,
            'the approved member did not receive their welcome credits',
        );
    }

    /**
     * CORRECT BEHAVIOUR — a forged description does not help on any suffix
     * either, and the attacker cannot reach the predicate by sending to
     * themselves (a self-transfer is refused outright), which is the only shape
     * the surviving legacy arm accepts.
     */
    public function test_a_member_cannot_write_a_row_that_looks_like_a_legacy_welcome_grant(): void
    {
        $attacker = $this->makeUser(10.0, 'active');

        $refused = null;
        try {
            $this->wallet()->transfer($attacker, [
                'recipient' => $attacker,
                'amount' => 0.01,
                'description' => '[Welcome Bonus] to myself',
            ]);
        } catch (\Throwable $e) {
            $refused = $e->getMessage();
        }

        $this->assertNotNull($refused, 'a self-transfer was accepted');
        $this->assertSame(
            0,
            (int) DB::table('transactions')
                ->where('tenant_id', $this->testTenantId)
                ->where('receiver_id', $attacker)
                ->whereColumn('sender_id', 'receiver_id')
                ->count(),
            'a member wrote a row in the legacy welcome-grant shape',
        );
    }

    // ------------------------------------------------------------------
    //  LEGITIMATE-ACCESS CONTROLS
    // ------------------------------------------------------------------

    /**
     * CONTROL — an ordinary transfer with an ordinary description, identical in
     * every other respect, still arrives and still leaves the grant intact.
     */
    public function test_control_an_ordinary_transfer_still_arrives_and_leaves_the_grant_intact(): void
    {
        $sender = $this->makeUser(10.0, 'active');
        $newMember = $this->makePendingNewMember();

        $this->wallet()->transfer($sender, [
            'recipient' => $newMember,
            'amount' => 0.01,
            'description' => 'have a nice day',
        ]);

        $grant = StartingBalanceService::applyToNewUser($newMember);

        $this->assertSame('starting_balance', $grant['source']);
        $this->assertSame(self::WELCOME, $grant['amount']);
        $this->assertEqualsWithDelta(self::WELCOME + 0.01, $this->balanceOf($newMember), 0.0001);
    }

    /**
     * CONTROL — the genuine idempotency the marker exists for still holds: a
     * second self-serve grant attempt does not double-credit.
     */
    public function test_control_a_genuine_second_grant_attempt_still_does_not_double_credit(): void
    {
        $newMember = $this->makePendingNewMember();

        $first = StartingBalanceService::applyToNewUser($newMember);
        $second = StartingBalanceService::applyToNewUser($newMember);

        $this->assertSame('starting_balance', $first['source']);
        $this->assertSame('already_applied', $second['source']);
        $this->assertEqualsWithDelta(self::WELCOME, $this->balanceOf($newMember), 0.0001, 'granted exactly once');
    }

    /**
     * CONTROL — the cross-mechanism idempotency still holds in both directions:
     * neither grant path stacks on top of the other.
     */
    public function test_control_the_two_grant_paths_still_do_not_stack(): void
    {
        $selfServeFirst = $this->makePendingNewMember();
        StartingBalanceService::applyToNewUser($selfServeFirst);
        $this->assertSame(
            0,
            $this->grantWelcomeCreditsAsAdminApproval($selfServeFirst),
            'the administrator path granted a second welcome bonus',
        );
        $this->assertEqualsWithDelta(self::WELCOME, $this->balanceOf($selfServeFirst), 0.0001);

        $adminFirst = $this->makePendingNewMember();
        $this->grantWelcomeCreditsAsAdminApproval($adminFirst);
        $this->assertSame(
            'already_applied',
            StartingBalanceService::applyToNewUser($adminFirst)['source'],
            'the self-serve path granted a second welcome bonus',
        );
        $this->assertEqualsWithDelta(self::WELCOME, $this->balanceOf($adminFirst), 0.0001);
    }

    /**
     * CONTROL — a welcome grant in the LEGACY shape (a self-transfer carrying
     * the `[Welcome Bonus]` description, written before `5eb2cacce` gave these
     * rows a transaction type) is still recognised, so an existing member who
     * was already paid is not paid twice.
     */
    public function test_control_a_legacy_shaped_welcome_grant_is_still_recognised(): void
    {
        $member = $this->makePendingNewMember();

        DB::table('transactions')->insert([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $member,
            'receiver_id' => $member,
            'amount' => self::WELCOME,
            'description' => '[Welcome Bonus] New member welcome credits (approved by admin #1)',
            'status' => 'completed',
            'created_at' => now(),
        ]);

        $this->assertSame(
            'already_applied',
            StartingBalanceService::applyToNewUser($member)['source'],
            'a legacy welcome grant was no longer recognised, so the member would be paid twice',
        );
        $this->assertSame(
            0,
            $this->grantWelcomeCreditsAsAdminApproval($member),
            'the administrator path no longer recognises a legacy welcome grant',
        );
        $this->assertSame(0.0, $this->balanceOf($member), 'nothing was credited a second time');
    }

    // ------------------------------------------------------------------
    //  Fixtures
    // ------------------------------------------------------------------

    private function wallet(): WalletService
    {
        return app(WalletService::class);
    }

    private function balanceOf(int $userId): float
    {
        return round((float) DB::table('users')->where('id', $userId)->value('balance'), 2);
    }

    /**
     * Replays the administrator-approval grant exactly as
     * AdminUsersController::approve() does, on the same private method and the
     * same `$user` array shape.
     */
    private function grantWelcomeCreditsAsAdminApproval(int $userId): int
    {
        $controller = app(\App\Http\Controllers\Api\AdminUsersController::class);
        $method = new \ReflectionMethod($controller, 'grantWelcomeCredits');
        $method->setAccessible(true);

        $user = (array) DB::table('users')->where('id', $userId)->first();

        return (int) $method->invoke($controller, $user, 1);
    }

    /**
     * A member between registration and activation: RegistrationService sets
     * `status = 'pending'` and `balance = 0`, and grants the welcome credits
     * later.
     */
    private function makePendingNewMember(): int
    {
        return $this->makeUser(0.0, 'pending', false);
    }

    private function makeUser(float $balance, string $status, bool $approved = true): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'F474 fixture',
            'email' => 'f474-' . bin2hex(random_bytes(10)) . '@example.test',
            'password_hash' => password_hash(bin2hex(random_bytes(16)), PASSWORD_BCRYPT),
            'balance' => $balance,
            'role' => 'member',
            'status' => $status,
            'is_active' => $status === 'active',
            'is_approved' => $approved,
            'onboarding_completed' => true,
            'preferred_language' => 'en',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function allowSafeguarding(): void
    {
        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('evaluateLocalContact')->andReturn($this->allowDecision());
        $policy->shouldReceive('evaluateCrossTenantContact')->andReturn($this->allowDecision());
        $policy->shouldReceive('evaluateExternalContact')->andReturn($this->allowDecision());
        $policy->shouldReceive('assertLocalContactAllowed')->andReturnNull();
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);
    }

    private function allowDecision(): SafeguardingInteractionDecision
    {
        return new SafeguardingInteractionDecision(
            status: SafeguardingInteractionDecision::ALLOW,
            code: 'ALLOWED',
            recipientTenantId: $this->testTenantId,
            purposeCode: 'safeguarded_member_contact',
            scopeType: 'tenant',
            scopeIdentifier: '',
            policyVersion: 'e076-f474',
        );
    }
}
