<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Exceptions\SafeguardingPolicyException;
use App\Services\ReviewService;
use App\Support\Members\MemberProfileVisibility;
use Illuminate\Http\JsonResponse;
use Illuminate\Validation\ValidationException;

/**
 * ReviewsController - User reviews for completed exchanges.
 *
 * Endpoints (v2):
 *   GET    /api/v2/reviews/pending               pending()
 *   GET    /api/v2/reviews/given                 given()
 *   GET    /api/v2/reviews/user/{userId}        userReviews()
 *   GET    /api/v2/reviews/user/{userId}/stats   userStats()
 *   GET    /api/v2/reviews/{id}                  show()
 *   POST   /api/v2/reviews                       store()
 *   DELETE /api/v2/reviews/{id}                  destroy()
 */
class ReviewsController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly ReviewService $reviewService,
    ) {}

    // -----------------------------------------------------------------
    //  GET /api/v2/reviews/pending
    // -----------------------------------------------------------------

    public function pending(): JsonResponse
    {
        $userId = $this->requireAuth();

        $filters = ['limit' => $this->queryInt('per_page', 20, 1, 100)];

        // Optional: resolve a single transaction's pending review. Used by the
        // review-request email deep link (/reviews/create?transaction_id=…) so
        // the target is found even when the user has many pending reviews.
        if ($this->query('transaction_id')) {
            $filters['transaction_id'] = $this->queryInt('transaction_id');
        }

        $result = $this->reviewService->getPendingReviews($userId, $filters);

        return $this->respondWithData($result['items'] ?? [], $result['meta'] ?? null);
    }

    // -----------------------------------------------------------------
    //  GET /api/v2/reviews/given
    // -----------------------------------------------------------------

    /**
     * List reviews WRITTEN BY the current user with cursor pagination.
     *
     * Excludes reviews the author has deleted (deleted_by_author_at set).
     * Query params: per_page (default 20, max 100), cursor.
     */
    public function given(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('reviews_given', 60, 60);

        $filters = [
            'limit' => $this->queryInt('per_page', 20, 1, 100),
        ];
        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }

        $result = $this->reviewService->getGivenByUser($userId, $filters);

        return $this->respondWithCollection(
            $result['items'],
            $result['cursor'] ?? null,
            $filters['limit'],
            $result['has_more'] ?? false
        );
    }

    // -----------------------------------------------------------------
    //  GET /api/v2/reviews/user/{userId}
    // -----------------------------------------------------------------

    /**
     * List reviews for a specific user with cursor pagination.
     *
     * Query params: per_page (default 20, max 100), cursor.
     */
    public function userReviews(int $userId): JsonResponse
    {
        $this->rateLimit('reviews_list', 60, 60);

        // F-081: the reviews a member has received are part of their profile,
        // so their privacy_profile choice applies exactly as on the profile
        // page (same 404 and code).
        if (! MemberProfileVisibility::canView($userId, $this->getOptionalUserId())) {
            return $this->respondWithError('PROFILE_PRIVATE', __('api.user_profile_private'), null, 404);
        }

        $filters = [
            'limit' => $this->queryInt('per_page', 20, 1, 100),
        ];
        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }

        $result = $this->reviewService->getForUser($userId, $filters);

        return $this->respondWithCollection(
            $result['items'],
            $result['cursor'] ?? null,
            $filters['limit'],
            $result['has_more'] ?? false
        );
    }

    // -----------------------------------------------------------------
    //  GET /api/v2/reviews/user/{userId}/stats
    // -----------------------------------------------------------------

    /**
     * Get review statistics for a user (average, total, distribution).
     */
    public function userStats(int $userId): JsonResponse
    {
        $this->rateLimit('reviews_stats', 120, 60);

        $stats = $this->reviewService->getStats($userId);

        return $this->respondWithData($stats);
    }

    // -----------------------------------------------------------------
    //  GET /api/v2/reviews/{id}
    // -----------------------------------------------------------------

    /**
     * Get a single review by ID.
     */
    public function show(int $id): JsonResponse
    {
        $this->rateLimit('reviews_show', 120, 60);

        $review = $this->reviewService->getById($id);

        if ($review === null) {
            return $this->respondWithError('NOT_FOUND', __('api.review_not_found'), null, 404);
        }

        return $this->respondWithData($review);
    }

    // -----------------------------------------------------------------
    //  POST /api/v2/reviews
    // -----------------------------------------------------------------

    /**
     * Create a review. Requires authentication.
     *
     * Body: receiver_id, rating (1-5), comment, transaction_id (optional).
     */
    public function store(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('review_create', 10, 60);

        try {
            $review = $this->reviewService->create($userId, $this->getAllInput());
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        } catch (ValidationException $e) {
            $errors = collect($e->errors())->flatMap(function (array $messages, string $field) {
                return array_map(fn (string $msg) => [
                    'code'    => 'VALIDATION_ERROR',
                    'message' => $msg,
                    'field'   => $field,
                ], $messages);
            })->values()->all();

            return $this->respondWithErrors($errors, 422);
        } catch (\RuntimeException $e) {
            $msg = $e->getMessage();
            $code = 'VALIDATION_ERROR';
            $status = 400;

            if (str_contains($msg, 'yourself')) {
                $status = 400;
            } elseif (str_contains($msg, 'already reviewed')) {
                $status = 409;
            }

            return $this->respondWithError($code, $msg, null, $status);
        }

        // Award XP for leaving a review
        try {
            \App\Services\GamificationService::awardXP($userId, \App\Services\GamificationService::XP_VALUES['leave_review'], 'leave_review', 'Left a review');
        } catch (\Throwable $e) {
            \Log::warning('Gamification XP award failed', ['action' => 'leave_review', 'user' => $userId, 'error' => $e->getMessage()]);
        }

        // Record feed activity
        try {
            app(\App\Services\FeedActivityService::class)->recordActivity(
                \App\Core\TenantContext::getId(),
                $userId,
                'review',
                (int) ($review['id'] ?? 0),
                [
                    'content'  => $review['comment'] ?? null,
                    'metadata' => [
                        'rating'      => $review['rating'] ?? null,
                        'receiver_id' => $review['receiver_id'] ?? null,
                    ],
                ]
            );
        } catch (\Throwable $e) {
            \Log::warning('Feed activity recording failed', ['type' => 'review', 'id' => $review['id'] ?? 0, 'error' => $e->getMessage()]);
        }

        return $this->respondWithData($review, null, 201);
    }

    // -----------------------------------------------------------------
    //  DELETE /api/v2/reviews/{id}
    // -----------------------------------------------------------------

    /**
     * Delete a review. Only the review author may delete.
     */
    public function destroy(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('reviews_delete', 10, 60);

        $existing = $this->reviewService->getById($id);

        if ($existing === null) {
            return $this->respondWithError('NOT_FOUND', __('api.review_not_found'), null, 404);
        }

        if ((int) ($existing['reviewer_id'] ?? 0) !== $userId) {
            return $this->respondWithError('FORBIDDEN', __('api.not_review_author'), null, 403);
        }

        $this->reviewService->delete($id);

        return $this->noContent();
    }
}
