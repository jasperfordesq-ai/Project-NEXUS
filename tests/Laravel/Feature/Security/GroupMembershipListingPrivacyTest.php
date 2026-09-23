<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-096 (E-027) — `GET /v2/groups?user_id=X` listed which groups any member
 * belongs to. Even public groups can be sensitive (a bereavement or recovery
 * support group), and membership is not shown anywhere else to other members.
 * The filter is now honoured only for the viewer's own id, or for an
 * administrator.
 */
class GroupMembershipListingPrivacyTest extends TestCase
{
    use DatabaseTransactions;

    private int $groupId;

    private User $target;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        TenantContext::setById($this->testTenantId);

        $owner = $this->member();
        $this->target = $this->member();
        $this->groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $owner->id,
            'name' => 'Bereavement support ' . bin2hex(random_bytes(3)),
            'description' => 'F-096 fixture',
            'visibility' => 'public',
            'status' => 'active',
            'is_active' => 1,
            'created_at' => now(),
        ]);
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $this->groupId,
            'user_id' => $this->target->id,
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
        ]);
    }

    public function test_another_member_cannot_list_someones_group_memberships(): void
    {
        Sanctum::actingAs($this->member(), ['*']);

        $ids = $this->groupIds("/v2/groups?user_id={$this->target->id}&per_page=100");

        $this->assertNotContains($this->groupId, $ids);
    }

    public function test_member_can_list_their_own_groups(): void
    {
        Sanctum::actingAs($this->target, ['*']);

        $this->assertContains($this->groupId, $this->groupIds("/v2/groups?user_id={$this->target->id}&per_page=100"));
    }

    public function test_admin_can_list_a_members_groups(): void
    {
        Sanctum::actingAs($this->member(['role' => 'admin']), ['*']);

        $this->assertContains($this->groupId, $this->groupIds("/v2/groups?user_id={$this->target->id}&per_page=100"));
    }

    // ------------------------------------------------------------------

    /** @return list<int> */
    private function groupIds(string $uri): array
    {
        $rows = $this->apiGet($uri)->assertStatus(200)->json('data') ?? [];

        return array_values(array_map(static fn ($r): int => (int) ((array) $r)['id'], $rows));
    }

    /** @param array<string, mixed> $overrides */
    private function member(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
        TenantContext::setById($this->testTenantId);

        return $user;
    }
}
