<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use Illuminate\Support\Facades\DB;
use App\Support\UserDisplayName;

/**
 * TeamTaskService — Native Eloquent/DB implementation for team task management.
 *
 * Manages tasks within groups (ideation challenge teams). Uses cursor-based pagination.
 */
class TeamTaskService
{
    /** @var list<string> */
    private const STATUSES = ['todo', 'in_progress', 'done'];

    /** @var list<string> */
    private const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

    /** @var list<string> */
    private const MANAGER_FIELDS = [
        'title',
        'description',
        'assigned_to',
        'priority',
        'due_date',
    ];

    private array $errors = [];

    public function getErrors(): array
    {
        return $this->errors;
    }

    /**
     * Get tasks for a group with optional filters and cursor pagination.
     *
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public function getTasks(int $groupId, array $filters = [], ?int $userId = null): array
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();
        $limit = min(max((int) ($filters['limit'] ?? 50), 1), 100);

        if (!$this->authorizeParent($groupId, $userId, false)) {
            return ['items' => [], 'cursor' => null, 'has_more' => false];
        }

        $query = DB::table('team_tasks')
            ->where('tenant_id', $tenantId)
            ->where('group_id', $groupId);

        if (!empty($filters['status'])) {
            $query->where('status', $filters['status']);
        }

        if (!empty($filters['assigned_to'])) {
            $query->where('assigned_to', (int) $filters['assigned_to']);
        }

        if (!empty($filters['cursor'])) {
            $query->where('id', '<', (int) $filters['cursor']);
        }

        $tasks = $query->orderByDesc('id')
            ->limit($limit + 1)
            ->get()
            ->toArray();

        $hasMore = count($tasks) > $limit;
        if ($hasMore) {
            array_pop($tasks);
        }

        $capabilityContext = $this->taskCapabilityContext($groupId, (int) $userId);
        $assignees = $this->loadAssignees($tasks, (int) $tenantId);
        $items = array_map(
            fn ($row) => $this->presentTask(
                $row,
                (int) $userId,
                $capabilityContext,
                $assignees[(int) ($row->assigned_to ?? 0)] ?? null,
            ),
            $tasks,
        );
        $cursor = !empty($items) ? (string) end($items)['id'] : null;

        return [
            'items' => $items,
            'cursor' => $cursor,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Get a single task by ID (tenant-scoped).
     */
    public function getById(int $taskId, ?int $userId = null): ?array
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        $task = DB::table('team_tasks')
            ->where('id', $taskId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$task) {
            return null;
        }

        if (!$this->authorizeParent((int) $task->group_id, $userId, false)) {
            return null;
        }

        $assignees = $this->loadAssignees([$task], (int) $tenantId);

