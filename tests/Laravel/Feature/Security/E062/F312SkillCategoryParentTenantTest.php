<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E062;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-312 (E-062) — the F-256 class on skill categories: creating a category
 * checks that its parent exists in the caller's community, but updating one
 * wrote any integer to parent_id, including another community's category id.
 * The update must apply the same check as the create.
 */
class F312SkillCategoryParentTenantTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
    }

    private function category(int $tenantId, string $name): int
    {
        return (int) DB::table('skill_categories')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => $name,
            'slug' => 'f312-' . bin2hex(random_bytes(4)),
            'parent_id' => null,
            'display_order' => 0,
            'is_active' => 1,
            'created_at' => now(),
        ]);
    }

    private function signInAsAdmin(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'admin', 'status' => 'active', 'is_approved' => 1,
        ]));
    }

    public function test_update_refuses_another_communitys_category_as_parent(): void
    {
        $otherTenantId = (int) DB::table('tenants')->where('id', '!=', $this->testTenantId)->orderBy('id')->value('id');
        $this->assertGreaterThan(0, $otherTenantId, 'precondition: a second community exists');
        $foreignParent = $this->category($otherTenantId, 'F312 foreign parent');
        $mine = $this->category($this->testTenantId, 'F312 mine');
        $this->signInAsAdmin();

        $this->apiPut("/v2/skills/categories/{$mine}", ['parent_id' => $foreignParent])->assertStatus(422);

        $this->assertNull(DB::table('skill_categories')->where('id', $mine)->value('parent_id'),
            'a category must never point at another community\'s category');
    }

    public function test_update_refuses_a_parent_that_does_not_exist(): void
    {
        $mine = $this->category($this->testTenantId, 'F312 mine');
        $this->signInAsAdmin();

        $this->apiPut("/v2/skills/categories/{$mine}", ['parent_id' => 2147480000])->assertStatus(422);

        $this->assertNull(DB::table('skill_categories')->where('id', $mine)->value('parent_id'));
    }

    public function test_control_update_accepts_an_own_community_parent_and_clearing_it(): void
    {
        $parent = $this->category($this->testTenantId, 'F312 parent');
        $mine = $this->category($this->testTenantId, 'F312 child');
        $this->signInAsAdmin();

        $this->apiPut("/v2/skills/categories/{$mine}", ['parent_id' => $parent])->assertStatus(200);
        $this->assertSame($parent, (int) DB::table('skill_categories')->where('id', $mine)->value('parent_id'));

        $this->apiPut("/v2/skills/categories/{$mine}", ['parent_id' => null])->assertStatus(200);
        $this->assertNull(DB::table('skill_categories')->where('id', $mine)->value('parent_id'));
    }
}
