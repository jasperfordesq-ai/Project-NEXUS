<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E062;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\BlockUserService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-285 (E-062) — `user_blocks` has UNIQUE (user_id, blocked_user_id) with no
 * tenant_id, every read is tenant-scoped, and the write was insertOrIgnore. So
 * once a super admin had moved both members to another community, the old row
 * (still carrying the old tenant_id) swallowed every new block of the pair:
 * the API said "blocked", nothing was stored for the new community, the
 * blocked list stayed empty and the "blocked" member could still message.
 *
 * The fix re-homes that stale row into the community the block is made in.
 * Controls: a first block and a repeat block in the same community still
 * behave as before, and an unrelated pair's row is not touched.
 */
class F285BlockAfterCommunityMoveTest extends TestCase
{
    use DatabaseTransactions;

    private const OLD_TENANT = 999;

    protected function setUp(): void
    {
        parent::setUp();
        $this->app['auth']->forgetGuards();
        Cache::flush();
    }

    public function test_reblocking_after_a_community_move_takes_effect_in_the_new_community(): void
    {
        $victim = $this->member(self::OLD_TENANT);
        $attacker = $this->member(self::OLD_TENANT);

        TenantContext::setById(self::OLD_TENANT);
        BlockUserService::block((int) $victim->id, (int) $attacker->id, 'F285 original block');

        // A super admin moves both members (User::moveTenant updates users.tenant_id only).
        $this->moveToTenant($victim, $this->testTenantId);
        $this->moveToTenant($attacker, $this->testTenantId);
        TenantContext::setById($this->testTenantId);
        $this->assertFalse(
            BlockUserService::isBlockedEither((int) $victim->id, (int) $attacker->id),
            'precondition: the old community\'s row does not apply here',
        );

        $this->actAs($victim);
        $this->apiPost('/v2/users/' . $attacker->id . '/block', ['reason' => 'F285 re-block'])
            ->assertOk()
            ->assertJsonPath('data.success', true);

        TenantContext::setById($this->testTenantId);
        $rows = DB::table('user_blocks')
            ->where('user_id', (int) $victim->id)
            ->where('blocked_user_id', (int) $attacker->id)
            ->get();
        $this->assertCount(1, $rows);
        $this->assertSame($this->testTenantId, (int) $rows[0]->tenant_id, 'the block now belongs to the new community');
        $this->assertSame('F285 re-block', (string) $rows[0]->reason);
        $this->assertTrue(
            BlockUserService::isBlockedEither((int) $victim->id, (int) $attacker->id),
            'the block the API reported is actually enforced',
        );

        $listed = array_map(
            static fn (array $r): int => (int) ($r['user_id'] ?? 0),
            $this->apiGet('/v2/users/blocked')->assertOk()->json('data') ?? [],
        );
        $this->assertContains((int) $attacker->id, $listed, 'the member sees the block in their own list');

        $this->actAs($attacker);
        $send = $this->apiPost('/v2/messages', [
            'recipient_id' => (int) $victim->id,
            'body' => 'F285-AFTER-REBLOCK',
        ]);
        $this->assertGreaterThanOrEqual(400, $send->getStatusCode(), 'the blocked member can no longer message');
        $this->assertSame(0, (int) DB::table('messages')->where('body', 'F285-AFTER-REBLOCK')->count());
    }

    public function test_control_a_first_block_and_a_repeat_block_in_the_same_community_are_unchanged(): void
    {
        $victim = $this->member($this->testTenantId);
        $attacker = $this->member($this->testTenantId);

        $this->actAs($victim);
        $this->apiPost('/v2/users/' . $attacker->id . '/block', ['reason' => 'F285 first'])->assertOk();
        $this->actAs($victim);
        $this->apiPost('/v2/users/' . $attacker->id . '/block', ['reason' => 'F285 repeat'])->assertOk();

        TenantContext::setById($this->testTenantId);
        $rows = DB::table('user_blocks')
            ->where('user_id', (int) $victim->id)
            ->where('blocked_user_id', (int) $attacker->id)
            ->get();
        $this->assertCount(1, $rows, 'a repeat block is still idempotent');
        $this->assertSame($this->testTenantId, (int) $rows[0]->tenant_id);
        $this->assertSame('F285 first', (string) $rows[0]->reason, 'a repeat block in the same community keeps the original row');
        $this->assertTrue(BlockUserService::isBlockedEither((int) $victim->id, (int) $attacker->id));
    }

    public function test_control_an_unrelated_pairs_row_in_another_community_is_not_touched(): void
    {
        $other = $this->member(self::OLD_TENANT);
        $otherTarget = $this->member(self::OLD_TENANT);
        TenantContext::setById(self::OLD_TENANT);
        BlockUserService::block((int) $other->id, (int) $otherTarget->id, 'F285 unrelated');

        $victim = $this->member($this->testTenantId);
        $attacker = $this->member($this->testTenantId);
        $this->actAs($victim);
        $this->apiPost('/v2/users/' . $attacker->id . '/block')->assertOk();

        $unrelated = DB::table('user_blocks')
            ->where('user_id', (int) $other->id)
            ->where('blocked_user_id', (int) $otherTarget->id)
            ->first();
        $this->assertNotNull($unrelated);
        $this->assertSame(self::OLD_TENANT, (int) $unrelated->tenant_id);
        $this->assertSame('F285 unrelated', (string) $unrelated->reason);
    }

    private function moveToTenant(User $user, int $tenantId): void
    {
        DB::table('users')->where('id', $user->id)->update(['tenant_id' => $tenantId]);
        $user->tenant_id = $tenantId;
    }

    private function actAs(User $user): void
    {
        $this->app['auth']->forgetGuards();
        $this->withTenant($this->testTenantId);
        Sanctum::actingAs($user, ['*']);
    }

    private function member(int $tenantId): User
    {
        return User::factory()->forTenant($tenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
    }
}
