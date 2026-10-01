<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Enums\GroupStatus;
use App\Exceptions\SafeguardingPolicyException;
use App\Services\GeocodingService;
use App\Services\GroupPolicyRepository;
use App\Services\GroupService;
use App\Services\GroupApprovalWorkflowService;
use App\Services\GroupLifecycleService;
use App\Services\SmartGroupRankingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\ActivityLog;
use App\Models\Group;
use App\Models\Notification;

/**
 * AdminGroupsController -- Admin group management (list, analytics, approvals, moderation,
 * group types, policies, members, geocoding, recommendations, featured).
 *
 * All methods require admin authentication.
 */
class AdminGroupsController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly GroupService $groupService,
        private readonly GeocodingService $geocodingService,
        private readonly GroupPolicyRepository $groupPolicyRepository,
        private readonly SmartGroupRankingService $smartGroupRankingService,
    ) {}

    // =========================================================================
    // Groups List & Detail
    // =========================================================================

    /** GET /api/v2/admin/groups */
    public function index(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $page = $this->queryInt('page', 1, 1);
        $limit = $this->queryInt('limit', 20, 1, 100);
        $offset = ($page - 1) * $limit;
        $status = $this->query('status');
        $search = $this->query('search');

        $conditions = ['g.tenant_id = ?'];
        $params = [$tenantId];

        if ($status === 'inactive') {
            $status = GroupStatus::Archived->value;
        }
        if (is_string($status) && in_array($status, GroupStatus::values(), true)) {
            $conditions[] = 'g.status = ?';
            $params[] = $status;
        }

        if ($search) {
            $conditions[] = '(g.name LIKE ? OR g.description LIKE ?)';
            $searchTerm = '%' . $search . '%';
            $params[] = $searchTerm;
            $params[] = $searchTerm;
        }

        $where = implode(' AND ', $conditions);

        try {
            $total = (int) DB::selectOne("SELECT COUNT(*) as cnt FROM `groups` g WHERE {$where}", $params)->cnt;

            $items = DB::select(
                "SELECT g.*, CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as creator_name,
                    t.name as tenant_name,
                    (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id AND gm.status = 'active') as member_count
                 FROM `groups` g
                 LEFT JOIN users u ON g.owner_id = u.id
                 LEFT JOIN tenants t ON g.tenant_id = t.id
                 WHERE {$where}
                 ORDER BY g.created_at DESC
                 LIMIT ? OFFSET ?",
                array_merge($params, [$limit, $offset])
            );

            $formatted = array_map(fn($row) => [
                'id' => (int) $row->id,
                'tenant_id' => (int) $row->tenant_id,
                'tenant_name' => $row->tenant_name ?? 'Unknown',
                'name' => $row->name ?? '',
                'description' => $row->description ?? '',
                'image_url' => $row->image_url ?: null,
                'visibility' => $row->visibility ?? 'public',
                'status' => $row->status ?? GroupStatus::Active->value,
                'creator_name' => trim($row->creator_name ?? ''),
                'member_count' => (int) ($row->member_count ?? 0),
                'created_at' => $row->created_at,
            ], $items);

            return $this->respondWithPaginatedCollection($formatted, $total, $page, $limit);
        } catch (\Exception $e) {
            Log::error(__('api.fetch_failed', ['resource' => 'groups']), ['error' => $e->getMessage()]);
            return $this->respondWithError('GROUPS_QUERY_ERROR', __('api.server_error'), null, 500);
        }
    }

    /** GET /api/v2/admin/groups/{id} (detail with stats) */
    public function getGroup($id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        try {
            $group = $this->groupService->getById((int) $id);

            // TenantScope already limits the query to the current tenant; if null the group
            // simply doesn't exist (or belongs to another tenant).
            if (!$group) {
                return $this->respondWithError('NOT_FOUND', __('api.group_not_found'), null, 404);
            }

            $stats = DB::selectOne(
                "SELECT
                    (SELECT COUNT(*) FROM group_posts gp JOIN group_discussions gd ON gp.discussion_id = gd.id WHERE gd.group_id = ?) as posts_count,
                    (SELECT COUNT(*) FROM events WHERE group_id = ?) as events_count",
                [$id, $id]
            );

            $group['stats'] = [
                'posts_count' => (int) ($stats->posts_count ?? 0),
                'events_count' => (int) ($stats->events_count ?? 0),
                'activity_score' => (int) ($group['member_count'] ?? 0) * 10,
            ];

            $tenant = DB::selectOne("SELECT name FROM tenants WHERE id = ?", [$tenantId]);
            $group['tenant_name'] = $tenant->name ?? 'Unknown';

            return $this->respondWithData($group);
        } catch (\Exception $e) {
            Log::error(__('api.fetch_failed', ['resource' => 'group']), ['error' => $e->getMessage()]);
            return $this->respondWithError('GROUP_DETAIL_ERROR', __('api.server_error'), null, 500);
        }
    }

    /** GET /api/v2/admin/groups/{id} (simple) */
    public function show(int $id): JsonResponse
    {
        return $this->getGroup($id);
    }

    // =========================================================================
    // Analytics
    // =========================================================================

    /** GET /api/v2/admin/groups/analytics */
    public function analytics(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        try {
            $totalGroups = (int) DB::selectOne("SELECT COUNT(*) as cnt FROM `groups` WHERE tenant_id = ?", [$tenantId])->cnt;
            $totalMembers = (int) DB::selectOne(
                "SELECT COUNT(*) as cnt FROM group_members gm JOIN `groups` g ON gm.group_id = g.id WHERE g.tenant_id = ? AND gm.status = 'active'",
                [$tenantId]
            )->cnt;
            $avgMembers = $totalGroups > 0 ? round($totalMembers / $totalGroups, 1) : 0;
            $activeGroups = (int) DB::selectOne(
                "SELECT COUNT(*) as cnt FROM `groups` WHERE tenant_id = ? AND status = ?",
                [$tenantId, GroupStatus::Active->value],
            )->cnt;
            $pendingApprovals = (int) DB::selectOne(
                "SELECT COUNT(*) as cnt FROM group_members gm JOIN `groups` g ON gm.group_id = g.id WHERE g.tenant_id = ? AND gm.status = 'pending'",
                [$tenantId]
            )->cnt;

            $mostActive = DB::select(
                "SELECT g.id, g.name,
                    (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id AND gm.status = 'active') as member_count
                 FROM `groups` g WHERE g.tenant_id = ? ORDER BY member_count DESC LIMIT 5",
                [$tenantId]
            );

            return $this->respondWithData([
                'total_groups' => $totalGroups,
                'total_members' => $totalMembers,
                'avg_members_per_group' => $avgMembers,
                'active_groups' => $activeGroups,
                'pending_approvals' => $pendingApprovals,
                'most_active_groups' => array_map(fn($r) => [
                    'id' => (int) $r->id, 'name' => $r->name, 'member_count' => (int) $r->member_count,
                ], $mostActive),
            ]);
        } catch (\Exception $e) {
            return $this->respondWithError('GROUPS_ANALYTICS_ERROR', __('api.server_error'), null, 500);
        }
    }

    // =========================================================================
    // Approvals
    // =========================================================================

    /** GET /api/v2/admin/groups/approvals */
    public function approvals(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        try {
            $items = DB::select(
                "SELECT gm.*, g.name as group_name, t.name as tenant_name, g.tenant_id,
                    CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as user_name
                 FROM group_members gm
                 JOIN `groups` g ON gm.group_id = g.id
                 JOIN users u ON gm.user_id = u.id
                 LEFT JOIN tenants t ON g.tenant_id = t.id
                 WHERE gm.status = 'pending' AND g.tenant_id = ?
                 ORDER BY gm.created_at DESC",
                [$tenantId]
            );

            $formatted = array_map(fn($row) => [
                'id' => (int) $row->id,
                'group_id' => (int) $row->group_id,
                'group_name' => $row->group_name ?? '',
                'tenant_id' => (int) $row->tenant_id,
                'tenant_name' => $row->tenant_name ?? 'Unknown',
                'user_id' => (int) $row->user_id,
                'user_name' => trim($row->user_name ?? ''),
                'status' => $row->status ?? 'pending',
                'created_at' => $row->created_at ?? null,
            ], $items);

            return $this->respondWithData($formatted);
        } catch (\Exception $e) {
            return $this->respondWithError('GROUPS_APPROVALS_ERROR', __('api.server_error'), null, 500);
        }
    }

    /** POST /api/v2/admin/groups/approvals/{id}/approve */
    public function approveMember($id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        try {
            $membership = DB::selectOne(
                "SELECT gm.*, g.name as group_name, g.tenant_id
                 FROM group_members gm JOIN `groups` g ON gm.group_id = g.id
                 WHERE gm.id = ? AND g.tenant_id = ? AND gm.status = 'pending'",
                [(int) $id, $tenantId]
            );

            if (!$membership) {
                return $this->respondWithError('NOT_FOUND', __('api.pending_request_not_found'), null, 404);
            }

            if (! GroupService::handleJoinRequest(
                (int) $membership->group_id,
                (int) $membership->user_id,
                $adminId,
                'accept',
            )) {
                return $this->groupServiceMutationError('GROUPS_APPROVE_ERROR');
            }

            // Notify the member they've been approved (unless admin is the
            // member), rendered in the member's preferred language.
            try {
                if ((int) $membership->user_id !== $adminId) {
                    $recipient = DB::table('users')
                        ->where('id', (int) $membership->user_id)
                        ->where('tenant_id', $tenantId)
                        ->select(['preferred_language'])
                        ->first();

                    LocaleContext::withLocale($recipient, function () use ($membership, $tenantId) {
                        $msg = __('api_controllers_3.admin_bells.group_member_approved', ['group' => $membership->group_name]);
                        Notification::createNotification(
                            (int) $membership->user_id,
                            $msg,
                            "/groups/{$membership->group_id}",
                            'info',
                            false,
                            $tenantId
                        );
                        \App\Services\NotificationDispatcher::fanOutPush((int) ($membership->user_id), 'info', $msg, "/groups/{$membership->group_id}");
                    });
                }
            } catch (\Throwable $e) {
                Log::warning('Failed to send group member approval notification', [
                    'membership_id' => $id,
                    'user_id' => $membership->user_id,
                    'error' => $e->getMessage(),
                ]);
            }

            return $this->respondWithData(['id' => (int) $id, 'status' => 'active']);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        } catch (\Exception $e) {
            return $this->respondWithError('GROUPS_APPROVE_ERROR', __('api.server_error'), null, 500);
        }
    }

    /** POST /api/v2/admin/groups/approvals/{id}/reject */
    public function rejectMember($id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        try {
            $membership = DB::selectOne(
                "SELECT gm.*, g.name as group_name, g.tenant_id
                 FROM group_members gm JOIN `groups` g ON gm.group_id = g.id
                 WHERE gm.id = ? AND g.tenant_id = ? AND gm.status = 'pending'",
                [(int) $id, $tenantId]
            );

            if (!$membership) {
                return $this->respondWithError('NOT_FOUND', __('api.pending_request_not_found'), null, 404);
            }

            if (! GroupService::handleJoinRequest(
                (int) $membership->group_id,
                (int) $membership->user_id,
                $adminId,
                'reject',
            )) {
                return $this->groupServiceMutationError('GROUPS_REJECT_ERROR');
            }

            // Notify the member their request was declined (unless admin is the
            // member), rendered in the member's preferred language.
            try {
                if ((int) $membership->user_id !== $adminId) {
                    $recipient = DB::table('users')
                        ->where('id', (int) $membership->user_id)
                        ->where('tenant_id', $tenantId)
                        ->select(['preferred_language'])
                        ->first();

                    LocaleContext::withLocale($recipient, function () use ($membership, $tenantId) {
                        $msg = __('api_controllers_3.admin_bells.group_member_rejected', ['group' => $membership->group_name]);
                        Notification::createNotification(
                            (int) $membership->user_id,
                            $msg,
                            null,
                            'info',
                            false,
                            $tenantId
                        );
                        \App\Services\NotificationDispatcher::fanOutPush((int) ($membership->user_id), 'info', $msg, null);
                    });
                }
            } catch (\Throwable $e) {
                Log::warning('Failed to send group member rejection notification', [
                    'membership_id' => $id,
                    'user_id' => $membership->user_id,
                    'error' => $e->getMessage(),
                ]);
            }

            return $this->respondWithData(['id' => (int) $id, 'status' => 'rejected']);
        } catch (\Exception $e) {
            return $this->respondWithError('GROUPS_REJECT_ERROR', __('api.server_error'), null, 500);
        }
    }

    /** POST /api/v2/admin/groups/{id}/approve */
    public function approve(int $id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $group = DB::selectOne(
            "SELECT id, name, owner_id FROM `groups` WHERE id = ? AND tenant_id = ?",
            [$id, $tenantId]
        );

        if (!$group) {
            return $this->respondWithError('NOT_FOUND', __('api.group_not_found'), null, 404);
        }

        $requestId = DB::table('group_approval_requests')
            ->where('tenant_id', $tenantId)
            ->where('group_id', $id)
            ->where('status', GroupApprovalWorkflowService::STATUS_PENDING)
            ->value('id');
        if ($requestId === null || ! GroupApprovalWorkflowService::approveGroup(
            (int) $requestId,
            $adminId,
        )) {
            return $this->respondWithError('INVALID_STATE', __('api.invalid_status'), null, 409);
        }

        // Notify the group owner (unless the admin is the owner), rendered in
        // the owner's preferred language.
        try {
            if ($group->owner_id && (int) $group->owner_id !== $adminId) {
                $recipient = DB::table('users')
                    ->where('id', (int) $group->owner_id)
                    ->where('tenant_id', $tenantId)
                    ->select(['preferred_language'])
                    ->first();

                LocaleContext::withLocale($recipient, function () use ($group, $id, $tenantId) {
                    $msg = __('api_controllers_3.admin_bells.group_approved');
                    Notification::createNotification(
                        (int) $group->owner_id,
                        $msg,
                        "/groups/{$id}",
                        'info',
                        false,
                        $tenantId
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) ($group->owner_id), 'info', $msg, "/groups/{$id}");
                });
            }
        } catch (\Throwable $e) {
            Log::warning('Failed to send group approval notification', [
                'group_id' => $id,
                'owner_id' => $group->owner_id,
                'error' => $e->getMessage(),
            ]);
        }

        return $this->respondWithData(['id' => $id, 'status' => 'active']);
    }

    // =========================================================================
    // Moderation
    // =========================================================================

    /** GET /api/v2/admin/groups/moderation */
    public function moderation(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        try {
            $items = [];
            try {
                $items = DB::select(
                    "SELECT g.id, g.name, g.status, g.created_at, g.tenant_id, t.name as tenant_name,
                        COUNT(r.id) as report_count
                     FROM `groups` g
                     INNER JOIN reports r ON r.content_type = 'group' AND r.content_id = g.id
                     LEFT JOIN tenants t ON g.tenant_id = t.id
                     WHERE g.tenant_id = ? AND r.status = 'pending'
                     GROUP BY g.id, g.name, g.status, g.created_at, g.tenant_id, t.name
                     ORDER BY report_count DESC",
                    [$tenantId]
                );
            } catch (\Exception $e) {
                $items = DB::select(
                    "SELECT g.id, g.name, g.status, g.created_at, g.tenant_id, t.name as tenant_name, 0 as report_count
                     FROM `groups` g LEFT JOIN tenants t ON g.tenant_id = t.id
                     WHERE g.tenant_id = ? AND g.status = ? ORDER BY g.created_at DESC",
                    [$tenantId, GroupStatus::Archived->value]
                );
            }

            $formatted = array_map(fn($row) => [
                'id' => (int) $row->id,
                'name' => $row->name ?? '',
                'tenant_id' => (int) $row->tenant_id,
                'tenant_name' => $row->tenant_name ?? 'Unknown',
                'status' => $row->status ?? GroupStatus::Active->value,
                'report_count' => (int) ($row->report_count ?? 0),
                'created_at' => $row->created_at,
            ], $items);

            return $this->respondWithData($formatted);
        } catch (\Exception $e) {
            return $this->respondWithError('GROUPS_MODERATION_ERROR', __('api.server_error'), null, 500);
        }
    }

    // =========================================================================
    // Status & CRUD
    // =========================================================================

    /** PUT /api/v2/admin/groups/{id}/status */
    public function updateStatus($id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $newStatus = (string) $this->input('status');
        if ($newStatus === 'inactive') {
            $newStatus = GroupStatus::Archived->value;
        }

        if (! in_array($newStatus, GroupStatus::values(), true)) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.invalid_status'),
                'status',
                422,
            );
        }

        $group = DB::selectOne("SELECT id, name, tenant_id FROM `groups` WHERE id = ? AND tenant_id = ?", [(int) $id, $tenantId]);
        if (!$group) {
            return $this->respondWithError('NOT_FOUND', __('api.group_not_found'), null, 404);
        }

        if (! GroupLifecycleService::transition((int) $id, $newStatus, $adminId, 'Admin status update')) {
            return $this->respondWithError('INVALID_STATE', __('api.invalid_status'), 'status', 409);
        }
        ActivityLog::log($adminId, 'admin_update_group_status', "Set group #{$id} \"{$group->name}\" to {$newStatus}");

        return $this->respondWithData(['id' => (int) $id, 'status' => $newStatus]);
    }

    /** PUT /api/v2/admin/groups/{id} */
    public function updateGroup($id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $input = $this->getAllInput();

        $group = DB::selectOne("SELECT id, name, tenant_id FROM `groups` WHERE id = ? AND tenant_id = ?", [(int) $id, $tenantId]);
        if (!$group) {
            return $this->respondWithError('NOT_FOUND', __('api.group_not_found'), null, 404);
        }

        $allowed = [
            'name', 'description', 'visibility', 'location', 'latitude', 'longitude',
            'type_id', 'parent_id', 'federated_visibility', 'primary_color', 'accent_color',
        ];
        $unsupported = array_values(array_diff(array_keys($input), $allowed));
        if ($unsupported !== []) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.invalid_input'),
                (string) $unsupported[0],
                422,
            );
        }

        if ($input === []) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.no_fields_to_update'), null, 422);
        }

        if (! $this->groupService->update((int) $id, $adminId, $input)) {
            $errors = $this->groupService->getErrors();
            $status = match ($errors[0]['code'] ?? '') {
                'NOT_FOUND' => 404,
                'FORBIDDEN' => 403,
                default => 422,
            };

            return $this->respondWithErrors($errors, $status);
        }

        ActivityLog::log($adminId, 'admin_update_group', "Updated group #{$id}: {$group->name}");

        return $this->respondWithData(['id' => (int) $id, 'updated' => true]);
    }

    /** DELETE /api/v2/admin/groups/{id} */
    public function destroy(int $id): JsonResponse
    {
        return $this->deleteGroup($id);
    }

    /** DELETE /api/v2/admin/groups/{id} (named) */
    public function deleteGroup($id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $group = DB::selectOne("SELECT id, name, tenant_id FROM `groups` WHERE id = ? AND tenant_id = ?", [(int) $id, $tenantId]);
        if (!$group) {
            return $this->respondWithError('NOT_FOUND', __('api.group_not_found'), null, 404);
        }

        if (!$this->groupService->delete((int) $id, $adminId)) {
            $errors = $this->groupService->getErrors();
            $status = match ($errors[0]['code'] ?? '') {
                'NOT_FOUND' => 404,
                'FORBIDDEN' => 403,
                default => 400,
            };
            return $this->respondWithErrors($errors, $status);
        }
        return $this->respondWithData(['deleted' => true, 'id' => (int) $id]);
    }

    // =========================================================================
    // Group Types
    // =========================================================================

    /** GET /api/v2/admin/groups/types */
    public function getGroupTypes(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        try {
            $types = DB::select(
                "SELECT gt.*, t.name as tenant_name,
                    (SELECT COUNT(*) FROM `groups` g WHERE g.type_id = gt.id AND g.tenant_id = ?) as member_count
                 FROM group_types gt
                 LEFT JOIN tenants t ON gt.tenant_id = t.id
                 WHERE gt.tenant_id = ?
                 ORDER BY gt.sort_order ASC, gt.name ASC",
                [$tenantId, $tenantId]
            );

            $formatted = array_map(function ($row) use ($tenantId) {
                $policyCount = 0;
                try {
                    $policyCount = (int) (DB::selectOne("SELECT COUNT(*) as cnt FROM group_policies WHERE tenant_id = ?", [$tenantId])->cnt ?? 0);
                } catch (\Throwable $e) { Log::warning('Stats query failed in ' . __METHOD__, ['error' => $e->getMessage()]); }

                return [
                    'id' => (int) $row->id,
                    'tenant_id' => (int) $row->tenant_id,
                    'tenant_name' => $row->tenant_name ?? 'Unknown',
                    'name' => $row->name,
                    'description' => $row->description ?? '',
                    'icon' => $row->icon ?? 'fa-layer-group',
                    'color' => $row->color ?? '#6366f1',
                    'member_count' => (int) $row->member_count,
                    'policy_count' => $policyCount,
                    'created_at' => $row->created_at,
                ];
            }, $types);

            return $this->respondWithData($formatted);
        } catch (\Throwable $e) {
            return $this->respondWithError('GROUP_TYPES_ERROR', __('api.server_error'), null, 500);
        }
    }

    /** POST /api/v2/admin/groups/types */
    public function createGroupType(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $name = trim($this->input('name', ''));

        if (empty($name)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.name_required'), 'name', 422);
        }

        try {
            DB::insert(
                "INSERT INTO group_types (tenant_id, name, slug, description, icon, color, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, NOW())",
                [$tenantId, $name, \Illuminate\Support\Str::slug($name), $this->input('description'), $this->input('icon', 'fa-layer-group'), $this->input('color', '#6366f1')]
            );
            $id = DB::getPdo()->lastInsertId();
            ActivityLog::log(
                $adminId,
                'admin_create_group_type',
                "Created group type #{$id}: {$name}",
                false,
                null,
                'admin',
                'group_type',
                (int) $id,
            );
            return $this->respondWithData(['id' => $id, 'name' => $name]);
        } catch (\Throwable $e) {
            return $this->respondWithError('GROUP_TYPE_CREATE_ERROR', __('api.server_error'), null, 500);
        }
    }

    /** PUT /api/v2/admin/groups/types/{id} */
    public function updateGroupType($id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $id = (int) $id;

        try {
            $existing = DB::selectOne("SELECT id, name, tenant_id FROM group_types WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
            if (!$existing) {
                return $this->respondWithError('NOT_FOUND', __('api.group_type_invalid'), null, 404);
            }

            $name = trim($this->input('name', $existing->name));
            DB::update(
                "UPDATE group_types SET name = ?, description = ?, icon = ?, color = ?, updated_at = NOW() WHERE id = ? AND tenant_id = ?",
                [$name, $this->input('description'), $this->input('icon', 'fa-layer-group'), $this->input('color', '#6366f1'), $id, $tenantId]
            );
            ActivityLog::log(
                $adminId,
                'admin_update_group_type',
                "Updated group type #{$id}: {$name}",
                false,
                null,
                'admin',
                'group_type',
                $id,
            );
            return $this->respondWithData(['id' => $id, 'name' => $name]);
        } catch (\Throwable $e) {
            return $this->respondWithError('GROUP_TYPE_UPDATE_ERROR', __('api.server_error'), null, 500);
        }
    }

    /** DELETE /api/v2/admin/groups/types/{id} */
    public function deleteGroupType($id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $id = (int) $id;

        try {
            $type = DB::selectOne("SELECT id, name FROM group_types WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
            if (!$type) {
                return $this->respondWithError('NOT_FOUND', __('api.group_type_invalid'), null, 404);
            }

            $count = (int) (DB::selectOne("SELECT COUNT(*) as cnt FROM `groups` WHERE type_id = ? AND tenant_id = ?", [$id, $tenantId])->cnt ?? 0);
            if ($count > 0) {
                return $this->respondWithError('GROUP_TYPE_IN_USE', __('api.group_type_in_use', ['count' => $count]), null, 422);
            }

            DB::delete("DELETE FROM group_types WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
            ActivityLog::log(
                $adminId,
                'admin_delete_group_type',
                "Deleted group type #{$id}: {$type->name}",
                false,
                null,
                'admin',
                'group_type',
                $id,
            );
            return $this->respondWithData(['deleted' => true, 'id' => $id]);
        } catch (\Throwable $e) {
            return $this->respondWithError('GROUP_TYPE_DELETE_ERROR', __('api.server_error'), null, 500);
        }
    }

    // =========================================================================
    // Policies
    // =========================================================================

    /** GET /api/v2/admin/groups/types/{id}/policies */
    public function getPolicies($id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        try {
            $policies = $this->groupPolicyRepository->getAllPolicies($tenantId);
            $formatted = [];
            foreach ($policies as $category => $categoryPolicies) {
                foreach ($categoryPolicies as $key => $policy) {
                    $formatted[] = [
                        'category' => $category,
                        'key' => $key,
                        'value' => $policy['value'],
                        'type' => $policy['type'],
                        'label' => ucwords(str_replace('_', ' ', $key)),
                        'description' => $policy['description'],
                    ];
                }
            }
            return $this->respondWithData($formatted);
        } catch (\Throwable $e) {
            return $this->respondWithError('POLICIES_ERROR', __('api.server_error'), null, 500);
        }
    }

    /** PUT /api/v2/admin/groups/types/{id}/policies */
    public function setPolicy($id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $key = $this->input('key');
        $value = $this->input('value');

        if (empty($key)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.policy_key_required'), 'key', 422);
        }

        try {
            $category = $this->input('category', GroupPolicyRepository::CATEGORY_FEATURES);
            $type = $this->input('type', GroupPolicyRepository::TYPE_STRING);
            DB::transaction(function () use ($adminId, $tenantId, $key, $value, $category, $type): void {
                $this->groupPolicyRepository->setPolicy(
                    $key,
                    $value,
                    $category,
                    $type,
                    $this->input('description'),
                    $tenantId,
                );
                ActivityLog::log(
                    $adminId,
                    'admin_set_group_policy',
                    "Set group policy {$key} ({$category}/{$type})",
                    false,
                    null,
                    'admin',
                    'group_policy',
                );
            });
            return $this->respondWithData(['key' => $key, 'value' => $value]);
        } catch (\Throwable $e) {
            return $this->respondWithError('POLICY_SET_ERROR', __('api.server_error'), null, 500);
        }
    }

    // =========================================================================
    // Members
    // =========================================================================

    /** GET /api/v2/admin/groups/{groupId}/members */
    public function getMembers($groupId): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $role = $this->query('role');
        $limit = $this->queryInt('limit', 20, 1, 100);
        $offset = $this->queryInt('offset', 0, 0);

        try {
            $conditions = ['gm.group_id = ?', 'g.tenant_id = ?'];
            $params = [(int) $groupId, $tenantId];

            if ($role) {
                $conditions[] = 'gm.role = ?';
                $params[] = $role;
            }

            $where = implode(' AND ', $conditions);

            $members = DB::select(
                "SELECT gm.user_id, gm.role, gm.joined_at,
                    CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as user_name,
                    u.avatar_url as user_avatar
                 FROM group_members gm
                 JOIN `groups` g ON gm.group_id = g.id
                 JOIN users u ON gm.user_id = u.id
                 WHERE {$where}
                 ORDER BY FIELD(gm.role, 'owner', 'admin', 'member'), gm.joined_at ASC
                 LIMIT ? OFFSET ?",
                array_merge($params, [$limit, $offset])
            );

            $formatted = array_map(fn($row) => [
                'user_id' => (int) $row->user_id,
                'user_name' => trim($row->user_name),
                'user_avatar' => $row->user_avatar,
                'role' => $row->role,
                'joined_at' => $row->joined_at,
            ], $members);

            return $this->respondWithData($formatted);
        } catch (\Exception $e) {
            return $this->respondWithError('GROUP_MEMBERS_ERROR', __('api.server_error'), null, 500);
        }
    }

    /** POST /api/v2/admin/groups/{groupId}/members/{userId}/promote */
    public function promoteMember($groupId, $userId): JsonResponse
    {
        $adminId = $this->requireAdmin();

        try {
            if (! GroupService::updateMemberRole((int) $groupId, (int) $userId, $adminId, 'admin')) {
                return $this->groupServiceMutationError('PROMOTE_ERROR');
            }

            return $this->respondWithData(['role' => 'admin']);
        } catch (\Exception $e) {
            return $this->respondWithError('PROMOTE_ERROR', __('api.server_error'), null, 500);
        }
    }

    /** POST /api/v2/admin/groups/{groupId}/members/{userId}/demote */
    public function demoteMember($groupId, $userId): JsonResponse
    {
        $adminId = $this->requireAdmin();

        try {
            if (! GroupService::updateMemberRole((int) $groupId, (int) $userId, $adminId, 'member')) {
                return $this->groupServiceMutationError('DEMOTE_ERROR');
            }

            return $this->respondWithData(['role' => 'member']);
        } catch (\Exception $e) {
            return $this->respondWithError('DEMOTE_ERROR', __('api.server_error'), null, 500);
        }
    }

    /** DELETE /api/v2/admin/groups/{groupId}/members/{userId} */
    public function kickMember($groupId, $userId): JsonResponse
    {
        $adminId = $this->requireAdmin();

        try {
            if (! GroupService::removeMember((int) $groupId, (int) $userId, $adminId)) {
                return $this->groupServiceMutationError('KICK_ERROR');
            }

            return $this->respondWithData(['kicked' => true]);
        } catch (\Exception $e) {
            return $this->respondWithError('KICK_ERROR', __('api.server_error'), null, 500);
        }
    }

    // =========================================================================
    // Geocoding
    // =========================================================================

    /** POST /api/v2/admin/groups/{id}/geocode */
    public function geocodeGroup($id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $id = (int) $id;

        try {
            $group = DB::selectOne("SELECT id, name, location, tenant_id FROM `groups` WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
            if (!$group) {
                return $this->respondWithError('NOT_FOUND', __('api.group_not_found'), null, 404);
            }
            if (empty($group->location)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.group_no_location'), null, 422);
            }

            $coords = $this->geocodingService->geocode($group->location);
            if (!$coords) {
                return $this->respondWithError('GEOCODING_FAILED', __('api.geocoding_failed'), null, 500);
            }

            DB::update("UPDATE `groups` SET latitude = ?, longitude = ? WHERE id = ? AND tenant_id = ?", [$coords['latitude'], $coords['longitude'], $id, $tenantId]);
            ActivityLog::log($adminId, 'admin_geocode_group', "Geocoded group #{$id}: {$group->name}");
            return $this->respondWithData(['latitude' => $coords['latitude'], 'longitude' => $coords['longitude']]);
        } catch (\Throwable $e) {
            return $this->respondWithError('GEOCODE_ERROR', __('api.server_error'), null, 500);
        }
    }

    /** POST /api/v2/admin/groups/batch-geocode */
    public function batchGeocode(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        try {
            $groups = DB::select(
                "SELECT id, location FROM `groups` WHERE tenant_id = ? AND location IS NOT NULL AND location != '' AND (latitude IS NULL OR longitude IS NULL) LIMIT 50",
                [$tenantId]
            );

            $success = 0;
            $failed = 0;

            foreach ($groups as $group) {
                $coords = $this->geocodingService->geocode($group->location);
                if ($coords) {
                    DB::update("UPDATE `groups` SET latitude = ?, longitude = ? WHERE id = ? AND tenant_id = ?", [$coords['latitude'], $coords['longitude'], $group->id, $tenantId]);
                    $success++;
                } else {
                    $failed++;
                }
                usleep(100000);
            }

            ActivityLog::log($adminId, 'admin_batch_geocode_groups', "Batch geocoded {$success} groups, {$failed} failed");
            return $this->respondWithData(['processed' => count($groups), 'success' => $success, 'failed' => $failed]);
        } catch (\Throwable $e) {
            return $this->respondWithError('BATCH_GEOCODE_ERROR', __('api.server_error'), null, 500);
        }
    }

    // =========================================================================
    // Recommendations & Featured
    // =========================================================================

    /** GET /api/v2/admin/groups/recommendations */
    public function getRecommendationData(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $limit = min(100, max(1, $this->queryInt('limit', 20)));
        $offset = $this->queryInt('offset', 0, 0);

        // Source is group_match_cache, written by GroupMatchingService::warmUpCache()
        // and served to members through /v2/matches/all. Until 2026-10-01 this read a
        // `group_recommendations` table that has never existed; a swallowed catch
        // turned that into a permanent "0 recommendations" page. match_score is
        // stored 0–100; this endpoint reports scores as 0–1 ratios.
        // "Joined" = the member recorded a join, or now holds an active membership.
        $joinedExpr = "(gmc.status = 'joined' OR EXISTS (
                SELECT 1 FROM group_members gm
                WHERE gm.user_id = gmc.user_id AND gm.group_id = gmc.group_id
                  AND gm.tenant_id = gmc.tenant_id AND gm.status = 'active'
            ))";

        try {
            $recommendations = array_map(fn($r) => (array) $r, DB::select(
                "SELECT gmc.user_id, gmc.group_id, gmc.match_score, gmc.status, gmc.created_at, gmc.tenant_id,
                    CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as user_name,
                    g.name as group_name, t.name as tenant_name,
                    {$joinedExpr} as joined
                 FROM group_match_cache gmc
                 JOIN users u ON u.id = gmc.user_id AND u.tenant_id = gmc.tenant_id
                 JOIN `groups` g ON g.id = gmc.group_id AND g.tenant_id = gmc.tenant_id
                 LEFT JOIN tenants t ON t.id = gmc.tenant_id
                 WHERE gmc.tenant_id = ?
                 ORDER BY gmc.created_at DESC, gmc.id DESC LIMIT ? OFFSET ?",
                [$tenantId, $limit, $offset]
            ));

            $statsRow = (array) DB::selectOne(
                "SELECT COUNT(*) as total, AVG(gmc.match_score) as avg_score,
                    COALESCE(SUM(CASE WHEN {$joinedExpr} THEN 1 ELSE 0 END), 0) as joined_count
                 FROM group_match_cache gmc
                 JOIN users u ON u.id = gmc.user_id AND u.tenant_id = gmc.tenant_id
                 JOIN `groups` g ON g.id = gmc.group_id AND g.tenant_id = gmc.tenant_id
                 WHERE gmc.tenant_id = ?",
                [$tenantId]
            );
        } catch (\Throwable $e) {
            Log::error('[AdminGroupsController] getRecommendationData failed', [
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);
            return $this->respondWithError('RECOMMENDATIONS_ERROR', __('api.server_error'), null, 500);
        }

        $formatted = array_map(fn($row) => [
            'user_id' => (int) $row['user_id'], 'user_name' => trim((string) $row['user_name']),
            'group_id' => (int) $row['group_id'], 'group_name' => $row['group_name'],
            'tenant_id' => (int) $row['tenant_id'], 'tenant_name' => $row['tenant_name'] ?? 'Unknown',
            'score' => round((float) $row['match_score'] / 100, 4), 'joined' => (bool) $row['joined'],
            'status' => (string) $row['status'], 'created_at' => $row['created_at'],
        ], $recommendations);

        $total = (int) ($statsRow['total'] ?? 0);
        $joinRate = $total > 0 ? round(((int) $statsRow['joined_count'] / $total) * 100, 1) : 0;

        return $this->respondWithData([
            'recommendations' => $formatted,
            'stats' => [
                'total' => $total,
                'avg_score' => round((float) ($statsRow['avg_score'] ?? 0) / 100, 2),
                'join_rate' => $joinRate,
            ],
        ]);
    }

    /** GET /api/v2/admin/groups/featured */
    public function getFeaturedGroups(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        try {
            $groups = $this->smartGroupRankingService->getFeaturedGroupsWithScores('local_hubs', $tenantId);
            return $this->respondWithData($groups);
        } catch (\Throwable $e) {
            return $this->respondWithError('FEATURED_GROUPS_ERROR', __('api.server_error'), null, 500);
        }
    }

    /** POST /api/v2/admin/groups/featured/update */
    public function updateFeaturedGroups(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        try {
            $result = $this->smartGroupRankingService->updateFeaturedLocalHubs($tenantId);
            ActivityLog::log($adminId, 'admin_update_featured_groups', "Updated featured groups: {$result['featured']} groups featured, {$result['cleared']} cleared");
            return $this->respondWithData($result);
        } catch (\Throwable $e) {
            return $this->respondWithError('UPDATE_FEATURED_ERROR', __('api.server_error'), null, 500);
        }
    }

    /** PUT /api/v2/admin/groups/{id}/toggle-featured */
    public function toggleFeatured($id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        try {
            $group = DB::selectOne("SELECT id, name, is_featured, tenant_id FROM `groups` WHERE id = ? AND tenant_id = ?", [(int) $id, $tenantId]);
            if (!$group) {
                return $this->respondWithError('NOT_FOUND', __('api.group_not_found'), null, 404);
            }

            $newStatus = $group->is_featured ? 0 : 1;
            DB::update("UPDATE `groups` SET is_featured = ? WHERE id = ? AND tenant_id = ?", [$newStatus, (int) $id, $tenantId]);
            ActivityLog::log($adminId, 'admin_toggle_group_featured', ($newStatus ? 'Featured' : 'Unfeatured') . " group #{$id}: {$group->name}");

            return $this->respondWithData(['is_featured' => (bool) $newStatus]);
        } catch (\Exception $e) {
            return $this->respondWithError('TOGGLE_FEATURED_ERROR', __('api.server_error'), null, 500);
        }
    }

    // =========================================================================
    // Group Analytics (legacy controller delegation)
    // =========================================================================

    /** GET /api/v2/admin/groups/{id}/analytics */
    public function apiData($id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $id = (int) $id;

        try {
            $group = DB::selectOne("SELECT id, name FROM `groups` WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
            if (!$group) {
                return $this->respondWithError('NOT_FOUND', __('api.group_not_found'), null, 404);
            }

            $memberCount = (int) (DB::selectOne("SELECT COUNT(*) as cnt FROM group_members WHERE group_id = ? AND tenant_id = ?", [$id, $tenantId])->cnt ?? 0);
            $postsCount = 0;
            try { $postsCount = (int) (DB::selectOne("SELECT COUNT(*) as cnt FROM group_posts gp JOIN group_discussions gd ON gp.discussion_id = gd.id WHERE gd.group_id = ? AND gd.tenant_id = ?", [$id, $tenantId])->cnt ?? 0); } catch (\Throwable $e) { Log::warning('Stats query failed in ' . __METHOD__, ['error' => $e->getMessage()]); }
            $eventsCount = 0;
            try { $eventsCount = (int) (DB::selectOne("SELECT COUNT(*) as cnt FROM events WHERE group_id = ? AND tenant_id = ?", [$id, $tenantId])->cnt ?? 0); } catch (\Throwable $e) { Log::warning('Stats query failed in ' . __METHOD__, ['error' => $e->getMessage()]); }

            return $this->respondWithData([
                'group_id' => $id,
                'group_name' => $group->name,
                'member_count' => $memberCount,
                'posts_count' => $postsCount,
                'events_count' => $eventsCount,
            ]);
        } catch (\Throwable $e) {
            return $this->respondWithError('ANALYTICS_ERROR', __('api.server_error'), null, 500);
        }
    }

    // =========================================================================
    // Lifecycle & Bulk Operations
    // =========================================================================

    /** POST /api/v2/admin/groups/{id}/archive */
    public function archiveGroup(int $id): JsonResponse
    {
        $this->requireAdmin();
        $userId = $this->requireUserId();
        if ($userId instanceof JsonResponse) return $userId;

        $reason = request()->input('reason', '');
        $success = \App\Services\GroupLifecycleService::archive($id, $userId, $reason);

        return $success
            ? $this->successResponse(['message' => __('api_controllers_1.admin_groups.group_archived')])
            : $this->respondWithError('INVALID_STATE', __('api.invalid_status'), 'status', 409);
    }

    /** POST /api/v2/admin/groups/{id}/unarchive */
    public function unarchiveGroup(int $id): JsonResponse
    {
        $this->requireAdmin();
        $userId = $this->requireUserId();
        if ($userId instanceof JsonResponse) return $userId;

        $success = \App\Services\GroupLifecycleService::unarchive($id, $userId);

        return $success
            ? $this->successResponse(['message' => __('api_controllers_1.admin_groups.group_unarchived')])
            : $this->respondWithError('INVALID_STATE', __('api.invalid_status'), 'status', 409);
    }

    /** POST /api/v2/admin/groups/bulk-archive */
    public function bulkArchive(): JsonResponse
    {
        $this->requireAdmin();
        $userId = $this->requireUserId();
        if ($userId instanceof JsonResponse) return $userId;

        $groupIds = request()->input('group_ids', []);
        if (empty($groupIds) || !is_array($groupIds)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_input'), 'group_ids', 422);
        }

        $affected = \App\Services\GroupLifecycleService::bulkArchive($groupIds, $userId);
        return $this->successResponse(['archived' => $affected]);
    }

    /** POST /api/v2/admin/groups/bulk-unarchive */
    public function bulkUnarchive(): JsonResponse
    {
        $this->requireAdmin();
        $userId = $this->requireUserId();
        if ($userId instanceof JsonResponse) return $userId;

        $groupIds = request()->input('group_ids', []);
        if (empty($groupIds) || !is_array($groupIds)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_input'), 'group_ids', 422);
        }

        $affected = \App\Services\GroupLifecycleService::bulkUnarchive($groupIds, $userId);
        return $this->successResponse(['unarchived' => $affected]);
    }

    /** POST /api/v2/admin/groups/{id}/transfer-ownership */
    public function transferOwnership(int $id): JsonResponse
    {
        $this->requireAdmin();
        $userId = $this->requireUserId();
        if ($userId instanceof JsonResponse) return $userId;

        $newOwnerId = (int) request()->input('new_owner_id');
        if (!$newOwnerId) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_user'), 'new_owner_id', 422);
        }
        if (! Group::query()->whereKey($id)->exists()) {
            return $this->respondWithError('NOT_FOUND', __('api.group_not_found'), null, 404);
        }

        $success = \App\Services\GroupLifecycleService::transferOwnership($id, $newOwnerId, $userId);

        return $success
            ? $this->successResponse(['message' => __('api_controllers_1.admin_groups.ownership_transferred')])
            : $this->respondWithError('VALIDATION_ERROR', __('api.invalid_user'), 'new_owner_id', 422);
    }

    /** POST /api/v2/admin/groups/{id}/merge */
    public function mergeGroup(int $id): JsonResponse
    {
        $this->requireAdmin();
        $userId = $this->requireUserId();
        if ($userId instanceof JsonResponse) return $userId;

        $targetGroupId = (int) request()->input('target_group_id');
        if (!$targetGroupId) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.group_not_found'), 'target_group_id', 422);
        }
        if (! Group::query()->whereKey($id)->exists()) {
            return $this->respondWithError('NOT_FOUND', __('api.group_not_found'), null, 404);
        }

        try {
            $success = \App\Services\GroupLifecycleService::mergeGroups($id, $targetGroupId, $userId);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        return $success
            ? $this->successResponse(['message' => __('api_controllers_1.admin_groups.groups_merged')])
            : $this->respondWithError('INVALID_STATE', __('api.invalid_input'), 'target_group_id', 409);
    }

    /** POST /api/v2/admin/groups/{id}/clone */
    public function cloneGroup(int $id): JsonResponse
    {
        $this->requireAdmin();
        $userId = $this->requireUserId();
        if ($userId instanceof JsonResponse) return $userId;

        $newName = trim((string) request()->input('name', ''));
        if ($newName === '') {
            return $this->respondWithError('VALIDATION_ERROR', __('api.name_required'), 'name', 422);
        }
        if (! Group::query()->whereKey($id)->exists()) {
            return $this->respondWithError('NOT_FOUND', __('api.group_not_found'), null, 404);
        }

        $cloneMembers = (bool) request()->input('clone_members', false);
        try {
            $newGroupId = \App\Services\GroupLifecycleService::cloneGroup($id, $newName, $userId, $cloneMembers);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        return $newGroupId
            ? $this->successResponse(['id' => $newGroupId, 'message' => __('api_controllers_1.admin_groups.group_cloned')])
            : $this->respondWithError('VALIDATION_ERROR', __('api.invalid_input'), 'name', 422);
    }

    /** GET /api/v2/admin/groups/{id}/audit-log */
    public function auditLog(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = (int) TenantContext::getId();

        $groupExists = DB::table('groups')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->exists();
        if (! $groupExists) {
            return $this->respondWithError('NOT_FOUND', __('api.group_not_found'), null, 404);
        }

        try {
            $filters = [
                'page' => $this->queryInt('page', 1, 1),
                'per_page' => $this->queryInt('per_page', 25, 1, 100),
            ];
            $action = $this->query('action');
            if (is_string($action) && trim($action) !== '') {
                $filters['action'] = mb_substr(trim($action), 0, 100);
            }
            $logs = \App\Services\GroupAuditService::getGroupLogPage($id, $filters);
            return $this->successResponse($logs);
        } catch (\Throwable $e) {
            Log::error('Failed to load group audit log', [
                'tenant_id' => $tenantId,
                'group_id' => $id,
                'error' => $e->getMessage(),
            ]);
            return $this->respondWithError('SERVER_ERROR', __('api.server_error'), null, 500);
        }
    }

    // =========================================================================
    // Tags Management
    // =========================================================================

    /** GET /api/v2/admin/group-tags */
    public function listTags(): JsonResponse
    {
        $this->requireAdmin();
        $tags = \App\Services\GroupTagService::getAll([
            'search' => $this->query('q'),
            'limit' => $this->queryInt('limit', 100),
        ]);
        return $this->successResponse($tags);
    }

    /** POST /api/v2/admin/group-tags */
    public function createTag(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $name = request()->input('name');
        if (!$name) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.name_required'), 'name', 422);
        }

        $tag = DB::transaction(function () use ($adminId, $tenantId, $name): ?array {
            $slug = \Illuminate\Support\Str::slug((string) $name);
            $existing = DB::table('group_tags')
                ->where('tenant_id', $tenantId)
                ->where('slug', $slug)
                ->exists();
            $tag = \App\Services\GroupTagService::create((string) $name, request()->input('color'));
            if ($tag !== null && ! $existing) {
                ActivityLog::log(
                    $adminId,
                    'admin_create_group_tag',
                    'Created group tag #' . (int) $tag['id'],
                    false,
                    null,
                    'admin',
                    'group_tag',
                    (int) $tag['id'],
                );
            }

            return $tag;
        });
        return $tag
            ? $this->successResponse($tag, 201)
            : $this->respondWithError('VALIDATION_ERROR', __('api.invalid_input'), 'name', 422);
    }

    /** DELETE /api/v2/admin/group-tags/{tagId} */
    public function deleteTag(int $tagId): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $success = DB::transaction(function () use ($adminId, $tenantId, $tagId): bool {
            $tag = DB::table('group_tags')
                ->where('tenant_id', $tenantId)
                ->where('id', $tagId)
                ->lockForUpdate()
                ->first(['id']);
            if ($tag === null || ! \App\Services\GroupTagService::delete($tagId)) {
                return false;
            }
            ActivityLog::log(
                $adminId,
                'admin_delete_group_tag',
                "Deleted group tag #{$tagId}",
                false,
                null,
                'admin',
                'group_tag',
                $tagId,
            );

            return true;
        });
        return $success
            ? $this->successResponse(['message' => __('api_controllers_1.admin_groups.tag_deleted')])
            : $this->respondWithError('NOT_FOUND', __('api.tag_not_found'), null, 404);
    }

    // =========================================================================
    // Collections
    // =========================================================================

    public function listCollections(): JsonResponse
    {
        $this->requireAdmin();
        return $this->successResponse(\App\Services\GroupCollectionService::getAll());
    }

    public function createCollection(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $userId = $this->requireUserId();
        if ($userId instanceof JsonResponse) return $userId;
        $data = request()->only(['name', 'description', 'image_url', 'sort_order']);
        if (empty($data['name'])) return $this->respondWithError('VALIDATION_ERROR', __('api.name_required'), 'name', 422);
        $id = DB::transaction(function () use ($adminId, $data, $userId): int {
            $id = \App\Services\GroupCollectionService::create($data, $userId);
            ActivityLog::log(
                $adminId,
                'admin_create_group_collection',
                "Created group collection #{$id}",
                false,
                null,
                'admin',
                'group_collection',
                $id,
            );

            return $id;
        });
        return $this->successResponse(['id' => $id], 201);
    }

    public function updateCollection(int $id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $data = request()->only(['name', 'description', 'image_url', 'sort_order', 'is_active']);
        $success = DB::transaction(function () use ($adminId, $id, $data): bool {
            if (! \App\Services\GroupCollectionService::update($id, $data)) {
                return false;
            }
            ActivityLog::log(
                $adminId,
                'admin_update_group_collection',
                "Updated group collection #{$id}",
                false,
                null,
                'admin',
                'group_collection',
                $id,
            );

            return true;
        });
        return $success
            ? $this->successResponse(['message' => __('api_controllers_1.admin_groups.collection_updated')])
            : $this->respondWithError('NOT_FOUND', __('api.group_collection_not_found'), null, 404);
    }

    public function deleteCollection(int $id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $success = DB::transaction(function () use ($adminId, $id): bool {
            if (! \App\Services\GroupCollectionService::delete($id)) {
                return false;
            }
            ActivityLog::log(
                $adminId,
                'admin_delete_group_collection',
                "Deleted group collection #{$id}",
                false,
                null,
                'admin',
                'group_collection',
                $id,
            );

            return true;
        });
        return $success
            ? $this->successResponse(['message' => __('api_controllers_1.admin_groups.collection_deleted')])
            : $this->respondWithError('NOT_FOUND', __('api.group_collection_not_found'), null, 404);
    }

    public function setCollectionGroups(int $id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $groupIds = request()->input('group_ids', []);
        if (!is_array($groupIds)) return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_input'), 'group_ids', 422);
        // F-482: setGroups() silently did nothing for a collection belonging to
        // another community, yet this method reported success AND wrote an
        // activity_log row naming that community's collection id. Refuse before
        // the log is written, exactly as deleteCollection() above does.
        $success = DB::transaction(function () use ($adminId, $id, $groupIds): bool {
            if (! \App\Services\GroupCollectionService::setGroups($id, $groupIds)) {
                return false;
            }
            ActivityLog::log(
                $adminId,
                'admin_set_group_collection_groups',
                'Set groups for collection #' . $id . '; count=' . count($groupIds),
                false,
                null,
                'admin',
                'group_collection',
                $id,
            );

            return true;
        });
        return $success
            ? $this->successResponse(['message' => __('api_controllers_1.admin_groups.collection_groups_set')])
            : $this->respondWithError('NOT_FOUND', __('api.group_collection_not_found'), null, 404);
    }

    // =========================================================================
    // Auto-Assign Rules
    // =========================================================================

    public function listAutoAssignRules(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $rules = DB::table('group_auto_assign_rules as r')
            ->join('groups as g', 'r.group_id', '=', 'g.id')
            ->where('r.tenant_id', $tenantId)
            ->where('g.tenant_id', $tenantId)
            ->select(
                'r.id',
                'r.group_id',
                'r.rule_type',
                'r.rule_value',
                'r.is_active',
                'r.created_at',
                'g.name as group_name',
            )
            ->orderBy('r.group_id')
            ->get()->map(fn ($r) => (array) $r)->toArray();
        return $this->successResponse($rules);
    }

    public function createAutoAssignRule(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $data = request()->only(['group_id', 'rule_type', 'rule_value']);
        if (empty($data['group_id']) || empty($data['rule_type']) || empty($data['rule_value'])) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_input'), 'group_id', 422);
        }
        $groupId = (int) $data['group_id'];
        if (! DB::table('groups')->where('id', $groupId)->where('tenant_id', $tenantId)->exists()) {
            return $this->respondWithError('NOT_FOUND', __('api.group_not_found'), null, 404);
        }
        if (! in_array((string) $data['rule_type'], ['location', 'interest', 'role', 'attribute'], true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_input'), 'rule_type', 422);
        }
        $id = DB::transaction(function () use ($adminId, $tenantId, $data): int {
            $id = (int) DB::table('group_auto_assign_rules')->insertGetId([
                'tenant_id' => $tenantId,
                'group_id' => (int) $data['group_id'],
                'rule_type' => $data['rule_type'],
                'rule_value' => $data['rule_value'],
                'is_active' => true,
                'created_at' => now(),
            ]);
            ActivityLog::log(
                $adminId,
                'admin_create_group_auto_assign_rule',
                'Created group auto-assign rule #' . $id . '; type=' . (string) $data['rule_type'],
                false,
                null,
                'admin',
                'group_auto_assign_rule',
                $id,
            );

            return $id;
        });
        return $this->successResponse(['id' => $id], 201);
    }

    public function updateAutoAssignRule(int $id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $data = request()->only(['group_id', 'rule_type', 'rule_value', 'is_active']);
        if ($data === []) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_input'), null, 422);
        }
        if (array_key_exists('group_id', $data)) {
            $groupId = (int) $data['group_id'];
            if ($groupId < 1 || ! DB::table('groups')
                ->where('id', $groupId)
                ->where('tenant_id', $tenantId)
                ->exists()) {
                return $this->respondWithError('NOT_FOUND', __('api.group_not_found'), null, 404);
            }
            $data['group_id'] = $groupId;
        }
        if (array_key_exists('rule_type', $data)
            && ! in_array((string) $data['rule_type'], ['location', 'interest', 'role', 'attribute'], true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_input'), 'rule_type', 422);
        }
        if (array_key_exists('rule_value', $data) && trim((string) $data['rule_value']) === '') {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_input'), 'rule_value', 422);
        }

        $updated = DB::transaction(function () use ($adminId, $tenantId, $id, $data): bool {
            $rule = DB::table('group_auto_assign_rules')
                ->where('id', $id)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first(['id']);
            if ($rule === null) {
                return false;
            }

            $updates = [];
            foreach (['group_id', 'rule_type', 'rule_value', 'is_active'] as $field) {
                if (array_key_exists($field, $data)) {
                    $updates[$field] = $field === 'is_active' ? (bool) $data[$field] : $data[$field];
                }
            }
            DB::table('group_auto_assign_rules')
                ->where('id', $id)
                ->where('tenant_id', $tenantId)
                ->update($updates);
            ActivityLog::log(
                $adminId,
                'admin_update_group_auto_assign_rule',
                "Updated group auto-assign rule #{$id}",
                false,
                null,
                'admin',
                'group_auto_assign_rule',
                $id,
            );

            return true;
        });

        return $updated
            ? $this->successResponse(['id' => $id])
            : $this->respondWithError('NOT_FOUND', __('api_controllers_1.admin_groups.rule_not_found'), null, 404);
    }

    public function deleteAutoAssignRule(int $id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $deleted = DB::transaction(function () use ($adminId, $tenantId, $id): int {
            $rule = DB::table('group_auto_assign_rules')
                ->where('id', $id)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first(['id', 'rule_type']);
            if ($rule === null) {
                return 0;
            }
            $deleted = DB::table('group_auto_assign_rules')
                ->where('id', $id)
                ->where('tenant_id', $tenantId)
                ->delete();
            if ($deleted === 1) {
                ActivityLog::log(
                    $adminId,
                    'admin_delete_group_auto_assign_rule',
                    'Deleted group auto-assign rule #' . $id . '; type=' . (string) $rule->rule_type,
                    false,
                    null,
                    'admin',
                    'group_auto_assign_rule',
                    $id,
                );
            }

            return $deleted;
        });
        return $deleted > 0
            ? $this->successResponse(['message' => __('api_controllers_1.admin_groups.rule_deleted')])
            : $this->respondWithError('NOT_FOUND', __('api_controllers_1.admin_groups.rule_not_found'), null, 404);
    }

    private function groupServiceMutationError(string $fallbackCode): JsonResponse
    {
        $errors = GroupService::getErrors();
        if ($errors === []) {
            return $this->respondWithError($fallbackCode, __('api.server_error'), null, 500);
        }

        $status = match ($errors[0]['code'] ?? '') {
            'NOT_FOUND', 'NOT_MEMBER' => 404,
            'FORBIDDEN', 'OWNER_CANNOT_LEAVE', 'SOLE_ADMIN' => 403,
            'GROUP_UNAVAILABLE', 'CAPACITY_FULL', 'MEMBERSHIP_LIMIT_REACHED' => 409,
            default => 422,
        };

        return $this->respondWithErrors($errors, $status);
    }
}
