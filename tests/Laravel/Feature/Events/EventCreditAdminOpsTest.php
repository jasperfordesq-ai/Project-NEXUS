<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Models\Event;
use App\Models\EventAttendance;
use App\Models\User;
use App\Services\EventCreditService;
use App\Services\WalletService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Admin operations over the reward ledger: monthly cap, retry, reversal, and
 * the failed-claim resume path.
 *
 * The scenarios here are the ones the treasury suite deliberately leaves to the
 * admin surface — what happens AFTER a mint failed, and how a community budget
 * bounds the treasury's exposure. Two behaviours matter more than the rest:
 *
 *  - A failed claim must never be a dead end. Before the resume path existed, a
 *    wallet outage during check-in permanently blocked the member's reward: the
 *    ledger's unique key made every later settle report `already_settled`.
 *  - A reversal that fails to move money must leave the original claim reading
 *    as PAID — the ledger may never claim credits were reclaimed when they
 *    were not.
 */
class EventCreditAdminOpsTest extends TestCase
{
    use DatabaseTransactions;

    private function setFeature(bool $enabled): void
    {
        $row = DB::table('tenants')->where('id', $this->testTenantId)->first();
        $features = [];
        if ($row && ! empty($row->features)) {
            $decoded = is_string($row->features) ? json_decode($row->features, true) : $row->features;
            if (is_array($decoded)) {
                $features = $decoded;
            }
        }
        $features['events'] = true;
        $features['event_attendance_credits'] = $enabled;

        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);
    }

    /** Write the tenant's monthly cap the way the admin config endpoint does. */
    private function setMonthlyCap(?float $cap): void
    {
        $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('configuration');
        $root = is_string($raw) ? (json_decode($raw, true) ?: []) : (is_array($raw) ? $raw : []);
        $events = is_array($root['events'] ?? null) ? $root['events'] : [];

        if ($cap === null) {
            unset($events['attendance_credit_monthly_cap']);
        } else {
            $events['attendance_credit_monthly_cap'] = $cap;
        }

        $root['events'] = $events;
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'configuration' => json_encode($root),
        ]);
    }

    private function member(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'balance' => 0,
        ], $overrides));
    }

    private function event(User $organiser, ?float $reward): Event
    {
        $event = new Event([
            'user_id' => $organiser->id,
            'title' => 'Wassail',
            'start_time' => now()->subHour(),
            'end_time' => now()->addHour(),
        ]);
        $event->tenant_id = $this->testTenantId;
        $event->status = 'active';
        $event->attendance_credit_amount = $reward;
        $event->save();

        return $event;
    }

    private function attendance(Event $event, User $attendee): EventAttendance
    {
        $existing = EventAttendance::withoutGlobalScopes()
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', (int) $event->id)
            ->where('user_id', (int) $attendee->id)
            ->first();

        if ($existing !== null) {
            return $existing;
        }

        $id = (int) DB::table('event_attendance')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'event_id' => (int) $event->id,
            'user_id' => (int) $attendee->id,
            'attendance_status' => 'checked_in',
            'attendance_version' => 1,
            'checked_in_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return EventAttendance::withoutGlobalScopes()->findOrFail($id);
    }

    private function settle(Event $event, User $attendee, User $actor): array
    {
        return app(EventCreditService::class)->settleAttendance(
            $event,
            $this->attendance($event, $attendee),
            $attendee,
            $actor,
        );
    }

    private function balanceOf(User $user): float
    {
        return (float) DB::table('users')->where('id', $user->id)->value('balance');
    }

    private function bindThrowingMint(): void
    {
        $this->app->bind(WalletService::class, function () {
            return new class extends WalletService {
                public function __construct() {}

                public function mintToMember(
                    int $tenantId,
                    int $recipientId,
                    float $amount,
                    string $transactionType,
                    string $description,
                ): int {
                    throw new \RuntimeException('wallet unavailable');
                }
            };
        });
    }

    private function bindThrowingReclaim(): void
    {
        $this->app->bind(WalletService::class, function () {
            return new class extends WalletService {
                public function __construct() {}

                public function reclaimFromMember(
                    int $tenantId,
                    int $memberId,
                    float $amount,
                    string $transactionType,
                    string $description,
                ): int {
                    throw new \RuntimeException('wallet unavailable');
                }
            };
        });
    }

    private function restoreRealWallet(WalletService $real): void
    {
        $this->app->bind(WalletService::class, static fn () => $real);
    }

    // ── Monthly cap ─────────────────────────────────────────────────────

    public function test_the_monthly_cap_blocks_minting_beyond_the_budget(): void
    {
        config(['events.attendance_credit_mode' => 'treasury']);
        $this->setFeature(true);
        $this->setMonthlyCap(1.5);

        $organiser = $this->member();
        $first = $this->member();
        $second = $this->member();
        $event = $this->event($organiser, 1.0);

        $this->assertSame('settled', $this->settle($event, $first, $organiser)['status']);

        // 1.0 spent of 1.5 — the next 1.0 reward would overshoot.
        $result = $this->settle($event, $second, $organiser);

        $this->assertSame('deferred_failed', $result['status']);
        $this->assertContains($result['status'], EventCreditService::SETTLED_STATUSES, 'Cap blocking must never abort a check-in.');
        $this->assertSame(0.0, $this->balanceOf($second));

        $claim = DB::table('event_attendance_credit_claims')->where('id', $result['claim_id'])->first();
        $this->assertSame('failed', $claim->status);
        $this->assertSame('monthly_cap_reached', $claim->failure_code);
    }

    public function test_no_cap_means_uncapped(): void
    {
        config(['events.attendance_credit_mode' => 'treasury']);
        $this->setFeature(true);
        $this->setMonthlyCap(null);

        $organiser = $this->member();
        $attendee = $this->member();
        $event = $this->event($organiser, 2.0);

        $this->assertSame('settled', $this->settle($event, $attendee, $organiser)['status']);
        $this->assertSame(2.0, $this->balanceOf($attendee));
    }

    public function test_a_reversal_frees_monthly_cap_budget(): void
    {
        config(['events.attendance_credit_mode' => 'treasury']);
        $this->setFeature(true);
        $this->setMonthlyCap(1.0);

        $organiser = $this->member();
        $admin = $this->member(['role' => 'admin']);
        $first = $this->member();
        $second = $this->member();
        $event = $this->event($organiser, 1.0);

        $paid = $this->settle($event, $first, $organiser);
        $this->assertSame('settled', $paid['status']);

        $blocked = $this->settle($event, $second, $organiser);
        $this->assertSame('deferred_failed', $blocked['status']);

        // Reversing the paid claim returns its amount to the budget…
        $reversal = app(EventCreditService::class)->reverseClaim(
            $this->testTenantId,
            (int) $paid['claim_id'],
            (int) $admin->id,
            'Paid in error',
        );
        $this->assertSame('reversed', $reversal['status']);

        // …so the blocked claim is now retryable within the cap.
        $retried = app(EventCreditService::class)->retryClaim($this->testTenantId, (int) $blocked['claim_id']);
        $this->assertSame('settled', $retried['status']);
        $this->assertSame(1.0, $this->balanceOf($second));
    }

    // ── Failed-claim resume (the dead-end bug) ──────────────────────────

    public function test_a_later_checkin_resumes_a_failed_claim_instead_of_reporting_it_paid(): void
    {
        config(['events.attendance_credit_mode' => 'treasury']);
        $this->setFeature(true);

        $organiser = $this->member();
        $attendee = $this->member();
        $event = $this->event($organiser, 1.0);

        $real = app(WalletService::class);
        $this->bindThrowingMint();

        $failed = $this->settle($event, $attendee, $organiser);
        $this->assertSame('deferred_failed', $failed['status']);
        $this->assertSame(0.0, $this->balanceOf($attendee));

        $this->restoreRealWallet($real);

        // Before the resume path, this reported `already_settled` and the
        // member could never be paid for this event again.
        $resumed = $this->settle($event, $attendee, $organiser);

        $this->assertSame('settled', $resumed['status']);
        $this->assertSame(1.0, $this->balanceOf($attendee));
        $this->assertSame(
            1,
            DB::table('event_attendance_credit_claims')
                ->where('event_id', $event->id)
                ->where('user_id', $attendee->id)
                ->count(),
            'Resume must reuse the existing claim row, not create a second one.',
        );

        // And a THIRD settle is plain idempotent again.
        $this->assertSame('already_settled', $this->settle($event, $attendee, $organiser)['status']);
        $this->assertSame(1.0, $this->balanceOf($attendee));
    }

    // ── Admin retry ─────────────────────────────────────────────────────

    public function test_retry_pays_a_failed_claim_exactly_once(): void
    {
        config(['events.attendance_credit_mode' => 'treasury']);
        $this->setFeature(true);

        $organiser = $this->member();
        $attendee = $this->member();
        $event = $this->event($organiser, 1.0);

        $real = app(WalletService::class);
        $this->bindThrowingMint();
        $failed = $this->settle($event, $attendee, $organiser);
        $this->assertSame('deferred_failed', $failed['status']);
        $this->restoreRealWallet($real);

        $result = app(EventCreditService::class)->retryClaim($this->testTenantId, (int) $failed['claim_id']);

        $this->assertSame('settled', $result['status']);
        $this->assertSame(1.0, $this->balanceOf($attendee));

        // A second retry finds the claim completed.
        $again = app(EventCreditService::class)->retryClaim($this->testTenantId, (int) $failed['claim_id']);
        $this->assertSame('not_retryable', $again['status']);
        $this->assertSame(1.0, $this->balanceOf($attendee));
    }

    public function test_retry_refuses_completed_claims_and_unknown_ids(): void
    {
        config(['events.attendance_credit_mode' => 'treasury']);
        $this->setFeature(true);

        $organiser = $this->member();
        $attendee = $this->member();
        $event = $this->event($organiser, 1.0);

        $paid = $this->settle($event, $attendee, $organiser);
        $this->assertSame('settled', $paid['status']);

        $this->assertSame(
            'not_retryable',
            app(EventCreditService::class)->retryClaim($this->testTenantId, (int) $paid['claim_id'])['status'],
        );
        $this->assertSame(
            'not_found',
            app(EventCreditService::class)->retryClaim($this->testTenantId, 999999999)['status'],
        );
        // Wrong tenant cannot see the claim at all.
        $this->assertSame(
            'not_found',
            app(EventCreditService::class)->retryClaim($this->testTenantId + 1, (int) $paid['claim_id'])['status'],
        );
    }

    // ── Admin reversal ──────────────────────────────────────────────────

    public function test_reversal_reclaims_the_credit_and_is_single_use(): void
    {
        config(['events.attendance_credit_mode' => 'treasury']);
        $this->setFeature(true);

        $organiser = $this->member();
        $admin = $this->member(['role' => 'admin']);
        $attendee = $this->member();
        $event = $this->event($organiser, 1.5);

        $paid = $this->settle($event, $attendee, $organiser);
        $this->assertSame('settled', $paid['status']);
        $this->assertSame(1.5, $this->balanceOf($attendee));

        $result = app(EventCreditService::class)->reverseClaim(
            $this->testTenantId,
            (int) $paid['claim_id'],
            (int) $admin->id,
            'Checked in by mistake',
        );

        $this->assertSame('reversed', $result['status']);
        $this->assertSame(0.0, $this->balanceOf($attendee));

        $original = DB::table('event_attendance_credit_claims')->where('id', $paid['claim_id'])->first();
        $this->assertSame('reversed', $original->status);
        $this->assertSame('admin_reversal', $original->reversal_code);
        $this->assertNotNull($original->reversed_at);

        $child = DB::table('event_attendance_credit_claims')->where('id', $result['claim_id'])->first();
        $this->assertSame(EventCreditService::REVERSAL_CLAIM_TYPE, $child->claim_type);
        $this->assertSame((int) $paid['claim_id'], (int) $child->parent_claim_id);
        $this->assertSame('completed', $child->status);
        $this->assertNotNull($child->transaction_id);

        // The reversal transaction flows member → community.
        $txn = DB::table('transactions')->where('id', $child->transaction_id)->first();
        $this->assertSame((int) $attendee->id, (int) $txn->sender_id);
        $this->assertNull($txn->receiver_id);
        $this->assertSame(EventCreditService::REVERSAL_TRANSACTION_TYPE, $txn->transaction_type);

        // Single use.
        $again = app(EventCreditService::class)->reverseClaim(
            $this->testTenantId,
            (int) $paid['claim_id'],
            (int) $admin->id,
            'Twice',
        );
        $this->assertSame('not_reversible', $again['status']);
        $this->assertSame(0.0, $this->balanceOf($attendee));
    }

    public function test_a_failed_reclaim_leaves_the_original_claim_reading_as_paid(): void
    {
        config(['events.attendance_credit_mode' => 'treasury']);
        $this->setFeature(true);

        $organiser = $this->member();
        $admin = $this->member(['role' => 'admin']);
        $attendee = $this->member();
        $event = $this->event($organiser, 1.0);

        $paid = $this->settle($event, $attendee, $organiser);
        $this->assertSame('settled', $paid['status']);

        $real = app(WalletService::class);
        $this->bindThrowingReclaim();

        $result = app(EventCreditService::class)->reverseClaim(
            $this->testTenantId,
            (int) $paid['claim_id'],
            (int) $admin->id,
            'Reverse during outage',
        );

        $this->assertSame('reverse_failed', $result['status']);
        $this->assertSame(1.0, $this->balanceOf($attendee), 'No money moved, so the balance must be untouched.');

        // 🔴 The original must read as PAID again — a ledger that says
        // "reversed" while the member still holds the credits is lying.
        $original = DB::table('event_attendance_credit_claims')->where('id', $paid['claim_id'])->first();
        $this->assertSame('completed', $original->status);
        $this->assertNull($original->reversed_at);

        $child = DB::table('event_attendance_credit_claims')->where('id', $result['claim_id'])->first();
        $this->assertSame('failed', $child->status);
        $this->assertSame('reclaim_failed', $child->failure_code);

        // Once the wallet recovers, the same reversal succeeds by resuming the
        // failed child claim rather than colliding on its unique key.
        $this->restoreRealWallet($real);

        $retryReversal = app(EventCreditService::class)->reverseClaim(
            $this->testTenantId,
            (int) $paid['claim_id'],
            (int) $admin->id,
            'Reverse after recovery',
        );

        $this->assertSame('reversed', $retryReversal['status']);
        $this->assertSame(0.0, $this->balanceOf($attendee));
        $this->assertSame(
            1,
            DB::table('event_attendance_credit_claims')
                ->where('parent_claim_id', $paid['claim_id'])
                ->count(),
            'The retried reversal must reuse the failed child claim.',
        );
    }

    // ── HTTP surface ────────────────────────────────────────────────────

    public function test_the_claims_ledger_requires_an_admin(): void
    {
        config(['events.attendance_credit_mode' => 'treasury']);
        $this->setFeature(true);

        $member = $this->member();
        $this->actingAs($member);

        $this->apiGet('/v2/admin/events/attendance-claims')->assertStatus(403);
    }

    public function test_the_claims_ledger_lists_and_filters_claims(): void
    {
        config(['events.attendance_credit_mode' => 'treasury']);
        $this->setFeature(true);

        $organiser = $this->member();
        $admin = $this->member(['role' => 'admin']);
        $attendee = $this->member();
        $event = $this->event($organiser, 1.0);

        $paid = $this->settle($event, $attendee, $organiser);
        $this->assertSame('settled', $paid['status']);

        $this->actingAs($admin);

        $response = $this->apiGet('/v2/admin/events/attendance-claims?status=completed');
        $response->assertStatus(200);

        $claims = $response->json('data.claims');
        $ids = array_column($claims, 'id');
        $this->assertContains((int) $paid['claim_id'], $ids);

        $row = collect($claims)->firstWhere('id', (int) $paid['claim_id']);
        $this->assertSame('Wassail', $row['event_title']);
        $this->assertSame('completed', $row['status']);
        $this->assertSame(1.0, (float) $row['amount']);
        $this->assertNotNull($row['member_name']);

        // Filtering by a different status excludes it.
        $failedOnly = $this->apiGet('/v2/admin/events/attendance-claims?status=failed');
        $failedOnly->assertStatus(200);
        $this->assertNotContains(
            (int) $paid['claim_id'],
            array_column($failedOnly->json('data.claims'), 'id'),
        );
    }

    public function test_the_retry_and_reverse_endpoints_drive_the_service(): void
    {
        config(['events.attendance_credit_mode' => 'treasury']);
        $this->setFeature(true);

        $organiser = $this->member();
        $admin = $this->member(['role' => 'admin']);
        $attendee = $this->member();
        $event = $this->event($organiser, 1.0);

        $real = app(WalletService::class);
        $this->bindThrowingMint();
        $failed = $this->settle($event, $attendee, $organiser);
        $this->assertSame('deferred_failed', $failed['status']);
        $this->restoreRealWallet($real);

        $this->actingAs($admin);

        // Reason is required for a reversal.
        $this->apiPost('/v2/admin/events/attendance-claims/' . $failed['claim_id'] . '/reverse', [])
            ->assertStatus(422);

        // Retry an unknown claim → 404; a failed claim → paid.
        $this->apiPost('/v2/admin/events/attendance-claims/999999999/retry')->assertStatus(404);

        $retry = $this->apiPost('/v2/admin/events/attendance-claims/' . $failed['claim_id'] . '/retry');
        $retry->assertStatus(200);
        $this->assertSame('settled', $retry->json('data.status'));
        $this->assertSame(1.0, $this->balanceOf($attendee));

        // Retrying the now-completed claim conflicts.
        $this->apiPost('/v2/admin/events/attendance-claims/' . $failed['claim_id'] . '/retry')
            ->assertStatus(409);

        // Reverse it, with a reason.
        $reverse = $this->apiPost(
            '/v2/admin/events/attendance-claims/' . $failed['claim_id'] . '/reverse',
            ['reason' => 'Recorded against the wrong member'],
        );
        $reverse->assertStatus(200);
        $this->assertSame('reversed', $reverse->json('data.status'));
        $this->assertSame(0.0, $this->balanceOf($attendee));
    }

    public function test_gating_split_between_minting_and_correction_paths(): void
    {
        config(['events.attendance_credit_mode' => 'treasury']);
        $this->setFeature(false);

        $admin = $this->member(['role' => 'admin']);
        $this->actingAs($admin);

        // Retry MINTS → stays behind the tenant flag.
        $this->apiPost('/v2/admin/events/attendance-claims/1/retry')->assertStatus(403);

        // The audit ledger and the reversal path deliberately survive the flag
        // being off — that is the incident state in which they are needed.
        // (Full behavioural coverage in EventCreditHardeningTest.)
        $this->apiGet('/v2/admin/events/attendance-claims')->assertStatus(200);
    }
}
