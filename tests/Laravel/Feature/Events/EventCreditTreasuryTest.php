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
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Attendance rewards: the community mint.
 *
 * This is the only path in the platform that CREATES time credits from an event,
 * so the tests are written around the ways it could go wrong with money rather
 * than around the happy path:
 *
 *  - THREE switches must all be on. Each one alone must grant nothing, because
 *    the whole point of the fail-closed design is that no single
 *    misconfiguration starts moving credits.
 *  - Exactly one credit per member per event, guaranteed by the claim ledger's
 *    unique key rather than by a prior read, so a re-check-in cannot double-pay.
 *  - A mint failure must never cost the member their check-in.
 *  - An unrecognised writer status must still abort — that is the interlock the
 *    allow-set replaced, and loosening it too far is the risk of this change.
 */
class EventCreditTreasuryTest extends TestCase
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
            'title' => 'Song and Soils',
            'start_time' => now()->subHour(),
            'end_time' => now()->addHour(),
        ]);
        $event->tenant_id = $this->testTenantId;
        $event->status = 'active';
        // attendance_credit_amount is not fillable on purpose — it is a funding
        // decision written by the admin endpoint, not event content.
        $event->attendance_credit_amount = $reward;
        $event->save();

        return $event;
    }

    /**
     * The attendance row for this member, created once.
     *
     * Idempotent on purpose: a re-settlement (the double-pay scenario) happens
     * against the SAME attendance row, so a helper that inserted a fresh one
     * each call would collide on event_attendance's own unique key and never
     * reach the ledger check that is actually under test.
     */
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

    // ── The three switches ──────────────────────────────────────────────

    public function test_mode_off_grants_nothing_and_reports_disabled(): void
    {
        config(['events.attendance_credit_mode' => 'off']);
        $this->setFeature(true);

        $organiser = $this->member();
        $attendee = $this->member();
        $event = $this->event($organiser, 1.0);

        $result = $this->settle($event, $attendee, $organiser);

        $this->assertSame('disabled', $result['status']);
        $this->assertSame(0.0, $this->balanceOf($attendee));
        $this->assertSame(0, DB::table('event_attendance_credit_claims')->where('event_id', $event->id)->count());
    }

    public function test_an_unknown_mode_still_fails_closed(): void
    {
        config(['events.attendance_credit_mode' => 'organiser_pays']);
        $this->setFeature(true);

        $organiser = $this->member();
        $attendee = $this->member();
        $event = $this->event($organiser, 1.0);

        $result = $this->settle($event, $attendee, $organiser);

        $this->assertSame('disabled', $result['status'], 'An unreviewed mode must never mint.');
        $this->assertSame(0.0, $this->balanceOf($attendee));
    }

    public function test_feature_flag_off_grants_nothing(): void
    {
        config(['events.attendance_credit_mode' => 'treasury']);
        $this->setFeature(false);

        $organiser = $this->member();
        $attendee = $this->member();
        $event = $this->event($organiser, 1.0);

        $result = $this->settle($event, $attendee, $organiser);

        $this->assertSame('skipped', $result['status']);
        $this->assertSame(0.0, $this->balanceOf($attendee));
        $this->assertSame(0, DB::table('event_attendance_credit_claims')->where('event_id', $event->id)->count());
    }

    public function test_an_event_with_no_configured_amount_grants_nothing(): void
    {
        config(['events.attendance_credit_mode' => 'treasury']);
        $this->setFeature(true);

        $organiser = $this->member();
        $attendee = $this->member();
        $event = $this->event($organiser, null);

        $result = $this->settle($event, $attendee, $organiser);

        $this->assertSame('skipped', $result['status']);
        $this->assertSame(0.0, $this->balanceOf($attendee));
    }

    // ── The mint ────────────────────────────────────────────────────────

    public function test_all_three_switches_on_mints_exactly_once(): void
    {
        config(['events.attendance_credit_mode' => 'treasury']);
        $this->setFeature(true);

        $organiser = $this->member();
        $attendee = $this->member();
        $event = $this->event($organiser, 1.0);

        $result = $this->settle($event, $attendee, $organiser);

        $this->assertSame('settled', $result['status']);
        $this->assertNotNull($result['claim_id']);
        $this->assertNotNull($result['transaction_id']);
        $this->assertSame(1.0, $this->balanceOf($attendee));

        $claim = DB::table('event_attendance_credit_claims')->where('id', $result['claim_id'])->first();
        $this->assertSame('completed', $claim->status);
        $this->assertSame('tenant_treasury', $claim->funding_source_type);
        $this->assertNull($claim->payer_user_id, 'Nobody is debited — the community funds the reward.');
        $this->assertSame((int) $attendee->id, (int) $claim->payee_user_id);
        $this->assertSame((int) $result['transaction_id'], (int) $claim->transaction_id);

        $txn = DB::table('transactions')->where('id', $result['transaction_id'])->first();
        $this->assertNull($txn->sender_id, 'A mint has no sender.');
        $this->assertSame((int) $attendee->id, (int) $txn->receiver_id);
        $this->assertSame('event_attendance_reward', $txn->transaction_type);
    }

    public function test_a_second_settlement_for_the_same_member_does_not_pay_twice(): void
    {
        config(['events.attendance_credit_mode' => 'treasury']);
        $this->setFeature(true);

        $organiser = $this->member();
        $attendee = $this->member();
        $event = $this->event($organiser, 1.0);

        $first = $this->settle($event, $attendee, $organiser);
        $second = $this->settle($event, $attendee, $organiser);

        $this->assertSame('settled', $first['status']);
        $this->assertSame('already_settled', $second['status']);
        $this->assertSame(1.0, $this->balanceOf($attendee), 'The ledger unique key is the guarantee against double payment.');
        $this->assertSame(
            1,
            DB::table('event_attendance_credit_claims')
                ->where('tenant_id', $this->testTenantId)
                ->where('event_id', $event->id)
                ->where('user_id', $attendee->id)
                ->count(),
        );
    }

    public function test_the_amount_is_clamped_to_the_community_ceiling(): void
    {
        config([
            'events.attendance_credit_mode' => 'treasury',
            'events.attendance_credit_max' => 2.0,
        ]);
        $this->setFeature(true);

        $organiser = $this->member();
        $attendee = $this->member();
        // A stale, over-ceiling amount left on an existing event.
        $event = $this->event($organiser, 50.0);

        $result = $this->settle($event, $attendee, $organiser);

        $this->assertSame('settled', $result['status']);
        $this->assertSame(2.0, $this->balanceOf($attendee), 'Clamped, not rejected — and never above the ceiling.');
    }

    public function test_fractional_rewards_are_supported(): void
    {
        config(['events.attendance_credit_mode' => 'treasury']);
        $this->setFeature(true);

        $organiser = $this->member();
        $attendee = $this->member();
        $event = $this->event($organiser, 0.5);

        $this->assertSame('settled', $this->settle($event, $attendee, $organiser)['status']);
        $this->assertSame(0.5, $this->balanceOf($attendee));
    }

    public function test_an_organiser_cannot_reward_themselves(): void
    {
        config(['events.attendance_credit_mode' => 'treasury']);
        $this->setFeature(true);

        $organiser = $this->member();
        $event = $this->event($organiser, 1.0);

        // Actor and attendee are the same person.
        $result = $this->settle($event, $organiser, $organiser);

        $this->assertSame('skipped', $result['status']);
        $this->assertSame(0.0, $this->balanceOf($organiser));
    }

    public function test_two_attendees_are_each_rewarded_once(): void
    {
        config(['events.attendance_credit_mode' => 'treasury']);
        $this->setFeature(true);

        $organiser = $this->member();
        $first = $this->member();
        $second = $this->member();
        $event = $this->event($organiser, 1.0);

        $this->assertSame('settled', $this->settle($event, $first, $organiser)['status']);
        $this->assertSame('settled', $this->settle($event, $second, $organiser)['status']);

        $this->assertSame(1.0, $this->balanceOf($first));
        $this->assertSame(1.0, $this->balanceOf($second));
    }

    // ── Engagement wiring ───────────────────────────────────────────────

    public function test_a_settled_reward_records_verified_attendance_engagement(): void
    {
        config(['events.attendance_credit_mode' => 'treasury']);
        $this->setFeature(true);

        $organiser = $this->member();
        $attendee = $this->member();
        $event = $this->event($organiser, 1.0);

        $this->settle($event, $attendee, $organiser);

        $this->assertDatabaseHas('user_xp_log', [
            'user_id' => $attendee->id,
            'action' => 'event_attendance_verified',
        ]);
    }

    public function test_no_engagement_is_recorded_when_nothing_is_granted(): void
    {
        config(['events.attendance_credit_mode' => 'off']);
        $this->setFeature(true);

        $organiser = $this->member();
        $attendee = $this->member();
        $event = $this->event($organiser, 1.0);

        $this->settle($event, $attendee, $organiser);

        $this->assertDatabaseMissing('user_xp_log', [
            'user_id' => $attendee->id,
            'action' => 'event_attendance_verified',
        ]);
    }

    // ── Tenant isolation ────────────────────────────────────────────────

    public function test_the_reward_is_scoped_to_the_events_own_tenant(): void
    {
        config(['events.attendance_credit_mode' => 'treasury']);

        // Our tenant has the flag OFF.
        $this->setFeature(false);

        $otherTenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Rewarding Community',
            'slug' => 'rewarding-' . uniqid(),
            'features' => json_encode(['events' => true, 'event_attendance_credits' => true]),
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        TenantContext::setById($otherTenantId);
        $organiser = User::factory()->forTenant($otherTenantId)->create(['status' => 'active', 'balance' => 0]);
        $attendee = User::factory()->forTenant($otherTenantId)->create(['status' => 'active', 'balance' => 0]);

        $event = new Event([
            'user_id' => $organiser->id,
            'title' => 'Other tenant event',
            'start_time' => now()->subHour(),
        ]);
        $event->tenant_id = $otherTenantId;
        $event->status = 'active';
        $event->attendance_credit_amount = 1.0;
        $event->save();

        $attendanceId = (int) DB::table('event_attendance')->insertGetId([
            'tenant_id' => $otherTenantId,
            'event_id' => (int) $event->id,
            'user_id' => (int) $attendee->id,
            'attendance_status' => 'checked_in',
            'attendance_version' => 1,
            'checked_in_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Evaluate while OUR tenant is the ambient context: the flag must be
        // read for the EVENT's tenant, not whatever context happens to be set
        // (a queue worker or console command can be pointed anywhere).
        TenantContext::setById($this->testTenantId);

        $result = app(EventCreditService::class)->settleAttendance(
            $event,
            EventAttendance::withoutGlobalScopes()->findOrFail($attendanceId),
            $attendee,
            $organiser,
        );

        $this->assertSame('settled', $result['status']);
        $this->assertSame(
            1.0,
            (float) DB::table('users')->where('id', $attendee->id)->value('balance'),
        );
        $this->assertSame(
            $otherTenantId,
            (int) DB::table('event_attendance_credit_claims')->where('id', $result['claim_id'])->value('tenant_id'),
        );
    }

    // ── The interlock ───────────────────────────────────────────────────

    public function test_every_returned_status_is_in_the_allow_set(): void
    {
        // The attendance service aborts a check-in on any status it does not
        // recognise. If a new outcome is added here without being added to
        // SETTLED_STATUSES, check-in breaks — so pin the relationship.
        foreach (['disabled', 'skipped', 'settled', 'already_settled', 'deferred_failed'] as $status) {
            $this->assertContains(
                $status,
                EventCreditService::SETTLED_STATUSES,
                "'{$status}' is returned by settleAttendance but is not in the allow-set the interlock checks."
            );
        }
    }
}
