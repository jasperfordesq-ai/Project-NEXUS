<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Models\GoalCheckin;
use App\Models\Goal;
use App\Core\TenantContext;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * GoalCheckinService — Eloquent-based service for goal check-ins.
 *
 * Replaces the legacy DI wrapper that delegated to
 */
class GoalCheckinService
{
    /**
     * Create a check-in for a goal.
     */
    public function create(int $goalId, int $userId, array $data): GoalCheckin
    {
        return DB::transaction(function () use ($goalId, $userId, $data): GoalCheckin {
            $goal = Goal::findOrFail($goalId);
            $progressPercent = $data['progress_percent'] ?? $data['progress_value'] ?? null;
            $progressPercent = $progressPercent === null ? null : min(100.0, max(0.0, (float) $progressPercent));

            $checkin = GoalCheckin::create([
                'goal_id'          => $goalId,
                'user_id'          => $userId,
                'progress_percent' => $progressPercent,
                'note'             => $this->normalizeNote($data['note'] ?? null),
                'mood'             => $this->normalizeMood($data['mood'] ?? null),
            ]);

            if ($progressPercent !== null) {
                $target = (float) ($goal->target_value ?? 0);
                if ($target > 0) {
                    $goal->current_value = round(($target * $progressPercent) / 100, 2);
                    if ($progressPercent >= 100) {
                        $goal->status = 'completed';
                        $goal->completed_at = now();
                    }
                }
            }

            $previousCheckinAt = $goal->last_checkin_at ? Carbon::parse($goal->last_checkin_at) : null;
            $goal->last_checkin_at = now();

            if (Schema::hasColumn('goals', 'streak_count') && Schema::hasColumn('goals', 'best_streak_count')) {
                $streak = $previousCheckinAt && $this->isWithinStreakWindow($previousCheckinAt, (string) ($goal->checkin_frequency ?? 'none'))
                    ? ((int) ($goal->streak_count ?? 0)) + 1
                    : 1;

                $goal->streak_count = $streak;
                $goal->best_streak_count = max((int) ($goal->best_streak_count ?? 0), $streak);
            }

            $goal->save();

            if (Schema::hasTable('goal_progress_history')) {
                DB::table('goal_progress_history')->insert([
                    'goal_id'    => $goalId,
                    'tenant_id'  => TenantContext::getId(),
                    'event_type' => 'checkin',
                    'description'=> __('api_controllers_3.goals.history_checkin', ['percent' => round($progressPercent ?? 0)]),
                    'data'       => json_encode([
                        'progress_value' => $progressPercent,
                        'progress_percent' => $progressPercent,
                        'note' => $checkin->note,
                        'mood' => $checkin->mood,
                    ]),
                    'created_at' => now(),
                ]);
            }

            app(GoalProgressService::class)->syncMilestones($goal);

            $checkin->setAttribute('progress_value', $progressPercent);

            return $checkin;
        });
    }

    private function normalizeNote(mixed $note): ?string
    {
        $value = trim((string) ($note ?? ''));

        return $value !== '' ? $value : null;
    }

    private function normalizeMood(mixed $mood): ?string
    {
        $value = is_string($mood) ? $mood : null;
        $allowed = ['great', 'good', 'neutral', 'okay', 'struggling', 'stuck', 'motivated', 'grateful'];

        return $value !== null && in_array($value, $allowed, true) ? $value : null;
    }

    private function isWithinStreakWindow(Carbon $lastCheckinAt, string $frequency): bool
    {
        return match ($frequency) {
            'daily' => $lastCheckinAt->greaterThanOrEqualTo(now()->subDays(2)),
            'weekly' => $lastCheckinAt->greaterThanOrEqualTo(now()->subDays(8)),
            'biweekly' => $lastCheckinAt->greaterThanOrEqualTo(now()->subDays(15)),
            'monthly' => $lastCheckinAt->greaterThanOrEqualTo(now()->subDays(32)),
            default => $lastCheckinAt->greaterThanOrEqualTo(now()->subDays(8)),
        };
    }

    /**
     * Get check-ins for a goal with cursor pagination.
     */
    public function getByGoalId(int $goalId, array $filters = []): array
    {
        $limit = min((int) ($filters['limit'] ?? 20), 100);
        $cursor = $filters['cursor'] ?? null;

        $query = GoalCheckin::where('goal_id', $goalId)
            ->with(['user:id,first_name,last_name,profile_type,organization_name,avatar_url']);

        if ($cursor !== null && ($cid = base64_decode($cursor, true)) !== false) {
            $query->where('id', '<', (int) $cid);
        }

        $query->orderByDesc('id');
        $items = $query->limit($limit + 1)->get();
        $hasMore = $items->count() > $limit;
        if ($hasMore) {
            $items->pop();
        }

        $mappedItems = $items->map(function (GoalCheckin $item) {
            $row = $item->toArray();
            $row['progress_value'] = $row['progress_percent'] ?? null;
            return $row;
        })->all();

        return [
            'items'    => $mappedItems,
            'cursor'   => $hasMore && $items->isNotEmpty() ? base64_encode((string) $items->last()->id) : null,
            'has_more' => $hasMore,
        ];
    }
}
