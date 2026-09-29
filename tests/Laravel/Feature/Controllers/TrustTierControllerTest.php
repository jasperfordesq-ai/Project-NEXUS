<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

class TrustTierControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function setCaringCommunityFeature(bool $enabled): void
    {
        $tenant = DB::table('tenants')->where('id', $this->testTenantId)->first();
        $features = [];
        if ($tenant && ! empty($tenant->features)) {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : $tenant->features;
            $features = is_array($decoded) ? $decoded : [];
        }

        $features['caring_community'] = $enabled;
        DB::table('tenants')
            ->where('id', $this->testTenantId)
            ->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);
    }

    private function requireTrustTierTables(): void
    {
        if (
            ! Schema::hasColumn('users', 'trust_tier')
            || ! Schema::hasTable('caring_trust_tier_config')
            || ! Schema::hasTable('vol_logs')
            || ! Schema::hasTable('reviews')
        ) {
            $this->markTestSkipped('Trust tier tables are not present in the test database.');
        }
    }

    public function test_member_trust_tier_uses_hours_reviews_and_identity_verification(): void
    {
        $this->requireTrustTierTables();
        $this->setCaringCommunityFeature(true);

        $member = User::factory()->forTenant($this->testTenantId)->create([
            'is_verified' => true,
            'verification_status' => 'passed',
            'verification_completed_at' => now(),
            'trust_tier' => 0,
        ]);

        // E-061 F-269: identity verification is the active id_verified badge.
        // The email/verification_* columns above no longer count on their own.
        DB::table('member_verification_badges')->insert([
            'user_id' => $member->id,
            'tenant_id' => $this->testTenantId,
            'badge_type' => 'id_verified',
            'granted_at' => now(),
        ]);

        DB::table('vol_logs')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'user_id' => $member->id,
                'date_logged' => now()->subDays(4)->toDateString(),
                'hours' => 4.5,
                'description' => 'Neighbour visit',
                'status' => 'approved',
            ],
            [
                'tenant_id' => $this->testTenantId,
                'user_id' => $member->id,
                'date_logged' => now()->subDays(2)->toDateString(),
                'hours' => 5.5,
                'description' => 'Care accompaniment',
                'status' => 'approved',
            ],
        ]);

        for ($i = 0; $i < 3; $i++) {
            $reviewer = User::factory()->forTenant($this->testTenantId)->create();
            DB::table('reviews')->insert([
                'tenant_id' => $this->testTenantId,
                'reviewer_id' => $reviewer->id,
                'receiver_id' => $member->id,
                'rating' => 5,
                'comment' => 'Reliable and kind support.',
                'status' => 'approved',
                'created_at' => now(),
            ]);
        }

        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/caring-community/my-trust-tier');

        $response->assertStatus(200);
        $response->assertJsonPath('data.tier', 3);
        $response->assertJsonPath('data.label', 'verified');
        $response->assertJsonPath('data.next_tier', 'coordinator');

        $this->assertDatabaseHas('users', [
            'id' => $member->id,
            'tenant_id' => $this->testTenantId,
            'trust_tier' => 3,
        ]);
    }

    public function test_member_trust_tier_route_respects_caring_community_feature_gate(): void
    {
        $this->requireTrustTierTables();
        $this->setCaringCommunityFeature(false);

        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/caring-community/my-trust-tier');

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');
    }
}
