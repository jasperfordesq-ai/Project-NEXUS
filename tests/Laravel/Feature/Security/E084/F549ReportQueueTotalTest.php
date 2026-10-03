<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E084;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-549 (E-084) — residual of F-454.
 *
 * F-454 withholds from a broker's report queue every report they are a party
 * to (a complaint about them, or about their content). The fix removed those
 * rows from the page being returned and reduced `meta.total` by the number
 * removed FROM THAT PAGE only. Withheld reports on any other page stayed in
 * the total, so the queue said "N reports" where the broker could only ever
 * reach fewer — and the difference is the number of complaints about them.
 *
 * The broker dashboard's new "open reports" tile counts the same queue, so the
 * total must be the number the broker can actually reach, on every page.
 */
final class F549ReportQueueTotalTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
        $this->app['auth']->forgetGuards();
        Cache::flush();
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
    }

    public function test_the_queue_total_counts_only_reports_the_broker_can_reach_on_every_page(): void
    {
        $broker = $this->staff('broker');
        $reporter = $this->staff('member');
        $other = $this->staff('member');

        // A complaint about the broker, OLDER, so it falls on a later page...
        $this->report($reporter->id, $broker->id, now()->subDays(2));
        // ...and one about someone else, newer, on page 1.
        $this->report($reporter->id, $other->id, now()->subDay());

        Sanctum::actingAs($broker, ['*']);

        $reachable = [];
        $totals = [];
        for ($page = 1; $page <= 200; $page++) {
            $res = $this->apiGet("/v2/admin/reports?status=pending&limit=1&page={$page}")->assertOk();
            $totals[] = $res->json('meta.total');
            $rows = $res->json('data') ?? [];
            if ($rows === []) {
                break;
            }
            foreach ($rows as $row) {
                $reachable[] = (int) $row['id'];
            }
        }

        foreach ($totals as $i => $total) {
            self::assertSame(count($reachable), $total,
                'page ' . ($i + 1) . ' reports a total the broker cannot reach; the gap reveals reports withheld because they are about the broker');
        }
    }

    /**
     * The same page's count boxes come from /reports/stats, which counted every
     * report in the community — so "Pending" minus the rows a broker could
     * reach was, again, the number of complaints about them, on one page load.
     */
    public function test_the_queue_count_boxes_count_only_reports_the_broker_can_reach(): void
    {
        $broker = $this->staff('broker');
        $reporter = $this->staff('member');
        $other = $this->staff('member');

        $this->report($reporter->id, $broker->id, now()->subDays(2));
        $this->report($reporter->id, $other->id, now()->subDay());

        Sanctum::actingAs($broker, ['*']);

        $pendingListed = (int) $this->apiGet('/v2/admin/reports?status=pending&limit=100')->assertOk()->json('meta.total');
        $allListed = (int) $this->apiGet('/v2/admin/reports?limit=100')->assertOk()->json('meta.total');
        $stats = $this->apiGet('/v2/admin/reports/stats')->assertOk()->json('data');

        self::assertSame($pendingListed, $stats['pending'], 'the Pending box must count only reports the broker can reach');
        self::assertSame($allListed, $stats['total'], 'the Total box must count only reports the broker can reach');
    }

    /** CONTROL — an administrator is not a party-filtered viewer; every report counts. */
    public function test_control_an_admin_total_still_counts_every_report(): void
    {
        $admin = $this->staff('admin');
        $reporter = $this->staff('member');
        $other = $this->staff('member');

        $before = $this->asAdminTotal($admin);
        $this->report($reporter->id, $admin->id, now()->subDays(2));
        $this->report($reporter->id, $other->id, now()->subDay());

        self::assertSame($before + 2, $this->asAdminTotal($admin));
    }

    private function asAdminTotal(User $admin): int
    {
        Sanctum::actingAs($admin, ['*']);

        return (int) $this->apiGet('/v2/admin/reports?status=pending&limit=1')->assertOk()->json('meta.total');
    }

    private function staff(string $role): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        DB::table('users')->where('id', $u->id)->update([
            'role' => $role,
            'is_admin' => $role === 'admin' ? 1 : 0,
        ]);

        return User::find($u->id);
    }

    private function report(int $reporterId, int $subjectId, \DateTimeInterface $at): int
    {
        return (int) DB::table('reports')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'reporter_id' => $reporterId,
            'target_type' => 'user',
            'target_id' => $subjectId,
            'reason' => 'F549 fixture',
            'status' => 'open',
            'created_at' => $at,
            'updated_at' => $at,
        ]);
    }
}
