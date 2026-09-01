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

/**
 * FeedRankingService — Full EdgeRank Algorithm (15-Signal Pipeline)
 *
 * Implements a complete EdgeRank-style feed ranking with 15 weighted signals:
 *  1. Time Decay        — Hacker News-style freshness decay (72h half-life)
 *  2. Engagement        — Log-scaled likes + comments
 *  3. Engagement Velocity — Trending detection (rapid engagement in 2h window)
 *  4. Content Type      — Community actions rank above passive content
 *  5. Social Affinity   — Interaction-based relationship scoring
 *  6. Creator Vitality  — Poster's recent activity level
 *  7. Geo Decay         — Haversine distance-based decay
 *  8. Content Quality   — Images, video, hashtags, @mentions, length
 *  9. Context Timing    — Time-of-day / day-of-week boosts
 * 10. Conversation Depth — Threaded discussion depth boost
 * 11. Reaction Weighting — Emoji reaction type weights
 * 12. Negative Signals  — Hidden posts, muted users, reports
 * 13. CTR Feedback      — Click-through rate with confidence gating
 * 14. User Type Prefs   — Per-user content type personalization
 * 15. Save/Bookmark     — Interest graph from saved content
 *
 * Post-sort: User diversity + Content-type diversity reordering.
 *
 * Uses raw DB:: queries for performance on the complex 15-signal pipeline.
 */
class FeedRankingService
{
    // Public signal constants (used by tests)
    public const LIKE_WEIGHT = 1;
    public const COMMENT_WEIGHT = 5;
    public const SHARE_WEIGHT = 8;

    public const FRESHNESS_FULL_HOURS = 24;
    public const FRESHNESS_HALF_LIFE_HOURS = 72;
    public const FRESHNESS_MINIMUM = 0.3;

    public const GEO_FULL_SCORE_RADIUS = 50;
    public const GEO_DECAY_INTERVAL = 100;
    public const GEO_DECAY_PER_INTERVAL = 0.03;
    public const GEO_MINIMUM_SCORE = 0.15;
    /**
     * Exponential decay lambda: score = exp(-lambda * distanceKm).
     * lambda = 0.003 gives ~0.5 score at 231 km, floors at GEO_MINIMUM_SCORE.
     */
    public const GEO_DECAY_LAMBDA = 0.003;

    public const VITALITY_FULL_THRESHOLD = 7;
    public const VITALITY_DECAY_THRESHOLD = 30;
    public const VITALITY_MINIMUM = 0.5;

    public const SOCIAL_GRAPH_ENABLED = true;
    public const SOCIAL_GRAPH_MAX_BOOST = 2.0;
    public const SOCIAL_GRAPH_INTERACTION_DAYS = 90;
    public const SOCIAL_GRAPH_FOLLOWER_BOOST = 1.5;

    public const NEGATIVE_SIGNALS_ENABLED = true;
    public const HIDE_PENALTY = 0.0;
    public const MUTE_PENALTY = 0.1;
    public const BLOCK_PENALTY = 0.0;
    public const REPORT_PENALTY_PER = 0.15;

    public const VELOCITY_ENABLED = true;
    public const VELOCITY_WINDOW_HOURS = 2;
    public const VELOCITY_THRESHOLD = 3;
    public const VELOCITY_MAX_BOOST = 1.8;
    public const VELOCITY_DECAY_HOURS = 6;

    public const CONVERSATION_DEPTH_ENABLED = true;
    public const CONVERSATION_DEPTH_MAX_BOOST = 1.5;
    public const CONVERSATION_DEPTH_THRESHOLD = 3;

    public const DIVERSITY_ENABLED = true;
    public const DIVERSITY_MAX_CONSECUTIVE = 2;
    public const DIVERSITY_PENALTY = 0.5;
    public const DIVERSITY_TYPE_ENABLED = true;
    public const DIVERSITY_TYPE_MAX_CONSECUTIVE = 3;

    public const QUALITY_ENABLED = true;
    public const QUALITY_IMAGE_BOOST = 1.3;
    public const QUALITY_LINK_BOOST = 1.1;
    public const QUALITY_LENGTH_MIN = 50;
    public const QUALITY_LENGTH_BONUS = 1.2;
    public const QUALITY_VIDEO_BOOST = 1.4;
    public const QUALITY_HASHTAG_BOOST = 1.1;
    public const QUALITY_MENTION_BOOST = 1.15;

    public const CTR_ENABLED = true;
    public const CTR_MAX_BOOST = 1.5;
    public const CTR_MIN_IMPRESSIONS = 5;

    public const USER_TYPE_PREFS_ENABLED = true;
    public const USER_TYPE_PREFS_MAX_BOOST = 1.4;
    public const USER_TYPE_PREFS_LOOKBACK_DAYS = 30;

    public const SAVE_SIGNAL_ENABLED = true;
    public const SAVE_SIGNAL_MAX_BOOST = 1.35;
    public const SAVE_SIGNAL_MIN_SAVES = 2;

    public const REACTION_WEIGHTS = [
        'love' => 2.0, 'celebrate' => 1.8, 'insightful' => 1.5,
        'like' => 1.0, 'curious' => 0.8, 'sad' => 0.6, 'angry' => 0.5,
    ];

    /**
     * Map raw Unicode emoji (stored in reactions.emoji) to named reaction types
     * that match the keys in REACTION_WEIGHTS.
     */
    public const EMOJI_REACTION_MAP = [
        '❤️' => 'love',
        '❤'  => 'love',   // bare heart without variation selector
        '👍' => 'like',
        '😮' => 'curious',
        '😢' => 'sad',
        '😠' => 'angry',
        '🎉' => 'celebrate',
        '💡' => 'insightful',
        '🤔' => 'curious',
    ];

    /** CTR neutral baseline — real feed CTR is 1–3%, not 10% */
    public const CTR_NEUTRAL_BASELINE = 0.02;

    // View/click tracking
    private const VIEW_TRACKING_ENABLED = true;
    private const CLICK_TRACKING_ENABLED = true;

    private ?array $config = null;
    /** @var array<int, int> */
    private array $mutedUserSet = [];

    /**
     * Per-request, per-tenant config cache. getConfig() is called from inside
     * tight scoring loops — without this, every post scored re-queries the
     * tenants table.
     *
     * @var array<int, array>
     */
    private static array $configCacheByTenant = [];

    /**
     * Tracks which tenant last populated $configCacheByTenant so we can
     * detect a tenant switch (e.g. in Octane/queue workers) and flush
     * stale config before it bleeds across tenants.
     */
    private static ?int $lastRequestTenantId = null;

    public function __construct()
    {
    }

    // =========================================================================
    // CONFIG
    // =========================================================================

