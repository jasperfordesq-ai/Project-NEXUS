<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\GroupAuditService;
use App\Services\GroupInviteService;
use App\Services\GroupService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * E-035 F-186 — a member removed from a private group must not be able to
 * walk straight back in with a shareable link invite that was issued before
 * the removal. Other people can still use that link, and a manager can
 * deliberately re-invite the removed member with a new link.
 */
class GroupRemovedMemberInviteRejoinTest extends TestCase
{
    use DatabaseTransactions;

    private function seedUser(): int
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        TenantContext::setById($this->testTenantId);

        return (int) $user->id;
    }

    private function seedPrivateGroup(int $ownerId): int
    {
        $groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $ownerId,
            'name' => 'E035 private group',
            'visibility' => 'private',
            'status' => 'active',
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => $ownerId,
            'role' => 'owner',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $groupId;
    }

    /** @param array<string,mixed>|null $link */
    private function tokenFor(?array $link): string
    {
        $this->assertNotNull($link);

        return (string) DB::table('group_invites')
            ->where('tenant_id', $this->testTenantId)
            ->where('id', (int) $link['id'])
            ->value('token');
    }

    private function isActiveMember(int $groupId, int $userId): bool
    {
        return DB::table('group_members')
            ->where('tenant_id', $this->testTenantId)
            ->where('group_id', $groupId)
            ->where('user_id', $userId)
            ->where('status', 'active')
            ->exists();
    }

    public function test_removed_member_cannot_rejoin_with_the_same_link(): void
    {
        $ownerId = $this->seedUser();
        $memberId = $this->seedUser();
        $newcomerId = $this->seedUser();
        $groupId = $this->seedPrivateGroup($ownerId);

        $service = new GroupInviteService();
        $link = $service->createLink($groupId, $ownerId);
        $this->assertNotNull($link, json_encode($service->getErrors()));
        $token = $this->tokenFor($link);

        $joined = $service->acceptInvite($token, $memberId);
        $this->assertNotNull($joined, json_encode($service->getErrors()));
        $this->assertTrue($this->isActiveMember($groupId, $memberId));

        $this->assertTrue(
            GroupService::removeMember($groupId, $memberId, $ownerId),
            json_encode(GroupService::getErrors()),
        );
        $this->assertFalse($this->isActiveMember($groupId, $memberId));

        $again = new GroupInviteService();
        $this->assertNull($again->acceptInvite($token, $memberId));
        $this->assertSame('FORBIDDEN', $again->getErrors()[0]['code'] ?? null);
        $this->assertFalse($this->isActiveMember($groupId, $memberId));

        // The same link still works for somebody who was never removed.
        $fresh = new GroupInviteService();
        $this->assertNotNull($fresh->acceptInvite($token, $newcomerId), json_encode($fresh->getErrors()));
        $this->assertTrue($this->isActiveMember($groupId, $newcomerId));
    }

    public function test_manager_can_deliberately_reinvite_with_a_new_link(): void
    {
        $ownerId = $this->seedUser();
        $memberId = $this->seedUser();
        $groupId = $this->seedPrivateGroup($ownerId);

        $service = new GroupInviteService();
        $token = $this->tokenFor($service->createLink($groupId, $ownerId));
        $this->assertNotNull($service->acceptInvite($token, $memberId));
        $this->assertTrue(GroupService::removeMember($groupId, $memberId, $ownerId));

        // Put the removal clearly before the new link (second-resolution clocks).
        DB::table('group_audit_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('group_id', $groupId)
            ->where('action', GroupAuditService::ACTION_MEMBER_REMOVED)
            ->update(['created_at' => now()->subMinutes(5)]);
        DB::table('group_invites')
            ->where('tenant_id', $this->testTenantId)
            ->where('token', $token)
            ->update(['created_at' => now()->subMinutes(10)]);

        $reinvite = new GroupInviteService();
        $newLink = $reinvite->createLink($groupId, $ownerId);
        $this->assertNotNull($newLink, json_encode($reinvite->getErrors()));
        $this->assertNull((new GroupInviteService())->acceptInvite($token, $memberId));
        $this->assertNotNull((new GroupInviteService())->acceptInvite($this->tokenFor($newLink), $memberId));
        $this->assertTrue($this->isActiveMember($groupId, $memberId));
    }
}
