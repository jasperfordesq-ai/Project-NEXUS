<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E073;

use App\Core\FederationApiMiddleware;
use App\Models\User;
use App\Services\ReviewService;
use App\Services\SafeguardingInteractionPolicy;
use App\Support\SafeguardingInteractionDecision;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\Laravel\Concerns\EnablesExternalFederation;
use Tests\Laravel\TestCase;

/**
 * F-441 (E-073, slice D finding D-2) — the v1 partner API wrote approved,
 * publicly-counted reviews on any local member with no checks at all.
 *
 * `FederationController::createReview()` took `transaction_id` and
 * `reviewer_id` straight from the body and inserted
 * `review_type='federated', status='approved', show_cross_tenant=1`. Because
 * `reviews.reviewer_id` carries a foreign key to `users.id`, the row was
 * attributed to a real local member who did not write it, and
 * `ReviewService::getStats()` counts federated rows, so every planted row moved
 * that member's public average.
 *
 * The fix brings this path up to the platform's own local standard
 * (`ReviewService::create()`, which names review-bombing in its own comment):
 * a review must name a real exchange in the reviewee's community, both named
 * parties must be parties of that exchange, and the same pair cannot be
 * reviewed twice for the same exchange.
 */
final class F441V1PartnerInboundReviewRequiresExchangeTest extends TestCase
{
    use DatabaseTransactions;
    use EnablesExternalFederation;

    protected function setUp(): void
    {
        parent::setUp();
        $this->enableExternalFederation();
        FederationApiMiddleware::reset();
        $this->allowSafeguarding();
    }

    protected function tearDown(): void
    {
        FederationApiMiddleware::reset();
        unset($_SERVER['HTTP_X_API_KEY']);
        parent::tearDown();
    }

    // ------------------------------------------------------------------
    //  THE HARM
    // ------------------------------------------------------------------

    public function test_a_review_with_no_exchange_behind_it_is_refused(): void
    {
        $victim = $this->federatedMember();
        $attributedTo = $this->federatedMember();
        $apiKey = $this->partnerApiKey('f441-a');

        $before = app(ReviewService::class)->getStats((int) $victim->id);

        for ($i = 0; $i < 5; $i++) {
            $this->useKey($apiKey);
            $response = $this->apiPost('/v1/federation/reviews', [
                'reviewer_id' => (int) $attributedTo->id,
                'reviewee_id' => (int) $victim->id,
                'rating' => 1,
                'comment' => 'f441 review bomb ' . $i,
            ], ['X-API-Key' => $apiKey]);

            $this->assertSame(400, $response->status(), (string) $response->getContent());
            $response->assertJsonPath('code', 'TRANSACTION_REQUIRED');
        }

        $this->assertSame(
            0,
            DB::table('reviews')->where('receiver_id', (int) $victim->id)->where('comment', 'like', 'f441 review bomb%')->count(),
            'nothing was written',
        );

        $after = app(ReviewService::class)->getStats((int) $victim->id);
        $this->assertSame($before['total'], $after['total'], 'the public review total did not move');
        $this->assertSame($before['average'], $after['average'], 'the public average did not move');
    }

    public function test_a_review_borrowing_an_exchange_between_two_other_members_is_refused(): void
    {
        $victim = $this->federatedMember();
        $attributedTo = $this->federatedMember();
        $strangerA = $this->federatedMember();
        $strangerB = $this->federatedMember();
        $apiKey = $this->partnerApiKey('f441-b');

        $foreignTransactionId = $this->exchange($strangerA, $strangerB);

        $this->useKey($apiKey);
        $response = $this->apiPost('/v1/federation/reviews', [
            'reviewer_id' => (int) $attributedTo->id,
            'reviewee_id' => (int) $victim->id,
            'rating' => 1,
            'comment' => 'f441 borrowed exchange',
            'transaction_id' => $foreignTransactionId,
        ], ['X-API-Key' => $apiKey]);

        $this->assertSame(403, $response->status(), (string) $response->getContent());
        $response->assertJsonPath('code', 'NOT_TRANSACTION_PARTY');

        $this->assertDatabaseMissing('reviews', [
            'receiver_id' => (int) $victim->id,
            'comment' => 'f441 borrowed exchange',
        ]);

        // The platform's own local path refuses the identical attachment, and
        // its message names the reason this control exists.
        $this->actingAsTenantMember($attributedTo);
        $refused = null;
        try {
            app(ReviewService::class)->create((int) $attributedTo->id, [
                'receiver_id' => (int) $victim->id,
                'rating' => 1,
                'comment' => 'local attempt at the same thing',
                'transaction_id' => $foreignTransactionId,
            ]);
        } catch (\Throwable $e) {
            $refused = $e->getMessage();
        }
        $this->assertNotNull($refused);
        $this->assertStringContainsString('only review the other party', (string) $refused);
    }

