<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Console;

use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

/**
 * Tests for SafeguardingSlaEscalateCommand (artisan safeguarding:sla-escalate).
 *
 * Tenant ID 99702 is exclusively reserved for this test class.
 * The command iterates ALL active tenants with the caring_community feature
 * enabled. We seed our isolated tenant, assert its rows only, and do not
 * assert global counts (other tenants' data may exist).
 */
class SafeguardingSlaEscalateCommandTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 99702;

    /** User who files reports in tests */
    private int $reporterUserId;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        Mail::fake();

        // Insert the test tenant with caring_community feature enabled
        DB::table('tenants')->insertOrIgnore([
            'id'        => self::TENANT_ID,
            'name'      => 'SLA Escalate Test Tenant',
            'slug'      => 'sg-sla-test-99702',
            'is_active' => 1,
            'features'  => json_encode(['caring_community' => true]),
            'created_at' => now(),
        ]);

        // Insert a reporter user (reporter must exist as FK on safeguarding_reports)
        $this->reporterUserId = DB::table('users')->insertGetId([
            'tenant_id'          => self::TENANT_ID,
            'name'               => 'SLA Reporter',
            'first_name'         => 'SLA',
            'last_name'          => 'Reporter',
            'email'              => 'reporter-sla-99702@test.local',
            'password'           => bcrypt('secret'),
            'role'               => 'member',
            'status'             => 'active',
            'preferred_language' => 'en',
            'created_at'         => now(),
        ]);

        \App\Core\TenantContext::setById(self::TENANT_ID);
    }

    // -----------------------------------------------------------------------
    // Helper: insert a safeguarding_reports row
    // -----------------------------------------------------------------------
    private function insertReport(array $overrides = []): int
    {
        $defaults = [
            'tenant_id'          => self::TENANT_ID,
            'reporter_user_id'   => $this->reporterUserId,
            'category'           => 'other',
            'severity'           => 'medium',
            'description'        => 'Test safeguarding report',
            'status'             => 'submitted',
            'escalated'          => 0,
            'escalated_at'       => null,
            'review_due_at'      => now()->subHours(2),  // already past due
            'created_at'         => now()->subDays(3),
            'updated_at'         => now()->subDays(3),
        ];

        return (int) DB::table('safeguarding_reports')->insertGetId(
            array_merge($defaults, $overrides)
        );
    }

    // -----------------------------------------------------------------------
    // 1. Command exits zero with nothing to do
    // -----------------------------------------------------------------------
    public function test_command_exits_zero_with_no_due_reports(): void
    {
        // No reports seeded — should run cleanly
        $this->artisan('safeguarding:sla-escalate')
            ->assertExitCode(0);
    }

    // -----------------------------------------------------------------------
    // 2. Breached-SLA report is escalated (escalated=1 and escalated_at set)
    // -----------------------------------------------------------------------
    public function test_sla_breached_report_is_escalated(): void
    {
        $reportId = $this->insertReport([
            'review_due_at' => now()->subHours(5),
            'status'        => 'submitted',
            'escalated'     => 0,
        ]);

        $this->artisan('safeguarding:sla-escalate')
            ->assertExitCode(0);

        $report = DB::table('safeguarding_reports')->find($reportId);
        $this->assertSame(1, (int) $report->escalated, 'Report should be marked escalated=1');
        $this->assertNotNull($report->escalated_at, 'escalated_at should be set');
    }

    // -----------------------------------------------------------------------
    // 3. Already-escalated report is not re-escalated (idempotency)
    // -----------------------------------------------------------------------
    public function test_already_escalated_report_is_not_re_escalated(): void
    {
        $escalatedAt = now()->subHours(1)->toDateTimeString();
        $reportId = $this->insertReport([
            'review_due_at' => now()->subHours(10),
            'status'        => 'submitted',
            'escalated'     => 1,
            'escalated_at'  => $escalatedAt,
        ]);

        $this->artisan('safeguarding:sla-escalate')
            ->assertExitCode(0);

        $report = DB::table('safeguarding_reports')->find($reportId);
        // Verify timestamp is unchanged (within 1 second tolerance)
        $this->assertEquals(
            (new \DateTime($escalatedAt))->format('Y-m-d H:i:s'),
            (new \DateTime($report->escalated_at))->format('Y-m-d H:i:s'),
            'escalated_at should not be overwritten on a second run'
        );
    }

    // -----------------------------------------------------------------------
    // 4. Resolved report is not escalated
    // -----------------------------------------------------------------------
    public function test_resolved_report_is_not_escalated(): void
    {
        $reportId = $this->insertReport([
            'review_due_at' => now()->subHours(5),
            'status'        => 'resolved',
            'escalated'     => 0,
        ]);

        $this->artisan('safeguarding:sla-escalate')
            ->assertExitCode(0);

        $report = DB::table('safeguarding_reports')->find($reportId);
        $this->assertSame(0, (int) $report->escalated);
        $this->assertNull($report->escalated_at);
    }

    // -----------------------------------------------------------------------
    // 5. Dismissed report is not escalated
    // -----------------------------------------------------------------------
    public function test_dismissed_report_is_not_escalated(): void
    {
        $reportId = $this->insertReport([
            'review_due_at' => now()->subHours(5),
            'status'        => 'dismissed',
            'escalated'     => 0,
        ]);

        $this->artisan('safeguarding:sla-escalate')
            ->assertExitCode(0);

        $report = DB::table('safeguarding_reports')->find($reportId);
        $this->assertSame(0, (int) $report->escalated);
        $this->assertNull($report->escalated_at);
    }

    // -----------------------------------------------------------------------
    // 6. Report whose review_due_at is in the future is not escalated
    // -----------------------------------------------------------------------
    public function test_report_not_yet_due_is_not_escalated(): void
    {
        $reportId = $this->insertReport([
            'review_due_at' => now()->addHours(24),  // future
            'status'        => 'submitted',
            'escalated'     => 0,
        ]);

        $this->artisan('safeguarding:sla-escalate')
            ->assertExitCode(0);

        $report = DB::table('safeguarding_reports')->find($reportId);
        $this->assertSame(0, (int) $report->escalated);
        $this->assertNull($report->escalated_at);
    }

    // -----------------------------------------------------------------------
    // 7. Report with NULL review_due_at is not escalated
    // -----------------------------------------------------------------------
    public function test_report_without_review_due_at_is_not_escalated(): void
    {
        $reportId = $this->insertReport([
            'review_due_at' => null,
            'status'        => 'submitted',
            'escalated'     => 0,
        ]);

        $this->artisan('safeguarding:sla-escalate')
            ->assertExitCode(0);

        $report = DB::table('safeguarding_reports')->find($reportId);
        $this->assertSame(0, (int) $report->escalated);
        $this->assertNull($report->escalated_at);
    }

    // -----------------------------------------------------------------------
    // 8. Dry-run: counts but does not write
    // -----------------------------------------------------------------------
    public function test_dry_run_does_not_escalate(): void
    {
        $reportId = $this->insertReport([
            'review_due_at' => now()->subHours(5),
            'status'        => 'submitted',
            'escalated'     => 0,
        ]);

        $this->artisan('safeguarding:sla-escalate', ['--dry-run' => true])
            ->expectsOutputToContain('DRY RUN')
            ->assertExitCode(0);

        $report = DB::table('safeguarding_reports')->find($reportId);
        $this->assertSame(0, (int) $report->escalated, 'Dry-run must not write escalated=1');
        $this->assertNull($report->escalated_at, 'Dry-run must not write escalated_at');
    }

    // -----------------------------------------------------------------------
    // 9. Multiple breached reports in the same tenant are all escalated
    // -----------------------------------------------------------------------
    public function test_multiple_breached_reports_are_all_escalated(): void
    {
        $ids = [];
        foreach (['submitted', 'triaged', 'investigating'] as $status) {
            $ids[] = $this->insertReport([
                'review_due_at' => now()->subHours(3),
                'status'        => $status,
                'escalated'     => 0,
            ]);
        }

        $this->artisan('safeguarding:sla-escalate')
            ->assertExitCode(0);

        foreach ($ids as $id) {
            $report = DB::table('safeguarding_reports')->find($id);
            $this->assertSame(
                1,
                (int) $report->escalated,
                "Report #{$id} should be escalated"
            );
        }
    }

    // -----------------------------------------------------------------------
    // 10. Tenant with caring_community disabled is skipped
    // -----------------------------------------------------------------------
    /**
     * 🔴 REVERSED by F-408 (E-069). This test previously asserted that a
     * community without the `caring_community` feature was SKIPPED — which was
     * the vulnerability, not the contract. The feature switch is reachable by an
     * ordinary community administrator, so skipping let one unaudited API call
     * silence the SLA breach alert for concerns that were already open. The
     * sweep is now driven by the overdue reports themselves; the module switch
     * governs what a community can do next, not whether an existing safeguarding
     * obligation is escalated.
     * Regression pin: tests/Laravel/Feature/Security/E069/F408SafeguardingSlaEscalationCannotBeSilencedTest.php
     */
    public function test_tenant_without_caring_community_feature_is_still_escalated(): void
    {
        // Create a second tenant WITHOUT caring_community
        $otherTenantId = 99703;
        DB::table('tenants')->insertOrIgnore([
            'id'        => $otherTenantId,
            'name'      => 'No Caring Community Tenant',
            'slug'      => 'no-cc-99703',
            'is_active' => 1,
            'features'  => json_encode(['caring_community' => false]),
            'created_at' => now(),
        ]);

        $reporterInOther = DB::table('users')->insertGetId([
            'tenant_id'  => $otherTenantId,
            'name'       => 'Other Reporter',
            'first_name' => 'Other',
            'last_name'  => 'Reporter',
            'email'      => 'reporter-other-99703@test.local',
            'password'   => bcrypt('secret'),
            'role'       => 'member',
            'status'     => 'active',
            'preferred_language' => 'en',
            'created_at' => now(),
        ]);

        $reportId = DB::table('safeguarding_reports')->insertGetId([
            'tenant_id'        => $otherTenantId,
            'reporter_user_id' => $reporterInOther,
            'category'         => 'other',
            'severity'         => 'medium',
            'description'      => 'Overdue concern in a community with the module switched off',
            'status'           => 'submitted',
            'escalated'        => 0,
            'escalated_at'     => null,
            'review_due_at'    => now()->subHours(5),
            'created_at'       => now()->subDays(1),
        ]);

        $this->artisan('safeguarding:sla-escalate')
            ->assertExitCode(0);

        $report = DB::table('safeguarding_reports')->find($reportId);
        $this->assertSame(1, (int) $report->escalated, 'An overdue concern is escalated even with caring_community off');
        $this->assertNotNull($report->escalated_at);
    }

    // -----------------------------------------------------------------------
    // 11. An inactive community's overdue concern is STILL escalated (F-408)
    // -----------------------------------------------------------------------
    /**
     * 🔴 REVERSED by F-408 (E-069), for the same reason as the test above:
     * deactivating a community was a second, equally unaudited route to the same
     * silence. Deactivation stops new activity; it does not retire a
     * safeguarding concern that is already open and already past its deadline.
     */
    public function test_inactive_tenant_is_still_escalated(): void
    {
        $inactiveTenantId = 99704;
        DB::table('tenants')->insertOrIgnore([
            'id'        => $inactiveTenantId,
            'name'      => 'Inactive Tenant',
            'slug'      => 'inactive-99704',
            'is_active' => 0,   // <-- inactive
            'features'  => json_encode(['caring_community' => true]),
            'created_at' => now(),
        ]);

        $reporterInInactive = DB::table('users')->insertGetId([
            'tenant_id'  => $inactiveTenantId,
            'name'       => 'Inactive Reporter',
            'first_name' => 'Inactive',
            'last_name'  => 'Reporter',
            'email'      => 'reporter-inactive-99704@test.local',
            'password'   => bcrypt('secret'),
            'role'       => 'member',
            'status'     => 'active',
            'preferred_language' => 'en',
            'created_at' => now(),
        ]);

        $reportId = DB::table('safeguarding_reports')->insertGetId([
            'tenant_id'        => $inactiveTenantId,
            'reporter_user_id' => $reporterInInactive,
            'category'         => 'other',
            'severity'         => 'medium',
            'description'      => 'Overdue concern in a deactivated community',
            'status'           => 'submitted',
            'escalated'        => 0,
            'escalated_at'     => null,
            'review_due_at'    => now()->subHours(5),
            'created_at'       => now()->subDays(1),
        ]);

        $this->artisan('safeguarding:sla-escalate')
            ->assertExitCode(0);

        $report = DB::table('safeguarding_reports')->find($reportId);
        $this->assertSame(1, (int) $report->escalated, 'An overdue concern is escalated even in a deactivated community');
        $this->assertNotNull($report->escalated_at);
    }

    // -----------------------------------------------------------------------
    // 12. Output message contains key fields
    // -----------------------------------------------------------------------
    public function test_output_contains_summary_when_done(): void
    {
        $reportId = $this->insertReport([
            'review_due_at' => now()->subHours(5),
            'status'        => 'submitted',
            'escalated'     => 0,
        ]);

        $this->artisan('safeguarding:sla-escalate')
            ->expectsOutputToContain('Done')
            ->assertExitCode(0);

        // Confirm escalation actually happened (not just output)
        $report = DB::table('safeguarding_reports')->find($reportId);
        $this->assertSame(1, (int) $report->escalated);
    }
}
