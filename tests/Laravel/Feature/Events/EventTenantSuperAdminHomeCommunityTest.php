<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Enums\EventCapacityRegistrationState;
use App\Exceptions\EventAttendanceException;
use App\Exceptions\EventLifecycleTransitionException;
use App\Exceptions\EventRegistrationException;
use App\Exceptions\EventRoleAssignmentException;
use App\Models\Event;
use App\Models\User;
use App\Policies\EventPolicy;
use App\Services\EventAttendanceService;
use App\Services\EventConfigurationService;
use App\Services\EventPeopleService;
use App\Services\EventPublicationWorkflowService;
use App\Services\EventRegistrationService;
use App\Services\EventRoleService;
use App\Support\Events\EventPeopleQuery;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Concerns\MakesNetworkAdminHierarchy;
use Tests\Laravel\TestCase;

/**
 * A tenant super admin acts in its OWN community only.
 *
 * Owner, 11 October 2026: "I don't want tenant admins to act outside of the home
 * community or tenant super admins, or normal tenant admins." Only the platform
 * owner (is_super_admin / is_god) keeps cross-community reach.
 *
 * Until then App\Support\Authorization\TenantAdminScope gave a tenant super admin
 * (`is_tenant_super_admin`, a "network admin") admin authority over every
 * sub-community beneath its own, by materialised-path prefix. This suite builds
 * that exact relationship for real — the actor's home community is made the
 * PARENT of the community the event lives in (MakesNetworkAdminHierarchy) — so
 * each refusal below is the strongest form of the case, not an unrelated
 * stranger being turned away.
 *
 * Every refusal is paired with a control: the same action by a platform owner
 * from elsewhere on the same event succeeds, and the same tenant super admin on
 * an event in its own community succeeds. Without those, "refused" could mean
 * only that the fixture was broken.
 *
 * Services are driven directly rather than over HTTP: Authenticate already
 * returns 403 tenant_mismatch to a non-platform actor whose account row is on
 * another community, so an HTTP test would stop there and prove nothing about
 * the service-layer authority decision this pins.
 */
final class EventTenantSuperAdminHomeCommunityTest extends TestCase
{
    use DatabaseTransactions;
    use MakesNetworkAdminHierarchy;

    /** The sub-community the event lives on. */
    private const SUB_COMMUNITY = 2;

    /** The parent community the tenant super admin's account row lives on. */
    private const PARENT_COMMUNITY = 999;

    protected function setUp(): void
    {
        parent::setUp();
        Config::set('events.attendance_credit_mode', 'off');
        $this->makeHomeTenantOversee(self::PARENT_COMMUNITY, self::SUB_COMMUNITY);
        TenantContext::setById(self::SUB_COMMUNITY);
    }

    // ------------------------------------------------------------ refusals

    public function test_a_parent_tenant_super_admin_holds_no_management_ability_on_a_sub_community_event(): void
    {
        $tsa = $this->parentTenantSuperAdmin();
        $event = $this->eventModel($this->publishedEvent(self::SUB_COMMUNITY, $this->member(self::SUB_COMMUNITY)));

        $abilities = app(EventPolicy::class)->abilitiesForEvents($tsa, [$event])[(int) $event->id];
        $granted = array_keys(array_filter($abilities));

        // 'view' only: the event is published, and a published event is visible
        // to anyone in the community — exactly what a plain member gets.
        self::assertSame(['view'], $granted, 'BAD OUTCOME: a parent community\'s tenant super admin holds management abilities on a sub-community event.');
    }

    public function test_a_parent_tenant_super_admin_cannot_view_a_sub_community_roster(): void
    {
        $tsa = $this->parentTenantSuperAdmin();
        $eventId = $this->publishedEvent(self::SUB_COMMUNITY, $this->member(self::SUB_COMMUNITY));
        $this->pending($eventId, $this->member(self::SUB_COMMUNITY));

        self::assertFalse(app(EventPolicy::class)->viewRoster($tsa, $this->eventModel($eventId)));
        try {
            app(EventPeopleService::class)->paginateForActor($this->eventModel($eventId), $tsa, EventPeopleQuery::fromArray([]));
            self::fail('BAD OUTCOME: a parent community\'s tenant super admin read a sub-community event roster.');
        } catch (EventRegistrationException $exception) {
            self::assertSame('event_registration_authorization_denied', $exception->reasonCode);
        }
    }

