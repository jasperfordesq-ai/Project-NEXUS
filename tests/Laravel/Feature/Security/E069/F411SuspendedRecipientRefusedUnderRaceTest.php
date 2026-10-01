<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E069;

use App\Core\TenantContext;
use App\Services\CreditDonationService;
use App\Services\WalletService;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Feature\Security\E067\Concerns\ForksRace;
use Tests\Laravel\TestCase;

/**
 * F-411 — a member suspended while a credit is in flight must not be paid.
 *
 * `WalletService::transfer()` called `canReceiveCredits()` on an unlocked read
 * BEFORE its money transaction opened and never re-read the status inside it;
 * the credit statement carried no status condition. `CreditDonationService::donate()`
 * had the identical shape. So a suspension, ban or rejection that committed
 * between the check and the money move did not stop the credit, and the hours
 * landed in an account nobody can sign in to or spend from.
 *
 * `CommunityFundService::adminWithdraw()` (:184-200) and
 * `MarketplaceCommunityDeliveryService` (:410-424) are the in-house
 * counter-examples: they validate the recipient under the same lock the money
 * move holds. Both call sites here now do the same.
 *
 * These tests assert the CORRECT outcome: under a real `pcntl_fork` collision,
 * with the suspension asserted committed before any credit can move, nothing is
 * paid and nothing is debited.
 *
 * NOT `DatabaseTransactions`: a two-process race has to commit, so fixtures are
 * removed in tearDown() instead. This is the convention every other fork race
 * in `tests/Laravel/Feature/Security/` already follows.
 */
final class F411SuspendedRecipientRefusedUnderRaceTest extends TestCase
{
    use ForksRace;

    /** @var list<int> */
    private array $users = [];

    protected function tearDown(): void
    {
        DB::purge();
        DB::reconnect();
        if ($this->users !== []) {
            DB::table('credit_donations')->whereIn('donor_id', $this->users)->delete();
            DB::table('transactions')->whereIn('sender_id', $this->users)->delete();
            DB::table('transactions')->whereIn('receiver_id', $this->users)->delete();
            DB::table('notifications')->whereIn('user_id', $this->users)->delete();
            DB::table('user_xp_log')->whereIn('user_id', $this->users)->delete();
            DB::table('org_audit_log')->whereIn('user_id', $this->users)->delete();
            DB::table('wallet_transfer_receipts')->whereIn('sender_id', $this->users)->delete();
            DB::table('users')->whereIn('id', $this->users)->delete();
        }
        parent::tearDown();
    }

    // ── WalletService::transfer ───────────────────────────────────────────

    /**
     * CORRECT BEHAVIOUR — a suspension that commits while the transfer is in
     * flight stops the credit, and leaves the sender's balance alone.
     */
    public function test_a_suspension_committed_mid_transfer_stops_the_credit(): void
    {
        $this->requireForking();
        $sender = $this->makeUser(10);
        $receiver = $this->makeUser(0);

        $report = $this->forkRace(
            $this->testTenantId,
            fn (): array => $this->transfer($sender, $receiver, 4.0),
            static fn (string $q): bool => str_contains($q, '`users`') && str_contains($q, 'for update'),
            function () use ($receiver): void {
                $this->suspend($receiver);
                self::assertSame(
                    'suspended',
                    $this->userStatus($receiver),
                    'the suspension must commit before any credit can move',
                );
            },
        );

        self::assertTrue($report['reached_barrier'] ?? false, 'the collision was not real: ' . json_encode($report));
        self::assertFalse(
            $report['moved'] ?? true,
            'the transfer was accepted into a suspended account: ' . json_encode($report),
        );
        self::assertSame(
            0.0,
            $this->balance($receiver),
            'time credits reached an account suspended before the money moved',
        );
        self::assertSame(10.0, $this->balance($sender), 'the sender was debited for a refused transfer');
    }

