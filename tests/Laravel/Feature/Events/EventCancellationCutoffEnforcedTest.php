<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Enums\EventCapacityRegistrationState;
use App\Exceptions\EventRegistrationException;
use App\Models\User;
use App\Services\EventRegistrationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * The organiser's published cancellation cutoff (cancellation_cutoff_at_utc)
 * was saved and shown to members but never enforced: a member could withdraw
 * a confirmed place after it. Reproduced live (cutoff in the past, member
 * withdrew, 200).
 *
 * After the cutoff a member can no longer give up a confirmed place
 * themselves. Organisers and event managers are exempt, and withdrawing a
 * request that never held a seat (pending) is still allowed.
 */
final class EventCancellationCutoffEnforcedTest extends TestCase
{
    use DatabaseTransactions;

    private EventRegistrationService $registrations;

    protected function setUp(): void
    {
        parent::setUp();
        Config::set('events.notification_delivery.mode', 'outbox_authoritative');
        Config::set('events.notification_delivery.consumer_enabled', true);
        Config::set('events.registration.default_capacity_pool_key', 'event');
        Config::set('events.registration.legacy_dual_read', true);
        Config::set('events.registration.legacy_dual_write', true);
        Config::set('events.registration.timed_waitlist_offers_enabled', false);
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'events.notification_delivery_mode')
            ->delete();
        $this->registrations = new EventRegistrationService();
    }

    public function test_member_cannot_withdraw_a_confirmed_place_after_the_cancellation_cutoff(): void
    {
        [$organizer, $member, $eventId] = $this->eventWithConfirmedMember(now()->subHour());

        try {
            $this->registrations->withdraw($eventId, (int) $member->id, $member, 'cutoff-member-withdraw');
            self::fail('BAD OUTCOME: a member withdrew a confirmed place after the published cancellation cutoff.');
        } catch (EventRegistrationException $exception) {
            self::assertSame('event_registration_transition_invalid', $exception->reasonCode);
        }
        self::assertSame('confirmed', $this->state($eventId, $member));
    }

    public function test_the_api_refuses_a_late_member_withdrawal(): void
    {
        [, $member, $eventId] = $this->eventWithConfirmedMember(now()->subHour());

        Sanctum::actingAs($member, ['*']);
        $this->apiPost("/v2/events/{$eventId}/registration/withdraw", [], ['Idempotency-Key' => 'cutoff-api-withdraw'])
            ->assertStatus(409)
            ->assertJsonPath('errors.0.code', 'EVENT_REGISTRATION_TRANSITION_INVALID');
        self::assertSame('confirmed', $this->state($eventId, $member));
    }

    public function test_the_organiser_can_still_cancel_a_place_after_the_cutoff(): void
    {
        [$organizer, $member, $eventId] = $this->eventWithConfirmedMember(now()->subHour());

        $this->registrations->transition(
            $eventId,
            (int) $member->id,
            EventCapacityRegistrationState::Cancelled,
            $organizer,
            'cutoff-organiser-cancel',
            null,
            null,
            'Removed by the organiser',
        );

        self::assertSame('cancelled', $this->state($eventId, $member));
    }

    public function test_control_member_can_withdraw_before_the_cutoff(): void
    {
        [, $member, $eventId] = $this->eventWithConfirmedMember(now()->addDay());

        $this->registrations->withdraw($eventId, (int) $member->id, $member, 'cutoff-early-withdraw');

        self::assertSame('cancelled', $this->state($eventId, $member));
    }

    public function test_control_member_can_withdraw_without_a_cutoff(): void
    {
        [, $member, $eventId] = $this->eventWithConfirmedMember(null);

        $this->registrations->withdraw($eventId, (int) $member->id, $member, 'cutoff-none-withdraw');

        self::assertSame('cancelled', $this->state($eventId, $member));
    }

    public function test_member_may_still_withdraw_a_pending_request_after_the_cutoff(): void
    {
        $organizer = $this->member();
        $member = $this->member();
        $eventId = $this->event($organizer);
        $this->publishSettings($eventId, $organizer, now()->subHour(), 'manual');
        $this->registrations->confirm($eventId, (int) $member->id, $member, 'cutoff-pending-request');
        self::assertSame('pending', $this->state($eventId, $member));

        $this->registrations->withdraw($eventId, (int) $member->id, $member, 'cutoff-pending-withdraw');

        self::assertSame('cancelled', $this->state($eventId, $member));
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    /** @return array{0:User,1:User,2:int} */
    private function eventWithConfirmedMember(?\DateTimeInterface $cutoff): array
    {
        $organizer = $this->member();
        $member = $this->member();
        $eventId = $this->event($organizer);
        $this->publishSettings($eventId, $organizer, $cutoff, 'auto');
        $this->registrations->confirm($eventId, (int) $member->id, $member, 'cutoff-confirm');
        self::assertSame('confirmed', $this->state($eventId, $member));

        return [$organizer, $member, $eventId];
    }

    private function publishSettings(int $eventId, User $organizer, ?\DateTimeInterface $cutoff, string $approvalMode): void
    {
        $event = DB::table('events')->where('id', $eventId)->first(['occurrence_key', 'start_time']);
        DB::table('event_registration_settings')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'occurrence_key' => $event->occurrence_key,
            'revision' => 1,
            'status' => 'published',
            'approval_mode' => $approvalMode,
            'cancellation_cutoff_at_utc' => $cutoff,
            'event_starts_at_utc_snapshot' => $event->start_time,
            'event_timezone_snapshot' => 'UTC',
            'created_by' => $organizer->id,
            'updated_by' => $organizer->id,
            'published_by' => $organizer->id,
            'published_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function event(User $organizer): int
    {
        $start = now()->addWeek();

        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $organizer->id,
            'title' => 'Cancellation cutoff fixture',
            'description' => 'Cancellation cutoff fixture.',
            'start_time' => $start,
            'end_time' => $start->copy()->addHour(),
            'timezone' => 'UTC',
            'timezone_source' => 'explicit',
            'all_day' => 0,
            'occurrence_key' => 'cutoff:' . bin2hex(random_bytes(10)),
            'is_recurring_template' => 0,
            'max_attendees' => 10,
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function state(int $eventId, User $member): ?string
    {
        $state = DB::table('event_registrations')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $eventId)
            ->where('user_id', (int) $member->id)
            ->value('registration_state');

        return $state === null ? null : (string) $state;
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'member',
            'status' => 'active',
            'is_approved' => true,
        ]);
    }
}
