<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Enums\EventCapacityRegistrationState;
use App\Enums\EventWaitlistQueueState;
use App\Exceptions\EventRegistrationException;
use App\Models\User;
use App\Services\EventRegistrationService;
use App\Services\EventWaitlistService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-587 — accepting a waitlist offer confirmed the member even when the
 * event's published registration settings require organiser approval.
 *
 * transitionLocked() applied the published settings (approval mode, the
 * open/close window) only when the transition did NOT come from a waitlist
 * offer, so the offer path skipped both. Reproduced live: manual approval,
 * capacity 1, A approved, B waitlisted, A withdrew, B accepted the offer and
 * was `confirmed` without the organiser deciding.
 *
 * Behaviour after the fix: under manual approval an accepted offer becomes a
 * `pending` request for the organiser. A pending place holds no seat, so the
 * seat goes straight back to the queue (the next waiter is offered it, as a
 * declined or expired offer does). The registration window is honoured too.
 */
final class F587WaitlistOfferHonoursManualApprovalTest extends TestCase
{
    use DatabaseTransactions;

    private EventRegistrationService $registrations;
    private EventWaitlistService $waitlist;

    protected function setUp(): void
    {
        parent::setUp();
        Config::set('events.notification_delivery.mode', 'outbox_authoritative');
        Config::set('events.notification_delivery.consumer_enabled', true);
        Config::set('events.registration.default_capacity_pool_key', 'event');
        Config::set('events.registration.allow_allocation_keys', false);
        Config::set('events.registration.legacy_dual_read', true);
        Config::set('events.registration.legacy_dual_write', true);
        Config::set('events.registration.timed_waitlist_offers_enabled', true);
        Config::set('events.registration.offer_ttl_minutes', 15);
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'events.notification_delivery_mode')
            ->delete();
        $this->registrations = new EventRegistrationService();
        $this->waitlist = new EventWaitlistService($this->registrations);
        self::assertTrue($this->waitlist->timedOffersEnabled(), 'Fixture precondition: timed offers are on.');
    }

    public function test_accepting_an_offer_under_manual_approval_waits_for_the_organiser(): void
    {
        [$eventId, , $first, $second, $offerToken] = $this->offerAfterRelease('manual');

        $accepted = $this->waitlist->acceptOffer($eventId, (int) $first->id, $offerToken, $first, 'f587-accept');

        self::assertSame(
            'pending',
            $this->state($eventId, $first),
            'BAD OUTCOME: the organiser requires approval, but accepting a waitlist offer confirmed the member.',
        );
        self::assertSame(EventWaitlistQueueState::Accepted, $accepted->entry->queue_state);
        self::assertSame(
            (int) $accepted->registration?->getKey(),
            (int) $accepted->entry->accepted_registration_id,
        );

        // The pending place holds no seat, so the queue must not stall: the
        // next waiter is offered the seat.
        self::assertSame((int) $second->id, (int) $accepted->nextOfferedEntry?->user_id);
        self::assertSame('offered', (string) DB::table('event_waitlist_entries')
            ->where('event_id', $eventId)
            ->where('user_id', (int) $second->id)
            ->value('queue_state'));
        self::assertSame(0, $this->confirmed($eventId), 'Nobody holds a confirmed place yet.');

        // Replaying the acceptance changes nothing and offers nothing twice.
        $replay = $this->waitlist->acceptOffer($eventId, (int) $first->id, $offerToken, $first, 'f587-accept');
        self::assertTrue($replay->replayed);
        self::assertSame(1, (int) DB::table('event_waitlist_entries')
            ->where('event_id', $eventId)
            ->where('queue_state', 'offered')
            ->count());
    }

    public function test_an_offer_cannot_be_accepted_after_the_registration_window_closed(): void
    {
        [$eventId, , $first, , $offerToken] = $this->offerAfterRelease('auto');
        DB::table('event_registration_settings')->where('event_id', $eventId)->update([
            'opens_at_utc' => now()->subDays(5),
            'closes_at_utc' => now()->subMinute(),
        ]);

        try {
            $this->waitlist->acceptOffer($eventId, (int) $first->id, $offerToken, $first, 'f587-late-accept');
            self::fail('An offer was accepted after the registration window closed.');
        } catch (EventRegistrationException $exception) {
            self::assertSame('event_registration_window_closed', $exception->reasonCode);
        }
        self::assertNotSame('confirmed', $this->state($eventId, $first));
        self::assertSame('offered', (string) DB::table('event_waitlist_entries')
            ->where('event_id', $eventId)
            ->where('user_id', (int) $first->id)
            ->value('queue_state'), 'The refused acceptance rolled back; the offer simply runs out.');
    }

    public function test_control_under_automatic_approval_an_accepted_offer_still_confirms(): void
    {
        [$eventId, , $first, $second, $offerToken] = $this->offerAfterRelease('auto');

        $accepted = $this->waitlist->acceptOffer($eventId, (int) $first->id, $offerToken, $first, 'f587-auto-accept');

        self::assertSame('confirmed', $this->state($eventId, $first));
        self::assertNull($accepted->nextOfferedEntry, 'The seat was taken, so nobody else is offered it.');
        self::assertSame('waiting', (string) DB::table('event_waitlist_entries')
            ->where('event_id', $eventId)
            ->where('user_id', (int) $second->id)
            ->value('queue_state'));
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    /**
     * Capacity 1. The holder is confirmed (approved by the organiser under
     * manual approval), two members wait, the holder withdraws and the first
     * waiter is offered the seat.
     *
     * @return array{0:int,1:User,2:User,3:User,4:string}
     */
    private function offerAfterRelease(string $approvalMode): array
    {
        $organizer = $this->member();
        $holder = $this->member();
        $first = $this->member();
        $second = $this->member();
        $eventId = $this->event($organizer);
        $this->publishSettings($eventId, $organizer, $approvalMode);

        $this->registrations->confirm($eventId, (int) $holder->id, $holder, 'f587-holder-request');
        if ($approvalMode === 'manual') {
            self::assertSame('pending', $this->state($eventId, $holder));
            $this->registrations->transition(
                $eventId,
                (int) $holder->id,
                EventCapacityRegistrationState::Confirmed,
                $organizer,
                'f587-holder-approve',
            );
        }
        self::assertSame('confirmed', $this->state($eventId, $holder));

        $this->waitlist->join($eventId, (int) $first->id, $first, 'f587-join-first');
        $this->waitlist->join($eventId, (int) $second->id, $second, 'f587-join-second');

        $released = $this->registrations->withdraw($eventId, (int) $holder->id, $holder, 'f587-holder-withdraw');
        self::assertSame((int) $first->id, (int) $released->offeredEntry?->user_id, 'Fixture: first waiter offered.');
        self::assertNotNull($released->offerToken);

        return [$eventId, $organizer, $first, $second, (string) $released->offerToken];
    }

    private function publishSettings(int $eventId, User $organizer, string $approvalMode): void
    {
        $event = DB::table('events')->where('id', $eventId)->first(['occurrence_key', 'start_time']);
        DB::table('event_registration_settings')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'occurrence_key' => $event->occurrence_key,
            'revision' => 1,
            'status' => 'published',
            'approval_mode' => $approvalMode,
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

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    private function event(User $organizer): int
    {
        $start = now()->addWeek();

        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $organizer->id,
            'title' => 'F-587 waitlist approval fixture',
            'description' => 'F-587 waitlist approval fixture.',
            'start_time' => $start,
            'end_time' => $start->copy()->addHour(),
            'timezone' => 'UTC',
            'timezone_source' => 'explicit',
            'all_day' => 0,
            'occurrence_key' => 'f587:' . bin2hex(random_bytes(10)),
            'is_recurring_template' => 0,
            'max_attendees' => 1,
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

    private function confirmed(int $eventId): int
    {
        return (int) DB::table('event_registrations')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $eventId)
            ->where('registration_state', 'confirmed')
            ->count();
    }
}
