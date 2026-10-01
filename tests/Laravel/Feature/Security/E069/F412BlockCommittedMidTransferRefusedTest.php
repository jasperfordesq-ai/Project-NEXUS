<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E069;

use App\Core\TenantContext;
use App\Services\BlockUserService;
use App\Services\CreditDonationService;
use App\Services\WalletService;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Feature\Security\E067\Concerns\ForksRace;
use Tests\Laravel\TestCase;

/**
 * F-412 — blocking someone must stop a transfer or donation already in flight.
 *
 * F-332 established the rule and the harm it prevents: a transfer carries the
 * sender's free text to the recipient as a bell notification, a push and an
 * email (`NotifyTransactionCompleted`), so a block in either direction must
 * refuse it before any credit moves. `WalletService::transfer()` checked the
 * block BEFORE its money transaction opened and never re-tested it inside,
 * and `CreditDonationService::donate()` had the identical shape — so a block
 * that committed in that window did not stop the delivery.
 *
 * F-411 put the recipient's STATUS re-check under the lock on both paths; this
 * is the second arm of the same line.
 *
 * These tests assert the CORRECT outcome: with the block asserted committed
 * before any credit can move, nothing is paid and no notification is written.
 *
 * NOT `DatabaseTransactions`: a two-process race has to commit, so fixtures are
 * removed in tearDown() instead.
 */
final class F412BlockCommittedMidTransferRefusedTest extends TestCase
{
    use ForksRace;

    /** @var list<int> */
    private array $users = [];

