<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use App\Services\PrerenderService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * AdminPrerenderController — auth, validation, lifecycle smoke tests.
 *
 * These tests don't require the snapshot cache volume to be mounted — the
 * service returns empty inventory if the path is unreadable, and tests
 * cover that path along with the DB-backed job queue.
 */
class AdminPrerenderControllerTest extends TestCase
{
    use DatabaseTransactions;

    public function test_summary_requires_auth(): void
    {
        $this->apiGet('/v2/admin/prerender/summary')->assertStatus(401);
    }

    public function test_summary_rejects_non_admin(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->create());
        $this->apiGet('/v2/admin/prerender/summary')->assertStatus(403);
    }

    public function test_summary_rejects_tenant_admin(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());
        $this->apiGet('/v2/admin/prerender/summary')->assertStatus(403);
    }

    public function test_summary_allows_platform_super_admin(): void
    {
        Sanctum::actingAs($this->makeSuperAdmin());
        $r = $this->apiGet('/v2/admin/prerender/summary');
        $r->assertStatus(200);
        $r->assertJsonStructure(['data' => [
            'cache_readable', 'total_snapshots', 'expected_count',
            'queued_jobs', 'active_jobs', 'realtime_channel', 'realtime_event',
        ]]);
    }

    public function test_inventory_validates_tenant_slug(): void
    {
        Sanctum::actingAs($this->makeSuperAdmin());
        $this->apiGet('/v2/admin/prerender/inventory?tenant=' . urlencode('not!a!slug!'))
            ->assertStatus(400);
    }

    public function test_inspect_rejects_path_traversal(): void
    {
        Sanctum::actingAs($this->makeSuperAdmin());
        $this->apiGet('/v2/admin/prerender/inspect?path=' . urlencode('../../etc/passwd'))
            ->assertStatus(404);
    }

    public function test_enqueue_rejects_non_super_admin(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());
        $this->apiPost('/v2/admin/prerender/jobs', ['force' => true])
            ->assertStatus(403);
    }

    public function test_enqueue_creates_a_job_for_the_platform_team(): void
    {
        Sanctum::actingAs($this->makeSuperAdmin());
        $r = $this->apiPost('/v2/admin/prerender/jobs', [
            'routes' => '/about,/faq',
            'force'  => true,
        ]);
        $r->assertStatus(200);
        $id = $r->json('data.job_id');
        $this->assertGreaterThan(0, $id);
        $this->assertDatabaseHas('prerender_jobs', [
            'id'           => $id,
            'status'       => 'queued',
            'routes'       => '/about,/faq',
            'force_render' => 1,
        ]);
    }

    public function test_enqueue_dedupes_identical_queued_jobs(): void
    {
        Sanctum::actingAs($this->makeSuperAdmin());
        $a = $this->apiPost('/v2/admin/prerender/jobs', ['force' => true])->json('data.job_id');
        $b = $this->apiPost('/v2/admin/prerender/jobs', ['force' => true])->json('data.job_id');
        $this->assertSame($a, $b);
    }

    public function test_enqueue_rejects_bad_route_pattern(): void
    {
        Sanctum::actingAs($this->makeSuperAdmin());
        $this->apiPost('/v2/admin/prerender/jobs', ['routes' => 'no-leading-slash'])
            ->assertStatus(400);
    }

    public function test_enqueue_rejects_tenant_owned_route_without_tenant_scope(): void
    {
        Sanctum::actingAs($this->makeSuperAdmin());

        $this->apiPost('/v2/admin/prerender/jobs', ['routes' => '/page/tenant-only-page'])
            ->assertStatus(400);

        $this->apiPost('/v2/admin/prerender/jobs', ['routes' => '/jobs'])
            ->assertStatus(400);
    }

    public function test_purge_rejects_all_tenant_delete_without_confirmation(): void
    {
        Sanctum::actingAs($this->makeSuperAdmin());

        $this->apiPost('/v2/admin/prerender/purge', [
            'pattern' => '/page/*',
            'dry_run' => false,
        ])->assertStatus(400);
    }

    public function test_live_purge_requires_current_server_preview_token(): void
    {
        Sanctum::actingAs($this->makeSuperAdmin());

        $this->apiPost('/v2/admin/prerender/purge', [
            'pattern' => '/about',
            'tenant_slug' => $this->testTenantSlug,
            'dry_run' => false,
        ])->assertStatus(409)
            ->assertJsonPath('code', 'PRERENDER_PREVIEW_REQUIRED');
    }

    public function test_matching_preview_token_authorizes_exact_live_purge(): void
    {
        Sanctum::actingAs($this->makeSuperAdmin());
        $preview = $this->apiPost('/v2/admin/prerender/purge', [
            'pattern' => '/about',
            'tenant_slug' => $this->testTenantSlug,
            'dry_run' => true,
        ])->assertStatus(200);
        $token = $preview->json('data.preview_token');
        $this->assertIsString($token);

        $this->apiPost('/v2/admin/prerender/purge', [
            'pattern' => '/about',
            'tenant_slug' => $this->testTenantSlug,
            'dry_run' => false,
            'preview_token' => $token,
        ])->assertStatus(200);
    }

    public function test_cancel_marks_queued_job_cancelled(): void
    {
        Sanctum::actingAs($this->makeSuperAdmin());
        $id = $this->apiPost('/v2/admin/prerender/jobs', ['force' => true])->json('data.job_id');
        $this->apiPost("/v2/admin/prerender/jobs/{$id}/cancel")->assertStatus(200);
        $this->assertSame('cancelled', DB::table('prerender_jobs')->where('id', $id)->value('status'));
    }

    public function test_cancel_409_on_already_running_job(): void
    {
        Sanctum::actingAs($this->makeSuperAdmin());
        $id = $this->apiPost('/v2/admin/prerender/jobs', ['force' => true])->json('data.job_id');
        DB::table('prerender_jobs')->where('id', $id)->update(['status' => 'running']);
        $this->apiPost("/v2/admin/prerender/jobs/{$id}/cancel")->assertStatus(409);
    }

    public function test_jobs_listing_returns_recent_jobs(): void
    {
        Sanctum::actingAs($this->makeSuperAdmin());
        $this->apiPost('/v2/admin/prerender/jobs', ['force' => true]);
        $r = $this->apiGet('/v2/admin/prerender/jobs');
        $r->assertStatus(200);
        $this->assertNotEmpty($r->json('data.items'));
    }

    public function test_metrics_returns_prometheus_text(): void
    {
        Sanctum::actingAs($this->makeSuperAdmin());
        $r = $this->apiGet('/v2/admin/prerender/metrics');
        $r->assertStatus(200);
        $r->assertHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        $body = $r->getContent();
        $this->assertStringContainsString('# TYPE nexus_prerender_snapshots_total gauge', $body);
        $this->assertStringContainsString('nexus_prerender_jobs_total{status="queued"}', $body);
    }

    public function test_realtime_channel_returns_expected_shape(): void
    {
        Sanctum::actingAs($this->makeSuperAdmin());
        $r = $this->apiGet('/v2/admin/prerender/realtime-channel');
        $r->assertStatus(200);
        $this->assertSame('private-admin-prerender', $r->json('data.channel'));
        $this->assertSame('job.updated', $r->json('data.event'));
    }

    public function test_reset_queue_requeues_stale_claimed_jobs_without_updated_at_column(): void
    {
        Sanctum::actingAs($this->makeSuperAdmin());
        $jobId = DB::table('prerender_jobs')->insertGetId([
            'status' => 'claimed',
            'priority' => 5,
            'tenant_id' => $this->testTenantId,
            'routes' => '/about',
            'force_render' => 0,
            'dry_run' => 0,
            'claimed_at' => now()->subHour(),
            'claimed_by' => 'stale-worker',
            'started_at' => now()->subHour(),
            'queued_at' => now()->subHour(),
        ]);

        $this->apiPost('/v2/admin/prerender/reset-queue')->assertStatus(200);

        $row = DB::table('prerender_jobs')->where('id', $jobId)->first();
        $this->assertSame('queued', $row->status);
        $this->assertNull($row->claimed_at);
        $this->assertNull($row->claimed_by);
        $this->assertNull($row->started_at);
    }

    public function test_reset_queue_preserves_long_running_job_with_recent_heartbeat(): void
    {
        Sanctum::actingAs($this->makeSuperAdmin());
        $jobId = DB::table('prerender_jobs')->insertGetId([
            'status' => 'running',
            'priority' => 5,
            'tenant_id' => $this->testTenantId,
            'routes' => '/about',
            'force_render' => 0,
            'dry_run' => 0,
            'claimed_at' => now()->subHours(2),
            'claimed_by' => 'healthy-worker-token',
            'started_at' => now()->subHours(2),
            'heartbeat_at' => now()->subMinute(),
            'queued_at' => now()->subHours(2),
        ]);

        $this->apiPost('/v2/admin/prerender/reset-queue')
            ->assertStatus(200)
            ->assertJsonPath('data.rows_reset', 0);

        $row = DB::table('prerender_jobs')->where('id', $jobId)->first();
        $this->assertSame('running', $row->status);
        $this->assertSame('healthy-worker-token', $row->claimed_by);
        $this->assertNotNull($row->heartbeat_at);
    }

    public function test_reset_all_requires_exact_confirmation(): void
    {
        Sanctum::actingAs($this->makeSuperAdmin());

        $this->apiPost('/v2/admin/prerender/reset-all', [
            'confirmation' => 'reset',
        ])->assertStatus(422);
    }

    public function test_reset_all_schedules_authoritative_rebuild(): void
    {
        Sanctum::actingAs($this->makeSuperAdmin());
        $this->mock(PrerenderService::class, function ($mock): void {
            $mock->shouldReceive('resetAllSnapshots')
                ->once()
                ->andReturn([
                    'job_id' => 4321,
                    'cancelled_jobs' => 2,
                    'cancelled_active_jobs' => 1,
                    'tenant_count' => 3,
                    'planned_routes' => 99,
                ]);
            $mock->shouldNotReceive('audit');
        });

        $this->apiPost('/v2/admin/prerender/reset-all', [
            'confirmation' => 'RESET ALL SNAPSHOTS',
        ])->assertStatus(202)
            ->assertJsonPath('data.job_id', 4321)
            ->assertJsonPath('data.planned_routes', 99);
    }

    public function test_reset_all_returns_failure_and_best_effort_logs_failed_attempt(): void
    {
        Sanctum::actingAs($this->makeSuperAdmin());
        $this->mock(PrerenderService::class, function ($mock): void {
            $mock->shouldReceive('resetAllSnapshots')
                ->once()
                ->andThrow(new \RuntimeException('required success audit insert failed'));
            $mock->shouldReceive('audit')
                ->once()
                ->withArgs(function (
                    string $action,
                    int $actorUserId,
                    ?int $tenantId,
                    ?int $jobId,
                    string $outcome,
                    array $details,
                    ?string $ip,
                    ?string $userAgent
                ): bool {
                    unset($ip, $userAgent);
                    return $action === 'reset_all'
                        && $actorUserId > 0
                        && $tenantId === null
                        && $jobId === null
                        && $outcome === 'error'
                        && str_contains((string) ($details['error'] ?? ''), 'audit insert failed');
                });
        });

        $this->apiPost('/v2/admin/prerender/reset-all', [
            'confirmation' => 'RESET ALL SNAPSHOTS',
        ])->assertStatus(503)
            ->assertJsonPath('code', 'PRERENDER_RESET_FAILED');
    }

    public function test_csv_export_neutralizes_spreadsheet_formulas(): void
    {
        Sanctum::actingAs($this->makeSuperAdmin());
        $this->mock(PrerenderService::class, function ($mock): void {
            $mock->shouldReceive('recentAudit')->once()->andReturn([[
                'id' => 1,
                'created_at' => '2026-07-10 12:00:00',
                'action' => 'enqueue',
                'outcome' => 'ok',
                'actor_email' => '=HYPERLINK("https://attacker.invalid")',
                'tenant_slug' => '+cmd|calc',
                'job_id' => 9,
                'ip' => '@SUM(1+1)',
                'details' => ['routes' => '-2+3'],
            ]]);
        });

        $response = $this->apiGet('/v2/admin/prerender/export/audit.csv');
        $response->assertStatus(200);
        $csv = (string) $response->streamedContent();

        $this->assertStringContainsString("'=HYPERLINK", $csv);
        $this->assertStringContainsString("'+cmd|calc", $csv);
        $this->assertStringContainsString("'@SUM(1+1)", $csv);
    }

    public function test_public_invalidation_webhook_requires_its_shared_secret(): void
    {
        config(['prerender.webhook_token' => 'test-prerender-webhook-secret']);

        $this->apiPost('/v2/prerender/invalidate', [
            'tenant_id' => $this->testTenantId,
            'routes' => ['/about'],
            'recache' => false,
        ])->assertStatus(401);
    }

    public function test_public_invalidation_webhook_bearer_is_repeatable_for_newer_publishes(): void
    {
        config(['prerender.webhook_token' => 'test-prerender-webhook-secret']);
        $this->mock(PrerenderService::class, function ($mock): void {
            $mock->shouldReceive('loadTenantTargets')
                ->twice()
                ->andReturn([['tenant_id' => $this->testTenantId]]);
            $mock->shouldReceive('invalidateRoutes')
                ->twice()
                ->with($this->testTenantId, ['/about'], false)
                ->andReturn(0);
            $mock->shouldReceive('audit')->twice();
        });
        $payload = [
            'tenant_id' => $this->testTenantId,
            'routes' => ['/about'],
            'recache' => false,
        ];
        $headers = ['Authorization' => 'Bearer test-prerender-webhook-secret'];

        $this->apiPost('/v2/prerender/invalidate', $payload, $headers)
            ->assertStatus(200)
            ->assertJsonPath('data.tenant_id', $this->testTenantId);

        $this->apiPost('/v2/prerender/invalidate', $payload, $headers)
            ->assertStatus(200)
            ->assertJsonPath('data.tenant_id', $this->testTenantId);
    }

    public function test_public_invalidation_webhook_rejects_traversal_and_encoded_aliases(): void
    {
        config(['prerender.webhook_token' => 'test-prerender-webhook-traversal-secret']);
        $headers = ['Authorization' => 'Bearer test-prerender-webhook-traversal-secret'];

        foreach (['/../../../httpdocs', '/./blog', '//blog', '/%2e%2e/httpdocs', '/blog%2fpost'] as $route) {
            $this->apiPost('/v2/prerender/invalidate', [
                'tenant_id' => $this->testTenantId,
                'routes' => [$route],
                'recache' => false,
            ], $headers)->assertStatus(400);
        }
    }

    public function test_public_invalidation_webhook_rejects_unknown_tenant(): void
    {
        config(['prerender.webhook_token' => 'test-prerender-webhook-secret']);

        $this->apiPost('/v2/prerender/invalidate', [
            'tenant_id' => 999999999,
            'routes' => ['/about'],
            'recache' => false,
        ], ['Authorization' => 'Bearer test-prerender-webhook-secret'])
            ->assertStatus(404);
    }

    private function makeSuperAdmin(): User
    {
        // The prerender engine is a Platform team page (E-128): is_god AND
        // super admin. A global super admin on their own is now refused; that
        // is pinned in AdminPrerenderControllerPlatformTeamLockTest.
        return User::factory()
            ->forTenant($this->testTenantId)
            ->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
    }
}
