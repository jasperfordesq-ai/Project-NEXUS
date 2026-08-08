<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\CaringCommunity;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\CaringCommunity\HelpRequestSlaService;
use App\Services\CaringCommunity\OperatingPolicyService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for AG96 — Help Request SLA Breach Dashboard.
 *
 * Uses Carbon::setTestNow() to make age-based breach assertions deterministic.
 * Help requests are seeded directly via DB::table() because the
 * caring_help_requests table has no factory yet.
 */
class HelpRequestSlaDashboardTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        $this->setCaringCommunityFeature($this->testTenantId, true);

        // Wipe any seed data so each test sees an empty tenant.
        DB::table('caring_help_requests')->where('tenant_id', $this->testTenantId)->delete();
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow(); // reset
        parent::tearDown();
    }

    private function setCaringCommunityFeature(int $tenantId, bool $enabled): void
    {
        $tenant = DB::table('tenants')->where('id', $tenantId)->first();
        $features = [];
        if ($tenant && !empty($tenant->features)) {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : $tenant->features;
            $features = is_array($decoded) ? $decoded : [];
        }
        $features['caring_community'] = $enabled;
        DB::table('tenants')
            ->where('id', $tenantId)
            ->update(['features' => json_encode($features)]);
        TenantContext::setById($tenantId);
    }

    private function makeAdmin(int $tenantId): User
    {
        return User::factory()->forTenant($tenantId)->admin()->create();
    }

    private function makeMember(int $tenantId): User
    {
        return User::factory()->forTenant($tenantId)->create();
    }

    /**
     * Seed a help request with explicit timestamps so SLA buckets are
     * deterministic.
     */
    private function seedHelpRequest(
        int $tenantId,
        int $userId,
        string $status,
        Carbon $createdAt,
        ?Carbon $updatedAt = null,
        string $what = 'Need a hand at home',
    ): int {
        $updatedAt ??= $createdAt;

        return (int) DB::table('caring_help_requests')->insertGetId([
            'tenant_id'          => $tenantId,
            'user_id'            => $userId,
            'what'               => $what,
            'when_needed'        => 'asap',
            'contact_preference' => 'either',
            'status'             => $status,
            'created_at'         => $createdAt,
            'updated_at'         => $updatedAt,
        ]);
    }

    public function test_admin_can_fetch_dashboard(): void
    {
        $admin = $this->makeAdmin($this->testTenantId);
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/caring-community/sla-dashboard');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'data' => [
                'policy' => ['first_response_hours', 'resolution_hours', 'source'],
                'summary' => [
                    'pending',
                    'in_progress',
                    'first_response_breached',
                    'first_response_at_risk',
                    'resolution_breached',
                    'resolution_at_risk',
                    'resolved_within_window_24h',
                ],
                'open_requests',
                'recently_resolved',
                'generated_at',
            ],
        ]);
    }

    public function test_non_admin_member_gets_403(): void
    {
        $member = $this->makeMember($this->testTenantId);
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/caring-community/sla-dashboard');

        $response->assertStatus(403);
    }

    public function test_returns_403_when_caring_community_feature_disabled(): void
    {
        $this->setCaringCommunityFeature($this->testTenantId, false);

        $admin = $this->makeAdmin($this->testTenantId);
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/caring-community/sla-dashboard');

        $response->assertStatus(403);
    }

    public function test_empty_tenant_returns_zero_counts(): void
    {
        Carbon::setTestNow('2026-05-01 12:00:00');

        $service = app(HelpRequestSlaService::class);
        $dashboard = $service->dashboard($this->testTenantId);

        $this->assertSame(0, $dashboard['summary']['pending']);
        $this->assertSame(0, $dashboard['summary']['in_progress']);
        $this->assertSame(0, $dashboard['summary']['first_response_breached']);
        $this->assertSame(0, $dashboard['summary']['first_response_at_risk']);
        $this->assertSame(0, $dashboard['summary']['resolution_breached']);
        $this->assertSame(0, $dashboard['summary']['resolution_at_risk']);
        $this->assertSame(0, $dashboard['summary']['resolved_within_window_24h']);
        $this->assertSame([], $dashboard['open_requests']);
        $this->assertSame([], $dashboard['recently_resolved']);
    }

    public function test_breached_first_response_appears_first_with_breached_bucket(): void
    {
        Carbon::setTestNow('2026-05-01 12:00:00');
        $now = Carbon::now();

        // Wipe any tenant-level policy so we get the platform default 24h SLA.
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'like', OperatingPolicyService::KEY_PREFIX . '%')
            ->delete();

        $reporter = $this->makeMember($this->testTenantId);

        // 30h ago — over the 24h first-response SLA → breached.
        $breachedId = $this->seedHelpRequest(
            $this->testTenantId,
            $reporter->id,
            'pending',
            $now->copy()->subHours(30),
            null,
            'Breached request',
        );

        // 2h ago — well under 24h × 0.75 = 18h → on_track.
        $onTrackId = $this->seedHelpRequest(
            $this->testTenantId,
            $reporter->id,
            'pending',
            $now->copy()->subHours(2),
            null,
            'Fresh request',
        );

        // Carbon v3 regression guard: before the fix this call threw a TypeError
        // (a float age was handed to bucket(int)) and inverted the age sign. The
        // dashboard now ages requests correctly against the 24h first-response SLA.
        $service = app(HelpRequestSlaService::class);
        $dashboard = $service->dashboard($this->testTenantId);

        $this->assertSame(2, $dashboard['summary']['pending']);
        $this->assertSame(1, $dashboard['summary']['first_response_breached']);
        $this->assertSame(0, $dashboard['summary']['first_response_at_risk']);

        $this->assertCount(2, $dashboard['open_requests']);

        $first = $dashboard['open_requests'][0];
        $this->assertSame($breachedId, (int) $first['id']);
        $this->assertSame('breached', $first['bucket']);
        $this->assertSame('first_response', $first['sla_dimension']);
        $this->assertSame(24, (int) $first['sla_target_hours']);

        $second = $dashboard['open_requests'][1];
        $this->assertSame($onTrackId, (int) $second['id']);
        $this->assertSame('on_track', $second['bucket']);
    }

    public function test_recently_resolved_shows_within_resolution_sla(): void
    {
        Carbon::setTestNow('2026-05-01 12:00:00');
        $now = Carbon::now();

        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'like', OperatingPolicyService::KEY_PREFIX . '%')
            ->delete();

        $reporter = $this->makeMember($this->testTenantId);

        // Created 36h ago, closed 12h ago. Turnaround = 24h, under the
        // platform-default 72h resolution SLA. Closed within the 72h
        // recently-resolved window, so it should appear in that list.
        $closedId = $this->seedHelpRequest(
            $this->testTenantId,
            $reporter->id,
            'closed',
            $now->copy()->subHours(36),
            $now->copy()->subHours(12),
            'Closed within window',
        );

        $service = app(HelpRequestSlaService::class);
        $dashboard = $service->dashboard($this->testTenantId);

        $this->assertCount(
            1,
            $dashboard['recently_resolved'],
            'Closed-within-72h request must surface in recently_resolved'
        );
        $row = $dashboard['recently_resolved'][0];
        $this->assertSame($closedId, (int) $row['id']);
        $this->assertSame('closed', $row['status']);

        // Turnaround = updated(-12h) − created(-36h) = 24h, within the 72h
        // platform-default resolution SLA. (Regression guard for the Carbon v3
        // signed-diff fix: the service now measures created → updated, so this
        // reports the real 24h rather than the old, always-zero value.)
        $this->assertTrue(
            (bool) $row['within_resolution_sla'],
            'Closed turnaround (24h) is within the 72h resolution SLA window'
        );
        $this->assertSame(
            24.0,
            (float) $row['turnaround_hours'],
            'Turnaround must be the real 24h (updated −12h minus created −36h)'
        );
    }

    public function test_policy_source_starts_as_platform_defaults_then_flips_to_tenant_policy(): void
    {
        // Strip any pre-existing operating-policy rows for the tenant so the
        // service genuinely sees a fresh tenant.
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'like', OperatingPolicyService::KEY_PREFIX . '%')
            ->delete();

        $service = app(HelpRequestSlaService::class);

        $before = $service->dashboard($this->testTenantId);
        $this->assertSame('platform_defaults', $before['policy']['source']);
        $this->assertSame(24, (int) $before['policy']['first_response_hours']);
        $this->assertSame(72, (int) $before['policy']['resolution_hours']);

        // Apply a real tenant-level policy update via the canonical service.
        $policyService = app(OperatingPolicyService::class);
        $result = $policyService->update($this->testTenantId, [
            'sla_first_response_hours' => 12,
            'sla_help_request_hours'   => 48,
        ]);
        $this->assertArrayNotHasKey('errors', $result, 'Policy update must succeed');

        $after = $service->dashboard($this->testTenantId);
        $this->assertSame('tenant_policy', $after['policy']['source']);
        $this->assertSame(12, (int) $after['policy']['first_response_hours']);
        $this->assertSame(48, (int) $after['policy']['resolution_hours']);
    }
}
