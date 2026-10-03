<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\SupportReportNotificationService;
use App\Models\SupportReport;
use App\Models\User;
use App\Core\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Log;

/**
 * SupportReportNotificationServiceTest
 *
 * Strategy:
 * - notifyCreated is the sole public method; it dispatches bell notifications
 *   and (for high-impact reports) emails to admin users in the tenant.
 * - We use real DB rows for tenant/user/notifications so the Eloquent queries
 *   in adminRecipients() actually resolve.
 * - EmailDispatchService::sendRaw and NotificationDispatcher::fanOutPush are
 *   both fire-and-forget and can fail silently in test env — we check that
 *   notifyCreated does not throw and that a bell Notification row is written.
 * - shouldSendImmediateEmail is private — we test it via the impact values
 *   ('blocked'/'major' => email, other => no email) by observing log behaviour
 *   or by reflection.
 * - Queue::fake() is used to prevent any observer-triggered job from resetting
 *   TenantContext under a sync queue worker.
 */
class SupportReportNotificationServiceTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 2;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        TenantContext::setById(self::TENANT_ID);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Build an unsaved SupportReport with the given impact.
     * Uses direct property assignment so no DB write occurs and no
     * unique-reference constraint can fire unexpectedly.
     */
    private function makeReport(
        string $impact = 'minor',
        string $reference = 'SR-TEST-001',
        ?int $id = null
    ): SupportReport {
        $report = new SupportReport();
        $report->id          = $id ?? rand(900000, 999999);
        $report->tenant_id   = self::TENANT_ID;
        $report->reference   = $reference . '-' . uniqid();
        $report->summary     = 'Unit test support report';
        $report->description = 'Description for testing.';
        $report->impact      = $impact;
        $report->status      = 'open';
        $report->source      = 'in_app';
        $report->route       = '/test/route';
        $report->diagnostics = null;
        return $report;
    }

    /**
     * Insert a minimal admin user for tenant 2 and return the User model.
     */
    private function insertAdminUser(string $role = 'admin'): User
    {
        $uid = uniqid('adm', true);
        $id  = DB::table('users')->insertGetId([
            'tenant_id'   => self::TENANT_ID,
            'name'        => 'Admin ' . $uid,
            'first_name'  => 'Admin',
            'last_name'   => 'User',
            'email'       => $uid . '@admin.test',
            'status'      => 'active',
            'role'        => $role,
            'balance'     => 0,
            'is_approved' => 1,
            'created_at'  => now(),
            'updated_at'  => now(),
        ]);

        return User::withoutGlobalScopes()->find($id);
    }

    // ─────────────────────────────────────────────────────────────────────
    // notifyCreated — does not throw
    // ─────────────────────────────────────────────────────────────────────

    public function test_notifyCreated_does_not_throw_for_minor_impact(): void
    {
        $report = $this->makeReport('minor');

        // Should complete without exception.
        SupportReportNotificationService::notifyCreated($report);

        $this->addToAssertionCount(1);
    }

    public function test_notifyCreated_does_not_throw_for_major_impact(): void
    {
        $report = $this->makeReport('major');

        SupportReportNotificationService::notifyCreated($report);

        $this->addToAssertionCount(1);
    }

    public function test_notifyCreated_does_not_throw_for_blocked_impact(): void
    {
        $report = $this->makeReport('blocked');

        SupportReportNotificationService::notifyCreated($report);

        $this->addToAssertionCount(1);
    }

    public function test_notifyCreated_does_not_throw_for_cosmetic_impact(): void
    {
        $report = $this->makeReport('cosmetic');

        SupportReportNotificationService::notifyCreated($report);

        $this->addToAssertionCount(1);
    }

    // ─────────────────────────────────────────────────────────────────────
    // notifyCreated — bell notification is written for admin users
    // ─────────────────────────────────────────────────────────────────────

    public function test_notifyCreated_creates_bell_notification_for_admin(): void
    {
        $admin  = $this->insertAdminUser('admin');
        $report = $this->makeReport('minor');

        $before = DB::table('notifications')
            ->where('user_id', $admin->id)
            ->count();

        SupportReportNotificationService::notifyCreated($report);

        $after = DB::table('notifications')
            ->where('user_id', $admin->id)
            ->count();

        $this->assertGreaterThan($before, $after, 'A bell notification row should be inserted for the admin');
    }

    public function test_notifyCreated_creates_bell_notification_for_is_admin_user(): void
    {
        // Users flagged with is_admin=1 but role='member' should also receive bell notifications.
        $uid = uniqid('isa', true);
        $id  = DB::table('users')->insertGetId([
            'tenant_id'   => self::TENANT_ID,
            'name'        => 'IsAdmin ' . $uid,
            'first_name'  => 'IsAdmin',
            'last_name'   => 'User',
            'email'       => $uid . '@isadmin.test',
            'status'      => 'active',
            'role'        => 'member',
            'is_admin'    => 1,
            'balance'     => 0,
            'is_approved' => 1,
            'created_at'  => now(),
            'updated_at'  => now(),
        ]);

        $report = $this->makeReport('cosmetic');

        $before = DB::table('notifications')->where('user_id', $id)->count();

        SupportReportNotificationService::notifyCreated($report);

        $after = DB::table('notifications')->where('user_id', $id)->count();

        $this->assertGreaterThan($before, $after);
    }

    // shouldSendImmediateEmail() was removed on 2026-10-03 (594c627af): every
    // report now emails the admins whatever its impact. That behaviour is
    // pinned in Feature\SupportReportApiTest::
    // test_low_priority_support_reports_also_email_admins_and_create_a_bell_notification.

    // ─────────────────────────────────────────────────────────────────────
    // translatedImpact — tested via reflection
    // ─────────────────────────────────────────────────────────────────────

    public function test_translatedImpact_returns_string_for_all_known_values(): void
    {
        $ref = new \ReflectionClass(SupportReportNotificationService::class);
        $method = $ref->getMethod('translatedImpact');
        $method->setAccessible(true);

        foreach (['blocked', 'major', 'minor', 'cosmetic'] as $impact) {
            $result = $method->invoke(null, $impact);
            $this->assertIsString($result, "translatedImpact({$impact}) should return a string");
            $this->assertNotEmpty($result);
        }
    }

    public function test_translatedImpact_returns_string_for_unknown_value(): void
    {
        $ref = new \ReflectionClass(SupportReportNotificationService::class);
        $method = $ref->getMethod('translatedImpact');
        $method->setAccessible(true);

        // 'unknown' falls through to the default arm — should not throw.
        $result = $method->invoke(null, 'unknown_value');
        $this->assertIsString($result);
    }

    // ─────────────────────────────────────────────────────────────────────
    // notifyCreated — graceful handling when tenant has no admins
    // ─────────────────────────────────────────────────────────────────────

    public function test_notifyCreated_does_not_throw_when_tenant_has_no_admins(): void
    {
        // Use an isolated tenant that has no admin users.
        $tempTenantId = 97001;
        DB::table('tenants')->insertOrIgnore([
            'id'               => $tempTenantId,
            'name'             => 'NoAdminTenant',
            'slug'             => 'no-admin-' . $tempTenantId,
            'is_active'        => 1,
            'depth'            => 1,
            'parent_id'        => 1,
            'path'             => '/1/' . $tempTenantId . '/',
            'allows_subtenants'=> 0,
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);

        $report            = new SupportReport();
        $report->id        = 999998;
        $report->tenant_id = $tempTenantId;
        $report->reference = 'SR-NOADMIN-' . uniqid();
        $report->summary   = 'No admin test';
        $report->description = 'desc';
        $report->impact    = 'blocked';
        $report->status    = 'open';
        $report->source    = 'in_app';
        $report->route     = null;
        $report->diagnostics = null;

        // Should silently succeed with no admins to notify.
        SupportReportNotificationService::notifyCreated($report);

        $this->addToAssertionCount(1);
    }
}
