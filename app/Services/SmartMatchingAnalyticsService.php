<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * SmartMatchingAnalyticsService — Analytics and reporting for the smart matching engine.
 *
 * Provides score/distance distributions, overall stats, and the per-member and
 * per-listing diagnosis the platform team's Matching diagnostic page shows, by
 * querying the match_cache, match_dismissals, match_preferences and
 * match_approvals tables.
 *
 * Two rules hold for every query in this class:
 *  - it is scoped to the current community (`tenant_id = ?`), and
 *  - a `match_cache` row only counts while it is unexpired
 *    (`expires_at > NOW()`). The nightly clean-up deletes expired rows, so
 *    between runs an expired row is a match the engine no longer stands
 *    behind; counting it made every figure drift upwards during the day.
 */
class SmartMatchingAnalyticsService
{
    /** A cached match counts only while this holds. Always ANDed after the tenant scope. */
    private const LIVE = 'expires_at > NOW()';

    /**
     * Stored matches that are still matches: live, and not hidden by the
     * member. The totals, averages and breakdowns used LIVE alone, so a
     * match a member had hidden went on being counted as one of theirs.
     * (The funnel's own "dismissed" figure still reads LIVE.)
     */
    private const SHOWN = "expires_at > NOW() AND (status IS NULL OR status <> 'dismissed')";

    /**
     * Score buckets as half-open ranges [min, max): every score from 0 to 100
     * lands in exactly one. Until November 2026 the bounds were whole numbers
     * compared with >= and <= ("0-20", "21-40", …) against a DECIMAL(5,2)
     * column, so a score of 40.70 was counted nowhere. The keys are what the
     * analytics screen looks its labels up by — change them in both places.
     */
    public const SCORE_BUCKETS = ['0-20', '20-40', '40-60', '60-80', '80-100'];

    /** Distance buckets in km, half-open [min, max); `unknown` = no distance stored. */
    public const DISTANCE_BUCKETS = ['0-5', '5-15', '15-30', '30-50', '50+', 'unknown'];

    public function __construct()
    {
    }

    /**
     * Get a dashboard summary of matching metrics.
     */
    public function getDashboardSummary(): array
    {
        try {
            $stats = $this->getOverallStats();
            $funnel = $this->getConversionFunnel();

            return [
                'overview' => $stats,
                'conversion' => $funnel,
                'period' => 'last_30_days',
            ];
        } catch (\Exception $e) {
            Log::error('[MatchingAnalytics] getDashboardSummary failed', ['error' => $e->getMessage()]);
            throw $e;
        }
    }

