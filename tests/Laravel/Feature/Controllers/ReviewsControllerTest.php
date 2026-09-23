<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\Review;
use App\Models\User;
use App\Services\EmailDispatchService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for ReviewsController — create, list, delete.
 */
class ReviewsControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function authenticatedUser(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    // ------------------------------------------------------------------
    //  USER REVIEWS
    // ------------------------------------------------------------------

    public function test_user_reviews_returns_list(): void
    {
        $user = $this->authenticatedUser();
        $other = User::factory()->forTenant($this->testTenantId)->create();

        Review::factory()->forTenant($this->testTenantId)->create([
            'reviewer_id' => $user->id,
            'receiver_id' => $other->id,
        ]);

        $response = $this->apiGet("/v2/reviews/user/{$other->id}");

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_user_reviews_returns_empty_for_no_reviews(): void
    {
        $this->authenticatedUser();
        $other = User::factory()->forTenant($this->testTenantId)->create();

        $response = $this->apiGet("/v2/reviews/user/{$other->id}");

        $response->assertStatus(200);
    }

    public function test_user_reviews_alternate_route(): void
    {
        $this->authenticatedUser();
        $other = User::factory()->forTenant($this->testTenantId)->create();

        $response = $this->apiGet("/v2/users/{$other->id}/reviews");

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  USER STATS
    // ------------------------------------------------------------------

    public function test_user_stats_returns_data(): void
    {
        $this->authenticatedUser();
        $other = User::factory()->forTenant($this->testTenantId)->create();

        $response = $this->apiGet("/v2/reviews/user/{$other->id}/stats");

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ------------------------------------------------------------------
    //  SHOW
    // ------------------------------------------------------------------

    public function test_show_returns_review(): void
    {
        $this->authenticatedUser();
        // F-073: show() returns published reviews only to non-parties. The
        // factory's default status ('published') is not a value of the
        // reviews.status enum, so state a real published status explicitly.
        $review = Review::factory()->forTenant($this->testTenantId)->create(['status' => 'approved']);

        $response = $this->apiGet("/v2/reviews/{$review->id}");

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_show_returns_404_for_nonexistent(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/reviews/999999');

        $response->assertStatus(404);
    }

    // ------------------------------------------------------------------
    //  CREATE
    // ------------------------------------------------------------------

    public function test_can_create_review(): void
    {
        $user = $this->authenticatedUser();
        $other = User::factory()->forTenant($this->testTenantId)->create();

        $response = $this->apiPost('/v2/reviews', [
            'receiver_id' => $other->id,
            'rating' => 5,
            'comment' => 'Excellent exchange! Very helpful.',
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201]);
    }

    public function test_create_review_sends_one_receiver_email_and_bell(): void
    {
        $user = $this->authenticatedUser([
            'first_name' => 'Reviewer',
        ]);
        $other = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'review-receiver-' . uniqid('', true) . '@example.test',
            'preferred_language' => 'en',
        ]);

        $mailer = new class extends EmailDispatchService {
            public array $calls = [];

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                $this->calls[] = compact('to', 'subject', 'body', 'options');

                return true;
            }
        };
        app()->instance(EmailDispatchService::class, $mailer);

        $response = $this->apiPost('/v2/reviews', [
            'receiver_id' => $other->id,
            'rating' => 5,
            'comment' => 'Excellent exchange! Very helpful.',
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201]);

        $this->assertDatabaseHas('notifications', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $other->id,
            'type' => 'review',
            'link' => '/reviews',
        ]);

        $this->assertCount(1, $mailer->calls);
        $this->assertSame($other->email, $mailer->calls[0]['to']);
        $this->assertSame('review', $mailer->calls[0]['options']['category']);
        $this->assertSame($this->testTenantId, $mailer->calls[0]['options']['tenant_id']);
    }

    public function test_create_requires_authentication(): void
    {
        $response = $this->apiPost('/v2/reviews', [
            'receiver_id' => 1,
            'rating' => 5,
            'comment' => 'Unauthorized review.',
        ]);

        $response->assertStatus(401);
    }

    public function test_create_fails_without_required_fields(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/reviews', []);

        $this->assertContains($response->getStatusCode(), [400, 422]);
    }

    public function test_create_fails_with_invalid_rating(): void
    {
        $user = $this->authenticatedUser();
        $other = User::factory()->forTenant($this->testTenantId)->create();

        $response = $this->apiPost('/v2/reviews', [
            'receiver_id' => $other->id,
            'rating' => 10, // Out of 1-5 range
            'comment' => 'Invalid rating.',
        ]);

        $this->assertContains($response->getStatusCode(), [400, 422]);
    }

    public function test_cannot_review_self(): void
    {
        $user = $this->authenticatedUser();

        $response = $this->apiPost('/v2/reviews', [
            'receiver_id' => $user->id,
            'rating' => 5,
            'comment' => 'Self review.',
        ]);

        $response->assertStatus(400);
    }

    public function test_cannot_create_duplicate_review(): void
    {
        $user = $this->authenticatedUser();
        $other = User::factory()->forTenant($this->testTenantId)->create();

        Review::factory()->forTenant($this->testTenantId)->create([
            'reviewer_id' => $user->id,
            'receiver_id' => $other->id,
            'transaction_id' => null,
            'created_at' => now(),
        ]);

        $response = $this->apiPost('/v2/reviews', [
            'receiver_id' => $other->id,
            'rating' => 4,
            'comment' => 'Duplicate review.',
        ]);

        $response->assertStatus(409);
    }

    // ------------------------------------------------------------------
    //  DELETE
    // ------------------------------------------------------------------

    public function test_author_can_delete_review(): void
    {
        $user = $this->authenticatedUser();
        $other = User::factory()->forTenant($this->testTenantId)->create();

        $review = Review::factory()->forTenant($this->testTenantId)->create([
            'reviewer_id' => $user->id,
            'receiver_id' => $other->id,
        ]);

        $response = $this->apiDelete("/v2/reviews/{$review->id}");

        $this->assertContains($response->getStatusCode(), [200, 204]);
    }

    public function test_author_delete_marks_deleted_by_author_at(): void
    {
        $user = $this->authenticatedUser();
        $other = User::factory()->forTenant($this->testTenantId)->create();

        $review = Review::factory()->forTenant($this->testTenantId)->create([
            'reviewer_id' => $user->id,
            'receiver_id' => $other->id,
            'status' => 'approved',
        ]);

        $response = $this->apiDelete("/v2/reviews/{$review->id}");

        $this->assertContains($response->getStatusCode(), [200, 204]);

        $row = \Illuminate\Support\Facades\DB::table('reviews')->where('id', $review->id)->first();
        $this->assertNotNull($row);
        $this->assertSame('rejected', $row->status);
        $this->assertNotNull($row->deleted_by_author_at, 'Author delete must set deleted_by_author_at');
    }

    public function test_non_author_cannot_delete_review(): void
    {
        $author = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();
        $review = Review::factory()->forTenant($this->testTenantId)->create([
            'reviewer_id' => $author->id,
            'receiver_id' => $receiver->id,
        ]);

        $this->authenticatedUser(); // Different user

        $response = $this->apiDelete("/v2/reviews/{$review->id}");

        $response->assertStatus(403);
    }

    public function test_delete_nonexistent_review_returns_404(): void
    {
        $this->authenticatedUser();

        $response = $this->apiDelete('/v2/reviews/999999');

        $response->assertStatus(404);
    }

    public function test_delete_requires_authentication(): void
    {
        $review = Review::factory()->forTenant($this->testTenantId)->create();

        $response = $this->apiDelete("/v2/reviews/{$review->id}");

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  PENDING
    // ------------------------------------------------------------------

    public function test_pending_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/reviews/pending');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_pending_requires_authentication(): void
    {
        $response = $this->apiGet('/v2/reviews/pending');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  GIVEN (reviews written by the current user)
    // ------------------------------------------------------------------

    public function test_given_returns_only_own_written_reviews(): void
    {
        $user = $this->authenticatedUser();
        $other = User::factory()->forTenant($this->testTenantId)->create();

        $mine = Review::factory()->forTenant($this->testTenantId)->create([
            'reviewer_id' => $user->id,
            'receiver_id' => $other->id,
            'status' => 'approved',
        ]);

        // Written by someone else — must NOT appear in my given list.
        $theirs = Review::factory()->forTenant($this->testTenantId)->create([
            'reviewer_id' => $other->id,
            'receiver_id' => $user->id,
            'status' => 'approved',
        ]);

        $response = $this->apiGet('/v2/reviews/given');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data', 'meta']);

        $ids = array_column($response->json('data'), 'id');
        $this->assertContains($mine->id, $ids);
        $this->assertNotContains($theirs->id, $ids);

        // Receiver block describes the member the review is about.
        $item = collect($response->json('data'))->firstWhere('id', $mine->id);
        $this->assertSame($other->id, (int) $item['receiver']['id']);
    }

    public function test_given_excludes_author_deleted_reviews(): void
    {
        $user = $this->authenticatedUser();
        $other = User::factory()->forTenant($this->testTenantId)->create();

        $deleted = Review::factory()->forTenant($this->testTenantId)->create([
            'reviewer_id' => $user->id,
            'receiver_id' => $other->id,
            'status' => 'rejected',
        ]);
        // deleted_by_author_at is not in $fillable — set it directly.
        \Illuminate\Support\Facades\DB::table('reviews')
            ->where('id', $deleted->id)
            ->update(['deleted_by_author_at' => now()]);

        $kept = Review::factory()->forTenant($this->testTenantId)->create([
            'reviewer_id' => $user->id,
            'receiver_id' => $other->id,
            'status' => 'approved',
        ]);

        $response = $this->apiGet('/v2/reviews/given');

        $response->assertStatus(200);
        $ids = array_column($response->json('data'), 'id');
        $this->assertContains($kept->id, $ids);
        $this->assertNotContains($deleted->id, $ids, 'Author-deleted reviews must not appear in the given list');
    }

    public function test_given_is_tenant_scoped(): void
    {
        $user = $this->authenticatedUser();

        $crossTenant = Review::factory()->forTenant(999)->create([
            'reviewer_id' => $user->id, // Same reviewer ID in another tenant
        ]);

        $response = $this->apiGet('/v2/reviews/given');

        $response->assertStatus(200);
        $ids = array_column($response->json('data'), 'id');
        $this->assertNotContains($crossTenant->id, $ids, 'Given list must be tenant-scoped');
    }

    public function test_given_requires_authentication(): void
    {
        $response = $this->apiGet('/v2/reviews/given');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  TENANT ISOLATION
    // ------------------------------------------------------------------

    public function test_cannot_see_other_tenant_review(): void
    {
        $this->authenticatedUser();
        $otherReview = Review::factory()->forTenant(999)->create();

        $response = $this->apiGet("/v2/reviews/{$otherReview->id}");

        $response->assertStatus(404);
    }

    public function test_cannot_delete_other_tenant_review(): void
    {
        $user = $this->authenticatedUser();
        $otherReview = Review::factory()->forTenant(999)->create([
            'reviewer_id' => $user->id, // Even if user ID matches, tenant should isolate
        ]);

        $response = $this->apiDelete("/v2/reviews/{$otherReview->id}");

        $this->assertContains($response->getStatusCode(), [403, 404]);
    }
}
