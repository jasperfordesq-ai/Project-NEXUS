<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\RegionalAnalytics;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * AG59 — Super-admin POST /super-admin/regional-analytics/subscriptions/{id}/generate-report
 * must enqueue / call the artisan command and return queued=true.
 */
class GenerateReportTest extends TestCase
{
    use DatabaseTransactions;

    public function test_generate_report_returns_queued_for_valid_subscription(): void
    {
        if (! Schema::hasTable('regional_analytics_subscriptions')) {
            $this->markTestSkipped('Regional analytics tables not present.');
        }

        $admin = User::factory()->forTenant($this->testTenantId)->create([
            'is_super_admin' => true,
            // Platform team only since 15 Nov 2026 (E-128).
            'is_god' => true,
            'role' => 'super_admin',
            'is_verified' => true,
            'is_approved' => true,
        ]);
        Sanctum::actingAs($admin);

        $subId = DB::table('regional_analytics_subscriptions')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'partner_name' => 'Report Test Partner',
            'partner_type' => 'municipality',
            'contact_email' => 'report-test@example.com',
            'plan_tier' => 'basic',
            'status' => 'active',
            'subscription_token' => Str::random(64),
            'monthly_price_cents' => 29900,
            'currency' => 'CHF',
            'enabled_modules' => json_encode(['trends']),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->postJson('/api/super-admin/regional-analytics/subscriptions/' . $subId . '/generate-report');

        $response->assertStatus(200);
        $response->assertJsonPath('data.queued', true);
        $response->assertJsonPath('data.subscription_id', $subId);
    }

    public function test_generate_report_404s_on_unknown_subscription(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->create([
            'is_super_admin' => true,
            // Platform team only since 15 Nov 2026 (E-128).
            'is_god' => true,
            'role' => 'super_admin',
            'is_verified' => true,
            'is_approved' => true,
        ]);
        Sanctum::actingAs($admin);

        $response = $this->postJson('/api/super-admin/regional-analytics/subscriptions/999999/generate-report');
        $response->assertStatus(404);
    }
}