    public static function getConfig(): array
    {
        // Per-request memoization keyed by tenant — avoids repeated DB hits
        // from inside scoring loops (called once per post).
        try {
            $tenantIdForCache = TenantContext::getId();
            // H1: Detect tenant switch (Octane / queue workers) and flush stale cache
            if (self::$lastRequestTenantId !== null && self::$lastRequestTenantId !== $tenantIdForCache) {
                self::$configCacheByTenant = [];
            }
            self::$lastRequestTenantId = $tenantIdForCache;
            if ($tenantIdForCache !== null && isset(self::$configCacheByTenant[$tenantIdForCache])) {
                return self::$configCacheByTenant[$tenantIdForCache];
            }
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('FeedRankingService: TenantContext unavailable, skipping per-request cache', [
                'error' => $e->getMessage(),
            ]);
            $tenantIdForCache = null;
        }

        $defaults = [
            'enabled' => true,
            'like_weight' => self::LIKE_WEIGHT, 'comment_weight' => self::COMMENT_WEIGHT, 'share_weight' => self::SHARE_WEIGHT,
            'vitality_full_days' => self::VITALITY_FULL_THRESHOLD, 'vitality_decay_days' => self::VITALITY_DECAY_THRESHOLD, 'vitality_minimum' => self::VITALITY_MINIMUM,
            'geo_full_radius' => self::GEO_FULL_SCORE_RADIUS, 'geo_decay_interval' => self::GEO_DECAY_INTERVAL,
            'geo_decay_rate' => self::GEO_DECAY_PER_INTERVAL, 'geo_minimum' => self::GEO_MINIMUM_SCORE,
            'freshness_enabled' => true, 'freshness_full_hours' => self::FRESHNESS_FULL_HOURS,
            'freshness_half_life' => self::FRESHNESS_HALF_LIFE_HOURS, 'freshness_minimum' => self::FRESHNESS_MINIMUM, 'freshness_gravity' => 1.0,
            'social_graph_enabled' => self::SOCIAL_GRAPH_ENABLED, 'social_graph_max_boost' => self::SOCIAL_GRAPH_MAX_BOOST,
            'social_graph_lookback_days' => self::SOCIAL_GRAPH_INTERACTION_DAYS, 'social_graph_follower_boost' => self::SOCIAL_GRAPH_FOLLOWER_BOOST,
            'negative_signals_enabled' => self::NEGATIVE_SIGNALS_ENABLED,
            'hide_penalty' => self::HIDE_PENALTY, 'mute_penalty' => self::MUTE_PENALTY, 'block_penalty' => self::BLOCK_PENALTY,
            'report_penalty_per' => self::REPORT_PENALTY_PER,
            'quality_enabled' => self::QUALITY_ENABLED,
            'quality_image_boost' => self::QUALITY_IMAGE_BOOST, 'quality_link_boost' => self::QUALITY_LINK_BOOST,
            'quality_length_min' => self::QUALITY_LENGTH_MIN, 'quality_length_bonus' => self::QUALITY_LENGTH_BONUS,
            'quality_video_boost' => self::QUALITY_VIDEO_BOOST, 'quality_hashtag_boost' => self::QUALITY_HASHTAG_BOOST,
            'quality_mention_boost' => self::QUALITY_MENTION_BOOST,
            'diversity_enabled' => self::DIVERSITY_ENABLED, 'diversity_max_consecutive' => self::DIVERSITY_MAX_CONSECUTIVE,
            'diversity_penalty' => self::DIVERSITY_PENALTY,
            'diversity_type_enabled' => self::DIVERSITY_TYPE_ENABLED, 'diversity_type_max_consecutive' => self::DIVERSITY_TYPE_MAX_CONSECUTIVE,
            'velocity_enabled' => self::VELOCITY_ENABLED, 'velocity_window_hours' => self::VELOCITY_WINDOW_HOURS,
            'velocity_threshold' => self::VELOCITY_THRESHOLD, 'velocity_max_boost' => self::VELOCITY_MAX_BOOST, 'velocity_decay_hours' => self::VELOCITY_DECAY_HOURS,
            'conversation_depth_enabled' => self::CONVERSATION_DEPTH_ENABLED,
            'conversation_depth_max_boost' => self::CONVERSATION_DEPTH_MAX_BOOST, 'conversation_depth_threshold' => self::CONVERSATION_DEPTH_THRESHOLD,
            'ctr_enabled' => self::CTR_ENABLED, 'ctr_max_boost' => self::CTR_MAX_BOOST, 'ctr_min_impressions' => self::CTR_MIN_IMPRESSIONS,
            'user_type_prefs_enabled' => self::USER_TYPE_PREFS_ENABLED, 'user_type_prefs_max_boost' => self::USER_TYPE_PREFS_MAX_BOOST,
            'user_type_prefs_lookback_days' => self::USER_TYPE_PREFS_LOOKBACK_DAYS,
            'save_signal_enabled' => self::SAVE_SIGNAL_ENABLED, 'save_signal_max_boost' => self::SAVE_SIGNAL_MAX_BOOST, 'save_signal_min_saves' => self::SAVE_SIGNAL_MIN_SAVES,
        ];

        try {
            $tenantId = TenantContext::getId();
            $configJson = DB::table('tenants')->where('id', $tenantId)->value('configuration');
            if ($configJson) {
                $configArr = json_decode($configJson, true);
                if (is_array($configArr) && isset($configArr['feed_algorithm'])) {
                    $config = array_merge($defaults, $configArr['feed_algorithm']);
                    self::validateConfigArray($config);
                    if ($tenantIdForCache !== null) {
                        self::$configCacheByTenant[$tenantIdForCache] = $config;
                    }
                    return $config;
                }
            }
        } catch (\Exception $e) {
            // Fall through to defaults
        }

        self::validateConfigArray($defaults);
        if ($tenantIdForCache !== null) {
            self::$configCacheByTenant[$tenantIdForCache] = $defaults;
        }
        return $defaults;
    }

    /**
     * Clear the per-request static config cache. Required for tests and for
     * Octane-style persistent workers between requests.
     */
    public static function clearStaticCache(): void
    {
        self::$configCacheByTenant = [];
        self::$lastRequestTenantId = null;
    }

    private static function validateConfigArray(array &$c): void
    {
        $c['like_weight'] = max(0, (float) $c['like_weight']);
        $c['comment_weight'] = max(0, (float) $c['comment_weight']);
        $c['share_weight'] = max(0, (float) $c['share_weight']);
        $c['vitality_full_days'] = max(1, (int) $c['vitality_full_days']);
        $c['vitality_decay_days'] = max($c['vitality_full_days'] + 1, (int) $c['vitality_decay_days']);
        $c['vitality_minimum'] = max(0.0, min(1.0, (float) $c['vitality_minimum']));
        $c['geo_full_radius'] = max(0, (float) $c['geo_full_radius']);
        $c['geo_decay_interval'] = max(1, (float) $c['geo_decay_interval']);
        $c['geo_decay_rate'] = max(0.0, min(1.0, (float) $c['geo_decay_rate']));
        $c['geo_minimum'] = max(0.0, min(1.0, (float) $c['geo_minimum']));
        $c['freshness_half_life'] = max(1, (float) $c['freshness_half_life']);
        $c['freshness_minimum'] = max(0.0, min(1.0, (float) $c['freshness_minimum']));
        $c['freshness_gravity'] = max(0.1, min(3.0, (float) ($c['freshness_gravity'] ?? 1.0)));
        $c['social_graph_max_boost'] = max(1.0, min(5.0, (float) $c['social_graph_max_boost']));
        $c['social_graph_lookback_days'] = max(1, (int) $c['social_graph_lookback_days']);
        foreach (['quality_image_boost','quality_link_boost','quality_length_bonus','quality_video_boost','quality_hashtag_boost','quality_mention_boost'] as $key) {
            $c[$key] = max(1.0, min(3.0, (float) $c[$key]));
        }
    }

    public function isEnabled(): bool
    {
        return !empty(self::getConfig()['enabled']);
    }

    public function clearCache(): void
    {
        $this->config = null;
        $this->mutedUserSet = [];
    }

    // =========================================================================
    // PUBLIC STATIC SCORING METHODS (used by tests)
    // =========================================================================

    /**
     * Calculate Haversine distance between two coordinate pairs.
     */
    public static function calculateHaversineDistance(float $lat1, float $lon1, float $lat2, float $lon2): float
    {
        $earthRadiusKm = 6371;
        $latDiff = deg2rad($lat2 - $lat1);
        $lonDiff = deg2rad($lon2 - $lon1);
        $a = sin($latDiff / 2) * sin($latDiff / 2) +
             cos(deg2rad($lat1)) * cos(deg2rad($lat2)) *
             sin($lonDiff / 2) * sin($lonDiff / 2);
        $c = 2 * atan2(sqrt($a), sqrt(1 - $a));
        return $earthRadiusKm * $c;
    }

    /**
     * Compute geo decay score from a pre-calculated distance in km.
     */
    public static function computeGeoDecayFromDistance(float $distanceKm): float
    {
        if ($distanceKm <= self::GEO_FULL_SCORE_RADIUS) {
            return 1.0;
        }

        // Exponential decay beyond the full-score radius.
        // score = exp(-lambda * distance), floored at GEO_MINIMUM_SCORE.
        $score = exp(-self::GEO_DECAY_LAMBDA * $distanceKm);
        return max(self::GEO_MINIMUM_SCORE, $score);
    }

    /**
     * Calculate geo decay score from viewer/poster coordinates.
     */
    public static function calculateGeoDecayScore(?float $viewerLat, ?float $viewerLon, ?float $posterLat, ?float $posterLon): float
    {
        if ($viewerLat === null || $viewerLon === null || $posterLat === null || $posterLon === null) {
            return 1.0;
        }

        $distanceKm = self::calculateHaversineDistance($viewerLat, $viewerLon, $posterLat, $posterLon);
        return self::computeGeoDecayFromDistance($distanceKm);
    }

    /**
     * Compute vitality score from days since last activity.
     */
    public static function computeVitalityFromDays(int $days): float
    {
        if ($days <= self::VITALITY_FULL_THRESHOLD) {
            return 1.0;
        }
        if ($days >= self::VITALITY_DECAY_THRESHOLD) {
            return self::VITALITY_MINIMUM;
        }

        $decayRange = self::VITALITY_DECAY_THRESHOLD - self::VITALITY_FULL_THRESHOLD;
        $daysIntoDecay = $days - self::VITALITY_FULL_THRESHOLD;
        $scoreRange = 1.0 - self::VITALITY_MINIMUM;
        return 1.0 - ($daysIntoDecay / $decayRange * $scoreRange);
    }

    /**
     * Calculate content quality score for a post.
     */
    public static function calculateContentQualityScore(array $post): float
    {
        $score = 1.0;
        $content = (string) ($post['content'] ?? '');

        if (!empty($post['image_url'])) {
            $score *= self::QUALITY_IMAGE_BOOST;
        }
        if (preg_match('/https?:\/\//', $content)) {
            $score *= self::QUALITY_LINK_BOOST;
        }
        if (preg_match('/(?:youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|dailymotion\.com)/i', $content)) {
            $score *= self::QUALITY_VIDEO_BOOST;
        }
        if (strpos($content, '#') !== false) {
            $score *= self::QUALITY_HASHTAG_BOOST;
        }
        if (strpos($content, '@') !== false) {
            $score *= self::QUALITY_MENTION_BOOST;
        }
        if (strlen($content) >= self::QUALITY_LENGTH_MIN) {
            $score *= self::QUALITY_LENGTH_BONUS;
        }

        return $score;
    }

