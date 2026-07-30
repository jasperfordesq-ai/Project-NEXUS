<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\I18n\LocaleContext;
use App\Models\Challenge;
use App\Models\Notification;
use App\Models\User;
use App\Models\UserChallengeProgress;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * ChallengeService — Eloquent-based service for gamification challenges.
 *
 * Manages challenge creation, listing, and member claim/completion workflows.
 * All queries are tenant-scoped via HasTenantScope trait on models.
 */
class ChallengeService
{
    public function __construct(
        private readonly Challenge $challenge,
        private readonly UserChallengeProgress $progress,
        private readonly GamificationService $gamificationService,
    ) {}

    /**
     * Get all challenges for a tenant.
     */
    public static function getAll(int $tenantId, array $filters = []): array
    {
        $limit = min((int) ($filters['limit'] ?? 20), 100);
        $offset = max(0, (int) ($filters['offset'] ?? 0));

        $query = Challenge::query();

        if (! empty($filters['status'])) {
            $query->where('status', $filters['status']);
        }
        if (! empty($filters['category'])) {
            $query->where('category', $filters['category']);
        }

        $total = $query->count();
        $items = $query->orderByDesc('created_at')
            ->offset($offset)->limit($limit)
            ->get()->toArray();

        return ['items' => $items, 'total' => $total];
    }

    /**
     * Get a single challenge by ID.
     */
    public static function getById(int $id, int $tenantId): ?array
    {
        $challenge = Challenge::query()
            ->where('id', $id)
            ->first();
        if (!$challenge) {
            return null;
        }
        // Verify tenant match (HasTenantScope should handle this, but be explicit)
        if ((int) $challenge->tenant_id !== $tenantId) {
            return null;
        }
        return $challenge->toArray();
    }

    /**
     * Create a new challenge.
     */
    public static function create(int $tenantId, array $data): ?int
    {
        $challenge = new Challenge([
            'title'          => $data['title'],
            'description'    => $data['description'] ?? null,
            'challenge_type' => $data['challenge_type'] ?? 'weekly',
            'action_type'    => $data['action_type'] ?? null,
            'target_count'   => $data['target_count'] ?? 1,
            'category'       => $data['category'] ?? 'general',
            'xp_reward'      => max(0, (int) ($data['xp_reward'] ?? 10)),
            'badge_reward'   => $data['badge_reward'] ?? null,
            'status'         => 'active',
            'is_active'      => true,
            'start_date'     => $data['start_date'] ?? $data['starts_at'] ?? now(),
            'end_date'       => $data['end_date'] ?? $data['ends_at'] ?? null,
            'starts_at'      => $data['starts_at'] ?? $data['start_date'] ?? now(),
            'ends_at'        => $data['ends_at'] ?? $data['end_date'] ?? null,
        ]);
        $challenge->save();

        return $challenge->id;
    }

    /**
     * Claim the reward for a completed challenge.
     *
     * 🔴 The claim ledger is `user_challenge_progress.reward_claimed`, NOT a
     * separate claims table. This method used to read and insert into a
     * `challenge_claims` table that has never existed in any schema, so every
     * call threw and the accessible frontend could never claim a reward. It
     * also never awarded anything, so simply creating that table would have
     * turned a visible failure into a silent one.
     *
     * Semantics deliberately mirror GamificationV2Controller::claimChallenge()
     * (the React path) so both frontends behave identically: the member must
     * have a progress row, it must be completed, and the flip to claimed is a
     * conditional UPDATE so concurrent requests cannot double-award.
     */
    public static function claim(int $challengeId, int $userId, int $tenantId): bool
    {
        // Verify user belongs to this tenant
        $userInTenant = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->exists();
        if (!$userInTenant) {
            return false;
        }

        // Validate by id + tenant only, exactly as the React path does via
        // getById(). `challenges` has no `status` column — filtering on one
        // (as this method used to) throws before the claim can even be
        // attempted. `is_active` and the date range are the real predicates,
        // and they gate whether the challenge was listed in the first place.
        $challenge = Challenge::query()->where('id', $challengeId)->first();

        if (! $challenge || (int) $challenge->tenant_id !== $tenantId) {
            return false;
        }

        $progress = DB::table('user_challenge_progress')
            ->where('challenge_id', $challengeId)
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->first();

        // Not started, not finished, or already claimed — nothing to award.
        if (! $progress || empty($progress->completed_at) || ! empty($progress->reward_claimed)) {
            return false;
        }

        // Atomic claim: only the request that flips reward_claimed 0 -> 1 gets
        // to award the reward, so a double submit cannot pay out twice.
        $affected = DB::table('user_challenge_progress')
            ->where('challenge_id', $challengeId)
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('reward_claimed', 0)
            ->update([
                'reward_claimed' => 1,
                'claimed_at'     => now(),
            ]);

        if ($affected === 0) {
            return false;
        }

        self::awardChallengeReward($userId, $challenge);

        return true;
    }

    /**
     * Get active challenges for current tenant.
     */
    public static function getActiveChallenges(): array
    {
        $today = now()->toDateString();

        return Challenge::query()
            ->where('is_active', true)
            ->where('start_date', '<=', $today)
            ->where('end_date', '>=', $today)
            ->orderBy('end_date')
            ->get()
            ->toArray();
    }

