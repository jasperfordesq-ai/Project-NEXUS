<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Enums\EventCapacityRegistrationState;
use App\Models\User;
use App\Services\EventRegistrationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-099 (E-027): a member must not be able to overturn an organiser's
 * registration decision, and published registration settings must bind.
 *
 * A member may still ASK again after being declined or cancelled (existing
 * design, see EventRegistrationServiceTest), but the request now waits for
 * the organiser as "pending" instead of confirming itself.
 *
 * The state machine lets Declined/Cancelled move straight back to Confirmed,
 * and a member acting on their own registration skipped every authorisation
 * check. A member the organiser had rejected could therefore confirm again
 * and receive the meeting link and a check-in credential. "Require organiser
 * approval" and the registration open/close dates were stored but never read.
 */
final class EventOrganiserDecisionTest extends TestCase
{
    use DatabaseTransactions;

    private EventRegistrationService $registrations;

    protected function setUp(): void
    {
        parent::setUp();
        Config::set('app.key', 'base64:HfQEDtbtr90JIXhsaAhSFWnzIo1f31VZ2e5qLqKKnls=');
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

    public function test_member_cannot_reconfirm_after_the_organiser_declined_them(): void
    {
        [$organizer, $member, $eventId] = $this->eventWithMember();
        $this->registrations->transition(
            $eventId,
            (int) $member->id,
            EventCapacityRegistrationState::Declined,
            $organizer,
            'organiser-decline-1',
            null,
            null,
            'Not eligible for this session',
        );

        Sanctum::actingAs($member, ['*']);
        $this->confirm($eventId, 'member-retry-after-decline')
            ->assertOk()
            ->assertJsonPath('data.relationship.registration.state', 'pending');

        self::assertSame('pending', $this->state($eventId, $member), 'Only the organiser may confirm a declined member');
    }

    public function test_member_cannot_reconfirm_after_the_organiser_cancelled_them(): void
    {
        [$organizer, $member, $eventId] = $this->eventWithMember();
        $this->registrations->transition($eventId, (int) $member->id, EventCapacityRegistrationState::Confirmed, $member, 'self-confirm-1');
        $this->registrations->transition(
            $eventId,
            (int) $member->id,
            EventCapacityRegistrationState::Cancelled,
            $organizer,
            'organiser-cancel-1',
            null,
            null,
            'Removed by organiser',
        );

        Sanctum::actingAs($member, ['*']);
        $this->confirm($eventId, 'member-retry-after-cancel')->assertOk();

        self::assertSame('pending', $this->state($eventId, $member), 'Only the organiser may restore a cancelled place');
    }

    public function test_member_awaiting_approval_cannot_confirm_themselves(): void
    {
        [$organizer, $member, $eventId] = $this->eventWithMember();
        $this->registrations->transition($eventId, (int) $member->id, EventCapacityRegistrationState::Pending, $organizer, 'organiser-pending-1');

        Sanctum::actingAs($member, ['*']);
        $this->confirm($eventId, 'member-self-promote-1')->assertOk();

        self::assertSame('pending', $this->state($eventId, $member));
    }

    public function test_member_who_withdrew_themselves_can_register_again(): void
    {
        [, $member, $eventId] = $this->eventWithMember();
        Sanctum::actingAs($member, ['*']);

        $this->confirm($eventId, 'control-confirm-1')->assertOk();
        $this->apiPost("/v2/events/{$eventId}/registration/withdraw", [], ['Idempotency-Key' => 'control-withdraw-1'])->assertOk();
        $this->confirm($eventId, 'control-confirm-2')
            ->assertOk()
            ->assertJsonPath('data.relationship.registration.state', 'confirmed');
    }

    public function test_manual_approval_puts_a_member_in_pending_until_the_organiser_approves(): void
    {
        [$organizer, $member, $eventId] = $this->eventWithMember();
        $this->publishSettings($eventId, $organizer, ['approval_mode' => 'manual']);

        Sanctum::actingAs($member, ['*']);
        $this->confirm($eventId, 'manual-confirm-1')
            ->assertOk()
            ->assertJsonPath('data.relationship.registration.state', 'pending');
        // Retrying the same request converges on the same pending row.
        $this->confirm($eventId, 'manual-confirm-1')->assertOk()
            ->assertJsonPath('data.relationship.registration.state', 'pending');
        self::assertSame('pending', $this->state($eventId, $member));

        Sanctum::actingAs($organizer, ['*']);
        $this->apiPost("/v2/events/{$eventId}/people/{$member->id}/approve", [], ['Idempotency-Key' => 'manual-approve-1'])
            ->assertOk();
        self::assertSame('confirmed', $this->state($eventId, $member));
    }

    public function test_registration_is_refused_outside_the_published_window(): void
    {
        [$organizer, $member, $eventId] = $this->eventWithMember();
        $this->publishSettings($eventId, $organizer, [
            'opens_at_utc' => now()->addDays(2),
            'closes_at_utc' => now()->addDays(3),
        ]);

        Sanctum::actingAs($member, ['*']);
        $this->confirm($eventId, 'early-confirm-1')
            ->assertStatus(409)
            ->assertJsonPath('errors.0.code', 'EVENT_REGISTRATION_CLOSED');
        self::assertNull($this->state($eventId, $member));
    }

    /** @return array{0: User, 1: User, 2: int} */
    private function eventWithMember(): array
    {
        $organizer = $this->member('Decision Organizer');
        $member = $this->member('Decision Member');
        $start = now()->addWeek();

        $eventId = (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $organizer->id,
            'title' => 'Organiser decision fixture',
            'description' => 'F-099 regression fixture.',
            'start_time' => $start,
            'end_time' => $start->copy()->addHour(),
            'timezone' => 'UTC',
            'timezone_source' => 'explicit',
            'all_day' => 0,
            'occurrence_key' => "f099:{$this->testTenantId}:" . bin2hex(random_bytes(8)),
            'is_recurring_template' => 0,
            'max_attendees' => 10,
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [$organizer, $member, $eventId];
    }

    /** @param array<string,mixed> $overrides */
    private function publishSettings(int $eventId, User $organizer, array $overrides): void
    {
        $event = DB::table('events')->where('id', $eventId)->first(['occurrence_key', 'start_time']);
        DB::table('event_registration_settings')->insert(array_merge([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'occurrence_key' => $event->occurrence_key,
            'revision' => 1,
            'status' => 'published',
            'approval_mode' => 'auto',
            'event_starts_at_utc_snapshot' => $event->start_time,
            'event_timezone_snapshot' => 'UTC',
            'created_by' => $organizer->id,
            'updated_by' => $organizer->id,
            'published_by' => $organizer->id,
            'published_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    private function confirm(int $eventId, string $key): \Illuminate\Testing\TestResponse
    {
        return $this->apiPost("/v2/events/{$eventId}/registration/confirm", [], ['Idempotency-Key' => $key]);
    }

    private function state(int $eventId, User $member): ?string
    {
        $state = DB::table('event_registrations')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $member->id)
            ->value('registration_state');

        return $state === null ? null : (string) $state;
    }

    private function member(string $name): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'name' => $name,
            'first_name' => $name,
            'role' => 'member',
            'status' => 'active',
            'is_approved' => true,
        ]);
    }
}