    public function test_a_transaction_in_another_community_cannot_be_borrowed(): void
    {
        $victim = $this->federatedMember();
        $attributedTo = $this->federatedMember();
        $apiKey = $this->partnerApiKey('f441-c');

        $foreignTenantId = $this->otherTenantId();
        $foreignTransactionId = (int) DB::table('transactions')->insertGetId([
            'tenant_id' => $foreignTenantId,
            'sender_id' => (int) $attributedTo->id,
            'receiver_id' => (int) $victim->id,
            'amount' => 1,
            'description' => 'f441c foreign-tenant exchange',
            'transaction_type' => 'exchange',
            'status' => 'completed',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->useKey($apiKey);
        $response = $this->apiPost('/v1/federation/reviews', [
            'reviewer_id' => (int) $attributedTo->id,
            'reviewee_id' => (int) $victim->id,
            'rating' => 1,
            'comment' => 'f441c cross-community borrow',
            'transaction_id' => $foreignTransactionId,
        ], ['X-API-Key' => $apiKey]);

        $this->assertSame(403, $response->status(), (string) $response->getContent());
        $this->assertDatabaseMissing('reviews', [
            'comment' => 'f441c cross-community borrow',
        ]);
    }

    public function test_the_same_exchange_cannot_be_reviewed_twice(): void
    {
        $reviewer = $this->federatedMember();
        $reviewee = $this->federatedMember();
        $apiKey = $this->partnerApiKey('f441-d');
        $transactionId = $this->exchange($reviewer, $reviewee);

        $this->useKey($apiKey);
        $this->apiPost('/v1/federation/reviews', [
            'reviewer_id' => (int) $reviewer->id,
            'reviewee_id' => (int) $reviewee->id,
            'rating' => 5,
            'comment' => 'f441d first',
            'transaction_id' => $transactionId,
        ], ['X-API-Key' => $apiKey])->assertStatus(201);

        $this->useKey($apiKey);
        $second = $this->apiPost('/v1/federation/reviews', [
            'reviewer_id' => (int) $reviewer->id,
            'reviewee_id' => (int) $reviewee->id,
            'rating' => 1,
            'comment' => 'f441d duplicate',
            'transaction_id' => $transactionId,
        ], ['X-API-Key' => $apiKey]);

        $this->assertSame(409, $second->status(), (string) $second->getContent());
        $second->assertJsonPath('code', 'DUPLICATE_REVIEW');

        $this->assertSame(
            1,
            DB::table('reviews')
                ->where('receiver_id', (int) $reviewee->id)
                ->where('transaction_id', $transactionId)
                ->count(),
            'exactly one review survives for the exchange',
        );
    }

    // ------------------------------------------------------------------
    //  LEGITIMATE ACCESS — a real exchange still produces a review
    // ------------------------------------------------------------------

    public function test_control_a_review_of_a_genuine_exchange_between_the_two_parties_is_accepted(): void
    {
        $reviewer = $this->federatedMember();
        $reviewee = $this->federatedMember();
        $apiKey = $this->partnerApiKey('f441-e');
        $transactionId = $this->exchange($reviewer, $reviewee);

        $before = app(ReviewService::class)->getStats((int) $reviewee->id);

        $this->useKey($apiKey);
        $response = $this->apiPost('/v1/federation/reviews', [
            'reviewer_id' => (int) $reviewer->id,
            'reviewee_id' => (int) $reviewee->id,
            'rating' => 5,
            'comment' => 'f441e genuine review',
            'transaction_id' => $transactionId,
        ], ['X-API-Key' => $apiKey]);

        $this->assertSame(201, $response->status(), (string) $response->getContent());

        $this->assertDatabaseHas('reviews', [
            'receiver_id' => (int) $reviewee->id,
            'reviewer_id' => (int) $reviewer->id,
            'transaction_id' => $transactionId,
            'status' => 'approved',
            'review_type' => 'federated',
        ]);

        $after = app(ReviewService::class)->getStats((int) $reviewee->id);
        $this->assertSame($before['total'] + 1, $after['total'], 'the feature still works');
    }

    // ------------------------------------------------------------------
    //  The gates this endpoint already had must still fire
    // ------------------------------------------------------------------

    public function test_control_self_review_and_the_members_own_opt_out_still_refuse(): void
    {
        $member = $this->federatedMember();
        $apiKey = $this->partnerApiKey('f441-f');

        $this->useKey($apiKey);
        $self = $this->apiPost('/v1/federation/reviews', [
            'reviewer_id' => (int) $member->id,
            'reviewee_id' => (int) $member->id,
            'rating' => 5,
        ], ['X-API-Key' => $apiKey]);
        $this->assertSame(400, $self->status(), (string) $self->getContent());
        $self->assertJsonPath('code', 'SELF_REVIEW');

        $optedOut = $this->federatedMember();
        DB::table('federation_user_settings')
            ->where('user_id', (int) $optedOut->id)
            ->update(['show_reviews_federated' => 0]);
        $transactionId = $this->exchange($member, $optedOut);

        $this->useKey($apiKey);
        $refused = $this->apiPost('/v1/federation/reviews', [
            'reviewer_id' => (int) $member->id,
            'reviewee_id' => (int) $optedOut->id,
            'rating' => 1,
            'comment' => 'f441f must not persist',
            'transaction_id' => $transactionId,
        ], ['X-API-Key' => $apiKey]);
        $this->assertSame(403, $refused->status(), (string) $refused->getContent());
        $refused->assertJsonPath('code', 'REVIEWS_DISABLED');
        $this->assertDatabaseMissing('reviews', ['comment' => 'f441f must not persist']);
    }

    // ------------------------------------------------------------------
    //  Fixtures
    // ------------------------------------------------------------------

    private function exchange(User $sender, User $receiver): int
    {
        return (int) DB::table('transactions')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => (int) $sender->id,
            'receiver_id' => (int) $receiver->id,
            'amount' => 1,
            'description' => 'f441 exchange ' . bin2hex(random_bytes(4)),
            'transaction_type' => 'exchange',
            'status' => 'completed',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function otherTenantId(): int
    {
        $row = DB::table('tenants')->where('id', '!=', $this->testTenantId)->first(['id']);
        if ($row) {
            return (int) $row->id;
        }

        return (int) DB::table('tenants')->insertGetId([
            'name' => 'F441 other community',
            'slug' => 'f441-other-' . bin2hex(random_bytes(4)),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function actingAsTenantMember(User $user): void
    {
        FederationApiMiddleware::reset();
        unset($_SERVER['HTTP_X_API_KEY']);
        \App\Core\TenantContext::setById($this->testTenantId);
        \Laravel\Sanctum\Sanctum::actingAs($user, ['*']);
    }

    private function federatedMember(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        DB::table('federation_user_settings')->updateOrInsert(
            ['user_id' => (int) $user->id],
            [
                'federation_optin' => 1,
                'profile_visible_federated' => 1,
                'appear_in_federated_search' => 1,
                'messaging_enabled_federated' => 1,
                'transactions_enabled_federated' => 1,
                'show_reviews_federated' => 1,
                'updated_at' => now(),
            ],
        );

        return $user;
    }

    private function partnerApiKey(string $platformId): string
    {
        $apiKey = $platformId . '-' . bin2hex(random_bytes(10));
        DB::table('federation_api_keys')->insert([
            'tenant_id' => $this->testTenantId,
            'name' => 'F-441 ' . $platformId,
            'key_hash' => hash('sha256', $apiKey),
            'key_prefix' => substr($apiKey, 0, 8),
            'signing_enabled' => 0,
            'platform_id' => $platformId,
            'permissions' => json_encode(['reviews:write']),
            'rate_limit' => 100000,
            'status' => 'active',
            'created_by' => 1,
            'created_at' => now(),
            'updated_at' => now(),
            'hourly_request_count' => 0,
        ]);

        return $apiKey;
    }

    private function useKey(string $apiKey): void
    {
        FederationApiMiddleware::reset();
        $_SERVER['HTTP_X_API_KEY'] = $apiKey;
        $_SERVER['REQUEST_METHOD'] = 'POST';
        $_SERVER['REQUEST_URI'] = '/api/v1/federation/reviews';
        $_SERVER['REMOTE_ADDR'] = '127.0.0.1';
    }

    private function allowSafeguarding(): void
    {
        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('evaluateExternalContact')->andReturn($this->allowDecision());
        $policy->shouldReceive('evaluateCrossTenantContact')->andReturn($this->allowDecision());
        $policy->shouldReceive('evaluateLocalContact')->andReturn($this->allowDecision());
        $policy->shouldReceive('assertLocalContactAllowed')->andReturnNull();
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);
    }

    private function allowDecision(): SafeguardingInteractionDecision
    {
        return new SafeguardingInteractionDecision(
            status: SafeguardingInteractionDecision::ALLOW,
            code: 'ALLOWED',
            recipientTenantId: $this->testTenantId,
            purposeCode: 'safeguarded_member_contact',
            scopeType: 'tenant',
            scopeIdentifier: '',
            policyVersion: 'e074-e',
        );
    }
}
