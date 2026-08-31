<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Models\ActivityLog;
use App\Models\Notification;

/**
 * AdminCommentsController -- Admin comment moderation.
 *
 * Moderate comments across all content types.
 * All endpoints require admin authentication.
 * Super admins can operate across all tenants.
 */
class AdminCommentsController extends BaseApiController
{
    protected bool $isV2Api = true;

    /**
     * Check if the current user is a super admin.
     */
    private function isSuperAdmin(): bool
    {
        $user = \Illuminate\Support\Facades\Auth::user();
        if (!$user) return false;
        $role = (string)($user->role ?? '');
        return !empty($user->is_super_admin)
            || !empty($user->is_god)
            || in_array($role, ['super_admin', 'god'], true);
    }

    /**
     * Resolve effective tenant ID for admin filtering.
     * Super admins can pass ?tenant_id=all or ?tenant_id=N.
     * Regular admins are locked to their tenant.
     */
    private function resolveEffectiveTenantId(bool $isSuperAdmin, int $tenantId): ?int
    {
        $filterRaw = $this->query('tenant_id');

        if ($isSuperAdmin) {
            if ($filterRaw === 'all') {
                return null;
            }
            if ($filterRaw !== null && is_numeric($filterRaw)) {
                return (int) $filterRaw;
            }
            return $tenantId;
        }

        return $tenantId;
    }

    /**
     * GET /api/v2/admin/comments
     *
     * Query params: page, limit, target_type, search, tenant_id (super admin only)
     */
    /**
     * Self-dealing guard: a broker/coordinator must not moderate a comment
     * they wrote themselves (they could otherwise scrub their own record).
     * Admin tiers retain full latitude. Mirrors the match-approval and
     * balance-adjustment guards. See BrokerModerationAuthorizationTest.
     */
    private function guardBrokerNotAuthor(int $authorId, int $callerId): ?JsonResponse
    {
        if ($this->callerIsAdminTier()) {
            return null;
        }
        if ($authorId === $callerId) {
            return $this->respondWithError('AUTH_INSUFFICIENT_PERMISSIONS', __('api.broker_cannot_moderate_own_content'), null, 403);
        }
        return null;
    }

    public function index(): JsonResponse
    {
        $this->requireBrokerOrAdmin();
        $superAdmin = $this->isSuperAdmin();
        $tenantId = $this->getTenantId();

        $page = $this->queryInt('page', 1, 1);
        $limit = $this->queryInt('limit', 20, 1, 100);
        $offset = ($page - 1) * $limit;
        $targetType = $this->query('target_type');
        $search = $this->query('search');

        $conditions = [];
        $params = [];

        $effectiveTenantId = $this->resolveEffectiveTenantId($superAdmin, $tenantId);
        if ($effectiveTenantId !== null) {
            $conditions[] = 'c.tenant_id = ?';
            $params[] = $effectiveTenantId;
        }

        if ($targetType) {
            $conditions[] = 'c.target_type = ?';
            $params[] = $targetType;
        }

        if ($search) {
            $conditions[] = '(c.content LIKE ? OR u.name LIKE ?)';
            $searchPattern = '%' . $search . '%';
            $params[] = $searchPattern;
            $params[] = $searchPattern;
        }

        // Safety: $where is assembled from hardcoded SQL fragments only.
        // All user-supplied values (search, targetType, effectiveTenantId) are bound
        // via parameterised ? placeholders — never interpolated into the SQL string.
        $where = !empty($conditions) ? implode(' AND ', $conditions) : '1=1';

        $total = (int) DB::selectOne(
            "SELECT COUNT(*) as total FROM comments c LEFT JOIN users u ON c.user_id = u.id WHERE {$where}",
            $params
        )->total;

        $comments = DB::select(
            "SELECT c.*, u.name as user_name, u.avatar_url as user_avatar, t.name as tenant_name
             FROM comments c
             LEFT JOIN users u ON c.user_id = u.id
             LEFT JOIN tenants t ON c.tenant_id = t.id
             WHERE {$where}
             ORDER BY c.created_at DESC
             LIMIT ? OFFSET ?",
            array_merge($params, [$limit, $offset])
        );

        $formatted = array_map(function ($comment) {
            return [
                'id' => (int) $comment->id,
                'user_id' => (int) $comment->user_id,
                'tenant_id' => (int) $comment->tenant_id,
                'tenant_name' => $comment->tenant_name ?? 'Unknown',
                'user_name' => $comment->user_name ?? 'Unknown',
                'user_avatar' => $comment->user_avatar,
                'target_type' => $comment->target_type,
                'target_id' => (int) $comment->target_id,
                'parent_id' => $comment->parent_id ? (int) $comment->parent_id : null,
                'content' => $comment->content,
                'created_at' => $comment->created_at,
                'updated_at' => $comment->updated_at ?? $comment->created_at,
            ];
        }, $comments);

        return $this->respondWithPaginatedCollection($formatted, $total, $page, $limit);
    }

