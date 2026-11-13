<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Middleware;

use App\Core\TenantContext;
use App\Http\Middleware\EnsureOnboardingComplete;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;

class EnsureOnboardingCompleteTest extends TestCase
{
    use DatabaseTransactions;

    private EnsureOnboardingComplete $middleware;

    protected function setUp(): void
    {
        parent::setUp();
        $this->middleware = new EnsureOnboardingComplete();

        // Flush the OnboardingConfigService cache so our DB seed is seen
        \Illuminate\Support\Facades\Cache::flush();

        // Ensure the tenant config says onboarding is mandatory for all tests
        // that rely on the blocking path. Column names are setting_key/setting_value.
        DB::table('tenant_settings')
            ->updateOrInsert(
                ['tenant_id' => $this->testTenantId, 'setting_key' => 'onboarding.mandatory'],
                ['setting_value' => '1', 'updated_at' => now()]
            );
    }

    private function makeNext(): \Closure
    {
        return function ($request) {
            return response()->json(['ok' => true], 200);
        };
    }

    public function test_unauthenticated_request_returns_401(): void
    {
        $request = Request::create('/v2/listings', 'POST');

        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(401, $response->getStatusCode());
        $data = $response->getData(true);
        $this->assertFalse($data['success']);
        $this->assertEquals('auth_required', $data['errors'][0]['code']);
        $this->assertEquals('2.0', $response->headers->get('API-Version'));
    }

    public function test_user_with_onboarding_completed_passes_through(): void
    {
        $user = User::factory()->create([
            'tenant_id'            => $this->testTenantId,
            'onboarding_completed' => true,
        ]);

        $request = Request::create('/v2/listings', 'POST');
        $request->setUserResolver(fn () => $user);

        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(200, $response->getStatusCode());
    }

    public function test_user_without_onboarding_completed_gets_403(): void
    {
        $user = User::factory()->create([
            'tenant_id'            => $this->testTenantId,
            'onboarding_completed' => false,
            'is_admin'             => false,
            'is_super_admin'       => false,
            'is_tenant_super_admin' => false,
            'is_god'               => false,
            'role'                 => 'member',
        ]);

        $request = Request::create('/v2/listings', 'POST');
        $request->setUserResolver(fn () => $user);

        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(403, $response->getStatusCode());
        $data = $response->getData(true);
        $this->assertFalse($data['success']);
        $this->assertEquals('ONBOARDING_REQUIRED', $data['errors'][0]['code']);
        $this->assertEquals('2.0', $response->headers->get('API-Version'));
    }

    public function test_admin_bypasses_onboarding_check(): void
    {
        $user = User::factory()->create([
            'tenant_id'            => $this->testTenantId,
            'onboarding_completed' => false,
            'is_admin'             => true,
        ]);

        $request = Request::create('/v2/listings', 'POST');
        $request->setUserResolver(fn () => $user);

        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(200, $response->getStatusCode());
    }

    public function test_super_admin_bypasses_onboarding_check(): void
    {
        $user = User::factory()->create([
            'tenant_id'            => $this->testTenantId,
            'onboarding_completed' => false,
            'is_super_admin'       => true,
        ]);

        $request = Request::create('/v2/listings', 'POST');
        $request->setUserResolver(fn () => $user);

        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(200, $response->getStatusCode());
    }

    public function test_tenant_super_admin_bypasses_onboarding_check(): void
    {
        $user = User::factory()->create([
            'tenant_id'              => $this->testTenantId,
            'onboarding_completed'   => false,
            'is_tenant_super_admin'  => true,
        ]);

        $request = Request::create('/v2/listings', 'POST');
        $request->setUserResolver(fn () => $user);

        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(200, $response->getStatusCode());
    }

    public function test_god_bypasses_onboarding_check(): void
    {
        $user = User::factory()->create([
            'tenant_id'            => $this->testTenantId,
            'onboarding_completed' => false,
            'is_god'               => true,
        ]);

        $request = Request::create('/v2/listings', 'POST');
        $request->setUserResolver(fn () => $user);

        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(200, $response->getStatusCode());
    }

    public function test_admin_role_bypasses_onboarding_check(): void
    {
        $user = User::factory()->create([
            'tenant_id'            => $this->testTenantId,
            'onboarding_completed' => false,
            'role'                 => 'admin',
            'is_admin'             => false,
        ]);

        $request = Request::create('/v2/listings', 'POST');
        $request->setUserResolver(fn () => $user);

        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(200, $response->getStatusCode());
    }

    public function test_tenant_admin_role_bypasses_onboarding_check(): void
    {
        $user = User::factory()->create([
            'tenant_id'            => $this->testTenantId,
            'onboarding_completed' => false,
            'role'                 => 'tenant_admin',
            'is_admin'             => false,
        ]);

        $request = Request::create('/v2/listings', 'POST');
        $request->setUserResolver(fn () => $user);

        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(200, $response->getStatusCode());
    }

    public function test_super_admin_role_bypasses_onboarding_check(): void
    {
        $user = User::factory()->create([
            'tenant_id'            => $this->testTenantId,
            'onboarding_completed' => false,
            'role'                 => 'super_admin',
            'is_admin'             => false,
        ]);

        $request = Request::create('/v2/listings', 'POST');
        $request->setUserResolver(fn () => $user);

        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(200, $response->getStatusCode());
    }

    public function test_non_mandatory_tenant_passes_member_through_without_completion(): void
    {
        // Override tenant config to non-mandatory for this test
        DB::table('tenant_settings')
            ->updateOrInsert(
                ['tenant_id' => $this->testTenantId, 'setting_key' => 'onboarding.mandatory'],
                ['setting_value' => '0', 'updated_at' => now()]
            );

        // Create user first — factory create() fires Eloquent observers that can
        // reset TenantContext to 1. We re-pin AFTER create.
        $user = User::factory()->create([
            'tenant_id'            => $this->testTenantId,
            'onboarding_completed' => false,
            'is_admin'             => false,
            'role'                 => 'member',
        ]);

        // Invalidate OnboardingConfigService's own cache key so getConfig() re-reads DB
        \App\Services\OnboardingConfigService::clearConfigCache($this->testTenantId);

        // Re-pin TenantContext after create (observers reset it to tenant 1)
        TenantContext::setById($this->testTenantId);

        $request = Request::create('/v2/listings', 'POST');
        $request->setUserResolver(fn () => $user);

        $response = $this->middleware->handle($request, $this->makeNext());

        // Non-mandatory → should pass through
        $this->assertEquals(200, $response->getStatusCode());
    }

    /**
     * Welcome steps switched OFF, with "must finish" left on from before. The
     * admin page greyed that switch out but kept its value, so new members were
     * never shown the steps and were still refused here (found 13 Nov 2026).
     */
    public function test_a_community_with_the_welcome_steps_switched_off_never_blocks_a_member(): void
    {
        DB::table('tenant_settings')
            ->updateOrInsert(
                ['tenant_id' => $this->testTenantId, 'setting_key' => 'onboarding.enabled'],
                ['setting_value' => '0', 'updated_at' => now()]
            );

        $user = User::factory()->create([
            'tenant_id'            => $this->testTenantId,
            'onboarding_completed' => false,
            'is_admin'             => false,
            'role'                 => 'member',
        ]);

        \App\Services\OnboardingConfigService::clearConfigCache($this->testTenantId);
        TenantContext::setById($this->testTenantId);

        $request = Request::create('/v2/messages', 'POST');
        $request->setUserResolver(fn () => $user);

        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(200, $response->getStatusCode());
    }
}
