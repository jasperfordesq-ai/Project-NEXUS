<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * DailyRewardService — Native Eloquent implementation for daily login rewards.
 *
 * Uses the `daily_rewards` table for reward history and the `users` table
 * for streak tracking (login_streak, last_daily_reward, longest_streak).
 */
class DailyRewardService
{
    /**
     * Base XP for daily login (matches GamificationService::XP_VALUES['daily_login']).
     */
    private const BASE_XP = 5;

    /**
     * Streak milestone bonuses: streak_day => bonus XP.
     */
    private const STREAK_BONUSES = [
        3  => 5,
        7  => 15,
        14 => 25,
        30 => 50,
        60 => 100,
        90 => 150,
    ];

    public function __construct()
    {
    }

    /**
     * Claim daily reward for a given tenant + user.
     *
     * Returns reward data array if successful, null if already claimed today.
     */
    public static function claim(int $tenantId, int $userId): ?array
    {
        $today = now()->toDateString();

        // Quick pre-check outside transaction (avoids transaction overhead for common case)
        $alreadyClaimed = DB::table('daily_rewards')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->where('reward_date', $today)
            ->exists();

        if ($alreadyClaimed) {
            return null;
        }

        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->select('login_streak', 'last_daily_reward', 'longest_streak', 'xp', 'level')
            ->first();

        if (!$user) {
            return null;
        }

        // Calculate streak
        $yesterday = now()->subDay()->toDateString();
        $lastReward = $user->last_daily_reward;
        $currentStreak = (int) ($user->login_streak ?? 0);

        if ($lastReward === $yesterday) {
            $currentStreak++;
        } else {
            $currentStreak = 1;
        }

        // Calculate XP and bonuses
        $baseXp = self::BASE_XP;
        $milestoneBonus = self::STREAK_BONUSES[$currentStreak] ?? 0;
        $totalXp = $baseXp + $milestoneBonus;

        $longestStreak = max((int) ($user->longest_streak ?? 0), $currentStreak);

        try {
            return DB::transaction(function () use ($tenantId, $userId, $today, $currentStreak, $baseXp, $milestoneBonus, $totalXp, $longestStreak) {
                // Insert daily reward record — UNIQUE KEY (tenant_id, user_id, reward_date)
                // prevents double-claim even under concurrent requests (TOCTOU protection)
                DB::table('daily_rewards')->insert([
                    'tenant_id'      => $tenantId,
                    'user_id'        => $userId,
                    'reward_date'    => $today,
                    'xp_earned'      => $totalXp,
                    'streak_day'     => $currentStreak,
                    'milestone_bonus' => $milestoneBonus,
                    'created_at'     => now(),
                    'claimed_at'     => now(),
                ]);

                // Update user streak info and XP
                DB::table('users')
                    ->where('id', $userId)
                    ->where('tenant_id', $tenantId)
                    ->update([
                        'login_streak'      => $currentStreak,
                        'last_daily_reward' => $today,
                        'longest_streak'    => $longestStreak,
                        'xp'                => DB::raw('xp + ' . (int) $totalXp),
                    ]);

                // Log XP award
                DB::table('user_xp_log')->insert([
                    'tenant_id'   => $tenantId,
                    'user_id'     => $userId,
                    'xp_amount'   => $totalXp,
                    'action'      => 'daily_login',
                    'description' => "Daily login reward (day {$currentStreak})" . ($milestoneBonus > 0 ? " + streak bonus" : ''),
                    'created_at'  => now(),
                ]);

                return [
                    'xp_earned'       => $totalXp,
                    'base_xp'         => $baseXp,
                    'milestone_bonus' => $milestoneBonus,
                    'streak_day'      => $currentStreak,
                    'longest_streak'  => $longestStreak,
                ];
            });
        } catch (\Illuminate\Database\UniqueConstraintViolationException $e) {
            // Concurrent request already claimed — return null (already claimed)
            return null;
        }
    }

    /**
     * Check whether the user can claim today's reward.
     */
    public static function canClaim(int $tenantId, int $userId): bool
    {
        return !DB::table('daily_rewards')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->where('reward_date', now()->toDateString())
            ->exists();
    }

