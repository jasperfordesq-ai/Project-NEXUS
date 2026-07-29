<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Services\MessageService;
use App\Services\NotificationDispatcher;
use App\Services\RealtimeService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * StoryService — Manages 24-hour disappearing stories (Instagram-style).
 *
 * All queries are tenant-scoped via TenantContext::getId().
 * Uses raw DB queries for performance on high-volume story operations.
 */
class StoryService
{
    /** Maximum active stories per user */
    private const MAX_ACTIVE_STORIES = 30;

    /** Story lifetime in hours */
    private const STORY_LIFETIME_HOURS = 24;

    /** Days after expiry before media files are purged */
    private const MEDIA_RETENTION_DAYS = 30;

    /**
     * Create a new story.
     *
     * @param int $userId
     * @param array $data {media_type, media_url?, thumbnail_url?, text_content?, text_style?, background_color?, background_gradient?, duration?, poll_question?, poll_options?}
     * @return array The created story
     *
     * @throws \RuntimeException if max active stories exceeded
     */
    public function create(int $userId, array $data): array
    {
        $tenantId = TenantContext::getId();

        // Validate data outside transaction (fast fail before locking)
        $mediaType = $data['media_type'] ?? 'image';
        $duration = min(max((int) ($data['duration'] ?? 5), 3), 30);
        $expiresAt = now()->addHours(self::STORY_LIFETIME_HOURS)->format('Y-m-d H:i:s');

        $pollOptions = null;
        if ($mediaType === 'poll') {
            if (empty($data['poll_question'])) {
                throw new \RuntimeException(__('api.story_poll_question_required'));
            }
            $options = $data['poll_options'] ?? [];
            if (!is_array($options) || count($options) < 2 || count($options) > 4) {
                throw new \RuntimeException(__('api.story_poll_option_count'));
            }
            $pollOptions = json_encode(array_values($options));
        }

        $textStyle = null;
        if (!empty($data['text_style']) && is_array($data['text_style'])) {
            $textStyle = json_encode($data['text_style']);
        }

        $videoDuration = null;
        if ($mediaType === 'video' && !empty($data['video_duration'])) {
            $videoDuration = (float) $data['video_duration'];
            $duration = min(max((int) ceil($videoDuration), 3), 30);
        }

        $audience = $data['audience'] ?? 'everyone';

        // Atomic check-and-insert: transaction with locking read prevents
        // concurrent requests from bypassing the 30-story limit.
        $storyId = DB::transaction(function () use (
            $tenantId, $userId, $mediaType, $data, $textStyle, $duration,
            $videoDuration, $pollOptions, $audience, $expiresAt
        ) {
            // Locking count — blocks concurrent inserts for this user until commit
            $activeCount = DB::selectOne(
                'SELECT COUNT(*) as cnt FROM stories WHERE tenant_id = ? AND user_id = ? AND is_active = 1 AND expires_at > NOW() FOR UPDATE',
                [$tenantId, $userId]
            );

            if (($activeCount->cnt ?? 0) >= self::MAX_ACTIVE_STORIES) {
                throw new \RuntimeException(__('api.story_max_active_reached', ['max' => self::MAX_ACTIVE_STORIES]));
            }

            DB::insert(
                'INSERT INTO stories (tenant_id, user_id, media_type, media_url, thumbnail_url, text_content, text_style, background_color, background_gradient, duration, video_duration, poll_question, poll_options, audience, expires_at, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
                [
                    $tenantId,
                    $userId,
                    $mediaType,
                    $data['media_url'] ?? null,
                    $data['thumbnail_url'] ?? null,
                    $data['text_content'] ?? null,
                    $textStyle,
                    $data['background_color'] ?? null,
                    $data['background_gradient'] ?? null,
                    $duration,
                    $videoDuration,
                    $data['poll_question'] ?? null,
                    $pollOptions,
                    $audience,
                    $expiresAt,
                ]
            );

            return DB::getPdo()->lastInsertId();
        });

        $storyId = (int) $storyId;

        // Notify the user's connections about the new story (non-blocking)
        try {
            $this->notifyConnections($userId, (int) $storyId);
        } catch (\Throwable $e) {
            Log::warning('StoryService: Failed to notify connections for story', [
                'story_id' => $storyId,
                'user_id' => $userId,
                'error' => $e->getMessage(),
            ]);
        }

        return $this->getStoryById((int) $storyId);
    }

