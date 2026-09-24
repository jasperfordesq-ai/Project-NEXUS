<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\PartnerApi;

use App\Services\PartnerApi\PartnerApiRateLimiter;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * AG60 — Tests the per-partner rate limiter and the 429 path through
 * the PartnerApiAuth middleware.
 */
class RateLimitTest extends TestCase
{
    use DatabaseTransactions;

    public function test_rate_limiter_allows_up_to_limit_then_blocks(): void
    {
        Cache::flush();

        $partnerId = 99001;
        $limit = 60;

        $allowedCount = 0;
        for ($i = 0; $i < $limit; $i++) {
            $r = PartnerApiRateLimiter::hit($partnerId, $limit);
            if ($r['allowed']) {
                $allowedCount++;
            }
        }
        $this->assertSame($limit, $allowedCount, 'First 60 requests should all be allowed');

        // The 61st must be blocked
        $blocked = PartnerApiRateLimiter::hit($partnerId, $limit);
        $this->assertFalse($blocked['allowed'], '61st request must be rate-limited');
        $this->assertSame(0, $blocked['remaining']);
        $this->assertGreaterThan(0, $blocked['retry_after']);
        $this->assertSame($limit, $blocked['limit']);
    }

    public function test_middleware_returns_429_when_partner_exceeds_minute_limit(): void
    {
        Cache::flush();

        $partnerId = (int) DB::table('api_partners')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Rate Limited Partner',
            'slug' => 'rl-partner-' . uniqid(),
            'status' => 'active',
            'is_sandbox' => false,
            'allowed_scopes' => json_encode(['aggregates.read']),
            'allowed_ip_cidrs' => json_encode([]),
            'rate_limit_per_minute' => 1, // tiny so the second call trips the limiter
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // F-175: the Partner API is now gated by the per-tenant `partner_api` feature.
        $features = json_decode((string) (DB::table('tenants')->where('id', $this->testTenantId)->value('features') ?: '{}'), true) ?: [];
        $features['partner_api'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);

        $partner = (array) DB::table('api_partners')->where('id', $partnerId)->first();
        $token = \App\Services\PartnerApi\PartnerApiAuthService::issueAccessToken($partner)['access_token'];

        $first = $this->getJson('/api/partner/v1/aggregates/community', [
            'Authorization' => "Bearer {$token}",
        ]);
        $first->assertStatus(200);

        $second = $this->getJson('/api/partner/v1/aggregates/community', [
            'Authorization' => "Bearer {$token}",
        ]);
        $second->assertStatus(429);
        $second->assertJsonPath('errors.0.code', 'rate_limited');
        $second->assertHeader('Retry-After');
    }
}
