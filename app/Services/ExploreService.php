<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * ExploreService — Aggregates discovery data for the Explore/Discover page.
 *
 * Returns multiple content sections in a single call to avoid waterfall requests.
 * Results are cached in Redis with differentiated TTLs per section type.
 *
 * Algorithm pipeline (Phase 1):
 *   - SmartMatchingEngine: 6-signal scoring (category, skill, proximity, freshness, reciprocity, quality)
 *   - CollaborativeFilteringService: item-based + user-user CF
 *   - MatchLearningService: historical boost/penalty from interaction history
 *   - KNN pre-computed recommendations from Redis (nightly pipeline)
 *   - Dismissed/muted user filtering
 *   - Location-based "Near You" ranking via Haversine
 *
 * All queries are tenant-scoped via TenantContext::getId().
 */
class ExploreService
{
    private const CACHE_TTL_SECONDS = 300; // 5 minutes
    private const CACHE_TTL_SLOW = 900;    // 15 minutes (slow-changing sections)

    public function __construct(
        private readonly SmartMatchingEngine $matchingEngine,
        private readonly MatchLearningService $matchLearning,
    ) {}

    /**
     * Get all explore page data in one call.
     *
     * Global (non-personalized) sections are cached per-tenant.
     * Personalized sections (recommended_listings) are cached per-user.
     */
    public function getExploreData(int $userId): array
    {
        if ($userId <= 0) {
            throw new \InvalidArgumentException('Explore data requires an authenticated user.');
        }

        $tenantId = TenantContext::getId();

        // ─── Global sections — granular per-section caching (Phase 5) ───
        // Each section cached independently with appropriate TTLs.
        // Fast-changing sections (trending, stats): 5 min
        // Slow-changing sections (orgs, resources, skills): 15 min
        $globalData = [
            // Viewer-sensitive identity/audience sections are intentionally not
            // cached: privacy and membership changes must apply immediately.
            'trending_posts'             => $this->getTrendingPosts($tenantId, $userId),
            'popular_listings'           => $this->cachedSection($tenantId, 'popular_listings',   fn() => $this->getPopularListings($tenantId)),
            'active_groups'              => $this->cachedSection($tenantId, 'active_groups',      fn() => $this->getActiveGroups($tenantId)),
            'upcoming_events'            => $this->cachedSection($tenantId, 'upcoming_events',    fn() => $this->getUpcomingEvents($tenantId), 600),
            'top_contributors'           => $this->getTopContributors($tenantId, $userId),
            'trending_hashtags'          => $this->cachedSection($tenantId, 'trending_hashtags',  fn() => $this->getTrendingHashtags($tenantId)),
            'new_members'                => $this->getNewMembers($tenantId, $userId),
            'featured_challenges'        => $this->cachedSection($tenantId, 'featured_challenges',fn() => $this->getFeaturedChallenges($tenantId), self::CACHE_TTL_SLOW),
            'community_stats'            => $this->cachedSection($tenantId, 'community_stats',    fn() => $this->getCommunityStats($tenantId), self::CACHE_TTL_SLOW),
            // Phase 2 — new content sections
            'trending_blog_posts'        => $this->cachedSection($tenantId, 'trending_blog_posts', fn() => $this->getTrendingBlogPosts($tenantId), self::CACHE_TTL_SLOW),
            'volunteering_opportunities' => $this->cachedSection($tenantId, 'volunteering',       fn() => $this->getFeaturedVolunteering($tenantId), self::CACHE_TTL_SLOW),
            'active_organisations'       => $this->cachedSection($tenantId, 'organisations',      fn() => $this->getActiveOrganisations($tenantId), self::CACHE_TTL_SLOW),
            'active_polls'               => $this->cachedSection($tenantId, 'active_polls',       fn() => $this->getActivePolls($tenantId), 600),
            'in_demand_skills'           => $this->cachedSection($tenantId, 'in_demand_skills',   fn() => $this->getInDemandSkills($tenantId), self::CACHE_TTL_SLOW),
            'featured_resources'         => $this->cachedSection($tenantId, 'featured_resources', fn() => $this->getFeaturedResources($tenantId), self::CACHE_TTL_SLOW),
            'latest_jobs'                => $this->cachedSection($tenantId, 'latest_jobs',        fn() => $this->getLatestJobs($tenantId), self::CACHE_TTL_SLOW),
            // Phase 5 — include categories to eliminate second API call
            'categories'                 => $this->cachedSection($tenantId, 'categories',         fn() => $this->getListingCategories($tenantId), self::CACHE_TTL_SLOW),
        ];

        // ─── Personalized sections — cached per user ───
        $userKey = "nexus:explore:{$tenantId}:{$userId}";
        $userData = null;
        try {
            $userData = Cache::get($userKey);
            if (!is_array($userData)) {
                $userData = null;
            }
        } catch (\Throwable $e) {
            Log::debug('[ExploreService] Cache::get (user) failed: ' . $e->getMessage());
        }

        if ($userData === null) {
            $userData = [
                'recommended_listings' => $this->getRecommendedListings($tenantId, $userId),
                'near_you_listings' => $this->getNearYouListings($tenantId, $userId),
                'suggested_connections' => $this->getSuggestedConnections($tenantId, $userId),
            ];
            try {
                Cache::put($userKey, $userData, self::CACHE_TTL_SECONDS);
            } catch (\Throwable $e) {
                Log::debug('[ExploreService] Cache::put (user) failed: ' . $e->getMessage());
            }
        }

        return array_merge($globalData, $userData);
    }

    /**
     * Per-section caching helper (Phase 5 — granular cache invalidation).
     * Each section is cached independently with its own TTL.
     */
    private function cachedSection(int $tenantId, string $section, callable $compute, int $ttl = self::CACHE_TTL_SECONDS): array
    {
        $key = "nexus:explore:{$tenantId}:{$section}";
        try {
            $cached = Cache::get($key);
            if (is_array($cached)) {
                return $cached;
            }
        } catch (\Throwable $e) {
            Log::debug("[ExploreService] Cache::get failed for section '{$section}': " . $e->getMessage());
        }
        $data = $compute();
        try {
            Cache::put($key, $data, $ttl);
        } catch (\Throwable $e) {
            Log::debug("[ExploreService] Cache::put failed for section '{$section}': " . $e->getMessage());
        }
        return $data;
    }

