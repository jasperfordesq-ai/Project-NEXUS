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
 * LeaderboardSeasonService — Seasonal leaderboard management.
 *
 * Manages leaderboard seasons with auto-creation, ranking, reward distribution,
 * and user-specific season data. All methods are tenant-scoped.
 */
class LeaderboardSeasonService
{
    /**
     * Get the current active season.
     */
    public function getCurrentSeason(int $tenantId): ?array
    {
        try {
            $tableCheck = DB::select("SHOW TABLES LIKE 'leaderboard_seasons'");
            if (empty($tableCheck)) {
                return null;
            }

            // start_date/end_date are DATE columns: comparing end_date against a
            // full datetime casts the DATE to midnight, which made the season
            // invisible for its entire final day (and getOrCreateCurrentSeason
            // then inserted a duplicate season on every call that day).
            $season = DB::table('leaderboard_seasons')
                ->where('tenant_id', $tenantId)
                ->where('start_date', '<=', now()->toDateString())
                ->where('end_date', '>=', now()->toDateString())
                ->where('status', 'active')
                ->orderByDesc('start_date')
                ->first();

            return $season ? (array) $season : null;
        } catch (\Throwable $e) {
            Log::warning('[LeaderboardSeason] getCurrentSeason error: ' . $e->getMessage());
            return null;
        }
    }

    /**
     * Get season leaderboard rankings.
     */
    public function getSeasonLeaderboard(int $tenantId, int $seasonId, int $limit = 20): array
    {
        $rankings = [];

        try {
            $tableCheck = DB::select("SHOW TABLES LIKE 'season_rankings'");
            if (!empty($tableCheck)) {
                $rankings = DB::table('season_rankings as sr')
                    ->join('users as u', 'sr.user_id', '=', 'u.id')
                    ->where('sr.season_id', $seasonId)
                    ->where('u.tenant_id', $tenantId)
                    ->select('sr.*', 'u.first_name', 'u.last_name', 'u.profile_type', 'u.organization_name', 'u.avatar_url', 'u.level')
                    ->orderByDesc('sr.season_xp')
                    ->limit($limit)
                    ->get()
                    ->map(fn ($r) => (array) $r)
                    ->all();
            }
        } catch (\Throwable $e) {
            // Table may not exist
        }

        if (empty($rankings)) {
            $season = DB::table('leaderboard_seasons')->where('id', $seasonId)->where('tenant_id', $tenantId)->first();
            if ($season) {
                $rankings = $this->calculateSeasonRankings($tenantId);
            }
        }

        return $rankings;
    }

