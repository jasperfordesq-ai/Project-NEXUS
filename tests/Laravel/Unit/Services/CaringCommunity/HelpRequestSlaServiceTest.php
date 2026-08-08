<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services\CaringCommunity;

use App\Services\CaringCommunity\HelpRequestSlaService;
use App\Services\CaringCommunity\OperatingPolicyService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

/**
 * Carbon-v3 SLA regression coverage for HelpRequestSlaService. Both source bugs
 * below are now FIXED; these tests assert the CORRECT behaviour and act as
 * regression guards against the signed/float Carbon-v3 diff semantics.
 *
 * FIXED bug A — Carbon::diffInSeconds() returns a SIGNED float in Carbon v3.
 *   The age line `$now->diffInSeconds($created)` produced a NEGATIVE float, which
 *   both threw `TypeError: bucket(): Argument #1 ($ageSec) must be of type int,
 *   float given` and (once the type was widened) yielded a negative age that
 *   mis-bucketed every breached request as on_track. Fixed by measuring
 *   `max(0.0, $created->diffInSeconds($now))` (older → now, clamped) and widening
 *   bucket()'s first parameter to `float|int`.
 *
 * FIXED bug B — collect()'s turnaround line was
 *   `$turnaroundSec = max(0, $updated->diffInSeconds($created));`
 *   Carbon's diffInSeconds() is SIGNED, so `$updated->diffInSeconds($created)`
 *   returned a NEGATIVE float when $updated is AFTER $created (the normal case),
 *   collapsing every turnaround to max(0, negative) = 0. That made
 *   within_resolution_sla always TRUE and resolved_within_window_24h increment for
 *   every recently-closed row. Fixed by reversing the operands to
 *   `max(0.0, $created->diffInSeconds($updated))` (older → newer).
 */
class HelpRequestSlaServiceTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();

        // Remove any pre-existing policy overrides so tests start from defaults.
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'like', OperatingPolicyService::KEY_PREFIX . '%')
            ->delete();

        // Remove any pre-existing help-request rows for this tenant.
        DB::table('caring_help_requests')
            ->where('tenant_id', $this->testTenantId)
            ->delete();
    }

    private function service(): HelpRequestSlaService
    {
        return app(HelpRequestSlaService::class);
    }

    /**
     * Insert a help-request row using REAL columns from the schema.
     *
     * Real columns: id, tenant_id, user_id, what, when_needed, contact_preference,
     *               status, created_at, updated_at, is_on_behalf, requested_by_id, deleted_at
     */
    private function insertHelpRequest(array $overrides = []): int
    {
        $defaults = [
            'tenant_id'          => $this->testTenantId,
            'user_id'            => 1,
            'what'               => 'Test help request',
            'when_needed'        => 'This week',
            'contact_preference' => 'either',
            'status'             => 'pending',
            'is_on_behalf'       => 0,
            'created_at'         => now(),
            'updated_at'         => now(),
        ];

        return DB::table('caring_help_requests')->insertGetId(array_merge($defaults, $overrides));
    }

    // ──────────────────────────────────────────────────────────────────────
    // dashboard() structure — safe: no rows, bucket() never called
    // ──────────────────────────────────────────────────────────────────────

    public function test_dashboard_returns_expected_top_level_keys(): void
    {
        $result = $this->service()->dashboard($this->testTenantId);

        $this->assertArrayHasKey('policy', $result);
        $this->assertArrayHasKey('summary', $result);
        $this->assertArrayHasKey('open_requests', $result);
        $this->assertArrayHasKey('recently_resolved', $result);
        $this->assertArrayHasKey('generated_at', $result);
    }

    public function test_dashboard_policy_uses_platform_defaults_when_no_policy_set(): void
    {
        $result = $this->service()->dashboard($this->testTenantId);

        $policy = $result['policy'];
        $this->assertSame(24, $policy['first_response_hours']);
        $this->assertSame(72, $policy['resolution_hours']);
        $this->assertSame('platform_defaults', $policy['source']);
    }

    public function test_dashboard_policy_source_is_tenant_policy_when_policy_stored(): void
    {
        app(OperatingPolicyService::class)->update($this->testTenantId, [
            'sla_first_response_hours' => 48,
            'sla_help_request_hours'   => 96,
        ]);

        // No rows → bucket() never called → no TypeError.
        $result = $this->service()->dashboard($this->testTenantId);

        $this->assertSame(48, $result['policy']['first_response_hours']);
        $this->assertSame(96, $result['policy']['resolution_hours']);
        $this->assertSame('tenant_policy', $result['policy']['source']);
    }

    public function test_dashboard_summary_all_zeros_when_no_rows(): void
    {
        $result = $this->service()->dashboard($this->testTenantId);

        $summary = $result['summary'];
        foreach ($summary as $key => $value) {
            $this->assertSame(0, $value, "Expected summary[$key] to be 0, got $value");
        }

        $this->assertSame([], $result['open_requests']);
        $this->assertSame([], $result['recently_resolved']);
    }

    public function test_dashboard_generated_at_is_iso8601_string(): void
    {
        $result = $this->service()->dashboard($this->testTenantId);

        $this->assertIsString($result['generated_at']);
        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}T/', $result['generated_at']);
    }

    public function test_dashboard_summary_has_all_required_keys(): void
    {
        $result = $this->service()->dashboard($this->testTenantId);

        $expectedKeys = [
            'pending',
            'in_progress',
            'first_response_breached',
            'first_response_at_risk',
            'resolution_breached',
            'resolution_at_risk',
            'resolved_within_window_24h',
        ];

        foreach ($expectedKeys as $key) {
            $this->assertArrayHasKey($key, $result['summary'], "Missing summary key: $key");
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // BUCKETS constant
    // ──────────────────────────────────────────────────────────────────────

    public function test_buckets_constant_contains_expected_values(): void
    {
        $this->assertSame(['breached', 'at_risk', 'on_track'], HelpRequestSlaService::BUCKETS);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Tenant isolation — safe: rows are closed & older than 72h
    // (status=closed & updated_at > 72h ago → skips bucket() + recently_resolved)
    // ──────────────────────────────────────────────────────────────────────

    public function test_dashboard_excludes_old_closed_rows_from_other_tenants(): void
    {
        DB::table('caring_help_requests')->insert([
            'tenant_id'          => 999,
            'user_id'            => 1,
            'what'               => 'Other tenant request',
            'when_needed'        => 'Anytime',
            'contact_preference' => 'either',
            'status'             => 'closed',
            'is_on_behalf'       => 0,
            'created_at'         => now()->subHours(200),
            'updated_at'         => now()->subHours(100),
        ]);

        $result = $this->service()->dashboard($this->testTenantId);

        $this->assertSame(0, $result['summary']['pending']);
        $this->assertSame(0, $result['summary']['in_progress']);
        $this->assertSame([], $result['open_requests']);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Bucketing + age (FIXED bug A) — pending/matched rows now bucket correctly.
    //
    // Default policy: first_response SLA = 24h, resolution SLA = 72h.
    // RISK_RATIO_AT_RISK = 0.75 → at_risk threshold is 75% of the target window
    // (18h for first response, 54h for resolution).
    // ──────────────────────────────────────────────────────────────────────

    public function test_pending_request_well_within_sla_is_on_track(): void
    {
        // Age ≈ 1h, well under the 18h at_risk threshold.
        $this->insertHelpRequest([
            'status'     => 'pending',
            'created_at' => now()->subHour(),
        ]);

        $result = $this->service()->dashboard($this->testTenantId);

        $this->assertSame(1, $result['summary']['pending']);
        $this->assertSame(0, $result['summary']['first_response_breached']);
        $this->assertSame(0, $result['summary']['first_response_at_risk']);
        $this->assertCount(1, $result['open_requests']);

        $row = $result['open_requests'][0];
        $this->assertSame('on_track', $row['bucket']);
        $this->assertSame('first_response', $row['sla_dimension']);
        $this->assertSame(24, $row['sla_target_hours']);
    }

    public function test_pending_request_at_risk_above_75_percent_of_sla(): void
    {
        // Age ≈ 20h: ≥ 18h (75% of 24h) but < 24h → at_risk.
        $this->insertHelpRequest([
            'status'     => 'pending',
            'created_at' => now()->subHours(20),
        ]);

        $result = $this->service()->dashboard($this->testTenantId);

        $this->assertSame(1, $result['summary']['first_response_at_risk']);
        $this->assertSame(0, $result['summary']['first_response_breached']);
        $this->assertSame('at_risk', $result['open_requests'][0]['bucket']);
    }

    public function test_pending_request_breached_when_older_than_sla(): void
    {
        // Age ≈ 30h ≥ 24h first-response SLA → breached.
        $this->insertHelpRequest([
            'status'     => 'pending',
            'created_at' => now()->subHours(30),
        ]);

        $result = $this->service()->dashboard($this->testTenantId);

        $this->assertSame(1, $result['summary']['first_response_breached']);
        $this->assertSame(0, $result['summary']['first_response_at_risk']);

        $row = $result['open_requests'][0];
        $this->assertSame('breached', $row['bucket']);
        $this->assertGreaterThanOrEqual(6.0, $row['sla_overage_hours']); // ≈ 30h - 24h
    }

    public function test_matched_request_well_within_resolution_sla_is_on_track(): void
    {
        // Matched (in-progress) measured against the 72h resolution SLA.
        // Age ≈ 10h, well under the 54h at_risk threshold.
        $this->insertHelpRequest([
            'status'     => 'matched',
            'created_at' => now()->subHours(10),
        ]);

        $result = $this->service()->dashboard($this->testTenantId);

        $this->assertSame(1, $result['summary']['in_progress']);
        $this->assertSame(0, $result['summary']['resolution_breached']);
        $this->assertSame(0, $result['summary']['resolution_at_risk']);

        $row = $result['open_requests'][0];
        $this->assertSame('on_track', $row['bucket']);
        $this->assertSame('resolution', $row['sla_dimension']);
        $this->assertSame(72, $row['sla_target_hours']);
    }

    public function test_matched_request_breached_when_older_than_resolution_sla(): void
    {
        // Age ≈ 80h ≥ 72h resolution SLA → breached.
        $this->insertHelpRequest([
            'status'     => 'matched',
            'created_at' => now()->subHours(80),
        ]);

        $result = $this->service()->dashboard($this->testTenantId);

        $this->assertSame(1, $result['summary']['in_progress']);
        $this->assertSame(1, $result['summary']['resolution_breached']);
        $this->assertSame('breached', $result['open_requests'][0]['bucket']);
    }

    public function test_open_requests_sorted_breached_before_at_risk_before_on_track(): void
    {
        $this->insertHelpRequest(['status' => 'pending', 'created_at' => now()->subHour()]);    // on_track
        $this->insertHelpRequest(['status' => 'pending', 'created_at' => now()->subHours(20)]); // at_risk
        $this->insertHelpRequest(['status' => 'pending', 'created_at' => now()->subHours(30)]); // breached

        $result = $this->service()->dashboard($this->testTenantId);

        $this->assertCount(3, $result['open_requests']);
        $buckets = array_column($result['open_requests'], 'bucket');
        $this->assertSame(['breached', 'at_risk', 'on_track'], $buckets);
    }

    public function test_sla_breach_uses_tenant_policy_sla_not_platform_defaults(): void
    {
        // Tighten the first-response SLA to 2h via tenant policy.
        app(OperatingPolicyService::class)->update($this->testTenantId, [
            'sla_first_response_hours' => 2,
            'sla_help_request_hours'   => 72,
        ]);

        // Age ≈ 3h: on_track under the 24h default, but breached under the 2h policy.
        $this->insertHelpRequest([
            'status'     => 'pending',
            'created_at' => now()->subHours(3),
        ]);

        $result = $this->service()->dashboard($this->testTenantId);

        $this->assertSame(2, $result['policy']['first_response_hours']);
        $this->assertSame('tenant_policy', $result['policy']['source']);
        $this->assertSame(1, $result['summary']['first_response_breached']);

        $row = $result['open_requests'][0];
        $this->assertSame('breached', $row['bucket']);
        $this->assertSame(2, $row['sla_target_hours']);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Recently resolved — turnaround / within-SLA (FIXED bug B).
    //
    // With the signed-diff fix, $turnaroundSec is now the real elapsed
    // created → updated time, so within_resolution_sla and
    // resolved_within_window_24h reflect actual turnaround.
    // ──────────────────────────────────────────────────────────────────────

    public function test_closed_request_within_72h_appears_in_recently_resolved(): void
    {
        $this->insertHelpRequest([
            'status'     => 'closed',
            'created_at' => now()->subHours(48),
            'updated_at' => now()->subHour(),
        ]);

        $result = $this->service()->dashboard($this->testTenantId);

        $this->assertSame(0, $result['summary']['pending']);
        $this->assertCount(1, $result['recently_resolved']);

        $row = $result['recently_resolved'][0];
        $this->assertArrayHasKey('turnaround_hours', $row);
        $this->assertArrayHasKey('within_resolution_sla', $row);
        $this->assertSame('closed', $row['status']);

        // Regression guard for bug B: created 48h ago, updated 1h ago → real
        // turnaround ≈ 47h. The old signed-diff bug collapsed this to 0.0.
        $this->assertEqualsWithDelta(47.0, $row['turnaround_hours'], 0.2);
        $this->assertTrue($row['within_resolution_sla']); // 47h ≤ 72h SLA
    }

    public function test_closed_request_older_than_72h_does_not_appear_in_recently_resolved(): void
    {
        $this->insertHelpRequest([
            'status'     => 'closed',
            'created_at' => now()->subHours(200),
            'updated_at' => now()->subHours(100), // updated > 72h ago
        ]);

        $result = $this->service()->dashboard($this->testTenantId);

        $this->assertCount(0, $result['recently_resolved']);
    }

    /**
     * Turnaround ≈ 2h (created 3h ago, updated 1h ago) is ≤ 24h, so
     * resolved_within_window_24h is incremented.
     */
    public function test_closed_within_24h_turnaround_increments_resolved_within_window_24h(): void
    {
        $this->insertHelpRequest([
            'status'     => 'closed',
            'created_at' => now()->subHours(3),
            'updated_at' => now()->subHour(),
        ]);

        $result = $this->service()->dashboard($this->testTenantId);

        $this->assertSame(1, $result['summary']['resolved_within_window_24h']);
        $this->assertEqualsWithDelta(2.0, $result['recently_resolved'][0]['turnaround_hours'], 0.2);
    }

    /**
     * Regression guard for bug B: turnaround ≈ 48h (created 49h ago, updated 1h
     * ago) is > 24h, so resolved_within_window_24h must NOT be incremented even
     * though the row is still within the 72h recently-resolved window. Under the
     * old signed-diff bug this wrongly counted as 1 (turnaround collapsed to 0).
     */
    public function test_closed_turnaround_beyond_24h_does_not_increment_resolved_within_window_24h(): void
    {
        $this->insertHelpRequest([
            'status'     => 'closed',
            'created_at' => now()->subHours(49),
            'updated_at' => now()->subHour(),
        ]);

        $result = $this->service()->dashboard($this->testTenantId);

        // Real turnaround ≈ 48h > 24h → counter stays 0.
        $this->assertSame(0, $result['summary']['resolved_within_window_24h']);

        // Row still appears in recently_resolved (correct — updated within 72h).
        $this->assertCount(1, $result['recently_resolved']);
        $this->assertEqualsWithDelta(48.0, $result['recently_resolved'][0]['turnaround_hours'], 0.2);
    }

    /**
     * Default resolution SLA = 72h. Turnaround ≈ 24h (created 25h ago, updated 1h
     * ago) is within SLA → within_resolution_sla is true.
     */
    public function test_closed_request_within_resolution_sla_sets_within_resolution_sla_true(): void
    {
        $this->insertHelpRequest([
            'status'     => 'closed',
            'created_at' => now()->subHours(25),
            'updated_at' => now()->subHour(),
        ]);

        $result = $this->service()->dashboard($this->testTenantId);

        $this->assertCount(1, $result['recently_resolved']);
        $this->assertEqualsWithDelta(24.0, $result['recently_resolved'][0]['turnaround_hours'], 0.2);
        $this->assertTrue($result['recently_resolved'][0]['within_resolution_sla']);
    }

    /**
     * Regression guard for bug B: turnaround ≈ 73h (created 74h ago, updated 1h
     * ago) exceeds the 72h resolution SLA, so within_resolution_sla must be FALSE.
     * Under the old signed-diff bug turnaround collapsed to 0 and this wrongly
     * read true.
     */
    public function test_closed_request_outside_resolution_sla_sets_within_resolution_sla_false(): void
    {
        $this->insertHelpRequest([
            'status'     => 'closed',
            'created_at' => now()->subHours(74),
            'updated_at' => now()->subHour(),
        ]);

        $result = $this->service()->dashboard($this->testTenantId);

        $this->assertCount(1, $result['recently_resolved']);
        $this->assertEqualsWithDelta(73.0, $result['recently_resolved'][0]['turnaround_hours'], 0.2);
        $this->assertFalse($result['recently_resolved'][0]['within_resolution_sla']);
    }

    // ──────────────────────────────────────────────────────────────────────
    // KEY_PREFIX constant
    // ──────────────────────────────────────────────────────────────────────

    public function test_key_prefix_constant_is_expected_value(): void
    {
        $this->assertSame('caring.operating_policy.', OperatingPolicyService::KEY_PREFIX);
    }
}
