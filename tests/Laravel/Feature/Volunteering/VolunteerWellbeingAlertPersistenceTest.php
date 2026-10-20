<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Volunteering;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\VolunteerWellbeingService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Burnout detection must not write on a read. The wellbeing dashboard /
 * my-status GET endpoints call detectBurnoutRisk() with the default
 * $persist = false, so viewing wellbeing never mutates vol_wellbeing_alerts;
 * the scheduled tenant assessment passes $persist = true and is the sole
 * write path.
 */
class VolunteerWellbeingAlertPersistenceTest extends TestCase
{
    use DatabaseTransactions;

    /**
     * Seed a deterministically at-risk volunteer: one approved 10h log 45 days
     * ago gives an hours trend of "declining_significantly" (+25, recent 30d
     * hours are 0 vs 10 in the prior 30d) plus an engagement gap > 30 days
     * (+10) = risk score 35, above the 30-point alert threshold.
     */
    private function seedAtRiskVolunteer(): int
    {
        TenantContext::setById($this->testTenantId);
        $user = User::factory()->forTenant($this->testTenantId)->create();

        DB::table('vol_logs')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'organization_id' => null,
            'date_logged' => now()->subDays(45)->toDateString(),
            'hours' => 10.0,
            'status' => 'approved',
            'created_at' => now()->subDays(45),
            'updated_at' => now()->subDays(45),
        ]);

        return (int) $user->id;
    }

    public function test_read_path_does_not_write_wellbeing_alert(): void
    {
        $userId = $this->seedAtRiskVolunteer();

        // Creating the fixture user re-resolves TenantContext to the default
        // tenant; re-assert it so the assessment scopes to the seeded tenant.
        TenantContext::setById($this->testTenantId);
        $assessment = VolunteerWellbeingService::detectBurnoutRisk($userId); // $persist defaults to false

        $this->assertGreaterThanOrEqual(30, $assessment['risk_score'], 'fixture should be at-risk');
        $this->assertDatabaseMissing('vol_wellbeing_alerts', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
        ]);
    }

    public function test_assessment_write_path_upserts_wellbeing_alert(): void
    {
        $userId = $this->seedAtRiskVolunteer();

        TenantContext::setById($this->testTenantId);
        VolunteerWellbeingService::detectBurnoutRisk($userId, true);

        $this->assertDatabaseHas('vol_wellbeing_alerts', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'status' => 'active',
        ]);
    }

    /**
     * Seed a recovered volunteer: one approved log dated today gives a stable
     * hours trend and no engagement gap, so the recomputed risk score is 0 —
     * below the 30-point alert threshold.
     */
    private function seedRecoveredVolunteer(): int
    {
        TenantContext::setById($this->testTenantId);
        $user = User::factory()->forTenant($this->testTenantId)->create();

        DB::table('vol_logs')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'organization_id' => null,
            'date_logged' => now()->toDateString(),
            'hours' => 2.0,
            'status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return (int) $user->id;
    }

    public function test_assessment_resolves_active_alert_when_user_recovers(): void
    {
        // VOL-BE-005: a recovered volunteer's stale active alert must be closed.
        $userId = $this->seedRecoveredVolunteer();

        DB::table('vol_wellbeing_alerts')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'risk_level' => 'critical',
            'risk_score' => 75,
            'indicators' => json_encode(['stale' => true]),
            'coordinator_notified' => false,
            'status' => 'active',
            'created_at' => now()->subDays(60),
            'updated_at' => now()->subDays(60),
        ]);

        TenantContext::setById($this->testTenantId);
        VolunteerWellbeingService::runTenantAssessment();

        $this->assertDatabaseMissing('vol_wellbeing_alerts', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'status' => 'active',
        ]);
        $this->assertDatabaseHas('vol_wellbeing_alerts', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'status' => 'resolved',
        ]);
    }

    public function test_assessment_keeps_active_alert_for_still_at_risk_user(): void
    {
        $userId = $this->seedAtRiskVolunteer(); // recomputes to score 35

        DB::table('vol_wellbeing_alerts')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'risk_level' => 'moderate',
            'risk_score' => 35,
            'indicators' => json_encode([]),
            'coordinator_notified' => false,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        TenantContext::setById($this->testTenantId);
        VolunteerWellbeingService::runTenantAssessment();

        $this->assertDatabaseHas('vol_wellbeing_alerts', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'status' => 'active',
        ]);
    }
    /**
     * A volunteer with no logged hours and no shift signup was never scanned, so
     * a shared "Struggling" check-in alone (score 55) never reached the daily
     * assessment: no refresh, no auto-resolve when they later felt better.
     */
    public function test_assessment_includes_a_volunteer_whose_only_signal_is_a_shared_low_check_in(): void
    {
        TenantContext::setById($this->testTenantId);
        $user = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        DB::table('vol_mood_checkins')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'mood' => 1,
            'note' => null,
            'share_with_team' => 1,
            'created_at' => now()->subDay(),
        ]);

        TenantContext::setById($this->testTenantId);
        $summary = VolunteerWellbeingService::runTenantAssessment();

        $this->assertContains((int) $user->id, array_column($summary['at_risk_users'], 'user_id'));
        $this->assertDatabaseHas('vol_wellbeing_alerts', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'status' => 'active',
        ]);
    }
}
