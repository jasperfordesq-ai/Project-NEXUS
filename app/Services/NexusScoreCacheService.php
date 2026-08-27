<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Models\NexusScoreCache;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use App\Support\UserDisplayName;

/**
 * NexusScoreCacheService — Eloquent-based cache layer for Nexus Score calculations.
 *
 * Manages cached score calculations for performance. Scores are cached for 1 hour.
 * All queries are tenant-scoped via HasTenantScope trait on models.
 */
class NexusScoreCacheService
{
    public function __construct(
        private readonly NexusScoreCache $cache,
        private readonly NexusScoreService $scoreService,
        private readonly User $user,
    ) {}

    /**
     * Get cached score value (simple float).
     */
    public function get(int $tenantId, int $userId): ?float
    {
        try {
            if (! $this->cacheTableExists()) {
                return null;
            }

            $cached = $this->cache->newQuery()
                ->where('user_id', $userId)
                ->where('calculated_at', '>', now()->subHour())
                ->first();

            return $cached ? (float) $cached->total_score : null;
        } catch (\Throwable $e) {
            Log::debug('[NexusScoreCache] getSimple failed: ' . $e->getMessage());
            return null;
        }
    }

    /**
     * Set cached score value.
     */
    public function set(int $tenantId, int $userId, float $score): void
    {
        try {
            if (! $this->cacheTableExists()) {
                return;
            }

            $this->cache->newQuery()->updateOrCreate(
                ['user_id' => $userId, 'tenant_id' => $tenantId],
                [
                    'total_score'   => $score,
                    'calculated_at' => now(),
                ]
            );
        } catch (\Throwable $e) {
            Log::error('NexusScoreCache::set error: ' . $e->getMessage());
        }
    }

    /**
     * Invalidate cache for a user (simple).
     */
    public function invalidate(int $tenantId, int $userId): void
    {
        try {
            if (! $this->cacheTableExists()) {
                return;
            }

            $this->cache->newQuery()
                ->where('user_id', $userId)
                ->delete();
        } catch (\Throwable $e) {
            // Silently fail
        }
    }

    /**
     * Warm cache for all users in a tenant.
     */
    public function warmCache(int $tenantId): int
    {
        $userIds = $this->user->newQuery()
            ->where('tenant_id', $tenantId)
            ->where('is_approved', true)
            ->pluck('id');

        $count = 0;
        foreach ($userIds as $userId) {
            try {
                $this->getScore($userId, $tenantId, true);
                $count++;
            } catch (\Throwable $e) {
                continue;
            }
        }

        return $count;
    }

    /**
     * Get score from cache or calculate fresh.
     */
    public function getScore(int $userId, int $tenantId, bool $forceRecalculate = false): array
    {
        if (! $forceRecalculate) {
            $cached = $this->getCachedScore($userId, $tenantId);
            if ($cached !== null) {
                $cached['percentile'] = $this->calculateRealPercentile($userId, $tenantId, $cached['total_score']);
                return $cached;
            }
        }

        // Calculate fresh score
        $scoreData = $this->scoreService->calculateNexusScore($userId, $tenantId);

        // Cache it
        $this->cacheScore($userId, $tenantId, $scoreData);

        // Override percentile with real community data from cache table
        $scoreData['percentile'] = $this->calculateRealPercentile($userId, $tenantId, $scoreData['total_score']);

        return $scoreData;
    }

    /**
     * Invalidate cache for a user (full row delete).
     */
    public function invalidateCache(int $userId, int $tenantId): void
    {
        $this->invalidate($tenantId, $userId);
    }

    /**
     * Get leaderboard from cache.
     */
    public function getCachedLeaderboard(int $tenantId, int $limit = 10): array
    {
        try {
            if (! $this->cacheTableExists()) {
                return $this->calculateLiveLeaderboard($tenantId, $limit);
            }

            $topUsers = $this->cache->newQuery()
                ->join('users', 'nexus_score_cache.user_id', '=', 'users.id')
                ->select([
                    'nexus_score_cache.user_id',
                    DB::raw(UserDisplayName::sql('users', 'name')),
                    'users.avatar_url',
                    'nexus_score_cache.total_score as score',
                    'nexus_score_cache.tier',
                ])
                ->orderByDesc('nexus_score_cache.total_score')
                ->limit($limit)
                ->get()
                ->map(function ($user) {
                    $row = $user->toArray();
                    $row['tier'] = $this->scoreService->calculateTier($row['score']);
                    return $row;
                })
                ->all();

            $stats = $this->cache->newQuery()
                ->selectRaw('AVG(total_score) as avg_score, COUNT(*) as total_users')
                ->first();

            return [
                'top_users'         => $topUsers,
                'community_average' => round($stats->avg_score ?? 0, 1),
                'total_users'       => (int) ($stats->total_users ?? 0),
            ];
        } catch (\Throwable $e) {
            return ['top_users' => [], 'community_average' => 0, 'total_users' => 0];
        }
    }

