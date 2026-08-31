<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\MarketplaceListing;
use App\Models\MarketplaceReport;
use App\Models\MarketplaceSellerProfile;
use App\Models\Notification;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use App\Support\UserDisplayName;

/**
 * MarketplaceReportService — DSA notice-and-action compliance (MKT6).
 *
 * Handles user reports against marketplace listings, admin moderation,
 * appeal workflows, and DSA transparency reporting.
 */
class MarketplaceReportService
{
    // -----------------------------------------------------------------
    //  Create
    // -----------------------------------------------------------------

    /**
     * Create a new report against a marketplace listing.
     *
     * Validates the listing exists and prevents duplicate reports
     * from the same user for the same listing.
     *
     * @param int $reporterId The user filing the report
     * @param int $listingId  The listing being reported
     * @param array{reason: string, description: string, evidence_urls?: array} $data
     * @return MarketplaceReport
     *
     * @throws \InvalidArgumentException if listing not found or duplicate report
     */
    public static function createReport(int $reporterId, int $listingId, array $data): MarketplaceReport
    {
        $tenantId = TenantContext::getId();
        // Serialize reports for the same listing. Without the listing lock,
        // two concurrent requests can both pass the duplicate check and insert
        // active reports before either transaction becomes visible.
        $report = DB::transaction(function () use ($tenantId, $reporterId, $listingId, $data): MarketplaceReport {
            $listing = MarketplaceListing::where('tenant_id', $tenantId)
                ->where('id', $listingId)
                ->lockForUpdate()
                ->first();
            if (!$listing) {
                throw new \InvalidArgumentException(__('api.marketplace_listing_not_found'));
            }

            if ((int) $listing->user_id === $reporterId) {
                throw new \InvalidArgumentException(__('api.marketplace_report_own_listing'));
            }

            $existingReport = MarketplaceReport::where('reporter_id', $reporterId)
                ->where('tenant_id', $tenantId)
                ->where('marketplace_listing_id', $listingId)
                ->whereNotIn('status', ['no_action', 'appeal_resolved'])
                ->first();

            if ($existingReport) {
                throw new \InvalidArgumentException(__('api.marketplace_report_duplicate_active'));
            }

            $report = new MarketplaceReport();
            $report->tenant_id = $tenantId;
            $report->marketplace_listing_id = $listingId;
            $report->reporter_id = $reporterId;
            $report->reason = $data['reason'];
            $report->description = $data['description'];
            $report->evidence_urls = $data['evidence_urls'] ?? null;
            $report->status = 'received';
            $report->save();

            return $report;
        });

        // Send receipt confirmation to reporter (DSA requirement)
        self::queueReportNotification(
            $report,
            'received',
            'emails_misc.marketplace_report.received_subject',
            [],
            'emails_misc.marketplace_report.received_title',
            'emails_misc.marketplace_report.received_body',
            [],
            'emails_misc.marketplace_report.received_ref',
            ['report_id' => $report->id],
            '/marketplace/reports/' . $report->id,
            'emails_misc.marketplace_report.received_cta'
        );

        // Alert moderators a new DSA report awaits review within the 24h window.
        // Previously only the reporter got a receipt; admins had no signal and
        // had to poll the queue.
        try {
            \App\Services\NotificationDispatcher::notifyModerationAdmins(
                'marketplace_report_filed',
                '/admin/marketplace/reports/' . $report->id,
                'svc_notifications_2.marketplace_report.admin_alert',
                'emails_misc.moderation.marketplace_subject',
                'emails_misc.moderation.marketplace_body',
                ['report_id' => $report->id, 'reason' => (string) $report->reason],
                'danger'
            );
        } catch (\Throwable $notifyError) {
            \Illuminate\Support\Facades\Log::warning('Marketplace report admin alert failed: ' . $notifyError->getMessage());
        }

        return $report;
    }

    // -----------------------------------------------------------------
    //  Admin Actions
    // -----------------------------------------------------------------

    /**
     * Acknowledge a report (admin). Sets acknowledged_at and status to under_review.
     *
     * @param int $reportId The report to acknowledge
     * @param int $adminId  The admin performing the action
     * @return MarketplaceReport
     */
    public static function acknowledgeReport(int $reportId, int $adminId): MarketplaceReport
    {
        $report = MarketplaceReport::findOrFail($reportId);

        if (!in_array($report->status, ['received', 'acknowledged'])) {
            throw new \InvalidArgumentException(__('api.marketplace_report_acknowledge_invalid_state'));
        }

        $report->acknowledged_at = now();
        $report->status = 'under_review';
        $report->handled_by = $adminId;
        $report->save();

        // Notify reporter their report is under active review
        self::queueReportNotification(
            $report,
            'acknowledged',
            'emails_misc.marketplace_report.acknowledged_subject',
            ['report_id' => $report->id],
            'emails_misc.marketplace_report.acknowledged_title',
            'emails_misc.marketplace_report.acknowledged_body',
            ['report_id' => $report->id],
            null, [],
            '/marketplace/reports/' . $report->id,
            'emails_misc.marketplace_report.received_cta'
        );

        // Notify the SELLER their listing is under review (DSA transparency).
        try {
            self::notifySellerEnforcement(
                (int) ($report->listing->user_id ?? 0),
                (int) $report->tenant_id,
                (int) $report->marketplace_listing_id,
                (string) ($report->listing->title ?? ''),
                'under_review'
            );
        } catch (\Throwable $e) {
            Log::warning('[MarketplaceReportService] acknowledge seller notice failed: ' . $e->getMessage());
        }

        return $report;
    }

