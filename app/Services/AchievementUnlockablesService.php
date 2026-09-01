<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * AchievementUnlockablesService — Eloquent/DB query builder service for profile unlockables.
 *
 * Manages profile themes, avatar frames, and other rewards unlocked through achievements.
 * Uses DB::table() for user_active_unlockables and static data for unlockable definitions.
 */
class AchievementUnlockablesService
{
    /**
     * Unlockable types.
     */
    public const TYPES = [
        'theme' => 'Profile Theme',
        'avatar_frame' => 'Avatar Frame',
        'badge_style' => 'Badge Display Style',
        'profile_banner' => 'Profile Banner',
        'name_color' => 'Name Color',
        'special_emoji' => 'Special Emoji',
    ];

    /**
     * Get all available unlockables with their requirements.
     */
    public static function getAllUnlockables(): array
    {
        return [
            'themes' => [
                'theme_dark_gold' => [
                    'name' => 'Dark Gold', 'type' => 'theme',
                    'preview' => ['primary' => '#1e1e2e', 'accent' => '#fbbf24', 'text' => '#ffffff'],
                    'requirement' => ['type' => 'level', 'value' => 10],
                    'description' => 'Elegant dark theme with gold accents',
                ],
                'theme_ocean' => [
                    'name' => 'Ocean Blue', 'type' => 'theme',
                    'preview' => ['primary' => '#0c4a6e', 'accent' => '#38bdf8', 'text' => '#ffffff'],
                    'requirement' => ['type' => 'level', 'value' => 15],
                    'description' => 'Calm ocean-inspired theme',
                ],
                'theme_forest' => [
                    'name' => 'Forest', 'type' => 'theme',
                    'preview' => ['primary' => '#14532d', 'accent' => '#4ade80', 'text' => '#ffffff'],
                    'requirement' => ['type' => 'badge', 'value' => 'volunteer_5'],
                    'description' => 'Natural forest-inspired theme',
                ],
                'theme_sunset' => [
                    'name' => 'Sunset', 'type' => 'theme',
                    'preview' => ['primary' => '#7c2d12', 'accent' => '#fb923c', 'text' => '#ffffff'],
                    'requirement' => ['type' => 'level', 'value' => 20],
                    'description' => 'Warm sunset colors',
                ],
                'theme_royal' => [
                    'name' => 'Royal Purple', 'type' => 'theme',
                    'preview' => ['primary' => '#581c87', 'accent' => '#c084fc', 'text' => '#ffffff'],
                    'requirement' => ['type' => 'level', 'value' => 25],
                    'description' => 'Majestic purple theme',
                ],
                'theme_legendary' => [
                    'name' => 'Legendary', 'type' => 'theme',
                    'preview' => ['primary' => '#000000', 'accent' => 'linear-gradient(135deg, #fbbf24, #f59e0b, #ef4444)', 'text' => '#ffffff'],
                    'requirement' => ['type' => 'level', 'value' => 50],
                    'description' => 'For true legends only',
                ],
            ],
            'frames' => [
                'frame_bronze' => [
                    'name' => 'Bronze Ring', 'type' => 'avatar_frame',
                    'css' => 'border: 3px solid #cd7f32; border-radius: 50%;',
                    'requirement' => ['type' => 'level', 'value' => 5],
                    'description' => 'Simple bronze frame',
                ],
                'frame_silver' => [
                    'name' => 'Silver Ring', 'type' => 'avatar_frame',
                    'css' => 'border: 3px solid #c0c0c0; border-radius: 50%; box-shadow: 0 0 10px rgba(192,192,192,0.5);',
                    'requirement' => ['type' => 'level', 'value' => 10],
                    'description' => 'Shiny silver frame',
                ],
                'frame_gold' => [
                    'name' => 'Gold Ring', 'type' => 'avatar_frame',
                    'css' => 'border: 4px solid #ffd700; border-radius: 50%; box-shadow: 0 0 15px rgba(255,215,0,0.6);',
                    'requirement' => ['type' => 'level', 'value' => 20],
                    'description' => 'Prestigious gold frame',
                ],
                'frame_diamond' => [
                    'name' => 'Diamond', 'type' => 'avatar_frame',
                    'css' => 'border: 4px solid #b9f2ff; border-radius: 50%; box-shadow: 0 0 20px rgba(185,242,255,0.8), inset 0 0 10px rgba(185,242,255,0.3);',
                    'requirement' => ['type' => 'level', 'value' => 30],
                    'description' => 'Sparkling diamond frame',
                ],
                'frame_fire' => [
                    'name' => 'Fire Ring', 'type' => 'avatar_frame',
                    'css' => 'border: 4px solid #ef4444; border-radius: 50%; box-shadow: 0 0 20px rgba(239,68,68,0.7); animation: fireGlow 1.5s ease-in-out infinite;',
                    'requirement' => ['type' => 'badge', 'value' => 'streak_30'],
                    'description' => 'Burning fire effect',
                ],
                'frame_rainbow' => [
                    'name' => 'Rainbow', 'type' => 'avatar_frame',
                    'css' => 'border: 4px solid transparent; border-radius: 50%; background: linear-gradient(white, white) padding-box, linear-gradient(135deg, #ef4444, #f97316, #fbbf24, #22c55e, #3b82f6, #8b5cf6) border-box; animation: rainbowRotate 3s linear infinite;',
                    'requirement' => ['type' => 'badges_count', 'value' => 20],
                    'description' => 'Animated rainbow frame',
                ],
            ],
            'name_colors' => [
                'color_gold' => [
                    'name' => 'Gold Name', 'type' => 'name_color',
                    'css' => 'color: #fbbf24; text-shadow: 0 0 10px rgba(251,191,36,0.5);',
                    'requirement' => ['type' => 'level', 'value' => 15],
                    'description' => 'Display your name in gold',
                ],
                'color_purple' => [
                    'name' => 'Purple Name', 'type' => 'name_color',
                    'css' => 'color: #a855f7; text-shadow: 0 0 10px rgba(168,85,247,0.5);',
                    'requirement' => ['type' => 'level', 'value' => 25],
                    'description' => 'Display your name in purple',
                ],
                'color_rainbow' => [
                    'name' => 'Rainbow Name', 'type' => 'name_color',
                    'css' => 'background: linear-gradient(90deg, #ef4444, #f97316, #fbbf24, #22c55e, #3b82f6, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;',
                    'requirement' => ['type' => 'level', 'value' => 50],
                    'description' => 'Animated rainbow name',
                ],
            ],
            'banners' => [
                'banner_stars' => [
                    'name' => 'Starry Night', 'type' => 'profile_banner',
                    'image' => '/assets/img/banners/stars.jpg',
                    'css' => 'background: linear-gradient(135deg, #1e1e2e 0%, #2d2d44 100%);',
                    'requirement' => ['type' => 'level', 'value' => 10],
                    'description' => 'Beautiful starry banner',
                ],
                'banner_gradient' => [
                    'name' => 'Vibrant Gradient', 'type' => 'profile_banner',
                    'css' => 'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);',
                    'requirement' => ['type' => 'level', 'value' => 15],
                    'description' => 'Colorful gradient banner',
                ],
                'banner_champion' => [
                    'name' => 'Champion', 'type' => 'profile_banner',
                    'css' => 'background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 50%, #d97706 100%);',
                    'requirement' => ['type' => 'badge', 'value' => 'leaderboard_1'],
                    'description' => 'For #1 leaderboard finishers',
                ],
            ],
            'special_emojis' => [
                'emoji_crown' => [
                    'name' => 'Crown', 'type' => 'special_emoji', 'emoji' => '👑',
                    'requirement' => ['type' => 'level', 'value' => 30],
                    'description' => 'Display a crown next to your name',
                ],
                'emoji_star' => [
                    'name' => 'Star', 'type' => 'special_emoji', 'emoji' => '⭐',
                    'requirement' => ['type' => 'level', 'value' => 20],
                    'description' => 'Display a star next to your name',
                ],
                'emoji_fire' => [
                    'name' => 'Fire', 'type' => 'special_emoji', 'emoji' => '🔥',
                    'requirement' => ['type' => 'badge', 'value' => 'streak_7'],
                    'description' => 'For streak masters',
                ],
                'emoji_diamond' => [
                    'name' => 'Diamond', 'type' => 'special_emoji', 'emoji' => '💎',
                    'requirement' => ['type' => 'level', 'value' => 50],
                    'description' => 'Rare diamond status',
                ],
            ],
        ];
    }

