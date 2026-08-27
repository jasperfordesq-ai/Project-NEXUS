<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\Mailer;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\Goal;
use App\Models\GoalCheckin;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Services\GoalMilestoneEmailService;

/**
 * GoalService — Eloquent-based service for goal operations.
 *
 * All queries are tenant-scoped automatically via the HasTenantScope trait.
 */
class GoalService
{
    public function __construct(
        private readonly Goal $goal,
    ) {}

    private function progressPercent(Goal $goal): float
    {
        $target = (float) ($goal->target_value ?? 0);
        $current = (float) ($goal->current_value ?? 0);

        return $target > 0 ? min(100.0, max(0.0, ($current / $target) * 100)) : 0.0;
    }

    private function recordHistory(Goal $goal, string $eventType, string $description, array $data = [], ?int $createdBy = null): void
    {
        DB::table('goal_progress_history')->insert([
            'goal_id'    => $goal->id,
            'tenant_id'  => TenantContext::getId(),
            'event_type' => $eventType,
            'description'=> $description,
            'data'       => $data === [] ? null : json_encode($data),
            'created_at' => now(),
        ]);

        if (DB::getSchemaBuilder()->hasTable('goal_progress_log')) {
            DB::table('goal_progress_log')->insert([
                'goal_id'    => $goal->id,
                'tenant_id'  => TenantContext::getId(),
                'event_type' => $eventType === 'milestone' ? 'milestone_reached' : $eventType,
                'old_value'  => $data['old_value'] ?? null,
                'new_value'  => $data['new_value'] ?? null,
                'metadata'   => json_encode($data),
                'created_by' => $createdBy,
                'created_at' => now(),
            ]);
        }
    }

