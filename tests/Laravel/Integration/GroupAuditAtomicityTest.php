<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Integration;

use App\Core\TenantContext;
use App\Enums\GroupStatus;
use App\Services\GroupAnnouncementService;
use App\Services\GroupChatroomService;
use App\Services\GroupFileService;
use App\Services\GroupInviteService;
use App\Services\GroupLifecycleService;
use App\Services\GroupService;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Tests\Laravel\TestCase;
use Throwable;

/**
 * Committed fixtures plus database triggers prove required audit failures roll
 * back their domain writes. This class deliberately does not use transactions:
 * MariaDB trigger DDL commits implicitly.
 */
final class GroupAuditAtomicityTest extends TestCase
{
    private const GROUP_AUDIT_TRIGGER = 'group_audit_force_failure_g18';
    private const ACTIVITY_TRIGGER = 'group_activity_force_failure_g18';

    /** @var list<int> */
    private array $userIds = [];

    /** @var list<int> */
    private array $groupIds = [];

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        Queue::fake();
        Storage::fake('local');
        $this->dropFailureTriggers();
    }

    protected function tearDown(): void
    {
        $this->dropFailureTriggers();
        if ($this->groupIds !== []) {
            $chatroomIds = DB::table('group_chatrooms')
                ->whereIn('group_id', $this->groupIds)
                ->pluck('id')
                ->map(static fn (mixed $id): int => (int) $id)
                ->all();
            if ($chatroomIds !== []) {
                DB::table('group_chatroom_pinned_messages')->whereIn('chatroom_id', $chatroomIds)->delete();
                DB::table('group_chatroom_messages')->whereIn('chatroom_id', $chatroomIds)->delete();
                DB::table('group_chatrooms')->whereIn('id', $chatroomIds)->delete();
            }
            DB::table('group_files')->whereIn('group_id', $this->groupIds)->delete();
            DB::table('group_announcements')->whereIn('group_id', $this->groupIds)->delete();
            DB::table('group_invites')->whereIn('group_id', $this->groupIds)->delete();
            DB::table('group_audit_log')->whereIn('group_id', $this->groupIds)->delete();
            DB::table('group_members')->whereIn('group_id', $this->groupIds)->delete();
            DB::table('groups')->whereIn('id', $this->groupIds)->delete();
        }
        if ($this->userIds !== []) {
            DB::table('activity_log')->whereIn('user_id', $this->userIds)->delete();
            DB::table('users')->whereIn('id', $this->userIds)->delete();
        }
        TenantContext::reset();
        parent::tearDown();
    }

    public function test_transfer_rolls_back_owner_and_roles_when_required_audit_fails(): void
    {
        $ownerId = $this->user();
        $newOwnerId = $this->user();
        $groupId = $this->group($ownerId, 'Atomic transfer');
        $this->member($groupId, $ownerId, 'owner');
        $this->member($groupId, $newOwnerId, 'member');
        $this->failGroupAuditInserts();

        $error = $this->captureFailure(static fn (): bool => GroupLifecycleService::transferOwnership(
            $groupId,
            $newOwnerId,
            $ownerId,
        ));

        self::assertStringContainsString('forced group audit failure', $error->getMessage());
        self::assertSame($ownerId, (int) DB::table('groups')->where('id', $groupId)->value('owner_id'));
        self::assertSame('owner', DB::table('group_members')
            ->where('group_id', $groupId)->where('user_id', $ownerId)->value('role'));
        self::assertSame('member', DB::table('group_members')
            ->where('group_id', $groupId)->where('user_id', $newOwnerId)->value('role'));
    }

    public function test_clone_rolls_back_group_and_members_when_required_audit_fails(): void
    {
        $ownerId = $this->user();
        $memberId = $this->user();
        $sourceId = $this->group($ownerId, 'Atomic clone source');
        $this->member($sourceId, $memberId, 'member');
        $this->failGroupAuditInserts();

        $error = $this->captureFailure(static fn (): int|null => GroupLifecycleService::cloneGroup(
            $sourceId,
            'Clone that must roll back',
            $ownerId,
            true,
        ));

        self::assertStringContainsString('forced group audit failure', $error->getMessage());
        self::assertSame(0, DB::table('groups')
            ->where('tenant_id', $this->testTenantId)
            ->where('name', 'Clone that must roll back')
            ->count());
    }

    public function test_create_and_update_roll_back_when_required_group_audit_fails(): void
    {
        $ownerId = $this->user();
        $this->failGroupAuditInserts();

        $createError = $this->captureFailure(static fn () => GroupService::create($ownerId, [
            'name' => 'Create that must roll back',
            'description' => 'This valid group must not survive its required audit failure.',
            'visibility' => 'public',
        ]));
        self::assertStringContainsString('forced group audit failure', $createError->getMessage());
        self::assertSame(0, DB::table('groups')
            ->where('tenant_id', $this->testTenantId)
            ->where('name', 'Create that must roll back')
            ->count());

        $this->dropFailureTriggers();
        $groupId = $this->group($ownerId, 'Original atomic update');
        $originalName = (string) DB::table('groups')->where('id', $groupId)->value('name');
        $this->failGroupAuditInserts();
        $updateError = $this->captureFailure(static fn (): bool => GroupService::update(
            $groupId,
            $ownerId,
            ['name' => 'Update that must roll back'],
        ));
        self::assertStringContainsString('forced group audit failure', $updateError->getMessage());
        self::assertSame($originalName, DB::table('groups')->where('id', $groupId)->value('name'));
    }

    public function test_delete_preserves_group_when_durable_activity_audit_fails(): void
    {
        $ownerId = $this->user();
        $groupId = $this->group($ownerId, 'Delete that must roll back');
        $this->member($groupId, $ownerId, 'owner');
        $this->failActivityInserts();

        $error = $this->captureFailure(static fn (): bool => GroupService::delete($groupId, $ownerId));

        self::assertStringContainsString('forced group activity failure', $error->getMessage());
        self::assertSame(1, DB::table('groups')->where('id', $groupId)->count());
        self::assertSame(1, DB::table('group_members')->where('group_id', $groupId)->count());
        self::assertSame(0, DB::table('activity_log')
            ->where('entity_type', 'group')
            ->where('entity_id', $groupId)
            ->count());
    }

    public function test_role_change_and_member_removal_roll_back_when_required_audit_fails(): void
    {
        $ownerId = $this->user();
        $memberId = $this->user();
        $groupId = $this->group($ownerId, 'Member mutation audit rollback');
        $this->member($groupId, $ownerId, 'owner');
        $this->member($groupId, $memberId, 'member');
        $this->failGroupAuditInserts();

        $roleError = $this->captureFailure(static fn (): bool => GroupService::updateMemberRole(
            $groupId,
            $memberId,
            $ownerId,
            'admin',
        ));
        self::assertStringContainsString('forced group audit failure', $roleError->getMessage());
        self::assertSame('member', DB::table('group_members')
            ->where('group_id', $groupId)
            ->where('user_id', $memberId)
            ->value('role'));

        $removeError = $this->captureFailure(static fn (): bool => GroupService::removeMember(
            $groupId,
            $memberId,
            $ownerId,
        ));
        self::assertStringContainsString('forced group audit failure', $removeError->getMessage());
        $this->assertDatabaseHas('group_members', [
            'group_id' => $groupId,
            'user_id' => $memberId,
            'role' => 'member',
            'status' => 'active',
        ]);
    }

    public function test_join_leave_acceptance_and_revocation_roll_back_with_their_audit(): void
    {
        $ownerId = $this->user();
        $memberId = $this->user();
        $inviteeId = $this->user();
        $groupId = $this->group($ownerId, 'Membership mutation audit rollback');
        $this->member($groupId, $ownerId, 'owner');
        $this->failGroupAuditInserts();

        $joinError = $this->captureFailure(static fn (): array => GroupService::join($groupId, $memberId));
        self::assertStringContainsString('forced group audit failure', $joinError->getMessage());
        self::assertFalse(DB::table('group_members')
            ->where('group_id', $groupId)
            ->where('user_id', $memberId)
            ->exists());

        $this->dropFailureTriggers();
        $this->member($groupId, $memberId, 'member');
        $this->failGroupAuditInserts();
        $leaveError = $this->captureFailure(static fn (): array => GroupService::leave($groupId, $memberId));
        self::assertStringContainsString('forced group audit failure', $leaveError->getMessage());
        $this->assertDatabaseHas('group_members', [
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => $memberId,
            'status' => 'active',
        ]);

        $token = str_repeat('z', 40);
        $inviteId = (int) DB::table('group_invites')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'invited_by' => $ownerId,
            'invite_type' => 'link',
            'token' => $token,
            'status' => GroupInviteService::STATUS_PENDING,
            'expires_at' => now()->addDay(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $inviteService = new GroupInviteService();
        $acceptError = $this->captureFailure(
            static fn (): ?array => $inviteService->acceptInvite($token, $inviteeId),
        );
        self::assertStringContainsString('forced group audit failure', $acceptError->getMessage());
        self::assertFalse(DB::table('group_members')
            ->where('group_id', $groupId)
            ->where('user_id', $inviteeId)
            ->exists());

        $revokeError = $this->captureFailure(
            static fn (): bool => $inviteService->revokeInvite($groupId, $inviteId, $ownerId),
        );
        self::assertStringContainsString('forced group audit failure', $revokeError->getMessage());
        self::assertSame(
            GroupInviteService::STATUS_PENDING,
            DB::table('group_invites')->where('id', $inviteId)->value('status'),
        );
    }

    public function test_join_request_approval_and_rejection_roll_back_with_their_audit(): void
    {
        $ownerId = $this->user();
        $approvedId = $this->user();
        $rejectedId = $this->user();
        $groupId = $this->group($ownerId, 'Join request audit rollback');
        $this->member($groupId, $ownerId, 'owner');
        DB::table('groups')->where('id', $groupId)->update(['cached_member_count' => 1]);
        foreach ([$approvedId, $rejectedId] as $userId) {
            DB::table('group_members')->insert([
                'tenant_id' => $this->testTenantId,
                'group_id' => $groupId,
                'user_id' => $userId,
                'role' => 'member',
                'status' => 'pending',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
        $this->failGroupAuditInserts();

        $approveError = $this->captureFailure(static fn (): bool => GroupService::handleJoinRequest(
            $groupId,
            $approvedId,
            $ownerId,
            'accept',
        ));
        self::assertStringContainsString('forced group audit failure', $approveError->getMessage());
        $this->assertDatabaseHas('group_members', [
            'group_id' => $groupId,
            'user_id' => $approvedId,
            'status' => 'pending',
        ]);

        $rejectError = $this->captureFailure(static fn (): bool => GroupService::handleJoinRequest(
            $groupId,
            $rejectedId,
            $ownerId,
            'reject',
        ));
        self::assertStringContainsString('forced group audit failure', $rejectError->getMessage());
        $this->assertDatabaseHas('group_members', [
            'group_id' => $groupId,
            'user_id' => $rejectedId,
            'status' => 'pending',
        ]);
        self::assertSame(1, (int) DB::table('groups')->where('id', $groupId)->value('cached_member_count'));
    }

    public function test_file_storage_and_metadata_are_compensated_when_required_audit_fails(): void
    {
        $ownerId = $this->user();
        $groupId = $this->group($ownerId, 'File mutation audit rollback');
        $this->member($groupId, $ownerId, 'owner');
        $service = new GroupFileService();
        $this->failGroupAuditInserts();

        $uploadError = $this->captureFailure(static fn (): ?array => $service->upload(
            $groupId,
            $ownerId,
            ['file' => UploadedFile::fake()->createWithContent('audit.txt', 'audit rollback bytes')],
        ));
        self::assertStringContainsString('forced group audit failure', $uploadError->getMessage());
        self::assertSame(0, DB::table('group_files')->where('group_id', $groupId)->count());
        Storage::disk('local')->assertDirectoryEmpty("groups/{$this->testTenantId}/{$groupId}");

        $this->dropFailureTriggers();
        $path = "groups/{$this->testTenantId}/{$groupId}/delete-rollback.txt";
        Storage::disk('local')->put($path, 'must be restored');
        $fileId = (int) DB::table('group_files')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'file_name' => 'delete-rollback.txt',
            'file_path' => $path,
            'file_type' => 'text/plain',
            'file_size' => 16,
            'uploaded_by' => $ownerId,
            'download_count' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->failGroupAuditInserts();

        self::assertFalse($service->delete($groupId, $fileId, $ownerId));
        $this->assertDatabaseHas('group_files', ['id' => $fileId, 'file_path' => $path]);
        Storage::disk('local')->assertExists($path);
        self::assertSame('must be restored', Storage::disk('local')->get($path));
    }

    public function test_file_upload_and_delete_write_sanitized_actor_target_audits(): void
    {
        $ownerId = $this->user();
        $groupId = $this->group($ownerId, 'File mutation audit success');
        $this->member($groupId, $ownerId, 'owner');
        $service = new GroupFileService();

        $uploaded = $service->upload(
            $groupId,
            $ownerId,
            ['file' => UploadedFile::fake()->createWithContent('audited.txt', 'audited bytes')],
        );
        self::assertNotNull($uploaded, json_encode($service->getErrors(), JSON_THROW_ON_ERROR));
        $fileId = (int) $uploaded['id'];
        self::assertTrue($service->delete($groupId, $fileId, $ownerId));

        $audits = DB::table('group_audit_log')
            ->where('group_id', $groupId)
            ->whereIn('action', [
                \App\Services\GroupAuditService::ACTION_FILE_UPLOADED,
                \App\Services\GroupAuditService::ACTION_FILE_DELETED,
            ])
            ->get()
            ->keyBy('action');
        self::assertCount(2, $audits);
        foreach ($audits as $audit) {
            self::assertSame($ownerId, (int) $audit->user_id);
            self::assertStringNotContainsString('groups/', (string) $audit->details);
            $details = json_decode((string) $audit->details, true, 512, JSON_THROW_ON_ERROR);
            self::assertSame($fileId, (int) $details['file_id']);
            self::assertSame($ownerId, (int) $details['target_user_id']);
            self::assertArrayNotHasKey('file_path', $details);
        }
    }

    public function test_content_delete_rolls_back_when_required_audit_fails(): void
    {
        $ownerId = $this->user();
        $groupId = $this->group($ownerId, 'Content mutation audit rollback');
        $this->member($groupId, $ownerId, 'owner');
        $announcementId = (int) DB::table('group_announcements')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'title' => 'Atomic announcement',
            'content' => 'This row must survive an audit failure.',
            'is_pinned' => false,
            'priority' => 0,
            'created_by' => $ownerId,
            'created_at' => now(),
        ]);
        $this->failGroupAuditInserts();
        $service = new GroupAnnouncementService();

        $error = $this->captureFailure(
            static fn (): bool => $service->delete($groupId, $announcementId, $ownerId),
        );

        self::assertStringContainsString('forced group audit failure', $error->getMessage());
        $this->assertDatabaseHas('group_announcements', [
            'id' => $announcementId,
            'group_id' => $groupId,
        ]);
    }

    public function test_group_image_replace_and_remove_share_the_audit_transaction(): void
    {
        $ownerId = $this->user();
        $groupId = $this->group($ownerId, 'Image audit atomicity');
        $oldAvatar = "/uploads/tenants/{$this->testTenantId}/groups/old-avatar.png";
        $oldCover = "/uploads/tenants/{$this->testTenantId}/groups/old-cover.png";
        $newAvatar = "/uploads/tenants/{$this->testTenantId}/groups/new-avatar.png";
        DB::table('groups')->where('id', $groupId)->update([
            'image_url' => $oldAvatar,
            'cover_image_url' => $oldCover,
        ]);

        $replacement = GroupService::replaceImage(
            $groupId,
            $ownerId,
            $newAvatar,
            'avatar',
        );
        self::assertNotNull($replacement);
        $audit = DB::table('group_audit_log')
            ->where('group_id', $groupId)
            ->where('action', \App\Services\GroupAuditService::ACTION_GROUP_IMAGE_UPDATED)
            ->first();
        self::assertNotNull($audit);
        self::assertStringNotContainsString('/uploads/', (string) $audit->details);
        self::assertSame([
            'image_type' => 'avatar',
            'operation' => 'replaced',
            'had_previous' => true,
        ], json_decode((string) $audit->details, true, 512, JSON_THROW_ON_ERROR));

        $this->failGroupAuditInserts();
        $error = $this->captureFailure(
            static fn (): ?array => GroupService::replaceImage($groupId, $ownerId, null, 'cover'),
        );
        self::assertStringContainsString('forced group audit failure', $error->getMessage());
        self::assertSame(
            $oldCover,
            DB::table('groups')->where('id', $groupId)->value('cover_image_url'),
        );

        $this->dropFailureTriggers();
        self::assertNotNull(GroupService::replaceImage($groupId, $ownerId, null, 'cover'));
        self::assertNull(DB::table('groups')->where('id', $groupId)->value('cover_image_url'));
        self::assertSame(2, DB::table('group_audit_log')
            ->where('group_id', $groupId)
            ->where('action', \App\Services\GroupAuditService::ACTION_GROUP_IMAGE_UPDATED)
            ->count());
    }

    public function test_chat_pin_and_unpin_roll_back_when_required_audit_fails(): void
    {
        $ownerId = $this->user();
        $groupId = $this->group($ownerId, 'Chat pin audit atomicity');
        $this->member($groupId, $ownerId, 'owner');
        $chatroomId = (int) DB::table('group_chatrooms')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'name' => 'Audit channel',
            'description' => 'Atomic pin fixture.',
            'category' => 'general',
            'is_private' => false,
            'permissions' => null,
            'created_by' => $ownerId,
            'is_default' => false,
            'created_at' => now(),
        ]);
        $messageId = (int) DB::table('group_chatroom_messages')->insertGetId([
            'chatroom_id' => $chatroomId,
            'user_id' => $ownerId,
            'body' => 'The message body must not enter audit metadata.',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $service = new GroupChatroomService();

        $this->failGroupAuditInserts();
        $pinError = $this->captureFailure(
            static fn (): bool => $service->pinMessage($groupId, $chatroomId, $messageId, $ownerId),
        );
        self::assertStringContainsString('forced group audit failure', $pinError->getMessage());
        $this->assertDatabaseMissing('group_chatroom_pinned_messages', [
            'tenant_id' => $this->testTenantId,
            'chatroom_id' => $chatroomId,
            'message_id' => $messageId,
        ]);

        $this->dropFailureTriggers();
        self::assertTrue($service->pinMessage($groupId, $chatroomId, $messageId, $ownerId));
        $pinAudit = DB::table('group_audit_log')
            ->where('group_id', $groupId)
            ->where('action', \App\Services\GroupAuditService::ACTION_CHATROOM_MESSAGE_PINNED)
            ->first();
        self::assertNotNull($pinAudit);
        self::assertStringNotContainsString('message body', strtolower((string) $pinAudit->details));

        $this->failGroupAuditInserts();
        $unpinError = $this->captureFailure(
            static fn (): bool => $service->unpinMessage($groupId, $chatroomId, $messageId, $ownerId),
        );
        self::assertStringContainsString('forced group audit failure', $unpinError->getMessage());
        $this->assertDatabaseHas('group_chatroom_pinned_messages', [
            'tenant_id' => $this->testTenantId,
            'chatroom_id' => $chatroomId,
            'message_id' => $messageId,
        ]);

        $this->dropFailureTriggers();
        self::assertTrue($service->unpinMessage($groupId, $chatroomId, $messageId, $ownerId));
        $this->assertDatabaseHas('group_audit_log', [
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => $ownerId,
            'action' => \App\Services\GroupAuditService::ACTION_CHATROOM_MESSAGE_UNPINNED,
        ]);
    }

    private function user(): int
    {
        $suffix = bin2hex(random_bytes(8));
        $id = (int) DB::table('users')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Atomic Groups User',
            'email' => 'group-atomic-' . $suffix . '@example.test',
            'role' => 'member',
            'status' => 'active',
            'is_approved' => true,
            'is_active' => true,
            'preferred_language' => 'en',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->userIds[] = $id;

        return $id;
    }

    private function group(int $ownerId, string $name): int
    {
        $id = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $ownerId,
            'name' => $name . ' ' . bin2hex(random_bytes(4)),
            'description' => 'Committed Groups audit atomicity fixture.',
            'visibility' => 'public',
            'status' => GroupStatus::Active->value,
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->groupIds[] = $id;

        return $id;
    }

    private function member(int $groupId, int $userId, string $role): void
    {
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => $userId,
            'role' => $role,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function failGroupAuditInserts(): void
    {
        DB::unprepared(
            'CREATE TRIGGER ' . self::GROUP_AUDIT_TRIGGER
            . " BEFORE INSERT ON group_audit_log FOR EACH ROW SIGNAL SQLSTATE '45000' "
            . "SET MESSAGE_TEXT = 'forced group audit failure'",
        );
    }

    private function failActivityInserts(): void
    {
        DB::unprepared(
            'CREATE TRIGGER ' . self::ACTIVITY_TRIGGER
            . " BEFORE INSERT ON activity_log FOR EACH ROW SIGNAL SQLSTATE '45000' "
            . "SET MESSAGE_TEXT = 'forced group activity failure'",
        );
    }

    private function dropFailureTriggers(): void
    {
        DB::unprepared('DROP TRIGGER IF EXISTS ' . self::GROUP_AUDIT_TRIGGER);
        DB::unprepared('DROP TRIGGER IF EXISTS ' . self::ACTIVITY_TRIGGER);
    }

    private function captureFailure(callable $operation): Throwable
    {
        try {
            $operation();
        } catch (Throwable $error) {
            return $error;
        }

        self::fail('Expected the injected audit failure to abort the operation.');
    }
}