    protected function tearDown(): void
    {
        DB::purge();
        DB::reconnect();
        if ($this->users !== []) {
            DB::table('user_blocks')->whereIn('user_id', $this->users)->delete();
            DB::table('user_blocks')->whereIn('blocked_user_id', $this->users)->delete();
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
     * CORRECT BEHAVIOUR — a block that commits while the transfer is in flight
     * stops the credit and the free text that rides with it.
     */
    public function test_a_block_committed_mid_transfer_stops_the_credit(): void
    {
        $this->requireForking();
        $sender = $this->makeUser(10);
        $blocker = $this->makeUser(0);

        $report = $this->forkRace(
            $this->testTenantId,
            fn (): array => $this->transfer($sender, $blocker, 4.0),
            static fn (string $q): bool => str_contains($q, '`users`') && str_contains($q, 'for update'),
            function () use ($blocker, $sender): void {
                TenantContext::setById($this->testTenantId);
                BlockUserService::block($blocker, $sender, 'F412 harassment');
                self::assertTrue(
                    BlockUserService::isBlockedEither($sender, $blocker),
                    'the block must commit before any credit can move',
                );
            },
        );

        self::assertTrue($report['reached_barrier'] ?? false, 'the collision was not real: ' . json_encode($report));
        self::assertFalse(
            $report['moved'] ?? true,
            'the transfer reached a member who had blocked the sender: ' . json_encode($report),
        );
        self::assertSame(0.0, $this->balance($blocker), 'credits reached the blocker');
        self::assertSame(10.0, $this->balance($sender), 'the sender was debited for a refused transfer');
        self::assertSame(
            0,
            $this->transactionsBetween($sender, $blocker),
            'a ledger row carrying the blocked sender\'s text was written',
        );
        self::assertSame(
            0,
            $this->notificationsFor($blocker),
            'the blocked sender\'s free text was delivered to the blocker',
        );
    }

    /**
     * CONTROL — the same real collision, differing ONLY in what the parent does
     * while the transfer is parked: the recipient blocks an unrelated third
     * member rather than the sender. The rightful transfer must still complete.
     */
    public function test_control_a_block_on_someone_else_mid_transfer_still_lets_it_through(): void
    {
        $this->requireForking();
        $sender = $this->makeUser(10);
        $recipient = $this->makeUser(0);
        $stranger = $this->makeUser(0);

        $report = $this->forkRace(
            $this->testTenantId,
            fn (): array => $this->transfer($sender, $recipient, 4.0),
            static fn (string $q): bool => str_contains($q, '`users`') && str_contains($q, 'for update'),
            function () use ($recipient, $stranger, $sender): void {
                TenantContext::setById($this->testTenantId);
                BlockUserService::block($recipient, $stranger, 'F412 control: an unrelated block');
                self::assertFalse(
                    BlockUserService::isBlockedEither($sender, $recipient),
                    'the sender and the recipient are not blocked',
                );
            },
        );

        self::assertTrue($report['reached_barrier'] ?? false, 'the collision was not real: ' . json_encode($report));
        self::assertTrue($report['moved'] ?? false, 'a lawful transfer was refused: ' . json_encode($report));
        self::assertSame(4.0, $this->balance($recipient));
        self::assertSame(6.0, $this->balance($sender));
    }

    /** CONTROL — the uncontested refusal (F-332) still works, unchanged. */
    public function test_control_a_block_before_the_transfer_still_refuses_it(): void
    {
        $sender = $this->makeUser(10);
        $blocker = $this->makeUser(0);
        TenantContext::setById($this->testTenantId);
        BlockUserService::block($blocker, $sender, 'F412 harassment');

        $result = $this->transfer($sender, $blocker, 4.0);

        self::assertFalse($result['moved'], json_encode($result));
        self::assertSame(10.0, $this->balance($sender));
        self::assertSame(0.0, $this->balance($blocker));
    }

    // ── CreditDonationService::donate ─────────────────────────────────────

    /**
     * CORRECT BEHAVIOUR — the second call site. A block that commits while the
     * donation is in flight stops the credit and the donor's message with it.
     */
    public function test_a_block_committed_mid_donation_stops_the_credit(): void
    {
        $this->requireForking();
        $donor = $this->makeUser(10);
        $blocker = $this->makeUser(0);

        $report = $this->forkRace(
            $this->testTenantId,
            fn (): array => $this->donate($donor, $blocker, 3.0),
            static fn (string $q): bool => str_contains($q, '`users`') && str_contains($q, 'for update'),
            function () use ($blocker, $donor): void {
                TenantContext::setById($this->testTenantId);
                BlockUserService::block($blocker, $donor, 'F412 harassment');
                self::assertTrue(
                    BlockUserService::isBlockedEither($donor, $blocker),
                    'the block must commit before any credit can move',
                );
            },
        );

        self::assertTrue($report['reached_barrier'] ?? false, 'the collision was not real: ' . json_encode($report));
        self::assertFalse(
            $report['moved'] ?? true,
            'the donation reached a member who had blocked the donor: ' . json_encode($report),
        );
        self::assertSame(0.0, $this->balance($blocker), 'credits reached the blocker');
        self::assertSame(10.0, $this->balance($donor), 'the donor was debited for a refused donation');
        self::assertSame(
            0,
            $this->notificationsFor($blocker),
            'the blocked donor\'s message was delivered to the blocker',
        );
    }

    /**
     * CONTROL — the same real collision on the donation path with a block on an
     * unrelated member. The rightful donation must still complete.
     */
    public function test_control_a_block_on_someone_else_mid_donation_still_lets_it_through(): void
    {
        $this->requireForking();
        $donor = $this->makeUser(10);
        $recipient = $this->makeUser(0);
        $stranger = $this->makeUser(0);

        $report = $this->forkRace(
            $this->testTenantId,
            fn (): array => $this->donate($donor, $recipient, 3.0),
            static fn (string $q): bool => str_contains($q, '`users`') && str_contains($q, 'for update'),
            function () use ($recipient, $stranger): void {
                TenantContext::setById($this->testTenantId);
                BlockUserService::block($recipient, $stranger, 'F412 control: an unrelated block');
            },
        );

        self::assertTrue($report['reached_barrier'] ?? false, 'the collision was not real: ' . json_encode($report));
        self::assertTrue($report['moved'] ?? false, 'a lawful donation was refused: ' . json_encode($report));
        self::assertSame(3.0, $this->balance($recipient));
        self::assertSame(7.0, $this->balance($donor));
    }

    /** CONTROL — the uncontested refusal (F-332) still works, unchanged. */
    public function test_control_a_block_before_the_donation_still_refuses_it(): void
    {
        $donor = $this->makeUser(10);
        $blocker = $this->makeUser(0);
        TenantContext::setById($this->testTenantId);
        BlockUserService::block($blocker, $donor, 'F412 harassment');

        $result = $this->donate($donor, $blocker, 3.0);

        self::assertFalse($result['moved'], json_encode($result));
        self::assertSame(10.0, $this->balance($donor));
        self::assertSame(0.0, $this->balance($blocker));
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
                'description' => 'F412 unwanted message riding on a transfer',
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
            $ok = app(CreditDonationService::class)->donate(
                $this->testTenantId,
                $donorId,
                $recipientId,
                $amount,
                'F412 unwanted message riding on a donation',
            );

            return ['moved' => $ok, 'error' => null];
        } catch (\Throwable $e) {
            return ['moved' => false, 'error' => get_class($e) . ': ' . $e->getMessage()];
        }
    }

    private function makeUser(float $balance): int
    {
        $id = (int) DB::table('users')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'F412 money fixture',
            'email' => 'f412-' . bin2hex(random_bytes(10)) . '@example.test',
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

    private function transactionsBetween(int $senderId, int $receiverId): int
    {
        return (int) DB::table('transactions')
            ->where('tenant_id', $this->testTenantId)
            ->where('sender_id', $senderId)
            ->where('receiver_id', $receiverId)
            ->count();
    }

    private function notificationsFor(int $userId): int
    {
        return (int) DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $userId)
            ->count();
    }
}