    /**
     * Resolve a report with an action decision (admin).
     *
     * If action is listing_removed, the listing is soft-removed.
     * If action is seller_suspended, all seller's listings are deactivated.
     *
     * @param int $reportId The report to resolve
     * @param int $adminId  The admin performing the action
     * @param array{action_taken: string, resolution_reason: string} $data
     * @return MarketplaceReport
     */
    public static function resolveReport(int $reportId, int $adminId, array $data): MarketplaceReport
    {
        $actionTaken = $data['action_taken'] ?? 'none';
        $report = DB::transaction(function () use ($reportId, $adminId, $data, $actionTaken): MarketplaceReport {
            $lockedReport = MarketplaceReport::query()
                ->whereKey($reportId)
                ->lockForUpdate()
                ->firstOrFail();

            if (! in_array($lockedReport->status, ['received', 'acknowledged', 'under_review'], true)) {
                throw new \InvalidArgumentException(__('api.marketplace_report_resolve_invalid_state'));
            }

            $lockedReport->status = $actionTaken === 'none' ? 'no_action' : 'action_taken';
            $lockedReport->action_taken = $actionTaken;
            if (in_array($actionTaken, ['listing_removed', 'seller_suspended'], true)) {
                $lockedReport->enforcement_snapshot = self::captureEnforcementSnapshot(
                    (int) $lockedReport->marketplace_listing_id,
                );
            }
            $lockedReport->resolution_reason = $data['resolution_reason'] ?? null;
            $lockedReport->resolved_at = now();
            $lockedReport->handled_by = $adminId;
            $lockedReport->transparency_report_included = true;
            $lockedReport->save();

            if ($actionTaken === 'listing_removed') {
                self::removeListing($lockedReport->marketplace_listing_id, (int) $lockedReport->id);
            } elseif ($actionTaken === 'seller_suspended') {
                self::suspendSeller($lockedReport->marketplace_listing_id, (int) $lockedReport->id);
            }

            return $lockedReport;
        });
        $report->loadMissing('listing');

        // Notify reporter of the decision (DSA requirement — action taken or no action)
        try {
            $bodyKey = $actionTaken !== 'none'
                ? 'emails_misc.marketplace_report.resolved_action_taken'
                : 'emails_misc.marketplace_report.resolved_no_action';
            $bodyParams = $actionTaken !== 'none' ? ['action' => $actionTaken] : [];

            self::queueReportNotification(
                $report,
                'resolved',
                'emails_misc.marketplace_report.resolved_subject',
                ['report_id' => $report->id],
                'emails_misc.marketplace_report.resolved_title',
                $bodyKey,
                $bodyParams,
                'emails_misc.marketplace_report.resolved_appeal_rights',
                [],
                '/marketplace/reports/' . $report->id,
                'emails_misc.marketplace_report.resolved_cta'
            );
        } catch (\Throwable $e) {
            Log::warning('[MarketplaceReportService] resolveReport email failed: ' . $e->getMessage());
        }

        // Notify the SELLER of the outcome (DSA transparency): enforcement detail
        // + appeal rights when action was taken, or a "no action" clearance.
        // The reporter's identity is never disclosed to the seller.
        try {
            self::notifySellerEnforcement(
                (int) ($report->listing->user_id ?? 0),
                (int) $report->tenant_id,
                (int) $report->marketplace_listing_id,
                (string) ($report->listing->title ?? ''),
                $actionTaken !== 'none' ? 'action' : 'cleared',
                $actionTaken !== 'none' ? $actionTaken : '',
                $report->resolution_reason
            );
        } catch (\Throwable $e) {
            Log::warning('[MarketplaceReportService] resolve seller notice failed: ' . $e->getMessage());
        }

        return $report;
    }

    // -----------------------------------------------------------------
    //  Appeals
    // -----------------------------------------------------------------

    /**
     * File an appeal against a resolved report.
     *
     * @param int    $reportId  The report to appeal
     * @param int    $userId The original reporter or affected seller
     * @param string $appealText The appeal justification
     * @return MarketplaceReport
     */
    public static function appealReport(int $reportId, int $userId, string $appealText): MarketplaceReport
    {
        $report = MarketplaceReport::with('listing:id,user_id,title,status')->findOrFail($reportId);
        $isReporter = (int) $report->reporter_id === $userId;
        $isAffectedSeller = (int) ($report->listing?->user_id ?? 0) === $userId;
        $eligible = ($isReporter && $report->status === 'no_action')
            || ($isAffectedSeller && $report->status === 'action_taken');
        if (! $isReporter && ! $isAffectedSeller) {
            throw new AuthorizationException(__('api.marketplace_report_access_denied'));
        }
        if (! $eligible) {
            throw new \InvalidArgumentException(__('api.marketplace_report_appeal_invalid_state'));
        }

        $report->status = 'appealed';
        $report->appeal_text = $appealText;
        $report->appealed_by = $userId;
        $report->save();

        // Confirm appeal receipt to reporter
        try {
            self::queueReportNotification(
                $report,
                'appeal_received',
                'emails_misc.marketplace_report.appeal_received_subject',
                ['report_id' => $report->id],
                'emails_misc.marketplace_report.appeal_received_title',
                'emails_misc.marketplace_report.appeal_received_body',
                ['report_id' => $report->id],
                null, [],
                '/marketplace/reports/' . $report->id,
                'emails_misc.marketplace_report.received_cta',
                $userId,
            );
        } catch (\Throwable $e) {
            Log::warning('[MarketplaceReportService] appealReport email failed: ' . $e->getMessage());
        }

        return $report;
    }

