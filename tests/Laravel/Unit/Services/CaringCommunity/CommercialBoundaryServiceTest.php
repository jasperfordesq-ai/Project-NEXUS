<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services\CaringCommunity;

use App\Core\TenantContext;
use App\Services\CaringCommunity\CommercialBoundaryService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

/**
 * Tests for CommercialBoundaryService (AG82).
 *
 * This service is COMPLIANCE-CRITICAL: it governs the legal boundary between
 * what is AGPL-licensed code (free for anyone to deploy) and what requires a
 * commercial agreement with the platform operator. Tests cover:
 *
 *  - Canonical matrix structure and correctness of default classifications
 *  - Allow/deny logic of the four classification values
 *  - setOverride (valid key, invalid key, invalid classification, clear override)
 *  - Persistence round-trips
 *  - Sanitisation of corrupt stored overrides
 */
class CommercialBoundaryServiceTest extends TestCase
{
    use DatabaseTransactions;

    private int $tenantId = 2;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();

        TenantContext::setById($this->tenantId);

        // Start every test with a clean slate for this tenant's boundary setting.
        DB::table('tenant_settings')
            ->where('tenant_id', $this->tenantId)
            ->where('setting_key', CommercialBoundaryService::SETTING_KEY)
            ->delete();
    }

    private function service(): CommercialBoundaryService
    {
        return app(CommercialBoundaryService::class);
    }

    // -------------------------------------------------------------------------
    // CLASSIFICATIONS constant — legal boundary enum values
    // -------------------------------------------------------------------------

    public function test_classifications_constant_contains_exactly_four_expected_values(): void
    {
        $expected = ['agpl_public', 'tenant_config', 'private_deployment', 'commercial'];

        // Order must match for strict legal interpretation.
        $this->assertSame($expected, CommercialBoundaryService::CLASSIFICATIONS);
    }

    // -------------------------------------------------------------------------
    // matrix() — canonical structure
    // -------------------------------------------------------------------------

    public function test_matrix_returns_required_top_level_keys(): void
    {
        $m = $this->service()->matrix($this->tenantId);

        $this->assertArrayHasKey('categories', $m);
        $this->assertArrayHasKey('classifications', $m);
        $this->assertArrayHasKey('capabilities', $m);
        $this->assertArrayHasKey('overrides_count', $m);
        $this->assertArrayHasKey('last_updated_at', $m);
    }

    public function test_matrix_capabilities_all_have_required_fields(): void
    {
        $m = $this->service()->matrix($this->tenantId);

        foreach ($m['capabilities'] as $cap) {
            $this->assertArrayHasKey('key', $cap, "Missing 'key' in capability");
            $this->assertArrayHasKey('category', $cap);
            $this->assertArrayHasKey('default_classification', $cap);
            $this->assertArrayHasKey('effective_classification', $cap);
            $this->assertArrayHasKey('is_overridden', $cap);
            $this->assertArrayHasKey('agpl_module', $cap);
        }
    }

    public function test_matrix_default_effective_classification_matches_default_when_no_overrides(): void
    {
        $m = $this->service()->matrix($this->tenantId);

        foreach ($m['capabilities'] as $cap) {
            $this->assertSame(
                $cap['default_classification'],
                $cap['effective_classification'],
                "Capability '{$cap['key']}': effective should equal default when no override applied."
            );
            $this->assertFalse($cap['is_overridden']);
        }
    }

    public function test_matrix_overrides_count_is_zero_initially(): void
    {
        $m = $this->service()->matrix($this->tenantId);

        $this->assertSame(0, $m['overrides_count']);
    }

    // -------------------------------------------------------------------------
    // Specific capability default classifications (compliance-critical)
    // -------------------------------------------------------------------------

    public function test_caring_community_module_defaults_to_agpl_public(): void
    {
        $caps = $this->capabilityByKey('caring_community_module');

        $this->assertNotNull($caps, 'caring_community_module capability must exist in matrix');
        $this->assertSame('agpl_public', $caps['default_classification']);
    }

    public function test_paid_regional_analytics_defaults_to_commercial(): void
    {
        $caps = $this->capabilityByKey('paid_regional_analytics');

        $this->assertNotNull($caps, 'paid_regional_analytics capability must exist in matrix');
        $this->assertSame('commercial', $caps['default_classification']);
        $this->assertFalse($caps['agpl_module'],
            'paid_regional_analytics must NOT be flagged agpl_module — it requires a commercial agreement');
    }

    public function test_partner_api_access_defaults_to_commercial(): void
    {
        $caps = $this->capabilityByKey('partner_api_access');

        $this->assertNotNull($caps);
        $this->assertSame('commercial', $caps['default_classification']);
        $this->assertFalse($caps['agpl_module']);
    }

    public function test_tenant_branded_native_app_defaults_to_private_deployment(): void
    {
        $caps = $this->capabilityByKey('tenant_branded_native_app');

        $this->assertNotNull($caps);
        $this->assertSame('private_deployment', $caps['default_classification']);
        // Source is AGPL even though deployment is private.
        $this->assertTrue($caps['agpl_module']);
    }

    public function test_local_advertising_campaigns_defaults_to_tenant_config(): void
    {
        $caps = $this->capabilityByKey('local_advertising_campaigns');

        $this->assertNotNull($caps);
        $this->assertSame('tenant_config', $caps['default_classification']);
    }

    // -------------------------------------------------------------------------
    // setOverride() — allow decisions
    // -------------------------------------------------------------------------

    public function test_set_override_with_valid_key_and_valid_classification_succeeds(): void
    {
        $result = $this->service()->setOverride($this->tenantId, 'caring_community_module', 'tenant_config');

        $this->assertArrayHasKey('matrix', $result);
        $this->assertArrayNotHasKey('errors', $result);
    }

    public function test_set_override_changes_effective_classification_in_returned_matrix(): void
    {
        $svc = $this->service();
        $svc->setOverride($this->tenantId, 'caring_community_module', 'tenant_config');

        $m = $svc->matrix($this->tenantId);
        $cap = $this->capabilityFromMatrix($m, 'caring_community_module');

        $this->assertSame('tenant_config', $cap['effective_classification']);
        $this->assertTrue($cap['is_overridden']);
    }

    public function test_set_override_increments_overrides_count(): void
    {
        $svc = $this->service();
        $svc->setOverride($this->tenantId, 'caring_community_module', 'tenant_config');
        $svc->setOverride($this->tenantId, 'caring_help_requests', 'commercial');

        $m = $svc->matrix($this->tenantId);
        $this->assertSame(2, $m['overrides_count']);
    }

    public function test_set_override_persists_across_service_instances(): void
    {
        $this->service()->setOverride($this->tenantId, 'caring_pilot_scoreboard', 'commercial');

        // New service instance reads from DB.
        $m = app(CommercialBoundaryService::class)->matrix($this->tenantId);
        $cap = $this->capabilityFromMatrix($m, 'caring_pilot_scoreboard');

        $this->assertSame('commercial', $cap['effective_classification']);
        $this->assertTrue($cap['is_overridden']);
    }

    // -------------------------------------------------------------------------
    // setOverride() — deny / validation decisions
    // -------------------------------------------------------------------------

    public function test_set_override_rejects_unknown_capability_key(): void
    {
        $result = $this->service()->setOverride($this->tenantId, 'blockchain_magic', 'agpl_public');

        $this->assertArrayHasKey('errors', $result);
        $fields = array_column($result['errors'], 'field');
        $this->assertContains('capability_key', $fields);
    }

    public function test_set_override_rejects_invalid_classification_value(): void
    {
        $result = $this->service()->setOverride($this->tenantId, 'caring_community_module', 'freemium');

        $this->assertArrayHasKey('errors', $result);
        $fields = array_column($result['errors'], 'field');
        $this->assertContains('classification', $fields);
        $error = collect($result['errors'])->firstWhere('field', 'classification');
        $this->assertSame('INVALID_CLASSIFICATION', $error['code']);
        $this->assertSame(CommercialBoundaryService::CLASSIFICATIONS, $error['params']['classifications']);
    }

    public function test_set_override_rejects_both_bad_key_and_bad_classification(): void
    {
        $result = $this->service()->setOverride($this->tenantId, 'not_a_real_cap', 'not_a_real_class');

        $this->assertArrayHasKey('errors', $result);
        $this->assertGreaterThanOrEqual(2, count($result['errors']));
    }

    // -------------------------------------------------------------------------
    // setOverride() — clearing an override (null classification)
    // -------------------------------------------------------------------------

    public function test_clear_override_reverts_capability_to_default(): void
    {
        $svc = $this->service();
        // Set then clear the override.
        $svc->setOverride($this->tenantId, 'caring_community_module', 'commercial');
        $svc->setOverride($this->tenantId, 'caring_community_module', null);

        $m = $svc->matrix($this->tenantId);
        $cap = $this->capabilityFromMatrix($m, 'caring_community_module');

        $this->assertSame('agpl_public', $cap['effective_classification']);
        $this->assertFalse($cap['is_overridden']);
        $this->assertSame(0, $m['overrides_count']);
    }

    public function test_clear_override_on_non_overridden_key_is_a_no_op(): void
    {
        // Should succeed without creating an override row.
        $result = $this->service()->setOverride($this->tenantId, 'caring_community_module', null);

        $this->assertArrayHasKey('matrix', $result);
        $this->assertSame(0, $result['matrix']['overrides_count']);
    }

    // -------------------------------------------------------------------------
    // Stored override sanitisation
    // -------------------------------------------------------------------------

    public function test_corrupt_override_with_unknown_key_is_silently_dropped(): void
    {
        // Write a corrupt envelope directly to DB.
        $corrupt = json_encode([
            'overrides' => [
                'caring_community_module' => 'tenant_config', // valid
                'unknown_cap_xyz'         => 'agpl_public',   // invalid key — must be stripped
            ],
        ]);
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->tenantId, 'setting_key' => CommercialBoundaryService::SETTING_KEY],
            ['setting_value' => $corrupt, 'setting_type' => 'json', 'category' => 'caring_community', 'updated_at' => now()]
        );

        $m = $this->service()->matrix($this->tenantId);

        // Only the valid override survives.
        $this->assertSame(1, $m['overrides_count']);
        $cap = $this->capabilityFromMatrix($m, 'caring_community_module');
        $this->assertSame('tenant_config', $cap['effective_classification']);
    }

    public function test_corrupt_override_with_invalid_classification_is_silently_dropped(): void
    {
        $corrupt = json_encode([
            'overrides' => [
                'caring_community_module' => 'pay_per_use', // invalid classification
            ],
        ]);
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->tenantId, 'setting_key' => CommercialBoundaryService::SETTING_KEY],
            ['setting_value' => $corrupt, 'setting_type' => 'json', 'category' => 'caring_community', 'updated_at' => now()]
        );

        $m = $this->service()->matrix($this->tenantId);

        $this->assertSame(0, $m['overrides_count']);
        $cap = $this->capabilityFromMatrix($m, 'caring_community_module');
        $this->assertSame('agpl_public', $cap['effective_classification']); // reverts to default
    }

    // -------------------------------------------------------------------------
    // Helper: find a capability by key inside a matrix result
    // -------------------------------------------------------------------------

    private function capabilityByKey(string $key): ?array
    {
        $m = $this->service()->matrix($this->tenantId);
        return $this->capabilityFromMatrix($m, $key);
    }

    private function capabilityFromMatrix(array $matrix, string $key): ?array
    {
        foreach ($matrix['capabilities'] as $cap) {
            if ($cap['key'] === $key) {
                return $cap;
            }
        }
        return null;
    }
}
