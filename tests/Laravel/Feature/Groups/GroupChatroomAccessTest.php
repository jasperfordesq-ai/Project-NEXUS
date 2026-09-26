<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Groups;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\GroupChatroomService;
use App\Services\GroupConfigurationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

final class GroupChatroomAccessTest extends TestCase
{
    use DatabaseTransactions;

    private User $owner;
    private User $nonMember;
    private User $pendingMember;
    private User $member;
    private User $groupAdmin;
    private User $tenantAdmin;
    private User $foreignOwner;

    private int $activeGroupId;
    private int $otherGroupId;
    private int $archivedGroupId;
    private int $foreignGroupId;
    private int $publicChatroomId;
    private int $privateChatroomId;
    private int $otherChatroomId;
    private int $archivedChatroomId;
    private int $foreignChatroomId;
    private int $publicMessageId;
    private int $otherMessageId;
    private int $archivedMessageId;

    protected function setUp(): void
    {
        parent::setUp();

        $features = json_decode((string) DB::table('tenants')
            ->where('id', $this->testTenantId)
            ->value('features'), true) ?: [];
        $features['ideation_challenges'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode($features),
        ]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
        GroupConfigurationService::set(GroupConfigurationService::CONFIG_TAB_CHATROOMS, true);

        $this->owner = $this->user('chat_owner');
        $this->nonMember = $this->user('chat_nonmember');
        $this->pendingMember = $this->user('chat_pending');
        $this->member = $this->user('chat_member');
        $this->groupAdmin = $this->user('chat_group_admin');
        $this->tenantAdmin = User::factory()->forTenant($this->testTenantId)->admin()->create([
            'username' => 'chat_tenant_admin',
        ]);
        $this->foreignOwner = User::factory()->forTenant(999)->create([
            'username' => 'chat_foreign_owner',
        ]);

        TenantContext::setById($this->testTenantId);
        $this->activeGroupId = $this->insertGroup('active', (int) $this->owner->id);
        $this->otherGroupId = $this->insertGroup('active', (int) $this->owner->id);
        $this->archivedGroupId = $this->insertGroup('archived', (int) $this->owner->id);
        $this->foreignGroupId = $this->insertGroup('active', (int) $this->foreignOwner->id, 999);

        $this->insertMembership($this->activeGroupId, $this->pendingMember, 'pending');
        $this->insertMembership($this->activeGroupId, $this->member, 'active');
        $this->insertMembership($this->activeGroupId, $this->groupAdmin, 'active', 'admin');
        $this->insertMembership($this->otherGroupId, $this->groupAdmin, 'active', 'admin');
        $this->insertMembership($this->archivedGroupId, $this->member, 'active');
        $this->insertMembership($this->archivedGroupId, $this->groupAdmin, 'active', 'admin');

        $this->publicChatroomId = $this->insertChatroom($this->activeGroupId, false, (int) $this->owner->id);
        $this->privateChatroomId = $this->insertChatroom($this->activeGroupId, true, (int) $this->owner->id);
        $this->otherChatroomId = $this->insertChatroom($this->otherGroupId, false, (int) $this->owner->id);
        $this->archivedChatroomId = $this->insertChatroom($this->archivedGroupId, false, (int) $this->owner->id);
        $this->foreignChatroomId = $this->insertChatroom(
            $this->foreignGroupId,
            false,
            (int) $this->foreignOwner->id,
            999,
        );

        $this->publicMessageId = $this->insertMessage($this->publicChatroomId, (int) $this->member->id, 'Active group message');
        $this->insertMessage($this->privateChatroomId, (int) $this->member->id, 'Private channel message');
        $this->otherMessageId = $this->insertMessage($this->otherChatroomId, (int) $this->groupAdmin->id, 'Other group message');
        $this->archivedMessageId = $this->insertMessage($this->archivedChatroomId, (int) $this->member->id, 'Archived group message');
        $this->insertMessage($this->foreignChatroomId, (int) $this->foreignOwner->id, 'Foreign tenant message');
    }

