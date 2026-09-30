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
use App\Services\ReportTargetResolver;
use App\Support\FeedItemTables;

/**
 * AdminReportsController -- Admin user and content report handling.
 *
 * Manage user-submitted reports (flagged content).
 * All endpoints require admin authentication.
 */
class AdminReportsController extends BaseApiController
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
     * GET /api/v2/admin/reports
     *
     * Query params: page, limit, type, status, search
     */
    /**
     * Self-dealing guard: a broker/coordinator must not close a report they
     * filed themselves, one that targets them directly, or one about content
     * they own — they could otherwise bury complaints about their own conduct.
     * Content ownership comes from ReportTargetResolver (the same lookup the
     * report list shows as the item's author), with a separate lookup for the
     * reportable feed types its display mapping does not cover. For a review,
     * the member it is about is a party too. If a content row has been removed
     * or its type cannot be resolved, only an admin may close the report:
     * otherwise its former owner could remove it and bury the complaint.
     * Admin tiers retain full latitude.
     * See BrokerModerationAuthorizationTest (F-218).
     */
    private function guardBrokerNotParty(object $report, int $callerId): ?JsonResponse
    {
        if ($this->callerIsAdminTier()) {
            return null;
        }
        $parties = $this->reportParties($report);
        if ($parties === null || in_array($callerId, $parties, true)) {
            return $this->respondWithError('AUTH_INSUFFICIENT_PERMISSIONS', __('api.broker_cannot_moderate_own_content'), null, 403);
        }
        return null;
    }

    /**
     * Members with a personal stake in a report: who filed it, and who the
     * reported item belongs to or is about.
     *
     * @return list<int>|null Null when content ownership cannot be established.
     */
    private function reportParties(object $report): ?array
    {
        $parties = [(int) $report->reporter_id];
        $type = $report->target_type ?? null;
        $targetId = (int) ($report->target_id ?? 0);

        if ($type === 'user') {
            $parties[] = $targetId;
            return $parties;
        }

        $targets = ReportTargetResolver::resolveMany([$report]);
        $authorId = $targets["{$type}:{$targetId}"]['target_author_id'] ?? null;
        if ($authorId === null && $targetId > 0 && is_string($type)) {
            // The report API accepts every reactable feed item, while the
            // display resolver covers only a subset. Resolve ownership for
            // the remaining types before a broker can close the report.
            $ownerColumn = match ($type) {
                'volunteer' => 'created_by',
                'blog' => 'author_id',
                'goal', 'poll', 'challenge', 'resource', 'job', 'discussion' => 'user_id',
                default => null,
            };
            $table = FeedItemTables::TABLES[$type] ?? null;
            if ($ownerColumn !== null && $table !== null) {
                $authorId = DB::table($table)
                    ->where('id', $targetId)
                    ->where('tenant_id', (int) $report->tenant_id)
                    ->value($ownerColumn);
            }
        }
        if ($authorId === null) {
            return null;
        }
        $parties[] = (int) $authorId;

        if ($type === 'review' && $targetId > 0) {
            $receiverId = DB::table('reviews')
                ->where('id', $targetId)
                ->where('tenant_id', (int) $report->tenant_id)
                ->value('receiver_id');
            if ($receiverId !== null) {
                $parties[] = (int) $receiverId;
            }
        }

        return $parties;
    }

    public function index(): JsonResponse
    {
        $callerId = $this->requireBrokerOrAdmin();
        $superAdmin = $this->isSuperAdmin();
        $tenantId = $this->getTenantId();

        $page = $this->queryInt('page', 1, 1);
        $limit = $this->queryInt('limit', 20, 1, 100);
        $offset = ($page - 1) * $limit;
        $type = $this->query('type');
        $status = $this->query('status');
        $search = $this->query('search');

        $conditions = [];
        $params = [];

        $effectiveTenantId = $this->resolveEffectiveTenantId($superAdmin, $tenantId);
        if ($effectiveTenantId !== null) {
            $conditions[] = 'r.tenant_id = ?';
            $params[] = $effectiveTenantId;
        }

        if ($type && in_array($type, ['listing', 'user', 'message', 'post', 'feed_post', 'comment', 'review', 'event'], true)) {
            $conditions[] = 'r.target_type = ?';
            $params[] = $type;
        }

        if ($status && in_array($status, ['open', 'pending', 'resolved', 'dismissed'], true)) {
            // Treat 'pending' and 'open' as equivalent (legacy compat)
            if ($status === 'pending') {
                $conditions[] = "r.status IN ('open', 'pending')";
            } else {
                $conditions[] = 'r.status = ?';
                $params[] = $status;
            }
        }

        if ($search) {
            $conditions[] = '(r.reason LIKE ? OR reporter.name LIKE ?)';
            $searchPattern = '%' . $search . '%';
            $params[] = $searchPattern;
            $params[] = $searchPattern;
        }

        $where = !empty($conditions) ? implode(' AND ', $conditions) : '1=1';

        $total = (int) DB::selectOne(
            "SELECT COUNT(*) as total FROM reports r LEFT JOIN users reporter ON r.reporter_id = reporter.id WHERE {$where}",
            $params
        )->total;

        $reports = DB::select(
            "SELECT r.*, reporter.name as reporter_name, reporter.avatar_url as reporter_avatar, t.name as tenant_name
             FROM reports r
             LEFT JOIN users reporter ON r.reporter_id = reporter.id
             LEFT JOIN tenants t ON r.tenant_id = t.id
             WHERE {$where}
             ORDER BY r.created_at DESC
             LIMIT ? OFFSET ?",
            array_merge($params, [$limit, $offset])
        );

        // F-454: the read side of F-218. A caller below admin tier does not see
        // reports they are a party to — the queue would otherwise hand the
        // reported person the complainant's name and the complaint itself.
        // This is a list, so the row is excluded rather than the route refused;
        // the caller could not resolve or dismiss those reports in any case.
        if (! $this->callerIsAdminTier()) {
            $visible = array_values(array_filter(
                $reports,
                fn ($report) => $this->guardBrokerNotParty($report, $callerId) === null,
            ));
            $total = max(0, $total - (count($reports) - count($visible)));
            $reports = $visible;
        }

        $targets = ReportTargetResolver::resolveMany($reports);
        $formatted = array_map(fn ($report) => $this->formatReport($report, $targets), $reports);

        return $this->respondWithPaginatedCollection($formatted, $total, $page, $limit);
    }

    /**
     * GET /api/v2/admin/reports/{id}
     */
    public function show(int $id): JsonResponse
    {
        $callerId = $this->requireBrokerOrAdmin();
        $superAdmin = $this->isSuperAdmin();
        $tenantId = $this->getTenantId();

        if ($superAdmin) {
            $report = DB::selectOne(
                "SELECT r.*, reporter.name as reporter_name, reporter.avatar_url as reporter_avatar, t.name as tenant_name
                 FROM reports r
                 LEFT JOIN users reporter ON r.reporter_id = reporter.id
                 LEFT JOIN tenants t ON r.tenant_id = t.id
                 WHERE r.id = ?",
                [$id]
            );
        } else {
            $report = DB::selectOne(
                "SELECT r.*, reporter.name as reporter_name, reporter.avatar_url as reporter_avatar, t.name as tenant_name
                 FROM reports r
                 LEFT JOIN users reporter ON r.reporter_id = reporter.id
                 LEFT JOIN tenants t ON r.tenant_id = t.id
                 WHERE r.id = ? AND r.tenant_id = ?",
                [$id, $tenantId]
            );
        }

        if (!$report) {
            return $this->respondWithError('NOT_FOUND', __('api.report_not_found'), null, 404);
        }

        // F-454: the reported person, and the owner of the reported content,
        // must not read the complaint — it names who filed it and what they
        // wrote. The platform already withholds exactly this from a reported
        // seller (MarketplaceReportService::formatReportForViewer()).
        if ($refusal = $this->guardBrokerNotParty($report, $callerId)) {
            return $refusal;
        }

        $targets = ReportTargetResolver::resolveMany([$report]);

        return $this->respondWithData($this->formatReport($report, $targets));
    }

    /**
     * Shape a report row for the API, merging resolved target metadata.
     *
     * @param array<string,array<string,mixed>> $targets Keyed "{target_type}:{target_id}"
     * @return array<string,mixed>
     */
    private function formatReport(object $report, array $targets): array
    {
        $key = "{$report->target_type}:" . (int) $report->target_id;
        $target = $targets[$key] ?? [];

        return [
            'id' => (int) $report->id,
            'tenant_id' => (int) $report->tenant_id,
            'tenant_name' => $report->tenant_name ?? 'Unknown',
            'reporter_id' => (int) $report->reporter_id,
            'reporter_name' => $report->reporter_name ?? 'Unknown',
            'reporter_avatar' => $report->reporter_avatar,
            'content_type' => $report->target_type,
            'target_id' => (int) $report->target_id,
            'target_label' => $target['target_label'] ?? null,
            'target_preview' => $target['target_preview'] ?? null,
            'target_avatar' => $target['target_avatar'] ?? null,
            'target_author_id' => $target['target_author_id'] ?? null,
            'target_author_name' => $target['target_author_name'] ?? null,
            'target_exists' => $target['target_exists'] ?? true,
            'reason' => $report->reason,
            'status' => $report->status,
            'created_at' => $report->created_at,
            'updated_at' => $report->updated_at ?? $report->created_at,
        ];
    }

    /**
     * POST /api/v2/admin/reports/{id}/resolve
     */
    public function resolve(int $id): JsonResponse
    {
        $adminId = $this->requireBrokerOrAdmin();
        $superAdmin = $this->isSuperAdmin();
        $tenantId = $this->getTenantId();

        if ($superAdmin) {
            $report = DB::selectOne("SELECT id, status, tenant_id, reporter_id, target_type, target_id FROM reports WHERE id = ?", [$id]);
        } else {
            $report = DB::selectOne("SELECT id, status, tenant_id, reporter_id, target_type, target_id FROM reports WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
        }

        if (!$report) {
            return $this->respondWithError('NOT_FOUND', __('api.report_not_found'), null, 404);
        }

        if ($guard = $this->guardBrokerNotParty($report, $adminId)) return $guard;

        if (!in_array($report->status, ['open', 'pending'], true)) {
            return $this->respondWithError('ALREADY_PROCESSED', __('api.report_already_status', ['status' => $report->status]), null, 400);
        }

        $reportTenantId = (int) $report->tenant_id;

        DB::update(
            "UPDATE reports SET status = 'resolved', updated_at = NOW() WHERE id = ? AND tenant_id = ?",
            [$id, $reportTenantId]
        );

        ActivityLog::log(
            $adminId,
            'resolve_report',
            "Resolved report ID {$id}" . ($superAdmin ? " (tenant {$reportTenantId})" : '')
        );

        // Notify the report creator, rendered in the reporter's preferred
        // language (scoped to the report's tenant for the super-admin path).
        try {
            $reporterId = (int) $report->reporter_id;

            if ($reporterId) {
                $link = $report->target_type && $report->target_id
                    ? \App\Services\SocialNotificationService::getContentLink(
                        (string) $report->target_type,
                        (int) $report->target_id,
                    )
                    : null;

                $recipient = DB::table('users')
                    ->where('id', $reporterId)
                    ->where('tenant_id', $reportTenantId)
                    ->select(['preferred_language'])
                    ->first();

                LocaleContext::withLocale($recipient, function () use ($reporterId, $link) {
                    $msg = __('api_controllers_3.admin_bells.report_resolved');
                    Notification::createNotification(
                        $reporterId,
                        $msg,
                        $link,
                        'moderation',
                        false
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) ($reporterId), 'moderation', $msg, $link);
                });
            }
        } catch (\Throwable $e) {
            Log::warning("AdminReportsController::resolve notification failed: " . $e->getMessage());
        }

        return $this->respondWithData(['success' => true, 'message' => __('api_controllers_1.admin_reports.report_resolved')]);
    }

    /**
     * POST /api/v2/admin/reports/{id}/dismiss
     */
    public function dismiss(int $id): JsonResponse
    {
        $adminId = $this->requireBrokerOrAdmin();
        $superAdmin = $this->isSuperAdmin();
        $tenantId = $this->getTenantId();

        if ($superAdmin) {
            $report = DB::selectOne("SELECT id, status, tenant_id, reporter_id, target_type, target_id FROM reports WHERE id = ?", [$id]);
        } else {
            $report = DB::selectOne("SELECT id, status, tenant_id, reporter_id, target_type, target_id FROM reports WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
        }

        if (!$report) {
            return $this->respondWithError('NOT_FOUND', __('api.report_not_found'), null, 404);
        }

        if ($guard = $this->guardBrokerNotParty($report, $adminId)) return $guard;

        if (!in_array($report->status, ['open', 'pending'], true)) {
            return $this->respondWithError('ALREADY_PROCESSED', __('api.report_already_status', ['status' => $report->status]), null, 400);
        }

        $reportTenantId = (int) $report->tenant_id;

        DB::update(
            "UPDATE reports SET status = 'dismissed', updated_at = NOW() WHERE id = ? AND tenant_id = ?",
            [$id, $reportTenantId]
        );

        ActivityLog::log(
            $adminId,
            'dismiss_report',
            "Dismissed report ID {$id}" . ($superAdmin ? " (tenant {$reportTenantId})" : '')
        );

        // Notify the report creator (neutral wording — "reviewed" not
        // "dismissed"), rendered in the reporter's preferred language (scoped to
        // the report's tenant for the super-admin path).
        try {
            $reporterId = (int) $report->reporter_id;

            if ($reporterId) {
                $recipient = DB::table('users')
                    ->where('id', $reporterId)
                    ->where('tenant_id', $reportTenantId)
                    ->select(['preferred_language'])
                    ->first();

                LocaleContext::withLocale($recipient, function () use ($reporterId) {
                    $msg = __('api_controllers_3.admin_bells.report_reviewed');
                    Notification::createNotification(
                        $reporterId,
                        $msg,
                        null,
                        'moderation',
                        false
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) ($reporterId), 'moderation', $msg, null);
                });
            }
        } catch (\Throwable $e) {
            Log::warning("AdminReportsController::dismiss notification failed: " . $e->getMessage());
        }

        return $this->respondWithData(['success' => true, 'message' => __('api_controllers_1.admin_reports.report_dismissed')]);
    }

    /**
     * GET /api/v2/admin/reports/stats
     */
    public function stats(): JsonResponse
    {
        $this->requireBrokerOrAdmin();
        $superAdmin = $this->isSuperAdmin();
        $tenantId = $this->getTenantId();

        $effectiveTenantId = $this->resolveEffectiveTenantId($superAdmin, $tenantId);
        $tenantWhere = $effectiveTenantId !== null ? 'tenant_id = ?' : '1=1';
        $tenantParams = $effectiveTenantId !== null ? [$effectiveTenantId] : [];

        $stats = DB::selectOne(
            "SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status IN ('open', 'pending') THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved,
                SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END) as dismissed
             FROM reports
             WHERE {$tenantWhere}",
            $tenantParams
        );

        return $this->respondWithData([
            'total' => (int) ($stats->total ?? 0),
            'pending' => (int) ($stats->pending ?? 0),
            'resolved' => (int) ($stats->resolved ?? 0),
            'dismissed' => (int) ($stats->dismissed ?? 0),
        ]);
    }
}