    public function test_a_parent_tenant_super_admin_cannot_approve_a_sub_community_registration(): void
    {
        $tsa = $this->parentTenantSuperAdmin();
        $member = $this->member(self::SUB_COMMUNITY);
        $eventId = $this->publishedEvent(self::SUB_COMMUNITY, $this->member(self::SUB_COMMUNITY));
        $this->pending($eventId, $member);

        try {
            app(EventRegistrationService::class)->transition(
                $eventId,
                (int) $member->id,
                EventCapacityRegistrationState::Confirmed,
                $tsa,
                'tsa-approve-' . $eventId,
            );
            self::fail('BAD OUTCOME: a parent community\'s tenant super admin approved a sub-community registration.');
        } catch (EventRegistrationException $exception) {
            self::assertSame('event_registration_authorization_denied', $exception->reasonCode);
        }
        self::assertSame('pending', $this->registrationState($eventId, $member));
    }

    public function test_a_parent_tenant_super_admin_cannot_check_someone_in_on_a_sub_community_event(): void
    {
        $tsa = $this->parentTenantSuperAdmin();
        $attendee = $this->member(self::SUB_COMMUNITY);
        $eventId = $this->startedEvent(self::SUB_COMMUNITY, $this->member(self::SUB_COMMUNITY));
        $this->going($eventId, $attendee, self::SUB_COMMUNITY);

        try {
            app(EventAttendanceService::class)->record($eventId, (int) $attendee->id, $tsa);
            self::fail('BAD OUTCOME: a parent community\'s tenant super admin checked someone in on a sub-community event.');
        } catch (EventAttendanceException $exception) {
            self::assertSame('event_attendance_authorization_denied', $exception->reasonCode);
        }
        self::assertNull($this->attendanceStatus($eventId, $attendee));
    }

    public function test_a_parent_tenant_super_admin_cannot_publish_a_sub_community_draft(): void
    {
        $this->setEventsConfig(self::SUB_COMMUNITY, ['moderation_required' => false]);
        $tsa = $this->parentTenantSuperAdmin();
        $eventId = $this->draftEvent(self::SUB_COMMUNITY, $this->member(self::SUB_COMMUNITY), 'draft');

        try {
            app(EventPublicationWorkflowService::class)->publish($eventId, $tsa);
            self::fail('BAD OUTCOME: a parent community\'s tenant super admin published a sub-community draft.');
        } catch (EventLifecycleTransitionException) {
            self::assertTrue(true);
        }
        self::assertSame('draft', $this->publicationState($eventId));
    }

    public function test_a_parent_tenant_super_admin_cannot_approve_a_sub_community_event_awaiting_review(): void
    {
        $this->setEventsConfig(self::SUB_COMMUNITY, ['moderation_required' => true]);
        $tsa = $this->parentTenantSuperAdmin();
        $eventId = $this->draftEvent(self::SUB_COMMUNITY, $this->member(self::SUB_COMMUNITY), 'pending_review');

        try {
            app(EventPublicationWorkflowService::class)->approve($eventId, $tsa);
            self::fail('BAD OUTCOME: a parent community\'s tenant super admin approved a sub-community event for publication.');
        } catch (EventLifecycleTransitionException) {
            self::assertTrue(true);
        }
        self::assertSame('pending_review', $this->publicationState($eventId));
    }

    public function test_a_parent_tenant_super_admin_cannot_create_events_in_a_sub_community_restricted_to_admins(): void
    {
        $this->setEventsConfig(self::SUB_COMMUNITY, ['creation_role' => 'admins']);
        $tsa = $this->parentTenantSuperAdmin();

        self::assertFalse(app(EventConfigurationService::class)->canCreate(self::SUB_COMMUNITY, (int) $tsa->id));
    }