    /**
     * Get unlockables available to a user.
     */
    public static function getUserUnlockables(int $userId): array
    {
        $allUnlockables = self::getAllUnlockables();
        $userLevel = self::getUserLevel($userId);
        $userBadges = self::getUserBadgeKeys($userId);
        $badgeCount = count($userBadges);

        $available = [];
        $locked = [];

        foreach ($allUnlockables as $category => $items) {
            foreach ($items as $key => $item) {
                $isUnlocked = self::checkRequirement($item['requirement'], $userLevel, $userBadges, $badgeCount);

                $item['key'] = $key;
                $item['category'] = $category;
                $item['unlocked'] = $isUnlocked;

                if ($isUnlocked) {
                    $available[$category][$key] = $item;
                } else {
                    $locked[$category][$key] = $item;
                }
            }
        }

        return [
            'available' => $available,
            'locked' => $locked,
        ];
    }

    /**
     * Get user's active unlockables (what they have equipped).
     */
    public static function getUserActiveUnlockables(int $userId): array
    {
        // user_active_unlockables has no tenant_id column: a user belongs to
        // exactly one tenant, so user_id already scopes the row. Filtering on a
        // tenant_id here threw "Unknown column" on every call.
        $result = DB::table('user_active_unlockables')
            ->where('user_id', $userId)
            ->select(['unlockable_type', 'unlockable_key'])
            ->get();

        $active = [];
        foreach ($result as $row) {
            $active[$row->unlockable_type] = $row->unlockable_key;
        }

        return $active;
    }

