<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\Goal;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use App\Support\UserDisplayName;

/**
 * GoalProgressService — Eloquent-based service for goal progress history.
 *
 * Replaces the legacy DI wrapper that delegated to
 */
class GoalProgressService
{
    private function resolveStoredTranslation(?string $value, array $replace = []): ?string
    {
        if ($value === null || !str_starts_with($value, 'api_controllers_3.')) {
            return $value;
        }

        $translated = __($value, $replace);

        return $translated === $value ? $value : $translated;
    }

    private function historyReplacements(string $eventType, array $data): array
    {
        $percent = $data['progress_percent'] ?? $data['progress_value'] ?? 0;

        return match ($eventType) {
            'progress_update', 'checkin' => ['percent' => round((float) $percent)],
            'milestone' => ['title' => (string) ($data['title'] ?? '')],
            default => [],
        };
    }

    public function recordHistory(Goal $goal, string $eventType, string $description, array $data = []): void
    {
        if (!DB::getSchemaBuilder()->hasTable('goal_progress_history')) {
            return;
        }

        DB::table('goal_progress_history')->insert([
            'goal_id'     => $goal->id,
            'tenant_id'   => TenantContext::getId(),
            'event_type'  => $eventType,
            'description' => $description,
            'data'        => $data === [] ? null : json_encode($data),
            'created_at'  => now(),
        ]);
    }

    public function seedDefaultMilestones(Goal $goal, ?array $milestones = null): void
    {
        if (!DB::getSchemaBuilder()->hasTable('goal_milestones')) {
            return;
        }

        $exists = DB::table('goal_milestones')->where('goal_id', $goal->id)->exists();
        if ($exists) {
            return;
        }

        $targetValue = (float) ($goal->target_value ?? 0);
        $defaults = $milestones ?: [
            ['title' => __('api_controllers_3.goals.milestone_quarter'), 'target_percent' => 25],
            ['title' => __('api_controllers_3.goals.milestone_half'), 'target_percent' => 50],
            ['title' => __('api_controllers_3.goals.milestone_three_quarters'), 'target_percent' => 75],
            ['title' => __('api_controllers_3.goals.milestone_complete'), 'target_percent' => 100],
        ];

        foreach (array_values($defaults) as $index => $milestone) {
            $percent = isset($milestone['target_percent']) ? (float) $milestone['target_percent'] : null;
            $value = isset($milestone['target_value'])
                ? (float) $milestone['target_value']
                : ($percent !== null && $targetValue > 0 ? round(($targetValue * $percent) / 100, 2) : null);

            DB::table('goal_milestones')->insert([
                'goal_id'        => $goal->id,
                'tenant_id'      => TenantContext::getId(),
                'title'          => trim((string) ($milestone['title'] ?? __('api_controllers_3.goals.milestone_generic', ['number' => $index + 1]))),
                'target_percent' => $percent,
                'target_value'   => $value,
                'sort_order'     => $index + 1,
                'created_at'     => now(),
                'updated_at'     => now(),
            ]);
        }
    }

    public function syncMilestones(Goal $goal): int
    {
        if (!DB::getSchemaBuilder()->hasTable('goal_milestones')) {
            return 0;
        }

        $this->seedDefaultMilestones($goal);

        $target = (float) ($goal->target_value ?? 0);
        $current = (float) ($goal->current_value ?? 0);
        $percent = $target > 0 ? min(100.0, max(0.0, ($current / $target) * 100)) : 0.0;
        $now = now();
        $completed = 0;

        $milestones = DB::table('goal_milestones')
            ->where('goal_id', $goal->id)
            ->whereNull('completed_at')
            ->orderBy('sort_order')
            ->get();

        foreach ($milestones as $milestone) {
            $targetPercent = $milestone->target_percent !== null ? (float) $milestone->target_percent : null;
            $targetValue = $milestone->target_value !== null ? (float) $milestone->target_value : null;
            $hit = ($targetPercent !== null && $percent >= $targetPercent)
                || ($targetValue !== null && $current >= $targetValue);

            if (!$hit) {
                continue;
            }

            DB::table('goal_milestones')
                ->where('id', $milestone->id)
                ->update(['completed_at' => $now, 'updated_at' => $now]);

            $this->recordHistory($goal, 'milestone', __('api_controllers_3.goals.history_milestone', [
                'title' => $milestone->title,
            ]), [
                'milestone_id' => $milestone->id,
                'title' => $milestone->title,
                'progress_value' => round($percent, 2),
            ]);
            $completed++;
        }

        return $completed;
    }

    public function getMilestones(int $goalId): array
    {
        if (!DB::getSchemaBuilder()->hasTable('goal_milestones')) {
            return [];
        }

        return DB::table('goal_milestones')
            ->where('goal_id', $goalId)
            ->orderBy('sort_order')
            ->get()
            ->map(function ($row) {
                $data = (array) $row;
                $data['title'] = $this->resolveStoredTranslation((string) ($data['title'] ?? ''), [
                    'number' => $data['sort_order'] ?? '',
                ]);

                return $data;
            })
            ->all();
    }

