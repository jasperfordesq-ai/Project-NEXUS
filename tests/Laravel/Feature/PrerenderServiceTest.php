<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature;

use App\Console\Commands\PrerenderProcessQueue;
use App\Models\User;
use App\Services\PrerenderService;
use App\Services\SitemapService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

/**
 * Unit-level coverage for PrerenderService and the artisan command's parsing
 * helpers. Uses a per-test temp directory as the snapshot cache so we don't
 * depend on the production volume.
 */
class PrerenderServiceTest extends TestCase
{
    use DatabaseTransactions;

    private ?string $tmpCache = null;

    protected function setUp(): void
    {
        parent::setUp();
        // Several tests assert the exact FIFO/priority order of freshly enqueued
        // jobs (claimNextJob returns the oldest eligible row). A stray queued row
        // committed by an earlier non-transactional run would always be claimed
        // first and break those assertions. Clear the table so each test starts
        // from a known-empty queue. The delete runs inside the DatabaseTransactions
        // wrapper, so it rolls back after the test and never mutates CI long-term.
        DB::table('prerender_jobs')->delete();
        $this->tmpCache = sys_get_temp_dir() . '/nexus-prerender-test-' . uniqid();
        mkdir($this->tmpCache, 0777, true);
        putenv('PRERENDER_CACHE_PATH=' . $this->tmpCache);
        putenv('PRERENDER_EVENT_LOG=' . $this->tmpCache . '/events.jsonl');
        putenv('PRERENDER_ASSETS_MANIFEST=' . $this->tmpCache . '/.assets-manifest.json');
    }

    protected function tearDown(): void
    {
        if ($this->tmpCache !== null) {
            $this->rrmdir($this->tmpCache);
        }
        putenv('PRERENDER_CACHE_PATH');
        putenv('PRERENDER_EVENT_LOG');
        putenv('PRERENDER_ASSETS_MANIFEST');
        parent::tearDown();
    }

    public function test_inventory_returns_empty_when_cache_empty(): void
    {
        $service = new PrerenderService();
        $this->assertSame([], $service->inventory(null, true));
    }

    public function test_static_route_floor_excludes_authenticated_feature_routes(): void
    {
        $service = new PrerenderService();
        $regular = (object) [
            'slug' => 'another-community',
            'features' => json_encode([
                'blog' => true,
                'marketplace' => true,
                'courses' => true,
                'podcasts' => true,
            ]),
            'configuration' => json_encode(['modules' => []]),
        ];
        $routes = $service->routesForTenant($regular);

        $this->assertNotContains('/marketplace', $routes);
        $this->assertNotContains('/courses', $routes);
        $this->assertNotContains('/podcasts', $routes);
        $this->assertNotContains('/marketplace/map', $routes);
        $this->assertNotContains('/development-status', $routes);
        $this->assertNotContains('/impact-report', $routes);
        $this->assertContains('/blog', $routes);
        $this->assertFalse(PrerenderService::routeRequiresAuthentication('/blog'));
        $this->assertFalse(PrerenderService::routeRequiresAuthentication('/blog/public-post'));

        $hourRoutes = $service->routesForTenant((object) [
            'slug' => 'hour-timebank',
            'features' => '{}',
            'configuration' => '{}',
        ]);
        $this->assertContains('/partner', $hourRoutes);
        $this->assertContains('/social-prescribing', $hourRoutes);
        $this->assertContains('/impact-summary', $hourRoutes);
        $this->assertContains('/impact-report', $hourRoutes);
        $this->assertContains('/strategic-plan', $hourRoutes);

        foreach (['explore', 'listings', 'events', 'groups', 'jobs', 'volunteering', 'organisations', 'ideation', 'resources', 'kb', 'marketplace', 'courses', 'podcasts'] as $prefix) {
            $this->assertTrue(PrerenderService::routeRequiresAuthentication("/{$prefix}"));
            $this->assertNotContains("/{$prefix}", $routes);
        }
    }

    public function test_inventory_lists_snapshot_with_age_staleness(): void
    {
        $this->writeSnapshot('example.com/about/index.html', '<html><body><h1>Hi</h1></body></html>');
        $service = new PrerenderService();
        $rows = $service->inventory(null, true);
        $this->assertCount(1, $rows);
        $this->assertSame('example.com', $rows[0]['host']);
        $this->assertSame('/about', $rows[0]['route']);
        $this->assertSame('fresh', $rows[0]['age_staleness']);
    }

    public function test_inspect_extracts_structured_seo_data(): void
    {
        $html = <<<'HTML'
<!doctype html><html><head>
<title>Page Title</title>
<meta name="description" content="A description">
<link rel="canonical" href="https://example.com/about">
<meta property="og:title" content="OG">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage"}</script>
</head><body><h1>Headline</h1></body></html>
HTML;
        $this->writeSnapshot('example.com/about/index.html', $html);
        $service = new PrerenderService();
        $result = $service->inspect('example.com/about/index.html');

        $this->assertNotNull($result);
        $this->assertSame('Page Title', $result['title']);
        $this->assertSame('A description', $result['meta_description']);
        $this->assertSame('https://example.com/about', $result['canonical']);
        $this->assertSame('OG', $result['og_tags']['og:title']);
        $this->assertTrue($result['flags']['has_jsonld']);
        $this->assertTrue($result['flags']['jsonld_valid']);
        $this->assertSame(['WebPage'], $result['json_ld']['blocks'][0]['types']);
        $this->assertFalse($result['flags']['multiple_h1']);
    }

    public function test_inspect_flags_invalid_json_ld(): void
    {
        $html = '<html><head><script type="application/ld+json">{not json}</script></head><body></body></html>';
        $this->writeSnapshot('example.com/bad/index.html', $html);
        $service = new PrerenderService();
        $result = $service->inspect('example.com/bad/index.html');
        $this->assertFalse($result['flags']['jsonld_valid']);
    }

    public function test_inspect_rejects_path_traversal(): void
    {
        $this->writeSnapshot('a/index.html', '<html></html>');
        $service = new PrerenderService();
        $this->assertNull($service->inspect('../etc/passwd'));
        $this->assertNull($service->inspect('a/../b/index.html'));
        $this->assertNull($service->inspect('a/index.txt'));
    }

    public function test_inventory_detects_dead_asset_refs(): void
    {
        // Manifest declares only one valid asset
        file_put_contents(
            $this->tmpCache . '/.assets-manifest.json',
            json_encode(['/assets/index-VALID.js'])
        );
        $html = '<html><head><script src="/assets/index-DEAD.js"></script></head></html>';
        $this->writeSnapshot('example.com/index.html', $html);

        $service = new PrerenderService();
        $rows = $service->inventory(null, true);
        $this->assertCount(1, $rows);
        $this->assertContains('/assets/index-DEAD.js', $rows[0]['asset_issues']);
        $this->assertSame('stale', $rows[0]['staleness']); // asset issues bump to stale
    }

    public function test_claim_next_job_is_atomic(): void
    {
        $service = new PrerenderService();
        $id1 = $service->enqueueJob(null, '/about', false, false, null);
        $id2 = $service->enqueueJob(null, '/faq', false, false, null);

        $first = $service->claimNextJob('worker-1');
        $this->assertNotNull($first);
        $this->assertSame($id1, (int) $first['id']);
        $this->assertSame('claimed', DB::table('prerender_jobs')->where('id', $id1)->value('status'));

        $second = $service->claimNextJob('worker-2');
        $this->assertNotNull($second);
        $this->assertSame($id2, (int) $second['id']);

        $third = $service->claimNextJob('worker-3');
        $this->assertNull($third);
    }

    public function test_enqueue_dedupes_identical_queued_jobs(): void
    {
        $service = new PrerenderService();
        $a = $service->enqueueJob(null, '/about', true, false, 1);
        $b = $service->enqueueJob(null, '/about', true, false, 1);
        $this->assertSame($a, $b);
    }

