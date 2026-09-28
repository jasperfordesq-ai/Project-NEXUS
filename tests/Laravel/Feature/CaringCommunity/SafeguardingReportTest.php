<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\CaringCommunity;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\CaringCommunity\SafeguardingService;
use App\Services\EmailDispatchService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\Laravel\TestCase;

class SafeguardingReportTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 2; // hour-timebank

    protected function setUp(): void
    {
        parent::setUp();
        $mailer = Mockery::mock(EmailDispatchService::class);
        $mailer->shouldReceive('send')->andReturn(true);
        $this->app->instance(EmailDispatchService::class, $mailer);
        $this->setCaringCommunityFeature(self::TENANT_ID, true);
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
        TenantContext::setById($tenantId);
    }

    private function makeUser(int $tenantId, string $email, string $role = 'member'): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id'  => $tenantId,
            'first_name' => 'Test',
            'last_name'  => 'User',
            'email'      => $email,
            'username'   => 'u_' . substr(md5($email . $tenantId), 0, 8),
            'password'   => password_hash('password', PASSWORD_BCRYPT),
            'balance'    => 0,
            'status'     => 'active',
            'role'       => $role,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_member_can_submit_report_with_valid_data(): void
    {
        TenantContext::setById(self::TENANT_ID);
        $reporter = $this->makeUser(self::TENANT_ID, 'rep.' . uniqid() . '@example.com');

        $service = app(SafeguardingService::class);
        $result = $service->submitReport($reporter, [
            'category'    => 'financial_concern',
            'severity'    => 'high',
            'description' => 'I observed concerning withdrawals.',
        ]);

        $this->assertArrayHasKey('report_id', $result);
        $row = DB::table('safeguarding_reports')->where('id', $result['report_id'])->first();
        $this->assertNotNull($row);
        $this->assertSame('submitted', $row->status);
        $this->assertSame('high', $row->severity);
        $this->assertSame('financial_concern', $row->category);
        $this->assertSame((int) self::TENANT_ID, (int) $row->tenant_id);
    }

    public function test_review_due_at_is_set_based_on_severity(): void
    {
        TenantContext::setById(self::TENANT_ID);
        $reporter = $this->makeUser(self::TENANT_ID, 'rep2.' . uniqid() . '@example.com');
        $service = app(SafeguardingService::class);

        $critical = $service->submitReport($reporter, [
            'category'    => 'exploitation',
            'severity'    => 'critical',
            'description' => 'Urgent.',
        ]);
        $low = $service->submitReport($reporter, [
            'category'    => 'other',
            'severity'    => 'low',
            'description' => 'Minor concern.',
        ]);

        $criticalDue = strtotime((string) DB::table('safeguarding_reports')->where('id', $critical['report_id'])->value('review_due_at'));
        $lowDue = strtotime((string) DB::table('safeguarding_reports')->where('id', $low['report_id'])->value('review_due_at'));

        // Critical due before low (critical = 4h, low = 168h)
        $this->assertLessThan($lowDue, $criticalDue);
    }

    public function test_coordinator_can_assign_report(): void
    {
        TenantContext::setById(self::TENANT_ID);
        $reporter = $this->makeUser(self::TENANT_ID, 'rep3.' . uniqid() . '@example.com');
        $reviewer = $this->makeUser(self::TENANT_ID, 'rev.' . uniqid() . '@example.com', 'coordinator');
        $admin = $this->makeUser(self::TENANT_ID, 'adm.' . uniqid() . '@example.com', 'admin');

        $service = app(SafeguardingService::class);
        $r = $service->submitReport($reporter, [
            'category'    => 'neglect',
            'severity'    => 'medium',
            'description' => 'concern',
        ]);

        $service->assignReport($r['report_id'], $reviewer, $admin);

        $row = DB::table('safeguarding_reports')->where('id', $r['report_id'])->first();
        $this->assertSame($reviewer, (int) $row->assigned_to_user_id);

        $action = DB::table('safeguarding_report_actions')
            ->where('report_id', $r['report_id'])
            ->where('action', 'assigned')
            ->first();
        $this->assertNotNull($action);
    }

    public function test_assignment_rejects_ordinary_member_and_report_subject_without_side_effects(): void
    {
        TenantContext::setById(self::TENANT_ID);
        $reporter = $this->makeUser(self::TENANT_ID, 'assign-rep.' . uniqid() . '@example.com');
        $ordinaryMember = $this->makeUser(self::TENANT_ID, 'assign-member.' . uniqid() . '@example.com');
        $subject = $this->makeUser(self::TENANT_ID, 'assign-subject.' . uniqid() . '@example.com', 'coordinator');
        $admin = $this->makeUser(self::TENANT_ID, 'assign-admin.' . uniqid() . '@example.com', 'admin');
        $service = app(SafeguardingService::class);
        $reportId = (int) $service->submitReport($reporter, [
            'category' => 'exploitation',
            'severity' => 'high',
            'description' => 'Synthetic report for assignment authorization.',
            'subject_user_id' => $subject,
        ])['report_id'];

        foreach ([$ordinaryMember, $subject] as $assigneeId) {
            $rejected = false;
            try {
                $service->assignReport($reportId, $assigneeId, $admin);
            } catch (\RuntimeException $e) {
                $rejected = true;
            }
            $this->assertTrue($rejected, 'An ineligible assignee must be rejected.');

            $this->assertNull(DB::table('safeguarding_reports')->where('id', $reportId)->value('assigned_to_user_id'));
            $this->assertSame(0, DB::table('safeguarding_report_actions')->where('report_id', $reportId)->where('action', 'assigned')->count());
            $this->assertSame(0, DB::table('notifications')->where('user_id', $assigneeId)->where('type', 'safeguarding_assigned')->count());
        }
    }

    public function test_subject_cannot_mutate_their_own_report_but_other_staff_can(): void
    {
        $subject = $this->makeUser(self::TENANT_ID, uniqid() . '@example.test', 'admin');
        $reviewer = $this->makeUser(self::TENANT_ID, uniqid() . '@example.test', 'admin');
        $service = app(SafeguardingService::class);
        $id = $service->submitReport($reviewer, ['category' => 'neglect', 'severity' => 'medium',
            'description' => 'Synthetic concern', 'subject_user_id' => $subject])['report_id'];
        $before = (array) DB::table('safeguarding_reports')->find($id);
        $actions = DB::table('safeguarding_report_actions')->where('report_id', $id)->count();
        foreach ([
            fn () => $service->assignReport($id, $reviewer, $subject),
            fn () => $service->escalateReport($id, $subject, 'attempt'),
            fn () => $service->changeStatus($id, 'dismissed', $subject),
            fn () => $service->addNote($id, $subject, 'attempt'),
        ] as $attempt) {
            try {
                $attempt();
                $this->fail('A report subject must not mutate their case.');
            } catch (\RuntimeException $e) {
                $this->assertNotEmpty($e->getMessage());
            }
            $this->assertSame($before, (array) DB::table('safeguarding_reports')->find($id));
            $this->assertSame($actions, DB::table('safeguarding_report_actions')->where('report_id', $id)->count());
        }
        $service->assignReport($id, $reviewer, $reviewer);
        $service->escalateReport($id, 0, 'Scheduled escalation');
        $service->addNote($id, $reviewer, 'reviewed');
        $service->changeStatus($id, 'investigating', $reviewer);
        $this->assertDatabaseHas('safeguarding_reports', ['id' => $id, 'assigned_to_user_id' => $reviewer,
            'escalated' => 1, 'status' => 'investigating']);
        $this->assertSame($actions + 4, DB::table('safeguarding_report_actions')->where('report_id', $id)->count());
    }

    public function test_escalation_marks_report_escalated(): void
    {
        TenantContext::setById(self::TENANT_ID);
        $reporter = $this->makeUser(self::TENANT_ID, 'rep4.' . uniqid() . '@example.com');
        $admin = $this->makeUser(self::TENANT_ID, 'adm2.' . uniqid() . '@example.com', 'admin');

        $service = app(SafeguardingService::class);
        $r = $service->submitReport($reporter, [
            'category'    => 'medical_concern',
            'severity'    => 'high',
            'description' => 'urgent',
        ]);

        $service->escalateReport($r['report_id'], $admin, 'Escalated due to severity');

        $row = DB::table('safeguarding_reports')->where('id', $r['report_id'])->first();
        $this->assertTrue((bool) $row->escalated);
        $this->assertNotNull($row->escalated_at);
    }

    public function test_status_change_records_action(): void
    {
        TenantContext::setById(self::TENANT_ID);
        $reporter = $this->makeUser(self::TENANT_ID, 'rep5.' . uniqid() . '@example.com');
        $admin = $this->makeUser(self::TENANT_ID, 'adm3.' . uniqid() . '@example.com', 'admin');

        $service = app(SafeguardingService::class);
        $r = $service->submitReport($reporter, [
            'category'    => 'inappropriate_behavior',
            'severity'    => 'medium',
            'description' => 'desc',
        ]);

        $service->changeStatus($r['report_id'], 'investigating', $admin);
        $service->changeStatus($r['report_id'], 'resolved', $admin, 'Talked to both parties');

        $row = DB::table('safeguarding_reports')->where('id', $r['report_id'])->first();
        $this->assertSame('resolved', $row->status);
        $this->assertNotNull($row->resolved_at);
        $this->assertSame('Talked to both parties', (string) $row->resolution_notes);

        $actionCount = (int) DB::table('safeguarding_report_actions')
            ->where('report_id', $r['report_id'])
            ->whereIn('action', ['status_changed', 'resolved'])
            ->count();
        $this->assertGreaterThanOrEqual(1, $actionCount);
    }

    public function test_member_cannot_see_other_members_reports(): void
    {
        TenantContext::setById(self::TENANT_ID);
        $reporterA = $this->makeUser(self::TENANT_ID, 'a.' . uniqid() . '@example.com');
        $reporterB = $this->makeUser(self::TENANT_ID, 'b.' . uniqid() . '@example.com');

        $service = app(SafeguardingService::class);
        $service->submitReport($reporterA, [
            'category'    => 'other',
            'severity'    => 'low',
            'description' => 'A report',
        ]);

        $bReports = $service->myReports($reporterB);
        $this->assertCount(0, $bReports);
    }

    public function test_member_can_see_own_reports(): void
    {
        TenantContext::setById(self::TENANT_ID);
        $reporter = $this->makeUser(self::TENANT_ID, 'own.' . uniqid() . '@example.com');

        $service = app(SafeguardingService::class);
        $service->submitReport($reporter, [
            'category'    => 'other',
            'severity'    => 'low',
            'description' => 'My own',
        ]);
        $service->submitReport($reporter, [
            'category'    => 'neglect',
            'severity'    => 'medium',
            'description' => 'Another concern',
        ]);

        $own = $service->myReports($reporter);
        $this->assertCount(2, $own);
    }

    public function test_admin_endpoints_require_safeguarding_permission(): void
    {
        TenantContext::setById(self::TENANT_ID);

        // Plain member — should be denied on admin list endpoint
        $member = $this->makeUser(self::TENANT_ID, 'plain.' . uniqid() . '@example.com');
        $userModel = User::query()->find($member);
        $this->assertNotNull($userModel);
        Sanctum::actingAs($userModel);

        $resp = $this->getJson('/api/v2/admin/caring-community/safeguarding/reports');
        $this->assertContains($resp->status(), [401, 403]);
    }

    public function test_endpoints_403_when_caring_community_feature_disabled(): void
    {
        $this->setCaringCommunityFeature(self::TENANT_ID, false);
        TenantContext::setById(self::TENANT_ID);

        $member = $this->makeUser(self::TENANT_ID, 'gated.' . uniqid() . '@example.com');
        $userModel = User::query()->find($member);
        $this->assertNotNull($userModel);
        Sanctum::actingAs($userModel);

        $resp = $this->postJson('/api/v2/caring-community/safeguarding/report', [
            'category'    => 'other',
            'severity'    => 'low',
            'description' => 'test',
        ]);
        $this->assertSame(403, $resp->status());
    }
}
