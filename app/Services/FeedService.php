<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Enums\GroupStatus;
use App\Models\FeedActivity;
use App\Models\FeedPost;
use App\Models\Like;
use App\Exceptions\SafeguardingPolicyException;
use App\Services\FeedRankingService;
use App\Services\LinkPreviewService;
use App\Services\MentionService;
use App\Services\ShareService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use App\Core\TenantContext;
use App\Support\Events\EventSearchVisibility;
use App\Support\FeedItemTables;
use App\Support\UserDisplayName;

/**
 * FeedService — Laravel DI-based service for social feed operations.
 *
 * Queries the feed_activity table (unified feed) to match the legacy response
 * shape expected by the React frontend. All queries are tenant-scoped
 * automatically via the HasTenantScope trait on the FeedActivity model.
 */
class FeedService
{
    /**
     * Fix 6: Maximum allowed post body length (50 KB) to prevent oversized payload abuse.
     */
    public const MAX_POST_LENGTH = 50000;

    /**
     * Resolve and gate every @mentioned member before any post content write.
     */
    public static function assertMentionContactsAllowed(
        string $content,
        int $authorId,
        int $tenantId,
        string $channel,
    ): void {
        if ((int) TenantContext::getId() !== $tenantId) {
            throw new SafeguardingPolicyException(
                'SAFEGUARDING_POLICY_UNAVAILABLE',
                __('safeguarding.errors.policy_unavailable'),
            );
        }

        try {
            $recipientIds = array_values(MentionService::resolveMentions(
                MentionService::extractMentions($content),
                $tenantId,
            ));
        } catch (\Throwable $e) {
            Log::error('Safeguarding feed mention recipient resolution unavailable', [
                'tenant_id' => $tenantId,
                'channel' => $channel,
                'reason_code' => 'mention_recipient_lookup_failed',
                'exception_class' => $e::class,
            ]);
            throw new SafeguardingPolicyException(
                'SAFEGUARDING_POLICY_UNAVAILABLE',
                __('safeguarding.errors.policy_unavailable'),
            );
        }

        $recipientIds = array_values(array_unique(array_filter(
            array_map(static fn (mixed $id): int => (int) $id, $recipientIds),
            static fn (int $id): bool => $id > 0 && $id !== $authorId,
        )));
        sort($recipientIds, SORT_NUMERIC);

        if ($recipientIds === []) {
            return;
        }

        app(SafeguardingInteractionPolicy::class)->assertManyLocalContactsAllowed(
            $authorId,
            $recipientIds,
            $tenantId,
            $channel,
        );
    }

    /**
     * Map plural filter names to source_type values (matches legacy).
     *
     * 'badge_earned' / 'level_up' were mapped here and are deliberately gone:
     * gamification milestones are no longer feed content (see
     * self::EXCLUDED_SOURCE_TYPES), so there is no filter that can select them.
     */
    private const TYPE_MAP = [
        'posts' => 'post', 'listings' => 'listing', 'events' => 'event',
        'polls' => 'poll', 'goals' => 'goal', 'jobs' => 'job',
        'challenges' => 'challenge', 'volunteering' => 'volunteer',
        'blogs' => 'blog', 'discussions' => 'discussion',
    ];

    /**
     * Source types that never appear in any feed read.
     *
     * Gamification milestone cards ('badge_earned', 'level_up') were rendered as
     * full-width celebratory cards in every client and dominated the feed.
     * Removed on the owner's instruction (2026-08-27): the feed carries member
     * content, and gamification lives on the achievements/profile surfaces.
     *
     * GamificationService no longer WRITES these rows, so this is the guard for
     * historical rows already in feed_activity. It is applied in getFeed(), which
     * is the single read path behind the main feed, profile feeds, group feeds
     * and the single-item lookups — so no client can request them back.
     *
     * The rest of gamification (XP, levels, badge awards, notifications, emails,
     * leaderboards, the achievements page) is untouched.
     */
    public const EXCLUDED_SOURCE_TYPES = ['badge_earned', 'level_up'];

    public function __construct(
        private readonly FeedActivity $feedActivity,
        private readonly FeedPost $feedPost,
    ) {}

    /**
     * Get feed items from feed_activity with cursor-based pagination.
     *
     * Returns the same response shape as the legacy FeedService::getFeed().
     *
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public function getFeed(?int $currentUserId, array $filters = []): array
    {
        $limit = min((int) ($filters['limit'] ?? 20), 100);
        $mode = $filters['mode'] ?? 'ranked';
        $isRanked = ($mode !== 'chronological' && $mode !== 'recent');
        $type = $filters['type'] ?? 'all';
        $profileUserId = $filters['user_id'] ?? null;
        $groupId = $filters['group_id'] ?? null;
        $subtype = $filters['subtype'] ?? null;
        $cursor = $filters['cursor'] ?? null;
        /*
          🔴 The DETAIL endpoints must not truncate, and this is why the option exists.

          `SocialController::showPost()` is implemented as `getFeed(['post_id' => …])`, so it
          inherited the list's 500-character limit — the one place a limit must never apply.
          Reported by a member on 2026-08-24 ("It won't let me read more") and measured: a
          1,268-character post came back from `/v2/feed/posts/210` as **503 characters** with
          `content_truncated: true`. The full text of any post over 500 characters was
          unreachable in the mobile app, and the "Read more" control took you to a screen
          that had no more to show.

          The list keeps truncating on purpose: it is 20 items a page and the payload matters.
        */
        $fullContent = (bool) ($filters['full_content'] ?? false);
        $commentsHasDeletedAt = Schema::hasColumn('comments', 'deleted_at');

        // Decode HMAC-signed cursor: base64(sig.json_payload)
        $cursorCreatedAt = null;
        $cursorActivityId = null;
        if ($cursor) {
            $decoded = base64_decode($cursor, strict: true);
            if ($decoded !== false) {
                $dotPos = strpos($decoded, '.');
                if ($dotPos !== false) {
                    $sig     = substr($decoded, 0, $dotPos);
                    $payload = substr($decoded, $dotPos + 1);
                    $expected = hash_hmac('sha256', $payload, config('app.key'));
                    if (hash_equals($expected, $sig)) {
                        $data = json_decode($payload, true);
                        if (isset($data['ts'], $data['id'])) {
                            $cursorCreatedAt  = $data['ts'];
                            $cursorActivityId = (int) $data['id'];
                        }
                    }
                } else {
                    // Legacy unsigned cursor (base64("created_at|id") or base64("id")) — accept for backwards compat
                    if (str_contains($decoded, '|')) {
                        [$cursorCreatedAt, $cursorActivityIdStr] = explode('|', $decoded, 2);
                        $cursorActivityId = ctype_digit($cursorActivityIdStr) ? (int) $cursorActivityIdStr : null;
                    } elseif (ctype_digit($decoded)) {
                        $cursorActivityId = (int) $decoded;
                    }
                }
            }
        }

        // Virtual filters ("saved", "following") are scope filters, not source_type filters.
        // They constrain the result set by user relationship rather than content type.
        $isSavedFilter = $type === 'saved';
        $isFollowingFilter = $type === 'following';

        // Map type filter to source_type (excluding virtual filters)
        $sourceType = null;
        if ($type !== 'all' && !$isSavedFilter && !$isFollowingFilter) {
            $sourceType = self::TYPE_MAP[$type] ?? null;
        }

        // Build query — scope the users JOIN to the current tenant to prevent cross-tenant user leakage
        $tenantId = TenantContext::getId();
        if ($profileUserId !== null && !FeedItemTables::canViewProfile((int) $profileUserId, $currentUserId)) {
            return ['items' => [], 'cursor' => null, 'has_more' => false];
        }
        if ($groupId !== null && !FeedItemTables::canViewGroup((int) $groupId, $currentUserId, $tenantId)) {
            return ['items' => [], 'cursor' => null, 'has_more' => false];
        }
        $query = $this->feedActivity->newQuery()
            ->join('users as u', function ($join) use ($tenantId) {
                $join->on('feed_activity.user_id', '=', 'u.id')
                     ->where('u.tenant_id', '=', $tenantId);
            })
            ->where('feed_activity.is_visible', true)
            // Gamification milestones are not feed content — see EXCLUDED_SOURCE_TYPES.
            ->whereNotIn('feed_activity.source_type', self::EXCLUDED_SOURCE_TYPES)
            ->select([
                'feed_activity.id as activity_id',
                'feed_activity.source_type',
                'feed_activity.source_id',
                'feed_activity.user_id',
                'feed_activity.title',
                'feed_activity.content',
                'feed_activity.image_url',
                'feed_activity.metadata',
                'feed_activity.group_id',
                'feed_activity.created_at',
                // NULLIF guards: users.name is NOT NULL, so a plain COALESCE
                // never reaches the first/last fallback and an empty name ('')
                // renders as a nameless post. Same expression as the admin
                // moderation list in AdminFeedController::index.
                DB::raw("COALESCE(NULLIF(u.name, ''), NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), '')) as author_name"),
                'u.avatar_url as author_avatar',
                'u.location as user_location',
            ]);

        $this->applyPostVisibilityScope($query, $currentUserId, $tenantId);

        // Retained Event rows can be draft, under review, archived, cancelled,
        // completed, or recurrence templates. Apply the canonical lifecycle
        // boundary before pagination so stale activity rows cannot consume a
        // page slot, distort has_more, or leak through a single-item lookup.
        $query->where(function ($items) use ($tenantId): void {
            $items->where('feed_activity.source_type', '<>', 'event')
                ->orWhereExists(function ($events) use ($tenantId): void {
                    $events->selectRaw('1')
                        ->from('events as visible_events')
                        ->whereColumn('visible_events.id', 'feed_activity.source_id');
                    EventSearchVisibility::applyToQuery($events, $tenantId, 'visible_events');
                });
        });

        if ($sourceType !== null) {
            $query->where('feed_activity.source_type', $sourceType);
        }

