<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\PartnerApi;

use App\Services\PartnerApi\PartnerApiAuthService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * AG60 — Tests PartnerApiAuth middleware.
 *
 *   - Missing / invalid Bearer token → 401
 *   - Valid token without required scope → 403
 *   - Valid token with required scope → 200
 */
class PartnerAuthMiddlewareTest extends TestCase
{
    use DatabaseTransactions;

    private int $partnerId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->partnerId = (int) DB::table('api_partners')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Scope Test Partner',
            'slug' => 'scope-test-' . uniqid(),
            'status' => 'active',
            'is_sandbox' => false,
            // Has aggregates.read but NOT users.read
            'allowed_scopes' => json_encode(['aggregates.read']),
            'allowed_ip_cidrs' => json_encode([]),
            'rate_limit_per_minute' => 60,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // F-175: the Partner API is now gated by the per-tenant `partner_api` feature.
        $features = json_decode((string) (DB::table('tenants')->where('id', $this->testTenantId)->value('features') ?: '{}'), true) ?: [];
        $features['partner_api'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
    }

    public function test_missing_bearer_token_returns_401(): void
    {
        $response = $this->getJson('/api/partner/v1/aggregates/community');

        $response->assertStatus(401);
        $response->assertJsonPath('errors.0.code', 'invalid_token');
    }

    public function test_invalid_bearer_token_returns_401(): void
    {
        $response = $this->getJson('/api/partner/v1/aggregates/community', [
            'Authorization' => 'Bearer at_obviously_not_real_token_xxxxxxxxxxxxxxxx',
        ]);

        $response->assertStatus(401);
        $response->assertJsonPath('errors.0.code', 'invalid_token');
    }

    public function test_valid_token_without_required_scope_returns_403(): void
    {
        $partner = (array) DB::table('api_partners')->where('id', $this->partnerId)->first();
        $token = PartnerApiAuthService::issueAccessToken($partner)['access_token'];

        // /users requires users.read scope; this partner only has aggregates.read
        $response = $this->getJson('/api/partner/v1/users', [
            'Authorization' => "Bearer {$token}",
        ]);

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'insufficient_scope');
    }

    public function test_valid_token_with_required_scope_returns_200(): void
    {
        $partner = (array) DB::table('api_partners')->where('id', $this->partnerId)->first();
        $token = PartnerApiAuthService::issueAccessToken($partner)['access_token'];

        // /aggregates/community requires aggregates.read which this partner has
        $response = $this->getJson('/api/partner/v1/aggregates/community', [
            'Authorization' => "Bearer {$token}",
        ]);

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'data' => [
                'tenant_id',
                'active_members_bucket',
                'active_listings_bucket',
                'generated_at',
            ],
        ]);
    }
}
