<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Services\BadgeCollectionService;
use App\Services\CommunityDashboardService;
use App\Services\EngagementRecognitionService;
use App\Services\LeaderboardService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use App\Core\TenantContext;
use App\Models\UserBadge;
use App\Services\ChallengeService;
use App\Services\DailyRewardService;
use App\Services\GamificationService;
use App\Services\LeaderboardSeasonService;
use App\Services\NexusScoreCacheService;
use App\Services\XPShopService;
use App\Support\UserDisplayName;

/**
 * GamificationV2Controller -- Gamification v2: profile, badges, leaderboard,
 * challenges, shop, seasons, nexus-score.
 *
 * Fully migrated from ob_start() delegation to direct service calls.
 */
class GamificationV2Controller extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly BadgeCollectionService $badgeCollectionService,
        private readonly ChallengeService $challengeService,
        private readonly DailyRewardService $dailyRewardService,
        private readonly GamificationService $gamificationServiceLegacy,
        private readonly LeaderboardSeasonService $leaderboardSeasonService,
        private readonly LeaderboardService $leaderboardService,
        private readonly NexusScoreCacheService $nexusScoreCacheService,
        private readonly XPShopService $xpShopService,
    ) {}

    // =====================================================================
    // PROFILE
    // =====================================================================

    /** GET /api/v2/gamification/profile */
    public function profile(): JsonResponse
    {
        // getOptionalUserId() — unauthenticated viewers must be able to load public profiles.
        // getUserId() would throw 401 for any anonymous user viewing a profile.
        $currentUserId = $this->getOptionalUserId();
        $targetUserId = $this->queryInt('user_id', $currentUserId ?? 0);

        $this->rateLimit('gamification_profile', 60, 60);

        $tenantId = TenantContext::getId();

        $userRow = DB::selectOne(
            "SELECT id, first_name, last_name, avatar_url, xp, level FROM users WHERE id = ? AND tenant_id = ?",
            [$targetUserId, $tenantId]
        );
        $user = $userRow ? (array)$userRow : null;

        if (!$user) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.user_not_found'), null, 404);
        }

        $xp = (int) ($user['xp'] ?? 0);
        $level = (int) ($user['level'] ?? 1);

        $progressPercent = $this->gamificationServiceLegacy->getLevelProgress($xp, $level);
        $currentThreshold = GamificationService::LEVEL_THRESHOLDS[$level] ?? 0;
        $nextThreshold = GamificationService::LEVEL_THRESHOLDS[$level + 1] ?? null;

        $badges = UserBadge::getForUser($targetUserId);
        $showcasedBadges = UserBadge::getShowcased($targetUserId);

        foreach ($showcasedBadges as &$badge) {
            $def = $this->gamificationServiceLegacy->getBadgeByKey($badge['badge_key']);
            if ($def) {
                $badge = array_merge($badge, $def);
            }
        }

        $profile = [
            'user' => [
                'id' => $user['id'],
                'name' => UserDisplayName::resolve($user),
                'avatar_url' => $user['avatar_url'],
            ],
            'xp' => $xp,
            'level' => $level,
            // 🔴 Must stay in this payload. GamificationService::getProfile() returns
            // level_name, and the Blade accessible frontend reads it from that service
            // directly to render "Level 3 (Contributor)". Any HTTP consumer — web-uk,
            // the React app, mobile — can only get it from here, so omitting it made the
            // level name unrenderable outside the PHP process and silently dropped the
            // level title from the accessible dashboard and achievements pages.
            'level_name' => GamificationService::getLevelName($level),
            'level_progress' => [
                'current_xp' => $xp,
                'xp_for_current_level' => $currentThreshold,
                'xp_for_next_level' => $nextThreshold ?? $currentThreshold,
                'progress_percentage' => $progressPercent,
            ],
            'badges_count' => count($badges),
            'showcased_badges' => $showcasedBadges,
            'is_own_profile' => ($currentUserId !== null && $targetUserId === $currentUserId),
        ];

        if ($currentUserId !== null && $targetUserId === $currentUserId) {
            $profile['xp_values'] = GamificationService::XP_VALUES;
            $profile['level_thresholds'] = GamificationService::LEVEL_THRESHOLDS;
        }

        return $this->respondWithData($profile);
    }

    // =====================================================================
    // BADGES
    // =====================================================================

    /** GET /api/v2/gamification/badges */
    public function badges(): JsonResponse
    {
        // getOptionalUserId() — unauthenticated viewers must be able to see badges on public profiles.
        $currentUserId = $this->getOptionalUserId();
        $targetUserId = $this->queryInt('user_id', $currentUserId ?? 0);
        $type = $this->query('type');
        $showcasedOnly = $this->inputBool('showcased', false);

        $this->rateLimit('gamification_badges', 60, 60);

        if ($showcasedOnly) {
            $badges = UserBadge::getShowcased($targetUserId);
        } else {
            $badges = UserBadge::getForUser($targetUserId);
        }

        $enrichedBadges = [];
        foreach ($badges as $badge) {
            $def = $this->gamificationServiceLegacy->getBadgeByKey($badge['badge_key']);
            if ($def) {
                $enriched = array_merge($badge, $def);
                $enriched['description'] = $enriched['msg'] ?? $enriched['description'] ?? null;

                if ($type && ($enriched['type'] ?? '') !== $type) {
                    continue;
                }

                $enrichedBadges[] = $enriched;
            }
        }

        $allDefinitions = $this->gamificationServiceLegacy->getBadgeDefinitions();
        $availableTypes = array_unique(array_column($allDefinitions, 'type'));

        return $this->respondWithData($enrichedBadges, [
            'total' => count($enrichedBadges),
            'available_types' => array_values($availableTypes),
        ]);
    }

    /** GET /api/v2/gamification/badges/{key} */
    public function showBadge(string $key): JsonResponse
    {
        $userId = $this->getUserId();

        $this->rateLimit('gamification_badge_detail', 60, 60);

        $definition = $this->gamificationServiceLegacy->getBadgeByKey($key);

        if (!$definition) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.badge_not_found'), null, 404);
        }

        $userBadgeRow = DB::selectOne(
            "SELECT * FROM user_badges WHERE user_id = ? AND badge_key = ? AND tenant_id = ?",
            [$userId, $key, $this->getTenantId()]
        );
        $userBadge = $userBadgeRow ? (array)$userBadgeRow : null;

        $badge = array_merge($definition, [
            'earned' => !empty($userBadge),
            'earned_at' => $userBadge['awarded_at'] ?? null,
            'is_showcased' => !empty($userBadge['is_showcased'] ?? false),
        ]);
        $badge['description'] = $badge['msg'] ?? $badge['description'] ?? null;

        return $this->respondWithData($badge);
    }

    // =====================================================================
    // LEADERBOARD
    // =====================================================================

    /** GET /api/v2/gamification/leaderboard */
    public function leaderboard(): JsonResponse
    {
        $userId = $this->getUserId();
        $period = $this->query('period', 'all');
        $limit = $this->queryInt('limit', 20, 1, 100);
        $type = $this->query('type', 'xp');

        $this->rateLimit('gamification_leaderboard', 30, 60);

        $tenantId = TenantContext::getId();

        $typeMap = [
            'xp' => 'xp',
            'volunteer_hours' => 'vol_hours',
            'credits_earned' => 'credits_earned',
            'nexus_score' => 'nexus_score',
        ];
        $serviceType = $typeMap[$type] ?? 'xp';

        $periodMap = [
            'all' => 'all_time',
            'season' => 'all_time',
            'month' => 'monthly',
            'week' => 'weekly',
        ];
        $servicePeriod = $periodMap[$period] ?? 'all_time';

        // NexusScore leaderboard
        if ($serviceType === 'nexus_score') {
            $tableCheck = DB::select("SHOW TABLES LIKE 'nexus_score_cache'");
            if (empty($tableCheck)) {
                return $this->respondWithData([], ['period' => $period, 'type' => $type, 'your_position' => null, 'total_entries' => 0, 'has_more' => false]);
            }

            // Fetch one extra row to detect whether more pages exist
            $rowResults = DB::select(
                "SELECT n.user_id, n.total_score, n.percentile, u.name, u.avatar_url, u.xp, u.level
                 FROM nexus_score_cache n
                 JOIN users u ON u.id = n.user_id
                 WHERE n.tenant_id = ? AND u.tenant_id = ? AND u.is_approved = 1
                 ORDER BY n.total_score DESC
                 LIMIT ?",
                [$tenantId, $tenantId, $limit + 1]
            );
            $rows = array_map(fn($r) => (array)$r, $rowResults);
            $hasMore = count($rows) > $limit;
            if ($hasMore) {
                array_pop($rows);
            }

            $leaderboard = [];
            foreach ($rows as $pos => $row) {
                $leaderboard[] = [
                    'position' => $pos + 1,
                    'user' => [
                        'id' => (int) $row['user_id'],
                        'name' => trim($row['name'] ?? ''),
                        'avatar_url' => $row['avatar_url'] ?? null,
                    ],
                    'xp' => (int) ($row['xp'] ?? 0),
                    'level' => (int) ($row['level'] ?? 1),
                    'score' => (float) $row['total_score'],
                    'is_current_user' => ((int) $row['user_id'] === (int) $userId),
                ];
            }

            $currentUserPosition = null;
            foreach ($leaderboard as $entry) {
                if ($entry['is_current_user']) {
                    $currentUserPosition = $entry['position'];
                    break;
                }
            }

            $totalNexus = (int) (DB::selectOne(
                "SELECT COUNT(*) AS cnt FROM nexus_score_cache n
                 JOIN users u ON u.id = n.user_id
                 WHERE n.tenant_id = ? AND u.tenant_id = ? AND u.is_approved = 1",
                [$tenantId, $tenantId]
            )->cnt ?? 0);

            return $this->respondWithData($leaderboard, [
                'period' => $period,
                'type' => $type,
                'your_position' => $currentUserPosition,
                'total_entries' => $totalNexus,
                'has_more' => $hasMore,
            ]);
        }

        // Standard leaderboard via LeaderboardService
        // Fetch one extra entry to detect whether more pages exist
        $rawEntries = $this->leaderboardService->getLeaderboardByType(
            $tenantId,
            $serviceType,
            $servicePeriod,
            $limit + 1,
            $userId
        );

        $hasMore = count($rawEntries) > $limit;
        if ($hasMore) {
            array_pop($rawEntries);
        }

        $leaderboard = [];
        foreach ($rawEntries as $entry) {
            $score = isset($entry['score']) ? (float) $entry['score'] : 0;
            $xp = ($serviceType === 'xp')
                ? (int) $score
                : (int) ($entry['xp'] ?? 0);

            $leaderboard[] = [
                'position' => (int) ($entry['rank'] ?? 0),
                'user' => [
                    'id' => (int) $entry['user_id'],
                    'name' => trim($entry['name'] ?? ''),
                    'avatar_url' => $entry['avatar_url'] ?? null,
                ],
                'xp' => $xp,
                'level' => (int) ($entry['level'] ?? 1),
                'score' => $score,
                'is_current_user' => ((int) $entry['user_id'] === (int) $userId),
            ];
        }

        $currentUserPosition = null;
        foreach ($leaderboard as $entry) {
            if ($entry['is_current_user']) {
                $currentUserPosition = $entry['position'];
                break;
            }
        }

        if ($currentUserPosition === null && $serviceType === 'xp') {
            $positionResult = DB::selectOne(
                "SELECT COUNT(*) + 1 AS position
                 FROM users
                 WHERE tenant_id = ? AND is_approved = 1 AND COALESCE(show_on_leaderboard, 1) = 1 AND xp > (
                     SELECT COALESCE(xp, 0) FROM users WHERE id = ?
                 )",
                [$tenantId, $userId]
            );
            $currentUserPosition = (int) ($positionResult->position ?? 0) ?: null;
        }

        $totalMembers = (int) (DB::selectOne(
            "SELECT COUNT(*) AS cnt FROM users WHERE tenant_id = ? AND is_approved = 1 AND COALESCE(show_on_leaderboard, 1) = 1",
            [$tenantId]
        )->cnt ?? 0);

        return $this->respondWithData($leaderboard, [
            'period' => $period,
            'type' => $type,
            'your_position' => $currentUserPosition,
            'total_entries' => $totalMembers,
            'has_more' => $hasMore,
        ]);
    }

    // =====================================================================
    // CHALLENGES
    // =====================================================================

    /** GET /api/v2/gamification/challenges */
    public function challenges(): JsonResponse
    {
        $userId = $this->getUserId();
        $this->rateLimit('gamification_challenges', 30, 60);

        try {
            $challenges = $this->challengeService->getChallengesWithProgress($userId);
            return $this->respondWithData($challenges);
        } catch (\Throwable $e) {
            return $this->respondWithError('SERVER_INTERNAL_ERROR', __('api.gamification_challenges_failed'), null, 500);
        }
    }

    /** POST /api/v2/gamification/challenges/{id}/claim */
    public function claimChallenge(int $id): JsonResponse
    {
        $userId = $this->getUserId();
        $this->rateLimit('gamification_claim_challenge', 10, 60);

        try {
            // Resolve the model, not an array: the reward is awarded by the
            // shared ChallengeService::awardChallengeReward(), which needs the
            // whole challenge (including badge_reward).
            $challenge = $this->challengeService->getModelById($id, $this->getTenantId());

            if (!$challenge) {
                return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.challenge_not_found'), null, 404);
            }

            $progressRow = DB::selectOne(
                "SELECT * FROM user_challenge_progress WHERE challenge_id = ? AND user_id = ? AND tenant_id = ?",
                [$id, $userId, $this->getTenantId()]
            );
            $progress = $progressRow ? (array)$progressRow : null;

            if (!$progress) {
                return $this->respondWithError('CHALLENGE_NOT_STARTED', __('api.gamification_challenge_not_started'), null, 400);
            }

            if (!empty($progress['reward_claimed'])) {
                return $this->respondWithError('CHALLENGE_ALREADY_CLAIMED', __('api.gamification_challenge_already_claimed'), null, 400);
            }

            if (empty($progress['completed_at'])) {
                return $this->respondWithError('CHALLENGE_NOT_COMPLETED', __('api.gamification_challenge_not_completed'), null, 400);
            }

            // Atomic claim: UPDATE only if reward_claimed is still 0 to prevent
            // double-award under concurrent requests (TOCTOU race condition).
            // `claimed_at` is stamped here too so this path leaves the same
            // ledger row as ChallengeService::claim() — it was omitted, so every
            // React claim left claimed_at NULL while accessible claims set it.
            $affected = DB::update(
                "UPDATE user_challenge_progress SET reward_claimed = 1, claimed_at = NOW() WHERE challenge_id = ? AND user_id = ? AND tenant_id = ? AND reward_claimed = 0",
                [$id, $userId, $this->getTenantId()]
            );

            if ($affected === 0) {
                return $this->respondWithError('CHALLENGE_ALREADY_CLAIMED', __('api.gamification_challenge_already_claimed'), null, 400);
            }

            // 🔴 Award via the ONE shared routine — do not award anything here.
            // This path used to award XP inline and ignored challenges.badge_reward
            // entirely, so the same challenge granted a badge and a notification on
            // the accessible frontend and neither here. Any new reward belongs in
            // ChallengeService::awardChallengeReward() so both frontends get it.
            $reward = $this->challengeService->awardChallengeReward($userId, $challenge);

            return $this->respondWithData([
                'claimed' => true,
                'challenge_id' => $id,
                'reward' => [
                    'xp' => $reward['xp'],
                    'badge' => $reward['badge'],
                ],
            ]);
        } catch (\Throwable $e) {
            return $this->respondWithError('SERVER_INTERNAL_ERROR', __('api.gamification_claim_failed'), null, 500);
        }
    }

    // =====================================================================
    // COLLECTIONS
    // =====================================================================

    /** GET /api/v2/gamification/collections */
    public function collections(): JsonResponse
    {
        $userId = $this->getUserId();
        $this->rateLimit('gamification_collections', 30, 60);

        try {
            $collections = $this->badgeCollectionService->getCollectionsWithProgress($userId);
            return $this->respondWithData($collections);
        } catch (\Throwable $e) {
            return $this->respondWithError('SERVER_INTERNAL_ERROR', __('api.gamification_collections_failed'), null, 500);
        }
    }

    // =====================================================================
    // DAILY REWARD
    // =====================================================================

    /** GET /api/v2/gamification/daily-reward */
    public function dailyRewardStatus(): JsonResponse
    {
        $userId = $this->getUserId();
        $this->rateLimit('gamification_daily_status', 30, 60);

        try {
            $status = $this->dailyRewardService->getTodayStatus($userId);
            return $this->respondWithData($status);
        } catch (\Throwable $e) {
            return $this->respondWithError('SERVER_INTERNAL_ERROR', __('api.gamification_daily_unavailable'), null, 500);
        }
    }

    /** POST /api/v2/gamification/daily-reward */
    public function claimDailyReward(): JsonResponse
    {
        $userId = $this->getUserId();
        $this->rateLimit('gamification_daily_claim', 10, 60);

        try {
            $reward = $this->dailyRewardService->checkAndAwardDailyReward($userId);

            if ($reward === null) {
                return $this->respondWithError('RESOURCE_CONFLICT', __('api.gamification_daily_already_claimed'), null, 409);
            }

            return $this->respondWithData([
                'claimed' => true,
                'reward' => $reward,
            ]);
        } catch (\Throwable $e) {
            return $this->respondWithError('SERVER_INTERNAL_ERROR', __('api.gamification_daily_claim_failed'), null, 500);
        }
    }

    // =====================================================================
    // SHOP
    // =====================================================================

    /** GET /api/v2/gamification/shop */
    public function shop(): JsonResponse
    {
        $userId = $this->getUserId();
        $this->rateLimit('gamification_shop', 30, 60);

        try {
            $data = $this->xpShopService->getItemsWithUserStatus($userId);
            return $this->respondWithData($data['items'] ?? $data, ['user_xp' => $data['user_xp'] ?? null]);
        } catch (\Throwable $e) {
            return $this->respondWithError('SERVER_INTERNAL_ERROR', __('api.gamification_shop_failed'), null, 500);
        }
    }

    /** POST /api/v2/gamification/shop/purchase */
    public function purchase(): JsonResponse
    {
        $userId = $this->getUserId();
        $this->rateLimit('gamification_purchase', 10, 60);

        $itemId = $this->input('item_id');

        if (empty($itemId)) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.gamification_item_id_required'), 'item_id', 400);
        }

        try {
            $result = $this->xpShopService->purchaseItem($userId, $itemId);

            if ($result['success'] ?? false) {
                return $this->respondWithData($result);
            } else {
                return $this->respondWithError('RESOURCE_CONFLICT', $result['error'] ?? __('api.purchase_failed'), null, 400);
            }
        } catch (\Throwable $e) {
            return $this->respondWithError('SERVER_INTERNAL_ERROR', __('api.gamification_purchase_failed'), null, 500);
        }
    }

    // =====================================================================
    // SHOWCASE
    // =====================================================================

    /** PUT /api/v2/gamification/showcase */
    public function updateShowcase(): JsonResponse
    {
        $userId = $this->getUserId();
        $this->rateLimit('gamification_showcase', 10, 60);

        $badgeKeys = $this->input('badge_keys', []);

        if (!is_array($badgeKeys)) {
            return $this->respondWithError('VALIDATION_INVALID_FORMAT', __('api.gamification_badge_keys_array'), 'badge_keys', 400);
        }

        if (count($badgeKeys) > 5) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.gamification_max_5_showcase'), 'badge_keys', 400);
        }

        $userBadges = UserBadge::getForUser($userId);
        $userBadgeKeys = array_column($userBadges, 'badge_key');

        $invalidKeys = array_diff($badgeKeys, $userBadgeKeys);
        if (!empty($invalidKeys)) {
            return $this->respondWithError('VALIDATION_INVALID_VALUE', __('api.gamification_badges_not_owned'), 'badge_keys', 400);
        }

        try {
            UserBadge::updateShowcase($userId, $badgeKeys);

            $showcased = UserBadge::getShowcased($userId);
            foreach ($showcased as &$badge) {
                $def = $this->gamificationServiceLegacy->getBadgeByKey($badge['badge_key']);
                if ($def) {
                    $badge = array_merge($badge, $def);
                }
            }

            return $this->respondWithData([
                'message' => __('api.showcase_updated'),
                'showcased_badges' => $showcased,
            ]);
        } catch (\Throwable $e) {
            return $this->respondWithError('SERVER_INTERNAL_ERROR', __('api.gamification_showcase_update_failed'), null, 500);
        }
    }

    // =====================================================================
    // SEASONS
    // =====================================================================

    /** GET /api/v2/gamification/seasons */
    public function seasons(): JsonResponse
    {
        $this->rateLimit('gamification_seasons', 30, 60);

        try {
            $seasons = $this->leaderboardSeasonService->getAllSeasons();
            return $this->respondWithData($seasons);
        } catch (\Throwable $e) {
            return $this->respondWithError('SERVER_INTERNAL_ERROR', __('api.gamification_seasons_failed'), null, 500);
        }
    }

    /** GET /api/v2/gamification/seasons/current */
    public function currentSeason(): JsonResponse
    {
        $userId = $this->getUserId();
        $this->rateLimit('gamification_current_season', 30, 60);

        try {
            $data = $this->leaderboardSeasonService->getSeasonWithUserData($userId);

            if ($data === null) {
                return $this->respondWithData([
                    'season' => null,
                    'user_rank' => null,
                    'user_data' => null,
                    'leaderboard' => [],
                    'rewards' => null,
                    'days_remaining' => 0,
                    'is_ending_soon' => false,
                    'total_participants' => 0,
                ]);
            }

            return $this->respondWithData($data);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('[GamificationV2] currentSeason error: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
            return $this->respondWithError('SERVER_INTERNAL_ERROR', __('api.gamification_season_current_failed'), null, 500);
        }
    }

    // =====================================================================
    // NEXUS SCORE
    // =====================================================================

    /** GET /api/v2/gamification/nexus-score */
    public function nexusScore(): JsonResponse
    {
        $userId = $this->getUserId();
        $tenantId = TenantContext::getId();

        $this->rateLimit('nexus_score', 30, 60);

        $force = request()->boolean('force', false);

        try {
            $scoreData = $this->nexusScoreCacheService->getScore($userId, $tenantId, $force);

            $tier = $scoreData['tier'];
            if (is_array($tier)) {
                $tierName = $tier['name'] ?? 'Novice';
                $tierIcon = $tier['icon'] ?? '';
                $tierColor = $tier['color'] ?? '';
            } else {
                $tierName = (string) $tier;
                $tierIcon = '';
                $tierColor = '';
            }

            $breakdown = $scoreData['breakdown'] ?? [];
            $formatted = [];
            $categoryMeta = [
                'engagement' => ['label' => 'Community Engagement', 'max' => 250],
                'quality' => ['label' => 'Contribution Quality', 'max' => 200],
                'volunteer' => ['label' => 'Volunteer Hours', 'max' => 200],
                'activity' => ['label' => 'Platform Activity', 'max' => 150],
                'badges' => ['label' => 'Badges & Achievements', 'max' => 100],
                'impact' => ['label' => 'Social Impact', 'max' => 100],
            ];
            foreach ($categoryMeta as $key => $meta) {
                $cat = $breakdown[$key] ?? [];
                $formatted[] = [
                    'key' => $key,
                    'label' => $meta['label'],
                    'score' => (int) ($cat['score'] ?? 0),
                    'max' => $meta['max'],
                    'percentage' => $meta['max'] > 0
                        ? round((($cat['score'] ?? 0) / $meta['max']) * 100, 1)
                        : 0,
                    'details' => $cat['details'] ?? [],
                ];
            }

            return $this->respondWithData([
                'total_score' => (int) ($scoreData['total_score'] ?? 0),
                'max_score' => 1000,
                'percentage' => (float) ($scoreData['percentage'] ?? 0),
                'percentile' => (float) ($scoreData['percentile'] ?? 0),
                'tier' => [
                    'name' => $tierName,
                    'icon' => $tierIcon,
                    'color' => $tierColor,
                ],
                'breakdown' => $formatted,
                'insights' => array_map(function ($i) {
                    return is_array($i) ? ($i['message'] ?? $i['title'] ?? '') : (string) $i;
                }, $scoreData['insights'] ?? []),
            ]);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("NexusScore error for user {$userId}: " . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
            return $this->respondWithError('SERVER_INTERNAL_ERROR', __('api.gamification_nexus_score_failed'), null, 500);
        }
    }

    // =====================================================================
    // COMMUNITY DASHBOARD (Gamification Redesign)
    // =====================================================================

    /** GET /api/v2/gamification/community-dashboard */
    public function communityDashboard(): JsonResponse
    {
        $tenantId = TenantContext::getId();
        $data = CommunityDashboardService::getCommunityImpact($tenantId);

        return $this->respondWithData($data);
    }

    /** GET /api/v2/gamification/personal-journey */
    public function personalJourney(): JsonResponse
    {
        $userId = $this->getUserId();
        $tenantId = TenantContext::getId();
        $data = CommunityDashboardService::getPersonalJourney($tenantId, $userId);

        return $this->respondWithData($data);
    }

    /** GET /api/v2/gamification/member-spotlight */
    public function memberSpotlight(): JsonResponse
    {
        $tenantId = TenantContext::getId();
        $limit = (int) (request()->query('limit', 3));
        $data = CommunityDashboardService::getMemberSpotlight($tenantId, min($limit, 10));

        return $this->respondWithData($data);
    }

    /** GET /api/v2/gamification/engagement-history */
    public function engagementHistory(): JsonResponse
    {
        $userId = $this->getUserId();
        $tenantId = TenantContext::getId();

        try {
            $data = EngagementRecognitionService::getEngagementHistory($tenantId, $userId);

            return $this->respondWithData($data);
        } catch (\Throwable $e) {
            return $this->respondWithError('SERVER_ERROR', __('api.server_error'), null, 500);
        }
    }
}
