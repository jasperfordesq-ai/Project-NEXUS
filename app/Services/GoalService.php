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
use App\Models\User;
use App\Models\UserXpLog;
use App\Support\UserDisplayName;
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
        return $this->updateProgressWithResult($id, $userId, $increment)['goal'];
    }

    /** @return array{goal:Goal|null,replay:bool,increment:float,old_percent:float,new_percent:float} */
    public function updateProgressWithResult(
        int $id,
        int $userId,
        float $increment,
        ?float $expectedCurrent = null,
        ?float $desiredCurrent = null,
    ): array {
        $result = DB::transaction(function () use ($id, $userId, $increment, $expectedCurrent, $desiredCurrent): array {
            $goal = $this->goal->newQuery()->lockForUpdate()->find($id);
            if (!$goal || (int) $goal->user_id !== $userId) {
                return ['goal' => null, 'replay' => false, 'increment' => 0.0, 'old_percent' => 0.0, 'new_percent' => 0.0];
            }

            $current = (float) ($goal->current_value ?? 0);
            $target = (float) ($goal->target_value ?? 0);
            if ($desiredCurrent !== null) {
                if (abs($current - $desiredCurrent) < 0.000001) {
                    $percent = $target > 0 ? min(100.0, ($current / $target) * 100) : 0.0;
                    return ['goal' => $goal, 'replay' => true, 'increment' => 0.0, 'old_percent' => $percent, 'new_percent' => $percent];
                }
                if ($expectedCurrent === null || abs($current - $expectedCurrent) >= 0.000001) {
                    throw new \InvalidArgumentException('Goal progress changed before this update');
                }
                $increment = $desiredCurrent - $current;
            }

            $oldPercent = $target > 0 ? min(100.0, ($current / $target) * 100) : 0.0;
            $goal->current_value = $current + $increment;
            if ($target > 0 && $goal->current_value >= $target) $goal->status = 'completed';
            $goal->save();

            $newPercent = $target > 0 ? min(100.0, ((float) $goal->current_value / $target) * 100) : 0.0;
            $this->recordHistory($goal, 'progress_update', __('api_controllers_3.goals.history_progress', [
                'percent' => round($newPercent),
            ]), [
                'increment' => $increment, 'old_value' => $current,
                'new_value' => (float) $goal->current_value, 'progress_value' => round($newPercent, 2),
            ], $userId);
            app(GoalProgressService::class)->syncMilestones($goal);
            return compact('goal', 'increment', 'oldPercent', 'newPercent') + ['replay' => false];
        });

        if ($result['goal'] && !$result['replay']) {
            try {
                GoalMilestoneEmailService::checkAndSendMilestone(
                    TenantContext::getId(), $userId, $id, (string) ($result['goal']->title ?? ''),
                    $result['oldPercent'], $result['newPercent'],
                );
            } catch (\Throwable $e) {
                Log::warning('[GoalService] milestone email failed', ['goal' => $id, 'error' => $e->getMessage()]);
            }
        }

        return [
            'goal' => $result['goal']?->fresh(['user']),
            'replay' => $result['replay'],
            'increment' => (float) $result['increment'],
            'old_percent' => (float) ($result['oldPercent'] ?? $result['old_percent']),
            'new_percent' => (float) ($result['newPercent'] ?? $result['new_percent']),
        ];
    }

    /**
     * Mark a goal as completed.
     */
    public function complete(int $id, int $userId): ?Goal
    {
        return $this->completeWithResult($id, $userId)['goal'];
    }

    /** @return array{goal: Goal|null, replay: bool} */
    public function completeWithResult(int $id, int $userId): array
    {
        $result = DB::transaction(function () use ($id, $userId): array {
            $goal = $this->goal->newQuery()->lockForUpdate()->find($id);

            if (! $goal || (int) $goal->user_id !== $userId) {
                return ['goal' => null, 'replay' => false];
            }

            if ($goal->status === 'completed') {
                return ['goal' => $goal, 'replay' => true];
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

            $xpReference = 'goal:' . $id;
            GamificationService::awardXP(
                $userId,
                GamificationService::XP_VALUES['complete_goal'],
                'complete_goal',
                'Completed a goal',
                $xpReference,
            );
            if (! UserXpLog::query()
                ->where('user_id', $userId)
                ->where('action', 'complete_goal')
                ->where('source_reference', $xpReference)
                ->exists()) {
                throw new \RuntimeException('Goal completion XP did not persist.');
            }

            return ['goal' => $goal, 'replay' => false];
        });

        $goal = $result['goal'];
        if (! $goal || $result['replay']) {
            return $result;
        }

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

        return $result;
    }

    /**
     * Offer to be the buddy of another member's public goal.
     *
     * F-004 (E-038, owner decision 26 Sep 2026): an offer is a REQUEST. It
     * creates a pending `goal_buddy_requests` row and changes nothing on the
     * goal; `mentor_id` is written only when the goal owner accepts
     * (acceptBuddyRequest). One pending request per member per goal, and a
     * member whose offer was declined cannot offer again on that goal, so an
     * owner cannot be re-notified at will.
     *
     * The goal row is locked for the whole decision (F-143) so an offer cannot
     * interleave with an owner's accept.
     *
     * @return array{request_id: int, goal: Goal}|null null when the offer is not possible
     */
    public function offerBuddy(int $goalId, int $userId): ?array
    {
        return DB::transaction(function () use ($goalId, $userId): ?array {
            $goal = $this->goal->newQuery()->lockForUpdate()->find($goalId);

            if (! $goal || ! $goal->is_public || $goal->mentor_id !== null) {
                return null;
            }

            if ((int) $goal->user_id === $userId) {
                return null;
            }

            // F-334: a buddy offer bell- and push-notifies the goal owner with
            // the offering member's editable display name, so a block in either
            // direction refuses it. Checked before the safeguarding policy so a
            // blocked member cannot probe it.
            BlockUserService::assertNoBlockBetween($userId, (int) $goal->user_id);

            app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
                $userId,
                (int) $goal->user_id,
                (int) $goal->tenant_id,
                'goal_buddy',
            );

            $alreadyAsked = DB::table('goal_buddy_requests')
                ->where('tenant_id', (int) $goal->tenant_id)
                ->where('goal_id', (int) $goal->id)
                ->where('requester_id', $userId)
                ->whereIn('status', ['pending', 'declined'])
                ->exists();
            if ($alreadyAsked) {
                return null;
            }

            $requestId = (int) DB::table('goal_buddy_requests')->insertGetId([
                'tenant_id'    => (int) $goal->tenant_id,
                'goal_id'      => (int) $goal->id,
                'owner_id'     => (int) $goal->user_id,
                'requester_id' => $userId,
                'status'       => 'pending',
                'created_at'   => now(),
                'updated_at'   => now(),
            ]);

            return [
                'request_id' => $requestId,
                'goal'       => $this->freshWithPublicParticipants($goal),
            ];
        });
    }

    /**
     * Pending buddy requests on a goal, for its owner only.
     *
     * @return array{status: string, requests?: list<array<string,mixed>>}
     */
    public function listBuddyRequests(int $goalId, int $ownerId): array
    {
        $goal = $this->goal->newQuery()->find($goalId);
        if (! $goal) {
            return ['status' => 'not_found'];
        }
        if ((int) $goal->user_id !== $ownerId) {
            return ['status' => 'forbidden'];
        }

        $rows = DB::table('goal_buddy_requests')
            ->where('tenant_id', (int) $goal->tenant_id)
            ->where('goal_id', (int) $goal->id)
            ->where('status', 'pending')
            ->orderBy('id')
            ->get(['id', 'requester_id', 'status', 'created_at']);

        // User is tenant-scoped: a requester who left the community drops out.
        $requesters = User::query()
            ->whereIn('id', $rows->pluck('requester_id')->map(fn ($id) => (int) $id)->all())
            ->get(User::PUBLIC_IDENTITY_COLUMNS)
            ->keyBy('id');

        $requests = [];
        foreach ($rows as $row) {
            $requester = $requesters->get((int) $row->requester_id);
            if (! $requester) {
                continue;
            }
            $requests[] = [
                'id'         => (int) $row->id,
                'status'     => (string) $row->status,
                'created_at' => $row->created_at,
                'requester'  => [
                    'id'         => (int) $requester->id,
                    'name'       => UserDisplayName::resolve($requester),
                    'avatar_url' => $requester->avatar_url,
                ],
            ];
        }

        return ['status' => 'ok', 'requests' => $requests];
    }

    /**
     * The goal owner accepts a pending buddy request. This is the only path
     * that writes `goals.mentor_id` for a member-initiated buddy.
     *
     * The goal row and the request row are locked in one transaction, so two
     * accepts (double submit, two tabs) cannot both win (F-143); every other
     * pending request on the goal is closed as superseded.
     *
     * @return array{status: string, goal?: Goal, requester_id?: int}
     */
    public function acceptBuddyRequest(int $goalId, int $requestId, int $ownerId): array
    {
        return DB::transaction(function () use ($goalId, $requestId, $ownerId): array {
            $goal = $this->goal->newQuery()->lockForUpdate()->find($goalId);
            if (! $goal) {
                return ['status' => 'not_found'];
            }
            if ((int) $goal->user_id !== $ownerId) {
                return ['status' => 'forbidden'];
            }

            $request = DB::table('goal_buddy_requests')
                ->where('id', $requestId)
                ->where('tenant_id', (int) $goal->tenant_id)
                ->where('goal_id', (int) $goal->id)
                ->lockForUpdate()
                ->first();
            if (! $request) {
                return ['status' => 'not_found'];
            }
            if ($request->status !== 'pending' || $goal->mentor_id !== null) {
                return ['status' => 'conflict'];
            }

            $requesterId = (int) $request->requester_id;
            if (! User::query()->where('id', $requesterId)->exists()) {
                return ['status' => 'conflict'];
            }

            // F-334: a request made before the block was placed must not be
            // turned into a live buddy relationship afterwards.
            BlockUserService::assertNoBlockBetween($requesterId, (int) $goal->user_id);

            app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
                $requesterId,
                (int) $goal->user_id,
                (int) $goal->tenant_id,
                'goal_buddy',
            );

            $goal->mentor_id = $requesterId;
            $goal->save();

            $now = now();
            DB::table('goal_buddy_requests')
                ->where('id', (int) $request->id)
                ->update(['status' => 'accepted', 'responded_at' => $now, 'updated_at' => $now]);
            DB::table('goal_buddy_requests')
                ->where('tenant_id', (int) $goal->tenant_id)
                ->where('goal_id', (int) $goal->id)
                ->where('status', 'pending')
                ->update(['status' => 'superseded', 'responded_at' => $now, 'updated_at' => $now]);

            $this->recordHistory($goal, 'buddy_joined', __('api_controllers_3.goals.history_buddy_joined'), [
                'buddy_id'         => $requesterId,
                'buddy_request_id' => (int) $request->id,
            ], $ownerId);

            return [
                'status'       => 'accepted',
                'goal'         => $this->freshWithPublicParticipants($goal),
                'requester_id' => $requesterId,
            ];
        });
    }

    /**
     * The goal owner declines a pending buddy request. The goal is untouched.
     *
     * @return array{status: string}
     */
    public function declineBuddyRequest(int $goalId, int $requestId, int $ownerId): array
    {
        return DB::transaction(function () use ($goalId, $requestId, $ownerId): array {
            $goal = $this->goal->newQuery()->lockForUpdate()->find($goalId);
            if (! $goal) {
                return ['status' => 'not_found'];
            }
            if ((int) $goal->user_id !== $ownerId) {
                return ['status' => 'forbidden'];
            }

            $request = DB::table('goal_buddy_requests')
                ->where('id', $requestId)
                ->where('tenant_id', (int) $goal->tenant_id)
                ->where('goal_id', (int) $goal->id)
                ->lockForUpdate()
                ->first();
            if (! $request) {
                return ['status' => 'not_found'];
            }
            if ($request->status !== 'pending') {
                return ['status' => 'conflict'];
            }

            DB::table('goal_buddy_requests')
                ->where('id', (int) $request->id)
                ->update(['status' => 'declined', 'responded_at' => now(), 'updated_at' => now()]);

            return ['status' => 'declined'];
        });
    }

    /**
     * Goal ids (from $goalIds) on which $requesterId has a pending buddy request.
     *
     * @param  list<int>  $goalIds
     * @return list<int>
     */
    public function pendingBuddyRequestGoalIds(int $requesterId, array $goalIds): array
    {
        if ($goalIds === []) {
            return [];
        }

        return DB::table('goal_buddy_requests')
            ->where('tenant_id', TenantContext::getId())
            ->where('requester_id', $requesterId)
            ->where('status', 'pending')
            ->whereIn('goal_id', $goalIds)
            ->pluck('goal_id')
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values()
            ->all();
    }

    /**
     * Pending buddy request counts keyed by goal id.
     *
     * @param  list<int>  $goalIds
     * @return array<int,int>
     */
    public function pendingBuddyRequestCounts(array $goalIds): array
    {
        if ($goalIds === []) {
            return [];
        }

        $counts = [];
        $rows = DB::table('goal_buddy_requests')
            ->where('tenant_id', TenantContext::getId())
            ->where('status', 'pending')
            ->whereIn('goal_id', $goalIds)
            ->groupBy('goal_id')
            ->selectRaw('goal_id, COUNT(*) as pending_count')
            ->get();
        foreach ($rows as $row) {
            $counts[(int) $row->goal_id] = (int) $row->pending_count;
        }

        return $counts;
    }

    /**
     * Reload a goal with owner and buddy constrained to public identity
     * columns (F-097 — never return full account rows).
     */
    private function freshWithPublicParticipants(Goal $goal): Goal
    {
        $publicIdentity = implode(',', User::PUBLIC_IDENTITY_COLUMNS);

        return $goal->fresh([
            "user:{$publicIdentity}",
            "mentor:{$publicIdentity}",
        ]);
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

        // F-334: a buddy note is free text the goal owner is shown, so a block
        // placed after the buddy relationship began still stops it.
        BlockUserService::assertNoBlockBetween($buddyId, (int) $goal->user_id);

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
