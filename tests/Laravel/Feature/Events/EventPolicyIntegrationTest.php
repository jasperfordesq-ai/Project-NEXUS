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
use App\Services\EventRoleService;
use App\Services\EventService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

final class EventPolicyIntegrationTest extends TestCase
{
    use DatabaseTransactions;

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function user(array $overrides = [], ?int $tenantId = null): User
    {
        return User::factory()->forTenant($tenantId ?? $this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
        ], $overrides));
    }

    private function event(int $organizerId, array $overrides = []): int
    {
        return (int) DB::table('events')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'user_id' => $organizerId,
            'title' => 'Policy-integrated event',
            'description' => 'Exercises the Events policy service boundary.',
            'start_time' => now()->addMinutes(15),
            'end_time' => now()->addHour(),
            'status' => 'active',
            'is_online' => 1,
            'online_link' => 'https://meet.example.test/policy-integration',
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    private function group(int $ownerId, string $visibility = 'private'): int
    {
        return (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $ownerId,
            'name' => 'Policy integration group ' . uniqid(),
            'slug' => 'policy-integration-' . uniqid(),
            'description' => 'Private event audience.',
            'visibility' => $visibility,
            'status' => 'active',
            'is_active' => 1,
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

    private function rsvp(int $eventId, User $user, string $status): void
    {
        DB::table('event_rsvps')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => (int) $user->getKey(),
            'status' => $status,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function series(User $creator): int
    {
        return (int) DB::table('event_series')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'title' => 'Policy integration series',
            'description' => null,
            'created_by' => (int) $creator->getKey(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_canonical_permissions_are_independent_and_meeting_window_remains_mapper_owned(): void
    {
        Carbon::setTestNow('2030-05-01 10:00:00 UTC');
        $organizer = $this->user(['first_name' => 'Organizer']);
        $confirmed = $this->user(['first_name' => 'Confirmed']);
        $unrelated = $this->user(['first_name' => 'Unrelated']);
        $eventId = $this->event((int) $organizer->getKey());
        $this->rsvp($eventId, $confirmed, 'going');

        Sanctum::actingAs($organizer, ['*']);
        $ownerResponse = $this->apiGet(
            "/v2/events/{$eventId}",
            ['X-Events-Contract' => '2']
        );
        $ownerResponse->assertOk()
            ->assertJsonPath('data.permissions.edit', true)
            ->assertJsonPath('data.permissions.manage_people', true)
            ->assertJsonPath('data.permissions.check_in', true)
            ->assertJsonPath('data.permissions.message', true)
            ->assertJsonPath('data.permissions.export', true)
            ->assertJsonPath('data.permissions.manage_agenda', true)
            ->assertJsonPath('data.permissions.manage_staff', true)
            ->assertJsonPath('data.permissions.manage_finance', true)
            ->assertJsonPath('data.permissions.transfer_ownership', true)
            ->assertJsonPath('data.online_access.reveal_state', 'available');

        Sanctum::actingAs($confirmed, ['*']);
        $confirmedResponse = $this->apiGet(
            "/v2/events/{$eventId}",
            ['X-Events-Contract' => '2']
        );
        $confirmedResponse->assertOk()
            ->assertJsonPath('data.permissions.edit', false)
            ->assertJsonPath('data.permissions.manage_people', false)
            ->assertJsonPath('data.permissions.check_in', false)
            ->assertJsonPath('data.permissions.message', false)
            ->assertJsonPath('data.permissions.export', false)
            ->assertJsonPath('data.permissions.manage_agenda', false)
            ->assertJsonPath('data.permissions.manage_staff', false)
            ->assertJsonPath('data.permissions.manage_finance', false)
            ->assertJsonPath('data.permissions.transfer_ownership', false)
            ->assertJsonPath('data.online_access.reveal_state', 'available');

        Carbon::setTestNow('2030-05-01 08:00:00 UTC');
        $this->apiGet("/v2/events/{$eventId}", ['X-Events-Contract' => '2'])
            ->assertOk()
            ->assertJsonPath('data.online_access.reveal_state', 'scheduled')
            ->assertJsonPath('data.online_access.join_url', null);

        Sanctum::actingAs($unrelated, ['*']);
        $this->apiGet("/v2/events/{$eventId}", ['X-Events-Contract' => '2'])
            ->assertOk()
            ->assertJsonPath('data.permissions.edit', false)
            ->assertJsonPath('data.online_access.reveal_state', 'restricted')
            ->assertJsonPath('data.online_access.join_url', null);
    }

    public function test_delegated_roles_reach_the_canonical_contract_without_broad_privilege_leakage(): void
    {
        $organizer = $this->user(['first_name' => 'Organizer']);
        $communications = $this->user(['first_name' => 'Communications']);
        $finance = $this->user(['first_name' => 'Finance']);
        $eventId = $this->event((int) $organizer->getKey());
        TenantContext::setById($this->testTenantId);
        $roles = new EventRoleService();
        $roles->grant(
            $eventId,
            (int) $communications->getKey(),
            EventStaffRole::CommunicationsManager,
            $organizer,
        );
        $roles->grant(
            $eventId,
            (int) $finance->getKey(),
            EventStaffRole::FinanceManager,
            $organizer,
        );

        Sanctum::actingAs($communications, ['*']);
        $this->apiGet("/v2/events/{$eventId}", ['X-Events-Contract' => '2'])
            ->assertOk()
            ->assertJsonPath('data.permissions.edit', false)
            ->assertJsonPath('data.permissions.message', true)
            ->assertJsonPath('data.permissions.broadcast', true)
            ->assertJsonPath('data.permissions.manage_agenda', false)
            ->assertJsonPath('data.permissions.manage_staff', false)
            ->assertJsonPath('data.permissions.manage_finance', false)
            ->assertJsonPath('data.permissions.transfer_ownership', false);

        Sanctum::actingAs($finance, ['*']);
        $this->apiGet("/v2/events/{$eventId}", ['X-Events-Contract' => '2'])
            ->assertOk()
            ->assertJsonPath('data.permissions.edit', false)
            ->assertJsonPath('data.permissions.message', false)
            ->assertJsonPath('data.permissions.manage_agenda', false)
            ->assertJsonPath('data.permissions.manage_finance', true)
            ->assertJsonPath('data.permissions.reconcile_credits', true)
            ->assertJsonPath('data.permissions.reconcile_tickets', true)
            ->assertJsonPath('data.permissions.transfer_ownership', false);
    }

    public function test_complete_roster_and_waitlist_are_manager_only_while_own_position_survives(): void
    {
        $organizer = $this->user(['first_name' => 'Organizer']);
        $confirmed = $this->user(['first_name' => 'Confirmed']);
        $waitlisted = $this->user(['first_name' => 'Waitlisted']);
        $eventId = $this->event((int) $organizer->getKey());
        $this->rsvp($eventId, $confirmed, 'going');
        DB::table('event_waitlist')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => (int) $waitlisted->getKey(),
            'position' => 1,
            'status' => 'waiting',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Owner decision, 9 Nov 2026: a member may see who else is GOING (the
        // narrow member list), but never the complete roster or the waitlist.
        Sanctum::actingAs($confirmed, ['*']);
        $memberView = $this->apiGet("/v2/events/{$eventId}/attendees?status=all", ['X-Events-Contract' => '2'])
            ->assertOk()
            ->json('data');
        $memberIds = array_map(static fn (array $item): int => (int) $item['member']['id'], $memberView);
        $this->assertNotContains((int) $waitlisted->getKey(), $memberIds);
        $this->assertNotContains((int) $organizer->getKey(), $memberIds);
        foreach ($memberView as $item) {
            $this->assertSame('confirmed', $item['registration']['state']);
            $this->assertNull($item['attendance']['checked_in_at']);
        }

        Sanctum::actingAs($waitlisted, ['*']);
        $waitlistResponse = $this->apiGet("/v2/events/{$eventId}/waitlist");
        $waitlistResponse->assertOk()->assertJsonCount(0, 'data');
        $this->assertSame(1, $waitlistResponse->json('meta.user_position'));

        Sanctum::actingAs($organizer, ['*']);
        $this->apiGet("/v2/events/{$eventId}/attendees", ['X-Events-Contract' => '2'])
            ->assertOk()
            ->assertJsonPath('data.0.id', (int) $confirmed->getKey());
        $this->apiGet("/v2/events/{$eventId}/waitlist")
            ->assertOk()
            ->assertJsonPath('data.0.id', (int) $waitlisted->getKey());
    }

    public function test_manage_attendance_and_series_link_share_the_policy_boundary(): void
    {
        $organizer = $this->user(['first_name' => 'Organizer']);
        $attendee = $this->user(['first_name' => 'Attendee']);
        $unrelated = $this->user(['first_name' => 'Unrelated']);
        $eventId = $this->event((int) $organizer->getKey());
        $seriesId = $this->series($organizer);
        $this->rsvp($eventId, $attendee, 'going');

        Sanctum::actingAs($unrelated, ['*']);
        $this->apiPut("/v2/events/{$eventId}", ['title' => 'Forbidden edit'])
            ->assertForbidden();
        $this->apiGet("/v2/events/{$eventId}/attendance")
            ->assertForbidden();
        $this->apiPost("/v2/events/{$eventId}/attendance", ['user_id' => $attendee->id])
            ->assertForbidden();
        $this->apiPost("/v2/events/{$eventId}/series", ['series_id' => $seriesId])
            ->assertForbidden();

        Sanctum::actingAs($organizer, ['*']);
        $this->apiPut("/v2/events/{$eventId}", ['title' => 'Authorised edit'])
            ->assertOk();
        $this->apiPost("/v2/events/{$eventId}/attendance", ['user_id' => $attendee->id])
            ->assertOk();
        $this->apiPost("/v2/events/{$eventId}/series", ['series_id' => $seriesId])
            ->assertOk();

        $this->assertSame(
            'Authorised edit',
            DB::table('events')->where('id', $eventId)->value('title')
        );
        $this->assertSame(
            $seriesId,
            (int) DB::table('events')->where('id', $eventId)->value('series_id')
        );
        $this->assertTrue(
            DB::table('event_attendance')
                ->where('event_id', $eventId)
                ->where('user_id', $attendee->id)
                ->exists()
        );
    }

    public function test_operational_roles_with_stale_admin_flags_receive_no_admin_policy_or_permission_projection(): void
    {
        $owner = $this->user();
        $eventId = $this->event((int) $owner->id, [
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
        ]);
        /** @var Event $event */
        $event = Event::withoutGlobalScopes()->findOrFail($eventId);

        foreach (['broker', 'coordinator'] as $role) {
            $actor = $this->user([
                'role' => $role,
                'is_admin' => true,
                'is_super_admin' => true,
                'is_tenant_super_admin' => true,
            ]);

            self::assertFalse(app(EventPolicy::class)->manage($actor, $event));
            Sanctum::actingAs($actor, ['*']);
            $this->apiGet("/v2/events/{$eventId}", ['X-Events-Contract' => '2'])
                ->assertOk()
                ->assertJsonPath('data.permissions.edit', false)
                ->assertJsonPath('data.permissions.publish', false)
                ->assertJsonPath('data.permissions.manage_staff', false);
            $this->apiGet('/v2/admin/events')->assertForbidden();
        }
    }

    public function test_named_series_count_only_includes_events_visible_to_the_current_actor(): void
    {
        Carbon::setTestNow('2030-05-01 10:00:00 UTC');
        $organizer = $this->user(['first_name' => 'Organizer']);
        $outsider = $this->user(['first_name' => 'Outsider']);
        $privateGroupId = $this->group((int) $organizer->getKey());
        $this->joinGroup($privateGroupId, $organizer, 'owner');
        $seriesId = $this->series($organizer);

        $visibleEventId = $this->event((int) $organizer->getKey(), [
            'title' => 'Visible series event',
            'series_id' => $seriesId,
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'start_time' => now()->addDays(1),
            'end_time' => now()->addDays(1)->addHour(),
        ]);
        $this->event((int) $organizer->getKey(), [
            'title' => 'Private series event',
            'series_id' => $seriesId,
            'group_id' => $privateGroupId,
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'start_time' => now()->addDays(2),
            'end_time' => now()->addDays(2)->addHour(),
        ]);
        $this->event((int) $organizer->getKey(), [
            'title' => 'Draft series event',
            'series_id' => $seriesId,
            'status' => 'draft',
            'publication_status' => 'draft',
            'operational_status' => 'scheduled',
            'start_time' => now()->addDays(3),
            'end_time' => now()->addDays(3)->addHour(),
        ]);

        Sanctum::actingAs($outsider, ['*']);
        $this->apiGet("/v2/events/{$visibleEventId}", ['X-Events-Contract' => '2'])
            ->assertOk()
            ->assertJsonPath('data.series.named.event_count', 1);

        Sanctum::actingAs($organizer, ['*']);
        $this->apiGet("/v2/events/{$visibleEventId}", ['X-Events-Contract' => '2'])
            ->assertOk()
            ->assertJsonPath('data.series.named.event_count', 3);
    }

    public function test_recurrence_projection_omits_private_and_draft_sibling_ids_and_times_for_outsiders(): void
    {
        Carbon::setTestNow('2030-05-01 10:00:00 UTC');
        $organizer = $this->user(['first_name' => 'Organizer']);
        $outsider = $this->user(['first_name' => 'Outsider']);
        $privateGroupId = $this->group((int) $organizer->getKey());
        $this->joinGroup($privateGroupId, $organizer, 'owner');
        $occurrenceKeyPrefix = 'policy-recurrence-' . uniqid();

        $rootId = $this->event((int) $organizer->getKey(), [
            'title' => 'Draft recurrence template',
            'status' => 'draft',
            'publication_status' => 'draft',
            'operational_status' => 'scheduled',
            'is_recurring_template' => 1,
            'occurrence_key' => null,
            'occurrence_date' => now()->addDays(1)->toDateString(),
            'start_time' => now()->addDays(1),
            'end_time' => now()->addDays(1)->addHour(),
        ]);
        $visibleOccurrenceId = $this->event((int) $organizer->getKey(), [
            'title' => 'Visible recurrence occurrence',
            'parent_event_id' => $rootId,
            'is_recurring_template' => 0,
            'occurrence_key' => $occurrenceKeyPrefix . '-visible',
            'occurrence_date' => now()->addDays(2)->toDateString(),
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'start_time' => now()->addDays(2),
            'end_time' => now()->addDays(2)->addHour(),
        ]);
        $draftOccurrenceId = $this->event((int) $organizer->getKey(), [
            'title' => 'Draft recurrence occurrence',
            'parent_event_id' => $rootId,
            'is_recurring_template' => 0,
            'occurrence_key' => $occurrenceKeyPrefix . '-draft',
            'occurrence_date' => now()->addDays(3)->toDateString(),
            'status' => 'draft',
            'publication_status' => 'draft',
            'operational_status' => 'scheduled',
            'start_time' => now()->addDays(3),
            'end_time' => now()->addDays(3)->addHour(),
        ]);
        $privateOccurrenceId = $this->event((int) $organizer->getKey(), [
            'title' => 'Private recurrence occurrence',
            'parent_event_id' => $rootId,
            'is_recurring_template' => 0,
            'occurrence_key' => $occurrenceKeyPrefix . '-private',
            'occurrence_date' => now()->addDays(4)->toDateString(),
            'group_id' => $privateGroupId,
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'start_time' => now()->addDays(4),
            'end_time' => now()->addDays(4)->addHour(),
        ]);

        Sanctum::actingAs($outsider, ['*']);
        $outsiderResponse = $this->apiGet(
            "/v2/events/{$visibleOccurrenceId}",
            ['X-Events-Contract' => '2'],
        );
        $outsiderResponse->assertOk()
            ->assertJsonPath('data.series.recurrence.occurrence_count', 1);
        $outsiderOccurrences = $outsiderResponse->json('data.series.recurrence.occurrences');
        $this->assertSame(
            [$visibleOccurrenceId],
            array_column($outsiderOccurrences, 'id'),
        );
        $this->assertSame(
            ['2030-05-03'],
            array_map(
                static fn (array $occurrence): string => substr((string) $occurrence['start_at'], 0, 10),
                $outsiderOccurrences,
            ),
        );

        Sanctum::actingAs($organizer, ['*']);
        $organizerResponse = $this->apiGet(
            "/v2/events/{$visibleOccurrenceId}",
            ['X-Events-Contract' => '2'],
        );
        $organizerResponse->assertOk()
            ->assertJsonPath('data.series.recurrence.occurrence_count', 4);
        $this->assertSame(
            [$rootId, $visibleOccurrenceId, $draftOccurrenceId, $privateOccurrenceId],
            array_column($organizerResponse->json('data.series.recurrence.occurrences'), 'id'),
        );
    }

    public function test_recurrence_projection_reports_the_full_visible_count_when_the_preview_is_bounded(): void
    {
        Carbon::setTestNow('2030-05-01 10:00:00 UTC');
        $organizer = $this->user(['first_name' => 'Organizer']);
        $rootId = $this->event((int) $organizer->getKey(), [
            'title' => 'Large recurrence template',
            'status' => 'draft',
            'publication_status' => 'draft',
            'operational_status' => 'scheduled',
            'is_recurring_template' => 1,
            'occurrence_key' => null,
            'start_time' => now()->addDay(),
            'end_time' => now()->addDay()->addHour(),
        ]);
        $firstOccurrenceId = null;
        for ($index = 1; $index <= 51; $index++) {
            $occurrenceId = $this->event((int) $organizer->getKey(), [
                'title' => "Large recurrence occurrence {$index}",
                'parent_event_id' => $rootId,
                'is_recurring_template' => 0,
                'occurrence_key' => "large-recurrence-{$rootId}-{$index}",
                'occurrence_date' => now()->addDays($index + 1)->toDateString(),
                'publication_status' => 'published',
                'operational_status' => 'scheduled',
                'start_time' => now()->addDays($index + 1),
                'end_time' => now()->addDays($index + 1)->addHour(),
            ]);
            $firstOccurrenceId ??= $occurrenceId;
        }

        Sanctum::actingAs($organizer, ['*']);
        $response = $this->apiGet(
            "/v2/events/{$firstOccurrenceId}",
            ['X-Events-Contract' => '2'],
        );

        $response->assertOk()
            ->assertJsonPath('data.series.recurrence.occurrence_count', 52);
        $this->assertCount(50, $response->json('data.series.recurrence.occurrences'));
    }

    public function test_private_group_and_cross_tenant_direct_ids_fail_closed(): void
    {
        $organizer = $this->user(['first_name' => 'Organizer']);
        $member = $this->user(['first_name' => 'Member']);
        $groupAdmin = $this->user(['first_name' => 'Group Admin']);
        $outsider = $this->user(['first_name' => 'Outsider']);
        $foreign = $this->user(['first_name' => 'Foreign'], 999);
        $groupId = $this->group((int) $organizer->getKey());
        $this->joinGroup($groupId, $organizer, 'owner');
        $this->joinGroup($groupId, $member);
        $this->joinGroup($groupId, $groupAdmin, 'admin');
        $eventId = $this->event((int) $organizer->getKey(), ['group_id' => $groupId]);

        Sanctum::actingAs($member, ['*']);
        $this->apiGet("/v2/events/{$eventId}")->assertOk();

        Sanctum::actingAs($outsider, ['*']);
        $this->apiGet("/v2/events/{$eventId}")->assertNotFound();

        Sanctum::actingAs($groupAdmin, ['*']);
        $this->apiGet("/v2/events/{$eventId}")->assertOk();
        $this->apiPut("/v2/events/{$eventId}", ['title' => 'Group admin cannot take ownership'])
            ->assertForbidden();

        TenantContext::setById($this->testTenantId);
        $this->assertNull(EventService::getById($eventId, (int) $foreign->getKey()));
    }
}
