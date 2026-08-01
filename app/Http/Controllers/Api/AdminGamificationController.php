<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Core\TenantContext;
use App\Models\User;
use App\Services\GamificationService;
use App\Services\AchievementCampaignService;
use App\Services\BadgeDefinitionService;

/**
 * AdminGamificationController -- Admin gamification: stats, badges, campaigns, bulk awards.
 *
 * All methods require admin authentication.
 */
class AdminGamificationController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly GamificationService $gamificationService,
        private readonly AchievementCampaignService $achievementCampaignService,
    ) {}

    /** GET /api/v2/admin/gamification/stats */
    public function stats(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $totalBadgesAwarded = 0;
        $activeUsers = 0;
        $totalXp = 0;
        $activeCampaigns = 0;
        $badgeDistribution = [];
        $builtInBadgeNameCodes = [];

        try { $totalBadgesAwarded = (int) DB::selectOne("SELECT COUNT(*) as cnt FROM user_badges ub JOIN users u ON ub.user_id = u.id WHERE u.tenant_id = ?", [$tenantId])->cnt; } catch (\Throwable $e) { Log::warning('AdminGamificationController: ' . $e->getMessage(), ['context' => __METHOD__]); }
        try { $activeUsers = (int) DB::selectOne("SELECT COUNT(DISTINCT ub.user_id) as cnt FROM user_badges ub JOIN users u ON ub.user_id = u.id WHERE u.tenant_id = ?", [$tenantId])->cnt; } catch (\Throwable $e) { Log::warning('AdminGamificationController: ' . $e->getMessage(), ['context' => __METHOD__]); }
        try { $totalXp = (int) DB::selectOne("SELECT COALESCE(SUM(xp), 0) as total FROM users WHERE tenant_id = ?", [$tenantId])->total; } catch (\Throwable $e) { Log::warning('AdminGamificationController: ' . $e->getMessage(), ['context' => __METHOD__]); }
        try { $activeCampaigns = (int) DB::selectOne("SELECT COUNT(*) as cnt FROM achievement_campaigns WHERE tenant_id = ? AND status = 'active'", [$tenantId])->cnt; } catch (\Throwable $e) { Log::warning('AdminGamificationController: ' . $e->getMessage(), ['context' => __METHOD__]); }

        try {
            foreach ($this->gamificationService->getBadgeDefinitions() as $definition) {
                $badgeKey = (string) ($definition['key'] ?? '');
                if ($badgeKey !== '') {
                    $builtInBadgeNameCodes[$badgeKey] = self::badgeTranslationCode($definition, $badgeKey, 'name');
                }
            }
        } catch (\Throwable $e) { Log::warning('AdminGamificationController: ' . $e->getMessage(), ['context' => __METHOD__]); }

        try {
            $rows = DB::select(
                "SELECT ub.badge_key, ub.name as badge_name, COUNT(*) as count FROM user_badges ub JOIN users u ON ub.user_id = u.id
                 WHERE u.tenant_id = ? GROUP BY ub.badge_key, ub.name ORDER BY count DESC LIMIT 10",
                [$tenantId]
            );
            $badgeDistribution = array_map(fn($r) => [
                'badge_key' => $r->badge_key,
                'badge_name' => $r->badge_name,
                'name_code' => $builtInBadgeNameCodes[$r->badge_key] ?? null,
                'count' => (int) $r->count,
            ], $rows);
        } catch (\Throwable $e) { Log::warning('AdminGamificationController: ' . $e->getMessage(), ['context' => __METHOD__]); }

        return $this->respondWithData([
            'total_badges_awarded' => $totalBadgesAwarded,
            'active_users' => $activeUsers,
            'total_xp_awarded' => $totalXp,
            'active_campaigns' => $activeCampaigns,
            'badge_distribution' => $badgeDistribution,
        ]);
    }

    /** GET /api/v2/admin/gamification/badges */
    public function badges(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $badges = [];

        try {
            $definitions = $this->gamificationService->getBadgeDefinitions();
            foreach ($definitions as $def) {
                $badgeKey = (string) ($def['key'] ?? '');
                $badges[] = [
                    'id' => null,
                    'key' => $badgeKey,
                    'name' => $def['name'] ?? $badgeKey,
                    'name_code' => self::badgeTranslationCode($def, $badgeKey, 'name'),
                    'description' => $def['msg'] ?? $def['description'] ?? '',
                    'description_code' => self::badgeTranslationCode($def, $badgeKey, 'description'),
                    'icon' => $def['icon'] ?? 'award',
                    'type' => 'built_in',
                    'awarded_count' => 0,
                ];
            }
        } catch (\Throwable $e) { Log::warning('AdminGamificationController: ' . $e->getMessage(), ['context' => __METHOD__]); }

        try {
            $customBadges = DB::select("SELECT * FROM custom_badges WHERE tenant_id = ? ORDER BY created_at DESC", [$tenantId]);
            foreach ($customBadges as $cb) {
                $badges[] = ['id' => (int) $cb->id, 'key' => 'custom_' . $cb->id, 'name' => $cb->name, 'description' => $cb->description ?? '', 'icon' => $cb->icon ?? 'award', 'type' => 'custom', 'awarded_count' => 0];
            }
        } catch (\Throwable $e) { Log::warning('AdminGamificationController: ' . $e->getMessage(), ['context' => __METHOD__]); }

        try {
            $counts = DB::select("SELECT ub.badge_key, COUNT(*) as cnt FROM user_badges ub JOIN users u ON ub.user_id = u.id WHERE u.tenant_id = ? GROUP BY ub.badge_key", [$tenantId]);
            $countMap = [];
            foreach ($counts as $row) { $countMap[$row->badge_key] = (int) $row->cnt; }
            foreach ($badges as &$badge) { $badge['awarded_count'] = $countMap[$badge['key']] ?? 0; }
            unset($badge);
        } catch (\Throwable $e) { Log::warning('AdminGamificationController: ' . $e->getMessage(), ['context' => __METHOD__]); }

        return $this->respondWithData($badges);
    }

    /**
     * Return a stable translation code for a built-in badge while preserving
     * any explicit semantic code supplied by the badge-definition service.
     *
     * @param array<string, mixed> $definition
     */
    private static function badgeTranslationCode(array $definition, string $badgeKey, string $field): ?string
    {
        if ($badgeKey === '') {
            return null;
        }

        $codeField = $field . '_code';
        if (array_key_exists($codeField, $definition)) {
            $explicitCode = $definition[$codeField];
            return is_string($explicitCode) && $explicitCode !== '' ? $explicitCode : null;
        }

        return "badges.{$badgeKey}.{$field}";
    }

    /** POST /api/v2/admin/gamification/badges */
    public function createBadge(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $name = trim($this->input('name', ''));
        if (empty($name)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.badge_name_required'), 'name', 422);
        }

        $description = trim($this->input('description', ''));
        $icon = trim($this->input('icon', 'award'));

        try {
            $badgeKey = 'custom_' . strtolower(preg_replace('/[^a-z0-9]+/i', '_', $name)) . '_' . time();
            DB::insert(
                "INSERT INTO custom_badges (tenant_id, badge_key, name, description, icon, badge_type, xp_reward, is_active, created_at) VALUES (?, ?, ?, ?, ?, 'custom', 0, 1, NOW())",
                [$tenantId, $badgeKey, $name, $description, $icon]
            );
            $id = (int) DB::getPdo()->lastInsertId();

            return $this->respondWithData(['id' => $id, 'key' => $badgeKey, 'name' => $name, 'description' => $description, 'icon' => $icon, 'type' => 'custom'], null, 201);
        } catch (\Throwable $e) {
            Log::warning('AdminGamificationController: createBadge failed: ' . $e->getMessage(), ['context' => __METHOD__]);
            return $this->respondWithError('SERVER_ERROR', __('api.create_failed', ['resource' => 'badge']), null, 500);
        }
    }

    /** DELETE /api/v2/admin/gamification/badges/{id} */
    public function deleteBadge(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        try {
            $badge = DB::selectOne("SELECT * FROM custom_badges WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
            if (!$badge) {
                return $this->respondWithError('NOT_FOUND', __('api.badge_not_found'), null, 404);
            }

            $actualKey = $badge->badge_key ?? ('custom_' . $id);
            try { DB::delete("DELETE FROM user_badges WHERE badge_key = ? AND user_id IN (SELECT id FROM users WHERE tenant_id = ?)", [$actualKey, $tenantId]); } catch (\Throwable $e) { Log::warning('AdminGamificationController: ' . $e->getMessage(), ['context' => __METHOD__]); }
            DB::delete("DELETE FROM custom_badges WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);

            return $this->respondWithData(['deleted' => true]);
        } catch (\Throwable $e) {
            Log::warning('AdminGamificationController: deleteBadge failed: ' . $e->getMessage(), ['context' => __METHOD__]);
            return $this->respondWithError('SERVER_ERROR', __('api.delete_failed', ['resource' => 'badge']), null, 500);
        }
    }

    /** GET /api/v2/admin/gamification/campaigns */
    public function campaigns(): JsonResponse
    {
        $this->requireAdmin();
        try {
            $campaigns = $this->achievementCampaignService->getCampaigns();
            $formatted = array_map(fn($c) => [
                'id' => (int) $c['id'], 'name' => $c['name'] ?? '', 'description' => $c['description'] ?? '', 'status' => $c['status'] ?? 'draft',
                'badge_key' => $c['badge_key'] ?? null, 'badge_name' => $c['badge_key'] ?? '', 'target_audience' => $c['target_audience'] ?? 'all_users',
                'start_date' => $c['activated_at'] ?? null, 'end_date' => null, 'total_awards' => (int) ($c['total_awards'] ?? 0), 'created_at' => $c['created_at'] ?? '',
            ], $campaigns);
            return $this->respondWithData($formatted);
        } catch (\Throwable $e) {
            Log::warning('AdminGamificationController: campaigns fetch failed: ' . $e->getMessage(), ['context' => __METHOD__]);
            return $this->respondWithData([]);
        }
    }

    /** POST /api/v2/admin/gamification/campaigns */
    public function createCampaign(): JsonResponse
    {
        $this->requireAdmin();
        $name = trim($this->input('name', ''));
        if (empty($name)) return $this->respondWithError('VALIDATION_ERROR', __('api.campaign_name_required'), 'name');

        try {
            $id = $this->achievementCampaignService->createCampaign([
                'name' => $name, 'description' => trim($this->input('description', '')), 'type' => $this->input('type', 'one_time'),
                'badge_key' => $this->input('badge_key', ''), 'xp_amount' => (int) $this->input('xp_amount', 0),
                'target_audience' => $this->input('target_audience', 'all_users'), 'audience_config' => $this->input('audience_config', []),
                'schedule' => $this->input('schedule'),
            ]);
            return $this->respondWithData(['id' => (int) $id, 'name' => $name, 'status' => 'draft'], null, 201);
        } catch (\Throwable $e) {
            Log::error('Failed to create campaign: ' . $e->getMessage());
            return $this->respondWithError('SERVER_ERROR', __('api.create_failed', ['resource' => 'campaign']), null, 500);
        }
    }

    /** PUT /api/v2/admin/gamification/campaigns/{id} */
    public function updateCampaign(int $id): JsonResponse
    {
        $this->requireAdmin();
        $campaign = $this->achievementCampaignService->getCampaign($id);
        if (!$campaign) return $this->respondWithError('NOT_FOUND', __('api.campaign_not_found'), null, 404);

        $newStatus = $this->input('status');
        if ($newStatus && $newStatus !== $campaign['status']) {
            if ($newStatus === 'active') $this->achievementCampaignService->activateCampaign($id);
            elseif ($newStatus === 'paused') $this->achievementCampaignService->pauseCampaign($id);
        }

        try {
            $this->achievementCampaignService->updateCampaign($id, [
                'name' => trim($this->input('name', $campaign['name'])), 'description' => trim($this->input('description', $campaign['description'] ?? '')),
                'type' => $this->input('type', $campaign['type'] ?? 'one_time'), 'badge_key' => $this->input('badge_key', $campaign['badge_key'] ?? ''),
                'xp_amount' => (int) $this->input('xp_amount', $campaign['xp_amount'] ?? 0),
                'target_audience' => $this->input('target_audience', $campaign['target_audience'] ?? 'all_users'),
                'audience_config' => $this->input('audience_config', json_decode($campaign['audience_config'] ?? '{}', true)),
                'schedule' => $this->input('schedule', $campaign['schedule'] ?? null),
            ]);
            return $this->respondWithData(['id' => $id, 'updated' => true]);
        } catch (\Throwable $e) {
            Log::error('Failed to update campaign: ' . $e->getMessage());
            return $this->respondWithError('SERVER_ERROR', __('api.update_failed', ['resource' => 'campaign']), null, 500);
        }
    }

    /** DELETE /api/v2/admin/gamification/campaigns/{id} */
    public function deleteCampaign(int $id): JsonResponse
    {
        $this->requireAdmin();
        $campaign = $this->achievementCampaignService->getCampaign($id);
        if (!$campaign) return $this->respondWithError('NOT_FOUND', __('api.campaign_not_found'), null, 404);
        try { $this->achievementCampaignService->deleteCampaign($id); return $this->respondWithData(['deleted' => true]); }
        catch (\Throwable $e) {
            Log::warning('AdminGamificationController: deleteCampaign failed: ' . $e->getMessage(), ['context' => __METHOD__]);
            return $this->respondWithError('SERVER_ERROR', __('api.delete_failed', ['resource' => 'campaign']), null, 500);
        }
    }

    // ── Challenges CRUD ─────────────────────────────────────────────────
    //
    // Challenges were member-visible (view + claim on both frontends) long
    // before an admin could create one anywhere but the database console.
    // action_type is restricted to ChallengeService::SUPPORTED_ACTION_TYPES:
    // only actions wired through EngagementService ever progress, so offering
    // any other XP action here would create challenges stuck at zero.

    /** GET /api/v2/admin/gamification/challenges */
    public function challenges(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $filters = [
            'limit' => (int) $this->input('limit', 50),
            'offset' => (int) $this->input('offset', 0),
        ];
        if ($this->input('challenge_type')) {
            $filters['challenge_type'] = (string) $this->input('challenge_type');
        }
        if ($this->input('is_active') !== null && $this->input('is_active') !== '') {
            $filters['is_active'] = filter_var($this->input('is_active'), FILTER_VALIDATE_BOOLEAN);
        }

        $result = \App\Services\ChallengeService::getAll($tenantId, $filters);

        return $this->respondWithData([
            'challenges' => $result['items'],
            'total' => $result['total'],
            'supported_action_types' => \App\Services\ChallengeService::SUPPORTED_ACTION_TYPES,
            'challenge_types' => \App\Services\ChallengeService::CHALLENGE_TYPES,
        ]);
    }

    /**
     * Shared field validation for challenge writes.
     *
     * @param  array<string,mixed>  $data
     * @return string|null a field name that failed, or null when valid
     */
    private function invalidChallengeField(array $data, bool $partial): ?string
    {
        if (! $partial || array_key_exists('title', $data)) {
            if (trim((string) ($data['title'] ?? '')) === '') {
                return 'title';
            }
        }
        if (! $partial || array_key_exists('action_type', $data)) {
            if (! in_array((string) ($data['action_type'] ?? ''), \App\Services\ChallengeService::SUPPORTED_ACTION_TYPES, true)) {
                return 'action_type';
            }
        }
        if (array_key_exists('challenge_type', $data)
            && ! in_array((string) $data['challenge_type'], \App\Services\ChallengeService::CHALLENGE_TYPES, true)) {
            return 'challenge_type';
        }
        if (array_key_exists('target_count', $data) && (int) $data['target_count'] < 1) {
            return 'target_count';
        }
        if (array_key_exists('xp_reward', $data)
            && ((int) $data['xp_reward'] < 0 || (int) $data['xp_reward'] > 1000)) {
            return 'xp_reward';
        }

        $start = $data['start_date'] ?? null;
        $end = $data['end_date'] ?? null;
        if (! $partial && (empty($start) || empty($end))) {
            return empty($start) ? 'start_date' : 'end_date';
        }
        if (! empty($start) && ! empty($end)) {
            try {
                if (\Illuminate\Support\Carbon::parse((string) $end)->lt(\Illuminate\Support\Carbon::parse((string) $start))) {
                    return 'end_date';
                }
            } catch (\Throwable) {
                return 'end_date';
            }
        }

        return null;
    }

    /** POST /api/v2/admin/gamification/challenges */
    public function createChallenge(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $data = [
            'title' => trim((string) $this->input('title', '')),
            'description' => $this->input('description'),
            'challenge_type' => (string) $this->input('challenge_type', 'weekly'),
            'action_type' => (string) $this->input('action_type', ''),
            'target_count' => (int) $this->input('target_count', 1),
            'xp_reward' => (int) $this->input('xp_reward', 50),
            'badge_reward' => $this->input('badge_reward'),
            'start_date' => $this->input('start_date'),
            'end_date' => $this->input('end_date'),
            'is_active' => filter_var($this->input('is_active', true), FILTER_VALIDATE_BOOLEAN),
        ];

        if (($field = $this->invalidChallengeField($data, false)) !== null) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.challenge_field_invalid'), $field, 422);
        }

        try {
            $id = \App\Services\ChallengeService::create($tenantId, $data);

            return $this->respondWithData(
                \App\Services\ChallengeService::getById((int) $id, $tenantId),
                null,
                201,
            );
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (\Throwable $e) {
            Log::error('Failed to create challenge: ' . $e->getMessage());

            return $this->respondWithError('SERVER_ERROR', __('api.create_failed', ['resource' => 'challenge']), null, 500);
        }
    }

    /** PUT /api/v2/admin/gamification/challenges/{id} */
    public function updateChallenge(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        if (\App\Services\ChallengeService::getById($id, $tenantId) === null) {
            return $this->respondWithError('NOT_FOUND', __('api.challenge_not_found'), null, 404);
        }

        $data = [];
        foreach (['title', 'description', 'challenge_type', 'action_type', 'badge_reward', 'start_date', 'end_date'] as $key) {
            if ($this->input($key) !== null) {
                $data[$key] = $this->input($key);
            }
        }
        foreach (['target_count', 'xp_reward'] as $key) {
            if ($this->input($key) !== null) {
                $data[$key] = (int) $this->input($key);
            }
        }
        if ($this->input('is_active') !== null) {
            $data['is_active'] = filter_var($this->input('is_active'), FILTER_VALIDATE_BOOLEAN);
        }

        if (($field = $this->invalidChallengeField($data, true)) !== null) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.challenge_field_invalid'), $field, 422);
        }

        try {
            \App\Services\ChallengeService::update($id, $tenantId, $data);

            return $this->respondWithData(\App\Services\ChallengeService::getById($id, $tenantId));
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (\Throwable $e) {
            Log::error('Failed to update challenge: ' . $e->getMessage());

            return $this->respondWithError('SERVER_ERROR', __('api.update_failed', ['resource' => 'challenge']), null, 500);
        }
    }

    /** DELETE /api/v2/admin/gamification/challenges/{id} */
    public function deleteChallenge(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        if (\App\Services\ChallengeService::getById($id, $tenantId) === null) {
            return $this->respondWithError('NOT_FOUND', __('api.challenge_not_found'), null, 404);
        }

        try {
            \App\Services\ChallengeService::delete($id, $tenantId);

            // ON DELETE CASCADE takes member progress with it — the admin UI
            // warns before calling this.
            return $this->respondWithData(['deleted' => true]);
        } catch (\Throwable $e) {
            Log::warning('AdminGamificationController: deleteChallenge failed: ' . $e->getMessage(), ['context' => __METHOD__]);

            return $this->respondWithError('SERVER_ERROR', __('api.delete_failed', ['resource' => 'challenge']), null, 500);
        }
    }

    /** POST /api/v2/admin/gamification/recheck-all */
    public function recheckAll(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        try {
            // Process in chunks to avoid loading all user IDs at once and to limit
            // memory usage. Each chunk processes 100 users before fetching the next batch.
            $checked = 0;
            $lastId = 0;
            $chunkSize = 100;

            do {
                $users = DB::select(
                    "SELECT id FROM users WHERE tenant_id = ? AND is_approved = 1 AND id > ? ORDER BY id ASC LIMIT ?",
                    [$tenantId, $lastId, $chunkSize]
                );

                foreach ($users as $user) {
                    $this->gamificationService->runAllBadgeChecks((int) $user->id);
                    $checked++;
                    $lastId = (int) $user->id;
                }
            } while (count($users) === $chunkSize);

            return $this->respondWithData(['users_checked' => $checked, 'message' => __('api_controllers_1.admin_gamification.badge_recheck_completed', ['count' => $checked])]);
        } catch (\Throwable $e) {
            Log::error('Badge recheck failed: ' . $e->getMessage());
            return $this->respondWithError('SERVER_ERROR', __('api.badge_recheck_failed'), null, 500);
        }
    }

    /** POST /api/v2/admin/gamification/bulk-award */
    public function bulkAward(): JsonResponse
    {
        $this->requireAdmin();
        $badgeSlug = trim($this->input('badge_slug', ''));
        $userIds = $this->input('user_ids', []);

        if (empty($badgeSlug)) return $this->respondWithError('VALIDATION_ERROR', __('api.badge_slug_required'), 'badge_slug', 422);
        if (empty($userIds) || !is_array($userIds)) return $this->respondWithError('VALIDATION_ERROR', __('api.user_ids_required'), 'user_ids', 422);

        // Validate that the badge_slug exists and is enabled for this tenant
        $tenantId = TenantContext::getId();
        $badgeDef = BadgeDefinitionService::getBadgeByKey($badgeSlug, $tenantId);
        if ($badgeDef === null) {
            // Also check custom badges in DB
            $customBadge = DB::selectOne(
                "SELECT id FROM custom_badges WHERE badge_key = ? AND tenant_id = ? AND is_active = 1",
                [$badgeSlug, $tenantId]
            );
            if (!$customBadge) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.badge_slug_invalid'), 'badge_slug', 422);
            }
        }

        // Filter user_ids to only include users belonging to the current tenant
        $validUserIds = User::where('tenant_id', $tenantId)
            ->whereIn('id', $userIds)
            ->pluck('id')
            ->toArray();

        $awarded = 0; $errors = [];
        foreach ($validUserIds as $userId) {
            try { $this->gamificationService->awardBadgeByKey((int) $userId, $badgeSlug); $awarded++; }
            catch (\Throwable $e) { $errors[] = "User {$userId}: " . $e->getMessage(); }
        }

        return $this->respondWithData(['awarded' => $awarded, 'total_requested' => count($validUserIds), 'errors' => $errors]);
    }

    /** GET /api/v2/admin/gamification/badge-config */
    public function getBadgeConfig(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $badges = BadgeDefinitionService::getAllBadgesForAdmin($tenantId);

        return $this->respondWithData($badges);
    }

    /** PUT /api/v2/admin/gamification/badge-config/{badgeKey} */
    public function updateBadgeConfig(string $badgeKey): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $data = request()->only(['is_enabled', 'custom_threshold', 'custom_name', 'custom_description', 'custom_icon']);

        $success = BadgeDefinitionService::updateTenantOverride($tenantId, $badgeKey, $data);

        if (!$success) {
            return $this->respondWithError('BADGE_UPDATE_FAILED', __('api.update_failed', ['resource' => 'badge configuration']), null, 422);
        }

        return $this->respondWithData(['success' => true]);
    }

    /** POST /api/v2/admin/gamification/badge-config/{badgeKey}/reset */
    public function resetBadgeConfig(string $badgeKey): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $success = BadgeDefinitionService::resetTenantOverride($tenantId, $badgeKey);

        return $this->respondWithData(['success' => $success]);
    }
}
