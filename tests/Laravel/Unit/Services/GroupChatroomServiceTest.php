<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Models\Group;
use App\Models\User;
use App\Services\GroupAuditService;
use App\Services\GroupChatroomService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

class GroupChatroomServiceTest extends TestCase
{
    use DatabaseTransactions;

    private GroupChatroomService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new GroupChatroomService();
    }

    public function test_public_contract_exposes_expected_methods(): void
    {
        $reflection = new \ReflectionClass(GroupChatroomService::class);
        foreach (['getChatrooms', 'getById', 'create', 'ensureDefaultChatroom', 'delete', 'getMessages', 'postMessage', 'deleteMessage', 'pinMessage', 'unpinMessage', 'getPinnedMessages'] as $method) {
            $this->assertTrue($reflection->getMethod($method)->isPublic(), $method);
        }
    }

    public function test_default_chatroom_uses_the_active_locale_and_is_idempotent(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $group = Group::factory()->forTenant($this->testTenantId)->create([
            'owner_id' => $owner->id,
            'status' => 'active',
            'is_active' => true,
        ]);
        $previousLocale = App::getLocale();

        try {
            App::setLocale('de');

            $firstId = $this->service->ensureDefaultChatroom((int) $group->id, (int) $owner->id);
            $secondId = $this->service->ensureDefaultChatroom((int) $group->id, (int) $owner->id);

            self::assertNotNull($firstId);
            self::assertSame($firstId, $secondId);
            self::assertDatabaseHas('group_chatrooms', [
                'id' => $firstId,
                'tenant_id' => $this->testTenantId,
                'group_id' => $group->id,
                'created_by' => $owner->id,
                'name' => 'Allgemein',
                'description' => 'Standard-Gruppenchat',
                'is_default' => 1,
            ]);
            self::assertSame(1, DB::table('group_chatrooms')
                ->where('tenant_id', $this->testTenantId)
                ->where('group_id', $group->id)
                ->where('is_default', true)
                ->count());
        } finally {
            App::setLocale($previousLocale);
        }
    }

    public function test_chatroom_lists_require_an_explicit_viewer(): void
    {
        $this->assertNull($this->service->getChatrooms(1));
        $this->assertSame('FORBIDDEN', $this->service->getErrors()[0]['code']);
    }

    public function test_message_lists_require_an_explicit_viewer(): void
    {
        $this->assertNull($this->service->getMessages(1));
        $this->assertSame('FORBIDDEN', $this->service->getErrors()[0]['code']);
    }

    public function test_message_and_chatroom_delete_write_actor_target_audits(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $group = Group::factory()->forTenant($this->testTenantId)->create([
            'owner_id' => $owner->id,
            'status' => 'active',
            'is_active' => true,
        ]);
        $chatroomId = $this->service->create((int) $group->id, (int) $owner->id, [
            'name' => 'Audited room',
        ]);
        self::assertNotNull($chatroomId);
        $messageId = $this->service->postMessage((int) $chatroomId, (int) $owner->id, 'Delete this message');
        self::assertNotNull($messageId);

        self::assertTrue($this->service->deleteMessage((int) $messageId, (int) $owner->id));
        self::assertTrue($this->service->delete((int) $chatroomId, (int) $owner->id));

        $audits = DB::table('group_audit_log')
            ->where('group_id', $group->id)
            ->whereIn('action', [
                GroupAuditService::ACTION_CHATROOM_MESSAGE_DELETED,
                GroupAuditService::ACTION_CHATROOM_DELETED,
            ])
            ->get()
            ->keyBy('action');
        self::assertCount(2, $audits);
        self::assertSame((int) $owner->id, (int) $audits[GroupAuditService::ACTION_CHATROOM_MESSAGE_DELETED]->user_id);
        self::assertSame((int) $owner->id, (int) $audits[GroupAuditService::ACTION_CHATROOM_DELETED]->user_id);
        $messageDetails = json_decode(
            (string) $audits[GroupAuditService::ACTION_CHATROOM_MESSAGE_DELETED]->details,
            true,
            512,
            JSON_THROW_ON_ERROR,
        );
        self::assertSame((int) $messageId, (int) $messageDetails['message_id']);
        self::assertSame((int) $owner->id, (int) $messageDetails['target_user_id']);
    }

    public function test_chatroom_and_message_creation_replay_the_original_result_without_duplicates(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $group = Group::factory()->forTenant($this->testTenantId)->create([
            'owner_id' => $owner->id,
            'status' => 'active',
            'is_active' => true,
        ]);

        $roomKey = 'mobile-chatroom-' . bin2hex(random_bytes(8));
        $firstRoomId = $this->service->create((int) $group->id, (int) $owner->id, [
            'name' => 'Planning',
            'idempotency_key' => $roomKey,
        ]);
        self::assertNotNull($firstRoomId);
        self::assertFalse($this->service->lastOperationWasReplay());

        $secondRoomId = $this->service->create((int) $group->id, (int) $owner->id, [
            'name' => 'Planning',
            'idempotency_key' => $roomKey,
        ]);
        self::assertSame($firstRoomId, $secondRoomId);
        self::assertTrue($this->service->lastOperationWasReplay());
        self::assertSame(1, DB::table('group_chatrooms')->where('id', $firstRoomId)->count());

        $messageKey = 'mobile-chat-message-' . bin2hex(random_bytes(8));
        $firstMessageId = $this->service->postMessage((int) $firstRoomId, (int) $owner->id, 'Status update', $messageKey);
        self::assertNotNull($firstMessageId);
        self::assertFalse($this->service->lastOperationWasReplay());

        $secondMessageId = $this->service->postMessage((int) $firstRoomId, (int) $owner->id, 'Status update', $messageKey);
        self::assertSame($firstMessageId, $secondMessageId);
        self::assertTrue($this->service->lastOperationWasReplay());
        self::assertSame(1, DB::table('group_chatroom_messages')->where('id', $firstMessageId)->count());
    }

    public function test_chatroom_message_idempotency_key_cannot_be_reused_for_changed_content(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $group = Group::factory()->forTenant($this->testTenantId)->create([
            'owner_id' => $owner->id,
            'status' => 'active',
            'is_active' => true,
        ]);
        $chatroomId = $this->service->create((int) $group->id, (int) $owner->id, ['name' => 'General']);
        self::assertNotNull($chatroomId);

        $key = 'mobile-chat-message-' . bin2hex(random_bytes(8));
        self::assertNotNull($this->service->postMessage((int) $chatroomId, (int) $owner->id, 'Original', $key));
        self::assertNull($this->service->postMessage((int) $chatroomId, (int) $owner->id, 'Changed', $key));
        self::assertSame('IDEMPOTENCY_CONFLICT', $this->service->getErrors()[0]['code']);
        self::assertSame(1, DB::table('group_chatroom_messages')->where('chatroom_id', $chatroomId)->count());
    }

    public function test_getErrors_returns_array(): void
    {
        $this->assertIsArray($this->service->getErrors());
    }
}
