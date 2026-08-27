<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\Group;
use App\Models\GroupChallenge;
use App\Models\User;
use Carbon\CarbonImmutable;
use DomainException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;
use RuntimeException;
use App\Support\UserDisplayName;

/**
 * Tenant-safe, lifecycle-aware collective challenges for Groups.
 */
final class GroupChallengeService
{
    public const TITLE_MIN = 3;
    public const TITLE_MAX = 120;
    public const DESCRIPTION_MIN = 10;
    public const DESCRIPTION_MAX = 2000;
    public const TARGET_MIN = 1;
    public const TARGET_MAX = 1000000;

    /** @var list<string> Metrics with a real production progress hook. */
    public const ALLOWED_METRICS = ['posts', 'discussions', 'members', 'files'];

    /** @var list<int> Server-defined reward choices; arbitrary XP is rejected. */
    public const REWARD_BANDS = [0, 25, 50, 100];

    public const ERROR_REQUIRED = 'required';
    public const ERROR_TITLE_LENGTH = 'title_length';
    public const ERROR_DESCRIPTION_LENGTH = 'description_length';
    public const ERROR_METRIC = 'metric';
    public const ERROR_TARGET = 'target';
    public const ERROR_REWARD = 'reward';
    public const ERROR_DATES = 'dates';
    public const ERROR_IMMUTABLE = 'CHALLENGE_IMMUTABLE';

    /** @return list<array<string, mixed>> */
    public static function getActive(int $groupId): array
    {
        return GroupChallenge::query()
            ->with('creator:id,name,first_name,last_name,profile_type,organization_name,avatar_url')
            ->where('group_id', $groupId)
            ->whereIn('metric', self::ALLOWED_METRICS)
            ->where('status', 'active')
            ->where('starts_at', '<=', now())
            ->where('ends_at', '>', now())
            ->orderBy('ends_at')
            ->get()
            ->map(static fn (GroupChallenge $challenge): array => self::toDto($challenge))
            ->all();
    }

    /** @return list<array<string, mixed>> */
    public static function getAll(int $groupId, int $limit = 20): array
    {
        return GroupChallenge::query()
            ->with('creator:id,name,first_name,last_name,profile_type,organization_name,avatar_url')
            ->where('group_id', $groupId)
            ->whereIn('metric', self::ALLOWED_METRICS)
            ->orderByDesc('created_at')
            ->limit(max(1, min(100, $limit)))
            ->get()
            ->map(static fn (GroupChallenge $challenge): array => self::toDto($challenge))
            ->all();
    }

    /** @return array<string, mixed>|null */
    public static function getById(int $groupId, int $challengeId): array|null
    {
        $challenge = GroupChallenge::query()
            ->with('creator:id,name,first_name,last_name,profile_type,organization_name,avatar_url')
            ->where('group_id', $groupId)
            ->whereIn('metric', self::ALLOWED_METRICS)
            ->find($challengeId);

        return $challenge instanceof GroupChallenge ? self::toDto($challenge) : null;
    }

