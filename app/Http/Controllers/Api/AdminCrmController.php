<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Core\TenantContext;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * AdminCrmController -- CRM contact management, notes, tasks, tags, timeline, exports.
 *
 * Fully converted from legacy delegation to direct DB/service calls.
 */
class AdminCrmController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct() {}

    // ─────────────────────────────────────────────────────────────────────────
    // Contacts
    // ─────────────────────────────────────────────────────────────────────────

    /** GET /api/v2/admin/crm/contacts */
    public function contacts(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $page = $this->queryInt('page', 1, 1);
        $perPage = $this->queryInt('per_page', 20, 1, 100);
        $search = $this->query('q');
        // Cap search length so a multi-kilobyte wildcard-rich term can't
        // turn into an expensive LIKE scan and a DB-level DoS.
        if ($search !== null && strlen((string) $search) > 100) {
            $search = substr((string) $search, 0, 100);
        }
        $offset = ($page - 1) * $perPage;

        if ($search) {
            $items = DB::select('SELECT * FROM crm_contacts WHERE tenant_id = ? AND (name LIKE ? OR email LIKE ?) ORDER BY created_at DESC LIMIT ? OFFSET ?', [$tenantId, "%{$search}%", "%{$search}%", $perPage, $offset]);
            $total = DB::selectOne('SELECT COUNT(*) as cnt FROM crm_contacts WHERE tenant_id = ? AND (name LIKE ? OR email LIKE ?)', [$tenantId, "%{$search}%", "%{$search}%"])->cnt;
        } else {
            $items = DB::select('SELECT * FROM crm_contacts WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?', [$tenantId, $perPage, $offset]);
            $total = DB::selectOne('SELECT COUNT(*) as cnt FROM crm_contacts WHERE tenant_id = ?', [$tenantId])->cnt;
        }
        return $this->respondWithPaginatedCollection($items, (int) $total, $page, $perPage);
    }

    /** GET /api/v2/admin/crm/contacts/{id} */
    public function show(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $contact = DB::selectOne('SELECT * FROM crm_contacts WHERE id = ? AND tenant_id = ?', [$id, $tenantId]);
        if ($contact === null) { return $this->respondWithError('NOT_FOUND', __('api.contact_not_found'), null, 404); }
        return $this->respondWithData($contact);
    }

    /** PUT /api/v2/admin/crm/contacts/{id} */
    public function update(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $data = $this->getAllInput();
        $allowed = ['name', 'email', 'phone', 'organization', 'tags', 'status'];
        $sets = []; $params = [];
        foreach ($data as $key => $value) {
            if (in_array($key, $allowed, true)) { $sets[] = "{$key} = ?"; $params[] = $value; }
        }
        if (empty($sets)) { return $this->respondWithError('VALIDATION_ERROR', __('api.no_valid_fields')); }
        $params[] = $id; $params[] = $tenantId;
        $affected = DB::update('UPDATE crm_contacts SET ' . implode(', ', $sets) . ' WHERE id = ? AND tenant_id = ?', $params);
        if ($affected === 0) { return $this->respondWithError('NOT_FOUND', __('api.contact_not_found'), null, 404); }
        return $this->respondWithData(['id' => $id, 'updated' => true]);
    }

    /** GET /api/v2/admin/crm/contacts/{id}/notes */
    public function notes(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $contact = DB::selectOne('SELECT id FROM crm_contacts WHERE id = ? AND tenant_id = ?', [$id, $tenantId]);
        if ($contact === null) { return $this->respondWithError('NOT_FOUND', __('api.contact_not_found'), null, 404); }
        $notes = DB::select('SELECT * FROM crm_notes WHERE contact_id = ? AND tenant_id = ? ORDER BY created_at DESC', [$id, $tenantId]);
        return $this->respondWithData($notes);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Dashboard
    // ─────────────────────────────────────────────────────────────────────────

    public function dashboard(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $memberStats = $this->getMemberStats($tenantId);

        $openTasks = 0; $overdueTasks = 0;
        try {
            $openTasks = (int) DB::selectOne("SELECT COUNT(*) as cnt FROM coordinator_tasks WHERE tenant_id = ? AND status IN ('pending','in_progress')", [$tenantId])->cnt;
            $overdueTasks = (int) DB::selectOne("SELECT COUNT(*) as cnt FROM coordinator_tasks WHERE tenant_id = ? AND status IN ('pending','in_progress') AND due_date < CURDATE()", [$tenantId])->cnt;
        } catch (\Throwable $e) { Log::warning('Stats query failed in ' . __METHOD__, ['error' => $e->getMessage()]); }

        $totalNotes = 0;
        try { $totalNotes = (int) DB::selectOne("SELECT COUNT(*) as cnt FROM member_notes WHERE tenant_id = ?", [$tenantId])->cnt; } catch (\Throwable $e) { Log::warning('Stats query failed in ' . __METHOD__, ['error' => $e->getMessage()]); }

        return $this->respondWithData([
            'total_members' => $memberStats['total_members'], 'active_members' => $memberStats['active_members'],
            'new_this_month' => $memberStats['new_this_month'], 'pending_approvals' => $memberStats['pending_approvals'],
            'open_tasks' => $openTasks, 'overdue_tasks' => $overdueTasks,
            'total_notes' => $totalNotes, 'never_logged_in' => $memberStats['never_logged_in'],
            'retention_rate' => $memberStats['retention_rate'],
        ]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Funnel
    // ─────────────────────────────────────────────────────────────────────────

    public function funnel(): JsonResponse
    {
        $this->requireBrokerOrAdmin();
        $tenantId = TenantContext::getId();

        $registered = (int) DB::selectOne("SELECT COUNT(*) as cnt FROM users WHERE tenant_id = ?", [$tenantId])->cnt;
        $emailVerified = (int) DB::selectOne("SELECT COUNT(*) as cnt FROM users WHERE tenant_id = ? AND email_verified_at IS NOT NULL", [$tenantId])->cnt;
        $profileCompleted = (int) DB::selectOne("SELECT COUNT(*) as cnt FROM users WHERE tenant_id = ? AND (bio IS NOT NULL AND bio != '') AND (location IS NOT NULL AND location != '')", [$tenantId])->cnt;

        $firstListing = 0;
        try { $firstListing = (int) DB::selectOne("SELECT COUNT(DISTINCT user_id) as cnt FROM listings WHERE tenant_id = ?", [$tenantId])->cnt; } catch (\Throwable $e) { Log::warning('Stats query failed in ' . __METHOD__, ['error' => $e->getMessage()]); }

        $firstExchange = 0;
        try {
            $firstExchange = (int) DB::selectOne(
                "SELECT COUNT(DISTINCT u) as cnt FROM (SELECT sender_id as u FROM transactions WHERE tenant_id = ? AND status = 'completed' UNION SELECT receiver_id as u FROM transactions WHERE tenant_id = ? AND status = 'completed') AS combined",
                [$tenantId, $tenantId]
            )->cnt;
        } catch (\Throwable $e) { Log::warning('Stats query failed in ' . __METHOD__, ['error' => $e->getMessage()]); }

        $repeatUser = 0;
        try {
            $repeatUser = (int) DB::selectOne(
                "SELECT COUNT(*) as cnt FROM (SELECT u, COUNT(*) as tx_count FROM (SELECT sender_id as u FROM transactions WHERE tenant_id = ? AND status = 'completed' UNION ALL SELECT receiver_id as u FROM transactions WHERE tenant_id = ? AND status = 'completed') AS all_tx GROUP BY u HAVING tx_count >= 2) AS repeat_users",
                [$tenantId, $tenantId]
            )->cnt;
        } catch (\Throwable $e) { Log::warning('Stats query failed in ' . __METHOD__, ['error' => $e->getMessage()]); }

        $monthlyRegistrations = DB::select(
            "SELECT DATE_FORMAT(created_at, '%Y-%m') as month, COUNT(*) as count FROM users WHERE tenant_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH) GROUP BY DATE_FORMAT(created_at, '%Y-%m') ORDER BY month ASC",
            [$tenantId]
        );
        $monthlyRegistrations = array_map(fn($r) => (array)$r, $monthlyRegistrations);

        return $this->respondWithData([
            'stages' => [
                ['code' => 'registered', 'count' => $registered, 'color' => '#3b82f6'],
                ['code' => 'email_verified', 'count' => $emailVerified, 'color' => '#6366f1'],
                ['code' => 'profile_complete', 'count' => $profileCompleted, 'color' => '#8b5cf6'],
                ['code' => 'first_listing', 'count' => $firstListing, 'color' => '#a855f7'],
                ['code' => 'first_exchange', 'count' => $firstExchange, 'color' => '#d946ef'],
                ['code' => 'repeat_user', 'count' => $repeatUser, 'color' => '#ec4899'],
            ],
            'monthly_registrations' => $monthlyRegistrations,
        ]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Admin list
    // ─────────────────────────────────────────────────────────────────────────

    public function listAdmins(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $admins = DB::select(
            "SELECT id, name, email, avatar_url, role FROM users WHERE tenant_id = ? AND (role IN ('admin','tenant_admin','super_admin') OR is_admin = 1) ORDER BY name ASC",
            [$tenantId]
        );
        $admins = array_map(fn($r) => (array)$r, $admins);

        return $this->respondWithCollection($admins);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Notes
    // ─────────────────────────────────────────────────────────────────────────

    /** GET /api/v2/admin/crm/notes */
    public function listNotes(): JsonResponse
    {
        $this->requireBrokerOrAdmin();
        $tenantId = TenantContext::getId();

        $userId = $this->queryInt('user_id');
        $category = $this->query('category');
        $search = $this->query('search');
        $page = max(1, $this->queryInt('page', 1));
        $limit = min(100, max(1, $this->queryInt('limit', 20)));
        $offset = ($page - 1) * $limit;

        $where = "mn.tenant_id = ?";
        $params = [$tenantId];

        if ($userId) {
            $where .= " AND mn.user_id = ?";
            $params[] = $userId;
        }

        $validCategories = ['general', 'outreach', 'support', 'onboarding', 'concern', 'follow_up'];
        if ($category && in_array($category, $validCategories, true)) {
            $where .= " AND mn.category = ?";
            $params[] = $category;
        }

        if ($search && mb_strlen($search) >= 2) {
            $escaped = str_replace(['%', '_'], ['\\%', '\\_'], $search);
            $searchTerm = '%' . $escaped . '%';
            $where .= " AND (mn.content LIKE ? ESCAPE '\\\\' OR u.name LIKE ? ESCAPE '\\\\')";
            $params[] = $searchTerm;
            $params[] = $searchTerm;
        }

        $total = (int) DB::selectOne(
            "SELECT COUNT(*) as cnt FROM member_notes mn LEFT JOIN users u ON u.id = mn.user_id WHERE {$where}",
            $params
        )->cnt;

        $dataParams = array_merge($params, [$limit, $offset]);
        $notes = DB::select(
            "SELECT mn.*, u.name as user_name, u.avatar_url as user_avatar, a.name as author_name
             FROM member_notes mn
             LEFT JOIN users u ON u.id = mn.user_id
             LEFT JOIN users a ON a.id = mn.author_id
             WHERE {$where}
             ORDER BY mn.is_pinned DESC, mn.created_at DESC
             LIMIT ? OFFSET ?",
            $dataParams
        );
        $notes = array_map(fn($r) => (array)$r, $notes);

        return $this->respondWithPaginatedCollection($notes, $total, $page, $limit);
    }

    /** POST /api/v2/admin/crm/notes */
    public function createNote(): JsonResponse
    {
        $adminId = $this->requireBrokerOrAdmin();
        $tenantId = TenantContext::getId();

        $userId = (int) $this->input('user_id', 0);
        $content = trim($this->input('content', ''));
        $category = $this->input('category', 'general');

        if (!$userId || !$content) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.user_id_content_required'), null, 400);
        }

        $user = DB::selectOne("SELECT id FROM users WHERE id = ? AND tenant_id = ?", [$userId, $tenantId]);
        if (!$user) {
            return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
        }

        $validCategories = ['general', 'outreach', 'support', 'onboarding', 'concern', 'follow_up'];
        if (!in_array($category, $validCategories, true)) {
            $category = 'general';
        }

        DB::insert(
            "INSERT INTO member_notes (tenant_id, user_id, author_id, content, category, is_pinned) VALUES (?, ?, ?, ?, ?, ?)",
            [$tenantId, $userId, $adminId, $content, $category, (int) $this->input('is_pinned', 0)]
        );

        $noteId = (int) DB::getPdo()->lastInsertId();

        $note = DB::selectOne(
            "SELECT mn.*, u.name as user_name, u.avatar_url as user_avatar, a.name as author_name
             FROM member_notes mn LEFT JOIN users u ON u.id = mn.user_id LEFT JOIN users a ON a.id = mn.author_id
             WHERE mn.id = ? AND mn.tenant_id = ?",
            [$noteId, $tenantId]
        );

        return $this->respondWithData($note);
    }

    /** PUT /api/v2/admin/crm/notes/{id} */
    public function updateNote($id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $id = (int) $id;

        $note = DB::selectOne("SELECT id FROM member_notes WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
        if (!$note) {
            return $this->respondWithError('NOT_FOUND', __('api.note_not_found'), null, 404);
        }

        $updates = [];
        $params = [];

        $content = $this->input('content');
        if ($content !== null) {
            $updates[] = "content = ?";
            $params[] = trim($content);
        }

        $category = $this->input('category');
        $validCategories = ['general', 'outreach', 'support', 'onboarding', 'concern', 'follow_up'];
        if ($category !== null && in_array($category, $validCategories, true)) {
            $updates[] = "category = ?";
            $params[] = $category;
        }

        $isPinned = $this->input('is_pinned');
        if ($isPinned !== null) {
            $updates[] = "is_pinned = ?";
            $params[] = (int) $isPinned;
        }

        if (empty($updates)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.no_fields_to_update'), null, 400);
        }

        $params[] = $id;
        $params[] = $tenantId;
        DB::update("UPDATE member_notes SET " . implode(', ', $updates) . " WHERE id = ? AND tenant_id = ?", $params);

        $updated = DB::selectOne(
            "SELECT mn.*, u.name as user_name, u.avatar_url as user_avatar, a.name as author_name
             FROM member_notes mn LEFT JOIN users u ON u.id = mn.user_id LEFT JOIN users a ON a.id = mn.author_id
             WHERE mn.id = ? AND mn.tenant_id = ?",
            [$id, $tenantId]
        );

        return $this->respondWithData($updated);
    }

    /** DELETE /api/v2/admin/crm/notes/{id} */
    public function deleteNote($id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $id = (int) $id;

        $note = DB::selectOne("SELECT id FROM member_notes WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
        if (!$note) {
            return $this->respondWithError('NOT_FOUND', __('api.note_not_found'), null, 404);
        }

        DB::delete("DELETE FROM member_notes WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);

        return $this->respondWithData(['deleted' => true]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Coordinator Tasks
    // ─────────────────────────────────────────────────────────────────────────

    /** GET /api/v2/admin/crm/tasks */
    public function listTasks(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $status = $this->query('status');
        $priority = $this->query('priority');
        $assignedTo = $this->queryInt('assigned_to');
        $search = $this->query('search');
        $page = max(1, $this->queryInt('page', 1));
        $limit = min(100, max(1, $this->queryInt('limit', 20)));
        $offset = ($page - 1) * $limit;

        $where = "ct.tenant_id = ?";
        $params = [$tenantId];

        $validStatuses = ['pending', 'in_progress', 'completed', 'cancelled'];
        if ($status && in_array($status, $validStatuses, true)) {
            $where .= " AND ct.status = ?";
            $params[] = $status;
        }

        $validPriorities = ['low', 'medium', 'high', 'urgent'];
        if ($priority && in_array($priority, $validPriorities, true)) {
            $where .= " AND ct.priority = ?";
            $params[] = $priority;
        }

        if ($assignedTo) {
            $where .= " AND ct.assigned_to = ?";
            $params[] = $assignedTo;
        }

        if ($search && mb_strlen($search) >= 2) {
            $escaped = str_replace(['%', '_'], ['\\%', '\\_'], $search);
            $searchTerm = '%' . $escaped . '%';
            $where .= " AND (ct.title LIKE ? ESCAPE '\\\\' OR ct.description LIKE ? ESCAPE '\\\\')";
            $params[] = $searchTerm;
            $params[] = $searchTerm;
        }

        $total = (int) DB::selectOne("SELECT COUNT(*) as cnt FROM coordinator_tasks ct WHERE {$where}", $params)->cnt;

        $dataParams = array_merge($params, [$limit, $offset]);
        $tasks = DB::select(
            "SELECT ct.*, assigned.name as assigned_to_name, creator.name as created_by_name,
                    member.name as user_name, member.avatar_url as user_avatar
             FROM coordinator_tasks ct
             LEFT JOIN users assigned ON assigned.id = ct.assigned_to
             LEFT JOIN users creator ON creator.id = ct.created_by
             LEFT JOIN users member ON member.id = ct.user_id
             WHERE {$where}
             ORDER BY
                CASE ct.status WHEN 'pending' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'completed' THEN 2 WHEN 'cancelled' THEN 3 END,
                CASE ct.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
                ct.due_date ASC, ct.created_at DESC
             LIMIT ? OFFSET ?",
            $dataParams
        );
        $tasks = array_map(fn($r) => (array)$r, $tasks);

        return $this->respondWithPaginatedCollection($tasks, $total, $page, $limit);
    }

    /** POST /api/v2/admin/crm/tasks */
    public function createTask(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $title = trim($this->input('title', ''));
        $assignedTo = (int) $this->input('assigned_to', $adminId);

        if (!$title) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.title_is_required'), null, 400);
        }

        // Validate assignee belongs to this tenant
        $assignee = DB::selectOne("SELECT id FROM users WHERE id = ? AND tenant_id = ?", [$assignedTo, $tenantId]);
        if (!$assignee) {
            $assignedTo = $adminId; // fallback to current admin
        }

        $validPriorities = ['low', 'medium', 'high', 'urgent'];
        $priority = in_array($this->input('priority', ''), $validPriorities, true) ? $this->input('priority') : 'medium';

        $userId = $this->input('user_id') ? (int) $this->input('user_id') : null;
        $dueDate = $this->input('due_date') ? trim($this->input('due_date')) : null;
        $description = $this->input('description') ? trim($this->input('description')) : null;

        if ($dueDate && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $dueDate)) {
            $dueDate = null;
        }

        DB::insert(
            "INSERT INTO coordinator_tasks (tenant_id, assigned_to, user_id, title, description, priority, status, due_date, created_by)
             VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
            [$tenantId, $assignedTo, $userId, $title, $description, $priority, $dueDate, $adminId]
        );

        $taskId = (int) DB::getPdo()->lastInsertId();

        $task = DB::selectOne(
            "SELECT ct.*, assigned.name as assigned_to_name, creator.name as created_by_name,
                    member.name as user_name, member.avatar_url as user_avatar
             FROM coordinator_tasks ct
             LEFT JOIN users assigned ON assigned.id = ct.assigned_to
             LEFT JOIN users creator ON creator.id = ct.created_by
             LEFT JOIN users member ON member.id = ct.user_id
             WHERE ct.id = ? AND ct.tenant_id = ?",
            [$taskId, $tenantId]
        );

        return $this->respondWithData($task);
    }

    /** PUT /api/v2/admin/crm/tasks/{id} */
    public function updateTask($id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $id = (int) $id;

        $task = DB::selectOne("SELECT id, status FROM coordinator_tasks WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
        if (!$task) {
            return $this->respondWithError('NOT_FOUND', __('api.task_not_found'), null, 404);
        }

        $updates = [];
        $params = [];

        $title = $this->input('title');
        if ($title !== null) { $updates[] = "title = ?"; $params[] = trim($title); }

        $description = $this->input('description');
        if ($description !== null) { $updates[] = "description = ?"; $params[] = trim($description); }

        $priority = $this->input('priority');
        $validPriorities = ['low', 'medium', 'high', 'urgent'];
        if ($priority !== null && in_array($priority, $validPriorities, true)) {
            $updates[] = "priority = ?"; $params[] = $priority;
        }

        $status = $this->input('status');
        $validStatuses = ['pending', 'in_progress', 'completed', 'cancelled'];
        if ($status !== null && in_array($status, $validStatuses, true)) {
            $updates[] = "status = ?"; $params[] = $status;
            if ($status === 'completed') {
                $updates[] = "completed_at = NOW()";
            } elseif ($task->status === 'completed') {
                $updates[] = "completed_at = NULL";
            }
        }

        $assignedTo = $this->input('assigned_to');
        if ($assignedTo !== null) {
            $assignee = DB::selectOne("SELECT id FROM users WHERE id = ? AND tenant_id = ?", [(int) $assignedTo, $tenantId]);
            if ($assignee) {
                $updates[] = "assigned_to = ?"; $params[] = (int) $assignedTo;
            }
        }

        if (request()->has('due_date')) {
            $dueDate = $this->input('due_date');
            if (!$dueDate) {
                $updates[] = "due_date = NULL";
            } elseif (preg_match('/^\d{4}-\d{2}-\d{2}$/', $dueDate)) {
                $updates[] = "due_date = ?"; $params[] = $dueDate;
            }
        }

        if (request()->has('user_id')) {
            $userIdInput = $this->input('user_id');
            $updates[] = "user_id = ?"; $params[] = $userIdInput ? (int) $userIdInput : null;
        }

        if (empty($updates)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.no_fields_to_update'), null, 400);
        }

        $params[] = $id;
        $params[] = $tenantId;
        DB::update("UPDATE coordinator_tasks SET " . implode(', ', $updates) . " WHERE id = ? AND tenant_id = ?", $params);

        $updated = DB::selectOne(
            "SELECT ct.*, assigned.name as assigned_to_name, creator.name as created_by_name,
                    member.name as user_name, member.avatar_url as user_avatar
             FROM coordinator_tasks ct
             LEFT JOIN users assigned ON assigned.id = ct.assigned_to
             LEFT JOIN users creator ON creator.id = ct.created_by
             LEFT JOIN users member ON member.id = ct.user_id
             WHERE ct.id = ? AND ct.tenant_id = ?",
            [$id, $tenantId]
        );

        return $this->respondWithData($updated);
    }

    /** DELETE /api/v2/admin/crm/tasks/{id} */
    public function deleteTask($id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $id = (int) $id;

        $task = DB::selectOne("SELECT id FROM coordinator_tasks WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
        if (!$task) {
            return $this->respondWithError('NOT_FOUND', __('api.task_not_found'), null, 404);
        }

        DB::delete("DELETE FROM coordinator_tasks WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);

        return $this->respondWithData(['deleted' => true]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Member Tags
    // ─────────────────────────────────────────────────────────────────────────

    /** GET /api/v2/admin/crm/tags */
    public function listTags(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $userId = $this->queryInt('user_id');
        $tagFilter = $this->query('tag');

        if ($userId) {
            $tags = DB::select(
                "SELECT mt.*, u.name as user_name FROM member_tags mt LEFT JOIN users u ON u.id = mt.user_id
                 WHERE mt.tenant_id = ? AND mt.user_id = ? ORDER BY mt.tag ASC",
                [$tenantId, $userId]
            );
            $tags = array_map(fn($r) => (array)$r, $tags);
        } elseif ($tagFilter) {
            $tags = DB::select(
                "SELECT mt.*, u.name as user_name, u.avatar_url as user_avatar FROM member_tags mt LEFT JOIN users u ON u.id = mt.user_id
                 WHERE mt.tenant_id = ? AND mt.tag = ? ORDER BY mt.created_at DESC",
                [$tenantId, $tagFilter]
            );
            $tags = array_map(fn($r) => (array)$r, $tags);
        } else {
            $tags = DB::select(
                "SELECT tag, COUNT(*) as member_count FROM member_tags WHERE tenant_id = ? GROUP BY tag ORDER BY member_count DESC",
                [$tenantId]
            );
            $tags = array_map(fn($r) => (array)$r, $tags);
        }

        return $this->respondWithCollection($tags);
    }

    /** POST /api/v2/admin/crm/tags */
    public function addTag(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $userId = (int) $this->input('user_id', 0);
        $tag = trim($this->input('tag', ''));

        if (!$userId || !$tag) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.user_id_tag_required'), null, 400);
        }

        if (mb_strlen($tag) > 50) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.tag_max_length'), null, 400);
        }

        $user = DB::selectOne("SELECT id FROM users WHERE id = ? AND tenant_id = ?", [$userId, $tenantId]);
        if (!$user) {
            return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
        }

        try {
            DB::insert(
                "INSERT INTO member_tags (tenant_id, user_id, tag, created_by) VALUES (?, ?, ?, ?)",
                [$tenantId, $userId, $tag, $adminId]
            );
        } catch (\Throwable $e) {
            if (strpos($e->getMessage(), 'Duplicate') !== false) {
                return $this->respondWithError('RESOURCE_ALREADY_EXISTS', __('api.tag_already_assigned'), null, 409);
            }
            throw $e;
        }

        $tagId = (int) DB::getPdo()->lastInsertId();

        return $this->respondWithData([
            'id' => $tagId, 'tenant_id' => $tenantId,
            'user_id' => $userId, 'tag' => $tag, 'created_by' => $adminId,
        ]);
    }

    /** DELETE /api/v2/admin/crm/tags/bulk */
    public function bulkRemoveTag(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $tag = trim($this->query('tag', ''));
        if (!$tag) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.tag_param_required'), null, 400);
        }

        $count = (int) DB::selectOne("SELECT COUNT(*) as cnt FROM member_tags WHERE tenant_id = ? AND tag = ?", [$tenantId, $tag])->cnt;
        if ($count === 0) {
            return $this->respondWithError('NOT_FOUND', __('api.tag_not_found'), null, 404);
        }

        DB::delete("DELETE FROM member_tags WHERE tenant_id = ? AND tag = ?", [$tenantId, $tag]);

        return $this->respondWithData(['deleted' => $count]);
    }

    /** DELETE /api/v2/admin/crm/tags/{id} */
    public function removeTag($id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $id = (int) $id;

        $tag = DB::selectOne("SELECT id FROM member_tags WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
        if (!$tag) {
            return $this->respondWithError('NOT_FOUND', __('api.tag_not_found'), null, 404);
        }

        DB::delete("DELETE FROM member_tags WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);

        return $this->respondWithData(['deleted' => true]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Activity Timeline
    // ─────────────────────────────────────────────────────────────────────────

    /** GET /api/v2/admin/crm/timeline */
    public function timeline(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $userId = $this->queryInt('user_id');
        $type = $this->query('type');
        $allowedTypes = ['login', 'signup', 'listing_created', 'exchange_completed', 'note_added', 'task_created', 'group_joined', 'profile_updated'];
        if ($type && !in_array($type, $allowedTypes, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_2.admin_crm.invalid_type'), null, 400);
        }
        $days = $this->queryInt('days', 30);
        $page = max(1, $this->queryInt('page', 1));
        $limit = min(100, max(1, $this->queryInt('limit', 25)));
        $offset = ($page - 1) * $limit;

        $unions = [];
        $params = [];
        $countParams = [];
        $safeDays = (int) $days;
        $useDayFilter = $safeDays > 0;
        $nullText = "CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci";
        $emptyDescriptionParams = "CONVERT('{}' USING utf8mb4) COLLATE utf8mb4_unicode_ci";

        // 1. Logins
        if (!$type || $type === 'login') {
            $activityAt = "COALESCE(up.last_activity_at, u.last_active_at, u.last_login_at)";
            $sql = "SELECT CONVERT('login' USING utf8mb4) COLLATE utf8mb4_unicode_ci as activity_type, u.id as user_id,
                     CONVERT(u.name USING utf8mb4) COLLATE utf8mb4_unicode_ci as user_name,
                     CONVERT(u.avatar_url USING utf8mb4) COLLATE utf8mb4_unicode_ci as user_avatar,
                     {$emptyDescriptionParams} as description_params, {$nullText} as metadata, {$activityAt} as created_at
                     FROM users u
                     LEFT JOIN user_presence up ON up.tenant_id = u.tenant_id AND up.user_id = u.id
                     WHERE u.tenant_id = ? AND {$activityAt} IS NOT NULL";
            $p = [$tenantId]; $cp = [$tenantId];
            if ($userId) { $sql .= " AND u.id = ?"; $p[] = $userId; $cp[] = $userId; }
            if ($useDayFilter) { $sql .= " AND {$activityAt} >= DATE_SUB(NOW(), INTERVAL ? DAY)"; $p[] = $safeDays; $cp[] = $safeDays; }
            $this->appendTimelineBranch($unions, $params, $countParams, $sql, $p, $cp);
        }

        // 2. Signups
        if (!$type || $type === 'signup') {
            $sql = "SELECT CONVERT('signup' USING utf8mb4) COLLATE utf8mb4_unicode_ci as activity_type, u.id as user_id,
                     CONVERT(u.name USING utf8mb4) COLLATE utf8mb4_unicode_ci as user_name,
                     CONVERT(u.avatar_url USING utf8mb4) COLLATE utf8mb4_unicode_ci as user_avatar,
                     {$emptyDescriptionParams} as description_params, {$nullText} as metadata, u.created_at as created_at
                     FROM users u WHERE u.tenant_id = ?";
            $p = [$tenantId]; $cp = [$tenantId];
            if ($userId) { $sql .= " AND u.id = ?"; $p[] = $userId; $cp[] = $userId; }
            if ($useDayFilter) { $sql .= " AND u.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)"; $p[] = $safeDays; $cp[] = $safeDays; }
            $this->appendTimelineBranch($unions, $params, $countParams, $sql, $p, $cp);
        }

        // 3. Listings created
        if (!$type || $type === 'listing_created') {
            try {
                DB::selectOne("SELECT 1 FROM listings LIMIT 1");
                $sql = "SELECT CONVERT('listing_created' USING utf8mb4) COLLATE utf8mb4_unicode_ci as activity_type, l.user_id,
                         CONVERT(u.name USING utf8mb4) COLLATE utf8mb4_unicode_ci as user_name,
                         CONVERT(u.avatar_url USING utf8mb4) COLLATE utf8mb4_unicode_ci as user_avatar,
                         CONVERT(JSON_OBJECT('title', l.title) USING utf8mb4) COLLATE utf8mb4_unicode_ci as description_params, {$nullText} as metadata, l.created_at
                         FROM listings l LEFT JOIN users u ON u.id = l.user_id WHERE l.tenant_id = ?";
                $p = [$tenantId]; $cp = [$tenantId];
                if ($userId) { $sql .= " AND l.user_id = ?"; $p[] = $userId; $cp[] = $userId; }
                if ($useDayFilter) { $sql .= " AND l.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)"; $p[] = $safeDays; $cp[] = $safeDays; }
                $this->appendTimelineBranch($unions, $params, $countParams, $sql, $p, $cp);
            } catch (\Throwable $e) { Log::warning('Stats query failed in ' . __METHOD__, ['error' => $e->getMessage()]); }
        }

        // 4. Exchanges completed
        if (!$type || $type === 'exchange_completed') {
            try {
                DB::selectOne("SELECT 1 FROM transactions LIMIT 1");
                $sql = "SELECT CONVERT('exchange_completed' USING utf8mb4) COLLATE utf8mb4_unicode_ci as activity_type, t.sender_id as user_id,
                         CONVERT(u.name USING utf8mb4) COLLATE utf8mb4_unicode_ci as user_name,
                         CONVERT(u.avatar_url USING utf8mb4) COLLATE utf8mb4_unicode_ci as user_avatar,
                         CONVERT(JSON_OBJECT('member_name', r.name) USING utf8mb4) COLLATE utf8mb4_unicode_ci as description_params, {$nullText} as metadata, t.created_at
                         FROM transactions t LEFT JOIN users u ON u.id = t.sender_id LEFT JOIN users r ON r.id = t.receiver_id
                         WHERE t.tenant_id = ? AND t.status = 'completed'";
                $p = [$tenantId]; $cp = [$tenantId];
                if ($userId) { $sql .= " AND t.sender_id = ?"; $p[] = $userId; $cp[] = $userId; }
                if ($useDayFilter) { $sql .= " AND t.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)"; $p[] = $safeDays; $cp[] = $safeDays; }
                $this->appendTimelineBranch($unions, $params, $countParams, $sql, $p, $cp);
            } catch (\Throwable $e) { Log::warning('Stats query failed in ' . __METHOD__, ['error' => $e->getMessage()]); }
        }

        // 5. Notes added
        if (!$type || $type === 'note_added') {
            try {
                DB::selectOne("SELECT 1 FROM member_notes LIMIT 1");
                $sql = "SELECT CONVERT('note_added' USING utf8mb4) COLLATE utf8mb4_unicode_ci as activity_type, mn.user_id,
                         CONVERT(u.name USING utf8mb4) COLLATE utf8mb4_unicode_ci as user_name,
                         CONVERT(u.avatar_url USING utf8mb4) COLLATE utf8mb4_unicode_ci as user_avatar,
                         CONVERT(JSON_OBJECT('author_name', a.name, 'content', LEFT(COALESCE(mn.content, ''), 80)) USING utf8mb4) COLLATE utf8mb4_unicode_ci as description_params, {$nullText} as metadata, mn.created_at
                         FROM member_notes mn LEFT JOIN users u ON u.id = mn.user_id LEFT JOIN users a ON a.id = mn.author_id
                         WHERE mn.tenant_id = ?";
                $p = [$tenantId]; $cp = [$tenantId];
                if ($userId) { $sql .= " AND mn.user_id = ?"; $p[] = $userId; $cp[] = $userId; }
                if ($useDayFilter) { $sql .= " AND mn.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)"; $p[] = $safeDays; $cp[] = $safeDays; }
                $this->appendTimelineBranch($unions, $params, $countParams, $sql, $p, $cp);
            } catch (\Throwable $e) { Log::warning('Stats query failed in ' . __METHOD__, ['error' => $e->getMessage()]); }
        }

        // 6. Tasks created
        if (!$type || $type === 'task_created') {
            try {
                DB::selectOne("SELECT 1 FROM coordinator_tasks LIMIT 1");
                $sql = "SELECT CONVERT('task_created' USING utf8mb4) COLLATE utf8mb4_unicode_ci as activity_type, ct.created_by as user_id,
                         CONVERT(u.name USING utf8mb4) COLLATE utf8mb4_unicode_ci as user_name,
                         CONVERT(u.avatar_url USING utf8mb4) COLLATE utf8mb4_unicode_ci as user_avatar,
                         CONVERT(JSON_OBJECT('title', ct.title) USING utf8mb4) COLLATE utf8mb4_unicode_ci as description_params, {$nullText} as metadata, ct.created_at
                         FROM coordinator_tasks ct LEFT JOIN users u ON u.id = ct.created_by WHERE ct.tenant_id = ?";
                $p = [$tenantId]; $cp = [$tenantId];
                if ($userId) { $sql .= " AND ct.created_by = ?"; $p[] = $userId; $cp[] = $userId; }
                if ($useDayFilter) { $sql .= " AND ct.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)"; $p[] = $safeDays; $cp[] = $safeDays; }
                $this->appendTimelineBranch($unions, $params, $countParams, $sql, $p, $cp);
            } catch (\Throwable $e) { Log::warning('Stats query failed in ' . __METHOD__, ['error' => $e->getMessage()]); }
        }

        // 7. Group joins
        if (!$type || $type === 'group_joined') {
            try {
                DB::selectOne("SELECT 1 FROM group_members LIMIT 1");
                $sql = "SELECT CONVERT('group_joined' USING utf8mb4) COLLATE utf8mb4_unicode_ci as activity_type, gm.user_id,
                         CONVERT(u.name USING utf8mb4) COLLATE utf8mb4_unicode_ci as user_name,
                         CONVERT(u.avatar_url USING utf8mb4) COLLATE utf8mb4_unicode_ci as user_avatar,
                         CONVERT(JSON_OBJECT('group_name', g.name) USING utf8mb4) COLLATE utf8mb4_unicode_ci as description_params, {$nullText} as metadata, gm.created_at
                         FROM group_members gm LEFT JOIN users u ON u.id = gm.user_id
                         INNER JOIN `groups` g ON g.id = gm.group_id AND g.tenant_id = ? WHERE 1=1";
                $p = [$tenantId]; $cp = [$tenantId];
                if ($userId) { $sql .= " AND gm.user_id = ?"; $p[] = $userId; $cp[] = $userId; }
                if ($useDayFilter) { $sql .= " AND gm.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)"; $p[] = $safeDays; $cp[] = $safeDays; }
                $this->appendTimelineBranch($unions, $params, $countParams, $sql, $p, $cp);
            } catch (\Throwable $e) { Log::warning('Stats query failed in ' . __METHOD__, ['error' => $e->getMessage()]); }
        }

        // 8. Profile updates
        if (!$type || $type === 'profile_updated') {
            $sql = "SELECT CONVERT('profile_updated' USING utf8mb4) COLLATE utf8mb4_unicode_ci as activity_type, u.id as user_id,
                     CONVERT(u.name USING utf8mb4) COLLATE utf8mb4_unicode_ci as user_name,
                     CONVERT(u.avatar_url USING utf8mb4) COLLATE utf8mb4_unicode_ci as user_avatar,
                     {$emptyDescriptionParams} as description_params, {$nullText} as metadata, u.updated_at as created_at
                     FROM users u WHERE u.tenant_id = ? AND u.updated_at > u.created_at";
            $p = [$tenantId]; $cp = [$tenantId];
            if ($userId) { $sql .= " AND u.id = ?"; $p[] = $userId; $cp[] = $userId; }
            if ($useDayFilter) { $sql .= " AND u.updated_at >= DATE_SUB(NOW(), INTERVAL ? DAY)"; $p[] = $safeDays; $cp[] = $safeDays; }
            $this->appendTimelineBranch($unions, $params, $countParams, $sql, $p, $cp);
        }

        if (empty($unions)) {
            return $this->respondWithPaginatedCollection([], 0, $page, $limit);
        }

        try {
            $unionSql = implode(" UNION ALL ", $unions);

            $total = (int) DB::selectOne("SELECT COUNT(*) as cnt FROM ({$unionSql}) AS timeline", $countParams)->cnt;

            $entries = DB::select("SELECT * FROM ({$unionSql}) AS timeline ORDER BY created_at DESC LIMIT " . (int) $limit . " OFFSET " . (int) $offset, $params);
            $entries = array_map(fn($r) => (array)$r, $entries);

            foreach ($entries as $i => &$entry) {
                $entry['id'] = ($page - 1) * $limit + $i + 1;
                $entry['description_code'] = $entry['activity_type'];
                $descriptionParams = json_decode((string) ($entry['description_params'] ?? '{}'), true);
                $entry['description_params'] = is_array($descriptionParams) ? $descriptionParams : [];
            }
            unset($entry);

            return $this->respondWithPaginatedCollection($entries, $total, $page, $limit);
        } catch (\Throwable $e) {
            Log::warning('CRM timeline query failed', ['error' => $e->getMessage()]);
            return $this->respondWithPaginatedCollection([], 0, $page, $limit);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CSV Exports
    // ─────────────────────────────────────────────────────────────────────────

    /** GET /api/v2/admin/crm/export/notes */
    public function exportNotes(): StreamedResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $notes = DB::select(
            "SELECT mn.id, mn.user_id, u.name as user_name, mn.content, mn.category,
                    mn.is_pinned, a.name as author_name, mn.created_at, mn.updated_at
             FROM member_notes mn LEFT JOIN users u ON u.id = mn.user_id LEFT JOIN users a ON a.id = mn.author_id
             WHERE mn.tenant_id = ? ORDER BY mn.created_at DESC",
            [$tenantId]
        );
        $notes = array_map(fn($r) => (array)$r, $notes);

        return $this->streamCsv('crm-notes', ['ID', 'User ID', 'User Name', 'Content', 'Category', 'Pinned', 'Author', 'Created', 'Updated'], $notes);
    }

    /** GET /api/v2/admin/crm/export/tasks */
    public function exportTasks(): StreamedResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $tasks = DB::select(
            "SELECT ct.id, ct.title, ct.description, ct.priority, ct.status,
                    assigned.name as assigned_to_name, member.name as related_member,
                    ct.due_date, ct.completed_at, creator.name as created_by_name, ct.created_at
             FROM coordinator_tasks ct
             LEFT JOIN users assigned ON assigned.id = ct.assigned_to
             LEFT JOIN users creator ON creator.id = ct.created_by
             LEFT JOIN users member ON member.id = ct.user_id
             WHERE ct.tenant_id = ? ORDER BY ct.created_at DESC",
            [$tenantId]
        );
        $tasks = array_map(fn($r) => (array)$r, $tasks);

        return $this->streamCsv('crm-tasks', ['ID', 'Title', 'Description', 'Priority', 'Status', 'Assigned To', 'Related Member', 'Due Date', 'Completed At', 'Created By', 'Created'], $tasks);
    }

    /** GET /api/v2/admin/crm/export/dashboard */
    public function exportDashboard(): StreamedResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $memberStats = $this->getMemberStats($tenantId);

        $rows = [
            ['metric' => __('admin.label_total_members'), 'value' => $memberStats['total_members']],
            ['metric' => __('admin.label_active_members'), 'value' => $memberStats['active_members']],
            ['metric' => __('admin.label_new_this_month'), 'value' => $memberStats['new_this_month']],
            ['metric' => __('admin.label_pending_approvals'), 'value' => $memberStats['pending_approvals']],
            ['metric' => __('admin.label_retention_rate'), 'value' => $memberStats['retention_rate'] . '%'],
        ];

        return $this->streamCsv('crm-dashboard', ['Metric', 'Value'], $rows);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    private function appendTimelineBranch(
        array &$unions,
        array &$params,
        array &$countParams,
        string $sql,
        array $branchParams,
        array $countBranchParams
    ): void {
        if (!$this->canRunTimelineBranch($sql, $branchParams)) {
            return;
        }

        $unions[] = $sql;
        $params = array_merge($params, $branchParams);
        $countParams = array_merge($countParams, $countBranchParams);
    }

    private function canRunTimelineBranch(string $sql, array $params): bool
    {
        try {
            DB::select("SELECT 1 FROM ({$sql}) AS timeline_branch LIMIT 1", $params);

            return true;
        } catch (\Throwable $e) {
            Log::warning('CRM timeline branch skipped', [
                'error' => $e->getMessage(),
                'sql' => $sql,
            ]);

            return false;
        }
    }

    private function getMemberStats(int $tenantId): array
    {
        $memberWhere = $this->approvedActiveMemberWhere('u');
        $recentActivityWhere = $this->recentMemberActivityWhere('u');

        $totalMembers = (int) DB::selectOne(
            "SELECT COUNT(*) as cnt
             FROM users u
             WHERE {$memberWhere}",
            [$tenantId]
        )->cnt;

        $activeMembers = (int) DB::selectOne(
            "SELECT COUNT(*) as cnt
             FROM users u
             WHERE {$memberWhere}
               AND ({$recentActivityWhere})",
            [$tenantId]
        )->cnt;

        $newThisMonth = (int) DB::selectOne(
            "SELECT COUNT(*) as cnt
             FROM users u
             WHERE {$memberWhere}
               AND u.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')",
            [$tenantId]
        )->cnt;

        $pendingApprovals = (int) DB::selectOne(
            "SELECT COUNT(*) as cnt
             FROM users u
             WHERE u.tenant_id = ?
               AND u.is_approved = 0",
            [$tenantId]
        )->cnt;

        $neverLoggedIn = (int) DB::selectOne(
            "SELECT COUNT(*) as cnt
             FROM users u
             WHERE {$memberWhere}
               AND u.last_login_at IS NULL",
            [$tenantId]
        )->cnt;

        $activityRate = $totalMembers > 0
            ? round(($activeMembers / $totalMembers) * 100, 1)
            : 0;

        return [
            'total_members' => $totalMembers,
            'active_members' => $activeMembers,
            'new_this_month' => $newThisMonth,
            'pending_approvals' => $pendingApprovals,
            'never_logged_in' => $neverLoggedIn,
            'retention_rate' => $activityRate,
        ];
    }

    private function approvedActiveMemberWhere(string $alias = 'u'): string
    {
        $prefix = $alias !== '' ? $alias . '.' : '';

        return "{$prefix}tenant_id = ? AND {$prefix}is_approved = 1 AND ({$prefix}status IS NULL OR {$prefix}status = 'active')";
    }

    private function recentMemberActivityWhere(string $alias = 'u'): string
    {
        $prefix = $alias !== '' ? $alias . '.' : '';

        return "EXISTS (
                    SELECT 1
                    FROM user_presence up
                    WHERE up.tenant_id = {$prefix}tenant_id
                      AND up.user_id = {$prefix}id
                      AND up.last_activity_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                )
                OR {$prefix}last_active_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                OR {$prefix}last_login_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)";
    }

    private function streamCsv(string $filename, array $headers, array $rows): StreamedResponse
    {
        $date = date('Y-m-d');
        return new StreamedResponse(function () use ($headers, $rows) {
            $output = fopen('php://output', 'w');
            \App\Support\CsvExportSanitizer::put($output, $headers);
            foreach ($rows as $row) {
                \App\Support\CsvExportSanitizer::put($output, array_values($row));
            }
            fclose($output);
        }, 200, [
            'Content-Type' => 'text/csv; charset=utf-8',
            'Content-Disposition' => "attachment; filename=\"{$filename}-{$date}.csv\"",
            'Cache-Control' => 'no-cache, no-store, must-revalidate',
        ]);
    }
}
