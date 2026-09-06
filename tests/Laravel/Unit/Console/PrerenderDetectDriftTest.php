<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Console;

use App\Services\PrerenderService;
use App\Services\SitemapService;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * Tests for the prerender:detect-drift Artisan command.
 *
 * The command:
 *   1. Calls PrerenderService::loadTenantTargets() to get active tenants.
 *   2. Calls PrerenderService::inventory() for mtime data.
 *   3. Fetches sitemap XML via SitemapService::generateForTenant().
 *   4. Does a raw DB::table('prerender_jobs') query to check for active jobs.
 *   5. For stale/missing routes calls PrerenderService::enqueueJob().
 *
 * Because `prerender_jobs` may not exist in the nexus_test schema, we create
 * it inline in setUp() and drop it in tearDown().
 *
 * We bind mocks for PrerenderService and SitemapService to avoid any
 * filesystem / HTTP / headless-renderer calls.
 */
class PrerenderDetectDriftTest extends TestCase
{
    use \Illuminate\Foundation\Testing\DatabaseTransactions;

    /** Unique tenant id scoped to this test file. */
    private const TENANT_ID = 99715;
    private const TENANT_SLUG = 'test-drift-99715';
    private const TENANT_HOST = 'drift-99715.project-nexus.ie';

    private \Mockery\MockInterface $prerenderMock;
    private \Mockery\MockInterface $sitemapMock;

    /** Whether we created prerender_jobs ourselves (so we can drop it). */
    private bool $createdPrerenderJobsTable = false;