    public function test_authoritative_reset_cancels_older_work_and_enqueues_one_fresh_global_job(): void
    {
        $this->mock(SitemapService::class, function ($mock): void {
            $mock->shouldReceive('clearCache')->once();
            $mock->shouldReceive('generateForTenant')
                ->atLeast()->once()
                ->andReturnUsing(static function (int $tenantId, ?string $baseUrl = null): string {
                    unset($tenantId);
                    $base = rtrim((string) $baseUrl, '/');
                    return '<urlset><url><loc>'
                        . htmlspecialchars($base . '/', ENT_XML1 | ENT_QUOTES, 'UTF-8')
                        . '</loc></url></urlset>';
                });
        });

        $service = new PrerenderService();
        $queuedId = $service->enqueueJob(null, '/about', false, false, null);
        $activeId = $service->enqueueJob(null, '/faq', false, false, null);
        DB::table('prerender_jobs')->where('id', $activeId)->update([
            'status' => 'running',
            'claimed_at' => now(),
            'started_at' => now(),
            'claimed_by' => 'old-worker-token',
        ]);

        // Add a real caller transaction inside the test harness wrapper. The
        // testing transaction manager otherwise executes afterCommit callbacks
        // immediately when only its own isolation transaction is open.
        $result = DB::transaction(function () use ($service, $queuedId, $activeId): array {
            $result = $service->resetAllSnapshots(
                1,
                '203.0.113.19',
                'Prerender reset integration test'
            );

            $this->assertSame(2, $result['cancelled_jobs']);
            $this->assertSame(1, $result['cancelled_active_jobs']);
            $this->assertGreaterThan(0, $result['tenant_count']);
            $this->assertGreaterThanOrEqual($result['tenant_count'], $result['planned_routes']);
            $this->assertSame('queued', DB::table('prerender_jobs')->where('id', $queuedId)->value('status'));
            $this->assertSame('running', DB::table('prerender_jobs')->where('id', $activeId)->value('status'));
            $this->assertSame(
                'failed',
                DB::table('prerender_jobs')->where('id', $result['job_id'])->value('status'),
                'Old blue/green workers must see a non-claimable storage status until commit'
            );
            $this->assertSame('pending', DB::table('prerender_jobs')->where('id', $result['job_id'])->value('fence_state'));
            $this->assertSame('pending_fence', $service->getJob($result['job_id'])['status']);
            $this->assertFileDoesNotExist($this->tmpCache . '/.publish-epoch');

            return $result;
        });

        $this->assertSame('cancelled', DB::table('prerender_jobs')->where('id', $queuedId)->value('status'));
        $this->assertSame('cancelled', DB::table('prerender_jobs')->where('id', $activeId)->value('status'));

        $fresh = DB::table('prerender_jobs')->where('id', $result['job_id'])->first();
        $this->assertNotNull($fresh);
        $this->assertSame('queued', $fresh->status);
        $this->assertSame('activated', $fresh->fence_state);
        $this->assertNotNull($fresh->fence_ready_at);
        $this->assertNull($fresh->tenant_id);
        $this->assertNull($fresh->routes);
        $this->assertSame(1, (int) $fresh->force_render);
        $this->assertSame(PrerenderService::PRIORITY_HIGH, (int) $fresh->priority);
        $this->assertFileExists($this->tmpCache . '/.publish-epoch');
        $this->assertTrue($service->getJob((int) $result['job_id'])['authoritative_reset']);
        $audit = DB::table('prerender_audit_log')
            ->where('action', 'reset_all')
            ->where('job_id', $result['job_id'])
            ->first();
        $this->assertNotNull($audit);
        $this->assertSame('ok', $audit->outcome);
        $this->assertSame('203.0.113.19', $audit->ip);
        $this->assertSame('Prerender reset integration test', $audit->user_agent);
        $auditDetails = json_decode((string) $audit->details, true);
        $this->assertSame($result['job_id'], $auditDetails['job_id'] ?? null);
        $this->assertSame($result['planned_routes'], $auditDetails['planned_routes'] ?? null);
        $this->assertFalse(
            $service->cancelJob((int) $result['job_id']),
            'An activated authoritative replacement must not be cancellable after it supersedes older work'
        );

        $activatedEpoch = file_get_contents($this->tmpCache . '/.publish-epoch');
        $claimed = $service->claimNextJob('worker-after-activation');
        $this->assertNotNull($claimed);
        $this->assertSame((int) $result['job_id'], (int) $claimed['id']);
        $this->assertSame(
            $activatedEpoch,
            file_get_contents($this->tmpCache . '/.publish-epoch'),
            'Retrying queue claim after activation must not rotate the epoch twice'
        );
    }

    public function test_reset_all_rolls_back_new_intent_when_required_success_audit_fails(): void
    {
        $this->mock(SitemapService::class, function ($mock): void {
            $mock->shouldReceive('clearCache')->never();
            $mock->shouldReceive('generateForTenant')
                ->atLeast()->once()
                ->andReturnUsing(static function (int $tenantId, ?string $baseUrl = null): string {
                    unset($tenantId);
                    $base = rtrim((string) $baseUrl, '/');
                    return '<urlset><url><loc>'
                        . htmlspecialchars($base . '/', ENT_XML1 | ENT_QUOTES, 'UTF-8')
                        . '</loc></url></urlset>';
                });
        });

        $service = new class extends PrerenderService {
            protected function insertAuditRow(array $row): void
            {
                throw new \RuntimeException('simulated prerender audit storage outage');
            }
        };
        $oldJobId = $service->enqueueJob(null, '/about', false, false, null);
        $jobCountBefore = DB::table('prerender_jobs')->count();
        $auditCountBefore = DB::table('prerender_audit_log')->count();

        try {
            $service->resetAllSnapshots(1, '203.0.113.20', 'Audit outage test');
            $this->fail('The required success audit failure must abort reset-all');
        } catch (\RuntimeException $e) {
            $this->assertSame('simulated prerender audit storage outage', $e->getMessage());
        }

        $this->assertSame($jobCountBefore, DB::table('prerender_jobs')->count());
        $this->assertSame('queued', DB::table('prerender_jobs')->where('id', $oldJobId)->value('status'));
        $this->assertSame($auditCountBefore, DB::table('prerender_audit_log')->count());
        $this->assertFalse(
            DB::table('prerender_jobs')
                ->where('fence_state', 'pending')
                ->whereNull('fence_ready_at')
                ->exists()
        );
        $this->assertFileDoesNotExist($this->tmpCache . '/.publish-epoch');

        // Existing callers retain non-blocking audit semantics.
        $service->audit('ordinary_best_effort_action', 1, null, null, 'ok');
        $this->assertSame($auditCountBefore, DB::table('prerender_audit_log')->count());
    }

    public function test_pending_authoritative_intent_does_not_mutate_filesystem_or_old_jobs_inside_outer_transaction(): void
    {
        $service = new PrerenderService();
        $oldId = $service->enqueueJob(null, '/about', false, false, null);

        $intent = null;
        try {
            DB::transaction(function () use ($service, $oldId, &$intent): void {
                $intent = $service->enqueueAuthoritativeRebuildIntent(1);
                $reusedIntent = $service->enqueueAuthoritativeRebuildIntent(1);

                $this->assertSame('queued', DB::table('prerender_jobs')->where('id', $oldId)->value('status'));
                $this->assertSame($intent['job_id'], $reusedIntent['job_id']);
                $this->assertSame(1, $reusedIntent['cancelled_jobs']);
                $this->assertSame(
                    'pending',
                    DB::table('prerender_jobs')->where('id', $intent['job_id'])->value('fence_state')
                );
                $this->assertSame(
                    'pending_fence',
                    $service->getJob($intent['job_id'])['status']
                );
                $this->assertSame(
                    'failed',
                    DB::table('prerender_jobs')->where('id', $intent['job_id'])->value('status')
                );
                $this->assertNull(
                    DB::table('prerender_jobs')->where('id', $intent['job_id'])->value('fence_ready_at')
                );
                $this->assertArrayHasKey('fence_ready_at', $service->getJob($intent['job_id']));
                $this->assertFileDoesNotExist($this->tmpCache . '/.publish-epoch');

                // A same-connection claim attempt must not accidentally execute
                // the pending outbox while this transaction can still roll back.
                $claimed = $service->claimNextJob('worker-before-commit');
                $this->assertNotNull($claimed);
                $this->assertSame($oldId, (int) $claimed['id']);
                $this->assertSame(
                    'pending_fence',
                    $service->getJob($intent['job_id'])['status']
                );
                $this->assertFileDoesNotExist($this->tmpCache . '/.publish-epoch');

                throw new \RuntimeException('rollback pending fence probe');
            });
            $this->fail('The rollback probe should throw');
        } catch (\RuntimeException $e) {
            $this->assertSame('rollback pending fence probe', $e->getMessage());
        }

        $this->assertIsArray($intent);
        $this->assertFalse(DB::table('prerender_jobs')->where('id', $intent['job_id'])->exists());
        $this->assertSame('queued', DB::table('prerender_jobs')->where('id', $oldId)->value('status'));
        $this->assertFileDoesNotExist($this->tmpCache . '/.publish-epoch');
    }

    public function test_contended_after_commit_activation_returns_quickly_and_remains_recoverable(): void
    {
        $service = new PrerenderService();
        $lock = fopen($this->tmpCache . '/.mutation.lock', 'c+');
        $this->assertIsResource($lock);
        $this->assertTrue(flock($lock, LOCK_EX | LOCK_NB));
        $intent = null;

        try {
            $started = microtime(true);
            $intent = $service->enqueueAuthoritativeRebuildIntent(1);
            $elapsed = microtime(true) - $started;

            $this->assertLessThan(2.0, $elapsed, 'The API path must not wait for a long-running publisher');
            $this->assertSame('pending_fence', $service->getJob($intent['job_id'])['status']);
            $this->assertTrue($service->getJob($intent['job_id'])['authoritative_reset']);
            $this->assertSame($intent['job_id'], $service->listJobs(10, 'pending_fence')[0]['id']);
            $this->assertSame([], $service->listJobs(10, 'failed'));
            $this->assertStringContainsString(
                'publisher fence activation deferred',
                (string) DB::table('prerender_jobs')->where('id', $intent['job_id'])->value('error_message')
            );
            $this->assertFileDoesNotExist($this->tmpCache . '/.publish-epoch');
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }

        $this->assertIsArray($intent);
        $activate = new \ReflectionMethod($service, 'activatePendingAuthoritativeJob');
        $this->assertTrue($activate->invoke($service, $intent['job_id'], 1.0));
        $this->assertSame('queued', $service->getJob($intent['job_id'])['status']);
        $this->assertFileExists($this->tmpCache . '/.publish-epoch');
    }

    public function test_pending_fence_recovery_precedes_a_tripped_breaker(): void
    {
        // This path must run at transaction level zero, as the host processor
        // does. Temporarily end the test wrapper transaction, then restore it
        // after removing the committed probe row.
        DB::commit();
        $jobId = 0;
        try {
            $jobId = (int) DB::table('prerender_jobs')->insertGetId([
                'requested_by' => null,
                'tenant_id' => null,
                'routes' => null,
                'force_render' => 1,
                'dry_run' => 0,
                'priority' => PrerenderService::PRIORITY_HIGH,
                'status' => 'failed',
                'queued_at' => now(),
                'fence_state' => 'pending',
                'fence_ready_at' => null,
                'error_message' => 'pending publisher fence activation',
            ]);

            $service = new PrerenderService();
            $service->tripBreaker(900);
            $claimed = $service->claimNextJob('breaker-recovery-worker');

            $this->assertNotNull($claimed);
            $this->assertSame($jobId, (int) $claimed['id']);
            $this->assertNull($service->breakerTrippedUntil());
            $this->assertFileExists($this->tmpCache . '/.publish-epoch');
        } finally {
            \Illuminate\Support\Facades\Cache::forget(PrerenderService::BREAKER_CACHE_KEY);
            if ($jobId > 0) DB::table('prerender_jobs')->where('id', $jobId)->delete();
            DB::beginTransaction();
        }
    }

