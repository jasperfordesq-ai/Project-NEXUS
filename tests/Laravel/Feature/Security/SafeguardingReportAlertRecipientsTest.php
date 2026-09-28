<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\CaringCommunity\SafeguardingService;
use App\Services\EmailDispatchService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Mockery;
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

    protected function setUp(): void
    {
        parent::setUp();
        $mailer = Mockery::mock(EmailDispatchService::class);
        $mailer->shouldReceive('send')->andReturn(true);
        $this->app->instance(EmailDispatchService::class, $mailer);
    }

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

    private function individualViewer(User $user, bool $granted, ?string $expiresAt = null): void
    {
        $permissionId = DB::table('permissions')->where('name', 'safeguarding.view')->value('id');
        if (!$permissionId) {
            $permissionId = DB::table('permissions')->insertGetId([
                'name' => 'safeguarding.view',
                'display_name' => 'View safeguarding reports',
                'description' => 'View safeguarding reports',
                'category' => 'safeguarding',
                'is_dangerous' => 0,
                'tenant_id' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        DB::table('user_permissions')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'permission_id' => $permissionId,
            'granted' => $granted ? 1 : 0,
            'granted_at' => now(),
            'expires_at' => $expiresAt,
        ]);
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

    public function test_revoked_and_expired_viewers_receive_no_critical_report_alert(): void
    {
        Mail::fake();
        TenantContext::setById($this->testTenantId);
        $activeViewer = $this->staff('member');
        $revokedViewer = $this->staff('member');
        $expiredViewer = $this->staff('member');
        $reporter = $this->staff('member');
        $this->individualViewer($activeViewer, true);
        $this->individualViewer($revokedViewer, false);
        $this->individualViewer($expiredViewer, true, now()->subMinute()->toDateTimeString());

        app(SafeguardingService::class)->submitReport($reporter->id, [
            'category' => 'exploitation',
            'severity' => 'critical',
            'description' => 'Synthetic report for recipient authorization.',
        ]);

        $this->assertTrue($this->alerted($activeViewer), 'a current viewer must still be alerted');
        $this->assertFalse($this->alerted($revokedViewer), 'a revoked viewer must not be alerted');
        $this->assertFalse($this->alerted($expiredViewer), 'an expired viewer must not be alerted');
    }
}
