<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\Connection;
use App\Models\Event;
use App\Models\EventRsvp;
use App\Models\FeedPost;
use App\Models\Group;
use App\Models\GroupMember;
use App\Models\Listing;
use App\Models\Message;
use App\Models\Notification;
use App\Models\Review;
use App\Models\Transaction;
use App\Models\User;
use App\Models\UserBadge;
use App\Models\UserStreak;
use App\Models\UserXpLog;
use App\Models\VolLog;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Services\BadgeDefinitionService;
use App\Services\GamificationRealtimeService;
use App\Support\UserDisplayName;

/**
 * GamificationService — Eloquent-based service for gamification.
 *
 * XP is tracked on the users table (xp/points column). Badges in user_badges.
 * All queries are tenant-scoped via HasTenantScope trait on models.
 */
class GamificationService
{
    public const XP_VALUES = [
        'send_credits'         => 10,
        'receive_credits'      => 5,
        'volunteer_hour'       => 20,
        'create_listing'       => 15,
        'complete_transaction' => 25,
        'leave_review'         => 10,
        'attend_event'         => 15,
        'create_event'         => 30,
        'join_group'           => 10,
        'create_group'         => 50,
        'create_post'          => 5,
        'daily_login'          => 5,
        'complete_profile'     => 50,
        'earn_badge'           => 25,
        'vote_poll'            => 2,
        'send_message'         => 2,
        'make_connection'      => 10,
        'complete_goal'        => 10,
        'venue_visit'          => 10,
        'event_attendance_verified' => 15,
    ];

    public const LEVEL_THRESHOLDS = [
        1 => 0, 2 => 100, 3 => 300, 4 => 600, 5 => 1000,
        6 => 1500, 7 => 2200, 8 => 3000, 9 => 4000, 10 => 5500,
        11 => 7500, 12 => 10000, 13 => 13000, 14 => 16500, 15 => 20500,
        16 => 25000, 17 => 30000, 18 => 36000, 19 => 43000, 20 => 51000,
        21 => 60000, 22 => 70000, 23 => 82000, 24 => 95000, 25 => 110000,
    ];

    /**
     * V2 Level Thresholds — 10 named levels (gamification redesign).
     * Selected via tenant config. Old 25-level system preserved as V1 fallback.
     */
    public const LEVEL_THRESHOLDS_V2 = [
        1  => ['xp' => 0,      'name' => 'Newcomer'],
        2  => ['xp' => 100,    'name' => 'Explorer'],
        3  => ['xp' => 500,    'name' => 'Contributor'],
        4  => ['xp' => 1500,   'name' => 'Helper'],
        5  => ['xp' => 3500,   'name' => 'Builder'],
        6  => ['xp' => 7000,   'name' => 'Advocate'],
        7  => ['xp' => 15000,  'name' => 'Leader'],
        8  => ['xp' => 30000,  'name' => 'Champion'],
        9  => ['xp' => 60000,  'name' => 'Pillar'],
        10 => ['xp' => 100000, 'name' => 'Legend'],
    ];

    /**
     * V2 XP Values — simplified, removing trivial actions (gamification redesign).
     * Deprecated actions log a notice and award 0 XP.
     */
    public const XP_VALUES_V2 = [
        'complete_transaction' => 25,
        'volunteer_hour'       => 20,
        'create_listing'       => 15,
        'create_event'         => 30,
        'create_group'         => 50,
        'attend_event'         => 15,
        'leave_review'         => 10,
        'make_connection'      => 10,
        'complete_profile'     => 50,
        'earn_badge'           => 25,
        'complete_goal'        => 10,
        'venue_visit'          => 10,
        'event_attendance_verified' => 15,
    ];

    /**
     * Get level name for a given level number (V2 system).
     */
    /**
     * Get level name for a given level number.
     * Maps V1 levels (1-25) to V2 named levels (1-10) by finding the closest match.
     */
    public static function getLevelName(int $level): string
    {
        // Direct V2 match
        if (isset(self::LEVEL_THRESHOLDS_V2[$level])) {
            return self::LEVEL_THRESHOLDS_V2[$level]['name'];
        }

        // V1 level > 10: map to closest V2 level by XP threshold
        $xp = self::LEVEL_THRESHOLDS[$level] ?? 0;
        $v2Level = 1;
        foreach (self::LEVEL_THRESHOLDS_V2 as $lvl => $data) {
            if ($xp >= $data['xp']) {
                $v2Level = $lvl;
            }
        }
        return self::LEVEL_THRESHOLDS_V2[$v2Level]['name'];
    }

    /**
     * Cache for badge definitions to avoid repeated array creation.
     */
    private static ?array $badgeDefinitionsCache = null;

    public function __construct(
        private readonly User $user,
        private readonly UserBadge $userBadge,
    ) {}

    // =========================================================================
    // PROFILE & LEADERBOARD (already Eloquent, kept as-is)
    // =========================================================================

    /**
     * Get gamification profile for a user (XP, level, badge count, showcased badges).
     */
    public static function getProfile(int $userId, ?int $tenantId = null): array
    {
        $tenantId = $tenantId ?? TenantContext::getId();
        $user = User::query()
            ->where('tenant_id', $tenantId)
            ->find($userId, ['id', 'first_name', 'last_name', 'avatar_url', 'xp', 'level', 'points']);

        if (! $user) {
            return [];
        }

        $xp = (int) ($user->xp ?? $user->points ?? 0);
        $level = (int) ($user->level ?? 1);

        // Recalculate level from XP
        foreach (self::LEVEL_THRESHOLDS as $lvl => $threshold) {
            if ($xp >= $threshold) {
                $level = $lvl;
            }
        }

        $nextThreshold = self::LEVEL_THRESHOLDS[$level + 1] ?? null;
        $currentThreshold = self::LEVEL_THRESHOLDS[$level] ?? 0;
        $progress = $nextThreshold
            ? min(100, round(($xp - $currentThreshold) / ($nextThreshold - $currentThreshold) * 100, 1))
            : 100;

        $badgeCount = UserBadge::where('user_id', $userId)->count();
        $showcased = UserBadge::query()
            ->where('user_id', $userId)
            ->where('is_showcased', true)
            ->orderBy('showcase_order')
            ->get()
            ->toArray();

        // Enrich showcased with badge definitions
        foreach ($showcased as &$badge) {
            $def = self::getBadgeByKey($badge['badge_key']);
            if ($def) {
                $badge = array_merge($badge, $def);
            }
        }

        return [
            'user' => [
                'id'         => $user->id,
                'name'       => UserDisplayName::resolve($user),
                'avatar_url' => $user->avatar_url,
            ],
            'xp'               => $xp,
            'level'            => $level,
            'level_name'       => self::getLevelName($level),
            'level_progress'   => [
                'current_xp'            => $xp,
                'xp_for_current_level'  => $currentThreshold,
                'xp_for_next_level'     => $nextThreshold ?? $currentThreshold,
                'progress_percentage'   => $progress,
            ],
            'badges_count'     => $badgeCount,
            'showcased_badges' => $showcased,
            'xp_values'        => self::XP_VALUES,
            'level_thresholds' => self::LEVEL_THRESHOLDS,
        ];
    }

    /**
     * Get all badges earned by a user, enriched with definitions.
     */
    public static function getBadges(int $userId, ?int $tenantId = null): array
    {
        $tenantId = $tenantId ?? TenantContext::getId();
        $badges = UserBadge::query()
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->orderByDesc('awarded_at')
            ->get()
            ->toArray();

        foreach ($badges as &$badge) {
            $def = self::getBadgeByKey($badge['badge_key']);
            if ($def) {
                $badge = array_merge($badge, $def);
                $badge['description'] = $badge['msg'] ?? $badge['description'] ?? null;
            }
        }

        return $badges;
    }

