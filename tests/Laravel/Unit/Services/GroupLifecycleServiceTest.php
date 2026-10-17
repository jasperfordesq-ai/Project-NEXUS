<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Enums\GroupStatus;
use App\Models\Group;
use App\Models\User;
use App\Services\GroupAuditService;
use App\Services\GroupLifecycleService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

final class GroupLifecycleServiceTest extends TestCase
{
    use DatabaseTransactions;

    private User $actor;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        $this->actor = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        Queue::fake();
    }

    public function test_status_constants_expose_only_the_canonical_vocabulary(): void
    {
        self::assertSame('pending_review', GroupLifecycleService::STATUS_PENDING_REVIEW);
        self::assertSame('active', GroupLifecycleService::STATUS_ACTIVE);
        self::assertSame('dormant', GroupLifecycleService::STATUS_DORMANT);
        self::assertSame('archived', GroupLifecycleService::STATUS_ARCHIVED);
        self::assertSame('rejected', GroupLifecycleService::STATUS_REJECTED);
        self::assertSame('pending_review', GroupLifecycleService::STATUS_DRAFT);
        self::assertSame('pending_review', GroupLifecycleService::STATUS_PENDING);
        self::assertSame('archived', GroupLifecycleService::STATUS_DELETED);
    }

    public function test_get_status_is_tenant_scoped_and_reads_the_canonical_field(): void
    {
        $local = $this->group(GroupStatus::Dormant);
        $foreign = Group::factory()->forTenant(999)->create([
            'owner_id' => User::factory()->forTenant(999),
            'status' => GroupStatus::Active->value,
            'is_active' => true,
        ]);
        TenantContext::setById($this->testTenantId);

        self::assertSame('dormant', GroupLifecycleService::getStatus($local->id));
        self::assertNull(GroupLifecycleService::getStatus($foreign->id));
        self::assertNull(GroupLifecycleService::getStatus(PHP_INT_MAX));
    }

    public function test_transition_writes_the_canonical_pair_and_audit_atomically(): void
    {
        $group = $this->group(GroupStatus::Active);

        self::assertTrue(GroupLifecycleService::transition(
            $group->id,
            GroupStatus::Dormant->value,
            $this->actor->id,
            'Inactivity threshold',
        ));

        $stored = DB::table('groups')->where('id', $group->id)->first();
        self::assertSame('dormant', $stored->status);
        self::assertSame(0, (int) $stored->is_active);

        $audit = DB::table('group_audit_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('group_id', $group->id)
            ->where('action', 'group_status_changed')
            ->sole();
        $details = json_decode((string) $audit->details, true, flags: JSON_THROW_ON_ERROR);
        self::assertSame('active', $details['old_status']);
        self::assertSame('dormant', $details['new_status']);
        self::assertSame('Inactivity threshold', $details['reason']);
    }

    public function test_idempotent_transition_succeeds_without_duplicate_audit(): void
    {
        $group = $this->group(GroupStatus::Active);

        self::assertTrue(GroupLifecycleService::transition(
            $group->id,
            GroupStatus::Active->value,
            $this->actor->id,
        ));
        self::assertSame(0, DB::table('group_audit_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('group_id', $group->id)
            ->where('action', 'group_status_changed')
            ->count());
    }

    public function test_unknown_and_disallowed_transitions_leave_the_row_unchanged(): void
    {
        $group = $this->group(GroupStatus::Archived);

        self::assertFalse(GroupLifecycleService::transition(
            $group->id,
            'unreviewed_state',
            $this->actor->id,
        ));
        self::assertFalse(GroupLifecycleService::transition(
            $group->id,
            GroupStatus::Dormant->value,
            $this->actor->id,
        ));
        self::assertSame('archived', DB::table('groups')->where('id', $group->id)->value('status'));
        self::assertSame(0, (int) DB::table('groups')->where('id', $group->id)->value('is_active'));
    }

    public function test_archive_and_unarchive_keep_the_compatibility_mirror_in_sync(): void
    {
        $group = $this->group(GroupStatus::Active);

        self::assertTrue(GroupLifecycleService::archive($group->id, $this->actor->id, 'Owner archive'));
        self::assertDatabaseHas('groups', [
            'id' => $group->id,
            'tenant_id' => $this->testTenantId,
            'status' => GroupStatus::Archived->value,
            'is_active' => 0,
        ]);

        self::assertTrue(GroupLifecycleService::unarchive($group->id, $this->actor->id));
        self::assertDatabaseHas('groups', [
            'id' => $group->id,
            'tenant_id' => $this->testTenantId,
            'status' => GroupStatus::Active->value,
            'is_active' => 1,
        ]);
    }

    public function test_bulk_transitions_count_only_rows_that_changed_in_this_tenant(): void
    {
        $first = $this->group(GroupStatus::Active);
        $second = $this->group(GroupStatus::Active);
        $alreadyArchived = $this->group(GroupStatus::Archived);
        $foreign = Group::factory()->forTenant(999)->create([
            'owner_id' => User::factory()->forTenant(999),
            'status' => GroupStatus::Active->value,
            'is_active' => true,
        ]);
        TenantContext::setById($this->testTenantId);

        self::assertSame(2, GroupLifecycleService::bulkArchive([
            $first->id,
            $second->id,
            $alreadyArchived->id,
            $foreign->id,
        ], $this->actor->id));

        self::assertSame(3, GroupLifecycleService::bulkUnarchive([
            $first->id,
            $second->id,
            $alreadyArchived->id,
            $foreign->id,
        ], $this->actor->id));
        self::assertSame('active', DB::table('groups')->where('id', $foreign->id)->value('status'));
    }

    public function test_transfer_ownership_updates_owner_roles_and_audit_atomically_and_is_idempotent(): void
    {
        $group = $this->group(GroupStatus::Active);
        $newOwner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        DB::table('group_members')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'group_id' => $group->id,
                'user_id' => $this->actor->id,
                'role' => 'owner',
                'status' => 'active',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'group_id' => $group->id,
                'user_id' => $newOwner->id,
                'role' => 'member',
                'status' => 'active',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        self::assertTrue(GroupLifecycleService::transferOwnership(
            $group->id,
            (int) $newOwner->id,
            (int) $this->actor->id,
        ));
        self::assertSame((int) $newOwner->id, (int) DB::table('groups')->where('id', $group->id)->value('owner_id'));
        self::assertSame('owner', DB::table('group_members')
            ->where('group_id', $group->id)
            ->where('user_id', $newOwner->id)
            ->value('role'));
        self::assertSame('admin', DB::table('group_members')
            ->where('group_id', $group->id)
            ->where('user_id', $this->actor->id)
            ->value('role'));

        $audit = DB::table('group_audit_log')
            ->where('group_id', $group->id)
            ->where('action', GroupAuditService::ACTION_GROUP_UPDATED)
            ->sole();
        $details = json_decode((string) $audit->details, true, flags: JSON_THROW_ON_ERROR);
        self::assertSame('ownership_transferred', $details['action']);
        self::assertSame((int) $this->actor->id, $details['previous_owner_id']);
        self::assertSame((int) $newOwner->id, $details['new_owner_id']);

        self::assertTrue(GroupLifecycleService::transferOwnership(
            $group->id,
            (int) $newOwner->id,
            (int) $newOwner->id,
        ));
        self::assertSame(1, DB::table('group_audit_log')
            ->where('group_id', $group->id)
            ->where('action', GroupAuditService::ACTION_GROUP_UPDATED)
            ->count());
        self::assertSame(1, DB::table('group_members')
            ->where('group_id', $group->id)
            ->where('role', 'owner')
            ->count());
    }

    public function test_transfer_rejects_cross_tenant_owner_and_actor_without_mutation(): void
    {
        $group = $this->group(GroupStatus::Active);
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $group->id,
            'user_id' => $this->actor->id,
            'role' => 'owner',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $foreignUser = User::factory()->forTenant(999)->create(['status' => 'active']);
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $group->id,
            'user_id' => $foreignUser->id,
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        self::assertFalse(GroupLifecycleService::transferOwnership(
            $group->id,
            (int) $foreignUser->id,
            (int) $this->actor->id,
        ));
        self::assertFalse(GroupLifecycleService::transferOwnership(
            $group->id,
            (int) $this->actor->id,
            (int) $foreignUser->id,
        ));
        self::assertSame((int) $this->actor->id, (int) DB::table('groups')->where('id', $group->id)->value('owner_id'));
        self::assertSame(0, DB::table('group_audit_log')->where('group_id', $group->id)->count());
    }

    public function test_clone_validates_actor_and_name_and_copies_members_and_audit(): void
    {
        $source = $this->group(GroupStatus::Active);
        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $source->id,
            'user_id' => $member->id,
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $cloneId = GroupLifecycleService::cloneGroup(
            $source->id,
            'Cloned lifecycle group',
            (int) $this->actor->id,
            true,
        );
        self::assertNotNull($cloneId);
        $this->assertDatabaseHas('groups', [
            'id' => $cloneId,
            'tenant_id' => $this->testTenantId,
            'owner_id' => $this->actor->id,
            'name' => 'Cloned lifecycle group',
            'cached_member_count' => 2,
        ]);
        self::assertSame(2, DB::table('group_members')->where('group_id', $cloneId)->count());
        $audit = DB::table('group_audit_log')
            ->where('group_id', $cloneId)
            ->where('action', GroupAuditService::ACTION_GROUP_CREATED)
            ->sole();
        $details = json_decode((string) $audit->details, true, flags: JSON_THROW_ON_ERROR);
        self::assertSame('group_cloned', $details['action']);
        self::assertSame((int) $source->id, $details['source_group_id']);

        self::assertNull(GroupLifecycleService::cloneGroup($source->id, 'x', (int) $this->actor->id));
        $foreignActor = User::factory()->forTenant(999)->create(['status' => 'active']);
        self::assertNull(GroupLifecycleService::cloneGroup($source->id, 'Foreign clone', (int) $foreignActor->id));
        self::assertNull(GroupLifecycleService::cloneGroup(PHP_INT_MAX, 'Missing source', (int) $this->actor->id));
    }

    private function group(GroupStatus $status): Group
    {
        /** @var Group $group */
        $group = Group::factory()->forTenant($this->testTenantId)->create([
            'owner_id' => $this->actor->id,
            'status' => $status->value,
            'is_active' => $status->legacyIsActive(),
        ]);

        return $group;
    }
}