        return $this->presentTask(
            $task,
            (int) $userId,
            $this->taskCapabilityContext((int) $task->group_id, (int) $userId),
            $assignees[(int) ($task->assigned_to ?? 0)] ?? null,
        );
    }

    /**
     * Create a new task within a group.
     */
    public function create(int $groupId, int $userId, array $data): ?int
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        if (!$this->authorizeParent($groupId, $userId, true)) {
            return null;
        }

        $title = trim($data['title'] ?? '');
        if ($title === '') {
            $this->errors[] = [
                'code' => 'VALIDATION_ERROR',
                'message' => __('svc_notifications_2.team_task.title_required'),
                'field' => 'title',
            ];
            return null;
        }

        // Validate status if provided
        $status = $data['status'] ?? 'todo';
        if (!in_array($status, self::STATUSES, true)) {
            $this->errors[] = [
                'code' => 'VALIDATION_ERROR',
                'message' => __('svc_notifications_2.team_task.invalid_status'),
                'field' => 'status',
            ];
            return null;
        }

        $priority = $data['priority'] ?? 'medium';
        if (!in_array($priority, self::PRIORITIES, true)) {
            $this->errors[] = [
                'code' => 'VALIDATION_ERROR',
                'message' => __('svc_notifications_2.team_task.invalid_priority'),
                'field' => 'priority',
            ];
            return null;
        }

        $assignedTo = $this->resolveAssignee($groupId, $data);
        if ($assignedTo === false) {
            return null;
        }

        $now = now();
        GroupService::assertSafeguardingBroadcastAllowed(
            $groupId,
            $userId,
            (int) $tenantId,
            'team_task_create',
            trim($title . ' ' . (string) ($data['description'] ?? '')),
            is_int($assignedTo) && $assignedTo > 0 ? [$assignedTo] : [],
        );

        $id = DB::table('team_tasks')->insertGetId([
            'group_id' => $groupId,
            'tenant_id' => $tenantId,
            'title' => $title,
            'description' => $data['description'] ?? null,
            'assigned_to' => $assignedTo,
            'status' => $status,
            'priority' => $priority,
            'due_date' => $data['due_date'] ?? null,
            'created_by' => $userId,
            'created_at' => $now,
            'completed_at' => $status === 'done' ? $now : null,
        ]);

        return (int) $id;
    }

    /**
     * Update an existing task.
     */
    public function update(int $taskId, int $userId, array $data): bool
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        $task = DB::table('team_tasks')
            ->where('id', $taskId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$task) {
            $this->errors[] = [
                'code' => 'RESOURCE_NOT_FOUND',
                'message' => __('svc_notifications_2.team_task.task_not_found'),
            ];
            return false;
        }

        $groupId = (int) $task->group_id;
        if (!$this->authorizeParent($groupId, $userId, true)) {
            return false;
        }

        $isManager = GroupAccessService::canManage($groupId, $userId);
        $isCreator = (int) ($task->created_by ?? 0) === $userId;
        $isAssignee = (int) ($task->assigned_to ?? 0) === $userId;

        $changesManagerField = array_intersect(self::MANAGER_FIELDS, array_keys($data)) !== [];
        if ($changesManagerField && !$isCreator && !$isManager) {
            return $this->forbid();
        }
        if (array_key_exists('status', $data) && !$isAssignee && !$isCreator && !$isManager) {
            return $this->forbid();
        }

        $update = [];

        if (array_key_exists('title', $data)) {
            $title = trim($data['title']);
            if ($title === '') {
                $this->errors[] = [
                    'code' => 'VALIDATION_ERROR',
                    'message' => __('svc_notifications_2.team_task.title_cannot_be_empty'),
                    'field' => 'title',
                ];
                return false;
            }
            $update['title'] = $title;
        }

        if (array_key_exists('description', $data)) {
            $update['description'] = $data['description'];
        }

        if (array_key_exists('assigned_to', $data)) {
            $assignedTo = $this->resolveAssignee($groupId, $data);
            if ($assignedTo === false) {
                return false;
            }
            $update['assigned_to'] = $assignedTo;
        }

        if (array_key_exists('status', $data)) {
            if (!in_array($data['status'], self::STATUSES, true)) {
                $this->errors[] = [
                    'code' => 'VALIDATION_ERROR',
                    'message' => __('svc_notifications_2.team_task.invalid_status'),
                    'field' => 'status',
                ];
                return false;
            }
            $update['status'] = $data['status'];

            // Set completed_at when transitioning to done
            if ($data['status'] === 'done' && $task->status !== 'done') {
                $update['completed_at'] = now();
            } elseif ($data['status'] !== 'done') {
                $update['completed_at'] = null;
            }
        }

        if (array_key_exists('priority', $data)) {
            if (!in_array($data['priority'], self::PRIORITIES, true)) {
                $this->errors[] = [
                    'code' => 'VALIDATION_ERROR',
                    'message' => __('svc_notifications_2.team_task.invalid_priority'),
                    'field' => 'priority',
                ];
                return false;
            }
            $update['priority'] = $data['priority'];
        }

        if (array_key_exists('due_date', $data)) {
            $update['due_date'] = $data['due_date'];
        }

        if (empty($update)) {
            return true; // Nothing to update is still success
        }

        $additionalRecipients = [];
        if ((int) ($task->assigned_to ?? 0) > 0) {
            $additionalRecipients[] = (int) $task->assigned_to;
        }
        if (isset($update['assigned_to']) && (int) $update['assigned_to'] > 0) {
            $additionalRecipients[] = (int) $update['assigned_to'];
        }
        GroupService::assertSafeguardingBroadcastAllowed(
            (int) $task->group_id,
            $userId,
            (int) $tenantId,
            'team_task_update',
            trim((string) ($update['title'] ?? '') . ' ' . (string) ($update['description'] ?? '')),
            $additionalRecipients,
        );

        $update['updated_at'] = now();

        DB::table('team_tasks')
            ->where('id', $taskId)
            ->where('tenant_id', $tenantId)
            ->update($update);

        return true;
    }

    /**
     * Delete a task.
     */
    public function delete(int $taskId, int $userId): bool
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        return DB::transaction(function () use ($taskId, $userId, $tenantId): bool {
            $task = DB::table('team_tasks')
                ->where('id', $taskId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();

            if (!$task) {
                $this->errors[] = [
                    'code' => 'RESOURCE_NOT_FOUND',
                    'message' => __('svc_notifications_2.team_task.task_not_found'),
                ];
                return false;
            }

            $groupId = (int) $task->group_id;
            if (!$this->authorizeParent($groupId, $userId, true)) {
                return false;
            }

            $isCreator = (int) ($task->created_by ?? 0) === $userId;
            if (!$isCreator && !GroupAccessService::canManage($groupId, $userId)) {
                return $this->forbid();
            }

            $deleted = DB::table('team_tasks')
                ->where('id', $taskId)
                ->where('tenant_id', $tenantId)
                ->where('group_id', $groupId)
                ->delete();
            if ($deleted !== 1) {
                $this->errors[] = [
                    'code' => 'RESOURCE_NOT_FOUND',
                    'message' => __('svc_notifications_2.team_task.task_not_found'),
                ];
                return false;
            }

            GroupAuditService::log(
                GroupAuditService::ACTION_TEAM_TASK_DELETED,
                $groupId,
                $userId,
                [
                    'task_id' => $taskId,
                    'title' => (string) $task->title,
                    'target_user_id' => (int) ($task->created_by ?? 0),
                    'assigned_to' => (int) ($task->assigned_to ?? 0) ?: null,
                ],
            );

            return true;
        });
    }

    /**
     * Get task statistics for a group.
     */
    public function getStats(int $groupId, ?int $userId = null): array
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        if (!$this->authorizeParent($groupId, $userId, false)) {
            return ['total' => 0, 'todo' => 0, 'in_progress' => 0, 'done' => 0, 'overdue' => 0];
        }

        $counts = DB::table('team_tasks')
            ->where('group_id', $groupId)
            ->where('tenant_id', $tenantId)
            ->selectRaw("
                COUNT(*) as total,
                SUM(CASE WHEN status = 'todo' THEN 1 ELSE 0 END) as todo,
                SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
                SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
                SUM(CASE WHEN due_date IS NOT NULL AND due_date < CURDATE() AND status != 'done' THEN 1 ELSE 0 END) as overdue
            ")
            ->first();

        return [
            'total' => (int) ($counts->total ?? 0),
            'todo' => (int) ($counts->todo ?? 0),
            'in_progress' => (int) ($counts->in_progress ?? 0),
            'done' => (int) ($counts->done ?? 0),
            'overdue' => (int) ($counts->overdue ?? 0),
        ];
    }

    private function authorizeParent(int $groupId, ?int $userId, bool $write): bool
    {
        $tenantId = (int) TenantContext::getId();
        if (!DB::table('groups')
            ->where('id', $groupId)
            ->where('tenant_id', $tenantId)
            ->exists()) {
            $this->errors[] = [
                'code' => 'RESOURCE_NOT_FOUND',
                'message' => __('api.group_not_found'),
            ];
            return false;
        }

        $allowed = $userId !== null && ($write
            ? GroupAccessService::canWriteContent($groupId, $userId)
            : GroupAccessService::canViewMemberContent($groupId, $userId));
        if (!$allowed) {
            $this->errors[] = [
                'code' => 'FORBIDDEN',
                'message' => $write
                    ? __('api.group_member_required_post')
                    : __('api.group_member_required_view_discussions'),
            ];
            return false;
        }

        return true;
    }

    /**
     * Resolve an optional assignee while ensuring the target participates in
     * this exact tenant/group. False signals a validation failure.
     */
    private function resolveAssignee(int $groupId, array $data): int|null|false
    {
        if (!array_key_exists('assigned_to', $data) || $data['assigned_to'] === null || $data['assigned_to'] === '') {
            return null;
        }

        $value = $data['assigned_to'];
        $assigneeId = is_int($value)
            ? $value
            : (is_string($value) && ctype_digit($value) ? (int) $value : 0);
        if ($assigneeId <= 0 || !$this->isAssignableGroupMember($groupId, $assigneeId)) {
            $this->errors[] = [
                'code' => 'VALIDATION_ERROR',
                'message' => __('validation.exists', ['attribute' => 'assigned_to']),
                'field' => 'assigned_to',
            ];
            return false;
        }

        return $assigneeId;
    }

    private function isAssignableGroupMember(int $groupId, int $userId): bool
    {
        $tenantId = (int) TenantContext::getId();
        $isTenantUser = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->exists();
        if (!$isTenantUser) {
            return false;
        }

        $isOwner = DB::table('groups')
            ->where('id', $groupId)
            ->where('tenant_id', $tenantId)
            ->where('owner_id', $userId)
            ->exists();

        return $isOwner || DB::table('group_members')
            ->where('tenant_id', $tenantId)
            ->where('group_id', $groupId)
            ->where('user_id', $userId)
            ->where('status', 'active')
            ->exists();
    }

    /** @return array{can_write: bool, is_manager: bool} */
    private function taskCapabilityContext(int $groupId, int $viewerId): array
    {
        $canWrite = $groupId > 0 && GroupAccessService::canWriteContent($groupId, $viewerId);

        return [
            'can_write' => $canWrite,
            'is_manager' => $canWrite && GroupAccessService::canManage($groupId, $viewerId),
        ];
    }

    /**
     * @param array<int, object> $tasks
     * @return array<int, array{id: int, name: string, avatar_url: string|null}>
     */
    private function loadAssignees(array $tasks, int $tenantId): array
    {
        $assigneeIds = array_values(array_unique(array_filter(array_map(
            static fn (object $task): int => (int) ($task->assigned_to ?? 0),
            $tasks,
        ))));
        if ($assigneeIds === []) {
            return [];
        }

        $users = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->whereIn('id', $assigneeIds)
            ->get(['id', 'name', 'first_name', 'last_name', 'profile_type', 'organization_name', 'avatar_url']);

        $result = [];
        foreach ($users as $user) {
            $result[(int) $user->id] = [
                'id' => (int) $user->id,
                'name' => UserDisplayName::resolve($user),
                'avatar_url' => $user->avatar_url !== null ? (string) $user->avatar_url : null,
            ];
        }

        return $result;
    }

    /**
     * @param array{can_write: bool, is_manager: bool} $context
     * @param array{id: int, name: string, avatar_url: string|null}|null $assignee
     * @return array<string, mixed>
     */
    private function presentTask(
        object|array $task,
        int $viewerId,
        array $context,
        ?array $assignee,
    ): array
    {
        $data = (array) $task;
        $isManager = $context['is_manager'];
        $isCreator = $context['can_write'] && (int) ($data['created_by'] ?? 0) === $viewerId;
        $isAssignee = $context['can_write'] && (int) ($data['assigned_to'] ?? 0) === $viewerId;

        $data['can_update_status'] = $isAssignee || $isCreator || $isManager;
        $data['can_edit'] = $isCreator || $isManager;
        $data['can_delete'] = $isCreator || $isManager;
        $data['assignee'] = $assignee;

        return $data;
    }

    private function forbid(): false
    {
        $this->errors[] = [
            'code' => 'FORBIDDEN',
            'message' => __('api.forbidden'),
        ];

        return false;
    }
}
