<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\CaringCommunity;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Hardening tests for the Municipal ROI admin endpoint.
 *
 * Covers the procurement-grade additions for KISS / Age-Stiftung / cantonal
 * social-department evaluators:
 *
 *   1. Date-range filter (from / to query params) actually filters
 *   2. Tenant-configurable hourly rate
 *      (`caring_community.formal_care_hourly_rate_chf`) flows through to
 *      formal_care_offset_chf
 *   3. Substitution-weighting via `categories.substitution_coefficient`
 *      multiplies hours when the column is present
 *   4. Sub-region breakdown returns rows once `caring_sub_regions`,
 *      `caring_care_providers.sub_region_id`, and a chain of relationships
 *      with approved logs are populated
 *   5. CSV export endpoint streams the expected metric rows
 */
class MunicipalRoiHardeningTest extends TestCase
{
    use DatabaseTransactions;

    private int $tenantId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenantId = $this->testTenantId;

        $this->setCaringCommunityFeature(true);
        TenantContext::setById($this->tenantId);

        // Wipe data so each test sees a deterministic empty tenant.
        DB::table('vol_logs')->where('tenant_id', $this->tenantId)->delete();
        if (Schema::hasTable('caring_support_relationships')) {
            DB::table('caring_support_relationships')->where('tenant_id', $this->tenantId)->delete();
        }
        if (Schema::hasTable('caring_care_providers')) {
            DB::table('caring_care_providers')->where('tenant_id', $this->tenantId)->delete();
        }
        if (Schema::hasTable('caring_sub_regions')) {
            DB::table('caring_sub_regions')->where('tenant_id', $this->tenantId)->delete();
        }
        DB::table('tenant_settings')
            ->where('tenant_id', $this->tenantId)
            ->where('setting_key', 'caring_community.formal_care_hourly_rate_chf')
            ->delete();
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function setCaringCommunityFeature(bool $enabled): void
    {
        $tenant = DB::table('tenants')->where('id', $this->tenantId)->first();
        $features = [];
        if ($tenant && !empty($tenant->features)) {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : $tenant->features;
            $features = is_array($decoded) ? $decoded : [];
        }
        $features['caring_community'] = $enabled;
        DB::table('tenants')
            ->where('id', $this->tenantId)
            ->update(['features' => json_encode($features)]);
    }

    private function makeAdmin(): User
    {
        return User::factory()->forTenant($this->tenantId)->admin()->create();
    }

    private function seedVolLog(int $userId, float $hours, Carbon $createdAt, ?int $relationshipId = null): int
    {
        return (int) DB::table('vol_logs')->insertGetId([
            'tenant_id'                       => $this->tenantId,
            'user_id'                         => $userId,
            'opportunity_id'                  => null,
            'caring_support_relationship_id'  => $relationshipId,
            'date_logged'                     => $createdAt->toDateString(),
            'hours'                           => $hours,
            'description'                     => 'test',
            'status'                          => 'approved',
            'created_at'                      => $createdAt->toDateTimeString(),
            'updated_at'                      => $createdAt->toDateTimeString(),
        ]);
    }

    public function test_date_range_filter_excludes_logs_outside_window(): void
    {
        Carbon::setTestNow('2026-05-01 12:00:00');

        $admin = $this->makeAdmin();
        Sanctum::actingAs($admin);

        $member = User::factory()->forTenant($this->tenantId)->create();

        // Log inside range (2026-03-15)
        $this->seedVolLog($member->id, 10.0, Carbon::parse('2026-03-15 09:00:00'));
        // Log outside range (2025-12-01)
        $this->seedVolLog($member->id, 99.0, Carbon::parse('2025-12-01 09:00:00'));

        $response = $this->apiGet('/v2/admin/caring-community/municipal-roi?from=2026-01-01&to=2026-04-30');
        $response->assertStatus(200);

        $data = $response->json('data');

        $this->assertSame('2026-01-01', $data['period']['from'] ?? null);
        $this->assertSame('2026-04-30', $data['period']['to'] ?? null);
        $this->assertEqualsWithDelta(10.0, (float) $data['total_hours'], 0.001, 'Out-of-range log must be excluded');
        $this->assertSame(1, (int) $data['total_exchanges']);
    }

