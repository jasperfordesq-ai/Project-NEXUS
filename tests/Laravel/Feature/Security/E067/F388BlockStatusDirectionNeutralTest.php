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
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-388 (E-067) — GET /v2/users/{id}/block-status returned `is_blocked_by`,
 * telling a blocked member exactly who had blocked them. Every interaction
 * path refuses a blocked pair "direction-neutrally … so the actor cannot tell
 * whether they were blocked or are the blocker" (BlockUserService); this
 * endpoint undid that for anyone who walked ids.
 *
 * `is_blocked_by` stays in the response for client compatibility but is always
 * false. `is_blocked` (whether the CALLER blocked this person) is unchanged.
 */
final class F388BlockStatusDirectionNeutralTest extends TestCase
{
    use DatabaseTransactions;

    public function test_a_blocked_member_cannot_learn_who_blocked_them(): void
    {
        $blocker = $this->member();
        $blocked = $this->member();
        BlockUserService::block((int) $blocker->id, (int) $blocked->id);

        Sanctum::actingAs($blocked, ['*']);
        $res = $this->apiGet('/v2/users/' . $blocker->id . '/block-status')->assertOk();

        self::assertFalse($res->json('data.is_blocked_by'), 'the blocked member must not be told who blocked them');
        self::assertFalse($res->json('data.is_blocked'));
    }

    public function test_control_the_blocker_still_sees_their_own_block(): void
    {
        $blocker = $this->member();
        $blocked = $this->member();
        BlockUserService::block((int) $blocker->id, (int) $blocked->id);

        Sanctum::actingAs($blocker, ['*']);
        $res = $this->apiGet('/v2/users/' . $blocked->id . '/block-status')->assertOk();

        self::assertTrue($res->json('data.is_blocked'), 'a member can still see whom they have blocked');
    }

    private function member(): User
    {
        TenantContext::setById($this->testTenantId);

        return User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
    }
}
