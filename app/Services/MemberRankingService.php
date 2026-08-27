<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use App\Support\UserDisplayName;

/**
 * MemberRankingService — CommunityRank algorithm for ranking members.
 *
 * Computes weighted scores (activity, contribution, reputation, connectivity,
 * proximity) to rank members within a tenant.
 *
 * Reputation uses Bayesian smoothing plus a Wilson lower bound so members with
 * only one or two strong reviews do not outrank consistently trusted members.
 */
class MemberRankingService
{
    private const ACTIVITY_LOOKBACK_DAYS = 30;
    private const CONTRIBUTION_LOOKBACK_DAYS = 90;
    private const WEIGHT_ACTIVITY = 0.25;
    private const WEIGHT_CONTRIBUTION = 0.25;
    private const WEIGHT_REPUTATION = 0.20;
    private const WEIGHT_CONNECTIVITY = 0.20;
    private const WEIGHT_PROXIMITY = 0.10;
    private const BAYESIAN_PRIOR_MEAN = 3.8;
    private const BAYESIAN_PRIOR_STRENGTH = 5.0;
    private const WILSON_Z = 1.96;
    private const POSITIVE_REVIEW_THRESHOLD = 4.0;
    private const PROXIMITY_NEUTRAL_SCORE = 0.5;
    private const PROXIMITY_MAX_DISTANCE_KM = 100.0;

    public function __construct(
        private readonly User $user,
    ) {}

