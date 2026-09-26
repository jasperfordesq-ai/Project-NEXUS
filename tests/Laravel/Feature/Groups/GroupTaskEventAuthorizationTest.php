<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Groups;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\GroupConfigurationService;
use App\Services\TeamTaskService;
use App\Services\TenantFeatureConfig;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

final class GroupTaskEventAuthorizationTest extends TestCase
{
    use DatabaseTransactions;

    private TeamTaskService $tasks;
    private User $owner;
    private User $member;
    private User $assignee;
    private User $unrelatedMember;
    private User $pendingMember;
    private User $groupAdmin;
    private User $tenantAdmin;
    private User $nonMemberOrganizer;
    private User $foreignUser;
    private int $activeGroupId;
    private int $otherGroupId;
    private int $archivedGroupId;
    private int $foreignGroupId;
    private int $privateEventId;
    private int $archivedEventId;
    private int $foreignLinkedEventId;

    protected function setUp(): void
    {
        parent::setUp();

        $features = array_merge(TenantFeatureConfig::FEATURE_DEFAULTS, [
            'events' => true,
            'groups' => true,
            'ideation_challenges' => true,
        ]);
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode($features, JSON_THROW_ON_ERROR),
        ]);
        TenantContext::setById($this->testTenantId);
        GroupConfigurationService::set(GroupConfigurationService::CONFIG_TAB_TASKS, true);
        Cache::forget("group_config:{$this->testTenantId}");

        $this->tasks = new TeamTaskService();
        $this->owner = $this->user('g06_owner');
        $this->member = $this->user('g06_member');
        $this->assignee = $this->user('g06_assignee');
        $this->unrelatedMember = $this->user('g06_unrelated');
        $this->pendingMember = $this->user('g06_pending');
        $this->groupAdmin = $this->user('g06_group_admin');
        $this->tenantAdmin = User::factory()->forTenant($this->testTenantId)->admin()->create([
            'username' => 'g06_tenant_admin',
        ]);
        $this->nonMemberOrganizer = $this->user('g06_nonmember_organizer');
        $this->foreignUser = User::factory()->forTenant(999)->create([
            'username' => 'g06_foreign_user',
        ]);

        $this->activeGroupId = $this->insertGroup(
            $this->testTenantId,
            (int) $this->owner->id,
            'active',
            'private',
            false,
        );
        $this->otherGroupId = $this->insertGroup(
            $this->testTenantId,
            (int) $this->owner->id,
            'active',
            'private',
        );
        $this->archivedGroupId = $this->insertGroup(
            $this->testTenantId,
            (int) $this->owner->id,
            'archived',
            'private',
            false,
        );
        $this->foreignGroupId = $this->insertGroup(
            999,
            (int) $this->foreignUser->id,
            'active',
            'public',
        );

        foreach ([$this->member, $this->assignee, $this->unrelatedMember] as $member) {
            $this->insertMembership($this->activeGroupId, $member, 'active');
        }
        $this->insertMembership($this->activeGroupId, $this->pendingMember, 'pending');
        $this->insertMembership($this->activeGroupId, $this->groupAdmin, 'active', 'admin');
        $this->insertMembership($this->otherGroupId, $this->assignee, 'active');
        $this->insertMembership($this->archivedGroupId, $this->member, 'active');
        $this->insertMembership($this->archivedGroupId, $this->groupAdmin, 'active', 'admin');

        $this->privateEventId = $this->insertEvent(
            (int) $this->nonMemberOrganizer->id,
            $this->activeGroupId,
            'Private group event',
            1,
        );
        $this->archivedEventId = $this->insertEvent(
            (int) $this->member->id,
            $this->archivedGroupId,
            'Archived group event',
        );
        $this->foreignLinkedEventId = $this->insertEvent(
            (int) $this->member->id,
            $this->foreignGroupId,
            'Foreign-linked event',
        );

        // Model listeners used by user/event fixtures may restore a previously
        // empty CLI tenant. Re-establish the service boundary explicitly.
        TenantContext::setById($this->testTenantId);
    }

    public function test_private_group_event_reads_follow_member_content_not_event_ownership(): void
    {
        foreach ([$this->member, $this->groupAdmin, $this->tenantAdmin, $this->owner] as $actor) {
            Sanctum::actingAs($actor, ['*']);
            $this->apiGet("/v2/events/{$this->privateEventId}")->assertOk();
        }

        foreach ([$this->nonMemberOrganizer, $this->pendingMember] as $actor) {
            Sanctum::actingAs($actor, ['*']);
            $this->apiGet("/v2/events/{$this->privateEventId}")->assertNotFound();

            $ids = array_map('intval', array_column(
                $this->apiGet("/v2/events?when=all&group_id={$this->activeGroupId}&per_page=100")
                    ->assertOk()
                    ->json('data') ?? [],
                'id',
            ));
            $this->assertNotContains($this->privateEventId, $ids);
        }

        Sanctum::actingAs($this->member, ['*']);
        $memberIds = array_map('intval', array_column(
            $this->apiGet("/v2/events?when=all&group_id={$this->activeGroupId}&per_page=100")
                ->assertOk()
                ->json('data') ?? [],
            'id',
        ));
        $this->assertContains($this->privateEventId, $memberIds);

        foreach ([$this->member, $this->tenantAdmin] as $actor) {
            Sanctum::actingAs($actor, ['*']);
            $this->apiGet("/v2/events/{$this->archivedEventId}")->assertNotFound();
            $this->apiGet("/v2/events/{$this->foreignLinkedEventId}")->assertNotFound();
        }
    }

    public function test_private_group_event_participation_and_children_recheck_parent_access(): void
    {
        Sanctum::actingAs($this->nonMemberOrganizer, ['*']);
        $this->apiPost("/v2/events/{$this->privateEventId}/rsvp", ['status' => 'going'])
            ->assertNotFound();
        $this->apiPost("/v2/events/{$this->privateEventId}/waitlist")
            ->assertNotFound();
        $this->apiGet("/v2/events/{$this->privateEventId}/reminders")
            ->assertNotFound();
        $this->assertDatabaseMissing('event_rsvps', [
            'tenant_id' => $this->testTenantId,
            'event_id' => $this->privateEventId,
            'user_id' => $this->nonMemberOrganizer->id,
        ]);
        $this->assertDatabaseMissing('event_waitlist', [
            'tenant_id' => $this->testTenantId,
            'event_id' => $this->privateEventId,
            'user_id' => $this->nonMemberOrganizer->id,
        ]);
        $this->assertDatabaseMissing('event_registrations', [
            'tenant_id' => $this->testTenantId,
            'event_id' => $this->privateEventId,
            'user_id' => $this->nonMemberOrganizer->id,
        ]);
        $this->assertDatabaseMissing('event_waitlist_entries', [
            'tenant_id' => $this->testTenantId,
            'event_id' => $this->privateEventId,
            'user_id' => $this->nonMemberOrganizer->id,
        ]);

        Sanctum::actingAs($this->member, ['*']);
        $this->apiPost("/v2/events/{$this->privateEventId}/rsvp", ['status' => 'going'])
            ->assertOk();

        Sanctum::actingAs($this->assignee, ['*']);
        $this->apiPost("/v2/events/{$this->privateEventId}/waitlist")
            ->assertOk();
        $this->apiGet("/v2/events/{$this->privateEventId}/waitlist")
            ->assertOk();

        Sanctum::actingAs($this->member, ['*']);
        $this->apiGet("/v2/events/{$this->privateEventId}/reminders")
            ->assertOk();

        $this->apiPost("/v2/events/{$this->archivedEventId}/rsvp", ['status' => 'going'])
            ->assertNotFound();
    }

    public function test_group_event_attachment_uses_canonical_lifecycle_and_integration_role(): void
    {
        $memberEventId = $this->insertEvent((int) $this->member->id, null, 'Member attachment');
        Sanctum::actingAs($this->member, ['*']);
        $this->apiPut("/v2/events/{$memberEventId}", ['group_id' => $this->activeGroupId])
            ->assertForbidden();
        $this->assertNull(DB::table('events')->where('id', $memberEventId)->value('group_id'));

        $adminEventId = $this->insertEvent((int) $this->groupAdmin->id, null, 'Admin attachment');
        Sanctum::actingAs($this->groupAdmin, ['*']);
        $this->apiPut("/v2/events/{$adminEventId}", ['group_id' => $this->activeGroupId])
            ->assertOk();
        $this->assertSame(
            $this->activeGroupId,
            (int) DB::table('events')->where('id', $adminEventId)->value('group_id'),
            'status=active is canonical even when legacy is_active is false.',
        );

        $archivedTargetId = $this->insertEvent((int) $this->groupAdmin->id, null, 'Archived attachment');
        $this->apiPut("/v2/events/{$archivedTargetId}", ['group_id' => $this->archivedGroupId])
            ->assertUnprocessable();
        $this->apiPut("/v2/events/{$archivedTargetId}", ['group_id' => $this->foreignGroupId])
            ->assertUnprocessable();
        $this->assertNull(DB::table('events')->where('id', $archivedTargetId)->value('group_id'));
    }

    public function test_group_linked_event_writes_close_when_membership_or_lifecycle_closes(): void
    {
        $seriesParentId = $this->insertEvent(
            (int) $this->nonMemberOrganizer->id,
            $this->activeGroupId,
            'Private recurring parent',
        );
        DB::table('events')->where('id', $this->privateEventId)->update([
            'parent_event_id' => $seriesParentId,
        ]);

        Sanctum::actingAs($this->nonMemberOrganizer, ['*']);
        $this->apiPut("/v2/events/{$this->privateEventId}", ['title' => 'Leaked organizer write'])
            ->assertForbidden();
        $this->apiPost("/v2/events/{$this->privateEventId}/cancel", ['reason' => 'Leaked cancel'])
            ->assertForbidden();
        $this->apiPut("/v2/events/{$this->privateEventId}/recurring", [
            'scope' => 'single',
            'title' => 'Leaked recurring write',
        ])->assertForbidden();
        $this->assertSame(
            'Private group event',
            DB::table('events')->where('id', $this->privateEventId)->value('title'),
        );
        $this->assertSame(
            'active',
            DB::table('events')->where('id', $this->privateEventId)->value('status'),
        );
        $this->assertSame(
            $seriesParentId,
            (int) DB::table('events')->where('id', $this->privateEventId)->value('parent_event_id'),
        );

        Sanctum::actingAs($this->member, ['*']);
        $this->apiPut("/v2/events/{$this->archivedEventId}", ['title' => 'Archived write'])
            ->assertForbidden();
        $this->assertSame(
            'Archived group event',
            DB::table('events')->where('id', $this->archivedEventId)->value('title'),
        );
    }

    public function test_series_event_rows_and_counts_follow_group_visibility(): void
    {
        $seriesId = (int) DB::table('event_series')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'title' => 'Private group series',
            'description' => 'Series visibility fixture.',
            'created_by' => $this->nonMemberOrganizer->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('events')->where('id', $this->privateEventId)->update(['series_id' => $seriesId]);

        Sanctum::actingAs($this->nonMemberOrganizer, ['*']);
        $concealed = $this->apiGet("/v2/events/series/{$seriesId}")->assertOk();
        $this->assertSame(0, (int) $concealed->json('data.series.event_count'));
        $this->assertSame([], $concealed->json('data.events'));

        Sanctum::actingAs($this->member, ['*']);
        $visible = $this->apiGet("/v2/events/series/{$seriesId}")->assertOk();
        $this->assertSame(1, (int) $visible->json('data.series.event_count'));
        $this->assertSame(
            [$this->privateEventId],
            array_map('intval', array_column($visible->json('data.events') ?? [], 'id')),
        );
    }

    public function test_task_parent_access_matrix_conceals_foreign_and_closes_archived_groups(): void
    {
        $taskId = $this->insertTask($this->activeGroupId, (int) $this->member->id, (int) $this->assignee->id);
        $archivedTaskId = $this->insertTask($this->archivedGroupId, (int) $this->member->id, (int) $this->member->id);
        $foreignTaskId = $this->insertTask(
            $this->foreignGroupId,
            (int) $this->foreignUser->id,
            (int) $this->foreignUser->id,
            999,
        );

        foreach ([$this->member, $this->groupAdmin, $this->tenantAdmin, $this->owner] as $actor) {
            Sanctum::actingAs($actor, ['*']);
            $this->apiGet("/v2/team-tasks/{$taskId}")->assertOk();
        }

        foreach ([$this->nonMemberOrganizer, $this->pendingMember] as $actor) {
            Sanctum::actingAs($actor, ['*']);
            $this->apiGet("/v2/team-tasks/{$taskId}")->assertForbidden();
            $this->apiGet("/v2/groups/{$this->activeGroupId}/tasks")->assertForbidden();
        }

        Sanctum::actingAs($this->member, ['*']);
        $this->apiGet("/v2/team-tasks/{$archivedTaskId}")->assertForbidden();
        $this->apiGet("/v2/team-tasks/{$foreignTaskId}")->assertNotFound();
        $this->apiGet("/v2/groups/{$this->foreignGroupId}/tasks")->assertNotFound();

        Sanctum::actingAs($this->tenantAdmin, ['*']);
        $this->apiGet("/v2/team-tasks/{$archivedTaskId}")->assertForbidden();
    }

    public function test_task_fields_have_creator_assignee_and_manager_permissions(): void
    {
        $taskId = $this->insertTask($this->activeGroupId, (int) $this->member->id, (int) $this->assignee->id);

        $this->assertTrue(
            $this->tasks->update($taskId, (int) $this->assignee->id, ['status' => 'done']),
            json_encode($this->tasks->getErrors(), JSON_THROW_ON_ERROR),
        );
        $this->assertSame('done', DB::table('team_tasks')->where('id', $taskId)->value('status'));

        $this->assertFalse($this->tasks->update($taskId, (int) $this->assignee->id, ['title' => 'Assignee rewrite']));
        $this->assertSame('FORBIDDEN', $this->tasks->getErrors()[0]['code']);
        $this->assertFalse($this->tasks->update($taskId, (int) $this->unrelatedMember->id, ['status' => 'todo']));
        $this->assertSame('FORBIDDEN', $this->tasks->getErrors()[0]['code']);

        $this->assertTrue($this->tasks->update($taskId, (int) $this->member->id, [
            'title' => 'Creator rewrite',
            'assigned_to' => $this->unrelatedMember->id,
        ]));
        $stored = DB::table('team_tasks')->where('id', $taskId)->first();
        $this->assertSame('Creator rewrite', $stored->title);
        $this->assertSame((int) $this->unrelatedMember->id, (int) $stored->assigned_to);

        foreach ([$this->pendingMember, $this->foreignUser] as $invalidAssignee) {
            $this->assertFalse($this->tasks->update($taskId, (int) $this->groupAdmin->id, [
                'assigned_to' => $invalidAssignee->id,
            ]));
            $this->assertSame('VALIDATION_ERROR', $this->tasks->getErrors()[0]['code']);
        }

        $otherOnly = $this->user('g06_other_only');
        $this->insertMembership($this->otherGroupId, $otherOnly, 'active');
        $this->assertFalse($this->tasks->update($taskId, (int) $this->groupAdmin->id, [
            'assigned_to' => $otherOnly->id,
        ]));
        $this->assertSame('VALIDATION_ERROR', $this->tasks->getErrors()[0]['code']);

        $this->assertFalse($this->tasks->delete($taskId, (int) $this->unrelatedMember->id));
        $this->assertDatabaseHas('team_tasks', ['id' => $taskId]);
        $this->assertTrue($this->tasks->delete($taskId, (int) $this->groupAdmin->id));
        $this->assertDatabaseMissing('team_tasks', ['id' => $taskId]);
    }

    public function test_task_dto_exposes_server_computed_field_capabilities(): void
    {
        $taskId = $this->insertTask($this->activeGroupId, (int) $this->member->id, (int) $this->assignee->id);

        $creator = $this->tasks->getById($taskId, (int) $this->member->id);
        $this->assertNotNull($creator);
        $this->assertSame((int) $this->assignee->id, $creator['assignee']['id']);
        $this->assertSame($this->assignee->name, $creator['assignee']['name']);
        $this->assertTrue($creator['can_update_status']);
        $this->assertTrue($creator['can_edit']);
        $this->assertTrue($creator['can_delete']);

        $assignee = $this->tasks->getById($taskId, (int) $this->assignee->id);
        $this->assertNotNull($assignee);
        $this->assertTrue($assignee['can_update_status']);
        $this->assertFalse($assignee['can_edit']);
        $this->assertFalse($assignee['can_delete']);

        $unrelated = $this->tasks->getById($taskId, (int) $this->unrelatedMember->id);
        $this->assertNotNull($unrelated);
        $this->assertFalse($unrelated['can_update_status']);
        $this->assertFalse($unrelated['can_edit']);
        $this->assertFalse($unrelated['can_delete']);

        $manager = $this->tasks->getById($taskId, (int) $this->groupAdmin->id);
        $this->assertNotNull($manager);
        $this->assertTrue($manager['can_update_status']);
        $this->assertTrue($manager['can_edit']);
        $this->assertTrue($manager['can_delete']);

        Sanctum::actingAs($this->assignee, ['*']);
        $this->apiGet("/v2/team-tasks/{$taskId}")
            ->assertOk()
            ->assertJsonPath('data.can_update_status', true)
            ->assertJsonPath('data.can_edit', false)
            ->assertJsonPath('data.can_delete', false)
            ->assertJsonPath('data.assignee.id', (int) $this->assignee->id);

        DB::table('team_tasks')->where('id', $taskId)->update([
            'assigned_to' => $this->foreignUser->id,
        ]);
        TenantContext::setById($this->testTenantId);
        $malformed = $this->tasks->getById($taskId, (int) $this->member->id);
        $this->assertNotNull($malformed);
        $this->assertNull($malformed['assignee']);
    }

    public function test_task_replay_after_deletion_returns_a_new_complete_task_response(): void
    {
        Sanctum::actingAs($this->member, ['*']);
        $path = "/v2/groups/{$this->activeGroupId}/tasks";
        $payload = ['title' => 'Replay-safe disposable task', 'priority' => 'high'];
        $headers = ['Idempotency-Key' => 'group-task-api-delete-replay-1'];

        $first = $this->apiPost($path, $payload, $headers)
            ->assertCreated()
            ->assertJsonPath('data.title', 'Replay-safe disposable task')
            ->assertJsonPath('data.priority', 'high');
        $firstId = (int) $first->json('data.id');
        self::assertGreaterThan(0, $firstId);

        $this->apiPost($path, $payload, $headers)
            ->assertCreated()
            ->assertJsonPath('data.id', $firstId);
        $this->apiDelete("/v2/team-tasks/{$firstId}")->assertNoContent();

        $replacement = $this->apiPost($path, $payload, $headers)
            ->assertCreated()
            ->assertJsonPath('data.title', 'Replay-safe disposable task')
            ->assertJsonPath('data.priority', 'high');
        $replacementId = (int) $replacement->json('data.id');
        self::assertGreaterThan(0, $replacementId);
        self::assertNotSame($firstId, $replacementId);
    }

    public function test_task_create_authorizes_parent_before_payload_and_assignee_validation(): void
    {
        $this->assertSame($this->testTenantId, (int) TenantContext::getId());
        $this->assertDatabaseHas('groups', [
            'id' => $this->activeGroupId,
            'tenant_id' => $this->testTenantId,
        ]);

        $this->assertNull($this->tasks->create(
            $this->activeGroupId,
            (int) $this->nonMemberOrganizer->id,
            ['title' => ''],
        ));
        $this->assertSame('FORBIDDEN', $this->tasks->getErrors()[0]['code']);

        $this->assertNull($this->tasks->create(
            $this->foreignGroupId,
            (int) $this->member->id,
            ['title' => ''],
        ));
        $this->assertSame('RESOURCE_NOT_FOUND', $this->tasks->getErrors()[0]['code']);

        $this->assertNull($this->tasks->create($this->activeGroupId, (int) $this->member->id, [
            'title' => 'Invalid cross-tenant assignee',
            'assigned_to' => $this->foreignUser->id,
        ]));
        $this->assertSame('VALIDATION_ERROR', $this->tasks->getErrors()[0]['code']);

        $taskId = $this->tasks->create($this->activeGroupId, (int) $this->member->id, [
            'title' => 'Valid assigned task',
            'assigned_to' => $this->assignee->id,
        ]);
        $this->assertIsInt($taskId);
        $this->assertDatabaseHas('team_tasks', [
            'id' => $taskId,
            'tenant_id' => $this->testTenantId,
            'group_id' => $this->activeGroupId,
            'assigned_to' => $this->assignee->id,
        ]);
    }

    private function user(string $username): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'username' => $username,
            'status' => 'active',
            'is_approved' => true,
        ]);

        // User model listeners may restore the tenant context that was active
        // before the factory ran. Keep later service calls on this test tenant.
        TenantContext::setById($this->testTenantId);

        return $user;
    }

    private function insertGroup(
        int $tenantId,
        int $ownerId,
        string $status,
        string $visibility,
        bool $legacyActive = true,
    ): int {
        return (int) DB::table('groups')->insertGetId([
            'tenant_id' => $tenantId,
            'owner_id' => $ownerId,
            'name' => 'G06 ' . $status . ' ' . uniqid('', true),
            'slug' => 'g06-' . $tenantId . '-' . uniqid(),
            'description' => 'Group task/event authorization fixture.',
            'visibility' => $visibility,
            'status' => $status,
            'is_active' => $legacyActive,
            'cached_member_count' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function insertMembership(
        int $groupId,
        User $user,
        string $status,
        string $role = 'member',
    ): void {
        DB::table('group_members')->insert([
            'tenant_id' => $user->tenant_id,
            'group_id' => $groupId,
            'user_id' => $user->id,
            'status' => $status,
            'role' => $role,
            'joined_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function insertEvent(
        int $organizerId,
        ?int $groupId,
        string $title,
        int $maxAttendees = 20,
    ): int
    {
        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $organizerId,
            'group_id' => $groupId,
            'title' => $title,
            'description' => 'G06 event authorization fixture.',
            'location' => 'Test Hall',
            'start_time' => now()->addDays(2),
            'end_time' => now()->addDays(2)->addHour(),
            'max_attendees' => $maxAttendees,
            'is_online' => false,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function insertTask(int $groupId, int $creatorId, int $assigneeId, ?int $tenantId = null): int
    {
        return (int) DB::table('team_tasks')->insertGetId([
            'tenant_id' => $tenantId ?? $this->testTenantId,
            'group_id' => $groupId,
            'title' => 'G06 team task ' . uniqid('', true),
            'description' => 'Task authorization fixture.',
            'assigned_to' => $assigneeId,
            'status' => 'todo',
            'priority' => 'medium',
            'due_date' => now()->addWeek()->toDateString(),
            'created_by' => $creatorId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