    /**
     * Calculate engagement score from likes and comments.
     */
    public static function calculateEngagementScore(int $likes, int $comments): float
    {
        $points = ($likes * self::LIKE_WEIGHT) + ($comments * self::COMMENT_WEIGHT);
        if ($points <= 0) {
            return 1.0;
        }
        return 1.0 + min(log(1.0 + $points) * 0.3, 2.0);
    }

    /**
     * Calculate vitality score for a user.
     */
    public static function calculateVitalityScore(int $userId): float
    {
        try {
            $tenantId = TenantContext::getId();
            $rows = DB::select(
                "SELECT MAX(created_at) AS last_active FROM (
                    SELECT MAX(created_at) AS created_at FROM activity_log WHERE user_id = ? AND tenant_id = ? AND action IN ('login','post_created','comment_added','like_added')
                    UNION ALL
                    SELECT MAX(created_at) AS created_at FROM feed_posts WHERE user_id = ? AND tenant_id = ?
                ) AS combined",
                [$userId, $tenantId, $userId, $tenantId]
            );
            if (!empty($rows) && $rows[0]->last_active) {
                $days = self::getDaysSinceDateStatic($rows[0]->last_active);
                return self::computeVitalityFromDays($days);
            }
        } catch (\Exception $e) {
            Log::debug('[FeedRanking] calculateVitalityScore failed: ' . $e->getMessage());
        }
        return self::VITALITY_MINIMUM;
    }

    /**
     * Calculate freshness score from a datetime string.
     */
    public static function calculateFreshnessScore(string $createdAt): float
    {
        $hoursAgo = max(0, (time() - strtotime($createdAt)) / 3600);
        if ($hoursAgo <= self::FRESHNESS_FULL_HOURS) {
            return 1.0;
        }
        return self::hackerNewsDecay((int) round($hoursAgo));
    }

    /**
     * Calculate social graph score for viewer-author pair.
     */
    public static function calculateSocialGraphScore(int $viewerId, int $authorId): float
    {
        if ($viewerId === 0 || $authorId === 0) {
            return 1.0;
        }
        try {
            $tenantId = TenantContext::getId();
            $sql = "SELECT SUM(CASE
                    WHEN va.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 3
                    WHEN va.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 2
                    ELSE 1
                END) AS weighted_interactions FROM (
                SELECT created_at FROM likes WHERE user_id=? AND target_type='post' AND tenant_id=? AND created_at>=DATE_SUB(NOW(),INTERVAL ? DAY)
                UNION ALL
                SELECT created_at FROM comments WHERE user_id=? AND target_type='post' AND tenant_id=? AND created_at>=DATE_SUB(NOW(),INTERVAL ? DAY)
            ) AS va";
            $params = [$viewerId, $tenantId, self::SOCIAL_GRAPH_INTERACTION_DAYS, $viewerId, $tenantId, self::SOCIAL_GRAPH_INTERACTION_DAYS];
            $rows = DB::select($sql, $params);
            if (!empty($rows) && $rows[0]->weighted_interactions > 0) {
                $bf = (self::SOCIAL_GRAPH_MAX_BOOST - 1) / 4;
                return min(self::SOCIAL_GRAPH_MAX_BOOST, 1.0 + (log((float) $rows[0]->weighted_interactions + 1, 2) * $bf));
            }
        } catch (\Exception $e) {
            Log::debug('[FeedRanking] calculateSocialGraphScore failed: ' . $e->getMessage());
        }
        return 1.0;
    }

    /**
     * Calculate negative signals score for a post.
     */
    public static function calculateNegativeSignalsScore(int $viewerId, int $postId): float
    {
        if ($viewerId === 0) {
            return 1.0;
        }
        try {
            $tenantId = TenantContext::getId();
            // feed_hidden identifies a hidden item by target_type + target_id,
            // not post_id — the same shape getBatchNegativeSignals() uses. The
            // old column threw, and the catch below returned the neutral score,
            // so a post the member had hidden was never penalised.
            $hidden = DB::table('feed_hidden')
                ->where('user_id', $viewerId)
                ->where('tenant_id', $tenantId)
                ->where('target_type', 'post')
                ->where('target_id', $postId)
                ->exists();
            if ($hidden) {
                return self::HIDE_PENALTY;
            }

            $reportCount = DB::table('reports')
                ->where('target_type', 'post')
                ->where('target_id', $postId)
                ->where('tenant_id', $tenantId)
                ->count();
            if ($reportCount > 0) {
                return max(0.1, 1.0 - $reportCount * self::REPORT_PENALTY_PER);
            }
        } catch (\Exception $e) {
            Log::debug('[FeedRanking] calculateNegativeSignalsScore failed: ' . $e->getMessage());
        }
        return 1.0;
    }

    /**
     * Hacker News-style time decay.
     */
    public static function hackerNewsDecay(int $hoursAgo): float
    {
        $halfLife = max(1.0, (float) self::FRESHNESS_HALF_LIFE_HOURS);
        $gravity = 1.0;
        $decay = 1.0 / pow(1.0 + $hoursAgo / $halfLife, $gravity);
        return max(self::FRESHNESS_MINIMUM, $decay);
    }

    /**
     * Contextual boost based on content type and time of day.
     */
    public static function contextualBoost(string $sourceType, ?string $viewerTimezone = null): float
    {
        try {
            $tz = $viewerTimezone ? new \DateTimeZone($viewerTimezone) : new \DateTimeZone('UTC');
            $now = new \DateTime('now', $tz);
            $hour = (int) $now->format('G');
            $dow = (int) $now->format('N');
        } catch (\Exception $e) {
            $hour = (int) date('G');
            $dow = (int) date('N');
        }

        $isWeekend = $dow >= 6;
        $isWeekday = !$isWeekend;
        $isMorning = $hour >= 7 && $hour < 12;
        $isEvening = $hour >= 19 && $hour < 22;

        return match ($sourceType) {
            'event' => ($dow === 1 && $isMorning) ? 1.20 : (($dow === 5 && $hour >= 14) ? 1.15 : 1.0),
            'volunteer' => $isWeekend ? 1.18 : 1.0,
            'job' => ($isWeekday && $isMorning && $dow <= 3) ? 1.15 : 1.0,
            'post', 'poll' => $isEvening ? 1.12 : (($hour >= 2 && $hour < 6) ? 0.90 : 1.0),
            'listing' => ($isWeekend && $isMorning) ? 1.10 : 1.0,
            default => 1.0,
        };
    }

    // =========================================================================
    // DIVERSITY (Public Static)
    // =========================================================================

    /**
     * Apply user-author diversity to feed items.
     *
     * @param array $config Optional tenant config; falls back to class constants.
     */
    public static function applyContentDiversity(array $items, array $config = []): array
    {
        $maxUser = (int) ($config['diversity_max_consecutive'] ?? self::DIVERSITY_MAX_CONSECUTIVE);
        $result = [];
        $deferred = [];

        foreach ($items as $item) {
            $userId = (int) ($item['user_id'] ?? 0);
            $shouldDefer = false;

            if ($userId > 0) {
                $c = 0;
                for ($i = count($result) - 1; $i >= 0 && $i >= count($result) - $maxUser; $i--) {
                    if ((int) ($result[$i]['user_id'] ?? 0) === $userId) {
                        $c++;
                    } else {
                        break;
                    }
                }
                if ($c >= $maxUser) {
                    $shouldDefer = true;
                }
            }

            if ($shouldDefer) {
                $deferred[] = $item;
            } else {
                $result[] = $item;
            }
        }

        foreach ($deferred as $di) {
            $dUid = (int) ($di['user_id'] ?? 0);
            $ins = false;
            for ($i = 0; $i < count($result); $i++) {
                $ok = true;
                if ($dUid > 0) {
                    for ($j = max(0, $i - $maxUser + 1); $j < min(count($result), $i + $maxUser); $j++) {
                        if ((int) ($result[$j]['user_id'] ?? 0) === $dUid) {
                            $ok = false;
                            break;
                        }
                    }
                }
                if ($ok) {
                    array_splice($result, $i, 0, [$di]);
                    $ins = true;
                    break;
                }
            }
            if (!$ins) {
                $result[] = $di;
            }
        }

        return $result;
    }

    /**
     * Apply content-type diversity to feed items.
     *
     * @param array $config Optional tenant config; falls back to class constants.
     */
    public static function applyContentTypeDiversity(array $items, array $config = []): array
    {
        $maxType = (int) ($config['diversity_type_max_consecutive'] ?? self::DIVERSITY_TYPE_MAX_CONSECUTIVE);
        $result = [];
        $deferred = [];

        foreach ($items as $item) {
            $cType = $item['type'] ?? $item['content_type'] ?? 'post';
            $shouldDefer = false;

            $c = 0;
            for ($i = count($result) - 1; $i >= 0 && $i >= count($result) - $maxType; $i--) {
                if (($result[$i]['type'] ?? $result[$i]['content_type'] ?? 'post') === $cType) {
                    $c++;
                } else {
                    break;
                }
            }
            if ($c >= $maxType) {
                $shouldDefer = true;
            }

            if ($shouldDefer) {
                $deferred[] = $item;
            } else {
                $result[] = $item;
            }
        }

        foreach ($deferred as $di) {
            $dType = $di['type'] ?? $di['content_type'] ?? 'post';
            $ins = false;
            for ($i = 0; $i < count($result); $i++) {
                $ok = true;
                for ($j = max(0, $i - $maxType + 1); $j < min(count($result), $i + $maxType); $j++) {
                    if (($result[$j]['type'] ?? $result[$j]['content_type'] ?? 'post') === $dType) {
                        $ok = false;
                        break;
                    }
                }
                if ($ok) {
                    array_splice($result, $i, 0, [$di]);
                    $ins = true;
                    break;
                }
            }
            if (!$ins) {
                $result[] = $di;
            }
        }

        return $result;
    }

    // =========================================================================
    // MAIN RANKING: rankPosts / getEdgeRankScore / boostPost
    // =========================================================================

    /**
     * Rank feed_activity items in-memory using 15-signal EdgeRank.
     *
     * @param int $tenantId Tenant scope
     * @param array $postIds Feed item IDs to rank
     * @param int $userId Authenticated user ID
     * @return array Re-ranked post IDs
     */
    public function rankPosts(int $tenantId, array $postIds, int $userId): array
    {
        if (empty($postIds)) {
            return [];
        }

        // Load posts as items
        $placeholders = implode(',', array_fill(0, count($postIds), '?'));
        try {
            $items = array_map(
                fn ($row) => (array) $row,
                DB::select(
                    "SELECT p.*, u.latitude as author_lat, u.longitude as author_lon
                     FROM feed_posts p
                     LEFT JOIN users u ON p.user_id = u.id
                     WHERE p.id IN ({$placeholders}) AND p.tenant_id = ?",
                    array_merge($postIds, [$tenantId])
                )
            );
        } catch (\Exception $e) {
            return $postIds; // Return unranked on error
        }

        if (empty($items)) {
            return $postIds;
        }

        // Use rankFeedItems for full 15-signal ranking
        $ranked = $this->rankFeedItems($items, $userId);

        return array_map(fn ($item) => (int) ($item['id'] ?? $item['post_id'] ?? 0), $ranked);
    }

    /**
     * Get EdgeRank score for a single post.
     */
    public function getEdgeRankScore(int $tenantId, int $postId, int $userId): float
    {
        try {
            $rows = DB::select(
                "SELECT p.*, u.latitude as author_lat, u.longitude as author_lon
                 FROM feed_posts p
                 LEFT JOIN users u ON p.user_id = u.id
                 WHERE p.id = ? AND p.tenant_id = ?",
                [$postId, $tenantId]
            );

            if (empty($rows)) {
                return 0.0;
            }

            $post = (array) $rows[0];
            $viewerCoords = $this->getUserCoordinates($userId);

            return self::calculatePostScore($post, $userId, $viewerCoords[0], $viewerCoords[1]);
        } catch (\Exception $e) {
            return 0.0;
        }
    }

    /**
     * Boost a post's visibility.
     *
     * NOTE: Not yet implemented — the `post_boosts` table and `feed_posts.boost_factor`
     * column do not exist in the schema. Implement a migration before enabling this.
     */
    public function boostPost(int $tenantId, int $postId, float $factor = 1.5): bool
    {
        Log::warning('FeedRankingService::boostPost() called but is not implemented — post_boosts table does not exist in schema.', [
            'tenant_id' => $tenantId,
            'post_id'   => $postId,
            'factor'    => $factor,
        ]);
        return false;
    }

    // =========================================================================
    // FULL 15-SIGNAL IN-MEMORY RANKING
    // =========================================================================

    /**
     * Rank feed items in-memory using 15-signal EdgeRank.
     */
    /**
     * @param bool $includeReasons If true, attaches '_ranking_reasons' with top signals per item
     */
    public function rankFeedItems(array $items, ?int $viewerId = null, ?string $viewerTimezone = null, bool $includeReasons = false): array
    {
        if (!$this->isEnabled() || count($items) < 2) {
            return $items;
        }

        $config = self::getConfig();
        $typeWeights = [
            'event' => 1.4, 'challenge' => 1.3, 'poll' => 1.25,
            'volunteer' => 1.2, 'goal' => 1.1, 'post' => 1.0,
            'listing' => 0.9, 'job' => 0.9, 'review' => 0.8,
        ];

        $authorIds = array_unique(array_filter(array_map(fn ($i) => (int) ($i['user_id'] ?? 0), $items)));
        $connectedSet = [];
        $socialScores = [];
        if ($viewerId) {
            $connectedIds = $this->getViewerConnectedUserIds($viewerId);
            $connectedSet = array_flip($connectedIds);
            if (!empty($authorIds)) {
                $socialScores = $this->getBatchSocialGraphScores($viewerId, $authorIds);
            }
        }

        $viewerLat = null;
        $viewerLon = null;
        if ($viewerId) {
            [$viewerLat, $viewerLon] = $this->getUserCoordinates($viewerId);
        }

        $authorCoords = !empty($authorIds) ? $this->getBatchUserCoordinates($authorIds) : [];
        $vitalityScores = !empty($authorIds) ? $this->getBatchVitalityScores($authorIds) : [];
        $velocityScores = (self::VELOCITY_ENABLED && !empty($items)) ? $this->getBatchEngagementVelocity($items) : [];
        $conversationDepths = (self::CONVERSATION_DEPTH_ENABLED && !empty($items)) ? $this->getBatchConversationDepth($items) : [];
        $reactionScores = !empty($items) ? $this->getBatchReactionScores($items) : [];
        $negativeScores = ($viewerId && !empty($items)) ? $this->getBatchNegativeSignals($viewerId, $items, $authorIds) : [];
        $ctrScores = (!empty($config['ctr_enabled']) && !empty($items)) ? $this->getBatchClickThroughRates($items) : [];
        $userTypePrefs = (!empty($config['user_type_prefs_enabled']) && $viewerId) ? $this->getInstanceUserTypePreferences($viewerId) : [];
        $saveScores = (!empty($config['save_signal_enabled']) && !empty($items)) ? $this->getBatchSaveScores($items) : [];

        foreach ($items as &$item) {
            $postId = (int) ($item['id'] ?? $item['post_id'] ?? 0);
            $itemType = (string) ($item['type'] ?? $item['source_type'] ?? 'post');
            $signalKey = self::feedItemSignalKey($item);
            $ctrKey = $signalKey;
            $authorId = (int) ($item['user_id'] ?? 0);
            $score = 1.0;

            if ($authorId && $this->isAuthorMuted($authorId)) {
                $item['_edge_rank'] = 0.0;
                continue;
            }

            // 1. Time Decay
            $createdAt = $item['created_at'] ?? null;
            if ($createdAt) {
                $hoursAgo = max(0, (int) round((time() - strtotime($createdAt)) / 3600));
                $score *= self::hackerNewsDecay($hoursAgo);
            }

            // 2. Engagement
            $likes = (int) ($item['likes_count'] ?? 0);
            $comments = (int) ($item['comments_count'] ?? 0);
            $points = ($likes * $config['like_weight']) + ($comments * $config['comment_weight']);
            $score *= $points > 0 ? 1.0 + min(log(1.0 + $points) * 0.3, 2.0) : 1.05;

            // 3. Velocity
            if (self::VELOCITY_ENABLED && isset($velocityScores[$signalKey])) {
                $v = $velocityScores[$signalKey];
                if ($v >= self::VELOCITY_THRESHOLD) {
                    $rawBoost = min(self::VELOCITY_MAX_BOOST, 1.0 + (($v - self::VELOCITY_THRESHOLD) / self::VELOCITY_THRESHOLD) * 0.4);
                    $postAgeHours = $createdAt ? max(0, (time() - strtotime($createdAt)) / 3600) : 0;
                    $velocityDecay = max(0.0, 1.0 - ($postAgeHours / (self::VELOCITY_DECAY_HOURS * 2)));
                    $score *= 1.0 + ($rawBoost - 1.0) * $velocityDecay;
                }
            }

            // 4. Type weight
            $sourceType = $item['type'] ?? $item['source_type'] ?? 'post';
            $score *= $typeWeights[$sourceType] ?? 1.0;

            // 5. Social Affinity
            if ($authorId && $viewerId) {
                if (isset($socialScores[$authorId]) && $socialScores[$authorId] > 0) {
                    $bf = ($config['social_graph_max_boost'] - 1) / 4;
                    $score *= min($config['social_graph_max_boost'], 1.0 + (log($socialScores[$authorId] + 1, 2) * $bf));
                } elseif (isset($connectedSet[$authorId])) {
                    $score *= (float) $config['social_graph_follower_boost'];
                }
            }

            // 6. Vitality
            if ($authorId && isset($vitalityScores[$authorId])) {
                $score *= $vitalityScores[$authorId];
            }

            // 7. Geo Decay
            if ($viewerLat !== null && $authorId && isset($authorCoords[$authorId])) {
                [$aLat, $aLon] = $authorCoords[$authorId];
                $score *= self::calculateGeoDecayScore($viewerLat, $viewerLon, $aLat, $aLon);
            }

            // 8. Quality
            if ($config['quality_enabled']) {
                $score *= self::calculateContentQualityScore($item);
            }

            // 9. Context Timing
            $score *= self::contextualBoost($sourceType, $viewerTimezone);

            // 10. Conversation Depth
            if (self::CONVERSATION_DEPTH_ENABLED && isset($conversationDepths[$signalKey])) {
                $d = $conversationDepths[$signalKey];
                if ($d >= self::CONVERSATION_DEPTH_THRESHOLD) {
                    $score *= min(self::CONVERSATION_DEPTH_MAX_BOOST, 1.0 + ($d / (self::CONVERSATION_DEPTH_THRESHOLD * 3)) * 0.5);
                }
            }

            // 11. Reaction Weighting
            if (isset($reactionScores[$signalKey]) && $reactionScores[$signalKey] > 0) {
                $score *= 1.0 + min($reactionScores[$signalKey] * 0.1, 1.0);
            }

            // 12. Negative Signals
            if ($viewerId && isset($negativeScores[$signalKey])) {
                $score *= $negativeScores[$signalKey];
            }

            // 13. CTR
            if (!empty($config['ctr_enabled']) && isset($ctrScores[$ctrKey])) {
                $ctr = $ctrScores[$ctrKey];
                $impressions = $ctrScores['_impressions'][$ctrKey] ?? 0;
                if ($impressions >= ($config['ctr_min_impressions'] ?? 5)) {
                    $maxBoost = (float) ($config['ctr_max_boost'] ?? 1.5);
                    $ctrMultiplier = 1.0 + ($ctr - self::CTR_NEUTRAL_BASELINE) * ($maxBoost - 1.0) / (1.0 - self::CTR_NEUTRAL_BASELINE);
                    $score *= max(0.8, min($maxBoost, $ctrMultiplier));
                }
            }

            // 14. User Type Preferences
            if (!empty($config['user_type_prefs_enabled']) && !empty($userTypePrefs)) {
                if (isset($userTypePrefs[$itemType])) {
                    $score *= $userTypePrefs[$itemType];
                }
            }

            // 15. Save/Bookmark
            if (!empty($config['save_signal_enabled']) && isset($saveScores[$signalKey])) {
                $saves = $saveScores[$signalKey];
                if ($saves >= ($config['save_signal_min_saves'] ?? 2)) {
                    $saveBoost = min(
                        (float) ($config['save_signal_max_boost'] ?? 1.35),
                        1.0 + log($saves, 10) * 0.2
                    );
                    $score *= $saveBoost;
                }
            }

            $item['_edge_rank'] = $score;
        }
        unset($item);

        usort($items, fn ($a, $b) => ($b['_edge_rank'] ?? 0) <=> ($a['_edge_rank'] ?? 0));

        $items = $this->applyDiversityInPlace($items);

        foreach ($items as &$item) {
            unset($item['_edge_rank']);
        }
        unset($item);

        // Second pass: compute ranking reasons when requested
        // Done after sort so we don't waste time on items that get filtered
        if ($includeReasons) {
            $items = $this->attachRankingReasons($items, $viewerId, $connectedSet, $socialScores, $velocityScores, $typeWeights);
        }

        return $items;
    }

    /**
     * Attach human-readable ranking reasons to each item.
     * Returns the top 3 contributing signals as i18n-ready keys.
     */
    private function attachRankingReasons(
        array $items,
        ?int $viewerId,
        array $connectedSet,
        array $socialScores,
        array $velocityScores,
        array $typeWeights,
    ): array {
        static $reasonLabels = [
            'social_affinity' => 'why_shown.from_connection',
            'engagement'      => 'why_shown.popular',
            'velocity'        => 'why_shown.trending',
            'type_boost'      => 'why_shown.community_content',
            'quality'         => 'why_shown.quality_content',
            'conversation'    => 'why_shown.active_discussion',
            'fresh'           => 'why_shown.fresh',
            'saved'           => 'why_shown.frequently_saved',
        ];

        foreach ($items as &$item) {
            $signals = [];
            $authorId = (int) ($item['user_id'] ?? 0);
            $postId = (int) ($item['id'] ?? $item['post_id'] ?? 0);
            $signalKey = self::feedItemSignalKey($item);

            // Social affinity
            if ($viewerId && $authorId && (isset($connectedSet[$authorId]) || (isset($socialScores[$authorId]) && $socialScores[$authorId] > 0))) {
                $signals['social_affinity'] = 2.0;
            }

            // Engagement
            $likes = (int) ($item['likes_count'] ?? 0);
            $comments = (int) ($item['comments_count'] ?? 0);
            if (($likes + $comments) >= 3) {
                $signals['engagement'] = 1.5 + min($likes + $comments, 20) * 0.05;
            }

            // Velocity
            if (isset($velocityScores[$signalKey]) && $velocityScores[$signalKey] >= self::VELOCITY_THRESHOLD) {
                $signals['velocity'] = 1.8;
            }

            // Type boost
            $sourceType = $item['type'] ?? $item['source_type'] ?? 'post';
            if (($typeWeights[$sourceType] ?? 1.0) > 1.1) {
                $signals['type_boost'] = $typeWeights[$sourceType] ?? 1.0;
            }

            // Quality (images, video)
            if (!empty($item['image_url']) || !empty($item['media'])) {
                $signals['quality'] = 1.3;
            }

            // Freshness (< 4h)
            $createdAt = $item['created_at'] ?? null;
            if ($createdAt) {
                $hoursAgo = max(0, (time() - strtotime($createdAt)) / 3600);
                if ($hoursAgo < 4) {
                    $signals['fresh'] = 1.5;
                }
            }

            // Sort by weight descending, take top 3
            arsort($signals);
            $topReasons = [];
            foreach (array_slice($signals, 0, 3, true) as $key => $weight) {
                $topReasons[] = $reasonLabels[$key] ?? $key;
            }

            $item['ranking_reasons'] = $topReasons;
        }
        unset($item);

        return $items;
    }

    // =========================================================================
    // TRACKING
    // =========================================================================

    /**
     * Polymorphic CTR tracking. $targetType defaults to 'post' for backwards
     * compatibility — pre-existing post-only callers continue to work.
     */
    public function recordImpression(int $targetId, int $userId, string $targetType = 'post'): void
    {
        if (!self::VIEW_TRACKING_ENABLED || $userId === 0 || $targetId === 0) return;

        $tenantId = TenantContext::getId();

        // H2: Per-user per-target debounce — skip duplicate impressions within 5 minutes
        $debounceKey = "imp:{$tenantId}:{$targetType}:{$targetId}:{$userId}";
        if (Cache::has($debounceKey)) return;

        // H3: GDPR — only track if user has analytics consent via cookie_consents table
        try {
            $analyticsConsent = Cache::remember(
                "consent:{$tenantId}:{$userId}",
                now()->addMinutes(30),
                fn () => DB::table('cookie_consents')
                    ->where('user_id', $userId)
                    ->where('tenant_id', $tenantId)
                    ->whereNull('withdrawal_date')
                    ->where(function ($q) {
                        $q->whereNull('expires_at')
                          ->orWhere('expires_at', '>', now());
                    })
                    ->orderByDesc('created_at')
                    ->value('analytics')
            );
            // Fail closed: if consent is explicitly 0 (false), do not track
            if ($analyticsConsent !== null && (int) $analyticsConsent === 0) return;
        } catch (\Throwable $e) {
            return; // Fail closed — don't track if we can't verify consent
        }

        try {
            // The target_type column is added by the
            // 2026_05_03_120000_add_target_type_to_feed_impressions_clicks
            // migration. Detect it so we don't break environments that
            // haven't migrated yet.
            $hasTypeColumn = \Illuminate\Support\Facades\Schema::hasColumn('feed_impressions', 'target_type');
            if ($hasTypeColumn) {
                DB::statement(
                    "INSERT INTO feed_impressions (post_id, target_type, user_id, tenant_id, created_at)
                     VALUES (?, ?, ?, ?, NOW())
                     ON DUPLICATE KEY UPDATE view_count = view_count + 1, updated_at = NOW()",
                    [$targetId, $targetType, $userId, $tenantId]
                );
            } else {
                // Pre-migration fallback: only persist post impressions to
                // avoid foreign-key collisions across types.
                if ($targetType !== 'post') return;
                DB::statement(
                    "INSERT INTO feed_impressions (post_id, user_id, tenant_id, created_at)
                     VALUES (?, ?, ?, NOW())
                     ON DUPLICATE KEY UPDATE view_count = view_count + 1, updated_at = NOW()",
                    [$targetId, $userId, $tenantId]
                );
            }
            Cache::put($debounceKey, 1, now()->addMinutes(5));
        } catch (\Exception $e) {
            // Non-blocking
        }
    }

    public function recordClick(int $targetId, int $userId, string $targetType = 'post'): void
    {
        if (!self::CLICK_TRACKING_ENABLED || $userId === 0 || $targetId === 0) return;
        $tenantId = TenantContext::getId();

        try {
            $analyticsConsent = Cache::remember(
                "consent:{$tenantId}:{$userId}",
                now()->addMinutes(30),
                fn () => DB::table('cookie_consents')
                    ->where('user_id', $userId)
                    ->where('tenant_id', $tenantId)
                    ->whereNull('withdrawal_date')
                    ->where(function ($q) {
                        $q->whereNull('expires_at')
                          ->orWhere('expires_at', '>', now());
                    })
                    ->orderByDesc('created_at')
                    ->value('analytics')
            );
            if ($analyticsConsent !== null && (int) $analyticsConsent === 0) return;
        } catch (\Throwable $e) {
            return;
        }

        try {
            $hasTypeColumn = \Illuminate\Support\Facades\Schema::hasColumn('feed_clicks', 'target_type');
            if ($hasTypeColumn) {
                DB::statement(
                    "INSERT INTO feed_clicks (post_id, target_type, user_id, tenant_id, created_at)
                     VALUES (?, ?, ?, ?, NOW())
                     ON DUPLICATE KEY UPDATE click_count = click_count + 1, updated_at = NOW()",
                    [$targetId, $targetType, $userId, $tenantId]
                );
            } else {
                if ($targetType !== 'post') return;
                DB::statement(
                    "INSERT INTO feed_clicks (post_id, user_id, tenant_id, created_at)
                     VALUES (?, ?, ?, NOW())
                     ON DUPLICATE KEY UPDATE click_count = click_count + 1, updated_at = NOW()",
                    [$targetId, $userId, $tenantId]
                );
            }
        } catch (\Exception $e) {
            // Non-blocking
        }
    }

    // =========================================================================
    // BATCH DATA LOADING (Private, Tenant-Scoped)
    // =========================================================================

    private function getBatchSocialGraphScores(int $viewerId, array $authorIds): array
    {
        if (empty($authorIds) || $viewerId === 0) return [];
        try {
            $tenantId = TenantContext::getId();
            $ph = implode(',', array_fill(0, count($authorIds), '?'));
            $days = 90;
            $sql = "SELECT p.user_id AS author_id, SUM(CASE
                    WHEN va.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 3
                    WHEN va.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 2
                    ELSE 1
                END) AS weighted_interactions FROM (
                SELECT target_id, created_at FROM likes WHERE user_id=? AND target_type='post' AND tenant_id=? AND created_at>=DATE_SUB(NOW(),INTERVAL ? DAY)
                UNION ALL
                SELECT target_id, created_at FROM comments WHERE user_id=? AND target_type='post' AND tenant_id=? AND created_at>=DATE_SUB(NOW(),INTERVAL ? DAY)
            ) AS va JOIN feed_posts p ON p.id=va.target_id AND p.tenant_id=? WHERE p.user_id IN ($ph) GROUP BY p.user_id";
            $params = array_merge([$viewerId, $tenantId, $days, $viewerId, $tenantId, $days, $tenantId], $authorIds);
            $rows = DB::select($sql, $params);
            $r = [];
            foreach ($rows as $row) { $r[(int) $row->author_id] = (float) $row->weighted_interactions; }
            return $r;
        } catch (\Exception $e) { Log::warning('FeedRankingService batch query failed', ['error' => $e->getMessage()]); return []; }
    }

    private function getBatchVitalityScores(array $userIds): array
    {
        if (empty($userIds)) return [];
        try {
            $tenantId = TenantContext::getId();
            $ph = implode(',', array_fill(0, count($userIds), '?'));
            $sql = "SELECT user_id, MAX(created_at) AS last_active FROM (
                SELECT user_id, MAX(created_at) AS created_at FROM activity_log WHERE user_id IN ($ph) AND tenant_id=? AND action IN ('login','post_created','comment_added','like_added') GROUP BY user_id
                UNION ALL
                SELECT user_id, MAX(created_at) AS created_at FROM feed_posts WHERE user_id IN ($ph) AND tenant_id=? GROUP BY user_id
            ) AS combined GROUP BY user_id";
            $params = array_merge($userIds, [$tenantId], $userIds, [$tenantId]);
            $rows = DB::select($sql, $params);
            $r = [];
            foreach ($rows as $row) {
                $daysSince = self::getDaysSinceDateStatic($row->last_active);
                $r[(int) $row->user_id] = self::computeVitalityFromDays($daysSince);
            }
            $config = self::getConfig();
            foreach ($userIds as $uid) {
                if (!isset($r[$uid])) { $r[$uid] = (float) $config['vitality_minimum']; }
            }
            return $r;
        } catch (\Exception $e) { Log::warning('FeedRankingService batch query failed', ['error' => $e->getMessage()]); return []; }
    }

    private function getBatchEngagementVelocity(array $feedItems): array
    {
        if (empty($feedItems)) return [];
        try {
            $tenantId = TenantContext::getId();
            $hrs = self::VELOCITY_WINDOW_HOURS;

            // Group by normalised target_type so engagement table queries match
            // the values actually stored in likes/comments (may differ from source_type)
            $byType = [];
            foreach ($feedItems as $item) {
                $sType = $item['type'] ?? $item['source_type'] ?? 'post';
                $sId   = (int) ($item['id'] ?? $item['post_id'] ?? 0);
                if ($sId > 0) $byType[self::normaliseTargetType($sType)][] = $sId;
            }

            $r = [];
            foreach ($byType as $targetType => $ids) {
                $ph  = implode(',', array_fill(0, count($ids), '?'));
                $sql = "SELECT target_id, COUNT(*) AS velocity FROM (
                    SELECT target_id FROM likes WHERE target_type=? AND target_id IN ($ph) AND tenant_id=? AND created_at>=DATE_SUB(NOW(),INTERVAL ? HOUR)
                    UNION ALL
                    SELECT target_id FROM comments WHERE target_type=? AND target_id IN ($ph) AND tenant_id=? AND created_at>=DATE_SUB(NOW(),INTERVAL ? HOUR)
                ) AS recent GROUP BY target_id";
                $params = array_merge([$targetType], $ids, [$tenantId, $hrs, $targetType], $ids, [$tenantId, $hrs]);
                $rows = DB::select($sql, $params);
                foreach ($rows as $row) { $r[$targetType . ':' . (int) $row->target_id] = (int) $row->velocity; }
            }
            return $r;
        } catch (\Exception $e) { Log::warning('FeedRankingService batch query failed', ['error' => $e->getMessage()]); return []; }
    }

    private function getBatchConversationDepth(array $feedItems): array
    {
        if (empty($feedItems)) return [];
        try {
            $tenantId = TenantContext::getId();

            $byType = [];
            foreach ($feedItems as $item) {
                $sType = $item['type'] ?? $item['source_type'] ?? 'post';
                $sId   = (int) ($item['id'] ?? $item['post_id'] ?? 0);
                if ($sId > 0) $byType[self::normaliseTargetType($sType)][] = $sId;
            }

            $r = [];
            foreach ($byType as $targetType => $ids) {
                $ph   = implode(',', array_fill(0, count($ids), '?'));
                $rows = DB::select(
                    "SELECT target_id, COUNT(*) AS depth FROM comments
                     WHERE target_type = ? AND target_id IN ($ph) AND tenant_id = ? AND parent_id IS NOT NULL
                     GROUP BY target_id",
                    array_merge([$targetType], $ids, [$tenantId])
                );
                foreach ($rows as $row) { $r[$targetType . ':' . (int) $row->target_id] = (int) $row->depth; }
            }
            return $r;
        } catch (\Exception $e) { Log::warning('FeedRankingService batch query failed', ['error' => $e->getMessage()]); return []; }
    }

    private function getBatchReactionScores(array $feedItems): array
    {
        if (empty($feedItems)) return [];
        try {
            $tenantId = TenantContext::getId();

            // Group feed items by normalised target_type to match engagement table values
            $byType = [];
            foreach ($feedItems as $item) {
                $sType = $item['type'] ?? $item['source_type'] ?? 'post';
                $sId   = (int) ($item['id'] ?? $item['post_id'] ?? 0);
                if ($sId > 0) {
                    $byType[self::normaliseTargetType($sType)][] = $sId;
                }
            }

            $r = [];
            foreach ($byType as $targetType => $ids) {
                $ph   = implode(',', array_fill(0, count($ids), '?'));
                $rows = DB::select(
                    "SELECT target_id AS post_id, emoji, COUNT(*) AS cnt
                     FROM reactions
                     WHERE target_type = ? AND target_id IN ($ph) AND tenant_id = ?
                     GROUP BY target_id, emoji",
                    array_merge([$targetType], $ids, [$tenantId])
                );
                foreach ($rows as $row) {
                    $pid   = (int) $row->post_id;
                    $key = $targetType . ':' . $pid;
                    $named = self::EMOJI_REACTION_MAP[$row->emoji] ?? 'like';
                    $weight = self::REACTION_WEIGHTS[$named] ?? 1.0;
                    $r[$key] = ($r[$key] ?? 0) + ($weight * (int) $row->cnt);
                }
            }
            return $r;
        } catch (\Exception $e) { Log::warning('FeedRankingService batch query failed', ['error' => $e->getMessage()]); return []; }
    }

    private function getBatchNegativeSignals(int $viewerId, array $feedItems, array $authorIds): array
    {
        $config = self::getConfig();
        if (empty($config['negative_signals_enabled']) || $viewerId === 0) return [];
        $result = [];
        $tenantId = TenantContext::getId();
        $this->mutedUserSet = [];
        try {
            // Group items by normalised target_type so queries match engagement table values
            $byType = [];
            foreach ($feedItems as $item) {
                $sType = $item['type'] ?? $item['source_type'] ?? 'post';
                $sId   = (int) ($item['id'] ?? $item['post_id'] ?? 0);
                if ($sId > 0) {
                    $byType[self::normaliseTargetType($sType)][] = $sId;
                }
            }

            // Hidden items (feed_hidden uses target_id / target_type columns)
            foreach ($byType as $targetType => $ids) {
                $ph   = implode(',', array_fill(0, count($ids), '?'));
                $rows = DB::select(
                    "SELECT target_id FROM feed_hidden
                     WHERE user_id = ? AND tenant_id = ? AND target_type = ? AND target_id IN ($ph)",
                    array_merge([$viewerId, $tenantId, $targetType], $ids)
                );
                foreach ($rows as $row) {
                    $result[$targetType . ':' . (int) $row->target_id] = (float) $config['hide_penalty'];
                }
            }

            // Muted authors
            if (!empty($authorIds)) {
                $ph = implode(',', array_fill(0, count($authorIds), '?'));
                $rows = DB::select("SELECT muted_user_id FROM feed_muted_users WHERE user_id=? AND tenant_id=? AND muted_user_id IN ($ph)", array_merge([$viewerId, $tenantId], $authorIds));
                foreach ($rows as $row) { $this->mutedUserSet[(int) $row->muted_user_id] = 1; }
            }

            // Reported items (reports table uses target_type / target_id)
            foreach ($byType as $targetType => $ids) {
                $ph   = implode(',', array_fill(0, count($ids), '?'));
                $rows = DB::select(
                    "SELECT target_id, COUNT(*) AS report_count FROM reports
                     WHERE target_type = ? AND target_id IN ($ph) AND tenant_id = ?
                     GROUP BY target_id",
                    array_merge([$targetType], $ids, [$tenantId])
                );
                foreach ($rows as $row) {
                    $key = $targetType . ':' . (int) $row->target_id;
                    if (!isset($result[$key])) {
                        $result[$key] = max(0.1, 1.0 - (int) $row->report_count * (float) $config['report_penalty_per']);
                    }
                }
            }
        } catch (\Exception $e) {
            \Log::warning('FeedRankingService: failed to fetch batch report penalties', ['error' => $e->getMessage()]);
        }
        return $result;
    }

    /**
     * Fetch click-through rates for feed items.
     *
     * feed_impressions and feed_clicks only have a `post_id` column (no target_type).
     * To prevent cross-contamination (listing #42 getting click data from post #42),
     * we only look up CTR for items whose source_type is 'post'. All other item types
     * get 0.0 CTR returned so the CTR signal is skipped for them via the impression
     * count gate (impressions will be 0, below ctr_min_impressions).
     *
     * @param array $feedItems Full feed item arrays (not raw IDs)
     */
    private function getBatchClickThroughRates(array $feedItems): array
    {
        if (empty($feedItems) || !self::CLICK_TRACKING_ENABLED) return [];

        return $this->getBatchClickThroughRatesPolymorphic($feedItems);
    }

    /**
     * Fetch polymorphic CTR keyed by source type and ID.
     */
    private function getBatchClickThroughRatesPolymorphic(array $feedItems): array
    {
        $idsByType = [];
        foreach ($feedItems as $item) {
            $sourceType = (string) ($item['type'] ?? $item['source_type'] ?? 'post');
            $id = (int) ($item['id'] ?? $item['post_id'] ?? 0);
            if ($id > 0) {
                $idsByType[$sourceType][] = $id;
            }
        }

        $result = ['_impressions' => []];
        if (empty($idsByType)) {
            return $result;
        }

        try {
            $tenantId = TenantContext::getId();
            $hasTypeColumn = \Illuminate\Support\Facades\Schema::hasColumn('feed_impressions', 'target_type')
                && \Illuminate\Support\Facades\Schema::hasColumn('feed_clicks', 'target_type');

            if (!$hasTypeColumn) {
                $postOnlyIds = array_values(array_unique($idsByType['post'] ?? []));
                if (empty($postOnlyIds)) {
                    return $result;
                }

                $ph = implode(',', array_fill(0, count($postOnlyIds), '?'));
                $rows = DB::select(
                    "SELECT fi.post_id, SUM(fi.view_count) AS impressions, COALESCE(SUM(fc.click_count),0)/GREATEST(SUM(fi.view_count),1) AS ctr
                     FROM feed_impressions fi LEFT JOIN feed_clicks fc ON fc.post_id=fi.post_id AND fc.tenant_id=fi.tenant_id AND fc.user_id=fi.user_id
                     WHERE fi.post_id IN ($ph) AND fi.tenant_id=? GROUP BY fi.post_id",
                    array_merge($postOnlyIds, [$tenantId])
                );

                foreach ($rows as $row) {
                    $key = 'post:' . (int) $row->post_id;
                    $result[$key] = min(1.0, (float) $row->ctr);
                    $result['_impressions'][$key] = (int) $row->impressions;
                }

                return $result;
            }

            $clauses = [];
            $params = [];
            foreach ($idsByType as $sourceType => $ids) {
                $ids = array_values(array_unique(array_map('intval', $ids)));
                if (empty($ids)) {
                    continue;
                }

                $ph = implode(',', array_fill(0, count($ids), '?'));
                $clauses[] = "(fi.target_type = ? AND fi.post_id IN ($ph))";
                $params[] = $sourceType;
                array_push($params, ...$ids);
            }

            if (empty($clauses)) {
                return $result;
            }

            $rows = DB::select(
                "SELECT fi.target_type, fi.post_id, SUM(fi.view_count) AS impressions, COALESCE(SUM(fc.click_count),0)/GREATEST(SUM(fi.view_count),1) AS ctr
                 FROM feed_impressions fi
                 LEFT JOIN feed_clicks fc ON fc.post_id=fi.post_id AND fc.target_type=fi.target_type AND fc.tenant_id=fi.tenant_id AND fc.user_id=fi.user_id
                 WHERE fi.tenant_id=? AND (" . implode(' OR ', $clauses) . ")
                 GROUP BY fi.target_type, fi.post_id",
                array_merge([$tenantId], $params)
            );

            foreach ($rows as $row) {
                $key = (string) $row->target_type . ':' . (int) $row->post_id;
                $result[$key] = min(1.0, (float) $row->ctr);
                $result['_impressions'][$key] = (int) $row->impressions;
            }
        } catch (\Exception $e) {
            Log::warning('FeedRankingService batch query failed', ['error' => $e->getMessage()]);
        }

        return $result;
    }

    /**
     * Instance-level user type preferences (used internally by rankFeedItems).
     */
    private function getInstanceUserTypePreferences(int $viewerId): array
    {
        return self::getUserTypePreferences($viewerId);
    }

    /**
     * Get user content type preferences.
     */
    public static function getUserTypePreferences(int $viewerId): array
    {
        if ($viewerId === 0) return [];
        $config = self::getConfig();
        $maxBoost = (float) ($config['user_type_prefs_max_boost'] ?? 1.4);
        $lookbackDays = (int) ($config['user_type_prefs_lookback_days'] ?? 30);
        try {
            $tenantId = TenantContext::getId();
            $sql = "SELECT fa.source_type, COUNT(*) AS engagements FROM (
                SELECT target_id FROM likes WHERE user_id=? AND target_type='post' AND tenant_id=? AND created_at>=DATE_SUB(NOW(),INTERVAL ? DAY)
                UNION ALL
                SELECT target_id FROM comments WHERE user_id=? AND target_type='post' AND tenant_id=? AND created_at>=DATE_SUB(NOW(),INTERVAL ? DAY)
            ) AS eng
            JOIN feed_activity fa ON fa.source_type IN ('post','listing','event','poll','goal','review','job','challenge','volunteer')
                AND fa.source_id = eng.target_id AND fa.tenant_id=?
            GROUP BY fa.source_type";
            $params = [$viewerId, $tenantId, $lookbackDays, $viewerId, $tenantId, $lookbackDays, $tenantId];
            $rows = DB::select($sql, $params);
            if (empty($rows)) return [];

            $maxEng = 0;
            $typeCounts = [];
            foreach ($rows as $row) {
                $typeCounts[$row->source_type] = (int) $row->engagements;
                $maxEng = max($maxEng, (int) $row->engagements);
            }
            if ($maxEng === 0) return [];

            $result = [];
            foreach ($typeCounts as $type => $count) {
                // L7: $maxEng is guarded above by the === 0 check, so no division by zero
                $normalized = $count / $maxEng;
                $result[$type] = 1.0 + ($normalized * ($maxBoost - 1.0));
            }
            return $result;
        } catch (\Exception $e) { Log::warning('FeedRankingService batch query failed', ['error' => $e->getMessage()]); return []; }
    }

    private function getBatchSaveScores(array $feedItems): array
    {
        if (empty($feedItems)) return [];
        try {
            $tenantId = TenantContext::getId();

            // Build (bookmarkable_type, bookmarkable_id) pairs from feed items
            $pairs = [];
            foreach ($feedItems as $item) {
                $sType = $item['type'] ?? $item['source_type'] ?? 'post';
                $sId   = (int) ($item['id'] ?? $item['post_id'] ?? 0);
                if ($sId > 0) {
                    $pairs[] = [$sType, $sId];
                }
            }
            if (empty($pairs)) return [];

            // Build WHERE clause: (bookmarkable_type = ? AND bookmarkable_id = ?) OR ...
            $conditions = implode(' OR ', array_fill(0, count($pairs), '(bookmarkable_type = ? AND bookmarkable_id = ?)'));
            $params = [$tenantId];
            foreach ($pairs as [$t, $id]) {
                $params[] = $t;
                $params[] = $id;
            }

            $rows = DB::select(
                "SELECT bookmarkable_type AS source_type, bookmarkable_id AS source_id, COUNT(*) AS save_count
                 FROM bookmarks
                 WHERE tenant_id = ? AND ($conditions)
                 GROUP BY bookmarkable_type, bookmarkable_id
                 HAVING save_count > 0",
                $params
            );
            $r = [];
            foreach ($rows as $row) { $r[(string) $row->source_type . ':' . (int) $row->source_id] = (int) $row->save_count; }
            return $r;
        } catch (\Exception $e) { Log::warning('FeedRankingService batch query failed', ['error' => $e->getMessage()]); return []; }
    }

    // =========================================================================
    // SCORING HELPERS (static)
    // =========================================================================

    /**
     * Calculate the full post score (used by getEdgeRankScore).
     */
    public static function calculatePostScore(array $post, int $viewerId, ?float $viewerLat = null, ?float $viewerLon = null): float
    {
        $config = self::getConfig();
        $score = 1.0;

        // Time Decay
        $createdAt = $post['created_at'] ?? null;
        if ($createdAt) {
            $hoursAgo = max(0, (int) round((time() - strtotime($createdAt)) / 3600));
            $score *= self::hackerNewsDecay($hoursAgo);
        }

        // Engagement — log-scaled to match rankFeedItems() formula
        $likes = (int) ($post['likes_count'] ?? 0);
        $comments = (int) ($post['comments_count'] ?? 0);
        $points = ($likes * $config['like_weight']) + ($comments * $config['comment_weight']);
        $score *= max(1.0, 1.0 + min(log(1.0 + $points) * 0.3, 2.0));

        // Type weight
        $typeWeights = [
            'event' => 1.4, 'challenge' => 1.3, 'poll' => 1.25,
            'volunteer' => 1.2, 'goal' => 1.1, 'post' => 1.0,
            'listing' => 0.9, 'job' => 0.9, 'review' => 0.8,
        ];
        $sourceType = $post['type'] ?? $post['source_type'] ?? 'post';
        $score *= $typeWeights[$sourceType] ?? 1.0;

        // Geo Decay
        $posterLat = isset($post['author_lat']) ? (float) $post['author_lat'] : null;
        $posterLon = isset($post['author_lon']) ? (float) $post['author_lon'] : null;
        $score *= self::calculateGeoDecayScore($viewerLat, $viewerLon, $posterLat, $posterLon);

        return $score;
    }

    // =========================================================================
    // COORDINATE HELPERS
    // =========================================================================

    private function getUserCoordinates(int $userId): array
    {
        try {
            $row = DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', TenantContext::getId())
                ->select('latitude', 'longitude')
                ->first();

            if ($row && $row->latitude !== null && $row->longitude !== null) {
                return [(float) $row->latitude, (float) $row->longitude];
            }
        } catch (\Exception $e) {
            \Log::warning('FeedRankingService: failed to fetch user coordinates', ['user_id' => $userId, 'error' => $e->getMessage()]);
        }
        return [null, null];
    }

    private function getBatchUserCoordinates(array $userIds): array
    {
        if (empty($userIds)) return [];
        try {
            $ph = implode(',', array_fill(0, count($userIds), '?'));
            // C1: scope by tenant_id to prevent cross-tenant coordinate leakage
            $rows = DB::select(
                "SELECT id, latitude, longitude FROM users
                 WHERE id IN ($ph)
                 AND latitude IS NOT NULL
                 AND longitude IS NOT NULL
                 AND tenant_id = ?",
                array_merge($userIds, [TenantContext::getId()])
            );
            $result = [];
            foreach ($rows as $row) {
                $result[(int) $row->id] = [(float) $row->latitude, (float) $row->longitude];
            }
            return $result;
        } catch (\Exception $e) { Log::warning('FeedRankingService batch query failed', ['error' => $e->getMessage()]); return []; }
    }

    private function getViewerConnectedUserIds(int $viewerId): array
    {
        try {
            $tenantId = TenantContext::getId();

            // 1. Completed time-credit transactions (original signal)
            $transactionRows = DB::select(
                "SELECT DISTINCT CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END AS connected_id
                 FROM transactions
                 WHERE (sender_id = ? OR receiver_id = ?) AND tenant_id = ? AND status = 'completed'",
                [$viewerId, $viewerId, $viewerId, $tenantId]
            );

            // 2. Accepted social connections (connections table, tenant-scoped)
            $connectionRows = DB::select(
                "SELECT DISTINCT CASE WHEN requester_id = ? THEN receiver_id ELSE requester_id END AS connected_id
                 FROM connections
                 WHERE (requester_id = ? OR receiver_id = ?) AND tenant_id = ? AND status = 'accepted'",
                [$viewerId, $viewerId, $viewerId, $tenantId]
            );

            // 3. Co-members in shared groups (group_members, active status, tenant-scoped)
            // Finds users in any group the viewer belongs to — broadens social graph for new/non-transacting users.
            $groupMemberRows = DB::select(
                "SELECT DISTINCT gm2.user_id AS connected_id
                 FROM group_members gm1
                 JOIN group_members gm2 ON gm2.group_id = gm1.group_id
                     AND gm2.user_id != ?
                     AND gm2.status = 'active'
                     AND gm2.tenant_id = ?
                 WHERE gm1.user_id = ? AND gm1.status = 'active' AND gm1.tenant_id = ?",
                [$viewerId, $tenantId, $viewerId, $tenantId]
            );

            $ids = array_unique(array_merge(
                array_map(fn ($row) => (int) $row->connected_id, $transactionRows),
                array_map(fn ($row) => (int) $row->connected_id, $connectionRows),
                array_map(fn ($row) => (int) $row->connected_id, $groupMemberRows),
            ));

            return array_values(array_filter($ids, fn ($id) => $id > 0 && $id !== $viewerId));
        } catch (\Exception $e) { Log::warning('FeedRankingService batch query failed', ['error' => $e->getMessage()]); return []; }
    }

    private function isAuthorMuted(int $authorId): bool
    {
        return isset($this->mutedUserSet[$authorId]);
    }

    // =========================================================================
    // DIVERSITY (Instance-level, used by rankFeedItems)
    // =========================================================================

    private function applyDiversityInPlace(array $items): array
    {
        $config = self::getConfig();
        $userDiv = !empty($config['diversity_enabled']);
        $typeDiv = !empty($config['diversity_type_enabled']);
        if (!$userDiv && !$typeDiv) return $items;

        // Use the static methods for the actual diversity logic, passing tenant config
        if ($userDiv) {
            $items = self::applyContentDiversity($items, $config);
        }
        if ($typeDiv) {
            $items = self::applyContentTypeDiversity($items, $config);
        }

        return $items;
    }

    // =========================================================================
    // UTILITY
    // =========================================================================

    /**
     * Normalise a feed_activity source_type value to the target_type string
     * stored in likes, comments, reactions, and reports tables.
     *
     * feed_activity.source_type is the canonical value. Engagement tables use
     * the same values in almost all cases, but this single method is the
     * authoritative mapping point — add any future mismatches here rather than
     * patching individual batch methods.
     *
     * Current known divergences (schema-verified 2026-04-17):
     *   None — all source_type values match their engagement target_type values.
     *   The method is present so the pattern is established and easy to extend.
     */
    private static function normaliseTargetType(string $sourceType): string
    {
        return match ($sourceType) {
            // Identity mapping — no mismatches in current schema.
            // Example future entry: 'volunteer' => 'volunteer_post',
            default => $sourceType,
        };
    }

    private static function feedItemSignalKey(array $item): string
    {
        $sourceType = (string) ($item['type'] ?? $item['source_type'] ?? 'post');
        $sourceId = (int) ($item['id'] ?? $item['post_id'] ?? 0);

        return self::normaliseTargetType($sourceType) . ':' . $sourceId;
    }

    private static function getDaysSinceDateStatic(string $dateString): int
    {
        try {
            $date = new \DateTime($dateString);
            $now = new \DateTime();
            return $now->diff($date)->days;
        } catch (\Exception $e) {
            return 999;
        }
    }
}
