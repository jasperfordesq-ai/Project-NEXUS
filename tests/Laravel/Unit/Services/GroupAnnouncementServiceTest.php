<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Models\User;
use App\Services\GroupAuditService;
use App\Services\GroupAnnouncementService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

class GroupAnnouncementServiceTest extends TestCase
{
    use DatabaseTransactions;

    private GroupAnnouncementService $service;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        $this->service = new GroupAnnouncementService();
    }

    public function test_list_returns_null_when_user_not_member(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $outsider = User::factory()->forTenant($this->testTenantId)->create();
        $groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $owner->id,
            'name' => 'Announcement access ' . uniqid('', true),
            'description' => 'Private announcement access fixture.',
            'visibility' => 'private',
            'status' => 'active',
            'is_active' => true,
            'cached_member_count' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => $owner->id,
            'role' => 'owner',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        self::assertNull($this->service->list($groupId, (int) $outsider->id));
        self::assertSame('FORBIDDEN', $this->service->getErrors()[0]['code'] ?? null);
    }

    public function test_getErrors_returns_array(): void
    {
        self::assertIsArray($this->service->getErrors());
    }

    public function test_creation_receipt_replays_one_announcement_and_rejects_changed_content(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $owner->id,
            'name' => 'Announcement replay ' . uniqid('', true),
            'description' => 'Announcement replay fixture.',
            'visibility' => 'private',
            'status' => 'active',
            'is_active' => true,
            'cached_member_count' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => $owner->id,
            'role' => 'owner',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $payload = [
            'title' => 'Seeds arrived',
            'content' => 'Collect them from the shed.',
            'is_pinned' => true,
            'idempotency_key' => 'group-announcement-replay-1',
        ];

        $first = $this->service->create($groupId, (int) $owner->id, $payload);
        $replay = $this->service->create($groupId, (int) $owner->id, $payload);

        self::assertNotNull($first);
        self::assertSame($first['id'], $replay['id'] ?? null);
        self::assertTrue((bool) ($replay['_idempotent_replay'] ?? false));
        self::assertSame(1, DB::table('group_announcements')->where('id', $first['id'])->count());
        self::assertSame(1, DB::table('group_content_creation_receipts')->where('operation_type', 'announcement')->count());

        self::assertNull($this->service->create($groupId, (int) $owner->id, [
            ...$payload,
            'content' => 'Changed intent.',
        ]));
        self::assertSame('IDEMPOTENCY_CONFLICT', $this->service->getErrors()[0]['code'] ?? null);

        self::assertTrue($this->service->delete($groupId, (int) $first['id'], (int) $owner->id));
        self::assertSame(0, DB::table('group_content_creation_receipts')
            ->where('operation_type', 'announcement')
            ->where('result_id', $first['id'])
            ->count());
        $recreated = $this->service->create($groupId, (int) $owner->id, $payload);
        self::assertNotNull($recreated);
        self::assertNotSame((int) $first['id'], (int) $recreated['id']);
    }

    public function test_admin_delete_writes_actor_and_announcement_metadata(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $owner->id,
            'name' => 'Announcement audit ' . uniqid('', true),
            'description' => 'Announcement audit fixture.',
            'visibility' => 'private',
            'status' => 'active',
            'is_active' => true,
            'cached_member_count' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => $owner->id,
            'role' => 'owner',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $announcementId = (int) DB::table('group_announcements')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'title' => 'Delete audit title',
            'content' => 'Delete audit content',
            'is_pinned' => false,
            'priority' => 0,
            'created_by' => $owner->id,
            'created_at' => now(),
        ]);

        self::assertTrue($this->service->delete($groupId, $announcementId, (int) $owner->id));

        $audit = DB::table('group_audit_log')
            ->where('group_id', $groupId)
            ->where('action', GroupAuditService::ACTION_ANNOUNCEMENT_DELETED)
            ->sole();
        self::assertSame((int) $owner->id, (int) $audit->user_id);
        $details = json_decode((string) $audit->details, true, 512, JSON_THROW_ON_ERROR);
        self::assertSame($announcementId, (int) $details['announcement_id']);
        self::assertSame('Delete audit title', $details['title']);
        self::assertSame((int) $owner->id, (int) $details['target_user_id']);
    }
}