    /**
     * GET /api/v2/admin/comments/{id}
     */
    public function show(int $id): JsonResponse
    {
        $this->requireBrokerOrAdmin();
        $superAdmin = $this->isSuperAdmin();
        $tenantId = $this->getTenantId();

        $effectiveTenantId = $this->resolveEffectiveTenantId($superAdmin, $tenantId);
        // Safety: $tenantWhere is a hardcoded literal string ('AND c.tenant_id = ?' or '').
        // The tenant ID value is bound via parameterised placeholder, not interpolated.
        $tenantWhere = $effectiveTenantId !== null ? 'AND c.tenant_id = ?' : '';
        $tenantParams = $effectiveTenantId !== null ? [$effectiveTenantId] : [];

        $comment = DB::selectOne(
            "SELECT c.*, u.name as user_name, u.email as user_email, u.avatar_url as user_avatar, t.name as tenant_name
             FROM comments c
             LEFT JOIN users u ON c.user_id = u.id
             LEFT JOIN tenants t ON c.tenant_id = t.id
             WHERE c.id = ? {$tenantWhere}",
            array_merge([$id], $tenantParams)
        );

        if (!$comment) {
            return $this->respondWithError('NOT_FOUND', __('api.comment_not_found'), null, 404);
        }

        return $this->respondWithData([
            'id' => (int) $comment->id,
            'user_id' => (int) $comment->user_id,
            'tenant_id' => (int) $comment->tenant_id,
            'tenant_name' => $comment->tenant_name ?? 'Unknown',
            'user_name' => $comment->user_name ?? 'Unknown',
            'user_email' => $comment->user_email,
            'user_avatar' => $comment->user_avatar,
            'target_type' => $comment->target_type,
            'target_id' => (int) $comment->target_id,
            'parent_id' => $comment->parent_id ? (int) $comment->parent_id : null,
            'content' => $comment->content,
            'created_at' => $comment->created_at,
            'updated_at' => $comment->updated_at ?? $comment->created_at,
        ]);
    }

    /**
     * POST /api/v2/admin/comments/{id}/hide
     * Hides a comment using the feed_hidden table (target_type='comment')
     */
    public function hide(int $id): JsonResponse
    {
        $adminId = $this->requireBrokerOrAdmin();
        $superAdmin = $this->isSuperAdmin();
        $tenantId = $this->getTenantId();

        $effectiveTenantId = $this->resolveEffectiveTenantId($superAdmin, $tenantId);
        // Safety: $tenantWhere is a hardcoded literal string ('AND tenant_id = ?' or '').
        // The tenant ID value is bound via parameterised placeholder, not interpolated.
        $tenantWhere = $effectiveTenantId !== null ? 'AND tenant_id = ?' : '';
        $tenantParams = $effectiveTenantId !== null ? [$effectiveTenantId] : [];

        $comment = DB::selectOne(
            "SELECT id, user_id, target_type, target_id, tenant_id FROM comments WHERE id = ? {$tenantWhere}",
            array_merge([$id], $tenantParams)
        );

        if (!$comment) {
            return $this->respondWithError('NOT_FOUND', __('api.comment_not_found'), null, 404);
        }

        if ($guard = $this->guardBrokerNotAuthor((int) $comment->user_id, $adminId)) return $guard;

        $commentTenantId = (int) $comment->tenant_id;

        DB::statement(
            "INSERT IGNORE INTO feed_hidden (user_id, tenant_id, target_type, target_id, created_at)
             VALUES (?, ?, 'comment', ?, NOW())",
            [$adminId, $commentTenantId, $id]
        );

        ActivityLog::log(
            $adminId,
            'hide_comment',
            "Hidden comment #{$id} on {$comment->target_type} #{$comment->target_id}" . ($superAdmin ? " (tenant {$commentTenantId})" : '')
        );

        // Notify the comment author
        try {
            $commentAuthorId = (int) $comment->user_id;

            if ($commentAuthorId && $commentAuthorId !== $adminId) {
                $link = $comment->target_type && $comment->target_id
                    ? \App\Services\SocialNotificationService::getContentLink(
                        (string) $comment->target_type,
                        (int) $comment->target_id,
                    )
                    : null;

                Notification::createNotification(
                    $commentAuthorId,
                    __('api_controllers_3.admin_bells.comment_hidden'),
                    $link,
                    'moderation',
                    true
                );
                \App\Services\NotificationDispatcher::fanOutPush((int) $commentAuthorId, 'moderation', __('api_controllers_3.admin_bells.comment_hidden'), $link);
            }
        } catch (\Throwable $e) {
            Log::warning("AdminCommentsController::hide notification failed: " . $e->getMessage());
        }

        return $this->respondWithData(['success' => true, 'message' => __('api.comment_hidden')]);
    }

