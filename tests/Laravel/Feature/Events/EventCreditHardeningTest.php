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
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Hardening pinned after the adversarial money-path review.
 *
 *  - ATOMICITY: the balance write and its transactions row commit together.
 *    Before, a failure between the two statements left the balance up with no
 *    ledger row, the claim marked failed (= retryable), and the retry minted
 *    AGAIN — a silent double-credit. The probe here injects a failure AFTER
 *    the transactions insert executes and asserts everything rolled back.
 *  - KILL SWITCH: an admin retry is minting, so the platform mode gates it
 *    exactly as it gates a check-in settle.
 *  - CORRECTION PATH: reversal (and the audit ledger) deliberately keep
 *    working with the tenant feature flag OFF — that flag being switched off
 *    is precisely the incident state in which corrections happen.
 */
class EventCreditHardeningTest extends TestCase
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

    private function event(User $organiser, float $reward): Event
    {
        $event = new Event([
            'user_id' => $organiser->id,
            'title' => 'Hardening Fair',
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

    private function balanceOf(User $user): float
    {
        return (float) DB::table('users')->where('id', $user->id)->value('balance');
    }

    // ── Atomicity ───────────────────────────────────────────────────────

    public function test_a_failure_after_the_ledger_insert_rolls_back_the_balance_too(): void
    {
        config(['events.attendance_credit_mode' => 'treasury']);
        $this->setFeature(true);

        $organiser = $this->member();
        $attendee = $this->member();
        $event = $this->event($organiser, 1.0);

        // Throw AFTER the transactions insert has executed — the exact window
        // that used to leave a phantom balance increment behind. DB::listen
        // callbacks run synchronously after each statement, so an exception
        // here propagates up through the mint inside its transaction.
        $armed = true;
        DB::listen(function (QueryExecuted $query) use (&$armed): void {
            if ($armed && str_contains($query->sql, 'insert into `transactions`')) {
                $armed = false;

                throw new \RuntimeException('post-insert failure injection');
            }
        });

        $result = app(EventCreditService::class)->settleAttendance(
            $event,
            $this->attendance($event, $attendee),
            $attendee,
            $organiser,
        );

        $this->assertSame('deferred_failed', $result['status']);
        // 🔴 The heart of the fix: no phantom credit survives the failure.
        $this->assertSame(0.0, $this->balanceOf($attendee), 'Balance must roll back with the failed ledger insert.');
        $this->assertSame(0, DB::table('transactions')->where('receiver_id', $attendee->id)->count());

        $claim = DB::table('event_attendance_credit_claims')->where('id', $result['claim_id'])->first();
        $this->assertSame('failed', $claim->status);

        // And the retry (injection disarmed) pays exactly once.
        $retry = app(EventCreditService::class)->retryClaim($this->testTenantId, (int) $result['claim_id']);
        $this->assertSame('settled', $retry['status']);
        $this->assertSame(1.0, $this->balanceOf($attendee), 'Exactly one credit after the retry — never two.');
        $this->assertSame(1, DB::table('transactions')->where('receiver_id', $attendee->id)->count());
    }

    // ── Kill switches ───────────────────────────────────────────────────

    public function test_admin_retry_respects_the_platform_mode_kill_switch(): void
    {
        config(['events.attendance_credit_mode' => 'treasury']);
        $this->setFeature(true);

        $organiser = $this->member();
        $attendee = $this->member();
        $event = $this->event($organiser, 1.0);

        // Manufacture a failed claim under treasury mode.
        $armed = true;
        DB::listen(function (QueryExecuted $query) use (&$armed): void {
            if ($armed && str_contains($query->sql, 'insert into `transactions`')) {
                $armed = false;

                throw new \RuntimeException('mint outage');
            }
        });
        $failed = app(EventCreditService::class)->settleAttendance(
            $event,
            $this->attendance($event, $attendee),
            $attendee,
            $organiser,
        );
        $this->assertSame('deferred_failed', $failed['status']);

        // Operator kills the platform switch; the stale failed claim must not
        // be mintable through the admin retry.
        config(['events.attendance_credit_mode' => 'off']);

        $result = app(EventCreditService::class)->retryClaim($this->testTenantId, (int) $failed['claim_id']);

        $this->assertSame('disabled', $result['status']);
        $this->assertSame(0.0, $this->balanceOf($attendee));
        $this->assertSame(
            'failed',
            DB::table('event_attendance_credit_claims')->where('id', $failed['claim_id'])->value('status'),
            'The claim must stay failed (retryable) rather than being consumed.',
        );
    }

    public function test_reversal_and_ledger_survive_disabling_the_tenant_flag(): void
    {
        config(['events.attendance_credit_mode' => 'treasury']);
        $this->setFeature(true);

        $organiser = $this->member();
        $admin = $this->member(['role' => 'admin']);
        $attendee = $this->member();
        $event = $this->event($organiser, 1.0);

        $paid = app(EventCreditService::class)->settleAttendance(
            $event,
            $this->attendance($event, $attendee),
            $attendee,
            $organiser,
        );
        $this->assertSame('settled', $paid['status']);

        // The incident response: flag off to stop the bleeding…
        $this->setFeature(false);
        $this->actingAs($admin);

        // …the audit ledger stays readable…
        $this->apiGet('/v2/admin/events/attendance-claims?status=completed')->assertStatus(200);

        // …and the erroneous reward can still be corrected.
        $reverse = $this->apiPost(
            '/v2/admin/events/attendance-claims/' . $paid['claim_id'] . '/reverse',
            ['reason' => 'Granted in error, flag now disabled'],
        );
        $reverse->assertStatus(200);
        $this->assertSame('reversed', $reverse->json('data.status'));
        $this->assertSame(0.0, $this->balanceOf($attendee));

        // Retry, which MINTS, stays feature-gated: 403 with the flag off.
        $this->apiPost('/v2/admin/events/attendance-claims/' . $paid['claim_id'] . '/retry')
            ->assertStatus(403);
    }

    // ── Transition path carries the credit outcome ──────────────────────

    public function test_the_transition_result_reports_the_credit_status(): void
    {
        config(['events.attendance_credit_mode' => 'treasury']);
        $this->setFeature(true);

        $organiser = $this->member();
        $attendee = $this->member();
        $event = $this->event($organiser, 1.0);

        // The transition path requires a confirmed registration before
        // check-in (unlike the raw settle used by the suites above).
        DB::table('event_registrations')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => (int) $event->id,
            'user_id' => (int) $attendee->id,
            'capacity_pool_key' => 'event',
            'registration_state' => 'confirmed',
            'registration_version' => 1,
            'state_changed_at' => now(),
            'state_changed_by' => (int) $organiser->id,
            'confirmed_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $service = app(\App\Services\EventAttendanceService::class);

        $first = $service->transition(
            (int) $event->id,
            (int) $attendee->id,
            \App\Enums\EventAttendanceAction::CheckIn,
            $organiser,
            0,
            null,
            'hardening-checkin-1',
        );
        $this->assertSame('settled', $first->toArray()['credit_status']);

        $undo = $service->transition(
            (int) $event->id,
            (int) $attendee->id,
            \App\Enums\EventAttendanceAction::Undo,
            $organiser,
            (int) $first->toArray()['attendance_version'],
            'Mis-scan during hardening test',
            'hardening-undo-1',
        );
        $this->assertNull($undo->toArray()['credit_status']);

        // Re-check-in after the undo: financially a no-op, and now it SAYS so.
        $second = $service->transition(
            (int) $event->id,
            (int) $attendee->id,
            \App\Enums\EventAttendanceAction::CheckIn,
            $organiser,
            (int) $undo->toArray()['attendance_version'],
            null,
            'hardening-checkin-2',
        );
        $this->assertSame('already_settled', $second->toArray()['credit_status']);
        $this->assertSame(1.0, $this->balanceOf($attendee), 'Still exactly one reward.');
    }
}