    /**
     * Resolve an appeal (admin).
     *
     * @param int $reportId The report with an active appeal
     * @param int $adminId  The admin resolving the appeal
     * @param array{action_taken: string, resolution_reason: string} $data
     * @return MarketplaceReport
     */
    public static function resolveAppeal(int $reportId, int $adminId, array $data): MarketplaceReport
    {
        $actionTaken = $data['action_taken'] ?? 'none';
        $report = DB::transaction(function () use ($reportId, $adminId, $data, $actionTaken): MarketplaceReport {
            $lockedReport = MarketplaceReport::query()
                ->whereKey($reportId)
                ->lockForUpdate()
                ->firstOrFail();

            if ($lockedReport->status !== 'appealed') {
                throw new \InvalidArgumentException(__('api.marketplace_report_not_appealed'));
            }

            $previousAction = (string) ($lockedReport->action_taken ?? 'none');
            if ($previousAction !== $actionTaken) {
                self::restoreEnforcementSnapshot($lockedReport);
            }

            $lockedReport->status = 'appeal_resolved';
            $lockedReport->action_taken = $actionTaken;
            $lockedReport->resolution_reason = $data['resolution_reason'] ?? null;
            $lockedReport->appeal_resolved_at = now();
            $lockedReport->handled_by = $adminId;
            $lockedReport->save();

            if ($actionTaken === 'listing_removed') {
                self::removeListing($lockedReport->marketplace_listing_id, (int) $lockedReport->id);
            } elseif ($actionTaken === 'seller_suspended') {
                self::suspendSeller($lockedReport->marketplace_listing_id, (int) $lockedReport->id);
            }

            return $lockedReport;
        });
        $report->loadMissing('listing');

        // Send final decision email to reporter (DSA — end of appeals process)
        try {
            self::queueReportNotification(
                $report,
                'appeal_resolved',
                'emails_misc.marketplace_report.appeal_resolved_subject',
                ['report_id' => $report->id],
                'emails_misc.marketplace_report.appeal_resolved_title',
                'emails_misc.marketplace_report.appeal_resolved_body',
                ['report_id' => $report->id],
                null, [],
                '/marketplace/reports/' . $report->id,
                'emails_misc.marketplace_report.appeal_resolved_cta',
                (int) ($report->appealed_by ?: $report->reporter_id),
            );
        } catch (\Throwable $e) {
            Log::warning('[MarketplaceReportService] resolveAppeal email failed: ' . $e->getMessage());
        }

        // Notify the SELLER of the final appeal outcome (DSA — end of the
        // appeals process). Reporter identity is never disclosed.
        try {
            self::notifySellerEnforcement(
                (int) ($report->listing->user_id ?? 0),
                (int) $report->tenant_id,
                (int) $report->marketplace_listing_id,
                (string) ($report->listing->title ?? ''),
                'appeal_outcome',
                $actionTaken !== 'none' ? $actionTaken : '',
                $report->resolution_reason
            );
        } catch (\Throwable $e) {
            Log::warning('[MarketplaceReportService] appeal seller notice failed: ' . $e->getMessage());
        }

        return $report;
    }

    // -----------------------------------------------------------------
    //  Queries
    // -----------------------------------------------------------------

    /**
     * Return a privacy-safe report view to its reporter or affected seller.
     * The seller never receives the reporter's identity, evidence URLs, or
     * free-text notice description.
     *
     * @return array<string,mixed>
     */
    public static function getReportForUser(int $reportId, int $userId): array
    {
        $report = MarketplaceReport::with('listing:id,user_id,title,status')
            ->findOrFail($reportId);
        $isReporter = (int) $report->reporter_id === $userId;
        $isSeller = (int) ($report->listing?->user_id ?? 0) === $userId;
        if (! $isReporter && ! $isSeller) {
            throw new AuthorizationException(__('api.marketplace_report_access_denied'));
        }

        return self::formatReportForViewer($report, $userId, $isReporter);
    }

    /** @return array<int,array<string,mixed>> */
    public static function getReportsForUser(int $userId): array
    {
        return MarketplaceReport::query()
            ->with('listing:id,user_id,title,status')
            ->where(function ($query) use ($userId): void {
                $query->where('reporter_id', $userId)
                    ->orWhereHas('listing', fn ($listing) => $listing->where('user_id', $userId));
            })
            ->orderByDesc('created_at')
            ->limit(100)
            ->get()
            ->map(fn (MarketplaceReport $report): array => self::formatReportForViewer(
                $report,
                $userId,
                (int) $report->reporter_id === $userId,
            ))
            ->all();
    }