    /**
     * Get stories for the story bar (feed view).
     *
     * Returns users who have active stories, grouped by user.
     * Current user's stories first, then connections, then community.
     * For each user: avatar, name, whether current user has viewed ALL their stories.
     *
     * @param int $userId Current authenticated user
     * @return array
     */
    public function getFeedStories(int $userId): array
    {
        $tenantId = TenantContext::getId();

        // Get all users with active stories in this tenant
        // Respects audience: 'everyone' visible to all, 'connections' to connections only,
        // 'close_friends' to close friends only. Own stories always visible.
        $rows = DB::select(
            'SELECT
                s.user_id,
                u.first_name,
                u.last_name,
                u.avatar_url,
                COUNT(s.id) as story_count,
                MAX(s.created_at) as latest_story_at,
                SUM(CASE WHEN sv.id IS NULL THEN 1 ELSE 0 END) as unseen_count
             FROM stories s
             JOIN users u ON u.id = s.user_id
             LEFT JOIN story_views sv ON sv.story_id = s.id AND sv.viewer_id = ?
             WHERE s.tenant_id = ?
               AND s.is_active = 1
               AND s.expires_at > NOW()
               AND (
                   s.user_id = ?
                   OR COALESCE(s.audience, \'everyone\') = \'everyone\'
                   OR (COALESCE(s.audience, \'everyone\') = \'connections\' AND EXISTS (
                       SELECT 1 FROM connections c
                       WHERE ((c.requester_id = s.user_id AND c.receiver_id = ?) OR (c.receiver_id = s.user_id AND c.requester_id = ?))
                         AND c.status = \'accepted\' AND c.tenant_id = ?
                   ))
                   OR (COALESCE(s.audience, \'everyone\') = \'close_friends\' AND EXISTS (
                       SELECT 1 FROM close_friends cf WHERE cf.user_id = s.user_id AND cf.friend_id = ? AND cf.tenant_id = ?
                   ))
               )
             GROUP BY s.user_id, u.first_name, u.last_name, u.avatar_url
             ORDER BY
                (s.user_id = ?) DESC,
                unseen_count DESC,
                latest_story_at DESC',
            [$userId, $tenantId, $userId, $userId, $userId, $tenantId, $userId, $tenantId, $userId]
        );

        // Check connections for sorting priority
        $connectionUserIds = DB::select(
            'SELECT CASE WHEN requester_id = ? THEN receiver_id ELSE requester_id END as friend_id
             FROM connections
             WHERE (requester_id = ? OR receiver_id = ?)
               AND status = ?
               AND tenant_id = ?',
            [$userId, $userId, $userId, 'accepted', $tenantId]
        );
        $connectedIds = array_map(fn($r) => (int) $r->friend_id, $connectionUserIds);

        $result = [];
        foreach ($rows as $row) {
            $isOwn = (int) $row->user_id === $userId;
            $isConnected = in_array((int) $row->user_id, $connectedIds);

            $result[] = [
                'user_id' => (int) $row->user_id,
                'name' => trim(($row->first_name ?? '') . ' ' . ($row->last_name ?? '')),
                'first_name' => $row->first_name ?? '',
                'avatar_url' => $row->avatar_url,
                'story_count' => (int) $row->story_count,
                'has_unseen' => (int) $row->unseen_count > 0,
                'is_own' => $isOwn,
                'is_connected' => $isConnected,
                'latest_at' => $row->latest_story_at,
            ];
        }

        // Sort: own first, then unseen connections, then unseen others, then seen connections, then seen others
        usort($result, function ($a, $b) {
            if ($a['is_own'] !== $b['is_own']) return $a['is_own'] ? -1 : 1;
            if ($a['has_unseen'] !== $b['has_unseen']) return $a['has_unseen'] ? -1 : 1;
            if ($a['is_connected'] !== $b['is_connected']) return $a['is_connected'] ? -1 : 1;
            return strcmp($b['latest_at'] ?? '', $a['latest_at'] ?? '');
        });

        return $result;
    }

    /**
     * Get all active stories for a specific user.
     *
     * @param int $userId The user whose stories to retrieve
     * @param int|null $viewerId The viewer (for seen/unseen status)
     * @return array
     */
    public function getUserStories(int $userId, ?int $viewerId = null): array
    {
        $tenantId = TenantContext::getId();
        $viewerInt = $viewerId ? (int) $viewerId : 0;

        // If the viewer is the story owner, show all their stories (no audience filter).
        // Otherwise, enforce audience visibility (everyone / connections / close_friends).
        $audienceClause = '';
        $audienceParams = [];

        if ($viewerInt && $viewerInt !== $userId) {
            $audienceClause = '
               AND (
                   COALESCE(s.audience, \'everyone\') = \'everyone\'
                   OR (COALESCE(s.audience, \'everyone\') = \'connections\' AND EXISTS (
                       SELECT 1 FROM connections c
                       WHERE ((c.requester_id = s.user_id AND c.receiver_id = ?) OR (c.receiver_id = s.user_id AND c.requester_id = ?))
                         AND c.status = \'accepted\' AND c.tenant_id = ?
                   ))
                   OR (COALESCE(s.audience, \'everyone\') = \'close_friends\' AND EXISTS (
                       SELECT 1 FROM close_friends cf WHERE cf.user_id = s.user_id AND cf.friend_id = ? AND cf.tenant_id = ?
                   ))
               )';
            $audienceParams = [$viewerInt, $viewerInt, $tenantId, $viewerInt, $tenantId];
        }

        $stories = DB::select(
            'SELECT s.*,
                    u.first_name, u.last_name, u.avatar_url,
                    ' . ($viewerInt ? 'CASE WHEN sv.id IS NOT NULL THEN 1 ELSE 0 END as is_viewed' : '0 as is_viewed') . '
             FROM stories s
             JOIN users u ON u.id = s.user_id
             ' . ($viewerInt ? 'LEFT JOIN story_views sv ON sv.story_id = s.id AND sv.viewer_id = ' . $viewerInt : '') . '
             WHERE s.tenant_id = ?
               AND s.user_id = ?
               AND s.is_active = 1
               AND s.expires_at > NOW()
               ' . $audienceClause . '
             ORDER BY s.created_at ASC',
            array_merge([$tenantId, $userId], $audienceParams)
        );

        return array_map(fn($s) => $this->formatStory($s), $stories);
    }

    /**
     * Mark a story as viewed by a user.
     *
     * @param int $storyId
     * @param int $viewerId
     */
    public function viewStory(int $storyId, int $viewerId): void
    {
        $tenantId = TenantContext::getId();

        // Verify story belongs to this tenant and is active
        $story = DB::selectOne(
            'SELECT id, user_id FROM stories WHERE id = ? AND tenant_id = ? AND is_active = 1 AND expires_at > NOW()',
            [$storyId, $tenantId]
        );

        if (!$story) {
            return; // Story not found or expired — silently ignore
        }

        // Don't track self-views
        if ((int) $story->user_id === $viewerId) {
            return;
        }

        // Insert view (ignore duplicate) — only increment view_count if a new row was actually inserted
        $affected = DB::affectingStatement(
            'INSERT IGNORE INTO story_views (story_id, viewer_id, viewed_at) VALUES (?, ?, NOW())',
            [$storyId, $viewerId]
        );

        if ($affected > 0) {
            DB::update(
                'UPDATE stories SET view_count = view_count + 1 WHERE id = ? AND tenant_id = ?',
                [$storyId, $tenantId]
            );
        }
    }

    /**
     * Get viewers list for a story (only available to story owner).
     *
     * @param int $storyId
     * @param int $ownerId The requesting user (must be story owner)
     * @return array
     *
     * @throws \RuntimeException if not story owner
     */
    public function getViewers(int $storyId, int $ownerId): array
    {
        $tenantId = TenantContext::getId();

        $story = DB::selectOne(
            'SELECT id, user_id FROM stories WHERE id = ? AND tenant_id = ?',
            [$storyId, $tenantId]
        );

        if (!$story) {
            throw new \RuntimeException(__('api.story_not_found'));
        }

        if ((int) $story->user_id !== $ownerId) {
            throw new \RuntimeException(__('api.story_viewers_owner_only'));
        }

        // Fix 12: scope the users JOIN to the current tenant to prevent cross-tenant user leakage
        $viewers = DB::select(
            'SELECT u.id, u.first_name, u.last_name, u.avatar_url, sv.viewed_at
             FROM story_views sv
             JOIN users u ON u.id = sv.viewer_id AND u.tenant_id = ?
             WHERE sv.story_id = ?
             ORDER BY sv.viewed_at DESC',
            [$tenantId, $storyId]
        );

        return array_map(fn($v) => [
            'id' => (int) $v->id,
            'name' => trim(($v->first_name ?? '') . ' ' . ($v->last_name ?? '')),
            'avatar_url' => $v->avatar_url,
            'viewed_at' => $v->viewed_at,
        ], $viewers);
    }

    /**
     * Add a reaction to a story.
     *
     * @param int $storyId
     * @param int $userId
     * @param string $reactionType e.g. 'heart', 'laugh', 'wow', 'fire', 'clap', 'sad'
     */
    public function reactToStory(int $storyId, int $userId, string $reactionType): void
    {
        $tenantId = TenantContext::getId();

        // Verify story belongs to this tenant
        $story = DB::selectOne(
            'SELECT id, user_id FROM stories WHERE id = ? AND tenant_id = ? AND is_active = 1 AND expires_at > NOW()',
            [$storyId, $tenantId]
        );

        if (!$story) {
            throw new \RuntimeException(__('api.story_not_found'));
        }

        if (!$this->canViewStory((object) $story, $userId, $tenantId)) {
            throw new \RuntimeException(__('api.story_not_found'));
        }

        $allowedReactions = ['heart', 'laugh', 'wow', 'fire', 'clap', 'sad'];
        if (!in_array($reactionType, $allowedReactions)) {
            throw new \RuntimeException(__('api.story_invalid_reaction_type'));
        }

        // Toggle reaction: remove if same type exists, otherwise upsert
        $existing = DB::selectOne(
            'SELECT id, reaction_type FROM story_reactions WHERE story_id = ? AND user_id = ? AND tenant_id = ?',
            [$storyId, $userId, $tenantId]
        );

        if ($existing) {
            if ($existing->reaction_type === $reactionType) {
                // Same reaction — remove it (toggle off)
                DB::delete('DELETE FROM story_reactions WHERE id = ? AND tenant_id = ?', [$existing->id, $tenantId]);
                return;
            }
            // Different reaction — update in place
            if ((int) $story->user_id !== $userId) {
                app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
                    $userId,
                    (int) $story->user_id,
                    (int) $tenantId,
                    'story_reaction',
                );
            }
            DB::update(
                'UPDATE story_reactions SET reaction_type = ?, created_at = NOW() WHERE id = ? AND tenant_id = ?',
                [$reactionType, $existing->id, $tenantId]
            );
        } else {
            if ((int) $story->user_id !== $userId) {
                app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
                    $userId,
                    (int) $story->user_id,
                    (int) $tenantId,
                    'story_reaction',
                );
            }
            DB::insert(
                'INSERT INTO story_reactions (tenant_id, story_id, user_id, reaction_type, created_at) VALUES (?, ?, ?, ?, NOW())',
                [$tenantId, $storyId, $userId, $reactionType]
            );
        }

        // Note: Notification is dispatched by StoryController after this method returns.
        // Realtime broadcast for reaction events.
        if (!$existing && (int) $story->user_id !== $userId) {
            try {
                $reactor = DB::selectOne(
                    'SELECT first_name, last_name FROM users WHERE id = ? AND tenant_id = ?',
                    [$userId, $tenantId]
                );
                $reactorName = $reactor ? trim($reactor->first_name . ' ' . $reactor->last_name) : __('emails.common.fallback_someone');

                $emojiMap = [
                    'heart' => "\u{2764}\u{FE0F}",
                    'laugh' => "\u{1F602}",
                    'wow'   => "\u{1F62E}",
                    'fire'  => "\u{1F525}",
                    'clap'  => "\u{1F44F}",
                    'sad'   => "\u{1F622}",
                ];
                $emoji = $emojiMap[$reactionType] ?? $reactionType;

                // Render the story-owner-facing message in the owner's preferred locale.
                $storyOwner = DB::selectOne(
                    'SELECT preferred_language FROM users WHERE id = ? AND tenant_id = ?',
                    [(int) $story->user_id, $tenantId]
                );

                LocaleContext::withLocale($storyOwner, function () use ($story, $reactorName, $emoji) {
                    RealtimeService::broadcastNotification($story->user_id, [
                        'type'    => 'story_reaction',
                        'message' => __('svc_notifications.story.reaction', ['name' => $reactorName, 'emoji' => $emoji]),
                        'link'    => '/feed',
                    ]);
                });
            } catch (\Throwable $e) {
                \Log::warning('Failed to broadcast story reaction', [
                    'story_id' => $storyId,
                    'reactor'  => $userId,
                    'error'    => $e->getMessage(),
                ]);
            }
        }
    }