    public function test_rolling_deploy_insert_without_fence_timestamp_remains_claimable(): void
    {
        $legacyId = (int) DB::table('prerender_jobs')->insertGetId([
            'requested_by' => null,
            'tenant_id' => null,
            'routes' => '/about',
            'force_render' => 0,
            'dry_run' => 0,
            'priority' => PrerenderService::PRIORITY_NORMAL,
            'status' => 'queued',
            'queued_at' => now(),
            // Deliberately omit fence_ready_at, as an old blue/green writer does.
        ]);

        $this->assertNotNull(
            DB::table('prerender_jobs')->where('id', $legacyId)->value('fence_ready_at')
        );
        $this->assertSame(
            'ready',
            DB::table('prerender_jobs')->where('id', $legacyId)->value('fence_state')
        );
        $claimed = (new PrerenderService())->claimNextJob('legacy-compatible-worker');
        $this->assertNotNull($claimed);
        $this->assertSame($legacyId, (int) $claimed['id']);
    }

    public function test_finalise_job_records_counters_and_status(): void
    {
        $service = new PrerenderService();
        $id = $service->enqueueJob(null, null, true, false, 1);
        $service->claimNextJob('w');
        $service->markRunning($id, 'w');
        $this->assertTrue($service->finaliseJob(
            $id, 'succeeded', 10, 9, 1, 0, 42, 'log tail here', null, 'w'
        ));

        $row = DB::table('prerender_jobs')->where('id', $id)->first();
        $this->assertSame('succeeded', $row->status);
        $this->assertSame(10, (int) $row->planned_count);
        $this->assertSame(9, (int) $row->rendered_count);
        $this->assertSame(1, (int) $row->invalid_count);
        $this->assertSame(0, (int) $row->exit_code);
        $this->assertSame(42, (int) $row->duration_s);
        $this->assertSame('log tail here', $row->log_excerpt);
    }

    public function test_parse_counters_extracts_from_real_log(): void
    {
        $log = "[INFO] Planning cache refresh...\n"
             . "[INFO] Planned 27 page(s) to refresh out of 35 candidate page(s)\n"
             . "[OK]   13 pre-rendered page(s) published as complete host-tree generation(s) in nexus-react-prod\n"
             . "[WARN] 2 rendered page(s) reference assets outside the active manifest\n";
        [$planned, $rendered, $invalid] = PrerenderProcessQueue::parseCounters($log);
        $this->assertSame(27, $planned);
        $this->assertSame(13, $rendered);
        $this->assertNull($invalid);
    }

    public function test_prometheus_metrics_emit_required_series(): void
    {
        $service = new PrerenderService();
        $service->enqueueJob(null, null, true, false, 1);
        $body = $service->prometheusMetrics();

        $this->assertStringContainsString('# TYPE nexus_prerender_snapshots_total gauge', $body);
        $this->assertStringContainsString('# TYPE nexus_prerender_jobs_total gauge', $body);
        $this->assertStringContainsString('nexus_prerender_job_fence_available 1', $body);
        $this->assertStringContainsString('nexus_prerender_jobs_total{status="pending_fence"} 0', $body);
        $this->assertMatchesRegularExpression('/nexus_prerender_jobs_total\{status="queued"\} 1/', $body);
        $this->assertStringContainsString('nexus_prerender_coverage_ratio', $body);
    }

    public function test_tail_events_returns_newest_first(): void
    {
        $log = $this->tmpCache . '/events.jsonl';
        file_put_contents($log, json_encode(['ts' => '1', 'event' => 'a']) . "\n");
        file_put_contents($log, json_encode(['ts' => '2', 'event' => 'b']) . "\n", FILE_APPEND);
        file_put_contents($log, json_encode(['ts' => '3', 'event' => 'c']) . "\n", FILE_APPEND);

        $service = new PrerenderService();
        $events = $service->tailEvents(10);
        $this->assertSame(['c', 'b', 'a'], array_column($events, 'event'));
    }