    /**
     * Get XP leaderboard for the current tenant.
     */
    public static function getLeaderboard(?int $tenantId = null, string $period = 'all_time', int $limit = 20): array
    {
        // Default to the caller's tenant if not explicitly passed. Without this
        // scope the leaderboard aggregates users across every tenant on the
        // platform — a cross-tenant data leak that also breaks per-tenant
        // gamification semantics.
        $tenantId = $tenantId ?? \App\Core\TenantContext::getId();

        $query = User::query()
            ->select(['id', 'first_name', 'last_name', 'profile_type', 'organization_name', 'avatar_url', 'xp', 'level', 'points'])
            ->where('tenant_id', $tenantId)
            ->where('is_approved', true);

        $query->orderByRaw('COALESCE(xp, points, 0) DESC')
              ->limit($limit);

        return $query->get()
            ->map(fn (User $u, int $i) => [
                'position'        => $i + 1,
                'user'            => [
                    'id'         => $u->id,
                    'name'       => UserDisplayName::resolve($u),
                    'avatar_url' => $u->avatar_url,
                ],
                'xp'              => (int) ($u->xp ?? $u->points ?? 0),
                'level'           => (int) ($u->level ?? 1),
                'score'           => (float) ($u->xp ?? $u->points ?? 0),
                'is_current_user' => false,
            ])
            ->all();
    }

    /**
     * Claim daily login reward (idempotent per calendar day).
     */
    public static function claimDailyReward(int $userId, ?int $tenantId = null): ?array
    {
        // Delegate to DailyRewardService — the canonical daily reward implementation
        // with streak tracking, milestone bonuses, and proper tenant scoping.
        $tenantId = $tenantId ?? TenantContext::getId();
        $result = DailyRewardService::claim($tenantId, $userId);

        if ($result === null) {
            return null;
        }

        // Adapt return format for callers expecting the legacy shape
        return [
            'claimed'         => true,
            'reward'          => [
                'xp'              => $result['xp_earned'],
                'base_xp'         => $result['base_xp'],
                'milestone_bonus' => $result['milestone_bonus'],
                'streak_day'      => $result['streak_day'],
                'longest_streak'  => $result['longest_streak'],
            ],
        ];
    }

    // =========================================================================
    // BADGE DEFINITIONS (static, no DB needed)
    // =========================================================================

    /**
     * Get all badge definitions — uses DB-backed definitions when available,
     * falls back to static definitions for backward compatibility.
     */
    public static function getBadgeDefinitions(): array
    {
        // Try DB-backed definitions first (post-migration)
        if (BadgeDefinitionService::isSeeded()) {
            $dbBadges = BadgeDefinitionService::getEnabledBadges();
            if (! empty($dbBadges)) {
                return $dbBadges;
            }
        }

        // Fallback to hardcoded definitions (pre-migration safety)
        return self::getStaticBadgeDefinitions();
    }