    public function test_a_parent_tenant_super_admin_cannot_open_a_sub_community_event_team(): void
    {
        $tsa = $this->parentTenantSuperAdmin();
        $eventId = $this->publishedEvent(self::SUB_COMMUNITY, $this->member(self::SUB_COMMUNITY));

        self::assertFalse(app(EventPolicy::class)->manageStaff($tsa, $this->eventModel($eventId)));
        try {
            app(EventRoleService::class)->list($eventId, $tsa);
            self::fail('BAD OUTCOME: a parent community\'s tenant super admin opened a sub-community event\'s Team tab.');
        } catch (EventRoleAssignmentException) {
            self::assertTrue(true);
        }
    }

    // ------------------------------------------- control: own community

    public function test_the_same_tenant_super_admin_keeps_full_authority_in_its_own_community(): void
    {
        $tsa = $this->parentTenantSuperAdmin();
        TenantContext::setById(self::PARENT_COMMUNITY);
        $this->setEventsConfig(self::PARENT_COMMUNITY, ['creation_role' => 'admins', 'moderation_required' => false]);

        $organizer = $this->member(self::PARENT_COMMUNITY);
        $eventId = $this->publishedEvent(self::PARENT_COMMUNITY, $organizer);
        $abilities = app(EventPolicy::class)->abilitiesForEvents($tsa, [$this->eventModel($eventId)])[$eventId];
        self::assertSame([], array_keys(array_filter($abilities, static fn (bool $granted): bool => ! $granted)), 'A tenant super admin must hold every ability on its own community\'s event.');

        self::assertTrue(app(EventConfigurationService::class)->canCreate(self::PARENT_COMMUNITY, (int) $tsa->id));

        $draftId = $this->draftEvent(self::PARENT_COMMUNITY, $organizer, 'draft');
        app(EventPublicationWorkflowService::class)->publish($draftId, $tsa);
        self::assertSame('published', $this->publicationState($draftId));
    }

    // ------------------------------------------- control: platform owner

    public function test_a_platform_owner_from_elsewhere_still_acts_on_the_sub_community_event(): void
    {
        $owner = $this->platformOwner();
        $member = $this->member(self::SUB_COMMUNITY);
        $eventId = $this->publishedEvent(self::SUB_COMMUNITY, $this->member(self::SUB_COMMUNITY));
        $this->pending($eventId, $member);

        $roster = app(EventPeopleService::class)->paginateForActor($this->eventModel($eventId), $owner, EventPeopleQuery::fromArray([]));
        self::assertContains((int) $member->id, array_map(
            static fn (array $person): int => (int) ($person['member']['id'] ?? 0),
            $roster['items'],
        ));

        app(EventRegistrationService::class)->transition(
            $eventId,
            (int) $member->id,
            EventCapacityRegistrationState::Confirmed,
            $owner,
            'platform-approve-' . $eventId,
        );
        self::assertSame('confirmed', $this->registrationState($eventId, $member));

        $this->setEventsConfig(self::SUB_COMMUNITY, ['creation_role' => 'admins']);
        self::assertTrue(app(EventConfigurationService::class)->canCreate(self::SUB_COMMUNITY, (int) $owner->id));
    }

    public function test_a_platform_owner_from_elsewhere_still_checks_in_and_publishes_on_the_sub_community(): void
    {
        $owner = $this->platformOwner();
        $attendee = $this->member(self::SUB_COMMUNITY);
        $startedId = $this->startedEvent(self::SUB_COMMUNITY, $this->member(self::SUB_COMMUNITY));
        $this->going($startedId, $attendee, self::SUB_COMMUNITY);
        self::assertSame('checked_in', app(EventAttendanceService::class)->record($startedId, (int) $attendee->id, $owner)->outcome);

        $this->setEventsConfig(self::SUB_COMMUNITY, ['moderation_required' => true]);
        $pendingId = $this->draftEvent(self::SUB_COMMUNITY, $this->member(self::SUB_COMMUNITY), 'pending_review');
        app(EventPublicationWorkflowService::class)->approve($pendingId, $owner);
        self::assertSame('published', $this->publicationState($pendingId));
    }

    // ------------------------------------------------------------ fixtures