    /**
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    public static function create(int $groupId, int $createdBy, array $data): array
    {
        if (
            ! GroupAccessService::canManage($groupId, $createdBy)
            || ! GroupAccessService::canWriteContent($groupId, $createdBy)
        ) {
            throw new AuthorizationException('Group challenge management is not allowed.');
        }

        $normalized = self::normalizeCreateData($data);
        $tenantId = (int) TenantContext::getId();

        GroupService::assertSafeguardingBroadcastAllowed(
            $groupId,
            $createdBy,
            $tenantId,
            'group_challenge_create',
            $normalized['title'] . ' ' . $normalized['description'],
        );

        $challenge = DB::transaction(static function () use ($tenantId, $groupId, $createdBy, $normalized): GroupChallenge {
            $challenge = GroupChallenge::query()->create([
                'tenant_id' => $tenantId,
                'group_id' => $groupId,
                'created_by' => $createdBy,
                'title' => $normalized['title'],
                'description' => $normalized['description'] !== '' ? $normalized['description'] : null,
                'metric' => $normalized['metric'],
                'target_value' => $normalized['target_value'],
                'current_value' => 0,
                'reward_xp' => $normalized['reward_xp'],
                'reward_badge' => null,
                'status' => 'active',
                'starts_at' => $normalized['starts_at'],
                'ends_at' => $normalized['ends_at'],
            ]);

            GroupAuditService::log(
                GroupAuditService::ACTION_CHALLENGE_CREATED,
                $groupId,
                $createdBy,
                [
                    'challenge_id' => (int) $challenge->id,
                    'metric' => (string) $challenge->metric,
                    'target_value' => (int) $challenge->target_value,
                    'reward_xp' => (int) $challenge->reward_xp,
                ],
            );

            return $challenge;
        });

        $challenge->load('creator:id,name,first_name,last_name,profile_type,organization_name,avatar_url');

        return self::toDto($challenge);
    }

    /**
     * Increment every live challenge for the implemented metric. Row locks,
     * the active-to-completed transition, reward ledger rows, and XP issuance
     * share one database transaction.
     */
    public static function incrementProgress(int $groupId, string $metric, int $amount = 1): void
    {
        if ($amount <= 0 || ! in_array($metric, self::ALLOWED_METRICS, true)) {
            return;
        }

        if (! Group::query()->active()->whereKey($groupId)->exists()) {
            return;
        }

        DB::transaction(static function () use ($groupId, $metric, $amount): void {
            $challenges = GroupChallenge::query()
                ->where('group_id', $groupId)
                ->where('status', 'active')
                ->where('metric', $metric)
                ->where('starts_at', '<=', now())
                ->where('ends_at', '>', now())
                ->orderBy('id')
                ->lockForUpdate()
                ->get();

            foreach ($challenges as $challenge) {
                $current = (int) $challenge->current_value;
                $target = (int) $challenge->target_value;
                $newValue = min($target, $current + $amount);
                if ($newValue <= $current) {
                    continue;
                }

                $justCompleted = $current < $target && $newValue >= $target;
                $challenge->current_value = $newValue;
                if ($justCompleted) {
                    $challenge->status = 'completed';
                    $challenge->completed_at = now();
                }
                $challenge->save();

                if ($justCompleted) {
                    GroupAuditService::log(
                        GroupAuditService::ACTION_CHALLENGE_COMPLETED,
                        (int) $challenge->group_id,
                        (int) $challenge->created_by,
                        [
                            'challenge_id' => (int) $challenge->id,
                            'metric' => (string) $challenge->metric,
                            'target_value' => (int) $challenge->target_value,
                            'automated' => true,
                        ],
                    );
                    self::issueRewards($challenge);
                }
            }
        }, 3);
    }

    /**
     * Cross-tenant cron maintenance by design: expiry is defined solely by
     * challenge state/time and does not expose rows to a request actor.
     */
    public static function expireOverdue(): int
    {
        return DB::table('group_challenges')
            ->where('status', 'active')
            ->where('ends_at', '<', now())
            ->update(['status' => 'expired', 'updated_at' => now()]);
    }

    /**
     * Cancel an active challenge without deleting its historical or economy data.
     *
     * @return array{challenge: array<string, mixed>, changed: bool}|null
     */
    public static function delete(int $groupId, int $challengeId, int $actorId): array|null
    {
        if (
            ! GroupAccessService::canManage($groupId, $actorId)
            || ! GroupAccessService::canWriteContent($groupId, $actorId)
        ) {
            throw new AuthorizationException('Group challenge management is not allowed.');
        }

        $tenantId = (int) TenantContext::getId();

        return DB::transaction(static function () use ($tenantId, $groupId, $challengeId, $actorId): array|null {
            $challenge = GroupChallenge::query()
                ->where('group_id', $groupId)
                ->whereKey($challengeId)
                ->lockForUpdate()
                ->first();

            if (! $challenge instanceof GroupChallenge) {
                return null;
            }

            $reference = 'group_challenge:' . (int) $challenge->id;
            $hasRewardEvidence = DB::table('group_challenge_rewards')
                ->where('tenant_id', $tenantId)
                ->where('challenge_id', (int) $challenge->id)
                ->exists()
                || DB::table('user_xp_log')
                    ->where('tenant_id', $tenantId)
                    ->where('action', 'group_challenge')
                    ->where('source_reference', $reference)
                    ->exists();

            if ($hasRewardEvidence || ! in_array((string) $challenge->status, ['active', 'cancelled'], true)) {
                throw new DomainException(self::ERROR_IMMUTABLE);
            }

            $changed = (string) $challenge->status === 'active';
            if ($changed) {
                $challenge->status = 'cancelled';
                $challenge->save();

                GroupAuditService::log(
                    GroupAuditService::ACTION_CHALLENGE_CANCELLED,
                    $groupId,
                    $actorId,
                    [
                        'challenge_id' => (int) $challenge->id,
                        'prior_status' => 'active',
                        'metric' => (string) $challenge->metric,
                        'target_value' => (int) $challenge->target_value,
                        'reward_xp' => (int) $challenge->reward_xp,
                    ],
                );
            }

            $challenge->load('creator:id,name,first_name,last_name,profile_type,organization_name,avatar_url');

            return [
                'challenge' => self::toDto($challenge),
                'changed' => $changed,
            ];
        }, 3);
    }

