<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Exceptions\SafeguardingPolicyException;
use App\I18n\LocaleContext;
use App\Models\Goal;
use App\Models\Notification;
use App\Models\User;
use App\Services\GoalService;
use App\Services\GoalCheckinService;
use App\Services\GoalProgressService;
use App\Services\GoalTemplateService;
use App\Services\GoalReminderService;
use Illuminate\Http\JsonResponse;
use App\Support\UserDisplayName;

/**
 * GoalsController — Eloquent-powered CRUD and progress tracking for member goals.
 *
 * Fully migrated from legacy delegation to Eloquent via GoalService.
 */
class GoalsController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly GoalService $goalService,
        private readonly GoalCheckinService $checkinService,
        private readonly GoalProgressService $progressService,
        private readonly GoalTemplateService $templateService,
        private readonly GoalReminderService $reminderService,
    ) {}

    /**
     * Enrich a goal array with computed fields the frontend expects.
     *
     * Maps nested relations to flat fields: user_name, user_avatar,
     * buddy_id, buddy_name, buddy_avatar, progress_percentage.
     */
    private function enrichGoal(array $goal): array
    {
        // Flatten user relation
        $user = $goal['user'] ?? null;
        $goal['user_name'] = $user
            ? UserDisplayName::resolve($user)
            : null;
        $goal['user_avatar'] = $user['avatar_url'] ?? null;

        // Map mentor → buddy fields (frontend uses buddy_id, backend stores mentor_id)
        $mentor = $goal['mentor'] ?? null;
        $goal['buddy_id'] = $goal['mentor_id'] ?? null;
        $goal['buddy_name'] = $mentor
            ? UserDisplayName::resolve($mentor)
            : null;
        $goal['buddy_avatar'] = $mentor['avatar_url'] ?? null;

        // Compute progress percentage
        $target = (float) ($goal['target_value'] ?? 0);
        $current = (float) ($goal['current_value'] ?? 0);
        $goal['progress_percentage'] = $target > 0 ? min(100.0, ($current / $target) * 100) : 0.0;
        $goal['streak_count'] = (int) ($goal['streak_count'] ?? 0);
        $goal['best_streak_count'] = (int) ($goal['best_streak_count'] ?? 0);

        return $goal;
    }

    private function canViewGoal(Goal $goal, int $userId): bool
    {
        return (bool) $goal->is_public
            || (int) $goal->user_id === $userId
            || (int) ($goal->mentor_id ?? 0) === $userId;
    }

    // -----------------------------------------------------------------
    //  GET /api/v2/goals
    // -----------------------------------------------------------------

    public function index(): JsonResponse
    {
        $userId = $this->getUserId();

        $filters = [
            'user_id'    => $this->queryInt('user_id', $userId),
            'status'     => $this->query('status', 'all'),
            'visibility' => $this->query('visibility', 'all'),
            'limit'      => $this->queryInt('per_page', 20, 1, 100),
        ];

        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }

        // If querying another user's goals, only show public
        if ($filters['user_id'] !== $userId) {
            $filters['visibility'] = 'public';
        }

        $result = $this->goalService->getAll($filters);

        $items = array_map(function (array $goal) use ($userId) {
            $goal = $this->enrichGoal($goal);
            $goal['is_owner'] = ((int) ($goal['user_id'] ?? 0) === $userId);
            $goal['is_buddy'] = ((int) ($goal['mentor_id'] ?? 0) === $userId && ($goal['mentor_id'] ?? null) !== null);
            return $goal;
        }, $result['items']);

        return $this->respondWithCollection(
            $items,
            $result['cursor'],
            $filters['limit'],
            $result['has_more']
        );
    }

    // -----------------------------------------------------------------
    //  GET /api/v2/goals/{id}
    // -----------------------------------------------------------------

    public function show(int $id): JsonResponse
    {
        $userId = $this->getUserId();

        $goal = $this->goalService->getById($id);

        if (! $goal) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.goal_not_found'), null, 404);
        }

        if (! $this->canViewGoal($goal, $userId)) {
            return $this->respondWithError('RESOURCE_FORBIDDEN', __('api.goal_is_private'), null, 403);
        }

        $data = $this->enrichGoal($goal->toArray());
        $data['is_owner'] = ((int) $goal->user_id === $userId);
        $data['is_buddy'] = ((int) ($goal->mentor_id ?? 0) === $userId && $goal->mentor_id !== null);

        return $this->respondWithData($data);
    }

    // -----------------------------------------------------------------
    //  POST /api/v2/goals
    // -----------------------------------------------------------------

    public function store(): JsonResponse
    {
        $userId = $this->getUserId();
        $this->rateLimit('goal_create', 10, 60);

        $data = $this->getAllInput();

        if (empty(trim($data['title'] ?? ''))) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.title_required'), 'title', 400);
        }

        $goal = $this->goalService->create($userId, $data);
        $result = $this->enrichGoal($goal->load(['user:id,first_name,last_name,profile_type,organization_name,avatar_url', 'mentor:id,first_name,last_name,profile_type,organization_name,avatar_url'])->toArray());
        $result['is_owner'] = true;

        // Record feed activity (only for public goals)
        if (!empty($data['is_public']) || ($goal->is_public ?? false)) {
            try {
                app(\App\Services\FeedActivityService::class)->recordActivity(
                    \App\Core\TenantContext::getId(),
                    $userId,
                    'goal',
                    $goal->id,
                    [
                        'title'   => $data['title'] ?? null,
                        'content' => $data['description'] ?? null,
                    ]
                );
            } catch (\Throwable $e) {
                \Log::warning('Feed activity recording failed', ['type' => 'goal', 'id' => $goal->id, 'error' => $e->getMessage()]);
            }
        }

        return $this->respondWithData($result, null, 201);
    }

    // -----------------------------------------------------------------
    //  PUT /api/v2/goals/{id}
    // -----------------------------------------------------------------

    public function update(int $id): JsonResponse
    {
        $userId = $this->getUserId();
        $this->rateLimit('goal_update', 20, 60);

        $goal = $this->goalService->update($id, $userId, $this->getAllInput());

        if (! $goal) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.goal_not_found_or_not_owned'), null, 404);
        }

        $data = $this->enrichGoal($goal->load(['user:id,first_name,last_name,profile_type,organization_name,avatar_url', 'mentor:id,first_name,last_name,profile_type,organization_name,avatar_url'])->toArray());
        $data['is_owner'] = true;

        return $this->respondWithData($data);
    }

    // -----------------------------------------------------------------
    //  DELETE /api/v2/goals/{id}
    // -----------------------------------------------------------------

    public function destroy(int $id): JsonResponse
    {
        $userId = $this->getUserId();
        $this->rateLimit('goal_delete', 10, 60);

        $deleted = $this->goalService->delete($id, $userId);

        if (! $deleted) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.goal_not_found_or_not_owned'), null, 404);
        }

        return $this->noContent();
    }

    // -----------------------------------------------------------------
    //  POST /api/v2/goals/{id}/progress
    // -----------------------------------------------------------------

    public function progress(int $id): JsonResponse
    {
        $userId = $this->getUserId();
        $this->rateLimit('goal_progress', 30, 60);

        $increment = $this->input('increment');

        if ($increment === null) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.increment_required'), 'increment', 400);
        }

        $goal = $this->goalService->incrementProgress($id, $userId, (float) $increment);

        if (! $goal) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.goal_not_found_or_not_owned'), null, 404);
        }

        // Notify the buddy/mentor of progress updates
        try {
            $mentorId = $goal->mentor_id ? (int) $goal->mentor_id : null;
            if ($mentorId && $mentorId !== $userId) {
                $owner = User::find($userId);
                $mentor = User::find($mentorId);
                LocaleContext::withLocale($mentor, function () use ($owner, $goal, $mentorId, $id) {
                    $ownerName = $owner->name ?? __('emails.common.fallback_someone');
                    $goalTitle = $goal->title ?? 'their goal';

                    // If progress caused auto-completion, send completion message
                    if ($goal->status === 'completed') {
                        Notification::createNotification(
                            $mentorId,
                            __('api_controllers_3.goals.completed_mentor', ['name' => $ownerName, 'title' => $goalTitle]),
                            "/goals/{$id}",
                            'goal_completed'
                        );
                        \App\Services\NotificationDispatcher::fanOutPush((int) $mentorId, 'goal_completed', __('api_controllers_3.goals.completed_mentor', ['name' => $ownerName, 'title' => $goalTitle]), "/goals/{$id}");
                    } else {
                        Notification::createNotification(
                            $mentorId,
                            __('api_controllers_3.goals.progress_mentor', ['name' => $ownerName, 'title' => $goalTitle]),
                            "/goals/{$id}",
                            'goal_progress'
                        );
                        \App\Services\NotificationDispatcher::fanOutPush((int) $mentorId, 'goal_progress', __('api_controllers_3.goals.progress_mentor', ['name' => $ownerName, 'title' => $goalTitle]), "/goals/{$id}");
                    }
                });
            }
        } catch (\Throwable $e) {
            \Log::warning('Goal progress notification failed', ['goal' => $id, 'error' => $e->getMessage()]);
        }

        // If auto-completed via progress, also notify the owner (achievement)
        try {
            if ($goal->status === 'completed') {
                Notification::createNotification(
                    $userId,
                    __('api_controllers_3.goals.completed_self', ['title' => $goal->title]),
                    "/goals/{$id}",
                    'goal_completed'
                );
                \App\Services\NotificationDispatcher::fanOutPush((int) $userId, 'goal_completed', __('api_controllers_3.goals.completed_self', ['title' => $goal->title]), "/goals/{$id}");
            }
        } catch (\Throwable $e) {
            \Log::warning('Goal auto-completion notification failed', ['goal' => $id, 'error' => $e->getMessage()]);
        }

        $data = $this->enrichGoal($goal->load(['user:id,first_name,last_name,profile_type,organization_name,avatar_url', 'mentor:id,first_name,last_name,profile_type,organization_name,avatar_url'])->toArray());
        $data['is_owner'] = true;

        return $this->respondWithData($data);
    }

    // -----------------------------------------------------------------
    //  POST /api/v2/goals/{id}/complete
    // -----------------------------------------------------------------

    public function complete(int $id): JsonResponse
    {
        $userId = $this->getUserId();
        $this->rateLimit('goal_complete', 10, 60);

        $goal = $this->goalService->complete($id, $userId);

        if (! $goal) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.goal_not_found_or_not_owned'), null, 404);
        }

        // Award XP for completing a goal
        try {
            \App\Services\GamificationService::awardXP($userId, \App\Services\GamificationService::XP_VALUES['complete_goal'], 'complete_goal', 'Completed a goal');
        } catch (\Throwable $e) {
            \Log::warning('Gamification XP award failed', ['action' => 'complete_goal', 'user' => $userId, 'error' => $e->getMessage()]);
        }

        // Notify the goal owner (achievement notification)
        try {
            $goalTitle = $goal->title ?? 'your goal';
            Notification::createNotification(
                $userId,
                __('api_controllers_3.goals.completed_self', ['title' => $goalTitle]),
                "/goals/{$id}",
                'goal_completed'
            );
            \App\Services\NotificationDispatcher::fanOutPush((int) $userId, 'goal_completed', __('api_controllers_3.goals.completed_self', ['title' => $goalTitle]), "/goals/{$id}");
        } catch (\Throwable $e) {
            \Log::warning('Goal completion notification failed', ['goal' => $id, 'error' => $e->getMessage()]);
        }

        // Notify the buddy/mentor if one exists
        try {
            $mentorId = $goal->mentor_id ? (int) $goal->mentor_id : null;
            if ($mentorId && $mentorId !== $userId) {
                $owner = User::find($userId);
                $mentor = User::find($mentorId);
                LocaleContext::withLocale($mentor, function () use ($owner, $goal, $mentorId, $id) {
                    $ownerName = $owner->name ?? __('emails.common.fallback_someone');
                    Notification::createNotification(
                        $mentorId,
                        __('api_controllers_3.goals.completed_mentor', ['name' => $ownerName, 'title' => $goal->title]),
                        "/goals/{$id}",
                        'goal_completed'
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) $mentorId, 'goal_completed', __('api_controllers_3.goals.completed_mentor', ['name' => $ownerName, 'title' => $goal->title]), "/goals/{$id}");
                });
            }
        } catch (\Throwable $e) {
            \Log::warning('Goal buddy completion notification failed', ['goal' => $id, 'error' => $e->getMessage()]);
        }

        $data = $this->enrichGoal($goal->load(['user:id,first_name,last_name,profile_type,organization_name,avatar_url', 'mentor:id,first_name,last_name,profile_type,organization_name,avatar_url'])->toArray());
        $data['is_owner'] = true;

        return $this->respondWithData($data);
    }

    // -----------------------------------------------------------------
    //  GET /api/v2/goals/discover
    // -----------------------------------------------------------------

    public function discover(): JsonResponse
    {
        $userId = $this->getUserId();

        $filters = [
            'limit' => $this->queryInt('per_page', 20, 1, 100),
        ];

        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }

        $result = $this->goalService->getPublicForBuddy($userId, $filters);

        $items = array_map(function (array $goal) use ($userId) {
            $goal = $this->enrichGoal($goal);
            $goal['is_owner'] = ((int) ($goal['user_id'] ?? 0) === $userId);
            $goal['is_buddy'] = false;
            return $goal;
        }, $result['items']);

        return $this->respondWithCollection($items, $result['cursor'], $filters['limit'], $result['has_more']);
    }

    // -----------------------------------------------------------------
    //  GET /api/v2/goals/mentoring
    // -----------------------------------------------------------------

    public function mentoring(): JsonResponse
    {
        $userId = $this->getUserId();

        $filters = [
            'limit' => $this->queryInt('per_page', 20, 1, 100),
        ];

        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }

        $result = $this->goalService->getGoalsAsMentor($userId, $filters);

        $items = array_map(function (array $goal) use ($userId) {
            $goal = $this->enrichGoal($goal);
            $goal['is_owner'] = ((int) ($goal['user_id'] ?? 0) === $userId);
            $goal['is_buddy'] = true;
            return $goal;
        }, $result['items']);

        return $this->respondWithCollection($items, $result['cursor'], $filters['limit'], $result['has_more']);
    }

    // -----------------------------------------------------------------
    //  POST /api/v2/goals/{id}/buddy
    // -----------------------------------------------------------------

    public function buddy(int $id): JsonResponse
    {
        $userId = $this->getUserId();
        $this->rateLimit('goal_buddy', 10, 60);

        try {
            $goal = $this->goalService->offerBuddy($id, $userId);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if (! $goal) {
            return $this->respondWithError('RESOURCE_CONFLICT', __('api.cannot_become_buddy'), null, 409);
        }

        // Notify the goal owner that someone became their buddy
        try {
            $goalOwnerId = (int) $goal->user_id;
            if ($goalOwnerId !== $userId) {
                $buddy = User::find($userId);
                $goalOwner = User::find($goalOwnerId);
                LocaleContext::withLocale($goalOwner, function () use ($buddy, $goal, $goalOwnerId, $id) {
                    $buddyName = $buddy->name ?? __('emails.common.fallback_someone');
                    Notification::createNotification(
                        $goalOwnerId,
                        __('api_controllers_3.goals.buddy_joined_owner', ['name' => $buddyName, 'title' => $goal->title]),
                        "/goals/{$id}",
                        'goal_buddy'
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) $goalOwnerId, 'goal_buddy', __('api_controllers_3.goals.buddy_joined_owner', ['name' => $buddyName, 'title' => $goal->title]), "/goals/{$id}");
                });
            }
        } catch (\Throwable $e) {
            \Log::warning('Goal buddy notification failed', ['goal' => $id, 'error' => $e->getMessage()]);
        }

        return $this->respondWithData([
            'message' => __('api.buddy_added'),
            'goal'    => $this->enrichGoal($goal->toArray()),
        ]);
    }

    public function buddyNudge(int $id): JsonResponse
    {
        $userId = $this->getUserId();
        $this->rateLimit('goal_buddy_nudge', 20, 60);

        try {
            $note = $this->goalService->createBuddyNote($id, $userId, $this->getAllInput());
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }
        if (! $note) {
            return $this->respondWithError('RESOURCE_FORBIDDEN', __('api.goal_buddy_required'), null, 403);
        }

        try {
            $goal = $this->goalService->getById($id);
            if ($goal) {
                $buddy = User::find($userId);
                $ownerId = (int) $goal->user_id;
                $owner = User::find($ownerId);
                LocaleContext::withLocale($owner, function () use ($buddy, $goal, $ownerId, $id, $note) {
                    $buddyName = $buddy->name ?? __('emails.common.fallback_someone');
                    $pushBody = __('api_controllers_3.goals.buddy_action_owner', [
                        'name' => $buddyName,
                        'title' => $goal->title,
                        'action' => __('api_controllers_3.goals.buddy_action_' . ($note['type'] ?? 'encouragement')),
                    ]);
                    Notification::createNotification(
                        $ownerId,
                        $pushBody,
                        "/goals/{$id}",
                        'goal_buddy'
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) $ownerId, 'goal_buddy', $pushBody, "/goals/{$id}");
                });
            }
        } catch (\Throwable $e) {
            \Log::warning('Goal buddy nudge notification failed', ['goal' => $id, 'error' => $e->getMessage()]);
        }

        return $this->respondWithData($note, null, 201);
    }

    // -----------------------------------------------------------------
    //  Check-ins
    // -----------------------------------------------------------------

    public function createCheckin(int $id): JsonResponse
    {
        $userId = $this->getUserId();
        $this->rateLimit('goal_checkin', 20, 60);

        $goal = $this->goalService->getById($id);
        if (! $goal || (int) $goal->user_id !== $userId) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.goal_not_found_or_not_owned'), null, 404);
        }

        $checkin = $this->checkinService->create($id, $userId, $this->getAllInput());

        // Notify the buddy/mentor about the check-in
        try {
            $mentorId = $goal->mentor_id ? (int) $goal->mentor_id : null;
            if ($mentorId && $mentorId !== $userId) {
                $owner = User::find($userId);
                $mentor = User::find($mentorId);
                LocaleContext::withLocale($mentor, function () use ($owner, $goal, $mentorId, $id) {
                    $ownerName = $owner->name ?? __('emails.common.fallback_someone');
                    Notification::createNotification(
                        $mentorId,
                        __('api_controllers_3.goals.checkin_mentor', ['name' => $ownerName, 'title' => $goal->title]),
                        "/goals/{$id}",
                        'goal_checkin'
                    );
                });
            }
        } catch (\Throwable $e) {
            \Log::warning('Goal check-in notification failed', ['goal' => $id, 'error' => $e->getMessage()]);
        }

        return $this->respondWithData($checkin->toArray(), null, 201);
    }

    public function listCheckins(int $id): JsonResponse
    {
        $userId = $this->getUserId();

        $goal = $this->goalService->getById($id);
        if (! $goal) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.goal_not_found'), null, 404);
        }

        if (! $this->canViewGoal($goal, $userId)) {
            return $this->respondWithError('RESOURCE_FORBIDDEN', __('api.goal_is_private'), null, 403);
        }

        $filters = [
            'limit' => $this->queryInt('per_page', 20, 1, 100),
        ];

        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }

        $result = $this->checkinService->getByGoalId($id, $filters);

        return $this->respondWithCollection($result['items'], $result['cursor'], $filters['limit'], $result['has_more']);
    }

    // -----------------------------------------------------------------
    //  Progress history
    // -----------------------------------------------------------------

    public function history(int $id): JsonResponse
    {
        $userId = $this->getUserId();

        $goal = $this->goalService->getById($id);
        if (! $goal) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.goal_not_found'), null, 404);
        }

        if (! $this->canViewGoal($goal, $userId)) {
            return $this->respondWithError('RESOURCE_FORBIDDEN', __('api.goal_is_private'), null, 403);
        }

        $filters = [
            'limit' => $this->queryInt('per_page', 50, 1, 100),
        ];

        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }

        if ($this->query('event_type')) {
            $filters['event_type'] = $this->query('event_type');
        }

        $result = $this->progressService->getProgressHistory($id, $filters);

        return $this->respondWithCollection($result['items'], $result['cursor'], $filters['limit'], $result['has_more']);
    }

    public function historySummary(int $id): JsonResponse
    {
        $userId = $this->getUserId();

        $goal = $this->goalService->getById($id);
        if (! $goal) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.goal_not_found'), null, 404);
        }

        if (! $this->canViewGoal($goal, $userId)) {
            return $this->respondWithError('RESOURCE_FORBIDDEN', __('api.goal_is_private'), null, 403);
        }

        $summary = $this->progressService->getSummary($id);

        return $this->respondWithData($summary);
    }

    public function insights(int $id): JsonResponse
    {
        $userId = $this->getUserId();

        $goal = $this->goalService->getById($id);
        if (! $goal) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.goal_not_found'), null, 404);
        }

        if (! $this->canViewGoal($goal, $userId)) {
            return $this->respondWithError('RESOURCE_FORBIDDEN', __('api.goal_is_private'), null, 403);
        }

        return $this->respondWithData($this->progressService->getInsights($id));
    }

    // -----------------------------------------------------------------
    //  Templates
    // -----------------------------------------------------------------

    public function templates(): JsonResponse
    {
        $this->getUserId();

        $filters = [
            'limit' => $this->queryInt('per_page', 50, 1, 100),
        ];

        if ($this->query('category')) {
            $filters['category'] = $this->query('category');
        }

        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }

        $result = $this->templateService->getAll($filters);

        return $this->respondWithCollection($result['items'], $result['cursor'], $filters['limit'], $result['has_more']);
    }

    public function templateCategories(): JsonResponse
    {
        $this->getUserId();

        $categories = $this->templateService->getCategories();

        return $this->respondWithData($categories);
    }

    public function createTemplate(): JsonResponse
    {
        $userId = $this->requireAdmin();
        $this->rateLimit('goal_template_create', 10, 60);

        $data = $this->getAllInput();

        if (empty(trim($data['title'] ?? ''))) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.title_required'), 'title', 400);
        }

        $template = $this->templateService->create($userId, $data);

        return $this->respondWithData($template->toArray(), null, 201);
    }

    public function createFromTemplate(int $templateId): JsonResponse
    {
        $userId = $this->getUserId();
        $this->rateLimit('goal_create', 10, 60);

        $goal = $this->templateService->createGoalFromTemplate($templateId, $userId, $this->getAllInput());

        if (! $goal) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.template_not_found'), null, 404);
        }

        $data = $goal->toArray();
        $data['is_owner'] = true;

        return $this->respondWithData($data, null, 201);
    }

    // -----------------------------------------------------------------
    //  Reminders
    // -----------------------------------------------------------------

    public function getReminder(int $id): JsonResponse
    {
        $userId = $this->getUserId();

        $reminder = $this->reminderService->getReminder($id, $userId);

        return $this->respondWithData($reminder);
    }

    public function setReminder(int $id): JsonResponse
    {
        $userId = $this->getUserId();
        $this->rateLimit('goal_reminder', 20, 60);

        $reminder = $this->reminderService->setReminder($id, $userId, $this->getAllInput());

        if ($reminder === []) {
            return $this->respondWithError('NOT_FOUND', __('api.goal_not_found'), null, 404);
        }

        return $this->respondWithData($reminder);
    }

    public function deleteReminder(int $id): JsonResponse
    {
        $userId = $this->getUserId();

        $this->reminderService->deleteReminder($id, $userId);

        return $this->noContent();
    }
}
