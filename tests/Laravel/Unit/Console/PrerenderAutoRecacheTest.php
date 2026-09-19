<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Console;

use App\Services\PrerenderService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * Tests for prerender:auto-recache Artisan command.
 *
 * Uses unique tenant id 99718 for isolation.
 * PrerenderService is mocked — no HTTP/headless renderer is invoked.
 */
class PrerenderAutoRecacheTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 99718;

    /** @var \Mockery\MockInterface&PrerenderService */
    private \Mockery\MockInterface $service;

    protected function setUp(): void
    {
        parent::setUp();

        DB::table('tenants')->insertOrIgnore([
            'id'         => self::TENANT_ID,
            'name'       => 'Test Auto Recache Tenant',
            'slug'       => 'test-auto-recache-' . self::TENANT_ID,
            'is_active'  => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        \App\Core\TenantContext::setById(self::TENANT_ID);

        $this->service = Mockery::mock(PrerenderService::class);
        $this->service
            ->shouldReceive('tenantRouteCanBePrerendered')
            ->byDefault()
            ->andReturn(true);
        $this->app->instance(PrerenderService::class, $this->service);
    }

    // -------------------------------------------------------------------------
    // Empty inventory → no work done
    // -------------------------------------------------------------------------

    public function test_exits_success_when_inventory_is_empty(): void
    {
        $this->service
            ->shouldReceive('inventory')
            ->once()
            ->andReturn([]);

        // loadTenantTargets should NOT be called when inventory is empty.
        $this->service->shouldNotReceive('loadTenantTargets');
        $this->service->shouldNotReceive('enqueueJob');

        $this->artisan('prerender:auto-recache')
            ->assertExitCode(0);
    }

    public function test_fails_closed_when_inventory_is_truncated(): void
    {
        $this->service
            ->shouldReceive('inventory')
            ->once()
            ->andReturn([['__truncated' => true]]);
        $this->service
            ->shouldReceive('loadTenantTargets')
            ->once()
            ->andReturn([[
                'tenant_id' => self::TENANT_ID,
                'host' => 'example.local',
                'prefix' => '/test',
                'slug' => 'test-auto-recache-' . self::TENANT_ID,
            ]]);
        $this->service->shouldNotReceive('enqueueJob');

        $this->artisan('prerender:auto-recache')
            ->expectsOutputToContain('freshness pass was incomplete')
            ->assertExitCode(1);
    }

    // -------------------------------------------------------------------------
    // All rows below min-stale-seconds threshold → no enqueue
    // -------------------------------------------------------------------------

    public function test_exits_success_when_all_rows_are_below_min_stale_threshold(): void
    {
        $slug = 'test-auto-recache-' . self::TENANT_ID;

        // 60-second old snapshot, but min-stale-seconds default is 300.
        $this->service
            ->shouldReceive('inventory')
            ->once()
            ->andReturn([
                [
                    'host'          => 'example.local',
                    'route'         => '/home',
                    'age_s'         => 60,
                    'content_stale' => false,
                ],
            ]);

        $this->service
            ->shouldReceive('loadTenantTargets')
            ->once()
            ->andReturn([['host' => 'example.local', 'slug' => $slug]]);

        $this->service->shouldNotReceive('enqueueJob');

        $this->artisan('prerender:auto-recache')
            ->assertExitCode(0);
    }

    // -------------------------------------------------------------------------
    // Content-stale snapshot above threshold → enqueue
    // -------------------------------------------------------------------------

    public function test_content_stale_snapshot_above_threshold_is_enqueued(): void
    {
        $slug = 'test-auto-recache-' . self::TENANT_ID;

        $this->service
            ->shouldReceive('inventory')
            ->once()
            ->andReturn([
                [
                    'host'          => 'example.local',
                    'route'         => '/listings',
                    'age_s'         => 600,
                    'content_stale' => true,
                ],
            ]);

        $this->service
            ->shouldReceive('loadTenantTargets')
            ->once()
            ->andReturn([['host' => 'example.local', 'slug' => $slug]]);

        $this->service
            ->shouldReceive('enqueueJob')
            ->once()
            ->with(self::TENANT_ID, Mockery::type('string'), false, false, null, PrerenderService::PRIORITY_LOW)
            ->andReturn(123);

        $this->artisan('prerender:auto-recache')
            ->assertExitCode(0);
    }

    // -------------------------------------------------------------------------
    // TTL-stale snapshot → enqueued (via ttlForRoute comparison)
    // -------------------------------------------------------------------------

    public function test_ttl_stale_snapshot_is_enqueued_when_include_ttl_is_set(): void
    {
        $slug = 'test-auto-recache-' . self::TENANT_ID;

        // age_s=7200 (2h), TTL=3600 (1h) → TTL-stale
        $this->service
            ->shouldReceive('inventory')
            ->once()
            ->andReturn([
                [
                    'host'          => 'example.local',
                    'route'         => '/about',
                    'age_s'         => 7200,
                    'content_stale' => false,
                ],
            ]);

        $this->service
            ->shouldReceive('loadTenantTargets')
            ->once()
            ->andReturn([['host' => 'example.local', 'slug' => $slug]]);

        $this->service
            ->shouldReceive('ttlForRoute')
            ->with('/about')
            ->andReturn(3600);

        $this->service
            ->shouldReceive('enqueueJob')
            ->once()
            ->andReturn(77);

        $this->artisan('prerender:auto-recache', ['--include-ttl' => '1', '--include-content' => '0'])
            ->assertExitCode(0);
    }

    // -------------------------------------------------------------------------
    // Dry-run: no enqueue called, exits success
    // -------------------------------------------------------------------------

    public function test_dry_run_prints_plan_without_enqueueing(): void
    {
        $slug = 'test-auto-recache-' . self::TENANT_ID;

        $this->service
            ->shouldReceive('inventory')
            ->once()
            ->andReturn([
                [
                    'host'          => 'example.local',
                    'route'         => '/events',
                    'age_s'         => 900,
                    'content_stale' => true,
                ],
            ]);

        $this->service
            ->shouldReceive('loadTenantTargets')
            ->once()
            ->andReturn([['host' => 'example.local', 'slug' => $slug]]);

        // In dry-run mode enqueueJob must NOT be called.
        $this->service->shouldNotReceive('enqueueJob');

        $this->artisan('prerender:auto-recache', ['--dry-run' => true])
            ->assertExitCode(0);
    }

    // -------------------------------------------------------------------------
    // Unknown host in inventory → snapshot skipped
    // -------------------------------------------------------------------------

    public function test_snapshot_for_unknown_host_is_skipped(): void
    {
        $slug = 'test-auto-recache-' . self::TENANT_ID;

        $this->service
            ->shouldReceive('inventory')
            ->once()
            ->andReturn([
                [
                    'host'          => 'completely-unknown.local',
                    'route'         => '/foo',
                    'age_s'         => 999,
                    'content_stale' => true,
                ],
            ]);

        $this->service
            ->shouldReceive('loadTenantTargets')
            ->once()
            ->andReturn([['host' => 'example.local', 'slug' => $slug]]);

        // Host doesn't match → no job.
        $this->service->shouldNotReceive('enqueueJob');

        $this->artisan('prerender:auto-recache')
            ->assertExitCode(0);
    }

    // -------------------------------------------------------------------------
    // Tenant already has an active job → skipped
    // -------------------------------------------------------------------------

    public function test_tenant_with_active_job_is_skipped(): void
    {
        $slug = 'test-auto-recache-' . self::TENANT_ID;

        $this->service
            ->shouldReceive('inventory')
            ->once()
            ->andReturn([
                [
                    'host'          => 'example.local',
                    'route'         => '/members',
                    'age_s'         => 600,
                    'content_stale' => true,
                ],
            ]);

        $this->service
            ->shouldReceive('loadTenantTargets')
            ->once()
            ->andReturn([['host' => 'example.local', 'slug' => $slug]]);

        // Insert a running prerender job for this tenant so the active-check fires.
        // prerender_jobs has no created_at/updated_at — use real column set.
        DB::table('prerender_jobs')->insert([
            'tenant_id' => self::TENANT_ID,
            'status'    => 'running',
            'queued_at' => now()->toDateTimeString(),
        ]);

        // Because the tenant has a running job, enqueueJob must NOT be called.
        $this->service->shouldNotReceive('enqueueJob');

        $this->artisan('prerender:auto-recache')
            ->assertExitCode(0);
    }

    /**
     * 🔴 Regression: a tenant whose blocking job can never be claimed was
     * skipped here silently and for ever, while the sweep reported success.
     * On production that hid a three-day freeze of the platform master's
     * crawler-served pages: the starved job suppressed the very sweep that
     * would have refreshed them, and nothing anywhere said so. A block older
     * than prerender.tenant_block_alert_seconds is stuck, not busy.
     */
    public function test_a_long_blocked_tenant_is_reported_and_fails_the_sweep(): void
    {
        config(['prerender.tenant_block_alert_seconds' => 7200]);
        $slug = 'test-auto-recache-' . self::TENANT_ID;

        $this->service
            ->shouldReceive('inventory')
            ->once()
            ->andReturn([
                [
                    'host'          => 'example.local',
                    'route'         => '/members',
                    'age_s'         => 600,
                    'content_stale' => true,
                ],
            ]);

        $this->service
            ->shouldReceive('loadTenantTargets')
            ->once()
            ->andReturn([[
                'host'      => 'example.local',
                'slug'      => $slug,
                'prefix'    => '',
                'tenant_id' => self::TENANT_ID,
            ]]);

        // Queued for three days and never claimed — jobs #7125/#7126/#8035.
        DB::table('prerender_jobs')->insert([
            'tenant_id' => self::TENANT_ID,
            'status'    => 'queued',
            'queued_at' => now()->subDays(3)->toDateTimeString(),
        ]);

        $this->service->shouldNotReceive('enqueueJob');

        $this->artisan('prerender:auto-recache')
            ->expectsOutputToContain('has had prerender job')
            ->assertExitCode(1);
    }

    /**
     * The complement: a job that is genuinely in flight must still be skipped
     * quietly. Turning ordinary busy-ness into an alarm would make the alarm
     * worthless, which is how the two-month blank-shell outage stayed unread.
     */
    public function test_a_recently_queued_blocking_job_is_still_skipped_quietly(): void
    {
        config(['prerender.tenant_block_alert_seconds' => 7200]);
        $slug = 'test-auto-recache-' . self::TENANT_ID;

        $this->service
            ->shouldReceive('inventory')
            ->once()
            ->andReturn([
                [
                    'host'          => 'example.local',
                    'route'         => '/members',
                    'age_s'         => 600,
                    'content_stale' => true,
                ],
            ]);

        $this->service
            ->shouldReceive('loadTenantTargets')
            ->once()
            ->andReturn([[
                'host'      => 'example.local',
                'slug'      => $slug,
                'prefix'    => '',
                'tenant_id' => self::TENANT_ID,
            ]]);

        DB::table('prerender_jobs')->insert([
            'tenant_id' => self::TENANT_ID,
            'status'    => 'running',
            'queued_at' => now()->subMinutes(2)->toDateTimeString(),
        ]);

        $this->service->shouldNotReceive('enqueueJob');

        $this->artisan('prerender:auto-recache')
            ->assertExitCode(0);
    }

    // -------------------------------------------------------------------------
    // max-tenants cap respected
    // -------------------------------------------------------------------------

    public function test_max_tenants_cap_limits_enqueue_count(): void
    {
        // Two stale tenants, but max-tenants=1 → only one job created.
        $slugA = 'test-auto-recache-a-' . self::TENANT_ID;
        $slugB = 'test-auto-recache-b-' . self::TENANT_ID;

        // Insert a second tenant for this test.
        DB::table('tenants')->insertOrIgnore([
            'id'         => self::TENANT_ID + 1,
            'name'       => 'Recache Tenant B',
            'slug'       => $slugB,
            'is_active'  => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->service
            ->shouldReceive('inventory')
            ->once()
            ->andReturn([
                ['host' => 'host-a.local', 'route' => '/page', 'age_s' => 600, 'content_stale' => true],
                ['host' => 'host-b.local', 'route' => '/page', 'age_s' => 600, 'content_stale' => true],
            ]);

        $this->service
            ->shouldReceive('loadTenantTargets')
            ->once()
            ->andReturn([
                ['host' => 'host-a.local', 'slug' => $slugA],
                ['host' => 'host-b.local', 'slug' => $slugB],
            ]);

        // Only one tenant should be enqueued.
        $this->service
            ->shouldReceive('enqueueJob')
            ->once()
            ->andReturn(1);

        $this->artisan('prerender:auto-recache', ['--max-tenants' => '1'])
            ->assertExitCode(0);
    }

    public function test_large_route_sets_are_split_below_the_job_payload_limit(): void
    {
        $slug = 'test-auto-recache-' . self::TENANT_ID;
        $inventory = [];
        for ($i = 0; $i < 20; $i++) {
            $inventory[] = [
                'host' => 'example.local',
                'route' => '/page/' . str_repeat(chr(97 + ($i % 26)), 140) . $i,
                'age_s' => 600,
                'content_stale' => true,
            ];
        }

        $this->service->shouldReceive('inventory')->once()->andReturn($inventory);
        $this->service->shouldReceive('loadTenantTargets')->once()->andReturn([[
            'tenant_id' => self::TENANT_ID,
            'host' => 'example.local',
            'prefix' => '',
            'slug' => $slug,
        ]]);
        $this->service
            ->shouldReceive('enqueueJob')
            ->twice()
            ->withArgs(fn (int $tenantId, ?string $routes, ...$rest) =>
                $tenantId === self::TENANT_ID
                && is_string($routes)
                && strlen($routes) <= 1900
            )
            ->andReturn(100, 101);

        $this->artisan('prerender:auto-recache')
            ->assertExitCode(0);
    }
}
