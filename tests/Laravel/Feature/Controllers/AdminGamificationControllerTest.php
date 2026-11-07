<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for AdminGamificationController.
 *
 * Covers stats, badges CRUD, campaigns CRUD, recheck-all, bulk-award.
 */
class AdminGamificationControllerTest extends TestCase
{
    use DatabaseTransactions;

    // ================================================================
    // MEDAL NAMES — PUT /v2/admin/gamification/badge-config/{key}
    // AWID focus group, Oct 2026: "Can we customise the text … in medals?"
    // The API could, but the admin screen offered only on/off and reset.
    // ================================================================

    private function seedBadge(string $key): void
    {
        DB::table('badges')->insert([
            'tenant_id' => $this->testTenantId, 'badge_key' => $key, 'name' => 'First Exchange',
            'description' => 'Complete your first exchange.', 'icon' => 'award', 'badge_tier' => 'template',
            'is_enabled' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    public function test_an_admin_renames_a_medal_and_clears_the_name_again(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);
        $key = 'awid_rename_' . uniqid();
        $this->seedBadge($key);

        $this->apiPut("/v2/admin/gamification/badge-config/{$key}", [
            'custom_name' => '  Primer intercambio  ',
            'custom_description' => 'Completaste tu primer intercambio.',
        ])->assertStatus(200);

        $row = DB::table('tenant_badge_overrides')->where('tenant_id', $this->testTenantId)->where('badge_key', $key)->first();
        $this->assertSame('Primer intercambio', $row->custom_name);
        $this->assertSame('Completaste tu primer intercambio.', $row->custom_description);

        // Emptying the name returns it to the built-in wording.
        $this->apiPut("/v2/admin/gamification/badge-config/{$key}", ['custom_name' => '', 'custom_description' => ''])
            ->assertStatus(200);
        $row = DB::table('tenant_badge_overrides')->where('tenant_id', $this->testTenantId)->where('badge_key', $key)->first();
        $this->assertNull($row->custom_name);
        $this->assertNull($row->custom_description);
    }

    public function test_a_medal_name_longer_than_the_column_is_refused(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);
        $key = 'awid_long_' . uniqid();
        $this->seedBadge($key);

        $this->apiPut("/v2/admin/gamification/badge-config/{$key}", ['custom_name' => str_repeat('a', 201)])
            ->assertStatus(422);
    }

    // ================================================================
    // STATS — GET /v2/admin/gamification/stats
    // ================================================================

    public function test_stats_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/gamification/stats');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'data' => [
                'total_badges_awarded',
                'active_users',
                'total_xp_awarded',
                'active_campaigns',
                'badge_distribution',
            ],
        ]);
    }

    public function test_stats_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/gamification/stats');

        $response->assertStatus(403);
    }

    public function test_stats_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/gamification/stats');

        $response->assertStatus(401);
    }

    // ================================================================
    // BADGES — GET /v2/admin/gamification/badges
    // ================================================================

    public function test_badges_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/gamification/badges');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_badges_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/gamification/badges');

        $response->assertStatus(403);
    }

    // ================================================================
    // CREATE BADGE — POST /v2/admin/gamification/badges
    // ================================================================

    public function test_create_badge_returns_201_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $this->ensureCustomBadgesTable();

        $response = $this->apiPost('/v2/admin/gamification/badges', [
            'name' => 'Test Badge',
            'description' => 'A test badge',
            'icon' => 'star',
        ]);

        $response->assertStatus(201);
        $response->assertJsonStructure([
            'data' => ['id', 'key', 'name', 'description', 'icon', 'type'],
        ]);
        $response->assertJsonPath('data.name', 'Test Badge');
        $response->assertJsonPath('data.type', 'custom');
    }

    public function test_create_badge_requires_name(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/gamification/badges', [
            'description' => 'No name provided',
        ]);

        $response->assertStatus(422);
    }

    public function test_create_badge_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPost('/v2/admin/gamification/badges', [
            'name' => 'Test Badge',
        ]);

        $response->assertStatus(403);
    }

    // ================================================================
    // CAMPAIGNS — GET /v2/admin/gamification/campaigns
    // ================================================================

    public function test_campaigns_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/gamification/campaigns');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_campaigns_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/gamification/campaigns');

        $response->assertStatus(403);
    }

    // ================================================================
    // RECHECK ALL — POST /v2/admin/gamification/recheck-all
    // ================================================================

    public function test_recheck_all_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/gamification/recheck-all');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'data' => ['users_checked', 'message'],
        ]);
    }

    public function test_recheck_all_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiPost('/v2/admin/gamification/recheck-all');

        $response->assertStatus(401);
    }

    // ================================================================
    // BULK AWARD — POST /v2/admin/gamification/bulk-award
    // ================================================================

    public function test_bulk_award_requires_badge_slug(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/gamification/bulk-award', [
            'user_ids' => [1],
        ]);

        $response->assertStatus(422);
    }

    public function test_bulk_award_requires_user_ids(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/gamification/bulk-award', [
            'badge_slug' => 'test_badge',
        ]);

        $response->assertStatus(422);
    }

    public function test_bulk_award_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPost('/v2/admin/gamification/bulk-award', [
            'badge_slug' => 'test_badge',
            'user_ids' => [1],
        ]);

        $response->assertStatus(403);
    }

    public function test_custom_badges_helper_keeps_the_test_transaction_open(): void
    {
        // CREATE TABLE commits implicitly on MariaDB even when IF NOT EXISTS
        // finds the table, which ends DatabaseTransactions' wrapper: every
        // later write in the test becomes permanent in nexus_test.
        $this->ensureCustomBadgesTable();

        $this->assertSame(
            1,
            (int) DB::selectOne('SELECT @@in_transaction AS t')->t,
            'the helper must not end the test transaction'
        );
    }

    private function ensureCustomBadgesTable(): void
    {
        // Check first: CREATE TABLE commits the test transaction implicitly,
        // even when IF NOT EXISTS finds the table already there.
        if (\Illuminate\Support\Facades\Schema::hasTable('custom_badges')) {
            return;
        }

        DB::statement("CREATE TABLE IF NOT EXISTS custom_badges (
            id INT AUTO_INCREMENT PRIMARY KEY,
            tenant_id INT NOT NULL,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            icon VARCHAR(100) DEFAULT 'award',
            xp INT DEFAULT 0,
            category VARCHAR(100) DEFAULT 'custom',
            is_active TINYINT DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )");
    }
}
