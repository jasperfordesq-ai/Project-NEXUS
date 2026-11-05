<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E120;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\EmailDispatchService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * E-120 / GHSA-528v-8vqx-4qww — a safeguarding manager could assign a report
 * to ANY active member of the community. The member was recorded as the
 * reviewer and received a bell/push/email naming the report id, severity and
 * category.
 *
 * The rule these tests pin: a report may only be assigned to — and staff
 * alerts about it may only reach — someone the report-viewing endpoints would
 * let open it in this community (AdminCaringCommunityController::
 * guardSafeguarding('view'): admin tier, broker, coordinator, or a live
 * tenant-scoped safeguarding.view / .manage grant), and never to the person the
 * report is about. Assignment and viewing must agree.
 */
class SafeguardingAssigneeAuthorisationTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $mailer = Mockery::mock(EmailDispatchService::class);
        $mailer->shouldReceive('send')->andReturn(true);
        $mailer->shouldReceive('sendRaw')->andReturn(true);
        $this->app->instance(EmailDispatchService::class, $mailer);
        $this->enableCaringCommunity();
    }

    private function enableCaringCommunity(): void
    {
        $tenant = DB::table('tenants')->where('id', $this->testTenantId)->first();
        $features = [];
        if ($tenant && !empty($tenant->features)) {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : $tenant->features;
            $features = is_array($decoded) ? $decoded : [];
        }
        $features['caring_community'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);
    }

    private function user(string $role = 'member', array $extra = [], ?int $tenantId = null): User
    {
        return User::factory()->forTenant($tenantId ?? $this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'role' => $role,
        ], $extra));
    }

    private function grant(User $user, string $permission, bool $granted = true, ?string $expiresAt = null): void
    {
        $permissionId = DB::table('permissions')->where('name', $permission)->value('id');
        if (!$permissionId) {
            $permissionId = DB::table('permissions')->insertGetId([
                'name' => $permission,
                'display_name' => $permission,
                'description' => $permission,
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

    private function report(?int $subjectId = null, string $severity = 'critical'): int
    {
        $reporter = $this->user();

        return (int) DB::table('safeguarding_reports')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'reporter_user_id' => $reporter->id,
            'subject_user_id' => $subjectId,
            'category' => 'exploitation',
            'severity' => $severity,
            'description' => 'Synthetic E-120 report.',
            'status' => 'submitted',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function assign(User $actor, int $reportId, int $assigneeId): \Illuminate\Testing\TestResponse
    {
        Sanctum::actingAs($actor);

        return $this->apiPost("/v2/admin/caring-community/safeguarding/reports/{$reportId}/assign", [
            'assignee_user_id' => $assigneeId,
        ]);
    }

    private function notified(int $userId, string $type): int
    {
        return DB::table('notifications')->where('user_id', $userId)->where('type', $type)->count();
    }

    private function assertNothingHappened(int $reportId, int $assigneeId): void
    {
        $this->assertNull(DB::table('safeguarding_reports')->where('id', $reportId)->value('assigned_to_user_id'));
        $this->assertSame(0, DB::table('safeguarding_report_actions')->where('report_id', $reportId)->where('action', 'assigned')->count());
        $this->assertSame(0, $this->notified($assigneeId, 'safeguarding_assigned'));
    }

    /** The reporter's exact scenario: admin assigns report to an ordinary member. */
    public function test_an_ordinary_member_cannot_be_made_the_assignee_and_learns_nothing(): void
    {
        $admin = $this->user('admin');
        $member = $this->user('member');
        $reportId = $this->report();

        $response = $this->assign($admin, $reportId, $member->id);

        $response->assertStatus(404);
        $this->assertNothingHappened($reportId, $member->id);
    }

    public function test_a_holder_of_safeguarding_manage_cannot_assign_to_an_ordinary_member_either(): void
    {
        $officer = $this->user('member');
        $this->grant($officer, 'safeguarding.manage');
        $member = $this->user('member');
        $reportId = $this->report();

        $this->assign($officer, $reportId, $member->id)->assertStatus(404);
        $this->assertNothingHappened($reportId, $member->id);
    }

    public function test_the_subject_of_a_report_cannot_be_assigned_their_own_case(): void
    {
        $admin = $this->user('admin');
        $reportedCoordinator = $this->user('coordinator');
        $reportedAdmin = $this->user('admin');

        foreach ([$reportedCoordinator, $reportedAdmin] as $subject) {
            $reportId = $this->report($subject->id);
            $this->assign($admin, $reportId, $subject->id)->assertStatus(404);
            $this->assertNothingHappened($reportId, $subject->id);
        }
    }

    public function test_revoked_expired_and_other_community_grants_do_not_make_an_assignee(): void
    {
        $admin = $this->user('admin');
        $revoked = $this->user('member');
        $this->grant($revoked, 'safeguarding.view', false);
        $expired = $this->user('member');
        $this->grant($expired, 'safeguarding.view', true, now()->subDay()->toDateTimeString());
        $suspendedAdmin = $this->user('admin', ['status' => 'suspended']);

        $otherTenantId = (int) DB::table('tenants')->where('id', '!=', $this->testTenantId)->value('id');
        $candidates = [$revoked, $expired, $suspendedAdmin];
        if ($otherTenantId > 0) {
            $candidates[] = $this->user('admin', [], $otherTenantId);
        }
        TenantContext::setById($this->testTenantId);

        foreach ($candidates as $candidate) {
            $reportId = $this->report();
            $this->assign($admin, $reportId, $candidate->id)->assertStatus(404);
            $this->assertNothingHappened($reportId, $candidate->id);
        }
    }

    public function test_real_safeguarding_staff_can_be_assigned_and_are_told(): void
    {
        $admin = $this->user('admin');
        $flagAdmin = $this->user('member', ['is_admin' => 1]);
        $coordinator = $this->user('coordinator');
        $broker = $this->user('broker');
        $viewer = $this->user('member');
        $this->grant($viewer, 'safeguarding.view');

        foreach ([$admin, $flagAdmin, $coordinator, $broker, $viewer] as $reviewer) {
            $reportId = $this->report();
            $this->assign($admin, $reportId, $reviewer->id)->assertStatus(200);
            $this->assertSame($reviewer->id, (int) DB::table('safeguarding_reports')->where('id', $reportId)->value('assigned_to_user_id'));
            $this->assertGreaterThan(0, $this->notified($reviewer->id, 'safeguarding_assigned'), "role {$reviewer->role} should be told");
        }
    }

    /**
     * Assignment and viewing agree: for every kind of person, an assignment is
     * accepted exactly when that person can open the report themselves.
     */
    public function test_assignment_is_accepted_exactly_when_the_assignee_can_open_the_report(): void
    {
        $admin = $this->user('admin');
        $viewer = $this->user('member');
        $this->grant($viewer, 'safeguarding.view');
        $revoked = $this->user('member');
        $this->grant($revoked, 'safeguarding.view', false);
        $subject = $this->user('coordinator');

        $cases = [
            'admin' => $this->user('admin'),
            'flag admin' => $this->user('member', ['is_admin' => 1]),
            'tenant super admin' => $this->user('member', ['is_tenant_super_admin' => 1]),
            'coordinator' => $this->user('coordinator'),
            'broker' => $this->user('broker'),
            'view grant' => $viewer,
            'revoked grant' => $revoked,
            'ordinary member' => $this->user('member'),
            'subject' => $subject,
        ];

        foreach ($cases as $label => $candidate) {
            $reportId = $this->report($subject->id);

            Sanctum::actingAs($candidate);
            $canOpen = $this->apiGet("/v2/admin/caring-community/safeguarding/reports/{$reportId}")->status() === 200;

            $assigned = $this->assign($admin, $reportId, $candidate->id)->status() === 200;

            $this->assertSame($canOpen, $assigned, "{$label}: viewing ({$this->bool($canOpen)}) and assignment ({$this->bool($assigned)}) disagree");
        }
    }

    /** A stale assignee who has since lost access must not get the escalation alert. */
    public function test_escalation_never_alerts_an_assignee_who_cannot_open_the_report(): void
    {
        $admin = $this->user('admin');
        $formerCoordinator = $this->user('member');
        $reportId = $this->report();
        DB::table('safeguarding_reports')->where('id', $reportId)->update(['assigned_to_user_id' => $formerCoordinator->id]);

        Sanctum::actingAs($admin);
        $this->apiPost("/v2/admin/caring-community/safeguarding/reports/{$reportId}/escalate", ['note' => 'overdue'])
            ->assertStatus(200);

        $this->assertSame(0, $this->notified($formerCoordinator->id, 'safeguarding_escalated'));
        $this->assertGreaterThan(0, $this->notified($admin->id, 'safeguarding_escalated'));
    }

    private function bool(bool $value): string
    {
        return $value ? 'yes' : 'no';
    }
}