    /** @return array<string,mixed> */
    private static function formatReportForViewer(MarketplaceReport $report, int $userId, bool $isReporter): array
    {
        $isSeller = ! $isReporter && (int) ($report->listing?->user_id ?? 0) === $userId;
        $canAppeal = ($isReporter && $report->status === 'no_action')
            || ($isSeller && $report->status === 'action_taken');

        return [
            'id' => (int) $report->id,
            'marketplace_listing_id' => (int) $report->marketplace_listing_id,
            'reason' => $report->reason,
            'description' => $isReporter ? $report->description : null,
            'evidence_urls' => $isReporter ? $report->evidence_urls : null,
            'status' => $report->status,
            'acknowledged_at' => $report->acknowledged_at?->toISOString(),
            'resolved_at' => $report->resolved_at?->toISOString(),
            'resolution_reason' => $report->resolution_reason,
            'action_taken' => $report->action_taken,
            'appeal_text' => (int) $report->appealed_by === $userId ? $report->appeal_text : null,
            'appeal_resolved_at' => $report->appeal_resolved_at?->toISOString(),
            'can_appeal' => $canAppeal,
            'viewer_role' => $isReporter ? 'reporter' : 'seller',
            'listing' => $report->listing ? [
                'id' => (int) $report->listing->id,
                'title' => $report->listing->title,
                'status' => $report->listing->status,
            ] : null,
        ];
    }

    /**
     * Get pending reports for admin review (offset-paginated).
     *
     * @param int    $limit  Items per page
     * @param int    $page   Page number (1-based)
     * @param string|null $status Filter by status (null = all pending states)
     * @return array{items: array, total: int, page: int, per_page: int}
     */
    public static function getPendingReports(int $limit = 20, int $page = 1, ?string $status = null): array
    {
        $query = MarketplaceReport::with([
            'listing:id,title,user_id,status',
            'reporter:id,first_name,last_name,profile_type,organization_name,avatar_url',
            'handler:id,first_name,last_name,profile_type,organization_name',
        ]);

        if ($status) {
            $query->where('status', $status);
        } else {
            $query->whereIn('status', ['received', 'acknowledged', 'under_review', 'appealed']);
        }

        $total = $query->count();

        $reports = $query->orderBy('created_at', 'asc')
            ->offset(($page - 1) * $limit)
            ->limit($limit)
            ->get();

        $items = $reports->map(fn ($r) => self::formatReport($r))->all();

        return [
            'items' => $items,
            'total' => $total,
            'page' => $page,
            'per_page' => $limit,
        ];
    }

    /**
     * Get all reports for a specific listing.
     *
     * @param int $listingId
     * @return array
     */
    public static function getReportsForListing(int $listingId): array
    {
        $reports = MarketplaceReport::with([
            'reporter:id,first_name,last_name,profile_type,organization_name,avatar_url',
            'handler:id,first_name,last_name,profile_type,organization_name',
        ])
            ->where('marketplace_listing_id', $listingId)
            ->orderBy('created_at', 'desc')
            ->get();

        return $reports->map(fn ($r) => self::formatReport($r))->all();
    }

    /**
     * Get DSA transparency statistics.
     *
     * Returns aggregate data for the current tenant: total reports,
     * average resolution time, and breakdown by action taken.
     *
     * @return array
     */
    public static function getTransparencyStats(): array
    {
        $tenantId = TenantContext::getId();

        $total = MarketplaceReport::query()
            ->where('tenant_id', $tenantId)
            ->count();

        $byStatus = MarketplaceReport::query()
            ->where('tenant_id', $tenantId)
            ->selectRaw('status, COUNT(*) as count')
            ->groupBy('status')
            ->pluck('count', 'status')
            ->all();

        $byAction = MarketplaceReport::query()
            ->where('tenant_id', $tenantId)
            ->whereNotNull('action_taken')
            ->selectRaw('action_taken, COUNT(*) as count')
            ->groupBy('action_taken')
            ->pluck('count', 'action_taken')
            ->all();

        $avgResolutionHours = MarketplaceReport::query()
            ->where('tenant_id', $tenantId)
            ->whereNotNull('resolved_at')
            ->selectRaw('AVG(TIMESTAMPDIFF(HOUR, created_at, resolved_at)) as avg_hours')
            ->value('avg_hours');

        $acknowledged24h = MarketplaceReport::query()
            ->where('tenant_id', $tenantId)
            ->whereNotNull('acknowledged_at')
            ->whereRaw('TIMESTAMPDIFF(HOUR, created_at, acknowledged_at) <= 24')
            ->count();

        $totalAcknowledged = MarketplaceReport::query()
            ->where('tenant_id', $tenantId)
            ->whereNotNull('acknowledged_at')
            ->count();

        return [
            'total_reports' => $total,
            'by_status' => $byStatus,
            'by_action' => $byAction,
            'avg_resolution_hours' => $avgResolutionHours ? round((float) $avgResolutionHours, 1) : null,
            'acknowledged_within_24h' => $acknowledged24h,
            'total_acknowledged' => $totalAcknowledged,
            'acknowledgement_rate_24h' => $totalAcknowledged > 0
                ? round($acknowledged24h / $totalAcknowledged * 100, 1)
                : null,
            'pending_reports' => ($byStatus['received'] ?? 0) + ($byStatus['acknowledged'] ?? 0) + ($byStatus['under_review'] ?? 0),
        ];
    }

    // -----------------------------------------------------------------
    //  Scheduled: Auto-acknowledge overdue reports
    // -----------------------------------------------------------------

