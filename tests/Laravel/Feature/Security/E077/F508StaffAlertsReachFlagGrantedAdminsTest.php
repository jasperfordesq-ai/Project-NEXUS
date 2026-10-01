<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E077;

use App\Core\TenantContext;
use App\Events\GroupCreated;
use App\Listeners\NotifyAdminOfNewGroup;
use App\Models\Group;
use App\Models\User;
use App\Services\Identity\RegistrationOrchestrationService;
use App\Services\NotificationDispatcher;
use App\Support\Authorization\AdminTier;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

/**
 * F-508 (E-077 re-attack, reviewers B's C3 and C's D7) — staff alerts must reach
 * an administrator granted the way the platform now grants one: a flag
 * (`is_tenant_super_admin`, `is_admin`, …) on a `role='member'` row.
 *
 * Five fan-outs chose recipients by the role string alone, so in a community
 * whose only staff are flag-granted, content reports, exchange approvals and
 * disputes, new-group notices, members awaiting approval and identity checks
 * reached nobody. F-490 fixed four similar listeners by hand-copying the flag
 * condition; these now use the shared recipient rules instead
 * (SafeguardingStaff for broker-and-admin alerts, AdminTier for admin-only).
 *
 * These tests assert the CORRECT behaviour and fail before the fix. Controls:
 * a role-string administrator is still alerted, a broker still receives the
 * broker-work alerts, and an ordinary member receives none of them.
 */
final class F508StaffAlertsReachFlagGrantedAdminsTest extends TestCase
{
    use DatabaseTransactions;

    private User $flagAdmin;

    private User $roleAdmin;

    private User $broker;

    private User $member;

    /** A community of its own, so each alert reaches only this file's four accounts. */
    private int $tenantId = 0;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        Cache::flush();
        $slug = 'e077-f508-' . bin2hex(random_bytes(4));
        $this->tenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'E077 F508 ' . $slug, 'slug' => $slug, 'is_active' => 1,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        TenantContext::reset();
        TenantContext::setById($this->tenantId);

        $this->flagAdmin = $this->account(['role' => 'member', 'is_admin' => 0, 'is_tenant_super_admin' => 1]);
        $this->roleAdmin = $this->account(['role' => 'admin', 'is_admin' => 1]);
        $this->broker = $this->account(['role' => 'broker']);
        $this->member = $this->account(['role' => 'member']);

        self::assertTrue(
            AdminTier::allows(DB::table('users')->where('id', $this->flagAdmin->id)->first()),
            'fixture: the flag-granted account really holds admin authority'
        );
    }

    public function test_moderation_report_alert_reaches_the_flag_granted_admin(): void
    {
        NotificationDispatcher::notifyModerationAdmins(
            'content_report',
            '/admin/reports',
            'notifications.content_reported',
            'emails_misc.moderation.subject',
            'emails_misc.moderation.body',
            [],
        );

        $this->assertBells(flag: 1, role: 1, broker: 1, member: 0);
    }

    public function test_exchange_broker_alert_reaches_the_flag_granted_admin(): void
    {
        NotificationDispatcher::notifyAdmins('exchange_disputed', ['exchange_id' => 1], 'F508 dispute');

        $this->assertBells(flag: 1, role: 1, broker: 1, member: 0);
    }

    public function test_new_group_alert_reaches_the_flag_granted_admin(): void
    {
        $owner = $this->account(['role' => 'member']);
        $groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->tenantId,
            'owner_id' => $owner->id,
            'name' => 'F508 group',
            'description' => 'F508 group',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $group = Group::withoutGlobalScopes()->find($groupId);

        (new NotifyAdminOfNewGroup())->handle(new GroupCreated($group, $this->tenantId));

        $this->assertBells(flag: 1, role: 1, broker: 1, member: 0);
    }

    public function test_pending_approval_alert_reaches_the_flag_granted_admin(): void
    {
        $applicant = $this->account(['role' => 'member', 'is_approved' => 0]);
        $m = new \ReflectionMethod(RegistrationOrchestrationService::class, 'handleOpenWithApproval');
        $m->setAccessible(true);
        $m->invoke(null, (int) $applicant->id, $this->tenantId, []);

        $this->assertBells(flag: 1, role: 1, broker: 1, member: 0);
    }

    public function test_verification_completed_alert_reaches_the_flag_granted_admin_only(): void
    {
        $subject = $this->account(['role' => 'member']);
        NotificationDispatcher::dispatchVerificationCompletedToAdmins((int) $subject->id, 'passed');

        // Admin-only alert: brokers were never recipients, and still are not.
        $this->assertBells(flag: 1, role: 1, broker: 0, member: 0);
    }

    private function assertBells(int $flag, int $role, int $broker, int $member): void
    {
        $count = fn (User $u): int => (int) DB::table('notifications')->where('user_id', $u->id)->count();

        $this->assertSame($flag, $count($this->flagAdmin), 'F-508: the flag-granted administrator');
        $this->assertSame($role, $count($this->roleAdmin), 'CONTROL: the role-string administrator');
        $this->assertSame($broker, $count($this->broker), 'CONTROL: the broker');
        $this->assertSame($member, $count($this->member), 'CONTROL: an ordinary member receives no staff alert');
    }

    /** @param array<string,mixed> $cols */
    private function account(array $cols): User
    {
        $u = User::factory()->forTenant($this->tenantId)->create(['status' => 'active', 'is_approved' => true]);
        DB::table('users')->where('id', $u->id)->update($cols);

        return User::find($u->id);
    }
}