    /**
     * Get goals with optional filtering and cursor pagination.
     *
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public function getAll(array $filters = []): array
    {
        $limit = min((int) ($filters['limit'] ?? 20), 100);
        $cursor = $filters['cursor'] ?? null;

        $query = $this->goal->newQuery()
            ->with(['user:id,first_name,last_name,profile_type,organization_name,avatar_url', 'mentor:id,first_name,last_name,profile_type,organization_name,avatar_url']);

        if (! empty($filters['user_id'])) {
            $query->where('user_id', (int) $filters['user_id']);
        } else {
            $query->where('is_public', true);
        }

        if (! empty($filters['status']) && $filters['status'] !== 'all') {
            $query->where('status', $filters['status']);
        }

        if (! empty($filters['visibility']) && $filters['visibility'] !== 'all') {
            $query->where('is_public', $filters['visibility'] === 'public');
        }

        if ($cursor !== null && ($cid = base64_decode($cursor, true)) !== false) {
            $query->where('id', '<', (int) $cid);
        }

        $query->orderByDesc('id');
        $items = $query->limit($limit + 1)->get();
        $hasMore = $items->count() > $limit;
        if ($hasMore) {
            $items->pop();
        }

        return [
            'items'    => $items->toArray(),
            'cursor'   => $hasMore && $items->isNotEmpty() ? base64_encode((string) $items->last()->id) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Get public goals available for buddy offers (excludes user's own).
     */
    public function getPublicForBuddy(int $userId, array $filters = []): array
    {
        $limit = min((int) ($filters['limit'] ?? 20), 100);
        $cursor = $filters['cursor'] ?? null;

        $query = $this->goal->newQuery()
            ->with(['user:id,first_name,last_name,profile_type,organization_name,avatar_url', 'mentor:id,first_name,last_name,profile_type,organization_name,avatar_url'])
            ->where('is_public', true)
            ->where('status', 'active')
            ->where('user_id', '!=', $userId)
            ->whereNull('mentor_id');

        if ($cursor !== null && ($cid = base64_decode($cursor, true)) !== false) {
            $query->where('id', '<', (int) $cid);
        }

        $query->orderByDesc('id');
        $items = $query->limit($limit + 1)->get();
        $hasMore = $items->count() > $limit;
        if ($hasMore) {
            $items->pop();
        }

        return [
            'items'    => $items->toArray(),
            'cursor'   => $hasMore && $items->isNotEmpty() ? base64_encode((string) $items->last()->id) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Get goals where user is buddy/mentor.
     */
    public function getGoalsAsMentor(int $userId, array $filters = []): array
    {
        $limit = min((int) ($filters['limit'] ?? 20), 100);
        $cursor = $filters['cursor'] ?? null;

        $query = $this->goal->newQuery()
            ->with(['user:id,first_name,last_name,profile_type,organization_name,avatar_url', 'mentor:id,first_name,last_name,profile_type,organization_name,avatar_url'])
            ->where('mentor_id', $userId);

        if ($cursor !== null && ($cid = base64_decode($cursor, true)) !== false) {
            $query->where('id', '<', (int) $cid);
        }

        $query->orderByDesc('id');
        $items = $query->limit($limit + 1)->get();
        $hasMore = $items->count() > $limit;
        if ($hasMore) {
            $items->pop();
        }

        return [
            'items'    => $items->toArray(),
            'cursor'   => $hasMore && $items->isNotEmpty() ? base64_encode((string) $items->last()->id) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Get a single goal by ID.
     */
    public function getById(int $id): ?Goal
    {
        return $this->goal->newQuery()
            ->with(['user:id,first_name,last_name,profile_type,organization_name,avatar_url', 'mentor:id,first_name,last_name,profile_type,organization_name,avatar_url'])
            ->find($id);
    }

    /**
     * Create a new goal.
     */
    public function create(int $userId, array $data): Goal
    {
        $goal = $this->goal->newInstance([
            'user_id'           => $userId,
            'title'             => trim($data['title']),
            'description'       => trim($data['description'] ?? ''),
            'deadline'          => $data['deadline'] ?? null,
            'is_public'         => $data['is_public'] ?? true,
            'status'            => 'active',
            'target_value'      => max(1, (float) ($data['target_value'] ?? 100)),
            'current_value'     => max(0, (float) ($data['current_value'] ?? 0)),
            'checkin_frequency' => $data['checkin_frequency'] ?? 'none',
        ]);

        $goal->save();
        $this->recordHistory($goal, 'created', __('api_controllers_3.goals.history_created'), [
            'target_value' => (float) $goal->target_value,
            'progress_value' => $this->progressPercent($goal),
        ], $userId);
        app(GoalProgressService::class)->seedDefaultMilestones($goal);

        // Send goal-created email
        try {
            $user = DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', TenantContext::getId())
                ->select(['email', 'name', 'first_name', 'preferred_language'])
                ->first();

            if ($user && !empty($user->email)) {
                $tenantId = TenantContext::getId();
                LocaleContext::withLocale($user, function () use ($user, $goal, $tenantId) {
                    $firstName = $user->first_name ?? $user->name ?? __('emails.common.fallback_name');
                    $goalTitle = htmlspecialchars($goal->title ?? '', ENT_QUOTES, 'UTF-8');
                    $goalUrl   = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . '/goals/' . $goal->id;
                    $community = TenantContext::getName();

                    $html = EmailTemplateBuilder::make()
                        ->theme('success')
                        ->title(__('emails_goals.created.title'))
                        ->previewText(__('emails_goals.created.preview', ['title' => $goalTitle]))
                        ->greeting($firstName)
                        ->paragraph(__('emails_goals.created.body', ['community' => $community]))
                        ->highlight($goalTitle)
                        ->button(__('emails_goals.created.cta'), $goalUrl)
                        ->render();

                    if (!\App\Services\EmailDispatchService::sendRaw(
                        $user->email,
                        __('emails_goals.created.subject', ['title' => $goalTitle, 'community' => $community]),
                        $html,
                        null,
                        null,
                        null,
                        'goal',
                        ['tenant_id' => $tenantId]
                    )) {
                        Log::warning('[GoalService] created email send returned false', ['goal_id' => $goal->id]);
                    }
                });
            }
        } catch (\Throwable $e) {
            Log::warning('[GoalService] created email failed: ' . $e->getMessage());
        }

        return $goal->fresh(['user']);
    }

    /**
     * Update a goal (only owner).
     */
    public function update(int $id, int $userId, array $data): ?Goal
    {
        $goal = $this->goal->newQuery()->find($id);

        if (! $goal || (int) $goal->user_id !== $userId) {
            return null;
        }

        $allowed = ['title', 'description', 'deadline', 'is_public', 'status', 'target_value', 'checkin_frequency'];
        $goal->fill(collect($data)->only($allowed)->all());
        if (isset($data['target_value'])) {
            $goal->target_value = max(1, (float) $data['target_value']);
        }
        $goal->save();
        app(GoalProgressService::class)->syncMilestones($goal);

        return $goal->fresh(['user']);
    }

    /**
     * Delete a goal (only owner).
     */
    public function delete(int $id, int $userId): bool
    {
        $goal = $this->goal->newQuery()->find($id);

        if (! $goal || (int) $goal->user_id !== $userId) {
            return false;
        }

        // Capture data before deletion for the email
        $goalTitle = $goal->title ?? '';
        $goalId    = $goal->id;

        $deleted = (bool) $goal->delete();

        if ($deleted) {
            // Send goal-abandoned/deleted email
            try {
                $user = DB::table('users')
                    ->where('id', $userId)
                    ->where('tenant_id', TenantContext::getId())
                    ->select(['email', 'name', 'first_name', 'preferred_language', 'tenant_id'])
                    ->first();

                if ($user && !empty($user->email)) {
                    $tenantId = TenantContext::getId();
                    LocaleContext::withLocale($user, function () use ($user, $goalTitle, $tenantId) {
                        $firstName     = $user->first_name ?? $user->name ?? __('emails.common.fallback_name');
                        $safeTitle     = htmlspecialchars($goalTitle, ENT_QUOTES, 'UTF-8');
                        $newGoalUrl    = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . '/goals';
                        $community     = TenantContext::getName();

                        $html = EmailTemplateBuilder::make()
                            ->theme('info')
                            ->title(__('emails_goals.abandoned.title'))
                            ->previewText(__('emails_goals.abandoned.preview'))
                            ->greeting($firstName)
                            ->paragraph(__('emails_goals.abandoned.body', ['title' => $safeTitle, 'community' => $community]))
                            ->paragraph(__('emails_goals.abandoned.note'))
                            ->button(__('emails_goals.abandoned.cta'), $newGoalUrl)
                            ->render();

                        if (!\App\Services\EmailDispatchService::sendRaw(
                            $user->email,
                            __('emails_goals.abandoned.subject', ['title' => $safeTitle, 'community' => $community]),
                            $html,
                            null,
                            null,
                            null,
                            'goal',
                            ['tenant_id' => $tenantId]
                        )) {
                            Log::warning('[GoalService] abandoned email send returned false');
                        }
                    });
                }
            } catch (\Throwable $e) {
                Log::warning('[GoalService] abandoned email failed: ' . $e->getMessage());
            }
        }

        return $deleted;
    }

    /**
     * Increment goal progress.
     */
    public function incrementProgress(int $id, int $userId, float $increment): ?Goal
    {
        $goal = $this->goal->newQuery()->find($id);

        if (! $goal || (int) $goal->user_id !== $userId) {
            return null;
        }

        $current = (float) ($goal->current_value ?? 0);
        $target  = (float) ($goal->target_value ?? 0);

        $oldPercent = $target > 0 ? min(100.0, ($current / $target) * 100) : 0.0;

        $goal->current_value = $current + $increment;

        if ($target > 0 && $goal->current_value >= $target) {
            $goal->status = 'completed';
        }

        $goal->save();

        $newPercent = $target > 0 ? min(100.0, ((float) $goal->current_value / $target) * 100) : 0.0;
        $this->recordHistory($goal, 'progress_update', __('api_controllers_3.goals.history_progress', [
            'percent' => round($newPercent),
        ]), [
            'increment' => $increment,
            'old_value' => $current,
            'new_value' => (float) $goal->current_value,
            'progress_value' => round($newPercent, 2),
        ], $userId);
        app(GoalProgressService::class)->syncMilestones($goal);

        // Fire milestone emails (25 / 50 / 75 / 100%) — silenced to avoid disrupting the response
        try {
            GoalMilestoneEmailService::checkAndSendMilestone(
                TenantContext::getId(),
                $userId,
                $id,
                (string) ($goal->title ?? ''),
                $oldPercent,
                $newPercent
            );
        } catch (\Throwable $e) {
            Log::warning('[GoalService] milestone email failed', ['goal' => $id, 'error' => $e->getMessage()]);
        }

        return $goal->fresh(['user']);
    }

    /**
     * Mark a goal as completed.
     */
    public function complete(int $id, int $userId): ?Goal
    {
        $goal = $this->goal->newQuery()->find($id);

        if (! $goal || (int) $goal->user_id !== $userId) {
            return null;
        }

        $target = (float) ($goal->target_value ?? 1);
        $goal->current_value = $target;
        $goal->status = 'completed';
        $goal->completed_at = now();
        $goal->save();
        $this->recordHistory($goal, 'completed', __('api_controllers_3.goals.history_completed'), [
            'progress_value' => 100,
            'new_value' => (float) $goal->current_value,
        ], $userId);
        app(GoalProgressService::class)->syncMilestones($goal);

        // Send goal-completed email
        try {
            $user = DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', TenantContext::getId())
                ->select(['email', 'name', 'first_name', 'preferred_language'])
                ->first();

            if ($user && !empty($user->email)) {
                $tenantId = TenantContext::getId();
                LocaleContext::withLocale($user, function () use ($user, $goal, $tenantId) {
                    $firstName = $user->first_name ?? $user->name ?? __('emails.common.fallback_name');
                    $goalTitle = htmlspecialchars($goal->title ?? '', ENT_QUOTES, 'UTF-8');
                    $goalUrl   = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . '/goals/' . $goal->id;
                    $community = TenantContext::getName();

                    $html = EmailTemplateBuilder::make()
                        ->theme('success')
                        ->title(__('emails_goals.completed.title'))
                        ->previewText(__('emails_goals.completed.preview', ['title' => $goalTitle]))
                        ->greeting($firstName)
                        ->paragraph(__('emails_goals.completed.body', ['community' => $community]))
                        ->highlight(__('emails_goals.completed.highlight'))
                        ->button(__('emails_goals.completed.cta'), $goalUrl)
                        ->render();

                    if (!\App\Services\EmailDispatchService::sendRaw(
                        $user->email,
                        __('emails_goals.completed.subject', ['title' => $goalTitle, 'community' => $community]),
                        $html,
                        null,
                        null,
                        null,
                        'goal',
                        ['tenant_id' => $tenantId]
                    )) {
                        Log::warning('[GoalService] completed email send returned false', ['goal_id' => $goal->id]);
                    }
                });
            }
        } catch (\Throwable $e) {
            Log::warning('[GoalService] completed email failed: ' . $e->getMessage());
        }

        return $goal;
    }

    /**
     * Offer to be buddy for a goal.
     */
    public function offerBuddy(int $goalId, int $userId): ?Goal
    {
        $goal = $this->goal->newQuery()->find($goalId);

        if (! $goal || ! $goal->is_public || $goal->mentor_id !== null) {
            return null;
        }

        if ((int) $goal->user_id === $userId) {
            return null;
        }

        app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
            $userId,
            (int) $goal->user_id,
            (int) $goal->tenant_id,
            'goal_buddy',
        );

        $goal->mentor_id = $userId;
        $goal->save();
        $this->recordHistory($goal, 'buddy_joined', __('api_controllers_3.goals.history_buddy_joined'), [
            'buddy_id' => $userId,
        ], $userId);

        return $goal->fresh(['user', 'mentor']);
    }

    /**
     * Let a buddy send a visible accountability action to the goal owner.
     */
    public function createBuddyNote(int $goalId, int $buddyId, array $data): ?array
    {
        $goal = $this->goal->newQuery()->find($goalId);

        if (! $goal || (int) ($goal->mentor_id ?? 0) !== $buddyId) {
            return null;
        }

        app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
            $buddyId,
            (int) $goal->user_id,
            (int) $goal->tenant_id,
            'goal_buddy_note',
        );

        if (!DB::getSchemaBuilder()->hasTable('goal_buddy_notes')) {
            return null;
        }

        $type = $data['type'] ?? 'encouragement';
        if (!in_array($type, ['nudge', 'encouragement', 'offer_help', 'celebration', 'note'], true)) {
            $type = 'encouragement';
        }

        $message = trim((string) ($data['message'] ?? ''));
        $defaults = [
            'nudge' => __('api_controllers_3.goals.buddy_note_nudge'),
            'encouragement' => __('api_controllers_3.goals.buddy_note_encouragement'),
            'offer_help' => __('api_controllers_3.goals.buddy_note_offer_help'),
            'celebration' => __('api_controllers_3.goals.buddy_note_celebration'),
            'note' => __('api_controllers_3.goals.buddy_note_note'),
        ];

        $id = DB::table('goal_buddy_notes')->insertGetId([
            'goal_id' => $goalId,
            'tenant_id' => TenantContext::getId(),
            'buddy_id' => $buddyId,
            'owner_id' => (int) $goal->user_id,
            'type' => $type,
            'message' => $message !== '' ? $message : $defaults[$type],
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $note = (array) DB::table('goal_buddy_notes')->where('id', $id)->first();
        app(GoalProgressService::class)->recordHistory($goal, 'buddy_action', __('api_controllers_3.goals.history_buddy_action'), [
            'buddy_note_id' => $id,
            'type' => $type,
            'message' => $note['message'] ?? null,
        ]);

        return $note;
    }
}