    /**
     * Auto-acknowledge reports that have been in 'received' state
     * for more than 24 hours (DSA requirement).
     *
     * @return int Number of reports auto-acknowledged
     */
    public static function processUnacknowledged(): int
    {
        $cutoff = now()->subHours(24);

        $overdue = MarketplaceReport::withoutGlobalScopes()
            ->where('status', 'received')
            ->where('created_at', '<=', $cutoff)
            ->whereNull('acknowledged_at')
            ->get();

        $count = 0;

        foreach ($overdue as $report) {
            $previousTenantId = TenantContext::currentId();

            try {
                // Set tenant context per-report so sendReportEmail uses the correct
                // tenant's mailer, URLs, and translations.
                TenantContext::setById((int) $report->tenant_id);

                $report->status = 'acknowledged';
                $report->acknowledged_at = now();
                $report->save();
                $count++;

                // Notify reporter their report is now under review
                self::queueReportNotification(
                    $report,
                    'auto_acknowledged',
                    'emails_misc.marketplace_report.acknowledged_subject',
                    ['report_id' => $report->id],
                    'emails_misc.marketplace_report.acknowledged_title',
                    'emails_misc.marketplace_report.acknowledged_body',
                    ['report_id' => $report->id],
                    null, [],
                    '/marketplace/reports/' . $report->id,
                    'emails_misc.marketplace_report.received_cta'
                );

                // Notify the SELLER their listing is under review (DSA transparency).
                self::notifySellerEnforcement(
                    (int) ($report->listing->user_id ?? 0),
                    (int) $report->tenant_id,
                    (int) $report->marketplace_listing_id,
                    (string) ($report->listing->title ?? ''),
                    'under_review'
                );
            } catch (\Throwable $e) {
                Log::warning('[MarketplaceReportService] processUnacknowledged email failed: ' . $e->getMessage());
            } finally {
                if ($previousTenantId !== null) {
                    TenantContext::setById($previousTenantId);
                } else {
                    TenantContext::reset();
                }
            }
        }

        if ($count > 0) {
            Log::info('MarketplaceReportService: auto-acknowledged overdue reports', [
                'count' => $count,
            ]);
        }

        return $count;
    }

    // -----------------------------------------------------------------
    //  Email helpers
    // -----------------------------------------------------------------

    /**
     * Notify a marketplace SELLER (listing owner) about a moderation action on
     * their listing — DSA transparency. Sends bell + device push + email in the
     * seller's own preferred_language. Reporter identity and report details are
     * NEVER disclosed; the seller is told only what happened, a generic reason,
     * and (for enforcement) their appeal rights. Best-effort and failure
     * isolated — nothing here may unwind the moderation action.
     *
     * @param string $event     one of: under_review | action | cleared | appeal_outcome | suspended
     * @param string $actionCode listing_removed | seller_suspended | listing_rejected | '' (none)
     * @param string $reason    free-text moderation reason (optional)
     * @param bool   $appealable true for report-driven enforcement (offers the
     *   reports appeal flow); false for a direct admin action with no report to
     *   appeal (offers a contact-support note instead).
     */
    public static function notifySellerEnforcement(int $sellerId, int $tenantId, int $listingId, string $listingTitle, string $event, string $actionCode = '', ?string $reason = null, bool $appealable = true): void
    {
        if ($sellerId <= 0 || $tenantId <= 0) {
            return;
        }

        $seller = DB::table('users')
            ->where('id', $sellerId)
            ->where('tenant_id', $tenantId)
            ->first(['id', 'email', 'first_name', 'preferred_language']);
        if (!$seller) {
            return;
        }

        $isEnforcement = in_array($event, ['action', 'appeal_outcome', 'suspended'], true);
        // Account-level events (suspension) and missing listings link to the
        // marketplace home rather than to a specific listing.
        $link = ($event === 'suspended' || $listingId <= 0) ? '/marketplace' : ('/marketplace/' . $listingId);

        \App\I18n\LocaleContext::withLocale($seller, function () use ($seller, $sellerId, $tenantId, $event, $actionCode, $reason, $listingTitle, $link, $isEnforcement, $appealable): void {
            $ns = 'emails_misc.marketplace_enforcement.';
            $actionLabel = $actionCode !== '' ? __($ns . 'action_label_' . $actionCode) : __($ns . 'action_label_none');
            $params = [
                'title'  => $listingTitle !== '' ? $listingTitle : ('#' . 0),
                'action' => $actionLabel,
                'reason' => ($reason !== null && trim($reason) !== '') ? $reason : __($ns . 'reason_unspecified'),
            ];

            $bellMsg = trim(strip_tags(__('svc_notifications_2.marketplace_enforcement.' . $event . '_bell', $params)));

            try {
                Notification::createNotification($sellerId, $bellMsg, $link, 'marketplace_enforcement', true, $tenantId);
            } catch (\Throwable $e) {
                Log::warning('[MarketplaceReportService] seller enforcement bell failed: ' . $e->getMessage(), ['user_id' => $sellerId]);
            }

            try {
                \App\Services\NotificationDispatcher::fanOutPush($sellerId, 'marketplace_enforcement', $bellMsg, $link);
            } catch (\Throwable $e) {
                Log::debug('[MarketplaceReportService] seller enforcement push failed: ' . $e->getMessage());
            }

            if (empty($seller->email)) {
                return;
            }
            try {
                $base    = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix();
                $subject = __($ns . $event . '_subject', $params);
                $builder = \App\Core\EmailTemplateBuilder::make()
                    ->theme($isEnforcement ? 'danger' : 'brand')
                    ->title($subject)
                    ->paragraph(__($ns . $event . '_body', $params));
                if ($isEnforcement && $appealable) {
                    $builder->paragraph(__($ns . 'action_appeal_note'))
                        ->button(__($ns . 'cta_appeal'), $base . '/marketplace/reports');
                } elseif ($isEnforcement) {
                    // Direct admin action — there is no report to appeal, so point
                    // the seller to support rather than the reports appeal flow.
                    $builder->paragraph(__($ns . 'contact_support_note'))
                        ->button(__($ns . 'cta_view'), $base . $link);
                } else {
                    $builder->button(__($ns . 'cta_view'), $base . $link);
                }
                \App\Services\EmailDispatchService::sendRaw($seller->email, $subject, $builder->render(), null, null, null, 'marketplace', ['tenant_id' => $tenantId]);
            } catch (\Throwable $e) {
                Log::warning('[MarketplaceReportService] seller enforcement email failed: ' . $e->getMessage(), ['user_id' => $sellerId]);
            }
        });
    }