    public function getBuddyNotes(int $goalId): array
    {
        if (!DB::getSchemaBuilder()->hasTable('goal_buddy_notes')) {
            return [];
        }

        return DB::table('goal_buddy_notes as gbn')
            ->leftJoin('users as u', function ($join) {
                $join->on('gbn.buddy_id', '=', 'u.id')
                    ->whereColumn('gbn.tenant_id', '=', 'u.tenant_id');
            })
            ->where('gbn.goal_id', $goalId)
            ->orderByDesc('gbn.id')
            ->limit(5)
            ->get([
                'gbn.id', 'gbn.type', 'gbn.message', 'gbn.created_at',
                'u.first_name', 'u.last_name', 'u.profile_type', 'u.organization_name', 'u.avatar_url',
            ])
            ->map(function ($row) {
                $data = (array) $row;
                $data['buddy_name'] = UserDisplayName::resolve($data);
                unset($data['first_name'], $data['last_name']);
                return $data;
            })
            ->all();
    }

    public function getInsights(int $goalId): array
    {
        $goal = Goal::findOrFail($goalId);
        $this->syncMilestones($goal);

        $lastCheckin = DB::table('goal_checkins')
            ->where('goal_id', $goalId)
            ->orderByDesc('id')
            ->first();

        $checkinCount = DB::table('goal_checkins')->where('goal_id', $goalId)->count();
        $frequency = $goal->checkin_frequency ?? 'none';
        $nextDueAt = $this->nextCheckinDueAt($goal);
        $isDue = $nextDueAt !== null && Carbon::parse($nextDueAt)->lte(now());
        $milestones = $this->getMilestones($goalId);
        $completedMilestones = count(array_filter($milestones, fn ($m) => !empty($m['completed_at'])));

        return [
            'checkin_count' => $checkinCount,
            'last_checkin_at' => $lastCheckin->created_at ?? $goal->last_checkin_at,
            'checkin_frequency' => $frequency,
            'next_checkin_due_at' => $nextDueAt,
            'is_checkin_due' => $isDue,
            'streak_count' => (int) ($goal->streak_count ?? 0),
            'best_streak_count' => (int) ($goal->best_streak_count ?? 0),
            'milestones' => $milestones,
            'completed_milestones' => $completedMilestones,
            'milestone_count' => count($milestones),
            'buddy_notes' => $this->getBuddyNotes($goalId),
        ];
    }

    private function nextCheckinDueAt(Goal $goal): ?string
    {
        $frequency = $goal->checkin_frequency ?? 'none';
        if ($frequency === 'none') {
            return null;
        }

        $base = $goal->last_checkin_at ? Carbon::parse($goal->last_checkin_at) : Carbon::parse($goal->created_at);

        return match ($frequency) {
            'daily' => $base->copy()->addDay()->toISOString(),
            'weekly' => $base->copy()->addWeek()->toISOString(),
            'biweekly' => $base->copy()->addWeeks(2)->toISOString(),
            'monthly' => $base->copy()->addMonth()->toISOString(),
            default => null,
        };
    }

    /**
     * Get progress history for a goal with cursor pagination.
     */
    public function getProgressHistory(int $goalId, array $filters = []): array
    {
        // Validates tenant ownership via HasTenantScope global scope
        Goal::findOrFail($goalId);

        $limit = min((int) ($filters['limit'] ?? 50), 100);
        $cursor = $filters['cursor'] ?? null;

        $query = DB::table('goal_progress_history')
            ->where('goal_id', $goalId);

        if (! empty($filters['event_type'])) {
            $query->where('event_type', $filters['event_type']);
        }

        if ($cursor !== null && ($cid = base64_decode($cursor, true)) !== false) {
            $query->where('id', '<', (int) $cid);
        }

        $query->orderByDesc('id');
        $rows = $query->limit($limit + 1)->get();
        $hasMore = $rows->count() > $limit;
        if ($hasMore) {
            $rows->pop();
        }

        $items = $rows->map(function ($r) {
            $row = (array) $r;
            $decoded = null;
            if (!empty($row['data'])) {
                $decoded = json_decode((string) $row['data'], true);
            }
            $row['data'] = is_array($decoded) ? $decoded : [];
            $row['type'] = $r->event_type;
            $row['description'] = $this->resolveStoredTranslation(
                (string) ($row['description'] ?? ''),
                $this->historyReplacements((string) $r->event_type, $row['data'])
            );

            return $row;
        })->all();

        return [
            'items'    => $items,
            'cursor'   => $hasMore && $rows->isNotEmpty() ? base64_encode((string) $rows->last()->id) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Get progress summary for a goal.
     */
    public function getSummary(int $goalId): array
    {
        // Validates tenant ownership via HasTenantScope global scope
        Goal::findOrFail($goalId);

        $total = DB::table('goal_progress_history')
            ->where('goal_id', $goalId)
            ->count();

        $events = DB::table('goal_progress_history')
            ->where('goal_id', $goalId)
            ->selectRaw('event_type, COUNT(*) as count')
            ->groupBy('event_type')
            ->pluck('count', 'event_type')
            ->all();

        return [
            'total_events'   => $total,
            'events_by_type' => $events,
        ];
    }
}
