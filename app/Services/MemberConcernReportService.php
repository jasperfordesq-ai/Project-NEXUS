<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Exceptions\MemberConcernReportException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * A member tells their community's coordinators about another member, or about
 * a message they received.
 *
 * Reports land in the shared `reports` queue that brokers, coordinators and
 * admins already work (AdminReportsController), so the existing rules apply:
 * nobody below admin tier sees or closes a report they are a party to
 * (ReportQueueVisibility), and the reporter is told when it is closed.
 *
 * The reported member is never told, and is never sent the staff alert even
 * when they are staff themselves.
 */
final class MemberConcernReportService
{
    public const CATEGORIES = [
        'safeguarding_concern',
        'harassment',
        'inappropriate',
        'scam_or_fraud',
        'spam',
        'other',
    ];

    public const DETAILS_MAX = 2000;

    private const SNAPSHOT_MAX = 5000;

    /** @throws MemberConcernReportException */
    public function reportMember(int $tenantId, int $reporterId, int $targetUserId, ?string $category, ?string $details): int
    {
        [$category, $details] = $this->validated($category, $details);

        if ($targetUserId === $reporterId) {
            throw new MemberConcernReportException('CANNOT_REPORT_SELF', 422, 'member_reports.cannot_report_self');
        }

        $exists = DB::table('users')
            ->where('id', $targetUserId)
            ->where('tenant_id', $tenantId)
            ->whereNull('deleted_at')
            ->exists();
        if (! $exists) {
            throw new MemberConcernReportException('NOT_FOUND', 404, 'member_reports.member_not_found');
        }

        return $this->file($tenantId, $reporterId, 'user', $targetUserId, $category, $details, null, $targetUserId);
    }

    /** @throws MemberConcernReportException */
    public function reportMessage(int $tenantId, int $reporterId, int $messageId, ?string $category, ?string $details): int
    {
        [$category, $details] = $this->validated($category, $details);

        // Only the person a direct message was sent to may report it, and only
        // a message from this community: a partner community's member is
        // handled by that community.
        $message = DB::table('messages')
            ->where('id', $messageId)
            ->where('tenant_id', $tenantId)
            ->where('receiver_id', $reporterId)
            ->where('sender_id', '!=', $reporterId)
            ->where(fn ($q) => $q->whereNull('is_federated')->orWhere('is_federated', 0))
            ->where('is_deleted_receiver', 0)
            ->select(['id', 'sender_id', 'body', 'transcript', 'is_voice'])
            ->first();
        if (! $message) {
            throw new MemberConcernReportException('NOT_FOUND', 404, 'member_reports.message_not_found');
        }

        $words = trim((string) ($message->body ?? ''));
        if ($words === '') {
            $words = trim((string) ($message->transcript ?? ''));
        }
        $snapshot = $words === '' ? null : mb_substr($words, 0, self::SNAPSHOT_MAX);

        return $this->file($tenantId, $reporterId, 'message', $messageId, $category, $details, $snapshot, (int) $message->sender_id);
    }

    /**
     * @return array{0: string, 1: string}
     * @throws MemberConcernReportException
     */
    private function validated(?string $category, ?string $details): array
    {
        $category = trim((string) $category);
        if (! in_array($category, self::CATEGORIES, true)) {
            throw new MemberConcernReportException('VALIDATION_ERROR', 422, 'member_reports.invalid_category', 'category');
        }

        $details = trim((string) $details);
        if (mb_strlen($details) > self::DETAILS_MAX) {
            throw new MemberConcernReportException('VALIDATION_ERROR', 422, 'member_reports.details_too_long', 'details');
        }
        if ($category === 'other' && $details === '') {
            throw new MemberConcernReportException('VALIDATION_ERROR', 422, 'member_reports.details_required', 'details');
        }

        return [$category, $details];
    }

    /** @throws MemberConcernReportException */
    private function file(
        int $tenantId,
        int $reporterId,
        string $targetType,
        int $targetId,
        string $category,
        string $details,
        ?string $snapshot,
        int $reportedUserId,
    ): int {
        $alreadyOpen = DB::table('reports')
            ->where('tenant_id', $tenantId)
            ->where('reporter_id', $reporterId)
            ->where('target_type', $targetType)
            ->where('target_id', $targetId)
            ->where('status', 'open')
            ->exists();
        if ($alreadyOpen) {
            throw new MemberConcernReportException('ALREADY_REPORTED', 409, 'member_reports.already_reported');
        }

        $reportId = (int) DB::table('reports')->insertGetId([
            'tenant_id' => $tenantId,
            'reporter_id' => $reporterId,
            'target_type' => $targetType,
            'target_id' => $targetId,
            // `reason` is what older screens show; the category code maps to a
            // translated label there when no details were given.
            'reason' => $details !== '' ? $details : $category,
            'category' => $category,
            'target_snapshot' => $snapshot,
            'status' => 'open',
            'created_at' => now(),
        ]);

        $safeguarding = $category === 'safeguarding_concern';
        try {
            NotificationDispatcher::notifyModerationAdmins(
                'member_concern_reported',
                '/broker/moderation/reports', // admin moderation moved to the broker panel; admins can open it
                $safeguarding
                    ? 'svc_notifications_2.member_concern.safeguarding_alert'
                    : ($targetType === 'message'
                        ? 'svc_notifications_2.member_concern.message_alert'
                        : 'svc_notifications_2.member_concern.member_alert'),
                $safeguarding ? 'emails_misc.moderation.safeguarding_subject' : 'emails_misc.moderation.member_concern_subject',
                $safeguarding ? 'emails_misc.moderation.safeguarding_body' : 'emails_misc.moderation.member_concern_body',
                ['report_id' => $reportId],
                $safeguarding ? 'danger' : 'warning',
                excludeUserIds: [$reporterId, $reportedUserId],
                brokerLink: '/broker/moderation/reports',
            );
        } catch (\Throwable $e) {
            // The report is saved and visible in the queue; a failed alert must
            // not tell the member their report failed.
            Log::warning('Member concern report alert failed', ['report_id' => $reportId, 'error' => $e->getMessage()]);
        }

        return $reportId;
    }
}
