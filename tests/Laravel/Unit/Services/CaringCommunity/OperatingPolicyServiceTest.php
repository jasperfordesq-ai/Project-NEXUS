<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services\CaringCommunity;

use App\Services\CaringCommunity\OperatingPolicyService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

class OperatingPolicyServiceTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();

        // Clean any pre-existing policy rows for our test tenant to ensure isolation.
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'like', OperatingPolicyService::KEY_PREFIX . '%')
            ->delete();
    }

    private function service(): OperatingPolicyService
    {
        return app(OperatingPolicyService::class);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Schema / structure
    // ──────────────────────────────────────────────────────────────────────

    public function test_schema_returns_all_expected_fields(): void
    {
        $schema = $this->service()->schema();

        $expectedFields = [
            'approval_authority',
            'trusted_reviewer_threshold',
            'sla_first_response_hours',
            'sla_help_request_hours',
            'legacy_hour_settlement',
            'reciprocal_balance_threshold_hours',
            'safeguarding_escalation_user_id',
            'chf_hourly_rate',
            'chf_prevention_multiplier',
            'statement_cadence',
            'policy_appendix_url',
        ];

        foreach ($expectedFields as $field) {
            $this->assertArrayHasKey($field, $schema, "Missing schema field: $field");
        }

        $this->assertCount(count($expectedFields), $schema);
    }

    public function test_schema_field_has_type_and_default(): void
    {
        $schema = $this->service()->schema();

        foreach ($schema as $field => $meta) {
            $this->assertArrayHasKey('type', $meta, "Field $field missing 'type'");
            $this->assertArrayHasKey('default', $meta, "Field $field missing 'default'");
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // get() — defaults when no rows stored
    // ──────────────────────────────────────────────────────────────────────

    public function test_get_returns_schema_defaults_when_no_policy_stored(): void
    {
        $result = $this->service()->get($this->testTenantId);

        $this->assertArrayHasKey('policy', $result);
        $this->assertArrayHasKey('schema', $result);
        $this->assertArrayHasKey('last_updated_at', $result);

        $policy = $result['policy'];
        $this->assertSame('admin', $policy['approval_authority']);
        $this->assertSame(5, $policy['trusted_reviewer_threshold']);
        $this->assertSame(24, $policy['sla_first_response_hours']);
        $this->assertSame(72, $policy['sla_help_request_hours']);
        $this->assertSame('transfer_to_beneficiary', $policy['legacy_hour_settlement']);
        $this->assertSame(40, $policy['reciprocal_balance_threshold_hours']);
        $this->assertNull($policy['safeguarding_escalation_user_id']);
        $this->assertEqualsWithDelta(35.0, $policy['chf_hourly_rate'], 0.001);
        $this->assertEqualsWithDelta(2.0, $policy['chf_prevention_multiplier'], 0.001);
        $this->assertSame('quarterly', $policy['statement_cadence']);
        $this->assertNull($policy['policy_appendix_url']);
    }

    public function test_get_last_updated_at_is_null_when_no_policy_stored(): void
    {
        $result = $this->service()->get($this->testTenantId);

        $this->assertNull($result['last_updated_at']);
    }

    // ──────────────────────────────────────────────────────────────────────
    // update() — happy paths
    // ──────────────────────────────────────────────────────────────────────

    public function test_update_persists_sla_first_response_hours(): void
    {
        $result = $this->service()->update($this->testTenantId, [
            'sla_first_response_hours' => 48,
        ]);

        $this->assertArrayHasKey('policy', $result);
        $this->assertSame(48, $result['policy']['sla_first_response_hours']);

        // Verify it survives a fresh get().
        $fresh = $this->service()->get($this->testTenantId);
        $this->assertSame(48, $fresh['policy']['sla_first_response_hours']);
    }

    public function test_update_persists_sla_help_request_hours(): void
    {
        $result = $this->service()->update($this->testTenantId, [
            'sla_help_request_hours' => 120,
        ]);

        $this->assertArrayHasKey('policy', $result);
        $this->assertSame(120, $result['policy']['sla_help_request_hours']);

        $fresh = $this->service()->get($this->testTenantId);
        $this->assertSame(120, $fresh['policy']['sla_help_request_hours']);
    }

    public function test_update_persists_approval_authority_enum(): void
    {
        $result = $this->service()->update($this->testTenantId, [
            'approval_authority' => 'coordinator',
        ]);

        $this->assertArrayHasKey('policy', $result);
        $this->assertSame('coordinator', $result['policy']['approval_authority']);
    }

    public function test_update_persists_chf_float_fields(): void
    {
        $result = $this->service()->update($this->testTenantId, [
            'chf_hourly_rate' => 42.5,
            'chf_prevention_multiplier' => 3.0,
        ]);

        $this->assertArrayHasKey('policy', $result);
        $this->assertEqualsWithDelta(42.5, $result['policy']['chf_hourly_rate'], 0.001);
        $this->assertEqualsWithDelta(3.0, $result['policy']['chf_prevention_multiplier'], 0.001);
    }

    public function test_update_sets_nullable_url_field(): void
    {
        $result = $this->service()->update($this->testTenantId, [
            'policy_appendix_url' => 'https://example.com/policy.pdf',
        ]);

        $this->assertArrayHasKey('policy', $result);
        $this->assertSame('https://example.com/policy.pdf', $result['policy']['policy_appendix_url']);
    }

    public function test_update_clears_nullable_url_field_with_null(): void
    {
        // First set a URL.
        $this->service()->update($this->testTenantId, [
            'policy_appendix_url' => 'https://example.com/policy.pdf',
        ]);

        // Now clear it.
        $result = $this->service()->update($this->testTenantId, [
            'policy_appendix_url' => null,
        ]);

        $this->assertArrayHasKey('policy', $result);
        $this->assertNull($result['policy']['policy_appendix_url']);
    }

    public function test_update_is_partial_leaves_other_fields_unchanged(): void
    {
        // Persist a non-default value first.
        $this->service()->update($this->testTenantId, [
            'approval_authority' => 'mutual',
        ]);

        // Partial update touches only one unrelated field.
        $this->service()->update($this->testTenantId, [
            'statement_cadence' => 'monthly',
        ]);

        $fresh = $this->service()->get($this->testTenantId);
        $this->assertSame('mutual', $fresh['policy']['approval_authority']);
        $this->assertSame('monthly', $fresh['policy']['statement_cadence']);
    }

    public function test_update_sets_last_updated_at_after_save(): void
    {
        $this->service()->update($this->testTenantId, [
            'sla_first_response_hours' => 12,
        ]);

        $fresh = $this->service()->get($this->testTenantId);
        $this->assertNotNull($fresh['last_updated_at']);
    }

    // ──────────────────────────────────────────────────────────────────────
    // update() — validation failures
    // ──────────────────────────────────────────────────────────────────────

    public function test_update_rejects_sla_first_response_hours_below_min(): void
    {
        $result = $this->service()->update($this->testTenantId, [
            'sla_first_response_hours' => 0,
        ]);

        $this->assertArrayHasKey('errors', $result);
        $fields = array_column($result['errors'], 'field');
        $this->assertContains('sla_first_response_hours', $fields);
    }

    public function test_update_rejects_sla_first_response_hours_above_max(): void
    {
        $result = $this->service()->update($this->testTenantId, [
            'sla_first_response_hours' => 999,
        ]);

        $this->assertArrayHasKey('errors', $result);
        $fields = array_column($result['errors'], 'field');
        $this->assertContains('sla_first_response_hours', $fields);
    }

    public function test_update_rejects_invalid_approval_authority_enum(): void
    {
        $result = $this->service()->update($this->testTenantId, [
            'approval_authority' => 'god_mode',
        ]);

        $this->assertArrayHasKey('errors', $result);
        $fields = array_column($result['errors'], 'field');
        $this->assertContains('approval_authority', $fields);
    }

    public function test_update_rejects_non_numeric_int_field(): void
    {
        $result = $this->service()->update($this->testTenantId, [
            'trusted_reviewer_threshold' => 'many',
        ]);

        $this->assertArrayHasKey('errors', $result);
        $fields = array_column($result['errors'], 'field');
        $this->assertContains('trusted_reviewer_threshold', $fields);
    }

    public function test_update_rejects_invalid_url_for_policy_appendix_url(): void
    {
        $result = $this->service()->update($this->testTenantId, [
            'policy_appendix_url' => 'not-a-url',
        ]);

        $this->assertArrayHasKey('errors', $result);
        $fields = array_column($result['errors'], 'field');
        $this->assertContains('policy_appendix_url', $fields);
    }

    public function test_update_does_not_persist_on_any_validation_error(): void
    {
        // Confirm no policy yet.
        $before = $this->service()->get($this->testTenantId);
        $this->assertSame(24, $before['policy']['sla_first_response_hours']);

        // Pass one valid and one invalid field together.
        $result = $this->service()->update($this->testTenantId, [
            'sla_first_response_hours' => 48,      // valid
            'approval_authority' => 'invalid_val', // invalid
        ]);

        $this->assertArrayHasKey('errors', $result);

        // sla_first_response_hours must NOT have been persisted.
        $after = $this->service()->get($this->testTenantId);
        $this->assertSame(24, $after['policy']['sla_first_response_hours']);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Tenant isolation
    // ──────────────────────────────────────────────────────────────────────

    public function test_get_returns_defaults_for_different_tenant(): void
    {
        // Store a custom value for our test tenant.
        $this->service()->update($this->testTenantId, [
            'sla_first_response_hours' => 48,
        ]);

        // A completely different tenant must still see the defaults.
        $other = $this->service()->get(999);
        $this->assertSame(24, $other['policy']['sla_first_response_hours']);
    }
}