    /**
     * Persist and immediately attempt report lifecycle notifications.
     *
     * @param array<string,mixed> $subjectParams
     * @param array<string,mixed> $bodyParams
     * @param array<string,mixed> $noteParams
     */
    private static function queueReportNotification(
        MarketplaceReport $report,
        string $eventType,
        string $subjectKey,
        array $subjectParams,
        string $titleKey,
        string $bodyKey,
        array $bodyParams,
        ?string $noteKey,
        array $noteParams,
        string $link,
        string $ctaKey,
        ?int $recipientOverride = null,
    ): void {
        $tenantId = (int) ($report->tenant_id ?: TenantContext::getId());
        $reportId = (int) $report->id;
        $recipientUserId = $recipientOverride ?? (int) $report->reporter_id;

        if ($tenantId <= 0 || $reportId <= 0 || $recipientUserId <= 0) {
            Log::warning('[MarketplaceReportService] skipped report notification with missing identifiers', [
                'tenant_id' => $tenantId,
                'report_id' => $reportId,
                'recipient_user_id' => $recipientUserId,
                'event_type' => $eventType,
            ]);
            return;
        }

        if (!Schema::hasTable('marketplace_report_notifications')) {
            self::sendReportEmail($recipientUserId, $subjectKey, $subjectParams, $titleKey, $bodyKey, $bodyParams, $noteKey, $noteParams, $link, $ctaKey);
            return;
        }

        $payload = [
            'subject_key' => $subjectKey,
            'subject_params' => $subjectParams,
            'title_key' => $titleKey,
            'body_key' => $bodyKey,
            'body_params' => $bodyParams,
            'note_key' => $noteKey,
            'note_params' => $noteParams,
            'link' => $link,
            'cta_key' => $ctaKey,
        ];

        foreach (['bell', 'email'] as $channel) {
            $dedupeKey = "marketplace_report:{$reportId}:{$eventType}:{$recipientUserId}";

            DB::table('marketplace_report_notifications')->insertOrIgnore([
                'tenant_id' => $tenantId,
                'marketplace_report_id' => $reportId,
                'recipient_user_id' => $recipientUserId,
                'event_type' => $eventType,
                'channel' => $channel,
                'dedupe_key' => $dedupeKey,
                'status' => 'pending',
                'attempts' => 0,
                'payload' => json_encode($payload),
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            DB::table('marketplace_report_notifications')
                ->where('tenant_id', $tenantId)
                ->where('dedupe_key', $dedupeKey)
                ->where('channel', $channel)
                ->where('status', '!=', 'sent')
                ->update([
                    'marketplace_report_id' => $reportId,
                    'recipient_user_id' => $recipientUserId,
                    'event_type' => $eventType,
                    'payload' => json_encode($payload),
                    'updated_at' => now(),
                ]);

            $row = DB::table('marketplace_report_notifications')
                ->where('tenant_id', $tenantId)
                ->where('dedupe_key', $dedupeKey)
                ->where('channel', $channel)
                ->first();

            if ($row && $row->status !== 'sent') {
                self::attemptReportNotification($row);
            }
        }
    }

    public static function retryPendingReportNotifications(int $limit = 100): int
    {
        if (!Schema::hasTable('marketplace_report_notifications')) {
            return 0;
        }

        $rows = DB::table('marketplace_report_notifications')
            ->whereIn('status', ['pending', 'failed'])
            ->where(function ($query): void {
                $query->whereNull('next_retry_at')
                    ->orWhere('next_retry_at', '<=', now());
            })
            ->orderBy('created_at')
            ->limit(max(1, min(500, $limit)))
            ->get();

        $processed = 0;
        foreach ($rows as $row) {
            self::attemptReportNotification($row);
            $processed++;
        }

        return $processed;
    }

    /**
     * @param object $row marketplace_report_notifications row
     */
    private static function attemptReportNotification(object $row): void
    {
        $payload = is_string($row->payload ?? null) ? json_decode($row->payload, true) : [];
        if (!is_array($payload)) {
            $payload = [];
        }

        $tenantId = (int) $row->tenant_id;
        $attempts = (int) $row->attempts + 1;

        DB::table('marketplace_report_notifications')
            ->where('id', $row->id)
            ->update([
                'status' => 'processing',
                'attempts' => $attempts,
                'last_attempted_at' => now(),
                'updated_at' => now(),
            ]);

        try {
            $sent = TenantContext::runForTenant($tenantId, function () use ($row, $payload): bool {
                if ($row->channel === 'bell') {
                    return self::sendReportBell((int) $row->recipient_user_id, (string) $row->event_type, $payload);
                }

                return self::sendReportEmailFromPayload((int) $row->recipient_user_id, $payload);
            });

            DB::table('marketplace_report_notifications')
                ->where('id', $row->id)
                ->update([
                    'status' => $sent ? 'sent' : 'failed',
                    'sent_at' => $sent ? now() : null,
                    'last_error' => $sent ? null : 'Dispatcher returned false',
                    'next_retry_at' => $sent ? null : now()->addMinutes(min(60, 5 * $attempts)),
                    'updated_at' => now(),
                ]);
        } catch (\Throwable $e) {
            DB::table('marketplace_report_notifications')
                ->where('id', $row->id)
                ->update([
                    'status' => 'failed',
                    'last_error' => $e->getMessage(),
                    'next_retry_at' => now()->addMinutes(min(60, 5 * $attempts)),
                    'updated_at' => now(),
                ]);

            Log::warning('[MarketplaceReportService] report notification failed', [
                'notification_id' => $row->id,
                'tenant_id' => $tenantId,
                'channel' => $row->channel,
                'event_type' => $row->event_type,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * @param array<string,mixed> $payload
     */
    private static function sendReportBell(int $userId, string $eventType, array $payload): bool
    {
        $bodyKey = (string) ($payload['body_key'] ?? '');
        $bodyParams = is_array($payload['body_params'] ?? null) ? $payload['body_params'] : [];
        $link = (string) ($payload['link'] ?? '');
        $tenantId = (int) TenantContext::getId();

        if ($bodyKey === '' || $tenantId <= 0) {
            return false;
        }

        $recipient = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->select(['id', 'preferred_language'])
            ->first();

        if (!$recipient) {
            return false;
        }

        return (bool) LocaleContext::withLocale($recipient, function () use ($userId, $eventType, $bodyKey, $bodyParams, $link, $tenantId): bool {
            $message = trim(strip_tags(__($bodyKey, $bodyParams)));
            if ($message === '') {
                return false;
            }

            Notification::createNotification(
                $userId,
                $message,
                $link,
                'marketplace_report_' . $eventType,
                true,
                $tenantId
            );
            \App\Services\NotificationDispatcher::fanOutPush($userId, 'marketplace_report_' . $eventType, $message, $link);

            return true;
        });
    }

    /**
     * @param array<string,mixed> $payload
     */
    private static function sendReportEmailFromPayload(int $userId, array $payload): bool
    {
        return self::sendReportEmail(
            $userId,
            (string) ($payload['subject_key'] ?? ''),
            is_array($payload['subject_params'] ?? null) ? $payload['subject_params'] : [],
            (string) ($payload['title_key'] ?? ''),
            (string) ($payload['body_key'] ?? ''),
            is_array($payload['body_params'] ?? null) ? $payload['body_params'] : [],
            isset($payload['note_key']) ? (string) $payload['note_key'] : null,
            is_array($payload['note_params'] ?? null) ? $payload['note_params'] : [],
            (string) ($payload['link'] ?? ''),
            (string) ($payload['cta_key'] ?? '')
        );
    }

    /**
     * Send a DSA report email to a user.
     *
     * @param array<string,mixed> $subjectParams
     * @param array<string,mixed> $bodyParams
     * @param array<string,mixed> $noteParams
     */
    private static function sendReportEmail(int $userId, string $subjectKey, array $subjectParams, string $titleKey, string $bodyKey, array $bodyParams, ?string $noteKey, array $noteParams, string $link, string $ctaKey): bool
    {
        $tenantId = TenantContext::getId();
        $user = DB::table('users')->where('id', $userId)->where('tenant_id', $tenantId)->select(['email', 'first_name', 'name', 'preferred_language'])->first();

        if (!$user || empty($user->email) || $subjectKey === '' || $titleKey === '' || $bodyKey === '' || $ctaKey === '') {
            return false;
        }

        $fullUrl = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . $link;

        return (bool) LocaleContext::withLocale($user, function () use ($user, $subjectKey, $subjectParams, $titleKey, $bodyKey, $bodyParams, $noteKey, $noteParams, $ctaKey, $fullUrl, $userId, $tenantId): bool {
            $firstName = $user->first_name ?? $user->name ?? __('emails.common.fallback_name');

            $builder = EmailTemplateBuilder::make()
                ->title(__($titleKey))
                ->greeting($firstName)
                ->paragraph(__($bodyKey, $bodyParams));

            if ($noteKey !== null) {
                $builder->paragraph(__($noteKey, $noteParams));
            }

            $html = $builder->button(__($ctaKey), $fullUrl)->render();

            $sent = \App\Services\EmailDispatchService::sendRaw($user->email, __($subjectKey, $subjectParams), $html, null, null, null, 'marketplace_report', ['tenant_id' => $tenantId]);
            if (!$sent) {
                Log::warning('[MarketplaceReportService] email failed', ['user_id' => $userId, 'subject_key' => $subjectKey]);
            }

            return $sent;
        });
    }

    // -----------------------------------------------------------------
    //  Formatting helpers
    // -----------------------------------------------------------------

    private static function formatReport(MarketplaceReport $report): array
    {
        return [
            'id' => $report->id,
            'marketplace_listing_id' => $report->marketplace_listing_id,
            'reason' => $report->reason,
            'description' => $report->description,
            'evidence_urls' => $report->evidence_urls,
            'status' => $report->status,
            'acknowledged_at' => $report->acknowledged_at?->toISOString(),
            'resolved_at' => $report->resolved_at?->toISOString(),
            'resolution_reason' => $report->resolution_reason,
            'action_taken' => $report->action_taken,
            'appeal_text' => $report->appeal_text,
            'appealed_by' => $report->appealed_by,
            'appeal_resolved_at' => $report->appeal_resolved_at?->toISOString(),
            'transparency_report_included' => $report->transparency_report_included,
            'listing' => $report->listing ? [
                'id' => $report->listing->id,
                'title' => $report->listing->title,
                'status' => $report->listing->status,
            ] : null,
            'reporter' => $report->reporter ? [
                'id' => $report->reporter->id,
                'name' => UserDisplayName::resolve($report->reporter),
                'avatar_url' => $report->reporter->avatar_url,
            ] : null,
            'handler' => $report->handler ? [
                'id' => $report->handler->id,
                'name' => UserDisplayName::resolve($report->handler),
            ] : null,
            'created_at' => $report->created_at?->toISOString(),
            'updated_at' => $report->updated_at?->toISOString(),
        ];
    }

    // -----------------------------------------------------------------
    //  Enforcement helpers
    // -----------------------------------------------------------------

    /** @return array<string,mixed> */
    private static function captureEnforcementSnapshot(int $listingId): array
    {
        $listing = MarketplaceListing::query()->whereKey($listingId)->first();
        if (! $listing) {
            return [];
        }

        $profile = MarketplaceSellerProfile::query()
            ->where('user_id', $listing->user_id)
            ->first();

        return [
            'listing_id' => (int) $listing->id,
            'seller_id' => (int) $listing->user_id,
            'listings' => MarketplaceListing::query()
                ->where('user_id', $listing->user_id)
                ->get(['id', 'status', 'moderation_status'])
                ->map(fn (MarketplaceListing $item): array => [
                    'id' => (int) $item->id,
                    'status' => (string) $item->status,
                    'moderation_status' => (string) $item->moderation_status,
                ])
                ->all(),
            'seller_profile' => $profile ? [
                'is_suspended' => (bool) $profile->is_suspended,
                'is_community_endorsed' => (bool) $profile->is_community_endorsed,
            ] : null,
        ];
    }

    /** Restore the exact pre-enforcement listing and seller state. */
    private static function restoreEnforcementSnapshot(MarketplaceReport $report): void
    {
        $snapshot = $report->enforcement_snapshot;
        if (! is_array($snapshot)) {
            return;
        }

        foreach (($snapshot['listings'] ?? []) as $listingState) {
            if (! is_array($listingState) || ! isset($listingState['id'])) {
                continue;
            }
            MarketplaceListing::query()
                ->whereKey((int) $listingState['id'])
                ->where('marketplace_enforcement_report_id', $report->id)
                ->update([
                    'status' => (string) ($listingState['status'] ?? 'inactive'),
                    'moderation_status' => (string) ($listingState['moderation_status'] ?? 'pending'),
                    'marketplace_enforcement_report_id' => null,
                ]);
        }

        $profileState = $snapshot['seller_profile'] ?? null;
        if (is_array($profileState) && isset($snapshot['seller_id'])) {
            MarketplaceSellerProfile::query()
                ->where('user_id', (int) $snapshot['seller_id'])
                ->where('marketplace_suspension_report_id', $report->id)
                ->update([
                    'is_suspended' => (bool) ($profileState['is_suspended'] ?? false),
                    'is_community_endorsed' => (bool) ($profileState['is_community_endorsed'] ?? false),
                    'marketplace_suspension_report_id' => null,
                ]);
        }
    }

    /**
     * Remove a listing by setting its status to 'removed'.
     */
    private static function removeListing(int $listingId, int $reportId): void
    {
        MarketplaceListing::where('id', $listingId)
            ->update([
                'status' => 'removed',
                'moderation_status' => 'rejected',
                'marketplace_enforcement_report_id' => $reportId,
            ]);
    }

    /**
     * Suspend the seller who owns the reported listing.
     * Deactivates all their active listings and sets is_suspended = true to
     * prevent them from creating new listings.
     */
    private static function suspendSeller(int $listingId, int $reportId): void
    {
        $listing = MarketplaceListing::find($listingId);
        if (!$listing) {
            return;
        }

        MarketplaceListing::where('user_id', $listing->user_id)
            ->where('status', 'active')
            ->update([
                'status' => 'removed',
                'moderation_status' => 'rejected',
                'marketplace_enforcement_report_id' => $reportId,
            ]);

        MarketplaceSellerProfile::where('user_id', $listing->user_id)
            ->update([
                'is_community_endorsed' => false,
                'is_suspended'          => true,
                'marketplace_suspension_report_id' => $reportId,
            ]);
    }
}
