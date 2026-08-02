<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Enums\EventStaffRole;
use App\Models\User;
use App\Services\EventRoleService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

final class EventStaffControllerTest extends TestCase
{
    use DatabaseTransactions;

    public function test_routes_require_authentication(): void
    {
        $this->apiGet('/v2/events/1/staff')->assertUnauthorized();
        $this->apiPost('/v2/events/1/staff', [
            'user_id' => 1,
            'role' => EventStaffRole::CheckInStaff->value,
        ])->assertUnauthorized();
        $this->apiDelete('/v2/events/1/staff/1')->assertUnauthorized();
    }

    public function test_owner_can_grant_list_and_revoke_with_versioned_idempotent_history(): void
    {
        $owner = $this->user(['first_name' => 'Owner']);
        $staff = $this->user(['first_name' => 'Staff', 'last_name' => 'Member']);
        $eventId = $this->event((int) $owner->id);
        Sanctum::actingAs($owner, ['*']);

        $payload = [
            'user_id' => (int) $staff->id,
            'role' => EventStaffRole::CommunicationsManager->value,
            'expires_at' => now()->addMonth()->startOfSecond()->toAtomString(),
        ];
        $headers = ['Idempotency-Key' => 'staff-api-grant-1'];
        $created = $this->apiPost("/v2/events/{$eventId}/staff", $payload, $headers);
        $created->assertCreated()
            ->assertJsonPath('data.changed', true)
            ->assertJsonPath('data.idempotent_replay', false)
            ->assertJsonPath('data.assignment.member.id', (int) $staff->id)
            ->assertJsonPath('data.assignment.member.name', 'Staff Member')
            ->assertJsonPath('data.assignment.role', EventStaffRole::CommunicationsManager->value)
            ->assertJsonPath('data.assignment.version', 1)
            ->assertJsonPath('data.assignment.history_metadata.immutable', true)
            ->assertJsonPath('data.assignment.history_metadata.entry_count', 1)
            ->assertJsonPath('data.assignment.history.0.idempotency_key', 'staff-api-grant-1')
            ->assertJsonPath('data.assignment.history.0.immutable', true);
        $assignmentId = (int) $created->json('data.assignment.id');
        $historyId = (int) $created->json('data.history_entry_id');

        $this->apiPost("/v2/events/{$eventId}/staff", $payload, $headers)
            ->assertOk()
            ->assertJsonPath('data.changed', false)
            ->assertJsonPath('data.idempotent_replay', true)
            ->assertJsonPath('data.history_entry_id', $historyId)
            ->assertJsonPath('data.assignment.version', 1);
        // Scoped to THIS assignment: the table is append-only (a trigger blocks
        // DELETE), so an unscoped count only ever passed against a pristine
        // database and failed for good after any interrupted run left a row.
        $this->assertSame(
            1,
            DB::table('event_staff_assignment_history')->where('assignment_id', $assignmentId)->count(),
        );

        $this->apiGet("/v2/events/{$eventId}/staff")
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $assignmentId)
            ->assertJsonPath(
                'meta.role_capabilities.co_organizer.5',
                'manageStaff',
            );

        $deleteHeaders = ['Idempotency-Key' => 'staff-api-revoke-1'];
        $this->apiDelete(
            "/v2/events/{$eventId}/staff/{$assignmentId}",
            [],
            $deleteHeaders,
        )->assertOk()
            ->assertJsonPath('data.changed', true)
            ->assertJsonPath('data.assignment.status', 'revoked')
            ->assertJsonPath('data.assignment.effective', false)
            ->assertJsonPath('data.assignment.version', 2)
            ->assertJsonPath('data.assignment.history_metadata.entry_count', 2);

        $this->apiDelete(
            "/v2/events/{$eventId}/staff/{$assignmentId}",
            [],
            $deleteHeaders,
        )->assertOk()
            ->assertJsonPath('data.changed', false)
            ->assertJsonPath('data.idempotent_replay', true)
            ->assertJsonPath('data.assignment.version', 2);
        $this->assertSame(
            2,
            DB::table('event_staff_assignment_history')->where('assignment_id', $assignmentId)->count(),
        );