    /**
     * Delete a story (soft delete by setting is_active = 0).
     *
     * @param int $storyId
     * @param int $userId Must be the story owner
     *
     * @throws \RuntimeException if not owner
     */
    public function deleteStory(int $storyId, int $userId): void
    {
        $tenantId = TenantContext::getId();

        $affected = DB::update(
            'UPDATE stories SET is_active = 0 WHERE id = ? AND user_id = ? AND tenant_id = ?',
            [$storyId, $userId, $tenantId]
        );

        if ($affected === 0) {
            throw new \RuntimeException(__('api.story_not_found_or_not_owner'));
        }
    }

    /**
     * Vote on a poll story.
     *
     * @param int $storyId
     * @param int $userId
     * @param int $optionIndex Zero-based index of the selected option
     * @return array Updated poll results
     *
     * @throws \RuntimeException
     */
    public function votePoll(int $storyId, int $userId, int $optionIndex): array
    {
        $tenantId = TenantContext::getId();

        $story = DB::selectOne(
            'SELECT id, user_id, media_type, poll_options FROM stories WHERE id = ? AND tenant_id = ? AND is_active = 1 AND expires_at > NOW()',
            [$storyId, $tenantId]
        );

        if (!$story) {
            throw new \RuntimeException(__('api.story_not_found'));
        }

        if ($story->media_type !== 'poll') {
            throw new \RuntimeException(__('api.story_not_a_poll'));
        }

        $options = json_decode($story->poll_options, true);
        if (!is_array($options) || $optionIndex < 0 || $optionIndex >= count($options)) {
            throw new \RuntimeException(__('api.story_invalid_option_index'));
        }

        // Fix 13: wrap the check-then-insert in a transaction and use insertOrIgnore
        // to prevent a race condition where two concurrent requests both pass the
        // "already voted" check and both insert (violating the uk_story_poll_vote constraint).
        $alreadyVoted = false;
        DB::transaction(function () use ($storyId, $story, $userId, $optionIndex, $tenantId, &$alreadyVoted) {
            $existing = DB::selectOne(
                'SELECT id FROM story_poll_votes WHERE story_id = ? AND user_id = ?',
                [$storyId, $userId]
            );

            if ($existing) {
                $alreadyVoted = true;
                return;
            }

            if ((int) $story->user_id !== $userId) {
                app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
                    $userId,
                    (int) $story->user_id,
                    (int) $tenantId,
                    'story_poll_vote',
                );
            }

            DB::table('story_poll_votes')->insertOrIgnore([
                'tenant_id'    => $tenantId,
                'story_id'     => $storyId,
                'user_id'      => $userId,
                'option_index' => $optionIndex,
                'created_at'   => now(),
            ]);
        });