    /**
     * DELETE /api/v2/admin/comments/{id}
     */
    public function destroy(int $id): JsonResponse
    {
        $adminId = $this->requireBrokerOrAdmin();
        $superAdmin = $this->isSuperAdmin();
        $tenantId = $this->getTenantId();

        $effectiveTenantId = $this->resolveEffectiveTenantId($superAdmin, $tenantId);
        // Safety: $tenantWhere is a hardcoded literal string ('AND tenant_id = ?' or '').
        // The tenant ID value is bound via parameterised placeholder, not interpolated.
        $tenantWhere = $effectiveTenantId !== null ? 'AND tenant_id = ?' : '';
        $tenantParams = $effectiveTenantId !== null ? [$effectiveTenantId] : [];

        $comment = DB::selectOne(
            "SELECT id, target_type, target_id, user_id, tenant_id FROM comments WHERE id = ? {$tenantWhere}",
            array_merge([$id], $tenantParams)
        );

        if (!$comment) {
            return $this->respondWithError('NOT_FOUND', __('api.comment_not_found'), null, 404);
        }

        if ($guard = $this->guardBrokerNotAuthor((int) $comment->user_id, $adminId)) return $guard;

        $commentTenantId = (int) $comment->tenant_id;

        DB::delete("DELETE FROM comments WHERE id = ? AND tenant_id = ?", [$id, $commentTenantId]);
        DB::delete("DELETE FROM feed_hidden WHERE target_type = 'comment' AND target_id = ? AND tenant_id = ?", [$id, $commentTenantId]);

        ActivityLog::log(
            $adminId,
            'delete_comment',
            "Deleted comment #{$id} on {$comment->target_type} #{$comment->target_id}" . ($superAdmin ? " (tenant {$commentTenantId})" : '')
        );

        // Notify the comment author (comment already deleted, use cached data)
        try {
            $commentAuthorId = (int) $comment->user_id;

            if ($commentAuthorId && $commentAuthorId !== $adminId) {
                Notification::createNotification(
                    $commentAuthorId,
                    __('api_controllers_3.admin_bells.comment_removed'),
                    null,
                    'moderation',
                    true
                );
                \App\Services\NotificationDispatcher::fanOutPush((int) $commentAuthorId, 'moderation', __('api_controllers_3.admin_bells.comment_removed'), null);

                // The bell/push above give no reason or recourse. Send a durable
                // email with WHY it was removed and HOW to contest (DSA
                // transparency), rendered in the author's own language. Reporter
                // identity is never disclosed.
                try {
                    $owner = DB::selectOne("SELECT email, preferred_language FROM users WHERE id = ? AND tenant_id = ?", [$commentAuthorId, $commentTenantId]);
                    if ($owner && !empty($owner->email)) {
                        \App\I18n\LocaleContext::withLocale($owner, function () use ($owner, $commentTenantId): void {
                            $ct = __('emails_misc.content_enforcement.type_comment');
                            $subject = __('emails_misc.content_enforcement.subject', ['content_type' => $ct]);
                            $html = \App\Core\EmailTemplateBuilder::make()
                                ->theme('danger')
                                ->title($subject)
                                ->paragraph(__('emails_misc.content_enforcement.body', ['content_type' => $ct]))
                                ->button(__('emails_misc.content_enforcement.cta'), \App\Core\EmailTemplateBuilder::tenantUrl('/help'))
                                ->render();
                            \App\Services\EmailDispatchService::sendRaw($owner->email, $subject, $html, null, null, null, 'moderation', ['tenant_id' => $commentTenantId]);
                        });
                    }
                } catch (\Throwable $emailError) {
                    Log::warning("AdminCommentsController::destroy owner email failed: " . $emailError->getMessage());
                }
            }
        } catch (\Throwable $e) {
            Log::warning("AdminCommentsController::destroy notification failed: " . $e->getMessage());
        }

        return $this->respondWithData(['success' => true, 'message' => __('api.comment_deleted')]);
    }
}