    /**
     * Rank members within a tenant using the CommunityRank algorithm.
     *
     * @return array{items: array<int, array<string, float|int|string|null>>, total: int}
     */
    public function rankMembers(
        int $tenantId,
        int $limit = 50,
        int $offset = 0,
        string $search = '',
        ?int $viewerId = null,
        ?float $viewerLatitude = null,
        ?float $viewerLongitude = null
    ): array
    {
        $config = $this->getConfig();

        // Bug 4: Clamp lookback days to valid range
        $activityDays = max(1, min(365, (int) ($config['activity_lookback_days'] ?? self::ACTIVITY_LOOKBACK_DAYS)));
        $contribDays  = max(1, min(365, (int) ($config['contribution_lookback_days'] ?? self::CONTRIBUTION_LOOKBACK_DAYS)));

        $cutoff       = now()->subDays($activityDays)->toDateTimeString();
        $contribCutoff = now()->subDays($contribDays)->toDateTimeString();

        // Bug 1: Return from cache for non-search requests
        $viewerIdKey = $viewerId ?? 0;
        $latBucket   = (int) round(($viewerLatitude ?? 0) * 10);
        $lonBucket   = (int) round(($viewerLongitude ?? 0) * 10);
        $cacheKey    = "community_rank:{$tenantId}:{$viewerIdKey}:{$latBucket}:{$lonBucket}";

        if ($search === '') {
            $cached = Cache::get($cacheKey);
            if ($cached !== null) {
                return [
                    'items' => array_slice($cached, $offset, $limit),
                    'total' => count($cached),
                ];
            }
        }

        $usersQuery = $this->user->newQuery()
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->where(function ($query) {
                $query->where('privacy_search', 1)
                    ->orWhereNull('privacy_search');
            })
            ->select(['id', 'first_name', 'last_name', 'avatar_url', 'points',
                       'is_verified', 'created_at', 'organization_name', 'profile_type', 'latitude', 'longitude']);

        if ($viewerId) {
            $usersQuery->where('id', '!=', $viewerId);
        }

        if ($search !== '') {
            $memberIds = SearchService::searchUsersStatic($search, $tenantId);
            if ($memberIds !== false && !empty($memberIds)) {
                $usersQuery->whereIn('id', array_map('intval', $memberIds));
            } elseif ($memberIds !== false) {
                $usersQuery->whereRaw('1 = 0');
            } else {
                $like = '%' . $search . '%';
                $usersQuery->where(function (Builder $query) use ($search, $like) {
                    $query->whereRaw(
                        "MATCH(first_name, last_name, bio, skills) AGAINST(? IN BOOLEAN MODE)",
                        [$search]
                    )
                    ->orWhereRaw("CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, '')) LIKE ?", [$like])
                    ->orWhere('organization_name', 'LIKE', $like)
                    ->orWhere('location', 'LIKE', $like);
                });
            }
        }

        OnboardingConfigService::applyVisibilityScope($usersQuery);

        $users = $usersQuery->get();

        if ($users->isEmpty()) {
            return ['items' => [], 'total' => 0];
        }

        $userIds = $users->pluck('id')->all();

        // Activity: transactions in lookback window
        $txnMap = DB::table('transactions')
            ->where('tenant_id', $tenantId)
            ->whereIn('sender_id', $userIds)
            ->where('created_at', '>=', $cutoff)
            ->select('sender_id as user_id', DB::raw('COUNT(*) as cnt'))
            ->groupBy('sender_id')
            ->pluck('cnt', 'user_id')
            ->all();

        // Activity: posts in lookback window
        $postMap = DB::table('feed_posts')
            ->where('tenant_id', $tenantId)
            ->whereIn('user_id', $userIds)
            ->where('created_at', '>=', $cutoff)
            ->select('user_id', DB::raw('COUNT(*) as cnt'))
            ->groupBy('user_id')
            ->pluck('cnt', 'user_id')
            ->all();

        // Contribution: listings created within the lookback window (recent activity counts more)
        // Hours given remains all-time as it reflects lifetime community value.
        $listingMap = DB::table('listings')
            ->where('tenant_id', $tenantId)
            ->whereIn('user_id', $userIds)
            ->where('created_at', '>=', $contribCutoff)
            ->select('user_id', DB::raw('COUNT(*) as cnt'))
            ->groupBy('user_id')
            ->pluck('cnt', 'user_id')
            ->all();

        $hoursGivenMap = DB::table('transactions')
            ->where('tenant_id', $tenantId)
            ->where('status', 'completed')
            ->whereIn('sender_id', $userIds)
            ->select('sender_id as user_id', DB::raw('COALESCE(SUM(amount), 0) as total_hours'))
            ->groupBy('sender_id')
            ->pluck('total_hours', 'user_id')
            ->all();

        $requesterConnectionMap = DB::table('connections')
            ->where('tenant_id', $tenantId)
            ->where('status', 'accepted')
            ->whereIn('requester_id', $userIds)
            ->select('requester_id as user_id', DB::raw('COUNT(*) as cnt'))
            ->groupBy('requester_id')
            ->pluck('cnt', 'user_id')
            ->all();

        $receiverConnectionMap = DB::table('connections')
            ->where('tenant_id', $tenantId)
            ->where('status', 'accepted')
            ->whereIn('receiver_id', $userIds)
            ->select('receiver_id as user_id', DB::raw('COUNT(*) as cnt'))
            ->groupBy('receiver_id')
            ->pluck('cnt', 'user_id')
            ->all();

        // Reputation: aggregate review statistics across local and portable federated reviews.
        $reviewStats = DB::table('reviews')
            ->whereIn('receiver_id', $userIds)
            ->where(function ($q) use ($tenantId) {
                $q->where('tenant_id', $tenantId)
                  ->orWhere(function ($q2) use ($tenantId) {
                      $q2->where('receiver_tenant_id', $tenantId)
                         ->where('review_type', 'federated')
                         ->where('show_cross_tenant', 1);
                  });
            })
            ->select(
                'receiver_id as user_id',
                DB::raw('AVG(rating) as avg_rating'),
                DB::raw('COUNT(*) as review_count'),
                DB::raw('SUM(CASE WHEN rating >= ' . self::POSITIVE_REVIEW_THRESHOLD . ' THEN 1 ELSE 0 END) as positive_count')
            )
            ->groupBy('receiver_id')
            ->get()
            ->keyBy('user_id');

        // Normalize and score
        $maxActivity = max(1, max(array_merge([0], array_values($txnMap), array_values($postMap))));
        $contributionRaw = [];
        foreach ($userIds as $userId) {
            $contributionRaw[$userId] = ((int) ($listingMap[$userId] ?? 0) * 2) + (float) ($hoursGivenMap[$userId] ?? 0);
        }
        $maxContrib = max(1, max(array_merge([0], array_values($contributionRaw))));
        $connectionMap = [];
        foreach ($userIds as $userId) {
            $connectionMap[$userId] = (int) ($requesterConnectionMap[$userId] ?? 0) + (int) ($receiverConnectionMap[$userId] ?? 0);
        }
        $maxConnections = max(1, max(array_merge([0], array_values($connectionMap))));

        $weights = [
            'activity' => max(0.0, (float) ($config['activity_weight'] ?? self::WEIGHT_ACTIVITY)),
            'contribution' => max(0.0, (float) ($config['contribution_weight'] ?? self::WEIGHT_CONTRIBUTION)),
            'reputation' => max(0.0, (float) ($config['reputation_weight'] ?? self::WEIGHT_REPUTATION)),
            'connectivity' => max(0.0, (float) ($config['connectivity_weight'] ?? self::WEIGHT_CONNECTIVITY)),
            'proximity' => max(0.0, (float) ($config['proximity_weight'] ?? self::WEIGHT_PROXIMITY)),
        ];

        // Bug 5: Guard against all-weights-zero configuration
        $totalUserWeight = array_sum($weights);
        if ($totalUserWeight <= 0.0) {
            $weights = [
                'activity'     => self::WEIGHT_ACTIVITY,
                'contribution' => self::WEIGHT_CONTRIBUTION,
                'reputation'   => self::WEIGHT_REPUTATION,
                'connectivity' => self::WEIGHT_CONNECTIVITY,
                'proximity'    => self::WEIGHT_PROXIMITY,
            ];
        }

        $globalWeightTotal = max(
            0.0001,
            $weights['activity'] + $weights['contribution'] + $weights['reputation'] + $weights['connectivity']
        );

        $ranked = $users->map(function ($user) use (
            $txnMap,
            $postMap,
            $contributionRaw,
            $reviewStats,
            $connectionMap,
            $maxActivity,
            $maxContrib,
            $maxConnections,
            $weights,
            $globalWeightTotal,
            $viewerLatitude,
            $viewerLongitude
        ) {
            $activity = (($txnMap[$user->id] ?? 0) + ($postMap[$user->id] ?? 0)) / $maxActivity;
            $contribution = ($contributionRaw[$user->id] ?? 0) / $maxContrib;
            $reputation = $this->calculateReputationScore($reviewStats->get($user->id));
            $connectivity = ($connectionMap[$user->id] ?? 0) / $maxConnections;
            $proximity = $this->calculateProximityScore(
                $viewerLatitude,
                $viewerLongitude,
                $user->latitude,
                $user->longitude
            );

            $globalScore = (
                ($weights['activity'] * $activity)
                + ($weights['contribution'] * $contribution)
                + ($weights['reputation'] * $reputation)
                + ($weights['connectivity'] * $connectivity)
            ) / $globalWeightTotal;

            $finalWeightTotal = $globalWeightTotal + ($weights['proximity'] > 0 ? $weights['proximity'] : 0.0);

            // Bug 3: Use uncapped sortScore for ordering; capped displayScore for UI
            $rawScore = (
                ($globalScore * $globalWeightTotal)
                + ($weights['proximity'] * $proximity)
            ) / max($finalWeightTotal, 0.0001);

            $verifiedBoost  = $user->is_verified ? 1.1 : 1.0;
            $sortScore      = $rawScore * $verifiedBoost;
            $displayScore   = round(min(1.0, $sortScore), 4);
            $displayGlobal  = round(min(1.0, $globalScore * $verifiedBoost), 4);

            return [
                'user_id'      => $user->id,
                'name'         => ($user->profile_type === 'organisation' && !empty($user->organization_name))
                    ? $user->organization_name
                    : UserDisplayName::resolve($user),
                'avatar_url'   => $user->avatar_url,
                'score'        => $displayScore,
                'global_score' => $displayGlobal,
                'activity'     => round($activity, 4),
                'contribution' => round($contribution, 4),
                'reputation'   => round($reputation, 4),
                'connectivity' => round($connectivity, 4),
                'proximity'    => round($proximity, 4),
                '_sort_score'  => $sortScore,
            ];
        })
        ->sortByDesc('_sort_score')
        ->values()
        ->map(function ($item) {
            unset($item['_sort_score']);
            return $item;
        })
        ->all();

        if ($search === '') {
            // Bug 1: Cache the full ranked array for 3 minutes
            Cache::put($cacheKey, $ranked, 180);

            // Bug 2: Throttle persistCommunityRanks to once per 10 minutes
            $persistKey = "community_rank_last_persist:{$tenantId}";
            if (!Cache::has($persistKey)) {
                $this->persistCommunityRanks($tenantId, $ranked);
                Cache::put($persistKey, true, 600);
            }
        }

        return [
            'items' => array_slice($ranked, $offset, $limit),
            'total' => count($ranked),
        ];
    }

