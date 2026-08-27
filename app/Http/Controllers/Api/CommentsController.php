<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\I18n\LocaleContext;
use App\Models\Comment;
use App\Models\Notification;
use App\Models\User;
use App\Services\CommentService;
use App\Services\ReactionService;
use App\Services\SocialNotificationService;
use App\Support\FeedItemTables;
use Illuminate\Http\JsonResponse;
use App\Support\UserDisplayName;

/**
 * CommentsController — Eloquent-powered threaded comments with reactions.
 *
 * Fully migrated from legacy delegation to Eloquent via CommentService.
 */
class CommentsController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly CommentService $commentService,
    ) {}

    // -----------------------------------------------------------------
    //  GET /api/v2/comments?target_type=...&target_id=...
    // -----------------------------------------------------------------

    public function index(): JsonResponse
    {
        $targetType = $this->query('target_type') ?? $this->query('commentable_type');
        $targetId = $this->queryInt('target_id') ?? $this->queryInt('commentable_id');

        if (! $targetType || ! $targetId) {
            return $this->respondWithError(
                'VALIDATION_REQUIRED_FIELD',
                __('api.target_type_and_id_required'),
                null,
                400
            );
        }

        $currentUserId = $this->getOptionalUserId() ?? 0;
        $targetType = CommentService::normalizeTargetType((string) $targetType);
        if (!FeedItemTables::isCommentable($targetType) || !FeedItemTables::canView($targetType, $targetId, $currentUserId ?: null)) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.target_not_found'), null, 404);
        }

        $comments = $this->commentService->getForEntity($targetType, $targetId, $currentUserId);
        $count = $this->commentService->countAll($comments);

        return $this->respondWithData([
            'comments' => $comments,
            'count'    => $count,
        ]);
    }

    // -----------------------------------------------------------------
    //  POST /api/v2/comments
    // -----------------------------------------------------------------

    public function store(): JsonResponse
    {
        $userId = $this->getUserId();
        // Rate-limit comment creation per user to block spam/flame floods.
        $this->rateLimit('comments_create', 30, 60);
        $tenantId = $this->getTenantId();

        $data = $this->getAllInput();
        $targetType = $data['target_type'] ?? $data['commentable_type'] ?? null;
        $targetId = isset($data['target_id']) ? (int) $data['target_id'] : null;
        if (!$targetId && isset($data['commentable_id'])) {
            $targetId = (int) $data['commentable_id'];
        }
        $content = trim($data['content'] ?? $data['body'] ?? '');

        if (! $targetType || ! $targetId) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.target_type_and_id_required'), null, 400);
        }

        if (empty($content)) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.comment_text_required'), 'content', 400);
        }

        if (mb_strlen($content) > 10000) {
            return $this->respondWithError('VALIDATION_INVALID_VALUE', __('api.comment_too_long'), 'content', 422);
        }

        $targetType = CommentService::normalizeTargetType((string) $targetType);
        if (!FeedItemTables::isCommentable($targetType) || !FeedItemTables::canView($targetType, $targetId, $userId)) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.target_not_found'), null, 404);
        }

        $data['content'] = $content;

        try {
            $comment = $this->commentService->create($targetType, $targetId, $userId, $tenantId, $data);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        $comment->load('user:id,first_name,last_name,profile_type,organization_name,avatar_url');
        $user = $comment->user;

        return $this->respondWithData([
            'id'             => $comment->id,
            'content'        => $comment->content,
            'created_at'     => $comment->created_at?->toIso8601String(),
            'edited'         => false,
            'is_own'         => true,
            'author'         => [
                'id'     => $userId,
                'name'   => $user ? UserDisplayName::resolve($user) : __('api.unknown_user'),
                'avatar' => $user->avatar_url ?? null,
            ],
            'reactions'      => (object) [],
            'user_reactions' => [],
            'replies'        => [],
        ], null, 201);
    }

    // -----------------------------------------------------------------
    //  PUT /api/v2/comments/{id}
    // -----------------------------------------------------------------

    public function update(int $id): JsonResponse
    {
        $userId = $this->getUserId();
        $this->rateLimit('comments_edit', 30, 60);

        $content = trim($this->input('content', ''));

        if (empty($content)) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.comment_text_required'), 'content', 400);
        }

        try {
            $updatedContent = $this->commentService->update($id, $userId, $content);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if ($updatedContent === null) {
            return $this->respondWithError('RESOURCE_FORBIDDEN', __('api.cannot_edit_comment'), null, 403);
        }

        return $this->respondWithData([
            'id'      => $id,
            'content' => $updatedContent,
            'edited'  => true,
        ]);
    }

    // -----------------------------------------------------------------
    //  DELETE /api/v2/comments/{id}
    // -----------------------------------------------------------------

    public function destroy(int $id): JsonResponse
    {
        $userId = $this->getUserId();
        $this->rateLimit('comments_delete', 30, 60);

        $deletedCount = $this->commentService->delete($id, $userId);

        if ($deletedCount < 1) {
            return $this->respondWithError('RESOURCE_FORBIDDEN', __('api.cannot_delete_comment'), null, 403);
        }

        return $this->respondWithData(['deleted' => true, 'id' => $id, 'deleted_count' => $deletedCount]);
    }

    // -----------------------------------------------------------------
    //  POST /api/v2/comments/{id}/reactions
    // -----------------------------------------------------------------

    public function reactions(int $id): JsonResponse
    {
        $userId = $this->getUserId();
        $tenantId = $this->getTenantId();

        $emoji = $this->input('reaction_type') ?? $this->input('emoji');

        if (! $emoji) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.emoji_required'), 'emoji', 400);
        }

        // Legacy aliases accepted by the pre-unified comment reaction endpoint.
        $emojiMap = [
            'heart'       => 'love',
            'thumbs_up'   => 'like',
            'thumbs_down' => 'sad',
            'angry'       => 'wow',
        ];

        $actualEmoji = $emojiMap[$emoji] ?? $emoji;
        if (!in_array($actualEmoji, ReactionService::VALID_TYPES, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_reaction_type'), 'emoji', 400);
        }

        try {
            $result = $this->commentService->toggleReaction($userId, $tenantId, $id, $actualEmoji);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        // Notify comment author on reaction add (not on remove/update)
        if ($result['action'] === 'added') {
            try {
                $comment = Comment::find($id);
                if ($comment && (int) $comment->tenant_id === TenantContext::getId() && (int) $comment->user_id !== $userId) {
                    $reactor = User::find($userId);
                    $recipient = User::find((int) $comment->user_id);
                    LocaleContext::withLocale($recipient, function () use ($reactor, $comment) {
                        $reactorName = $reactor ? UserDisplayName::resolve($reactor) : __('emails.common.fallback_someone');
                        $message = __('api_controllers_3.comments.reaction', ['name' => $reactorName]);
                        $pushLink = SocialNotificationService::getContentLink('comment', (int) $comment->id);
                        Notification::createNotification(
                            (int) $comment->user_id,
                            $message,
                            $pushLink,
                            'reaction'
                        );
                        \App\Services\NotificationDispatcher::fanOutPush((int) $comment->user_id, 'reaction', $message, $pushLink);
                    });
                }
            } catch (\Throwable $e) {
                \Log::warning('Comment reaction notification failed', ['comment' => $id, 'reactor' => $userId, 'error' => $e->getMessage()]);
            }
        }

        return $this->respondWithData([
            'action'    => $result['action'],
            'emoji'     => $actualEmoji,
            'reaction_type' => $actualEmoji,
            'reactions' => $result['reactions'],
        ]);
    }
}
