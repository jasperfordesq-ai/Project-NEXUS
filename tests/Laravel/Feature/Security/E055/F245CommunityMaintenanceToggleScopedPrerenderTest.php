<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E055;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-245 (E-055 I-1): PUT /v2/admin/settings with maintenance_mode present
 * queued a PLATFORM-wide authoritative prerender reset even when the value
 * did not change, cancelling every other community's queued / running
 * render jobs. A community's own top admin (is_tenant_super_admin) could
 * repeat that at will by re-sending the current value.
 *
 * First fix (28 Sep): the reset was queued only when the stored state
 * really flipped. Residual closed 29 Sep: a real flip no longer needs the
 * platform-wide reset at all, because the targeted publisher can now install
 * and remove a community's 503 maintenance snapshots on its own (pinned by
 * scripts/test/test-prerender-targeted-status-publish.sh). So no maintenance
 * save by a community admin, changed or not, touches other communities.
 *
 * The real-change control rotates the publisher epoch, so setUp points the
 * prerender paths at a throwaway folder and tearDown removes it (the same
 * isolation PrerenderServiceTest uses); the live cache is never touched.
 */
class F245CommunityMaintenanceToggleScopedPrerenderTest extends TestCase
{
    use DatabaseTransactions;

    private int $otherTenantId;
    private int $otherRunningJobId;
    private int $otherQueuedJobId;
    private ?string $tmpPrerender = null;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tmpPrerender = sys_get_temp_dir() . '/nexus-f245-prerender-' . uniqid('', true);
        mkdir($this->tmpPrerender, 0777, true);
        putenv('PRERENDER_CACHE_PATH=' . $this->tmpPrerender);
        putenv('PRERENDER_EVENT_LOG=' . $this->tmpPrerender . '/events.jsonl');
        putenv('PRERENDER_ASSETS_MANIFEST=' . $this->tmpPrerender . '/.assets-manifest.json');
        $this->otherTenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'F245 Neighbour', 'slug' => 'f245-nb-' . uniqid('', false), 'is_active' => 1,
        ]);
        $this->otherRunningJobId = (int) DB::table('prerender_jobs')->insertGetId([
            'tenant_id' => $this->otherTenantId, 'force_render' => 1, 'priority' => 5,
            'status' => 'running', 'claimed_by' => 'f245-worker', 'fence_state' => 'ready',
            'fence_ready_at' => now(), 'claimed_at' => now(), 'started_at' => now(), 'heartbeat_at' => now(),
        ]);
        $this->otherQueuedJobId = (int) DB::table('prerender_jobs')->insertGetId([
            'tenant_id' => $this->otherTenantId, 'force_render' => 1, 'priority' => 5,
            'status' => 'queued', 'fence_state' => 'ready', 'fence_ready_at' => now(), 'queued_at' => now(),
        ]);
    }

    private function communitySuperAdmin(): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        DB::table('users')->where('id', $u->id)->update(['is_tenant_super_admin' => 1, 'is_super_admin' => 0, 'is_god' => 0]);

        return $u->refresh();
    }

    private function storeMaintenance(?string $value): void
    {
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'general.maintenance_mode')
            ->delete();
        if ($value !== null) {
            DB::table('tenant_settings')->insert([
                'tenant_id' => $this->testTenantId,
                'setting_key' => 'general.maintenance_mode',
                'setting_value' => $value,
                'setting_type' => 'boolean',
            ]);
        }
    }

    private function storedMaintenance(): ?string
    {
        $v = DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'general.maintenance_mode')
            ->value('setting_value');

        return $v === null ? null : (string) $v;
    }

    private function assertNeighbourJobsUntouched(): void
    {
        $this->assertSame('running', (string) DB::table('prerender_jobs')->where('id', $this->otherRunningJobId)->value('status'));
        $this->assertSame('queued', (string) DB::table('prerender_jobs')->where('id', $this->otherQueuedJobId)->value('status'));
    }

    private function assertNoPlatformWideJob(): void
    {
        $this->assertSame(
            0,
            DB::table('prerender_jobs')
                ->whereNull('tenant_id')
                ->where('id', '>', $this->otherQueuedJobId)
                ->count(),
            'no platform-wide (tenant_id NULL) prerender job was queued'
        );
    }

    /** @return array<string, array{0: ?string, 1: string}> */
    public static function unchangedValues(): array
    {
        return [
            'resend false, stored false' => ['false', 'false'],
            'resend false, nothing stored (default off)' => [null, 'false'],
            'resend 0, stored false' => ['false', '0'],
            'resend true, stored true' => ['true', 'true'],
            'resend 1, stored true' => ['true', '1'],
            'resend true, stored 1' => ['1', 'true'],
        ];
    }

    protected function tearDown(): void
    {
        if ($this->tmpPrerender !== null && is_dir($this->tmpPrerender)) {
            $items = new \RecursiveIteratorIterator(
                new \RecursiveDirectoryIterator($this->tmpPrerender, \FilesystemIterator::SKIP_DOTS),
                \RecursiveIteratorIterator::CHILD_FIRST
            );
            foreach ($items as $item) {
                $item->isDir() ? @rmdir($item->getPathname()) : @unlink($item->getPathname());
            }
            @rmdir($this->tmpPrerender);
        }
        putenv('PRERENDER_CACHE_PATH');
        putenv('PRERENDER_EVENT_LOG');
        putenv('PRERENDER_ASSETS_MANIFEST');
        parent::tearDown();
    }

    /**
     * @dataProvider unchangedValues
     */
    public function test_unchanged_maintenance_resend_does_not_touch_other_communities(?string $stored, string $sent): void
    {
        $this->storeMaintenance($stored);
        Sanctum::actingAs($this->communitySuperAdmin());

        $res = $this->apiPut('/v2/admin/settings', ['maintenance_mode' => $sent]);
        $res->assertStatus(200);

        $this->assertNeighbourJobsUntouched();
        $this->assertNoPlatformWideJob();

        // Only this community's own output is refreshed.
        $job = DB::table('prerender_jobs')->where('id', (int) $res->json('data.prerender_job_id'))->first();
        $this->assertNotNull($job);
        $this->assertSame($this->testTenantId, (int) $job->tenant_id);
    }

    public function test_repeated_unchanged_resends_never_cancel_neighbour_jobs(): void
    {
        $this->storeMaintenance('false');
        Sanctum::actingAs($this->communitySuperAdmin());

        for ($i = 0; $i < 5; $i++) {
            $this->apiPut('/v2/admin/settings', ['maintenance_mode' => 'false'])->assertStatus(200);
        }

        $this->assertNeighbourJobsUntouched();
        $this->assertNoPlatformWideJob();
    }

    public function test_control_real_change_still_saves_and_refreshes_own_community(): void
    {
        $this->storeMaintenance('false');
        Sanctum::actingAs($this->communitySuperAdmin());

        $res = $this->apiPut('/v2/admin/settings', ['maintenance_mode' => 'true']);
        $res->assertStatus(200);

        $this->assertSame('true', $this->storedMaintenance());
        $job = DB::table('prerender_jobs')->where('id', (int) $res->json('data.prerender_job_id'))->first();
        $this->assertNotNull($job, 'a refresh covering this community was queued');
        $this->assertSame($this->testTenantId, (int) $job->tenant_id);
    }

    public function test_real_maintenance_flips_never_touch_other_communities(): void
    {
        $this->storeMaintenance('false');
        Sanctum::actingAs($this->communitySuperAdmin());

        foreach (['true', 'false', 'true', 'false'] as $value) {
            $res = $this->apiPut('/v2/admin/settings', ['maintenance_mode' => $value]);
            $res->assertStatus(200);
            $this->assertSame($value, $this->storedMaintenance());

            $job = DB::table('prerender_jobs')->where('id', (int) $res->json('data.prerender_job_id'))->first();
            $this->assertNotNull($job, 'a refresh of this community was queued');
            $this->assertSame($this->testTenantId, (int) $job->tenant_id);
            $this->assertSame(1, (int) $job->force_render);
        }

        $this->assertNeighbourJobsUntouched();
        $this->assertNoPlatformWideJob();
    }

    public function test_control_plain_admin_still_refused_on_maintenance_key(): void
    {
        $this->storeMaintenance('false');
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']));

        $this->apiPut('/v2/admin/settings', ['maintenance_mode' => 'true'])->assertStatus(403);
        $this->apiPut('/v2/admin/settings', ['maintenance_mode' => 'false'])->assertStatus(403);

        $this->assertSame('false', $this->storedMaintenance());
        $this->assertNeighbourJobsUntouched();
        $this->assertNoPlatformWideJob();
    }

    public function test_control_ordinary_setting_refreshes_own_community_only(): void
    {
        Sanctum::actingAs($this->communitySuperAdmin());

        $res = $this->apiPut('/v2/admin/settings', ['items_per_page' => 20]);
        $res->assertStatus(200);

        $this->assertNeighbourJobsUntouched();
        $this->assertNoPlatformWideJob();
        $job = DB::table('prerender_jobs')->where('id', (int) $res->json('data.prerender_job_id'))->first();
        $this->assertNotNull($job);
        $this->assertSame($this->testTenantId, (int) $job->tenant_id);
    }
}