    /**
     * Check if the CommunityRank algorithm is enabled.
     */
    public function isEnabled(): bool
    {
        $config = $this->getConfig();
        return !empty($config['enabled']);
    }

    /**
     * Get the current CommunityRank configuration.
     */
    public function getConfig(): array
    {
        $defaults = [
            'enabled' => true,
            'activity_lookback_days' => self::ACTIVITY_LOOKBACK_DAYS,
            'contribution_lookback_days' => self::CONTRIBUTION_LOOKBACK_DAYS,
            'activity_weight' => self::WEIGHT_ACTIVITY,
            'contribution_weight' => self::WEIGHT_CONTRIBUTION,
            'reputation_weight' => self::WEIGHT_REPUTATION,
            'connectivity_weight' => self::WEIGHT_CONNECTIVITY,
            'proximity_weight' => self::WEIGHT_PROXIMITY,
        ];

        try {
            $tenantId = TenantContext::getId();
            $row = DB::table('communityrank_settings')
                ->where('tenant_id', $tenantId)
                ->first();

            if ($row) {
                return array_merge($defaults, [
                    'enabled' => (bool) ($row->is_enabled ?? true),
                    'contribution_lookback_days' => (int) ($row->contribution_lookback_days ?? $defaults['contribution_lookback_days']),
                    'activity_weight' => (float) ($row->activity_weight ?? $defaults['activity_weight']),
                    'contribution_weight' => (float) ($row->contribution_weight ?? $defaults['contribution_weight']),
                    'reputation_weight' => (float) ($row->reputation_weight ?? $defaults['reputation_weight']),
                    'connectivity_weight' => (float) ($row->connectivity_weight ?? $defaults['connectivity_weight']),
                    'proximity_weight' => (float) ($row->proximity_weight ?? $defaults['proximity_weight']),
                ]);
            }

            $configJson = DB::table('tenants')->where('id', $tenantId)->value('configuration');
            if ($configJson) {
                $configArr = json_decode($configJson, true);
                $memberConfig = $configArr['algorithms']['members'] ?? null;
                if (is_array($memberConfig)) {
                    return array_merge($defaults, [
                        'enabled' => (bool) ($memberConfig['enabled'] ?? true),
                        'contribution_lookback_days' => (int) ($memberConfig['contribution_lookback_days'] ?? $defaults['contribution_lookback_days']),
                        'activity_weight' => (float) ($memberConfig['activity_weight'] ?? $memberConfig['weight_activity'] ?? $defaults['activity_weight']),
                        'contribution_weight' => (float) ($memberConfig['contribution_weight'] ?? $memberConfig['weight_contribution'] ?? $defaults['contribution_weight']),
                        'reputation_weight' => (float) ($memberConfig['reputation_weight'] ?? $memberConfig['weight_reputation'] ?? $defaults['reputation_weight']),
                        'connectivity_weight' => (float) ($memberConfig['connectivity_weight'] ?? $memberConfig['weight_connections'] ?? $defaults['connectivity_weight']),
                        'proximity_weight' => (float) ($memberConfig['proximity_weight'] ?? $defaults['proximity_weight']),
                    ]);
                }
            }
        } catch (\Exception $e) {
            // Fall back to defaults
        }

        return $defaults;
    }

