<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Social\Appreciations;

use App\Models\User;
use App\Services\Social\AppreciationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

/**
 * SOC14 — Top recipients ordered by count within the period window. Only notes
 * their receiver has shown on their profile are counted.
 */
class MostAppreciatedLeaderboardTest extends TestCase
{
    use DatabaseTransactions;

    public function test_leaderboard_orders_by_received_count(): void
    {
        $this->markTestSkipped(
            'Quarantine [isolation-debt]: order-dependent — passes in full-suite run order, fails when run in a sharded subset under CI. Re-enable after fixing test isolation. Tracked in PR #130.'
        );

        if (!Schema::hasTable('appreciations')) {
            $this->markTestSkipped('appreciations schema not present.');
        }
        Cache::flush();
        $svc = new AppreciationService();

        $top = User::factory()->forTenant($this->testTenantId)->create();
        $mid = User::factory()->forTenant($this->testTenantId)->create();
        $low = User::factory()->forTenant($this->testTenantId)->create();

        // 3 senders thank top, 2 thank mid, 1 thanks low
        for ($i = 0; $i < 3; $i++) {
            $s = User::factory()->forTenant($this->testTenantId)->create();
            $svc->setVisibility($svc->send($s->id, $top->id, "t{$i}", 'general')->id, $top->id, true);
        }
        for ($i = 0; $i < 2; $i++) {
            $s = User::factory()->forTenant($this->testTenantId)->create();
            $svc->setVisibility($svc->send($s->id, $mid->id, "m{$i}", 'general')->id, $mid->id, true);
        }
        $s = User::factory()->forTenant($this->testTenantId)->create();
        $svc->setVisibility($svc->send($s->id, $low->id, 'l0', 'general')->id, $low->id, true);

        $rows = $svc->getMostAppreciatedMembers(null, 'last_30d', 10);
        $this->assertNotEmpty($rows);

        $byUser = [];
        foreach ($rows as $r) {
            $byUser[$r['user_id']] = $r['count'];
        }

        $this->assertArrayHasKey($top->id, $byUser);
        $this->assertSame(3, $byUser[$top->id]);
        $this->assertSame(2, $byUser[$mid->id]);
        $this->assertSame(1, $byUser[$low->id]);

        // Order check: top should appear first
        $this->assertSame($top->id, $rows[0]['user_id']);
    }
}
