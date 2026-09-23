<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\GroupConfigurationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-098 (E-027) — a group chatroom can be created "private" and the app shows
 * it with a lock and a "Private" label, but the flag was never checked: every
 * member of the group could list it, read it and post in it.
 *
 * There is no per-chatroom member list, so "private" now means: the member who
 * created it, the group's owner and admins, and community administrators.
 */
class PrivateChatroomAccessTest extends TestCase
{
    use DatabaseTransactions;

    private User $owner;
    private User $member;
    private User $creator;
    private User $groupAdmin;
    private User $tenantAdmin;
    private int $groupId;
    private int $privateRoomId;
    private int $openRoomId;
    private int $privateMessageId;

    protected function setUp(): void
    {
        parent::setUp();

        $features = json_decode((string) DB::table('tenants')->where('id', $this->testTenantId)->value('features'), true) ?: [];
        $features['ideation_challenges'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
        GroupConfigurationService::set(GroupConfigurationService::CONFIG_TAB_CHATROOMS, true);

        $this->owner = $this->user();
        $this->member = $this->user();
        $this->creator = $this->user();
        $this->groupAdmin = $this->user();
        $this->tenantAdmin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        TenantContext::setById($this->testTenantId);

        $this->groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $this->owner->id,
            'name' => 'Private chatroom fixture ' . uniqid('', true),
            'description' => 'F-098 fixture',
            'visibility' => 'public',
            'status' => 'active',
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        foreach ([[$this->owner, 'owner'], [$this->member, 'member'], [$this->creator, 'member'], [$this->groupAdmin, 'admin']] as [$u, $role]) {
            DB::table('group_members')->insert([
                'tenant_id' => $this->testTenantId,
                'group_id' => $this->groupId,
                'user_id' => $u->id,
                'status' => 'active',
                'role' => $role,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        $this->privateRoomId = $this->chatroom(true, $this->creator);
        $this->openRoomId = $this->chatroom(false, $this->owner);
        $this->privateMessageId = (int) DB::table('group_chatroom_messages')->insertGetId([
            'chatroom_id' => $this->privateRoomId,
            'user_id' => $this->creator->id,
            'body' => 'Private planning note',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_ordinary_member_cannot_list_read_post_or_see_pins_of_a_private_chatroom(): void
    {
        Sanctum::actingAs($this->member, ['*']);

        $ids = array_column($this->apiGet("/v2/groups/{$this->groupId}/chatrooms")->assertStatus(200)->json('data') ?? [], 'id');
        $this->assertContains($this->openRoomId, $ids);
        $this->assertNotContains($this->privateRoomId, $ids);

        $this->apiGet("/v2/group-chatrooms/{$this->privateRoomId}/messages")->assertStatus(403);
        $this->apiPost("/v2/group-chatrooms/{$this->privateRoomId}/messages", ['body' => 'Let me in'])->assertStatus(403);
        $this->apiGet("/v2/groups/{$this->groupId}/chatrooms/{$this->privateRoomId}/pinned")->assertStatus(403);
        $this->assertDatabaseMissing('group_chatroom_messages', ['chatroom_id' => $this->privateRoomId, 'body' => 'Let me in']);

        // The open chatroom is unaffected.
        $this->apiGet("/v2/group-chatrooms/{$this->openRoomId}/messages")->assertStatus(200);
    }

    public function test_creator_group_admins_and_tenant_admins_keep_access(): void
    {
        foreach ([$this->creator, $this->owner, $this->groupAdmin, $this->tenantAdmin] as $actor) {
            Sanctum::actingAs($actor, ['*']);

            $ids = array_column($this->apiGet("/v2/groups/{$this->groupId}/chatrooms")->assertStatus(200)->json('data') ?? [], 'id');
            $this->assertContains($this->privateRoomId, $ids);
            $this->apiGet("/v2/group-chatrooms/{$this->privateRoomId}/messages")->assertStatus(200)
                ->assertJsonFragment(['body' => 'Private planning note']);
        }
    }

    // ------------------------------------------------------------------

    private function chatroom(bool $private, User $creator): int
    {
        return (int) DB::table('group_chatrooms')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'group_id' => $this->groupId,
            'name' => ($private ? 'Private ' : 'Open ') . uniqid('', true),
            'description' => 'F-098 fixture',
            'category' => 'general',
            'is_private' => $private,
            'permissions' => null,
            'created_by' => $creator->id,
            'is_default' => false,
            'created_at' => now(),
        ]);
    }

    private function user(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
    }
}