    /**
     * Clear the CommunityRank cache.
     */
    public function clearCache(): void
    {
        $tenantId = TenantContext::getId();
        Cache::forget("community_rank:{$tenantId}");
        Cache::forget("community_rank_last_persist:{$tenantId}");
    }

    private function calculateReputationScore(object|null $reviewStats): float
    {
        if (!$reviewStats) {
            return 0.5;
        }

        $reviewCount = max(0, (int) ($reviewStats->review_count ?? 0));
        if ($reviewCount === 0) {
            return 0.5;
        }

        $averageRating = (float) ($reviewStats->avg_rating ?? self::BAYESIAN_PRIOR_MEAN);
        $positiveCount = max(0, (int) ($reviewStats->positive_count ?? 0));

        $bayesianAverage = (
            (self::BAYESIAN_PRIOR_STRENGTH * self::BAYESIAN_PRIOR_MEAN)
            + ($averageRating * $reviewCount)
        ) / (self::BAYESIAN_PRIOR_STRENGTH + $reviewCount);

        $bayesianScore = min(1.0, max(0.0, $bayesianAverage / 5.0));
        $wilsonScore = $this->calculateWilsonLowerBound($positiveCount, $reviewCount);

        return round((($bayesianScore * 0.55) + ($wilsonScore * 0.45)), 6);
    }

