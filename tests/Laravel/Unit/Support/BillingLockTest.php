<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Support;

use App\Services\BillingStandingService;
use App\Support\Billing\BillingLock;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * "Is this community locked for non-payment?" — the one question every caller
 * (the API lock, the bootstrap flag, the mail and push entry points) asks.
 *
 * Tree used throughout: parent → child → grandchild, plus a sibling of child.
 */
final class BillingLockTest extends TestCase
{
    use DatabaseTransactions;

    private int $parent;
    private int $child;
    private int $grandchild;
    private int $sibling;

    protected function setUp(): void
    {
        parent::setUp();

        $this->parent = $this->makeCommunity('Lock parent', 1, '/1/');
        $this->child = $this->makeCommunity('Lock child', $this->parent, "/1/{$this->parent}/");
        $this->grandchild = $this->makeCommunity('Lock grandchild', $this->child, "/1/{$this->parent}/{$this->child}/");
        $this->sibling = $this->makeCommunity('Lock sibling', $this->parent, "/1/{$this->parent}/");

        BillingLock::flush();
    }

    protected function tearDown(): void
    {
        // parent::tearDown() rolls the transaction back. It must run even if
        // the flush throws, or the open transaction keeps its row locks and
        // every later test waits on them.
        try {
            BillingLock::flush();
        } finally {
            parent::tearDown();
        }
    }

    private function makeCommunity(string $name, int $parentId, string $parentPath): int
    {
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => 'lock-' . bin2hex(random_bytes(5)),
            'is_active' => 1,
            'parent_id' => $parentId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $id)->update(['path' => "{$parentPath}{$id}/"]);

        return $id;
    }

    public function test_nobody_suspended_means_nothing_is_locked(): void
    {
        DB::flushQueryLog();
        DB::enableQueryLog();

        $this->assertFalse(BillingLock::isLocked($this->child));
        $this->assertNull(BillingLock::reasonFor($this->child));

        $tenantQueries = array_filter(
            DB::getQueryLog(),
            static fn (array $q): bool => str_contains($q['query'], '`tenants`')
        );
        DB::disableQueryLog();

        $this->assertSame([], array_values($tenantQueries), 'With nobody suspended the community itself must not be read.');
    }

    public function test_a_suspended_community_is_locked(): void
    {
        BillingStandingService::suspend($this->child, null, 'manual', 'unpaid');

        $this->assertTrue(BillingLock::isLocked($this->child));

        $reason = BillingLock::reasonFor($this->child);
        $this->assertNotNull($reason);
        $this->assertSame($this->child, $reason['tenant_id']);
        $this->assertTrue($reason['own']);
        $this->assertSame('manual', $reason['source']);
        $this->assertNotEmpty($reason['suspended_at']);
    }

    public function test_a_suspended_parent_locks_child_and_grandchild(): void
    {
        BillingStandingService::suspend($this->parent, null, 'auto');

        $this->assertTrue(BillingLock::isLocked($this->child));
        $this->assertTrue(BillingLock::isLocked($this->grandchild));

        $reason = BillingLock::reasonFor($this->grandchild);
        $this->assertNotNull($reason);
        $this->assertSame($this->parent, $reason['tenant_id']);
        $this->assertFalse($reason['own']);
        $this->assertSame('auto', $reason['source']);
    }

    public function test_a_suspended_child_does_not_lock_its_parent_or_sibling(): void
    {
        BillingStandingService::suspend($this->child, null, 'manual');

        $this->assertFalse(BillingLock::isLocked($this->parent));
        $this->assertFalse(BillingLock::isLocked($this->sibling));
        $this->assertFalse(BillingLock::isLocked(1));
    }

    public function test_an_exempt_community_stays_open_under_a_suspended_parent(): void
    {
        BillingStandingService::setExempt($this->child, true, 1, 'council contract');
        BillingStandingService::suspend($this->parent, null, 'auto');

        $this->assertFalse(BillingLock::isLocked($this->child));
        $this->assertTrue(BillingLock::isLocked($this->sibling));
    }

    public function test_exemption_shields_everything_below_it(): void
    {
        BillingStandingService::setExempt($this->child, true, 1, 'council contract');
        BillingStandingService::suspend($this->parent, null, 'auto');

        $this->assertFalse(BillingLock::isLocked($this->grandchild));
    }

    public function test_a_community_suspended_below_an_exemption_is_still_locked(): void
    {
        BillingStandingService::setExempt($this->child, true, 1, 'council contract');
        BillingStandingService::suspend($this->grandchild, null, 'manual');

        $this->assertTrue(BillingLock::isLocked($this->grandchild));
        $this->assertFalse(BillingLock::isLocked($this->child));
    }

    public function test_empty_path_falls_back_to_parent_id(): void
    {
        DB::table('tenants')->where('id', $this->grandchild)->update(['path' => null]);
        BillingStandingService::suspend($this->parent, null, 'auto');

        $this->assertSame(
            [$this->grandchild, $this->child, $this->parent, 1],
            BillingLock::lineNearestFirst($this->grandchild)
        );
        $this->assertTrue(BillingLock::isLocked($this->grandchild));
    }

    public function test_a_path_that_does_not_end_at_the_community_is_not_trusted(): void
    {
        // A stale path left behind by a move: it names another line entirely.
        DB::table('tenants')->where('id', $this->grandchild)->update(['path' => "/1/{$this->sibling}/"]);

        $this->assertSame(
            [$this->grandchild, $this->child, $this->parent, 1],
            BillingLock::lineNearestFirst($this->grandchild)
        );
    }

    public function test_a_parent_loop_ends_the_walk(): void
    {
        DB::table('tenants')->where('id', $this->parent)->update(['path' => null, 'parent_id' => $this->child]);
        DB::table('tenants')->where('id', $this->child)->update(['path' => null]);

        $line = BillingLock::lineNearestFirst($this->child);

        $this->assertSame([$this->child, $this->parent], $line);
    }

    public function test_cache_failure_reads_the_database(): void
    {
        BillingStandingService::suspend($this->child, null, 'manual');

        Cache::shouldReceive('get')->andThrow(new \RuntimeException('cache is down'));

        $this->assertTrue(BillingLock::isLocked($this->child));
        $this->assertFalse(BillingLock::isLocked($this->sibling));
    }

    public function test_flush_makes_a_restore_visible_at_once(): void
    {
        BillingStandingService::suspend($this->child, null, 'manual');
        $this->assertTrue(BillingLock::isLocked($this->child));

        // Bypass the service so nothing flushes for us.
        DB::table('tenant_billing_standing')->where('tenant_id', $this->child)->update(['suspended_at' => null]);
        $this->assertTrue(BillingLock::isLocked($this->child), 'The cached list is still in use.');

        BillingLock::flush();
        $this->assertFalse(BillingLock::isLocked($this->child));
    }
}
