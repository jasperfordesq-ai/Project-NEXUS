<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Enums\EventStaffRole;
use App\Models\Event;
use App\Models\User;
use App\Policies\EventPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Tests\Laravel\TestCase;

final class EventPolicyTest extends TestCase
{
    use DatabaseTransactions;

    /** @var list<string> */
    private const ABILITIES = [
        'view',
        'viewMeetingLink',
        'viewRegisteredAgenda',
        'viewStaffAgenda',
        'viewRoster',
        'viewWaitlist',
        'manage',
        'manageAgenda',
        'manageStaff',
        'manageAttendance',
        'messagePeople',
        'exportPeople',
        'linkSeries',
        'manageRegistration',
        'broadcast',
        'manageFinance',
        'reconcileCredits',
        'reconcileTickets',
        'transferOwnership',
    ];

    private EventPolicy $policy;

    protected function setUp(): void
    {
        parent::setUp();
        $this->policy = new EventPolicy();
    }

    private function user(array $overrides = [], ?int $tenantId = null): User
    {
        return User::factory()->forTenant($tenantId ?? $this->testTenantId)->create(array_merge([
            'first_name' => 'Event',
            'last_name' => 'Policy User',
            'role' => 'member',
            'status' => 'active',
            'is_approved' => true,
            'is_admin' => false,
            'is_super_admin' => false,
            'is_tenant_super_admin' => false,
            'is_god' => false,
        ], $overrides));
    }