    private function calculateWilsonLowerBound(int $positiveCount, int $totalCount): float
    {
        if ($totalCount <= 0) {
            return 0.0;
        }

        $phat = $positiveCount / $totalCount;
        $z2 = self::WILSON_Z ** 2;

        $numerator = $phat + ($z2 / (2 * $totalCount))
            - self::WILSON_Z * sqrt(($phat * (1 - $phat) + ($z2 / (4 * $totalCount))) / $totalCount);
        $denominator = 1 + ($z2 / $totalCount);

        return min(1.0, max(0.0, $numerator / $denominator));
    }

    private function calculateProximityScore(
        ?float $viewerLatitude,
        ?float $viewerLongitude,
        ?float $memberLatitude,
        ?float $memberLongitude
    ): float {
        if (
            $viewerLatitude === null || $viewerLongitude === null
            || $memberLatitude === null || $memberLongitude === null
        ) {
            return self::PROXIMITY_NEUTRAL_SCORE;
        }

        $distanceKm = $this->calculateDistanceKm($viewerLatitude, $viewerLongitude, $memberLatitude, $memberLongitude);
        $distanceRatio = min(1.0, max(0.0, $distanceKm / self::PROXIMITY_MAX_DISTANCE_KM));

        return round(1.0 - $distanceRatio, 6);
    }

    private function calculateDistanceKm(
        float $lat1,
        float $lon1,
        float $lat2,
        float $lon2
    ): float {
        $earthRadiusKm = 6371.0;

        $latDelta = deg2rad($lat2 - $lat1);
        $lonDelta = deg2rad($lon2 - $lon1);
        $a = sin($latDelta / 2) ** 2
            + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($lonDelta / 2) ** 2;

        return $earthRadiusKm * (2 * atan2(sqrt($a), sqrt(1 - $a)));
    }

    /**
     * Persist the non-search ranking snapshot so admin/reporting surfaces can
     * consume CommunityRank consistently.
     *
     * @param array<int, array<string, float|int|string|null>> $ranked
     */
    private function persistCommunityRanks(int $tenantId, array $ranked): void
    {
        if (empty($ranked)) {
            return;
        }

        $timestamp = now()->toDateTimeString();
        $rows = [];
        foreach ($ranked as $index => $member) {
            $rows[] = [
                'tenant_id' => $tenantId,
                'user_id' => (int) $member['user_id'],
                'rank_score' => (float) ($member['global_score'] ?? $member['score'] ?? 0.0),
                'activity_score' => (float) ($member['activity'] ?? 0.0),
                'contribution_score' => (float) ($member['contribution'] ?? 0.0),
                'reputation_score' => (float) ($member['reputation'] ?? 0.0),
                'connectivity_score' => (float) ($member['connectivity'] ?? 0.0),
                'proximity_score' => (float) ($member['proximity'] ?? 0.0),
                'rank_position' => $index + 1,
                'tier' => $this->resolveTier((float) ($member['global_score'] ?? $member['score'] ?? 0.0)),
                'calculated_at' => $timestamp,
            ];
        }

        try {
            DB::table('community_ranks')->upsert(
                $rows,
                ['tenant_id', 'user_id'],
                ['rank_score', 'activity_score', 'contribution_score', 'reputation_score', 'connectivity_score', 'proximity_score', 'rank_position', 'tier', 'calculated_at']
            );
        } catch (\Throwable $e) {
            // Older environments may not have the rank snapshot tables yet.
        }
    }

    private function resolveTier(float $score): string
    {
        return match (true) {
            $score >= 0.85 => 'Platinum',
            $score >= 0.7 => 'Gold',
            $score >= 0.5 => 'Silver',
            default => 'Bronze',
        };
    }
}
