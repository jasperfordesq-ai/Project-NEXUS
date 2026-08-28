<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Services\EmailDispatchService;
use App\Services\InactiveMemberService;
use Illuminate\Database\Query\Expression;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

class InactiveMemberServiceTest extends TestCase
{
    private InactiveMemberService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new InactiveMemberService();
        // Service methods use DB::raw() for aggregate SQL expressions
        DB::shouldReceive('raw')->andReturnUsing(fn ($v) => new Expression($v));
    }

    public function test_detectInactive_returns_summary(): void
    {
        DB::shouldReceive('table')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('select')->andReturnSelf();
        DB::shouldReceive('selectRaw')->andReturnSelf();
        DB::shouldReceive('get')->andReturn(collect([]));

        $result = $this->service->detectInactive(2, 90);

        $this->assertArrayHasKey('tenant_id', $result);
        $this->assertArrayHasKey('threshold_days', $result);
        $this->assertArrayHasKey('total_flagged', $result);
        $this->assertArrayHasKey('resolved', $result);
        $this->assertSame(2, $result['tenant_id']);
        $this->assertSame(90, $result['threshold_days']);
    }

    public function test_getInactiveMembers_returns_paginated_results(): void
    {
        DB::shouldReceive('table')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('whereNull')->andReturnSelf();
        DB::shouldReceive('count')->andReturn(0);
        DB::shouldReceive('join')->andReturnSelf();
        DB::shouldReceive('select')->andReturnSelf();
        DB::shouldReceive('orderBy')->andReturnSelf();
        DB::shouldReceive('limit')->andReturnSelf();
        DB::shouldReceive('offset')->andReturnSelf();
        DB::shouldReceive('get')->andReturn(collect([]));

        $result = $this->service->getInactiveMembers(2, 90, null, 50, 0);

        $this->assertArrayHasKey('members', $result);
        $this->assertArrayHasKey('total', $result);
        $this->assertArrayHasKey('threshold_days', $result);
    }

    public function test_getInactiveMembers_clamps_limit(): void
    {
        DB::shouldReceive('table')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('whereNull')->andReturnSelf();
        DB::shouldReceive('count')->andReturn(0);
        DB::shouldReceive('join')->andReturnSelf();
        DB::shouldReceive('select')->andReturnSelf();
        DB::shouldReceive('orderBy')->andReturnSelf();
        DB::shouldReceive('limit')->andReturnSelf();
        DB::shouldReceive('offset')->andReturnSelf();
        DB::shouldReceive('get')->andReturn(collect([]));

        // Should not throw with extreme values
        $result = $this->service->getInactiveMembers(2, 90, null, 999, -5);
        $this->assertIsArray($result);
    }

    public function test_getInactivityStats_returns_summary(): void
    {
        DB::shouldReceive('table')->with('member_activity_flags')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('whereNull')->andReturnSelf();
        DB::shouldReceive('select')->andReturnSelf();
        DB::shouldReceive('first')->andReturn((object) [
            'total_flagged' => 5, 'inactive_count' => 3, 'dormant_count' => 1,
            'at_risk_count' => 1, 'notified_count' => 2,
        ]);

        DB::shouldReceive('table')->with('users')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('count')->andReturn(50);

        $result = $this->service->getInactivityStats(2);

        $this->assertSame(50, $result['total_active_members']);
        $this->assertSame(5, $result['total_flagged']);
        $this->assertSame(0.1, $result['inactivity_rate']);
    }

    public function test_markNotified_empty_ids_returns_zero(): void
    {
        $result = $this->service->markNotified(2, []);
        $this->assertSame(0, $result);
    }

    public function test_cron_runner_uses_inactive_member_service_instance(): void
    {
        $source = file_get_contents(app_path('Services/CronJobRunner.php'));

        $this->assertStringContainsString('app(InactiveMemberService::class)', $source);
        $this->assertStringContainsString('$service->detectInactive($tenantId)', $source);
        $this->assertStringNotContainsString('InactiveMemberService::detectInactive($tenantId)', $source);
    }

    public function test_markNotified_updates_records_after_email_success(): void
    {
        app()->instance(EmailDispatchService::class, new class extends EmailDispatchService {
            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                return true;
            }
        });

        // Tenant-context reads are deliberately NOT count-pinned. markNotified
        // resolves the tenant once via TenantContext::setById() and then again
        // through getSetting('site_name'), getFrontendUrl() and getSlugPrefix()
        // to build the email — four reads today. Asserting an exact number here
        // pinned an implementation detail: hoisting the community name and feed
        // URL out of the per-recipient loop (correct, and fewer queries than
        // doing it per recipient) reded this test without any behaviour changing.
        // What the test is actually for is below: the recipient query, one flag
        // update per member, and the returned count.
        DB::shouldReceive('table')->with('tenants')->atLeast()->once()->andReturnSelf();
        DB::shouldReceive('where')->with('id', 2)->atLeast()->once()->andReturnSelf();
        DB::shouldReceive('first')->atLeast()->once()->andReturn((object) [
            'id' => 2,
            'name' => 'Test Tenant',
            'slug' => 'test-tenant',
            'domain' => null,
            'configuration' => null,
            'is_active' => 1,
        ]);

        DB::shouldReceive('table')->with('users')->once()->andReturnSelf();
        DB::shouldReceive('where')->with('tenant_id', 2)->once()->andReturnSelf();
        DB::shouldReceive('whereIn')->with('id', [1, 2, 3])->once()->andReturnSelf();
        DB::shouldReceive('where')->with('status', 'active')->once()->andReturnSelf();
        DB::shouldReceive('whereNotNull')->with('email')->once()->andReturnSelf();
        DB::shouldReceive('select')->with(['id', 'email', 'first_name', 'name', 'preferred_language'])->once()->andReturnSelf();
        DB::shouldReceive('get')->once()->andReturn(collect([
            (object) ['id' => 1, 'email' => 'one@example.test', 'first_name' => 'One', 'name' => 'One', 'preferred_language' => 'en'],
            (object) ['id' => 2, 'email' => 'two@example.test', 'first_name' => 'Two', 'name' => 'Two', 'preferred_language' => 'en'],
            (object) ['id' => 3, 'email' => 'three@example.test', 'first_name' => 'Three', 'name' => 'Three', 'preferred_language' => 'en'],
        ]));

        DB::shouldReceive('table')->with('member_activity_flags')->times(3)->andReturnSelf();
        DB::shouldReceive('where')->with('tenant_id', 2)->times(3)->andReturnSelf();
        DB::shouldReceive('where')->with('user_id', \Mockery::type('int'))->times(3)->andReturnSelf();
        DB::shouldReceive('whereNull')->with('resolved_at')->times(3)->andReturnSelf();
        DB::shouldReceive('update')->times(3)->andReturn(1);

        $result = $this->service->markNotified(2, [1, 2, 3]);
        $this->assertSame(3, $result);
    }
}
