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
 * MatchLearningService — Learns from user interactions with matches to improve
 * future match quality via collaborative-filtering-style signals.
 *
 * Reads from: match_history, match_dismissals, match_cache, listings, categories
 * Writes to:  match_history
 *
 * Signals:
 * - Historical boost/penalty per listing based on past actions
 * - Category affinities derived from positive interactions
 * - Learned distance preference from accepted/dismissed distances
 */
class MatchLearningService
{
    /** Action weights for historical boost calculation (positive = good, negative = bad) */
    private const ACTION_WEIGHTS = [
        'accept'  =>  5.0,
        'contact' =>  3.0,
        'save'    =>  2.0,
        'view'    =>  0.5,
        'impression' => 0.0,
        'decline' => -2.0,
        'dismiss' => -4.0,
    ];

    /** How fast old interactions decay (half-life in days) */
    private const DECAY_HALF_LIFE_DAYS = 30;

    public function __construct()
    {
    }

    /**
     * Get a historical boost/penalty for a candidate listing based on the user's
     * past interactions with the listing's owner and category.
     *
     * Returns a float that should be ADDED to the match score (can be negative).
     * Typical range: -15 to +15.
     *
     * @param int          $userId            The user we are computing matches for
     * @param array|object $candidateListing   Candidate listing (must have user_id, category_id)
     */
    public function getHistoricalBoost($userId, $candidateListing): float
    {
        $tenantId = TenantContext::getId();
        $listing = (array) $candidateListing;
        $candidateOwnerId = (int) ($listing['user_id'] ?? 0);
        $candidateCategoryId = (int) ($listing['category_id'] ?? 0);

        if (!$candidateOwnerId) {
            return 0.0;
        }

        try {
            // 1. Direct interaction history with this listing owner's listings
            $ownerBoost = $this->getOwnerInteractionBoost($userId, $candidateOwnerId, $tenantId);

            // 2. Category affinity boost
            $categoryBoost = 0.0;
            if ($candidateCategoryId) {
                $affinities = $this->getCategoryAffinities($userId);
                $categoryBoost = ($affinities[$candidateCategoryId] ?? 0.0) * 5.0; // Scale to ±5
            }

            $total = $ownerBoost + $categoryBoost;

            // Clamp to ±15
            return max(-15.0, min(15.0, round($total, 2)));
        } catch (\Throwable $e) {
            return 0.0;
        }
    }

    /**
     * Batched owner-interaction boosts for a set of candidate owners — one
     * grouped query instead of getHistoricalBoost()'s per-candidate lookups.
     * Same weights/decay/clamp semantics as getOwnerInteractionBoost().
     *
     * @param int[] $ownerIds
     * @return array<int, float> ownerId => boost (clamped ±10)
     */
    public function getOwnerInteractionBoosts(int $userId, array $ownerIds): array
    {
        $tenantId = TenantContext::getId();
        $ownerIds = array_values(array_unique(array_filter(array_map('intval', $ownerIds))));
        if (empty($ownerIds)) {
            return [];
        }

        try {
            $placeholders = implode(',', array_fill(0, count($ownerIds), '?'));
            $rows = DB::select(
                "SELECT l.user_id as owner_id, mh.action, COUNT(*) as cnt, MAX(mh.created_at) as latest_at
                 FROM match_history mh
                 JOIN listings l ON mh.listing_id = l.id
                 WHERE mh.user_id = ? AND mh.tenant_id = ? AND l.user_id IN ($placeholders)
                 GROUP BY l.user_id, mh.action",
                array_merge([$userId, $tenantId], $ownerIds)
            );

            $boosts = [];
            foreach ($rows as $row) {
                $ownerId = (int) $row->owner_id;
                $weight = self::ACTION_WEIGHTS[$row->action] ?? 0.0;
                $count = min((int) $row->cnt, 10);

                $decay = 1.0;
                if ($row->latest_at) {
                    $ageDays = max(0, (time() - strtotime($row->latest_at)) / 86400);
                    $decay = pow(0.5, $ageDays / self::DECAY_HALF_LIFE_DAYS);
                }

                $boosts[$ownerId] = ($boosts[$ownerId] ?? 0.0) + $weight * $count * $decay;
            }

            return array_map(fn ($b) => max(-10.0, min(10.0, $b)), $boosts);
        } catch (\Throwable $e) {
            Log::warning('[MatchLearningService] getOwnerInteractionBoosts failed', [
                'user_id' => $userId,
                'error' => $e->getMessage(),
            ]);
            return [];
        }
    }

