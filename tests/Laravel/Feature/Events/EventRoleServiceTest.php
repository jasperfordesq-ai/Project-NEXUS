<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Enums\EventStaffAssignmentStatus;
use App\Enums\EventStaffCapability;
use App\Enums\EventStaffRole;
use App\Exceptions\EventRoleAssignmentException;
use App\Models\EventStaffAssignment;
use App\Models\EventStaffAssignmentHistory;
use App\Models\User;
use App\Services\EventRoleService;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use LogicException;
use Tests\Laravel\TestCase;

final class EventRoleServiceTest extends TestCase
{
    use DatabaseTransactions;

    private EventRoleService $service;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        $this->service = new EventRoleService();
    }

    public function test_owner_grants_lists_and_resolves_a_tenant_scoped_role(): void
    {
        $owner = $this->user();
        $staff = $this->user();
        $eventId = $this->event((int) $owner->id);

        $result = $this->service->grant(
            $eventId,
            (int) $staff->id,
            EventStaffRole::RegistrationManager,
            $owner,
            now()->addMonth(),
        );

        self::assertTrue($result['changed']);
        self::assertNotNull($result['history_id']);
        self::assertNotNull($result['outbox_id']);
        self::assertSame(EventStaffRole::RegistrationManager, $result['assignment']->role);
        self::assertSame(EventStaffAssignmentStatus::Active, $result['assignment']->status);
        self::assertSame(1, $result['assignment']->assignment_version);
        self::assertSame((int) $owner->id, (int) $result['assignment']->granted_by);
        self::assertCount(1, $this->service->list($eventId, $owner));

        self::assertSame([
            EventStaffCapability::View,
            EventStaffCapability::ViewRoster,
            EventStaffCapability::ViewWaitlist,
            EventStaffCapability::ExportPeople,
            EventStaffCapability::ManageRegistration,
        ], $this->service->capabilitiesForUser($eventId, (int) $staff->id));
        self::assertTrue($this->service->hasCapability(
            $eventId,
            (int) $staff->id,
            EventStaffCapability::ViewRoster,
        ));
        self::assertFalse($this->service->hasCapability(
            $eventId,
            (int) $staff->id,
            EventStaffCapability::ManageFinance,
        ));

        $history = DB::table('event_staff_assignment_history')->first();
        self::assertNotNull($history);
        self::assertSame('granted', $history->action);
        self::assertNull($history->from_status);
        self::assertSame('active', $history->to_status);
        self::assertSame(1, (int) $history->assignment_version);

        $outbox = DB::table('event_domain_outbox')->where('id', $result['outbox_id'])->first();
        self::assertNotNull($outbox);
        self::assertSame('event.staff_role.granted', $outbox->action);
    }

    public function test_grant_revoke_and_regrant_are_idempotent_and_monotonic(): void
    {
        $owner = $this->user();
        $staff = $this->user();
        $eventId = $this->event((int) $owner->id);
        $expiry = CarbonImmutable::now()->addMonth()->startOfSecond();

        $first = $this->service->grant(
            $eventId,
            (int) $staff->id,
            EventStaffRole::CommunicationsManager,
            $owner,
            $expiry,
        );
        $replay = $this->service->grant(
            $eventId,
            (int) $staff->id,
            EventStaffRole::CommunicationsManager,
            $owner,
            $expiry,
        );
        self::assertTrue($first['changed']);
        self::assertFalse($replay['changed']);
        self::assertSame(1, $replay['assignment']->assignment_version);
        self::assertSame(1, $this->historyCount($eventId));
        self::assertSame(1, $this->outboxCount($eventId));

        $revoked = $this->service->revoke(
            $eventId,
            (int) $staff->id,
            EventStaffRole::CommunicationsManager,
            $owner,
        );
        $revokeReplay = $this->service->revoke(
            $eventId,
            (int) $staff->id,
            EventStaffRole::CommunicationsManager,
            $owner,
        );
        self::assertTrue($revoked['changed']);
        self::assertFalse($revokeReplay['changed']);
        self::assertSame(2, $revokeReplay['assignment']->assignment_version);
        self::assertSame(2, $this->historyCount($eventId));
        self::assertSame(2, $this->outboxCount($eventId));
        self::assertSame([], $this->service->capabilitiesForUser($eventId, (int) $staff->id));

        $regranted = $this->service->grant(
            $eventId,
            (int) $staff->id,
            EventStaffRole::CommunicationsManager,
            $owner,
            null,
        );
        self::assertTrue($regranted['changed']);
        self::assertSame(3, $regranted['assignment']->assignment_version);
        self::assertSame(3, $this->historyCount($eventId));
        self::assertSame(3, $this->outboxCount($eventId));
        self::assertSame(
            ['granted', 'revoked', 'granted'],
            DB::table('event_staff_assignment_history')
                ->where('event_id', $eventId)
                ->orderBy('assignment_version')
                ->pluck('action')
                ->all(),
        );
    }

    public function test_tenant_admin_can_manage_roles_but_members_and_implicit_owner_assignment_are_denied(): void
    {
        $owner = $this->user();
        $admin = $this->user(['role' => 'tenant_admin']);
        $member = $this->user();
        $staff = $this->user();
        $eventId = $this->event((int) $owner->id);

        $adminGrant = $this->service->grant(
            $eventId,
            (int) $staff->id,
            EventStaffRole::CheckInStaff,
            $admin,
        );
        self::assertTrue($adminGrant['changed']);

        $this->assertReason(
            'event_staff_role_authorization_denied',
            fn () => $this->service->grant(
                $eventId,
                (int) $member->id,
                EventStaffRole::FinanceManager,
                $member,
            ),
        );
        $this->assertReason(
            'event_staff_role_authorization_denied',
            fn () => $this->service->revoke(
                $eventId,
                (int) $staff->id,
                EventStaffRole::CheckInStaff,
                $member,
            ),
        );
        $this->assertReason(
            'event_staff_role_owner_implicit',
            fn () => $this->service->grant(
                $eventId,
                (int) $owner->id,
                EventStaffRole::CoOrganizer,
                $owner,
            ),
        );
    }

    public function test_broker_and_coordinator_stale_admin_flags_never_grant_implicit_staff_authority(): void
    {
        $owner = $this->user();
        $target = $this->user();
        $eventId = $this->event((int) $owner->id);

        foreach (['broker', 'coordinator'] as $role) {
            $actor = $this->user([
                'role' => $role,
                'is_admin' => true,
                'is_super_admin' => true,
                'is_tenant_super_admin' => true,
            ]);

            $this->assertReason(
                'event_staff_role_authorization_denied',
                fn () => $this->service->grant(
                    $eventId,
                    (int) $target->id,
                    EventStaffRole::CheckInStaff,
                    $actor,
                ),
            );
        }

        self::assertSame(0, DB::table('event_staff_assignments')->where('event_id', $eventId)->count());
    }

    public function test_co_organizer_can_manage_only_subordinate_operational_roles(): void
    {
        $owner = $this->user();
        $coOrganizer = $this->user();
        $staff = $this->user();
        $eventId = $this->event((int) $owner->id);

        $this->service->grant(
            $eventId,
            (int) $coOrganizer->id,
            EventStaffRole::CoOrganizer,
            $owner,
        );

        self::assertCount(1, $this->service->list($eventId, $coOrganizer));
        $delegated = $this->service->grant(
            $eventId,
            (int) $staff->id,
            EventStaffRole::RegistrationManager,
            $coOrganizer,
        );
        self::assertTrue($delegated['changed']);

        $this->assertReason(
            'event_staff_role_privilege_escalation_denied',
            fn () => $this->service->grant(
                $eventId,
                (int) $staff->id,
                EventStaffRole::FinanceManager,
                $coOrganizer,
            ),
        );
        $this->assertReason(
            'event_staff_role_privilege_escalation_denied',
            fn () => $this->service->grant(
                $eventId,
                (int) $staff->id,
                EventStaffRole::CoOrganizer,
                $coOrganizer,
            ),
        );

        $revoked = $this->service->revoke(
            $eventId,
            (int) $staff->id,
            EventStaffRole::RegistrationManager,
            $coOrganizer,
        );
        self::assertTrue($revoked['changed']);

        $this->service->revoke(
            $eventId,
            (int) $coOrganizer->id,
            EventStaffRole::CoOrganizer,
            $owner,
        );
        $this->assertReason(
            'event_staff_role_authorization_denied',
            fn () => $this->service->list($eventId, $coOrganizer),
        );
    }

    public function test_accepted_grant_replays_after_expiry_without_renewing_access(): void
    {
        $owner = $this->user();
        $staff = $this->user();
        $eventId = $this->event((int) $owner->id);
        $expiry = CarbonImmutable::now()->addHour()->startOfSecond();
        $first = $this->service->grant($eventId, (int) $staff->id,
            EventStaffRole::CheckInStaff, $owner, $expiry, 'expired-grant-recovery');

        try {
            CarbonImmutable::setTestNow($expiry->addSecond());
            $replay = $this->service->grant($eventId, (int) $staff->id,
                EventStaffRole::CheckInStaff, $owner, $expiry, 'expired-grant-recovery');
            self::assertFalse($replay['changed']);
            self::assertSame($first['history_id'], $replay['history_id']);
            self::assertNull($replay['outbox_id']);
            self::assertSame(1, $replay['assignment']->assignment_version);
            self::assertSame(1, $this->historyCount($eventId));
            self::assertSame([], $this->service->capabilitiesForUser($eventId, (int) $staff->id));
            $this->assertReason('event_staff_role_expiry_not_future', fn () =>
                $this->service->grant($eventId, (int) $staff->id,
                    EventStaffRole::CheckInStaff, $owner, $expiry, 'new-expired-grant'));
        } finally {
            CarbonImmutable::setTestNow();
        }
    }

    public function test_idempotency_keys_replay_the_same_mutation_and_reject_reuse(): void
    {
        $owner = $this->user();
        $staff = $this->user();
        $eventId = $this->event((int) $owner->id);
        $expiry = CarbonImmutable::now()->addMonth()->startOfSecond();

        $first = $this->service->grant(
            $eventId,
            (int) $staff->id,
            EventStaffRole::CommunicationsManager,
            $owner,
            $expiry,
            'event-staff-grant-1',
        );
        $replay = $this->service->grant(
            $eventId,
            (int) $staff->id,
            EventStaffRole::CommunicationsManager,
            $owner,
            $expiry,
            'event-staff-grant-1',
        );

        self::assertTrue($first['changed']);
        self::assertFalse($replay['changed']);
        self::assertSame($first['history_id'], $replay['history_id']);
        self::assertSame(1, $this->historyCount($eventId));
        self::assertSame(1, $this->outboxCount($eventId));
        self::assertSame(
            'event-staff-grant-1',
            DB::table('event_staff_assignment_history')->value('idempotency_key'),
        );

        $this->assertReason(
            'event_staff_role_idempotency_conflict',
            fn () => $this->service->grant(
                $eventId,
                (int) $staff->id,
                EventStaffRole::CheckInStaff,
                $owner,
                null,
                'event-staff-grant-1',
            ),
        );

        $revoked = $this->service->revoke(
            $eventId,
            (int) $staff->id,
            EventStaffRole::CommunicationsManager,
            $owner,
            'event-staff-revoke-1',
        );
        $revokeReplay = $this->service->revoke(
            $eventId,
            (int) $staff->id,
            EventStaffRole::CommunicationsManager,
            $owner,
            'event-staff-revoke-1',
        );
        self::assertTrue($revoked['changed']);
        self::assertFalse($revokeReplay['changed']);
        self::assertSame($revoked['history_id'], $revokeReplay['history_id']);
        self::assertSame(2, $this->historyCount($eventId));
        self::assertSame(2, $this->outboxCount($eventId));
    }

    public function test_cross_tenant_event_target_and_actor_fail_closed(): void
    {
        $assignmentCount = DB::table('event_staff_assignments')->count();
        $historyCount = DB::table('event_staff_assignment_history')->count();
        $owner = $this->user();
        $staff = $this->user();
        $eventId = $this->event((int) $owner->id);
        $foreignOwner = $this->user([], 999);
        $foreignStaff = $this->user([], 999);
        $foreignEvent = $this->event((int) $foreignOwner->id, 999);

        TenantContext::setById($this->testTenantId);
        $this->assertReason(
            'event_staff_role_target_invalid',
            fn () => $this->service->grant(
                $eventId,
                (int) $foreignStaff->id,
                EventStaffRole::CheckInStaff,
                $owner,
            ),
        );
        $this->assertReason(
            'event_staff_role_event_not_found',
            fn () => $this->service->grant(
                $foreignEvent,
                (int) $staff->id,
                EventStaffRole::CheckInStaff,
                $owner,
            ),
        );
        $this->assertReason(
            'event_staff_role_actor_invalid',
            fn () => $this->service->grant(
                $eventId,
                (int) $staff->id,
                EventStaffRole::CheckInStaff,
                $foreignOwner,
            ),
        );
        self::assertSame($assignmentCount, DB::table('event_staff_assignments')->count());
        self::assertSame($historyCount, DB::table('event_staff_assignment_history')->count());
        self::assertSame(0, $this->outboxCount($eventId));
    }

    public function test_expiry_is_enforced_and_past_expiry_is_rejected(): void
    {
        $now = CarbonImmutable::parse('2026-07-11 12:00:00', 'UTC');
        CarbonImmutable::setTestNow($now);

        try {
            $owner = $this->user();
            $staff = $this->user();
            $eventId = $this->event((int) $owner->id);

            $this->service->grant(
                $eventId,
                (int) $staff->id,
                EventStaffRole::FinanceManager,
                $owner,
                $now->addHour(),
            );
            self::assertTrue($this->service->hasCapability(
                $eventId,
                (int) $staff->id,
                EventStaffCapability::ManageFinance,
            ));

            CarbonImmutable::setTestNow($now->addHours(2));
            self::assertSame([], $this->service->capabilitiesForUser($eventId, (int) $staff->id));
            self::assertCount(0, $this->service->list($eventId, $owner));
            self::assertCount(1, $this->service->list($eventId, $owner, true));

            $this->assertReason(
                'event_staff_role_expiry_not_future',
                fn () => $this->service->grant(
                    $eventId,
                    (int) $staff->id,
                    EventStaffRole::FinanceManager,
                    $owner,
                    $now,
                ),
            );
        } finally {
            CarbonImmutable::setTestNow();
        }
    }

    public function test_history_and_assignment_deletion_are_immutable(): void
    {
        $owner = $this->user();
        $staff = $this->user();
        $eventId = $this->event((int) $owner->id);
        $result = $this->service->grant(
            $eventId,
            (int) $staff->id,
            EventStaffRole::CheckInStaff,
            $owner,
        );

        try {
            DB::table('event_staff_assignment_history')
                ->where('id', $result['history_id'])
                ->update(['action' => 'tampered']);
            self::fail('Database trigger allowed event staff history mutation.');
        } catch (QueryException $exception) {
            self::assertStringContainsString('event_staff_assignment_history_immutable', $exception->getMessage());
        }

        try {
            DB::table('event_staff_assignment_history')
                ->where('id', $result['history_id'])
                ->delete();
            self::fail('Database trigger allowed event staff history deletion.');
        } catch (QueryException $exception) {
            self::assertStringContainsString('event_staff_assignment_history_immutable', $exception->getMessage());
        }

        $history = EventStaffAssignmentHistory::withoutGlobalScopes()->findOrFail($result['history_id']);
        $history->forceFill(['action' => 'tampered']);
        try {
            $history->save();
            self::fail('History model allowed mutation.');
        } catch (LogicException $exception) {
            self::assertSame('event_staff_assignment_history_immutable', $exception->getMessage());
        }
        try {
            $history->delete();
            self::fail('History model allowed deletion.');
        } catch (LogicException $exception) {
            self::assertSame('event_staff_assignment_history_immutable', $exception->getMessage());
        }

        $assignment = EventStaffAssignment::withoutGlobalScopes()->findOrFail($result['assignment']->id);
        try {
            $assignment->delete();
            self::fail('Assignment model allowed destructive deletion instead of revocation.');
        } catch (LogicException $exception) {
            self::assertSame('event_staff_assignment_delete_forbidden', $exception->getMessage());
        }
    }

    private function user(array $overrides = [], int $tenantId = 2): User
    {
        $user = User::factory()->forTenant($tenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
        TenantContext::setById($this->testTenantId);

        return $user;
    }

    private function event(int $ownerId, int $tenantId = 2): int
    {
        $start = now()->addWeek();

        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $ownerId,
            'title' => 'Event role fixture',
            'description' => 'Event role fixture.',
            'start_time' => $start,
            'end_time' => $start->copy()->addHour(),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function historyCount(int $eventId): int
    {
        return DB::table('event_staff_assignment_history')->where('event_id', $eventId)->count();
    }

    private function outboxCount(int $eventId): int
    {
        return DB::table('event_domain_outbox')
            ->where('event_id', $eventId)
            ->where('action', 'like', 'event.staff_role.%')
            ->count();
    }

    /** @param callable():mixed $operation */
    private function assertReason(string $reason, callable $operation): void
    {
        try {
            $operation();
            self::fail("Expected {$reason}.");
        } catch (EventRoleAssignmentException $exception) {
            self::assertSame($reason, $exception->reasonCode);
        }
    }
}
