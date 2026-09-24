<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\ActivityLog;

/**
 * AdminDeliverabilityController -- Admin deliverability dashboard, analytics, and CRUD.
 *
 * Fully converted from legacy delegation to direct DB/service calls.
 */
class AdminDeliverabilityController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct() {}

    private const VALID_STATUSES = ['draft', 'ready', 'in_progress', 'blocked', 'review', 'completed', 'cancelled', 'on_hold'];
    private const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'];

    // =========================================================================
    // Dashboard & Analytics
    // =========================================================================

    /** GET /api/v2/admin/deliverability/dashboard */
    public function getDashboard(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $total = (int) DB::selectOne("SELECT COUNT(*) as cnt FROM deliverables WHERE tenant_id = ?", [$tenantId])->cnt;

        $statusRows = DB::select("SELECT status, COUNT(*) as cnt FROM deliverables WHERE tenant_id = ? GROUP BY status", [$tenantId]);
        $byStatus = [];
        foreach ($statusRows as $row) { $byStatus[$row->status] = (int) $row->cnt; }

        $overdue = (int) DB::selectOne(
            "SELECT COUNT(*) as cnt FROM deliverables WHERE tenant_id = ? AND due_date < CURDATE() AND status NOT IN ('completed', 'cancelled')",
            [$tenantId]
        )->cnt;

        $completed = (int) ($byStatus['completed'] ?? 0);
        $completionRate = $total > 0 ? round(($completed / $total) * 100, 1) : 0;

        $recentActivity = DB::select(
            "SELECT h.id, h.deliverable_id, h.action_type, h.field_name, h.change_description, h.action_timestamp,
                    d.title as deliverable_title, CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as user_name
             FROM deliverable_history h LEFT JOIN deliverables d ON h.deliverable_id = d.id LEFT JOIN users u ON h.user_id = u.id
             WHERE h.tenant_id = ? ORDER BY h.action_timestamp DESC LIMIT 10",
            [$tenantId]
        );

        return $this->respondWithData([
            'total' => $total, 'by_status' => $byStatus, 'overdue' => $overdue, 'completion_rate' => $completionRate,
            'recent_activity' => array_map(fn($r) => [
                'id' => (int) $r->id, 'deliverable_id' => (int) $r->deliverable_id, 'deliverable_title' => $r->deliverable_title ?? '',
                'action_type' => $r->action_type, 'field_name' => $r->field_name, 'change_description' => $r->change_description,
                'user_name' => trim($r->user_name ?? ''), 'action_timestamp' => $r->action_timestamp,
            ], $recentActivity),
        ]);
    }

    /** GET /api/v2/admin/deliverability/analytics */
    public function getAnalytics(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $completionTrends = DB::select(
            "SELECT DATE(completed_at) as date, COUNT(*) as count FROM deliverables
             WHERE tenant_id = ? AND completed_at IS NOT NULL AND completed_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
             GROUP BY DATE(completed_at) ORDER BY date ASC",
            [$tenantId]
        );

        $priorityRows = DB::select("SELECT priority, COUNT(*) as cnt FROM deliverables WHERE tenant_id = ? GROUP BY priority", [$tenantId]);
        $priorityDistribution = [];
        foreach ($priorityRows as $r) { $priorityDistribution[$r->priority] = (int) $r->cnt; }

        $avgTime = DB::selectOne(
            "SELECT AVG(DATEDIFF(completed_at, created_at)) as avg_days FROM deliverables WHERE tenant_id = ? AND completed_at IS NOT NULL AND status = 'completed'",
            [$tenantId]
        );

        $riskRows = DB::select("SELECT risk_level, COUNT(*) as cnt FROM deliverables WHERE tenant_id = ? AND risk_level IS NOT NULL GROUP BY risk_level", [$tenantId]);
        $riskDistribution = [];
        foreach ($riskRows as $r) { $riskDistribution[$r->risk_level] = (int) $r->cnt; }

        return $this->respondWithData([
            'completion_trends' => array_map(fn($r) => ['date' => $r->date, 'count' => (int) $r->count], $completionTrends),
            'priority_distribution' => $priorityDistribution,
            'avg_days_to_complete' => $avgTime->avg_days !== null ? round((float) $avgTime->avg_days, 1) : null,
            'risk_distribution' => $riskDistribution,
        ]);
    }

    // =========================================================================
    // CRUD
    // =========================================================================

    /** GET /api/v2/admin/deliverability */
    public function getDeliverables(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $page = max(1, $this->queryInt('page', 1));
        $limit = min(100, max(1, $this->queryInt('limit', 20)));
        $offset = ($page - 1) * $limit;
        $status = $this->query('status');
        $priority = $this->query('priority');
        $assignedTo = $this->queryInt('assigned_to');
        $search = $this->query('search');

        $conditions = ['d.tenant_id = ?'];
        $params = [$tenantId];

        if ($status && in_array($status, self::VALID_STATUSES, true)) {
            $conditions[] = 'd.status = ?';
            $params[] = $status;
        }
        if ($priority && in_array($priority, self::VALID_PRIORITIES, true)) {
            $conditions[] = 'd.priority = ?';
            $params[] = $priority;
        }
        if ($assignedTo) {
            $conditions[] = 'd.assigned_to = ?';
            $params[] = $assignedTo;
        }
        if ($search) {
            $conditions[] = '(d.title LIKE ? OR d.description LIKE ?)';
            $searchTerm = '%' . $search . '%';
            $params[] = $searchTerm;
            $params[] = $searchTerm;
        }

        $where = implode(' AND ', $conditions);

        $total = (int) DB::selectOne("SELECT COUNT(*) as cnt FROM deliverables d WHERE {$where}", $params)->cnt;

        $itemResults = DB::select(
            "SELECT d.id, d.title, d.description, d.category, d.priority,
                    d.owner_id, d.assigned_to, d.assigned_group_id,
                    d.start_date, d.due_date, d.completed_at,
                    d.status, d.progress_percentage,
                    d.estimated_hours, d.actual_hours,
                    d.parent_deliverable_id, d.tags,
                    d.delivery_confidence, d.risk_level, d.risk_notes,
                    d.created_at, d.updated_at,
                    CONCAT(COALESCE(owner.first_name, ''), ' ', COALESCE(owner.last_name, '')) as owner_name,
                    CONCAT(COALESCE(assignee.first_name, ''), ' ', COALESCE(assignee.last_name, '')) as assignee_name
             FROM deliverables d
             LEFT JOIN users owner ON d.owner_id = owner.id AND owner.tenant_id = d.tenant_id
             LEFT JOIN users assignee ON d.assigned_to = assignee.id AND assignee.tenant_id = d.tenant_id
             WHERE {$where}
             ORDER BY d.created_at DESC
             LIMIT ? OFFSET ?",
            array_merge($params, [$limit, $offset])
        );
        $items = array_map(fn($r) => (array)$r, $itemResults);

        $formatted = array_map(function ($row) {
            return [
                'id' => (int) $row['id'],
                'title' => $row['title'] ?? '',
                'description' => $row['description'] ?? '',
                'category' => $row['category'] ?? null,
                'priority' => $row['priority'] ?? 'medium',
                'owner_id' => $row['owner_id'] ? (int) $row['owner_id'] : null,
                'owner_name' => trim($row['owner_name'] ?? ''),
                'assigned_to' => $row['assigned_to'] ? (int) $row['assigned_to'] : null,
                'assignee_name' => trim($row['assignee_name'] ?? ''),
                'assigned_group_id' => $row['assigned_group_id'] ? (int) $row['assigned_group_id'] : null,
                'start_date' => $row['start_date'] ?? null,
                'due_date' => $row['due_date'] ?? null,
                'completed_at' => $row['completed_at'] ?? null,
                'status' => $row['status'] ?? 'draft',
                'progress_percentage' => (int) ($row['progress_percentage'] ?? 0),
                'estimated_hours' => $row['estimated_hours'] !== null ? (float) $row['estimated_hours'] : null,
                'actual_hours' => $row['actual_hours'] !== null ? (float) $row['actual_hours'] : null,
                'parent_deliverable_id' => $row['parent_deliverable_id'] ? (int) $row['parent_deliverable_id'] : null,
                'tags' => json_decode($row['tags'] ?? '[]', true) ?: [],
                'delivery_confidence' => $row['delivery_confidence'] !== null ? (int) $row['delivery_confidence'] : null,
                'risk_level' => $row['risk_level'] ?? null,
                'risk_notes' => $row['risk_notes'] ?? null,
                'created_at' => $row['created_at'],
                'updated_at' => $row['updated_at'] ?? null,
            ];
        }, $items);

        return $this->respondWithPaginatedCollection($formatted, $total, $page, $limit);
    }

    /** GET /api/v2/admin/deliverability/{id} */
    public function getDeliverable(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $deliverableRow = DB::selectOne(
            "SELECT d.*,
                    CONCAT(COALESCE(owner.first_name, ''), ' ', COALESCE(owner.last_name, '')) as owner_name,
                    CONCAT(COALESCE(assignee.first_name, ''), ' ', COALESCE(assignee.last_name, '')) as assignee_name
             FROM deliverables d
             LEFT JOIN users owner ON d.owner_id = owner.id AND owner.tenant_id = d.tenant_id
             LEFT JOIN users assignee ON d.assigned_to = assignee.id AND assignee.tenant_id = d.tenant_id
             WHERE d.id = ? AND d.tenant_id = ?",
            [$id, $tenantId]
        );
        $deliverable = $deliverableRow ? (array)$deliverableRow : null;

        if (!$deliverable) {
            return $this->respondWithError('NOT_FOUND', __('api.deliverable_not_found'), null, 404);
        }

        $milestoneResults = DB::select(
            "SELECT m.*, CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as completed_by_name
             FROM deliverable_milestones m LEFT JOIN users u ON m.completed_by = u.id
             WHERE m.deliverable_id = ? AND m.tenant_id = ? ORDER BY m.order_position ASC",
            [$id, $tenantId]
        );
        $milestones = array_map(fn($r) => (array)$r, $milestoneResults);

        $formattedMilestones = array_map(function ($row) {
            return [
                'id' => (int) $row['id'],
                'title' => $row['title'] ?? '',
                'description' => $row['description'] ?? '',
                'order_position' => (int) ($row['order_position'] ?? 0),
                'status' => $row['status'] ?? 'pending',
                'completed_at' => $row['completed_at'] ?? null,
                'completed_by' => $row['completed_by'] ? (int) $row['completed_by'] : null,
                'completed_by_name' => trim($row['completed_by_name'] ?? ''),
                'due_date' => $row['due_date'] ?? null,
                'estimated_hours' => $row['estimated_hours'] !== null ? (float) $row['estimated_hours'] : null,
                'depends_on_milestone_ids' => json_decode($row['depends_on_milestone_ids'] ?? '[]', true) ?: [],
                'created_at' => $row['created_at'],
                'updated_at' => $row['updated_at'] ?? null,
            ];
        }, $milestones);

        $commentResults = DB::select(
            "SELECT c.*, CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as user_name, u.avatar_url as user_avatar
             FROM deliverable_comments c LEFT JOIN users u ON c.user_id = u.id
             WHERE c.deliverable_id = ? AND c.tenant_id = ? AND c.is_deleted = 0
             ORDER BY c.created_at DESC LIMIT 20",
            [$id, $tenantId]
        );
        $comments = array_map(fn($r) => (array)$r, $commentResults);

        $formattedComments = array_map(function ($row) {
            return [
                'id' => (int) $row['id'],
                'user_id' => (int) ($row['user_id'] ?? 0),
                'user_name' => trim($row['user_name'] ?? ''),
                'user_avatar' => $row['user_avatar'] ?? null,
                'comment_text' => $row['comment_text'] ?? '',
                'comment_type' => $row['comment_type'] ?? 'comment',
                'parent_comment_id' => $row['parent_comment_id'] ? (int) $row['parent_comment_id'] : null,
                'reactions' => json_decode($row['reactions'] ?? '[]', true) ?: [],
                'is_pinned' => (bool) ($row['is_pinned'] ?? false),
                'is_edited' => (bool) ($row['is_edited'] ?? false),
                'edited_at' => $row['edited_at'] ?? null,
                'mentioned_user_ids' => json_decode($row['mentioned_user_ids'] ?? '[]', true) ?: [],
                'created_at' => $row['created_at'],
                'updated_at' => $row['updated_at'] ?? null,
            ];
        }, $comments);

        $formatted = [
            'id' => (int) $deliverable['id'],
            'title' => $deliverable['title'] ?? '',
            'description' => $deliverable['description'] ?? '',
            'category' => $deliverable['category'] ?? null,
            'priority' => $deliverable['priority'] ?? 'medium',
            'owner_id' => $deliverable['owner_id'] ? (int) $deliverable['owner_id'] : null,
            'owner_name' => trim($deliverable['owner_name'] ?? ''),
            'assigned_to' => $deliverable['assigned_to'] ? (int) $deliverable['assigned_to'] : null,
            'assignee_name' => trim($deliverable['assignee_name'] ?? ''),
            'assigned_group_id' => $deliverable['assigned_group_id'] ? (int) $deliverable['assigned_group_id'] : null,
            'start_date' => $deliverable['start_date'] ?? null,
            'due_date' => $deliverable['due_date'] ?? null,
            'completed_at' => $deliverable['completed_at'] ?? null,
            'status' => $deliverable['status'] ?? 'draft',
            'progress_percentage' => (int) ($deliverable['progress_percentage'] ?? 0),
            'estimated_hours' => $deliverable['estimated_hours'] !== null ? (float) $deliverable['estimated_hours'] : null,
            'actual_hours' => $deliverable['actual_hours'] !== null ? (float) $deliverable['actual_hours'] : null,
            'parent_deliverable_id' => $deliverable['parent_deliverable_id'] ? (int) $deliverable['parent_deliverable_id'] : null,
            'blocking_deliverable_ids' => json_decode($deliverable['blocking_deliverable_ids'] ?? '[]', true) ?: [],
            'depends_on_deliverable_ids' => json_decode($deliverable['depends_on_deliverable_ids'] ?? '[]', true) ?: [],
            'tags' => json_decode($deliverable['tags'] ?? '[]', true) ?: [],
            'custom_fields' => json_decode($deliverable['custom_fields'] ?? '{}', true) ?: [],
            'delivery_confidence' => $deliverable['delivery_confidence'] !== null ? (int) $deliverable['delivery_confidence'] : null,
            'risk_level' => $deliverable['risk_level'] ?? null,
            'risk_notes' => $deliverable['risk_notes'] ?? null,
            'watchers' => json_decode($deliverable['watchers'] ?? '[]', true) ?: [],
            'collaborators' => json_decode($deliverable['collaborators'] ?? '[]', true) ?: [],
            'attachment_urls' => json_decode($deliverable['attachment_urls'] ?? '[]', true) ?: [],
            'external_links' => json_decode($deliverable['external_links'] ?? '[]', true) ?: [],
            'created_at' => $deliverable['created_at'],
            'updated_at' => $deliverable['updated_at'] ?? null,
            'milestones' => $formattedMilestones,
            'comments' => $formattedComments,
        ];

        return $this->respondWithData($formatted);
    }

    /** POST /api/v2/admin/deliverability */
    public function createDeliverable(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $data = $this->getAllInput();
        $title = trim($data['title'] ?? '');

        if (empty($title)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.title_required'), 'title', 400);
        }

        $status = 'draft';
        if (isset($data['status']) && in_array($data['status'], self::VALID_STATUSES, true)) {
            $status = $data['status'];
        }

        $priority = 'medium';
        if (isset($data['priority']) && in_array($data['priority'], self::VALID_PRIORITIES, true)) {
            $priority = $data['priority'];
        }

        // F-155: the assignee is echoed back by name in the list/detail views and
        // is sent an in-app notification + push. Refuse an assignee outside the
        // caller's community — otherwise a community admin could name any account
        // platform-wide, read back its name, and fan a notification out to it.
        if (isset($data['assigned_to']) && $data['assigned_to'] !== null && (int) $data['assigned_to'] !== 0) {
            $assignee = DB::selectOne(
                "SELECT id FROM users WHERE id = ? AND tenant_id = ?",
                [(int) $data['assigned_to'], $tenantId]
            );
            if (!$assignee) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.user_not_found'), 'assigned_to', 422);
            }
        }

        $tags = isset($data['tags']) ? json_encode($data['tags']) : '[]';
        $customFields = isset($data['custom_fields']) ? json_encode($data['custom_fields']) : '{}';
        $blockingIds = isset($data['blocking_deliverable_ids']) ? json_encode($data['blocking_deliverable_ids']) : '[]';
        $dependsOnIds = isset($data['depends_on_deliverable_ids']) ? json_encode($data['depends_on_deliverable_ids']) : '[]';
        $watchers = isset($data['watchers']) ? json_encode($data['watchers']) : '[]';
        $collaborators = isset($data['collaborators']) ? json_encode($data['collaborators']) : '[]';
        $attachmentUrls = isset($data['attachment_urls']) ? json_encode($data['attachment_urls']) : '[]';
        $externalLinks = isset($data['external_links']) ? json_encode($data['external_links']) : '[]';

        DB::insert(
            "INSERT INTO deliverables
                (tenant_id, title, description, category, priority, owner_id, assigned_to,
                 assigned_group_id, start_date, due_date, status, progress_percentage,
                 estimated_hours, parent_deliverable_id, blocking_deliverable_ids,
                 depends_on_deliverable_ids, tags, custom_fields, delivery_confidence,
                 risk_level, risk_notes, watchers, collaborators, attachment_urls,
                 external_links, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())",
            [
                $tenantId, $title, $data['description'] ?? null, $data['category'] ?? null, $priority,
                $adminId, isset($data['assigned_to']) ? (int) $data['assigned_to'] : null,
                isset($data['assigned_group_id']) ? (int) $data['assigned_group_id'] : null,
                $data['start_date'] ?? null, $data['due_date'] ?? null, $status,
                (int) ($data['progress_percentage'] ?? 0),
                isset($data['estimated_hours']) ? (float) $data['estimated_hours'] : null,
                isset($data['parent_deliverable_id']) ? (int) $data['parent_deliverable_id'] : null,
                $blockingIds, $dependsOnIds, $tags, $customFields,
                isset($data['delivery_confidence']) ? (int) $data['delivery_confidence'] : null,
                $data['risk_level'] ?? null, $data['risk_notes'] ?? null,
                $watchers, $collaborators, $attachmentUrls, $externalLinks,
            ]
        );

        $newId = DB::getPdo()->lastInsertId();

        $this->logHistory($tenantId, (int) $newId, 'created', $adminId, null, null, null, "Created deliverable: {$title}");

        // Notify assigned user, rendered in the assignee's preferred language.
        try {
            $assignedTo = isset($data['assigned_to']) ? (int) $data['assigned_to'] : null;
            if ($assignedTo && $assignedTo !== $adminId) {
                $recipient = DB::table('users')
                    ->where('id', $assignedTo)
                    ->where('tenant_id', $tenantId)
                    ->select(['preferred_language'])
                    ->first();

                LocaleContext::withLocale($recipient, function () use ($assignedTo, $title, $newId) {
                    $msg = __('api_controllers_3.deliverable.assigned', ['title' => $title]);
                    \App\Models\Notification::createNotification(
                        $assignedTo,
                        $msg,
                        "/deliverables/{$newId}",
                        'deliverable_assigned'
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) $assignedTo, 'deliverable_assigned', $msg, "/deliverables/{$newId}");
                });
            }
        } catch (\Throwable $e) {
            \Log::warning('Deliverable assignment notification failed', ['deliverable_id' => $newId, 'error' => $e->getMessage()]);
        }

        return $this->respondWithData([
            'id' => (int) $newId, 'title' => $title, 'status' => $status, 'priority' => $priority,
        ]);
    }

    /** PUT /api/v2/admin/deliverability/{id} */
    public function updateDeliverable(int $id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $existingRow = DB::selectOne(
            "SELECT id, title, status, priority, assigned_to FROM deliverables WHERE id = ? AND tenant_id = ?",
            [$id, $tenantId]
        );
        $existing = $existingRow ? (array)$existingRow : null;

        if (!$existing) {
            return $this->respondWithError('NOT_FOUND', __('api.deliverable_not_found'), null, 404);
        }

        $data = $this->getAllInput();

        $fields = [];
        $params = [];

        // Simple text/nullable fields
        $simpleFields = ['title', 'description', 'category', 'risk_level', 'risk_notes', 'start_date', 'due_date'];
        foreach ($simpleFields as $fieldName) {
            if (array_key_exists($fieldName, $data)) {
                $fields[] = "{$fieldName} = ?";
                $value = $data[$fieldName];
                $params[] = is_string($value) ? trim($value) : $value;
            }
        }

        if (isset($data['title']) && trim($data['title']) === '') {
            return $this->respondWithError('VALIDATION_ERROR', __('api.title_cannot_be_empty'), 'title', 400);
        }

        // Status
        if (isset($data['status'])) {
            if (!in_array($data['status'], self::VALID_STATUSES, true)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_status_value'), 'status', 400);
            }
            $fields[] = 'status = ?';
            $params[] = $data['status'];

            if ($data['status'] === 'completed' && $existing['status'] !== 'completed') {
                $fields[] = 'completed_at = NOW()';
            } elseif ($data['status'] !== 'completed' && $existing['status'] === 'completed') {
                $fields[] = 'completed_at = NULL';
            }

            if ($data['status'] !== $existing['status']) {
                $this->logHistory($tenantId, $id, 'status_changed', $adminId, 'status', $existing['status'], $data['status'],
                    "Status changed from {$existing['status']} to {$data['status']}");
            }
        }

        // Priority
        if (isset($data['priority'])) {
            if (!in_array($data['priority'], self::VALID_PRIORITIES, true)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_priority_value'), 'priority', 400);
            }
            $fields[] = 'priority = ?';
            $params[] = $data['priority'];

            if ($data['priority'] !== $existing['priority']) {
                $this->logHistory($tenantId, $id, 'priority_changed', $adminId, 'priority', $existing['priority'], $data['priority'],
                    "Priority changed from {$existing['priority']} to {$data['priority']}");
            }
        }

        // Assignment
        if (array_key_exists('assigned_to', $data)) {
            $newAssignee = $data['assigned_to'] !== null ? (int) $data['assigned_to'] : null;
            // F-155: same tenant guard as createDeliverable() — never assign to,
            // disclose, or notify an account outside the caller's community.
            if ($newAssignee !== null && $newAssignee !== 0) {
                $assignee = DB::selectOne(
                    "SELECT id FROM users WHERE id = ? AND tenant_id = ?",
                    [$newAssignee, $tenantId]
                );
                if (!$assignee) {
                    return $this->respondWithError('VALIDATION_ERROR', __('api.user_not_found'), 'assigned_to', 422);
                }
            }
            $fields[] = 'assigned_to = ?';
            $params[] = $newAssignee;

            $oldAssignee = $existing['assigned_to'] ? (string) $existing['assigned_to'] : 'unassigned';
            $newAssigneeStr = $newAssignee !== null ? (string) $newAssignee : 'unassigned';
            if ($oldAssignee !== $newAssigneeStr) {
                $this->logHistory($tenantId, $id, 'assignment_changed', $adminId, 'assigned_to', $oldAssignee, $newAssigneeStr, "Assignment changed");

                // Notify new assignee, rendered in the assignee's preferred language.
                if ($newAssignee && $newAssignee !== $adminId) {
                    try {
                        $deliverableTitle = $existing['title'] ?? 'a deliverable';
                        $recipient = DB::table('users')
                            ->where('id', $newAssignee)
                            ->where('tenant_id', $tenantId)
                            ->select(['preferred_language'])
                            ->first();

                        LocaleContext::withLocale($recipient, function () use ($newAssignee, $deliverableTitle, $id) {
                            $msg = __('api_controllers_3.deliverable.reassigned', ['title' => $deliverableTitle]);
                            \App\Models\Notification::createNotification(
                                $newAssignee,
                                $msg,
                                "/deliverables/{$id}",
                                'deliverable_assigned'
                            );
                            \App\Services\NotificationDispatcher::fanOutPush((int) $newAssignee, 'deliverable_assigned', $msg, "/deliverables/{$id}");
                        });
                    } catch (\Throwable $e) {
                        \Log::warning('Deliverable reassignment notification failed', ['deliverable_id' => $id, 'error' => $e->getMessage()]);
                    }
                }
            }
        }

        // Integer fields
        foreach (['assigned_group_id', 'progress_percentage', 'parent_deliverable_id', 'delivery_confidence'] as $fieldName) {
            if (array_key_exists($fieldName, $data)) {
                $fields[] = "{$fieldName} = ?";
                $params[] = $data[$fieldName] !== null ? (int) $data[$fieldName] : null;
            }
        }

        // Float fields
        foreach (['estimated_hours', 'actual_hours'] as $fieldName) {
            if (array_key_exists($fieldName, $data)) {
                $fields[] = "{$fieldName} = ?";
                $params[] = $data[$fieldName] !== null ? (float) $data[$fieldName] : null;
            }
        }

        // JSON fields
        foreach (['blocking_deliverable_ids', 'depends_on_deliverable_ids', 'tags', 'custom_fields', 'watchers', 'collaborators', 'attachment_urls', 'external_links'] as $fieldName) {
            if (array_key_exists($fieldName, $data)) {
                $fields[] = "{$fieldName} = ?";
                $params[] = json_encode($data[$fieldName]);
            }
        }

        if (empty($fields)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.no_fields_provided'), null, 400);
        }

        $fields[] = 'updated_at = NOW()';
        $params[] = $id;
        $params[] = $tenantId;

        DB::update("UPDATE deliverables SET " . implode(', ', $fields) . " WHERE id = ? AND tenant_id = ?", $params);

        return $this->getDeliverable($id);
    }

    /** DELETE /api/v2/admin/deliverability/{id} */
    public function deleteDeliverable(int $id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $deliverable = DB::selectOne("SELECT id, title FROM deliverables WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
        if (!$deliverable) {
            return $this->respondWithError('NOT_FOUND', __('api.deliverable_not_found'), null, 404);
        }

        DB::delete("DELETE FROM deliverable_comments WHERE deliverable_id = ? AND tenant_id = ?", [$id, $tenantId]);
        DB::delete("DELETE FROM deliverable_milestones WHERE deliverable_id = ? AND tenant_id = ?", [$id, $tenantId]);
        DB::delete("DELETE FROM deliverable_history WHERE deliverable_id = ? AND tenant_id = ?", [$id, $tenantId]);
        DB::delete("DELETE FROM deliverables WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);

        ActivityLog::log($adminId, 'admin_delete_deliverable', "Deleted deliverable #{$id}: " . ($deliverable->title ?? ''));

        return $this->respondWithData(['deleted' => true, 'id' => $id]);
    }

    /** POST /api/v2/admin/deliverability/{id}/comments */
    public function addComment(int $id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $deliverable = DB::selectOne("SELECT id FROM deliverables WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
        if (!$deliverable) {
            return $this->respondWithError('NOT_FOUND', __('api.deliverable_not_found'), null, 404);
        }

        $commentText = trim($this->input('comment_text', ''));
        if (empty($commentText)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.comment_text_required'), 'comment_text', 400);
        }

        $commentType = $this->input('comment_type', 'comment');
        $parentCommentId = $this->input('parent_comment_id') ? (int) $this->input('parent_comment_id') : null;
        $mentionedUserIds = $this->input('mentioned_user_ids') ? json_encode($this->input('mentioned_user_ids')) : '[]';

        DB::insert(
            "INSERT INTO deliverable_comments
                (tenant_id, deliverable_id, user_id, comment_text, comment_type,
                 parent_comment_id, reactions, is_pinned, is_edited, is_deleted,
                 mentioned_user_ids, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, '[]', 0, 0, 0, ?, NOW(), NOW())",
            [$tenantId, $id, $adminId, $commentText, $commentType, $parentCommentId, $mentionedUserIds]
        );

        $commentId = DB::getPdo()->lastInsertId();

        $this->logHistory($tenantId, $id, 'comment_added', $adminId, null, null, null, 'Comment added');

        $commentRow = DB::selectOne(
            "SELECT c.*, CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as user_name, u.avatar_url as user_avatar
             FROM deliverable_comments c LEFT JOIN users u ON c.user_id = u.id
             WHERE c.id = ? AND c.tenant_id = ?",
            [$commentId, $tenantId]
        );
        $comment = (array)$commentRow;

        return $this->respondWithData([
            'id' => (int) $comment['id'],
            'deliverable_id' => $id,
            'user_id' => (int) ($comment['user_id'] ?? 0),
            'user_name' => trim($comment['user_name'] ?? ''),
            'user_avatar' => $comment['user_avatar'] ?? null,
            'comment_text' => $comment['comment_text'] ?? '',
            'comment_type' => $comment['comment_type'] ?? 'comment',
            'parent_comment_id' => $comment['parent_comment_id'] ? (int) $comment['parent_comment_id'] : null,
            'reactions' => json_decode($comment['reactions'] ?? '[]', true) ?: [],
            'is_pinned' => (bool) ($comment['is_pinned'] ?? false),
            'is_edited' => false,
            'mentioned_user_ids' => json_decode($comment['mentioned_user_ids'] ?? '[]', true) ?: [],
            'created_at' => $comment['created_at'],
            'updated_at' => $comment['updated_at'] ?? null,
        ]);
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    private function logHistory(int $tenantId, int $deliverableId, string $actionType, ?int $userId, ?string $fieldName = null, ?string $oldValue = null, ?string $newValue = null, ?string $description = null): void
    {
        try {
            DB::insert(
                "INSERT INTO deliverable_history
                    (tenant_id, deliverable_id, action_type, user_id, action_timestamp,
                     field_name, old_value, new_value, change_description, ip_address, user_agent, created_at)
                 VALUES (?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, NOW())",
                [
                    $tenantId, $deliverableId, $actionType, $userId,
                    $fieldName, $oldValue, $newValue, $description,
                    request()->ip(), request()->userAgent(),
                ]
            );
        } catch (\Throwable $e) {
            // History logging should not break the main operation
        }
    }
}