        if ($alreadyVoted) {
            throw new \RuntimeException(__('api.story_already_voted'));
        }

        return $this->getPollResults($storyId);
    }

    /**
     * Get poll results for a story.
     *
     * @param int $storyId
     * @return array
     */
    public function getPollResults(int $storyId): array
    {
        $tenantId = TenantContext::getId();

        $votes = DB::select(
            'SELECT spv.option_index, COUNT(*) as vote_count
             FROM story_poll_votes spv
             INNER JOIN stories s ON spv.story_id = s.id AND s.tenant_id = ?
             WHERE spv.story_id = ?
             GROUP BY spv.option_index',
            [$tenantId, $storyId]
        );

        $results = [];
        $totalVotes = 0;
        foreach ($votes as $v) {
            $results[(int) $v->option_index] = (int) $v->vote_count;
            $totalVotes += (int) $v->vote_count;
        }

        return [
            'votes' => $results,
            'total_votes' => $totalVotes,
        ];
    }

    /**
     * Create a story highlight.
     *
     * @param int $userId
     * @param string $title
     * @param array $storyIds
     * @return array
     */
    public function createHighlight(int $userId, string $title, array $storyIds = []): array
    {
        $tenantId = TenantContext::getId();

        // Get next display order
        $maxOrder = DB::selectOne(
            'SELECT MAX(display_order) as max_order FROM story_highlights WHERE tenant_id = ? AND user_id = ?',
            [$tenantId, $userId]
        );
        $order = ($maxOrder->max_order ?? 0) + 1;

        // Determine cover URL from first story
        $coverUrl = null;
        if (!empty($storyIds)) {
            $firstStory = DB::selectOne(
                'SELECT media_url, thumbnail_url FROM stories WHERE id = ? AND user_id = ? AND tenant_id = ?',
                [(int) $storyIds[0], $userId, $tenantId]
            );
            if ($firstStory) {
                $coverUrl = $firstStory->thumbnail_url ?? $firstStory->media_url;
            }
        }

        DB::insert(
            'INSERT INTO story_highlights (tenant_id, user_id, title, cover_url, display_order, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
            [$tenantId, $userId, $title, $coverUrl, $order]
        );

        $highlightId = (int) DB::getPdo()->lastInsertId();

        // Add stories to highlight
        foreach ($storyIds as $idx => $sid) {
            DB::insert(
                'INSERT IGNORE INTO story_highlight_items (highlight_id, story_id, display_order) VALUES (?, ?, ?)',
                [$highlightId, (int) $sid, $idx]
            );
        }

        return $this->getHighlightById($highlightId);
    }

    /**
     * Get user's highlights.
     *
     * @param int $userId
     * @return array
     */
    public function getHighlights(int $userId): array
    {
        $tenantId = TenantContext::getId();

        $highlights = DB::select(
            'SELECT h.*,
                    (SELECT COUNT(*) FROM story_highlight_items shi WHERE shi.highlight_id = h.id) as story_count
             FROM story_highlights h
             WHERE h.tenant_id = ? AND h.user_id = ?
             ORDER BY h.display_order ASC',
            [$tenantId, $userId]
        );

        return array_map(fn($h) => [
            'id' => (int) $h->id,
            'title' => $h->title,
            'cover_url' => $h->cover_url,
            'story_count' => (int) $h->story_count,
            'display_order' => (int) $h->display_order,
            'created_at' => $h->created_at,
        ], $highlights);
    }

    /**
     * Add a story to an existing highlight.
     *
     * @param int $highlightId
     * @param int $storyId
     * @param int $userId Must be highlight owner
     *
     * @throws \RuntimeException
     */
    public function addToHighlight(int $highlightId, int $storyId, int $userId): void
    {
        $tenantId = TenantContext::getId();

        $highlight = DB::selectOne(
            'SELECT id FROM story_highlights WHERE id = ? AND user_id = ? AND tenant_id = ?',
            [$highlightId, $userId, $tenantId]
        );

        if (!$highlight) {
            throw new \RuntimeException(__('api.story_highlight_not_found_or_not_owner'));
        }

        // Get next order
        $maxOrder = DB::selectOne(
            'SELECT MAX(display_order) as max_order FROM story_highlight_items WHERE highlight_id = ?',
            [$highlightId]
        );

        DB::insert(
            'INSERT IGNORE INTO story_highlight_items (highlight_id, story_id, display_order) VALUES (?, ?, ?)',
            [$highlightId, $storyId, ($maxOrder->max_order ?? 0) + 1]
        );
    }

    /**
     * Delete a highlight.
     *
     * @param int $highlightId
     * @param int $userId Must be highlight owner
     *
     * @throws \RuntimeException
     */
    public function deleteHighlight(int $highlightId, int $userId): void
    {
        $tenantId = TenantContext::getId();

        $affected = DB::delete(
            'DELETE FROM story_highlights WHERE id = ? AND user_id = ? AND tenant_id = ?',
            [$highlightId, $userId, $tenantId]
        );

        if ($affected === 0) {
            throw new \RuntimeException(__('api.story_highlight_not_found_or_not_owner'));
        }
    }

    /**
     * Get stories for a highlight (used when viewing a highlight).
     *
     * @param int $highlightId
     * @param int|null $viewerId
     * @return array
     */
    public function getHighlightStories(int $highlightId, ?int $viewerId = null): array
    {
        $tenantId = TenantContext::getId();

        // Fix 11: filter out expired and inactive stories from highlights
        $stories = DB::select(
            'SELECT s.*,
                    u.first_name, u.last_name, u.avatar_url,
                    ' . ($viewerId ? 'CASE WHEN sv.id IS NOT NULL THEN 1 ELSE 0 END as is_viewed' : '0 as is_viewed') . '
             FROM story_highlight_items shi
             JOIN stories s ON s.id = shi.story_id
             JOIN users u ON u.id = s.user_id
             ' . ($viewerId ? 'LEFT JOIN story_views sv ON sv.story_id = s.id AND sv.viewer_id = ' . (int) $viewerId : '') . '
             WHERE shi.highlight_id = ?
               AND s.tenant_id = ?
               AND s.is_active = 1
               AND s.expires_at > NOW()
             ORDER BY shi.display_order ASC',
            [$highlightId, $tenantId]
        );

        return array_map(fn($s) => $this->formatStory($s), $stories);
    }

    /**
     * Cron job: archive expired stories, deactivate them, and clean up old media.
     */
    public function cleanupExpired(): void
    {
        // Archive expired stories before deactivating (auto-save for highlight curation)
        $archived = DB::affectingStatement(
            'INSERT IGNORE INTO story_archive (tenant_id, user_id, original_story_id, media_type, media_url, thumbnail_url, text_content, text_style, background_color, background_gradient, duration, video_duration, poll_question, poll_options, view_count, original_created_at)
             SELECT tenant_id, user_id, id, media_type, media_url, thumbnail_url, text_content, text_style, background_color, background_gradient, duration, video_duration, poll_question, poll_options, view_count, created_at
             FROM stories
             WHERE is_active = 1 AND expires_at <= NOW()'
        );

        if ($archived > 0) {
            Log::info("StoryService: Archived {$archived} expired stories");
        }

        // Deactivate expired stories
        $deactivated = DB::update(
            'UPDATE stories SET is_active = 0 WHERE is_active = 1 AND expires_at <= NOW()'
        );

        if ($deactivated > 0) {
            Log::info("StoryService: Deactivated {$deactivated} expired stories");
        }

        // Find stories older than retention period for media cleanup
        $oldStories = DB::select(
            'SELECT id, media_url, thumbnail_url FROM stories
             WHERE is_active = 0
               AND expires_at <= DATE_SUB(NOW(), INTERVAL ? DAY)
               AND (media_url IS NOT NULL OR thumbnail_url IS NOT NULL)',
            [self::MEDIA_RETENTION_DAYS]
        );

        foreach ($oldStories as $story) {
            $this->deleteMediaFile($story->media_url);
            $this->deleteMediaFile($story->thumbnail_url);

            DB::update(
                'UPDATE stories SET media_url = NULL, thumbnail_url = NULL WHERE id = ?',
                [$story->id]
            );
        }

        if (count($oldStories) > 0) {
            Log::info('StoryService: Cleaned up media for ' . count($oldStories) . ' old stories');
        }
    }

    /**
     * Handle story image upload.
     *
     * @param \Illuminate\Http\UploadedFile $file
     * @param int $tenantId
     * @param int $userId
     * @return string The relative URL of the uploaded file
     */
    public function uploadMedia(\Illuminate\Http\UploadedFile $file, int $tenantId, int $userId): string
    {
        // Defense-in-depth: validate even though controller already checks
        $allowedMimes = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
        ];
        $detectedMime = $file->getMimeType();
        if (!in_array($detectedMime, $allowedMimes, true)) {
            throw new \RuntimeException(__('api.story_invalid_media_type', ['type' => $detectedMime ?? 'unknown']));
        }

        $dir = "uploads/stories/{$tenantId}/{$userId}";
        // Derive extension from validated MIME type (not user-supplied filename)
        $extMap = [
            'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/gif' => 'gif', 'image/webp' => 'webp',
            'video/mp4' => 'mp4', 'video/webm' => 'webm', 'video/ogg' => 'ogg', 'video/quicktime' => 'mov',
        ];
        $ext = $extMap[$detectedMime] ?? 'bin';
        $filename = 'story_' . bin2hex(random_bytes(16)) . '.' . $ext;

        // Store in httpdocs/ (Apache document root), not public/ (Laravel default)
        $targetDir = base_path("httpdocs/{$dir}");
        if (!is_dir($targetDir)) {
            mkdir($targetDir, 0755, true);
        }
        $file->move($targetDir, $filename);

        return "/{$dir}/{$filename}";
    }

    /**
     * Reply to a story via DM.
     *
     * Creates a direct message to the story owner with story context attached.
     *
     * @param int $storyId
     * @param int $senderId The user sending the reply
     * @param string $body The reply message text
     * @return array The created message
     *
     * @throws \RuntimeException if story not found, expired, or self-reply
     */
    public function replyToStory(int $storyId, int $senderId, string $body): array
    {
        $tenantId = TenantContext::getId();

        // Verify story exists, is active, and belongs to this tenant
        $story = DB::selectOne(
            'SELECT id, user_id FROM stories WHERE id = ? AND tenant_id = ? AND is_active = 1 AND expires_at > NOW()',
            [$storyId, $tenantId]
        );

        if (!$story) {
            throw new \RuntimeException(__('api.story_not_found_or_expired'));
        }

        $storyOwnerId = (int) $story->user_id;

        // Prevent self-reply
        if ($senderId === $storyOwnerId) {
            throw new \RuntimeException(__('api.story_reply_to_own'));
        }

        if (!$this->canViewStory((object) $story, $senderId, $tenantId)) {
            throw new \RuntimeException(__('api.story_not_found_or_expired'));
        }

        // Send message with story context
        $message = MessageService::send($senderId, [
            'recipient_id' => $storyOwnerId,
            'body' => $body,
            'context_type' => 'story',
            'context_id' => $storyId,
        ]);

        return $message;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Story Archive
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Get archived stories for a user (for highlight curation after expiry).
     *
     * @param int $userId
     * @param int $limit
     * @param int $offset
     * @return array
     */
    public function getArchivedStories(int $userId, int $limit = 50, int $offset = 0): array
    {
        $tenantId = TenantContext::getId();

        $stories = DB::select(
            'SELECT * FROM story_archive
             WHERE tenant_id = ? AND user_id = ?
             ORDER BY original_created_at DESC
             LIMIT ? OFFSET ?',
            [$tenantId, $userId, $limit, $offset]
        );

        return array_map(fn($s) => [
            'id' => (int) $s->id,
            'original_story_id' => (int) $s->original_story_id,
            'media_type' => $s->media_type,
            'media_url' => $s->media_url,
            'thumbnail_url' => $s->thumbnail_url,
            'text_content' => $s->text_content,
            'background_gradient' => $s->background_gradient,
            'duration' => (int) $s->duration,
            'view_count' => (int) $s->view_count,
            'created_at' => $s->original_created_at,
            'archived_at' => $s->archived_at,
        ], $stories);
    }

    // ────────────────────────────────────────────────────────────────────────
    // Close Friends
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Get a user's close friends list.
     *
     * @param int $userId
     * @return array
     */
    public function getCloseFriends(int $userId): array
    {
        $tenantId = TenantContext::getId();

        return DB::select(
            'SELECT cf.friend_id, u.first_name, u.last_name, u.avatar_url, cf.created_at
             FROM close_friends cf
             JOIN users u ON u.id = cf.friend_id
             WHERE cf.tenant_id = ? AND cf.user_id = ?
             ORDER BY u.first_name ASC',
            [$tenantId, $userId]
        );
    }

    /**
     * Add a user to close friends list.
     *
     * @param int $userId
     * @param int $friendId
     */
    public function addCloseFriend(int $userId, int $friendId): void
    {
        $tenantId = TenantContext::getId();

        DB::statement(
            'INSERT IGNORE INTO close_friends (user_id, friend_id, tenant_id) VALUES (?, ?, ?)',
            [$userId, $friendId, $tenantId]
        );
    }

    /**
     * Remove a user from close friends list.
     *
     * @param int $userId
     * @param int $friendId
     */
    public function removeCloseFriend(int $userId, int $friendId): void
    {
        $tenantId = TenantContext::getId();

        DB::delete(
            'DELETE FROM close_friends WHERE user_id = ? AND friend_id = ? AND tenant_id = ?',
            [$userId, $friendId, $tenantId]
        );
    }

    // ────────────────────────────────────────────────────────────────────────
    // Story Analytics
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Track a story analytics event.
     *
     * @param int $storyId
     * @param int $viewerId
     * @param string $eventType One of: view_start, view_complete, tap_forward, tap_back, tap_exit, swipe_next, swipe_prev
     * @param int|null $watchDurationMs Time spent viewing in milliseconds
     */
    public function trackAnalytics(int $storyId, int $viewerId, string $eventType, ?int $watchDurationMs = null): void
    {
        $allowed = ['view_start', 'view_complete', 'tap_forward', 'tap_back', 'tap_exit', 'swipe_next', 'swipe_prev'];
        if (!in_array($eventType, $allowed)) {
            return;
        }

        $tenantId = TenantContext::getId();
        $story = DB::selectOne(
            'SELECT id FROM stories WHERE id = ? AND tenant_id = ?',
            [$storyId, $tenantId]
        );
        if (!$story) return;

        DB::insert(
            'INSERT INTO story_analytics (story_id, viewer_id, event_type, watch_duration_ms) VALUES (?, ?, ?, ?)',
            [$storyId, $viewerId, $eventType, $watchDurationMs]
        );
    }

    /**
     * Get analytics summary for a story (owner only).
     *
     * @param int $storyId
     * @param int $ownerId
     * @return array
     *
     * @throws \RuntimeException if not owner
     */
    public function getStoryAnalytics(int $storyId, int $ownerId): array
    {
        $tenantId = TenantContext::getId();

        $story = DB::selectOne(
            'SELECT id, user_id, view_count FROM stories WHERE id = ? AND tenant_id = ?',
            [$storyId, $tenantId]
        );

        if (!$story || (int) $story->user_id !== $ownerId) {
            throw new \RuntimeException(__('api.story_not_found_or_not_owner'));
        }

        // Event counts
        $events = DB::select(
            'SELECT event_type, COUNT(*) as cnt FROM story_analytics WHERE story_id = ? GROUP BY event_type',
            [$storyId]
        );

        $counts = [];
        foreach ($events as $e) {
            $counts[$e->event_type] = (int) $e->cnt;
        }

        // Average watch duration
        $avgDuration = DB::selectOne(
            'SELECT AVG(watch_duration_ms) as avg_ms FROM story_analytics WHERE story_id = ? AND watch_duration_ms IS NOT NULL',
            [$storyId]
        );

        // Completion rate
        $starts = $counts['view_start'] ?? 0;
        $completes = $counts['view_complete'] ?? 0;
        $completionRate = $starts > 0 ? round(($completes / $starts) * 100, 1) : 0;

        return [
            'story_id' => $storyId,
            'view_count' => (int) $story->view_count,
            'events' => $counts,
            'completion_rate' => $completionRate,
            'avg_watch_duration_ms' => $avgDuration->avg_ms ? (int) round($avgDuration->avg_ms) : null,
            'tap_forward_count' => $counts['tap_forward'] ?? 0,
            'tap_back_count' => $counts['tap_back'] ?? 0,
            'exit_count' => $counts['tap_exit'] ?? 0,
        ];
    }

    /**
     * Update a highlight's title.
     */
    public function updateHighlight(int $highlightId, int $userId, string $title): array
    {
        $tenantId = TenantContext::getId();

        $affected = DB::update(
            'UPDATE story_highlights SET title = ? WHERE id = ? AND user_id = ? AND tenant_id = ?',
            [$title, $highlightId, $userId, $tenantId]
        );

        if ($affected === 0) {
            throw new \RuntimeException(__('api.story_highlight_not_found_or_not_owner'));
        }

        return $this->getHighlightById($highlightId);
    }

    /**
     * Remove a story from a highlight.
     */
    public function removeFromHighlight(int $highlightId, int $storyId, int $userId): void
    {
        $tenantId = TenantContext::getId();

        // Verify ownership
        $highlight = DB::selectOne(
            'SELECT id FROM story_highlights WHERE id = ? AND user_id = ? AND tenant_id = ?',
            [$highlightId, $userId, $tenantId]
        );

        if (!$highlight) {
            throw new \RuntimeException(__('api.story_highlight_not_found_or_not_owner'));
        }

        DB::delete(
            'DELETE FROM story_highlight_items WHERE highlight_id = ? AND story_id = ?',
            [$highlightId, $storyId]
        );
    }

    /**
     * Reorder highlights for a user.
     * @param array $order Array of highlight IDs in desired order
     */
    public function reorderHighlights(int $userId, array $order): void
    {
        $tenantId = TenantContext::getId();

        foreach ($order as $position => $highlightId) {
            DB::update(
                'UPDATE story_highlights SET display_order = ? WHERE id = ? AND user_id = ? AND tenant_id = ?',
                [$position, (int) $highlightId, $userId, $tenantId]
            );
        }
    }

    /**
     * Save stickers for a story.
     * @param int $storyId
     * @param int $userId Must be story owner
     * @param array $stickers Array of sticker data
     */
    public function saveStickers(int $storyId, int $userId, array $stickers): void
    {
        $tenantId = TenantContext::getId();

        // Verify ownership
        $story = DB::selectOne(
            'SELECT id FROM stories WHERE id = ? AND user_id = ? AND tenant_id = ?',
            [$storyId, $userId, $tenantId]
        );

        if (!$story) {
            throw new \RuntimeException(__('api.story_not_found_or_not_owner'));
        }

        // Clear existing stickers
        DB::delete('DELETE FROM story_stickers WHERE story_id = ?', [$storyId]);

        // Insert new stickers
        foreach ($stickers as $s) {
            $type = $s['sticker_type'] ?? 'emoji';
            $allowed = ['mention', 'location', 'link', 'emoji', 'text_tag'];
            if (!in_array($type, $allowed)) continue;

            DB::insert(
                'INSERT INTO story_stickers (story_id, sticker_type, content, metadata, position_x, position_y, rotation, scale) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    $storyId,
                    $type,
                    $s['content'] ?? '',
                    isset($s['metadata']) ? json_encode($s['metadata']) : null,
                    (float) ($s['position_x'] ?? 50),
                    (float) ($s['position_y'] ?? 50),
                    (float) ($s['rotation'] ?? 0),
                    (float) ($s['scale'] ?? 1),
                ]
            );
        }
    }

    /**
     * Get stickers for a story.
     */
    public function getStickers(int $storyId): array
    {
        $stickers = DB::select(
            'SELECT * FROM story_stickers WHERE story_id = ? ORDER BY id ASC',
            [$storyId]
        );

        return array_map(fn($s) => [
            'id' => (int) $s->id,
            'sticker_type' => $s->sticker_type,
            'content' => $s->content,
            'metadata' => $s->metadata ? json_decode($s->metadata, true) : null,
            'position_x' => (float) $s->position_x,
            'position_y' => (float) $s->position_y,
            'rotation' => (float) $s->rotation,
            'scale' => (float) $s->scale,
        ], $stickers);
    }

    // ────────────────────────────────────────────────────────────────────────
    // Private helpers
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Notify a user's accepted connections about a new story.
     *
     * Sends both an in-app notification (via NotificationDispatcher) and
     * a real-time broadcast (via RealtimeService) to each connected user.
     *
     * @param int $userId  The story author
     * @param int $storyId The newly created story ID
     */
    private function notifyConnections(int $userId, int $storyId): void
    {
        $tenantId = TenantContext::getId();

        // Get the story author's name
        $user = DB::selectOne(
            'SELECT first_name, last_name FROM users WHERE id = ? AND tenant_id = ?',
            [$userId, $tenantId]
        );

        if (!$user) {
            return;
        }

        $userName = trim(($user->first_name ?? '') . ' ' . ($user->last_name ?? ''));

        // Get all accepted connections for this user (tenant-scoped) with their preferred_language
        // so the notification body renders in each recipient's own locale.
        $connections = DB::select(
            "SELECT CASE WHEN c.requester_id = ? THEN c.receiver_id ELSE c.requester_id END as friend_id,
                    u.preferred_language
             FROM connections c
             JOIN users u ON u.id = CASE WHEN c.requester_id = ? THEN c.receiver_id ELSE c.requester_id END
             WHERE (c.requester_id = ? OR c.receiver_id = ?)
               AND c.status = ?
               AND c.tenant_id = ?",
            [$userId, $userId, $userId, $userId, 'accepted', $tenantId]
        );

        $link = '/feed';

        foreach ($connections as $connection) {
            $friendId = (int) $connection->friend_id;

            try {
                // Render per-friend under their preferred locale — both the bell-dispatched
                // text and the realtime broadcast body.
                LocaleContext::withLocale($connection->preferred_language ?? null, function () use ($friendId, $userName, $link, $storyId, $userId) {
                    $content = __('emails_misc.stories.new_story_notification', ['name' => $userName]);

                    // In-app notification + email routing
                    NotificationDispatcher::dispatch(
                        $friendId,
                        'global',
                        null,
                        'new_story',
                        $content,
                        $link,
                        null
                    );

                    // Real-time push via Pusher
                    RealtimeService::broadcastNotification($friendId, [
                        'type' => 'new_story',
                        'message' => $content,
                        'link' => $link,
                        'story_id' => $storyId,
                        'user_id' => $userId,
                    ]);
                });
            } catch (\Throwable $e) {
                Log::warning('StoryService: Failed to notify connection of new story', [
                    'story_id' => $storyId,
                    'friend_id' => $friendId,
                    'error' => $e->getMessage(),
                ]);
                // Continue notifying remaining connections
            }
        }
    }

    private function getStoryById(int $storyId): array
    {
        $story = DB::selectOne(
            'SELECT s.*, u.first_name, u.last_name, u.avatar_url
             FROM stories s
             JOIN users u ON u.id = s.user_id
             WHERE s.id = ? AND s.tenant_id = ?',
            [$storyId, TenantContext::getId()]
        );

        if (!$story) {
            return [];
        }

        return $this->formatStory($story);
    }

    private function getHighlightById(int $highlightId): array
    {
        $h = DB::selectOne(
            'SELECT h.*,
                    (SELECT COUNT(*) FROM story_highlight_items shi WHERE shi.highlight_id = h.id) as story_count
             FROM story_highlights h
             WHERE h.id = ?',
            [$highlightId]
        );

        if (!$h) {
            return [];
        }

        return [
            'id' => (int) $h->id,
            'title' => $h->title,
            'cover_url' => $h->cover_url,
            'story_count' => (int) $h->story_count,
            'display_order' => (int) $h->display_order,
            'created_at' => $h->created_at,
        ];
    }

    private function formatStory(object $story): array
    {
        $result = [
            'id' => (int) $story->id,
            'user_id' => (int) $story->user_id,
            'media_type' => $story->media_type,
            'media_url' => $story->media_url,
            'thumbnail_url' => $story->thumbnail_url,
            'text_content' => $story->text_content,
            'text_style' => $story->text_style ? json_decode($story->text_style, true) : null,
            'background_color' => $story->background_color,
            'background_gradient' => $story->background_gradient,
            'duration' => (int) $story->duration,
            'video_duration' => isset($story->video_duration) ? (float) $story->video_duration : null,
            'view_count' => (int) $story->view_count,
            'is_viewed' => (bool) ($story->is_viewed ?? false),
            'expires_at' => $story->expires_at,
            'created_at' => $story->created_at,
        ];

        // Include user info if available
        if (isset($story->first_name)) {
            $result['user'] = [
                'id' => (int) $story->user_id,
                'name' => trim(($story->first_name ?? '') . ' ' . ($story->last_name ?? '')),
                'first_name' => $story->first_name ?? '',
                'avatar_url' => $story->avatar_url ?? null,
            ];
        }

        // Include poll data if applicable
        if ($story->media_type === 'poll') {
            $result['poll_question'] = $story->poll_question;
            $result['poll_options'] = $story->poll_options ? json_decode($story->poll_options, true) : [];
            $result['poll_results'] = $this->getPollResults((int) $story->id);
        }

        // Include stickers
        $result['stickers'] = $this->getStickers((int) $story->id);

        return $result;
    }

    private function canViewStory(object $story, int $viewerId, int $tenantId): bool
    {
        $ownerId = (int) $story->user_id;
        if ($ownerId === $viewerId) {
            return true;
        }

        $audience = (string) ($story->audience ?? 'everyone');
        if ($audience === 'everyone' || $audience === '') {
            return true;
        }

        if ($audience === 'connections') {
            return DB::table('connections')
                ->where('tenant_id', $tenantId)
                ->where('status', 'accepted')
                ->where(function ($query) use ($ownerId, $viewerId) {
                    $query->where(function ($inner) use ($ownerId, $viewerId) {
                        $inner->where('requester_id', $ownerId)->where('receiver_id', $viewerId);
                    })->orWhere(function ($inner) use ($ownerId, $viewerId) {
                        $inner->where('receiver_id', $ownerId)->where('requester_id', $viewerId);
                    });
                })
                ->exists();
        }

        if ($audience === 'close_friends') {
            return DB::table('close_friends')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $ownerId)
                ->where('friend_id', $viewerId)
                ->exists();
        }

        return false;
    }

    private function deleteMediaFile(?string $url): void
    {
        if (!$url) {
            return;
        }

        // Convert URL path to filesystem path (httpdocs is the doc root, not public/)
        $path = base_path('httpdocs/' . ltrim($url, '/'));

        if (file_exists($path)) {
            try {
                unlink($path);
            } catch (\Throwable $e) {
                Log::warning("StoryService: Failed to delete media file: {$path}", ['error' => $e->getMessage()]);
            }
        }
    }
}
