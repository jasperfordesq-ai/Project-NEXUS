<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Exceptions\SafeguardingPolicyException;
use Illuminate\Http\JsonResponse;
use App\I18n\LocaleContext;
use App\Services\MessageService;
use App\Services\StoryService;
use App\Models\Notification;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * StoryController — API endpoints for the Stories feature (24-hour disappearing content).
 *
 * Handles story CRUD, viewing, reactions, polls, and highlights.
 * All endpoints require authentication (auth:sanctum middleware).
 */
class StoryController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly StoryService $storyService,
    ) {}

    /**
     * GET /api/v2/stories — Get story feed (story bar data)
     */
    public function index(): JsonResponse
    {
        $userId = $this->requireAuth();

        try {
            $stories = $this->storyService->getFeedStories($userId);
            return $this->respondWithData($stories);
        } catch (\Throwable $e) {
            Log::error('StoryController::index failed', ['error' => $e->getMessage()]);
            return $this->respondWithError('STORIES_FETCH_FAILED', __('api.stories_fetch_failed'), null, 500);
        }
    }

    /**
     * GET /api/v2/stories/user/{userId} — Get specific user's stories
     */
    public function userStories(int $userId): JsonResponse
    {
        $viewerId = $this->requireAuth();

        try {
            $stories = $this->storyService->getUserStories($userId, $viewerId);
            return $this->respondWithData($stories);
        } catch (\Throwable $e) {
            Log::error('StoryController::userStories failed', ['error' => $e->getMessage()]);
            return $this->respondWithError('STORIES_FETCH_FAILED', __('api.user_stories_fetch_failed'), null, 500);
        }
    }

    /**
     * POST /api/v2/stories — Create a story
     *
     * Accepts multipart/form-data (for image stories) or JSON (for text/poll stories).
     */
    public function store(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('stories.create', 10, 60);

        $request = request();

        $mediaType = $request->input('media_type', 'image');

        // Validate audience
        $audience = $request->input('audience', 'everyone');
        if (!in_array($audience, ['everyone', 'connections', 'close_friends'])) {
            $audience = 'everyone';
        }

        $data = [
            'media_type' => $mediaType,
            'text_content' => $request->input('text_content'),
            'background_color' => $request->input('background_color'),
            'background_gradient' => $request->input('background_gradient'),
            'duration' => $request->input('duration', 5),
            'audience' => $audience,
        ];

        // Handle text_style (may come as JSON string or array)
        $textStyle = $request->input('text_style');
        if (is_string($textStyle)) {
            $decoded = json_decode($textStyle, true);
            if (json_last_error() === JSON_ERROR_NONE) {
                $data['text_style'] = $decoded;
            }
        } elseif (is_array($textStyle)) {
            $data['text_style'] = $textStyle;
        }

        // Handle poll data
        if ($mediaType === 'poll') {
            $data['poll_question'] = $request->input('poll_question');
            $pollOptions = $request->input('poll_options');
            if (is_string($pollOptions)) {
                $data['poll_options'] = json_decode($pollOptions, true);
            } elseif (is_array($pollOptions)) {
                $data['poll_options'] = $pollOptions;
            }
        }

        // Handle image upload
        if ($mediaType === 'image' && $request->hasFile('media')) {
            $file = $request->file('media');

            // Validate file
            $maxSize = 10 * 1024 * 1024; // 10MB
            if ($file->getSize() > $maxSize) {
                return $this->respondWithError('FILE_TOO_LARGE', __('api.story_image_too_large'), 'media');
            }

            $allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
            if (!in_array($file->getMimeType(), $allowedMimes)) {
                return $this->respondWithError('INVALID_FILE_TYPE', __('api.story_invalid_image_type'), 'media');
            }

            try {
                $tenantId = $this->getTenantId();
                $data['media_url'] = $this->storyService->uploadMedia($file, $tenantId, $userId);
            } catch (\Throwable $e) {
                Log::error('Story image upload failed', ['error' => $e->getMessage()]);
                return $this->respondWithError('UPLOAD_FAILED', __('api.story_upload_failed'), 'media', 500);
            }
        }

        // Handle video upload
        if ($mediaType === 'video' && $request->hasFile('media')) {
            $file = $request->file('media');

            $maxSize = 50 * 1024 * 1024; // 50MB
            if ($file->getSize() > $maxSize) {
                return $this->respondWithError('FILE_TOO_LARGE', __('api.story_video_too_large'), 'media');
            }

            $allowedMimes = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'];
            if (!in_array($file->getMimeType(), $allowedMimes)) {
                return $this->respondWithError('INVALID_FILE_TYPE', __('api.story_invalid_video_type'), 'media');
            }

            try {
                $tenantId = $this->getTenantId();
                $data['media_url'] = $this->storyService->uploadMedia($file, $tenantId, $userId);
                $data['video_duration'] = $request->input('video_duration');
            } catch (\Throwable $e) {
                Log::error('Story video upload failed', ['error' => $e->getMessage()]);
                return $this->respondWithError('UPLOAD_FAILED', __('api.story_video_upload_failed'), 'media', 500);
            }
        }

        // Validate: image/video stories must have a media file, text stories must have content
        if (in_array($mediaType, ['image', 'video']) && empty($data['media_url'])) {
            return $this->respondWithError('MISSING_MEDIA', __('api.story_media_required', ['type' => ucfirst($mediaType)]), 'media');
        }
        if ($mediaType === 'text' && empty($data['text_content'])) {
            return $this->respondWithError('MISSING_CONTENT', __('api.story_text_required'), 'text_content');
        }

        try {
            $story = $this->storyService->create($userId, $data);
            return $this->respondWithData($story, null, 201);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('STORY_CREATE_FAILED', $e->getMessage());
        } catch (\Throwable $e) {
            Log::error('StoryController::store failed', ['error' => $e->getMessage()]);
            return $this->respondWithError('STORY_CREATE_FAILED', __('api.story_create_failed'), null, 500);
        }
    }

    /**
     * POST /api/v2/stories/{id}/view — Mark story as viewed
     */
    public function view(int $id): JsonResponse
    {
        $userId = $this->requireAuth();

        try {
            $this->storyService->viewStory($id, $userId);
            return $this->respondWithData(['viewed' => true]);
        } catch (\Throwable $e) {
            Log::error('StoryController::view failed', ['error' => $e->getMessage()]);
            return $this->respondWithError('VIEW_FAILED', __('api.story_view_failed'), null, 500);
        }
    }

    /**
     * GET /api/v2/stories/{id}/viewers — Get viewers list (owner only)
     */
    public function viewers(int $id): JsonResponse
    {
        $userId = $this->requireAuth();

        try {
            $viewers = $this->storyService->getViewers($id, $userId);
            return $this->respondWithData($viewers);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('VIEWERS_FETCH_FAILED', $e->getMessage(), null, 403);
        } catch (\Throwable $e) {
            Log::error('StoryController::viewers failed', ['error' => $e->getMessage()]);
            return $this->respondWithError('VIEWERS_FETCH_FAILED', __('api.story_viewers_failed'), null, 500);
        }
    }

    /**
     * POST /api/v2/stories/{id}/react — React to a story
     */
    public function react(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('stories.react', 30, 60);

        $reactionType = request()->input('reaction_type');
        if (empty($reactionType)) {
            return $this->respondWithError('MISSING_REACTION', __('api.story_reaction_required'), 'reaction_type');
        }

        // H5: Verify story exists and is not expired
        $tenantId = $this->getTenantId();
        $story = DB::selectOne(
            'SELECT id, user_id, audience, expires_at FROM stories WHERE id = ? AND tenant_id = ?',
            [$id, $tenantId]
        );
        if (!$story) {
            return $this->respondWithError('NOT_FOUND', __('api.story_not_found'), null, 404);
        }
        if (!empty($story->expires_at) && strtotime($story->expires_at) <= time()) {
            return $this->respondWithError('NOT_FOUND', __('api.story_expired'), null, 404);
        }

        // M5: Enforce close_friends audience restriction
        if ($story->audience === 'close_friends' && (int) $story->user_id !== $userId) {
            $isFriend = DB::selectOne(
                'SELECT user_id FROM close_friends WHERE user_id = ? AND friend_id = ? AND tenant_id = ?',
                [$story->user_id, $userId, $tenantId]
            );
            if (!$isFriend) {
                return $this->respondWithError('FORBIDDEN', __('api.forbidden'), null, 403);
            }
        }

        try {
            $this->storyService->reactToStory($id, $userId, $reactionType);

            // Notify story creator about the reaction (skip self-reactions)
            try {
                $tenantId = $this->getTenantId();
                $story = DB::selectOne(
                    'SELECT user_id FROM stories WHERE id = ? AND tenant_id = ?',
                    [$id, $tenantId]
                );

                if ($story && (int) $story->user_id !== $userId) {
                    $reactor = DB::selectOne(
                        'SELECT first_name, last_name FROM users WHERE id = ? AND tenant_id = ?',
                        [$userId, $tenantId]
                    );
                    $recipient = DB::selectOne(
                        'SELECT preferred_language FROM users WHERE id = ? AND tenant_id = ?',
                        [(int) $story->user_id, $tenantId]
                    );

                    LocaleContext::withLocale($recipient, function () use ($reactor, $story, $reactionType) {
                        $reactorName = $reactor
                            ? UserDisplayName::resolve($reactor)
                            : __('emails.common.fallback_someone');
                        $emoji = [
                            'heart' => "\u{2764}\u{FE0F}",
                            'laugh' => "\u{1F602}",
                            'wow'   => "\u{1F62E}",
                            'fire'  => "\u{1F525}",
                            'clap'  => "\u{1F44F}",
                            'sad'   => "\u{1F622}",
                        ][$reactionType] ?? $reactionType;
                        $message = __('svc_notifications.story.reaction', [
                            'name' => $reactorName,
                            'emoji' => $emoji,
                        ]);

                        Notification::createNotification(
                            (int) $story->user_id,
                            $message,
                            '/feed',
                            'story_reaction'
                        );
                        \App\Services\NotificationDispatcher::fanOutPush((int) $story->user_id, 'story_reaction', $message, '/feed');
                    });
                }
            } catch (\Throwable $e) {
                Log::warning('Story reaction notification failed', [
                    'story_id' => $id,
                    'reactor' => $userId,
                    'error' => $e->getMessage(),
                ]);
            }

            return $this->respondWithData(['reacted' => true]);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('REACT_FAILED', $e->getMessage());
        } catch (\Throwable $e) {
            Log::error('StoryController::react failed', ['error' => $e->getMessage()]);
            return $this->respondWithError('REACT_FAILED', __('api.story_react_failed'), null, 500);
        }
    }

    /**
     * DELETE /api/v2/stories/{id} — Delete own story
     */
    public function destroy(int $id): JsonResponse
    {
        $userId = $this->requireAuth();

        try {
            $this->storyService->deleteStory($id, $userId);
            return $this->respondWithData(['deleted' => true]);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('DELETE_FAILED', $e->getMessage(), null, 403);
        } catch (\Throwable $e) {
            Log::error('StoryController::destroy failed', ['error' => $e->getMessage()]);
            return $this->respondWithError('DELETE_FAILED', __('api.story_delete_failed'), null, 500);
        }
    }

    /**
     * POST /api/v2/stories/{id}/poll/vote — Vote on poll story
     */
    public function pollVote(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('stories.poll_vote', 30, 60);

        $optionIndex = request()->input('option_index');
        if ($optionIndex === null) {
            return $this->respondWithError('MISSING_OPTION', __('api.story_poll_option_required'), 'option_index');
        }

        try {
            $results = $this->storyService->votePoll($id, $userId, (int) $optionIndex);
            return $this->respondWithData($results);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('VOTE_FAILED', $e->getMessage());
        } catch (\Throwable $e) {
            Log::error('StoryController::pollVote failed', ['error' => $e->getMessage()]);
            return $this->respondWithError('VOTE_FAILED', __('api.story_vote_failed'), null, 500);
        }
    }

    /**
     * GET /api/v2/stories/highlights/{userId} — Get user's highlights
     */
    public function highlights(int $userId): JsonResponse
    {
        $this->requireAuth();

        try {
            $highlights = $this->storyService->getHighlights($userId);
            return $this->respondWithData($highlights);
        } catch (\Throwable $e) {
            Log::error('StoryController::highlights failed', ['error' => $e->getMessage()]);
            return $this->respondWithError('HIGHLIGHTS_FETCH_FAILED', __('api.story_highlights_fetch_failed'), null, 500);
        }
    }

    /**
     * GET /api/v2/stories/highlights/{id}/stories — Get stories in a highlight
     */
    public function highlightStories(int $id): JsonResponse
    {
        $viewerId = $this->requireAuth();

        try {
            $stories = $this->storyService->getHighlightStories($id, $viewerId);
            return $this->respondWithData($stories);
        } catch (\Throwable $e) {
            Log::error('StoryController::highlightStories failed', ['error' => $e->getMessage()]);
            return $this->respondWithError('HIGHLIGHT_STORIES_FAILED', __('api.story_highlight_stories_failed'), null, 500);
        }
    }

    /**
     * POST /api/v2/stories/highlights — Create highlight
     */
    public function createHighlight(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('stories.highlights.create', 10, 60);

        $title = request()->input('title');
        if (empty($title)) {
            return $this->respondWithError('MISSING_TITLE', __('api.story_highlight_title_required'), 'title');
        }

        $storyIds = request()->input('story_ids', []);
        if (is_string($storyIds)) {
            $storyIds = json_decode($storyIds, true) ?? [];
        }

        try {
            $highlight = $this->storyService->createHighlight($userId, $title, $storyIds);
            return $this->respondWithData($highlight, null, 201);
        } catch (\Throwable $e) {
            Log::error('StoryController::createHighlight failed', ['error' => $e->getMessage()]);
            return $this->respondWithError('HIGHLIGHT_CREATE_FAILED', __('api.story_highlight_create_failed'), null, 500);
        }
    }

    /**
     * POST /api/v2/stories/highlights/{id}/items — Add story to highlight
     */
    public function addHighlightItem(int $id): JsonResponse
    {
        $userId = $this->requireAuth();

        $storyId = request()->input('story_id');
        if (empty($storyId)) {
            return $this->respondWithError('MISSING_STORY_ID', __('api.story_id_required'), 'story_id');
        }

        try {
            $this->storyService->addToHighlight($id, (int) $storyId, $userId);
            return $this->respondWithData(['added' => true]);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('ADD_ITEM_FAILED', $e->getMessage(), null, 403);
        } catch (\Throwable $e) {
            Log::error('StoryController::addHighlightItem failed', ['error' => $e->getMessage()]);
            return $this->respondWithError('ADD_ITEM_FAILED', __('api.story_highlight_add_failed'), null, 500);
        }
    }

    /**
     * POST /api/v2/stories/{id}/reply — Reply to a story via DM
     */
    public function reply(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('stories.reply', 30, 60);

        $body = trim(request()->input('body', ''));
        if (empty($body)) {
            return $this->respondWithError('MISSING_BODY', __('api.story_reply_required'), 'body');
        }

        // H5: Verify story exists and is not expired
        $tenantId = $this->getTenantId();
        $story = DB::selectOne(
            'SELECT id, user_id, audience, expires_at FROM stories WHERE id = ? AND tenant_id = ?',
            [$id, $tenantId]
        );
        if (!$story) {
            return $this->respondWithError('NOT_FOUND', __('api.story_not_found'), null, 404);
        }
        if (!empty($story->expires_at) && strtotime($story->expires_at) <= time()) {
            return $this->respondWithError('NOT_FOUND', __('api.story_expired'), null, 404);
        }

        // M5: Enforce close_friends audience restriction
        if ($story->audience === 'close_friends' && (int) $story->user_id !== $userId) {
            $isFriend = DB::selectOne(
                'SELECT user_id FROM close_friends WHERE user_id = ? AND friend_id = ? AND tenant_id = ?',
                [$story->user_id, $userId, $tenantId]
            );
            if (!$isFriend) {
                return $this->respondWithError('FORBIDDEN', __('api.forbidden'), null, 403);
            }
        }

        try {
            $result = $this->storyService->replyToStory($id, $userId, $body);

            // MessageService is the authoritative write boundary. A safeguarding
            // denial returns an empty result plus a structured error; propagate it
            // before creating the story-reply notification.
            if ($result === []) {
                $errors = MessageService::getErrors();
                if ($errors === []) {
                    return $this->respondWithError('REPLY_FAILED', __('api.story_reply_failed'));
                }

                return $this->respondWithErrors($errors, $this->replyFailureStatus($errors));
            }

            // Notify story creator about the reply (skip self-replies)
            try {
                $tenantId = $this->getTenantId();
                $story = DB::selectOne(
                    'SELECT user_id FROM stories WHERE id = ? AND tenant_id = ?',
                    [$id, $tenantId]
                );

                if ($story && (int) $story->user_id !== $userId) {
                    $replier = DB::selectOne(
                        'SELECT first_name, last_name FROM users WHERE id = ? AND tenant_id = ?',
                        [$userId, $tenantId]
                    );
                    $recipient = DB::selectOne(
                        'SELECT preferred_language FROM users WHERE id = ? AND tenant_id = ?',
                        [(int) $story->user_id, $tenantId]
                    );

                    LocaleContext::withLocale($recipient, function () use ($replier, $story) {
                        $replierName = $replier
                            ? UserDisplayName::resolve($replier)
                            : __('emails.common.fallback_someone');
                        $message = __('svc_notifications.story.reply', ['name' => $replierName]);

                        Notification::createNotification(
                            (int) $story->user_id,
                            $message,
                            '/feed',
                            'story_reply'
                        );
                        \App\Services\NotificationDispatcher::fanOutPush((int) $story->user_id, 'story_reply', $message, '/feed');
                    });
                }
            } catch (\Throwable $e) {
                Log::warning('Story reply notification failed', [
                    'story_id' => $id,
                    'replier' => $userId,
                    'error' => $e->getMessage(),
                ]);
            }

            return $this->respondWithData($result, null, 201);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('REPLY_FAILED', $e->getMessage());
        } catch (\Throwable $e) {
            Log::error('StoryController::reply failed', ['error' => $e->getMessage()]);
            return $this->respondWithError('REPLY_FAILED', __('api.story_reply_failed'), null, 500);
        }
    }

    /** @param array<int, array<string, mixed>> $errors */
    private function replyFailureStatus(array $errors): int
    {
        return match ($errors[0]['code'] ?? null) {
            'SAFEGUARDING_POLICY_UNAVAILABLE' => 503,
            'VETTING_REQUIRED', 'SAFEGUARDING_CONTACT_RESTRICTED', 'FORBIDDEN', 'BLOCKED' => 403,
            'NOT_FOUND' => 404,
            default => 400,
        };
    }

    /**
     * DELETE /api/v2/stories/highlights/{id} — Delete highlight
     */
    public function deleteHighlight(int $id): JsonResponse
    {
        $userId = $this->requireAuth();

        try {
            $this->storyService->deleteHighlight($id, $userId);
            return $this->respondWithData(['deleted' => true]);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('DELETE_FAILED', $e->getMessage(), null, 403);
        } catch (\Throwable $e) {
            Log::error('StoryController::deleteHighlight failed', ['error' => $e->getMessage()]);
            return $this->respondWithError('DELETE_FAILED', __('api.story_highlight_delete_failed'), null, 500);
        }
    }

    /**
     * GET /api/v2/stories/archive — Get own archived stories
     */
    public function archive(): JsonResponse
    {
        $userId = $this->requireAuth();

        try {
            $limit = min((int) request()->input('limit', 50), 100);
            $offset = max((int) request()->input('offset', 0), 0);
            $stories = $this->storyService->getArchivedStories($userId, $limit, $offset);
            return $this->respondWithData($stories);
        } catch (\Throwable $e) {
            Log::error('StoryController::archive failed', ['error' => $e->getMessage()]);
            return $this->respondWithError('ARCHIVE_FETCH_FAILED', __('api.story_archive_fetch_failed'), null, 500);
        }
    }

    /**
     * GET /api/v2/stories/close-friends — Get own close friends list
     */
    public function closeFriends(): JsonResponse
    {
        $userId = $this->requireAuth();

        try {
            $friends = $this->storyService->getCloseFriends($userId);
            return $this->respondWithData($friends);
        } catch (\Throwable $e) {
            Log::error('StoryController::closeFriends failed', ['error' => $e->getMessage()]);
            return $this->respondWithError('CLOSE_FRIENDS_FAILED', __('api.story_close_friends_failed'), null, 500);
        }
    }

    /**
     * POST /api/v2/stories/close-friends — Add close friend
     */
    public function addCloseFriend(): JsonResponse
    {
        $userId = $this->requireAuth();

        $friendId = request()->input('friend_id');
        if (empty($friendId)) {
            return $this->respondWithError('MISSING_FRIEND_ID', __('api.story_friend_id_required'), 'friend_id');
        }

        try {
            $this->storyService->addCloseFriend($userId, (int) $friendId);
            return $this->respondWithData(['added' => true]);
        } catch (\Throwable $e) {
            Log::error('StoryController::addCloseFriend failed', ['error' => $e->getMessage()]);
            return $this->respondWithError('ADD_FRIEND_FAILED', __('api.story_add_friend_failed'), null, 500);
        }
    }

    /**
     * DELETE /api/v2/stories/close-friends/{friendId} — Remove close friend
     */
    public function removeCloseFriend(int $friendId): JsonResponse
    {
        $userId = $this->requireAuth();

        try {
            $this->storyService->removeCloseFriend($userId, $friendId);
            return $this->respondWithData(['removed' => true]);
        } catch (\Throwable $e) {
            Log::error('StoryController::removeCloseFriend failed', ['error' => $e->getMessage()]);
            return $this->respondWithError('REMOVE_FRIEND_FAILED', __('api.story_remove_friend_failed'), null, 500);
        }
    }

    /**
     * POST /api/v2/stories/{id}/analytics — Track analytics event
     */
    public function trackAnalytics(int $id): JsonResponse
    {
        $userId = $this->requireAuth();

        $eventType = request()->input('event_type');
        if (empty($eventType)) {
            return $this->respondWithError('MISSING_EVENT', __('api.story_event_type_required'), 'event_type');
        }

        $watchDuration = request()->input('watch_duration_ms');

        try {
            $this->storyService->trackAnalytics($id, $userId, $eventType, $watchDuration ? (int) $watchDuration : null);
            return $this->respondWithData(['tracked' => true]);
        } catch (\Throwable $e) {
            // Silently fail analytics — don't break UX
            return $this->respondWithData(['tracked' => false]);
        }
    }

    /**
     * GET /api/v2/stories/{id}/analytics — Get story analytics (owner only)
     */
    public function getAnalytics(int $id): JsonResponse
    {
        $userId = $this->requireAuth();

        try {
            $analytics = $this->storyService->getStoryAnalytics($id, $userId);
            return $this->respondWithData($analytics);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('ANALYTICS_FAILED', $e->getMessage(), null, 403);
        } catch (\Throwable $e) {
            Log::error('StoryController::getAnalytics failed', ['error' => $e->getMessage()]);
            return $this->respondWithError('ANALYTICS_FAILED', __('api.story_analytics_failed'), null, 500);
        }
    }

    /**
     * PUT /api/v2/stories/highlights/{id} — Update highlight title
     */
    public function updateHighlight(int $id): JsonResponse
    {
        $userId = $this->requireAuth();

        $title = request()->input('title');
        if (empty($title)) {
            return $this->respondWithError('MISSING_TITLE', __('api.story_highlight_title_required'), 'title');
        }

        try {
            $highlight = $this->storyService->updateHighlight($id, $userId, $title);
            return $this->respondWithData($highlight);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('UPDATE_FAILED', $e->getMessage(), null, 403);
        } catch (\Throwable $e) {
            Log::error('StoryController::updateHighlight failed', ['error' => $e->getMessage()]);
            return $this->respondWithError('UPDATE_FAILED', __('api.story_highlight_update_failed'), null, 500);
        }
    }

    /**
     * DELETE /api/v2/stories/highlights/{id}/items/{storyId} — Remove story from highlight
     */
    public function removeHighlightItem(int $id, int $storyId): JsonResponse
    {
        $userId = $this->requireAuth();

        try {
            $this->storyService->removeFromHighlight($id, $storyId, $userId);
            return $this->respondWithData(['removed' => true]);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('REMOVE_FAILED', $e->getMessage(), null, 403);
        } catch (\Throwable $e) {
            Log::error('StoryController::removeHighlightItem failed', ['error' => $e->getMessage()]);
            return $this->respondWithError('REMOVE_FAILED', __('api.story_highlight_remove_failed'), null, 500);
        }
    }

    /**
     * POST /api/v2/stories/{id}/stickers — Save stickers for a story
     */
    public function saveStickers(int $id): JsonResponse
    {
        $userId = $this->requireAuth();

        $stickers = request()->input('stickers', []);
        if (!is_array($stickers)) {
            return $this->respondWithError('INVALID_STICKERS', __('api.story_stickers_must_be_array'), 'stickers');
        }

        try {
            $this->storyService->saveStickers($id, $userId, $stickers);
            return $this->respondWithData(['saved' => true]);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('SAVE_FAILED', $e->getMessage(), null, 403);
        } catch (\Throwable $e) {
            Log::error('StoryController::saveStickers failed', ['error' => $e->getMessage()]);
            return $this->respondWithError('SAVE_FAILED', __('api.story_save_stickers_failed'), null, 500);
        }
    }

    /**
     * PUT /api/v2/stories/highlights/reorder — Reorder highlights
     */
    public function reorderHighlights(): JsonResponse
    {
        $userId = $this->requireAuth();

        $order = request()->input('order', []);
        if (empty($order) || !is_array($order)) {
            return $this->respondWithError('MISSING_ORDER', __('api.story_order_required'), 'order');
        }

        try {
            $this->storyService->reorderHighlights($userId, $order);
            return $this->respondWithData(['reordered' => true]);
        } catch (\Throwable $e) {
            Log::error('StoryController::reorderHighlights failed', ['error' => $e->getMessage()]);
            return $this->respondWithError('REORDER_FAILED', __('api.story_reorder_failed'), null, 500);
        }
    }
}
