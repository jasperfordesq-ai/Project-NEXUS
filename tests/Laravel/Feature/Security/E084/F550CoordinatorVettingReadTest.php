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
 * F-550 (E-084) — a coordinator's broker-panel Vetting page could not load.
 *
 * The documented rule (docs/ROLES-AND-PERMISSIONS.md) is that coordinators
 * see vetting but make no vetting decisions. Every vetting READ route used
 * requireVettingDecisionMaker(), which refuses coordinators, so the Vetting
 * page, its counts, the policy box and the vetting part of a member's details
 * all failed for them. Found by re-running the E-083 broker-panel sweep with
 * the local test account's role set to coordinator: 8 refusals, all vetting.
 *
 * 🔴 These assertions state the CORRECT outcome, and pair each read with the
 * decision a coordinator must still be refused.
 */
final class F550CoordinatorVettingReadTest extends TestCase
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

    public function test_a_coordinator_can_read_the_vetting_page_routes(): void
    {
        $member = $this->user('member');
        Sanctum::actingAs($this->user('coordinator'), ['*']);

        foreach (['/v2/admin/vetting', '/v2/admin/vetting/stats', '/v2/admin/vetting/policy', "/v2/admin/vetting/user/{$member->id}"] as $route) {
            $res = $this->apiGet($route);
            self::assertSame(200, $res->getStatusCode(), "{$route} must load for a coordinator: " . $res->getContent());
        }
    }

    public function test_a_coordinator_still_cannot_record_a_vetting_decision(): void
    {
        $member = $this->user('member');
        Sanctum::actingAs($this->user('coordinator'), ['*']);

        foreach (["/v2/admin/vetting/user/{$member->id}/confirm", "/v2/admin/vetting/user/{$member->id}/revoke"] as $route) {
            $res = $this->apiPost($route, []);
            self::assertSame(403, $res->getStatusCode(), "{$route} must stay refused for a coordinator: " . $res->getContent());
        }
    }

    public function test_an_ordinary_member_is_still_refused_the_reads(): void
    {
        Sanctum::actingAs($this->user('member'), ['*']);

        self::assertSame(403, $this->apiGet('/v2/admin/vetting')->getStatusCode());
        self::assertSame(403, $this->apiGet('/v2/admin/vetting/policy')->getStatusCode());
    }

    private function user(string $role): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        DB::table('users')->where('id', $u->id)->update(['role' => $role, 'is_admin' => 0]);

        return User::find($u->id);
    }
}
