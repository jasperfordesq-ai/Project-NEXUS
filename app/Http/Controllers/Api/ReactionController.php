<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Exceptions\SafeguardingPolicyException;
use App\Services\ReactionService;
use App\Services\RealtimeService;
use App\Services\SocialNotificationService;
use App\Support\FeedItemTables;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;

/**
 * ReactionController — Handles emoji reactions across the platform.
 *
 * Reactions are polymorphic — any feed item type (post, listing, event, goal,
 * poll, review, volunteer, challenge, resource) plus comments can be reacted to.
 *
 * Canonical endpoints:
 *   POST   /v2/reactions                          — toggle reaction (body: target_type, target_id, reaction_type)
 *   GET    /v2/reactions/{type}/{id}              — get reaction counts
 *   GET    /v2/reactions/{type}/{id}/users/{rxn}  — paginated reactors
 *
 * Legacy aliases (kept for backward compat — thin wrappers):
 *   POST   /v2/posts/{id}/reactions               — toggle on a post
 *   GET    /v2/posts/{id}/reactions               — get post reactions
 *   GET    /v2/posts/{id}/reactions/{type}/users  — post reactors
 *   POST   /v2/comments/{id}/reactions            — toggle on a comment
 *   GET    /v2/comments/{id}/reactions            — get comment reactions
 */