    /**
     * Get challenges with user progress.
     */
    public static function getChallengesWithProgress(int $userId): array
    {
        $today = now()->toDateString();

        $challenges = Challenge::query()
            ->where('is_active', true)
            ->where('start_date', '<=', $today)
            ->where('end_date', '>=', $today)
            ->orderBy('end_date')
            ->get();

        // Get all progress for this user's active challenges
        $challengeIds = $challenges->pluck('id')->all();
        $progressMap = [];
        if (! empty($challengeIds)) {
            $progressMap = UserChallengeProgress::query()
                ->where('user_id', $userId)
                ->whereIn('challenge_id', $challengeIds)
                ->get()
                ->keyBy('challenge_id')
                ->all();
        }

        $result = [];
        foreach ($challenges as $challenge) {
            $row = $challenge->toArray();
            $prog = $progressMap[$challenge->id] ?? null;

            $row['user_progress'] = $prog ? (int) $prog->current_count : 0;
            $row['completed_at'] = $prog?->completed_at;
            $row['reward_claimed'] = $prog ? (bool) $prog->reward_claimed : false;
            $row['progress_percent'] = $challenge->target_count > 0
                ? min(100, round(($row['user_progress'] / $challenge->target_count) * 100))
                : 0;
            $row['is_completed'] = $row['user_progress'] >= $challenge->target_count;
            $row['days_remaining'] = max(0, (strtotime($challenge->end_date) - time()) / 86400);
            $row['hours_remaining'] = max(0, (strtotime($challenge->end_date) - time()) / 3600);
            $row['reward_xp'] = $challenge->xp_reward ?? 0;

            $result[] = $row;
        }

        return $result;
    }

    /**
     * Update progress for a challenge action.
     */
    public static function updateProgress(int $userId, string $actionType, int $increment = 1): array
    {
        $today = now()->toDateString();

        $challenges = Challenge::query()
            ->where('is_active', true)
            ->where('action_type', $actionType)
            ->where('start_date', '<=', $today)
            ->where('end_date', '>=', $today)
            ->get();

        $completed = [];

        foreach ($challenges as $challenge) {
            try {
                DB::transaction(function () use ($challenge, $userId, $increment, &$completed) {
                    $prog = UserChallengeProgress::query()
                        ->where('user_id', $userId)
                        ->where('challenge_id', $challenge->id)
                        ->lockForUpdate()
                        ->first();

                    if (! $prog) {
                        $prog = new UserChallengeProgress([
                            'user_id'      => $userId,
                            'challenge_id' => $challenge->id,
                            'current_count' => $increment,
                        ]);
                        $prog->save();
                        $newCount = $increment;
                    } else {
                        if ($prog->completed_at) {
                            return; // Already completed
                        }
                        $newCount = $prog->current_count + $increment;
                        $prog->current_count = $newCount;
                        $prog->save();
                    }

                    // Check if just completed — mark complete but do NOT auto-claim reward
                    // Users claim rewards explicitly via POST /v2/gamification/challenges/{id}/claim
                    if ($newCount >= $challenge->target_count && ! $prog->completed_at) {
                        $prog->completed_at = now();
                        $prog->save();

                        $completed[] = $challenge->toArray();
                    }
                });

                // Notify user of completion — rewards are claimed explicitly via
                // POST /v2/gamification/challenges/{id}/claim to prevent double-award
                if (! empty($completed) && $completed[array_key_last($completed)]['id'] === $challenge->id) {
                    // Render the bell in the RECIPIENT's preferred language.
                    $recipient = User::query()
                        ->withoutGlobalScopes()
                        ->select(['id', 'preferred_language'])
                        ->find($userId);

                    LocaleContext::withLocale($recipient, function () use ($userId, $challenge) {
                        Notification::createNotification(
                            $userId,
                            __('svc_notifications.challenge.complete_claim', ['title' => $challenge->title]),
                            '/achievements',
                            'achievement'
                        );
                        \App\Services\NotificationDispatcher::fanOutPush((int) ($userId), 'achievement', __('svc_notifications.challenge.complete_claim', ['title' => $challenge->title]), '/achievements');
                    });
                }
            } catch (\Throwable $e) {
                Log::error('ChallengeService::updateProgress error: ' . $e->getMessage());
            }
        }

        return $completed;
    }

    /**
     * Get a challenge by ID (legacy compatibility alias).
     */
    public static function getLegacyById(int $id): ?array
    {
        $challenge = Challenge::query()->find($id);
        return $challenge ? $challenge->toArray() : null;
    }

    /**
     * Award challenge completion rewards.
     */
    private static function awardChallengeReward(int $userId, Challenge $challenge): void
    {
        if ($challenge->xp_reward > 0) {
            GamificationService::awardXP(
                $userId,
                $challenge->xp_reward,
                'challenge_complete',
                "Challenge: {$challenge->title}"
            );
        }

        if (! empty($challenge->badge_reward)) {
            GamificationService::awardBadgeByKey($userId, $challenge->badge_reward);
        }

        // Render the bell in the RECIPIENT's preferred language.
        $recipient = User::query()
            ->withoutGlobalScopes()
            ->select(['id', 'preferred_language'])
            ->find($userId);

        LocaleContext::withLocale($recipient, function () use ($userId, $challenge) {
            Notification::createNotification(
                $userId,
                __('svc_notifications.challenge.complete_earned', ['title' => $challenge->title, 'xp' => $challenge->xp_reward]),
                '/achievements',
                'achievement'
            );
            \App\Services\NotificationDispatcher::fanOutPush((int) ($userId), 'achievement', __('svc_notifications.challenge.complete_earned', ['title' => $challenge->title, 'xp' => $challenge->xp_reward]), '/achievements');
        });
    }
}