    /**
     * @param array<string, mixed> $data
     * @return array{
     *   title: string,
     *   description: string,
     *   metric: string,
     *   target_value: int,
     *   reward_xp: int,
     *   starts_at: CarbonImmutable,
     *   ends_at: CarbonImmutable
     * }
     */
    public static function normalizeCreateData(array $data): array
    {
        $title = is_string($data['title'] ?? null) ? trim($data['title']) : '';
        $description = is_string($data['description'] ?? null) ? trim($data['description']) : '';
        $metric = is_string($data['metric'] ?? null) ? trim($data['metric']) : '';
        $endsAtInput = $data['ends_at'] ?? $data['end_date'] ?? null;

        if ($title === '' || $metric === '' || $endsAtInput === null || ! array_key_exists('target_value', $data)) {
            throw new InvalidArgumentException(self::ERROR_REQUIRED);
        }
        if (mb_strlen($title) < self::TITLE_MIN || mb_strlen($title) > self::TITLE_MAX) {
            throw new InvalidArgumentException(self::ERROR_TITLE_LENGTH);
        }
        if (
            $description !== ''
            && (mb_strlen($description) < self::DESCRIPTION_MIN || mb_strlen($description) > self::DESCRIPTION_MAX)
        ) {
            throw new InvalidArgumentException(self::ERROR_DESCRIPTION_LENGTH);
        }
        if (! in_array($metric, self::ALLOWED_METRICS, true)) {
            throw new InvalidArgumentException(self::ERROR_METRIC);
        }

        $target = self::parseInteger($data['target_value']);
        if ($target === null || $target < self::TARGET_MIN || $target > self::TARGET_MAX) {
            throw new InvalidArgumentException(self::ERROR_TARGET);
        }

        $rewardInput = $data['reward_xp'] ?? 0;
        $reward = self::parseInteger($rewardInput);
        if ($reward === null || ! in_array($reward, self::REWARD_BANDS, true)) {
            throw new InvalidArgumentException(self::ERROR_REWARD);
        }
        if (! empty($data['reward_badge'])) {
            throw new InvalidArgumentException(self::ERROR_REWARD);
        }

        try {
            $startsAt = isset($data['starts_at']) && $data['starts_at'] !== ''
                ? CarbonImmutable::parse((string) $data['starts_at'])
                : CarbonImmutable::now();
            $endsAt = CarbonImmutable::parse((string) $endsAtInput);
        } catch (\Throwable) {
            throw new InvalidArgumentException(self::ERROR_DATES);
        }

        if ($endsAt->lessThanOrEqualTo(CarbonImmutable::now()) || $endsAt->lessThanOrEqualTo($startsAt)) {
            throw new InvalidArgumentException(self::ERROR_DATES);
        }

        return [
            'title' => $title,
            'description' => $description,
            'metric' => $metric,
            'target_value' => $target,
            'reward_xp' => $reward,
            'starts_at' => $startsAt,
            'ends_at' => $endsAt,
        ];
    }

