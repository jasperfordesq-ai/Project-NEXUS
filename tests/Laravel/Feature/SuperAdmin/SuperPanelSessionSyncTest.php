<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\SuperAdmin;

use App\Core\SuperPanelAccess;
use App\Http\Controllers\Api\AdminSuperController;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * AdminSuperController::requireSuperAdmin() mirrors the caller into the session
 * for legacy readers. It wrote is_super_admin = 1 for EVERY caller it admitted,
 * so a tenant super admin's session claimed the platform tier — and legacy code
 * that trusted $_SESSION['is_super_admin'] would have treated it as one. (API
 * requests carry no session today, so the write was latent; it is removed so
 * it cannot become live.)
 */
class SuperPanelSessionSyncTest extends TestCase
{
    use DatabaseTransactions;

    /**
     * API routes carry no session, so the sync is exercised directly: give the
     * current request a session store and call the controller's gate.
     */
    private function runRequireSuperAdminAs(User $user): \Illuminate\Contracts\Session\Session
    {
        SuperPanelAccess::reset();
        Sanctum::actingAs($user);

        $session = $this->app['session']->driver('array');
        $session->start();
        request()->setLaravelSession($session);

        $controller = $this->app->make(AdminSuperController::class);
        $method = new \ReflectionMethod($controller, 'requireSuperAdmin');
        $method->setAccessible(true);
        $method->invoke($controller);

        return $session;
    }

    protected function tearDown(): void
    {
        SuperPanelAccess::reset();
        parent::tearDown();
    }

    public function test_a_tenant_super_admin_session_never_claims_the_platform_tier(): void
    {
        $hubId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Session Sync Hub',
            'slug' => 'session-sync-hub-' . uniqid('', false),
            'is_active' => 1,
            'allows_subtenants' => 1,
            'depth' => 0,
            'path' => null,
            'max_depth' => 3,
        ]);
        DB::table('tenants')->where('id', $hubId)->update(['path' => '/' . $hubId . '/']);

        $tsa = User::factory()->forTenant($hubId)->admin()->create(['status' => 'active', 'is_approved' => true]);
        DB::table('users')->where('id', $tsa->id)->update([
            'is_tenant_super_admin' => 1, 'is_super_admin' => 0, 'is_god' => 0,
        ]);

        $session = $this->runRequireSuperAdminAs($tsa->fresh());

        $this->assertSame((int) $tsa->id, (int) $session->get('user_id'), 'Control: the sync ran.');
        $this->assertEmpty($session->get('is_super_admin'), 'A tenant super admin must not be mirrored as a platform super admin.');
        $this->assertSame(1, (int) $session->get('is_tenant_super_admin'));
    }

    public function test_a_platform_super_admin_session_still_says_so(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active', 'is_approved' => true]);
        DB::table('users')->where('id', $owner->id)->update(['is_super_admin' => 1]);

        $session = $this->runRequireSuperAdminAs($owner->fresh());

        $this->assertSame(1, (int) $session->get('is_super_admin'));
    }
}