        // "Saved" virtual filter: only items the current user has bookmarked.
        // Joins bookmarks on (bookmarkable_type, bookmarkable_id) = (source_type, source_id).
        // Anonymous users get an empty result set.
        if ($isSavedFilter) {
            if (!$currentUserId) {
                return ['items' => [], 'cursor' => null, 'has_more' => false];
            }
            $query->whereExists(function ($sub) use ($currentUserId, $tenantId) {
                $sub->select(DB::raw(1))
                    ->from('bookmarks')
                    ->whereColumn('bookmarks.bookmarkable_type', 'feed_activity.source_type')
                    ->whereColumn('bookmarks.bookmarkable_id', 'feed_activity.source_id')
                    ->where('bookmarks.user_id', $currentUserId)
                    ->where('bookmarks.tenant_id', $tenantId);
            });
        }

        // "Following" virtual filter: only items authored by users the current user
        // has an accepted connection with (in either direction).
        if ($isFollowingFilter) {
            if (!$currentUserId) {
                return ['items' => [], 'cursor' => null, 'has_more' => false];
            }
            $query->whereExists(function ($sub) use ($currentUserId, $tenantId) {
                $sub->select(DB::raw(1))
                    ->from('connections')
                    ->where('connections.tenant_id', $tenantId)
                    ->where('connections.status', 'accepted')
                    ->where(function ($q) use ($currentUserId) {
                        $q->where(function ($q2) use ($currentUserId) {
                            $q2->where('connections.requester_id', $currentUserId)
                               ->whereColumn('connections.receiver_id', 'feed_activity.user_id');
                        })->orWhere(function ($q2) use ($currentUserId) {
                            $q2->where('connections.receiver_id', $currentUserId)
                               ->whereColumn('connections.requester_id', 'feed_activity.user_id');
                        });
                    });
            });
        }

        if ($profileUserId !== null) {
            $pid = (int) $profileUserId;
            // Profile feeds include the user's own activity AND items they've
            // reposted — the latter surface on their profile as "Shared by X"
            // via the shared_by hydration further down. Without this OR branch,
            // reposts were invisible because post_shares rows don't create
            // feed_activity rows (the table has a unique index on source).
            $query->where(function ($q) use ($pid, $tenantId) {
                $q->where('feed_activity.user_id', $pid)
                  ->orWhereExists(function ($sub) use ($pid, $tenantId) {
                      $sub->select(DB::raw(1))
                          ->from('post_shares')
                          ->whereColumn('post_shares.tenant_id', 'feed_activity.tenant_id')
                          ->whereColumn('post_shares.original_type', 'feed_activity.source_type')
                          ->whereColumn('post_shares.original_post_id', 'feed_activity.source_id')
                          ->where('post_shares.tenant_id', $tenantId)
                          ->where('post_shares.user_id', $pid);
                  });
            });
        }

        if ($groupId !== null) {
            $query->where('feed_activity.group_id', (int) $groupId);
        }

        if (isset($filters['post_id'])) {
            $query->where('feed_activity.source_id', (int) $filters['post_id'])
                  ->where('feed_activity.source_type', 'post');
        }

        // Polymorphic single-item lookup: feed_activity.source_id + source_type.
        // Used by the polymorphic detail endpoint so deep-links to listings,
        // events, polls, etc. resolve through the same feed shape as feedV2.
        if (isset($filters['entity_id']) && isset($filters['entity_type'])) {
            $query->where('feed_activity.source_id', (int) $filters['entity_id'])
                  ->where('feed_activity.source_type', (string) $filters['entity_type']);
        }

        if ($subtype !== null) {
            $query->whereRaw(
                "JSON_UNQUOTE(JSON_EXTRACT(feed_activity.metadata, '$.listing_type')) = ?",
                [$subtype]
            );
        }

        // Exclude admin-hidden posts
        $query->where('feed_activity.is_hidden', false);

        // Exclude posts hidden by current user (both legacy and V2 tables)
        if ($currentUserId) {
            $query->whereNotExists(function ($sub) use ($currentUserId, $tenantId) {
                $sub->select(DB::raw(1))
                    ->from('feed_hidden')
                    ->whereColumn('feed_hidden.target_id', 'feed_activity.source_id')
                    ->whereColumn('feed_hidden.target_type', 'feed_activity.source_type')
                    ->whereColumn('feed_hidden.tenant_id', 'feed_activity.tenant_id')
                    ->where('feed_hidden.tenant_id', $tenantId)
                    ->where('feed_hidden.user_id', $currentUserId);
            });
            $query->whereNotExists(function ($sub) use ($currentUserId, $tenantId) {
                $sub->select(DB::raw(1))
                    ->from('user_hidden_posts')
                    ->whereColumn('user_hidden_posts.post_id', 'feed_activity.source_id')
                    ->whereColumn('user_hidden_posts.tenant_id', 'feed_activity.tenant_id')
                    ->where('user_hidden_posts.tenant_id', $tenantId)
                    ->where('user_hidden_posts.user_id', $currentUserId);
            });
        }

        // Exclude blocked users (both directions)
        if ($currentUserId) {
            $blockedIds = BlockUserService::getBlockedPairIds($currentUserId);
            if (!empty($blockedIds)) {
                $query->whereNotIn('feed_activity.user_id', $blockedIds);
            }
        }

        // Exclude muted users (both legacy and V2 tables)
        if ($currentUserId) {
            $query->whereNotExists(function ($sub) use ($currentUserId, $tenantId) {
                $sub->select(DB::raw(1))
                    ->from('feed_muted_users')
                    ->whereColumn('feed_muted_users.muted_user_id', 'feed_activity.user_id')
                    ->whereColumn('feed_muted_users.tenant_id', 'feed_activity.tenant_id')
                    ->where('feed_muted_users.tenant_id', $tenantId)
                    ->where('feed_muted_users.user_id', $currentUserId);
            });
            $query->whereNotExists(function ($sub) use ($currentUserId, $tenantId) {
                $sub->select(DB::raw(1))
                    ->from('user_muted_users')
                    ->whereColumn('user_muted_users.muted_user_id', 'feed_activity.user_id')
                    ->whereColumn('user_muted_users.tenant_id', 'feed_activity.tenant_id')
                    ->where('user_muted_users.tenant_id', $tenantId)
                    ->where('user_muted_users.user_id', $currentUserId);
            });
        }

        // Group child content is member-only, even when the parent overview is
        // public. The membership and parent lifecycle must both be active.
        if ($currentUserId) {
            $query->where(function ($q) use ($currentUserId, $tenantId) {
                $q->whereNull('feed_activity.group_id')
                  ->orWhereExists(function ($sub) use ($currentUserId, $tenantId) {
                      $sub->select(DB::raw(1))
                          ->from('group_members as visible_group_members')
                          ->join('groups as visible_groups', 'visible_groups.id', '=', 'visible_group_members.group_id')
                          ->whereColumn('visible_group_members.group_id', 'feed_activity.group_id')
                          ->where('visible_group_members.user_id', $currentUserId)
                          ->where('visible_group_members.tenant_id', $tenantId)
                          ->where('visible_group_members.status', 'active')
                          ->where('visible_groups.tenant_id', $tenantId)
                          ->where('visible_groups.status', GroupStatus::Active->value);
                  });
            });
        } else {
            $query->whereNull('feed_activity.group_id');
        }

        // Cursor pagination by (created_at, id) tuple
        if ($cursorCreatedAt !== null && $cursorActivityId !== null) {
            $query->where(function ($q) use ($cursorCreatedAt, $cursorActivityId) {
                $q->where('feed_activity.created_at', '<', $cursorCreatedAt)
                  ->orWhere(function ($q2) use ($cursorCreatedAt, $cursorActivityId) {
                      $q2->where('feed_activity.created_at', '=', $cursorCreatedAt)
                         ->where('feed_activity.id', '<', $cursorActivityId);
                  });
            });
        } elseif ($cursorActivityId !== null) {
            $query->where('feed_activity.id', '<', $cursorActivityId);
        }

        $query->orderByDesc('feed_activity.created_at')
              ->orderByDesc('feed_activity.id');

        $fetchLimit = $limit;

        $rows = $query->limit($fetchLimit + 1)->get();

        $hasMore = $rows->count() > $fetchLimit;
        if ($hasMore) {
            $rows->pop();
        }

        if ($rows->isEmpty()) {
            return ['items' => [], 'cursor' => null, 'has_more' => false];
        }

        // Collect source IDs grouped by type for batch loading likes/comments
        $sourcesByType = [];
        foreach ($rows as $row) {
            $sourcesByType[$row->source_type][] = (int) $row->source_id;
        }

        // Build a polymorphic where helper: (target_type=? AND target_id IN (...)) OR ... per type.
        // One query covers every source_type in the feed page, replacing N per-type round trips.
        $applyPolymorphicTargetFilter = function ($q) use ($sourcesByType) {
            $q->where(function ($outer) use ($sourcesByType) {
                foreach ($sourcesByType as $sType => $sIds) {
                    $outer->orWhere(function ($inner) use ($sType, $sIds) {
                        $inner->where('target_type', $sType)
                              ->whereIn('target_id', $sIds);
                    });
                }
            });
        };

        // Batch load like counts (single polymorphic query).
        $likeCounts = [];
        $likeCountRows = DB::table('likes')
            ->selectRaw('target_type, target_id, COUNT(*) as cnt')
            ->where('tenant_id', $tenantId)
            ->tap($applyPolymorphicTargetFilter)
            ->groupBy('target_type', 'target_id')
            ->get();
        foreach ($likeCountRows as $row) {
            $likeCounts[$row->target_type . ':' . (int) $row->target_id] = (int) $row->cnt;
        }

        // Batch load comment counts (single polymorphic query).
        $commentCounts = [];
        $commentCountQuery = DB::table('comments')
            ->selectRaw('target_type, target_id, COUNT(*) as cnt')
            ->where('tenant_id', $tenantId)
            ->tap($applyPolymorphicTargetFilter)
            ->groupBy('target_type', 'target_id');
        if ($commentsHasDeletedAt) {
            $commentCountQuery->whereNull('deleted_at');
        }
        foreach ($commentCountQuery->get() as $row) {
            $commentCounts[$row->target_type . ':' . (int) $row->target_id] = (int) $row->cnt;
        }