    /**
     * Static accessor for badge definitions (used by other services).
     */
    public static function getStaticBadgeDefinitions(): array
    {
        if (self::$badgeDefinitionsCache !== null) {
            return self::$badgeDefinitionsCache;
        }

        self::$badgeDefinitionsCache = [
            // VOLUNTEERING BADGES
            ['key' => 'vol_1h',    'name' => 'First Steps',       'icon' => "\xF0\x9F\x91\xA3", 'type' => 'vol', 'threshold' => 1, 'msg' => 'logging your first volunteer hour'],
            ['key' => 'vol_10h',   'name' => 'Helping Hand',      'icon' => "\xF0\x9F\xA4\xB2", 'type' => 'vol', 'threshold' => 10, 'msg' => 'volunteering 10 hours'],
            ['key' => 'vol_50h',   'name' => 'Change Maker',      'icon' => "\xF0\x9F\x8C\x8D", 'type' => 'vol', 'threshold' => 50, 'msg' => 'volunteering 50 hours'],
            ['key' => 'vol_100h',  'name' => 'TimeBank Legend',   'icon' => "\xF0\x9F\x91\x91", 'type' => 'vol', 'threshold' => 100, 'msg' => 'volunteering 100 hours'],
            ['key' => 'vol_250h',  'name' => 'Volunteer Hero',    'icon' => "\xF0\x9F\xA6\xB8", 'type' => 'vol', 'threshold' => 250, 'msg' => 'volunteering 250 hours'],
            ['key' => 'vol_500h',  'name' => 'Volunteer Champion','icon' => "\xF0\x9F\x8F\x85", 'type' => 'vol', 'threshold' => 500, 'msg' => 'volunteering 500 hours'],

            // LISTING BADGES (Offers)
            ['key' => 'offer_1',   'name' => 'First Offer',       'icon' => "\xF0\x9F\x8E\x81", 'type' => 'offer', 'threshold' => 1, 'msg' => 'posting your first offer'],
            ['key' => 'offer_5',   'name' => 'Generous Soul',     'icon' => "\xF0\x9F\xA4\x9D", 'type' => 'offer', 'threshold' => 5, 'msg' => 'posting 5 offers'],
            ['key' => 'offer_10',  'name' => 'Gift Giver',        'icon' => "\xF0\x9F\x8E\x80", 'type' => 'offer', 'threshold' => 10, 'msg' => 'posting 10 offers'],
            ['key' => 'offer_25',  'name' => 'Offer Master',      'icon' => "\xF0\x9F\x8C\x9F", 'type' => 'offer', 'threshold' => 25, 'msg' => 'posting 25 offers'],

            // LISTING BADGES (Requests)
            ['key' => 'request_1', 'name' => 'First Request',     'icon' => "\xF0\x9F\x99\x8B", 'type' => 'request', 'threshold' => 1, 'msg' => 'posting your first request'],
            ['key' => 'request_5', 'name' => 'Community Seeker',  'icon' => "\xF0\x9F\x97\xA3\xEF\xB8\x8F", 'type' => 'request', 'threshold' => 5, 'msg' => 'making 5 requests'],
            ['key' => 'request_10','name' => 'Active Requester',  'icon' => "\xF0\x9F\x93\xA2", 'type' => 'request', 'threshold' => 10, 'msg' => 'making 10 requests'],

            // EARNING BADGES
            ['key' => 'earn_1',    'name' => 'First Earn',        'icon' => "\xF0\x9F\xAA\x99", 'type' => 'earn', 'threshold' => 1, 'msg' => 'earning your first time credit'],
            ['key' => 'earn_10',   'name' => 'Go Getter',         'icon' => "\xF0\x9F\x9A\x80", 'type' => 'earn', 'threshold' => 10, 'msg' => 'earning 10 time credits'],
            ['key' => 'earn_50',   'name' => 'Credit Builder',    'icon' => "\xE2\x9A\xA1", 'type' => 'earn', 'threshold' => 50, 'msg' => 'earning 50 time credits'],
            ['key' => 'earn_100',  'name' => 'Centurion',         'icon' => "\xF0\x9F\x92\xAF", 'type' => 'earn', 'threshold' => 100, 'msg' => 'earning 100 time credits'],
            ['key' => 'earn_250',  'name' => 'Credit Master',     'icon' => "\xF0\x9F\x92\x8E", 'type' => 'earn', 'threshold' => 250, 'msg' => 'earning 250 time credits'],

            // SPENDING BADGES
            ['key' => 'spend_1',   'name' => 'First Spend',       'icon' => "\xF0\x9F\x92\xB8", 'type' => 'spend', 'threshold' => 1, 'msg' => 'spending your first time credit'],
            ['key' => 'spend_10',  'name' => 'Active Spender',    'icon' => "\xF0\x9F\x92\xB3", 'type' => 'spend', 'threshold' => 10, 'msg' => 'spending 10 time credits'],
            ['key' => 'spend_50',  'name' => 'Generous Spender',  'icon' => "\xF0\x9F\x8E\x8A", 'type' => 'spend', 'threshold' => 50, 'msg' => 'spending 50 time credits'],

            // TRANSACTION BADGES
            ['key' => 'transaction_1',  'name' => 'First Exchange',   'icon' => "\xF0\x9F\x94\x84", 'type' => 'transaction', 'threshold' => 1, 'msg' => 'completing your first transaction'],
            ['key' => 'transaction_10', 'name' => 'Active Trader',    'icon' => "\xF0\x9F\x93\x8A", 'type' => 'transaction', 'threshold' => 10, 'msg' => 'completing 10 transactions'],
            ['key' => 'transaction_50', 'name' => 'Exchange Master',  'icon' => "\xF0\x9F\x92\xB1", 'type' => 'transaction', 'threshold' => 50, 'msg' => 'completing 50 transactions'],

            // DIVERSITY BADGES
            ['key' => 'diversity_3',  'name' => 'Community Helper',   'icon' => "\xF0\x9F\x8C\x88", 'type' => 'diversity', 'threshold' => 3, 'msg' => 'helping 3 different people'],
            ['key' => 'diversity_10', 'name' => 'Diverse Giver',      'icon' => "\xF0\x9F\x8C\x90", 'type' => 'diversity', 'threshold' => 10, 'msg' => 'helping 10 different people'],
            ['key' => 'diversity_25', 'name' => 'Community Pillar',   'icon' => "\xF0\x9F\x8F\x9B\xEF\xB8\x8F", 'type' => 'diversity', 'threshold' => 25, 'msg' => 'helping 25 different people'],

            // CONNECTION BADGES
            ['key' => 'connect_1',  'name' => 'First Friend',       'icon' => "\xF0\x9F\x91\x8B", 'type' => 'connection', 'threshold' => 1, 'msg' => 'making your first connection'],
            ['key' => 'connect_10', 'name' => 'Social Butterfly',   'icon' => "\xF0\x9F\xA6\x8B", 'type' => 'connection', 'threshold' => 10, 'msg' => 'making 10 connections'],
            ['key' => 'connect_25', 'name' => 'Network Builder',    'icon' => "\xF0\x9F\x95\xB8\xEF\xB8\x8F", 'type' => 'connection', 'threshold' => 25, 'msg' => 'making 25 connections'],
            ['key' => 'connect_50', 'name' => 'Community Connector','icon' => "\xF0\x9F\x94\x97", 'type' => 'connection', 'threshold' => 50, 'msg' => 'making 50 connections'],

            // MESSAGE BADGES
            ['key' => 'msg_1',    'name' => 'Conversation Starter', 'icon' => "\xF0\x9F\x92\xAC", 'type' => 'message', 'threshold' => 1, 'msg' => 'sending your first message'],
            ['key' => 'msg_50',   'name' => 'Active Communicator',  'icon' => "\xF0\x9F\x93\xB1", 'type' => 'message', 'threshold' => 50, 'msg' => 'sending 50 messages'],
            ['key' => 'msg_200',  'name' => 'Communication Pro',    'icon' => "\xF0\x9F\x93\xA8", 'type' => 'message', 'threshold' => 200, 'msg' => 'sending 200 messages'],

            // REVIEW BADGES
            ['key' => 'review_1',  'name' => 'First Feedback',     'icon' => "\xE2\xAD\x90", 'type' => 'review_given', 'threshold' => 1, 'msg' => 'leaving your first review'],
            ['key' => 'review_10', 'name' => 'Trusted Reviewer',   'icon' => "\xF0\x9F\x93\x9D", 'type' => 'review_given', 'threshold' => 10, 'msg' => 'leaving 10 reviews'],
            ['key' => 'review_25', 'name' => 'Review Expert',      'icon' => "\xF0\x9F\x8E\xAF", 'type' => 'review_given', 'threshold' => 25, 'msg' => 'leaving 25 reviews'],

            // 5-STAR BADGES
            ['key' => '5star_1',   'name' => 'First 5-Star',       'icon' => "\xF0\x9F\x8C\x9F", 'type' => '5star', 'threshold' => 1, 'msg' => 'receiving your first 5-star review'],
            ['key' => '5star_10',  'name' => 'Highly Rated',       'icon' => "\xF0\x9F\x8F\x86", 'type' => '5star', 'threshold' => 10, 'msg' => 'receiving 10 five-star reviews'],
            ['key' => '5star_25',  'name' => 'Excellence Award',   'icon' => "\xF0\x9F\x91\x8F", 'type' => '5star', 'threshold' => 25, 'msg' => 'receiving 25 five-star reviews'],

            // EVENT BADGES
            ['key' => 'event_attend_1',  'name' => 'First Event',      'icon' => "\xF0\x9F\x8E\x9F\xEF\xB8\x8F", 'type' => 'event_attend', 'threshold' => 1, 'msg' => 'attending your first event'],
            ['key' => 'event_attend_10', 'name' => 'Event Regular',    'icon' => "\xF0\x9F\x93\x85", 'type' => 'event_attend', 'threshold' => 10, 'msg' => 'attending 10 events'],
            ['key' => 'event_attend_25', 'name' => 'Event Enthusiast', 'icon' => "\xF0\x9F\x8E\x89", 'type' => 'event_attend', 'threshold' => 25, 'msg' => 'attending 25 events'],
            ['key' => 'event_host_1',    'name' => 'Event Host',       'icon' => "\xF0\x9F\x8E\xA4", 'type' => 'event_host', 'threshold' => 1, 'msg' => 'hosting your first event'],
            ['key' => 'event_host_5',    'name' => 'Event Organizer',  'icon' => "\xF0\x9F\x8E\xAA", 'type' => 'event_host', 'threshold' => 5, 'msg' => 'hosting 5 events'],

            // GROUP BADGES
            ['key' => 'group_join_1',  'name' => 'Team Player',        'icon' => "\xF0\x9F\x91\xA5", 'type' => 'group_join', 'threshold' => 1, 'msg' => 'joining your first group'],
            ['key' => 'group_join_5',  'name' => 'Community Member',   'icon' => "\xF0\x9F\x8F\x98\xEF\xB8\x8F", 'type' => 'group_join', 'threshold' => 5, 'msg' => 'joining 5 groups'],
            ['key' => 'group_create',  'name' => 'Group Founder',      'icon' => "\xF0\x9F\x9A\x80", 'type' => 'group_create', 'threshold' => 1, 'msg' => 'creating your first group'],

            // POST BADGES
            ['key' => 'post_1',   'name' => 'First Post',          'icon' => "\xE2\x9C\x8F\xEF\xB8\x8F", 'type' => 'post', 'threshold' => 1, 'msg' => 'creating your first post'],
            ['key' => 'post_25',  'name' => 'Content Creator',     'icon' => "\xF0\x9F\x93\xB0", 'type' => 'post', 'threshold' => 25, 'msg' => 'creating 25 posts'],
            ['key' => 'post_100', 'name' => 'Prolific Poster',     'icon' => "\xF0\x9F\x93\x9A", 'type' => 'post', 'threshold' => 100, 'msg' => 'creating 100 posts'],

            // LIKES RECEIVED BADGES
            ['key' => 'likes_50',  'name' => 'Getting Noticed',    'icon' => "\xE2\x9D\xA4\xEF\xB8\x8F", 'type' => 'likes_received', 'threshold' => 50, 'msg' => 'receiving 50 likes'],
            ['key' => 'likes_200', 'name' => 'Popular Voice',      'icon' => "\xF0\x9F\x92\x95", 'type' => 'likes_received', 'threshold' => 200, 'msg' => 'receiving 200 likes'],

            // PROFILE & LOYALTY BADGES
            ['key' => 'profile_complete', 'name' => 'Profile Pro',    'icon' => "\xF0\x9F\x91\xA4", 'type' => 'profile', 'threshold' => 100, 'msg' => 'completing your profile'],
            ['key' => 'member_30d',  'name' => 'Monthly Member',      'icon' => "\xF0\x9F\x93\x86", 'type' => 'membership', 'threshold' => 30, 'msg' => 'being a member for 30 days'],
            ['key' => 'member_180d', 'name' => 'Semester Member',     'icon' => "\xF0\x9F\x93\x85", 'type' => 'membership', 'threshold' => 180, 'msg' => 'being a member for 6 months'],
            ['key' => 'member_365d', 'name' => 'Annual Member',       'icon' => "\xF0\x9F\x8E\x82", 'type' => 'membership', 'threshold' => 365, 'msg' => 'being a member for one year'],

            // STREAK BADGES
            ['key' => 'streak_7d',   'name' => 'Week Warrior',       'icon' => "\xF0\x9F\x94\xA5", 'type' => 'streak', 'threshold' => 7, 'msg' => 'maintaining a 7-day streak'],
            ['key' => 'streak_30d',  'name' => 'Monthly Dedication', 'icon' => "\xF0\x9F\x94\xA5", 'type' => 'streak', 'threshold' => 30, 'msg' => 'maintaining a 30-day streak'],
            ['key' => 'streak_100d', 'name' => 'Streak Master',      'icon' => "\xF0\x9F\x94\xA5", 'type' => 'streak', 'threshold' => 100, 'msg' => 'maintaining a 100-day streak'],
            ['key' => 'streak_365d', 'name' => 'Year-Long Legend',   'icon' => "\xF0\x9F\x94\xA5", 'type' => 'streak', 'threshold' => 365, 'msg' => 'maintaining a 365-day streak'],

            // LEVEL BADGES
            ['key' => 'level_5',  'name' => 'Rising Star',         'icon' => "\xF0\x9F\x8C\x9F", 'type' => 'level', 'threshold' => 5, 'msg' => 'reaching level 5'],
            ['key' => 'level_10', 'name' => 'Community Champion',  'icon' => "\xF0\x9F\x8F\x86", 'type' => 'level', 'threshold' => 10, 'msg' => 'reaching level 10'],

            // SPECIAL BADGES
            ['key' => 'early_adopter', 'name' => 'Early Adopter',   'icon' => "\xF0\x9F\x8C\xB1", 'type' => 'special', 'threshold' => 0, 'msg' => 'being an early adopter'],
            ['key' => 'verified',      'name' => 'Verified Member', 'icon' => "\xE2\x9C\x85", 'type' => 'special', 'threshold' => 0, 'msg' => 'being a verified member'],
            ['key' => 'volunteer_org', 'name' => 'Organization Partner', 'icon' => "\xF0\x9F\x8F\xA2", 'type' => 'vol_org', 'threshold' => 1, 'msg' => 'creating a volunteer organization'],
        ];

        self::$badgeDefinitionsCache = array_map(static fn (array $badge): array => [
            ...$badge,
            'name_code' => 'badges.' . $badge['key'] . '.name',
            'description_code' => 'badges.' . $badge['key'] . '.description',
        ], self::$badgeDefinitionsCache);

        return self::$badgeDefinitionsCache;
    }