    /**
     * What happened when this member and each owner actually exchanged time,
     * read from the exchange records (either of them may have asked).
     *
     * Each completed exchange the member did not rate poorly counts +4 (up to
     * +8); any exchange the member rated 1 or 2 makes it -8, whatever else
     * happened. Until 18 Nov 2026 the learning signals saw only dismissals and
     * clicks on the Explore page: nothing a member did after a match reached
     * them, so a member who had a good exchange with someone was not more
     * likely to be shown them again.
     *
     * @param int[] $ownerIds
     * @return array<int, float> ownerId => boost
     */
    public function getExchangeOutcomeBoosts(int $userId, array $ownerIds): array
    {
        $tenantId = (int) TenantContext::getId();
        $ownerIds = array_values(array_unique(array_filter(array_map('intval', $ownerIds))));
        if ($ownerIds === [] || $userId <= 0) {
            return [];
        }

        try {
            $placeholders = implode(',', array_fill(0, count($ownerIds), '?'));
            // The member's own rating: as requester it is requester_rating,
            // as provider provider_rating.
            $rows = DB::select(
                "SELECT CASE WHEN requester_id = ? THEN provider_id ELSE requester_id END AS other_id,
                        status,
                        CASE WHEN requester_id = ? THEN requester_rating ELSE provider_rating END AS my_rating
                 FROM exchange_requests
                 WHERE tenant_id = ?
                   AND ((requester_id = ? AND provider_id IN ($placeholders))
                     OR (provider_id = ? AND requester_id IN ($placeholders)))
                   AND reversed_at IS NULL",
                array_merge([$userId, $userId, $tenantId, $userId], $ownerIds, [$userId], $ownerIds)
            );
        } catch (\Throwable $e) {
            Log::warning('[MatchLearningService] getExchangeOutcomeBoosts failed', [
                'user_id' => $userId,
                'error' => $e->getMessage(),
            ]);
            return [];
        }

        $completed = [];
        $ratedPoorly = [];
        foreach ($rows as $row) {
            $other = (int) $row->other_id;
            if ($row->my_rating !== null && (int) $row->my_rating > 0 && (int) $row->my_rating <= 2) {
                $ratedPoorly[$other] = true;
            } elseif ((string) $row->status === 'completed') {
                $completed[$other] = ($completed[$other] ?? 0) + 1;
            }
        }

        $boosts = [];
        foreach ($completed as $other => $count) {
            $boosts[$other] = min(8.0, 4.0 * $count);
        }
        foreach (array_keys($ratedPoorly) as $other) {
            $boosts[$other] = -8.0;
        }

        return $boosts;
    }

    /**
     * Record a user interaction with a listing for future learning.
     *
     * @param int    $userId    User who interacted
     * @param int    $listingId Listing they interacted with
     * @param string $action    One of: impression, view, save, contact, dismiss, accept, decline
     * @param array  $metadata  Optional extra context (e.g. match_score, distance_km)
     */
    public function recordInteraction($userId, $listingId, $action, array $metadata = []): bool
    {
        $tenantId = TenantContext::getId();

        // Normalize action name
        $validActions = ['impression', 'view', 'save', 'contact', 'dismiss', 'accept', 'decline'];
        if (!in_array($action, $validActions, true)) {
            // Map common aliases
            $actionMap = [
                'dismissed' => 'dismiss',
                'viewed' => 'view',
                'saved' => 'save',
                'contacted' => 'contact',
                'accepted' => 'accept',
                'declined' => 'decline',
            ];
            $action = $actionMap[$action] ?? 'view';
        }

        try {
            DB::table('match_history')->insert([
                'tenant_id'     => $tenantId,
                'user_id'       => (int) $userId,
                'listing_id'    => (int) $listingId,
                'action'        => $action,
                'match_score'   => (float) ($metadata['match_score'] ?? $metadata['score'] ?? 0),
                'distance_km'   => isset($metadata['distance_km']) ? (float) $metadata['distance_km'] : null,
                'match_reasons' => !empty($metadata['reasons']) ? json_encode($metadata['reasons']) : null,
                'created_at'    => now(),
            ]);

            return true;
        } catch (\Throwable $e) {
            Log::warning('[MatchLearningService] recordInteraction failed', [
                'user_id'    => $userId,
                'listing_id' => $listingId,
                'action'     => $action,
                'error'      => $e->getMessage(),
            ]);
            return false;
        }
    }

