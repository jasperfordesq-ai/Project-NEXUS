<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\UserStreak;
use Illuminate\Support\Facades\Log;

/**
 * StreakService — Eloquent-based service for user streaks.
 *
 * Manages login, activity, giving, and volunteer streaks.
 * All queries are tenant-scoped via HasTenantScope trait on models.
 */
class StreakService
{
    public const STREAK_TYPES = ['login', 'activity', 'giving', 'volunteer'];

    public function __construct(
        private readonly UserStreak $userStreak,
        private readonly GamificationService $gamificationService,
    ) {}

    /**
     * Get current streak for a user and type.
     */
    public static function getCurrentStreak(int $tenantId, int $userId): int
    {
        return (int) (UserStreak::query()
            ->where('user_id', $userId)
            ->where('streak_type', 'activity')
            ->value('current_streak') ?? 0);
    }

    /**
     * Record activity and update streak.
     */
    public static function recordActivity(int $tenantId, int $userId): bool
    {
        $result = self::updateStreak($userId, 'activity');
        return $result !== false;
    }

    /**
     * Get longest streak for a user.
     */
    public static function getLongestStreak(int $tenantId, int $userId): int
    {
        return (int) (UserStreak::query()
            ->where('user_id', $userId)
            ->where('streak_type', 'activity')
            ->value('longest_streak') ?? 0);
    }

    /**
     * Get streak leaderboard.
     */
    public static function getStreakLeaderboard(int $tenantId, int $limit = 10): array
    {
        return UserStreak::query()
            ->join('users', 'user_streaks.user_id', '=', 'users.id')
            ->where('users.tenant_id', $tenantId)
            ->where('user_streaks.streak_type', 'login')
            ->where('user_streaks.current_streak', '>', 0)
            ->select([
                'user_streaks.*',
                'users.first_name', 'users.last_name', 'users.profile_type', 'users.organization_name',
                'users.avatar_url', 'users.name',
            ])
            ->orderByDesc('user_streaks.current_streak')
            ->orderByDesc('user_streaks.longest_streak')
            ->limit($limit)
            ->get()
            ->toArray();
    }

    /**
     * Get all streaks for a user (all types).
     */
    public static function getAllStreaks(int $userId): array
    {
        $streaks = [];
        foreach (self::STREAK_TYPES as $type) {
            $streaks[$type] = self::getStreak($userId, $type);
        }
        return $streaks;
    }

    /**
     * Get streak icon based on length.
     */
    public static function getStreakIcon(int $streakLength): string
    {
        if ($streakLength >= 365) { return "\xF0\x9F\x94\xA5\xF0\x9F\x8F\x86"; }
        if ($streakLength >= 100) { return "\xF0\x9F\x94\xA5\xF0\x9F\x92\x8E"; }
        if ($streakLength >= 30) { return "\xF0\x9F\x94\xA5\xE2\xAD\x90"; }
        if ($streakLength >= 7) { return "\xF0\x9F\x94\xA5"; }
        if ($streakLength > 0) { return "\xE2\x9C\xA8"; }
        return "\xF0\x9F\x92\xA4";
    }

    /**
     * Get streak status message for display.
     */
    public static function getStreakMessage(?array $streak): string
    {
        if (! $streak || ($streak['current'] ?? 0) === 0) {
            return 'Start your streak today!';
        }

        $current = $streak['current'];

        if ($current >= 365) {
            return "Incredible! $current day streak! You're a legend!";
        } elseif ($current >= 100) {
            return "Amazing! $current day streak! Keep it up!";
        } elseif ($current >= 30) {
            return "Fantastic! $current day streak!";
        } elseif ($current >= 7) {
            return "Great job! $current day streak!";
        }

        return "$current day streak - keep going!";
    }

    /**
     * Get user's current streak for a specific type.
     */
    public static function getStreak(int $userId, string $streakType = 'activity'): ?array
    {
        try {
            $streak = UserStreak::query()
                ->where('user_id', $userId)
                ->where('streak_type', $streakType)
                ->first();

            if (! $streak) {
                return [
                    'current'       => 0,
                    'longest'       => 0,
                    'last_activity' => null,
                    'is_active'     => false,
                ];
            }

            $lastDate = $streak->last_activity_date?->toDateString();
            $today = now()->toDateString();
            $yesterday = now()->subDay()->toDateString();

            $isActive = ($lastDate === $today || $lastDate === $yesterday);

            return [
                'current'       => $streak->current_streak,
                'longest'       => $streak->longest_streak,
                'last_activity' => $lastDate,
                'is_active'     => $isActive,
            ];
        } catch (\Throwable $e) {
            Log::error('Get Streak Error: ' . $e->getMessage());
            return null;
        }
    }

    /**
     * Record login streak specifically.
     */
    public static function recordLogin(int $userId): array|false
    {
        return self::updateStreak($userId, 'login');
    }

    // =========================================================================
    // PRIVATE HELPERS
    // =========================================================================

    /**
     * Core streak update logic — handles creation, continuation, and reset.
     */
    private static function updateStreak(int $userId, string $streakType): array|false
    {
        if (! in_array($streakType, self::STREAK_TYPES)) {
            return false;
        }

        try {
            $today = now()->toDateString();

            $streak = UserStreak::query()
                ->where('user_id', $userId)
                ->where('streak_type', $streakType)
                ->first();

            if (! $streak) {
                // First activity — create streak record
                UserStreak::create([
                    'user_id'            => $userId,
                    'streak_type'        => $streakType,
                    'current_streak'     => 1,
                    'longest_streak'     => 1,
                    'last_activity_date' => $today,
                ]);

                GamificationService::checkStreakBadges($userId, 1);
                return ['current' => 1, 'longest' => 1, 'is_new' => true];
            }

            $lastDate = $streak->last_activity_date?->toDateString();
            $currentStreak = $streak->current_streak;
            $longestStreak = $streak->longest_streak;

            // Already recorded today
            if ($lastDate === $today) {
                return [
                    'current' => $currentStreak,
                    'longest' => $longestStreak,
                    'is_new'  => false,
                    'message' => __('svc_notifications_2.streak.already_recorded'),
                ];
            }

            $yesterday = now()->subDay()->toDateString();

            if ($lastDate === $yesterday) {
                // Consecutive day
                $currentStreak++;
                $longestStreak = max($longestStreak, $currentStreak);
            } else {
                // Streak broken — reset to 1
                $currentStreak = 1;
            }

            $streak->current_streak = $currentStreak;
            $streak->longest_streak = $longestStreak;
            $streak->last_activity_date = $today;
            $streak->save();

            // Check for streak badges
            GamificationService::checkStreakBadges($userId, $currentStreak);

            // Award XP for daily login streak
            if ($streakType === 'login') {
                GamificationService::awardXP(
                    $userId,
                    GamificationService::XP_VALUES['daily_login'],
                    'daily_login',
                    "Day $currentStreak streak"
                );
            }

            return [
                'current' => $currentStreak,
                'longest' => $longestStreak,
                'is_new'  => true,
            ];
        } catch (\Throwable $e) {
            Log::error('Streak Error: ' . $e->getMessage());
            return false;
        }
    }
}
