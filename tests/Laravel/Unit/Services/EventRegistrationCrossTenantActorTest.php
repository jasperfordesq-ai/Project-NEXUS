<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Enums\EventCapacityRegistrationState;
use App\Exceptions\EventParticipationException;
use App\Exceptions\EventRegistrationException;
use App\Exceptions\EventWaitlistException;
use App\Models\Event;
use App\Models\User;
use App\Services\EventPeopleService;
use App\Services\EventRegistrationService;
use App\Services\EventWaitlistService;
use App\Support\Events\EventPeopleQuery;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Regression cover for the ACTOR lookups on the Event REGISTRATION path.
 *
 * This is the corner 766b867d2 deliberately left open. Registration has three
 * distinct people in play and they follow different rules, which is why the
 * previous two commits stopped short of it:
 *
 *  - The ACTOR (whoever performs the write) is GLOBAL. Tenant-scoping the
 *    acting user's own row refused every manager whose account row lives on
 *    another tenant — network admins and platform admins acting on a
 *    sub-tenant — from approve / reject / cancel, the bulk people endpoint and
 *    the roster. Four lookups did this: EventRegistrationController::actor(),
 *    the persisted-actor re-read in EventRegistrationService::lockActor(), the
 *    same re-read in EventWaitlistService::lockActor(), and the actor-tenant
 *    comparison in EventPeopleService::assertActorScope(). Fixing only the
 *    controller would have changed nothing — the services re-read the actor
 *    with the same predicate and refused again (the trap called out in
 *    766b867d2).
 *
 *  - The SUBJECT (the registrant) is SAME-TENANT ONLY, deliberately. A
 *    participation subject must belong to the event's tenant:
 *    EventParticipationEligibilityService::assertCanParticipate() enforces it
 *    with event_participation_scope_invalid, and the safeguarding contact
 *    checks around it (assertLocalContactAllowed) are tenant-local by
 *    construction. This is why EventsController::legacyRegistrationActor()
 *    keeps its tenant predicate: at every one of its call sites the actor IS
 *    the subject (self-service RSVP / waitlist), so the predicate agrees with
 *    the real rule.
 *
 *  - The ORGANIZER lookup inside assertCanParticipate() is STILL tenant-scoped
 *    and is a separate, known limitation — see
 *    test_event_owned_by_a_cross_tenant_organizer_still_refuses_registration.
 *    It is not fixed here because the safeguarding layer models cross-tenant
 *    contact as its own evaluation (assertCrossTenantContactAllowed), so
 *    resolving the organizer globally while still calling the LOCAL check
 *    would quietly skip a safeguarding boundary.
 *
 * Both settled halves are pinned below, so a future pass cannot "finish the
 * job" by globalising the subject, and cannot re-scope the actor.
 *
 * These assert the services directly rather than driving the HTTP endpoints,
 * because Sanctum::actingAs() takes the guard branch of the Authenticate
 * middleware, whose own cross-tenant check would 403 first and mask the
 * behaviour under test (same reasoning as
 * EventPublicationWorkflowCrossTenantActorTest and
 * EventAttendanceCrossTenantActorTest).
 */
final class EventRegistrationCrossTenantActorTest extends TestCase
{
    use DatabaseTransactions;

    /** Tenant the Event lives on. The cross-tenant actor's home tenant is 999. */
    private const ACTING_TENANT = 2;
    private const HOME_TENANT = 999;

