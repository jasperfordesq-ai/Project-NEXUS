<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Groups;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * GET /v2/admin/groups/recommendations must report the group recommendations
 * the platform actually generated for members.
 *
 * Until 2026-10-01 the endpoint read a `group_recommendations` table that has
 * never existed. The query threw, a catch swallowed it, and the admin page
 * always showed 0 / 0.00 / 0% with "No recommendations found" while
 * `group_match_cache` (written by GroupMatchingService::warmUpCache) held
 * thousands of rows. These tests seed that real table and assert the page's
 * figures come from it.
 */
final class AdminGroupRecommendationsDataTest extends TestCase
{
    use DatabaseTransactions;

    private const FOREIGN_TENANT_ID = 999;

    public function test_admin_sees_generated_recommendations_with_real_stats(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $joiner = User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => 'Recjoin',
            'last_name' => 'Member',
        ]);
        $browser = User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => 'Recbrowse',
            'last_name' => 'Member',
        ]);

        $joinedGroup = $this->insertGroup($this->testTenantId, (int) $owner->id, 'Rec Joined Group');
        $openGroup = $this->insertGroup($this->testTenantId, (int) $owner->id, 'Rec Open Group');

        $this->insertMatch($this->testTenantId, (int) $joiner->id, $joinedGroup, 80.0, '2026-09-01 10:00:00');
        $this->insertMatch($this->testTenantId, (int) $browser->id, $openGroup, 40.0, '2026-09-02 10:00:00');
        $this->insertMembership($joinedGroup, (int) $joiner->id, $this->testTenantId);

        Sanctum::actingAs($admin);
        $response = $this->apiGet('/v2/admin/groups/recommendations?limit=50');

        $response->assertOk();
        $data = $response->json('data');

        $this->assertSame(2, $data['stats']['total']);
        $this->assertEqualsWithDelta(0.60, $data['stats']['avg_score'], 0.001);
        $this->assertEqualsWithDelta(50.0, $data['stats']['join_rate'], 0.001);

        $rows = $data['recommendations'];
        $this->assertCount(2, $rows);

        // Newest first.
        $this->assertSame($openGroup, $rows[0]['group_id']);
        $this->assertSame('Rec Open Group', $rows[0]['group_name']);
        $this->assertSame('Recbrowse Member', $rows[0]['user_name']);
        $this->assertEqualsWithDelta(0.40, $rows[0]['score'], 0.001);
        $this->assertFalse($rows[0]['joined']);
        $this->assertNotEmpty($rows[0]['created_at']);

        $this->assertSame($joinedGroup, $rows[1]['group_id']);
        $this->assertEqualsWithDelta(0.80, $rows[1]['score'], 0.001);
        $this->assertTrue($rows[1]['joined']);
    }

    public function test_other_tenants_recommendations_are_not_shown(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);
        $before = $this->apiGet('/v2/admin/groups/recommendations')->assertOk()->json('data.stats.total');

        $foreignUser = User::factory()->forTenant(self::FOREIGN_TENANT_ID)->create();
        $foreignGroup = $this->insertGroup(self::FOREIGN_TENANT_ID, (int) $foreignUser->id, 'Foreign Rec Group');
        // Newest row in the table, so it would top the list if tenant scoping failed.
        $this->insertMatch(self::FOREIGN_TENANT_ID, (int) $foreignUser->id, $foreignGroup, 90.0, '2099-01-01 10:00:00');

        $data = $this->apiGet('/v2/admin/groups/recommendations')->assertOk()->json('data');

        $this->assertNotContains($foreignGroup, array_column($data['recommendations'], 'group_id'));
        $this->assertSame($before, $data['stats']['total']);
    }

    private function insertGroup(int $tenantId, int $ownerId, string $name): int
    {
        return (int) DB::table('groups')->insertGetId([
            'tenant_id' => $tenantId,
            'owner_id' => $ownerId,
            'name' => $name,
            'slug' => 'admin-rec-' . $tenantId . '-' . uniqid(),
            'description' => 'Admin recommendations fixture.',
            'visibility' => 'public',
            'status' => 'active',
            'is_active' => true,
            'is_featured' => false,
            'cached_member_count' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function insertMatch(int $tenantId, int $userId, int $groupId, float $score, string $createdAt): void
    {
        DB::table('group_match_cache')->insert([
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'group_id' => $groupId,
            'match_score' => $score,
            'match_reasons' => json_encode(['Matches your interests']),
            'status' => 'new',
            'algorithm_version' => 'v2',
            'created_at' => $createdAt,
            'expires_at' => now()->addDays(7),
        ]);
    }

    private function insertMembership(int $groupId, int $userId, int $tenantId): void
    {
        DB::table('group_members')->insert([
            'tenant_id' => $tenantId,
            'group_id' => $groupId,
            'user_id' => $userId,
            'status' => 'active',
            'role' => 'member',
            'joined_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
