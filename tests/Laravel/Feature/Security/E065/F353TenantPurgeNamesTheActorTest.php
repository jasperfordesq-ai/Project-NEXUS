<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E065;

use App\Core\SuperPanelAccess;
use App\Core\TenantContext;
use App\Jobs\PurgeTenantJob;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * E-065 F-353 — permanently purging a whole community must record who ordered
 * it.
 *
 * Before the fix, AdminSuperController::tenantPurge only called
 * PurgeTenantJob::dispatch($id): no audit row at the point the purge was
 * ordered, and no server-side typed-name confirmation (the CLI twin
 * `php artisan tenant:purge` does demand the slug be typed back). The job
 * carried only the tenant id, and SuperAdminAuditService::log() resolves the
 * actor from SuperPanelAccess / $_SESSION — neither of which a queue worker
 * has — so the single tenant_purged row was written with actor_user_id = 0 and
 * actor_name = 'System'. Production runs QUEUE_CONNECTION=redis, so that was
 * the only branch that ever ran live.
 */
class F353TenantPurgeNamesTheActorTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        $this->app['auth']->forgetGuards();
        foreach (['HTTP_X_TENANT_ID', 'HTTP_X_TENANT_SLUG', 'HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION'] as $serverKey) {
            unset($_SERVER[$serverKey]);
        }
        Cache::flush();
        SuperPanelAccess::reset();
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
    }

    public function test_a_purge_executed_by_the_queue_worker_records_the_admin_who_ordered_it(): void
    {
        [$victimTenantId] = $this->tenant(['is_active' => 0]);
        $member = $this->memberIn($victimTenantId);
        $god = $this->godAdmin();

        // Model a queue worker exactly: no HTTP session, no resolved super-panel
        // access. Only the actor carried on the job payload can name anybody.
        $this->app['auth']->forgetGuards();
        SuperPanelAccess::reset();
        unset($_SESSION['user_id'], $_SESSION['tenant_id']);

        (new PurgeTenantJob(
            $victimTenantId,
            (int) $god->id,
            (int) $god->tenant_id,
            '203.0.113.5',
            'E065-F353-test-agent',
        ))->handle();

        // The community really is gone — this is the blast radius, not a no-op.
        $this->assertDatabaseMissing('tenants', ['id' => $victimTenantId]);
        $this->assertDatabaseMissing('users', ['id' => $member->id]);

        $row = DB::table('super_admin_audit_log')
            ->where('action_type', 'tenant_purged')
            ->where('target_id', $victimTenantId)
            ->orderByDesc('id')
            ->first();

        $this->assertNotNull($row, 'F-353: the purge must write an audit row');
        $this->assertSame(
            (int) $god->id,
            (int) $row->actor_user_id,
            'F-353: the purge audit row must name the admin who ordered it, not "System"'
        );
        $this->assertNotSame(
            'System',
            (string) $row->actor_name,
            'F-353: the purge audit row must carry a real name'
        );
        $this->assertSame(
            (int) $god->tenant_id,
            (int) $row->actor_tenant_id,
            'F-353: the purge audit row must record the actor community'
        );
        $this->assertSame('203.0.113.5', (string) $row->ip_address, 'F-353: the ordering IP is carried onto the job');
    }

    public function test_the_http_purge_endpoint_records_the_order_before_the_queue_runs(): void
    {
        Queue::fake();

        [$victimTenantId, $victimSlug] = $this->tenant(['is_active' => 0]);
        $god = $this->godAdmin();

        $this->assertSame(
            0,
            (int) DB::table('super_admin_audit_log')->where('target_id', $victimTenantId)->count(),
            'fixture: no audit rows for this tenant yet'
        );

        Sanctum::actingAs($god, ['*']);
        $this->postJson('/api/v2/admin/super/tenants/' . $victimTenantId . '/purge', [
            'confirm_slug' => $victimSlug,
        ])->assertStatus(202);

        Queue::assertPushed(PurgeTenantJob::class);

        $row = DB::table('super_admin_audit_log')
            ->where('target_id', $victimTenantId)
            ->orderByDesc('id')
            ->first();

        $this->assertNotNull(
            $row,
            'F-353: the request that ORDERS the purge must write its own audit row, so the record survives a queue that never runs'
        );
        $this->assertSame(
            (int) $god->id,
            (int) $row->actor_user_id,
            'F-353: the order-time audit row must name the god admin'
        );
    }

    public function test_the_purge_endpoint_refuses_without_the_typed_community_slug(): void
    {
        Queue::fake();

        [$victimTenantId] = $this->tenant(['is_active' => 0]);
        $god = $this->godAdmin();

        Sanctum::actingAs($god, ['*']);
        $this->postJson('/api/v2/admin/super/tenants/' . $victimTenantId . '/purge')
            ->assertStatus(422);

        Queue::assertNotPushed(PurgeTenantJob::class);
        $this->assertDatabaseHas('tenants', ['id' => $victimTenantId]);
    }

    public function test_the_purge_endpoint_refuses_when_the_typed_slug_is_wrong(): void
    {
        Queue::fake();

        [$victimTenantId] = $this->tenant(['is_active' => 0]);
        $god = $this->godAdmin();

        Sanctum::actingAs($god, ['*']);
        $this->postJson('/api/v2/admin/super/tenants/' . $victimTenantId . '/purge', [
            'confirm_slug' => 'not-the-right-slug',
        ])->assertStatus(422);

        Queue::assertNotPushed(PurgeTenantJob::class);
        $this->assertDatabaseHas('tenants', ['id' => $victimTenantId]);
    }

    public function test_control_the_in_request_deactivation_of_the_same_tenant_still_names_the_actor(): void
    {
        [$victimTenantId] = $this->tenant(['is_active' => 1]);
        $god = $this->godAdmin();

        Sanctum::actingAs($god, ['*']);
        $this->deleteJson('/api/v2/admin/super/tenants/' . $victimTenantId)
            ->assertStatus(200);

        $row = DB::table('super_admin_audit_log')
            ->where('action_type', 'tenant_deleted')
            ->where('target_id', $victimTenantId)
            ->first();

        $this->assertNotNull($row, 'CONTROL: the deactivation still writes an audit row');
        $this->assertSame((int) $god->id, (int) $row->actor_user_id, 'CONTROL: it still names the actor');
        $this->assertNotSame('System', (string) $row->actor_name);
    }

    // ---------------------------------------------------------------- helpers

    /**
     * @param array<string,mixed> $overrides
     * @return array{0:int,1:string}
     */
    private function tenant(array $overrides = []): array
    {
        $suffix = 'e066ef353' . bin2hex(random_bytes(5));

        $id = (int) DB::table('tenants')->insertGetId(array_merge([
            'name' => 'E065 F-353 synthetic community',
            'slug' => $suffix,
            'parent_id' => null,
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));

        return [$id, (string) DB::table('tenants')->where('id', $id)->value('slug')];
    }

    private function memberIn(int $tenantId): User
    {
        return User::factory()->forTenant($tenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    private function godAdmin(): User
    {
        $god = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'admin',
        ]);

        DB::table('users')->where('id', $god->id)->update([
            'is_super_admin' => 1,
            'is_tenant_super_admin' => 1,
            'is_god' => 1,
        ]);

        return User::find($god->id);
    }
}
