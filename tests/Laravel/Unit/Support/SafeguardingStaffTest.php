<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Support;

use App\Support\Authorization\SafeguardingStaff;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-221: who receives safeguarding and broker-work alerts.
 */
class SafeguardingStaffTest extends TestCase
{
    use DatabaseTransactions;

    private function user(array $attrs): int
    {
        return (int) DB::table('users')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'name' => 'Staff test',
            'email' => uniqid('staff_', true) . '@example.com',
            'password' => 'x',
            'status' => 'active',
            'role' => 'member',
            'created_at' => now(),
        ], $attrs));
    }

    public function test_builder_and_sql_forms_select_the_same_staff(): void
    {
        $expected = [
            $this->user(['role' => 'broker']),
            $this->user(['role' => 'coordinator']),
            $this->user(['role' => 'admin']),
            $this->user(['role' => 'tenant_admin']),
            $this->user(['is_admin' => 1]),
            $this->user(['is_tenant_super_admin' => 1]),
            $this->user(['is_super_admin' => 1]),
            $this->user(['is_god' => 1]),
        ];
        $member = $this->user([]);

        $viaBuilder = SafeguardingStaff::scope(DB::table('users')->where('tenant_id', $this->testTenantId))
            ->pluck('id')->map(fn ($id) => (int) $id)->all();
        $viaSql = array_map(
            fn ($r) => (int) $r->id,
            DB::select('SELECT id FROM users WHERE tenant_id = ? AND ' . SafeguardingStaff::sqlCondition(), [$this->testTenantId])
        );

        foreach ($expected as $id) {
            $this->assertContains($id, $viaBuilder);
            $this->assertContains($id, $viaSql);
        }
        $this->assertNotContains($member, $viaBuilder);
        $this->assertNotContains($member, $viaSql);
        sort($viaBuilder);
        sort($viaSql);
        $this->assertSame($viaBuilder, $viaSql);
    }

    public function test_aliased_forms_work_in_a_join(): void
    {
        $coordinator = $this->user(['role' => 'coordinator']);

        $ids = SafeguardingStaff::scope(DB::table('users as u')->where('u.tenant_id', $this->testTenantId), 'u')
            ->pluck('u.id')->map(fn ($id) => (int) $id)->all();
        $this->assertContains($coordinator, $ids);

        $rows = DB::select('SELECT u.id FROM users u WHERE u.tenant_id = ? AND ' . SafeguardingStaff::sqlCondition('u'), [$this->testTenantId]);
        $this->assertContains($coordinator, array_map(fn ($r) => (int) $r->id, $rows));
    }

    /**
     * Guard against the hand-copied role list coming back. Any staff alert
     * must use SafeguardingStaff. The Caring Community workflow's coordinator
     * checks are authorisation, not alerts, and are deliberately left alone.
     */
    public function test_no_alert_hard_codes_the_old_staff_role_list(): void
    {
        $allowed = [
            'app/Services/CaringCommunityWorkflowService.php',
        ];
        $pattern = "/'admin',\\s*'tenant_admin',\\s*'broker',\\s*'super_admin'/";
        $offenders = [];
        $root = base_path('app');
        $it = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root));
        foreach ($it as $file) {
            if (!$file->isFile() || $file->getExtension() !== 'php') {
                continue;
            }
            $relative = 'app/' . str_replace('\\', '/', substr($file->getPathname(), strlen($root) + 1));
            if (in_array($relative, $allowed, true)) {
                continue;
            }
            if (preg_match($pattern, (string) file_get_contents($file->getPathname()))) {
                $offenders[] = $relative;
            }
        }
        $this->assertSame([], $offenders, 'Use App\\Support\\Authorization\\SafeguardingStaff for staff alert recipients');
    }
}