    /**
     * Get badge definition by key — checks DB first, then static fallback.
     */
    public static function getBadgeByKey(string $key): ?array
    {
        // Try DB-backed definitions first
        $dbBadge = BadgeDefinitionService::getBadgeByKey($key);
        if ($dbBadge) {
            return $dbBadge;
        }

        // Fallback to static definitions
        foreach (self::getBadgeDefinitions() as $def) {
            if ($def['key'] === $key) {
                return $def;
            }
        }
        return null;
    }

    // =========================================================================
    // BADGE AWARDING (Eloquent)
    // =========================================================================

    /**
     * Award a badge to a user (idempotent — skips if already earned).
     */
    public static function awardBadge(int $userId, $badge): void
    {
        // Accept either array definition or badge key string
        if (is_string($badge)) {
            $badge = self::getBadgeByKey($badge);
            if (! $badge) {
                return;
            }
        }

        $exists = UserBadge::query()
            ->where('user_id', $userId)
            ->where('badge_key', $badge['key'])
            ->exists();

        if ($exists) {
            return;
        }

        try {
            UserBadge::create([
                'user_id'   => $userId,
                'badge_key' => $badge['key'],
                'name'      => $badge['name'],
                'icon'      => $badge['icon'],
            ]);
        } catch (\Illuminate\Database\UniqueConstraintViolationException $e) {
            // Badge already exists (race condition or cross-tenant duplicate) — skip silently
            return;
        }

        // Create notification — render in the RECIPIENT's preferred language.
        $recipient = User::query()
            ->withoutGlobalScopes()
            ->select(['id', 'preferred_language'])
            ->find($userId);

        LocaleContext::withLocale($recipient, function () use ($userId, $badge) {
            // Route through createNotification() so the bell's tenant_id is forced to
            // the recipient's users.tenant_id (cross-tenant write guard).
            Notification::createNotification(
                $userId,
                __('svc_notifications.gamification.badge_earned', ['name' => $badge['name'], 'icon' => $badge['icon']]),
                '/achievements',
                'achievement'
            );
            \App\Services\NotificationDispatcher::fanOutPush((int) ($userId), 'achievement', __('svc_notifications.gamification.badge_earned', ['name' => $badge['name'], 'icon' => $badge['icon']]), '/achievements');
        });

        // Broadcast badge earned event
        try {
            app(GamificationRealtimeService::class)->broadcastBadgeEarned($userId, $badge);
        } catch (\Throwable $e) {
            Log::debug('Gamification broadcast failed', ['error' => $e->getMessage()]);
        }

        try {
            app(GamificationEmailService::class)->sendMilestoneEmail($userId, 'badge_earned', [
                'badge_key' => $badge['key'],
                'badge_name' => $badge['name'],
                'name' => $badge['name'],
                'icon' => $badge['icon'],
            ]);
        } catch (\Throwable $e) {
            Log::warning('GamificationService: badge milestone email failed', [
                'user_id' => $userId,
                'badge_key' => $badge['key'] ?? null,
                'error' => $e->getMessage(),
            ]);
        }

        /*
         * NO FEED CARD IS WRITTEN FOR A BADGE.
         *
         * A `badge_earned` row used to be recorded in `feed_activity` here, which
         * every client rendered as a full-width celebratory card. Removed on the
         * owner's instruction (2026-08-27): the badge cards dominated the feed and
         * crowded out member content. `feed_activity` exists only to be read by
         * the feed, so recording the row would write data nothing can display —
         * FeedService::EXCLUDED_SOURCE_TYPES filters historical rows out.
         *
         * The award itself is untouched: the badge is granted above, the member is
         * notified (in-app, push, email) and XP is awarded below. Badges remain
         * visible on the achievements page and the member's profile.
         */

        // Award XP for earning badge
        self::awardXP($userId, self::XP_VALUES['earn_badge'], 'earn_badge', "Badge: {$badge['name']}");
    }

    /**
     * Award a badge by key (admin use).
     */
    public static function awardBadgeByKey(int $userId, string $badgeKey): void
    {
        $def = self::getBadgeByKey($badgeKey);
        if ($def) {
            self::awardBadge($userId, $def);
        }
    }

    // =========================================================================
    // XP & LEVELING (Eloquent)
    // =========================================================================

    /**
     * Award XP to a user and check for level up.
     */
    public static function awardXP(int $userId, int $amount, string $action, string $description = '', ?string $reference = null): void
    {
        if ($amount <= 0) {
            return;
        }

        try {
            DB::transaction(function () use ($userId, $amount, $action, $description, $reference) {
                // Prevent duplicate one-time XP awards — lock user row to serialize
                $oneTimeActions = ['complete_profile'];
                if (in_array($action, $oneTimeActions)) {
                    // Lock user row to prevent concurrent duplicate one-time awards
                    DB::table('users')->where('id', $userId)->lockForUpdate()->first();

                    $existing = UserXpLog::where('user_id', $userId)
                        ->where('action', $action)
                        ->exists();
                    if ($existing) {
                        return;
                    }
                }

                // Log XP
                UserXpLog::create([
                    'user_id'          => $userId,
                    'xp_amount'        => $amount,
                    'action'           => $action,
                    'description'      => $description,
                    'source_reference' => $reference,
                ]);

                // Update user XP (atomic increment)
                User::query()->where('id', $userId)->increment('xp', $amount);
            });

            // Invalidate cached leaderboard slices for this tenant — XP just changed.
            try {
                $tenantId = (int) (User::query()->where('id', $userId)->value('tenant_id') ?? 0);
                if ($tenantId > 0) {
                    \App\Services\LeaderboardService::invalidate($tenantId);
                }
            } catch (\Throwable $e) {
                \Log::warning('GamificationService: leaderboard cache invalidation failed', ['error' => $e->getMessage()]);
            }

            // Broadcast XP gained event
            try {
                app(GamificationRealtimeService::class)->broadcastXPGained($userId, $amount, $action);
            } catch (\Throwable $e) {
                Log::debug('Gamification broadcast failed', ['error' => $e->getMessage()]);
            }

            // Check for level up (outside transaction — non-critical)
            self::checkLevelUp($userId);
        } catch (\Illuminate\Database\UniqueConstraintViolationException $e) {
            // A reference-scoped award already exists for this
            // (tenant, user, action, source_reference) — idempotent no-op.
            // Do not re-award or log this as an error.
            return;
        } catch (\Throwable $e) {
            Log::error('XP Award Error: ' . $e->getMessage());
        }
    }