    /**
     * CONTROL — the same real collision, differing ONLY in what the parent does
     * while the transfer is parked: an unrelated change to the recipient's row
     * instead of a suspension. The rightful transfer must still complete, so
     * the refusal above is the status check and not merely contention.
     */
    public function test_control_an_unrelated_change_mid_transfer_still_lets_it_through(): void
    {
        $this->requireForking();
        $sender = $this->makeUser(10);
        $receiver = $this->makeUser(0);

        $report = $this->forkRace(
            $this->testTenantId,
            fn (): array => $this->transfer($sender, $receiver, 4.0),
            static fn (string $q): bool => str_contains($q, '`users`') && str_contains($q, 'for update'),
            function () use ($receiver): void {
                DB::table('users')->where('id', $receiver)->where('tenant_id', $this->testTenantId)
                    ->update(['bio' => 'F411 control: an unrelated edit', 'updated_at' => now()]);
                self::assertSame('active', $this->userStatus($receiver), 'the recipient is still active');
            },
        );

        self::assertTrue($report['reached_barrier'] ?? false, 'the collision was not real: ' . json_encode($report));
        self::assertTrue($report['moved'] ?? false, 'a lawful transfer was refused: ' . json_encode($report));
        self::assertSame(4.0, $this->balance($receiver));
        self::assertSame(6.0, $this->balance($sender));
    }

    /** CONTROL — an ordinary uncontested transfer to an active member still works. */
    public function test_control_transfer_to_an_active_member_succeeds(): void
    {
        $sender = $this->makeUser(10);
        $receiver = $this->makeUser(0);

        $result = $this->transfer($sender, $receiver, 4.0);

        self::assertTrue($result['moved'], json_encode($result));
        self::assertSame(6.0, $this->balance($sender));
        self::assertSame(4.0, $this->balance($receiver));
    }

    /** CONTROL — the uncontested refusal still works, unchanged. */
    public function test_control_suspension_before_the_transfer_refuses_it(): void
    {
        $sender = $this->makeUser(10);
        $receiver = $this->makeUser(0);
        $this->suspend($receiver);

        $result = $this->transfer($sender, $receiver, 4.0);

        self::assertFalse($result['moved'], json_encode($result));
        self::assertSame(10.0, $this->balance($sender));
        self::assertSame(0.0, $this->balance($receiver));
    }

    // ── CreditDonationService::donate ─────────────────────────────────────

    /**
     * CORRECT BEHAVIOUR — the second call site. A suspension that commits while
     * the donation is in flight stops the credit.
     */
    public function test_a_suspension_committed_mid_donation_stops_the_credit(): void
    {
        $this->requireForking();
        $donor = $this->makeUser(10);
        $recipient = $this->makeUser(0);

        $report = $this->forkRace(
            $this->testTenantId,
            fn (): array => $this->donate($donor, $recipient, 3.0),
            static fn (string $q): bool => str_contains($q, '`users`') && str_contains($q, 'for update'),
            function () use ($recipient): void {
                $this->suspend($recipient);
                self::assertSame(
                    'suspended',
                    $this->userStatus($recipient),
                    'the suspension must commit before any credit can move',
                );
            },
        );

        self::assertTrue($report['reached_barrier'] ?? false, 'the collision was not real: ' . json_encode($report));
        self::assertFalse(
            $report['moved'] ?? true,
            'the donation was accepted into a suspended account: ' . json_encode($report),
        );
        self::assertSame(
            0.0,
            $this->balance($recipient),
            'donated time credits reached an account suspended before the money moved',
        );
        self::assertSame(10.0, $this->balance($donor), 'the donor was debited for a refused donation');
    }

