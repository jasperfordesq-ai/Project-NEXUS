<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\CaringCommunity;

use App\Core\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Tests the safeguarding:sla-escalate scheduled command.
 *
 * Reports past their review_due_at while still open and not yet escalated
 * must be auto-escalated. Reports inside the SLA window stay untouched.
 * --dry-run leaves rows unmodified.
 */
class SafeguardingSlaCronTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 2;

    protected function setUp(): void
    {
        parent::setUp();
        $this->mock(\App\Services\EmailDispatchService::class, fn ($mock) => $mock->shouldReceive('send')->andReturn(true));
        \Illuminate\Support\Facades\Http::fake();
        $this->setCaringCommunityFeature(self::TENANT_ID, true);
        TenantContext::setById(self::TENANT_ID);
    }

    private function setCaringCommunityFeature(int $tenantId, bool $enabled): void
    {
        $tenant = DB::table('tenants')->where('id', $tenantId)->first();
        $features = [];
        if ($tenant && !empty($tenant->features)) {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : $tenant->features;
            $features = is_array($decoded) ? $decoded : [];
        }
        $features['caring_community'] = $enabled;
        DB::table('tenants')->where('id', $tenantId)->update(['features' => json_encode($features)]);
    }

    private function makeReporter(): int
    {
        $email = 'rep_cron.' . uniqid() . '@example.test';
        return (int) DB::table('users')->insertGetId([
            'tenant_id'  => self::TENANT_ID,
            'first_name' => 'Cron',
            'last_name'  => 'Reporter',
            'email'      => $email,
            'username'   => 'crn_' . substr(md5($email . microtime(true)), 0, 8),
            'password'   => password_hash('password', PASSWORD_BCRYPT),
            'balance'    => 0,
            'status'     => 'active',
            'role'       => 'member',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function insertReport(string $status, \DateTimeInterface $reviewDueAt, int $escalated = 0): int
    {
        $reporterId = $this->makeReporter();
        return (int) DB::table('safeguarding_reports')->insertGetId([
            'tenant_id'         => self::TENANT_ID,
            'reporter_user_id'  => $reporterId,
            'category'          => 'other',
            'severity'          => 'high',
            'description'       => 'Cron scenario',
            'status'            => $status,
            'review_due_at'     => $reviewDueAt,
            'escalated'         => $escalated,
            'created_at'        => now(),
            'updated_at'        => now(),
        ]);
    }

    public function test_breached_open_report_gets_auto_escalated(): void
    {
        $reportId = $this->insertReport(
            'submitted',
            now()->subHour(), // 1h ago — breached
            0
        );

        $exit = $this->artisan('safeguarding:sla-escalate')->run();
        $this->assertSame(0, $exit);

        $row = DB::table('safeguarding_reports')->where('id', $reportId)->first();
        $this->assertNotNull($row);
        $this->assertSame(1, (int) $row->escalated, 'Breached report should be escalated.');
        $this->assertNotNull($row->escalated_at);
    }

    public function test_within_sla_report_remains_untouched(): void
    {
        $reportId = $this->insertReport(
            'submitted',
            now()->addHours(3), // future — still inside SLA
            0
        );

        $this->artisan('safeguarding:sla-escalate')->run();

        $row = DB::table('safeguarding_reports')->where('id', $reportId)->first();
        $this->assertNotNull($row);
        $this->assertSame(0, (int) $row->escalated, 'Report inside SLA must not be escalated.');
    }

    public function test_already_escalated_report_is_not_escalated_again(): void
    {
        $reportId = $this->insertReport(
            'submitted',
            now()->subHours(2),
            1 // already escalated
        );

        // Stamp escalated_at so we can check it isn't overwritten by re-running.
        DB::table('safeguarding_reports')
            ->where('id', $reportId)
            ->update(['escalated_at' => now()->subHour()]);

        $beforeRow = DB::table('safeguarding_reports')->where('id', $reportId)->first();
        $beforeStamp = (string) $beforeRow->escalated_at;

        $this->artisan('safeguarding:sla-escalate')->run();

        $afterRow = DB::table('safeguarding_reports')->where('id', $reportId)->first();
        $this->assertSame($beforeStamp, (string) $afterRow->escalated_at, 'Already escalated row must not be touched.');
    }

    public function test_resolved_report_is_not_escalated(): void
    {
        $reportId = $this->insertReport(
            'resolved',
            now()->subDay(),
            0
        );

        $this->artisan('safeguarding:sla-escalate')->run();

        $row = DB::table('safeguarding_reports')->where('id', $reportId)->first();
        $this->assertSame(0, (int) $row->escalated, 'Resolved report must not be escalated.');
    }

    public function test_dry_run_does_not_modify_rows(): void
    {
        $reportId = $this->insertReport(
            'submitted',
            now()->subHour(),
            0
        );

        $this->artisan('safeguarding:sla-escalate', ['--dry-run' => true])->run();

        $row = DB::table('safeguarding_reports')->where('id', $reportId)->first();
        $this->assertSame(0, (int) $row->escalated, 'Dry run must not modify rows.');
    }
}
