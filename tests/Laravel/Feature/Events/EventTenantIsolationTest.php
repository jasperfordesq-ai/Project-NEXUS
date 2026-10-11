<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Enums\EventStaffRole;
use App\Exceptions\EventLifecycleHistoryException;
use App\Exceptions\EventRoleAssignmentException;
use App\Models\User;
use App\Services\EventLifecycleHistoryQueryService;
use App\Services\EventRoleService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Owner, 11 October 2026: "Admins from one community cannot change events in
 * another community. We don't want cross-tenant leakage. We need tenant
 * isolation." 05a3ee713 and c79a86590 opened an event's Team tab, lifecycle
 * history and calendar actions to managers from other communities; they were
 * reverted before deployment. These tests pin the isolation so it cannot come
 * back: an administrator of another community — with every community-level
 * admin flag, or as a platform administrator — is refused, and nothing is written.
 */
final class EventTenantIsolationTest extends TestCase
{
    use DatabaseTransactions;

    /** @return iterable<string,array{array<string,mixed>,int}> */
    public static function foreignAdministrators(): iterable
    {
        yield 'community admin of another community' => [['role' => 'admin', 'is_admin' => 1], 999];
        yield 'network admin of another community' => [['role' => 'admin', 'is_admin' => 1, 'is_tenant_super_admin' => 1], 999];
        yield 'platform administrator' => [['role' => 'admin', 'is_admin' => 1, 'is_super_admin' => 1, 'is_god' => 1], 1];
    }

    /**
     * @dataProvider foreignAdministrators
     * @param array<string,mixed> $flags
     */
    public function test_an_administrator_from_another_community_cannot_see_or_change_the_event_team(array $flags, int $homeTenant): void
    {
        $owner = $this->member();
        $staff = $this->member();
        $eventId = $this->event((int) $owner->id);
        $foreignAdmin = $this->member($flags, $homeTenant);
        $assignments = DB::table('event_staff_assignments')->count();
        $history = DB::table('event_staff_assignment_history')->count();
        $roles = app(EventRoleService::class);

        TenantContext::setById($this->testTenantId);
        $this->assertRefused(fn () => $roles->list($eventId, $foreignAdmin));
        $this->assertRefused(fn () => $roles->grant($eventId, (int) $staff->id, EventStaffRole::CoOrganizer, $foreignAdmin));

        self::assertSame($assignments, DB::table('event_staff_assignments')->count());
        self::assertSame($history, DB::table('event_staff_assignment_history')->count());
    }

    /**
     * @dataProvider foreignAdministrators
     * @param array<string,mixed> $flags
     */
    public function test_an_administrator_from_another_community_cannot_read_the_event_history(array $flags, int $homeTenant): void
    {
        $owner = $this->member();
        $eventId = $this->event((int) $owner->id);
        $foreignAdmin = $this->member($flags, $homeTenant);

        TenantContext::setById($this->testTenantId);
        try {
            app(EventLifecycleHistoryQueryService::class)->index($eventId, $foreignAdmin);
            self::fail('BAD OUTCOME: an administrator from another community read an event\'s lifecycle history.');
        } catch (EventLifecycleHistoryException) {
            self::assertTrue(true);
        }
    }

    private function assertRefused(callable $operation): void
    {
        try {
            $operation();
            self::fail('BAD OUTCOME: an administrator from another community reached the event team.');
        } catch (EventRoleAssignmentException) {
            self::assertTrue(true);
        }
    }

    /** @param array<string,mixed> $overrides */
    private function member(array $overrides = [], int $tenantId = 2): User
    {
        $user = User::factory()->forTenant($tenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
        ], $overrides));
        TenantContext::setById($this->testTenantId);

        return $user;
    }

    private function event(int $ownerId): int
    {
        $start = now()->addWeek();

        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'title' => 'Tenant isolation fixture',
            'description' => 'Tenant isolation fixture.',
            'start_time' => $start,
            'end_time' => $start->copy()->addHour(),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