    public function test_service_matrix_requires_active_parent_membership_even_for_non_private_chatrooms(): void
    {
        $service = app(GroupChatroomService::class);

        foreach ([$this->nonMember, $this->pendingMember] as $actor) {
            $this->assertNull($service->getChatrooms($this->activeGroupId, null, (int) $actor->id));
            $this->assertSame('FORBIDDEN', $service->getErrors()[0]['code']);
        }

        foreach ([$this->groupAdmin, $this->tenantAdmin] as $actor) {
            $chatrooms = $service->getChatrooms($this->activeGroupId, null, (int) $actor->id);
            $this->assertNotNull($chatrooms);
            $this->assertEqualsCanonicalizing(
                [$this->publicChatroomId, $this->privateChatroomId],
                array_column($chatrooms, 'id'),
            );
        }

        // F-098: a private chatroom (created here by the owner) is not listed
        // to an ordinary member; see PrivateChatroomAccessTest.
        $chatrooms = $service->getChatrooms($this->activeGroupId, null, (int) $this->member->id);
        $this->assertNotNull($chatrooms);
        $this->assertSame([$this->publicChatroomId], array_column($chatrooms, 'id'));

        $this->assertNull($service->getChatrooms($this->foreignGroupId, null, (int) $this->member->id));
        $this->assertSame('NOT_FOUND', $service->getErrors()[0]['code']);

        $this->assertNull($service->getChatrooms($this->archivedGroupId, null, (int) $this->member->id));
        $this->assertSame('FORBIDDEN', $service->getErrors()[0]['code']);
        $this->assertNull($service->getChatrooms($this->archivedGroupId, null, (int) $this->tenantAdmin->id));
        $this->assertSame('FORBIDDEN', $service->getErrors()[0]['code']);
    }

    public function test_http_chatroom_privacy_is_never_weaker_than_the_parent_group(): void
    {
        // F-098: the private chatroom is additionally closed to an ordinary
        // member (third column); group admins and tenant admins keep it.
        foreach ([
            [$this->nonMember, 403, 403],
            [$this->pendingMember, 403, 403],
            [$this->member, 200, 403],
            [$this->groupAdmin, 200, 200],
            [$this->tenantAdmin, 200, 200],
        ] as [$actor, $status, $privateStatus]) {
            $this->authenticateAs($actor);
            $this->apiGet("/v2/groups/{$this->activeGroupId}/chatrooms")->assertStatus($status);
            $this->apiGet("/v2/group-chatrooms/{$this->publicChatroomId}/messages")->assertStatus($status);
            $this->apiGet("/v2/group-chatrooms/{$this->privateChatroomId}/messages")->assertStatus($privateStatus);
        }

        $this->authenticateAs($this->member);
        $this->apiGet("/v2/groups/{$this->foreignGroupId}/chatrooms")->assertNotFound();
        $this->apiGet("/v2/group-chatrooms/{$this->foreignChatroomId}/messages")->assertNotFound();
        $this->apiGet("/v2/group-chatrooms/{$this->archivedChatroomId}/messages")->assertForbidden();
    }

    public function test_pin_unpin_and_pinned_reads_bind_group_chatroom_and_message_ids_together(): void
    {
        $this->authenticateAs($this->groupAdmin);

        $this->apiPost(
            "/v2/groups/{$this->activeGroupId}/chatrooms/{$this->publicChatroomId}/pin/{$this->publicMessageId}",
        )->assertCreated();
        $this->assertDatabaseHas('group_chatroom_pinned_messages', [
            'tenant_id' => $this->testTenantId,
            'chatroom_id' => $this->publicChatroomId,
            'message_id' => $this->publicMessageId,
        ]);

        $this->apiPost(
            "/v2/groups/{$this->activeGroupId}/chatrooms/{$this->otherChatroomId}/pin/{$this->otherMessageId}",
        )->assertNotFound();
        $this->apiPost(
            "/v2/groups/{$this->activeGroupId}/chatrooms/{$this->publicChatroomId}/pin/{$this->otherMessageId}",
        )->assertNotFound();
        $this->apiGet(
            "/v2/groups/{$this->activeGroupId}/chatrooms/{$this->otherChatroomId}/pinned",
        )->assertNotFound();

        $this->apiDelete(
            "/v2/groups/{$this->activeGroupId}/chatrooms/{$this->publicChatroomId}/pin/{$this->otherMessageId}",
        )->assertNotFound();
        $this->assertDatabaseHas('group_chatroom_pinned_messages', [
            'chatroom_id' => $this->publicChatroomId,
            'message_id' => $this->publicMessageId,
        ]);

        $this->apiPost(
            "/v2/groups/{$this->archivedGroupId}/chatrooms/{$this->archivedChatroomId}/pin/{$this->archivedMessageId}",
        )->assertForbidden();
        $this->apiPost(
            "/v2/groups/{$this->foreignGroupId}/chatrooms/{$this->foreignChatroomId}/pin/1",
        )->assertNotFound();

        $this->apiDelete(
            "/v2/groups/{$this->activeGroupId}/chatrooms/{$this->publicChatroomId}/pin/{$this->publicMessageId}",
        )->assertNoContent();
        $this->assertDatabaseMissing('group_chatroom_pinned_messages', [
            'chatroom_id' => $this->publicChatroomId,
            'message_id' => $this->publicMessageId,
        ]);
    }