    /**
     * Get overall matching statistics for the current community.
     *
     * @param float $hotThreshold The community's configured "hot match" score
     *        (SmartMatchingEngine config `hot_match_threshold`). It was
     *        hard-coded to 80 here, so the "hot matches" figure ignored the
     *        setting on the configuration screen.
     */
    public function getOverallStats(float $hotThreshold = 80.0): array
    {
        $tenantId = TenantContext::getId();

        try {
            // One pass over the community's live rows. "Today / this week /
            // this month" count rows first cached in that calendar window
            // (weeks start on Monday); a re-warm refreshes a row's expiry but
            // not its created_at, so these are new matches, not re-checks.
            $row = DB::selectOne(
                "SELECT COUNT(*) AS total,
                        COALESCE(SUM(created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')), 0) AS month_cnt,
                        COALESCE(SUM(created_at >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)), 0) AS week_cnt,
                        COALESCE(SUM(created_at >= CURDATE()), 0) AS today_cnt,
                        AVG(match_score) AS avg_score,
                        AVG(distance_km) AS avg_dist,
                        COUNT(DISTINCT user_id) AS users_cnt,
                        COALESCE(SUM(match_score >= ?), 0) AS hot_cnt,
                        COALESCE(SUM(match_type = 'mutual'), 0) AS mutual_cnt
                 FROM match_cache
                 WHERE tenant_id = ? AND " . self::SHOWN,
                [$hotThreshold, $tenantId]
            );

            // Match type breakdown
            $typeBreakdown = DB::select(
                "SELECT match_type, COUNT(*) as cnt FROM match_cache
                 WHERE tenant_id = ? AND " . self::SHOWN . " GROUP BY match_type",
                [$tenantId]
            );
            $types = [];
            foreach ($typeBreakdown as $typeRow) {
                $types[(string) $typeRow->match_type] = (int) $typeRow->cnt;
            }

            return [
                'total_cached_matches' => (int) ($row->total ?? 0),
                'total_matches_month' => (int) ($row->month_cnt ?? 0),
                'total_matches_week' => (int) ($row->week_cnt ?? 0),
                'total_matches_today' => (int) ($row->today_cnt ?? 0),
                'average_score' => round((float) ($row->avg_score ?? 0), 1),
                'average_distance_km' => round((float) ($row->avg_dist ?? 0), 1),
                'match_type_breakdown' => $types,
                'active_users_with_matches' => (int) ($row->users_cnt ?? 0),
                'hot_matches' => (int) ($row->hot_cnt ?? 0),
                'hot_match_threshold' => $hotThreshold,
                'mutual_matches_count' => (int) ($row->mutual_cnt ?? 0),
            ];
        } catch (\Exception $e) {
            Log::error('[MatchingAnalytics] getOverallStats failed', ['error' => $e->getMessage()]);
            throw $e;
        }
    }

    /**
     * Get score distribution (bucketed into the SCORE_BUCKETS ranges).
     *
     * @return list<array{range: string, count: int}>
     */
    public function getScoreDistribution(): array
    {
        $tenantId = TenantContext::getId();

        try {
            // Half-open ranges; the top one is closed so a perfect 100 counts.
            $row = DB::selectOne(
                "SELECT COALESCE(SUM(match_score < 20), 0) AS b0,
                        COALESCE(SUM(match_score >= 20 AND match_score < 40), 0) AS b1,
                        COALESCE(SUM(match_score >= 40 AND match_score < 60), 0) AS b2,
                        COALESCE(SUM(match_score >= 60 AND match_score < 80), 0) AS b3,
                        COALESCE(SUM(match_score >= 80), 0) AS b4
                 FROM match_cache
                 WHERE tenant_id = ? AND " . self::SHOWN,
                [$tenantId]
            );

            $distribution = [];
            foreach (self::SCORE_BUCKETS as $index => $label) {
                $distribution[] = [
                    'range' => $label,
                    'count' => (int) ($row->{'b' . $index} ?? 0),
                ];
            }

            return $distribution;
        } catch (\Exception $e) {
            Log::error('[MatchingAnalytics] getScoreDistribution failed', ['error' => $e->getMessage()]);
            throw $e;
        }
    }

    /**
     * Get distance distribution (bucketed into the DISTANCE_BUCKETS ranges).
     * The `unknown` bucket (remote listings, or a pair with no coordinates) is
     * only included when it is not empty.
     *
     * @return list<array{range: string, count: int}>
     */
    public function getDistanceDistribution(): array
    {
        $tenantId = TenantContext::getId();

        try {
            $row = DB::selectOne(
                "SELECT COALESCE(SUM(distance_km < 5), 0) AS b0,
                        COALESCE(SUM(distance_km >= 5 AND distance_km < 15), 0) AS b1,
                        COALESCE(SUM(distance_km >= 15 AND distance_km < 30), 0) AS b2,
                        COALESCE(SUM(distance_km >= 30 AND distance_km < 50), 0) AS b3,
                        COALESCE(SUM(distance_km >= 50), 0) AS b4,
                        COALESCE(SUM(distance_km IS NULL), 0) AS b5
                 FROM match_cache
                 WHERE tenant_id = ? AND " . self::SHOWN,
                [$tenantId]
            );

            $distribution = [];
            foreach (self::DISTANCE_BUCKETS as $index => $label) {
                $count = (int) ($row->{'b' . $index} ?? 0);
                if ($label === 'unknown' && $count === 0) {
                    continue;
                }
                $distribution[] = ['range' => $label, 'count' => $count];
            }

            return $distribution;
        } catch (\Exception $e) {
            Log::error('[MatchingAnalytics] getDistanceDistribution failed', ['error' => $e->getMessage()]);
            throw $e;
        }
    }

    /**
     * Gate impact + data-readiness metrics for the hard-gate era: how many
     * members/listings the geo gates can actually work with, how many members
     * sit in degraded (no-coordinates) mode, feedback-reason mix, and the
     * engine-version mix of the current cache.
     */
    public function getGateImpact(): array
    {
        $tenantId = TenantContext::getId();

        $result = [
            'degraded_users_count' => 0,
            'active_users_count' => 0,
            'listings_without_coords' => 0,
            'remote_listings_count' => 0,
            'active_listings_count' => 0,
            'dismiss_reasons' => [],
            'algorithm_version_mix' => [],
        ];

        try {
            $result['degraded_users_count'] = (int) (DB::selectOne(
                "SELECT COUNT(*) as cnt FROM users
                 WHERE tenant_id = ? AND status = 'active'
                   AND (latitude IS NULL OR latitude = 0 OR longitude IS NULL OR longitude = 0)",
                [$tenantId]
            )->cnt ?? 0);
            $result['active_users_count'] = (int) (DB::selectOne(
                "SELECT COUNT(*) as cnt FROM users WHERE tenant_id = ? AND status = 'active'",
                [$tenantId]
            )->cnt ?? 0);

            $result['listings_without_coords'] = (int) (DB::selectOne(
                "SELECT COUNT(*) as cnt FROM listings l
                 JOIN users u ON l.user_id = u.id AND u.tenant_id = l.tenant_id
                 WHERE l.tenant_id = ? AND l.status = 'active'
                   AND l.service_type IN ('physical_only', 'location_dependent')
                   AND COALESCE(l.latitude, NULLIF(u.latitude, 0)) IS NULL",
                [$tenantId]
            )->cnt ?? 0);
            $result['remote_listings_count'] = (int) (DB::selectOne(
                "SELECT COUNT(*) as cnt FROM listings
                 WHERE tenant_id = ? AND status = 'active' AND service_type IN ('remote_only', 'hybrid')",
                [$tenantId]
            )->cnt ?? 0);
            $result['active_listings_count'] = (int) (DB::selectOne(
                "SELECT COUNT(*) as cnt FROM listings WHERE tenant_id = ? AND status = 'active'",
                [$tenantId]
            )->cnt ?? 0);
        } catch (\Exception $e) {
            Log::error('[MatchingAnalytics] getGateImpact user/listing counts failed', ['error' => $e->getMessage()]);
            throw $e;
        }

        try {
            $reasons = DB::select(
                "SELECT COALESCE(reason, 'other') as reason, COUNT(*) as cnt
                 FROM match_dismissals WHERE tenant_id = ?
                 GROUP BY COALESCE(reason, 'other') ORDER BY cnt DESC",
                [$tenantId]
            );
            foreach ($reasons as $row) {
                $result['dismiss_reasons'][(string) $row->reason] = (int) $row->cnt;
            }
        } catch (\Exception $e) {
            Log::error('[MatchingAnalytics] getGateImpact dismiss reasons failed', ['error' => $e->getMessage()]);
            throw $e;
        }

        try {
            $versions = DB::select(
                "SELECT algorithm_version, COUNT(*) as cnt FROM match_cache
                 WHERE tenant_id = ? AND " . self::SHOWN . " GROUP BY algorithm_version",
                [$tenantId]
            );
            foreach ($versions as $row) {
                $result['algorithm_version_mix'][(string) $row->algorithm_version] = (int) $row->cnt;
            }
        } catch (\Exception $e) {
            Log::error('[MatchingAnalytics] getGateImpact algorithm versions failed', ['error' => $e->getMessage()]);
            throw $e;
        }

        return $result;
    }

    /**
     * Average pillar values across the cached v2 matches (parsed from
     * score_breakdown JSON). Sampled at up to 2000 recent rows to bound cost.
     */
    public function getPillarAverages(): array
    {
        $tenantId = TenantContext::getId();
        $sums = ['relevance' => 0.0, 'feasibility' => 0.0, 'trust' => 0.0];
        $count = 0;

        try {
            $rows = DB::select(
                "SELECT score_breakdown FROM match_cache
                 WHERE tenant_id = ? AND " . self::SHOWN . " AND score_breakdown IS NOT NULL
                 ORDER BY created_at DESC LIMIT 2000",
                [$tenantId]
            );

            foreach ($rows as $row) {
                $decoded = json_decode((string) $row->score_breakdown, true);
                if (!is_array($decoded) || !isset($decoded['pillars'])) {
                    continue;
                }
                foreach ($sums as $pillar => $_) {
                    if (isset($decoded['pillars'][$pillar]) && is_numeric($decoded['pillars'][$pillar])) {
                        $sums[$pillar] += (float) $decoded['pillars'][$pillar];
                    }
                }
                $count++;
            }
        } catch (\Exception $e) {
            Log::error('[MatchingAnalytics] getPillarAverages failed', ['error' => $e->getMessage()]);
            throw $e;
        }

        if ($count === 0) {
            return ['sample_size' => 0, 'pillars' => []];
        }

        return [
            'sample_size' => $count,
            'pillars' => array_map(fn ($sum) => round($sum / $count, 3), $sums),
        ];
    }

    /**
     * Get the match conversion funnel (generated -> viewed -> contacted -> completed).
     *
     * Only `new` and (since November 2026) `dismissed` are ever written to
     * match_cache.status: nothing records viewed / contacted / saved, so those
     * three and `conversion_rate` are always 0. No matching screen shows them.
     */
    public function getConversionFunnel(): array
    {
        $tenantId = TenantContext::getId();

        try {
            $total = (int) (DB::selectOne(
                "SELECT COUNT(*) as cnt FROM match_cache WHERE tenant_id = ? AND " . self::LIVE,
                [$tenantId]
            )->cnt ?? 0);

            $viewed = (int) (DB::selectOne(
                "SELECT COUNT(*) as cnt FROM match_cache
                 WHERE tenant_id = ? AND " . self::LIVE . " AND status IN ('viewed', 'contacted', 'saved')",
                [$tenantId]
            )->cnt ?? 0);

            $contacted = (int) (DB::selectOne(
                "SELECT COUNT(*) as cnt FROM match_cache
                 WHERE tenant_id = ? AND " . self::LIVE . " AND status = 'contacted'",
                [$tenantId]
            )->cnt ?? 0);

            $saved = (int) (DB::selectOne(
                "SELECT COUNT(*) as cnt FROM match_cache
                 WHERE tenant_id = ? AND " . self::LIVE . " AND status = 'saved'",
                [$tenantId]
            )->cnt ?? 0);

            $dismissed = (int) (DB::selectOne(
                "SELECT COUNT(*) as cnt FROM match_cache
                 WHERE tenant_id = ? AND " . self::LIVE . " AND status = 'dismissed'",
                [$tenantId]
            )->cnt ?? 0);

            $conversionRate = $total > 0 ? round(($contacted / $total) * 100, 1) : 0;

            return [
                'total_generated' => $total,
                'viewed' => $viewed,
                'contacted' => $contacted,
                'saved' => $saved,
                'dismissed' => $dismissed,
                'conversion_rate' => $conversionRate,
            ];
        } catch (\Exception $e) {
            Log::error('[MatchingAnalytics] getConversionFunnel failed', ['error' => $e->getMessage()]);
            throw $e;
        }
    }

    // =========================================================================
    // DIAGNOSIS — plain facts about one member or one listing
    // =========================================================================

    /**
     * Why does this member get (or not get) matches? Plain facts only; the
     * caller adds the community's settings and turns them into findings.
     *
     * Returns null when the member is not in the current community, so the
     * endpoint can answer 404 without revealing that the id exists elsewhere.
     *
     * @return array<string, mixed>|null
     */
    public function diagnoseUser(int $userId): ?array
    {
        $tenantId = TenantContext::getId();

        $user = DB::selectOne(
            "SELECT id, status, is_approved, latitude, longitude, last_active_at, last_login_at,
                    TIMESTAMPDIFF(DAY, last_active_at, NOW()) AS days_since_active,
                    TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))) AS full_name
             FROM users WHERE id = ? AND tenant_id = ?",
            [$userId, $tenantId]
        );
        if (!$user) {
            return null;
        }

        // Active listings: the engine matches on these (SmartMatchingEngine
        // reads status = 'active' and nothing else about the listing).
        $listingRows = DB::select(
            "SELECT l.type, c.name AS category_name, COUNT(*) AS cnt,
                    COALESCE(SUM(l.moderation_status IN ('pending_review', 'rejected')), 0) AS not_approved_cnt
             FROM listings l
             LEFT JOIN categories c ON c.id = l.category_id AND c.tenant_id = l.tenant_id
             WHERE l.user_id = ? AND l.tenant_id = ? AND l.status = 'active'
             GROUP BY l.type, c.name
             ORDER BY cnt DESC, l.type ASC",
            [$userId, $tenantId]
        );
        $byType = [];
        $byCategory = [];
        $activeListings = 0;
        $notApproved = 0;
        foreach ($listingRows as $row) {
            $count = (int) $row->cnt;
            $type = (string) $row->type;
            $activeListings += $count;
            $notApproved += (int) $row->not_approved_cnt;
            $byType[$type] = ($byType[$type] ?? 0) + $count;
            $byCategory[] = [
                'type' => $type,
                'category_name' => $row->category_name !== null ? (string) $row->category_name : null,
                'count' => $count,
            ];
        }

        $prefs = DB::selectOne(
            "SELECT matching_paused, min_match_score, max_distance_km, notification_frequency
             FROM match_preferences WHERE user_id = ? AND tenant_id = ?",
            [$userId, $tenantId]
        );

        $cache = DB::selectOne(
            "SELECT COUNT(*) AS cnt, MAX(match_score) AS best
             FROM match_cache WHERE user_id = ? AND tenant_id = ? AND " . self::SHOWN,
            [$userId, $tenantId]
        );

        $dismissals = DB::selectOne(
            "SELECT COUNT(*) AS cnt,
                    COALESCE(SUM(created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)), 0) AS recent_cnt
             FROM match_dismissals WHERE user_id = ? AND tenant_id = ?",
            [$userId, $tenantId]
        );

        $held = DB::selectOne(
            "SELECT COUNT(*) AS cnt FROM match_approvals
             WHERE user_id = ? AND tenant_id = ? AND status = 'pending'",
            [$userId, $tenantId]
        );

        return [
            'member' => [
                'id' => (int) $user->id,
                'name' => (string) $user->full_name,
                'status' => (string) $user->status,
                'is_approved' => (bool) $user->is_approved,
                'has_coordinates' => self::hasCoordinates($user->latitude, $user->longitude),
                'last_active_at' => $user->last_active_at,
                'days_since_active' => $user->days_since_active !== null ? (int) $user->days_since_active : null,
                'last_login_at' => $user->last_login_at,
            ],
            'listings' => [
                'active_count' => $activeListings,
                'awaiting_or_refused_review_count' => $notApproved,
                // Cast so an empty map is `{}` on the wire, not `[]`.
                'by_type' => (object) $byType,
                'by_category' => $byCategory,
            ],
            'preferences' => [
                'has_saved_preferences' => $prefs !== null,
                'matching_paused' => $prefs !== null && (bool) $prefs->matching_paused,
                'min_match_score' => $prefs !== null && $prefs->min_match_score !== null ? (int) $prefs->min_match_score : null,
                'max_distance_km' => $prefs !== null && $prefs->max_distance_km !== null ? (int) $prefs->max_distance_km : null,
                'notification_frequency' => $prefs !== null ? $prefs->notification_frequency : null,
            ],
            'cache' => [
                'cached_matches' => (int) ($cache->cnt ?? 0),
                'best_score' => ($cache->best ?? null) !== null ? round((float) $cache->best, 2) : null,
            ],
            'dismissals' => [
                'total' => (int) ($dismissals->cnt ?? 0),
                'last_90_days' => (int) ($dismissals->recent_cnt ?? 0),
            ],
            'held_for_approval_count' => (int) ($held->cnt ?? 0),
        ];
    }

    /**
     * Why is this listing (not) being offered to members as a match? Plain
     * facts only. Null when the listing is not in the current community.
     *
     * @return array<string, mixed>|null
     */
    public function diagnoseListing(int $listingId): ?array
    {
        $tenantId = TenantContext::getId();

        $listing = DB::selectOne(
            "SELECT l.id, l.title, l.status, l.moderation_status, l.type, l.service_type,
                    l.latitude, l.longitude, l.created_at, l.user_id,
                    c.name AS category_name,
                    u.status AS owner_status, u.last_active_at AS owner_last_active_at,
                    TIMESTAMPDIFF(DAY, u.last_active_at, NOW()) AS owner_days_since_active,
                    u.latitude AS owner_latitude, u.longitude AS owner_longitude,
                    TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS owner_name
             FROM listings l
             JOIN users u ON u.id = l.user_id AND u.tenant_id = l.tenant_id
             LEFT JOIN categories c ON c.id = l.category_id AND c.tenant_id = l.tenant_id
             WHERE l.id = ? AND l.tenant_id = ?",
            [$listingId, $tenantId]
        );
        if (!$listing) {
            return null;
        }

        $cache = DB::selectOne(
            "SELECT COUNT(DISTINCT user_id) AS cnt, MAX(match_score) AS best
             FROM match_cache WHERE listing_id = ? AND tenant_id = ? AND " . self::SHOWN,
            [$listingId, $tenantId]
        );

        $dismissals = DB::selectOne(
            "SELECT COUNT(*) AS cnt FROM match_dismissals WHERE listing_id = ? AND tenant_id = ?",
            [$listingId, $tenantId]
        );

        return [
            'listing' => [
                'id' => (int) $listing->id,
                'title' => (string) $listing->title,
                'status' => (string) $listing->status,
                'moderation_status' => $listing->moderation_status !== null ? (string) $listing->moderation_status : null,
                'type' => (string) $listing->type,
                'category_name' => $listing->category_name !== null ? (string) $listing->category_name : null,
                'service_type' => (string) $listing->service_type,
                'has_coordinates' => self::hasCoordinates($listing->latitude, $listing->longitude),
                'created_at' => $listing->created_at,
            ],
            'owner' => [
                'id' => (int) $listing->user_id,
                'name' => (string) $listing->owner_name,
                'status' => (string) $listing->owner_status,
                'has_coordinates' => self::hasCoordinates($listing->owner_latitude, $listing->owner_longitude),
                'last_active_at' => $listing->owner_last_active_at,
                'days_since_active' => $listing->owner_days_since_active !== null
                    ? (int) $listing->owner_days_since_active : null,
            ],
            'cache' => [
                'members_cached' => (int) ($cache->cnt ?? 0),
                'best_score' => ($cache->best ?? null) !== null ? round((float) $cache->best, 2) : null,
            ],
            'dismissals' => [
                'total' => (int) ($dismissals->cnt ?? 0),
            ],
        ];
    }

    /** Same test the engine uses: a 0/0 or missing pair is "no location". */
    private static function hasCoordinates(mixed $latitude, mixed $longitude): bool
    {
        return $latitude !== null && $longitude !== null
            && (float) $latitude !== 0.0 && (float) $longitude !== 0.0;
    }
}