    /** The production shape: role='admin', is_tenant_super_admin=1, no platform flag. */
    private function parentTenantSuperAdmin(): User
    {
        return $this->member(self::PARENT_COMMUNITY, [
            'role' => 'admin',
            'is_admin' => 1,
            'is_super_admin' => 0,
            'is_god' => 0,
            'is_tenant_super_admin' => 1,
        ]);
    }

    private function platformOwner(): User
    {
        return $this->member(self::PARENT_COMMUNITY, [
            'role' => 'admin',
            'is_admin' => 1,
            'is_super_admin' => 1,
            'is_god' => 1,
        ]);
    }

    /** @param array<string,mixed> $overrides */
    private function member(int $tenantId, array $overrides = []): User
    {
        $current = TenantContext::currentId();
        $user = User::factory()->forTenant($tenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
        ], $overrides));
        if ($current !== null) {
            TenantContext::setById($current);
        }

        return $user;
    }

    /** @param array<string,mixed> $settings */
    private function setEventsConfig(int $tenantId, array $settings): void
    {
        $raw = DB::table('tenants')->where('id', $tenantId)->value('configuration');
        $configuration = is_string($raw) ? (json_decode($raw, true) ?: []) : (is_array($raw) ? $raw : []);
        $configuration['events'] = array_merge($configuration['events'] ?? [], $settings);
        DB::table('tenants')->where('id', $tenantId)->update(['configuration' => json_encode($configuration)]);
    }

    /** Registrable: published, scheduled, not yet started. */
    private function publishedEvent(int $tenantId, User $organizer): int
    {
        return $this->insertEvent($tenantId, $organizer, now()->addDays(3), 'published');
    }

    /** Check-in window open: started five minutes ago. */
    private function startedEvent(int $tenantId, User $organizer): int
    {
        return $this->insertEvent($tenantId, $organizer, now()->subMinutes(5), 'published');
    }

    private function draftEvent(int $tenantId, User $organizer, string $publicationState): int
    {
        return $this->insertEvent($tenantId, $organizer, now()->addDays(3), $publicationState);
    }

    private function insertEvent(int $tenantId, User $organizer, \DateTimeInterface $start, string $publicationState): int
    {
        $published = $publicationState === 'published';

        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => (int) $organizer->id,
            'title' => 'Tenant super admin confinement fixture',
            'description' => 'Tenant super admin confinement fixture.',
            'start_time' => $start,
            'end_time' => \Carbon\Carbon::instance($start)->addHours(2),
            'status' => $published ? 'active' : 'draft',
            'publication_status' => $publicationState,
            'operational_status' => 'scheduled',
            'lifecycle_version' => 0,
            'is_recurring_template' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function eventModel(int $eventId): Event
    {
        /** @var Event $event */
        $event = Event::withoutGlobalScopes()->whereKey($eventId)->firstOrFail();

        return $event;
    }

    private function pending(int $eventId, User $member): void
    {
        app(EventRegistrationService::class)->transition(
            $eventId,
            (int) $member->id,
            EventCapacityRegistrationState::Pending,
            $member,
            'pending-' . $eventId . '-' . $member->id,
        );
    }

    private function going(int $eventId, User $attendee, int $tenantId): void
    {
        DB::table('event_rsvps')->insert([
            'tenant_id' => $tenantId,
            'event_id' => $eventId,
            'user_id' => (int) $attendee->id,
            'status' => 'going',
            'created_at' => now(),
        ]);
    }

    private function registrationState(int $eventId, User $member): ?string
    {
        $value = DB::table('event_registrations')
            ->where('event_id', $eventId)
            ->where('user_id', $member->id)
            ->value('registration_state');

        return $value === null ? null : (string) $value;
    }

    private function attendanceStatus(int $eventId, User $attendee): ?string
    {
        $value = DB::table('event_attendance')
            ->where('event_id', $eventId)
            ->where('user_id', $attendee->id)
            ->value('attendance_status');

        return $value === null ? null : (string) $value;
    }

    private function publicationState(int $eventId): ?string
    {
        $value = DB::table('events')->where('id', $eventId)->value('publication_status');

        return $value === null ? null : (string) $value;
    }
}