    /**
     * CONTROL — the same real collision on the donation path with an unrelated
     * change in the window. The rightful donation must still complete.
     */
    public function test_control_an_unrelated_change_mid_donation_still_lets_it_through(): void
    {
        $this->requireForking();
        $donor = $this->makeUser(10);
        $recipient = $this->makeUser(0);

        $report = $this->forkRace(
            $this->testTenantId,
            fn (): array => $this->donate($donor, $recipient, 3.0),
            static fn (string $q): bool => str_contains($q, '`users`') && str_contains($q, 'for update'),
            function () use ($recipient): void {
                DB::table('users')->where('id', $recipient)->where('tenant_id', $this->testTenantId)
                    ->update(['bio' => 'F411 control: an unrelated edit', 'updated_at' => now()]);
                self::assertSame('active', $this->userStatus($recipient), 'the recipient is still active');
            },
        );

        self::assertTrue($report['reached_barrier'] ?? false, 'the collision was not real: ' . json_encode($report));
        self::assertTrue($report['moved'] ?? false, 'a lawful donation was refused: ' . json_encode($report));
        self::assertSame(3.0, $this->balance($recipient));
        self::assertSame(7.0, $this->balance($donor));
    }

    /** CONTROL — an ordinary uncontested donation to an active member still works. */
    public function test_control_donation_to_an_active_member_succeeds(): void
    {
        $donor = $this->makeUser(10);
        $recipient = $this->makeUser(0);

        $result = $this->donate($donor, $recipient, 3.0);

        self::assertTrue($result['moved'], json_encode($result));
        self::assertSame(7.0, $this->balance($donor));
        self::assertSame(3.0, $this->balance($recipient));
    }

    /** CONTROL — the uncontested refusal still works, unchanged. */
    public function test_control_suspension_before_the_donation_refuses_it(): void
    {
        $donor = $this->makeUser(10);
        $recipient = $this->makeUser(0);
        $this->suspend($recipient);

        $result = $this->donate($donor, $recipient, 3.0);

        self::assertFalse($result['moved'], json_encode($result));
        self::assertSame(10.0, $this->balance($donor));
        self::assertSame(0.0, $this->balance($recipient));
    }

    // ── fixtures ──────────────────────────────────────────────────────────

    /** @return array<string,mixed> */
    private function transfer(int $senderId, int $receiverId, float $amount): array
    {
        TenantContext::setById($this->testTenantId);
        try {
            app(WalletService::class)->transfer($senderId, [
                'recipient' => $receiverId,
                'amount' => $amount,
                'description' => 'F411 transfer',
            ]);

            return ['moved' => true, 'error' => null];
        } catch (\Throwable $e) {
            return ['moved' => false, 'error' => get_class($e) . ': ' . $e->getMessage()];
        }
    }

    /** @return array<string,mixed> */
    private function donate(int $donorId, int $recipientId, float $amount): array
    {
        TenantContext::setById($this->testTenantId);
        try {
            $ok = app(CreditDonationService::class)
                ->donate($this->testTenantId, $donorId, $recipientId, $amount, 'F411 donation');

            return ['moved' => $ok, 'error' => null];
        } catch (\Throwable $e) {
            return ['moved' => false, 'error' => get_class($e) . ': ' . $e->getMessage()];
        }
    }

    private function makeUser(float $balance): int
    {
        $id = (int) DB::table('users')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'F411 money fixture',
            'email' => 'f411-' . bin2hex(random_bytes(10)) . '@example.test',
            'password_hash' => password_hash(bin2hex(random_bytes(16)), PASSWORD_BCRYPT),
            'balance' => $balance,
            'role' => 'member',
            'status' => 'active',
            'is_active' => true,
            'is_approved' => true,
            'preferred_language' => 'en',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->users[] = $id;

        return $id;
    }

    private function balance(int $id): float
    {
        return (float) DB::table('users')->where('id', $id)->value('balance');
    }

    private function userStatus(int $id): string
    {
        return (string) DB::table('users')->where('id', $id)->value('status');
    }

    private function suspend(int $id): void
    {
        DB::table('users')->where('id', $id)->where('tenant_id', $this->testTenantId)
            ->update(['status' => 'suspended', 'updated_at' => now()]);
    }
}