        // Batch load liked status for current user (single polymorphic query).
        $likedSet = [];
        if ($currentUserId) {
            $likedRows = DB::table('likes')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $currentUserId)
                ->tap($applyPolymorphicTargetFilter)
                ->select('target_type', 'target_id')
                ->get();
            foreach ($likedRows as $row) {
                $likedSet[$row->target_type . ':' . (int) $row->target_id] = true;
            }
        }

        // Batch load poll data for poll items
        $pollDataMap = $this->batchLoadPollData($rows, $currentUserId);

        // Collect receiver IDs for review enrichment
        $receiverIds = [];

        // Transform rows into the format expected by the React frontend
        $items = [];
        foreach ($rows as $row) {
            $meta = is_array($row->metadata) ? $row->metadata : ($row->metadata ? json_decode($row->metadata, true) : []);
            $likeKey = $row->source_type . ':' . $row->source_id;
            $imageUrl = $row->image_url;

            // Historical podcast feed rows may predate the tenant-bound artwork
            // policy. Never return an arbitrary remote creator URL from cache:
            // doing so would disclose the viewer's network metadata on render.
            if (in_array($row->source_type, ['podcast_show', 'podcast_episode'], true)) {
                $imageUrl = PodcastService::safePodcastArtworkPath($imageUrl);
            }

            $contentResult = $fullContent
                ? ['text' => $row->content ?? '', 'truncated' => false]
                : $this->truncateWithFlag($row->content ?? '', 500);

            $entry = [
                'id' => (int) $row->source_id,
                'type' => $row->source_type,
                'user_id' => (int) $row->user_id,
                'title' => $row->title,
                'content' => $contentResult['text'],
                'content_truncated' => $contentResult['truncated'],
                'image_url' => $imageUrl,
                'author' => [
                    'id' => (int) $row->user_id,
                    'name' => $row->author_name,
                    'avatar_url' => $row->author_avatar ?? '/assets/img/defaults/default_avatar.png',
                ],
                'likes_count' => $likeCounts[$likeKey] ?? 0,
                'comments_count' => $commentCounts[$likeKey] ?? 0,
                'is_liked' => isset($likedSet[$likeKey]),
                'created_at' => $row->created_at,
                // Event metadata
                'start_date' => $meta['start_date'] ?? null,
                'location' => $meta['location'] ?? ($row->source_type === 'listing' ? $row->user_location : null),
                // Review metadata
                'rating' => isset($meta['rating']) ? (int) $meta['rating'] : null,
                'receiver' => isset($meta['receiver_id']) ? ['id' => (int) $meta['receiver_id'], 'name' => ''] : null,
                // Job metadata
                'job_type' => $meta['job_type'] ?? null,
                'commitment' => $meta['commitment'] ?? null,
                // Challenge metadata
                'submission_deadline' => $meta['submission_deadline'] ?? null,
                'ideas_count' => isset($meta['ideas_count']) ? (int) $meta['ideas_count'] : null,
                // Listing metadata
                'listing_type' => $meta['listing_type'] ?? null,
                // Gamification metadata
                'badge_key' => $meta['badge_key'] ?? null,
                'badge_name' => $meta['badge_name'] ?? null,
                'badge_icon' => $meta['badge_icon'] ?? null,
                'new_level' => isset($meta['new_level']) ? (int) $meta['new_level'] : null,
                // Volunteer metadata
                'credits_offered' => isset($meta['credits_offered']) ? (int) $meta['credits_offered'] : null,
                'organization' => $meta['organization'] ?? null,
                // Podcast routing metadata
                'slug' => $meta['slug'] ?? null,
                'show_slug' => $meta['show_slug'] ?? null,
                'detail_path' => $meta['detail_path'] ?? null,
                // Volunteer-hours metadata (approved hour logs)
                'hours' => isset($meta['hours']) ? (float) $meta['hours'] : null,
                // Internal cursor fields
                '_activity_id' => (int) $row->activity_id,
                '_activity_created_at' => (string) $row->created_at,
            ];

            // Include poll_data for poll-type items
            if ($row->source_type === 'poll' && isset($pollDataMap[(int) $row->source_id])) {
                $entry['poll_data'] = $pollDataMap[(int) $row->source_id];
            }

            // Collect receiver IDs for review enrichment
            if ($row->source_type === 'review' && isset($meta['receiver_id']) && (int) $meta['receiver_id'] > 0) {
                $receiverIds[] = (int) $meta['receiver_id'];
            }

            $items[] = $entry;
        }

        // Defensive: drop feed items whose underlying source resource has been deleted.
        // Orphans shouldn't exist (deletion paths call FeedActivityService::deleteActivity),
        // but historical data gaps let them slip through — they surface as "Post not found"
        // when a user tries to share/react. Hide them from the feed entirely.
        $items = $this->filterOutOrphanedItems($items, $tenantId);

        // Enrich review receivers with names
        if (!empty($receiverIds)) {
            $nameMap = DB::table('users')
                ->whereIn('id', array_unique($receiverIds))
                ->where('tenant_id', $tenantId)
                ->pluck(DB::raw("COALESCE(name, CONCAT(first_name, ' ', last_name))"), 'id');
            foreach ($items as &$item) {
                if ($item['type'] === 'review' && isset($item['receiver']['id'])) {
                    $item['receiver']['name'] = $nameMap[$item['receiver']['id']] ?? 'Unknown';
                }
            }
            unset($item);
        }

        // Batch load views_count + share_count for post items from feed_posts table.
        // For typed items (listing, event, etc.), share_count comes from post_shares
        // via ShareService::batchShareCount below.
        $postIds = [];
        foreach ($items as $item) {
            if ($item['type'] === 'post') {
                $postIds[] = (int) $item['id'];
            }
        }
        if (!empty($postIds)) {
            $selectCols = ['id', 'share_count'];
            $hasViewsCount = Schema::hasColumn('feed_posts', 'views_count');
            if ($hasViewsCount) {
                $selectCols[] = 'views_count';
            }
            $hasIsOfficial = Schema::hasColumn('feed_posts', 'is_official');
            if ($hasIsOfficial) {
                $selectCols[] = 'is_official';
            }
            $postMeta = DB::table('feed_posts')
                ->whereIn('id', $postIds)
                ->where('tenant_id', $tenantId)
                ->select($selectCols)
                ->get()
                ->keyBy('id');
            foreach ($items as &$item) {
                if ($item['type'] === 'post' && isset($postMeta[$item['id']])) {
                    $item['views_count'] = $hasViewsCount ? (int) $postMeta[$item['id']]->views_count : 0;
                    $item['share_count'] = (int) $postMeta[$item['id']]->share_count;
                    if ($hasIsOfficial) {
                        $item['is_official'] = (bool) $postMeta[$item['id']]->is_official;
                    }
                }
            }
            unset($item);
        }

        // Batch load polymorphic share_count + is_shared for every shareable item type.
        // Must stay in sync with ShareService::VALID_TYPES.
        $shareableTypes = ShareService::VALID_TYPES;
        $shareTypeToIds = [];
        foreach ($items as $item) {
            if (in_array($item['type'], $shareableTypes, true)) {
                $shareTypeToIds[$item['type']][] = (int) $item['id'];
            }
        }
        if (!empty($shareTypeToIds)) {
            /** @var ShareService $shareService */
            $shareService = app(ShareService::class);
            $countMap = $shareService->batchShareCount($shareTypeToIds, $tenantId);
            $sharedMap = $currentUserId
                ? $shareService->batchIsShared($currentUserId, $shareTypeToIds, $tenantId)
                : [];

            foreach ($items as &$item) {
                if (!in_array($item['type'], $shareableTypes, true)) {
                    continue;
                }
                // For posts, prefer the denormalized feed_posts.share_count already set above.
                // For typed items, fall back to the computed count from post_shares.
                if ($item['type'] !== 'post' || !isset($item['share_count'])) {
                    $item['share_count'] = $countMap[$item['type']][$item['id']] ?? 0;
                }
                $item['is_shared'] = $sharedMap[$item['type']][$item['id']] ?? false;
            }
            unset($item);

            // Populate shared_by so cards can render "Shared by X" attribution.
            //
            // Priority for picking which sharer to surface:
            //   1. If a profile feed is being viewed (profileUserId is set) AND that
            //      user has reposted the item — use them. Lets the profile owner's
            //      reposts carry their own attribution.
            //   2. Otherwise, use the most recent sharer who is not the original
            //      author and not the current viewer (surfaces "my friend shared this").
            //
            // Single grouped query per type keeps hydration O(types).
            $sharerIdsToResolve = []; // user_id => true
            $latestSharerByItem = []; // "type:id" => ['user_id' => int, 'shared_at' => string]

            // Collapse per-type loops into TWO polymorphic queries (profile + fallback)
            // using a UNION-style approach via per-type OR clauses on a single SELECT.
            $typesWithShares = []; // type => [ids...]
            foreach ($shareTypeToIds as $type => $ids) {
                $idsWithShares = array_values(array_filter(
                    $ids,
                    fn ($id) => ($countMap[$type][$id] ?? 0) > 0
                ));
                if (!empty($idsWithShares)) {
                    $typesWithShares[$type] = $idsWithShares;
                }
            }

            if (!empty($typesWithShares)) {
                // Helper: build a where-group that applies (original_type=? AND original_post_id IN (...))
                // OR'd across each type — single query covers every shareable type at once.
                $applyTypeFilter = function ($q) use ($typesWithShares) {
                    $q->where(function ($outer) use ($typesWithShares) {
                        foreach ($typesWithShares as $type => $ids) {
                            $outer->orWhere(function ($inner) use ($type, $ids) {
                                $inner->where('original_type', $type)
                                      ->whereIn('original_post_id', $ids);
                            });
                        }
                    });
                };

                // Profile-feed pass: prefer the profile owner's own reposts.
                if ($profileUserId !== null) {
                    $profileRows = DB::table('post_shares')
                        ->where('tenant_id', $tenantId)
                        ->where('user_id', (int) $profileUserId)
                        ->tap($applyTypeFilter)
                        ->select('original_type', 'original_post_id', 'user_id', 'created_at')
                        ->get();
                    foreach ($profileRows as $row) {
                        $key = $row->original_type . ':' . (int) $row->original_post_id;
                        $latestSharerByItem[$key] = [
                            'user_id'   => (int) $row->user_id,
                            'shared_at' => (string) $row->created_at,
                        ];
                        $sharerIdsToResolve[(int) $row->user_id] = true;
                    }
                }

                // Fallback pass: most-recent non-self sharer for each (type, id).
                $fallbackRows = DB::table('post_shares')
                    ->where('tenant_id', $tenantId)
                    ->when($currentUserId, fn ($q) => $q->where('user_id', '!=', $currentUserId))
                    ->tap($applyTypeFilter)
                    ->select('original_type', 'original_post_id', 'user_id', 'created_at')
                    ->orderByDesc('created_at')
                    ->get();
                foreach ($fallbackRows as $row) {
                    $key = $row->original_type . ':' . (int) $row->original_post_id;
                    if (!isset($latestSharerByItem[$key])) {
                        $latestSharerByItem[$key] = [
                            'user_id'    => (int) $row->user_id,
                            'shared_at'  => (string) $row->created_at,
                        ];
                        $sharerIdsToResolve[(int) $row->user_id] = true;
                    }
                }
            }
            if (!empty($sharerIdsToResolve)) {
                $sharerInfo = DB::table('users')
                    ->whereIn('id', array_keys($sharerIdsToResolve))
                    ->where('tenant_id', $tenantId)
                    ->select('id', 'first_name', 'last_name', 'profile_type', 'organization_name', 'avatar_url')
                    ->get()
                    ->keyBy('id');
                foreach ($items as &$item) {
                    if (!in_array($item['type'], $shareableTypes, true)) {
                        continue;
                    }
                    $key = $item['type'] . ':' . (int) $item['id'];
                    if (!isset($latestSharerByItem[$key])) {
                        continue;
                    }
                    $entry = $latestSharerByItem[$key];
                    // Don't render "Shared by X" on the original author's own post
                    // when they're viewing it — attribution reads weird on content
                    // they created themselves. Exception: we're viewing their profile
                    // and THEY reposted it (rare self-repost case — keep attribution).
                    if ((int) $item['user_id'] === (int) ($currentUserId ?? 0)) {
                        continue;
                    }
                    $info = $sharerInfo[$entry['user_id']] ?? null;
                    if (!$info) {
                        continue;
                    }
                    $name = UserDisplayName::resolve($info);
                    $item['shared_by'] = [
                        'id'         => (int) $info->id,
                        'name'       => $name !== '' ? $name : 'Unknown',
                        'avatar_url' => $info->avatar_url,
                        'shared_at'  => $entry['shared_at'],
                    ];
                }
                unset($item);
            }
        }

        // Batch load bookmark status for current user across ALL bookmarkable types.
        // Keep this list in sync with app/Services/BookmarkService.php::VALID_TYPES.
        if ($currentUserId) {
            $bookmarkableTypes = ['post', 'listing', 'event', 'job', 'blog', 'discussion'];
            $typeIdPairs = [];
            foreach ($items as $item) {
                if (in_array($item['type'], $bookmarkableTypes, true)) {
                    $typeIdPairs[$item['type']][] = (int) $item['id'];
                }
            }
            if (!empty($typeIdPairs)) {
                // Single polymorphic query across all bookmarkable types.
                $bookmarkRows = DB::table('bookmarks')
                    ->where('user_id', $currentUserId)
                    ->where('tenant_id', $tenantId)
                    ->where(function ($outer) use ($typeIdPairs) {
                        foreach ($typeIdPairs as $bkType => $ids) {
                            $outer->orWhere(function ($inner) use ($bkType, $ids) {
                                $inner->where('bookmarkable_type', $bkType)
                                      ->whereIn('bookmarkable_id', array_unique($ids));
                            });
                        }
                    })
                    ->select('bookmarkable_type', 'bookmarkable_id')
                    ->get();
                $bookmarkedSet = [];
                foreach ($bookmarkRows as $row) {
                    $bookmarkedSet[$row->bookmarkable_type . ':' . (int) $row->bookmarkable_id] = true;
                }
                foreach ($items as &$item) {
                    if (in_array($item['type'], $bookmarkableTypes, true)) {
                        $item['is_bookmarked'] = isset($bookmarkedSet[$item['type'] . ':' . (int) $item['id']]);
                    }
                }
                unset($item);
            }
        }

        // Batch load link previews for post items
        try {
            if (!empty($postIds)) {
                /** @var LinkPreviewService $linkPreviewService */
                $linkPreviewService = app(LinkPreviewService::class);
                $previewMap = $linkPreviewService->batchLoadPostPreviews($postIds);
                foreach ($items as &$item) {
                    if ($item['type'] === 'post' && isset($previewMap[$item['id']])) {
                        $item['link_previews'] = $previewMap[$item['id']];
                    }
                }
                unset($item);
            }
        } catch (\Exception $e) {
            // Link preview loading should never break the feed
        }

        // Batch load quoted posts for post items (quote reposts)
        try {
            if (!empty($postIds)) {
                $quotedMap = DB::table('feed_posts')
                    ->whereIn('id', $postIds)
                    ->where('tenant_id', $tenantId)
                    ->whereNotNull('quoted_post_id')
                    ->pluck('quoted_post_id', 'id');

                if ($quotedMap->isNotEmpty()) {
                    $quotedPostIds = $quotedMap->values()
                        ->unique()
                        ->filter(fn ($id) => FeedItemTables::canView('post', (int) $id, $currentUserId))
                        ->values()
                        ->all();

                    if (!empty($quotedPostIds)) {
                        $quotedPosts = DB::table('feed_posts')
                            ->join('users', 'feed_posts.user_id', '=', 'users.id')
                            ->whereIn('feed_posts.id', $quotedPostIds)
                            ->where('feed_posts.tenant_id', $tenantId)
                            ->where('users.tenant_id', $tenantId)
                            ->select([
                                'feed_posts.id',
                                'feed_posts.content',
                                'feed_posts.image_url',
                                'feed_posts.created_at',
                                'feed_posts.user_id',
                                DB::raw("COALESCE(users.name, CONCAT(users.first_name, ' ', users.last_name)) as author_name"),
                                'users.avatar_url as author_avatar',
                            ])
                            ->get()
                            ->keyBy('id');

                        // Load media for quoted posts
                        $quotedMediaMap = [];
                        if ($quotedPosts->isNotEmpty()) {
                            $quotedMedia = DB::table('post_media')
                                ->whereIn('post_id', $quotedPostIds)
                                ->where('tenant_id', $tenantId)
                                ->orderBy('display_order')
                                ->get();
                            foreach ($quotedMedia as $m) {
                                $quotedMediaMap[$m->post_id][] = [
                                    'id' => (int) $m->id,
                                    'media_type' => $m->media_type,
                                    'file_url' => $m->file_url,
                                    'thumbnail_url' => $m->thumbnail_url,
                                    'alt_text' => $m->alt_text,
                                ];
                            }
                        }

                        foreach ($items as &$item) {
                            if ($item['type'] === 'post' && isset($quotedMap[$item['id']])) {
                                $qpId = $quotedMap[$item['id']];
                                if (isset($quotedPosts[$qpId])) {
                                    $qp = $quotedPosts[$qpId];
                                    $qpContent = $this->truncateWithFlag($qp->content ?? '', 280);
                                    $item['quoted_post'] = [
                                        'id' => (int) $qp->id,
                                        'content' => $qpContent['text'],
                                        'content_truncated' => $qpContent['truncated'],
                                        'image_url' => $qp->image_url,
                                        'created_at' => (string) $qp->created_at,
                                        'author' => [
                                            'id' => (int) $qp->user_id,
                                            'name' => $qp->author_name,
                                            'avatar_url' => $qp->author_avatar ?? '/assets/img/defaults/default_avatar.png',
                                        ],
                                        'media' => $quotedMediaMap[$qpId] ?? [],
                                    ];
                                }
                            }
                        }
                        unset($item);
                    }
                }
            }
        } catch (\Exception $e) {
            // Quoted post loading should never break the feed
            Log::warning('FeedService: quoted post batch load failed: ' . $e->getMessage());
        }

        // Apply EdgeRank ranking when mode is 'ranked' (the default).
        // rankFeedItems re-orders the full candidate pool; we then slice to the
        // requested page size and generate a cursor from the chronologically-last
        // item in the *unranked* candidate pool so the next page continues from
        // the correct position in the database.
        if ($isRanked && count($items) > 1) {
            try {
                // Fetch viewer timezone for Signal 9 (Context Timing) so that
                // time-of-day boosts are calculated in the viewer's local time.
                // Falls back to 'UTC' if the column doesn't exist or user is guest.
                $viewerTimezone = 'UTC';
                if ($currentUserId) {
                    $tzValue = DB::table('users')
                        ->where('id', $currentUserId)
                        ->where('tenant_id', $tenantId)
                        ->value('timezone');
                    if ($tzValue) {
                        $viewerTimezone = $tzValue;
                    }
                }

                /** @var FeedRankingService $rankingService */
                $rankingService = app(FeedRankingService::class);
                $items = $rankingService->rankFeedItems($items, $currentUserId, $viewerTimezone);
            } catch (\Throwable $e) {
                Log::warning('FeedService: EdgeRank ranking failed, falling back to chronological: ' . $e->getMessage());
            }
        }

        // For ranked mode we fetched up to $fetchLimit candidates. The cursor
        // must point to the chronologically-last item in the *full candidate set*
        // In ranked mode, cursor must point to the chronological tail of the served
        // items so the next page resumes at the correct DB position.
        if ($isRanked && !empty($items)) {
            $chronoTail = $items[0];
            foreach ($items as $candidate) {
                if (
                    $candidate['_activity_created_at'] < $chronoTail['_activity_created_at'] ||
                    (
                        $candidate['_activity_created_at'] === $chronoTail['_activity_created_at'] &&
                        $candidate['_activity_id'] < $chronoTail['_activity_id']
                    )
                ) {
                    $chronoTail = $candidate;
                }
            }

            $nextCursor = null;
            if (isset($chronoTail['_activity_id'], $chronoTail['_activity_created_at'])) {
                $payload = json_encode(['ts' => $chronoTail['_activity_created_at'], 'id' => $chronoTail['_activity_id']]);
                $sig = hash_hmac('sha256', $payload, config('app.key'));
                $nextCursor = base64_encode($sig . '.' . $payload);
            }
            return [
                'items'    => $items,
                'cursor'   => $nextCursor,
                'has_more' => $hasMore,
            ];
        }

        // Generate HMAC-signed cursor
        $nextCursor = null;
        if ($hasMore && !empty($items)) {
            $lastItem = end($items);
            if (isset($lastItem['_activity_id'], $lastItem['_activity_created_at'])) {
                $payload = json_encode(['ts' => $lastItem['_activity_created_at'], 'id' => $lastItem['_activity_id']]);
                $sig = hash_hmac('sha256', $payload, config('app.key'));
                $nextCursor = base64_encode($sig . '.' . $payload);
            }
        }

        return [
            'items'    => $items,
            'cursor'   => $nextCursor,
            'has_more' => $hasMore,
        ];
    }

    private function applyPostVisibilityScope($query, ?int $currentUserId, int $tenantId): void
    {
        $hasDeletedAt = Schema::hasColumn('feed_posts', 'deleted_at');
        $hasPublishStatus = Schema::hasColumn('feed_posts', 'publish_status');
        $hasHidden = Schema::hasColumn('feed_posts', 'is_hidden');

        $query->where(function ($outer) use ($currentUserId, $tenantId, $hasDeletedAt, $hasPublishStatus, $hasHidden) {
            $outer->where('feed_activity.source_type', '<>', 'post')
                ->orWhereExists(function ($sub) use ($currentUserId, $tenantId, $hasDeletedAt, $hasPublishStatus, $hasHidden) {
                    $sub->select(DB::raw(1))
                        ->from('feed_posts as fp')
                        ->whereColumn('fp.id', 'feed_activity.source_id')
                        ->whereColumn('fp.tenant_id', 'feed_activity.tenant_id')
                        ->where('fp.tenant_id', $tenantId);

                    if ($hasDeletedAt) {
                        $sub->whereNull('fp.deleted_at');
                    }

                    if ($hasPublishStatus) {
                        $sub->where(function ($q) {
                            $q->whereNull('fp.publish_status')
                                ->orWhere('fp.publish_status', 'published');
                        });
                    }

                    if ($hasHidden) {
                        $sub->where(function ($q) {
                            $q->whereNull('fp.is_hidden')
                                ->orWhere('fp.is_hidden', 0);
                        });
                    }

                    $sub->where(function ($visibility) use ($currentUserId, $tenantId) {
                        $visibility->where('fp.visibility', 'public')
                            ->orWhereNull('fp.visibility');

                        if ($currentUserId) {
                            $visibility->orWhere('fp.user_id', $currentUserId)
                                ->orWhere(function ($friends) use ($currentUserId, $tenantId) {
                                    $friends->whereIn('fp.visibility', ['friends', 'connections'])
                                        ->whereExists(function ($conn) use ($currentUserId, $tenantId) {
                                            $conn->select(DB::raw(1))
                                                ->from('connections')
                                                ->where('connections.tenant_id', $tenantId)
                                                ->where('connections.status', 'accepted')
                                                ->where(function ($q) use ($currentUserId) {
                                                    $q->where(function ($q2) use ($currentUserId) {
                                                        $q2->where('connections.requester_id', $currentUserId)
                                                            ->whereColumn('connections.receiver_id', 'fp.user_id');
                                                    })->orWhere(function ($q2) use ($currentUserId) {
                                                        $q2->where('connections.receiver_id', $currentUserId)
                                                            ->whereColumn('connections.requester_id', 'fp.user_id');
                                                    });
                                                });
                                        });
                                });
                        }
                    });
                });
        });
    }

    /**
     * Filter out feed items whose source resource has been deleted.
     * Orphans render as "ghost" cards that fail every interaction (share, react,
     * bookmark), so the cleanest UX is to hide them from the feed entirely.
     *
     * Types that don't have a distinct source row (post, review, badge_earned,
     * level_up, discussion) are passed through unchanged.
     *
     * @param  array<int, array<string, mixed>>  $items
     */
    private function filterOutOrphanedItems(array $items, int $tenantId): array
    {
        if (empty($items)) {
            return $items;
        }

        // Keep this list in sync with FeedActivityService source_type tables.
        // Review/badge_earned/level_up/discussion don't need validation — they
        // either have no source row or their source is inlined in the activity.
        $sourceTables = [
            'listing'   => 'listings',
            'event'     => 'events',
            'poll'      => 'polls',
            'job'       => 'job_vacancies',
            'blog'      => 'posts',
            'goal'      => 'goals',
            'challenge' => 'ideation_challenges',
            'volunteer' => 'vol_opportunities',
            'volunteer_hours' => 'vol_logs',
            'review'    => 'reviews',
        ];

        $idsByType = [];
        foreach ($items as $item) {
            if (isset($sourceTables[$item['type']])) {
                $idsByType[$item['type']][] = (int) $item['id'];
            }
        }
        if (empty($idsByType)) {
            return $items;
        }

        $existsByType = [];
        foreach ($idsByType as $type => $ids) {
            $table = $sourceTables[$type];
            $query = DB::table($table)->whereIn($table . '.id', array_unique($ids));
            if ($type === 'event') {
                // A retained Event row is not necessarily feed-visible. Draft,
                // review, template, cancelled, completed and archived rows all
                // remain in the database for audit, so existence-only filtering
                // would leak stale cards after a lifecycle transition.
                EventSearchVisibility::applyToQuery($query, $tenantId, $table);
            } else {
                $query->where($table . '.tenant_id', $tenantId);
            }
            $existing = $query->pluck($table . '.id')->all();
            $existsByType[$type] = array_flip($existing);
        }

        return array_values(array_filter(
            $items,
            static function (array $item) use ($existsByType, $sourceTables): bool {
                if (!isset($sourceTables[$item['type']])) {
                    return true;
                }
                return isset($existsByType[$item['type']][(int) $item['id']]);
            }
        ));
    }

    /**
     * Elements that never wrap content, so they are never left open by a cut.
     *
     * @var list<string>
     */
    private const VOID_ELEMENTS = [
        'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
        'link', 'meta', 'param', 'source', 'track', 'wbr',
    ];

    /**
     * Trim a post preview to a length a READER would recognise, and say whether it was cut.
     *
     * 🔴 This counted raw characters until 2026-08-28, and posts written in the web composer
     * are stored as HTML — `<p class="mb-1 leading-relaxed text-[var(--text-primary)]">` is
     * 52 characters before the member's first word. Two things followed, both reported:
     *
     *   - A SHORT post was flagged `content_truncated` and given a "Read more" it did not
     *     need, because the markup had eaten the budget.
     *   - The cut landed wherever 500 characters happened to fall — routinely inside a tag,
     *     leaving `<p class="mb-1 lead` in the payload. A half-written tag has no closing
     *     `>`, so a tag-stripper cannot match it and the fragment reaches the screen. It also
     *     put the appended "..." AFTER a `</p>`, which is why it appeared on a line of its own.
     *
     * So: measure the visible text, and when a cut is genuinely needed, make it on a word
     * boundary, never inside markup, and close whatever tags are still open.
     *
     * Entities (`&amp;`) are counted by their source length rather than as one character.
     * That errs towards a slightly shorter preview and keeps this measurement identical to
     * the one the cut itself uses, which matters more here than exactness.
     *
     * @return array{text: string, truncated: bool}
     */
    private function truncateWithFlag(string $text, int $maxLength): array
    {
        if ($text === '') {
            return ['text' => '', 'truncated' => false];
        }

        if (mb_strlen(strip_tags($text)) <= $maxLength) {
            return ['text' => $text, 'truncated' => false];
        }

        return [
            'text' => $this->truncateMarkupOnWordBoundary($text, $maxLength),
            'truncated' => true,
        ];
    }

    /**
     * Cut markup to `$maxLength` VISIBLE characters, then repair what the cut left open.
     *
     * Plain text (no tags at all) travels through this unchanged in shape: one text run,
     * cut on a word boundary, with the ellipsis appended — which is what the old code did.
     */
    private function truncateMarkupOnWordBoundary(string $text, int $maxLength): string
    {
        // Keep the delimiters: the tags are content here, not separators to be discarded.
        $tokens = preg_split('/(<[^>]*>)/', $text, -1, PREG_SPLIT_DELIM_CAPTURE | PREG_SPLIT_NO_EMPTY);
        if ($tokens === false) {
            return mb_substr($text, 0, $maxLength) . '...';
        }

        /** @var list<string> $openTags */
        $openTags = [];
        $out = '';
        $used = 0;

        foreach ($tokens as $token) {
            if (str_starts_with($token, '<') && str_ends_with($token, '>')) {
                $out .= $token;
                $this->trackOpenTag($token, $openTags);
                continue;
            }

            $remaining = $maxLength - $used;
            if (mb_strlen($token) <= $remaining) {
                $out .= $token;
                $used += mb_strlen($token);
                continue;
            }

            $out .= $this->cutTextRun($token, $remaining);
            break;
        }

        // The ellipsis belongs INSIDE the last open element, so a tag-stripper reads it as
        // part of the final paragraph rather than as a paragraph of its own.
        $out .= '...';

        foreach (array_reverse($openTags) as $name) {
            $out .= '</' . $name . '>';
        }

        return $out;
    }

    /**
     * Record what a tag did to the open-element stack, so the cut can close it again.
     *
     * @param list<string> $openTags
     */
    private function trackOpenTag(string $tag, array &$openTags): void
    {
        if (preg_match('/^<\/\s*([a-z0-9]+)/i', $tag, $matches) === 1) {
            $name = strtolower($matches[1]);
            // Close the most recent match; unbalanced markup must not pop the wrong element.
            for ($i = count($openTags) - 1; $i >= 0; $i--) {
                if ($openTags[$i] === $name) {
                    array_splice($openTags, $i, 1);
                    return;
                }
            }
            return;
        }

        if (str_ends_with($tag, '/>')) {
            return;
        }

        if (preg_match('/^<\s*([a-z0-9]+)/i', $tag, $matches) !== 1) {
            return;
        }

        $name = strtolower($matches[1]);
        if (!in_array($name, self::VOID_ELEMENTS, true)) {
            $openTags[] = $name;
        }
    }

    /**
     * Take up to `$limit` characters of one text run, preferring the last word boundary.
     *
     * The boundary is only honoured when it is not too far back, so a run without spaces
     * (a URL, a long identifier) still contributes its share instead of vanishing.
     */
    private function cutTextRun(string $run, int $limit): string
    {
        if ($limit <= 0) {
            return '';
        }

        $slice = mb_substr($run, 0, $limit);

        $lastSpace = mb_strrpos($slice, ' ');
        if ($lastSpace !== false && $lastSpace >= (int) ($limit * 0.6)) {
            $slice = mb_substr($slice, 0, $lastSpace);
        }

        // Never end on half an entity: `&amp` without its semicolon renders literally.
        $slice = (string) preg_replace('/&[a-z0-9#]*$/i', '', $slice);

        return rtrim($slice);
    }

    /**
     * Batch load poll data for poll-type items in the feed.
     */
    private function batchLoadPollData($rows, ?int $userId): array
    {
        $pollIds = [];
        foreach ($rows as $row) {
            if ($row->source_type === 'poll') {
                $pollIds[] = (int) $row->source_id;
            }
        }

        if (empty($pollIds)) {
            return [];
        }

        $tenantId = TenantContext::getId();
        $pollDataMap = [];

        // Load poll options
        $options = DB::table('poll_options')
            ->whereIn('poll_id', $pollIds)
            ->where('tenant_id', $tenantId)
            ->get();

        $optionsByPoll = $options->groupBy('poll_id');

        // Load vote counts
        $voteCounts = DB::table('poll_votes')
            ->selectRaw('poll_id, option_id, COUNT(*) as cnt')
            ->whereIn('poll_id', $pollIds)
            ->where('tenant_id', $tenantId)
            ->groupBy('poll_id', 'option_id')
            ->get();

        $voteCountMap = [];
        foreach ($voteCounts as $vc) {
            $voteCountMap[$vc->poll_id][$vc->option_id] = (int) $vc->cnt;
        }

        // Load user's votes
        $userVotes = [];
        if ($userId) {
            $votes = DB::table('poll_votes')
                ->where('user_id', $userId)
                ->whereIn('poll_id', $pollIds)
                ->where('tenant_id', $tenantId)
                ->pluck('option_id', 'poll_id');
            $userVotes = $votes->all();
        }

        // Load poll rows for is_active and question
        $polls = DB::table('polls')
            ->whereIn('id', $pollIds)
            ->where('tenant_id', $tenantId)
            ->get()
            ->keyBy('id');

        foreach ($pollIds as $pollId) {
            $opts = $optionsByPoll[$pollId] ?? collect();
            $totalVotes = 0;
            $formattedOptions = [];
            foreach ($opts as $opt) {
                $count = $voteCountMap[$pollId][$opt->id] ?? 0;
                $totalVotes += $count;
                $formattedOptions[] = [
                    'id' => (int) $opt->id,
                    'text' => $opt->label ?? $opt->option_text ?? $opt->text ?? '',
                    'vote_count' => $count,
                ];
            }

            // Compute percentages after we know the total
            foreach ($formattedOptions as &$fopt) {
                $fopt['percentage'] = $totalVotes > 0
                    ? round(($fopt['vote_count'] / $totalVotes) * 100, 1)
                    : 0;
            }
            unset($fopt);

            $poll = $polls[$pollId] ?? null;

            // Fix 7: for open (non-closed) polls, hide per-option counts from
            // non-creators to prevent results from influencing remaining voters.
            // The poll creator always sees full results.
            $pollIsOpen = $poll && (bool) ($poll->is_active ?? true)
                && ($poll->end_date === null || strtotime($poll->end_date) > time());
            $isCreator = $poll && $userId && (int) $poll->user_id === $userId;

            $optionsForResponse = $formattedOptions;
            if ($pollIsOpen && !$isCreator) {
                // Strip per-option counts and percentages — expose only option text and ID
                $optionsForResponse = array_map(fn($opt) => [
                    'id'         => $opt['id'],
                    'text'       => $opt['text'],
                    'vote_count' => null,
                    'percentage' => null,
                ], $formattedOptions);
                // Do not expose total_votes to non-creators of open polls either
                $totalVotesForResponse = null;
            } else {
                $totalVotesForResponse = $totalVotes;
            }

            $pollDataMap[$pollId] = [
                'id' => $pollId,
                'question' => $poll->question ?? '',
                'options' => $optionsForResponse,
                'total_votes' => $totalVotesForResponse,
                'user_vote_option_id' => $userVotes[$pollId] ?? null,
                'is_active' => (bool) ($poll->is_active ?? true),
                'expires_at' => $poll && !empty($poll->end_date)
                    ? date('c', strtotime((string) $poll->end_date))
                    : null,
            ];
        }

        return $pollDataMap;
    }

    /**
     * Create a feed post.
     *
     * @return FeedPost|array FeedPost on success, error array on validation failure
     */
    public function createPost(int $userId, array $data): FeedPost|array
    {
        $tenantId = TenantContext::getId();
        if (!isset($data['content']) && isset($data['body'])) {
            $data['content'] = $data['body'];
        }
        // Server-side XSS prevention: sanitize HTML content before storage
        $content = \App\Helpers\HtmlSanitizer::sanitize(trim($data['content'] ?? ''));
        $image = $data['image_url'] ?? $data['image'] ?? null;
        $visibility = $data['visibility'] ?? 'public';
        if ($visibility === 'connections') {
            $visibility = 'friends';
        }
        if (!in_array($visibility, ['public', 'private', 'friends'], true)) {
            $visibility = 'public';
        }
        $groupId = !empty($data['group_id']) ? (int) $data['group_id'] : null;

        if (empty($content) && empty($image)) {
            return ['error' => __('api_controllers_2.feed.content_or_image_required')];
        }

        // Fix 6: enforce maximum post body length
        if (mb_strlen($content) > self::MAX_POST_LENGTH) {
            throw new \InvalidArgumentException(__('api.feed_post_content_too_long', ['max' => self::MAX_POST_LENGTH]));
        }

        if ($groupId !== null && !FeedItemTables::canPostInGroup($groupId, $userId)) {
            return ['error' => __('api.social_group_membership_required')];
        }

        // Determine publish status: scheduled, draft, or published
        $publishStatus = $data['publish_status'] ?? 'published';
        $scheduledAt = $data['scheduled_at'] ?? null;

        if ($publishStatus === 'scheduled' && empty($scheduledAt)) {
            return ['error' => __('api.feed_scheduled_at_required')];
        }

        if ($publishStatus === 'scheduled' && $scheduledAt) {
            $scheduledTime = \Carbon\Carbon::parse($scheduledAt);
            if ($scheduledTime->isPast()) {
                // If the scheduled time is in the past, publish immediately
                $publishStatus = 'published';
                $scheduledAt = null;
            }
            // Carbon v3 `diffInDays` is signed; for a future scheduled time measure
            // now -> scheduledTime so the "more than a year ahead" guard is positive.
            // The reversed form returned negative, so this check never fired.
            if (now()->diffInDays($scheduledTime) > 365) {
                throw new \InvalidArgumentException(__('api.feed_schedule_too_far'));
            }
        }

        // Validate quoted_post_id if provided (quote repost)
        $quotedPostId = !empty($data['quoted_post_id']) ? (int) $data['quoted_post_id'] : null;
        if ($quotedPostId) {
            if (!FeedItemTables::canView('post', $quotedPostId, $userId)) {
                return ['error' => __('api_controllers_2.feed.quoted_post_not_found')];
            }
        }

        // Allowlist emoji (decorative post emoji) to prevent arbitrary Unicode injection
        $emoji = isset($data['emoji']) ? $data['emoji'] : null;
        if ($emoji !== null && !in_array($emoji, \App\Support\EmojiConstants::POST_DECORATIVE, true)) {
            $emoji = null;
        }

        // Spam detection: flag matching posts for review rather than blocking
        $spamFlagged = false;
        if (!empty($content) && \App\Services\ContentModerationService::detectSpam($content)) {
            $spamFlagged = true;
            Log::info('FeedService::createPost spam flag', [
                'user_id'   => $userId,
                'tenant_id' => $tenantId,
            ]);
        }

        // AG14: check if the author has the municipality_announcer role
        $isMunicipalityAnnouncer = DB::table('user_roles as ur')
            ->join('roles as r', 'ur.role_id', '=', 'r.id')
            ->where('ur.user_id', $userId)
            ->where('ur.tenant_id', $tenantId)
            ->where('r.name', 'municipality_announcer')
            ->exists();

        $post = $this->feedPost->newInstance([
            'user_id'        => $userId,
            'tenant_id'      => $tenantId,
            'content'        => $content,
            'emoji'          => $emoji,
            'image_url'      => $image,
            'type'           => 'post',
            'parent_type'    => $data['parent_type'] ?? null,
            'parent_id'      => $data['parent_id'] ?? null,
            'visibility'     => $visibility,
            'group_id'       => $groupId,
            'publish_status' => $publishStatus,
            'scheduled_at'   => $scheduledAt,
            'quoted_post_id' => $quotedPostId,
        ]);

        if ($isMunicipalityAnnouncer) {
            $post->is_official = true;
            $post->is_pinned   = true;
        }

        self::assertMentionContactsAllowed($content, $userId, (int) $tenantId, 'feed_post_create');

        $post->save();

        // If spam was detected, hide the post and queue it for moderation review
        if ($spamFlagged) {
            DB::table('feed_posts')
                ->where('id', $post->id)
                ->where('tenant_id', $tenantId)
                ->update(['is_hidden' => true]);
            $post->is_hidden = true;

            try {
                DB::table('content_moderation_queue')->insertOrIgnore([
                    'tenant_id'    => $tenantId,
                    'content_type' => 'post',
                    'content_id'   => $post->id,
                    'author_id'    => $userId,
                    'title'        => mb_substr(strip_tags($content), 0, 120),
                    'status'       => \App\Services\ContentModerationService::STATUS_FLAGGED,
                    'auto_flagged' => true,
                    'flag_reason'  => 'spam_pattern_match',
                    'created_at'   => now(),
                    'updated_at'   => now(),
                ]);
            } catch (\Throwable $e) {
                Log::warning('FeedService::createPost spam queue insert failed: ' . $e->getMessage());
            }
        }

        // Only record in feed_activity for immediately published posts;
        // scheduled/draft posts are added to feed_activity when published
        if ($publishStatus === 'published') {
            try {
                DB::table('feed_activity')->insertOrIgnore([
                    'tenant_id'   => $tenantId,
                    'user_id'     => $userId,
                    'source_type' => 'post',
                    'source_id'   => $post->id,
                    'group_id'    => $groupId,
                    'title'       => null,
                    'content'     => $content,
                    'image_url'   => $image,
                    'metadata'    => null,
                    'is_visible'  => !$spamFlagged,
                    'created_at'  => $post->created_at,
                ]);
            } catch (\Exception $e) {
                Log::warning("FeedService::createPost feed_activity sync failed: " . $e->getMessage());
            }
        }

        // Process @mentions in post content (only for published posts)
        if ($publishStatus === 'published') {
            try {
                MentionService::processText($content, $post->id, 'post', $userId);
            } catch (\Exception $e) {
                Log::warning("FeedService::createPost mention processing failed: " . $e->getMessage());
            }
        }

        $freshPost = $post->fresh(['user', 'quotedPost', 'quotedPost.user']);

        // Append formatted quoted_post for API response
        if ($freshPost->quotedPost) {
            $qp = $freshPost->quotedPost;
            $qpContent = $this->truncateWithFlag($qp->content ?? '', 280);
            $freshPost->setAttribute('quoted_post', [
                'id' => (int) $qp->id,
                'content' => $qpContent['text'],
                'content_truncated' => $qpContent['truncated'],
                'image_url' => $qp->image_url,
                'created_at' => (string) $qp->created_at,
                'author' => [
                    'id' => (int) $qp->user_id,
                    'name' => $qp->user ? UserDisplayName::resolve($qp->user, 'Unknown') : 'Unknown',
                    'avatar_url' => $qp->user?->avatar_url ?? '/assets/img/defaults/default_avatar.png',
                ],
                'media' => [],
            ]);
        }

        return $freshPost;
    }

    /**
     * Update an existing feed post. Only the author may edit.
     *
     * @return array{success: bool, error?: string}
     */
    public function updatePost(int $postId, int $userId, array $data): array
    {
        $tenantId = TenantContext::getId();

        $post = $this->feedPost->newQuery()
            ->where('id', $postId)
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->first();

        if (!$post) {
            return ['success' => false, 'error' => __('api_controllers_2.feed.post_not_found_or_not_owned')];
        }

        if (!isset($data['content']) && isset($data['body'])) {
            $data['content'] = $data['body'];
        }

        $content = isset($data['content'])
            ? \App\Helpers\HtmlSanitizer::sanitize(trim($data['content']))
            : $post->content;

        if (empty($content) && empty($post->image_url)) {
            return ['success' => false, 'error' => __('api_controllers_2.feed.content_or_image_required')];
        }

        // Fix 6: enforce maximum post body length on updates
        if (mb_strlen($content) > self::MAX_POST_LENGTH) {
            return ['success' => false, 'error' => 'Post content exceeds maximum allowed length of ' . self::MAX_POST_LENGTH . ' characters'];
        }

        // Fix 5: run spam detection on updated content, mirroring createPost() behaviour
        $spamFlagged = !empty($content) && \App\Services\ContentModerationService::detectSpam($content);

        if ($spamFlagged) {
            Log::info('FeedService::updatePost spam flag', [
                'post_id'   => $postId,
                'user_id'   => $userId,
                'tenant_id' => $tenantId,
            ]);
        }

        self::assertMentionContactsAllowed($content, $userId, (int) $tenantId, 'feed_post_update');

        $post->content = $content;
        if ($spamFlagged) {
            $post->is_hidden = true;
        }
        $post->updated_at = now();
        $post->save();

        if ($spamFlagged) {
            try {
                DB::table('content_moderation_queue')->insertOrIgnore([
                    'tenant_id'    => $tenantId,
                    'content_type' => 'post',
                    'content_id'   => $postId,
                    'author_id'    => $userId,
                    'title'        => mb_substr(strip_tags($content), 0, 120),
                    'status'       => \App\Services\ContentModerationService::STATUS_FLAGGED,
                    'auto_flagged' => true,
                    'flag_reason'  => 'spam_pattern_match',
                    'created_at'   => now(),
                    'updated_at'   => now(),
                ]);
            } catch (\Throwable $e) {
                Log::warning('FeedService::updatePost spam queue insert failed: ' . $e->getMessage());
            }
        }

        // Sync feed_activity content
        try {
            DB::table('feed_activity')
                ->where('source_type', 'post')
                ->where('source_id', $postId)
                ->where('tenant_id', $tenantId)
                ->update(['content' => $content]);
        } catch (\Exception $e) {
            Log::warning("FeedService::updatePost feed_activity sync failed: " . $e->getMessage());
        }

        return ['success' => true];
    }

    /**
     * Delete a member's own feed post (owner-scoped) and remove its feed_activity
     * row. Mirrors Api\SocialController::deletePostV2 so the accessible frontend
     * has a service-level entry point. Returns false when the post does not exist
     * or is not owned by the user.
     */
    public function deletePost(int $postId, int $userId): bool
    {
        $tenantId = TenantContext::getId();

        $post = $this->feedPost->newQuery()
            ->where('id', $postId)
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->first();

        if (! $post) {
            return false;
        }

        DB::table('feed_posts')
            ->where('id', $postId)
            ->where('tenant_id', $tenantId)
            ->delete();

        try {
            app(\App\Services\FeedActivityService::class)->removeActivity('post', $postId);
        } catch (\Throwable $e) {
            Log::warning('FeedService::deletePost feed_activity remove failed: ' . $e->getMessage());
        }

        return true;
    }

    /** @var array Validation error messages */
    private array $errors = [];

    /**
     * Create a feed post via direct DB insert.
     *
     * @return int|null Post ID or null on failure
     */
    public function createPostLegacy(int $userId, array $data): ?int
    {
        $this->errors = [];

        $rawContent = trim($data['content'] ?? '');
        // Server-side XSS prevention: sanitize HTML content before storage
        $content = \App\Helpers\HtmlSanitizer::sanitize($rawContent);
        $imageUrl = $data['image_url'] ?? null;
        $visibility = $data['visibility'] ?? 'public';
        $groupId = (int) ($data['group_id'] ?? 0);

        if ($visibility === 'connections') {
            $visibility = 'friends';
        }
        $validVisibility = ['public', 'private', 'friends'];
        if (!in_array($visibility, $validVisibility, true)) {
            $visibility = 'public';
        }

        if (empty($content) && empty($imageUrl)) {
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api_controllers_2.feed.content_or_image_required'), 'field' => 'content'];
            return null;
        }

        // Validate group membership if posting to group
        if ($groupId > 0) {
            if (!FeedItemTables::canPostInGroup($groupId, $userId)) {
                $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.social_group_membership_required')];
                return null;
            }
        }

        try {
            $tenantId = TenantContext::getId();

            if ($groupId > 0) {
                DB::insert(
                    "INSERT INTO feed_posts (user_id, tenant_id, content, image_url, likes_count, visibility, group_id, created_at) VALUES (?, ?, ?, ?, 0, ?, ?, NOW())",
                    [$userId, $tenantId, $content, $imageUrl, $visibility, $groupId]
                );
            } else {
                DB::insert(
                    "INSERT INTO feed_posts (user_id, tenant_id, content, image_url, likes_count, visibility, created_at) VALUES (?, ?, ?, ?, 0, ?, NOW())",
                    [$userId, $tenantId, $content, $imageUrl, $visibility]
                );
            }

            $postId = (int) DB::getPdo()->lastInsertId();

            // Record in feed_activity table
            try {
                DB::statement(
                    "INSERT INTO feed_activity
                        (tenant_id, user_id, source_type, source_id, group_id, title, content, image_url, metadata, is_visible, created_at)
                    VALUES (?, ?, 'post', ?, ?, NULL, ?, ?, NULL, 1, NOW())
                    ON DUPLICATE KEY UPDATE
                        content = VALUES(content), image_url = VALUES(image_url), is_visible = 1, created_at = VALUES(created_at)",
                    [$tenantId, $userId, $postId, $groupId ?: null, $content, $imageUrl]
                );
            } catch (\Exception $faEx) {
                \Illuminate\Support\Facades\Log::warning("FeedService::createPostLegacy feed_activity record failed: " . $faEx->getMessage());
            }

            return $postId;
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::error("FeedService::createPostLegacy error: " . $e->getMessage());
            $this->errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api_controllers_2.feed.create_post_failed')];
            return null;
        }
    }

    /**
     * Get a single feed item by type and ID.
     */
    /**
     * One feed item in full.
     *
     * 🔴 `$fullContent` defaults TRUE here, unlike the list. This is a detail lookup: every
     * caller of it is showing one item on its own screen, where clipping the body at 500
     * characters is the bug, not the feature. See the note in `getFeed()`.
     */
    public function getItem(string $type, int $id, ?int $userId, bool $fullContent = true): ?array
    {
        $tenantId = TenantContext::getId();
        if ($type === 'post' && !FeedItemTables::canView('post', $id, $userId)) {
            return null;
        }
        $items = [];
        $commentDeleteClause = Schema::hasColumn('comments', 'deleted_at')
            ? " AND deleted_at IS NULL"
            : '';

        switch ($type) {
            case 'post':
                $rows = DB::select(
                    "SELECT p.id, p.content, p.image_url, p.created_at, p.likes_count, p.user_id,
                           'post' as type,
                           COALESCE(u.name, CONCAT(u.first_name, ' ', u.last_name)) as author_name,
                           u.avatar_url as author_avatar,
                           (SELECT COUNT(*) FROM comments WHERE target_type = 'post' AND target_id = p.id AND tenant_id = ?{$commentDeleteClause}) as comments_count
                    FROM feed_posts p
                    JOIN users u ON p.user_id = u.id
                    WHERE p.id = ? AND p.tenant_id = ? AND u.tenant_id = ? AND (p.publish_status = 'published' OR p.publish_status IS NULL) AND (p.is_hidden = 0 OR p.is_hidden IS NULL) AND p.deleted_at IS NULL",
                    [$tenantId, $id, $tenantId, $tenantId]
                );
                $items = array_map(fn($r) => (array) $r, $rows);
                break;

            case 'blog':
                $rows = DB::select(
                    "SELECT p.id, p.slug, p.title, p.content, p.featured_image as image_url, p.created_at,
                           0 as likes_count, p.author_id as user_id, 'blog' as type,
                           COALESCE(u.name, CONCAT(u.first_name, ' ', u.last_name)) as author_name,
                           u.avatar_url as author_avatar,
                           (SELECT COUNT(*) FROM comments WHERE target_type = 'blog' AND target_id = p.id AND tenant_id = ?{$commentDeleteClause}) as comments_count
                    FROM posts p
                    JOIN users u ON p.author_id = u.id
                    WHERE p.id = ? AND p.tenant_id = ? AND p.status = 'published'",
                    [$tenantId, $id, $tenantId]
                );
                $items = array_map(fn($r) => (array) $r, $rows);
                break;

            case 'discussion':
                $rows = DB::select(
                    "SELECT gd.id, gd.title, gp_first.content, NULL as image_url, gd.created_at,
                           0 as likes_count, gd.user_id, 'discussion' as type,
                           COALESCE(u.name, CONCAT(u.first_name, ' ', u.last_name)) as author_name,
                           u.avatar_url as author_avatar,
                           (SELECT COUNT(*) FROM group_posts gpc WHERE gpc.discussion_id = gd.id AND gpc.tenant_id = gd.tenant_id) as comments_count
                    FROM group_discussions gd
                    JOIN users u ON gd.user_id = u.id
                    LEFT JOIN group_posts gp_first ON gp_first.discussion_id = gd.id AND gp_first.tenant_id = gd.tenant_id
                        AND gp_first.id = (SELECT MIN(gpm.id) FROM group_posts gpm WHERE gpm.discussion_id = gd.id AND gpm.tenant_id = gd.tenant_id)
                    WHERE gd.id = ? AND gd.tenant_id = ?",
                    [$id, $tenantId]
                );
                $items = array_map(fn($r) => (array) $r, $rows);
                break;
        }

        if (empty($items)) {
            return null;
        }

        // Format like the feed does — enrich with like status
        $item = $items[0];
        $contentResult = $fullContent
            ? ['text' => $item['content'] ?? '', 'truncated' => false]
            : $this->truncateWithFlag($item['content'] ?? '', 500);

        $isLiked = false;
        if ($userId) {
            $liked = DB::selectOne(
                "SELECT 1 FROM likes WHERE user_id = ? AND target_type = ? AND target_id = ? AND tenant_id = ?",
                [$userId, $type, $id, $tenantId]
            );
            $isLiked = (bool) $liked;
        }

        $reactions = null;
        if (in_array($type, ReactionService::VALID_TARGET_TYPES, true)) {
            $reactions = app(ReactionService::class)->getReactions($id, $type, $userId);
        }

        $response = [
            'id' => (int) $item['id'],
            'type' => $item['type'],
            'title' => $item['title'] ?? null,
            'content' => $contentResult['text'],
            'content_truncated' => $contentResult['truncated'],
            'image_url' => $item['image_url'] ?? null,
            'author' => [
                'id' => (int) $item['user_id'],
                'name' => $item['author_name'],
                'avatar_url' => $item['author_avatar'] ?? '/assets/img/defaults/default_avatar.png',
            ],
            'likes_count' => (int) ($item['likes_count'] ?? 0),
            'comments_count' => (int) ($item['comments_count'] ?? 0),
            'is_liked' => $isLiked,
            'created_at' => $item['created_at'],
        ];

        if ($reactions !== null) {
            $response['reactions'] = $reactions;
        }

        return $response;
    }

    /**
     * Publish all scheduled posts whose scheduled_at time has passed.
     *
     * Called every minute by the scheduler. Processes all tenants.
     *
     * @return int Number of posts published
     */
    public function publishScheduledPosts(): int
    {
        // Cross-tenant query: explicitly iterate tenants and set context per-post
        // so MentionService::processText and downstream tenant-scoped code uses
        // the correct tenant. Without this, posts from tenant A could trigger
        // mention processing under tenant B.
        $previousTenantId = TenantContext::currentId();
        $posts = FeedPost::withoutGlobalScopes()
            ->where('publish_status', 'scheduled')
            ->where('scheduled_at', '<=', now())
            ->get();

        $count = 0;

        foreach ($posts as $post) {
            try {
                TenantContext::setById((int) $post->tenant_id);
                self::assertMentionContactsAllowed(
                    (string) ($post->content ?? ''),
                    (int) $post->user_id,
                    (int) $post->tenant_id,
                    'feed_scheduled_post_publish',
                );

                $post->update([
                    'publish_status' => 'published',
                    'created_at'     => now(), // Set created_at to publish time so it appears fresh in feed
                ]);

                // Insert into feed_activity so the post appears in the main feed
                DB::table('feed_activity')->insertOrIgnore([
                    'tenant_id'   => $post->tenant_id,
                    'user_id'     => $post->user_id,
                    'source_type' => 'post',
                    'source_id'   => $post->id,
                    'group_id'    => $post->group_id,
                    'title'       => null,
                    'content'     => $post->content,
                    'image_url'   => $post->image_url,
                    'metadata'    => null,
                    'is_visible'  => true,
                    'created_at'  => now(),
                ]);

                // Process @mentions now that the post is live
                try {
                    MentionService::processText($post->content ?? '', $post->id, 'post', $post->user_id);
                } catch (\Exception $e) {
                    Log::warning("publishScheduledPosts mention processing failed for post {$post->id}: " . $e->getMessage());
                }

                $count++;
            } catch (\Exception $e) {
                Log::error("publishScheduledPosts failed for post {$post->id}: " . $e->getMessage());
            }
        }

        if ($count > 0) {
            Log::info("publishScheduledPosts: published {$count} scheduled post(s)");
        }

        if ($previousTenantId) {
            TenantContext::setById((int) $previousTenantId);
        } else {
            TenantContext::reset();
        }

        return $count;
    }

    /**
     * Get scheduled posts for a specific user.
     *
     * @return array{items: array}
     */
    public function getScheduledPosts(int $userId): array
    {
        $tenantId = TenantContext::getId();

        $posts = FeedPost::where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('publish_status', 'scheduled')
            ->orderBy('scheduled_at', 'asc')
            ->get();

        $items = [];
        foreach ($posts as $post) {
            $items[] = [
                'id'             => $post->id,
                'content'        => $post->content,
                'image_url'      => $post->image_url,
                'publish_status' => $post->publish_status,
                'scheduled_at'   => $post->scheduled_at?->toIso8601String(),
                'created_at'     => $post->created_at?->toIso8601String(),
            ];
        }

        return ['items' => $items];
    }

    /**
     * Get validation errors from the last operation.
     */
    public function getErrors(): array
    {
        return $this->errors;
    }

    /**
     * Toggle like on a feed post.
     *
     * @return array{liked: bool, likes_count: int}
     */
    public function like(int $postId, int $userId): array
    {
        $tenantId = TenantContext::getId();

        // Verify the target post belongs to this tenant before recording the like
        $postExists = DB::table('feed_posts')
            ->where('id', $postId)
            ->where('tenant_id', $tenantId)
            ->exists();

        if (! $postExists) {
            throw new \InvalidArgumentException('Post not found');
        }

        // Use atomic INSERT IGNORE + check affected rows to prevent duplicate likes
        // from concurrent requests (the uk_likes_user_target unique key enforces this)
        $existing = DB::table('likes')
            ->where('target_type', 'post')
            ->where('target_id', $postId)
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->first();

        if ($existing) {
            DB::table('likes')
                ->where('id', $existing->id)
                ->where('tenant_id', $tenantId)
                ->delete();
            $liked = false;
        } else {
            // Use INSERT IGNORE to gracefully handle race condition with unique constraint
            DB::statement(
                'INSERT IGNORE INTO likes (target_type, target_id, user_id, tenant_id, created_at) VALUES (?, ?, ?, ?, NOW())',
                ['post', $postId, $userId, $tenantId]
            );
            $liked = true;
        }

        $count = (int) DB::table('likes')
            ->where('target_type', 'post')
            ->where('target_id', $postId)
            ->where('tenant_id', $tenantId)
            ->count();

        return ['liked' => $liked, 'likes_count' => $count];
    }
}
