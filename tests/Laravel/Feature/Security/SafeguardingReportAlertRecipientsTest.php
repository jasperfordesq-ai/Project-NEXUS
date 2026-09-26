<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\CaringCommunity\SafeguardingService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Tests\Laravel\TestCase;

/**
 * F-213: a critical "Report a Concern" alert reaches the staff who can actually
 * open reports — and never the person the report is about.
 *
 * The alert went only to holders of an INDIVIDUAL `safeguarding.view` grant in
 * `user_permissions`, which the platform does not normally make (see O-040), so
 * in practice a critical report alerted nobody, while every admin, broker and
 * coordinator could read it (including the reporter's name).
 */
class SafeguardingReportAlertRecipientsTest extends TestCase
{
    use DatabaseTransactions;

    private function staff(string $role): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true, 'role' => $role]);
    }

    private function alerted(User $user): bool
    {
        return DB::table('notifications')
            ->where('user_id', $user->id)
            ->where('type', 'safeguarding_critical')
            ->exists();
    }

    public function test_a_critical_report_alerts_the_communitys_safeguarding_staff_but_not_its_subject(): void
    {
        Mail::fake();
        TenantContext::setById($this->testTenantId);
        $admin = $this->staff('admin');
        $broker = $this->staff('broker');
        $coordinator = $this->staff('coordinator');
        $reportedCoordinator = $this->staff('coordinator');
        $member = $this->staff('member');
        $reporter = $this->staff('member');
        TenantContext::setById($this->testTenantId);

        $result = app(SafeguardingService::class)->submitReport($reporter->id, [
            'category' => 'exploitation',
            'severity' => 'critical',
            'description' => 'A synthetic critical concern for the F-213 regression test.',
            'subject_user_id' => $reportedCoordinator->id,
        ]);
        $this->assertArrayHasKey('report_id', $result);

        $this->assertTrue($this->alerted($admin), 'admins can open reports, so they must be alerted');
        $this->assertTrue($this->alerted($broker));
        $this->assertTrue($this->alerted($coordinator));
        $this->assertFalse($this->alerted($reportedCoordinator), 'the person reported must never be alerted');
        $this->assertFalse($this->alerted($member));
    }

    public function test_staff_cannot_read_a_report_about_themselves(): void
    {
        Mail::fake();
        TenantContext::setById($this->testTenantId);
        $reportedCoordinator = $this->staff('coordinator');
        $otherCoordinator = $this->staff('coordinator');
        $reporter = $this->staff('member');
        TenantContext::setById($this->testTenantId);

        $service = app(SafeguardingService::class);
        $reportId = (int) $service->submitReport($reporter->id, [
            'category' => 'exploitation',
            'severity' => 'high',
            'description' => 'A synthetic concern about a coordinator for the F-213 regression test.',
            'subject_user_id' => $reportedCoordinator->id,
        ])['report_id'];

        $ids = fn (int $viewer) => array_map(fn ($r) => (int) ($r['id'] ?? 0), $service->listReports(null, null, $viewer));

        $this->assertNotContains($reportId, $ids($reportedCoordinator->id), 'a report must be hidden from the person it is about');
        $this->assertNull($service->reportDetail($reportId, $reportedCoordinator->id));
        $this->assertContains($reportId, $ids($otherCoordinator->id));
        $this->assertNotNull($service->reportDetail($reportId, $otherCoordinator->id));
    }
}
