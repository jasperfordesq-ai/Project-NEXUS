<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services\CaringCommunity;

use App\Services\CaringCommunity\PilotScoreboardService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

class PilotScoreboardServiceTest extends TestCase
{
    use DatabaseTransactions;

    // Use a high isolated tenant id so live tenant-2 data never pollutes our counts.
    private int $tid = 99600;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();

        // Ensure the isolated tenant row exists (required by FK on some tables).
        DB::table('tenants')->insertOrIgnore([
            'id'                => $this->tid,
            'name'              => 'Scoreboard Test Tenant',
            'slug'              => 'scoreboard-test-99600',
            'domain'            => null,
            'is_active'         => true,
            'depth'             => 0,
            'allows_subtenants' => false,
            'created_at'        => now(),
            'updated_at'        => now(),
        ]);

        \App\Core\TenantContext::setById($this->tid);

        // Wipe any leftover rows from a previous non-transactional run.
        if (Schema::hasTable('caring_kpi_baselines')) {
            DB::table('caring_kpi_baselines')->where('tenant_id', $this->tid)->delete();
        }
        if (Schema::hasTable('caring_support_relationships')) {
            DB::table('caring_support_relationships')->where('tenant_id', $this->tid)->delete();
        }
        if (Schema::hasTable('caring_help_requests')) {
            DB::table('caring_help_requests')->where('tenant_id', $this->tid)->delete();
        }
        if (Schema::hasTable('vol_logs')) {
            DB::table('vol_logs')->where('tenant_id', $this->tid)->delete();
        }
        if (Schema::hasTable('caring_emergency_alerts')) {
            DB::table('caring_emergency_alerts')->where('tenant_id', $this->tid)->delete();
        }
    }

    private function service(): PilotScoreboardService
    {
        return app(PilotScoreboardService::class);
    }

    /** Insert a minimal active user under the isolated tenant; returns id. */
    private function insertUser(string $role = 'member', string $status = 'active'): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id'  => $this->tid,
            'name'       => 'Scoreboard User ' . uniqid(),
            'email'      => 'sb_' . uniqid() . '@example.com',
            'status'     => $status,
            'role'       => $role,
            'created_at' => now(),
        ]);
    }

    // ──────────────────────────────────────────────────────────────────────
    // captureCurrentMetrics() — shape
    // ──────────────────────────────────────────────────────────────────────

    public function test_capture_current_metrics_returns_all_ten_keys_plus_methodology(): void
    {
        $metrics = $this->service()->captureCurrentMetrics($this->tid);

        $expectedKeys = [
            'active_members',
            'first_response_hours',
            'approved_hours',
            'recurring_relationships',
            'coordinator_workload_hrs',
            'satisfaction_score',
            'social_isolation_pct',
            'comms_reach_pct',
            'business_participation',
            'cost_offset_chf',
            'methodology',
        ];

        foreach ($expectedKeys as $key) {
            $this->assertArrayHasKey($key, $metrics, "Missing key: $key");
        }

        $this->assertIsArray($metrics['methodology']);
        $this->assertArrayHasKey('window_days', $metrics['methodology']);
        $this->assertArrayHasKey('hourly_rate_chf', $metrics['methodology']);
        $this->assertArrayHasKey('prevention_multiplier', $metrics['methodology']);
    }

    public function test_methodology_constants_match_spec(): void
    {
        $metrics = $this->service()->captureCurrentMetrics($this->tid);
        $m = $metrics['methodology'];

        $this->assertSame(90, $m['window_days']);
        $this->assertSame(35, $m['hourly_rate_chf']);
        $this->assertSame(2, $m['prevention_multiplier']);
    }

    // ──────────────────────────────────────────────────────────────────────
    // cost_offset_chf = approved_hours × 35 × 2
    // ──────────────────────────────────────────────────────────────────────

    public function test_cost_offset_chf_is_approved_hours_times_35_times_2(): void
    {
        $userId = $this->insertUser();

        // Insert 4.0 approved hours in the 90-day window.
        DB::table('vol_logs')->insert([
            'tenant_id'  => $this->tid,
            'user_id'    => $userId,
            'date_logged' => now()->toDateString(),
            'hours'      => '4.00',
            'status'     => 'approved',
            'created_at' => now(),
        ]);

        $metrics = $this->service()->captureCurrentMetrics($this->tid);

        // 4 hours × 35 CHF × 2 = 280.00
        $this->assertEqualsWithDelta(4.0, $metrics['approved_hours'], 0.01);
        $this->assertEqualsWithDelta(280.0, $metrics['cost_offset_chf'], 0.01);
    }

    public function test_cost_offset_chf_is_zero_when_no_approved_hours(): void
    {
        $metrics = $this->service()->captureCurrentMetrics($this->tid);

        $this->assertEqualsWithDelta(0.0, $metrics['approved_hours'], 0.001);
        $this->assertEqualsWithDelta(0.0, $metrics['cost_offset_chf'], 0.001);
    }

    public function test_approved_hours_ignores_pending_and_declined_logs(): void
    {
        $userId = $this->insertUser();

        DB::table('vol_logs')->insert([
            ['tenant_id' => $this->tid, 'user_id' => $userId, 'date_logged' => now()->toDateString(), 'hours' => '3.00', 'status' => 'pending',  'created_at' => now()],
            ['tenant_id' => $this->tid, 'user_id' => $userId, 'date_logged' => now()->toDateString(), 'hours' => '2.00', 'status' => 'declined', 'created_at' => now()],
        ]);

        $metrics = $this->service()->captureCurrentMetrics($this->tid);

        $this->assertEqualsWithDelta(0.0, $metrics['approved_hours'], 0.001);
    }

    // ──────────────────────────────────────────────────────────────────────
    // active_members — union of vol_logs and transactions
    // ──────────────────────────────────────────────────────────────────────

    public function test_active_members_counts_users_with_approved_logs_in_window(): void
    {
        $u1 = $this->insertUser();
        $u2 = $this->insertUser();

        DB::table('vol_logs')->insert([
            ['tenant_id' => $this->tid, 'user_id' => $u1, 'date_logged' => now()->toDateString(), 'hours' => '1.00', 'status' => 'approved', 'created_at' => now()],
            // Same user a second time — should still count as one distinct member.
            ['tenant_id' => $this->tid, 'user_id' => $u1, 'date_logged' => now()->toDateString(), 'hours' => '1.00', 'status' => 'approved', 'created_at' => now()],
            ['tenant_id' => $this->tid, 'user_id' => $u2, 'date_logged' => now()->toDateString(), 'hours' => '1.00', 'status' => 'approved', 'created_at' => now()],
        ]);

        $metrics = $this->service()->captureCurrentMetrics($this->tid);

        $this->assertSame(2, $metrics['active_members']);
    }

    public function test_active_members_excludes_logs_outside_90_day_window(): void
    {
        $userId = $this->insertUser();

        DB::table('vol_logs')->insert([
            'tenant_id'  => $this->tid,
            'user_id'    => $userId,
            'date_logged' => now()->subDays(100)->toDateString(),
            'hours'      => '1.00',
            'status'     => 'approved',
            'created_at' => now()->subDays(100),
        ]);

        $metrics = $this->service()->captureCurrentMetrics($this->tid);

        $this->assertSame(0, $metrics['active_members']);
    }

    // ──────────────────────────────────────────────────────────────────────
    // recurring_relationships
    // ──────────────────────────────────────────────────────────────────────

    public function test_recurring_relationships_counts_active_support_relationships(): void
    {
        $u1 = $this->insertUser();
        $u2 = $this->insertUser();

        DB::table('caring_support_relationships')->insert([
            [
                'tenant_id'      => $this->tid,
                'supporter_id'   => $u1,
                'recipient_id'   => $u2,
                'title'          => 'Relationship A',
                'frequency'      => 'weekly',
                'expected_hours' => '1.00',
                'start_date'     => now()->toDateString(),
                'status'         => 'active',
                'created_at'     => now(),
            ],
            [
                'tenant_id'      => $this->tid,
                'supporter_id'   => $u2,
                'recipient_id'   => $u1,
                'title'          => 'Relationship B',
                'frequency'      => 'monthly',
                'expected_hours' => '2.00',
                'start_date'     => now()->toDateString(),
                'status'         => 'paused',   // not active — must not be counted
                'created_at'     => now(),
            ],
        ]);

        $metrics = $this->service()->captureCurrentMetrics($this->tid);

        $this->assertSame(1, $metrics['recurring_relationships']);
    }

    public function test_recurring_relationships_is_zero_when_none_exist(): void
    {
        $metrics = $this->service()->captureCurrentMetrics($this->tid);

        $this->assertSame(0, $metrics['recurring_relationships']);
    }

    // ──────────────────────────────────────────────────────────────────────
    // median first-response hours
    // ──────────────────────────────────────────────────────────────────────

    public function test_first_response_hours_is_null_when_no_help_requests(): void
    {
        $metrics = $this->service()->captureCurrentMetrics($this->tid);

        // With no help-request fixtures for this tenant the median must be null.
        $this->assertNull($metrics['first_response_hours']);
    }

    public function test_first_response_hours_computes_median_correctly(): void
    {
        $userId = $this->insertUser();

        // Request resolved in 2 h and request resolved in 4 h → median = 3 h
        $base = now()->subDays(5);
        DB::table('caring_help_requests')->insert([
            [
                'tenant_id'   => $this->tid,
                'user_id'     => $userId,
                'what'        => 'Help A',
                'when_needed' => 'ASAP',
                'status'      => 'matched',
                'created_at'  => $base->copy()->toDateTimeString(),
                'updated_at'  => $base->copy()->addHours(2)->toDateTimeString(),
            ],
            [
                'tenant_id'   => $this->tid,
                'user_id'     => $userId,
                'what'        => 'Help B',
                'when_needed' => 'Tomorrow',
                'status'      => 'closed',
                'created_at'  => $base->copy()->toDateTimeString(),
                'updated_at'  => $base->copy()->addHours(4)->toDateTimeString(),
            ],
        ]);

        $metrics = $this->service()->captureCurrentMetrics($this->tid);

        // Two values [2, 4] → even count → median = (2+4)/2 = 3.0
        $this->assertNotNull($metrics['first_response_hours']);
        $this->assertEqualsWithDelta(3.0, $metrics['first_response_hours'], 0.1);
    }

    public function test_first_response_hours_ignores_still_pending_requests(): void
    {
        $userId = $this->insertUser();

        // A still-pending request must not contribute to the median.
        DB::table('caring_help_requests')->insert([
            'tenant_id'   => $this->tid,
            'user_id'     => $userId,
            'what'        => 'Still pending',
            'when_needed' => 'Later',
            'status'      => 'pending',
            'created_at'  => now()->subHours(5)->toDateTimeString(),
            'updated_at'  => now()->toDateTimeString(),
        ]);

        $metrics = $this->service()->captureCurrentMetrics($this->tid);

        $this->assertNull($metrics['first_response_hours']);
    }

    // ──────────────────────────────────────────────────────────────────────
    // coordinator_workload_hrs
    // ──────────────────────────────────────────────────────────────────────

    public function test_coordinator_workload_is_null_when_no_coordinators_and_no_help_requests(): void
    {
        // Clean tenant with no users at all → no coordinators → null.
        $metrics = $this->service()->captureCurrentMetrics($this->tid);

        $this->assertNull($metrics['coordinator_workload_hrs']);
    }

    public function test_coordinator_workload_divides_pending_requests_by_admin_count(): void
    {
        // Insert 1 admin (acts as coordinator fallback) and 3 pending requests.
        $adminId = $this->insertUser('admin');
        $memberId = $this->insertUser('member');

        DB::table('caring_help_requests')->insert([
            ['tenant_id' => $this->tid, 'user_id' => $memberId, 'what' => 'R1', 'when_needed' => 'Soon', 'status' => 'pending', 'created_at' => now()],
            ['tenant_id' => $this->tid, 'user_id' => $memberId, 'what' => 'R2', 'when_needed' => 'Soon', 'status' => 'pending', 'created_at' => now()],
            ['tenant_id' => $this->tid, 'user_id' => $memberId, 'what' => 'R3', 'when_needed' => 'Soon', 'status' => 'pending', 'created_at' => now()],
            // A closed request — must not count as pending.
            ['tenant_id' => $this->tid, 'user_id' => $memberId, 'what' => 'R4', 'when_needed' => 'Done', 'status' => 'closed',   'created_at' => now()],
        ]);

        $metrics = $this->service()->captureCurrentMetrics($this->tid);

        // 3 pending / 1 admin = 3.0
        $this->assertNotNull($metrics['coordinator_workload_hrs']);
        $this->assertEqualsWithDelta(3.0, $metrics['coordinator_workload_hrs'], 0.01);
    }

    // ──────────────────────────────────────────────────────────────────────
    // satisfaction_score — survey Likert mean
    // ──────────────────────────────────────────────────────────────────────

    public function test_satisfaction_score_is_null_when_no_survey_data(): void
    {
        // No municipality_surveys rows for this tenant → null expected.
        $metrics = $this->service()->captureCurrentMetrics($this->tid);

        $this->assertNull($metrics['satisfaction_score']);
    }

    public function test_satisfaction_score_computes_mean_from_likert_responses(): void
    {
        if (!Schema::hasTable('municipality_surveys')
            || !Schema::hasTable('municipality_survey_questions')
            || !Schema::hasTable('municipality_survey_responses')) {
            $this->markTestSkipped('Municipality survey tables not present.');
        }

        $userId = $this->insertUser();

        // Insert a survey, a likert satisfaction question, and two responses.
        $surveyId = (int) DB::table('municipality_surveys')->insertGetId([
            'tenant_id'  => $this->tid,
            'created_by' => $userId,
            'title'      => 'Pilot Satisfaction Survey',
            'status'     => 'active',
            'is_anonymous' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $questionId = (int) DB::table('municipality_survey_questions')->insertGetId([
            'survey_id'     => $surveyId,
            'tenant_id'     => $this->tid,
            'question_text' => 'Overall satisfaction',
            'question_type' => 'likert',
            'is_required'   => 1,
            'sort_order'    => 1,
            'created_at'    => now(),
            'updated_at'    => now(),
        ]);

        // Responses with scores 4 and 2 → mean = 3.0  (use separate inserts — column lists differ)
        DB::table('municipality_survey_responses')->insert([
            'survey_id'    => $surveyId,
            'tenant_id'    => $this->tid,
            'user_id'      => $userId,
            'answers'      => json_encode([(string) $questionId => 4]),
            'submitted_at' => now()->toDateTimeString(),
        ]);
        DB::table('municipality_survey_responses')->insert([
            'survey_id'     => $surveyId,
            'tenant_id'     => $this->tid,
            'user_id'       => null,
            'session_token' => uniqid('sess_'),
            'answers'       => json_encode([(string) $questionId => 2]),
            'submitted_at'  => now()->toDateTimeString(),
        ]);

        $metrics = $this->service()->captureCurrentMetrics($this->tid);

        $this->assertNotNull($metrics['satisfaction_score']);
        $this->assertEqualsWithDelta(3.0, $metrics['satisfaction_score'], 0.01);
    }

    // ──────────────────────────────────────────────────────────────────────
    // captureBaseline() and capturePrePilotBaseline()
    // ──────────────────────────────────────────────────────────────────────

    public function test_capture_pre_pilot_baseline_persists_with_canonical_label(): void
    {
        $adminId = $this->insertUser('admin');

        $result = $this->service()->capturePrePilotBaseline($this->tid, $adminId, 'Pre-pilot notes');

        $this->assertIsArray($result);
        $this->assertArrayHasKey('id', $result);
        $this->assertGreaterThan(0, $result['id']);
        $this->assertSame(PilotScoreboardService::PRE_PILOT_LABEL, $result['label']);
        $this->assertTrue($result['is_pre_pilot']);
        $this->assertSame('Pre-pilot notes', $result['notes']);
    }

    public function test_capture_baseline_quarterly_stores_non_pre_pilot_flag(): void
    {
        $adminId = $this->insertUser('admin');

        $result = $this->service()->captureBaseline($this->tid, 'Q1-2026', $adminId, null);

        $this->assertFalse($result['is_pre_pilot']);
        $this->assertSame('Q1-2026', $result['label']);
    }

    public function test_capture_baseline_envelope_contains_pilot_scoreboard_kind(): void
    {
        $adminId = $this->insertUser('admin');

        $result = $this->service()->captureBaseline($this->tid, 'Test Label', $adminId, null);

        // Re-read raw row to verify envelope structure written to DB.
        $row = DB::table('caring_kpi_baselines')->where('id', $result['id'])->first();
        $envelope = json_decode((string) $row->metrics, true);

        $this->assertSame('pilot_scoreboard', $envelope['kind']);
        $this->assertArrayHasKey('metrics', $envelope);
        $this->assertArrayHasKey('active_members', $envelope['metrics']);
    }

    // ──────────────────────────────────────────────────────────────────────
    // listBaselines()
    // ──────────────────────────────────────────────────────────────────────

    public function test_list_baselines_returns_empty_for_fresh_tenant(): void
    {
        $list = $this->service()->listBaselines($this->tid);

        $this->assertIsArray($list);
        $this->assertCount(0, $list);
    }

    public function test_list_baselines_returns_pilot_scoreboard_rows_only(): void
    {
        $adminId = $this->insertUser('admin');

        // Insert a genuine scoreboard baseline via the service.
        $this->service()->captureBaseline($this->tid, 'Scoreboard Entry', $adminId, null);

        // Insert a raw AG66 KPI baseline (different kind) that must NOT appear.
        DB::table('caring_kpi_baselines')->insert([
            'tenant_id'       => $this->tid,
            'label'           => 'AG66 Baseline',
            'baseline_period' => json_encode(['start' => '2025-01-01', 'end' => '2025-03-31']),
            'captured_at'     => now(),
            'metrics'         => json_encode(['kind' => 'kpi_baseline', 'member_count' => 5]),
            'notes'           => null,
            'captured_by'     => $adminId,
            'created_at'      => now(),
            'updated_at'      => now(),
        ]);

        $list = $this->service()->listBaselines($this->tid);

        $this->assertCount(1, $list);
        $this->assertSame('Scoreboard Entry', $list[0]['label']);
    }

    public function test_list_baselines_scoped_to_tenant(): void
    {
        $adminId = $this->insertUser('admin');
        $this->service()->captureBaseline($this->tid, 'My Entry', $adminId, null);

        // Different tenant must see empty list.
        $other = $this->service()->listBaselines(99601);

        $this->assertCount(0, $other);
    }

    // ──────────────────────────────────────────────────────────────────────
    // scoreboard() structure
    // ──────────────────────────────────────────────────────────────────────

    public function test_scoreboard_returns_expected_top_level_keys(): void
    {
        $board = $this->service()->scoreboard($this->tid);

        foreach (['current', 'pre_pilot_baseline', 'latest_quarterly', 'comparison', 'quarterly_review'] as $key) {
            $this->assertArrayHasKey($key, $board, "Missing scoreboard key: $key");
        }

        $this->assertIsArray($board['quarterly_review']);
        $this->assertArrayHasKey('next_due_at', $board['quarterly_review']);
        $this->assertArrayHasKey('is_overdue', $board['quarterly_review']);
        $this->assertArrayHasKey('cadence_months', $board['quarterly_review']);
        $this->assertSame(3, $board['quarterly_review']['cadence_months']);
    }

    public function test_scoreboard_comparison_is_null_when_no_pre_pilot_baseline(): void
    {
        // No baselines for this tenant → comparison must be null.
        $board = $this->service()->scoreboard($this->tid);

        $this->assertNull($board['pre_pilot_baseline']);
        $this->assertNull($board['comparison']);
        $this->assertNull($board['quarterly_review']['next_due_at']);
    }

    public function test_scoreboard_comparison_populated_after_pre_pilot_baseline_captured(): void
    {
        $adminId = $this->insertUser('admin');
        $this->service()->capturePrePilotBaseline($this->tid, $adminId, null);

        $board = $this->service()->scoreboard($this->tid);

        $this->assertNotNull($board['pre_pilot_baseline']);
        $this->assertIsArray($board['comparison']);

        // Comparison must cover all ten metric keys.
        $expectedMetricKeys = [
            'active_members', 'first_response_hours', 'approved_hours',
            'recurring_relationships', 'coordinator_workload_hrs', 'satisfaction_score',
            'social_isolation_pct', 'comms_reach_pct', 'business_participation', 'cost_offset_chf',
        ];
        foreach ($expectedMetricKeys as $key) {
            $this->assertArrayHasKey($key, $board['comparison'], "Missing comparison key: $key");
            $this->assertArrayHasKey('baseline', $board['comparison'][$key]);
            $this->assertArrayHasKey('current', $board['comparison'][$key]);
            $this->assertArrayHasKey('delta', $board['comparison'][$key]);
            $this->assertArrayHasKey('pct_change', $board['comparison'][$key]);
        }
    }

    public function test_scoreboard_quarterly_review_next_due_is_3_months_after_baseline(): void
    {
        $adminId = $this->insertUser('admin');
        $this->service()->capturePrePilotBaseline($this->tid, $adminId, null);

        $board = $this->service()->scoreboard($this->tid);
        $nextDue = $board['quarterly_review']['next_due_at'];

        $this->assertNotNull($nextDue);
        // next_due_at should be roughly 3 months from now (within a few minutes of this test run).
        $diff = now()->diffInDays(\Illuminate\Support\Carbon::parse($nextDue));
        $this->assertGreaterThan(85, $diff, 'next_due_at should be ~90 days away');
        $this->assertLessThan(95, $diff, 'next_due_at should not exceed ~92 days away');
    }

    public function test_compare_metrics_delta_and_pct_change_math(): void
    {
        $adminId = $this->insertUser('admin');

        // Baseline with zero approved hours.
        $this->service()->capturePrePilotBaseline($this->tid, $adminId, null);

        // Now add 2.0 approved hours so current > baseline.
        DB::table('vol_logs')->insert([
            'tenant_id'   => $this->tid,
            'user_id'     => $adminId,
            'date_logged' => now()->toDateString(),
            'hours'       => '2.00',
            'status'      => 'approved',
            'created_at'  => now(),
        ]);

        $board = $this->service()->scoreboard($this->tid);
        $comp = $board['comparison']['approved_hours'];

        // baseline was 0, current should be 2.
        $this->assertEqualsWithDelta(0.0, $comp['baseline'], 0.001);
        $this->assertEqualsWithDelta(2.0, $comp['current'], 0.001);
        $this->assertEqualsWithDelta(2.0, $comp['delta'], 0.001);
        // pct_change must be null when baseline is 0 (division-by-zero guard).
        $this->assertNull($comp['pct_change']);
    }
}
