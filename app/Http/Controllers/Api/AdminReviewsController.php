<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\I18n\LocaleContext;
use App\Models\ActivityLog;
use App\Models\Notification;

/**
 * AdminReviewsController -- Admin review moderation.
 *
 * Moderate user reviews (flag, hide, delete).
 * All endpoints require admin authentication.
 */
class AdminReviewsController extends BaseApiController
{
    protected bool $isV2Api = true;

    /**
     * Check if the current user is a super admin.
     */
    private function isSuperAdmin(): bool
    {
        // Platform-level super admin only. A tenant super-admin is scoped to their
        // own tenant by design (see EnsureIsSuperAdmin / requirePlatformSuperAdmin);
        // they must not reach the cross-tenant moderation branches below.
        return $this->isPlatformSuperAdmin();
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
     * GET /api/v2/admin/reviews
     *
     * Query params: page, limit, rating, status, search
     */
    /**
     * Self-dealing guard: a broker/coordinator must not moderate a review
     * they wrote (reviewer) or received (subject) — they could otherwise
     * bury unfavourable reviews about themselves. Admin tiers retain full
     * latitude. See BrokerModerationAuthorizationTest.
     */
    private function guardBrokerNotParty(?int $reviewerId, ?int $receiverId, int $callerId): ?JsonResponse
    {
        if ($this->callerIsAdminTier()) {
            return null;
        }
        if ($callerId === (int) $reviewerId || $callerId === (int) $receiverId) {
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
        $rating = $this->queryInt('rating');
        $status = $this->query('status');
        $search = $this->query('search');

        $conditions = [];
        $params = [];

        // Author-deleted reviews (deleted_by_author_at set) carry status
        // 'rejected' but are NOT moderator-rejected — the member removed their
        // own review. Keep them out of every moderation queue so an admin can
        // never resurrect one via flag().
        $conditions[] = 'r.deleted_by_author_at IS NULL';

        $effectiveTenantId = $this->resolveEffectiveTenantId($superAdmin, $tenantId);
        if ($effectiveTenantId !== null) {
            $conditions[] = 'r.tenant_id = ?';
            $params[] = $effectiveTenantId;
        }

        if ($rating !== null && $rating >= 1 && $rating <= 5) {
            $conditions[] = 'r.rating = ?';
            $params[] = $rating;
        }

        if ($status && in_array($status, ['pending', 'approved', 'rejected'], true)) {
            $conditions[] = 'r.status = ?';
            $params[] = $status;
        }

        if ($search) {
            $conditions[] = '(r.comment LIKE ? OR reviewer.name LIKE ? OR receiver.name LIKE ?)';
            $searchPattern = '%' . $search . '%';
            $params[] = $searchPattern;
            $params[] = $searchPattern;
            $params[] = $searchPattern;
        }

        $where = !empty($conditions) ? implode(' AND ', $conditions) : '1=1';

        $total = (int) DB::selectOne(
            "SELECT COUNT(*) as total
             FROM reviews r
             LEFT JOIN users reviewer ON r.reviewer_id = reviewer.id
             LEFT JOIN users receiver ON r.receiver_id = receiver.id
             WHERE {$where}",
            $params
        )->total;

        $reviews = DB::select(
            "SELECT r.*,
                    reviewer.name as reviewer_name, reviewer.avatar_url as reviewer_avatar,
                    receiver.name as receiver_name, receiver.avatar_url as receiver_avatar,
                    t.name as tenant_name
             FROM reviews r
             LEFT JOIN users reviewer ON r.reviewer_id = reviewer.id
             LEFT JOIN users receiver ON r.receiver_id = receiver.id
             LEFT JOIN tenants t ON r.tenant_id = t.id
             WHERE {$where}
             ORDER BY r.created_at DESC
             LIMIT ? OFFSET ?",
            array_merge($params, [$limit, $offset])
        );

        $formatted = array_map(function ($review) {
            return [
                'id' => (int) $review->id,
                'tenant_id' => (int) $review->tenant_id,
                'tenant_name' => $review->tenant_name ?? 'Unknown',
                'reviewer_id' => (int) $review->reviewer_id,
                'reviewer_name' => $review->reviewer_name ?? 'Unknown',
                'reviewer_avatar' => $review->reviewer_avatar,
                'receiver_id' => (int) $review->receiver_id,
                'receiver_name' => $review->receiver_name ?? 'Unknown',
                'receiver_avatar' => $review->receiver_avatar,
                'rating' => (int) $review->rating,
                'comment' => $review->comment,
                'content' => $review->comment,
                'status' => $review->status,
                'is_anonymous' => (bool) ($review->is_anonymous ?? false),
                'created_at' => $review->created_at,
            ];
        }, $reviews);

        return $this->respondWithPaginatedCollection($formatted, $total, $page, $limit);
    }

    /**
     * GET /api/v2/admin/reviews/{id}
     */
    public function show(int $id): JsonResponse
    {
        $this->requireBrokerOrAdmin();
        $superAdmin = $this->isSuperAdmin();
        $tenantId = $this->getTenantId();

        if ($superAdmin) {
            $review = DB::selectOne(
                "SELECT r.*,
                        reviewer.name as reviewer_name, reviewer.email as reviewer_email, reviewer.avatar_url as reviewer_avatar,
                        receiver.name as receiver_name, receiver.email as receiver_email, receiver.avatar_url as receiver_avatar,
                        t.name as tenant_name
                 FROM reviews r
                 LEFT JOIN users reviewer ON r.reviewer_id = reviewer.id
                 LEFT JOIN users receiver ON r.receiver_id = receiver.id
                 LEFT JOIN tenants t ON r.tenant_id = t.id
                 WHERE r.id = ?",
                [$id]
            );
        } else {
            $review = DB::selectOne(
                "SELECT r.*,
                        reviewer.name as reviewer_name, reviewer.email as reviewer_email, reviewer.avatar_url as reviewer_avatar,
                        receiver.name as receiver_name, receiver.email as receiver_email, receiver.avatar_url as receiver_avatar,
                        t.name as tenant_name
                 FROM reviews r
                 LEFT JOIN users reviewer ON r.reviewer_id = reviewer.id
                 LEFT JOIN users receiver ON r.receiver_id = receiver.id
                 LEFT JOIN tenants t ON r.tenant_id = t.id
                 WHERE r.id = ? AND r.tenant_id = ?",
                [$id, $tenantId]
            );
        }

        if (!$review) {
            return $this->respondWithError('NOT_FOUND', __('api.review_not_found'), null, 404);
        }

        return $this->respondWithData([
            'id' => (int) $review->id,
            'tenant_id' => (int) $review->tenant_id,
            'tenant_name' => $review->tenant_name ?? 'Unknown',
            'reviewer_id' => (int) $review->reviewer_id,
            'reviewer_name' => $review->reviewer_name ?? 'Unknown',
            'reviewer_email' => $review->reviewer_email,
            'reviewer_avatar' => $review->reviewer_avatar,
            'receiver_id' => (int) $review->receiver_id,
            'receiver_name' => $review->receiver_name ?? 'Unknown',
            'receiver_email' => $review->receiver_email,
            'receiver_avatar' => $review->receiver_avatar,
            'rating' => (int) $review->rating,
            'comment' => $review->comment,
            'content' => $review->comment,
            'status' => $review->status,
            'is_anonymous' => (bool) ($review->is_anonymous ?? false),
            'transaction_id' => $review->transaction_id ? (int) $review->transaction_id : null,
            'group_id' => $review->group_id ? (int) $review->group_id : null,
            'created_at' => $review->created_at,
        ]);
    }

    /**
     * POST /api/v2/admin/reviews/{id}/flag
     * Flags a review for admin attention by setting status to 'pending'
     */
    public function flag(int $id): JsonResponse
    {
        $adminId = $this->requireBrokerOrAdmin();
        $superAdmin = $this->isSuperAdmin();
        $tenantId = $this->getTenantId();

        if ($superAdmin) {
            $review = DB::selectOne("SELECT id, status, tenant_id, reviewer_id, receiver_id, deleted_by_author_at FROM reviews WHERE id = ?", [$id]);
        } else {
            $review = DB::selectOne("SELECT id, status, tenant_id, reviewer_id, receiver_id, deleted_by_author_at FROM reviews WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
        }

        // Author-deleted reviews must never be resurrected into the moderation
        // flow — treat them as not found even when called directly by ID.
        if (!$review || $review->deleted_by_author_at !== null) {
            return $this->respondWithError('NOT_FOUND', __('api.review_not_found'), null, 404);
        }

        if ($guard = $this->guardBrokerNotParty((int) $review->reviewer_id, (int) $review->receiver_id, $adminId)) return $guard;

        $reviewTenantId = (int) $review->tenant_id;

        DB::update("UPDATE reviews SET status = 'pending' WHERE id = ? AND tenant_id = ? AND deleted_by_author_at IS NULL", [$id, $reviewTenantId]);
        $this->hideReviewFeedActivity($id, $reviewTenantId);

        ActivityLog::log(
            $adminId,
            'flag_review',
            "Flagged review #{$id} for admin review (set status to pending)" . ($superAdmin ? " (tenant {$reviewTenantId})" : '')
        );

        return $this->respondWithData(['success' => true, 'message' => __('api_controllers_1.admin_reviews.review_flagged')]);
    }

    /**
     * POST /api/v2/admin/reviews/{id}/hide
     */
    public function hide(int $id): JsonResponse
    {
        $adminId = $this->requireBrokerOrAdmin();
        $superAdmin = $this->isSuperAdmin();
        $tenantId = $this->getTenantId();

        if ($superAdmin) {
            $review = DB::selectOne("SELECT id, status, tenant_id, reviewer_id, receiver_id, deleted_by_author_at FROM reviews WHERE id = ?", [$id]);
        } else {
            $review = DB::selectOne("SELECT id, status, tenant_id, reviewer_id, receiver_id, deleted_by_author_at FROM reviews WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
        }

        // Author-deleted reviews are outside the moderation flow — hiding one
        // would only confuse the author with a "review hidden" notification.
        if (!$review || $review->deleted_by_author_at !== null) {
            return $this->respondWithError('NOT_FOUND', __('api.review_not_found'), null, 404);
        }

        if ($guard = $this->guardBrokerNotParty((int) $review->reviewer_id, (int) $review->receiver_id, $adminId)) return $guard;

        $reviewTenantId = (int) $review->tenant_id;

        DB::update("UPDATE reviews SET status = 'rejected' WHERE id = ? AND tenant_id = ?", [$id, $reviewTenantId]);
        $this->hideReviewFeedActivity($id, $reviewTenantId);

        ActivityLog::log(
            $adminId,
            'hide_review',
            "Hidden review #{$id} (set status to rejected)" . ($superAdmin ? " (tenant {$reviewTenantId})" : '')
        );

        // Notify the reviewer, rendered in the reviewer's preferred language
        // (scoped to the review's tenant for the super-admin path).
        try {
            $reviewerId = (int) $review->reviewer_id;

            if ($reviewerId && $reviewerId !== $adminId) {
                $recipient = DB::table('users')
                    ->where('id', $reviewerId)
                    ->where('tenant_id', $reviewTenantId)
                    ->select(['preferred_language'])
                    ->first();

                LocaleContext::withLocale($recipient, function () use ($reviewerId, $reviewTenantId) {
                    $msg = __('api_controllers_3.admin_bells.review_hidden');
                    Notification::createNotification(
                        $reviewerId,
                        $msg,
                        null,
                        'moderation',
                        true,
                        $reviewTenantId
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) $reviewerId, 'moderation', $msg, null);
                });
            }
        } catch (\Throwable $e) {
            Log::warning("AdminReviewsController::hide notification failed: " . $e->getMessage());
        }

        return $this->respondWithData(['success' => true, 'message' => __('api_controllers_1.admin_reviews.review_hidden')]);
    }

    /**
     * DELETE /api/v2/admin/reviews/{id}
     */
    public function destroy(int $id): JsonResponse
    {
        $adminId = $this->requireBrokerOrAdmin();
        $superAdmin = $this->isSuperAdmin();
        $tenantId = $this->getTenantId();

        if ($superAdmin) {
            $review = DB::selectOne("SELECT id, tenant_id, reviewer_id, receiver_id FROM reviews WHERE id = ?", [$id]);
        } else {
            $review = DB::selectOne("SELECT id, tenant_id, reviewer_id, receiver_id FROM reviews WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
        }

        if (!$review) {
            return $this->respondWithError('NOT_FOUND', __('api.review_not_found'), null, 404);
        }

        if ($guard = $this->guardBrokerNotParty((int) $review->reviewer_id, (int) $review->receiver_id, $adminId)) return $guard;

        $reviewTenantId = (int) $review->tenant_id;
        $reviewerId = (int) $review->reviewer_id;

        DB::delete("DELETE FROM reviews WHERE id = ? AND tenant_id = ?", [$id, $reviewTenantId]);
        DB::delete(
            "DELETE FROM feed_activity WHERE tenant_id = ? AND source_type = 'review' AND source_id = ?",
            [$reviewTenantId, $id]
        );

        ActivityLog::log(
            $adminId,
            'delete_review',
            "Deleted review #{$id}" . ($superAdmin ? " (tenant {$reviewTenantId})" : '')
        );

        // Notify the reviewer (review already deleted, use cached reviewer_id),
        // rendered in the reviewer's preferred language (scoped to the review's
        // tenant for the super-admin path).
        try {
            if ($reviewerId && $reviewerId !== $adminId) {
                $recipient = DB::table('users')
                    ->where('id', $reviewerId)
                    ->where('tenant_id', $reviewTenantId)
                    ->select(['preferred_language'])
                    ->first();

                LocaleContext::withLocale($recipient, function () use ($reviewerId, $reviewTenantId) {
                    $msg = __('api_controllers_3.admin_bells.review_removed');
                    Notification::createNotification(
                        $reviewerId,
                        $msg,
                        null,
                        'moderation',
                        true,
                        $reviewTenantId
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) $reviewerId, 'moderation', $msg, null);
                });
            }
        } catch (\Throwable $e) {
            Log::warning("AdminReviewsController::destroy notification failed: " . $e->getMessage());
        }

        return $this->respondWithData(['success' => true, 'message' => __('api_controllers_1.admin_reviews.review_deleted')]);
    }

    /**
     * F-157: a flagged or hidden review must leave the community feed. The
     * review's own tenant is used (not the request's) so the super-admin path
     * hides the right row.
     */
    private function hideReviewFeedActivity(int $reviewId, int $reviewTenantId): void
    {
        DB::update(
            "UPDATE feed_activity SET is_visible = 0 WHERE tenant_id = ? AND source_type = 'review' AND source_id = ?",
            [$reviewTenantId, $reviewId]
        );
    }
}