    /**
     * Get category affinities for a user based on their interaction history.
     *
     * Returns an associative array of category_id => affinity score (-1.0 to 1.0).
     * Positive = user likes this category, negative = user dislikes it.
     *
     * @return array<int, float>
     */
    public function getCategoryAffinities($userId): array
    {
        $tenantId = TenantContext::getId();

        try {
            // Join match_history with listings to get category_id, then aggregate
            $rows = DB::select(
                "SELECT l.category_id,
                        mh.action,
                        COUNT(*) as cnt,
                        MAX(mh.created_at) as latest_at
                 FROM match_history mh
                 JOIN listings l ON mh.listing_id = l.id
                 WHERE mh.user_id = ? AND mh.tenant_id = ?
                   AND l.category_id IS NOT NULL
                 GROUP BY l.category_id, mh.action",
                [$userId, $tenantId]
            );

            // Aggregate weighted scores per category
            $categoryScores = [];
            foreach ($rows as $row) {
                $catId = (int) $row->category_id;
                $weight = self::ACTION_WEIGHTS[$row->action] ?? 0.0;
                $count = (int) $row->cnt;

                // Apply time decay based on latest interaction
                $decay = 1.0;
                if ($row->latest_at) {
                    $ageDays = max(0, (time() - strtotime($row->latest_at)) / 86400);
                    $decay = pow(0.5, $ageDays / self::DECAY_HALF_LIFE_DAYS);
                }

                if (!isset($categoryScores[$catId])) {
                    $categoryScores[$catId] = 0.0;
                }
                $categoryScores[$catId] += $weight * $count * $decay;
            }

            // Normalize to -1.0 .. 1.0
            if (empty($categoryScores)) {
                return [];
            }

            $maxAbs = max(1.0, max(array_map('abs', $categoryScores)));
            $normalized = [];
            foreach ($categoryScores as $catId => $score) {
                $normalized[$catId] = round($score / $maxAbs, 3);
            }

            return $normalized;
        } catch (\Throwable $e) {
            Log::warning('[MatchLearningService] getCategoryAffinities failed', [
                'user_id' => $userId,
                'error' => $e->getMessage(),
            ]);
            return [];
        }
    }

    /**
     * Get the user's learned distance preference from interaction history.
     *
     * Analyzes which distances the user tends to accept vs dismiss to infer
     * their ideal matching radius.
     *
     * @return array{preferred_km: float, max_km: float, confidence: float, sample_size: int}
     */
    public function getLearnedDistancePreference($userId): array
    {
        $tenantId = TenantContext::getId();
        $defaults = [
            'preferred_km' => 25.0,
            'max_km' => 50.0,
            'confidence' => 0.0,
            'sample_size' => 0,
        ];

        try {
            // Get interactions that have distance data from match_cache
            $rows = DB::select(
                "SELECT mh.action, mc.distance_km
                 FROM match_history mh
                 JOIN match_cache mc ON mh.listing_id = mc.listing_id
                                    AND mh.user_id = mc.user_id
                                    AND mc.tenant_id = ?
                 WHERE mh.user_id = ? AND mh.tenant_id = ?
                   AND mc.distance_km IS NOT NULL
                   AND mh.action IN ('accept', 'contact', 'save', 'dismiss', 'decline')
                 ORDER BY mh.created_at DESC
                 LIMIT 200",
                [$tenantId, $userId, $tenantId]
            );

            if (empty($rows)) {
                return $defaults;
            }

            $positiveDistances = [];
            $negativeDistances = [];

            foreach ($rows as $row) {
                $distance = (float) $row->distance_km;
                $weight = self::ACTION_WEIGHTS[$row->action] ?? 0.0;

                if ($weight > 0) {
                    $positiveDistances[] = $distance;
                } elseif ($weight < 0) {
                    $negativeDistances[] = $distance;
                }
            }

            $sampleSize = count($positiveDistances) + count($negativeDistances);
            if ($sampleSize < 3) {
                $defaults['sample_size'] = $sampleSize;
                return $defaults;
            }

            // Preferred = median of positive interactions
            $preferred = !empty($positiveDistances)
                ? $this->median($positiveDistances)
                : 25.0;

            // Max = 90th percentile of positive interactions (or median of negative)
            $max = !empty($positiveDistances)
                ? $this->percentile($positiveDistances, 90)
                : (!empty($negativeDistances) ? $this->median($negativeDistances) : 50.0);

            // Confidence based on sample size (saturates around 50 interactions)
            $confidence = min(1.0, $sampleSize / 50);

            return [
                'preferred_km' => round($preferred, 1),
                'max_km' => round(max($preferred, $max), 1),
                'confidence' => round($confidence, 2),
                'sample_size' => $sampleSize,
            ];
        } catch (\Throwable $e) {
            Log::warning('[MatchLearningService] getLearnedDistancePreference failed', [
                'user_id' => $userId,
                'error' => $e->getMessage(),
            ]);
            return $defaults;
        }
    }

