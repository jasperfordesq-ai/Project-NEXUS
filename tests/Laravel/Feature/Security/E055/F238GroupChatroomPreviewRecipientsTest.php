<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E055;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\GroupConfigurationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-238 (E-055 B-1) — a group chatroom message produces a bell notification
 * carrying a 120-character preview of the message. The recipient list must be
 * the people allowed to read the room: ACTIVE group members. Pending join
 * requesters, invitees and banned members are refused the chatroom (403) and
 * must not receive the preview either.
 */
final class F238GroupChatroomPreviewRecipientsTest extends TestCase
{
    use DatabaseTransactions;

    public function test_chat_preview_reaches_active_members_only(): void
    {
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
        GroupConfigurationService::set(GroupConfigurationService::CONFIG_TAB_CHATROOMS, true);

        $owner = $this->user('f238_owner');
        $sender = $this->user('f238_sender');
        $member = $this->user('f238_member');
        $pending = $this->user('f238_pending');
        $invited = $this->user('f238_invited');
        $banned = $this->user('f238_banned');
        $outsider = $this->user('f238_outsider');
        TenantContext::setById($this->testTenantId);

        $groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => (int) $owner->id,
            'name' => 'F238 private group ' . uniqid('', true),
            'description' => 'fixture',
            'visibility' => 'private',
            'status' => 'active',
            'is_active' => true,
            'cached_member_count' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        foreach ([
            [$owner, 'active', 'owner'],
            [$sender, 'active', 'member'],
            [$member, 'active', 'member'],
            [$invited, 'invited', 'member'],
            [$banned, 'banned', 'member'],
        ] as [$u, $status, $role]) {
            DB::table('group_members')->insert([
                'tenant_id' => $this->testTenantId,
                'group_id' => $groupId,
                'user_id' => (int) $u->id,
                'status' => $status,
                'role' => $role,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
        $chatroomId = (int) DB::table('group_chatrooms')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'name' => 'General',
            'description' => 'fixture',
            'category' => 'general',
            'is_private' => false,
            'permissions' => null,
            'created_by' => (int) $owner->id,
            'is_default' => false,
            'created_at' => now(),
        ]);

        // The pending row is created through the real "request to join" journey.
        Sanctum::actingAs($pending, ['*']);
        $this->apiPost("/v2/groups/{$groupId}/join");
        self::assertSame(
            'pending',
            DB::table('group_members')->where('group_id', $groupId)->where('user_id', (int) $pending->id)->value('status')
        );

        $secret = 'F238 confidential: meeting moved to the back room at 7';
        Sanctum::actingAs($sender, ['*']);
        $this->apiPost("/v2/group-chatrooms/{$chatroomId}/messages", ['body' => $secret])->assertStatus(201);

        $bell = fn (User $u) => DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', (int) $u->id)
            ->where('type', 'group_chatroom_message')
            ->value('message');

        // Control: the people allowed to read the room still get the preview.
        self::assertStringContainsString('confidential', (string) $bell($owner), 'owner (active) must be notified');
        self::assertStringContainsString('confidential', (string) $bell($member), 'active member must be notified');
        // The sender never notifies themself; an outsider with no row gets nothing.
        self::assertNull($bell($sender), 'sender must not be notified');
        self::assertNull($bell($outsider), 'outsider must not be notified');

        // The fix: rows that cannot read the room receive no preview.
        self::assertNull($bell($pending), 'pending join requester must not receive the chat preview');
        self::assertNull($bell($invited), 'invitee must not receive the chat preview');
        self::assertNull($bell($banned), 'banned member must not receive the chat preview');
    }

    private function user(string $username): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(['username' => $username . '_' . uniqid()]);
    }
}
