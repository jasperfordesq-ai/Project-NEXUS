<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Enums\EventCapacityRegistrationState;
use App\Exceptions\EventParticipationException;
use App\Exceptions\SafeguardingPolicyException;
use App\Models\Event;
use App\Models\User;
use App\Policies\EventPolicy;
use App\Services\EventParticipationEligibilityService;
use App\Services\EventRegistrationService;
use App\Services\EventWaitlistService;
use App\Services\SafeguardingInteractionPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\Laravel\TestCase;

final class EventParticipationEligibilityTest extends TestCase
{
    use DatabaseTransactions;

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
        Config::set('event_waitlist.envelope.active_key_version', 'eligibility-test-v1');
        Config::set('event_waitlist.envelope.active_key', null);
        Config::set('event_waitlist.envelope.fallback_to_app_key', true);
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'events.notification_delivery_mode')
            ->delete();
    }

    public function test_direct_registration_fails_atomically_when_safeguarding_denies(): void
    {
        $organizer = $this->member('Safeguarding Organizer');
        $member = $this->member('Safeguarding Subject');
        $event = $this->event((int) $organizer->id);
        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')
            ->once()
            ->with(
                (int) $member->id,
                (int) $organizer->id,
                $this->testTenantId,
                'event_registration',
            )
            ->andThrow(new SafeguardingPolicyException('VETTING_REQUIRED'));
        $service = new EventRegistrationService(
            null,
            new EventParticipationEligibilityService(new EventPolicy(), $policy),
        );

        try {
            $service->confirm(
                (int) $event->id,
                (int) $member->id,
                $member,
                'safeguarding-denied-registration',
            );
            self::fail('Safeguarding denial did not block direct registration.');
        } catch (SafeguardingPolicyException $exception) {
            self::assertSame('VETTING_REQUIRED', $exception->reasonCode);
        }
        $this->assertNoParticipationMutation((int) $event->id, (int) $member->id);
    }

    public function test_policy_unavailable_blocks_direct_waitlist_join_without_partial_facts(): void
    {
        $organizer = $this->member('Unavailable Organizer');
        $holder = $this->member('Unavailable Holder');
        $member = $this->member('Unavailable Subject');
        $event = $this->event((int) $organizer->id, 1);
        (new EventRegistrationService())->confirm(
            (int) $event->id,
            (int) $holder->id,
            $holder,
            'fill-before-policy-unavailable',
        );
        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')
            ->once()
            ->with(
                (int) $member->id,
                (int) $organizer->id,
                $this->testTenantId,
                'event_waitlist',
            )
            ->andThrow(new SafeguardingPolicyException('SAFEGUARDING_POLICY_UNAVAILABLE'));
        $eligibility = new EventParticipationEligibilityService(new EventPolicy(), $policy);
        $waitlist = new EventWaitlistService(null, null, null, $eligibility);

        try {
            $waitlist->join(
                (int) $event->id,
                (int) $member->id,
                $member,
                'policy-unavailable-waitlist',
            );
            self::fail('Unavailable safeguarding policy did not fail closed.');
        } catch (SafeguardingPolicyException $exception) {
            self::assertSame('SAFEGUARDING_POLICY_UNAVAILABLE', $exception->reasonCode);
        }
        self::assertFalse(DB::table('event_waitlist_entries')
            ->where('event_id', $event->id)
            ->where('user_id', $member->id)
            ->exists());
        self::assertFalse(DB::table('event_waitlist')
            ->where('event_id', $event->id)
            ->where('user_id', $member->id)
            ->exists());
    }

    public function test_organizer_approval_cannot_bypass_private_group_audience(): void
    {
        $organizer = $this->member('Private Organizer');
        $subject = $this->member('Private Outsider');
        $groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $organizer->id,
            'name' => 'Private registration group',
            'slug' => 'private-registration-' . bin2hex(random_bytes(5)),
            'description' => 'Audience boundary fixture.',
            'visibility' => 'private',
            'status' => 'active',
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $event = $this->event((int) $organizer->id, 5, ['group_id' => $groupId]);

        try {
            (new EventRegistrationService())->transition(
                (int) $event->id,
                (int) $subject->id,
                EventCapacityRegistrationState::Confirmed,
                $organizer,
                'private-audience-approval',
            );
            self::fail('Organizer approval bypassed the subject audience boundary.');
        } catch (EventParticipationException $exception) {
            self::assertSame('event_participation_audience_denied', $exception->reasonCode);
        }
        $this->assertNoParticipationMutation((int) $event->id, (int) $subject->id);
    }

    public function test_members_only_caring_event_rejects_unapproved_subject_at_service_boundary(): void
    {
        $organizer = $this->member('Caring Organizer');
        $subject = $this->member('Unapproved Caring Subject', ['is_approved' => false]);
        $event = $this->event((int) $organizer->id);
        DB::table('caring_kiss_treffen')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $event->id,
            'members_only' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        try {
            (new EventRegistrationService())->confirm(
                (int) $event->id,
                (int) $subject->id,
                $subject,
                'members-only-service-boundary',
            );
            self::fail('Members-only eligibility was bypassed.');
        } catch (EventParticipationException $exception) {
            self::assertSame(
                'event_participation_kiss_treffen_members_only',
                $exception->reasonCode,
            );
        }
        $this->assertNoParticipationMutation((int) $event->id, (int) $subject->id);
    }

    public function test_missing_or_inactive_organizer_identity_fails_closed(): void
    {
        $organizer = $this->member('Orphaned Organizer');
        $subject = $this->member('Orphaned Subject');
        $event = $this->event((int) $organizer->id);
        DB::table('events')->where('id', $event->id)->update(['user_id' => 999999999]);
        $event->refresh();

        try {
            (new EventRegistrationService())->confirm(
                (int) $event->id,
                (int) $subject->id,
                $subject,
                'orphaned-organizer-denied',
            );
            self::fail('An orphaned organizer identity was accepted.');
        } catch (EventParticipationException $exception) {
            self::assertSame('event_participation_organizer_invalid', $exception->reasonCode);
        }
        $this->assertNoParticipationMutation((int) $event->id, (int) $subject->id);

        DB::table('events')->where('id', $event->id)->update(['user_id' => $organizer->id]);
        DB::table('users')->where('id', $organizer->id)->update(['status' => 'suspended']);
        $event->refresh();
        try {
            (new EventRegistrationService())->confirm(
                (int) $event->id,
                (int) $subject->id,
                $subject,
                'inactive-organizer-denied',
            );
            self::fail('An inactive organizer identity was accepted.');
        } catch (EventParticipationException $exception) {
            self::assertSame('event_participation_organizer_invalid', $exception->reasonCode);
        }
        $this->assertNoParticipationMutation((int) $event->id, (int) $subject->id);
    }

    public function test_offer_acceptance_rechecks_policy_and_keeps_offer_unconsumed_on_denial(): void
    {
        $organizer = $this->member('Offer Organizer');
        $holder = $this->member('Offer Holder');
        $waiter = $this->member('Offer Waiter');
        $event = $this->event((int) $organizer->id, 1);
        $registrations = new EventRegistrationService();
        $waitlist = new EventWaitlistService($registrations);
        $registrations->confirm((int) $event->id, (int) $holder->id, $holder, 'offer-fill');
        $waitlist->join((int) $event->id, (int) $waiter->id, $waiter, 'offer-join');
        // E-102: free the seat without a release; a release with timed offers off now moves the head of the queue up itself.
        DB::table('events')->where('tenant_id', $this->testTenantId)->where('id', (int) $event->id)->increment('max_attendees');
        Config::set('events.registration.timed_waitlist_offers_enabled', true);
        $offer = $waitlist->offerNext((int) $event->id, $organizer, 'offer-create');
        self::assertNotNull($offer?->offerToken);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')
            ->once()
            ->with(
                (int) $waiter->id,
                (int) $organizer->id,
                $this->testTenantId,
                'event_registration',
            )
            ->andThrow(new SafeguardingPolicyException('VETTING_REQUIRED'));
        $eligibility = new EventParticipationEligibilityService(new EventPolicy(), $policy);
        $deniedRegistrations = new EventRegistrationService(null, $eligibility);
        $deniedWaitlist = new EventWaitlistService(
            $deniedRegistrations,
            null,
            null,
            $eligibility,
        );

        try {
            $deniedWaitlist->acceptOffer(
                (int) $event->id,
                (int) $waiter->id,
                (string) $offer->offerToken,
                $waiter,
                'offer-accept-denied',
            );
            self::fail('Offer acceptance bypassed safeguarding re-evaluation.');
        } catch (SafeguardingPolicyException $exception) {
            self::assertSame('VETTING_REQUIRED', $exception->reasonCode);
        }
        $entry = DB::table('event_waitlist_entries')->where('id', $offer->entry->id)->first();
        self::assertSame('offered', $entry?->queue_state);
        self::assertNull($entry?->offer_token_used_at);
        self::assertFalse(DB::table('event_registrations')
            ->where('event_id', $event->id)
            ->where('user_id', $waiter->id)
            ->where('registration_state', 'confirmed')
            ->exists());
    }

    /** @param array<string,mixed> $overrides */
    private function member(string $name, array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'name' => $name,
            'first_name' => $name,
            'role' => 'member',
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
    }

    /** @param array<string,mixed> $overrides */
    private function event(
        int $organizerId,
        int $capacity = 5,
        array $overrides = [],
    ): Event {
        $start = now()->addWeek();
        $eventId = (int) DB::table('events')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'user_id' => $organizerId,
            'title' => 'Participation eligibility fixture',
            'description' => 'Direct service eligibility fixture.',
            'start_time' => $start,
            'end_time' => $start->copy()->addHour(),
            'timezone' => 'UTC',
            'timezone_source' => 'explicit',
            'all_day' => 0,
            'occurrence_key' => 'eligibility:' . bin2hex(random_bytes(8)),
            'is_recurring_template' => 0,
            'max_attendees' => $capacity,
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));

        return Event::withoutGlobalScopes()->findOrFail($eventId);
    }

    private function assertNoParticipationMutation(int $eventId, int $userId): void
    {
        self::assertFalse(DB::table('event_registrations')
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->exists());
        self::assertFalse(DB::table('event_registration_history')
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->exists());
        self::assertFalse(DB::table('event_domain_outbox')
            ->where('event_id', $eventId)
            ->where('payload', 'like', '%"user_id":' . $userId . '%')
            ->exists());
        self::assertFalse(DB::table('event_rsvps')
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->exists());
    }
}