        $this->apiGet("/v2/events/{$eventId}/staff")
            ->assertOk()
            ->assertJsonCount(0, 'data');
        $this->apiGet("/v2/events/{$eventId}/staff?include_inactive=true")
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.status', 'revoked');
    }

    public function test_co_organizer_delegation_is_contained_and_owner_role_is_rejected(): void
    {
        $owner = $this->user();
        $coOrganizer = $this->user();
        $staff = $this->user();
        $member = $this->user();
        $eventId = $this->event((int) $owner->id);
        TenantContext::setById($this->testTenantId);
        (new EventRoleService())->grant(
            $eventId,
            (int) $coOrganizer->id,
            EventStaffRole::CoOrganizer,
            $owner,
        );

        Sanctum::actingAs($coOrganizer, ['*']);
        $this->apiGet("/v2/events/{$eventId}/staff")->assertOk();
        $this->apiPost("/v2/events/{$eventId}/staff", [
            'user_id' => (int) $staff->id,
            'role' => EventStaffRole::RegistrationManager->value,
        ])->assertCreated();
        $this->apiPost("/v2/events/{$eventId}/staff", [
            'user_id' => (int) $staff->id,
            'role' => EventStaffRole::FinanceManager->value,
        ])->assertForbidden()
            ->assertJsonPath('errors.0.code', 'EVENT_STAFF_FORBIDDEN')
            ->assertJsonPath('errors.0.message', __('api.forbidden'));
        $this->apiPost("/v2/events/{$eventId}/staff", [
            'user_id' => (int) $staff->id,
            'role' => EventStaffRole::CoOrganizer->value,
        ])->assertForbidden()
            ->assertJsonPath('errors.0.code', 'EVENT_STAFF_FORBIDDEN');
        $this->apiPost("/v2/events/{$eventId}/staff", [
            'user_id' => (int) $staff->id,
            'role' => 'owner',
        ])->assertUnprocessable()
            ->assertJsonPath('errors.0.code', 'EVENT_STAFF_OWNER_ROLE_IMPLICIT')
            ->assertJsonPath('errors.0.field', 'role');

        Sanctum::actingAs($member, ['*']);
        $this->apiGet("/v2/events/{$eventId}/staff")
            ->assertForbidden()
            ->assertJsonPath('errors.0.code', 'EVENT_STAFF_FORBIDDEN');
    }

    public function test_direct_ids_and_idempotency_reuse_fail_closed_with_stable_errors(): void
    {
        $owner = $this->user();
        $staff = $this->user();
        $foreign = $this->user([], 999);
        $eventId = $this->event((int) $owner->id);
        $foreignEventId = $this->event((int) $foreign->id, 999);
        Sanctum::actingAs($owner, ['*']);

        $this->apiPost("/v2/events/{$eventId}/staff", [
            'user_id' => (int) $foreign->id,
            'role' => EventStaffRole::CheckInStaff->value,
        ])->assertNotFound()
            ->assertJsonPath('errors.0.code', 'USER_NOT_FOUND')
            ->assertJsonPath('errors.0.message', __('api.user_not_found'));
        $this->apiGet("/v2/events/{$foreignEventId}/staff")
            ->assertNotFound()
            ->assertJsonPath('errors.0.code', 'EVENT_NOT_FOUND');

        $headers = ['Idempotency-Key' => 'staff-api-conflict-1'];
        $this->apiPost("/v2/events/{$eventId}/staff", [
            'user_id' => (int) $staff->id,
            'role' => EventStaffRole::CheckInStaff->value,
        ], $headers)->assertCreated();
        $this->apiPost("/v2/events/{$eventId}/staff", [
            'user_id' => (int) $staff->id,
            'role' => EventStaffRole::CommunicationsManager->value,
        ], $headers)->assertConflict()
            ->assertJsonPath('errors.0.code', 'EVENT_STAFF_IDEMPOTENCY_CONFLICT')
            ->assertJsonPath('errors.0.field', 'idempotency_key');

        $this->apiPost("/v2/events/{$eventId}/staff", [
            'user_id' => (int) $staff->id,
            'role' => EventStaffRole::CheckInStaff->value,
            'idempotency_key' => 'body-key',
        ], ['Idempotency-Key' => 'header-key'])
            ->assertUnprocessable()
            ->assertJsonPath('errors.0.code', 'EVENT_STAFF_VALIDATION_FAILED')
            ->assertJsonPath('errors.0.field', 'idempotency_key');
    }

    private function user(array $overrides = [], int $tenantId = 2): User
    {
        $user = User::factory()->forTenant($tenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
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
            'title' => 'Event staff API fixture',
            'description' => 'Event staff API fixture.',
            'start_time' => $start,
            'end_time' => $start->copy()->addHour(),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
