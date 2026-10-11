<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Enums\EventStaffRole;
use App\Exceptions\EventRoleAssignmentException;
use App\Services\EventRoleService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Concerns\MakesCrossTenantEventActors;
use Tests\Laravel\TestCase;

/**
 * The event Team tab for a manager whose own account lives on another community.
 *
 * EventStaffController::actor() and EventRoleService's two actor lookups
 * (authorizeEventManager, lockMutationSubjects) carried `users.tenant_id =
 * current tenant`, so a network admin overseeing this community — or a platform
 * admin from elsewhere — could not even open the staff list. The same bug family
 * as 766b867d2 / 6adcd4ff6. Once the actor is resolved by id alone, the service's
 * own admin test must be the confined one (TenantAdminScope, f9b568a05), not the
 * tenant-unaware AdminTier, or every community's admin would gain this tab: the
 * unrelated-admin cases below pin that.
 */
final class EventStaffCrossTenantManagerTest extends TestCase
{
    use DatabaseTransactions;
    use MakesCrossTenantEventActors;

    private EventRoleService $roles;

    protected function setUp(): void
    {
        parent::setUp();
        $this->roles = app(EventRoleService::class);
    }

    // ---- authorised cross-community actors ---------------------------------

    public function test_overseeing_network_admin_can_list_and_grant_staff(): void
    {
        $this->makeNetworkOverseeEventTenant();
        $admin = $this->overseeingNetworkAdmin();
        $owner = $this->eventTenantUser();
        $helper = $this->eventTenantUser();
        $eventId = $this->crossTenantFixtureEvent((int) $owner->id);

        $result = $this->roles->grant($eventId, (int) $helper->id, EventStaffRole::CheckInStaff, $admin);

        self::assertTrue($result['changed']);
        self::assertSame((int) $admin->id, (int) $result['assignment']->granted_by);
        self::assertCount(1, $this->roles->list($eventId, $admin));
    }

    public function test_overseeing_network_admin_can_revoke_staff(): void
    {
        $this->makeNetworkOverseeEventTenant();
        $admin = $this->overseeingNetworkAdmin();
        $owner = $this->eventTenantUser();
        $helper = $this->eventTenantUser();
        $eventId = $this->crossTenantFixtureEvent((int) $owner->id);
        $this->roles->grant($eventId, (int) $helper->id, EventStaffRole::CheckInStaff, $owner);

        $result = $this->roles->revoke($eventId, (int) $helper->id, EventStaffRole::CheckInStaff, $admin);

        self::assertTrue($result['changed']);
        self::assertSame('revoked', (string) $result['assignment']?->getRawOriginal('status'));
    }

    public function test_cross_tenant_organiser_can_manage_their_own_event_team(): void
    {
        $this->makeNetworkOverseeEventTenant();
        $organiser = $this->crossTenantActorUser($this->networkHomeTenantId);
        $helper = $this->eventTenantUser();
        $eventId = $this->crossTenantFixtureEvent((int) $organiser->id);

        $result = $this->roles->grant($eventId, (int) $helper->id, EventStaffRole::RegistrationManager, $organiser);

        self::assertTrue($result['changed']);
    }

    public function test_cross_tenant_platform_admin_can_open_the_team_tab_over_http(): void
    {
        $admin = $this->crossTenantPlatformAdmin();
        $owner = $this->eventTenantUser();
        $helper = $this->eventTenantUser();
        $eventId = $this->crossTenantFixtureEvent((int) $owner->id);

        Sanctum::actingAs($admin, ['*']);
        $this->apiGet("/v2/events/{$eventId}/staff")->assertOk();
        $this->apiPost("/v2/events/{$eventId}/staff", [
            'user_id' => (int) $helper->id,
            'role' => EventStaffRole::CheckInStaff->value,
        ])->assertCreated();
    }

    // ---- staff still have to be members of the event's community -----------

    public function test_a_member_of_another_community_cannot_be_made_staff(): void
    {
        $this->makeNetworkOverseeEventTenant();
        $admin = $this->overseeingNetworkAdmin();
        $owner = $this->eventTenantUser();
        $outsider = $this->crossTenantMember();
        $eventId = $this->crossTenantFixtureEvent((int) $owner->id);

        $this->assertRefused(
            ['event_staff_role_target_invalid'],
            fn () => $this->roles->grant($eventId, (int) $outsider->id, EventStaffRole::CheckInStaff, $admin),
        );
    }

    // ---- refusals that must hold before and after --------------------------

    public function test_member_of_another_community_is_refused(): void
    {
        $this->makeNetworkOverseeEventTenant();
        $stranger = $this->crossTenantMember();
        $owner = $this->eventTenantUser();
        $helper = $this->eventTenantUser();
        $eventId = $this->crossTenantFixtureEvent((int) $owner->id);

        $this->assertRefused(
            ['event_staff_role_actor_invalid', 'event_staff_role_authorization_denied'],
            fn () => $this->roles->list($eventId, $stranger),
        );
        $this->assertRefused(
            ['event_staff_role_actor_invalid', 'event_staff_role_authorization_denied'],
            fn () => $this->roles->grant($eventId, (int) $helper->id, EventStaffRole::CheckInStaff, $stranger),
        );
        self::assertSame(0, DB::table('event_staff_assignments')->where('event_id', $eventId)->count());

        Sanctum::actingAs($stranger, ['*']);
        $this->apiGet("/v2/events/{$eventId}/staff")->assertForbidden();
    }

    public function test_admin_of_an_unrelated_community_is_refused(): void
    {
        $this->makeNetworkOverseeEventTenant();
        $foreignAdmin = $this->unrelatedCommunityAdmin();
        $owner = $this->eventTenantUser();
        $helper = $this->eventTenantUser();
        $eventId = $this->crossTenantFixtureEvent((int) $owner->id);

        $this->assertRefused(
            ['event_staff_role_actor_invalid', 'event_staff_role_authorization_denied'],
            fn () => $this->roles->list($eventId, $foreignAdmin),
        );
        $this->assertRefused(
            ['event_staff_role_actor_invalid', 'event_staff_role_authorization_denied'],
            fn () => $this->roles->grant($eventId, (int) $helper->id, EventStaffRole::CoOrganizer, $foreignAdmin),
        );
        self::assertSame(0, DB::table('event_staff_assignments')->where('event_id', $eventId)->count());

        Sanctum::actingAs($foreignAdmin, ['*']);
        $this->apiGet("/v2/events/{$eventId}/staff")->assertForbidden();
    }

    public function test_local_admin_keeps_staff_authority(): void
    {
        $localAdmin = $this->eventTenantUser(['role' => 'admin', 'is_admin' => 1]);
        $owner = $this->eventTenantUser();
        $helper = $this->eventTenantUser();
        $eventId = $this->crossTenantFixtureEvent((int) $owner->id);

        $result = $this->roles->grant($eventId, (int) $helper->id, EventStaffRole::CoOrganizer, $localAdmin);

        self::assertTrue($result['changed']);
    }

    /** @param list<string> $reasons */
    private function assertRefused(array $reasons, callable $callback): void
    {
        try {
            $callback();
            self::fail('Expected the staff action to be refused.');
        } catch (EventRoleAssignmentException $exception) {
            self::assertContains($exception->reasonCode, $reasons);
        }
    }
}