    public function test_tenant_hourly_rate_override_flows_through_to_formal_care_offset(): void
    {
        Carbon::setTestNow('2026-05-01 12:00:00');

        $admin = $this->makeAdmin();
        Sanctum::actingAs($admin);

        // Override hourly rate to 40 CHF
        DB::table('tenant_settings')->insert([
            'tenant_id'     => $this->tenantId,
            'setting_key'   => 'caring_community.formal_care_hourly_rate_chf',
            'setting_value' => '40',
            'setting_type'  => 'integer',
            'category'      => 'caring_community',
            'created_at'    => now(),
            'updated_at'    => now(),
        ]);

        $member = User::factory()->forTenant($this->tenantId)->create();
        $this->seedVolLog($member->id, 10.0, Carbon::parse('2026-03-15 09:00:00'));

        $response = $this->apiGet('/v2/admin/caring-community/municipal-roi?from=2026-01-01&to=2026-04-30');
        $response->assertStatus(200);

        $data = $response->json('data');

        $this->assertSame(40.0, (float) $data['roi']['hourly_rate_chf']);
        $this->assertSame('tenant_setting', $data['methodology']['hourly_rate_source']);
        // weighted_hours falls back to total_hours when no category coefficient is in play
        $expectedOffset = 10.0 * 40.0;
        $this->assertEqualsWithDelta($expectedOffset, (float) $data['roi']['formal_care_offset_chf'], 0.001);
        $this->assertEqualsWithDelta($expectedOffset * 2, (float) $data['roi']['prevention_value_chf'], 0.001);
    }