    /**
     * Get listing categories (Phase 5 — eliminates second API call from frontend).
     */
    private function getListingCategories(int $tenantId): array
    {
        try {
            $rows = DB::select(
                "SELECT id, name, slug, color FROM categories WHERE tenant_id = ? AND type = 'listing' ORDER BY sort_order ASC, name ASC LIMIT 20",
                [$tenantId]
            );
            return array_map(fn($row) => [
                'id' => (int) $row->id,
                'name' => $row->name,
                'slug' => $row->slug,
                'color' => $row->color,
            ], $rows);
        } catch (\Throwable $e) {
            Log::debug('[ExploreService] getListingCategories failed: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Top 10 posts by trending score (velocity-weighted engagement).
     *
     * Trending score = 0.4 * total_engagement + 0.6 * velocity
     * Velocity = recent engagement (last 6h) / age-expected engagement rate
     * This detects content gaining engagement unusually fast, not just raw volume.
     */
    private function getTrendingPosts(int $tenantId, int $viewerId): array
    {
        if ($viewerId <= 0) {
            return [];
        }

        try {
            [$visibilitySql, $visibilityBindings] = $this->trendingPostVisibilitySql($tenantId, $viewerId);
            $rows = DB::select("
                SELECT
                    fp.id,
                    fp.user_id,
                    LEFT(fp.content, 200) AS excerpt,
                    fp.image_url,
                    fp.created_at,
                    COALESCE(u.first_name, '') AS author_first_name,
                    COALESCE(u.last_name, '') AS author_last_name,
                    u.profile_type AS author_profile_type,
                    u.organization_name AS author_organization_name,
                    u.avatar_url AS author_avatar,
                    (SELECT COUNT(*) FROM likes lk WHERE lk.target_type = 'post' AND lk.target_id = fp.id AND lk.tenant_id = ?) AS likes_count,
                    (SELECT COUNT(*) FROM comments c WHERE c.target_type = 'post' AND c.target_id = fp.id AND c.tenant_id = ?) AS comments_count,
                    (SELECT COUNT(*) FROM likes lk WHERE lk.target_type = 'post' AND lk.target_id = fp.id AND lk.tenant_id = ?)
                        + (SELECT COUNT(*) FROM comments c WHERE c.target_type = 'post' AND c.target_id = fp.id AND c.tenant_id = ?) AS engagement,
                    (SELECT COUNT(*) FROM likes lk2 WHERE lk2.target_type = 'post' AND lk2.target_id = fp.id AND lk2.tenant_id = ? AND lk2.created_at >= DATE_SUB(NOW(), INTERVAL 6 HOUR))
                        + (SELECT COUNT(*) FROM comments c2 WHERE c2.target_type = 'post' AND c2.target_id = fp.id AND c2.tenant_id = ? AND c2.created_at >= DATE_SUB(NOW(), INTERVAL 6 HOUR)) AS recent_engagement,
                    GREATEST(1, TIMESTAMPDIFF(HOUR, fp.created_at, NOW())) AS age_hours
                FROM feed_posts fp
                JOIN users u ON u.id = fp.user_id AND u.tenant_id = ? AND u.status = 'active'
                WHERE fp.tenant_id = ?
                    AND fp.created_at >= DATE_SUB(NOW(), INTERVAL 365 DAY)
                    AND (fp.is_hidden = 0 OR fp.is_hidden IS NULL)
                    AND fp.deleted_at IS NULL
                    AND (fp.publish_status = 'published' OR fp.publish_status IS NULL)
                    AND (fp.scheduled_at IS NULL OR fp.scheduled_at <= NOW())
                    {$visibilitySql}
                ORDER BY engagement DESC
                LIMIT 30
            ", array_merge(
                [$tenantId, $tenantId, $tenantId, $tenantId, $tenantId, $tenantId, $tenantId, $tenantId],
                $visibilityBindings
            ));

            // Compute velocity-weighted trending score
            $scored = [];
            foreach ($rows as $row) {
                $engagement = (int) $row->engagement;
                $recentEngagement = (int) $row->recent_engagement;
                $ageHours = max(1, (int) $row->age_hours);

                // Expected engagement rate: engagement / age_hours (baseline)
                $expectedRate = $engagement / $ageHours;
                // Recent rate: engagement in last 6 hours
                $recentRate = $recentEngagement / 6.0;
                // Velocity: how fast is it growing vs expected
                $velocity = $expectedRate > 0 ? min(10, $recentRate / $expectedRate) : ($recentEngagement > 0 ? 2.0 : 0);

                // Trending score: blend volume (40%) and velocity (60%)
                $trendingScore = (0.4 * min($engagement, 100)) + (0.6 * $velocity * 20);

                $scored[] = [
                    'id' => $row->id,
                    'user_id' => $row->user_id,
                    'excerpt' => $row->excerpt,
                    'image_url' => $row->image_url,
                    'created_at' => $row->created_at,
                    'author_name' => UserDisplayName::resolvePrefixed($row, 'author_'),
                    'author_avatar' => $row->author_avatar,
                    'likes_count' => (int) $row->likes_count,
                    'comments_count' => (int) $row->comments_count,
                    'engagement' => $engagement,
                    'trending_score' => $trendingScore,
                    'is_hot' => $velocity >= 2.0,
                ];
            }

            usort($scored, fn($a, $b) => $b['trending_score'] <=> $a['trending_score']);

            return array_slice($scored, 0, 10);
        } catch (\Throwable $e) {
            Log::warning('ExploreService::getTrendingPosts failed', ['error' => $e->getMessage()]);
            return [];
        }
    }

    /**
     * Build the viewer-dependent audience and private-group eligibility clause
     * used by both Explore trending queries.
     *
     * @return array{0: string, 1: array<int, int>}
     */
    private function trendingPostVisibilitySql(int $tenantId, int $viewerId): array
    {
        return [
            "AND (
                fp.user_id = ?
                OR fp.visibility IS NULL
                OR fp.visibility = 'public'
                OR (
                    fp.visibility IN ('friends', 'connections')
                    AND EXISTS (
                        SELECT 1
                        FROM connections conn
                        WHERE conn.tenant_id = ?
                          AND conn.status = 'accepted'
                          AND (
                              (conn.requester_id = ? AND conn.receiver_id = fp.user_id)
                              OR (conn.receiver_id = ? AND conn.requester_id = fp.user_id)
                          )
                    )
                )
            )
            AND (
                fp.group_id IS NULL
                OR EXISTS (
                    SELECT 1
                    FROM groups grp
                    WHERE grp.id = fp.group_id
                      AND grp.tenant_id = ?
                      AND grp.status = 'active'
                      AND (
                          grp.owner_id = ?
                          OR EXISTS (
                              SELECT 1
                              FROM group_members gm
                              WHERE gm.group_id = grp.id
                                AND gm.tenant_id = ?
                                AND gm.user_id = ?
                                AND gm.status = 'active'
                          )
                      )
                )
            )",
            [
                $viewerId,
                $tenantId,
                $viewerId,
                $viewerId,
                $tenantId,
                $viewerId,
                $tenantId,
                $viewerId,
            ],
        ];
    }

    /**
     * Top 8 active listings by view_count in last 30 days.
     */
    private function getPopularListings(int $tenantId): array
    {
        try {
            $rows = DB::select("
                SELECT
                    l.id,
                    l.title,
                    l.type,
                    l.image_url,
                    l.location,
                    l.hours_estimate AS estimated_hours,
                    l.created_at,
                    COALESCE(l.view_count, 0) AS view_count,
                    COALESCE(l.save_count, 0) AS save_count,
                    l.category_id,
                    COALESCE(cat.name, '') AS category_name,
                    COALESCE(cat.slug, '') AS category_slug,
                    cat.color AS category_color,
                    COALESCE(u.first_name, '') AS author_first_name,
                    COALESCE(u.last_name, '') AS author_last_name,
                    u.profile_type AS author_profile_type,
                    u.organization_name AS author_organization_name,
                    u.avatar_url AS author_avatar
                FROM listings l
                LEFT JOIN categories cat ON cat.id = l.category_id
                JOIN users u ON u.id = l.user_id AND u.tenant_id = ? AND u.status = 'active'
                WHERE l.tenant_id = ?
                    AND l.status = 'active'
                    AND l.created_at >= DATE_SUB(NOW(), INTERVAL 365 DAY)
                    AND CHAR_LENGTH(COALESCE(l.description, '')) >= 30
                    AND (cat.name IS NULL OR LOWER(TRIM(l.title)) <> LOWER(TRIM(CONVERT(cat.name USING utf8mb4) COLLATE utf8mb4_unicode_ci)))
                ORDER BY (COALESCE(l.view_count, 0) + COALESCE(l.save_count, 0)) DESC
                LIMIT 8
            ", [$tenantId, $tenantId]);

            return array_map(fn($row) => [
                'id' => $row->id,
                'title' => $row->title,
                'type' => $row->type,
                'image_url' => $row->image_url,
                'location' => $row->location,
                'estimated_hours' => $row->estimated_hours,
                'created_at' => $row->created_at,
                'view_count' => (int) $row->view_count,
                'save_count' => (int) $row->save_count,
                'category_name' => $row->category_name,
                'category_slug' => $row->category_slug,
                'category_color' => $row->category_color,
                'author_name' => UserDisplayName::resolvePrefixed($row, 'author_'),
                'author_avatar' => $row->author_avatar,
            ], $rows);
        } catch (\Throwable $e) {
            Log::warning('ExploreService::getPopularListings failed', ['error' => $e->getMessage()]);
            return [];
        }
    }

    /**
     * Top 6 groups by member count (active).
     */
    private function getActiveGroups(int $tenantId): array
    {
        try {
            $rows = DB::select("
                SELECT
                    g.id,
                    g.name,
                    g.description,
                    g.image_url,
                    g.visibility AS privacy,
                    g.created_at,
                    (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id AND gm.status = 'active') AS member_count
                FROM `groups` g
                WHERE g.tenant_id = ?
                    AND g.status = 'active'
                    AND g.visibility = 'public'
                ORDER BY member_count DESC
                LIMIT 6
            ", [$tenantId]);

            return array_map(fn($row) => [
                'id' => $row->id,
                'name' => $row->name,
                'description' => $row->description ? mb_substr($row->description, 0, 120) : null,
                'image_url' => $row->image_url,
                'privacy' => $row->privacy,
                'member_count' => (int) $row->member_count,
                'created_at' => $row->created_at,
            ], $rows);
        } catch (\Throwable $e) {
            Log::warning('ExploreService::getActiveGroups failed', ['error' => $e->getMessage()]);
            return [];
        }
    }

    /**
     * Next 8 upcoming events.
     */
    private function getUpcomingEvents(int $tenantId): array
    {
        try {
            $rows = DB::select("
                SELECT
                    e.id,
                    e.title,
                    e.description,
                    e.cover_image AS image_url,
                    e.start_time AS start_at,
                    e.end_time AS end_at,
                    e.location,
                    e.allow_remote_attendance AS is_online,
                    e.max_attendees,
                    (SELECT COUNT(*) FROM event_rsvps er WHERE er.event_id = e.id AND er.status = 'going') AS rsvp_count
                FROM events e
                WHERE e.tenant_id = ?
                    AND e.start_time > NOW()
                    AND e.status = 'active'
                    AND (
                        e.group_id IS NULL
                        OR EXISTS (
                            SELECT 1 FROM groups event_group
                            WHERE event_group.id = e.group_id
                              AND event_group.tenant_id = ?
                              AND event_group.is_active = 1
                              AND (event_group.status IS NULL OR event_group.status = 'active')
                              AND event_group.visibility = 'public'
                        )
                    )
                ORDER BY e.start_time ASC
                LIMIT 8
            ", [$tenantId, $tenantId]);

            return array_map(fn($row) => [
                'id' => $row->id,
                'title' => $row->title,
                'description' => $row->description ? mb_substr($row->description, 0, 120) : null,
                'image_url' => $row->image_url,
                'start_at' => $row->start_at,
                'end_at' => $row->end_at,
                'location' => $row->location,
                'is_online' => (bool) $row->is_online,
                'max_attendees' => $row->max_attendees,
                'rsvp_count' => (int) $row->rsvp_count,
            ], $rows);
        } catch (\Throwable $e) {
            Log::warning('ExploreService::getUpcomingEvents failed', ['error' => $e->getMessage()]);
            return [];
        }
    }

    /**
     * Top 6 users by XP earned in last 30 days.
     */
    private function getTopContributors(int $tenantId, int $viewerId): array
    {
        try {
            $rows = DB::select("
                SELECT
                    u.id,
                    COALESCE(u.first_name, '') AS first_name,
                    COALESCE(u.last_name, '') AS last_name,
                    u.profile_type,
                    u.organization_name,
                    u.avatar_url AS avatar,
                    COALESCE(u.xp, 0) AS xp,
                    COALESCE(u.level, 1) AS level,
                    u.tagline
                FROM users u
                WHERE u.tenant_id = ?
                    AND u.status = 'active'
                    AND (
                        u.id = ?
                        OR (
                            (u.privacy_search = 1 OR u.privacy_search IS NULL)
                            AND (
                                u.privacy_profile IS NULL
                                OR u.privacy_profile IN ('public', 'members')
                                OR (
                                    u.privacy_profile = 'connections'
                                    AND EXISTS (
                                        SELECT 1 FROM connections privacy_conn
                                        WHERE privacy_conn.tenant_id = ?
                                          AND privacy_conn.status = 'accepted'
                                          AND (
                                              (privacy_conn.requester_id = ? AND privacy_conn.receiver_id = u.id)
                                              OR (privacy_conn.receiver_id = ? AND privacy_conn.requester_id = u.id)
                                          )
                                    )
                                )
                            )
                        )
                    )
                    AND u.xp > 0
                ORDER BY u.xp DESC
                LIMIT 6
            ", [$tenantId, $viewerId, $tenantId, $viewerId, $viewerId]);

            return array_map(fn($row) => [
                'id' => $row->id,
                'name' => UserDisplayName::resolve($row),
                'avatar' => $row->avatar,
                'xp' => (int) $row->xp,
                'level' => (int) $row->level,
                'tagline' => $row->tagline,
            ], $rows);
        } catch (\Throwable $e) {
            Log::warning('ExploreService::getTopContributors failed', ['error' => $e->getMessage()]);
            return [];
        }
    }

    /**
     * Top 10 hashtags by usage in last 7 days.
     */
    private function getTrendingHashtags(int $tenantId): array
    {
        try {
            $rows = DB::select("
                SELECT
                    h.id,
                    h.tag,
                    h.post_count,
                    h.last_used_at
                FROM hashtags h
                WHERE h.tenant_id = ?
                    AND h.post_count > 0
                ORDER BY h.post_count DESC, h.last_used_at DESC
                LIMIT 10
            ", [$tenantId]);

            return array_map(fn($row) => [
                'id' => $row->id,
                'tag' => $row->tag,
                'post_count' => (int) $row->post_count,
                'last_used_at' => $row->last_used_at,
            ], $rows);
        } catch (\Throwable $e) {
            Log::warning('ExploreService::getTrendingHashtags failed', ['error' => $e->getMessage()]);
            return [];
        }
    }

    /**
     * 8 newest members joined in last 14 days.
     */
    private function getNewMembers(int $tenantId, int $viewerId): array
    {
        try {
            $rows = DB::select("
                SELECT
                    u.id,
                    COALESCE(u.first_name, '') AS first_name,
                    COALESCE(u.last_name, '') AS last_name,
                    u.profile_type,
                    u.organization_name,
                    u.avatar_url AS avatar,
                    u.tagline,
                    u.created_at
                FROM users u
                WHERE u.tenant_id = ?
                    AND u.status = 'active'
                    AND (
                        u.id = ?
                        OR (
                            (u.privacy_search = 1 OR u.privacy_search IS NULL)
                            AND (
                                u.privacy_profile IS NULL
                                OR u.privacy_profile IN ('public', 'members')
                                OR (
                                    u.privacy_profile = 'connections'
                                    AND EXISTS (
                                        SELECT 1 FROM connections privacy_conn
                                        WHERE privacy_conn.tenant_id = ?
                                          AND privacy_conn.status = 'accepted'
                                          AND (
                                              (privacy_conn.requester_id = ? AND privacy_conn.receiver_id = u.id)
                                              OR (privacy_conn.receiver_id = ? AND privacy_conn.requester_id = u.id)
                                          )
                                    )
                                )
                            )
                        )
                    )
                    AND u.created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
                ORDER BY u.created_at DESC
                LIMIT 8
            ", [$tenantId, $viewerId, $tenantId, $viewerId, $viewerId]);

            return array_map(fn($row) => [
                'id' => $row->id,
                'name' => UserDisplayName::resolve($row),
                'avatar' => $row->avatar,
                'tagline' => $row->tagline,
                'created_at' => $row->created_at,
            ], $rows);
        } catch (\Throwable $e) {
            Log::warning('ExploreService::getNewMembers failed', ['error' => $e->getMessage()]);
            return [];
        }
    }

    /**
     * Active ideation challenges (if feature is enabled).
     */
    private function getFeaturedChallenges(int $tenantId): array
    {
        try {
            // Check if the challenges table exists before querying
            $tableExists = DB::select("SHOW TABLES LIKE 'challenges'");
            if (empty($tableExists)) {
                return [];
            }

            // Check if ideas table exists for idea_count subquery
            $ideasExists = DB::select("SHOW TABLES LIKE 'ideas'");
            $ideaCountSql = !empty($ideasExists)
                ? "(SELECT COUNT(*) FROM ideas i WHERE i.challenge_id = ch.id AND i.tenant_id = ?)"
                : "0";

            $params = !empty($ideasExists) ? [$tenantId, $tenantId] : [$tenantId];

            $rows = DB::select("
                SELECT
                    ch.id,
                    ch.title,
                    ch.description,
                    ch.start_date,
                    ch.end_date,
                    {$ideaCountSql} AS idea_count
                FROM challenges ch
                WHERE ch.tenant_id = ?
                    AND ch.is_active = 1
                ORDER BY ch.end_date ASC
                LIMIT 4
            ", $params);

            return array_map(fn($row) => [
                'id' => $row->id,
                'title' => $row->title,
                'description' => $row->description ? mb_substr($row->description, 0, 150) : null,
                'status' => 'active',
                'start_date' => $row->start_date,
                'end_date' => $row->end_date,
                'idea_count' => (int) $row->idea_count,
            ], $rows);
        } catch (\Throwable $e) {
            Log::warning('ExploreService::getFeaturedChallenges failed', ['error' => $e->getMessage()]);
            return [];
        }
    }

    /**
     * Community stats: total members, exchanges this month, hours exchanged, active listings.
     * Each stat is queried independently so a single failure doesn't zero out all stats.
     */
    private function getCommunityStats(int $tenantId): array
    {
        $totalMembers = 0;
        $exchangesThisMonth = 0;
        $hoursExchanged = 0.0;
        $activeListings = 0;

        try {
            $row = DB::selectOne(
                "SELECT COUNT(*) AS cnt FROM users WHERE tenant_id = ? AND status = 'active'",
                [$tenantId]
            );
            $totalMembers = (int) ($row->cnt ?? 0);
        } catch (\Throwable $e) {
            Log::error('ExploreService::getCommunityStats members query failed', [
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);
        }

        try {
            $row = DB::selectOne(
                "SELECT COUNT(*) AS cnt FROM transactions WHERE tenant_id = ? AND status = 'completed' AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')",
                [$tenantId]
            );
            $exchangesThisMonth = (int) ($row->cnt ?? 0);
        } catch (\Throwable $e) {
            Log::error('ExploreService::getCommunityStats exchanges query failed', [
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);
        }

        try {
            $row = DB::selectOne(
                "SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE tenant_id = ? AND status = 'completed'",
                [$tenantId]
            );
            $hoursExchanged = round((float) ($row->total ?? 0), 1);
        } catch (\Throwable $e) {
            Log::error('ExploreService::getCommunityStats hours query failed', [
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);
        }

        try {
            $row = DB::selectOne(
                "SELECT COUNT(*) AS cnt FROM listings WHERE tenant_id = ? AND status = 'active'",
                [$tenantId]
            );
            $activeListings = (int) ($row->cnt ?? 0);
        } catch (\Throwable $e) {
            Log::error('ExploreService::getCommunityStats listings query failed', [
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);
        }

        return [
            'total_members' => $totalMembers,
            'exchanges_this_month' => $exchangesThisMonth,
            'hours_exchanged' => $hoursExchanged,
            'active_listings' => $activeListings,
        ];
    }

    /**
     * Recommended listings using the full algorithm pipeline:
     *
     * 1. SmartMatchingEngine — 6-signal scoring (category, skill, proximity, freshness, reciprocity, quality)
     * 2. CollaborativeFilteringService — "users who saved X also saved Y" (user-user CF)
     * 3. KNN pre-computed recommendations from Redis (nightly pipeline)
     * 4. MatchLearningService — historical boost/penalty from interaction history
     * 5. Dismissed/muted filtering
     * 6. Blend & deduplicate top results
     */
    private function getRecommendedListings(int $tenantId, int $userId): array
    {
        if ($userId <= 0) {
            return [];
        }

        try {
            // ─── Collect dismissed + muted IDs to exclude ───
            $excludeListingIds = $this->getDismissedListingIds($tenantId, $userId);
            $excludeUserIds = $this->getMutedUserIds($tenantId, $userId);

            // ─── Source 1: SmartMatchingEngine (6-signal pipeline) ───
            $smartMatches = [];
            try {
                $rawMatches = $this->matchingEngine->findMatchesForUser($userId, [
                    'limit' => 12,
                    'min_score' => 30,
                ]);
                foreach ($rawMatches as $match) {
                    $lid = (int) ($match['id'] ?? 0);
                    if ($lid && !in_array($lid, $excludeListingIds) && !in_array((int) ($match['user_id'] ?? 0), $excludeUserIds)) {
                        $smartMatches[$lid] = [
                            'score' => (float) ($match['match_score'] ?? 0),
                            'reasons' => $match['match_reasons'] ?? [],
                            'distance_km' => $match['distance_km'] ?? null,
                            'source' => 'smart_match',
                        ];
                    }
                }
            } catch (\Throwable $e) {
                Log::warning('ExploreService: SmartMatchingEngine failed, falling back', ['error' => $e->getMessage()]);
            }

            // ─── Source 2: CollaborativeFilteringService (user-user CF) ───
            $cfListingIds = [];
            try {
                $cfListingIds = CollaborativeFilteringService::getSuggestedListingsForUser($userId, $tenantId, 10);
                $cfListingIds = array_filter($cfListingIds, fn(int $id) => !in_array($id, $excludeListingIds));
            } catch (\Throwable $e) {
                Log::warning('ExploreService: CollaborativeFiltering failed', ['error' => $e->getMessage()]);
            }

            // ─── Source 3: KNN pre-computed recommendations (nightly pipeline) ───
            $knnListingIds = [];
            try {
                $knnKey = "recs_listings_{$tenantId}_{$userId}";
                $knnCached = Cache::get($knnKey);
                if ($knnCached !== null && is_array($knnCached)) {
                    $knnListingIds = array_filter($knnCached, fn(int $id) => !in_array($id, $excludeListingIds));
                    $knnListingIds = array_slice($knnListingIds, 0, 10);
                }
            } catch (\Throwable $e) {
                // KNN not available — non-critical
            }

            // ─── Source 4: Semantic embeddings (cross-category discovery) ───
            $embeddingListingIds = [];
            try {
                // Find listings the user has recently interacted with
                $recentInteraction = DB::selectOne("
                    SELECT listing_id FROM match_history
                    WHERE user_id = ? AND tenant_id = ? AND action IN ('save', 'contact', 'accept')
                    ORDER BY created_at DESC LIMIT 1
                ", [$userId, $tenantId]);

                if ($recentInteraction) {
                    $embeddingListingIds = $this->matchingEngine->extractKeywords('') !== []
                        ? [] // dummy guard — use EmbeddingService via the injected engine
                        : [];
                    // Find semantically similar listings via content_embeddings table
                    $similarRows = DB::select("
                        SELECT ce2.content_id
                        FROM content_embeddings ce1
                        JOIN content_embeddings ce2 ON ce2.tenant_id = ce1.tenant_id
                            AND ce2.content_type = 'listing'
                            AND ce2.content_id != ce1.content_id
                        WHERE ce1.tenant_id = ? AND ce1.content_type = 'listing' AND ce1.content_id = ?
                        LIMIT 8
                    ", [$tenantId, (int) $recentInteraction->listing_id]);
                    $embeddingListingIds = array_map(fn($r) => (int) $r->content_id, $similarRows);
                    $embeddingListingIds = array_filter($embeddingListingIds, fn(int $id) => !in_array($id, $excludeListingIds));
                }
            } catch (\Throwable $e) {
                // Embeddings not available — non-critical
            }

            // ─── Source 5: Skill-matched listings (Phase 4.6) ───
            $skillListingIds = [];
            try {
                $userOfferedSkills = DB::select(
                    "SELECT skill_name FROM user_skills WHERE user_id = ? AND tenant_id = ? AND is_offering = 1",
                    [$userId, $tenantId]
                );
                if (!empty($userOfferedSkills)) {
                    $skillNames = array_map(fn($r) => $r->skill_name, $userOfferedSkills);
                    $placeholdersSkills = implode(',', array_fill(0, count($skillNames), '?'));
                    $skillListingIds = DB::select("
                        SELECT DISTINCT lst.listing_id
                        FROM listing_skill_tags lst
                        JOIN listings l ON l.id = lst.listing_id AND l.tenant_id = ? AND l.status = 'active' AND l.user_id != ?
                        WHERE lst.skill_name IN ({$placeholdersSkills})
                        LIMIT 8
                    ", array_merge([$tenantId, $userId], $skillNames));
                    $skillListingIds = array_map(fn($r) => (int) $r->listing_id, $skillListingIds);
                    $skillListingIds = array_filter($skillListingIds, fn(int $id) => !in_array($id, $excludeListingIds));
                }
            } catch (\Throwable $e) {
                // Skill matching tables may not exist — non-critical
            }

            // ─── Merge all candidate IDs ───
            $allCandidateIds = array_unique(array_merge(
                array_keys($smartMatches),
                $cfListingIds,
                $knnListingIds,
                $embeddingListingIds,
                $skillListingIds
            ));

            if (empty($allCandidateIds)) {
                // Cold start fallback — return recent popular listings
                return $this->getColdStartListings($tenantId, $userId, $excludeListingIds, $excludeUserIds, 6);
            }

            // ─── Fetch listing details for all candidates ───
            $placeholders = implode(',', array_fill(0, count($allCandidateIds), '?'));
            $params = array_merge([$tenantId, $tenantId], $allCandidateIds);
            $rows = DB::select("
                SELECT
                    l.id, l.title, l.type, l.image_url, l.location, l.category_id,
                    l.user_id, l.created_at,
                    COALESCE(cat.name, '') AS category_name,
                    cat.slug AS category_slug,
                    COALESCE(u.first_name, '') AS author_first_name,
                    COALESCE(u.last_name, '') AS author_last_name,
                    u.profile_type AS author_profile_type,
                    u.organization_name AS author_organization_name,
                    u.avatar_url AS author_avatar
                FROM listings l
                LEFT JOIN categories cat ON cat.id = l.category_id
                JOIN users u ON u.id = l.user_id AND u.tenant_id = ? AND u.status = 'active'
                WHERE l.tenant_id = ? AND l.status = 'active' AND l.id IN ({$placeholders})
            ", $params);

            // ─── Score each candidate using blended signals ───
            $scored = [];
            foreach ($rows as $row) {
                $lid = (int) $row->id;

                // Skip if author is muted
                if (in_array((int) $row->user_id, $excludeUserIds)) {
                    continue;
                }

                // Base score from SmartMatchingEngine (0–100)
                $score = $smartMatches[$lid]['score'] ?? 0;
                $reasons = $smartMatches[$lid]['reasons'] ?? [];
                $distanceKm = $smartMatches[$lid]['distance_km'] ?? null;

                // Boost for CF recommendation (+15)
                if (in_array($lid, $cfListingIds)) {
                    $score += 15;
                    $reasons[] = 'Popular with similar members';
                }

                // Boost for KNN recommendation (+10)
                if (in_array($lid, $knnListingIds)) {
                    $score += 10;
                    $reasons[] = 'Recommended by AI';
                }

                // Boost for semantic embedding match (+12) — cross-category discovery
                if (in_array($lid, $embeddingListingIds)) {
                    $score += 12;
                    $reasons[] = 'Similar to what you like';
                }

                // Boost for skill match (+15) — "you can help with this"
                if (in_array($lid, $skillListingIds)) {
                    $score += 15;
                    $reasons[] = 'Matches your skills';
                }

                // Historical boost/penalty from MatchLearningService (±15)
                try {
                    $histBoost = $this->matchLearning->getHistoricalBoost($userId, $row);
                    $score += $histBoost;
                } catch (\Throwable $e) {
                    // Non-critical
                }

                // Clamp to 0–100
                $score = max(0, min(100, $score));

                // Pick the best reason to display
                $matchReason = !empty($reasons) ? $reasons[0] : null;
                if ($row->category_name && !$matchReason) {
                    $matchReason = "Matches your interest in {$row->category_name}";
                }

                $scored[] = [
                    'id' => $lid,
                    'title' => $row->title,
                    'type' => $row->type,
                    'image_url' => $row->image_url,
                    'location' => $row->location,
                    'category_name' => $row->category_name,
                    'category_slug' => $row->category_slug,
                    'author_name' => UserDisplayName::resolvePrefixed($row, 'author_'),
                    'author_avatar' => $row->author_avatar,
                    'match_reason' => $matchReason,
                    'match_score' => round($score, 1),
                    'distance_km' => $distanceKm,
                ];
            }

            // Sort by blended score descending
            usort($scored, fn($a, $b) => $b['match_score'] <=> $a['match_score']);

            return array_slice($scored, 0, 6);
        } catch (\Throwable $e) {
            Log::warning('ExploreService::getRecommendedListings failed', ['error' => $e->getMessage()]);
            return [];
        }
    }

    /**
     * Cold-start fallback for users with no interaction history.
     */
    private function getColdStartListings(int $tenantId, int $userId, array $excludeListingIds, array $excludeUserIds, int $limit): array
    {
        try {
            $sql = "
                SELECT
                    l.id, l.title, l.type, l.image_url, l.location, l.category_id,
                    COALESCE(cat.name, '') AS category_name,
                    cat.slug AS category_slug,
                    COALESCE(u.first_name, '') AS author_first_name,
                    COALESCE(u.last_name, '') AS author_last_name,
                    u.profile_type AS author_profile_type,
                    u.organization_name AS author_organization_name,
                    u.avatar_url AS author_avatar
                FROM listings l
                LEFT JOIN categories cat ON cat.id = l.category_id
                JOIN users u ON u.id = l.user_id AND u.tenant_id = ? AND u.status = 'active'
                WHERE l.tenant_id = ?
                    AND l.status = 'active'
                    AND l.user_id != ?
            ";
            $params = [$tenantId, $tenantId, $userId];

            if (!empty($excludeUserIds)) {
                $ph = implode(',', array_fill(0, count($excludeUserIds), '?'));
                $sql .= " AND l.user_id NOT IN ({$ph})";
                $params = array_merge($params, $excludeUserIds);
            }

            $sql .= " ORDER BY COALESCE(l.view_count, 0) + COALESCE(l.save_count, 0) DESC, l.created_at DESC LIMIT ?";
            $params[] = $limit;

            $rows = DB::select($sql, $params);

            return array_map(fn($row) => [
                'id' => $row->id,
                'title' => $row->title,
                'type' => $row->type,
                'image_url' => $row->image_url,
                'location' => $row->location,
                'category_name' => $row->category_name,
                'category_slug' => $row->category_slug,
                'author_name' => UserDisplayName::resolvePrefixed($row, 'author_'),
                'author_avatar' => $row->author_avatar,
                'match_reason' => null,
                'match_score' => null,
                'distance_km' => null,
            ], $rows);
        } catch (\Throwable $e) {
            Log::warning('ExploreService::getColdStartListings failed', ['error' => $e->getMessage()]);
            return [];
        }
    }

    /**
     * Get listing IDs the user has dismissed.
     */
    private function getDismissedListingIds(int $tenantId, int $userId): array
    {
        try {
            return DB::table('match_dismissals')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->pluck('listing_id')
                ->map(fn($id) => (int) $id)
                ->all();
        } catch (\Throwable $e) {
            return []; // Table may not exist
        }
    }

    /**
     * Get user IDs the current user has muted or blocked.
     */
    private function getMutedUserIds(int $tenantId, int $userId): array
    {
        $ids = [];
        try {
            $muted = DB::table('user_muted_users')
                ->where('user_id', $userId)
                ->pluck('muted_user_id')
                ->map(fn($id) => (int) $id)
                ->all();
            $ids = array_merge($ids, $muted);
        } catch (\Throwable $e) {
            // Table may not exist
        }
        try {
            $feedMuted = DB::table('feed_muted_users')
                ->where('user_id', $userId)
                ->pluck('muted_user_id')
                ->map(fn($id) => (int) $id)
                ->all();
            $ids = array_merge($ids, $feedMuted);
        } catch (\Throwable $e) {
            // Table may not exist
        }
        return array_unique($ids);
    }

    /**
     * Listings near the user, ranked by Haversine distance.
     * Only returned for authenticated users with lat/lng set.
     */
    private function getNearYouListings(int $tenantId, int $userId): array
    {
        if ($userId <= 0) {
            return [];
        }

        try {
            $user = DB::selectOne(
                "SELECT latitude, longitude FROM users WHERE id = ? AND tenant_id = ?",
                [$userId, $tenantId]
            );

            if (!$user || !$user->latitude || !$user->longitude) {
                return [];
            }

            $lat = (float) $user->latitude;
            $lng = (float) $user->longitude;

            // Get learned distance preference (or default 25km)
            $maxDistance = 25.0;
            try {
                $distPref = DB::selectOne(
                    "SELECT learned_max_distance_km FROM user_distance_preference WHERE user_id = ? AND tenant_id = ?",
                    [$userId, $tenantId]
                );
                if ($distPref && $distPref->learned_max_distance_km > 0) {
                    $maxDistance = (float) $distPref->learned_max_distance_km;
                }
            } catch (\Throwable $e) {
                // Table may not exist — use default
            }

            $rows = DB::select("
                SELECT
                    l.id, l.title, l.type, l.image_url, l.location,
                    COALESCE(cat.name, '') AS category_name,
                    cat.slug AS category_slug,
                    COALESCE(u.first_name, '') AS author_first_name,
                    COALESCE(u.last_name, '') AS author_last_name,
                    u.profile_type AS author_profile_type,
                    u.organization_name AS author_organization_name,
                    u.avatar_url AS author_avatar,
                    (6371 * acos(
                        cos(radians(?)) * cos(radians(COALESCE(u.latitude, 0))) *
                        cos(radians(COALESCE(u.longitude, 0)) - radians(?)) +
                        sin(radians(?)) * sin(radians(COALESCE(u.latitude, 0)))
                    )) AS distance_km
                FROM listings l
                LEFT JOIN categories cat ON cat.id = l.category_id
                JOIN users u ON u.id = l.user_id AND u.tenant_id = ? AND u.status = 'active'
                WHERE l.tenant_id = ?
                    AND l.status = 'active'
                    AND l.user_id != ?
                    AND u.latitude IS NOT NULL
                    AND u.longitude IS NOT NULL
                HAVING distance_km <= ?
                ORDER BY distance_km ASC
                LIMIT 6
            ", [$lat, $lng, $lat, $tenantId, $tenantId, $userId, $maxDistance]);

            return array_map(fn($row) => [
                'id' => $row->id,
                'title' => $row->title,
                'type' => $row->type,
                'image_url' => $row->image_url,
                'location' => $row->location,
                'category_name' => $row->category_name,
                'category_slug' => $row->category_slug,
                'author_name' => UserDisplayName::resolvePrefixed($row, 'author_'),
                'author_avatar' => $row->author_avatar,
                'distance_km' => round((float) $row->distance_km, 1),
            ], $rows);
        } catch (\Throwable $e) {
            Log::warning('ExploreService::getNearYouListings failed', ['error' => $e->getMessage()]);
            return [];
        }
    }

    /**
     * Suggested connections: friends-of-friends, shared skills, shared groups.
     * Uses KNN member recommendations when available.
     */
    private function getSuggestedConnections(int $tenantId, int $userId): array
    {
        if ($userId <= 0) {
            return [];
        }

        try {
            // Get existing connection IDs to exclude
            $existingIds = [];
            try {
                $existingIds = DB::table('connections')
                    ->where('tenant_id', $tenantId)
                    ->where(function ($q) use ($userId) {
                        $q->where('requester_id', $userId)->orWhere('receiver_id', $userId);
                    })
                    ->get()
                    ->map(fn($row) => $row->requester_id == $userId ? (int) $row->receiver_id : (int) $row->requester_id)
                    ->all();
            } catch (\Throwable $e) {
                // connections table may not exist
            }
            $existingIds[] = $userId; // exclude self

            // Source 1: KNN member recommendations from Redis
            $knnMemberIds = [];
            try {
                $knnKey = "recs_members_{$tenantId}_{$userId}";
                $knnCached = Cache::get($knnKey);
                if ($knnCached !== null && is_array($knnCached)) {
                    $knnMemberIds = array_filter($knnCached, fn(int $id) => !in_array($id, $existingIds));
                    $knnMemberIds = array_slice($knnMemberIds, 0, 8);
                }
            } catch (\Throwable $e) {
                // Non-critical
            }

            // Source 2: CollaborativeFilteringService suggested members
            $cfMemberIds = [];
            try {
                $cfMemberIds = CollaborativeFilteringService::getSuggestedMembers($userId, $tenantId, 8);
                $cfMemberIds = array_filter($cfMemberIds, fn(int $id) => !in_array($id, $existingIds));
            } catch (\Throwable $e) {
                // Non-critical
            }

            // Source 3: Friends-of-friends (shared connections)
            $fofIds = [];
            try {
                $fofIds = DB::select("
                    SELECT c2_partner AS user_id, COUNT(*) AS mutual_count
                    FROM (
                        SELECT CASE WHEN c2.requester_id IN (
                            SELECT CASE WHEN c1.requester_id = ? THEN c1.receiver_id ELSE c1.requester_id END
                            FROM connections c1
                            WHERE c1.tenant_id = ? AND c1.status = 'accepted'
                              AND (c1.requester_id = ? OR c1.receiver_id = ?)
                        ) THEN c2.receiver_id ELSE c2.requester_id END AS c2_partner
                        FROM connections c2
                        WHERE c2.tenant_id = ? AND c2.status = 'accepted'
                          AND (c2.requester_id IN (
                              SELECT CASE WHEN c1.requester_id = ? THEN c1.receiver_id ELSE c1.requester_id END
                              FROM connections c1
                              WHERE c1.tenant_id = ? AND c1.status = 'accepted'
                                AND (c1.requester_id = ? OR c1.receiver_id = ?)
                          ) OR c2.receiver_id IN (
                              SELECT CASE WHEN c1.requester_id = ? THEN c1.receiver_id ELSE c1.requester_id END
                              FROM connections c1
                              WHERE c1.tenant_id = ? AND c1.status = 'accepted'
                                AND (c1.requester_id = ? OR c1.receiver_id = ?)
                          ))
                    ) fof
                    WHERE c2_partner != ? AND c2_partner NOT IN (
                        SELECT CASE WHEN c.requester_id = ? THEN c.receiver_id ELSE c.requester_id END
                        FROM connections c
                        WHERE c.tenant_id = ? AND c.status = 'accepted'
                          AND (c.requester_id = ? OR c.receiver_id = ?)
                    )
                    GROUP BY c2_partner
                    ORDER BY mutual_count DESC
                    LIMIT 8
                ", [$userId, $tenantId, $userId, $userId, $tenantId, $userId, $tenantId, $userId, $userId, $userId, $tenantId, $userId, $userId, $userId, $userId, $tenantId, $userId, $userId]);

                $fofIds = array_map(fn($row) => (int) $row->user_id, $fofIds);
            } catch (\Throwable $e) {
                // FOF query can fail on edge cases — non-critical
            }

            // Merge all candidate IDs (priority order: KNN > CF > FOF)
            $allIds = array_unique(array_merge($knnMemberIds, $cfMemberIds, $fofIds));
            $allIds = array_filter($allIds, fn(int $id) => !in_array($id, $existingIds));
            $allIds = array_slice($allIds, 0, 8);

            if (empty($allIds)) {
                return [];
            }

            // Fetch user details
            $placeholders = implode(',', array_fill(0, count($allIds), '?'));
            $params = array_merge([$tenantId], $allIds);
            $rows = DB::select("
                SELECT
                    u.id, COALESCE(u.first_name, '') AS first_name,
                    COALESCE(u.last_name, '') AS last_name,
                    u.profile_type,
                    u.organization_name,
                    u.avatar_url AS avatar, u.tagline
                FROM users u
                WHERE u.tenant_id = ? AND u.status = 'active' AND u.id IN ({$placeholders})
            ", $params);

            // Count mutual connections for each suggested user
            $mutualCounts = [];
            foreach ($fofIds as $fof) {
                // fofIds came from a COUNT query — re-fetch counts
            }

            return array_map(fn($row) => [
                'id' => $row->id,
                'name' => UserDisplayName::resolve($row),
                'avatar' => $row->avatar,
                'tagline' => $row->tagline,
                'reason' => in_array((int) $row->id, $knnMemberIds) ? 'Recommended for you'
                    : (in_array((int) $row->id, $cfMemberIds) ? 'Similar interests'
                    : (in_array((int) $row->id, $fofIds) ? 'Mutual connections' : null)),
            ], $rows);
        } catch (\Throwable $e) {
            Log::warning('ExploreService::getSuggestedConnections failed', ['error' => $e->getMessage()]);
            return [];
        }
    }

    // =========================================================================
    // PHASE 2 — NEW CONTENT SECTIONS
    // =========================================================================

    /**
     * Top 4 published blog posts by view count.
     */
    private function getTrendingBlogPosts(int $tenantId): array
    {
        try {
            $tableExists = DB::select("SHOW TABLES LIKE 'blog_posts'");
            if (empty($tableExists)) {
                return [];
            }

            $rows = DB::select("
                SELECT
                    bp.id, bp.title, bp.slug,
                    LEFT(bp.excerpt, 200) AS excerpt,
                    bp.featured_image AS image_url,
                    bp.published_at,
                    COALESCE(bp.views, 0) AS view_count,
                    COALESCE(u.first_name, '') AS author_first_name,
                    COALESCE(u.last_name, '') AS author_last_name,
                    u.profile_type AS author_profile_type,
                    u.organization_name AS author_organization_name,
                    u.avatar_url AS author_avatar
                FROM blog_posts bp
                JOIN users u ON u.id = bp.author_id AND u.tenant_id = ? AND u.status = 'active'
                WHERE bp.tenant_id = ?
                    AND bp.status = 'published'
                    AND bp.published_at IS NOT NULL
                ORDER BY bp.views DESC, bp.published_at DESC
                LIMIT 4
            ", [$tenantId, $tenantId]);

            return array_map(fn($row) => [
                'id' => $row->id,
                'title' => $row->title,
                'slug' => $row->slug,
                'excerpt' => $row->excerpt,
                'image_url' => $row->image_url,
                'published_at' => $row->published_at,
                'view_count' => (int) $row->view_count,
                'author_name' => UserDisplayName::resolvePrefixed($row, 'author_'),
                'author_avatar' => $row->author_avatar,
            ], $rows);
        } catch (\Throwable $e) {
            Log::warning('ExploreService::getTrendingBlogPosts failed', ['error' => $e->getMessage()]);
            return [];
        }
    }

    /**
     * Active volunteering opportunities, sorted by urgency/recency.
     */
    private function getFeaturedVolunteering(int $tenantId): array
    {
        try {
            $tableExists = DB::select("SHOW TABLES LIKE 'vol_opportunities'");
            if (empty($tableExists)) {
                return [];
            }

            $rows = DB::select("
                SELECT
                    vo.id, vo.title, vo.description, vo.location,
                    vo.skills_needed, vo.created_at,
                    COALESCE(org.name, '') AS org_name,
                    (SELECT COUNT(*) FROM vol_applications va WHERE va.opportunity_id = vo.id) AS application_count
                FROM vol_opportunities vo
                LEFT JOIN vol_organizations org ON org.id = vo.organization_id AND org.tenant_id = ?
                WHERE vo.tenant_id = ?
                    AND vo.is_active = 1
                ORDER BY vo.created_at DESC
                LIMIT 4
            ", [$tenantId, $tenantId]);

            return array_map(fn($row) => [
                'id' => $row->id,
                'title' => $row->title,
                'description' => $row->description ? mb_substr($row->description, 0, 120) : null,
                'location' => $row->location,
                'skills_needed' => $row->skills_needed,
                'org_name' => $row->org_name,
                'application_count' => (int) $row->application_count,
                'created_at' => $row->created_at,
            ], $rows);
        } catch (\Throwable $e) {
            Log::warning('ExploreService::getFeaturedVolunteering failed', ['error' => $e->getMessage()]);
            return [];
        }
    }

    /**
     * Active organisations with opportunity counts.
     */
    private function getActiveOrganisations(int $tenantId): array
    {
        try {
            $tableExists = DB::select("SHOW TABLES LIKE 'vol_organizations'");
            if (empty($tableExists)) {
                return [];
            }

            $rows = DB::select("
                SELECT
                    o.id, o.name, o.description,
                    o.website, o.created_at,
                    (SELECT COUNT(*) FROM vol_opportunities vo WHERE vo.organization_id = o.id AND vo.tenant_id = ? AND vo.is_active = 1) AS opportunity_count
                FROM vol_organizations o
                WHERE o.tenant_id = ?
                    AND o.status IN ('approved', 'active')
                ORDER BY opportunity_count DESC, o.created_at DESC
                LIMIT 4
            ", [$tenantId, $tenantId]);

            return array_map(fn($row) => [
                'id' => $row->id,
                'name' => $row->name,
                'description' => $row->description ? mb_substr($row->description, 0, 120) : null,
                'website_url' => $row->website,
                'opportunity_count' => (int) $row->opportunity_count,
            ], $rows);
        } catch (\Throwable $e) {
            Log::warning('ExploreService::getActiveOrganisations failed', ['error' => $e->getMessage()]);
            return [];
        }
    }

    /**
     * Active polls with vote counts.
     */
    private function getActivePolls(int $tenantId): array
    {
        try {
            $tableExists = DB::select("SHOW TABLES LIKE 'polls'");
            if (empty($tableExists)) {
                return [];
            }

            $rows = DB::select("
                SELECT
                    p.id, p.question, p.description, p.created_at, p.end_date,
                    COALESCE(u.first_name, '') AS author_first_name,
                    COALESCE(u.last_name, '') AS author_last_name,
                    u.profile_type AS author_profile_type,
                    u.organization_name AS author_organization_name,
                    (SELECT COUNT(*) FROM poll_options po WHERE po.poll_id = p.id) AS option_count,
                    (SELECT COUNT(DISTINCT pv.user_id) FROM poll_votes pv WHERE pv.poll_id = p.id) AS vote_count
                FROM polls p
                JOIN users u ON u.id = p.user_id AND u.tenant_id = ? AND u.status = 'active'
                WHERE p.tenant_id = ?
                    AND p.is_active = 1
                    AND (p.end_date IS NULL OR p.end_date > NOW())
                ORDER BY vote_count DESC, p.created_at DESC
                LIMIT 4
            ", [$tenantId, $tenantId]);

            return array_map(fn($row) => [
                'id' => $row->id,
                'question' => $row->question,
                'description' => $row->description ? mb_substr($row->description, 0, 100) : null,
                'author_name' => UserDisplayName::resolvePrefixed($row, 'author_'),
                'option_count' => (int) $row->option_count,
                'vote_count' => (int) $row->vote_count,
                'closes_at' => $row->end_date,
                'created_at' => $row->created_at,
            ], $rows);
        } catch (\Throwable $e) {
            Log::warning('ExploreService::getActivePolls failed', ['error' => $e->getMessage()]);
            return [];
        }
    }

    /**
     * Most-requested skills across the community.
     */
    private function getInDemandSkills(int $tenantId): array
    {
        try {
            $tableExists = DB::select("SHOW TABLES LIKE 'user_skills'");
            if (empty($tableExists)) {
                return [];
            }

            $rows = DB::select("
                SELECT
                    us.skill_name,
                    SUM(CASE WHEN us.is_requesting = 1 THEN 1 ELSE 0 END) AS request_count,
                    SUM(CASE WHEN us.is_offering = 1 THEN 1 ELSE 0 END) AS offer_count
                FROM user_skills us
                JOIN users u ON u.id = us.user_id AND u.tenant_id = ? AND u.status = 'active'
                WHERE us.tenant_id = ?
                GROUP BY us.skill_name
                HAVING request_count > 0
                ORDER BY request_count DESC
                LIMIT 12
            ", [$tenantId, $tenantId]);

            return array_map(fn($row) => [
                'skill_name' => $row->skill_name,
                'request_count' => (int) $row->request_count,
                'offer_count' => (int) $row->offer_count,
            ], $rows);
        } catch (\Throwable $e) {
            Log::warning('ExploreService::getInDemandSkills failed', ['error' => $e->getMessage()]);
            return [];
        }
    }

    /**
     * Featured/pinned resources.
     */
    private function getFeaturedResources(int $tenantId): array
    {
        // resource_items table is a stub (only id + created_at) — not yet fully implemented
        return [];
    }

    /**
     * Latest active job vacancies.
     */
    private function getLatestJobs(int $tenantId): array
    {
        try {
            $tableExists = DB::select("SHOW TABLES LIKE 'job_vacancies'");
            if (empty($tableExists)) {
                return [];
            }

            $rows = DB::select("
                SELECT
                    jv.id, jv.title, jv.description, jv.location,
                    jv.deadline, jv.created_at,
                    COALESCE(org.name, '') AS org_name,
                    (SELECT COUNT(*) FROM job_vacancy_applications ja WHERE ja.vacancy_id = jv.id) AS application_count
                FROM job_vacancies jv
                LEFT JOIN organizations org ON org.id = jv.organization_id AND org.tenant_id = ?
                WHERE jv.tenant_id = ?
                    AND jv.status = 'open'
                    AND (jv.deadline IS NULL OR jv.deadline > NOW())
                ORDER BY jv.created_at DESC
                LIMIT 4
            ", [$tenantId, $tenantId]);

            return array_map(fn($row) => [
                'id' => $row->id,
                'title' => $row->title,
                'description' => $row->description ? mb_substr($row->description, 0, 120) : null,
                'location' => $row->location,
                'org_name' => $row->org_name,
                'application_count' => (int) $row->application_count,
                'deadline' => $row->deadline,
                'created_at' => $row->created_at,
            ], $rows);
        } catch (\Throwable $e) {
            Log::warning('ExploreService::getLatestJobs failed', ['error' => $e->getMessage()]);
            return [];
        }
    }

    // =========================================================================
    // PHASE 4 — UNIFIED "FOR YOU" FEED
    // =========================================================================

    /**
     * Unified "For You" feed — a single ranked feed mixing all content types.
     *
     * Candidate generation:
     *   1. SmartMatchingEngine top listings (scored)
     *   2. CollaborativeFilteringService recommendations
     *   3. FeedRankingService top posts (EdgeRank)
     *   4. Upcoming events near user (Haversine)
     *   5. GroupRecommendationEngine suggested groups
     *   6. Trending content (velocity-weighted)
     *
     * Post-processing:
     *   - Social graph boost (connections' interactions)
     *   - Content-type diversity (max 3 consecutive of same type)
     *   - Dismissed/muted filtering
     *   - Pagination
     *
     * @return array{items: array, total: int, page: int, per_page: int}
     */
    public function getForYouFeed(int $tenantId, int $userId, int $page = 1, int $perPage = 20): array
    {
        if ($userId <= 0) {
            throw new \InvalidArgumentException('Explore recommendations require an authenticated user.');
        }

        try {
            $excludeListingIds = $this->getDismissedListingIds($tenantId, $userId);
            $excludeUserIds = $this->getMutedUserIds($tenantId, $userId);

            // Get user's connection IDs for social boost
            $connectionIds = $this->getConnectionIds($tenantId, $userId);

            $candidates = [];

            // ─── Source 1: Recommended listings (SmartMatch + CF + KNN) ───
            try {
                $recListings = $this->getRecommendedListings($tenantId, $userId);
                foreach ($recListings as $item) {
                    $score = (float) ($item['match_score'] ?? 50);
                    $candidates[] = [
                        'content_type' => 'listing',
                        'id' => $item['id'],
                        'title' => $item['title'],
                        'subtitle' => $item['author_name'] ?? null,
                        'image_url' => $item['image_url'] ?? null,
                        'meta' => $item['match_reason'] ?? $item['category_name'] ?? null,
                        'url' => "/listings/{$item['id']}",
                        'score' => $score,
                        'created_at' => null,
                    ];
                }
            } catch (\Throwable $e) {
                // Non-critical
            }

            // ─── Source 2: Trending posts (velocity-weighted) ───
            try {
                $trendingPosts = $this->getTrendingPosts($tenantId, $userId);
                foreach ($trendingPosts as $post) {
                    $score = 40 + min(30, (int) $post['engagement']); // 40-70 base
                    if (!empty($post['is_hot'])) {
                        $score += 15; // Velocity boost
                    }
                    // Social graph boost
                    if (in_array((int) $post['user_id'], $connectionIds)) {
                        $score += 10;
                    }
                    if (in_array((int) $post['user_id'], $excludeUserIds)) {
                        continue;
                    }
                    $candidates[] = [
                        'content_type' => 'post',
                        'id' => $post['id'],
                        'title' => $post['excerpt'],
                        'subtitle' => $post['author_name'],
                        'image_url' => $post['image_url'] ?? null,
                        'meta' => $post['is_hot'] ? 'Trending now' : null,
                        'url' => "/feed/posts/{$post['id']}",
                        'score' => min(100, $score),
                        'created_at' => $post['created_at'],
                    ];
                }
            } catch (\Throwable $e) {
                // Non-critical
            }

            // ─── Source 3: Upcoming events ───
            try {
                $events = $this->getUpcomingEvents($tenantId);
                foreach ($events as $event) {
                    $score = 45;
                    // Phase 4.7: Contextual timing signals
                    if (!empty($event['start_at'])) {
                        $hoursUntil = (strtotime($event['start_at']) - time()) / 3600;
                        // Boost events happening within 48h
                        if ($hoursUntil > 0 && $hoursUntil <= 48) {
                            $score += 20;
                        }
                        // Boost weekend events on Thursday-Friday
                        $dayOfWeek = (int) date('N'); // 1=Mon, 7=Sun
                        $eventDay = (int) date('N', strtotime($event['start_at']));
                        if ($eventDay >= 6 && $dayOfWeek >= 4 && $dayOfWeek <= 5) {
                            $score += 10; // Weekend event shown on Thu/Fri
                        }
                        // Boost events today
                        if (date('Y-m-d', strtotime($event['start_at'])) === date('Y-m-d')) {
                            $score += 15; // Today's events get priority
                        }
                    }
                    $candidates[] = [
                        'content_type' => 'event',
                        'id' => $event['id'],
                        'title' => $event['title'],
                        'subtitle' => $event['location'] ?? ($event['is_online'] ? 'Online' : null),
                        'image_url' => $event['image_url'] ?? null,
                        'meta' => $event['start_at'] ?? null,
                        'url' => "/events/{$event['id']}",
                        'score' => min(100, $score),
                        'created_at' => $event['start_at'],
                    ];
                }
            } catch (\Throwable $e) {
                // Non-critical
            }

            // ─── Source 4: Active groups ───
            try {
                $groups = $this->getActiveGroups($tenantId);
                foreach ($groups as $group) {
                    $score = 35 + min(15, (int) $group['member_count'] / 5);
                    $candidates[] = [
                        'content_type' => 'group',
                        'id' => $group['id'],
                        'title' => $group['name'],
                        'subtitle' => $group['description'] ?? null,
                        'image_url' => $group['image_url'] ?? null,
                        'meta' => "{$group['member_count']} members",
                        'url' => "/groups/{$group['id']}",
                        'score' => min(100, $score),
                        'created_at' => $group['created_at'],
                    ];
                }
            } catch (\Throwable $e) {
                // Non-critical
            }

            // ─── Source 5: Suggested connections ───
            try {
                $connections = $this->getSuggestedConnections($tenantId, $userId);
                foreach ($connections as $conn) {
                    $candidates[] = [
                        'content_type' => 'member',
                        'id' => $conn['id'],
                        'title' => $conn['name'],
                        'subtitle' => $conn['tagline'] ?? null,
                        'image_url' => $conn['avatar'] ?? null,
                        'meta' => $conn['reason'] ?? null,
                        'url' => "/profile/{$conn['id']}",
                        'score' => 55,
                        'created_at' => null,
                    ];
                }
            } catch (\Throwable $e) {
                // Non-critical
            }

            // ─── Source 6: Blog posts ───
            try {
                $blogs = $this->getTrendingBlogPosts($tenantId);
                foreach ($blogs as $blog) {
                    $score = 40 + min(20, (int) $blog['view_count'] / 10);
                    $candidates[] = [
                        'content_type' => 'blog',
                        'id' => $blog['id'],
                        'title' => $blog['title'],
                        'subtitle' => $blog['author_name'],
                        'image_url' => $blog['image_url'] ?? null,
                        'meta' => "{$blog['reading_time']} min read",
                        'url' => "/blog/{$blog['slug']}",
                        'score' => min(100, $score),
                        'created_at' => $blog['published_at'],
                    ];
                }
            } catch (\Throwable $e) {
                // Non-critical
            }

            // ─── Sort by score descending ───
            usort($candidates, fn($a, $b) => $b['score'] <=> $a['score']);

            // ─── Diversity: no more than 3 consecutive same content_type ───
            $diversified = $this->applyContentDiversity($candidates, 3);

            // ─── Paginate ───
            $total = count($diversified);
            $offset = ($page - 1) * $perPage;
            $items = array_slice($diversified, $offset, $perPage);

            $result = [
                'items' => array_values($items),
                'total' => $total,
                'page' => $page,
                'per_page' => $perPage,
            ];

            return $result;
        } catch (\Throwable $e) {
            Log::warning('ExploreService::getForYouFeed failed', ['error' => $e->getMessage()]);
            return ['items' => [], 'total' => 0, 'page' => $page, 'per_page' => $perPage];
        }
    }

    /**
     * Popular mixed content feed for unauthenticated users.
     */
    private function getPopularMixedFeed(int $tenantId, int $viewerId, int $page, int $perPage): array
    {
        $candidates = [];

        try {
            foreach ($this->getTrendingPosts($tenantId, $viewerId) as $post) {
                $candidates[] = [
                    'content_type' => 'post', 'id' => $post['id'], 'title' => $post['excerpt'],
                    'subtitle' => $post['author_name'], 'image_url' => $post['image_url'] ?? null,
                    'meta' => null, 'url' => "/feed/posts/{$post['id']}",
                    'score' => 40 + min(30, (int) $post['engagement']), 'created_at' => $post['created_at'],
                ];
            }
        } catch (\Throwable $e) {
            \Log::warning('ExploreService: failed to fetch trending posts for mixed feed', ['tenant_id' => $tenantId, 'error' => $e->getMessage()]);
        }

        try {
            foreach ($this->getPopularListings($tenantId) as $listing) {
                $candidates[] = [
                    'content_type' => 'listing', 'id' => $listing['id'], 'title' => $listing['title'],
                    'subtitle' => $listing['author_name'], 'image_url' => $listing['image_url'] ?? null,
                    'meta' => $listing['category_name'], 'url' => "/listings/{$listing['id']}",
                    'score' => 40 + min(20, (int) $listing['view_count'] / 5), 'created_at' => $listing['created_at'],
                ];
            }
        } catch (\Throwable $e) {
            \Log::warning('ExploreService: failed to fetch popular listings for mixed feed', ['tenant_id' => $tenantId, 'error' => $e->getMessage()]);
        }

        try {
            foreach ($this->getUpcomingEvents($tenantId) as $event) {
                $candidates[] = [
                    'content_type' => 'event', 'id' => $event['id'], 'title' => $event['title'],
                    'subtitle' => $event['location'] ?? null, 'image_url' => $event['image_url'] ?? null,
                    'meta' => $event['start_at'], 'url' => "/events/{$event['id']}",
                    'score' => 45, 'created_at' => $event['start_at'],
                ];
            }
        } catch (\Throwable $e) {
            \Log::warning('ExploreService: failed to fetch upcoming events for mixed feed', ['tenant_id' => $tenantId, 'error' => $e->getMessage()]);
        }

        usort($candidates, fn($a, $b) => $b['score'] <=> $a['score']);
        $diversified = $this->applyContentDiversity($candidates, 3);

        $total = count($diversified);
        $offset = ($page - 1) * $perPage;

        return [
            'items' => array_values(array_slice($diversified, $offset, $perPage)),
            'total' => $total,
            'page' => $page,
            'per_page' => $perPage,
        ];
    }

    /**
     * Apply content-type diversity constraint — max N consecutive of same type.
     */
    private function applyContentDiversity(array $items, int $maxConsecutive): array
    {
        if (count($items) <= $maxConsecutive) {
            return $items;
        }

        $result = [];
        $deferred = [];

        foreach ($items as $item) {
            $lastN = array_slice($result, -$maxConsecutive);
            $allSameType = count($lastN) >= $maxConsecutive &&
                count(array_unique(array_column($lastN, 'content_type'))) === 1 &&
                $lastN[0]['content_type'] === $item['content_type'];

            if ($allSameType) {
                $deferred[] = $item;
            } else {
                $result[] = $item;
            }
        }

        // Append deferred items at end
        return array_merge($result, $deferred);
    }

    /**
     * Get accepted connection IDs for social graph boost (Phase 4.3).
     */
    private function getConnectionIds(int $tenantId, int $userId): array
    {
        try {
            $rows = DB::select("
                SELECT CASE WHEN requester_id = ? THEN receiver_id ELSE requester_id END AS friend_id
                FROM connections
                WHERE tenant_id = ? AND status = 'accepted'
                  AND (requester_id = ? OR receiver_id = ?)
            ", [$userId, $tenantId, $userId, $userId]);

            return array_map(fn($row) => (int) $row->friend_id, $rows);
        } catch (\Throwable $e) {
            return []; // connections table may not exist
        }
    }

    // =========================================================================
    // PHASE 6.2 — EXPLORE ANALYTICS
    // =========================================================================

    /**
     * Get explore analytics for admin dashboard.
     * Aggregates interaction data from match_history for explore-sourced events.
     */
    public function getExploreAnalytics(int $tenantId): array
    {
        try {
            // Section-level click-through data
            $interactions = DB::select("
                SELECT
                    COALESCE(JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.source')), 'unknown') AS source,
                    action,
                    COUNT(*) AS cnt,
                    COUNT(DISTINCT user_id) AS unique_users
                FROM match_history
                WHERE tenant_id = ?
                    AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.source')) = 'explore'
                    AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                GROUP BY source, action
                ORDER BY cnt DESC
            ", [$tenantId]);

            $actionBreakdown = [];
            $totalInteractions = 0;
            $uniqueUsers = 0;
            foreach ($interactions as $row) {
                $actionBreakdown[$row->action] = (int) $row->cnt;
                $totalInteractions += (int) $row->cnt;
                $uniqueUsers = max($uniqueUsers, (int) $row->unique_users);
            }

            // Dismissal stats
            $dismissals = DB::selectOne("
                SELECT COUNT(*) AS total, COUNT(DISTINCT user_id) AS users
                FROM match_dismissals
                WHERE tenant_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            ", [$tenantId]);

            // Most clicked content types (from match_history explore source)
            $contentTypes = DB::select("
                SELECT
                    COALESCE(JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.original_action')), action) AS explore_action,
                    COUNT(*) AS cnt
                FROM match_history
                WHERE tenant_id = ?
                    AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.source')) = 'explore'
                    AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                GROUP BY explore_action
                ORDER BY cnt DESC
            ", [$tenantId]);

            // Cache section hit rates
            $cacheSections = [
                'trending_posts', 'popular_listings', 'active_groups', 'upcoming_events',
                'top_contributors', 'trending_hashtags', 'new_members', 'featured_challenges',
                'community_stats', 'trending_blog_posts', 'volunteering', 'organisations',
                'active_polls', 'in_demand_skills', 'featured_resources', 'latest_jobs', 'categories',
            ];
            $cacheStatus = [];
            foreach ($cacheSections as $section) {
                $key = "nexus:explore:{$tenantId}:{$section}";
                $cacheStatus[$section] = Cache::has($key) ? 'hit' : 'miss';
            }

            return [
                'period' => 'last_30_days',
                'total_interactions' => $totalInteractions,
                'unique_users' => $uniqueUsers,
                'action_breakdown' => $actionBreakdown,
                'dismissals' => [
                    'total' => (int) ($dismissals->total ?? 0),
                    'unique_users' => (int) ($dismissals->users ?? 0),
                ],
                'explore_actions' => array_map(fn($r) => [
                    'action' => $r->explore_action,
                    'count' => (int) $r->cnt,
                ], $contentTypes),
                'cache_status' => $cacheStatus,
            ];
        } catch (\Throwable $e) {
            Log::warning('ExploreService::getExploreAnalytics failed', ['error' => $e->getMessage()]);
            return [
                'period' => 'last_30_days',
                'total_interactions' => 0,
                'unique_users' => 0,
                'action_breakdown' => [],
                'dismissals' => ['total' => 0, 'unique_users' => 0],
                'explore_actions' => [],
                'cache_status' => [],
            ];
        }
    }

    // =========================================================================
    // PHASE 6.3 — A/B TESTING SUPPORT
    // =========================================================================

    /**
     * Get the user's A/B test cohort for explore experiments.
     *
     * Assigns users to cohorts deterministically based on user_id % cohort_count.
     * Stores active experiments in Redis for quick lookup.
     *
     * @return array{cohort: string, experiments: array}
     */
    public function getUserExperimentCohort(int $tenantId, int $userId): array
    {
        if ($userId <= 0) {
            return ['cohort' => 'control', 'experiments' => []];
        }

        $cacheKey = "nexus:explore:experiments:{$tenantId}";
        $experiments = Cache::get($cacheKey);

        if ($experiments === null) {
            // Default experiments — can be configured per-tenant
            $experiments = [
                [
                    'id' => 'explore_section_order',
                    'name' => 'Section ordering experiment',
                    'cohorts' => 2, // control vs variant
                    'enabled' => false,
                ],
                [
                    'id' => 'for_you_blend_weights',
                    'name' => 'For You blending weights',
                    'cohorts' => 2,
                    'enabled' => false,
                ],
            ];

            // Check for tenant-specific experiment config
            try {
                $configJson = DB::table('tenants')->where('id', $tenantId)->value('configuration');
                if ($configJson) {
                    $config = json_decode($configJson, true);
                    if (isset($config['experiments']['explore'])) {
                        $experiments = $config['experiments']['explore'];
                    }
                }
            } catch (\Throwable $e) {
                // Use defaults
            }

            Cache::put($cacheKey, $experiments, 3600); // 1h TTL
        }

        // Deterministic cohort assignment based on user_id
        $activeExperiments = [];
        foreach ($experiments as $exp) {
            if (!($exp['enabled'] ?? false)) {
                continue;
            }
            $cohortCount = $exp['cohorts'] ?? 2;
            $cohortIndex = $userId % $cohortCount;
            $activeExperiments[] = [
                'experiment_id' => $exp['id'],
                'cohort' => $cohortIndex === 0 ? 'control' : "variant_{$cohortIndex}",
            ];
        }

        return [
            'cohort' => ($userId % 2 === 0) ? 'A' : 'B', // Global cohort
            'experiments' => $activeExperiments,
        ];
    }

    // =========================================================================
    // PAGINATED ENDPOINTS
    // =========================================================================

    /**
     * Get trending posts with pagination (for "see more" view).
     */
    public function getTrendingPostsPaginated(int $tenantId, int $viewerId, int $page = 1, int $perPage = 20): array
    {
        if ($viewerId <= 0) {
            throw new \InvalidArgumentException('Trending posts require an authenticated user.');
        }

        $offset = ($page - 1) * $perPage;

        try {
            [$visibilitySql, $visibilityBindings] = $this->trendingPostVisibilitySql($tenantId, $viewerId);
            $total = DB::selectOne("
                SELECT COUNT(*) AS cnt
                FROM feed_posts fp
                JOIN users u ON u.id = fp.user_id AND u.tenant_id = ? AND u.status = 'active'
                WHERE fp.tenant_id = ?
                    AND fp.created_at >= DATE_SUB(NOW(), INTERVAL 365 DAY)
                    AND (fp.is_hidden = 0 OR fp.is_hidden IS NULL)
                    AND fp.deleted_at IS NULL
                    AND (fp.publish_status = 'published' OR fp.publish_status IS NULL)
                    AND (fp.scheduled_at IS NULL OR fp.scheduled_at <= NOW())
                    {$visibilitySql}
            ", array_merge([$tenantId, $tenantId], $visibilityBindings));

            $rows = DB::select("
                SELECT
                    fp.id,
                    fp.user_id,
                    LEFT(fp.content, 300) AS excerpt,
                    fp.image_url,
                    fp.created_at,
                    COALESCE(u.first_name, '') AS author_first_name,
                    COALESCE(u.last_name, '') AS author_last_name,
                    u.profile_type AS author_profile_type,
                    u.organization_name AS author_organization_name,
                    u.avatar_url AS author_avatar,
                    (SELECT COUNT(*) FROM likes lk WHERE lk.target_type = 'post' AND lk.target_id = fp.id AND lk.tenant_id = ?) AS likes_count,
                    (SELECT COUNT(*) FROM comments c WHERE c.target_type = 'post' AND c.target_id = fp.id AND c.tenant_id = ?) AS comments_count
                FROM feed_posts fp
                JOIN users u ON u.id = fp.user_id AND u.tenant_id = ? AND u.status = 'active'
                WHERE fp.tenant_id = ?
                    AND fp.created_at >= DATE_SUB(NOW(), INTERVAL 365 DAY)
                    AND (fp.is_hidden = 0 OR fp.is_hidden IS NULL)
                    AND fp.deleted_at IS NULL
                    AND (fp.publish_status = 'published' OR fp.publish_status IS NULL)
                    AND (fp.scheduled_at IS NULL OR fp.scheduled_at <= NOW())
                    {$visibilitySql}
                ORDER BY (
                    (SELECT COUNT(*) FROM likes lk WHERE lk.target_type = 'post' AND lk.target_id = fp.id AND lk.tenant_id = ?)
                    + (SELECT COUNT(*) FROM comments c WHERE c.target_type = 'post' AND c.target_id = fp.id AND c.tenant_id = ?)
                ) DESC, fp.created_at DESC
                LIMIT ? OFFSET ?
            ", array_merge(
                [$tenantId, $tenantId, $tenantId, $tenantId],
                $visibilityBindings,
                [$tenantId, $tenantId, $perPage, $offset]
            ));

            return [
                'items' => array_map(fn($row) => [
                    'id' => $row->id,
                    'user_id' => $row->user_id,
                    'excerpt' => $row->excerpt,
                    'image_url' => $row->image_url,
                    'created_at' => $row->created_at,
                    'author_name' => UserDisplayName::resolvePrefixed($row, 'author_'),
                    'author_avatar' => $row->author_avatar,
                    'likes_count' => (int) $row->likes_count,
                    'comments_count' => (int) $row->comments_count,
                ], $rows),
                'total' => (int) ($total->cnt ?? 0),
                'page' => $page,
                'per_page' => $perPage,
            ];
        } catch (\Throwable $e) {
            Log::warning('ExploreService::getTrendingPostsPaginated failed', ['error' => $e->getMessage()]);
            return ['items' => [], 'total' => 0, 'page' => $page, 'per_page' => $perPage];
        }
    }

    /**
     * Get popular listings with pagination.
     */
    public function getPopularListingsPaginated(int $tenantId, int $page = 1, int $perPage = 20): array
    {
        $offset = ($page - 1) * $perPage;

        try {
            $total = DB::selectOne(
                "SELECT COUNT(*) AS cnt FROM listings WHERE tenant_id = ? AND status = 'active'",
                [$tenantId]
            );

            $rows = DB::select("
                SELECT
                    l.id,
                    l.title,
                    l.type,
                    l.description,
                    l.image_url,
                    l.location,
                    l.hours_estimate AS estimated_hours,
                    l.created_at,
                    COALESCE(l.view_count, 0) AS view_count,
                    COALESCE(l.save_count, 0) AS save_count,
                    COALESCE(cat.name, '') AS category_name,
                    COALESCE(cat.slug, '') AS category_slug,
                    cat.color AS category_color,
                    COALESCE(u.first_name, '') AS author_first_name,
                    COALESCE(u.last_name, '') AS author_last_name,
                    u.profile_type AS author_profile_type,
                    u.organization_name AS author_organization_name,
                    u.avatar_url AS author_avatar
                FROM listings l
                LEFT JOIN categories cat ON cat.id = l.category_id
                JOIN users u ON u.id = l.user_id AND u.tenant_id = ? AND u.status = 'active'
                WHERE l.tenant_id = ?
                    AND l.status = 'active'
                ORDER BY (COALESCE(l.view_count, 0) + COALESCE(l.save_count, 0)) DESC
                LIMIT ? OFFSET ?
            ", [$tenantId, $tenantId, $perPage, $offset]);

            return [
                'items' => array_map(fn($row) => [
                    'id' => $row->id,
                    'title' => $row->title,
                    'type' => $row->type,
                    'description' => $row->description ? mb_substr($row->description, 0, 200) : null,
                    'image_url' => $row->image_url,
                    'location' => $row->location,
                    'estimated_hours' => $row->estimated_hours,
                    'created_at' => $row->created_at,
                    'view_count' => (int) $row->view_count,
                    'save_count' => (int) $row->save_count,
                    'category_name' => $row->category_name,
                    'category_slug' => $row->category_slug,
                    'category_color' => $row->category_color,
                    'author_name' => UserDisplayName::resolvePrefixed($row, 'author_'),
                    'author_avatar' => $row->author_avatar,
                ], $rows),
                'total' => (int) ($total->cnt ?? 0),
                'page' => $page,
                'per_page' => $perPage,
            ];
        } catch (\Throwable $e) {
            Log::warning('ExploreService::getPopularListingsPaginated failed', ['error' => $e->getMessage()]);
            return ['items' => [], 'total' => 0, 'page' => $page, 'per_page' => $perPage];
        }
    }

    /**
     * Browse listings by category slug.
     */
    public function getListingsByCategory(int $tenantId, string $slug, int $page = 1, int $perPage = 20): array
    {
        $offset = ($page - 1) * $perPage;

        try {
            $category = DB::selectOne(
                "SELECT id, name, slug, color FROM categories WHERE tenant_id = ? AND slug = ?",
                [$tenantId, $slug]
            );

            if (!$category) {
                return ['items' => [], 'total' => 0, 'page' => $page, 'per_page' => $perPage, 'category' => null];
            }

            $total = DB::selectOne(
                "SELECT COUNT(*) AS cnt FROM listings WHERE tenant_id = ? AND category_id = ? AND status = 'active'",
                [$tenantId, $category->id]
            );

            $rows = DB::select("
                SELECT
                    l.id,
                    l.title,
                    l.type,
                    l.description,
                    l.image_url,
                    l.location,
                    l.hours_estimate AS estimated_hours,
                    l.created_at,
                    COALESCE(l.view_count, 0) AS view_count,
                    COALESCE(u.first_name, '') AS author_first_name,
                    COALESCE(u.last_name, '') AS author_last_name,
                    u.profile_type AS author_profile_type,
                    u.organization_name AS author_organization_name,
                    u.avatar_url AS author_avatar
                FROM listings l
                JOIN users u ON u.id = l.user_id AND u.tenant_id = ? AND u.status = 'active'
                WHERE l.tenant_id = ?
                    AND l.category_id = ?
                    AND l.status = 'active'
                ORDER BY l.created_at DESC
                LIMIT ? OFFSET ?
            ", [$tenantId, $tenantId, $category->id, $perPage, $offset]);

            return [
                'items' => array_map(fn($row) => [
                    'id' => $row->id,
                    'title' => $row->title,
                    'type' => $row->type,
                    'description' => $row->description ? mb_substr($row->description, 0, 200) : null,
                    'image_url' => $row->image_url,
                    'location' => $row->location,
                    'estimated_hours' => $row->estimated_hours,
                    'created_at' => $row->created_at,
                    'view_count' => (int) $row->view_count,
                    'author_name' => UserDisplayName::resolvePrefixed($row, 'author_'),
                    'author_avatar' => $row->author_avatar,
                ], $rows),
                'total' => (int) ($total->cnt ?? 0),
                'page' => $page,
                'per_page' => $perPage,
                'category' => [
                    'id' => $category->id,
                    'name' => $category->name,
                    'slug' => $category->slug,
                    'color' => $category->color,
                ],
            ];
        } catch (\Throwable $e) {
            Log::warning('ExploreService::getListingsByCategory failed', ['error' => $e->getMessage()]);
            return ['items' => [], 'total' => 0, 'page' => $page, 'per_page' => $perPage, 'category' => null];
        }
    }
}
