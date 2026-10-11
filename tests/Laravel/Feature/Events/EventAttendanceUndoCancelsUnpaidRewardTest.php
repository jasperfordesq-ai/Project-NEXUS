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
 * E-102 follow-up to F-588 — an attendance reward that FAILED to pay (wallet
 * outage, monthly cap) was left `failed` when its check-in was undone, so an
 * administrator pressing "retry" later still paid a member whose attendance
 * had been undone. Undo now cancels the unpaid claim, retry refuses a claim
 * whose attendance is no longer present, and a genuine re-check-in still pays
 * exactly once.
 */
final class EventAttendanceUndoCancelsUnpaidRewardTest extends TestCase
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
            'title' => 'Unpaid Reward Fair',
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

    public function test_undo_cancels_a_failed_reward_so_an_admin_retry_pays_nothing(): void
    {
        $checkIn = $this->checkInWithWalletDown('unpaid-checkin-1');
        self::assertSame('deferred_failed', $checkIn->creditStatus);
        self::assertSame('failed', $this->claim()->status);

        $undo = $this->move(EventAttendanceAction::Undo, $this->version($checkIn), 'unpaid-undo-1', 'Scanned the wrong member');
        self::assertSame('not_checked_in', $undo->toState->value);
        self::assertNotSame('failed', $this->claim()->status, 'An undone check-in must not leave a payable claim.');

        $retry = app(EventCreditService::class)->retryClaim($this->testTenantId, (int) $this->claim()->id);

        self::assertSame('not_retryable', $retry['status']);
        self::assertSame(0.0, $this->balance());
        self::assertSame(0, $this->ledgerCount(EventCreditService::TRANSACTION_TYPE));
    }

    public function test_a_re_check_in_after_the_cancelled_reward_pays_once(): void
    {
        $checkIn = $this->checkInWithWalletDown('unpaid-recheck-1');
        $undo = $this->move(EventAttendanceAction::Undo, $this->version($checkIn), 'unpaid-recheck-undo', 'Wrong member');
        app(EventCreditService::class)->retryClaim($this->testTenantId, (int) $this->claim()->id);

        $again = $this->move(EventAttendanceAction::CheckIn, $this->version($undo), 'unpaid-recheck-2');

        self::assertSame('settled', $again->creditStatus);
        self::assertSame(1.0, $this->balance());
        self::assertSame('completed', $this->claim()->status);
        self::assertSame(1, $this->ledgerCount(EventCreditService::TRANSACTION_TYPE));
        // The reward was never paid before, so its XP is recorded now.
        self::assertSame(1, DB::table('user_xp_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', (int) $this->attendee->id)
            ->where('action', 'event_attendance_verified')
            ->count());
    }

    public function test_retry_refuses_a_failed_claim_whose_attendance_is_no_longer_present(): void
    {
        $checkIn = $this->checkInWithWalletDown('unpaid-belt-1');
        // Simulate a claim left `failed` while the attendance was undone by a
        // path that did not cancel it (data from before this fix).
        DB::table('event_attendance')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', (int) $this->event->id)
            ->where('user_id', (int) $this->attendee->id)
            ->update(['attendance_status' => 'not_checked_in', 'checked_in_at' => null]);
        self::assertSame('failed', $this->claim()->status);

        $retry = app(EventCreditService::class)->retryClaim($this->testTenantId, (int) $this->claim()->id);

        self::assertSame('not_retryable', $retry['status']);
        self::assertSame('failed', $this->claim()->status);
        self::assertSame(0.0, $this->balance());
        self::assertNotNull($checkIn);
    }

    public function test_retry_still_pays_a_failed_claim_for_a_member_who_is_checked_in(): void
    {
        $this->checkInWithWalletDown('unpaid-present-1');

        $retry = app(EventCreditService::class)->retryClaim($this->testTenantId, (int) $this->claim()->id);

        self::assertSame('settled', $retry['status']);
        self::assertSame(1.0, $this->balance());
    }

    private function checkInWithWalletDown(string $key): EventAttendanceTransitionResult
    {
        $realWallet = app(WalletService::class);
        app()->instance(WalletService::class, new class (new Transaction(), new User()) extends WalletService {
            public function mintToMember(
                int $tenantId,
                int $recipientId,
                float $amount,
                string $transactionType,
                string $description,
            ): int {
                throw new \RuntimeException('wallet down');
            }
        });
        app()->forgetInstance(EventCreditService::class);
        app()->forgetInstance(EventAttendanceService::class);

        try {
            return $this->move(EventAttendanceAction::CheckIn, 0, $key);
        } finally {
            app()->instance(WalletService::class, $realWallet);
            app()->forgetInstance(EventCreditService::class);
            app()->forgetInstance(EventAttendanceService::class);
        }
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

    private function claim(): object
    {
        $claim = DB::table('event_attendance_credit_claims')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', (int) $this->event->id)
            ->where('user_id', (int) $this->attendee->id)
            ->where('claim_type', EventCreditService::CLAIM_TYPE)
            ->first();
        self::assertNotNull($claim, 'no reward claim');

        return $claim;
    }

    private function ledgerCount(string $transactionType): int
    {
        return DB::table('transactions')
            ->where('tenant_id', $this->testTenantId)
            ->where('transaction_type', $transactionType)
            ->where('receiver_id', (int) $this->attendee->id)
            ->count();
    }
}
