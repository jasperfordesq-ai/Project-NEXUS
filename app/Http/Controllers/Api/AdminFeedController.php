<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
use App\Models\ActivityLog;
use App\Models\FeedPost;
use App\Models\Notification;

/**
 * AdminFeedController -- Admin feed post moderation.
 *
 * Moderate feed posts (hide/delete).
 * All endpoints require admin authentication.
 */
class AdminFeedController extends BaseApiController
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
     * GET /api/v2/admin/feed
     *
     * Queries feed_activity (the unified feed table) so admins see ALL feed
     * items — posts, listings, events, polls, goals, jobs, challenges, etc.
     *
     * Query params: page, limit, type, user_id, search, is_hidden
     */
    /**
     * Self-dealing guard: a broker/coordinator must not hide/delete a feed
     * item they authored themselves (moderation must not double as
     * self-service content management, and the inverse — scrubbing their own
     * record — is the abuse vector). Admin tiers retain full latitude.
     * See BrokerModerationAuthorizationTest.
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

    /**
     * F-390: a feed card's AUTHOR is not always the person it is about. A
     * review card is authored by the reviewer and is about the receiver, so
     * guardBrokerNotAuthor() let a broker who had been reviewed hide or delete
     * the card — and, on delete, every other member's comment on it. Refuse a
     * broker who is the subject of the review, as AdminReviewsController does.
     */
    private function guardBrokerNotSubject(string $sourceType, int $sourceId, int $itemTenantId, int $callerId): ?JsonResponse
    {
        if ($sourceType !== 'review' || $this->callerIsAdminTier()) {
            return null;
        }
        $receiverId = (int) DB::table('reviews')
            ->where('id', $sourceId)
            ->where('tenant_id', $itemTenantId)
            ->value('receiver_id');
        if ($receiverId === $callerId) {
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
        $type = $this->query('type');
        $userId = $this->queryInt('user_id');
        $search = $this->query('search');
        $isHidden = $this->query('is_hidden');

        $conditions = [];
        $params = [];

        $effectiveTenantId = $this->resolveEffectiveTenantId($superAdmin, $tenantId);
        if ($effectiveTenantId !== null) {
            $conditions[] = 'fa.tenant_id = ?';
            $params[] = $effectiveTenantId;
        }

        if ($type) {
            $conditions[] = 'fa.source_type = ?';
            $params[] = $type;
        }

        if ($userId) {
            $conditions[] = 'fa.user_id = ?';
            $params[] = $userId;
        }

        if ($isHidden !== null) {
            if (in_array($isHidden, ['true', '1', 'yes'], true)) {
                $conditions[] = 'fa.is_hidden = 1';
            } elseif (in_array($isHidden, ['false', '0', 'no'], true)) {
                $conditions[] = 'fa.is_hidden = 0';
            }
            // Invalid values: silently ignore (don't filter by is_hidden)
        }

        if ($search) {
            $conditions[] = '(fa.content LIKE ? OR COALESCE(NULLIF(u.name, \'\'), CONCAT(u.first_name, \' \', u.last_name)) LIKE ?)';
            $searchPattern = '%' . addcslashes($search, '%_\\') . '%';
            $params[] = $searchPattern;
            $params[] = $searchPattern;
        }

        $where = !empty($conditions) ? implode(' AND ', $conditions) : '1=1';

        $total = (int) DB::selectOne(
            "SELECT COUNT(*) as total
             FROM feed_activity fa
             LEFT JOIN users u ON fa.user_id = u.id
             WHERE {$where}",
            $params
        )->total;

        // Use correlated subqueries instead of full-table GROUP BY derived tables
        // to avoid materializing the entire comments/likes tables on every request
        $rows = DB::select(
            "SELECT fa.id as activity_id, fa.source_type, fa.source_id, fa.user_id,
                    fa.tenant_id, fa.title, fa.content, fa.image_url,
                    fa.is_hidden, fa.is_visible, fa.created_at,
                    COALESCE(NULLIF(u.name, ''), CONCAT(u.first_name, ' ', u.last_name)) as user_name,
                    u.avatar_url as user_avatar,
                    t.name as tenant_name,
                    (SELECT COUNT(*) FROM comments c WHERE c.target_type = fa.source_type AND c.target_id = fa.source_id AND c.tenant_id = fa.tenant_id) as comments_count,
                    (SELECT COUNT(*) FROM likes l WHERE l.target_type = fa.source_type AND l.target_id = fa.source_id AND l.tenant_id = fa.tenant_id) as likes_count
             FROM feed_activity fa
             LEFT JOIN users u ON fa.user_id = u.id
             LEFT JOIN tenants t ON fa.tenant_id = t.id
             WHERE {$where}
             ORDER BY fa.created_at DESC
             LIMIT ? OFFSET ?",
            array_merge($params, [$limit, $offset])
        );

        $formatted = array_map(function ($row) {
            return [
                'id' => (int) $row->source_id,
                'activity_id' => (int) $row->activity_id,
                'user_id' => (int) $row->user_id,
                'tenant_id' => (int) $row->tenant_id,
                'tenant_name' => $row->tenant_name ?? 'Unknown',
                'user_name' => $row->user_name ?? 'Unknown',
                'user_avatar' => $row->user_avatar,
                'type' => $row->source_type ?? 'post',
                // Polls and goals often have a title and no body.
                'title' => $row->title ?? null,
                'content' => $row->content,
                'image_url' => $row->image_url ?? null,
                'likes_count' => (int) ($row->likes_count ?? 0),
                'comments_count' => (int) ($row->comments_count ?? 0),
                'is_hidden' => (bool) ($row->is_hidden ?? false),
                'created_at' => $row->created_at,
            ];
        }, $rows);

        return $this->respondWithPaginatedCollection($formatted, $total, $page, $limit);
    }

    /**
     * GET /api/v2/admin/feed/{id}
     *
     * Accepts query param ?type=<source_type> to look up non-post items.
     * Defaults to 'post' for backwards compatibility.
     */
    public function show(int $id): JsonResponse
    {
        $this->requireBrokerOrAdmin();
        $superAdmin = $this->isSuperAdmin();
        $tenantId = $this->getTenantId();
        $sourceType = $this->query('type', 'post');

        $effectiveTenantId = $this->resolveEffectiveTenantId($superAdmin, $tenantId);
        $tenantWhere = $effectiveTenantId !== null ? 'fa.tenant_id = ?' : '1=1';
        $tenantParams = $effectiveTenantId !== null ? [$effectiveTenantId] : [];

        $row = DB::selectOne(
            "SELECT fa.id as activity_id, fa.source_type, fa.source_id, fa.user_id,
                    fa.tenant_id, fa.title, fa.content, fa.image_url,
                    fa.is_hidden, fa.is_visible, fa.created_at,
                    COALESCE(NULLIF(u.name, ''), CONCAT(u.first_name, ' ', u.last_name)) as user_name,
                    u.email as user_email, u.avatar_url as user_avatar,
                    t.name as tenant_name
             FROM feed_activity fa
             LEFT JOIN users u ON fa.user_id = u.id
             LEFT JOIN tenants t ON fa.tenant_id = t.id
             WHERE fa.source_id = ? AND fa.source_type = ? AND {$tenantWhere}",
            array_merge([$id, $sourceType], $tenantParams)
        );

        if (!$row) {
            return $this->respondWithError('NOT_FOUND', __('api.post_not_found'), null, 404);
        }

        $rowTenantId = (int) $row->tenant_id;
        $recentComments = DB::select(
            "SELECT c.*, u.name as user_name
             FROM comments c
             LEFT JOIN users u ON c.user_id = u.id
             WHERE c.target_type = ? AND c.target_id = ? AND c.tenant_id = ?
             ORDER BY c.created_at DESC
             LIMIT 10",
            [$row->source_type, $id, $rowTenantId]
        );

        return $this->respondWithData([
            'id' => (int) $row->source_id,
            'activity_id' => (int) $row->activity_id,
            'user_id' => (int) $row->user_id,
            'tenant_id' => (int) $row->tenant_id,
            'tenant_name' => $row->tenant_name ?? 'Unknown',
            'user_name' => $row->user_name ?? 'Unknown',
            'user_email' => $row->user_email,
            'user_avatar' => $row->user_avatar,
            'type' => $row->source_type ?? 'post',
            'content' => $row->content,
            'image_url' => $row->image_url ?? null,
            'is_hidden' => (bool) ($row->is_hidden ?? false),
            'created_at' => $row->created_at,
            'recent_comments' => $recentComments,
        ]);
    }

    /**
     * POST /api/v2/admin/feed/{id}/hide
     *
     * Accepts JSON body { "type": "listing" } to hide non-post items.
     * Defaults to 'post' for backwards compatibility.
     */
    public function hide(int $id): JsonResponse
    {
        $adminId = $this->requireBrokerOrAdmin();
        $superAdmin = $this->isSuperAdmin();
        $tenantId = $this->getTenantId();
        $sourceType = $this->input('type') ?? $this->query('type', 'post');

        $effectiveTenantId = $this->resolveEffectiveTenantId($superAdmin, $tenantId);
        $tenantWhere = $effectiveTenantId !== null ? 'tenant_id = ?' : '1=1';
        $tenantParams = $effectiveTenantId !== null ? [$effectiveTenantId] : [];

        $row = DB::selectOne(
            "SELECT id, tenant_id, user_id FROM feed_activity WHERE source_type = ? AND source_id = ? AND {$tenantWhere}",
            array_merge([$sourceType, $id], $tenantParams)
        );

        if (!$row) {
            return $this->respondWithError('NOT_FOUND', __('api.feed_item_not_found'), null, 404);
        }

        if ($effectiveTenantId !== null && (int)$row->tenant_id !== $effectiveTenantId) {
            return $this->respondWithError('FORBIDDEN', __('api.scope_violation'), null, 403);
        }

        if ($guard = $this->guardBrokerNotAuthor((int) $row->user_id, $adminId)) return $guard;
        if ($guard = $this->guardBrokerNotSubject((string) $sourceType, $id, (int) $row->tenant_id, $adminId)) return $guard;

        $itemTenantId = (int) $row->tenant_id;

        // Fix 10: wrap both UPDATEs in a transaction so feed_activity and
        // feed_posts cannot become out of sync if the second UPDATE fails.
        DB::transaction(function () use ($sourceType, $id, $itemTenantId) {
            // Hide from feed_activity (hides from main feed for all users)
            DB::update(
                "UPDATE feed_activity SET is_hidden = 1, is_visible = 0 WHERE source_type = ? AND source_id = ? AND tenant_id = ?",
                [$sourceType, $id, $itemTenantId]
            );

            // If the source is a post, also set is_hidden on the feed_posts row
            if ($sourceType === 'post') {
                DB::update(
                    "UPDATE feed_posts SET is_hidden = 1 WHERE id = ? AND tenant_id = ?",
                    [$id, $itemTenantId]
                );
            }
        });

        ActivityLog::log(
            $adminId,
            'hide_feed_item',
            "Hidden feed {$sourceType} #{$id} (tenant {$itemTenantId})"
        );

        // Notify the content creator that their post was hidden
        try {
            $feedItem = DB::selectOne(
                "SELECT user_id FROM feed_activity WHERE source_type = ? AND source_id = ? AND tenant_id = ? LIMIT 1",
                [$sourceType, $id, $itemTenantId]
            );
            if ($feedItem && $feedItem->user_id) {
                Notification::createNotification(
                    (int) $feedItem->user_id,
                    __('api_controllers_3.admin_bells.post_hidden'),
                    null,
                    'moderation',
                    false,
                    $itemTenantId
                );
                \App\Services\NotificationDispatcher::fanOutPush((int) ((int) $feedItem->user_id), 'moderation', __('api_controllers_3.admin_bells.post_hidden'), null);
            }
        } catch (\Throwable $e) {
            Log::warning("AdminFeedController::hide notification failed for {$sourceType} #{$id}: " . $e->getMessage());
        }

        return $this->respondWithData(['success' => true, 'message' => __('api_controllers_1.admin_feed.item_hidden')]);
    }

    /**
     * DELETE /api/v2/admin/feed/{id}
     *
     * Accepts query param ?type=<source_type> to delete non-post items.
     * Defaults to 'post' for backwards compatibility.
     */
    public function destroy(int $id): JsonResponse
    {
        $adminId = $this->requireBrokerOrAdmin();
        $superAdmin = $this->isSuperAdmin();
        $tenantId = $this->getTenantId();
        $sourceType = $this->query('type', 'post');

        $effectiveTenantId = $this->resolveEffectiveTenantId($superAdmin, $tenantId);
        $tenantWhere = $effectiveTenantId !== null ? 'tenant_id = ?' : '1=1';
        $tenantParams = $effectiveTenantId !== null ? [$effectiveTenantId] : [];

        $row = DB::selectOne(
            "SELECT id, tenant_id, user_id FROM feed_activity WHERE source_type = ? AND source_id = ? AND {$tenantWhere}",
            array_merge([$sourceType, $id], $tenantParams)
        );

        if (!$row) {
            return $this->respondWithError('NOT_FOUND', __('api.feed_item_not_found'), null, 404);
        }

        if ($effectiveTenantId !== null && (int)$row->tenant_id !== $effectiveTenantId) {
            return $this->respondWithError('FORBIDDEN', __('api.scope_violation'), null, 403);
        }

        if ($guard = $this->guardBrokerNotAuthor((int) $row->user_id, $adminId)) return $guard;
        if ($guard = $this->guardBrokerNotSubject((string) $sourceType, $id, (int) $row->tenant_id, $adminId)) return $guard;

        $itemTenantId = (int) $row->tenant_id;

        // Capture creator user_id BEFORE deleting so we can notify them
        $creatorUserId = null;
        try {
            $feedItem = DB::selectOne(
                "SELECT user_id FROM feed_activity WHERE source_type = ? AND source_id = ? AND tenant_id = ? LIMIT 1",
                [$sourceType, $id, $itemTenantId]
            );
            $creatorUserId = $feedItem ? (int) $feedItem->user_id : null;
        } catch (\Throwable $e) {
            Log::warning("AdminFeedController::destroy failed to capture creator user_id for {$sourceType} #{$id}: " . $e->getMessage());
        }

        // Remove from feed_activity
        DB::delete("DELETE FROM feed_activity WHERE source_type = ? AND source_id = ? AND tenant_id = ?", [$sourceType, $id, $itemTenantId]);
        // Remove related engagement data
        DB::delete("DELETE FROM feed_hidden WHERE target_type = ? AND target_id = ? AND tenant_id = ?", [$sourceType, $id, $itemTenantId]);
        DB::delete("DELETE FROM likes WHERE target_type = ? AND target_id = ? AND tenant_id = ?", [$sourceType, $id, $itemTenantId]);
        DB::delete("DELETE FROM comments WHERE target_type = ? AND target_id = ? AND tenant_id = ?", [$sourceType, $id, $itemTenantId]);

        // If the source is a post, also soft-delete the feed_posts row
        if ($sourceType === 'post') {
            FeedPost::where('id', $id)->where('tenant_id', $itemTenantId)->delete();
        }

        ActivityLog::log(
            $adminId,
            'delete_feed_item',
            "Deleted feed {$sourceType} #{$id} (tenant {$itemTenantId})"
        );

        // Notify the content creator that their post was removed
        if ($creatorUserId) {
            try {
                Notification::createNotification(
                    $creatorUserId,
                    __('api_controllers_3.admin_bells.post_removed'),
                    null,
                    'moderation',
                    false,
                    $itemTenantId
                );
                \App\Services\NotificationDispatcher::fanOutPush((int) ($creatorUserId), 'moderation', __('api_controllers_3.admin_bells.post_removed'), null);

                // The bell/push above give no reason or recourse. Send a durable
                // email with WHY it was removed and HOW to contest (DSA
                // transparency), in the author's own language.
                try {
                    $owner = DB::selectOne("SELECT email, preferred_language FROM users WHERE id = ? AND tenant_id = ?", [$creatorUserId, $itemTenantId]);
                    if ($owner && !empty($owner->email)) {
                        \App\I18n\LocaleContext::withLocale($owner, function () use ($owner, $itemTenantId): void {
                            $ct = __('emails_misc.content_enforcement.type_post');
                            $subject = __('emails_misc.content_enforcement.subject', ['content_type' => $ct]);
                            $html = \App\Core\EmailTemplateBuilder::make()
                                ->theme('danger')
                                ->title($subject)
                                ->paragraph(__('emails_misc.content_enforcement.body', ['content_type' => $ct]))
                                ->button(__('emails_misc.content_enforcement.cta'), \App\Core\EmailTemplateBuilder::tenantUrl('/help'))
                                ->render();
                            \App\Services\EmailDispatchService::sendRaw($owner->email, $subject, $html, null, null, null, 'moderation', ['tenant_id' => $itemTenantId]);
                        });
                    }
                } catch (\Throwable $emailError) {
                    Log::warning("AdminFeedController::destroy owner email failed: " . $emailError->getMessage());
                }
            } catch (\Throwable $e) {
                Log::warning("AdminFeedController::destroy notification failed for {$sourceType} #{$id}: " . $e->getMessage());
            }
        }

        return $this->respondWithData(['success' => true, 'message' => __('api_controllers_1.admin_feed.item_deleted')]);
    }

    /**
     * POST /api/v2/admin/feed/grant-announcer
     *
     * Grant the municipality_announcer role to a user.
     * Body: { "user_id": int }
     */
    public function grantAnnouncer(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $userId = (int) ($this->input('user_id') ?? 0);

        if (!$userId) {
            return $this->respondWithError('VALIDATION', __('api.user_id_required'), null, 422);
        }

        // Ensure the user belongs to this tenant
        $user = DB::selectOne(
            "SELECT id FROM users WHERE id = ? AND tenant_id = ? LIMIT 1",
            [$userId, $tenantId]
        );
        if (!$user) {
            return $this->respondWithError('NOT_FOUND', __('api.user_not_found_in_tenant'), null, 404);
        }

        // Resolve role ID
        $role = DB::selectOne(
            "SELECT id FROM roles WHERE name = 'municipality_announcer' LIMIT 1"
        );
        if (!$role) {
            return $this->respondWithError('NOT_FOUND', __('api.municipal_announcer_role_missing_run_migrations'), null, 500);
        }

        // Idempotent insert
        DB::statement(
            "INSERT IGNORE INTO user_roles (user_id, role_id, tenant_id) VALUES (?, ?, ?)",
            [$userId, (int) $role->id, $tenantId]
        );

        ActivityLog::log($adminId, 'grant_municipality_announcer', "Granted municipality_announcer to user #{$userId} (tenant {$tenantId})");

        return $this->respondWithData(['success' => true, 'message' => __('api.municipal_announcer_role_granted')]);
    }

    /**
     * DELETE /api/v2/admin/feed/revoke-announcer/{user_id}
     *
     * Revoke the municipality_announcer role from a user.
     */
    public function revokeAnnouncer(int $userId): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $role = DB::selectOne(
            "SELECT id FROM roles WHERE name = 'municipality_announcer' LIMIT 1"
        );
        if (!$role) {
            return $this->respondWithError('NOT_FOUND', __('api.municipal_announcer_role_missing'), null, 500);
        }

        DB::delete(
            "DELETE FROM user_roles WHERE user_id = ? AND role_id = ? AND tenant_id = ?",
            [$userId, (int) $role->id, $tenantId]
        );

        ActivityLog::log($adminId, 'revoke_municipality_announcer', "Revoked municipality_announcer from user #{$userId} (tenant {$tenantId})");

        return $this->respondWithData(['success' => true, 'message' => __('api.municipal_announcer_role_revoked')]);
    }

    /**
     * GET /api/v2/admin/feed/stats
     */
    public function stats(): JsonResponse
    {
        $this->requireBrokerOrAdmin();
        $superAdmin = $this->isSuperAdmin();
        $tenantId = $this->getTenantId();

        $effectiveTenantId = $this->resolveEffectiveTenantId($superAdmin, $tenantId);

        if ($effectiveTenantId !== null) {
            $stats = DB::selectOne(
                "SELECT
                    COUNT(*) as total,
                    SUM(fa.is_hidden) as hidden,
                    (SELECT COUNT(*) FROM comments WHERE tenant_id = ?) as total_comments
                 FROM feed_activity fa
                 WHERE fa.tenant_id = ?",
                [$effectiveTenantId, $effectiveTenantId]
            );
        } else {
            $stats = DB::selectOne(
                "SELECT
                    COUNT(*) as total,
                    SUM(fa.is_hidden) as hidden,
                    (SELECT COUNT(*) FROM comments) as total_comments
                 FROM feed_activity fa"
            );
        }

        return $this->respondWithData([
            'total' => (int) ($stats->total ?? 0),
            'hidden' => (int) ($stats->hidden ?? 0),
            'total_comments' => (int) ($stats->total_comments ?? 0),
        ]);
    }
}
