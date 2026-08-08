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

class CaringSubRegionControllerTest extends TestCase
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

    private function requireTables(): void
    {
        if (! Schema::hasTable('caring_sub_regions') || ! Schema::hasTable('caring_care_providers')) {
            $this->markTestSkipped('Caring sub-region tables are not present in the test database.');
        }

    }

    public function test_admin_can_create_sub_region_and_member_can_list_active_regions(): void
    {
        $this->requireTables();
        $this->setCaringCommunityFeature(true);

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($admin);

        $create = $this->apiPost('/v2/admin/caring-community/sub-regions', [
            'name' => 'Lorzenhof Quartier',
            'type' => 'quartier',
            'description' => 'Neighbourhood coordination area for Cham.',
            'postal_codes' => ['6330'],
            'center_latitude' => 47.1758,
            'center_longitude' => 8.4622,
        ]);

        $create->assertStatus(201);
        $create->assertJsonPath('data.name', 'Lorzenhof Quartier');
        $create->assertJsonPath('data.slug', 'lorzenhof-quartier');
        $create->assertJsonPath('data.postal_codes.0', '6330');

        Sanctum::actingAs($member);

        $list = $this->apiGet('/v2/caring-community/sub-regions?search=Lorzenhof');
        $list->assertStatus(200);
        $list->assertJsonPath('data.data.0.name', 'Lorzenhof Quartier');
    }

    public function test_provider_directory_can_filter_by_sub_region(): void
    {
        $this->requireTables();
        $this->setCaringCommunityFeature(true);

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($admin);

        $region = $this->apiPost('/v2/admin/caring-community/sub-regions', [
            'name' => 'Herti Ortsteil',
            'type' => 'ortsteil',
            'postal_codes' => '6300',
        ]);
        $region->assertStatus(201);
        $subRegionId = (int) $region->json('data.id');

        $provider = $this->apiPost('/v2/admin/caring-community/providers', [
            'name' => 'Herti Neighbour Support',
            'type' => 'volunteer',
            'description' => 'Local volunteer support.',
            'sub_region_id' => $subRegionId,
        ]);
        $provider->assertStatus(201);
        $provider->assertJsonPath('data.sub_region.id', $subRegionId);

        Sanctum::actingAs($member);

        $list = $this->apiGet('/v2/caring-community/providers?sub_region_id=' . $subRegionId);
        $list->assertStatus(200);
        $list->assertJsonPath('data.data.0.name', 'Herti Neighbour Support');
        $list->assertJsonPath('data.data.0.sub_region.name', 'Herti Ortsteil');
    }

    public function test_sub_region_routes_respect_caring_community_feature_gate(): void
    {
        $this->requireTables();
        $this->setCaringCommunityFeature(false);

        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/caring-community/sub-regions');

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');
    }
}
