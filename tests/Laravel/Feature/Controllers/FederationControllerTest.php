<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Core\FederationApiMiddleware;
use App\Models\User;
use App\Services\SafeguardingInteractionPolicy;
use App\Support\SafeguardingInteractionDecision;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\Laravel\TestCase;
use Tests\Laravel\Concerns\EnablesExternalFederation;

/**
 * Feature tests for FederationController — V1 federation API.
 *
 * V1 federation endpoints use Federation API key auth (not Sanctum). The
 * directory index (`/v1/federation`) is public by design so partners can
 * discover endpoints. All protected endpoints require an `X-API-Key` header;
 * without it they respond 401 MISSING_API_KEY.
 */
class FederationControllerTest extends TestCase
{
    use DatabaseTransactions;

    use EnablesExternalFederation;

    protected function setUp(): void
    {
        parent::setUp();
        $this->enableExternalFederation();
        FederationApiMiddleware::reset();
    }

    protected function tearDown(): void
    {
        FederationApiMiddleware::reset();
        unset($_SERVER['HTTP_X_API_KEY']);
        parent::tearDown();
    }

    private function authenticatedUser(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);
        return $user;
    }

    // ------------------------------------------------------------------
    //  GET /v1/federation (index) — public directory, no auth required
    // ------------------------------------------------------------------

    public function test_federation_index_is_public_and_returns_api_info(): void
    {
        $response = $this->apiGet('/v1/federation');

        $response->assertStatus(200);
        $response->assertJsonFragment(['api' => 'Federation API']);
    }

    // ------------------------------------------------------------------
    //  GET /v1/federation/timebanks (requires Federation API key)
    // ------------------------------------------------------------------

    public function test_timebanks_rejects_request_without_api_key(): void
    {
        $response = $this->apiGet('/v1/federation/timebanks');

        $response->assertStatus(401);
        $response->assertJsonFragment(['code' => 'MISSING_API_KEY']);
    }

    public function test_timebanks_rejects_user_without_federation_api_key(): void
    {
        // Authenticated Sanctum user but no X-API-Key → still 401 MISSING_API_KEY
        $this->authenticatedUser();

        $response = $this->apiGet('/v1/federation/timebanks');

        $response->assertStatus(401);
        $response->assertJsonFragment(['code' => 'MISSING_API_KEY']);
    }

    // ------------------------------------------------------------------
    //  GET /v1/federation/members
    // ------------------------------------------------------------------

    public function test_federation_members_rejects_request_without_api_key(): void
    {
        $response = $this->apiGet('/v1/federation/members');

        $response->assertStatus(401);
        $response->assertJsonFragment(['code' => 'MISSING_API_KEY']);
    }

    public function test_federation_members_rejects_user_without_federation_api_key(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v1/federation/members');

        $response->assertStatus(401);
        $response->assertJsonFragment(['code' => 'MISSING_API_KEY']);
    }

    // ------------------------------------------------------------------
    //  GET /v1/federation/listings
    // ------------------------------------------------------------------

    public function test_federation_listings_rejects_request_without_api_key(): void
    {
        $response = $this->apiGet('/v1/federation/listings');

        $response->assertStatus(401);
        $response->assertJsonFragment(['code' => 'MISSING_API_KEY']);
    }

    public function test_federation_listings_rejects_user_without_federation_api_key(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v1/federation/listings');

        $response->assertStatus(401);
        $response->assertJsonFragment(['code' => 'MISSING_API_KEY']);
    }

    public function test_create_review_cross_tenant_denial_returns_403_without_write(): void
    {
        $reviewer = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $reviewee = User::factory()->forTenant(999)->create(['status' => 'active']);
        $this->enableFederatedReviews((int) $reviewer->id);
        $this->enableFederatedReviews((int) $reviewee->id);
        DB::table('federation_partnerships')->insert([
            'tenant_id' => $this->testTenantId,
            'partner_tenant_id' => 999,
            'status' => 'active',
            'federation_level' => 1,
            'requested_at' => now(),
            'created_at' => now(),
        ]);
        $apiKey = $this->createFederationApiKey($this->testTenantId);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('evaluateCrossTenantContact')
            ->once()
            ->with(
                (int) $reviewer->id,
                $this->testTenantId,
                (int) $reviewee->id,
                999,
                'federated_review_v1',
            )
            ->andReturn($this->safeguardingDenied(999));
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $response = $this->apiPost('/v1/federation/reviews', [
            'reviewer_id' => $reviewer->id,
            'reviewee_id' => $reviewee->id,
            'rating' => 5,
            'comment' => 'Must not persist',
        ], ['X-API-Key' => $apiKey]);

        $this->assertSame(403, $response->status(), $response->getContent());
        $response->assertJsonPath('code', 'VETTING_REQUIRED');
        $this->assertDatabaseMissing('reviews', [
            'reviewer_id' => $reviewer->id,
            'receiver_id' => $reviewee->id,
            'comment' => 'Must not persist',
        ]);
    }

    public function test_create_review_external_policy_unavailable_returns_503_without_write(): void
    {
        $reviewee = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->enableFederatedReviews((int) $reviewee->id);
        $apiKey = $this->createFederationApiKey($this->testTenantId, 'timeoverflow-test');
        $remoteReviewerId = 900001;

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('evaluateExternalContact')
            ->once()
            ->with(
                (int) $reviewee->id,
                $this->testTenantId,
                "federation-v1:timeoverflow-test:reviewer:{$remoteReviewerId}",
                'federated_review_v1',
            )
            ->andReturn($this->safeguardingUnavailable($this->testTenantId));
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $response = $this->apiPost('/v1/federation/reviews', [
            'reviewer_id' => $remoteReviewerId,
            'reviewee_id' => $reviewee->id,
            'rating' => 4,
        ], ['X-API-Key' => $apiKey]);

        $this->assertSame(503, $response->status(), $response->getContent());
        $response->assertJsonPath('code', 'SAFEGUARDING_POLICY_UNAVAILABLE');
        $this->assertDatabaseMissing('reviews', [
            'reviewer_id' => $remoteReviewerId,
            'receiver_id' => $reviewee->id,
        ]);
    }

    private function createFederationApiKey(int $tenantId, ?string $platformId = null): string
    {
        $apiKey = 'federation-review-' . bin2hex(random_bytes(10));
        DB::table('federation_api_keys')->insert([
            'tenant_id' => $tenantId,
            'name' => 'Federated Review Test Key',
            'key_hash' => hash('sha256', $apiKey),
            'key_prefix' => substr($apiKey, 0, 8),
            'signing_enabled' => 0,
            'platform_id' => $platformId,
            'permissions' => json_encode(['reviews:write']),
            'rate_limit' => 1000,
            'status' => 'active',
            'created_by' => 1,
            'created_at' => now(),
            'updated_at' => now(),
            'hourly_request_count' => 0,
        ]);

        // FederationApiMiddleware is a legacy static boundary that reads the
        // PHP superglobal directly rather than Laravel's Request header bag.
        $_SERVER['HTTP_X_API_KEY'] = $apiKey;
        $_SERVER['REQUEST_METHOD'] = 'POST';
        $_SERVER['REQUEST_URI'] = '/api/v1/federation/reviews';
        $_SERVER['REMOTE_ADDR'] = '127.0.0.1';

        return $apiKey;
    }

    private function enableFederatedReviews(int $userId): void
    {
        DB::table('federation_user_settings')->updateOrInsert(
            ['user_id' => $userId],
            [
                'federation_optin' => 1,
                'show_reviews_federated' => 1,
                'updated_at' => now(),
            ],
        );
    }

    private function safeguardingDenied(int $recipientTenantId): SafeguardingInteractionDecision
    {
        return new SafeguardingInteractionDecision(
            status: SafeguardingInteractionDecision::DENY,
            code: 'VETTING_REQUIRED',
            recipientTenantId: $recipientTenantId,
            purposeCode: 'safeguarded_member_contact',
            scopeType: 'tenant',
            scopeIdentifier: '',
            policyVersion: 'test-v1',
            requiredAttestationCodes: ['dbs_enhanced'],
            requiredAttestationLabels: ['Enhanced DBS'],
            canRequestCoordinator: true,
        );
    }

    private function safeguardingUnavailable(int $recipientTenantId): SafeguardingInteractionDecision
    {
        return new SafeguardingInteractionDecision(
            status: SafeguardingInteractionDecision::UNAVAILABLE,
            code: 'SAFEGUARDING_POLICY_UNAVAILABLE',
            recipientTenantId: $recipientTenantId,
            purposeCode: 'safeguarded_member_contact',
            scopeType: 'tenant',
            scopeIdentifier: '',
            canRequestCoordinator: true,
        );
    }
}
