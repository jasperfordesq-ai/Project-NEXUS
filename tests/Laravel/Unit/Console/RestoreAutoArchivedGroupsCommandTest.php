<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Console;

use App\Core\TenantContext;
use App\Enums\GroupStatus;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

final class RestoreAutoArchivedGroupsCommandTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 99734;

    private int $ownerId;

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow(Carbon::parse('2026-08-18 12:00:00'));
        Queue::fake();

        DB::table('tenants')->updateOrInsert(
            ['id' => self::TENANT_ID],
            [
                'name' => 'Restore Test Tenant',
                'slug' => 'restore-test-99734',
                'domain' => null,
                'is_active' => true,
                'depth' => 0,
                'allows_subtenants' => false,
                'created_at' => now(),
                'updated_at' => now(),
            ],
        );
        TenantContext::setById(self::TENANT_ID);

        $this->ownerId = (int) DB::table('users')->insertGetId([
            'tenant_id' => self::TENANT_ID,
            'name' => 'Restore Owner',
            'email' => 'restore-owner-99734@example.com',
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_tenant_option_is_required(): void
    {
        $this->artisan('groups:restore-auto-archived')->assertExitCode(1);
    }

    public function test_dry_run_reports_but_writes_nothing(): void
    {
        $groupId = $this->insertSweptGroup();

        $this->artisan('groups:restore-auto-archived', ['--tenant' => self::TENANT_ID])
            ->assertExitCode(0);

        $this->assertLifecycle($groupId, GroupStatus::Archived, false);
    }

    public function test_apply_restores_an_archived_group_to_active(): void
    {
        $groupId = $this->insertSweptGroup();

        $this->artisan('groups:restore-auto-archived', ['--tenant' => self::TENANT_ID, '--apply' => true])
            ->assertExitCode(0);

        $this->assertLifecycle($groupId, GroupStatus::Active, true);
    }

    public function test_restore_is_recorded_in_the_audit_log(): void
    {
        $groupId = $this->insertSweptGroup();

        $this->artisan('groups:restore-auto-archived', ['--tenant' => self::TENANT_ID, '--apply' => true])
            ->assertExitCode(0);

        $restoreEntries = DB::table('group_audit_log')
            ->where('tenant_id', self::TENANT_ID)
            ->where('group_id', $groupId)
            ->where('action', 'group_status_changed')
            ->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(details, '$.reason')) = ?", ['Restore after automatic inactivity sweep defect'])
            ->count();

        self::assertSame(1, $restoreEntries);
    }

    public function test_two_hop_sweep_is_restored_to_the_status_held_before_it(): void
    {
        $groupId = $this->insertGroup(['status' => GroupStatus::Archived->value, 'is_active' => false]);
        $this->insertSweepAudit($groupId, 'active', 'dormant', 'Automatic inactivity dormancy', '2026-07-13 03:30:21');
        $this->insertSweepAudit($groupId, 'dormant', 'archived', 'Automatic inactivity archive', '2026-07-24 03:30:22');

        $this->artisan('groups:restore-auto-archived', ['--tenant' => self::TENANT_ID, '--apply' => true])
            ->assertExitCode(0);

        $this->assertLifecycle($groupId, GroupStatus::Active, true);
    }

    public function test_group_changed_by_hand_since_the_sweep_is_left_alone(): void
    {
        $groupId = $this->insertSweptGroup();
        $this->insertSweepAudit($groupId, 'archived', 'archived', 'Admin reviewed and kept archived', '2026-08-01 09:00:00');

        $this->artisan('groups:restore-auto-archived', ['--tenant' => self::TENANT_ID, '--apply' => true])
            ->assertExitCode(0);

        $this->assertLifecycle($groupId, GroupStatus::Archived, false);
    }

    public function test_group_no_longer_in_the_status_the_sweep_set_is_left_alone(): void
    {
        // The sweep archived it, but it is active again now: somebody has already dealt with it.
        $groupId = $this->insertGroup(['status' => GroupStatus::Active->value, 'is_active' => true]);
        $this->insertSweepAudit($groupId, 'active', 'archived', 'Automatic inactivity archive', '2026-07-13 03:30:21');

        $this->artisan('groups:restore-auto-archived', ['--tenant' => self::TENANT_ID, '--apply' => true])
            ->assertExitCode(0);

        $this->assertLifecycle($groupId, GroupStatus::Active, true);
        self::assertSame(0, DB::table('group_audit_log')
            ->where('tenant_id', self::TENANT_ID)
            ->where('group_id', $groupId)
            ->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(details, '$.reason')) = ?", ['Restore after automatic inactivity sweep defect'])
            ->count());
    }

    public function test_a_group_the_sweep_never_touched_is_left_alone(): void
    {
        $untouched = $this->insertGroup(['status' => GroupStatus::Archived->value, 'is_active' => false]);

        $this->artisan('groups:restore-auto-archived', ['--tenant' => self::TENANT_ID, '--apply' => true])
            ->assertExitCode(0);

        $this->assertLifecycle($untouched, GroupStatus::Archived, false);
    }

    public function test_limit_caps_how_many_groups_one_run_restores(): void
    {
        $this->insertSweptGroup();
        $this->insertSweptGroup();
        $this->insertSweptGroup();

        $this->artisan('groups:restore-auto-archived', [
            '--tenant' => self::TENANT_ID,
            '--apply' => true,
            '--limit' => 2,
        ])->assertExitCode(0);

        $restored = DB::table('groups')
            ->where('tenant_id', self::TENANT_ID)
            ->where('status', GroupStatus::Active->value)
            ->count();

        self::assertSame(2, $restored);
    }

    private function insertSweptGroup(): int
    {
        $groupId = $this->insertGroup(['status' => GroupStatus::Archived->value, 'is_active' => false]);
        $this->insertSweepAudit($groupId, 'active', 'archived', 'Automatic inactivity archive', '2026-07-13 03:30:21');

        return $groupId;
    }

    private function insertSweepAudit(int $groupId, string $old, string $new, string $reason, string $at): void
    {
        DB::table('group_audit_log')->insert([
            'tenant_id' => self::TENANT_ID,
            'group_id' => $groupId,
            'user_id' => $this->ownerId,
            'action' => 'group_status_changed',
            'details' => json_encode(['old_status' => $old, 'new_status' => $new, 'reason' => $reason]),
            'created_at' => $at,
        ]);
    }

    private function insertGroup(array $overrides = []): int
    {
        $attributes = array_merge([
            'tenant_id' => self::TENANT_ID,
            'owner_id' => $this->ownerId,
            'name' => 'Restore Group ' . uniqid('', true),
            'visibility' => 'public',
            'status' => GroupStatus::Active->value,
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides);

        return (int) DB::table('groups')->insertGetId($attributes);
    }

    private function assertLifecycle(int $groupId, GroupStatus $status, bool $isActive): void
    {
        $stored = DB::table('groups')->where('id', $groupId)->first();
        self::assertSame($status->value, $stored->status);
        self::assertSame($isActive, (bool) $stored->is_active);
    }
}