    /**
     * Get user rank from cache.
     */
    public function getCachedRank(int $userId, int $tenantId): array
    {
        try {
            if (! $this->cacheTableExists()) {
                return $this->calculateLiveRank($userId, $tenantId);
            }

            $userScore = $this->cache->newQuery()
                ->where('user_id', $userId)
                ->value('total_score');

            if ($userScore === null) {
                return ['rank' => 0, 'score' => 0, 'total_users' => 0];
            }

            $rank = $this->cache->newQuery()
                ->where('total_score', '>', $userScore)
                ->count() + 1;

            $totalUsers = $this->cache->newQuery()->count();

            return [
                'rank'        => $rank,
                'score'       => (float) $userScore,
                'total_users' => $totalUsers,
            ];
        } catch (\Throwable $e) {
            return ['rank' => 0, 'score' => 0, 'total_users' => 0];
        }
    }

    // =========================================================================
    // PRIVATE HELPERS
    // =========================================================================

    /**
     * Check if cache table exists.
     */
    private function cacheTableExists(): bool
    {
        try {
            return Schema::hasTable('nexus_score_cache');
        } catch (\Throwable $e) {
            return false;
        }
    }

    /**
     * Get cached score data if fresh (within 1 hour).
     */
    private function getCachedScore(int $userId, int $tenantId): ?array
    {
        try {
            if (! $this->cacheTableExists()) {
                return null;
            }

            $cached = $this->cache->newQuery()
                ->where('user_id', $userId)
                ->where('tenant_id', $tenantId)
                ->where('calculated_at', '>', now()->subHour())
                ->first();

            if (! $cached) {
                return null;
            }

            // Reconstruct breakdown arrays (details are empty but percentage/score are accurate)
            $breakdown = [
                'engagement' => ['score' => (float) $cached->engagement_score, 'max' => 250, 'percentage' => round(($cached->engagement_score / 250) * 100, 1), 'details' => []],
                'quality'    => ['score' => (float) $cached->quality_score,    'max' => 200, 'percentage' => round(($cached->quality_score    / 200) * 100, 1), 'details' => []],
                'volunteer'  => ['score' => (float) $cached->volunteer_score,  'max' => 200, 'percentage' => round(($cached->volunteer_score  / 200) * 100, 1), 'details' => []],
                'activity'   => ['score' => (float) $cached->activity_score,   'max' => 150, 'percentage' => round(($cached->activity_score   / 150) * 100, 1), 'details' => []],
                'badges'     => ['score' => (float) $cached->badge_score,      'max' => 100, 'percentage' => round(($cached->badge_score      / 100) * 100, 1), 'details' => []],
                'impact'     => ['score' => (float) $cached->impact_score,     'max' => 100, 'percentage' => round(($cached->impact_score     / 100) * 100, 1), 'details' => []],
            ];

            return [
                'total_score'    => (float) $cached->total_score,
                'max_score'      => 1000,
                'percentage'     => round(($cached->total_score / 1000) * 100, 1),
                'percentile'     => (int) $cached->percentile,
                'tier'           => $this->scoreService->calculateTier($cached->total_score),
                'breakdown'      => $breakdown,
                'insights'       => $this->scoreService->generateInsights(
                    $breakdown['engagement'], $breakdown['quality'], $breakdown['volunteer'],
                    $breakdown['activity'], $breakdown['badges'], $breakdown['impact'],
                    $userId
                ),
                'next_milestone' => $this->scoreService->getNextMilestone($cached->total_score),
                'cached'         => true,
                'cached_at'      => $cached->calculated_at?->toIso8601String(),
            ];
        } catch (\Throwable $e) {
            Log::debug('[NexusScoreCache] getCachedScore failed: ' . $e->getMessage());
            return null;
        }
    }

