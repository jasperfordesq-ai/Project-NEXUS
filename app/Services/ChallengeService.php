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
     * The `challenges.challenge_type` column is an enum; anything outside this
     * set truncates to '' under the non-strict session sql_mode this app runs
     * (`config/database.php` sets `strict => false`), so a typo would persist
     * as a challenge that no `action_type` lookup can ever match.
     *
     * @var list<string>
     */
    public const CHALLENGE_TYPES = ['daily', 'weekly', 'monthly', 'special'];

    /**
     * The action_types an admin may put on a challenge.
     *
     * Deliberately NOT the whole of GamificationService::XP_VALUES: challenge
     * progress only advances through EngagementService::record(), and only
     * these actions are wired through it. A challenge on any other XP action
     * would sit at zero forever — the exact trap the admin UI must not offer.
     *
     * Semantics worth knowing when adding to this list:
     *  - venue_visit                 once per member/venue/day (DB unique key)
     *  - event_attendance_verified   once per member/event (claim ledger key)
     *  - attend_event                on a "going" RSVP; XP is
     *                                reference-deduplicated but progress can be
     *                                re-triggered by RSVP cycling — fine for
     *                                engagement, not for airtight counting
     */
    public const SUPPORTED_ACTION_TYPES = [
        'venue_visit',
        'event_attendance_verified',
        'attend_event',
    ];

    /**
     * Get all challenges for a tenant.
     *
     * 🔴 `challenges` has NO `status` column and NO `category` column. The real
     * ones are `is_active` (tinyint) and `challenge_type`
     * (daily|weekly|monthly|special). Filtering on the phantom pair threw
     * `SQLSTATE[42S22] Unknown column` on the `count()` before a single row was
     * read, and — unlike most of this codebase — nothing here catches it, so
     * the first caller to pass either filter took a hard 500. This method has
     * no callers yet, which is the only reason it never surfaced.
     *
     * `status` is kept as an explicit alias onto `is_active` rather than
     * dropped: a caller written against the old (imagined) contract then gets a
     * correct query instead of a filter that silently matches everything.
     *
     * @param  array{limit?:int|string, offset?:int|string, status?:string, is_active?:bool|int|string, challenge_type?:string}  $filters
     * @return array{items:list<array<string,mixed>>, total:int}
     */
    public static function getAll(int $tenantId, array $filters = []): array
    {
        $limit = min((int) ($filters['limit'] ?? 20), 100);
        $offset = max(0, (int) ($filters['offset'] ?? 0));

        // Explicit tenant predicate as well as the HasTenantScope global scope,
        // matching getById()/claim(). Without it the $tenantId argument was
        // decorative and the result depended entirely on ambient TenantContext.
        $query = Challenge::query()->where('tenant_id', $tenantId);

        if (! empty($filters['status'])) {
            $query->where('is_active', $filters['status'] === 'active');
        }
        if (isset($filters['is_active'])) {
            $query->where('is_active', (bool) $filters['is_active']);
        }
        if (! empty($filters['challenge_type'])) {
            $query->where('challenge_type', $filters['challenge_type']);
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
        return self::getModelById($id, $tenantId)?->toArray();
    }

    /**
     * Resolve a tenant-owned challenge as a model.
     *
     * Callers that need to award a reward must use this rather than getById(),
     * because awardChallengeReward() takes the model — an array loses the
     * `badge_reward` column silently if a caller only copies the fields it
     * happens to know about, which is exactly how the two claim paths drifted.
     */
    public static function getModelById(int $id, int $tenantId): ?Challenge
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
        return $challenge;
    }

    /**
     * Create a new challenge.
     *
     * 🔴 `challenges` has NO `status`, `category`, `starts_at` or `ends_at`
     * column. All four were in this payload, and because none of them appear in
     * Challenge::$fillable, Eloquent DISCARDED them silently instead of
     * failing — so a caller setting a category would have watched the write
     * succeed and the value evaporate. The real columns are `is_active`,
     * `challenge_type`, `start_date` and `end_date`.
     *
     * The insert was independently broken regardless of those: `action_type`
     * and `end_date` are both NOT NULL and both defaulted to null here, so
     * every call threw `1048 Column 'action_type' cannot be null`. Both are
     * required payload keys now and are checked up front, so a bad payload
     * fails with a message naming the field instead of an integrity-constraint
     * stack trace from three layers down.
     *
     * `starts_at` / `ends_at` survive as INPUT aliases only — they are payload
     * keys, never columns — so any caller written against the old shape keeps
     * working and its dates actually land.
     *
     * @param  array{title:string, action_type:string, end_date?:string, ends_at?:string, description?:?string, challenge_type?:string, target_count?:int|string, xp_reward?:int|string, badge_reward?:?string, start_date?:string, starts_at?:string, is_active?:bool|int|string}  $data
     *
     * @throws \InvalidArgumentException when a NOT NULL column has no value, or
     *                                   challenge_type is outside the enum.
     */
    public static function create(int $tenantId, array $data): ?int
    {
        $title = trim((string) ($data['title'] ?? ''));
        if ($title === '') {
            throw new \InvalidArgumentException('challenges.title is NOT NULL: a non-empty title is required.');
        }

        // NOT NULL with no DB default. Previously null-by-default, which is why
        // every call to this method threw before reaching the database's own
        // error for end_date.
        $actionType = trim((string) ($data['action_type'] ?? ''));
        if ($actionType === '') {
            throw new \InvalidArgumentException('challenges.action_type is NOT NULL: an action_type is required.');
        }

        $challengeType = (string) ($data['challenge_type'] ?? 'weekly');
        if (! in_array($challengeType, self::CHALLENGE_TYPES, true)) {
            throw new \InvalidArgumentException(sprintf(
                'challenges.challenge_type must be one of %s, got "%s".',
                implode('|', self::CHALLENGE_TYPES),
                $challengeType
            ));
        }

        // Both columns are DATE, not DATETIME — normalise so a datetime string
        // is not silently truncated on the way in.
        $startDate = $data['start_date'] ?? $data['starts_at'] ?? now();
        $endDate = $data['end_date'] ?? $data['ends_at'] ?? null;
        if (empty($endDate)) {
            throw new \InvalidArgumentException('challenges.end_date is NOT NULL: an end_date is required.');
        }

        $challenge = new Challenge([
            'tenant_id'      => $tenantId,
            'title'          => $title,
            'description'    => $data['description'] ?? null,
            'challenge_type' => $challengeType,
            'action_type'    => $actionType,
            'target_count'   => max(1, (int) ($data['target_count'] ?? 1)),
            'xp_reward'      => max(0, (int) ($data['xp_reward'] ?? 10)),
            'badge_reward'   => $data['badge_reward'] ?? null,
            'is_active'      => isset($data['is_active']) ? (bool) $data['is_active'] : true,
            'start_date'     => self::toDateString($startDate),
            'end_date'       => self::toDateString($endDate),
        ]);
        $challenge->save();

        return $challenge->id;
    }

    /**
     * Update a tenant-owned challenge. Same validation posture as create():
     * enum and NOT NULL constraints are checked here rather than left to the
     * database, whose non-strict mode would truncate instead of reject.
     *
     * @param  array<string,mixed>  $data  Only known columns are applied.
     */
    public static function update(int $id, int $tenantId, array $data): bool
    {
        $challenge = self::getModelById($id, $tenantId);
        if ($challenge === null) {
            return false;
        }

        if (array_key_exists('title', $data)) {
            $title = trim((string) $data['title']);
            if ($title === '') {
                throw new \InvalidArgumentException('challenges.title is NOT NULL: a non-empty title is required.');
            }
            $challenge->title = $title;
        }
        if (array_key_exists('description', $data)) {
            $challenge->description = $data['description'] !== null ? (string) $data['description'] : null;
        }
        if (array_key_exists('challenge_type', $data)) {
            $challengeType = (string) $data['challenge_type'];
            if (! in_array($challengeType, self::CHALLENGE_TYPES, true)) {
                throw new \InvalidArgumentException(sprintf(
                    'challenges.challenge_type must be one of %s, got "%s".',
                    implode('|', self::CHALLENGE_TYPES),
                    $challengeType
                ));
            }
            $challenge->challenge_type = $challengeType;
        }
        if (array_key_exists('action_type', $data)) {
            $actionType = trim((string) $data['action_type']);
            if ($actionType === '') {
                throw new \InvalidArgumentException('challenges.action_type is NOT NULL: an action_type is required.');
            }
            $challenge->action_type = $actionType;
        }
        if (array_key_exists('target_count', $data)) {
            $challenge->target_count = max(1, (int) $data['target_count']);
        }
        if (array_key_exists('xp_reward', $data)) {
            $challenge->xp_reward = max(0, (int) $data['xp_reward']);
        }
        if (array_key_exists('badge_reward', $data)) {
            $challenge->badge_reward = $data['badge_reward'] !== null ? (string) $data['badge_reward'] : null;
        }
        if (array_key_exists('is_active', $data)) {
            $challenge->is_active = (bool) $data['is_active'];
        }
        if (array_key_exists('start_date', $data)) {
            $challenge->start_date = self::toDateString($data['start_date']);
        }
        if (array_key_exists('end_date', $data)) {
            $challenge->end_date = self::toDateString($data['end_date']);
        }

        return $challenge->save();
    }

    /**
     * Delete a tenant-owned challenge.
     *
     * 🔴 user_challenge_progress has ON DELETE CASCADE onto challenges, so
     * deleting a challenge erases every member's progress on it — including
     * completed-but-unclaimed rewards. The admin UI warns before offering
     * this; deactivation (is_active=false) is the reversible alternative.
     */
    public static function delete(int $id, int $tenantId): bool
    {
        $challenge = self::getModelById($id, $tenantId);
        if ($challenge === null) {
            return false;
        }

        return (bool) $challenge->delete();
    }

    /**
     * Normalise a date-ish value to Y-m-d for the DATE columns above.
     */
    private static function toDateString(mixed $value): string
    {
        if ($value instanceof \DateTimeInterface) {
            return $value->format('Y-m-d');
        }

        return \Illuminate\Support\Carbon::parse((string) $value)->toDateString();
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

        // Validate by id + tenant only, exactly as the React path does — both
        // now share getModelById(). `challenges` has no `status` column —
        // filtering on one (as this method used to) throws before the claim can
        // even be attempted. `is_active` and the date range are the real
        // predicates, and they gate whether the challenge was listed at all.
        $challenge = self::getModelById($challengeId, $tenantId);

        if (! $challenge) {
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
     * Award the rewards for a claimed challenge: XP, the optional
     * `challenges.badge_reward` badge, and the "you earned it" bell.
     *
     * 🔴 This is the ONE award routine. BOTH claim paths must call it:
     * ChallengeService::claim() (accessible frontend, via
     * AlphaController::claimChallengeReward) and
     * GamificationV2Controller::claimChallenge() (React,
     * POST /api/v2/gamification/challenges/{id}/claim). Do not reimplement any
     * part of it at a call site.
     *
     * They previously each had their own reward logic and diverged: the React
     * path awarded XP only, so the same challenge granted a badge and a bell on
     * the accessible frontend and neither on React. Commit eea002e72 aligned
     * the claim SEMANTICS of the two paths but deliberately left the REWARDS
     * for a separate decision; this is that decision. Adding a reward here
     * reaches both frontends — adding one at a call site recreates the bug.
     *
     * Callers are responsible for winning the conditional `reward_claimed`
     * 0 -> 1 UPDATE *before* calling this, so a double submit cannot pay twice.
     *
     * @return array{xp: int, badge: string|null} What the challenge is
     *         configured to award: its XP, and its `badge_reward` key (null
     *         when unset). The badge key is reported as configured — the actual
     *         grant is a no-op when the member already holds that badge or the
     *         key matches no definition, which GamificationService decides.
     */
    public static function awardChallengeReward(int $userId, Challenge $challenge): array
    {
        $xp = max(0, (int) $challenge->xp_reward);
        $badgeKey = ! empty($challenge->badge_reward) ? (string) $challenge->badge_reward : null;

        if ($xp > 0) {
            GamificationService::awardXP(
                $userId,
                $xp,
                'challenge_complete',
                "Challenge: {$challenge->title}"
            );
        }

        if ($badgeKey !== null) {
            GamificationService::awardBadgeByKey($userId, $badgeKey);
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

        return ['xp' => $xp, 'badge' => $badgeKey];
    }
}