class ReactionController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly ReactionService $reactionService,
    ) {}

    // ========================================================================
    // Polymorphic Reactions (canonical)
    // ========================================================================

    /**
     * POST /v2/reactions
     *
     * Toggle a reaction on any reactable entity.
     * Body: { "target_type": "post|listing|event|...", "target_id": int, "reaction_type": "love" }
     */
    public function toggle(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('reaction_toggle', 120, 60);

        $targetType   = (string) $this->input('target_type');
        $targetId     = (int) $this->input('target_id');
        $reactionType = (string) $this->input('reaction_type');

        return $this->doToggle($userId, $targetType, $targetId, $reactionType);
    }

    /**
     * GET /v2/reactions/{type}/{id}
     */
    public function show(string $type, int $id): JsonResponse
    {
        return $this->doShow($type, $id);
    }

    /**
     * GET /v2/reactions/{type}/{id}/users/{reactionType}
     */
    public function reactors(string $type, int $id, string $reactionType): JsonResponse
    {
        return $this->doReactors($type, $id, $reactionType);
    }

    // ========================================================================
    // Post Reactions (legacy — delegate to polymorphic implementation)
    // ========================================================================

    /**
     * POST /v2/posts/{id}/reactions
     *
     * Toggle a reaction on a post. Body: { "reaction_type": "love" }
     */
    public function togglePostReaction(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('reaction_toggle', 120, 60);

        $reactionType = (string) $this->input('reaction_type');

        return $this->doToggle($userId, 'post', $id, $reactionType);
    }

    /**
     * GET /v2/posts/{id}/reactions
     */
    public function getPostReactions(int $id): JsonResponse
    {
        return $this->doShow('post', $id);
    }

    /**
     * GET /v2/posts/{id}/reactions/{type}/users
     */
    public function getPostReactors(int $id, string $type): JsonResponse
    {
        return $this->doReactors('post', $id, $type);
    }

    // ========================================================================
    // Comment Reactions
    // ========================================================================

    /**
     * POST /v2/comments/{id}/reactions
     *
     * Toggle a reaction on a comment. Body: { "reaction_type": "love" }
     */
    public function toggleCommentReaction(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('reaction_toggle', 120, 60);

        $reactionType = (string) $this->input('reaction_type');

        return $this->doToggle($userId, 'comment', $id, $reactionType);
    }

    /**
     * GET /v2/comments/{id}/reactions
     */
    public function getCommentReactions(int $id): JsonResponse
    {
        return $this->doShow('comment', $id);
    }

    // ========================================================================
    // Shared toggle/show/reactors implementation
    // ========================================================================

    private function doToggle(int $userId, string $targetType, int $targetId, string $reactionType): JsonResponse
    {
        if (empty($reactionType) || !in_array($reactionType, ReactionService::VALID_TYPES, true)) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.invalid_reaction_type_allowed', ['types' => implode(', ', ReactionService::VALID_TYPES)]),
                'reaction_type',
                400
            );
        }

        if (!in_array($targetType, ReactionService::VALID_TARGET_TYPES, true)) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.invalid_target_type_allowed', ['types' => implode(', ', ReactionService::VALID_TARGET_TYPES)]),
                'target_type',
                400
            );
        }

        if ($targetId <= 0) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.target_id_positive'), 'target_id', 400);
        }

        // Loud-failure guard: verify (target_type, target_id) resolves to a
        // real row in the right tenant before recording the reaction. Without
        // this check, a misrouted client (e.g. POSTing target_type='post' with
        // a listing's ID) would silently succeed and pollute the reactions
        // table with rows that never read back. This is the structural fix
        // that turns the "reactions don't persist" class of bug into a 404.
        if (!$this->targetExists($targetType, $targetId, $userId)) {
            return $this->respondWithError(
                'NOT_FOUND',
                __('api.target_not_found'),
                null,
                404
            );
        }

        try {
            $result = $this->reactionService->toggleReaction($targetId, $targetType, $reactionType, $userId);

            if ($result['action'] === 'added') {
                $this->notifyReaction($userId, $targetType, $targetId, $reactionType);
            }

            return $this->respondWithData($result);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('NOT_FOUND', __('api.target_not_found'), null, 404);
        } catch (\Exception $e) {
            return $this->respondWithError('REACTION_ERROR', __('api.reaction_toggle_failed'), null, 500);
        }
    }

    private function doShow(string $targetType, int $id): JsonResponse
    {
        if (!in_array($targetType, ReactionService::VALID_TARGET_TYPES, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.social_invalid_target_type'), 'target_type', 400);
        }
        $userId = $this->getOptionalUserId();

        if (!$this->targetExists($targetType, $id, $userId)) {
            return $this->respondWithError('NOT_FOUND', __('api.target_not_found'), null, 404);
        }

        try {
            $reactions = $this->reactionService->getReactions($id, $targetType, $userId);
            return $this->respondWithData($reactions);
        } catch (\Exception $e) {
            return $this->respondWithError('REACTION_ERROR', __('api.failed_fetch_reactions'), null, 500);
        }
    }

    private function doReactors(string $targetType, int $id, string $reactionType): JsonResponse
    {
        if (!in_array($targetType, ReactionService::VALID_TARGET_TYPES, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.social_invalid_target_type'), 'target_type', 400);
        }
        if (!in_array($reactionType, ReactionService::VALID_TYPES, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_reaction_type'), 'type', 400);
        }

        $userId = $this->getOptionalUserId();
        if (!$this->targetExists($targetType, $id, $userId)) {
            return $this->respondWithError('NOT_FOUND', __('api.target_not_found'), null, 404);
        }

        $page = $this->queryInt('page', 1, 1);
        $perPage = $this->queryInt('per_page', 20, 1, 50);

        try {
            $result = $this->reactionService->getReactors($id, $targetType, $reactionType, $page, $perPage, $userId);
            return $this->respondWithPaginatedCollection(
                $result['users'],
                $result['total'],
                $page,
                $perPage
            );
        } catch (\Exception $e) {
            return $this->respondWithError('REACTION_ERROR', __('api.failed_get_reactors'), null, 500);
        }
    }

    /**
     * Map of reactable target_type → backing table for tenant-scoped existence
     * checks. MUST stay in sync with ReactionService::VALID_TARGET_TYPES.
     *
     * Returning false for any unknown type is a fail-closed default — if the
     * type ever drifts, the request 404s rather than silently writing to the
     * polymorphic reactions table.
     */
    private function targetExists(string $targetType, int $targetId, ?int $viewerId): bool
    {
        if (!in_array($targetType, ReactionService::VALID_TARGET_TYPES, true)) {
            return false;
        }
        return FeedItemTables::canView($targetType, $targetId, $viewerId);
    }

    // ========================================================================
    // Private Helpers
    // ========================================================================

    /**
     * Send a notification + Pusher broadcast when a user reacts to content.
     *
     * Non-critical: wrapped in try-catch so notification failures don't block
     * the reaction response.
     */
    private function notifyReaction(int $actorId, string $targetType, int $targetId, string $reactionType): void
    {
        try {
            $contentOwnerId = SocialNotificationService::getContentOwnerId($targetType, $targetId);

            // Don't notify if reacting to own content
            if (!$contentOwnerId || $contentOwnerId === $actorId) {
                return;
            }

            // Create in-app notification (bell icon)
            SocialNotificationService::notifyLike(
                $contentOwnerId,
                $actorId,
                $targetType,
                $targetId,
                $reactionType
            );

            // Broadcast to Pusher for real-time update
            RealtimeService::broadcastNotification($contentOwnerId, [
                'type' => 'reaction',
                'target_type' => $targetType,
                'target_id' => $targetId,
                'reaction_type' => $reactionType,
                'actor_id' => $actorId,
            ]);
        } catch (\Throwable $e) {
            Log::debug("Reaction notification error (non-critical): " . $e->getMessage());
        }
    }
}
