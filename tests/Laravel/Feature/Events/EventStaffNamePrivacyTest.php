<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Enums\EventStaffRole;
use App\Http\Resources\EventStaffResource;
use App\Models\EventStaffAssignment;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-591: the event team list is read by organisers, who are ordinary
 * members. Under F-084 surnames are for administrators only, and an
 * organisation account is shown by its trading name — never its contact
 * person.
 */
final class EventStaffNamePrivacyTest extends TestCase
{
    use DatabaseTransactions;

    public function test_an_ordinary_organiser_sees_team_members_without_surnames(): void
    {
        $owner = $this->user(['first_name' => 'Owner', 'last_name' => 'Person']);
        $person = $this->user(['first_name' => 'Staff', 'last_name' => 'Surname']);
        $organisation = $this->user([
            'first_name' => 'Contact',
            'last_name' => 'Person',
            'profile_type' => 'organisation',
            'organization_name' => 'Riverside Repair Collective',
        ]);
        $eventId = $this->event((int) $owner->id);
        Sanctum::actingAs($owner, ['*']);

        foreach ([[$person, 'f591-person'], [$organisation, 'f591-org']] as [$member, $key]) {
            $this->apiPost("/v2/events/{$eventId}/staff", [
                'user_id' => (int) $member->id,
                'role' => EventStaffRole::CheckInStaff->value,
            ], ['Idempotency-Key' => $key])->assertCreated();
        }

        $rows = collect($this->apiGet("/v2/events/{$eventId}/staff")->assertOk()->json('data'))
            ->keyBy(static fn (array $row): int => (int) $row['member']['id']);

        $personRow = $rows[(int) $person->id]['member'];
        self::assertSame('Staff', $personRow['name']);
        self::assertSame('Staff', $personRow['first_name']);
        self::assertArrayNotHasKey('last_name', $personRow);

        $orgRow = $rows[(int) $organisation->id]['member'];
        self::assertSame('Riverside Repair Collective', $orgRow['name']);
        self::assertArrayNotHasKey('last_name', $orgRow);
        self::assertNull($orgRow['first_name'], 'The contact person must not be exposed for an organisation.');

        $encoded = (string) json_encode($rows->all());
        self::assertStringNotContainsString('Surname', $encoded);
        self::assertStringNotContainsString('Contact', $encoded);
    }

    public function test_an_administrator_keeps_full_names(): void
    {
        $owner = $this->user(['first_name' => 'Owner']);
        $person = $this->user(['first_name' => 'Staff', 'last_name' => 'Surname']);
        $eventId = $this->event((int) $owner->id);
        Sanctum::actingAs($owner, ['*']);
        $assignmentId = (int) $this->apiPost("/v2/events/{$eventId}/staff", [
            'user_id' => (int) $person->id,
            'role' => EventStaffRole::CheckInStaff->value,
        ], ['Idempotency-Key' => 'f591-admin'])->assertCreated()->json('data.assignment.id');

        $assignment = EventStaffAssignment::query()
            ->with('user:id,tenant_id,first_name,last_name,profile_type,organization_name,avatar_url')
            ->findOrFail($assignmentId);

        $member = EventStaffResource::fromModel($assignment, null, true)['member'];
        self::assertSame('Staff Surname', $member['name']);
        self::assertSame('Surname', $member['last_name']);
    }

    public function test_a_community_administrator_reading_the_team_list_sees_full_names(): void
    {
        $owner = $this->user(['first_name' => 'Owner']);
        $admin = $this->user(['first_name' => 'Ada', 'role' => 'admin']);
        $person = $this->user(['first_name' => 'Staff', 'last_name' => 'Surname']);
        $eventId = $this->event((int) $owner->id);
        Sanctum::actingAs($owner, ['*']);
        $this->apiPost("/v2/events/{$eventId}/staff", [
            'user_id' => (int) $person->id,
            'role' => EventStaffRole::CheckInStaff->value,
        ], ['Idempotency-Key' => 'f591-admin-api'])->assertCreated();

        Sanctum::actingAs($admin, ['*']);
        $rows = collect($this->apiGet("/v2/events/{$eventId}/staff")->assertOk()->json('data'));
        $member = $rows->firstWhere('member.id', (int) $person->id)['member'];
        self::assertSame('Staff Surname', $member['name']);
        self::assertSame('Surname', $member['last_name']);
    }

    /** @param array<string,mixed> $overrides */
    private function user(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
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
            'title' => 'F-591 staff fixture',
            'description' => 'F-591 staff fixture.',
            'start_time' => $start,
            'end_time' => $start->copy()->addHour(),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