    /**
     * Get all seasons for the current tenant.
     */
    public function getAllSeasons(int $limit = 12): array
    {
        $tenantId = TenantContext::getId();

        try {
            return DB::table('leaderboard_seasons')
                ->where('tenant_id', $tenantId)
                ->orderByDesc('start_date')
                ->limit($limit)
                ->get()
                ->map(fn ($r) => (array) $r)
                ->all();
        } catch (\Throwable $e) {
            Log::warning('[LeaderboardSeason] getPastSeasons failed: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Get the current season with user-specific rank, leaderboard, and rewards.
     */
    public function getSeasonWithUserData(int $userId): ?array
    {
        $tenantId = TenantContext::getId();
        $season = $this->getOrCreateCurrentSeason($tenantId);

        if (!$season) {
            return null;
        }

        $userRank = $this->getUserSeasonRank($userId, $season['id']);
        $leaderboard = $this->getSeasonLeaderboard($tenantId, $season['id'], 10);
        $rewards = json_decode($season['rewards'] ?? '{}', true);

        $endDate = strtotime($season['end_date']);
        $daysRemaining = max(0, (int) ceil(($endDate - time()) / 86400));

        $totalParticipants = (int) DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('is_approved', 1)
            ->where(DB::raw('COALESCE(xp, 0)'), '>', 0)
            ->count();

        return [
            'season' => $season,
            'user_rank' => $userRank,
            'user_data' => $userRank ? [
                'xp_earned' => (int) ($userRank['xp_earned'] ?? $userRank['xp'] ?? $userRank['season_xp'] ?? 0),
                'rank' => $userRank['rank'] ?? null,
                'position' => $userRank['position'] ?? null,
            ] : null,
            'leaderboard' => $leaderboard,
            'rewards' => $rewards,
            'days_remaining' => $daysRemaining,
            'is_ending_soon' => $daysRemaining <= 7,
            'total_participants' => $totalParticipants,
        ];
    }

    /**
     * Get or create the current month's season.
     */
    public function getOrCreateCurrentSeason(?int $tenantId = null): ?array
    {
        $tenantId = $tenantId ?? TenantContext::getId();
        $season = $this->getCurrentSeason($tenantId);

        if (!$season) {
            try {
                $tableCheck = DB::select("SHOW TABLES LIKE 'leaderboard_seasons'");
                if (!empty($tableCheck)) {
                    $season = $this->createMonthlySeason($tenantId);
                }
            } catch (\Throwable $e) {
                Log::warning('[LeaderboardSeason] getOrCreateCurrentSeason error: ' . $e->getMessage());
                return null;
            }
        }

        return $season;
    }

    /**
     * Get user's season ranking.
     */
    public function getUserSeasonRank(int $userId, ?int $seasonId = null): ?array
    {
        $tenantId = TenantContext::getId();

        if (!$seasonId) {
            $season = $this->getCurrentSeason($tenantId);
            $seasonId = $season['id'] ?? null;
        }

        if (!$seasonId) {
            return null;
        }

        // Verify season belongs to current tenant
        $seasonRow = DB::table('leaderboard_seasons')
            ->where('id', $seasonId)
            ->where('tenant_id', $tenantId)
            ->first();
        if (!$seasonRow) {
            return null;
        }

        // Check season_rankings table
        $ranking = null;
        try {
            $tableCheck = DB::select("SHOW TABLES LIKE 'season_rankings'");
            if (!empty($tableCheck)) {
                $row = DB::table('season_rankings')
                    ->where('season_id', $seasonId)
                    ->where('user_id', $userId)
                    ->first();
                if ($row) {
                    $ranking = (array) $row;
                }
            }
        } catch (\Throwable $e) {
            Log::warning('LeaderboardSeasonService: ranking lookup failed', ['user_id' => $userId, 'season_id' => $seasonId, 'error' => $e->getMessage()]);
        }

        if ($ranking) {
            $position = (int) DB::table('season_rankings')
                ->where('season_id', $seasonId)
                ->where('season_xp', '>', $ranking['season_xp'])
                ->count() + 1;

            $ranking['position'] = $position;
            return $ranking;
        }

        // Fallback: calculate from users table
        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->select('xp')
            ->first();

        if (!$user) {
            return null;
        }

        $position = (int) DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('xp', '>', $user->xp)
            ->count() + 1;

        return [
            'user_id' => $userId,
            'season_id' => $seasonId,
            'season_xp' => $user->xp,
            'position' => $position,
        ];
    }

    // ─── Private helpers ─────────────────────────────────────────────

    private function calculateSeasonRankings(int $tenantId): array
    {
        return DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where(DB::raw('COALESCE(xp, 0)'), '>', 0)
            ->select('id as user_id', 'first_name', 'last_name', 'profile_type', 'organization_name', 'avatar_url', 'level', 'xp as season_xp')
            ->orderByDesc('xp')
            ->limit(50)
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();
    }

    private function createMonthlySeason(int $tenantId, ?int $month = null, ?int $year = null): ?array
    {
        $month = $month ?? (int) date('n');
        $year = $year ?? (int) date('Y');

        $startDate = date('Y-m-01 00:00:00', strtotime("{$year}-{$month}-01"));
        $endDate = date('Y-m-t 23:59:59', strtotime("{$year}-{$month}-01"));

        $monthNames = [
            1 => 'January', 2 => 'February', 3 => 'March', 4 => 'April',
            5 => 'May', 6 => 'June', 7 => 'July', 8 => 'August',
            9 => 'September', 10 => 'October', 11 => 'November', 12 => 'December',
        ];

        $name = $monthNames[$month] . ' ' . $year;

        // Guard against duplicate season rows for the same month (the table has
        // no unique key): a duplicate would make the nightly finalizer award
        // the season rewards once per duplicate row.
        $existing = DB::table('leaderboard_seasons')
            ->where('tenant_id', $tenantId)
            ->whereDate('start_date', substr($startDate, 0, 10))
            ->first();
        if ($existing) {
            return $existing->status === 'active' ? (array) $existing : null;
        }

        $rewards = json_encode([
            1 => ['xp' => 500, 'badge' => 'season_champion', 'title' => 'Season Champion'],
            2 => ['xp' => 300, 'badge' => 'season_runner_up', 'title' => 'Runner Up'],
            3 => ['xp' => 200, 'badge' => 'season_third', 'title' => 'Third Place'],
            'top10' => ['xp' => 100, 'badge' => 'season_top10'],
            'top25' => ['xp' => 50],
            'participant' => ['xp' => 25],
        ]);

        DB::table('leaderboard_seasons')->insert([
            'tenant_id' => $tenantId,
            'name' => $name,
            'start_date' => $startDate,
            'end_date' => $endDate,
            'rewards' => $rewards,
            'status' => 'active',
        ]);

        return $this->getCurrentSeason($tenantId);
    }
}