    protected function setUp(): void
    {
        parent::setUp();

        Queue::fake();

        // Create prerender_jobs if it doesn't exist in nexus_test.
        $tableExists = (bool) DB::select("SHOW TABLES LIKE 'prerender_jobs'");
        if (!$tableExists) {
            Schema::create('prerender_jobs', function (\Illuminate\Database\Schema\Blueprint $table) {
                $table->bigIncrements('id');
                $table->unsignedBigInteger('requested_by')->nullable();
                $table->unsignedInteger('tenant_id')->nullable();
                $table->string('routes', 2048)->nullable();
                $table->boolean('force_render')->default(false);
                $table->boolean('dry_run')->default(false);
                $table->unsignedTinyInteger('priority')->default(5);
                $table->enum('status', ['queued', 'claimed', 'running', 'succeeded', 'failed', 'partial', 'cancelled'])->default('queued');
                $table->string('claimed_by', 128)->nullable();
                $table->unsignedInteger('planned_count')->nullable();
                $table->unsignedInteger('rendered_count')->nullable();
                $table->unsignedInteger('invalid_count')->nullable();
                $table->unsignedInteger('duration_s')->nullable();
                $table->integer('exit_code')->nullable();
                $table->mediumText('log_excerpt')->nullable();
                $table->string('error_message', 1024)->nullable();
                $table->timestamp('queued_at')->useCurrent();
                $table->timestamp('claimed_at')->nullable();
                $table->timestamp('started_at')->nullable();
                $table->timestamp('finished_at')->nullable();
            });
            $this->createdPrerenderJobsTable = true;
        }

        // Ensure our unique test tenant exists and is active.
        DB::table('tenants')->updateOrInsert(
            ['id' => self::TENANT_ID],
            [
                'name'       => 'Drift Test Tenant 99715',
                'slug'       => self::TENANT_SLUG,
                'domain'     => null,
                'is_active'  => 1,
                'depth'      => 0,
                'allows_subtenants' => 0,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
        // A committed row left by an interrupted local run must not make the
        // command silently skip this test tenant as "active_job_exists".
        DB::table('prerender_jobs')->where('tenant_id', self::TENANT_ID)->delete();
        DB::table('prerender_jobs')->whereNull('tenant_id')->delete();

        \App\Core\TenantContext::setById(self::TENANT_ID);

        // Bind mocks into the container so the command's constructor injection
        // picks them up automatically.
        $this->prerenderMock = Mockery::mock(PrerenderService::class);
        $this->sitemapMock   = Mockery::mock(SitemapService::class);

        // The reconciler now compares inventory with the exact static +
        // dynamic tenant plan so deleted/disabled routes can be purged. Most
        // tests below exercise stale/missing behavior and provide their
        // dynamic routes through the sitemap, so an empty static floor is the
        // neutral default; purge-specific tests override it explicitly.
        $this->prerenderMock
            ->shouldReceive('routesForTenant')
            ->byDefault()
            ->andReturn([]);
        $this->prerenderMock
            ->shouldReceive('purgeUnexpectedSnapshots')
            ->byDefault()
            ->andReturn(['deleted_total' => 0, 'by_tenant' => [], 'dry_run' => false]);
        $this->prerenderMock
            ->shouldReceive('authoritativeRepairRequired')
            ->byDefault()
            ->andReturn(false);
        // The reconciler asks the route plan whether each drifted route can
        // actually be rendered for this tenant before enqueueing it. Neutral
        // default: everything the sitemap publishes is renderable.
        $this->prerenderMock
            ->shouldReceive('tenantRouteCanBePrerendered')
            ->byDefault()
            ->andReturn(true);

        $this->app->instance(PrerenderService::class, $this->prerenderMock);
        $this->app->instance(SitemapService::class,   $this->sitemapMock);
    }

    protected function tearDown(): void
    {
        parent::tearDown(); // rolls back DatabaseTransactions first

        // Drop the table only if we created it (so we don't drop a real table).
        if ($this->createdPrerenderJobsTable) {
            Schema::dropIfExists('prerender_jobs');
            $this->createdPrerenderJobsTable = false;
        }
    }

    // -------------------------------------------------------------------------
    // Helper: build minimal sitemap XML for the test tenant.
    // -------------------------------------------------------------------------

    private function sitemapXml(array $entries): string
    {
        $urls = '';
        foreach ($entries as $path => $lastmod) {
            $loc = 'https://' . self::TENANT_HOST . '/' . self::TENANT_SLUG . $path;
            $urls .= "<url><loc>{$loc}</loc><lastmod>{$lastmod}</lastmod></url>\n";
        }
        return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset>{$urls}</urlset>";
    }

    private function sitemapXmlForHost(string $host, string $prefix, array $entries): string
    {
        $urls = '';
        foreach ($entries as $path => $lastmod) {
            $loc = 'https://' . $host . $prefix . $path;
            $urls .= "<url><loc>{$loc}</loc><lastmod>{$lastmod}</lastmod></url>
";
        }
        return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<urlset>{$urls}</urlset>";
    }

    private function makeTenantTarget(): array
    {
        return [
            'tenant_id' => self::TENANT_ID,
            'slug'      => self::TENANT_SLUG,
            'host'      => self::TENANT_HOST,
            'prefix'    => '/' . self::TENANT_SLUG,
        ];
    }

    // =========================================================================
    // No active tenants → early-exit with "No active tenants." message.
    // =========================================================================

    public function test_exits_success_when_no_active_tenants(): void
    {
        $this->prerenderMock
            ->shouldReceive('loadTenantTargets')
            ->once()
            ->andReturn([]);

        // inventory() and enqueueJob() must never be called.
        $this->prerenderMock->shouldNotReceive('inventory');
        $this->prerenderMock->shouldNotReceive('enqueueJob');

        $this->artisan('prerender:detect-drift')
            ->expectsOutputToContain('No active tenants')
            ->assertExitCode(0);
    }

    public function test_fails_closed_when_snapshot_inventory_is_truncated(): void
    {
        $this->prerenderMock
            ->shouldReceive('loadTenantTargets')
            ->once()
            ->andReturn([$this->makeTenantTarget()]);
        $this->prerenderMock
            ->shouldReceive('inventory')
            ->once()
            ->with(null, false)
            ->andReturn([['__truncated' => true]]);
        $this->sitemapMock->shouldNotReceive('generateForTenant');
        $this->prerenderMock->shouldNotReceive('enqueueJob');

        $this->artisan('prerender:detect-drift')
            ->expectsOutputToContain('drift pass was incomplete')
            ->assertExitCode(1);
    }

    // =========================================================================
    // No stale / missing routes → enqueueJob never called.
    // =========================================================================

    public function test_no_enqueue_when_all_snapshots_are_fresh(): void
    {
        $now = time();
        // Snapshot mtime = now; sitemap lastmod = 5 minutes ago → NOT stale.
        $snapMtime  = $now;
        $lastmodTs  = $now - 300;
        $lastmodStr = date('Y-m-d', $lastmodTs);

        $this->prerenderMock
            ->shouldReceive('loadTenantTargets')
            ->once()
            ->andReturn([$this->makeTenantTarget()]);

        $this->prerenderMock
            ->shouldReceive('inventory')
            ->once()
            ->with(null, false)
            ->andReturn([
                [
                    'host'  => self::TENANT_HOST,
                    'route' => '/' . self::TENANT_SLUG . '/about',
                    'mtime' => $snapMtime,
                ],
            ]);

        $this->sitemapMock
            ->shouldReceive('generateForTenant')
            ->once()
            ->with(self::TENANT_ID, Mockery::type('string'))
            ->andReturnUsing(function () use ($lastmodStr): string {
                $this->assertTrue((bool) config('prerender.runtime_force_fresh_sitemap'));
                return $this->sitemapXml(['/about' => $lastmodStr]);
            });

        $this->prerenderMock->shouldNotReceive('enqueueJob');

        $this->artisan('prerender:detect-drift')
            ->assertExitCode(0);
        $this->assertFalse((bool) config('prerender.runtime_force_fresh_sitemap'));
    }

    // =========================================================================
    // Stale snapshot → enqueueJob called with the stale route.
    // =========================================================================

    public function test_enqueues_job_when_snapshot_is_stale(): void
    {
        $now = time();
        // Snapshot mtime = 2 h ago; sitemap lastmod = 1 h ago → stale (gap > 60s).
        $snapMtime  = $now - 7200;
        $lastmodTs  = $now - 3600;
        $lastmodStr = gmdate('Y-m-d\TH:i:s\Z', $lastmodTs);

        $this->prerenderMock
            ->shouldReceive('loadTenantTargets')
            ->once()
            ->andReturn([$this->makeTenantTarget()]);

        $this->prerenderMock
            ->shouldReceive('inventory')
            ->once()
            ->with(null, false)
            ->andReturn([
                [
                    'host'  => self::TENANT_HOST,
                    'route' => '/' . self::TENANT_SLUG . '/about',
                    'mtime' => $snapMtime,
                ],
            ]);

        $this->sitemapMock
            ->shouldReceive('generateForTenant')
            ->once()
            ->with(self::TENANT_ID, Mockery::type('string'))
            ->andReturn($this->sitemapXml(['/about' => $lastmodStr]));

        $this->prerenderMock
            ->shouldReceive('enqueueJob')
            ->once()
            ->with(
                self::TENANT_ID,
                Mockery::on(fn ($r) => is_string($r) && str_contains($r, '/about')),
                false,
                false,
                null,
                PrerenderService::PRIORITY_HIGH
            )
            ->andReturn(1001);

        $this->artisan('prerender:detect-drift')
            ->assertExitCode(0);
    }

    // =========================================================================
    // Missing snapshot (include-missing=1 default) → enqueueJob called.
    // =========================================================================

    public function test_enqueues_job_for_missing_snapshot_by_default(): void
    {
        $this->prerenderMock
            ->shouldReceive('loadTenantTargets')
            ->once()
            ->andReturn([$this->makeTenantTarget()]);

        // Inventory is empty — no snapshot exists for /events.
        $this->prerenderMock
            ->shouldReceive('inventory')
            ->once()
            ->with(null, false)
            ->andReturn([]);

        $this->sitemapMock
            ->shouldReceive('generateForTenant')
            ->once()
            ->andReturn($this->sitemapXml(['/events' => date('Y-m-d')]));

        $this->prerenderMock
            ->shouldReceive('enqueueJob')
            ->once()
            ->with(
                self::TENANT_ID,
                Mockery::on(fn ($r) => is_string($r) && str_contains($r, '/events')),
                false,
                false,
                null,
                Mockery::type('int')
            )
            ->andReturn(1002);

        $this->artisan('prerender:detect-drift')
            ->assertExitCode(0);
    }

    // =========================================================================
    // --include-missing=0 → missing snapshots are NOT enqueued.
    // =========================================================================

    public function test_does_not_enqueue_missing_when_include_missing_off(): void
    {
        $this->prerenderMock
            ->shouldReceive('loadTenantTargets')
            ->once()
            ->andReturn([$this->makeTenantTarget()]);

        $this->prerenderMock
            ->shouldReceive('inventory')
            ->once()
            ->with(null, false)
            ->andReturn([]);

        $this->sitemapMock
            ->shouldReceive('generateForTenant')
            ->once()
            ->andReturn($this->sitemapXml(['/events' => date('Y-m-d')]));

        // With include-missing=0 and no stale rows, enqueueJob must not be called.
        $this->prerenderMock->shouldNotReceive('enqueueJob');

        $this->artisan('prerender:detect-drift', ['--include-missing' => '0'])
            ->assertExitCode(0);
    }

    // =========================================================================
    // --dry-run → enqueueJob never called; output contains dry_run:true.
    // =========================================================================

    public function test_dry_run_does_not_call_enqueue_job(): void
    {
        $now        = time();
        $snapMtime  = $now - 7200;
        $lastmodStr = gmdate('Y-m-d\TH:i:s\Z', $now - 3600);

        $this->prerenderMock
            ->shouldReceive('loadTenantTargets')
            ->once()
            ->andReturn([$this->makeTenantTarget()]);

        $this->prerenderMock
            ->shouldReceive('inventory')
            ->once()
            ->with(null, false)
            ->andReturn([
                ['host' => self::TENANT_HOST, 'route' => '/' . self::TENANT_SLUG . '/about', 'mtime' => $snapMtime],
            ]);

        $this->sitemapMock
            ->shouldReceive('generateForTenant')
            ->once()
            ->andReturn($this->sitemapXml(['/about' => $lastmodStr]));

        $this->prerenderMock->shouldNotReceive('enqueueJob');

        $this->artisan('prerender:detect-drift', ['--dry-run' => true])
            ->expectsOutputToContain('"dry_run": true')
            ->assertExitCode(0);
    }

    // =========================================================================
    // Sitemap errors fail the reconciliation pass; no enqueueJob.
    // =========================================================================

    public function test_fails_pass_when_sitemap_throws(): void
    {
        $this->prerenderMock
            ->shouldReceive('loadTenantTargets')
            ->once()
            ->andReturn([$this->makeTenantTarget()]);

        $this->prerenderMock
            ->shouldReceive('inventory')
            ->once()
            ->with(null, false)
            ->andReturn([]);

        $this->sitemapMock
            ->shouldReceive('generateForTenant')
            ->once()
            ->andThrow(new \RuntimeException('sitemap generation failed'));

        $this->prerenderMock->shouldNotReceive('enqueueJob');

        $this->artisan('prerender:detect-drift')
            ->expectsOutputToContain('planning_errors')
            ->assertExitCode(1);
    }

    // =========================================================================
    // Tenant with an active job (row in prerender_jobs) is skipped.
    // =========================================================================

    public function test_skips_tenant_with_active_job_in_db(): void
    {
        // Insert a live 'queued' job for our tenant. DatabaseTransactions rolls this back.
        DB::table('prerender_jobs')->insert([
            'tenant_id'  => self::TENANT_ID,
            'status'     => 'queued',
            'priority'   => PrerenderService::PRIORITY_HIGH,
            'queued_at'  => now(),
        ]);

        $this->prerenderMock
            ->shouldReceive('loadTenantTargets')
            ->once()
            ->andReturn([$this->makeTenantTarget()]);

        $this->prerenderMock
            ->shouldReceive('inventory')
            ->once()
            ->with(null, false)
            ->andReturn([]);

        // Sitemap / enqueueJob should not be called because the tenant is skipped.
        $this->sitemapMock->shouldNotReceive('generateForTenant');
        $this->prerenderMock->shouldNotReceive('enqueueJob');

        $this->artisan('prerender:detect-drift')
            ->assertExitCode(0);
    }

    // =========================================================================
    // --max-tenants=0 → no tenants processed, no enqueueJob.
    // =========================================================================

    public function test_tenant_cap_zero_processes_no_tenants(): void
    {
        $this->prerenderMock
            ->shouldReceive('loadTenantTargets')
            ->once()
            ->andReturn([$this->makeTenantTarget()]);

        $this->prerenderMock
            ->shouldReceive('inventory')
            ->once()
            ->with(null, false)
            ->andReturn([]);

        $this->sitemapMock->shouldNotReceive('generateForTenant');
        $this->prerenderMock->shouldNotReceive('enqueueJob');

        $this->artisan('prerender:detect-drift', ['--max-tenants' => '0'])
            ->assertExitCode(0);
    }

    // =========================================================================
    // Output JSON always contains the snapshot_count key (when at least one
    // tenant is active so the JSON block is reached).
    // =========================================================================

    public function test_output_contains_snapshot_count(): void
    {
        $this->prerenderMock
            ->shouldReceive('loadTenantTargets')
            ->once()
            ->andReturn([$this->makeTenantTarget()]);

        $this->prerenderMock
            ->shouldReceive('inventory')
            ->once()
            ->with(null, false)
            ->andReturn([]);

        $this->sitemapMock
            ->shouldReceive('generateForTenant')
            ->once()
            ->andReturn($this->sitemapXml([]));

        $exit = Artisan::call('prerender:detect-drift');
        $output = Artisan::output();
        $this->assertSame(1, $exit, $output);
        $this->assertStringContainsString('snapshot_count', $output);
        $this->assertStringContainsString('sitemap_empty', $output);
    }

    // =========================================================================
    // Custom --priority propagated to enqueueJob.
    // =========================================================================

    public function test_custom_priority_is_passed_to_enqueue_job(): void
    {
        $now        = time();
        $snapMtime  = $now - 7200;
        $lastmodStr = gmdate('Y-m-d\TH:i:s\Z', $now - 3600);

        $this->prerenderMock
            ->shouldReceive('loadTenantTargets')
            ->once()
            ->andReturn([$this->makeTenantTarget()]);

        $this->prerenderMock
            ->shouldReceive('inventory')
            ->once()
            ->with(null, false)
            ->andReturn([
                ['host' => self::TENANT_HOST, 'route' => '/' . self::TENANT_SLUG . '/about', 'mtime' => $snapMtime],
            ]);

        $this->sitemapMock
            ->shouldReceive('generateForTenant')
            ->once()
            ->andReturn($this->sitemapXml(['/about' => $lastmodStr]));

        $this->prerenderMock
            ->shouldReceive('enqueueJob')
            ->once()
            ->withArgs(function (int $tenantId, ?string $routes, bool $force, bool $dryRun, $requestedBy, int $priority): bool {
                // Priority 7 = LOW, passed via --priority=7.
                return $priority === 7;
            })
            ->andReturn(1003);

        $this->artisan('prerender:detect-drift', ['--priority' => '7'])
            ->assertExitCode(0);
    }

    // =========================================================================
    // Multiple stale + missing routes combined into one enqueueJob call.
    // =========================================================================

    public function test_stale_and_missing_routes_merged_into_single_job(): void
    {
        $now        = time();
        $snapMtime  = $now - 7200;
        $lastmodStr = gmdate('Y-m-d\TH:i:s\Z', $now - 3600);

        $this->prerenderMock
            ->shouldReceive('loadTenantTargets')
            ->once()
            ->andReturn([$this->makeTenantTarget()]);

        $this->prerenderMock
            ->shouldReceive('inventory')
            ->once()
            ->with(null, false)
            ->andReturn([
                // /about is stale.
                ['host' => self::TENANT_HOST, 'route' => '/' . self::TENANT_SLUG . '/about', 'mtime' => $snapMtime],
            ]);

        // Sitemap has /about (stale) and /jobs (missing).
        $this->sitemapMock
            ->shouldReceive('generateForTenant')
            ->once()
            ->andReturn($this->sitemapXml([
                '/about' => $lastmodStr,
                '/jobs'  => date('Y-m-d'),
            ]));

        $this->prerenderMock
            ->shouldReceive('enqueueJob')
            ->once()
            ->withArgs(function (int $tenantId, ?string $routes, bool $force, bool $dryRun, $requestedBy, int $priority): bool {
                // Both routes must appear in the comma-separated routes string.
                $parts = explode(',', $routes ?? '');
                return in_array('/about', $parts, true) && in_array('/jobs', $parts, true);
            })
            ->andReturn(1004);

        $this->artisan('prerender:detect-drift')
            ->assertExitCode(0);
    }

    public function test_purges_snapshot_that_is_outside_exact_tenant_plan(): void
    {
        $this->prerenderMock
            ->shouldReceive('loadTenantTargets')
            ->once()
            ->andReturn([$this->makeTenantTarget()]);

        $this->prerenderMock
            ->shouldReceive('inventory')
            ->once()
            ->with(null, false)
            ->andReturn([
                [
                    'host' => self::TENANT_HOST,
                    'route' => '/' . self::TENANT_SLUG . '/deleted-page',
                    'mtime' => time(),
                ],
            ]);

        $this->sitemapMock
            ->shouldReceive('generateForTenant')
            ->once()
            ->andReturn($this->sitemapXml(['/about' => date('Y-m-d')]));

        $this->prerenderMock
            ->shouldReceive('routesForTenant')
            ->once()
            ->with(self::TENANT_ID)
            ->andReturn(['/']);
        $this->prerenderMock->shouldNotReceive('enqueueJob');
        $this->prerenderMock
            ->shouldReceive('invalidateRoutes')
            ->once()
            ->with(self::TENANT_ID, ['/deleted-page'], false)
            ->andReturn(1);

        $this->artisan('prerender:detect-drift', [
            '--include-missing' => '0',
            '--purge-unexpected' => '1',
        ])->assertExitCode(0);
    }

    public function test_purge_unexpected_off_does_not_load_static_plan_or_delete_snapshot(): void
    {
        $this->prerenderMock
            ->shouldReceive('loadTenantTargets')
            ->once()
            ->andReturn([$this->makeTenantTarget()]);
        $this->prerenderMock
            ->shouldReceive('inventory')
            ->once()
            ->with(null, false)
            ->andReturn([
                [
                    'host' => self::TENANT_HOST,
                    'route' => '/' . self::TENANT_SLUG . '/deleted-page',
                    'mtime' => time(),
                ],
            ]);
        $this->sitemapMock
            ->shouldReceive('generateForTenant')
            ->once()
            ->andReturn($this->sitemapXml(['/about' => date('Y-m-d')]));

        $this->prerenderMock->shouldNotReceive('routesForTenant');
        $this->prerenderMock->shouldNotReceive('invalidateRoutes');
        $this->prerenderMock->shouldNotReceive('enqueueJob');

        $this->artisan('prerender:detect-drift', [
            '--include-missing' => '0',
            '--purge-unexpected' => '0',
        ])->assertExitCode(0);
    }

    public function test_orphan_host_triggers_global_unexpected_reconciliation(): void
    {
        $this->prerenderMock
            ->shouldReceive('loadTenantTargets')
            ->once()
            ->andReturn([$this->makeTenantTarget()]);
        $this->prerenderMock
            ->shouldReceive('inventory')
            ->once()
            ->with(null, false)
            ->andReturn([
                ['host' => 'retired-tenant.example', 'route' => '/', 'mtime' => time()],
            ]);
        $this->sitemapMock
            ->shouldReceive('generateForTenant')
            ->once()
            ->andReturn($this->sitemapXml(['/about' => date('Y-m-d')]));
        $this->prerenderMock->shouldNotReceive('enqueueJob');
        $this->prerenderMock
            ->shouldReceive('purgeUnexpectedSnapshots')
            ->once()
            ->with(false)
            ->andReturn(['deleted_total' => 1, 'by_tenant' => ['orphan@retired-tenant.example' => ['/']], 'dry_run' => false]);

        $this->artisan('prerender:detect-drift', ['--include-missing' => '0'])
            ->expectsOutputToContain('"orphan_snapshot_count": 1')
            ->assertExitCode(0);
    }

    public function test_active_authoritative_global_job_suppresses_drift_work(): void
    {
        DB::table('prerender_jobs')->insert([
            'tenant_id' => null,
            'force_render' => 1,
            'dry_run' => 0,
            'priority' => 1,
            'status' => 'running',
            'queued_at' => now(),
            'started_at' => now(),
        ]);

        $this->prerenderMock->shouldNotReceive('loadTenantTargets');
        $this->prerenderMock->shouldNotReceive('inventory');
        $this->sitemapMock->shouldNotReceive('generateForTenant');
        $this->prerenderMock->shouldNotReceive('enqueueJob');

        $this->artisan('prerender:detect-drift')
            ->expectsOutputToContain('authoritative_global_job_exists')
            ->assertExitCode(0);
    }

    // =========================================================================
    // A block that never ends must stop looking like routine success.
    //
    // The guard above is correct — per-tenant recaches piled on top of an
    // authoritative platform rebuild fight the rebuild — but it had no time
    // bound. In production three global jobs sat 'queued' back to back from
    // roughly 2026-08-11 to 2026-09-06 because the host job processor could
    // not claim work. Every two minutes the sweep hit this guard, printed
    // "authoritative_global_job_exists", exited 0, and so refreshed the
    // scheduler-liveness stamp the health endpoint watches. For 28 days the
    // engine looked alive, did nothing, and let 972 snapshots go stale.
    // =========================================================================

    public function test_long_lived_authoritative_global_job_fails_instead_of_reporting_success(): void
    {
        config(['prerender.authoritative_block_alert_seconds' => 1800]);

        DB::table('prerender_jobs')->insert([
            'tenant_id' => null,
            'force_render' => 1,
            'dry_run' => 0,
            'priority' => 1,
            'status' => 'queued',
            // Never claimed, never started — exactly the production shape.
            'queued_at' => date('Y-m-d H:i:s', time() - 7200),
        ]);

        $this->prerenderMock->shouldNotReceive('loadTenantTargets');
        $this->prerenderMock->shouldNotReceive('inventory');
        $this->sitemapMock->shouldNotReceive('generateForTenant');
        $this->prerenderMock->shouldNotReceive('enqueueJob');

        // A non-zero exit stops bootstrap/app.php's onSuccess() callback from
        // stamping prerender:sched:prerender-detect-drift:last_ok_at, so the
        // scheduler-liveness check in PrerenderService::health() goes red on
        // its own after ~6 minutes.
        $exitCode = Artisan::call('prerender:detect-drift');
        $report = $this->decodeReport(Artisan::output());

        $this->assertSame(1, $exitCode);
        $this->assertSame('authoritative_global_job_stuck', $report['skipped']['*']);
        $this->assertTrue($report['authoritative_block']['stale']);
        $this->assertFalse($report['authoritative_block']['progressing']);
        $this->assertGreaterThan(1800, $report['authoritative_block']['age_seconds']);
    }

    public function test_authoritative_global_job_inside_the_threshold_is_still_routine_success(): void
    {
        config(['prerender.authoritative_block_alert_seconds' => 1800]);

        DB::table('prerender_jobs')->insert([
            'tenant_id' => null,
            'force_render' => 1,
            'dry_run' => 0,
            'priority' => 1,
            'status' => 'queued',
            'queued_at' => date('Y-m-d H:i:s', time() - 300),
        ]);

        $exitCode = Artisan::call('prerender:detect-drift');
        $report = $this->decodeReport(Artisan::output());

        $this->assertSame(0, $exitCode);
        $this->assertSame('authoritative_global_job_exists', $report['skipped']['*']);
        $this->assertFalse($report['authoritative_block']['stale']);
    }

    public function test_a_long_authoritative_job_that_is_still_rendering_is_not_reported_as_stuck(): void
    {
        if (!\Illuminate\Support\Facades\Schema::hasColumn('prerender_jobs', 'heartbeat_at')) {
            $this->markTestSkipped('heartbeat_at migration is not applied.');
        }

        config(['prerender.authoritative_block_alert_seconds' => 1800]);

        // Older than the threshold, but the worker renewed its lease seconds
        // ago: this job IS refreshing snapshots, so pausing the drift sweep
        // for it is the guard working as intended, not a silent stop.
        DB::table('prerender_jobs')->insert([
            'tenant_id' => null,
            'force_render' => 1,
            'dry_run' => 0,
            'priority' => 1,
            'status' => 'running',
            'queued_at' => date('Y-m-d H:i:s', time() - 7200),
            'claimed_at' => date('Y-m-d H:i:s', time() - 7100),
            'started_at' => date('Y-m-d H:i:s', time() - 7100),
            'heartbeat_at' => date('Y-m-d H:i:s', time() - 20),
        ]);

        $exitCode = Artisan::call('prerender:detect-drift');
        $report = $this->decodeReport(Artisan::output());

        $this->assertSame(0, $exitCode);
        $this->assertSame('authoritative_global_job_exists', $report['skipped']['*']);
        $this->assertTrue($report['authoritative_block']['progressing']);
        $this->assertFalse($report['authoritative_block']['stale']);
    }

    // =========================================================================
    // A route the tenant's route plan rejects must not abandon the sweep.
    //
    // A tenant's sitemap and PrerenderService's route plan are two separately
    // maintained lists. When they diverge, enqueueJob() throws
    // InvalidArgumentException. That exception used to escape the per-tenant
    // loop, so one tenant missing one route stopped drift detection for every
    // tenant after it — and the sweep runs every 2 minutes, so it failed,
    // restarted, and failed again on the same route indefinitely.
    // =========================================================================

    public function test_route_missing_from_tenant_plan_does_not_abandon_the_sweep(): void
    {
        $secondTenantId   = self::TENANT_ID + 1;
        $secondTenantSlug = self::TENANT_SLUG . '-b';
        $secondTenantHost = 'drift-99716.project-nexus.ie';

        $this->prerenderMock
            ->shouldReceive('loadTenantTargets')
            ->once()
            ->andReturn([
                $this->makeTenantTarget(),
                [
                    'tenant_id' => $secondTenantId,
                    'slug'      => $secondTenantSlug,
                    'host'      => $secondTenantHost,
                    'prefix'    => '/' . $secondTenantSlug,
                ],
            ]);

        // Neither tenant has any snapshot, so every sitemap route is "missing".
        $this->prerenderMock
            ->shouldReceive('inventory')
            ->once()
            ->with(null, false)
            ->andReturn([]);

        $this->sitemapMock
            ->shouldReceive('generateForTenant')
            ->twice()
            ->andReturnUsing(function (int $tenantId) use ($secondTenantHost, $secondTenantSlug): string {
                if ($tenantId === self::TENANT_ID) {
                    return $this->sitemapXml(['/install-app' => date('Y-m-d')]);
                }
                return $this->sitemapXmlForHost(
                    $secondTenantHost,
                    '/' . $secondTenantSlug,
                    ['/about' => date('Y-m-d')]
                );
            });

        // The first tenant's only drifted route is absent from its route plan.
        $this->prerenderMock
            ->shouldReceive('tenantRouteCanBePrerendered')
            ->with(self::TENANT_ID, '/install-app', Mockery::any())
            ->andReturn(false);

        // Mirror the real PrerenderService: enqueueJob() re-validates every
        // token and throws when the route is not in the tenant's plan. Without
        // the filter above, this exception escapes the per-tenant loop and the
        // second tenant is never reached.
        $enqueuedTenants = [];
        $this->prerenderMock
            ->shouldReceive('enqueueJob')
            ->andReturnUsing(function (?int $tenantId, ?string $routes) use (&$enqueuedTenants): int {
                foreach (explode(',', (string) $routes) as $token) {
                    if ($tenantId === self::TENANT_ID && $token === '/install-app') {
                        throw new \InvalidArgumentException(
                            "Route is not available for tenant in enqueueJob: {$token}"
                        );
                    }
                }
                $enqueuedTenants[] = $tenantId;
                return 2002;
            });

        $exitCode = Artisan::call('prerender:detect-drift');
        $report = $this->decodeReport(Artisan::output());

        // The sweep reached the tenant AFTER the one with the bad route.
        $this->assertSame([$secondTenantId], $enqueuedTenants);
        $this->assertArrayHasKey($secondTenantSlug, $report['enqueued']);

        // Reported, not silently swallowed.
        $this->assertStringContainsString(
            'routes_not_in_tenant_plan',
            $report['skipped'][self::TENANT_SLUG] ?? ''
        );
        $this->assertStringContainsString(
            '/install-app',
            $report['skipped'][self::TENANT_SLUG] ?? ''
        );

        // A plan/sitemap divergence is a real contract bug, so the pass
        // completes its work but still reports failure.
        $this->assertSame(1, $report['planning_errors']);
        $this->assertSame(1, $exitCode);
    }

    public function test_unavailable_routes_are_reported_alongside_a_tenants_renderable_ones(): void
    {
        $this->prerenderMock
            ->shouldReceive('loadTenantTargets')
            ->once()
            ->andReturn([$this->makeTenantTarget()]);

        $this->prerenderMock
            ->shouldReceive('inventory')
            ->once()
            ->with(null, false)
            ->andReturn([]);

        $this->sitemapMock
            ->shouldReceive('generateForTenant')
            ->once()
            ->andReturn($this->sitemapXml([
                '/about'       => date('Y-m-d'),
                '/install-app' => date('Y-m-d'),
            ]));

        $this->prerenderMock
            ->shouldReceive('tenantRouteCanBePrerendered')
            ->with(self::TENANT_ID, '/install-app', Mockery::any())
            ->andReturn(false);

        // The renderable route is still enqueued; only the rejected one drops.
        $this->prerenderMock
            ->shouldReceive('enqueueJob')
            ->once()
            ->with(
                self::TENANT_ID,
                Mockery::on(fn ($r) => is_string($r)
                    && str_contains($r, '/about')
                    && !str_contains($r, '/install-app')),
                false,
                false,
                null,
                PrerenderService::PRIORITY_HIGH
            )
            ->andReturn(2003);

        $exitCode = Artisan::call('prerender:detect-drift');
        $report = $this->decodeReport(Artisan::output());

        $tenantReport = $report['enqueued'][self::TENANT_SLUG] ?? null;
        $this->assertNotNull($tenantReport, 'the tenant was not enqueued at all');
        $this->assertSame(1, $tenantReport['unavailable_routes']);
        $this->assertSame(['/install-app'], $tenantReport['unavailable_sample']);
        $this->assertSame(['/about'], $tenantReport['sample']);
        $this->assertSame(1, $report['planning_errors']);
        $this->assertSame(1, $exitCode);
    }

    /**
     * Decode the command's JSON report, tolerating any warning lines printed
     * before it.
     *
     * @return array<string,mixed>
     */
    private function decodeReport(string $output): array
    {
        $start = strpos($output, '{');
        $this->assertNotFalse($start, "command printed no JSON report:
{$output}");
        $decoded = json_decode(substr($output, $start), true);
        $this->assertIsArray($decoded, "command report was not valid JSON:
{$output}");
        return $decoded;
    }
}