    private static function issueRewards(GroupChallenge $challenge): void
    {
        $rewardXp = (int) $challenge->reward_xp;
        if ($rewardXp <= 0 || ! in_array($rewardXp, self::REWARD_BANDS, true)) {
            return;
        }

        $tenantId = (int) $challenge->tenant_id;
        $memberIds = DB::table('group_members')
            ->where('tenant_id', $tenantId)
            ->where('group_id', (int) $challenge->group_id)
            ->where('status', 'active')
            ->distinct()
            ->pluck('user_id')
            ->map(static fn ($id): int => (int) $id)
            ->all();

        if ($memberIds === []) {
            return;
        }

        $members = User::query()
            ->whereIn('id', $memberIds)
            ->get(['id', 'preferred_language']);

        foreach ($members as $member) {
            $inserted = DB::table('group_challenge_rewards')->insertOrIgnore([
                'tenant_id' => $tenantId,
                'challenge_id' => (int) $challenge->id,
                'user_id' => (int) $member->id,
                'reward_xp' => $rewardXp,
                'awarded_at' => now(),
            ]);
            if ($inserted !== 1) {
                continue;
            }

            $reference = 'group_challenge:' . (int) $challenge->id;
            LocaleContext::withLocale($member, static function () use ($member, $challenge, $rewardXp, $reference): void {
                GamificationService::awardXP(
                    (int) $member->id,
                    $rewardXp,
                    'group_challenge',
                    __('api.group_challenge_completed_xp', ['title' => $challenge->title]),
                    $reference,
                );
            });

            $logged = DB::table('user_xp_log')
                ->where('tenant_id', $tenantId)
                ->where('user_id', (int) $member->id)
                ->where('action', 'group_challenge')
                ->where('source_reference', $reference)
                ->exists();
            if (! $logged) {
                throw new RuntimeException('Group challenge XP issuance did not persist.');
            }

            GroupAuditService::log(
                GroupAuditService::ACTION_CHALLENGE_REWARD_AWARDED,
                (int) $challenge->group_id,
                (int) $member->id,
                [
                    'challenge_id' => (int) $challenge->id,
                    'recipient_user_id' => (int) $member->id,
                    'reward_xp' => $rewardXp,
                    'automated' => true,
                ],
            );
        }
    }

    private static function parseInteger(mixed $value): int|null
    {
        if (is_int($value)) {
            return $value;
        }
        if (! is_string($value)) {
            return null;
        }

        $value = trim($value);
        if ($value === '' || preg_match('/^-?\d+$/D', $value) !== 1) {
            return null;
        }

        $integer = filter_var($value, FILTER_VALIDATE_INT);

        return $integer === false ? null : (int) $integer;
    }

    /** @return array<string, mixed> */
    private static function toDto(GroupChallenge $challenge): array
    {
        $creator = $challenge->creator;
        $creatorName = $creator instanceof User
            ? UserDisplayName::resolve($creator)
            : '';
        $target = max(1, (int) $challenge->target_value);
        $current = max(0, (int) $challenge->current_value);

        return [
            'id' => (int) $challenge->id,
            'group_id' => (int) $challenge->group_id,
            'title' => (string) $challenge->title,
            'description' => (string) ($challenge->description ?? ''),
            'metric' => (string) $challenge->metric,
            'target_value' => $target,
            'current_value' => min($target, $current),
            'reward_xp' => (int) $challenge->reward_xp,
            'status' => (string) $challenge->status,
            'progress_percentage' => min(100, round(($current / $target) * 100, 1)),
            'starts_at' => $challenge->starts_at?->toIso8601String(),
            'ends_at' => $challenge->ends_at?->toIso8601String(),
            'completed_at' => $challenge->completed_at?->toIso8601String(),
            'creator' => [
                'id' => $creator instanceof User ? (int) $creator->id : (int) $challenge->created_by,
                'name' => $creatorName,
                'avatar_url' => $creator instanceof User ? ($creator->avatar_url ?? null) : null,
            ],
            'created_at' => $challenge->created_at?->toIso8601String(),
            'updated_at' => $challenge->updated_at?->toIso8601String(),
        ];
    }
}