    public function test_unauthorized_chatroom_writes_fail_before_creating_child_rows(): void
    {
        $before = DB::table('group_chatroom_messages')
            ->where('chatroom_id', $this->publicChatroomId)
            ->count();

        $this->authenticateAs($this->nonMember);
        $this->apiPost("/v2/group-chatrooms/{$this->publicChatroomId}/messages", [
            'body' => 'This must never be stored.',
        ])->assertForbidden();

        $this->authenticateAs($this->member);
        $this->apiPost("/v2/group-chatrooms/{$this->archivedChatroomId}/messages", [
            'body' => 'Archived groups are immutable.',
        ])->assertForbidden();

        $this->assertSame($before, DB::table('group_chatroom_messages')
            ->where('chatroom_id', $this->publicChatroomId)
            ->count());
        $this->assertSame(1, DB::table('group_chatroom_messages')
            ->where('chatroom_id', $this->archivedChatroomId)
            ->count());
    }

    public function test_http_creation_replays_chatrooms_and_messages_from_the_idempotency_header(): void
    {
        $this->authenticateAs($this->groupAdmin);

        $roomHeaders = ['Idempotency-Key' => 'mobile-chatroom-http-replay-1'];
        $firstRoom = $this->apiPost("/v2/groups/{$this->activeGroupId}/chatrooms", [
            'name' => 'Release planning',
        ], $roomHeaders)->assertCreated();
        $roomId = (int) $firstRoom->json('data.id');

        $this->apiPost("/v2/groups/{$this->activeGroupId}/chatrooms", [
            'name' => 'Release planning',
        ], $roomHeaders)->assertOk()
            ->assertJsonPath('data.id', $roomId)
            ->assertJsonPath('data._idempotent_replay', true);

        $messageHeaders = ['Idempotency-Key' => 'mobile-chatroom-message-http-replay-1'];
        $firstMessage = $this->apiPost("/v2/group-chatrooms/{$roomId}/messages", [
            'body' => 'Android build is ready.',
        ], $messageHeaders)->assertCreated();
        $messageId = (int) $firstMessage->json('data.id');

        $this->apiPost("/v2/group-chatrooms/{$roomId}/messages", [
            'body' => 'Android build is ready.',
        ], $messageHeaders)->assertOk()
            ->assertJsonPath('data.id', $messageId)
            ->assertJsonPath('data._idempotent_replay', true);

        $this->apiPost("/v2/group-chatrooms/{$roomId}/messages", [
            'body' => 'Changed intent',
        ], $messageHeaders)->assertConflict();

        $this->assertSame(1, DB::table('group_chatrooms')->where('id', $roomId)->count());
        $this->assertSame(1, DB::table('group_chatroom_messages')->where('id', $messageId)->count());
    }

    private function authenticateAs(User $user): void
    {
        Sanctum::actingAs($user, ['*']);
    }

    private function user(string $username): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(['username' => $username]);
    }

    private function insertGroup(string $status, int $ownerId, ?int $tenantId = null): int
    {
        $tenantId ??= $this->testTenantId;

        return (int) DB::table('groups')->insertGetId([
            'tenant_id' => $tenantId,
            'owner_id' => $ownerId,
            'name' => 'Chatroom access ' . $status . ' ' . uniqid('', true),
            'description' => 'Chatroom authorization fixture.',
            'visibility' => 'private',
            'status' => $status,
            'is_active' => $status === 'active',
            'cached_member_count' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function insertMembership(int $groupId, User $user, string $status, string $role = 'member'): void
    {
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => $user->id,
            'status' => $status,
            'role' => $role,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function insertChatroom(int $groupId, bool $private, int $creatorId, ?int $tenantId = null): int
    {
        return (int) DB::table('group_chatrooms')->insertGetId([
            'tenant_id' => $tenantId ?? $this->testTenantId,
            'group_id' => $groupId,
            'name' => ($private ? 'Private' : 'Public') . ' ' . uniqid('', true),
            'description' => 'Chatroom access fixture.',
            'category' => 'general',
            'is_private' => $private,
            'permissions' => null,
            'created_by' => $creatorId,
            'is_default' => false,
            'created_at' => now(),
        ]);
    }

    private function insertMessage(int $chatroomId, int $userId, string $body): int
    {
        return (int) DB::table('group_chatroom_messages')->insertGetId([
            'chatroom_id' => $chatroomId,
            'user_id' => $userId,
            'body' => $body,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
