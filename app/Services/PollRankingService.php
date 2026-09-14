<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Models\Poll;
use Illuminate\Support\Facades\DB;

/**
 * PollRankingService — Eloquent-based service for ranked-choice voting.
 *
 * Replaces the legacy DI wrapper that delegated to
 */
class PollRankingService
{
    /**
     * Submit ranked-choice votes for a poll.
     */
    public function submitRanking(int $pollId, int $userId, array $rankings): bool
    {
        $result = $this->submitRankingWithResult($pollId, $userId, $rankings);
        return $result['accepted'] && !$result['replayed'];
    }

    /** @return array{accepted:bool,replayed:bool} */
    public function submitRankingWithResult(int $pollId, int $userId, array $rankings): array
    {
        return DB::transaction(function () use ($pollId, $userId, $rankings): array {
            $poll = Poll::query()->lockForUpdate()->findOrFail($pollId);
            if (($poll->poll_type ?? 'standard') !== 'ranked') return ['accepted' => false, 'replayed' => false];
            if (!$poll->is_active || ($poll->end_date && $poll->end_date->isPast())) {
                return ['accepted' => false, 'replayed' => false];
            }

            $tenantId = \App\Core\TenantContext::getId();
            $validOptionIds = DB::table('poll_options')->where('tenant_id', $tenantId)
                ->where('poll_id', $pollId)->pluck('id')->map(static fn ($id): int => (int) $id)->all();
            $normalized = array_map(static fn ($ranking): array => [
                'option_id' => (int) ($ranking['option_id'] ?? 0),
                'rank' => (int) ($ranking['rank'] ?? 0),
            ], $rankings);
            usort($normalized, static fn (array $a, array $b): int => $a['rank'] <=> $b['rank']);
            $submittedIds = array_column($normalized, 'option_id');
            $submittedRanks = array_column($normalized, 'rank');
            if ($submittedIds === []
                || count($submittedIds) !== count(array_unique($submittedIds))
                || array_diff($submittedIds, $validOptionIds) !== []
                || $submittedRanks !== range(1, count($normalized))) {
                return ['accepted' => false, 'replayed' => false];
            }

            $existing = DB::table('poll_rankings')->where('tenant_id', $tenantId)
                ->where('poll_id', $pollId)->where('user_id', $userId)->orderBy('rank')
                ->get(['option_id', 'rank'])->map(static fn ($row): array => [
                    'option_id' => (int) $row->option_id, 'rank' => (int) $row->rank,
                ])->all();
            if ($existing !== []) {
                $matches = $existing === $normalized;
                if ($matches) $this->awardVoteXp($tenantId, $pollId, $userId);
                return ['accepted' => $matches, 'replayed' => $matches];
            }

            if ((int) $poll->user_id !== $userId) {
                app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
                    $userId, (int) $poll->user_id, (int) $tenantId, 'poll_ranking',
                );
            }
            foreach ($normalized as $ranking) {
                DB::table('poll_rankings')->insert([
                    'poll_id' => $pollId, 'user_id' => $userId,
                    'option_id' => $ranking['option_id'], 'rank' => $ranking['rank'],
                    'tenant_id' => $tenantId, 'created_at' => now(),
                ]);
            }
            $this->awardVoteXp($tenantId, $pollId, $userId);
            return ['accepted' => true, 'replayed' => false];
        });
    }

    private function awardVoteXp(int $tenantId, int $pollId, int $userId): void
    {
        $reference = 'poll:' . $pollId;
        GamificationService::awardXP(
            $userId,
            GamificationService::XP_VALUES['vote_poll'],
            'vote_poll',
            'Voted on a poll',
            $reference,
        );
        if (!DB::table('user_xp_log')->where('tenant_id', $tenantId)->where('user_id', $userId)
            ->where('action', 'vote_poll')->where('source_reference', $reference)->exists()) {
            throw new \RuntimeException('Poll ranking XP did not persist.');
        }
    }

    /**
     * Calculate IRV results for a ranked poll.
     */
    public function calculateResults(int $pollId): array
    {
        // Validates tenant ownership via HasTenantScope global scope
        Poll::findOrFail($pollId);

        $rankings = DB::table('poll_rankings')
            ->where('poll_id', $pollId)
            ->orderBy('user_id')
            ->orderBy('rank')
            ->get()
            ->groupBy('user_id');

        $options = DB::table('poll_options')
            ->where('poll_id', $pollId)
            ->pluck('label', 'id')
            ->all();

        // Simple first-choice tally (simplified IRV)
        $tally = [];
        foreach ($options as $optId => $text) {
            $tally[$optId] = ['option_id' => $optId, 'text' => $text, 'votes' => 0];
        }

        foreach ($rankings as $userRankings) {
            $first = $userRankings->sortBy('rank')->first();
            if ($first && isset($tally[$first->option_id])) {
                $tally[$first->option_id]['votes']++;
            }
        }

        usort($tally, fn ($a, $b) => $b['votes'] <=> $a['votes']);

        return [
            'total_voters' => $rankings->count(),
            'results'      => array_values($tally),
        ];
    }

    /**
     * Get a user's rankings for a poll.
     */
    public function getUserRankings(int $pollId, int $userId): ?array
    {
        // Validates tenant ownership via HasTenantScope global scope
        Poll::findOrFail($pollId);

        $rankings = DB::table('poll_rankings')
            ->where('poll_id', $pollId)
            ->where('user_id', $userId)
            ->orderBy('rank')
            ->get()
            ->all();

        return empty($rankings) ? null : array_map(fn ($r) => (array) $r, $rankings);
    }
}