    public function test_substitution_coefficient_weights_hours(): void
    {
        Carbon::setTestNow('2026-05-01 12:00:00');

        $admin = $this->makeAdmin();
        Sanctum::actingAs($admin);

        // Create a category with coefficient 0.5
        $categoryId = (int) DB::table('categories')->insertGetId([
            'tenant_id'                 => $this->tenantId,
            'name'                      => 'Test Companionship ' . uniqid(),
            'slug'                      => 'test-companionship-' . uniqid(),
            'sort_order'                => 0,
            'is_active'                 => 1,
            'color'                     => 'blue',
            'type'                      => 'caring',
            'substitution_coefficient'  => 0.5,
            'created_at'                => now(),
        ]);

        $member = User::factory()->forTenant($this->tenantId)->create();
        $recipient = User::factory()->forTenant($this->tenantId)->create();

        // Create a caring_support_relationship pointing at our weighted category
        $relationshipId = (int) DB::table('caring_support_relationships')->insertGetId([
            'tenant_id'        => $this->tenantId,
            'supporter_id'     => $member->id,
            'recipient_id'     => $recipient->id,
            'category_id'      => $categoryId,
            'title'            => 'Test relationship',
            'frequency'        => 'weekly',
            'expected_hours'   => 1.00,
            'start_date'       => '2026-01-01',
            'status'           => 'active',
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);

        // 10 hours linked through the 0.5-coefficient category
        $this->seedVolLog($member->id, 10.0, Carbon::parse('2026-03-15 09:00:00'), $relationshipId);

        $response = $this->apiGet('/v2/admin/caring-community/municipal-roi?from=2026-01-01&to=2026-04-30');
        $response->assertStatus(200);

        $data = $response->json('data');

        $this->assertEqualsWithDelta(10.0, (float) $data['total_hours'], 0.001);
        $this->assertEqualsWithDelta(5.0, (float) $data['weighted_hours'], 0.001, 'weighted_hours = 10 × 0.5');
        $this->assertTrue((bool) $data['methodology']['substitution_applied']);
        // formal_care_offset_chf uses weighted hours × default rate (35)
        $this->assertEqualsWithDelta(5.0 * 35.0, (float) $data['roi']['formal_care_offset_chf'], 0.001);
    }

    public function test_sub_region_breakdown_returns_rows_when_chain_populated(): void
    {
        if (!Schema::hasTable('caring_sub_regions')
            || !Schema::hasTable('caring_care_providers')
            || !Schema::hasColumn('caring_care_providers', 'sub_region_id')
        ) {
            $this->markTestSkipped('Sub-region tables not present in this schema.');
        }

        Carbon::setTestNow('2026-05-01 12:00:00');

        $admin = $this->makeAdmin();
        Sanctum::actingAs($admin);

        $member = User::factory()->forTenant($this->tenantId)->create();
        $recipient = User::factory()->forTenant($this->tenantId)->create();

        // Sub-region
        $subRegionId = (int) DB::table('caring_sub_regions')->insertGetId([
            'tenant_id'  => $this->tenantId,
            'name'       => 'Quartier Test',
            'slug'       => 'quartier-test-' . uniqid(),
            'type'       => 'quartier',
            'status'     => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Care provider (organization) attached to sub-region
        $providerId = (int) DB::table('caring_care_providers')->insertGetId([
            'tenant_id'     => $this->tenantId,
            'name'          => 'Spitex Test',
            'type'          => 'spitex',
            'sub_region_id' => $subRegionId,
            'status'        => 'active',
            'created_at'    => now(),
            'updated_at'    => now(),
        ]);

        // Relationship → that provider
        $relationshipId = (int) DB::table('caring_support_relationships')->insertGetId([
            'tenant_id'       => $this->tenantId,
            'supporter_id'    => $member->id,
            'recipient_id'    => $recipient->id,
            'organization_id' => $providerId,
            'title'           => 'Test relationship',
            'frequency'       => 'weekly',
            'expected_hours'  => 1.00,
            'start_date'      => '2026-01-01',
            'status'          => 'active',
            'created_at'      => now(),
            'updated_at'      => now(),
        ]);

        $this->seedVolLog($member->id, 7.0, Carbon::parse('2026-03-15 09:00:00'), $relationshipId);

        $response = $this->apiGet('/v2/admin/caring-community/municipal-roi?from=2026-01-01&to=2026-04-30');
        $response->assertStatus(200);

        $data = $response->json('data');

        $this->assertArrayHasKey('breakdown_by_sub_region', $data);
        $this->assertNotEmpty($data['breakdown_by_sub_region']);

        $row = collect($data['breakdown_by_sub_region'])
            ->firstWhere('sub_region_id', $subRegionId);
        $this->assertNotNull($row, 'Seeded sub-region must appear in breakdown');
        $this->assertEqualsWithDelta(7.0, (float) $row['hours'], 0.001);
    }

    public function test_csv_export_streams_expected_rows(): void
    {
        Carbon::setTestNow('2026-05-01 12:00:00');

        $admin = $this->makeAdmin();
        Sanctum::actingAs($admin);

        $member = User::factory()->forTenant($this->tenantId)->create();
        $this->seedVolLog($member->id, 10.0, Carbon::parse('2026-03-15 09:00:00'));

        $response = $this->apiGet('/v2/admin/caring-community/municipal-roi/export?from=2026-01-01&to=2026-04-30');
        $response->assertStatus(200);

        // Streamed responses don't expose Content-Type on the TestResponse the
        // same way regular JsonResponse does — assert via the underlying response.
        $contentType = $response->headers->get('Content-Type');
        $this->assertNotNull($contentType);
        $this->assertStringContainsString('text/csv', strtolower($contentType));

        $disposition = $response->headers->get('Content-Disposition');
        $this->assertNotNull($disposition);
        $this->assertStringContainsString('municipal-roi-', $disposition);
        $this->assertStringContainsString('2026-01-01', $disposition);
        $this->assertStringContainsString('2026-04-30', $disposition);

        $body = $response->streamedContent();
        // fputcsv quotes any field containing whitespace, so labels with spaces appear
        // wrapped: "Period start",2026-01-01,
        $this->assertStringContainsString('Metric,Value,Unit', $body);
        $this->assertStringContainsString('"Period start",2026-01-01', $body);
        $this->assertStringContainsString('"Period end",2026-04-30', $body);
        $this->assertStringContainsString('Total approved hours', $body);
        $this->assertStringContainsString('Substitution-weighted hours', $body);
        $this->assertStringContainsString('Formal care hourly rate', $body);
        $this->assertStringContainsString('Formal care offset', $body);
        $this->assertStringContainsString('Prevention value (2x multiplier)', $body);
        $this->assertStringContainsString('Active members', $body);
        $this->assertStringContainsString('Active relationships', $body);
        $this->assertStringContainsString('Care recipients (out of isolation)', $body);
    }
}