    private function event(int $organizerId, array $overrides = [], ?int $tenantId = null): Event
    {
        $id = (int) DB::table('events')->insertGetId(array_merge([
            'tenant_id' => $tenantId ?? $this->testTenantId,
            'user_id' => $organizerId,
            'title' => 'Policy matrix event',
            'description' => 'Permission matrix fixture.',
            'start_time' => now()->addDay(),
            'end_time' => now()->addDay()->addHour(),
            'status' => 'active',
            'is_online' => 1,
            'online_link' => 'https://meet.example.test/policy-matrix',
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));

        return Event::withoutGlobalScopes()->findOrFail($id);
    }

    private function group(int $ownerId, array $overrides = [], ?int $tenantId = null): int
    {
        return (int) DB::table('groups')->insertGetId(array_merge([
            'tenant_id' => $tenantId ?? $this->testTenantId,
            'owner_id' => $ownerId,
            'name' => 'Event policy group ' . uniqid(),
            'slug' => 'event-policy-' . uniqid(),
            'description' => 'Private audience fixture.',
            'visibility' => 'private',
            'status' => 'active',
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    private function rsvp(Event $event, User $user, string $status): void
    {
        DB::table('event_rsvps')->insert([
            'tenant_id' => (int) $event->getAttribute('tenant_id'),
            'event_id' => (int) $event->getKey(),
            'user_id' => (int) $user->getKey(),
            'status' => $status,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function canonicalRegistration(Event $event, User $user, string $state = 'confirmed'): void
    {
        DB::table('event_registrations')->insert([
            'tenant_id' => (int) $event->getAttribute('tenant_id'),
            'event_id' => (int) $event->getKey(),
            'user_id' => (int) $user->getKey(),
            'capacity_pool_key' => 'event',
            'allocation_key' => null,
            'registration_state' => $state,
            'registration_version' => 1,
            'state_changed_at' => now(),
            'state_changed_by' => (int) $user->getKey(),
            'confirmed_at' => $state === 'confirmed' ? now() : null,
            'declined_at' => $state === 'declined' ? now() : null,
            'cancelled_at' => $state === 'cancelled' ? now() : null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function canonicalWaitlist(Event $event, User $user, string $state): void
    {
        DB::table('event_waitlist_entries')->insert([
            'tenant_id' => (int) $event->getAttribute('tenant_id'),
            'event_id' => (int) $event->getKey(),
            'user_id' => (int) $user->getKey(),
            'capacity_pool_key' => 'event',
            'allocation_key' => null,
            'queue_state' => $state,
            'queue_version' => 1,
            'queue_sequence' => 1,
            'state_changed_at' => now(),
            'state_changed_by' => (int) $user->getKey(),
            'offered_at' => $state === 'offered' ? now() : null,
            'offer_expires_at' => $state === 'offered' ? now()->addHour() : null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function joinGroup(int $groupId, User $user, string $role = 'member'): void
    {
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => (int) $user->getKey(),
            'role' => $role,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function assignRole(
        Event $event,
        User $user,
        EventStaffRole $role,
        int $grantorId,
        string $status = 'active',
        mixed $expiresAt = null,
        ?int $tenantId = null,
    ): void {
        DB::table('event_staff_assignments')->insert([
            'tenant_id' => $tenantId ?? $this->testTenantId,
            'event_id' => (int) $event->getKey(),
            'user_id' => (int) $user->getKey(),
            'role' => $role->value,
            'status' => $status,
            'assignment_version' => 1,
            'granted_at' => now(),
            'granted_by' => $grantorId,
            'revoked_at' => $status === 'revoked' ? now() : null,
            'revoked_by' => $status === 'revoked' ? $grantorId : null,
            'expires_at' => $expiresAt,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** @return array<string, bool> */
    private function abilities(EventPolicy $policy, User $user, Event $event): array
    {
        // Console listeners deliberately clear tenant state after each fixture
        // write. Re-establish the request tenant before exercising the policy.
        TenantContext::setById($this->testTenantId);

        return [
            'view' => $policy->view($user, $event),
            'viewMeetingLink' => $policy->viewMeetingLink($user, $event),
            'viewRegisteredAgenda' => $policy->viewRegisteredAgenda($user, $event),
            'viewStaffAgenda' => $policy->viewStaffAgenda($user, $event),
            'viewRoster' => $policy->viewRoster($user, $event),
            'viewWaitlist' => $policy->viewWaitlist($user, $event),
            'manage' => $policy->manage($user, $event),
            'manageAgenda' => $policy->manageAgenda($user, $event),
            'manageStaff' => $policy->manageStaff($user, $event),
            'manageAttendance' => $policy->manageAttendance($user, $event),
            'messagePeople' => $policy->messagePeople($user, $event),
            'exportPeople' => $policy->exportPeople($user, $event),
            'linkSeries' => $policy->linkSeries($user, $event),
            'manageRegistration' => $policy->manageRegistration($user, $event),
            'broadcast' => $policy->broadcast($user, $event),
            'manageFinance' => $policy->manageFinance($user, $event),
            'reconcileCredits' => $policy->reconcileCredits($user, $event),
            'reconcileTickets' => $policy->reconcileTickets($user, $event),
            'transferOwnership' => $policy->transferOwnership($user, $event),
        ];
    }

    /** @param list<string> $allowed */
    private function assertOnlyAbilities(
        array $allowed,
        EventPolicy $policy,
        User $user,
        Event $event,
        string $persona,
    ): void {
        $actual = $this->abilities($policy, $user, $event);

        foreach (self::ABILITIES as $ability) {
            $this->assertSame(
                in_array($ability, $allowed, true),
                $actual[$ability],
                "Unexpected {$ability} decision for {$persona}."
            );
        }
    }

    public function test_standalone_event_permission_matrix_separates_detail_roster_and_meeting_access(): void
    {
        $owner = $this->user(['first_name' => 'Owner']);
        $unrelated = $this->user(['first_name' => 'Unrelated']);
        $interested = $this->user(['first_name' => 'Interested']);
        $confirmed = $this->user(['first_name' => 'Confirmed']);
        $attended = $this->user(['first_name' => 'Attended']);
        $waitlisted = $this->user(['first_name' => 'Waitlisted']);
        $admin = $this->user(['first_name' => 'Admin', 'role' => 'tenant_admin']);
        $legacyFlagAdmin = $this->user(['first_name' => 'Flag Admin', 'is_admin' => true]);
        $tenantSuperAdmin = $this->user([
            'first_name' => 'Tenant Super Admin',
            'is_tenant_super_admin' => true,
        ]);
        $platformAdmin = $this->user(['first_name' => 'Platform Admin', 'is_super_admin' => true]);
        $godAdmin = $this->user(['first_name' => 'God Admin', 'is_god' => true]);
        $suspended = $this->user(['first_name' => 'Suspended', 'status' => 'suspended']);
        $crossTenantAdmin = $this->user(
            ['first_name' => 'Foreign Admin', 'role' => 'tenant_admin'],
            999
        );
        $event = $this->event((int) $owner->getKey());

        $this->rsvp($event, $interested, 'interested');
        $this->rsvp($event, $confirmed, 'going');
        $this->rsvp($event, $attended, 'attended');
        $this->rsvp($event, $waitlisted, 'waitlisted');
        DB::table('event_waitlist')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => (int) $event->getKey(),
            'user_id' => (int) $waitlisted->getKey(),
            'position' => 1,
            'status' => 'waiting',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->assertOnlyAbilities(['view'], $this->policy, $unrelated, $event, 'unrelated member');
        $this->assertOnlyAbilities(['view'], $this->policy, $interested, $event, 'interested member');
        $this->assertOnlyAbilities(
            ['view', 'viewMeetingLink', 'viewRegisteredAgenda'],
            $this->policy,
            $confirmed,
            $event,
            'confirmed attendee'
        );
        $this->assertOnlyAbilities(
            ['view', 'viewMeetingLink', 'viewRegisteredAgenda'],
            $this->policy,
            $attended,
            $event,
            'attended member'
        );
        $this->assertOnlyAbilities(['view'], $this->policy, $waitlisted, $event, 'waitlisted member');
        $this->assertOnlyAbilities(self::ABILITIES, $this->policy, $owner, $event, 'event owner');
        $this->assertOnlyAbilities(self::ABILITIES, $this->policy, $admin, $event, 'tenant admin');
        $this->assertOnlyAbilities(self::ABILITIES, $this->policy, $legacyFlagAdmin, $event, 'flag admin');
        $this->assertOnlyAbilities(self::ABILITIES, $this->policy, $tenantSuperAdmin, $event, 'tenant super admin');
        $this->assertOnlyAbilities(self::ABILITIES, $this->policy, $platformAdmin, $event, 'platform admin');
        $this->assertOnlyAbilities(self::ABILITIES, $this->policy, $godAdmin, $event, 'god admin');
        $this->assertOnlyAbilities([], $this->policy, $suspended, $event, 'suspended member');
        // An admin of ANOTHER community holds no authority here, so it lands on
        // exactly what a plain member gets: 'view' on a published event, and
        // nothing else. Not [] — this event is published, and a published event is
        // visible to any viewer (the public index shows it to anonymous visitors
        // too), so withholding 'view' would be stricter than the public contract.
        // What matters is the other eighteen abilities, all refused: assertOnlyAbilities
        // checks the full matrix, so viewRoster, exportPeople, manageFinance and
        // transferOwnership are being asserted false right here.
        //
        // 🔴 This expectation was [] and had been failing on main since 5373940c8,
        // which dropped the actor's home-tenant comparison from hasValidContext()
        // and thereby handed this persona ALL NINETEEN abilities. Two commits read
        // the red as stale-test noise; it was a live cross-tenant escalation. The
        // tenant question now lives on the authority decision (TenantAdminScope,
        // via EventPolicy::isTenantAdmin) instead of on the identity check, so an
        // organiser whose account row is on another tenant still keeps full
        // authority over their own event. Tiers: TenantAdminScopeTest.
        $this->assertOnlyAbilities(['view'], $this->policy, $crossTenantAdmin, $event, 'cross-tenant admin');
    }

    public function test_active_waitlist_state_outranks_a_stale_confirmed_rsvp_for_meeting_access(): void
    {
        $owner = $this->user();
        $viewer = $this->user();
        $event = $this->event((int) $owner->getKey());
        $this->rsvp($event, $viewer, 'going');
        DB::table('event_waitlist')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => (int) $event->getKey(),
            'user_id' => (int) $viewer->getKey(),
            'position' => 2,
            'status' => 'waiting',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        TenantContext::setById($this->testTenantId);
        $this->assertTrue($this->policy->view($viewer, $event));
        $this->assertFalse($this->policy->viewMeetingLink($viewer, $event));
    }

    public function test_canonical_states_take_precedence_in_single_and_batch_meeting_access(): void
    {
        $owner = $this->user();
        $viewer = $this->user();
        $confirmedEvent = $this->event((int) $owner->getKey(), ['title' => 'Canonical confirmed']);
        $offeredEvent = $this->event((int) $owner->getKey(), ['title' => 'Canonical offered']);
        $cancelledRegistrationEvent = $this->event((int) $owner->getKey(), ['title' => 'Canonical cancelled registration']);
        $cancelledWaitlistEvent = $this->event((int) $owner->getKey(), ['title' => 'Canonical cancelled waitlist']);

        $this->canonicalRegistration($confirmedEvent, $viewer);
        $this->canonicalRegistration($offeredEvent, $viewer);
        $this->canonicalWaitlist($offeredEvent, $viewer, 'offered');
        $this->canonicalRegistration($cancelledRegistrationEvent, $viewer, 'cancelled');
        $this->rsvp($cancelledRegistrationEvent, $viewer, 'going');
        $this->canonicalRegistration($cancelledWaitlistEvent, $viewer);
        $this->canonicalWaitlist($cancelledWaitlistEvent, $viewer, 'cancelled');
        DB::table('event_waitlist')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => (int) $cancelledWaitlistEvent->getKey(),
            'user_id' => (int) $viewer->getKey(),
            'position' => 1,
            'status' => 'waiting',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        TenantContext::setById($this->testTenantId);
        $this->assertTrue((new EventPolicy())->viewMeetingLink($viewer, $confirmedEvent));
        $this->assertFalse((new EventPolicy())->viewMeetingLink($viewer, $offeredEvent));
        $this->assertFalse((new EventPolicy())->viewMeetingLink($viewer, $cancelledRegistrationEvent));
        $this->assertTrue((new EventPolicy())->viewMeetingLink($viewer, $cancelledWaitlistEvent));

        $batch = (new EventPolicy())->abilitiesForEvents($viewer, [
            $confirmedEvent,
            $offeredEvent,
            $cancelledRegistrationEvent,
            $cancelledWaitlistEvent,
        ]);

        $this->assertTrue($batch[(int) $confirmedEvent->getKey()]['viewMeetingLink']);
        $this->assertFalse($batch[(int) $offeredEvent->getKey()]['viewMeetingLink']);
        $this->assertFalse($batch[(int) $cancelledRegistrationEvent->getKey()]['viewMeetingLink']);
        $this->assertTrue($batch[(int) $cancelledWaitlistEvent->getKey()]['viewMeetingLink']);
        $this->assertSame(0, DB::table('event_rsvps')
            ->where('user_id', (int) $viewer->getKey())
            ->whereIn('event_id', [(int) $confirmedEvent->getKey(), (int) $offeredEvent->getKey()])
            ->count());
        $this->assertSame(0, DB::table('event_waitlist')
            ->where('user_id', (int) $viewer->getKey())
            ->where('event_id', (int) $offeredEvent->getKey())
            ->count());
    }

    public function test_private_group_audience_cannot_be_bypassed_by_rsvp_or_group_admin_role(): void
    {
        $groupOwner = $this->user(['first_name' => 'Group Owner']);
        $organizer = $this->user(['first_name' => 'Organizer']);
        $member = $this->user(['first_name' => 'Group Member']);
        $groupAdmin = $this->user(['first_name' => 'Group Admin']);
        $outsider = $this->user(['first_name' => 'Outsider']);
        $tenantAdmin = $this->user(['first_name' => 'Tenant Admin', 'role' => 'tenant_admin']);
        $groupId = $this->group((int) $groupOwner->getKey());

        $this->joinGroup($groupId, $organizer);
        $this->joinGroup($groupId, $member);
        $this->joinGroup($groupId, $groupAdmin, 'admin');
        $event = $this->event((int) $organizer->getKey(), ['group_id' => $groupId]);
        $this->rsvp($event, $member, 'going');
        $this->rsvp($event, $outsider, 'going');

        $this->assertOnlyAbilities(
            ['view', 'viewMeetingLink', 'viewRegisteredAgenda'],
            $this->policy,
            $member,
            $event,
            'confirmed private-group member'
        );
        $this->assertOnlyAbilities(['view'], $this->policy, $groupAdmin, $event, 'group admin');
        $this->assertOnlyAbilities(['view'], $this->policy, $groupOwner, $event, 'group owner');
        $this->assertOnlyAbilities([], $this->policy, $outsider, $event, 'confirmed group outsider');
        $this->assertOnlyAbilities(self::ABILITIES, $this->policy, $organizer, $event, 'group event owner');
        $this->assertOnlyAbilities(self::ABILITIES, $this->policy, $tenantAdmin, $event, 'tenant admin');
    }

    public function test_linked_group_membership_and_lifecycle_revoke_event_authority(): void
    {
        $groupOwner = $this->user(['first_name' => 'Boundary Owner']);
        $organizer = $this->user(['first_name' => 'Boundary Organizer']);
        $tenantAdmin = $this->user(['first_name' => 'Boundary Tenant Admin', 'role' => 'tenant_admin']);
        $groupId = $this->group((int) $groupOwner->getKey(), ['visibility' => 'public']);

        $this->joinGroup($groupId, $organizer);
        $event = $this->event((int) $organizer->getKey(), ['group_id' => $groupId]);
        $this->assertOnlyAbilities(
            self::ABILITIES,
            new EventPolicy(),
            $organizer,
            $event,
            'active group event owner',
        );

        DB::table('group_members')
            ->where('tenant_id', $this->testTenantId)
            ->where('group_id', $groupId)
            ->where('user_id', (int) $organizer->getKey())
            ->delete();

        $this->assertOnlyAbilities(
            ['view'],
            new EventPolicy(),
            $organizer,
            $event,
            'former public-group member',
        );

        DB::table('groups')->where('id', $groupId)->update(['status' => 'archived']);

        $this->assertOnlyAbilities([], new EventPolicy(), $organizer, $event, 'archived group event owner');
        $this->assertOnlyAbilities([], new EventPolicy(), $tenantAdmin, $event, 'archived group tenant admin');
    }

    public function test_draft_and_malformed_cross_tenant_group_links_fail_closed(): void
    {
        $owner = $this->user();
        $member = $this->user();
        $admin = $this->user(['role' => 'tenant_admin']);
        $draft = $this->event((int) $owner->getKey(), ['status' => 'draft']);

        $this->assertOnlyAbilities([], $this->policy, $member, $draft, 'member viewing draft');
        $this->assertOnlyAbilities(self::ABILITIES, $this->policy, $owner, $draft, 'draft owner');
        $this->assertOnlyAbilities(self::ABILITIES, $this->policy, $admin, $draft, 'draft admin');

        $foreignOwner = $this->user([], 999);
        $foreignGroupId = $this->group((int) $foreignOwner->getKey(), [], 999);
        $malformed = $this->event((int) $owner->getKey(), ['group_id' => $foreignGroupId]);

        $this->assertOnlyAbilities([], $this->policy, $owner, $malformed, 'owner with foreign group link');
        $this->assertOnlyAbilities([], $this->policy, $admin, $malformed, 'admin with foreign group link');
    }

    public function test_foreign_event_and_feature_disabled_tenant_deny_every_ability(): void
    {
        $localAdmin = $this->user(['role' => 'tenant_admin']);
        $foreignOwner = $this->user([], 999);
        $foreignEvent = $this->event((int) $foreignOwner->getKey(), [], 999);

        $this->assertOnlyAbilities([], $this->policy, $localAdmin, $foreignEvent, 'local admin foreign event');
        $this->assertOnlyAbilities([], $this->policy, $foreignOwner, $foreignEvent, 'foreign owner in local context');

        $localOwner = $this->user();
        $localEvent = $this->event((int) $localOwner->getKey());
        TenantContext::reset();
        $this->assertFalse($this->policy->view($localOwner, $localEvent));

        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['events' => false], JSON_THROW_ON_ERROR),
        ]);
        TenantContext::setById($this->testTenantId);

        $this->assertOnlyAbilities([], $this->policy, $localOwner, $localEvent, 'feature-disabled owner');
        $this->assertOnlyAbilities([], $this->policy, $localAdmin, $localEvent, 'feature-disabled admin');
    }

    public function test_assigned_roles_grant_only_their_exact_active_tenant_scoped_capabilities(): void
    {
        $owner = $this->user(['first_name' => 'Role Owner']);
        $coOrganizer = $this->user(['first_name' => 'Co Organizer']);
        $registration = $this->user(['first_name' => 'Registration']);
        $communications = $this->user(['first_name' => 'Communications']);
        $checkIn = $this->user(['first_name' => 'Check In']);
        $finance = $this->user(['first_name' => 'Finance']);
        $revoked = $this->user(['first_name' => 'Revoked']);
        $expired = $this->user(['first_name' => 'Expired']);
        $foreignScoped = $this->user(['first_name' => 'Foreign Scoped']);
        $event = $this->event((int) $owner->getKey());

        $this->assignRole($event, $coOrganizer, EventStaffRole::CoOrganizer, (int) $owner->id);
        $this->assignRole($event, $registration, EventStaffRole::RegistrationManager, (int) $owner->id);
        $this->assignRole($event, $communications, EventStaffRole::CommunicationsManager, (int) $owner->id);
        $this->assignRole($event, $checkIn, EventStaffRole::CheckInStaff, (int) $owner->id);
        $this->assignRole($event, $finance, EventStaffRole::FinanceManager, (int) $owner->id);
        $this->assignRole(
            $event,
            $revoked,
            EventStaffRole::CoOrganizer,
            (int) $owner->id,
            'revoked',
        );
        $this->assignRole(
            $event,
            $expired,
            EventStaffRole::CoOrganizer,
            (int) $owner->id,
            'active',
            now()->subMinute(),
        );
        $this->assignRole(
            $event,
            $foreignScoped,
            EventStaffRole::CoOrganizer,
            (int) $owner->id,
            'active',
            null,
            999,
        );

        $this->assertOnlyAbilities([
            'view',
            'viewMeetingLink',
            'viewRegisteredAgenda',
            'viewStaffAgenda',
            'viewRoster',
            'viewWaitlist',
            'manage',
            'manageAgenda',
            'manageStaff',
            'manageAttendance',
            'messagePeople',
            'exportPeople',
            'linkSeries',
            'manageRegistration',
            'broadcast',
        ], $this->policy, $coOrganizer, $event, 'co-organizer');
        $this->assertOnlyAbilities([
            'view',
            'viewRegisteredAgenda',
            'viewStaffAgenda',
            'viewRoster',
            'viewWaitlist',
            'exportPeople',
            'manageRegistration',
        ], new EventPolicy(), $registration, $event, 'registration manager');
        $this->assertOnlyAbilities(
            ['view', 'viewRegisteredAgenda', 'viewStaffAgenda', 'messagePeople', 'broadcast'],
            new EventPolicy(),
            $communications,
            $event,
            'communications manager',
        );
        $this->assertOnlyAbilities(
            ['view', 'viewRegisteredAgenda', 'viewStaffAgenda', 'viewRoster', 'manageAttendance'],
            new EventPolicy(),
            $checkIn,
            $event,
            'check-in staff',
        );
        $this->assertOnlyAbilities([
            'view',
            'viewRegisteredAgenda',
            'viewStaffAgenda',
            'manageFinance',
            'reconcileCredits',
            'reconcileTickets',
        ], new EventPolicy(), $finance, $event, 'finance manager');
        $this->assertOnlyAbilities(['view'], new EventPolicy(), $revoked, $event, 'revoked co-organizer');
        $this->assertOnlyAbilities(['view'], new EventPolicy(), $expired, $event, 'expired co-organizer');
        $this->assertOnlyAbilities(
            ['view'],
            new EventPolicy(),
            $foreignScoped,
            $event,
            'cross-tenant assignment',
        );
    }

    public function test_capability_extension_is_explicit_and_does_not_grant_broad_management(): void
    {
        $owner = $this->user();
        $staff = $this->user();
        $event = $this->event((int) $owner->getKey());
        $capabilityPolicy = new class extends EventPolicy {
            protected function hasAssignedCapability(
                User $user,
                Event $event,
                string $capability,
            ): bool {
                return $capability === 'manageAttendance';
            }
        };

        $this->assertOnlyAbilities(
            ['view', 'manageAttendance'],
            $capabilityPolicy,
            $staff,
            $event,
            'future attendance-only staff'
        );
    }

    public function test_batch_ability_matrix_has_direct_policy_parity_and_bounded_queries(): void
    {
        $organizer = $this->user(['first_name' => 'Batch Organizer']);
        $viewer = $this->user(['first_name' => 'Batch Viewer']);
        $groupId = $this->group((int) $organizer->getKey());
        $this->joinGroup($groupId, $viewer);

        $rows = [];
        for ($index = 0; $index < 100; $index++) {
            $rows[] = [
                'tenant_id' => $this->testTenantId,
                'user_id' => (int) $organizer->getKey(),
                'group_id' => $groupId,
                'title' => "Batch policy event {$index}",
                'description' => 'Bounded-query policy fixture.',
                'start_time' => now()->addDays($index + 1),
                'end_time' => now()->addDays($index + 1)->addHour(),
                'status' => 'active',
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }
        DB::table('events')->insert($rows);

        TenantContext::setById($this->testTenantId);
        $events = Event::query()
            ->where('group_id', $groupId)
            ->orderBy('id')
            ->get();
        $confirmedEvent = $events[0];
        $waitlistedEvent = $events[1];
        $this->rsvp($confirmedEvent, $viewer, 'going');
        $this->assignRole(
            $confirmedEvent,
            $viewer,
            EventStaffRole::CheckInStaff,
            (int) $organizer->getKey(),
        );
        DB::table('event_waitlist')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => (int) $waitlistedEvent->getKey(),
            'user_id' => (int) $viewer->getKey(),
            'position' => 1,
            'status' => 'waiting',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        TenantContext::setById($this->testTenantId);
        DB::flushQueryLog();
        DB::enableQueryLog();
        $batch = (new EventPolicy())->abilitiesForEvents($viewer, $events);
        $queries = DB::getQueryLog();
        DB::disableQueryLog();

        $this->assertCount(100, $batch);
        $this->assertLessThanOrEqual(
            9,
            count($queries),
            'Batch policy evaluation exceeded its nine bounded schema/fact queries.'
        );
        $this->assertSame(
            $this->abilities(new EventPolicy(), $viewer, $confirmedEvent),
            $batch[(int) $confirmedEvent->getKey()]
        );
        $this->assertSame(
            $this->abilities(new EventPolicy(), $viewer, $waitlistedEvent),
            $batch[(int) $waitlistedEvent->getKey()]
        );
        $this->assertTrue($batch[(int) $confirmedEvent->getKey()]['viewMeetingLink']);
        $this->assertTrue($batch[(int) $confirmedEvent->getKey()]['viewRegisteredAgenda']);
        $this->assertTrue($batch[(int) $confirmedEvent->getKey()]['viewStaffAgenda']);
        $this->assertTrue($batch[(int) $confirmedEvent->getKey()]['manageAttendance']);
        $this->assertFalse($batch[(int) $confirmedEvent->getKey()]['manage']);
        $this->assertFalse($batch[(int) $confirmedEvent->getKey()]['manageAgenda']);
        $this->assertFalse($batch[(int) $waitlistedEvent->getKey()]['viewMeetingLink']);
        $this->assertFalse($batch[(int) $waitlistedEvent->getKey()]['viewRegisteredAgenda']);
        $this->assertFalse($batch[(int) $waitlistedEvent->getKey()]['viewStaffAgenda']);
        $this->assertTrue($batch[(int) $confirmedEvent->getKey()]['viewRoster']);
    }

    public function test_laravel_auto_discovers_event_policy_and_guests_are_denied(): void
    {
        $owner = $this->user();
        $event = $this->event((int) $owner->getKey());

        TenantContext::setById($this->testTenantId);
        $this->assertFalse(Gate::allows('view', $event));
        $this->assertTrue(Gate::forUser($owner)->allows('manage', $event));
        $this->assertInstanceOf(EventPolicy::class, Gate::getPolicyFor($event));
    }
}