    private EventRegistrationService $registrations;
    private EventWaitlistService $waitlist;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById(self::ACTING_TENANT);
        $this->registrations = app(EventRegistrationService::class);
        $this->waitlist = app(EventWaitlistService::class);
    }

    private function crossTenantUser(array $overrides = []): User
    {
        return User::factory()->forTenant(self::HOME_TENANT)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
    }

    private function localUser(array $overrides = []): User
    {
        return User::factory()->forTenant(self::ACTING_TENANT)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
    }

    /** The production shape: role='admin', is_tenant_super_admin=1, home tenant elsewhere. */
    private function crossTenantNetworkAdmin(): User
    {
        return $this->crossTenantUser([
            'role' => 'admin',
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 1,
        ]);
    }

    /**
     * Registration requires a not-yet-started, published, scheduled occurrence
     * (EventRegistrationAvailability::evaluate).
     */
    private function event(
        int $organizerId,
        int $tenantId = self::ACTING_TENANT,
        ?int $maxAttendees = null,
    ): int {
        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $organizerId,
            'max_attendees' => $maxAttendees,
            'title' => 'Cross-tenant registration fixture',
            'description' => 'Cross-tenant registration fixture.',
            'start_time' => now()->addDays(3),
            'end_time' => now()->addDays(3)->addHours(2),
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 0,
            'is_recurring_template' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** A member's own pending request, created by the member themselves. */
    private function pendingRegistration(int $eventId, User $member): void
    {
        $this->registrations->transition(
            $eventId,
            (int) $member->id,
            EventCapacityRegistrationState::Pending,
            $member,
            'pending-' . $eventId . '-' . $member->id,
        );
    }

    /** A member confirming their own place — actor and subject are the same person. */
    private function confirmedRegistration(int $eventId, User $member): void
    {
        $this->registrations->transition(
            $eventId,
            (int) $member->id,
            EventCapacityRegistrationState::Confirmed,
            $member,
            'confirmed-' . $eventId . '-' . $member->id,
        );
    }

    private function registrationState(int $eventId, User $member): ?string
    {
        $value = DB::table('event_registrations')
            ->where('event_id', $eventId)
            ->where('user_id', $member->id)
            ->value('registration_state');

        return $value === null ? null : (string) $value;
    }

    // ================================================================
    // ACTOR is global
    // ================================================================

    /**
     * Covers EventRegistrationService::lockActor() — the persisted-actor
     * re-read that refused the admin after the controller had already
     * authorised them.
     */
    public function test_cross_tenant_network_admin_can_approve_a_members_registration(): void
    {
        $admin = $this->crossTenantNetworkAdmin();
        $organizer = $this->localUser();
        $member = $this->localUser();
        $eventId = $this->event((int) $organizer->id);
        $this->pendingRegistration($eventId, $member);

        $result = $this->registrations->transition(
            $eventId,
            (int) $member->id,
            EventCapacityRegistrationState::Confirmed,
            $admin,
            'approve-cross-tenant-network-admin',
        );

        self::assertSame(
            EventCapacityRegistrationState::Confirmed,
            $result->registration->registration_state,
            'A network admin must be able to approve a registration on a tenant they administer even when their own account row lives elsewhere.',
        );
        self::assertSame('confirmed', $this->registrationState($eventId, $member));
    }

    /**
     * The cancel/decline branch takes lockEvent() rather than
     * lockEligibleEvent() and skips assertCanParticipate, so it reaches
     * lockActor() by a different route.
     */
    public function test_cross_tenant_network_admin_can_cancel_a_members_registration(): void
    {
        $admin = $this->crossTenantNetworkAdmin();
        $organizer = $this->localUser();
        $member = $this->localUser();
        $eventId = $this->event((int) $organizer->id);
        $this->pendingRegistration($eventId, $member);

        $result = $this->registrations->transition(
            $eventId,
            (int) $member->id,
            EventCapacityRegistrationState::Cancelled,
            $admin,
            'cancel-cross-tenant-network-admin',
            null,
            null,
            'Cancelled on the member\'s behalf.',
        );

        self::assertSame(
            EventCapacityRegistrationState::Cancelled,
            $result->registration->registration_state,
        );
    }

    /**
     * Covers EventWaitlistService::lockActor() — the same re-read on the
     * waitlist half of the path.
     */
    public function test_cross_tenant_network_admin_can_place_a_member_on_the_waitlist(): void
    {
        $admin = $this->crossTenantNetworkAdmin();
        $organizer = $this->localUser();
        $member = $this->localUser();
        // join() requires a finite capacity with no slots left, otherwise it
        // refuses with event_waitlist_finite_capacity_required /
        // event_waitlist_capacity_available.
        $eventId = $this->event((int) $organizer->id, self::ACTING_TENANT, 1);
        $this->confirmedRegistration($eventId, $this->localUser());

        $result = $this->waitlist->join(
            $eventId,
            (int) $member->id,
            $admin,
            'waitlist-cross-tenant-network-admin',
        );

        self::assertGreaterThan(
            0,
            (int) $result->entry->queue_sequence,
            'A cross-tenant network admin must be able to place a member on an event waitlist.',
        );
    }

    /**
     * Covers EventPeopleService::assertActorScope() — the roster compared the
     * ACTOR's home tenant against the event's and returned
     * event_registration_authorization_denied.
     */
    public function test_cross_tenant_network_admin_can_view_the_roster(): void
    {
        $admin = $this->crossTenantNetworkAdmin();
        $organizer = $this->localUser();
        $member = $this->localUser();
        $eventId = $this->event((int) $organizer->id);
        $this->pendingRegistration($eventId, $member);
        /** @var Event $event */
        $event = Event::withoutGlobalScopes()->whereKey($eventId)->firstOrFail();

        $roster = app(EventPeopleService::class)->paginateForActor(
            $event,
            $admin,
            EventPeopleQuery::fromArray([]),
        );

        self::assertContains(
            (int) $member->id,
            array_map(
                static fn (array $person): int => (int) ($person['member']['id'] ?? 0),
                $roster['items'],
            ),
            'A cross-tenant network admin must see the roster of an event on a tenant they administer.',
        );
    }

    // ================================================================
    // SUBJECT stays same-tenant — the deliberate boundary
    // ================================================================

    /**
     * The rule behind EventsController::legacyRegistrationActor()'s tenant
     * predicate. A member of another community cannot register for this
     * community's event: they are the SUBJECT of a participation write, and
     * EventParticipationEligibilityService requires a subject on the event's
     * tenant. Do not "fix" this by globalising the subject lookup.
     */
    public function test_cross_tenant_member_cannot_register_themselves(): void
    {
        $organizer = $this->localUser();
        $outsider = $this->crossTenantUser(['role' => 'member']);
        $eventId = $this->event((int) $organizer->id);

        try {
            $this->registrations->transition(
                $eventId,
                (int) $outsider->id,
                EventCapacityRegistrationState::Pending,
                $outsider,
                'self-register-cross-tenant',
            );
            self::fail('A member of another tenant must not be able to register for this tenant\'s event.');
        } catch (EventRegistrationException $exception) {
            self::assertSame(
                'event_registration_subject_not_found',
                $exception->reasonCode,
                'The subject lookup is the first line of defence; EventParticipationEligibilityService (event_participation_scope_invalid) is the second.',
            );
        }

        self::assertNull($this->registrationState($eventId, $outsider));
    }

    /** The waitlist half keeps the same subject boundary. */
    public function test_cross_tenant_member_cannot_join_the_waitlist_themselves(): void
    {
        $organizer = $this->localUser();
        $outsider = $this->crossTenantUser(['role' => 'member']);
        $eventId = $this->event((int) $organizer->id);

        try {
            $this->waitlist->join(
                $eventId,
                (int) $outsider->id,
                $outsider,
                'waitlist-self-cross-tenant',
            );
            self::fail('A member of another tenant must not be able to join this tenant\'s waitlist.');
        } catch (EventWaitlistException $exception) {
            self::assertSame('event_waitlist_subject_not_found', $exception->reasonCode);
        }
    }

    // ================================================================
    // Guards that must not loosen
    // ================================================================

    /** The actor fix must not widen authority: a cross-tenant stranger is refused. */
    public function test_cross_tenant_stranger_cannot_approve_a_registration(): void
    {
        $organizer = $this->localUser();
        $member = $this->localUser();
        $stranger = $this->crossTenantUser(['role' => 'member']);
        $eventId = $this->event((int) $organizer->id);
        $this->pendingRegistration($eventId, $member);

        try {
            $this->registrations->transition(
                $eventId,
                (int) $member->id,
                EventCapacityRegistrationState::Confirmed,
                $stranger,
                'approve-cross-tenant-stranger',
            );
            self::fail('A cross-tenant stranger must not be able to approve a registration.');
        } catch (EventRegistrationException $exception) {
            self::assertSame('event_registration_authorization_denied', $exception->reasonCode);
        }

        self::assertSame('pending', $this->registrationState($eventId, $member));
    }

    public function test_suspended_cross_tenant_admin_is_refused(): void
    {
        $admin = $this->crossTenantUser([
            'role' => 'admin',
            'is_tenant_super_admin' => 1,
            'status' => 'suspended',
        ]);
        $organizer = $this->localUser();
        $member = $this->localUser();
        $eventId = $this->event((int) $organizer->id);
        $this->pendingRegistration($eventId, $member);

        try {
            $this->registrations->transition(
                $eventId,
                (int) $member->id,
                EventCapacityRegistrationState::Confirmed,
                $admin,
                'approve-suspended-cross-tenant',
            );
            self::fail('A suspended actor must stay refused regardless of tenant.');
        } catch (EventRegistrationException $exception) {
            self::assertSame('event_registration_actor_invalid', $exception->reasonCode);
        }

        self::assertSame('pending', $this->registrationState($eventId, $member));
    }

    /** Resource scoping is untouched: an event on another tenant stays invisible. */
    public function test_event_on_another_tenant_is_not_reachable(): void
    {
        $organizer = $this->crossTenantUser();
        $member = $this->crossTenantUser();
        $foreignEventId = $this->event((int) $organizer->id, self::HOME_TENANT);

        try {
            $this->registrations->transition(
                $foreignEventId,
                (int) $member->id,
                EventCapacityRegistrationState::Confirmed,
                $organizer,
                'approve-foreign-event',
            );
            self::fail('Registering on an event that belongs to another tenant must be refused.');
        } catch (EventRegistrationException $exception) {
            self::assertSame('event_registration_event_not_found', $exception->reasonCode);
        }
    }

    // ================================================================
    // Known limitation, pinned so it is visible rather than surprising
    // ================================================================

    /**
     * A SEPARATE bug from the actor family, deliberately not fixed here.
     *
     * EventParticipationEligibilityService::assertCanParticipate() resolves the
     * event's ORGANIZER with `AND tenant_id = ?` before running the two
     * safeguarding contact checks. Since 5373940c8 a cross-tenant organiser can
     * create and publish an event on a tenant they administer — but nobody can
     * then register for it, because the organizer row cannot be resolved and
     * every registration fails with event_participation_organizer_invalid. Even
     * a local member registering themselves is refused.
     *
     * It is left alone because the fix is not simply dropping the predicate:
     * SafeguardingInteractionPolicy exposes assertCrossTenantContactAllowed()
     * as a distinct evaluation from assertLocalContactAllowed(), so resolving
     * the organizer globally while still calling the local check would skip a
     * safeguarding boundary rather than honour it. That is an owner decision.
     *
     * When it is fixed, this test should be inverted, not deleted.
     */
    public function test_event_owned_by_a_cross_tenant_organizer_still_refuses_registration(): void
    {
        $organizer = $this->crossTenantUser();
        $member = $this->localUser();
        $eventId = $this->event((int) $organizer->id);

        try {
            $this->registrations->transition(
                $eventId,
                (int) $member->id,
                EventCapacityRegistrationState::Pending,
                $member,
                'self-register-cross-tenant-organizer-event',
            );
            self::fail(
                'Registration on a cross-tenant-organised event now succeeds — the organizer lookup in '
                . 'EventParticipationEligibilityService has been fixed, so invert this test.',
            );
        } catch (EventParticipationException $exception) {
            self::assertSame('event_participation_organizer_invalid', $exception->reasonCode);
        }
    }
}
