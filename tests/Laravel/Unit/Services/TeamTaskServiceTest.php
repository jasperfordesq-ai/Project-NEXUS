<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services;

use App\Models\User;
use App\Services\GroupAuditService;
use App\Services\TeamTaskService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

final class TeamTaskServiceTest extends TestCase
{
    use DatabaseTransactions;

    private TeamTaskService $service;
    private User $owner;
    private User $nonMember;
    private int $groupId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->service = new TeamTaskService();
        $this->owner = User::factory()->forTenant($this->testTenantId)->create();
        $this->nonMember = User::factory()->forTenant($this->testTenantId)->create();
        $this->groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $this->owner->id,
            'name' => 'Team task unit fixture ' . uniqid('', true),
            'slug' => 'team-task-unit-' . uniqid(),
            'description' => 'Real parent-policy fixture.',
            'visibility' => 'private',
            'status' => 'active',
            'is_active' => true,
            'cached_member_count' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        \App\Core\TenantContext::setById($this->testTenantId);
    }

    public function test_reads_fail_closed_without_an_actor(): void
    {
        $this->assertSame($this->testTenantId, (int) \App\Core\TenantContext::getId());
        $this->assertDatabaseHas('groups', [
            'id' => $this->groupId,
            'tenant_id' => $this->testTenantId,
        ]);

        $result = $this->service->getTasks($this->groupId);

        $this->assertSame(['items' => [], 'cursor' => null, 'has_more' => false], $result);
        $this->assertSame('FORBIDDEN', $this->service->getErrors()[0]['code']);
    }

    public function test_parent_policy_runs_before_payload_validation(): void
    {
        $this->assertNull($this->service->create(
            $this->groupId,
            (int) $this->nonMember->id,
            ['title' => ''],
        ));
        $this->assertSame('FORBIDDEN', $this->service->getErrors()[0]['code']);

        $this->assertNull($this->service->create(
            $this->groupId,
            (int) $this->owner->id,
            ['title' => ''],
        ));
        $this->assertSame('VALIDATION_ERROR', $this->service->getErrors()[0]['code']);
    }

    public function test_missing_task_is_tenant_scoped(): void
    {
        $this->assertNull($this->service->getById(PHP_INT_MAX, (int) $this->owner->id));
        $this->assertSame([], $this->service->getErrors());

        $this->assertFalse($this->service->delete(PHP_INT_MAX, (int) $this->owner->id));
        $this->assertSame('RESOURCE_NOT_FOUND', $this->service->getErrors()[0]['code']);
    }

    public function test_owner_can_read_empty_stats_without_a_membership_row(): void
    {
        $this->assertSame([
            'total' => 0,
            'todo' => 0,
            'in_progress' => 0,
            'done' => 0,
            'overdue' => 0,
        ], $this->service->getStats($this->groupId, (int) $this->owner->id));
        $this->assertSame([], $this->service->getErrors());
    }

    public function test_task_delete_writes_actor_and_creator_audit(): void
    {
        $taskId = $this->service->create($this->groupId, (int) $this->owner->id, [
            'title' => 'Audited task deletion',
        ]);
        self::assertNotNull($taskId);

        self::assertTrue($this->service->delete((int) $taskId, (int) $this->owner->id));

        $audit = DB::table('group_audit_log')
            ->where('group_id', $this->groupId)
            ->where('action', GroupAuditService::ACTION_TEAM_TASK_DELETED)
            ->sole();
        self::assertSame((int) $this->owner->id, (int) $audit->user_id);
        $details = json_decode((string) $audit->details, true, 512, JSON_THROW_ON_ERROR);
        self::assertSame((int) $taskId, (int) $details['task_id']);
        self::assertSame((int) $this->owner->id, (int) $details['target_user_id']);
        self::assertSame('Audited task deletion', $details['title']);
    }

    public function test_creation_receipt_replays_one_task_and_rejects_changed_intent(): void
    {
        $payload = [
            'title' => 'Water seedlings',
            'description' => 'Use the small greenhouse cans.',
            'priority' => 'high',
            'idempotency_key' => 'group-task-replay-1',
        ];

        $firstId = $this->service->create($this->groupId, (int) $this->owner->id, $payload);
        $replayedId = $this->service->create($this->groupId, (int) $this->owner->id, $payload);

        self::assertNotNull($firstId);
        self::assertSame($firstId, $replayedId);
        self::assertSame(1, DB::table('team_tasks')->where('id', $firstId)->count());
        self::assertSame(1, DB::table('group_content_creation_receipts')->where('operation_type', 'task')->count());

        self::assertNull($this->service->create($this->groupId, (int) $this->owner->id, [
            ...$payload,
            'description' => 'Changed intent.',
        ]));
        self::assertSame('IDEMPOTENCY_CONFLICT', $this->service->getErrors()[0]['code'] ?? null);
    }

    public function test_deleting_a_task_removes_its_creation_receipt_atomically(): void
    {
        $payload = [
            'title' => 'Disposable task',
            'description' => 'Delete this after the replay proof.',
            'idempotency_key' => 'group-task-delete-receipt-1',
        ];
        $firstId = $this->service->create($this->groupId, (int) $this->owner->id, $payload);
        self::assertNotNull($firstId);
        self::assertDatabaseHas('group_content_creation_receipts', [
            'tenant_id' => $this->testTenantId,
            'group_id' => $this->groupId,
            'operation_type' => 'task',
            'result_id' => $firstId,
        ]);

        self::assertTrue($this->service->delete((int) $firstId, (int) $this->owner->id));
        self::assertDatabaseMissing('team_tasks', ['id' => $firstId]);
        self::assertDatabaseMissing('group_content_creation_receipts', [
            'tenant_id' => $this->testTenantId,
            'group_id' => $this->groupId,
            'operation_type' => 'task',
            'result_id' => $firstId,
        ]);

        $replacementId = $this->service->create($this->groupId, (int) $this->owner->id, $payload);
        self::assertNotNull($replacementId);
        self::assertNotSame($firstId, $replacementId);
        self::assertDatabaseHas('team_tasks', ['id' => $replacementId]);
    }
}