    /**
     * Get the current streak for a user.
     */
    public static function getStreak(int $tenantId, int $userId): int
    {
        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->select('login_streak', 'last_daily_reward')
            ->first();

        if (!$user) {
            return 0;
        }

        // If the last reward was yesterday or today, the streak is still active
        $lastReward = $user->last_daily_reward;
        if ($lastReward === null) {
            return 0;
        }

        $daysSince = (int) abs(now()->startOfDay()->diffInDays(\Carbon\Carbon::parse($lastReward)->startOfDay()));
        if ($daysSince > 1) {
            return 0; // Streak broken
        }

        return (int) ($user->login_streak ?? 0);
    }

    /**
     * Get the reward configuration for a tenant.
     */
    public static function getRewardConfig(int $tenantId): array
    {
        return [
            'base_xp'         => self::BASE_XP,
            'streak_bonuses'  => self::STREAK_BONUSES,
            'max_streak_bonus' => max(self::STREAK_BONUSES),
        ];
    }

    /**
     * Check and award daily reward for a user.
     *
     * Uses TenantContext to get the tenant ID.
     * Returns reward data if awarded, null if already claimed today.
     */
    public static function checkAndAwardDailyReward(int $userId): ?array
    {
        $tenantId = TenantContext::getId();
        return self::claim($tenantId, $userId);
    }

    /**
     * Get today's reward status for a user.
     *
     * Uses TenantContext to get the tenant ID.
     */
    public static function getTodayStatus(int $userId): array
    {
        $tenantId = TenantContext::getId();
        $today = now()->toDateString();

        $todayReward = DB::table('daily_rewards')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->where('reward_date', $today)
            ->first();

        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->select('login_streak', 'last_daily_reward', 'longest_streak', 'xp')
            ->first();

        $currentStreak = self::getStreak($tenantId, $userId);
        $nextMilestone = null;
        foreach (self::STREAK_BONUSES as $day => $bonus) {
            if ($day > $currentStreak) {
                $nextMilestone = ['day' => $day, 'bonus' => $bonus];
                break;
            }
        }

        // Calculate reward_xp (XP available for today's unclaimed reward)
        $nextStreak = $todayReward !== null ? $currentStreak + 1 : max(1, $currentStreak + 1);
        $rewardXp = self::BASE_XP + (self::STREAK_BONUSES[$todayReward === null ? max(1, $currentStreak + 1) : $currentStreak] ?? 0);
        // next_reward_xp = what tomorrow's reward would be
        $nextRewardXp = self::BASE_XP + (self::STREAK_BONUSES[$todayReward !== null ? $currentStreak + 1 : max(1, $currentStreak + 1) + 1] ?? 0);

        return [
            'claimed_today'   => $todayReward !== null,
            'claimed_at'      => $todayReward->claimed_at ?? null,
            'xp_earned_today' => $todayReward ? (int) $todayReward->xp_earned : 0,
            'base_xp_today' => $todayReward ? (int) $todayReward->xp_earned - (int) $todayReward->milestone_bonus : 0,
            'milestone_bonus_today' => $todayReward ? (int) $todayReward->milestone_bonus : 0,
            'current_streak'  => $currentStreak,
            'longest_streak'  => (int) ($user->longest_streak ?? 0),
            'total_xp'        => (int) ($user->xp ?? 0),
            'next_milestone'  => $nextMilestone,
            'can_claim'       => $todayReward === null,
            'reward_xp'       => $todayReward === null ? $rewardXp : ($todayReward ? (int) $todayReward->xp_earned : self::BASE_XP),
            'next_reward_xp'  => $nextRewardXp,
            'next_claim_at'   => $todayReward !== null ? now()->addDay()->startOfDay()->toIso8601String() : null,
        ];
    }

    /**
     * Get reward history for a user.
     *
     * Uses TenantContext to get the tenant ID.
     */
    public static function getHistory(int $userId, int $limit = 30): array
    {
        $tenantId = TenantContext::getId();

        $rows = DB::table('daily_rewards')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->orderByDesc('reward_date')
            ->limit($limit)
            ->get();

        return $rows->map(function ($row) {
            return [
                'id'              => (int) $row->id,
                'reward_date'     => $row->reward_date,
                'xp_earned'       => (int) $row->xp_earned,
                'streak_day'      => (int) $row->streak_day,
                'milestone_bonus' => (int) $row->milestone_bonus,
                'claimed_at'      => $row->claimed_at,
            ];
        })->toArray();
    }

    /**
     * Get total XP earned from daily rewards.
     *
     * Uses TenantContext to get the tenant ID.
     */
    public static function getTotalEarned(int $userId): int
    {
        $tenantId = TenantContext::getId();

        return (int) DB::table('daily_rewards')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->sum('xp_earned');
    }
}
