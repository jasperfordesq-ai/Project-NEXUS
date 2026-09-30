<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E067;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\BlockUserService;
use App\Services\GroupMentionService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * E-067 A3 — residual gap in F-070 (@mentioning): GroupMentionService
 * (:79-137), reached from every group discussion create and discussion reply
 * (GroupService.php:2934, :3225), notifies each @mentioned member by bell and
 * push with no block filter, while the feed/comment MentionService::createMentions
 * (:109) drops blocked pairs via BlockUserService::withoutBlockedPairs().
 *
 * A mention is a per-recipient notification, not the indivisible group
 * broadcast F-336 deliberately exempted — the per-recipient filter E-066 §7
 * item 7 calls "the right design" is exactly what MentionService already does.
 *
 * F-387 fix: group mentions drop blocked pairs exactly as feed/comment mentions
 * do. Adapted from `.local-docs-archive/security-log/E-067/repro/a/A3GroupMentionIgnoresBlockTest.php`,
 * which asserted the blocker WAS notified; that assertion is inverted.
 */
class F387GroupMentionRespectsBlockTest extends TestCase
{
    use DatabaseTransactions;

    public function test_blocked_member_cannot_mention_the_blocker_in_a_shared_group(): void
    {
        $tenantId = $this->testTenantId;
        TenantContext::setById($tenantId);

        $suffix = bin2hex(random_bytes(3));
        $blocker = User::factory()->forTenant($tenantId)->create(['username' => 'f387blocker' . $suffix, 'status' => 'active']);
        $blocked = User::factory()->forTenant($tenantId)->create(['username' => 'f387blocked' . $suffix, 'status' => 'active']);
        $friend = User::factory()->forTenant($tenantId)->create(['username' => 'f387friend' . $suffix, 'status' => 'active']);

        $groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $tenantId,
            'owner_id' => (int) $blocker->id,
            'name' => 'F387 mention group ' . $suffix,
            'description' => 'x',
            'visibility' => 'public',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        foreach ([$blocker, $blocked, $friend] as $u) {
            DB::table('group_members')->insert([
                'tenant_id' => $tenantId,
                'group_id' => $groupId,
                'user_id' => (int) $u->id,
                'role' => 'member',
                'status' => 'active',
                'created_at' => now(),
            ]);
        }

        BlockUserService::block((int) $blocker->id, (int) $blocked->id, 'F387');
        $this->assertTrue(BlockUserService::isBlockedEither((int) $blocked->id, (int) $blocker->id));

        // Control 1: the feed/comment mention path drops the blocked pair.
        $feedMentioned = BlockUserService::withoutBlockedPairs((int) $blocked->id, [(int) $blocker->id, (int) $friend->id]);
        $this->assertSame([1 => (int) $friend->id], $feedMentioned, 'control: the F-070 filter removes the blocker');

        // Attack: the blocked member posts in the shared group mentioning the blocker and a friend.
        GroupMentionService::notifyMentioned(
            $groupId,
            (int) $blocked->id,
            'hello @' . $blocker->username . ' and @' . $friend->username,
            'post',
            1,
        );

        // Control 2: the unblocked friend is notified (the rightful case).
        $this->assertSame(1, DB::table('notifications')->where('user_id', (int) $friend->id)->where('type', 'group_mention')->count());
        // The blocker is NOT notified by the member they blocked.
        $this->assertSame(0, DB::table('notifications')->where('user_id', (int) $blocker->id)->where('type', 'group_mention')->count(),
            'the blocker must not receive a group_mention notification from the blocked member');
    }
}
