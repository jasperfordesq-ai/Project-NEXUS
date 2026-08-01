<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use Illuminate\Support\Facades\Log;

/**
 * EngagementService — the single junction between a real member action and the
 * two reward systems that should observe it: XP (GamificationService) and
 * admin-defined challenge progress (ChallengeService).
 *
 * Until this service existed, every action site called awardXP() inline and
 * nothing at all called ChallengeService::updateProgress(), so admin-defined
 * challenges could be created and claimed but their progress never advanced.
 * New action sites should call this rather than awarding XP directly, so the
 * two systems cannot drift apart again.
 *
 * Both halves are individually fault-isolated: recording engagement must never
 * fail the underlying action (a venue visit or event check-in is the fact of
 * record; XP and challenges are derived commentary on it).
 */
class EngagementService
{
    /**
     * Observe an engagement action for a member.
     *
     * @param  string      $actionType  Free-form action key; matched against
     *                                  GamificationService::XP_VALUES for the XP
     *                                  amount and against challenges.action_type
     *                                  for challenge progress.
     * @param  string|null $reference   Stable reference for the source event, used
     *                                  for reference-scoped XP idempotency.
     * @return array{xp_awarded:int, completed_challenges:array<int, array<string, mixed>>}
     */
    public static function record(
        int $userId,
        string $actionType,
        ?string $reference = null,
        string $description = '',
        int $increment = 1,
    ): array {
        $xpAwarded = 0;
        $completed = [];

        $xpAmount = (int) (GamificationService::XP_VALUES[$actionType] ?? 0);
        if ($xpAmount > 0) {
            try {
                GamificationService::awardXP($userId, $xpAmount, $actionType, $description, $reference);
                $xpAwarded = $xpAmount;
            } catch (\Throwable $e) {
                Log::warning('EngagementService: XP award failed', [
                    'user_id' => $userId,
                    'action' => $actionType,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        try {
            $completed = ChallengeService::updateProgress($userId, $actionType, $increment);
        } catch (\Throwable $e) {
            Log::warning('EngagementService: challenge progress failed', [
                'user_id' => $userId,
                'action' => $actionType,
                'error' => $e->getMessage(),
            ]);
        }

        return [
            'xp_awarded' => $xpAwarded,
            'completed_challenges' => array_values(array_map(
                static fn (array $challenge): array => [
                    'id' => (int) ($challenge['id'] ?? 0),
                    'title' => (string) ($challenge['title'] ?? ''),
                    'xp_reward' => (int) ($challenge['xp_reward'] ?? 0),
                ],
                $completed,
            )),
        ];
    }
}