    public function test_failures_registry_parses_tsv(): void
    {
        $now = time();
        file_put_contents(
            $this->tmpCache . '/.failures.tsv',
            "{$now}\texample.com/about/index.html\n" . ($now - 60) . "\texample.com/blog/index.html\n"
        );
        $service = new PrerenderService();
        $rows = $service->readFailures();
        $this->assertCount(2, $rows);
        $this->assertSame('example.com/about/index.html', $rows[0]['cache_path']);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Round 5 additions: purgePattern, ttlForRoute, seoScore, invalidateRoutes,
    // status sidecar reading.
    // ─────────────────────────────────────────────────────────────────────────

    public function test_purge_pattern_matches_glob_single_segment(): void
    {
        $this->writeSnapshot('example.com/blog/post-1/index.html', '<html><body>a</body></html>');
        $this->writeSnapshot('example.com/blog/post-2/index.html', '<html><body>b</body></html>');
        $this->writeSnapshot('example.com/about/index.html', '<html><body>c</body></html>');

        $svc = new PrerenderService();
        $result = $svc->purgePattern('/blog/*', null, dryRun: true);

        $this->assertCount(2, $result['deleted']);
        $this->assertTrue($result['dry_run']);
        // /about should be untouched
        $this->assertTrue(in_array('example.com/blog/post-1/index.html', $result['deleted'], true));
        $this->assertTrue(in_array('example.com/blog/post-2/index.html', $result['deleted'], true));
    }

    public function test_purge_pattern_actually_deletes_files(): void
    {
        $this->writeSnapshot('example.com/blog/post-1/index.html', '<html><body>a</body></html>');
        $svc = new PrerenderService();
        $result = $svc->purgePattern('/blog/*', null, dryRun: false);
        $this->assertCount(1, $result['deleted']);
        $this->assertFileDoesNotExist($this->tmpCache . '/example.com/blog/post-1/index.html');
    }

    public function test_purge_pattern_recursive_double_star(): void
    {
        $this->writeSnapshot('example.com/blog/post-1/index.html', '<html><body>a</body></html>');
        $this->writeSnapshot('example.com/blog/category/foo/index.html', '<html><body>b</body></html>');
        $svc = new PrerenderService();
        $result = $svc->purgePattern('/blog/**', null, dryRun: true);
        $this->assertCount(2, $result['deleted']);
    }

    public function test_exact_preview_purge_deletes_unchanged_snapshots(): void
    {
        $paths = [
            'example.com/blog/post-1/index.html',
            'example.com/blog/post-2/index.html',
        ];
        foreach ($paths as $index => $path) {
            $this->writeSnapshot($path, '<html><body>' . $index . '</body></html>');
        }

        $service = new PrerenderService();
        $fingerprints = $service->fingerprintCachePaths($paths);
        $deleted = $service->purgeExactCachePaths($paths, $fingerprints);

        $this->assertEqualsCanonicalizing($paths, $deleted);
        foreach ($paths as $path) {
            $this->assertFileDoesNotExist($this->tmpCache . '/' . $path);
        }
    }

    public function test_exact_preview_purge_rejects_same_path_replacement_without_partial_delete(): void
    {
        $first = 'example.com/blog/post-1/index.html';
        $second = 'example.com/blog/post-2/index.html';
        $this->writeSnapshot($first, '<html><body>original first</body></html>');
        $this->writeSnapshot($second, '<html><body>original second</body></html>');

        $service = new PrerenderService();
        $fingerprints = $service->fingerprintCachePaths([$first, $second]);
        $this->writeSnapshot($second, '<html><body>fresh replacement</body></html>');

        try {
            $service->purgeExactCachePaths([$first, $second], $fingerprints);
            $this->fail('A same-path replacement must invalidate the destructive preview.');
        } catch (\UnexpectedValueException $e) {
            $this->assertStringContainsString('changed before deletion', $e->getMessage());
        }

        $this->assertFileExists($this->tmpCache . '/' . $first);
        $this->assertFileExists($this->tmpCache . '/' . $second);
    }

    public function test_purge_pattern_scopes_to_shared_host_tenant_prefix(): void
    {
        $slugA = 'purge-a-' . uniqid();
        $slugB = 'purge-b-' . uniqid();
        DB::table('tenants')->insert([
            [
                'name' => 'Purge A',
                'slug' => $slugA,
                'domain' => null,
                'is_active' => 1,
                'created_at' => date('Y-m-d H:i:s'),
                'updated_at' => date('Y-m-d H:i:s'),
            ],
            [
                'name' => 'Purge B',
                'slug' => $slugB,
                'domain' => null,
                'is_active' => 1,
                'created_at' => date('Y-m-d H:i:s'),
                'updated_at' => date('Y-m-d H:i:s'),
            ],
        ]);
        $host = parse_url((string) env('FRONTEND_URL', 'https://app.project-nexus.ie'), PHP_URL_HOST)
            ?: 'app.project-nexus.ie';
        $this->writeSnapshot("{$host}/{$slugA}/blog/post/index.html", '<html><body>a</body></html>');
        $this->writeSnapshot("{$host}/{$slugB}/blog/post/index.html", '<html><body>b</body></html>');

        $svc = new PrerenderService();
        $result = $svc->purgePattern('/blog/*', $slugA, dryRun: true);
        $this->assertCount(1, $result['deleted']);
        $this->assertSame("{$host}/{$slugA}/blog/post/index.html", $result['deleted'][0]);
    }

    public function test_inventory_tenant_filter_scopes_to_shared_host_tenant_prefix(): void
    {
        $slugA = 'inventory-a-' . uniqid();
        $slugB = 'inventory-b-' . uniqid();
        DB::table('tenants')->insert([
            [
                'name' => 'Inventory A',
                'slug' => $slugA,
                'domain' => null,
                'is_active' => 1,
                'created_at' => date('Y-m-d H:i:s'),
                'updated_at' => date('Y-m-d H:i:s'),
            ],
            [
                'name' => 'Inventory B',
                'slug' => $slugB,
                'domain' => null,
                'is_active' => 1,
                'created_at' => date('Y-m-d H:i:s'),
                'updated_at' => date('Y-m-d H:i:s'),
            ],
        ]);
        $host = parse_url((string) env('FRONTEND_URL', 'https://app.project-nexus.ie'), PHP_URL_HOST)
            ?: 'app.project-nexus.ie';
        $this->writeSnapshot("{$host}/{$slugA}/about/index.html", '<html><body>a</body></html>');
        $this->writeSnapshot("{$host}/{$slugB}/about/index.html", '<html><body>b</body></html>');

        $svc = new PrerenderService();
        $rows = $svc->inventory($slugA, false);

        $this->assertCount(1, $rows);
        $this->assertSame($slugA, $rows[0]['tenant_slug']);
        $this->assertSame('/about', $rows[0]['tenant_route']);
        $this->assertSame("/{$slugA}/about", $rows[0]['route']);
    }

    public function test_ttl_for_route_picks_most_specific_pattern(): void
    {
        $svc = new PrerenderService();
        // From config/prerender.php defaults.
        $this->assertSame(6 * 3600, $svc->ttlForRoute('/'));
        $this->assertSame(12 * 3600, $svc->ttlForRoute('/blog'));
        $this->assertSame(7 * 24 * 3600, $svc->ttlForRoute('/blog/foo-post'));
        $this->assertSame(30 * 24 * 3600, $svc->ttlForRoute('/about'));
    }

    public function test_ttl_falls_back_to_default_for_unknown_route(): void
    {
        $svc = new PrerenderService();
        // Default in config/prerender.php is 7 days.
        $this->assertSame(7 * 24 * 3600, $svc->ttlForRoute('/some-route-not-in-config'));
    }

    public function test_seo_score_high_grade_for_complete_page(): void
    {
        $svc = new PrerenderService();
        $insp = [
            'title' => 'A reasonable title between ten and seventy characters',
            'meta_description' => str_repeat('x', 100),
            'canonical' => 'https://example.com/foo',
            'og_tags' => [
                'og:title' => 'Foo', 'og:description' => 'Bar', 'og:image' => 'https://example.com/og.png',
            ],
            'h1_texts' => ['Foo'],
            'json_ld' => ['blocks_count' => 1, 'all_valid' => true],
            'asset_issues' => [],
            'flags' => ['has_noscript' => true],
            'preview' => str_repeat('Lorem ipsum dolor sit amet. ', 60),
        ];
        $score = $svc->seoScore($insp);
        $this->assertGreaterThanOrEqual(90, $score['score']);
        $this->assertSame('A', $score['grade']);
        $this->assertEmpty($score['issues']);
    }

    public function test_seo_score_low_grade_when_critical_tags_missing(): void
    {
        $svc = new PrerenderService();
        $insp = [
            'title' => '',
            'meta_description' => null,
            'canonical' => null,
            'og_tags' => [],
            'h1_texts' => [],
            'json_ld' => ['blocks_count' => 0, 'all_valid' => true],
            'asset_issues' => ['a.js', 'b.js'],
            'flags' => ['has_noscript' => false],
            'preview' => '',
        ];
        $score = $svc->seoScore($insp);
        $this->assertLessThan(50, $score['score']);
        $this->assertSame('F', $score['grade']);
        $this->assertContains('Missing <title>', $score['issues']);
    }

    public function test_status_sidecar_is_surfaced_in_inspect(): void
    {
        $this->writeSnapshot('example.com/dead-link/index.html', '<html><body>not found</body></html>');
        file_put_contents($this->tmpCache . '/example.com/dead-link/_status', '404');

        $svc = new PrerenderService();
        $insp = $svc->inspect('example.com/dead-link/index.html');
        $this->assertNotNull($insp);
        $this->assertSame(404, $insp['http_status']);
    }

    public function test_status_sidecar_defaults_to_200_when_absent(): void
    {
        $this->writeSnapshot('example.com/ok/index.html', '<html><body>fine</body></html>');
        $svc = new PrerenderService();
        $insp = $svc->inspect('example.com/ok/index.html');
        $this->assertNotNull($insp);
        $this->assertSame(200, $insp['http_status']);
    }

    public function test_priority_promotion_on_duplicate_enqueue(): void
    {
        $svc = new PrerenderService();
        $id1 = $svc->enqueueJob(null, '/about', false, false, null, PrerenderService::PRIORITY_LOW);
        // Same args + higher priority → should promote the existing row.
        $id2 = $svc->enqueueJob(null, '/about', false, false, null, PrerenderService::PRIORITY_HIGH);
        $this->assertSame($id1, $id2);
        $row = DB::table('prerender_jobs')->where('id', $id1)->first();
        $this->assertSame(PrerenderService::PRIORITY_HIGH, (int) $row->priority);
    }

    public function test_claim_next_respects_priority(): void
    {
        $svc = new PrerenderService();
        // Older low-priority job comes in first.
        $oldLow = $svc->enqueueJob(null, '/about', false, false, null, PrerenderService::PRIORITY_LOW);
        // Newer high-priority job comes second.
        $newHigh = $svc->enqueueJob(null, '/faq', false, false, null, PrerenderService::PRIORITY_HIGH);

        $claimed = $svc->claimNextJob('test-host:0');
        $this->assertNotNull($claimed);
        $this->assertSame($newHigh, (int) $claimed['id'], 'high-priority should win even when queued later');
        $this->assertNotSame($oldLow, (int) $claimed['id']);
    }

    public function test_crawler_analytics_aggregates_jsonl_log(): void
    {
        $log = $this->tmpCache . '/.bot-access.jsonl';
        $now = date('c');
        $lines = [
            json_encode(['ts' => $now, 'host' => 'a.com', 'uri' => '/foo', 'status' => 200, 'crawler' => 'googlebot', 'verified' => '1', 'ua' => 'Googlebot', 'ip' => '66.249.66.1']),
            json_encode(['ts' => $now, 'host' => 'a.com', 'uri' => '/foo', 'status' => 200, 'crawler' => 'googlebot', 'verified' => '',  'ua' => 'Googlebot', 'ip' => '1.2.3.4']),
            json_encode(['ts' => $now, 'host' => 'a.com', 'uri' => '/bar', 'status' => 404, 'crawler' => 'bingbot',   'verified' => '1', 'ua' => 'Bingbot',  'ip' => '40.77.0.1']),
        ];
        file_put_contents($log, implode("\n", $lines) . "\n");

        $svc = new PrerenderService();
        $analytics = $svc->crawlerAnalytics(date('c', time() - 3600), 100);

        $this->assertSame(3, $analytics['total_hits']);
        $this->assertSame(2, $analytics['verified_hits']);
        $this->assertSame(['googlebot' => 1], $analytics['spoofed_by_crawler']);
        $this->assertSame(['googlebot' => 2, 'bingbot' => 1], $analytics['hits_by_crawler']);
    }

    // ─────── Round 2/3 tests ──────────────────────────────────────────────

    public function test_circuit_breaker_trips_after_threshold(): void
    {
        $service = new PrerenderService();
        $service->resetBreaker();
        $this->assertNull($service->breakerTrippedUntil(), 'breaker should start closed');

        // Pump 5 failed finalises inside the window — trips the breaker.
        $routes = ['/about', '/faq', '/contact', '/help', '/changelog'];
        for ($i = 0; $i < PrerenderService::BREAKER_FAILURE_THRESHOLD; $i++) {
            $id = $service->enqueueJob(null, $routes[$i], false, false, 1);
            $service->claimNextJob('w');
            $service->markRunning($id, 'w');
            $service->finaliseJob($id, 'failed', 0, 0, 0, 1, 5, null, 'boom', 'w');
        }

        $this->assertNotNull($service->breakerTrippedUntil(), 'breaker should trip');

        // claimNextJob must return null while tripped, even with work queued.
        $service->resetBreaker();
        $service->tripBreaker(900);
        $service->enqueueJob(null, '/privacy', false, false, 1);
        $this->assertNull(
            $service->claimNextJob('w-after-trip'),
            'claimNextJob must return null while breaker is tripped'
        );
        $service->resetBreaker();
    }

    public function test_per_tenant_concurrency_cap_blocks_second_job(): void
    {
        [$tenantA, $tenantB] = $this->seedCmsTenantPair('concurrency-a', 'concurrency-b');
        $service = new PrerenderService();
        $service->resetBreaker();

        // First job for tenant 99 gets claimed and stays running.
        $id1 = $service->enqueueJob($tenantA, '/about', false, false, 1);
        $first = $service->claimNextJob('w');
        $this->assertNotNull($first);
        $service->markRunning((int) $first['id']);

        // Second job for the SAME tenant: queued, but claimNextJob skips it.
        $id2 = $service->enqueueJob($tenantA, '/faq', false, false, 1);

        // Third job for a DIFFERENT tenant: should be claimable past the cap.
        $id3 = $service->enqueueJob($tenantB, '/contact', false, false, 1);

        $second = $service->claimNextJob('w');
        $this->assertNotNull($second, 'a different tenant must still be claimable');
        $this->assertSame($id3, (int) $second['id'], 'tenant B should be picked over busy tenant A');

        // After finishing tenant 99's first job, tenant 99 should be claimable again.
        $service->finaliseJob($id1, 'succeeded', 1, 1, 0, 0, 1, null, null, 'w');
        $third = $service->claimNextJob('w');
        $this->assertNotNull($third);
        $this->assertSame($id2, (int) $third['id']);
    }

    public function test_route_validation_rejects_shell_metacharacters(): void
    {
        $service = new PrerenderService();
        $this->expectException(\InvalidArgumentException::class);
        $service->enqueueJob(null, '/legit,/about;rm -rf /', false, false, 1);
    }

    public function test_audit_redacts_secret_keys(): void
    {
        $service = new PrerenderService();
        $service->audit(
            'test_secret', 1, null, null, 'ok',
            ['routes' => ['/x'], 'api_token' => 'sk-LIVE-DEADBEEF', 'nested' => ['password' => 'hunter2']]
        );

        $row = DB::table('prerender_audit_log')->orderByDesc('id')->first();
        $this->assertNotNull($row);
        $decoded = json_decode($row->details, true);
        $this->assertSame('[REDACTED]', $decoded['api_token']);
        $this->assertSame('[REDACTED]', $decoded['nested']['password']);
        // Non-secret fields preserved.
        $this->assertSame(['/x'], $decoded['routes']);
    }

    public function test_health_returns_red_when_breaker_tripped(): void
    {
        $service = new PrerenderService();
        $service->resetBreaker();
        $service->tripBreaker(600);
        $h = $service->health();
        $this->assertSame('red', $h['status']);
        $names = array_column($h['checks'], 'name');
        $this->assertContains('circuit_breaker', $names);
        $service->resetBreaker();
    }

    public function test_health_reports_stuck_jobs(): void
    {
        $service = new PrerenderService();
        $service->resetBreaker();
        // Insert a row that LOOKS stuck (claimed >30min ago).
        DB::table('prerender_jobs')->insert([
            'tenant_id'  => null,
            'routes'     => '/stuck',
            'status'     => 'running',
            'priority'   => 5,
            'claimed_at' => date('Y-m-d H:i:s', time() - 3600),
            'started_at' => date('Y-m-d H:i:s', time() - 3600),
            'queued_at'  => date('Y-m-d H:i:s', time() - 3700),
        ]);

        $h = $service->health();
        $stuck = collect($h['checks'])->firstWhere('name', 'stuck_jobs');
        $this->assertNotNull($stuck);
        $this->assertSame('yellow', $stuck['status']);
    }

    public function test_health_does_not_flag_a_long_job_with_a_recent_heartbeat(): void
    {
        if (!Schema::hasColumn('prerender_jobs', 'heartbeat_at')) {
            $this->markTestSkipped('heartbeat_at migration is not applied.');
        }

        $service = new PrerenderService();
        $service->resetBreaker();
        DB::table('prerender_jobs')->insert([
            'tenant_id'   => null,
            'routes'      => '/long-running',
            'status'      => 'running',
            'priority'    => 5,
            'claimed_at'  => date('Y-m-d H:i:s', time() - 7200),
            'started_at'  => date('Y-m-d H:i:s', time() - 7200),
            'heartbeat_at' => date('Y-m-d H:i:s', time() - 30),
            'queued_at'   => date('Y-m-d H:i:s', time() - 7300),
        ]);

        $health = $service->health();
        $stuck = collect($health['checks'])->firstWhere('name', 'stuck_jobs');
        $this->assertNotNull($stuck);
        $this->assertSame('green', $stuck['status']);
    }

    public function test_verify_integrity_matches_sidecar(): void
    {
        $service = new PrerenderService();
        $abs = $this->tmpCache . '/example.com/foo/index.html';
        @mkdir(dirname($abs), 0777, true);
        $html = '<html><body>hello</body></html>';
        file_put_contents($abs, $html);
        file_put_contents($abs . '.sha256', hash('sha256', $html) . '  ' . strlen($html));

        $r = $service->verifyIntegrity($abs);
        $this->assertSame('ok', $r['status']);
        $this->assertSame(hash('sha256', $html), $r['expected']);
    }

    public function test_verify_integrity_detects_mismatch(): void
    {
        $service = new PrerenderService();
        $abs = $this->tmpCache . '/example.com/bar/index.html';
        @mkdir(dirname($abs), 0777, true);
        file_put_contents($abs, '<html>original</html>');
        file_put_contents($abs . '.sha256', str_repeat('f', 64));

        $r = $service->verifyIntegrity($abs);
        $this->assertSame('mismatch', $r['status']);
        $this->assertNotEquals($r['expected'], $r['actual']);
    }

    public function test_verify_integrity_missing_sidecar(): void
    {
        $service = new PrerenderService();
        $abs = $this->tmpCache . '/example.com/baz/index.html';
        @mkdir(dirname($abs), 0777, true);
        file_put_contents($abs, '<html/>');
        // No .sha256 sidecar.
        $r = $service->verifyIntegrity($abs);
        $this->assertSame('missing', $r['status']);
    }

    public function test_ttl_inspector_picks_most_specific_pattern(): void
    {
        // Stub config.
        config(['prerender.ttl' => [
            'default'  => 7 * 86400,
            '/blog'    => 3600,
            '/blog/*'  => 1800,
            '/blog/**' => 900,
        ]]);
        $service = new PrerenderService();

        $exact = $service->describeTtlForRoute('/blog');
        $this->assertSame('/blog', $exact['matched_pattern']);
        $this->assertSame(3600, $exact['ttl_seconds']);

        $oneLevel = $service->describeTtlForRoute('/blog/hello');
        $this->assertSame('/blog/*', $oneLevel['matched_pattern']);
        $this->assertSame(1800, $oneLevel['ttl_seconds']);

        $deep = $service->describeTtlForRoute('/blog/tags/foo/bar');
        $this->assertSame('/blog/**', $deep['matched_pattern']);
        $this->assertSame(900, $deep['ttl_seconds']);

        $miss = $service->describeTtlForRoute('/nope');
        $this->assertNull($miss['matched_pattern']);
        $this->assertSame('default', $miss['source']);
        $this->assertSame(7 * 86400, $miss['ttl_seconds']);
    }

    public function test_safe_cache_path_accepts_route_special_chars(): void
    {
        // Regression: P1 fix widened the regex. A route like /events/social-(2024)
        // should produce an inspectable cache_path.
        $service = new PrerenderService();
        $html = '<html><head><title>X</title></head></html>';
        $this->writeSnapshot('example.com/events/social-(2024)/index.html', $html);
        $rows = $service->inventory(null, false);
        $this->assertNotEmpty($rows);
        $rel = $rows[0]['cache_path'];
        $this->assertNotNull($service->inspect($rel), 'inspect must accept routes containing ( ) chars');
    }

    public function test_burst_backpressure_coalesces_to_tenant_wide(): void
    {
        // Seed a tenant row so resolveTenantHost works.
        $tenantId = (int) DB::table('tenants')->insertGetId([
            'name'      => 'Burst Test',
            'slug'      => 'burst-test-' . uniqid(),
            'domain'    => 'burst-test.example',
            'is_active' => 1,
            'created_at'=> date('Y-m-d H:i:s'),
            'updated_at'=> date('Y-m-d H:i:s'),
        ]);
        // Reset the burst counter just in case a prior test populated it.
        \Illuminate\Support\Facades\Cache::forget("prerender:burst:tenant:{$tenantId}");

        // First 50 invocations should keep their per-route precision.
        $service = new PrerenderService();
        for ($i = 0; $i < 50; $i++) {
            $slug = "burst-page-{$i}";
            DB::table('pages')->insert([
                'tenant_id' => $tenantId,
                'title' => "Burst page {$i}",
                'slug' => $slug,
                'content' => '<p>Burst page</p>',
                'is_published' => 1,
                'created_at' => date('Y-m-d H:i:s'),
                'updated_at' => date('Y-m-d H:i:s'),
            ]);
            $abs = $this->tmpCache . "/burst-test.example/page/{$slug}/index.html";
            @mkdir(dirname($abs), 0777, true);
            file_put_contents($abs, '<html/>');
            $service->invalidateRoutes($tenantId, ["/page/{$slug}"]);
        }

        // The 51st should flip to a tenant-wide row (routes=null).
        DB::table('pages')->insert([
            'tenant_id' => $tenantId,
            'title' => 'Burst page 51',
            'slug' => 'burst-page-51',
            'content' => '<p>Burst page</p>',
            'is_published' => 1,
            'created_at' => date('Y-m-d H:i:s'),
            'updated_at' => date('Y-m-d H:i:s'),
        ]);
        $abs = $this->tmpCache . '/burst-test.example/page/burst-page-51/index.html';
        @mkdir(dirname($abs), 0777, true);
        file_put_contents($abs, '<html/>');
        $service->invalidateRoutes($tenantId, ['/page/burst-page-51']);

        $tenantWide = DB::table('prerender_jobs')
            ->where('tenant_id', $tenantId)
            ->whereNull('routes')
            ->where('status', 'queued')
            ->exists();
        $this->assertTrue($tenantWide, 'burst above threshold must enqueue a tenant-wide row');
    }

    public function test_enqueue_rejects_global_cms_page_route(): void
    {
        $service = new PrerenderService();

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Route requires tenant scope');

        $service->enqueueJob(null, '/page/tenant-only-page', false, false, null);
    }

    public function test_enqueue_rejects_feature_gated_route_without_tenant_scope(): void
    {
        $service = new PrerenderService();

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Route requires tenant scope');

        $service->enqueueJob(null, '/jobs', false, false, null);
    }

    public function test_enqueue_rejects_private_or_tool_routes_inside_dynamic_prefixes(): void
    {
        [$tenantId] = $this->seedCmsTenantPair('private-route-owner', 'private-route-other');
        $service = new PrerenderService();

        foreach (['/listings/create', '/profile/settings'] as $route) {
            try {
                $service->enqueueJob($tenantId, $route, false, false, null);
                $this->fail("Route {$route} should not be accepted for prerender.");
            } catch (\InvalidArgumentException $e) {
                $this->assertStringContainsString('Route is not available for tenant', $e->getMessage());
            }
        }
    }

    public function test_tenant_scoped_cms_page_route_must_belong_to_that_tenant(): void
    {
        [$ownerId, $otherId, , , $pageSlug] = $this->seedCmsTenantPair('enqueue-owner', 'enqueue-other');

        $service = new PrerenderService();
        $jobId = $service->enqueueJob($ownerId, "/page/{$pageSlug}", false, false, null);
        $this->assertGreaterThan(0, $jobId);

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Route is not available for tenant');

        $service->enqueueJob($otherId, "/page/{$pageSlug}", false, false, null);
    }

    public function test_published_blog_route_is_prerenderable_only_for_its_tenant(): void
    {
        [$ownerId, $otherId] = $this->seedCmsTenantPair('blog-owner', 'blog-other');
        $slug = $this->seedBlogPost($ownerId);
        DB::table('tenants')->whereIn('id', [$ownerId, $otherId])->update([
            'features' => json_encode(['blog' => true]),
        ]);

        $service = new PrerenderService();
        $jobId = $service->enqueueJob($ownerId, "/blog/{$slug}", false, false, null);
        $this->assertGreaterThan(0, $jobId);

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Route is not available for tenant');
        $service->enqueueJob($otherId, "/blog/{$slug}", false, false, null);
    }

    public function test_invalidate_routes_ignores_wrong_tenant_blog_route(): void
    {
        [$ownerId, $otherId, , $otherSlug] = $this->seedCmsTenantPair('invalidate-blog-owner', 'invalidate-blog-other');
        $slug = $this->seedBlogPost($ownerId);
        $host = $this->frontendHost();
        $wrongPath = $this->writeSnapshot("{$host}/{$otherSlug}/blog/{$slug}/index.html", '<html><body>wrong tenant</body></html>');

        $service = new PrerenderService();
        $deleted = $service->invalidateRoutes($otherId, ["/blog/{$slug}"]);

        $this->assertSame(1, $deleted);
        $this->assertFileDoesNotExist($wrongPath);
        $this->assertFalse(
            DB::table('prerender_jobs')->where('tenant_id', $otherId)->where('routes', "/blog/{$slug}")->exists(),
            'Wrong-tenant invalidation may purge a stale snapshot, but must not enqueue a recache job.'
        );
    }

    public function test_invalidate_routes_enqueues_prerenderable_missing_snapshot(): void
    {
        [$tenantId] = $this->seedCmsTenantPair('missing-snapshot-owner', 'missing-snapshot-other');

        $service = new PrerenderService();
        $deleted = $service->invalidateRoutes($tenantId, ['/about']);

        $this->assertSame(0, $deleted);
        $this->assertTrue(
            DB::table('prerender_jobs')->where('tenant_id', $tenantId)->where('routes', '/about')->exists(),
            'A valid route without an existing snapshot should still enqueue recache work.'
        );
    }

    public function test_route_normalization_canonicalizes_trailing_slash_and_rejects_traversal_aliases(): void
    {
        $this->assertSame('/blog', PrerenderService::normalizeRoute('/blog/'));
        $this->assertSame('/blog/caf%C3%A9', PrerenderService::normalizeRoute('/blog/caf%C3%A9'));
        foreach (['/./blog', '/../x', '/a/../../x', '//blog', '/blog//post', '/%2e%2e/x', '/a%2fb', '/bad%ZZ'] as $route) {
            $this->assertNull(PrerenderService::normalizeRoute($route), $route);
        }
    }

    public function test_enqueue_canonicalizes_and_deduplicates_route_aliases(): void
    {
        [$tenantId] = $this->seedCmsTenantPair('canonical-route-owner', 'canonical-route-other');
        $jobId = (new PrerenderService())->enqueueJob(
            $tenantId,
            '/about/,/about',
            false,
            false,
            null
        );

        $this->assertSame('/about', DB::table('prerender_jobs')->where('id', $jobId)->value('routes'));
    }

    public function test_snapshot_deletion_refuses_symlink_escape_from_cache_root(): void
    {
        [$tenantId] = $this->seedCmsTenantPair('symlink-owner', 'symlink-other');
        $target = collect((new PrerenderService())->loadTenantTargets())->firstWhere('tenant_id', $tenantId);
        $this->assertIsArray($target);

        $outside = $this->tmpCache . '-outside-' . uniqid();
        mkdir($outside, 0777, true);
        file_put_contents($outside . '/index.html', '<html><body>must survive</body></html>');
        $link = $this->tmpCache . '/' . $target['host'] . $target['prefix'] . '/about';
        mkdir(dirname($link), 0777, true);
        if (!@symlink($outside, $link)) {
            $this->rrmdir($outside);
            $this->markTestSkipped('Filesystem does not permit symlink creation');
        }

        try {
            $deleted = (new PrerenderService())->invalidateRoutes($tenantId, ['/about'], false);
            $this->assertSame(0, $deleted);
            $this->assertFileExists($outside . '/index.html');
        } finally {
            @unlink($link);
            $this->rrmdir($outside);
        }
    }

    public function test_tenant_targets_normalize_custom_and_inherited_hosts_to_lowercase(): void
    {
        $suffix = strtolower(uniqid());
        $parentId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Uppercase parent host',
            'slug' => "upper-parent-{$suffix}",
            'domain' => "Parent-{$suffix}.Example.TEST",
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $childId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Inherited uppercase host',
            'slug' => "upper-child-{$suffix}",
            'domain' => null,
            'parent_id' => $parentId,
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $targets = collect((new PrerenderService())->loadTenantTargets());
        $this->assertSame(
            strtolower("Parent-{$suffix}.Example.TEST"),
            $targets->firstWhere('tenant_id', $parentId)['host'] ?? null
        );
        $this->assertSame(
            strtolower("Parent-{$suffix}.Example.TEST"),
            $targets->firstWhere('tenant_id', $childId)['host'] ?? null
        );
    }

    public function test_invalidate_path_tenant_homepage_deletes_prefixed_snapshot(): void
    {
        [$tenantId, , $slug] = $this->seedCmsTenantPair('home-owner', 'home-other');
        $path = $this->writeSnapshot(
            $this->frontendHost() . "/{$slug}/index.html",
            '<html><body>old landing page</body></html>'
        );

        $deleted = (new PrerenderService())->invalidateRoutes($tenantId, ['/']);

        $this->assertSame(1, $deleted);
        $this->assertFileDoesNotExist($path);
        $this->assertDatabaseHas('prerender_jobs', [
            'tenant_id' => $tenantId,
            'routes' => '/',
            'status' => 'queued',
        ]);
    }

    public function test_custom_domain_parent_filter_never_includes_path_child_snapshots(): void
    {
        $suffix = uniqid();
        $domain = "parent-{$suffix}.example.test";
        $parentSlug = "parent-{$suffix}";
        $childSlug = "child-{$suffix}";
        $parentId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Parent custom domain',
            'slug' => $parentSlug,
            'domain' => $domain,
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('tenants')->insert([
            'name' => 'Path child',
            'slug' => $childSlug,
            'domain' => null,
            'parent_id' => $parentId,
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->writeSnapshot("{$domain}/blog/parent/index.html", '<html><body>parent</body></html>');
        $this->writeSnapshot("{$domain}/{$childSlug}/blog/child/index.html", '<html><body>child</body></html>');

        $service = new PrerenderService();
        $inventory = $service->inventory($parentSlug, false);
        $purge = $service->purgePattern('/blog/**', $parentSlug, true);

        $this->assertCount(1, $inventory);
        $this->assertSame($parentId, $inventory[0]['tenant_id']);
        $this->assertSame('/blog/parent', $inventory[0]['tenant_route']);
        $this->assertSame(["{$domain}/blog/parent/index.html"], $purge['deleted']);
    }

    public function test_profile_routes_are_never_prerenderable_without_public_seo_consent(): void
    {
        [$tenantId] = $this->seedCmsTenantPair('profile-owner', 'profile-other');
        $user = User::factory()->forTenant($tenantId)->create(['is_approved' => 1]);

        $this->assertFalse(
            (new PrerenderService())->tenantRouteCanBePrerendered($tenantId, "/profile/{$user->id}")
        );
    }

    public function test_dynamic_blog_route_requires_the_blog_feature(): void
    {
        [$tenantId] = $this->seedCmsTenantPair('disabled-blog-owner', 'disabled-blog-other');
        $postSlug = $this->seedBlogPost($tenantId);
        DB::table('tenants')->where('id', $tenantId)->update([
            'features' => json_encode(['blog' => false]),
        ]);

        $this->assertFalse(
            (new PrerenderService())->tenantRouteCanBePrerendered($tenantId, "/blog/{$postSlug}")
        );

        DB::table('tenants')->where('id', $tenantId)->update([
            'features' => json_encode(['blog' => true]),
        ]);

        $this->assertTrue(
            (new PrerenderService())->tenantRouteCanBePrerendered($tenantId, "/blog/{$postSlug}")
        );
    }

    public function test_late_finaliser_cannot_overwrite_a_new_claim_owner(): void
    {
        $service = new PrerenderService();
        $jobId = $service->enqueueJob(null, '/about', true, false, null);
        $service->claimNextJob('worker-old');
        $service->markRunning($jobId, 'worker-old');
        DB::table('prerender_jobs')->where('id', $jobId)->update([
            'status' => 'running',
            'claimed_by' => 'worker-new',
        ]);

        $this->assertFalse($service->finaliseJob(
            $jobId, 'failed', 1, 0, 1, 1, 5, null, 'late result', 'worker-old'
        ));

        $this->assertFalse(
            $service->finaliseJob($jobId, 'failed', 1, 0, 1, 1, 5, null, 'unfenced result')
        );

        $row = DB::table('prerender_jobs')->where('id', $jobId)->first();
        $this->assertSame('running', $row->status);
        $this->assertSame('worker-new', $row->claimed_by);
    }

    public function test_running_job_heartbeat_is_fenced_by_claim_owner(): void
    {
        $service = new PrerenderService();
        $jobId = $service->enqueueJob(null, '/about', true, false, null);
        $service->claimNextJob('worker-current');
        $service->markRunning($jobId, 'worker-current');
        $oldLease = now()->subHours(2)->toDateTimeString();
        $hasHeartbeat = Schema::hasColumn('prerender_jobs', 'heartbeat_at');
        $oldValues = [
            'started_at' => $oldLease,
        ];
        if ($hasHeartbeat) $oldValues['heartbeat_at'] = $oldLease;
        DB::table('prerender_jobs')->where('id', $jobId)->update($oldValues);

        $this->assertFalse($service->heartbeatJob($jobId, 'worker-stale'));
        $this->assertSame(
            $oldLease,
            DB::table('prerender_jobs')->where('id', $jobId)->value('started_at')
        );

        $this->assertTrue($service->heartbeatJob($jobId, 'worker-current'));
        $row = DB::table('prerender_jobs')->where('id', $jobId)->first();
        $leaseValue = $hasHeartbeat ? $row->heartbeat_at : $row->started_at;
        $this->assertGreaterThan(strtotime($oldLease), strtotime((string) $leaseValue));
        if ($hasHeartbeat) {
            $this->assertSame($oldLease, $row->started_at, 'heartbeat must not rewrite true start time');
        }
    }

    public function test_enqueue_rejects_oversized_route_sets_instead_of_truncating(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('exceeds the 2000-byte job limit');

        (new PrerenderService())->enqueueJob(null, str_repeat('/about,', 400), false, false, null);
    }

    public function test_invalidate_routes_deletes_snapshot_bundle_for_hidden_dynamic_route(): void
    {
        [$tenantId, , $slug] = $this->seedCmsTenantPair('hidden-vol-owner', 'hidden-vol-other');
        $host = $this->frontendHost();
        $indexPath = $this->writeSnapshot("{$host}/{$slug}/volunteering/opportunities/987654/index.html", '<html><body>old</body></html>');
        file_put_contents(dirname($indexPath) . '/index.html.sha256', hash('sha256', 'old'));
        file_put_contents(dirname($indexPath) . '/_status', '200');
        file_put_contents(dirname($indexPath) . '/index.md', '# old');

        $service = new PrerenderService();
        $deleted = $service->invalidateRoutes($tenantId, ['/volunteering/opportunities/987654']);

        $this->assertSame(1, $deleted);
        $this->assertFileDoesNotExist($indexPath);
        $this->assertFileDoesNotExist(dirname($indexPath) . '/index.html.sha256');
        $this->assertFileDoesNotExist(dirname($indexPath) . '/_status');
        $this->assertFileDoesNotExist(dirname($indexPath) . '/index.md');
        $this->assertFalse(
            DB::table('prerender_jobs')->where('tenant_id', $tenantId)->where('routes', '/volunteering/opportunities/987654')->exists(),
            'Hidden/deleted dynamic routes should be purged without recache.'
        );
    }

    public function test_invalidate_preserves_live_non_200_bundle_and_schedules_authoritative_rebuild(): void
    {
        [$tenantId, , $slug] = $this->seedCmsTenantPair('status-vol-owner', 'status-vol-other');
        $host = $this->frontendHost();
        $indexPath = $this->writeSnapshot(
            "{$host}/{$slug}/volunteering/opportunities/987655/index.html",
            '<html><body>gone</body></html>'
        );
        file_put_contents(dirname($indexPath) . '/_status', '410');

        $deleted = (new PrerenderService())->invalidateRoutes(
            $tenantId,
            ['/volunteering/opportunities/987655']
        );

        $this->assertSame(0, $deleted);
        $this->assertFileExists($indexPath);
        $this->assertFileExists(dirname($indexPath) . '/_status');
        $this->assertTrue(
            DB::table('prerender_jobs')
                ->whereNull('tenant_id')
                ->whereNull('routes')
                ->where('force_render', 1)
                ->where('status', 'queued')
                ->exists(),
            'Status-map changes must be published through one authoritative generation'
        );
    }

    public function test_tenant_owned_organisation_route_uses_volunteer_organizations(): void
    {
        [$tenantId] = $this->seedCmsTenantPair('vol-org-owner', 'vol-org-other');
        [$orgId] = $this->seedVolunteerContent($tenantId, organizationStatus: 'active');
        [$pendingOrgId] = $this->seedVolunteerContent($tenantId, organizationStatus: 'pending');

        $service = new PrerenderService();

        $this->assertTrue($service->tenantOwnedRouteExistsForTenant($tenantId, "/organisations/{$orgId}"));
        $this->assertFalse($service->tenantOwnedRouteExistsForTenant($tenantId, "/organisations/{$pendingOrgId}"));
    }

    public function test_tenant_owned_volunteer_opportunity_requires_visible_opportunity_and_org(): void
    {
        [$tenantId] = $this->seedCmsTenantPair('vol-opp-owner', 'vol-opp-other');
        [, $activeOpportunityId] = $this->seedVolunteerContent($tenantId, organizationStatus: 'approved', opportunityStatus: 'active');
        [, $pendingOrgOpportunityId] = $this->seedVolunteerContent($tenantId, organizationStatus: 'pending', opportunityStatus: 'active');
        [, $closedOpportunityId] = $this->seedVolunteerContent($tenantId, organizationStatus: 'approved', opportunityStatus: 'closed');

        $service = new PrerenderService();

        $this->assertTrue($service->tenantOwnedRouteExistsForTenant($tenantId, "/volunteering/opportunities/{$activeOpportunityId}"));
        $this->assertFalse($service->tenantOwnedRouteExistsForTenant($tenantId, "/volunteering/opportunities/{$pendingOrgOpportunityId}"));
        $this->assertFalse($service->tenantOwnedRouteExistsForTenant($tenantId, "/volunteering/opportunities/{$closedOpportunityId}"));
    }

    public function test_inventory_marks_volunteering_snapshot_content_stale(): void
    {
        [$tenantId, , $slug] = $this->seedCmsTenantPair('vol-stale-owner', 'vol-stale-other');
        DB::table('tenants')->where('id', $tenantId)->update(['updated_at' => now()->subDays(2)]);
        $this->seedVolunteerContent($tenantId, organizationStatus: 'active', opportunityStatus: 'active');
        $host = $this->frontendHost();
        $indexPath = $this->writeSnapshot("{$host}/{$slug}/volunteering/index.html", '<html><body>old volunteering</body></html>');
        touch($indexPath, time() - 7200);

        $service = new PrerenderService();
        $rows = $service->inventory($slug, true);

        $row = $rows[0] ?? null;
        $this->assertNotNull($row);
        $this->assertSame('/volunteering', $row['tenant_route']);
        $this->assertTrue($row['content_stale']);
        $this->assertStringContainsString('/volunteering content updated', (string) $row['content_stale_reason']);
    }

    public function test_route_planner_lists_cms_page_only_for_owning_tenant(): void
    {
        [, , $ownerSlug, $otherSlug, $pageSlug] = $this->seedCmsTenantPair('plan-owner', 'plan-other');

        Artisan::call('prerender:plan-routes', [
            '--tenant' => $ownerSlug,
            '--include-static' => '0',
            '--include-sitemap' => '1',
        ]);
        $ownerPlan = json_decode(Artisan::output(), true);

        Artisan::call('prerender:plan-routes', [
            '--tenant' => $otherSlug,
            '--include-static' => '0',
            '--include-sitemap' => '1',
        ]);
        $otherPlan = json_decode(Artisan::output(), true);

        $ownerRoutes = $ownerPlan['tenants'][0]['routes'] ?? [];
        $otherRoutes = $otherPlan['tenants'][0]['routes'] ?? [];

        $this->assertContains("/page/{$pageSlug}", $ownerRoutes);
        $this->assertNotContains("/page/{$pageSlug}", $otherRoutes);
    }

    public function test_strict_route_plan_rejects_sitemap_with_only_off_host_urls(): void
    {
        $this->mock(SitemapService::class, function ($mock): void {
            $mock->shouldReceive('generateForTenant')
                ->once()
                ->andReturn('<urlset><url><loc>https://wrong.example/page/other</loc></url></urlset>');
        });

        $service = new PrerenderService();
        $target = collect($service->loadTenantTargets())
            ->first();
        $this->assertIsArray($target);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('rejected 1 route location');
        $service->expectedRoutesForTenant(
            $target,
            PrerenderService::MAX_PLANNED_ROUTES_PER_TENANT,
            true
        );
    }

    public function test_strict_route_plan_rejects_one_bad_location_among_valid_routes(): void
    {
        $service = new PrerenderService();
        $target = collect($service->loadTenantTargets())->first();
        $this->assertIsArray($target);
        $base = 'https://' . $target['host'] . $target['prefix'];

        $this->mock(SitemapService::class, function ($mock) use ($base): void {
            $mock->shouldReceive('generateForTenant')->once()->andReturn(
                '<urlset>'
                . '<url><loc>' . htmlspecialchars($base . '/about', ENT_XML1) . '</loc></url>'
                . '<url><loc>https://wrong.example/blog/stale</loc></url>'
                . '</urlset>'
            );
        });

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('rejected 1 route location');
        $service->expectedRoutesForTenant(
            $target,
            PrerenderService::MAX_PLANNED_ROUTES_PER_TENANT,
            true
        );
    }

    public function test_auto_recache_does_not_enqueue_wrong_tenant_cms_snapshot(): void
    {
        [$ownerId, $otherId, $ownerSlug, $otherSlug, $pageSlug] = $this->seedCmsTenantPair('recache-owner', 'recache-other');
        $host = $this->frontendHost();
        $old = time() - 90 * 86400;

        $ownerPath = $this->writeSnapshot("{$host}/{$ownerSlug}/page/{$pageSlug}/index.html", '<html><body>owner</body></html>');
        $otherPath = $this->writeSnapshot("{$host}/{$otherSlug}/page/{$pageSlug}/index.html", '<html><body>wrong tenant</body></html>');
        touch($ownerPath, $old);
        touch($otherPath, $old);

        Artisan::call('prerender:auto-recache', [
            '--min-stale-seconds' => '0',
            '--include-ttl' => '1',
            '--include-content' => '0',
            '--max-tenants' => '10',
            '--max-routes' => '10',
        ]);

        $ownerRoutes = (string) DB::table('prerender_jobs')->where('tenant_id', $ownerId)->value('routes');
        $otherRoutes = (string) DB::table('prerender_jobs')->where('tenant_id', $otherId)->value('routes');

        $this->assertStringContainsString("/page/{$pageSlug}", $ownerRoutes);
        $this->assertStringNotContainsString("/page/{$pageSlug}", $otherRoutes);
    }

    public function test_drift_detector_does_not_enqueue_wrong_tenant_cms_route(): void
    {
        [$ownerId, $otherId, , , $pageSlug] = $this->seedCmsTenantPair('drift-owner', 'drift-other');

        $fakeSitemap = new class($ownerId, $pageSlug) extends SitemapService {
            public function __construct(private readonly int $ownerId, private readonly string $pageSlug) {}

            public function generateForTenant(int $tenantId, ?string $baseUrl = null): string
            {
                $base = rtrim($baseUrl ?: 'https://app.project-nexus.ie/test', '/');
                $routes = $tenantId === $this->ownerId ? ["/page/{$this->pageSlug}"] : [];
                $xml = '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
                foreach ($routes as $route) {
                    $xml .= '<url><loc>' . htmlspecialchars($base . $route, ENT_XML1) . '</loc><lastmod>' . date('c') . '</lastmod></url>';
                }
                return $xml . '</urlset>';
            }
        };
        app()->instance(SitemapService::class, $fakeSitemap);

        Artisan::call('prerender:detect-drift', [
            '--include-missing' => '1',
            '--min-drift-seconds' => '0',
            '--max-tenants' => '10',
            '--max-routes' => '10',
        ]);

        $ownerRoutes = (string) DB::table('prerender_jobs')->where('tenant_id', $ownerId)->value('routes');
        $otherRoutes = (string) DB::table('prerender_jobs')->where('tenant_id', $otherId)->value('routes');

        $this->assertStringContainsString("/page/{$pageSlug}", $ownerRoutes);
        $this->assertStringNotContainsString("/page/{$pageSlug}", $otherRoutes);
    }

    public function test_purge_unexpected_removes_cross_tenant_cms_page_snapshot(): void
    {
        [, , $ownerSlug, $otherSlug, $pageSlug] = $this->seedCmsTenantPair('cms-owner', 'cms-other');
        $host = $this->frontendHost();
        $this->writeSnapshot("{$host}/{$ownerSlug}/page/{$pageSlug}/index.html", '<html><body>owner</body></html>');
        $this->writeSnapshot("{$host}/{$otherSlug}/page/{$pageSlug}/index.html", '<html><body>wrong tenant</body></html>');

        $service = new PrerenderService();
        $dryRun = $service->purgeUnexpectedSnapshots(true);

        $this->assertContains("/page/{$pageSlug}", $dryRun['by_tenant'][$otherSlug] ?? []);
        $this->assertNotContains("/page/{$pageSlug}", $dryRun['by_tenant'][$ownerSlug] ?? []);

        $result = $service->purgeUnexpectedSnapshots(false);

        $this->assertSame(1, $result['deleted_total']);
        $this->assertFileExists($this->tmpCache . "/{$host}/{$ownerSlug}/page/{$pageSlug}/index.html");
        $this->assertFileDoesNotExist($this->tmpCache . "/{$host}/{$otherSlug}/page/{$pageSlug}/index.html");
    }

    public function test_purge_unexpected_can_reconcile_exactly_one_tenant(): void
    {
        [$tenantId, , $tenantSlug, $otherSlug] = $this->seedCmsTenantPair(
            'scoped-clean-owner',
            'scoped-clean-other'
        );
        $host = $this->frontendHost();
        $ownerPath = $this->writeSnapshot(
            "{$host}/{$tenantSlug}/obsolete-feature-route/index.html",
            '<html><body>owner stale route</body></html>'
        );
        $otherPath = $this->writeSnapshot(
            "{$host}/{$otherSlug}/obsolete-feature-route/index.html",
            '<html><body>other stale route</body></html>'
        );

        $result = (new PrerenderService())->purgeUnexpectedSnapshots(false, $tenantId);

        $this->assertSame(1, $result['deleted_total']);
        $this->assertFileDoesNotExist($ownerPath);
        $this->assertFileExists($otherPath);
    }

    public function test_global_purge_removes_snapshot_for_retired_unattributed_host(): void
    {
        $orphanPath = $this->writeSnapshot(
            'retired-tenant.example/old-page/index.html',
            '<html><body>retired tenant</body></html>'
        );

        $service = new PrerenderService();
        $dryRun = $service->purgeUnexpectedSnapshots(true);

        $this->assertContains('/old-page', $dryRun['by_tenant']['orphan@retired-tenant.example'] ?? []);
        $this->assertFileExists($orphanPath);

        $result = $service->purgeUnexpectedSnapshots(false);

        $this->assertSame(1, $result['deleted_total']);
        $this->assertFileDoesNotExist($orphanPath);
    }

    public function test_purge_unexpected_retains_owned_public_blog_snapshot_only(): void
    {
        [$ownerId, , $ownerSlug, $otherSlug] = $this->seedCmsTenantPair('blog-clean-owner', 'blog-clean-other');
        $slug = $this->seedBlogPost($ownerId);
        DB::table('tenants')->where('id', $ownerId)->update([
            'features' => json_encode(['blog' => true]),
        ]);
        $host = $this->frontendHost();
        $this->writeSnapshot("{$host}/{$ownerSlug}/blog/{$slug}/index.html", '<html><body>owner</body></html>');
        $this->writeSnapshot("{$host}/{$otherSlug}/blog/{$slug}/index.html", '<html><body>wrong tenant</body></html>');

        $service = new PrerenderService();
        $dryRun = $service->purgeUnexpectedSnapshots(true);

        $this->assertContains("/blog/{$slug}", $dryRun['by_tenant'][$otherSlug] ?? []);
        $this->assertNotContains("/blog/{$slug}", $dryRun['by_tenant'][$ownerSlug] ?? []);

        $result = $service->purgeUnexpectedSnapshots(false);

        $this->assertSame(1, $result['deleted_total']);
        $this->assertFileExists($this->tmpCache . "/{$host}/{$ownerSlug}/blog/{$slug}/index.html");
        $this->assertFileDoesNotExist($this->tmpCache . "/{$host}/{$otherSlug}/blog/{$slug}/index.html");
    }

    public function test_tenant_safety_report_flags_unexpected_cross_tenant_cms_page(): void
    {
        [, , $ownerSlug, $otherSlug, $pageSlug] = $this->seedCmsTenantPair('safety-owner', 'safety-other');
        $host = $this->frontendHost();
        $this->writeSnapshot("{$host}/{$ownerSlug}/page/{$pageSlug}/index.html", '<html><body>owner</body></html>');
        $this->writeSnapshot("{$host}/{$otherSlug}/page/{$pageSlug}/index.html", '<html><body>wrong tenant</body></html>');

        $service = new PrerenderService();
        $owner = $service->tenantSafetyReport($ownerSlug, ["/page/{$pageSlug}"]);
        $other = $service->tenantSafetyReport($otherSlug, []);

        $this->assertNotNull($owner);
        $this->assertNotNull($other);
        $this->assertSame(0, $owner['counts']['unexpected']);
        $this->assertSame(1, $other['counts']['unexpected']);
        $this->assertContains("/page/{$pageSlug}", $other['unexpected_routes']);
    }

    /**
     * @return array{0:int,1:int,2:string,3:string,4:string}
     */
    private function seedBlogPost(int $tenantId): string
    {
        $now = date('Y-m-d H:i:s');
        $authorId = (int) DB::table('users')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => 'Prerender Blog Author',
            'email' => 'prerender-blog-' . uniqid() . '@example.test',
            'is_approved' => 1,
            'status' => 'active',
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $slug = 'tenant-owned-post-' . uniqid();
        DB::table('posts')->insert([
            'tenant_id' => $tenantId,
            'author_id' => $authorId,
            'title' => 'Tenant owned post',
            'slug' => $slug,
            'excerpt' => 'Only one tenant owns this post.',
            'content' => 'Only one tenant owns this post.',
            'status' => 'published',
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return $slug;
    }

    private function seedCmsTenantPair(string $ownerPrefix, string $otherPrefix): array
    {
        $ownerSlug = $ownerPrefix . '-' . uniqid();
        $otherSlug = $otherPrefix . '-' . uniqid();
        $pageSlug = 'tenant-owned-page-' . uniqid();
        $now = date('Y-m-d H:i:s');

        $ownerId = (int) DB::table('tenants')->insertGetId([
            'name' => 'CMS Owner',
            'slug' => $ownerSlug,
            'domain' => null,
            'is_active' => 1,
            'features' => '{}',
            'configuration' => '{"modules":{}}',
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $otherId = (int) DB::table('tenants')->insertGetId([
            'name' => 'CMS Other',
            'slug' => $otherSlug,
            'domain' => null,
            'is_active' => 1,
            'features' => '{}',
            'configuration' => '{"modules":{}}',
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        DB::table('pages')->insert([
            'tenant_id' => $ownerId,
            'title' => 'Tenant owned page',
            'slug' => $pageSlug,
            'content' => '<p>Only the owner tenant should prerender this.</p>',
            'is_published' => 1,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return [$ownerId, $otherId, $ownerSlug, $otherSlug, $pageSlug];
    }

    private function frontendHost(): string
    {
        return parse_url((string) env('FRONTEND_URL', 'https://app.project-nexus.ie'), PHP_URL_HOST)
            ?: 'app.project-nexus.ie';
    }

    /**
     * @return array{0:int,1:int}
     */
    private function seedVolunteerContent(
        int $tenantId,
        string $organizationStatus = 'active',
        string $opportunityStatus = 'active'
    ): array {
        $now = date('Y-m-d H:i:s');
        $user = User::factory()->forTenant($tenantId)->create([
            'is_approved' => 1,
            'status' => 'active',
        ]);
        $suffix = uniqid();
        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $user->id,
            'name' => 'Volunteer Org ' . $suffix,
            'slug' => 'vol-org-' . $suffix,
            'description' => 'A volunteer organisation for prerender regression tests.',
            'contact_email' => 'vol-org-' . $suffix . '@example.test',
            'status' => $organizationStatus,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $opportunityId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $tenantId,
            'organization_id' => $orgId,
            'created_by' => $user->id,
            'title' => 'Volunteer Opportunity ' . $suffix,
            'description' => 'A volunteering opportunity for prerender regression tests.',
            'location' => 'Remote',
            'status' => $opportunityStatus,
            'is_active' => 1,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return [$orgId, $opportunityId];
    }

    private function writeSnapshot(string $rel, string $html): string
    {
        $path = $this->tmpCache . '/' . $rel;
        @mkdir(dirname($path), 0777, true);
        file_put_contents($path, $html);

        return $path;
    }

    private function rrmdir(string $dir): void
    {
        if (!is_dir($dir)) return;
        $items = scandir($dir) ?: [];
        foreach ($items as $i) {
            if ($i === '.' || $i === '..') continue;
            $p = $dir . '/' . $i;
            is_dir($p) ? $this->rrmdir($p) : @unlink($p);
        }
        @rmdir($dir);
    }
}
