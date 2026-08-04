<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\TenantProvisioning;

use App\Core\SuperPanelAccess;
use App\Models\User;
use App\Services\TenantProvisioning\TenantPurgeService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Guards the god-only permanent tenant purge. Because a purge is irreversible and
 * touches ~600 tenant-scoped tables + external systems, these tests pin the
 * critical invariants: it only runs on a deactivated, childless, non-Master
 * tenant; it deletes ordinary members but preserves platform super-admins; and a
 * dry run changes nothing.
 */
class TenantPurgeTest extends TestCase
{
    use DatabaseTransactions;

    /**
     * Insert a throwaway tenant and return its id. Parents under the always-present
     * test tenant (id 2) by default — the FK `fk_tenant_parent` requires a real
     * parent, and the test DB has no Master tenant (id 1).
     */
    private function makeTenant(bool $active, ?int $parentId = null): int
    {
        $slug = 'purge-' . substr(md5(uniqid('', true)), 0, 10);

        return (int) DB::table('tenants')->insertGetId([
            'name'       => 'Purge Test ' . $slug,
            'slug'       => $slug,
            'parent_id'  => $parentId ?? $this->testTenantId,
            'is_active'  => $active ? 1 : 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_purge_removes_tenant_its_data_and_members(): void
    {
        $tenantId = $this->makeTenant(active: false);

        // A tenant-scoped row (same shape TenantDefaultsSeeder uses) and a member.
        DB::table('tenant_settings')->insert([
            'tenant_id'     => $tenantId,
            'setting_key'   => 'general.registration_mode',
            'setting_value' => 'open',
            'setting_type'  => 'string',
        ]);
        $member = User::factory()->create(['tenant_id' => $tenantId]);

        $report = TenantPurgeService::purge($tenantId);

        $this->assertTrue($report['success'], $report['error'] ?? 'purge should succeed');
        $this->assertNull(DB::table('tenants')->where('id', $tenantId)->first(), 'tenant row should be gone');
        $this->assertSame(0, DB::table('tenant_settings')->where('tenant_id', $tenantId)->count(), 'tenant_settings should be purged');
        $this->assertNull(DB::table('users')->where('id', $member->id)->first(), 'ordinary member should be deleted');
    }

    public function test_purge_preserves_platform_super_admin(): void
    {
        $tenantId = $this->makeTenant(active: false, parentId: $this->testTenantId);

        $member     = User::factory()->create(['tenant_id' => $tenantId]);
        $superAdmin = User::factory()->create(['tenant_id' => $tenantId, 'is_super_admin' => true]);

        $report = TenantPurgeService::purge($tenantId);

        $this->assertTrue($report['success']);
        $this->assertNull(DB::table('users')->where('id', $member->id)->first(), 'member deleted');

        $survivor = DB::table('users')->where('id', $superAdmin->id)->first();
        $this->assertNotNull($survivor, 'platform super-admin must not be deleted');
        $this->assertSame($this->testTenantId, (int) $survivor->tenant_id, 'super-admin reassigned to parent tenant');
    }

    public function test_purge_refuses_master_tenant(): void
    {
        $report = TenantPurgeService::purge(1);
        $this->assertFalse($report['success']);
        $this->assertStringContainsStringIgnoringCase('master', $report['error']);
    }

    public function test_purge_refuses_active_tenant(): void
    {
        $tenantId = $this->makeTenant(active: true);
        $report = TenantPurgeService::purge($tenantId);
        $this->assertFalse($report['success']);
        $this->assertStringContainsStringIgnoringCase('deactivate', $report['error']);
    }

    public function test_purge_refuses_when_children_exist(): void
    {
        $parentId = $this->makeTenant(active: false);
        $this->makeTenant(active: false, parentId: $parentId);

        $report = TenantPurgeService::purge($parentId);
        $this->assertFalse($report['success']);
        $this->assertStringContainsStringIgnoringCase('sub-tenant', $report['error']);
    }

    public function test_dry_run_counts_without_deleting(): void
    {
        $tenantId = $this->makeTenant(active: false);
        $member = User::factory()->create(['tenant_id' => $tenantId]);

        $report = TenantPurgeService::purge($tenantId, ['dry_run' => true]);

        $this->assertTrue($report['success']);
        $this->assertTrue($report['dry_run']);
        $this->assertGreaterThanOrEqual(1, $report['members_to_delete']);
        // Nothing was actually removed.
        $this->assertNotNull(DB::table('tenants')->where('id', $tenantId)->first(), 'tenant still exists after dry run');
        $this->assertNotNull(DB::table('users')->where('id', $member->id)->first(), 'member still exists after dry run');
    }

    /**
     * A purge is irreversible, so its audit entry is the only surviving record of
     * it. From 2026-03 to 2026-08 that entry was written with action_type = ''
     * because 'tenant_purged' was missing from the enum — and because MariaDB runs
     * here with strict mode off, the write SUCCEEDED and log() returned true, so
     * nothing anywhere reported a problem. A real production purge on 2026-07-05
     * was recorded that way: fully described, but invisible to every by-action
     * view. This pins the label itself, not just the presence of a row.
     */
    public function test_purge_writes_an_audit_row_labelled_tenant_purged(): void
    {
        // SuperPanelAccess memoises the actor in a static for the life of the
        // process, and PHPUnit shares one process per shard, so an earlier test
        // class can leak an actor into this one.
        SuperPanelAccess::reset();

        $tenantId = $this->makeTenant(active: false);
        $slug = (string) DB::table('tenants')->where('id', $tenantId)->value('slug');

        $report = TenantPurgeService::purge($tenantId);
        $this->assertTrue($report['success'], $report['error'] ?? 'purge should succeed');

        $row = DB::table('super_admin_audit_log')
            ->where('target_type', 'tenant')
            ->where('target_id', $tenantId)
            ->orderByDesc('id')
            ->first();

        $this->assertNotNull($row, 'a purge must leave an audit entry');
        $this->assertSame(
            'tenant_purged',
            $row->action_type,
            "action_type was '" . (string) $row->action_type . "'; an empty string means the enum is missing "
            . "'tenant_purged' — run: docker exec -e DB_DATABASE=nexus_test nexus-php-app php artisan migrate --force"
        );
        $this->assertStringContainsString($slug, (string) $row->description);

        // Deliberately not asserting on actor_* : TestCase::setUp() clears
        // $_SESSION['user_id'] but not ['tenant_id'], so those values depend on
        // execution order and would flake under sharding.

        $this->assertSame(
            0,
            DB::table('super_admin_audit_log')->where('action_type', '')->count(),
            'no audit entry may carry a blank action_type'
        );
        $this->assertNotContains(
            'Audit entry for this purge was not recorded faithfully — check the application log.',
            $report['warnings'],
            'the purge should not report an audit warning once the enum is correct'
        );
    }

    public function test_dry_run_allowed_on_active_tenant(): void
    {
        // The preview must work BEFORE deactivation so an operator can see the
        // blast radius; only the real purge requires deactivation.
        $tenantId = $this->makeTenant(active: true);
        $report = TenantPurgeService::purge($tenantId, ['dry_run' => true]);
        $this->assertTrue($report['success']);
    }
}