    /**
     * Get aggregate learning stats for the current tenant (admin dashboard).
     *
     * @return array{total_interactions: int, unique_users: int, action_breakdown: array, avg_interactions_per_user: float, category_affinity_coverage: int}
     */
    public function getLearningStats(): array
    {
        $tenantId = TenantContext::getId();

        try {
            $totals = DB::selectOne(
                "SELECT COUNT(*) as total,
                        COUNT(DISTINCT user_id) as unique_users
                 FROM match_history
                 WHERE tenant_id = ?",
                [$tenantId]
            );

            $totalInteractions = $totals ? (int) $totals->total : 0;
            $uniqueUsers = $totals ? (int) $totals->unique_users : 0;

            // Action breakdown
            $actionRows = DB::select(
                "SELECT action, COUNT(*) as cnt
                 FROM match_history
                 WHERE tenant_id = ?
                 GROUP BY action
                 ORDER BY cnt DESC",
                [$tenantId]
            );

            $actionBreakdown = [];
            foreach ($actionRows as $row) {
                $actionBreakdown[$row->action] = (int) $row->cnt;
            }

            // How many categories have affinity data (at least one user with interactions)
            $categoryCoverage = 0;
            try {
                $catRow = DB::selectOne(
                    "SELECT COUNT(DISTINCT l.category_id) as cnt
                     FROM match_history mh
                     JOIN listings l ON mh.listing_id = l.id
                     WHERE mh.tenant_id = ? AND l.category_id IS NOT NULL",
                    [$tenantId]
                );
                $categoryCoverage = $catRow ? (int) $catRow->cnt : 0;
            } catch (\Throwable $e) {
                // Non-critical
            }

            return [
                'total_interactions' => $totalInteractions,
                'unique_users' => $uniqueUsers,
                'action_breakdown' => $actionBreakdown,
                'avg_interactions_per_user' => $uniqueUsers > 0
                    ? round($totalInteractions / $uniqueUsers, 1)
                    : 0.0,
                'category_affinity_coverage' => $categoryCoverage,
            ];
        } catch (\Throwable $e) {
            Log::warning('[MatchLearningService] getLearningStats failed', [
                'error' => $e->getMessage(),
            ]);
            return [
                'total_interactions' => 0,
                'unique_users' => 0,
                'action_breakdown' => [],
                'avg_interactions_per_user' => 0.0,
                'category_affinity_coverage' => 0,
            ];
        }
    }

    // =========================================================================
    // PRIVATE HELPERS
    // =========================================================================

    /**
     * Get a boost/penalty based on past interactions with a specific listing owner.
     */
    private function getOwnerInteractionBoost(int $userId, int $ownerId, int $tenantId): float
    {
        try {
            $rows = DB::select(
                "SELECT mh.action, COUNT(*) as cnt, MAX(mh.created_at) as latest_at
                 FROM match_history mh
                 JOIN listings l ON mh.listing_id = l.id
                 WHERE mh.user_id = ? AND mh.tenant_id = ? AND l.user_id = ?
                 GROUP BY mh.action",
                [$userId, $tenantId, $ownerId]
            );

            $boost = 0.0;
            foreach ($rows as $row) {
                $weight = self::ACTION_WEIGHTS[$row->action] ?? 0.0;
                $count = min((int) $row->cnt, 10); // Cap to avoid runaway scores

                $decay = 1.0;
                if ($row->latest_at) {
                    $ageDays = max(0, (time() - strtotime($row->latest_at)) / 86400);
                    $decay = pow(0.5, $ageDays / self::DECAY_HALF_LIFE_DAYS);
                }

                $boost += $weight * $count * $decay;
            }

            // Clamp to ±10 for the owner component
            return max(-10.0, min(10.0, $boost));
        } catch (\Throwable $e) {
            return 0.0;
        }
    }

    /**
     * Calculate median of an array of numbers.
     */
    private function median(array $values): float
    {
        if (empty($values)) {
            return 0.0;
        }

        sort($values);
        $count = count($values);
        $mid = (int) floor($count / 2);

        if ($count % 2 === 0) {
            return ($values[$mid - 1] + $values[$mid]) / 2.0;
        }

        return (float) $values[$mid];
    }

    /**
     * Calculate a given percentile of an array of numbers.
     */
    private function percentile(array $values, int $pct): float
    {
        if (empty($values)) {
            return 0.0;
        }

        sort($values);
        $index = ($pct / 100) * (count($values) - 1);
        $lower = (int) floor($index);
        $upper = (int) ceil($index);
        $fraction = $index - $lower;

        if ($lower === $upper || !isset($values[$upper])) {
            return (float) $values[$lower];
        }

        return $values[$lower] + $fraction * ($values[$upper] - $values[$lower]);
    }
}