    /**
     * Check if user leveled up and award level badge.
     */
    private static function checkLevelUp(int $userId): void
    {
        try {
            /** @var User|null $user */
            $user = User::query()->find($userId, ['id', 'xp', 'level']);
            if (! $user) {
                return;
            }

            $currentXP = (int) ($user->xp ?? 0);
            $currentLevel = (int) ($user->level ?? 1);
            $newLevel = self::calculateLevel($currentXP);

            if ($newLevel > $currentLevel) {
                $user->level = $newLevel;
                $user->save();

                // Render the bell in the RECIPIENT's preferred language.
                $recipient = User::query()
                    ->withoutGlobalScopes()
                    ->select(['id', 'preferred_language'])
                    ->find($userId);

                LocaleContext::withLocale($recipient, function () use ($userId, $newLevel) {
                    Notification::createNotification(
                        $userId,
                        __('svc_notifications.gamification.level_up', ['level' => $newLevel]),
                        '/achievements',
                        'achievement'
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) ($userId), 'achievement', __('svc_notifications.gamification.level_up', ['level' => $newLevel]), '/achievements');
                });

                // Broadcast level up event
                try {
                    app(GamificationRealtimeService::class)->broadcastLevelUp($userId, $newLevel);
                } catch (\Throwable $e) {
                    Log::debug('Gamification broadcast failed', ['error' => $e->getMessage()]);
                }

                try {
                    app(GamificationEmailService::class)->sendMilestoneEmail($userId, 'level_up', [
                        'level' => $newLevel,
                    ]);
                } catch (\Throwable $e) {
                    Log::warning('GamificationService: level milestone email failed', [
                        'user_id' => $userId,
                        'level' => $newLevel,
                        'error' => $e->getMessage(),
                    ]);
                }

                /*
                 * NO FEED CARD IS WRITTEN FOR A LEVEL-UP — same reason as the
                 * badge card in awardBadge(): gamification milestones are no
                 * longer feed content (owner instruction, 2026-08-27). The level
                 * itself, its notification, its email and the milestone bonus XP
                 * below are all unchanged.
                 */

                // Milestone bonus XP
                $milestones = [5 => 50, 10 => 100, 15 => 150, 20 => 200, 25 => 300, 30 => 400, 50 => 500, 100 => 1000];
                if (isset($milestones[$newLevel])) {
                    self::awardXP($userId, $milestones[$newLevel], 'level_milestone', "Level $newLevel milestone bonus");
                }

                // Check level badges
                self::checkLevelBadges($userId, $newLevel);
            }
        } catch (\Throwable $e) {
            Log::error('Level Up Check Error: ' . $e->getMessage());
        }
    }

    /**
     * Calculate level from XP.
     */
    public static function calculateLevel(int $xp): int
    {
        $level = 1;
        foreach (self::LEVEL_THRESHOLDS as $lvl => $threshold) {
            if ($xp >= $threshold) {
                $level = $lvl;
            }
        }
        return $level;
    }

    /**
     * Get level progress percentage (0–100).
     */
    public static function getLevelProgress(int $xp, int $level): float|int
    {
        $currentThreshold = self::LEVEL_THRESHOLDS[$level] ?? 0;
        $nextThreshold = self::LEVEL_THRESHOLDS[$level + 1] ?? null;

        if ($nextThreshold === null) {
            return 100;
        }

        $xpInLevel = $xp - $currentThreshold;
        $xpNeeded = $nextThreshold - $currentThreshold;

        if ($xpNeeded <= 0) {
            return 100;
        }

        return min(100, round(($xpInLevel / $xpNeeded) * 100));
    }

    // =========================================================================
    // BADGE CHECKING (Eloquent)
    // =========================================================================

    /**
     * Run all badge checks for a user (quantity + quality badges).
     */
    public static function runAllBadgeChecks(int $userId): void
    {
        // Existing quantity badge checks
        self::checkVolunteeringBadges($userId);
        self::checkTimebankingBadges($userId);
        self::checkListingBadges($userId);
        self::checkConnectionBadges($userId);
        self::checkMessageBadges($userId);
        self::checkReviewBadges($userId);
        self::checkEventBadges($userId, 'attend');
        self::checkEventBadges($userId, 'host');
        self::checkGroupBadges($userId, 'join');
        self::checkGroupBadges($userId, 'create');
        self::checkPostBadges($userId);
        self::checkLikesBadges($userId);
        self::checkProfileBadge($userId);
        self::checkMembershipBadges($userId);
        self::checkVolOrgBadges($userId);

        // New quality badge checks (gamification redesign)
        self::checkReliabilityBadges($userId);
        self::checkBridgeBuilderBadges($userId);
        self::checkMentorBadges($userId);
        self::checkReciprocityBadges($userId);
        self::checkCommunityChampionBadges($userId);
    }

    /**
     * Check and award streak badges.
     */
    public static function checkStreakBadges(int $userId, int $streakLength): void
    {
        foreach (self::getBadgeDefinitions() as $def) {
            if ($def['type'] === 'streak' && $streakLength >= $def['threshold']) {
                self::awardBadge($userId, $def);
            }
        }
    }

    /**
     * Check and award level badges.
     */
    public static function checkLevelBadges(int $userId, int $level): void
    {
        foreach (self::getBadgeDefinitions() as $def) {
            if ($def['type'] === 'level' && $level >= $def['threshold']) {
                self::awardBadge($userId, $def);
            }
        }
    }

    /**
     * Get badge progress for a user — shows progress towards next badges.
     */
    public static function getBadgeProgress(int $userId): array
    {
        $progress = [];
        $earnedKeys = UserBadge::query()
            ->where('user_id', $userId)
            ->pluck('badge_key')
            ->all();

        $stats = self::getUserStatsForProgress($userId);

        // Group by type and find next unlockable
        $badgesByType = [];
        foreach (self::getBadgeDefinitions() as $def) {
            $badgesByType[$def['type']][] = $def;
        }

        foreach ($badgesByType as $type => $badges) {
            usort($badges, fn ($a, $b) => $a['threshold'] - $b['threshold']);

            foreach ($badges as $badge) {
                if (in_array($badge['key'], $earnedKeys)) {
                    continue;
                }

                $current = $stats[$type] ?? 0;
                $threshold = $badge['threshold'];

                if ($threshold > 0 && $current < $threshold) {
                    $percent = min(99, round(($current / $threshold) * 100));
                    $progress[] = [
                        'badge'     => $badge,
                        'current'   => $current,
                        'target'    => $threshold,
                        'percent'   => $percent,
                        'remaining' => $threshold - $current,
                    ];
                    break; // Only next badge per category
                }
            }
        }

        usort($progress, fn ($a, $b) => $b['percent'] - $a['percent']);

        return array_slice($progress, 0, 6);
    }

    // =========================================================================
    // PRIVATE BADGE CHECK METHODS (Eloquent)
    // =========================================================================

    private static function checkVolunteeringBadges(int $userId): void
    {
        $totalHours = (int) VolLog::where('user_id', $userId)
            ->where('status', 'approved')
            ->sum('hours');

        foreach (self::getBadgeDefinitions() as $def) {
            if ($def['type'] === 'vol' && $totalHours >= $def['threshold']) {
                self::awardBadge($userId, $def);
            }
        }
    }

    /**
     * Transaction types that are system-issued grants rather than member
     * exchanges. Signup welcome credits and admin wallet grants must never
     * count towards transaction-based badges — otherwise every new member
     * gets "First Exchange"/"First Earn" from their signup credits before
     * they have exchanged anything.
     */
    public const SYSTEM_GRANT_TYPES = ['starting_balance', 'admin_grant'];

    /**
     * Constrain a transactions query to real member-to-member exchanges.
     *
     * Excludes system grant types, system-sent rows (sender NULL/0),
     * self-transactions, and legacy '[Welcome Bonus]' rows that were written
     * with the default 'transfer' type before grants had their own
     * transaction_type (AdminUsersController::grantWelcomeCredits).
     *
     * @param \Illuminate\Database\Eloquent\Builder|\Illuminate\Database\Query\Builder $query
     * @param string $t Column prefix when the query joins other tables (e.g. 'transactions.').
     */
    public static function realExchangesOnly($query, string $t = '')
    {
        return $query
            ->whereNotIn($t . 'transaction_type', self::SYSTEM_GRANT_TYPES)
            ->where($t . 'sender_id', '>', 0)
            ->whereColumn($t . 'sender_id', '!=', $t . 'receiver_id')
            ->where(function ($q) use ($t) {
                $q->whereNull($t . 'description')
                  ->orWhere($t . 'description', 'NOT LIKE', '[Welcome Bonus]%');
            });
    }

    /**
     * Corrected timebanking counts for a user — real member exchanges only
     * (see realExchangesOnly()). Shared by checkTimebankingBadges() and the
     * gamification:revoke-grant-badges cleanup command so both use identical
     * qualification maths.
     *
     * @return array{earn: int, spend: int, transaction: int, diversity: int}
     */
    public static function getRealExchangeCounts(int $userId): array
    {
        return [
            'earn' => (int) self::realExchangesOnly(Transaction::where('receiver_id', $userId))
                ->where('status', 'completed')
                ->sum('amount'),
            'spend' => (int) self::realExchangesOnly(Transaction::where('sender_id', $userId))
                ->where('deleted_for_sender', false)
                ->sum('amount'),
            'transaction' => (int) self::realExchangesOnly(
                Transaction::where(function ($q) use ($userId) {
                    $q->where('sender_id', $userId)->orWhere('receiver_id', $userId);
                })
            )->count(),
            'diversity' => (int) self::realExchangesOnly(Transaction::where('sender_id', $userId))
                ->distinct('receiver_id')
                ->count('receiver_id'),
        ];
    }

    private static function checkTimebankingBadges(int $userId): void
    {
        $counts = self::getRealExchangeCounts($userId);

        foreach (self::getBadgeDefinitions() as $def) {
            $qualifies = match ($def['type']) {
                'earn', 'spend', 'transaction', 'diversity' => $counts[$def['type']] >= $def['threshold'],
                default => false,
            };
            if ($qualifies) {
                self::awardBadge($userId, $def);
            }
        }
    }

    private static function checkListingBadges(int $userId): void
    {
        $offerCount = Listing::where('user_id', $userId)->where('type', 'offer')->count();
        $requestCount = Listing::where('user_id', $userId)->where('type', 'request')->count();

        foreach (self::getBadgeDefinitions() as $def) {
            $count = 0;
            if ($def['type'] === 'offer') { $count = $offerCount; }
            if ($def['type'] === 'request') { $count = $requestCount; }

            if ($count > 0 && $count >= $def['threshold']) {
                self::awardBadge($userId, $def);
            }
        }
    }

    private static function checkConnectionBadges(int $userId): void
    {
        $count = Connection::where('status', 'accepted')
            ->where(function ($q) use ($userId) {
                $q->where('requester_id', $userId)->orWhere('receiver_id', $userId);
            })->count();

        foreach (self::getBadgeDefinitions() as $def) {
            if ($def['type'] === 'connection' && $count >= $def['threshold']) {
                self::awardBadge($userId, $def);
            }
        }
    }

    private static function checkMessageBadges(int $userId): void
    {
        $count = Message::where('sender_id', $userId)->count();

        foreach (self::getBadgeDefinitions() as $def) {
            if ($def['type'] === 'message' && $count >= $def['threshold']) {
                self::awardBadge($userId, $def);
            }
        }
    }

    private static function checkEventBadges(int $userId, string $action = 'attend'): void
    {
        if ($action === 'attend') {
            $count = EventRsvp::where('user_id', $userId)->where('status', 'going')->count();
            $type = 'event_attend';
        } else {
            $count = Event::where('user_id', $userId)->count();
            $type = 'event_host';
        }

        foreach (self::getBadgeDefinitions() as $def) {
            if ($def['type'] === $type && $count >= $def['threshold']) {
                self::awardBadge($userId, $def);
            }
        }
    }

    private static function checkGroupBadges(int $userId, string $action = 'join'): void
    {
        if ($action === 'join') {
            $count = GroupMember::where('user_id', $userId)
                ->where('status', 'active')
                ->whereHas('group', static fn ($query) => $query->active())
                ->count();
            foreach (self::getBadgeDefinitions() as $def) {
                if ($def['type'] === 'group_join' && $count >= $def['threshold']) {
                    self::awardBadge($userId, $def);
                }
            }
        } elseif ($action === 'create') {
            $count = Group::where('owner_id', $userId)->active()->count();
            foreach (self::getBadgeDefinitions() as $def) {
                if ($def['type'] === 'group_create' && $count >= $def['threshold']) {
                    self::awardBadge($userId, $def);
                }
            }
        }
    }

    private static function checkPostBadges(int $userId): void
    {
        $count = FeedPost::where('user_id', $userId)->count();

        foreach (self::getBadgeDefinitions() as $def) {
            if ($def['type'] === 'post' && $count >= $def['threshold']) {
                self::awardBadge($userId, $def);
            }
        }
    }

    private static function checkLikesBadges(int $userId): void
    {
        try {
            // Tenant-scoped (2026-07-09 audit): raw join bypasses HasTenantScope,
            // and users belonging to two tenants would otherwise blend counts.
            $count = (int) DB::table('post_likes')
                ->join('feed_posts', 'post_likes.post_id', '=', 'feed_posts.id')
                ->where('feed_posts.tenant_id', \App\Core\TenantContext::getId())
                ->where('feed_posts.user_id', $userId)
                ->count();

            foreach (self::getBadgeDefinitions() as $def) {
                if ($def['type'] === 'likes_received' && $count >= $def['threshold']) {
                    self::awardBadge($userId, $def);
                }
            }
        } catch (\Throwable $e) {
            \Log::warning('GamificationService: checkLikesBadges failed', ['error' => $e->getMessage()]);
        }
    }

    private static function checkProfileBadge(int $userId): void
    {
        $completion = self::getProfileCompletion($userId);

        foreach (self::getBadgeDefinitions() as $def) {
            if ($def['type'] === 'profile' && $completion >= $def['threshold']) {
                self::awardBadge($userId, $def);
            }
        }
    }

    private static function checkMembershipBadges(int $userId): void
    {
        $days = self::getDaysSinceJoined($userId);

        foreach (self::getBadgeDefinitions() as $def) {
            if ($def['type'] === 'membership' && $days >= $def['threshold']) {
                self::awardBadge($userId, $def);
            }
        }
    }

    private static function checkReviewBadges(int $userId): void
    {
        $reviewsGiven = (int) Review::where('reviewer_id', $userId)->count();
        $fiveStarReceived = (int) Review::where('receiver_id', $userId)->where('rating', 5)->count();

        foreach (self::getBadgeDefinitions() as $def) {
            if ($def['type'] === 'review_given' && $reviewsGiven >= $def['threshold']) {
                self::awardBadge($userId, $def);
            }
            if ($def['type'] === '5star' && $fiveStarReceived >= $def['threshold']) {
                self::awardBadge($userId, $def);
            }
        }
    }

    private static function checkVolOrgBadges(int $userId): void
    {
        try {
            $count = (int) DB::table('vol_organizations')
                ->where('user_id', $userId)
                ->where('tenant_id', TenantContext::getId())
                ->count();

            foreach (self::getBadgeDefinitions() as $def) {
                if ($def['type'] === 'vol_org' && $count >= $def['threshold']) {
                    self::awardBadge($userId, $def);
                }
            }
        } catch (\Throwable $e) {
            \Log::warning('GamificationService: checkVolOrgBadges failed', ['error' => $e->getMessage()]);
        }
    }

    // =========================================================================
    // QUALITY BADGE CHECKS (Gamification Redesign)
    // =========================================================================

    /**
     * Check reliability badges — rewards low cancellation rate and completed transactions.
     */
    private static function checkReliabilityBadges(int $userId): void
    {
        try {
            $completed = (int) self::realExchangesOnly(
                Transaction::where(function ($q) use ($userId) {
                    $q->where('sender_id', $userId)->orWhere('receiver_id', $userId);
                })
            )->where('status', 'completed')->count();

            if ($completed === 0) {
                return;
            }

            $cancelled = (int) self::realExchangesOnly(
                Transaction::where(function ($q) use ($userId) {
                    $q->where('sender_id', $userId)->orWhere('receiver_id', $userId);
                })
            )->where('status', 'cancelled')->count();

            $total = $completed + $cancelled;
            $cancellationRate = $total > 0 ? ($cancelled / $total) : 0;

            foreach (self::getBadgeDefinitions() as $def) {
                if ($def['type'] !== 'reliability') {
                    continue;
                }
                $config = $def['config_json'] ?? [];
                $minTx = $config['min_transactions'] ?? $def['threshold'];
                $maxRate = $config['max_cancellation_rate'] ?? 0.10;

                if ($completed >= $minTx && $cancellationRate <= $maxRate) {
                    self::awardBadge($userId, $def);
                }
            }
        } catch (\Throwable $e) {
            Log::debug('checkReliabilityBadges failed: ' . $e->getMessage());
        }
    }

    /**
     * Check bridge builder badges — rewards trading across different skill categories.
     */
    private static function checkBridgeBuilderBadges(int $userId): void
    {
        try {
            // Count distinct listing categories the user has transacted in
            // (tenant-scoped — raw join bypasses HasTenantScope)
            $categoryCount = (int) self::realExchangesOnly(
                DB::table('transactions')
                    ->join('listings', 'transactions.listing_id', '=', 'listings.id')
                    ->where('transactions.tenant_id', \App\Core\TenantContext::getId())
                    ->where(function ($q) use ($userId) {
                        $q->where('transactions.sender_id', $userId)
                          ->orWhere('transactions.receiver_id', $userId);
                    })
                    ->where('transactions.status', 'completed'),
                'transactions.'
            )
                ->distinct()
                ->count('listings.category_id');

            if ($categoryCount === 0) {
                return;
            }

            foreach (self::getBadgeDefinitions() as $def) {
                if ($def['type'] !== 'bridge_builder') {
                    continue;
                }
                $config = $def['config_json'] ?? [];
                $minCategories = $config['min_categories'] ?? $def['threshold'];

                if ($categoryCount >= $minCategories) {
                    self::awardBadge($userId, $def);
                }
            }
        } catch (\Throwable $e) {
            Log::debug('checkBridgeBuilderBadges failed: ' . $e->getMessage());
        }
    }

    /**
     * Check mentor badges — rewards helping new members complete their first transaction.
     *
     * A "new member" is someone who joined within the last N days (configurable, default 30)
     * and had zero completed transactions before the one involving this user.
     */
    private static function checkMentorBadges(int $userId): void
    {
        try {
            // Count users who had their first real exchange with this user
            $mentoredCount = 0;
            $partners = self::realExchangesOnly(
                Transaction::where('status', 'completed')
                    ->where(function ($q) use ($userId) {
                        $q->where('sender_id', $userId)->orWhere('receiver_id', $userId);
                    })
            )
                ->get(['id', 'sender_id', 'receiver_id', 'created_at']);

            foreach ($partners as $tx) {
                $partnerId = $tx->sender_id === $userId ? $tx->receiver_id : $tx->sender_id;

                // Check if this was the partner's first completed real exchange
                $earlierTx = self::realExchangesOnly(
                    Transaction::where('status', 'completed')
                        ->where(function ($q) use ($partnerId) {
                            $q->where('sender_id', $partnerId)->orWhere('receiver_id', $partnerId);
                        })
                )
                    ->where('created_at', '<', $tx->created_at)
                    ->exists();

                if (! $earlierTx) {
                    $mentoredCount++;
                }
            }

            if ($mentoredCount === 0) {
                return;
            }

            foreach (self::getBadgeDefinitions() as $def) {
                if ($def['type'] !== 'mentor') {
                    continue;
                }
                if ($mentoredCount >= $def['threshold']) {
                    self::awardBadge($userId, $def);
                }
            }
        } catch (\Throwable $e) {
            Log::debug('checkMentorBadges failed: ' . $e->getMessage());
        }
    }

    /**
     * Check reciprocity badges — rewards balanced giving and receiving.
     *
     * The earn/spend ratio must be within a healthy range (not too much hoarding,
     * not too much spending). This is a core timebanking value.
     */
    private static function checkReciprocityBadges(int $userId): void
    {
        try {
            $earned = (int) self::realExchangesOnly(Transaction::where('receiver_id', $userId))
                ->where('status', 'completed')
                ->sum('amount');

            $spent = (int) self::realExchangesOnly(Transaction::where('sender_id', $userId))
                ->where('status', 'completed')
                ->sum('amount');

            $totalTx = (int) self::realExchangesOnly(
                Transaction::where(function ($q) use ($userId) {
                    $q->where('sender_id', $userId)->orWhere('receiver_id', $userId);
                })
            )->where('status', 'completed')->count();

            if ($totalTx === 0 || ($earned === 0 && $spent === 0)) {
                return;
            }

            // Calculate ratio (guard against division by zero)
            $ratio = $spent > 0 ? ($earned / $spent) : ($earned > 0 ? PHP_FLOAT_MAX : 1.0);

            foreach (self::getBadgeDefinitions() as $def) {
                if ($def['type'] !== 'reciprocity') {
                    continue;
                }
                $config = $def['config_json'] ?? [];
                $minTx = $config['min_transactions'] ?? $def['threshold'];
                $minRatio = $config['min_ratio'] ?? 0.3;
                $maxRatio = $config['max_ratio'] ?? 3.0;

                if ($totalTx >= $minTx && $ratio >= $minRatio && $ratio <= $maxRatio) {
                    self::awardBadge($userId, $def);
                }
            }
        } catch (\Throwable $e) {
            Log::debug('checkReciprocityBadges failed: ' . $e->getMessage());
        }
    }

    /**
     * Check community champion badges — rewards sustained multi-category activity.
     *
     * Checks if the user has been active across multiple categories for N consecutive months.
     */
    private static function checkCommunityChampionBadges(int $userId): void
    {
        try {
            $tenantId = TenantContext::getId();

            foreach (self::getBadgeDefinitions() as $def) {
                if ($def['type'] !== 'community_champion') {
                    continue;
                }

                $config = $def['config_json'] ?? [];
                $requiredMonths = $config['months'] ?? $def['threshold'];
                $minCategoriesPerMonth = $config['min_categories_per_month'] ?? 2;
                $minActivityPerMonth = $config['min_activity_per_month'] ?? 3;

                // Check each of the last N months
                $qualifyingMonths = 0;

                for ($i = 0; $i < $requiredMonths; $i++) {
                    $monthStart = now()->subMonths($i)->startOfMonth();
                    $monthEnd = now()->subMonths($i)->endOfMonth();

                    // Count distinct activity categories this month
                    $categories = self::realExchangesOnly(
                        DB::table('transactions')
                            ->leftJoin('listings', 'transactions.listing_id', '=', 'listings.id')
                            ->where('transactions.tenant_id', $tenantId)
                            ->where(function ($q) use ($userId) {
                                $q->where('transactions.sender_id', $userId)
                                  ->orWhere('transactions.receiver_id', $userId);
                            })
                            ->where('transactions.status', 'completed')
                            ->whereBetween('transactions.created_at', [$monthStart, $monthEnd]),
                        'transactions.'
                    )
                        ->distinct()
                        ->count('listings.category_id');

                    // Count total activities this month
                    $activityCount = self::realExchangesOnly(
                        Transaction::where(function ($q) use ($userId) {
                            $q->where('sender_id', $userId)->orWhere('receiver_id', $userId);
                        })
                    )
                        ->where('status', 'completed')
                        ->whereBetween('created_at', [$monthStart, $monthEnd])
                        ->count();

                    if ($categories >= $minCategoriesPerMonth && $activityCount >= $minActivityPerMonth) {
                        $qualifyingMonths++;
                    }
                }

                if ($qualifyingMonths >= $requiredMonths) {
                    self::awardBadge($userId, $def);
                }
            }
        } catch (\Throwable $e) {
            Log::debug('checkCommunityChampionBadges failed: ' . $e->getMessage());
        }
    }

    // =========================================================================
    // STAT HELPERS (Eloquent)
    // =========================================================================

    private static function getUserStatsForProgress(int $userId): array
    {
        $stats = [
            'vol' => 0, 'offer' => 0, 'request' => 0, 'earn' => 0,
            'spend' => 0, 'transaction' => 0, 'diversity' => 0,
            'connection' => 0, 'message' => 0, 'review_given' => 0,
            '5star' => 0, 'event_attend' => 0, 'event_host' => 0,
            'group_join' => 0, 'group_create' => 0, 'post' => 0,
            'likes_received' => 0, 'profile' => 0, 'membership' => 0,
            'streak' => 0, 'level' => 1,
            // Quality badge stats
            'reliability' => 0, 'bridge_builder' => 0, 'mentor' => 0,
            'reciprocity' => 0, 'community_champion' => 0,
        ];

        try { $stats['vol'] = (int) VolLog::where('user_id', $userId)->where('status', 'approved')->sum('hours'); } catch (\Throwable $e) { \Log::warning('GamificationService: stats[vol] failed', ['error' => $e->getMessage()]); }
        // Batch: listings table (2 → 1 query)
        try {
            $listingCounts = Listing::where('user_id', $userId)
                ->whereIn('type', ['offer', 'request'])
                ->selectRaw('type, COUNT(*) as cnt')
                ->groupBy('type')
                ->pluck('cnt', 'type');
            $stats['offer']   = (int) ($listingCounts['offer'] ?? 0);
            $stats['request'] = (int) ($listingCounts['request'] ?? 0);
        } catch (\Throwable $e) { \Log::warning('GamificationService: stats[listings] failed', ['error' => $e->getMessage()]); }

        // Batch: transactions table (4 → 2 queries)
        try {
            $txRow = self::realExchangesOnly(
                DB::table('transactions')
                    ->where('tenant_id', \App\Core\TenantContext::getId())
                    ->where(fn ($q) => $q->where('sender_id', $userId)->orWhere('receiver_id', $userId))
            )
                ->selectRaw('COUNT(*) as total, SUM(CASE WHEN receiver_id = ? AND status = ? THEN amount ELSE 0 END) as earned, SUM(CASE WHEN sender_id = ? AND deleted_for_sender = 0 THEN amount ELSE 0 END) as spent', [$userId, 'completed', $userId])
                ->first();
            $stats['transaction'] = (int) ($txRow->total ?? 0);
            $stats['earn']        = (int) ($txRow->earned ?? 0);
            $stats['spend']       = (int) ($txRow->spent ?? 0);
        } catch (\Throwable $e) { \Log::warning('GamificationService: stats[transactions] failed', ['error' => $e->getMessage()]); }
        try { $stats['diversity'] = (int) self::realExchangesOnly(Transaction::where('sender_id', $userId))->distinct('receiver_id')->count('receiver_id'); } catch (\Throwable $e) { \Log::warning('GamificationService: stats[diversity] failed', ['error' => $e->getMessage()]); }

        // Batch: reviews table (2 → 1 query)
        try {
            $reviewRow = DB::table('reviews')
                ->where('tenant_id', \App\Core\TenantContext::getId())
                ->where(fn ($q) => $q->where('reviewer_id', $userId)->orWhere('receiver_id', $userId))
                ->selectRaw('SUM(CASE WHEN reviewer_id = ? THEN 1 ELSE 0 END) as given, SUM(CASE WHEN receiver_id = ? AND rating = 5 THEN 1 ELSE 0 END) as fivestar', [$userId, $userId])
                ->first();
            $stats['review_given'] = (int) ($reviewRow->given ?? 0);
            $stats['5star']        = (int) ($reviewRow->fivestar ?? 0);
        } catch (\Throwable $e) { \Log::warning('GamificationService: stats[reviews] failed', ['error' => $e->getMessage()]); }

        try { $stats['connection'] = (int) Connection::where('status', 'accepted')->where(fn ($q) => $q->where('requester_id', $userId)->orWhere('receiver_id', $userId))->count(); } catch (\Throwable $e) { \Log::warning('GamificationService: stats[connection] failed', ['error' => $e->getMessage()]); }
        try { $stats['message'] = (int) Message::where('sender_id', $userId)->count(); } catch (\Throwable $e) { \Log::warning('GamificationService: stats[message] failed', ['error' => $e->getMessage()]); }
        try { $stats['event_attend'] = (int) EventRsvp::where('user_id', $userId)->where('status', 'going')->count(); } catch (\Throwable $e) { \Log::warning('GamificationService: stats[event_attend] failed', ['error' => $e->getMessage()]); }
        try { $stats['event_host'] = (int) Event::where('user_id', $userId)->count(); } catch (\Throwable $e) { \Log::warning('GamificationService: stats[event_host] failed', ['error' => $e->getMessage()]); }
        try { $stats['group_join'] = (int) GroupMember::where('user_id', $userId)->where('status', 'active')->count(); } catch (\Throwable $e) { \Log::warning('GamificationService: stats[group_join] failed', ['error' => $e->getMessage()]); }
        try { $stats['post'] = (int) FeedPost::where('user_id', $userId)->count(); } catch (\Throwable $e) { \Log::warning('GamificationService: stats[post] failed', ['error' => $e->getMessage()]); }
        try { $stats['likes_received'] = (int) DB::table('post_likes')->join('feed_posts', 'post_likes.post_id', '=', 'feed_posts.id')->where('feed_posts.tenant_id', \App\Core\TenantContext::getId())->where('feed_posts.user_id', $userId)->count(); } catch (\Throwable $e) { \Log::warning('GamificationService: stats[likes_received] failed', ['error' => $e->getMessage()]); }
        try { $stats['profile'] = self::getProfileCompletion($userId); } catch (\Throwable $e) { \Log::warning('GamificationService: stats[profile] failed', ['error' => $e->getMessage()]); }
        try { $stats['membership'] = self::getDaysSinceJoined($userId); } catch (\Throwable $e) { \Log::warning('GamificationService: stats[membership] failed', ['error' => $e->getMessage()]); }
        try { $stats['streak'] = (int) (UserStreak::where('user_id', $userId)->where('streak_type', 'login')->value('current_streak') ?? 0); } catch (\Throwable $e) { \Log::warning('GamificationService: stats[streak] failed', ['error' => $e->getMessage()]); }
        try { $stats['level'] = (int) (User::query()->where('id', $userId)->value('level') ?? 1); } catch (\Throwable $e) { \Log::warning('GamificationService: stats[level] failed', ['error' => $e->getMessage()]); }

        // Quality badge stats
        try {
            $completed = (int) self::realExchangesOnly(
                Transaction::where(function ($q) use ($userId) {
                    $q->where('sender_id', $userId)->orWhere('receiver_id', $userId);
                })
            )->where('status', 'completed')->count();
            $stats['reliability'] = $completed; // Simplified — actual check uses cancellation rate
        } catch (\Throwable $e) {
            \Log::warning('GamificationService: stats[reliability] failed', ['error' => $e->getMessage()]);
        }
        try {
            $stats['bridge_builder'] = (int) self::realExchangesOnly(
                DB::table('transactions')
                    ->join('listings', 'transactions.listing_id', '=', 'listings.id')
                    ->where('transactions.tenant_id', \App\Core\TenantContext::getId())
                    ->where(function ($q) use ($userId) {
                        $q->where('transactions.sender_id', $userId)->orWhere('transactions.receiver_id', $userId);
                    })->where('transactions.status', 'completed'),
                'transactions.'
            )
                ->distinct()->count('listings.category_id');
        } catch (\Throwable $e) {
            \Log::warning('GamificationService: stats[bridge_builder] failed', ['error' => $e->getMessage()]);
        }
        try { $stats['reciprocity'] = $stats['transaction']; } catch (\Throwable $e) { \Log::warning('GamificationService: stats[reciprocity] failed', ['error' => $e->getMessage()]); }

        return $stats;
    }

    private static function getProfileCompletion(int $userId): int
    {
        $user = User::query()->find($userId, ['first_name', 'last_name', 'email', 'bio', 'avatar_url', 'location', 'phone']);
        if (! $user) {
            return 0;
        }

        $fields = ['first_name', 'last_name', 'email', 'bio', 'avatar_url', 'location', 'phone'];
        $filled = 0;
        foreach ($fields as $field) {
            if (! empty($user->{$field})) {
                $filled++;
            }
        }

        return (int) round(($filled / count($fields)) * 100);
    }

    private static function getDaysSinceJoined(int $userId): int
    {
        $user = User::query()->find($userId, ['created_at']);
        if (! $user || ! $user->created_at) {
            return 0;
        }

        return (int) $user->created_at->diffInDays(now());
    }
}