    /**
     * Calculate real percentile from community scores in cache.
     */
    private function calculateRealPercentile(int $userId, int $tenantId, float $userScore): int
    {
        try {
            if (! $this->cacheTableExists()) {
                return 50;
            }

            $totalOthers = $this->cache->newQuery()
                ->where('tenant_id', $tenantId)
                ->where('user_id', '!=', $userId)
                ->count();

            if ($totalOthers < 2) {
                return 50;
            }

            $lowerCount = $this->cache->newQuery()
                ->where('tenant_id', $tenantId)
                ->where('user_id', '!=', $userId)
                ->where('total_score', '<', $userScore)
                ->count();

            return (int) round(($lowerCount / $totalOthers) * 100);
        } catch (\Throwable $e) {
            return 50;
        }
    }

    /**
     * Cache the calculated score.
     */
    private function cacheScore(int $userId, int $tenantId, array $scoreData): void
    {
        try {
            if (! $this->cacheTableExists()) {
                return;
            }

            $breakdown = $scoreData['breakdown'];

            $this->cache->newQuery()->updateOrCreate(
                ['user_id' => $userId, 'tenant_id' => $tenantId],
                [
                    'total_score'      => $scoreData['total_score'],
                    'engagement_score' => $breakdown['engagement']['score'],
                    'quality_score'    => $breakdown['quality']['score'],
                    'volunteer_score'  => $breakdown['volunteer']['score'],
                    'activity_score'   => $breakdown['activity']['score'],
                    'badge_score'      => $breakdown['badges']['score'],
                    'impact_score'     => $breakdown['impact']['score'],
                    'percentile'       => $scoreData['percentile'],
                    'tier'             => $scoreData['tier']['name'],
                    'calculated_at'    => now(),
                ]
            );
        } catch (\Throwable $e) {
            Log::error('Score cache error: ' . $e->getMessage());
        }
    }

    /**
     * Calculate live leaderboard (fallback when cache empty).
     */
    private function calculateLiveLeaderboard(int $tenantId, int $limit = 10): array
    {
        try {
            $users = $this->user->newQuery()
                ->where('tenant_id', $tenantId)
                ->where('is_approved', true)
                ->select(['id', 'first_name', 'last_name', 'profile_type', 'organization_name', 'avatar_url'])
                ->limit(100)
                ->get();

            if ($users->isEmpty()) {
                return ['top_users' => [], 'community_average' => 0, 'total_users' => 0];
            }

            $userScores = [];
            $totalScore = 0;

            foreach ($users as $user) {
                try {
                    $scoreData = $this->scoreService->calculateNexusScore($user->id, $tenantId);
                    $userScores[] = [
                        'user_id'    => $user->id,
                        'name'       => UserDisplayName::resolve($user),
                        'avatar_url' => $user->avatar_url,
                        'score'      => $scoreData['total_score'],
                        'tier'       => $scoreData['tier'],
                    ];
                    $totalScore += $scoreData['total_score'];
                } catch (\Throwable $e) {
                    continue;
                }
            }

            usort($userScores, fn ($a, $b) => $b['score'] <=> $a['score']);
            $topUsers = array_slice($userScores, 0, $limit);
            $totalUsers = count($userScores);
            $communityAverage = $totalUsers > 0 ? round($totalScore / $totalUsers, 1) : 0;

            return [
                'top_users'         => $topUsers,
                'community_average' => $communityAverage,
                'total_users'       => $totalUsers,
            ];
        } catch (\Throwable $e) {
            Log::error('Live leaderboard calculation error: ' . $e->getMessage());
            return ['top_users' => [], 'community_average' => 0, 'total_users' => 0];
        }
    }

    /**
     * Calculate live rank (fallback when cache empty).
     */
    private function calculateLiveRank(int $userId, int $tenantId): array
    {
        try {
            $userScoreData = $this->scoreService->calculateNexusScore($userId, $tenantId);
            $userScore = $userScoreData['total_score'];

            $users = $this->user->newQuery()
                ->where('tenant_id', $tenantId)
                ->where('is_approved', true)
                ->limit(100)
                ->pluck('id');

            $higherScoreCount = 0;
            foreach ($users as $id) {
                if ($id == $userId) {
                    continue;
                }
                try {
                    $otherScore = $this->scoreService->calculateNexusScore($id, $tenantId);
                    if ($otherScore['total_score'] > $userScore) {
                        $higherScoreCount++;
                    }
                } catch (\Throwable $e) {
                    continue;
                }
            }

            return [
                'rank'        => $higherScoreCount + 1,
                'score'       => $userScore,
                'total_users' => $users->count(),
            ];
        } catch (\Throwable $e) {
            Log::error('Live rank calculation error: ' . $e->getMessage());
            return ['rank' => 0, 'score' => 0, 'total_users' => 0];
        }
    }
}
