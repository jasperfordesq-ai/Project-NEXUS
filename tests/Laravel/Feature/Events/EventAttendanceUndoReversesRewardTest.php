<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Enums\EventAttendanceAction;
use App\Models\Event;
use App\Models\Transaction;
use App\Models\User;
use App\Services\EventAttendanceService;
use App\Services\EventCreditService;
use App\Services\WalletService;
use App\Support\Events\EventAttendanceTransitionResult;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-588 — undoing a check-in left the attendance time-credit reward paid.
 *
 * The check-in minted the reward; the undo never touched the claim, and a
 * later re-check-in reported `already_settled`. So a mis-scan paid a member
 * for an event they did not attend, and nothing on the door screen or in the
 * ledger said so. Undo now reverses the reward through the same reversal the
 * admin "reverse" action uses, and a genuine re-check-in pays again.
 */
final class EventAttendanceUndoReversesRewardTest extends TestCase
{
    use DatabaseTransactions;

    private User $organiser;

    private User $attendee;

    private Event $event;

    protected function setUp(): void
    {
        parent::setUp();
        config(['events.attendance_credit_mode' => 'treasury']);

        $row = DB::table('tenants')->where('id', $this->testTenantId)->first();
        $features = [];
        if ($row && ! empty($row->features)) {
            $decoded = is_string($row->features) ? json_decode($row->features, true) : $row->features;
            $features = is_array($decoded) ? $decoded : [];
        }
        $features['events'] = true;
        $features['event_attendance_credits'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);

        $this->organiser = $this->member();
        $this->attendee = $this->member();
        $event = new Event([
            'user_id' => $this->organiser->id,
            'title' => 'Undo Reward Fair',
            'start_time' => now()->subHour(),
            'end_time' => now()->addHour(),
        ]);
        $event->tenant_id = $this->testTenantId;
        $event->status = 'active';
        $event->attendance_credit_amount = 1.0;
        $event->save();
        $this->event = $event;

        DB::table('event_registrations')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => (int) $event->id,
            'user_id' => (int) $this->attendee->id,
            'capacity_pool_key' => 'event',
            'registration_state' => 'confirmed',
            'registration_version' => 1,
            'state_changed_at' => now(),
            'state_changed_by' => (int) $this->organiser->id,
            'confirmed_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_undoing_a_check_in_reverses_the_reward_and_a_re_check_in_pays_again(): void
    {
        $checkIn = $this->move(EventAttendanceAction::CheckIn, 0, 'f588-checkin-1');
        self::assertSame('settled', $checkIn->creditStatus);
        self::assertSame(1.0, $this->balance());

        $undo = $this->move(EventAttendanceAction::Undo, $this->version($checkIn), 'f588-undo-1', 'Scanned the wrong member');
        self::assertSame('reversed', $undo->creditStatus);
        self::assertSame(0.0, $this->balance(), 'The undone check-in must not stay paid.');
        $original = $this->claim(EventCreditService::CLAIM_TYPE);
        self::assertSame('reversed', $original->status);
        self::assertSame('attendance_undone', $original->reversal_code);
        self::assertSame('completed', $this->claim(EventCreditService::REVERSAL_CLAIM_TYPE)->status);

        // A genuine re-check-in is real attendance and pays again.
        $again = $this->move(EventAttendanceAction::CheckIn, $this->version($undo), 'f588-checkin-2');
        self::assertSame('settled', $again->creditStatus);
        self::assertSame(1.0, $this->balance());
        self::assertSame('completed', $this->claim(EventCreditService::CLAIM_TYPE)->status);

        // And the cycle repeats cleanly: a second mis-scan reverses again.
        $undoAgain = $this->move(EventAttendanceAction::Undo, $this->version($again), 'f588-undo-2', 'Scanned twice');
        self::assertSame('reversed', $undoAgain->creditStatus);
        self::assertSame(0.0, $this->balance());

        // The money ledger agrees with the balance: two mints, two reversals.
        self::assertSame(2, $this->ledgerCount(EventCreditService::TRANSACTION_TYPE));
        self::assertSame(2, $this->ledgerCount(EventCreditService::REVERSAL_TRANSACTION_TYPE));
        self::assertSame(1, DB::table('event_attendance_credit_claims')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', (int) $this->event->id)
            ->where('claim_type', EventCreditService::REVERSAL_CLAIM_TYPE)
            ->count());
    }

    public function test_a_replayed_undo_does_not_reverse_twice(): void
    {
        $checkIn = $this->move(EventAttendanceAction::CheckIn, 0, 'f588-replay-checkin');
        $version = $this->version($checkIn);
        $this->move(EventAttendanceAction::Undo, $version, 'f588-replay-undo', 'Wrong member');
        $replay = $this->move(EventAttendanceAction::Undo, $version, 'f588-replay-undo', 'Wrong member');

        self::assertTrue($replay->replayed);
        self::assertSame(0.0, $this->balance());
        self::assertSame(1, $this->ledgerCount(EventCreditService::REVERSAL_TRANSACTION_TYPE));
    }

    public function test_undoing_a_check_out_keeps_the_reward(): void
    {
        $checkIn = $this->move(EventAttendanceAction::CheckIn, 0, 'f588-out-checkin');
        $checkOut = $this->move(EventAttendanceAction::CheckOut, $this->version($checkIn), 'f588-out-checkout');
        $undo = $this->move(EventAttendanceAction::Undo, $this->version($checkOut), 'f588-out-undo', 'Left early by mistake');

        self::assertNull($undo->creditStatus);
        self::assertSame(1.0, $this->balance(), 'Still checked in, so still paid.');
        self::assertSame('completed', $this->claim(EventCreditService::CLAIM_TYPE)->status);
    }

    public function test_an_admin_reversal_is_not_undone_by_a_re_check_in(): void
    {
        $checkIn = $this->move(EventAttendanceAction::CheckIn, 0, 'f588-admin-checkin');
        $claimId = (int) $this->claim(EventCreditService::CLAIM_TYPE)->id;
        self::assertSame('reversed', app(EventCreditService::class)->reverseClaim(
            $this->testTenantId,
            $claimId,
            (int) $this->organiser->id,
            'Not eligible for this reward',
        )['status']);

        $undo = $this->move(EventAttendanceAction::Undo, $this->version($checkIn), 'f588-admin-undo', 'Wrong member');
        self::assertSame('no_reward', $undo->creditStatus);
        $again = $this->move(EventAttendanceAction::CheckIn, $this->version($undo), 'f588-admin-checkin-2');

        // The admin's decision stands: no reward is minted around it.
        self::assertSame('already_settled', $again->creditStatus);
        self::assertSame(0.0, $this->balance());
        self::assertSame(1, $this->ledgerCount(EventCreditService::TRANSACTION_TYPE));
    }

    public function test_a_failed_reversal_keeps_the_undo_and_says_so(): void
    {
        $checkIn = $this->move(EventAttendanceAction::CheckIn, 0, 'f588-fail-checkin');
        $realWallet = app(WalletService::class);
        app()->instance(WalletService::class, new class (new Transaction(), new User()) extends WalletService {
            public function reclaimFromMember(
                int $tenantId,
                int $memberId,
                float $amount,
                string $transactionType,
                string $description,
            ): int {
                throw new \RuntimeException('ledger refused');
            }
        });

        $undo = $this->move(EventAttendanceAction::Undo, $this->version($checkIn), 'f588-fail-undo', 'Wrong member');

        self::assertSame('reverse_failed', $undo->creditStatus);
        self::assertSame('not_checked_in', $undo->toState->value);
        self::assertSame(1.0, $this->balance(), 'No money moved, and the claim says it is still paid.');
        self::assertSame('completed', $this->claim(EventCreditService::CLAIM_TYPE)->status);
        $child = $this->claim(EventCreditService::REVERSAL_CLAIM_TYPE);
        self::assertSame('failed', $child->status);
        self::assertSame('reclaim_failed', $child->failure_code);

        // The admin reverse action can finish the job once the ledger recovers.
        app()->instance(WalletService::class, $realWallet);
        self::assertSame('reversed', app(EventCreditService::class)->reverseClaim(
            $this->testTenantId,
            (int) $this->claim(EventCreditService::CLAIM_TYPE)->id,
            (int) $this->organiser->id,
            'Finish the undo reversal',
        )['status']);
        self::assertSame(0.0, $this->balance());
    }

    private function move(
        EventAttendanceAction $action,
        int $expectedVersion,
        string $key,
        ?string $reason = null,
    ): EventAttendanceTransitionResult {
        return app(EventAttendanceService::class)->transition(
            (int) $this->event->id,
            (int) $this->attendee->id,
            $action,
            $this->organiser,
            $expectedVersion,
            $reason,
            $key,
        );
    }

    private function version(EventAttendanceTransitionResult $result): int
    {
        return (int) $result->toArray()['attendance_version'];
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'balance' => 0,
        ]);
    }

    private function balance(): float
    {
        return (float) DB::table('users')->where('id', $this->attendee->id)->value('balance');
    }

    private function claim(string $type): object
    {
        $claim = DB::table('event_attendance_credit_claims')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', (int) $this->event->id)
            ->where('user_id', (int) $this->attendee->id)
            ->where('claim_type', $type)
            ->first();
        self::assertNotNull($claim, "no {$type} claim");

        return $claim;
    }

    private function ledgerCount(string $transactionType): int
    {
        return DB::table('transactions')
            ->where('tenant_id', $this->testTenantId)
            ->where('transaction_type', $transactionType)
            ->where(function ($q): void {
                $q->where('receiver_id', (int) $this->attendee->id)
                    ->orWhere('sender_id', (int) $this->attendee->id);
            })
            ->count();
    }
}