    /**
     * Set a user's active unlockable.
     */
    public static function setActiveUnlockable(int $userId, string $type, string $key): bool
    {
        // Verify user has unlocked this item
        $unlockables = self::getUserUnlockables($userId);
        $found = false;

        foreach ($unlockables['available'] as $category => $items) {
            if (isset($items[$key])) {
                $found = true;
                break;
            }
        }

        if (!$found) {
            return false;
        }

        // Upsert the active unlockable. The conflict target must match the real
        // unique index, `unique_user_type` (user_id, unlockable_type); the table
        // carries no tenant_id, and naming one made every write fail.
        DB::table('user_active_unlockables')->upsert(
            [
                'user_id' => $userId,
                'unlockable_type' => $type,
                'unlockable_key' => $key,
                'activated_at' => now(),
            ],
            ['user_id', 'unlockable_type'],
            ['unlockable_key', 'activated_at']
        );

        return true;
    }

    /**
     * Remove an active unlockable.
     */
    public static function removeActiveUnlockable(int $userId, string $type): bool
    {
        DB::table('user_active_unlockables')
            ->where('user_id', $userId)
            ->where('unlockable_type', $type)
            ->delete();

        return true;
    }

    /**
     * Check if a requirement is met.
     */
    private static function checkRequirement(array $requirement, int $userLevel, array $userBadges, int $badgeCount): bool
    {
        return match ($requirement['type']) {
            'level' => $userLevel >= $requirement['value'],
            'badge' => in_array($requirement['value'], $userBadges),
            'badges_count' => $badgeCount >= $requirement['value'],
            default => false,
        };
    }

    /**
     * Get user's current level.
     */
    private static function getUserLevel(int $userId): int
    {
        $tenantId = TenantContext::getId();

        $result = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->first(['level']);

        return (int) ($result->level ?? 1);
    }

    /**
     * Get user's badge keys.
     */
    private static function getUserBadgeKeys(int $userId): array
    {
        $tenantId = TenantContext::getId();

        return DB::table('user_badges')
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->pluck('badge_key')
            ->all();
    }
}
