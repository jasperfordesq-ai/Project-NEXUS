<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\CaringCommunity;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\CaringCommunity\CaringCommunityAlertService;
use App\Services\CaringCommunity\CaringCommunityForecastService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

class CaringCommunityForecastTest extends TestCase
{
    use DatabaseTransactions;

    private function setCaringCommunityFeature(bool $enabled): void
    {
        $tenant = DB::table('tenants')->where('id', $this->testTenantId)->first();
        $features = [];
        if ($tenant && !empty($tenant->features)) {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : $tenant->features;
            $features = is_array($decoded) ? $decoded : [];
        }
        $features['caring_community'] = $enabled;
        DB::table('tenants')
            ->where('id', $this->testTenantId)
            ->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);
    }

    /**
     * Insert approved vol_logs for a single user, one log per month.
     * $values is keyed by months-ago (5 = 5 months ago, 0 = current month).
     *
     * @param array<int, float> $values
     */
    private function seedHoursOverMonths(int $userId, array $values): void
    {
        foreach ($values as $monthsAgo => $hours) {
            $date = date('Y-m-15', strtotime("first day of -{$monthsAgo} month"));
            DB::table('vol_logs')->insert([
                'tenant_id' => $this->testTenantId,
                'user_id' => $userId,
                'date_logged' => $date,
                'hours' => $hours,
                'description' => 'Test seed',
                'status' => 'approved',
                'created_at' => $date . ' 09:00:00',
            ]);
        }
    }

    public function test_forecast_returns_growing_trend_when_hours_increasing(): void
    {
        $this->markTestSkipped(
            'Quarantine [isolation-debt]: order-dependent — passes in full-suite run order, fails when run in a sharded subset under CI. Re-enable after fixing test isolation. Tracked in PR #130.'
        );

        $this->setCaringCommunityFeature(true);
        TenantContext::setById($this->testTenantId);
        $member = User::factory()->forTenant($this->testTenantId)->create();
        // months 5..0 increasing 10 -> 60
        $this->seedHoursOverMonths($member->id, [5 => 10, 4 => 20, 3 => 30, 2 => 40, 1 => 50, 0 => 60]);

        $service = app(CaringCommunityForecastService::class);
        $result = $service->forecastHours(3);

        $this->assertSame('growing', $result['trend']);
        $this->assertGreaterThan(0, $result['growth_rate_pct']);
        $this->assertCount(3, $result['forecast']);
        // First forecast point should be above the most recent history point
        $lastHistory = end($result['history'])['hours'];
        $this->assertGreaterThan($lastHistory * 0.9, $result['forecast'][0]['hours']);
    }

    public function test_forecast_returns_declining_trend_when_hours_dropping(): void
    {
        $this->markTestSkipped(
            'Quarantine [isolation-debt]: order-dependent — passes in full-suite run order, fails when run in a sharded subset under CI. Re-enable after fixing test isolation. Tracked in PR #130.'
        );

        $this->setCaringCommunityFeature(true);
        TenantContext::setById($this->testTenantId);
        $member = User::factory()->forTenant($this->testTenantId)->create();
        // months 5..0 declining 60 -> 10
        $this->seedHoursOverMonths($member->id, [5 => 60, 4 => 50, 3 => 40, 2 => 30, 1 => 20, 0 => 10]);

        $service = app(CaringCommunityForecastService::class);
        $result = $service->forecastHours(3);

        $this->assertSame('declining', $result['trend']);
        $this->assertLessThan(0, $result['growth_rate_pct']);
    }

    public function test_forecast_returns_stable_when_hours_flat(): void
    {
        $this->setCaringCommunityFeature(true);
        TenantContext::setById($this->testTenantId);
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $this->seedHoursOverMonths($member->id, [5 => 25, 4 => 25, 3 => 25, 2 => 25, 1 => 25, 0 => 25]);

        $service = app(CaringCommunityForecastService::class);
        $result = $service->forecastHours(3);

        $this->assertSame('stable', $result['trend']);
        $this->assertEqualsWithDelta(0.0, $result['growth_rate_pct'], 1.0);
    }

    public function test_alerts_surface_recipients_without_tandem(): void
    {
        $this->markTestSkipped(
            'Quarantine [isolation-debt]: order-dependent — passes in full-suite run order, fails when run in a sharded subset under CI. Re-enable after fixing test isolation. Tracked in PR #130.'
        );

        $this->setCaringCommunityFeature(true);
        TenantContext::setById($this->testTenantId);

        $supporter = User::factory()->forTenant($this->testTenantId)->create();
        $recipient = User::factory()->forTenant($this->testTenantId)->create();

        DB::table('vol_logs')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $supporter->id,
            'support_recipient_id' => $recipient->id,
            'date_logged' => date('Y-m-d', strtotime('-2 months')),
            'hours' => 3.0,
            'description' => 'Helped neighbour',
            'status' => 'approved',
            'created_at' => now(),
        ]);
        // Note: no caring_support_relationships row → alert should fire.

        $service = app(CaringCommunityAlertService::class);
        $alerts = $service->activeAlerts();
        $ids = array_column($alerts, 'id');

        $this->assertContains('recipients_without_tandem', $ids);
        $alert = collect($alerts)->firstWhere('id', 'recipients_without_tandem');
        $this->assertGreaterThanOrEqual(1, $alert['count']);
        $this->assertSame('warning', $alert['severity']);
    }

    public function test_alerts_surface_overdue_reviews(): void
    {
        $this->markTestSkipped(
            'Quarantine [isolation-debt]: order-dependent — passes in full-suite run order, fails when run in a sharded subset under CI. Re-enable after fixing test isolation. Tracked in PR #130.'
        );

        $this->setCaringCommunityFeature(true);
        TenantContext::setById($this->testTenantId);

        $member = User::factory()->forTenant($this->testTenantId)->create();
        // Pending log created 30 days ago (well past default 7-day SLA)
        DB::table('vol_logs')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'date_logged' => date('Y-m-d', strtotime('-30 days')),
            'hours' => 2.0,
            'description' => 'Old pending',
            'status' => 'pending',
            'created_at' => date('Y-m-d H:i:s', strtotime('-30 days')),
        ]);

        $service = app(CaringCommunityAlertService::class);
        $alerts = $service->activeAlerts();
        $ids = array_column($alerts, 'id');

        $this->assertContains('overdue_reviews', $ids);
        $alert = collect($alerts)->firstWhere('id', 'overdue_reviews');
        $this->assertGreaterThanOrEqual(1, $alert['count']);
    }

    public function test_alerts_skip_signals_with_zero_count(): void
    {
        $this->setCaringCommunityFeature(true);
        TenantContext::setById($this->testTenantId);

        // Wipe any seed data the tenant might already have so all signals
        // legitimately come back zero.
        DB::table('vol_logs')->where('tenant_id', $this->testTenantId)->delete();
        if (Schema::hasTable('caring_support_relationships')) {
            DB::table('caring_support_relationships')->where('tenant_id', $this->testTenantId)->delete();
        }
        if (Schema::hasTable('listings')) {
            DB::table('listings')->where('tenant_id', $this->testTenantId)->delete();
        }

        $service = app(CaringCommunityAlertService::class);
        $alerts = $service->activeAlerts();

        // The list must not contain any zero-count entries (it can be empty).
        $this->assertIsArray($alerts);
        foreach ($alerts as $alert) {
            $this->assertGreaterThan(0, $alert['count'], "Alert {$alert['id']} surfaced with zero count.");
        }
    }

    public function test_forecast_endpoint_returns_403_when_feature_disabled(): void
    {
        $this->setCaringCommunityFeature(false);
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/caring-community/forecast');

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');
    }
}
