<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Enums\EventCapacityRegistrationState;
use App\Enums\EventStaffRole;
use App\Exceptions\EventAttendanceException;
use App\Exceptions\EventLifecycleTransitionException;
use App\Exceptions\EventRegistrationException;
use App\Exceptions\EventRoleAssignmentException;
use App\Models\Event;
use App\Models\Tenant;
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
 * A tenant super admin acts in its own community AND every community below it
 * in the hierarchy — never above it, never beside it.
 *
 * Owner rule, 12 October 2026 (verbatim): "A tenant super admin can administer
 * all communities below it in the hierarchy, but not above it." Tenant admins
 * act in their own community only; the platform owner (is_super_admin / is_god)
 * acts everywhere.
 *
 * (From 11 to 12 October 2026 this suite asserted the opposite — that the
 * parent's tenant super admin was refused on a sub-community event — under an
 * earlier "own community only" reading. The owner reversed that on 12 October.)
 *
 * The relationship is built for real: the tenant super admin's home community is
 * made the PARENT of the community the event lives in (MakesNetworkAdminHierarchy).
 * Each grant is paired with refusals on the same fixture: the CHILD community's
 * tenant super admin on the parent's event, and a SIBLING community's tenant
 * super admin on the event — so "allowed" cannot mean that the fixture lets
 * everyone through.
 *
 * Services are driven directly rather than over HTTP: Authenticate/TenantContext
 * still pin a non-platform request to the actor's home community (403
 * tenant_mismatch) — whether HTTP should follow this rule is a separate, later
 * decision — so an HTTP test would stop there and prove nothing about the
 * service-layer authority decision this pins.
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

    // ------------------------------------------------------------ grants: parent over child

    public function test_a_parent_tenant_super_admin_holds_every_ability_on_a_sub_community_event(): void
    {
        $tsa = $this->parentTenantSuperAdmin();
        $event = $this->eventModel($this->publishedEvent(self::SUB_COMMUNITY, $this->member(self::SUB_COMMUNITY)));

        $abilities = app(EventPolicy::class)->abilitiesForEvents($tsa, [$event])[(int) $event->id];

        self::assertSame([], array_keys(array_filter($abilities, static fn (bool $granted): bool => ! $granted)), 'A tenant super admin must hold every ability on an event in a community below its own.');
    }

    public function test_a_parent_tenant_super_admin_can_view_a_sub_community_roster(): void
    {
        $tsa = $this->parentTenantSuperAdmin();
        $member = $this->member(self::SUB_COMMUNITY);
        $eventId = $this->publishedEvent(self::SUB_COMMUNITY, $this->member(self::SUB_COMMUNITY));
        $this->pending($eventId, $member);

        self::assertTrue(app(EventPolicy::class)->viewRoster($tsa, $this->eventModel($eventId)));
        $roster = app(EventPeopleService::class)->paginateForActor($this->eventModel($eventId), $tsa, EventPeopleQuery::fromArray([]));
        self::assertContains((int) $member->id, array_map(
            static fn (array $person): int => (int) ($person['member']['id'] ?? 0),
            $roster['items'],
        ));
    }

    public function test_a_parent_tenant_super_admin_can_approve_a_sub_community_registration(): void
    {
        $tsa = $this->parentTenantSuperAdmin();
        $member = $this->member(self::SUB_COMMUNITY);
        $eventId = $this->publishedEvent(self::SUB_COMMUNITY, $this->member(self::SUB_COMMUNITY));
        $this->pending($eventId, $member);

        app(EventRegistrationService::class)->transition(
            $eventId,
            (int) $member->id,
            EventCapacityRegistrationState::Confirmed,
            $tsa,
            'tsa-approve-' . $eventId,
        );

        self::assertSame('confirmed', $this->registrationState($eventId, $member));
    }

    public function test_a_parent_tenant_super_admin_can_check_someone_in_on_a_sub_community_event(): void
    {
        $tsa = $this->parentTenantSuperAdmin();
        $attendee = $this->member(self::SUB_COMMUNITY);
        $eventId = $this->startedEvent(self::SUB_COMMUNITY, $this->member(self::SUB_COMMUNITY));
        $this->going($eventId, $attendee, self::SUB_COMMUNITY);

        self::assertSame('checked_in', app(EventAttendanceService::class)->record($eventId, (int) $attendee->id, $tsa)->outcome);
    }

    public function test_a_parent_tenant_super_admin_can_publish_a_sub_community_draft(): void
    {
        $this->setEventsConfig(self::SUB_COMMUNITY, ['moderation_required' => false]);
        $tsa = $this->parentTenantSuperAdmin();
        $eventId = $this->draftEvent(self::SUB_COMMUNITY, $this->member(self::SUB_COMMUNITY), 'draft');

        app(EventPublicationWorkflowService::class)->publish($eventId, $tsa);

        self::assertSame('published', $this->publicationState($eventId));
    }

    public function test_a_parent_tenant_super_admin_can_approve_a_sub_community_event_awaiting_review(): void
    {
        $this->setEventsConfig(self::SUB_COMMUNITY, ['moderation_required' => true]);
        $tsa = $this->parentTenantSuperAdmin();
        $eventId = $this->draftEvent(self::SUB_COMMUNITY, $this->member(self::SUB_COMMUNITY), 'pending_review');

        app(EventPublicationWorkflowService::class)->approve($eventId, $tsa);

        self::assertSame('published', $this->publicationState($eventId));
    }

    public function test_a_parent_tenant_super_admin_can_create_events_in_a_sub_community_restricted_to_admins(): void
    {
        $this->setEventsConfig(self::SUB_COMMUNITY, ['creation_role' => 'admins']);
        $tsa = $this->parentTenantSuperAdmin();

        self::assertTrue(app(EventConfigurationService::class)->canCreate(self::SUB_COMMUNITY, (int) $tsa->id));
        // A plain admin of the parent is not a tenant super admin: own community only.
        self::assertFalse(app(EventConfigurationService::class)->canCreate(self::SUB_COMMUNITY, (int) $this->parentPlainAdmin()->id));
    }

    public function test_a_parent_tenant_super_admin_can_create_events_in_a_sub_community_open_to_all_members(): void
    {
        $this->setEventsConfig(self::SUB_COMMUNITY, ['creation_role' => 'members']);
        $tsa = $this->parentTenantSuperAdmin();

        self::assertTrue(app(EventConfigurationService::class)->canCreate(self::SUB_COMMUNITY, (int) $tsa->id));
        self::assertTrue(app(EventConfigurationService::class)->canCreate(self::SUB_COMMUNITY, (int) $this->member(self::SUB_COMMUNITY)->id));
        // A plain member of the parent community is not a member of this one.
        self::assertFalse(app(EventConfigurationService::class)->canCreate(self::SUB_COMMUNITY, (int) $this->member(self::PARENT_COMMUNITY)->id));
    }

    // ------------------------------------------------------------ refusals: upwards and sideways

    public function test_a_child_tenant_super_admin_holds_no_management_ability_on_the_parent_communitys_event(): void
    {
        $childTsa = $this->tenantSuperAdminOf(self::SUB_COMMUNITY);
        TenantContext::setById(self::PARENT_COMMUNITY);
        $event = $this->eventModel($this->publishedEvent(self::PARENT_COMMUNITY, $this->member(self::PARENT_COMMUNITY)));

        $abilities = app(EventPolicy::class)->abilitiesForEvents($childTsa, [$event])[(int) $event->id];

        self::assertSame(['view'], array_keys(array_filter($abilities)), 'BAD OUTCOME: a sub-community\'s tenant super admin holds management abilities on its parent community\'s event.');
    }

    public function test_a_child_tenant_super_admin_cannot_act_on_the_parent_communitys_event(): void
    {
        $childTsa = $this->tenantSuperAdminOf(self::SUB_COMMUNITY);
        TenantContext::setById(self::PARENT_COMMUNITY);
        $this->setEventsConfig(self::PARENT_COMMUNITY, ['creation_role' => 'admins', 'moderation_required' => false]);
        $member = $this->member(self::PARENT_COMMUNITY);
        $eventId = $this->publishedEvent(self::PARENT_COMMUNITY, $this->member(self::PARENT_COMMUNITY));
        $this->pending($eventId, $member);

        try {
            app(EventRegistrationService::class)->transition(
                $eventId,
                (int) $member->id,
                EventCapacityRegistrationState::Confirmed,
                $childTsa,
                'child-tsa-approve-' . $eventId,
            );
            self::fail('BAD OUTCOME: a sub-community\'s tenant super admin approved a registration on its parent community\'s event.');
        } catch (EventRegistrationException $exception) {
            self::assertSame('event_registration_authorization_denied', $exception->reasonCode);
        }
        self::assertSame('pending', $this->registrationState($eventId, $member));

        $draftId = $this->draftEvent(self::PARENT_COMMUNITY, $this->member(self::PARENT_COMMUNITY), 'draft');
        try {
            app(EventPublicationWorkflowService::class)->publish($draftId, $childTsa);
            self::fail('BAD OUTCOME: a sub-community\'s tenant super admin published its parent community\'s draft.');
        } catch (EventLifecycleTransitionException) {
            self::assertSame('draft', $this->publicationState($draftId));
        }

        self::assertFalse(app(EventConfigurationService::class)->canCreate(self::PARENT_COMMUNITY, (int) $childTsa->id));
    }

    public function test_a_sibling_communitys_tenant_super_admin_cannot_act_on_the_sub_community_event(): void
    {
        $siblingTsa = $this->tenantSuperAdminOf($this->siblingCommunity());
        $member = $this->member(self::SUB_COMMUNITY);
        $eventId = $this->publishedEvent(self::SUB_COMMUNITY, $this->member(self::SUB_COMMUNITY));
        $this->pending($eventId, $member);

        $abilities = app(EventPolicy::class)->abilitiesForEvents($siblingTsa, [$this->eventModel($eventId)])[$eventId];
        self::assertSame(['view'], array_keys(array_filter($abilities)), 'BAD OUTCOME: a sibling community\'s tenant super admin holds management abilities here.');

        try {
            app(EventPeopleService::class)->paginateForActor($this->eventModel($eventId), $siblingTsa, EventPeopleQuery::fromArray([]));
            self::fail('BAD OUTCOME: a sibling community\'s tenant super admin read this roster.');
        } catch (EventRegistrationException $exception) {
            self::assertSame('event_registration_authorization_denied', $exception->reasonCode);
        }

        $this->setEventsConfig(self::SUB_COMMUNITY, ['creation_role' => 'members']);
        self::assertFalse(app(EventConfigurationService::class)->canCreate(self::SUB_COMMUNITY, (int) $siblingTsa->id));
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
        return $this->tenantSuperAdminOf(self::PARENT_COMMUNITY);
    }

    private function tenantSuperAdminOf(int $tenantId): User
    {
        return $this->member($tenantId, [
            'role' => 'admin',
            'is_admin' => 1,
            'is_super_admin' => 0,
            'is_god' => 0,
            'is_tenant_super_admin' => 1,
        ]);
    }

    /** A plain community admin of the parent: own community only. */
    private function parentPlainAdmin(): User
    {
        return $this->member(self::PARENT_COMMUNITY, [
            'role' => 'admin',
            'is_admin' => 1,
            'is_super_admin' => 0,
            'is_god' => 0,
            'is_tenant_super_admin' => 0,
        ]);
    }

    /** A second community under the same parent, beside SUB_COMMUNITY. */
    private function siblingCommunity(): int
    {
        $sibling = Tenant::factory()->create([
            'domain' => null,
            'parent_id' => self::PARENT_COMMUNITY,
            'depth' => 1,
            'allows_subtenants' => false,
            'is_active' => true,
        ]);
        $id = (int) $sibling->id;
        Tenant::withoutGlobalScopes()->whereKey($id)->update(['path' => '/' . self::PARENT_COMMUNITY . '/' . $id . '/']);
        TenantContext::setById(self::SUB_COMMUNITY);

        return $id;
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
            'title' => 'Tenant super admin hierarchy fixture',
            'description' => 'Tenant super admin hierarchy fixture.',
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
