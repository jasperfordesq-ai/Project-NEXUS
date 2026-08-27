<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\CaringCommunity;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Mail\SafeguardingCriticalMail;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use InvalidArgumentException;
use RuntimeException;
use App\Support\UserDisplayName;

/**
 * SafeguardingService — formal safeguarding-concern escalation workflow.
 *
 * Members can submit reports about other members, coordinators, or
 * organisations. Reports flow through a status lifecycle with a severity-
 * driven SLA and a full audit trail of actions.
 *
 * Lifecycle:
 *   submitted → triaged → investigating → resolved | dismissed
 *
 * All rows are tenant-scoped; permission checks are enforced at the
 * controller layer.
 */
class SafeguardingService
{
    public const CATEGORIES = [
        'inappropriate_behavior',
        'financial_concern',
        'exploitation',
        'neglect',
        'medical_concern',
        'other',
    ];

    public const SEVERITIES = ['low', 'medium', 'high', 'critical'];

    public const STATUSES = [
        'submitted',
        'triaged',
        'investigating',
        'resolved',
        'dismissed',
    ];

    /** Severity → review SLA hours mapping */
    private const REVIEW_SLA_HOURS = [
        'critical' => 4,
        'high'     => 24,
        'medium'   => 72,
        'low'      => 168,
    ];

    private const MAX_DESCRIPTION_LENGTH = 2000;

    private const STATUS_TRANSITIONS = [
        'submitted'     => ['submitted', 'triaged', 'investigating', 'resolved', 'dismissed'],
        'triaged'       => ['triaged', 'investigating', 'resolved', 'dismissed'],
        'investigating' => ['investigating', 'resolved', 'dismissed'],
        'resolved'      => ['resolved'],
        'dismissed'     => ['dismissed'],
    ];

    /**
     * Member submits a report.
     *
     * @return array{report_id:int}
     */
    public function submitReport(int $reporterId, array $data): array
    {
        $tenantId = (int) TenantContext::getId();

        $category = (string) ($data['category'] ?? '');
        $severity = (string) ($data['severity'] ?? 'medium');
        $description = trim((string) ($data['description'] ?? ''));
        $subjectUserId = isset($data['subject_user_id']) && $data['subject_user_id'] !== ''
            ? (int) $data['subject_user_id'] : null;
        $subjectOrganisationId = isset($data['subject_organisation_id']) && $data['subject_organisation_id'] !== ''
            ? (int) $data['subject_organisation_id'] : null;
        $evidenceUrl = trim((string) ($data['evidence_url'] ?? ''));

        if (!in_array($category, self::CATEGORIES, true)) {
            throw new InvalidArgumentException(__('api.safeguarding_invalid_category'));
        }
        if (!in_array($severity, self::SEVERITIES, true)) {
            throw new InvalidArgumentException(__('api.safeguarding_invalid_severity'));
        }
        if ($description === '') {
            throw new InvalidArgumentException(__('api.safeguarding_description_required'));
        }
        if (mb_strlen($description) > self::MAX_DESCRIPTION_LENGTH) {
            throw new InvalidArgumentException(__('api.safeguarding_description_too_long'));
        }
        if ($evidenceUrl !== '' && mb_strlen($evidenceUrl) > 500) {
            throw new InvalidArgumentException(__('api.safeguarding_evidence_url_too_long'));
        }
        if (!$this->userBelongsToTenant($reporterId, $tenantId)) {
            throw new RuntimeException(__('api.safeguarding_reporter_not_found'));
        }
        if ($subjectUserId !== null && !$this->userBelongsToTenant($subjectUserId, $tenantId)) {
            throw new RuntimeException(__('api.safeguarding_subject_user_not_found'));
        }
        if ($subjectOrganisationId !== null && !$this->organisationBelongsToTenant($subjectOrganisationId, $tenantId)) {
            throw new RuntimeException(__('api.safeguarding_subject_organisation_not_found'));
        }

        $reviewDueAt = now()->addHours(self::REVIEW_SLA_HOURS[$severity]);

        $now = now();
        $reportId = (int) DB::table('safeguarding_reports')->insertGetId([
            'tenant_id'               => $tenantId,
            'reporter_user_id'        => $reporterId,
            'subject_user_id'         => $subjectUserId,
            'subject_organisation_id' => $subjectOrganisationId,
            'category'                => $category,
            'severity'                => $severity,
            'description'             => $description,
            'evidence_url'            => $evidenceUrl !== '' ? $evidenceUrl : null,
            'status'                  => 'submitted',
            'review_due_at'           => $reviewDueAt,
            'created_at'              => $now,
            'updated_at'              => $now,
        ]);

        $this->logAction($reportId, $reporterId, 'created', null);

        if ($severity === 'critical') {
            try {
                $this->fanOutCriticalNotification($reportId, $tenantId);
            } catch (\Throwable $e) {
                Log::warning('[Safeguarding] Critical fan-out failed: ' . $e->getMessage());
            }
        }

        return ['report_id' => $reportId];
    }

    /**
     * Coordinator assigns a report to a reviewer.
     */
    public function assignReport(int $reportId, int $assigneeUserId, int $actorId): void
    {
        $tenantId = (int) TenantContext::getId();

        $report = DB::table('safeguarding_reports')
            ->where('tenant_id', $tenantId)
            ->where('id', $reportId)
            ->first();
        if (!$report) {
            throw new RuntimeException(__('api.safeguarding_report_not_found'));
        }

        $assignee = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('id', $assigneeUserId)
            ->first(['id']);
        if (!$assignee) {
            throw new RuntimeException(__('api.safeguarding_assignee_not_found'));
        }

        DB::table('safeguarding_reports')
            ->where('tenant_id', $tenantId)
            ->where('id', $reportId)
            ->update([
                'assigned_to_user_id' => $assigneeUserId,
                'updated_at'          => now(),
            ]);

        $this->logAction($reportId, $actorId, 'assigned', 'Assigned to user #' . $assigneeUserId);

        // Tell the assigned reviewer (staff-only) — bell + email + push in their
        // own locale. Best-effort: a notification failure must never unwind the
        // assignment itself.
        try {
            $this->notifyReportStaff($reportId, $tenantId, [$assigneeUserId], 'assigned');
        } catch (\Throwable $e) {
            Log::warning('[Safeguarding] assignment notification failed: ' . $e->getMessage(), [
                'report_id' => $reportId,
            ]);
        }
    }

    /**
     * Mark a report escalated (overdue or coordinator judgement).
     */
    public function escalateReport(int $reportId, int $actorId, ?string $note = null): void
    {
        $tenantId = (int) TenantContext::getId();

        $report = DB::table('safeguarding_reports')
            ->where('tenant_id', $tenantId)
            ->where('id', $reportId)
            ->first();
        if (!$report) {
            throw new RuntimeException(__('api.safeguarding_report_not_found'));
        }

        DB::table('safeguarding_reports')
            ->where('tenant_id', $tenantId)
            ->where('id', $reportId)
            ->update([
                'escalated'    => 1,
                'escalated_at' => now(),
                'updated_at'   => now(),
            ]);

        $this->logAction($reportId, $actorId, 'escalated', $note);

        // Alert safeguarding staff that this report has escalated — fired here so
        // it covers BOTH manual escalation and the SafeguardingSlaEscalateCommand
        // cron (which calls this method). Recipients: the assigned reviewer (if
        // any) plus every safeguarding.view holder. Previously an SLA breach
        // escalated silently and nobody was told. Best-effort.
        try {
            $recipients = $this->resolveSafeguardingViewers($tenantId);
            if (!empty($report->assigned_to_user_id)) {
                $recipients[] = (int) $report->assigned_to_user_id;
            }
            $this->notifyReportStaff($reportId, $tenantId, $recipients, 'escalated');
        } catch (\Throwable $e) {
            Log::warning('[Safeguarding] escalation notification failed: ' . $e->getMessage(), [
                'report_id' => $reportId,
            ]);
        }
    }

    /**
     * Coordinator transitions status.
     */
    public function changeStatus(int $reportId, string $newStatus, int $actorId, ?string $notes = null): void
    {
        if (!in_array($newStatus, self::STATUSES, true)) {
            throw new InvalidArgumentException(__('api.safeguarding_invalid_status'));
        }

        $tenantId = (int) TenantContext::getId();

        $report = DB::table('safeguarding_reports')
            ->where('tenant_id', $tenantId)
            ->where('id', $reportId)
            ->first();
        if (!$report) {
            throw new RuntimeException(__('api.safeguarding_report_not_found'));
        }
        if (!in_array($newStatus, self::STATUS_TRANSITIONS[(string) $report->status] ?? [], true)) {
            throw new InvalidArgumentException(__('api.safeguarding_invalid_status_transition', [
                'from' => (string) $report->status,
                'to' => $newStatus,
            ]));
        }

        $update = [
            'status'     => $newStatus,
            'updated_at' => now(),
        ];

        if (in_array($newStatus, ['resolved', 'dismissed'], true)) {
            $update['resolved_at'] = now();
            if ($notes !== null && trim($notes) !== '') {
                $update['resolution_notes'] = $notes;
            }
        }

        DB::table('safeguarding_reports')
            ->where('tenant_id', $tenantId)
            ->where('id', $reportId)
            ->update($update);

        $action = match ($newStatus) {
            'resolved'  => 'resolved',
            'dismissed' => 'dismissed',
            'triaged'   => 'triaged',
            default     => 'status_changed',
        };

        $this->logAction($reportId, $actorId, $action, $notes);
    }

    /**
     * Append a note action without changing status.
     */
    public function addNote(int $reportId, int $actorId, string $note): void
    {
        $note = trim($note);
        if ($note === '') {
            throw new InvalidArgumentException(__('api.safeguarding_note_required'));
        }

        $tenantId = (int) TenantContext::getId();

        $report = DB::table('safeguarding_reports')
            ->where('tenant_id', $tenantId)
            ->where('id', $reportId)
            ->first();
        if (!$report) {
            throw new RuntimeException(__('api.safeguarding_report_not_found'));
        }

        $this->logAction($reportId, $actorId, 'note_added', $note);

        DB::table('safeguarding_reports')
            ->where('tenant_id', $tenantId)
            ->where('id', $reportId)
            ->update(['updated_at' => now()]);
    }

    /**
     * List reports for coordinators with optional filters.
     *
     * @return array<int,array<string,mixed>>
     */
    public function listReports(?string $status = null, ?string $severity = null): array
    {
        $tenantId = (int) TenantContext::getId();

        if (!Schema::hasTable('safeguarding_reports')) {
            return [];
        }

        $q = DB::table('safeguarding_reports as r')
            ->leftJoin('users as reporter', function ($j) {
                $j->on('reporter.id', '=', 'r.reporter_user_id')
                  ->on('reporter.tenant_id', '=', 'r.tenant_id');
            })
            ->leftJoin('users as subj', function ($j) {
                $j->on('subj.id', '=', 'r.subject_user_id')
                  ->on('subj.tenant_id', '=', 'r.tenant_id');
            })
            ->leftJoin('users as assignee', function ($j) {
                $j->on('assignee.id', '=', 'r.assigned_to_user_id')
                  ->on('assignee.tenant_id', '=', 'r.tenant_id');
            })
            ->where('r.tenant_id', $tenantId);

        if ($status !== null && $status !== '' && in_array($status, self::STATUSES, true)) {
            $q->where('r.status', $status);
        }
        if ($severity !== null && $severity !== '' && in_array($severity, self::SEVERITIES, true)) {
            $q->where('r.severity', $severity);
        }

        $rows = $q->orderByRaw("FIELD(r.severity, 'critical', 'high', 'medium', 'low')")
            ->orderByDesc('r.created_at')
            ->limit(500)
            ->get([
                'r.id', 'r.reporter_user_id', 'r.subject_user_id', 'r.subject_organisation_id',
                'r.category', 'r.severity', 'r.description', 'r.evidence_url', 'r.status',
                'r.assigned_to_user_id', 'r.review_due_at', 'r.escalated', 'r.escalated_at',
                'r.resolution_notes', 'r.resolved_at', 'r.created_at', 'r.updated_at',
                'reporter.first_name as reporter_first', 'reporter.last_name as reporter_last',
                'subj.first_name as subj_first', 'subj.last_name as subj_last',
                'assignee.first_name as assignee_first', 'assignee.last_name as assignee_last',
            ]);

        return $rows->map(fn (object $r) => $this->formatRow($r))->all();
    }

    /**
     * Return full detail for a single report including action history.
     *
     * @return array<string,mixed>|null
     */
    public function reportDetail(int $reportId): ?array
    {
        $tenantId = (int) TenantContext::getId();

        $row = DB::table('safeguarding_reports as r')
            ->leftJoin('users as reporter', function ($j) {
                $j->on('reporter.id', '=', 'r.reporter_user_id')
                  ->on('reporter.tenant_id', '=', 'r.tenant_id');
            })
            ->leftJoin('users as subj', function ($j) {
                $j->on('subj.id', '=', 'r.subject_user_id')
                  ->on('subj.tenant_id', '=', 'r.tenant_id');
            })
            ->leftJoin('users as assignee', function ($j) {
                $j->on('assignee.id', '=', 'r.assigned_to_user_id')
                  ->on('assignee.tenant_id', '=', 'r.tenant_id');
            })
            ->where('r.tenant_id', $tenantId)
            ->where('r.id', $reportId)
            ->first([
                'r.id', 'r.reporter_user_id', 'r.subject_user_id', 'r.subject_organisation_id',
                'r.category', 'r.severity', 'r.description', 'r.evidence_url', 'r.status',
                'r.assigned_to_user_id', 'r.review_due_at', 'r.escalated', 'r.escalated_at',
                'r.resolution_notes', 'r.resolved_at', 'r.created_at', 'r.updated_at',
                'reporter.first_name as reporter_first', 'reporter.last_name as reporter_last',
                'subj.first_name as subj_first', 'subj.last_name as subj_last',
                'assignee.first_name as assignee_first', 'assignee.last_name as assignee_last',
            ]);

        if (!$row) {
            return null;
        }

        $detail = $this->formatRow($row);

        $actions = DB::table('safeguarding_report_actions as a')
            ->leftJoin('users as actor', function ($j) {
                $j->on('actor.id', '=', 'a.actor_user_id')
                  ->on('actor.tenant_id', '=', 'a.tenant_id');
            })
            ->where('a.tenant_id', $tenantId)
            ->where('a.report_id', $reportId)
            ->orderBy('a.created_at')
            ->orderBy('a.id')
            ->get([
                'a.id', 'a.actor_user_id', 'a.action', 'a.notes', 'a.created_at',
                'actor.first_name as actor_first', 'actor.last_name as actor_last',
            ])
            ->map(fn (object $a) => [
                'id'         => (int) $a->id,
                'actor_id'   => (int) $a->actor_user_id,
                'actor_name' => $this->fullName((string) ($a->actor_first ?? ''), (string) ($a->actor_last ?? '')),
                'action'     => (string) $a->action,
                'notes'      => $a->notes ? (string) $a->notes : null,
                'created_at' => (string) $a->created_at,
            ])
            ->all();

        $detail['actions'] = $actions;
        return $detail;
    }

    /**
     * Coordinator dashboard summary: counts by status, severity, plus overdue.
     *
     * @return array<string,mixed>
     */
    public function dashboardSummary(): array
    {
        $tenantId = (int) TenantContext::getId();

        if (!Schema::hasTable('safeguarding_reports')) {
            return [
                'total'                 => 0,
                'open_total'            => 0,
                'open_by_severity'      => ['critical' => 0, 'high' => 0, 'medium' => 0, 'low' => 0],
                'by_status'             => [],
                'overdue'               => 0,
                'recent'                => [],
            ];
        }

        $openStatuses = ['submitted', 'triaged', 'investigating'];

        $statusCounts = DB::table('safeguarding_reports')
            ->where('tenant_id', $tenantId)
            ->selectRaw('status, COUNT(*) as c')
            ->groupBy('status')
            ->pluck('c', 'status')
            ->toArray();

        $severityCounts = DB::table('safeguarding_reports')
            ->where('tenant_id', $tenantId)
            ->whereIn('status', $openStatuses)
            ->selectRaw('severity, COUNT(*) as c')
            ->groupBy('severity')
            ->pluck('c', 'severity')
            ->toArray();

        $overdue = (int) DB::table('safeguarding_reports')
            ->where('tenant_id', $tenantId)
            ->whereIn('status', $openStatuses)
            ->whereNotNull('review_due_at')
            ->where('review_due_at', '<', now())
            ->count();

        $total = (int) array_sum($statusCounts);
        $openTotal = 0;
        foreach ($openStatuses as $s) {
            $openTotal += (int) ($statusCounts[$s] ?? 0);
        }

        $recent = $this->listReports();
        $recent = array_slice($recent, 0, 10);

        return [
            'total'              => $total,
            'open_total'         => $openTotal,
            'open_by_severity'   => [
                'critical' => (int) ($severityCounts['critical'] ?? 0),
                'high'     => (int) ($severityCounts['high'] ?? 0),
                'medium'   => (int) ($severityCounts['medium'] ?? 0),
                'low'      => (int) ($severityCounts['low'] ?? 0),
            ],
            'by_status'          => array_map('intval', $statusCounts),
            'overdue'            => $overdue,
            'recent'             => $recent,
        ];
    }

    /**
     * Reports submitted by a given member.
     *
     * @return array<int,array<string,mixed>>
     */
    public function myReports(int $userId): array
    {
        $tenantId = (int) TenantContext::getId();

        if (!Schema::hasTable('safeguarding_reports')) {
            return [];
        }

        $rows = DB::table('safeguarding_reports')
            ->where('tenant_id', $tenantId)
            ->where('reporter_user_id', $userId)
            ->orderByDesc('created_at')
            ->limit(100)
            ->get([
                'id', 'category', 'severity', 'description', 'status',
                'review_due_at', 'escalated', 'resolved_at', 'created_at',
            ]);

        return $rows->map(function (object $r): array {
            $desc = (string) $r->description;
            return [
                'id'              => (int) $r->id,
                'category'        => (string) $r->category,
                'severity'        => (string) $r->severity,
                'description_preview' => mb_strlen($desc) > 200 ? mb_substr($desc, 0, 200) . '…' : $desc,
                'status'          => (string) $r->status,
                'review_due_at'   => $r->review_due_at ? (string) $r->review_due_at : null,
                'escalated'       => (bool) $r->escalated,
                'resolved_at'     => $r->resolved_at ? (string) $r->resolved_at : null,
                'created_at'      => (string) $r->created_at,
            ];
        })->all();
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    private function logAction(int $reportId, int $actorId, string $action, ?string $notes): void
    {
        $tenantId = (int) TenantContext::getId();

        DB::table('safeguarding_report_actions')->insert([
            'tenant_id'     => $tenantId,
            'report_id'     => $reportId,
            'actor_user_id' => $actorId,
            'action'        => $action,
            'notes'         => $notes !== null && trim($notes) !== '' ? $notes : null,
            'created_at'    => now(),
        ]);
    }

    /**
     * Resolve the user IDs holding the `safeguarding.view` permission in this
     * tenant. Best-effort — schema differs across installs, so a query failure
     * yields an empty list rather than an exception.
     *
     * @return int[]
     */
    private function resolveSafeguardingViewers(int $tenantId): array
    {
        if (!Schema::hasTable('user_permissions') || !Schema::hasTable('permissions')) {
            return [];
        }

        try {
            return DB::table('user_permissions as up')
                ->join('permissions as p', 'p.id', '=', 'up.permission_id')
                ->where('p.name', 'safeguarding.view')
                ->where('up.tenant_id', $tenantId)
                ->distinct()
                ->pluck('up.user_id')
                ->map(fn ($id) => (int) $id)
                ->all();
        } catch (\Throwable $e) {
            Log::info('[Safeguarding] viewer resolve skipped — permissions layout differs: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Notify safeguarding STAFF about an assignment or escalation on a report.
     *
     * Staff-only — recipients are passed in by the caller (the assigned reviewer
     * for 'assigned'; assigned reviewer + safeguarding.view holders for
     * 'escalated'). The report SUBJECT/member is never a recipient. Each
     * recipient receives a bell + device push + email rendered in their own
     * preferred_language. Only report metadata (id, severity, category, review
     * deadline) is disclosed — never the case description. Best-effort and
     * failure-isolated per recipient/channel; nothing here may unwind the
     * assignment/escalation that triggered it.
     *
     * @param int[]  $recipientIds
     * @param string $event 'assigned' | 'escalated'
     */
    private function notifyReportStaff(int $reportId, int $tenantId, array $recipientIds, string $event): void
    {
        $recipientIds = array_values(array_unique(array_filter(
            array_map(static fn ($id) => (int) $id, $recipientIds),
            static fn (int $id) => $id > 0
        )));
        if (empty($recipientIds) || !Schema::hasTable('safeguarding_reports') || !Schema::hasTable('notifications')) {
            return;
        }

        $report = DB::table('safeguarding_reports')
            ->where('tenant_id', $tenantId)
            ->where('id', $reportId)
            ->first(['id', 'severity', 'category', 'review_due_at']);
        if (!$report) {
            return;
        }

        $recipients = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->whereIn('id', $recipientIds)
            ->where('status', 'active')
            ->get(['id', 'email', 'first_name', 'preferred_language']);
        if ($recipients->isEmpty()) {
            return;
        }

        $params = [
            'id'            => $reportId,
            'severity'      => (string) ($report->severity ?? 'medium'),
            'category'      => (string) ($report->category ?? ''),
            'review_due_at' => $report->review_due_at ? (string) $report->review_due_at : '',
        ];

        $link     = '/admin/caring-community/safeguarding/' . $reportId;
        $adminUrl = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . $link;

        $isEscalation = $event === 'escalated';
        $bellKey  = $isEscalation ? 'svc_notifications.safeguarding.escalated_bell' : 'svc_notifications.safeguarding.assigned_bell';
        $pushType = $isEscalation ? 'safeguarding_escalated' : 'safeguarding_assigned';
        $emailNs  = $isEscalation ? 'emails_misc.safeguarding.escalation_' : 'emails_misc.safeguarding.assignment_';
        $theme    = $isEscalation ? 'danger' : 'brand';

        foreach ($recipients as $recipient) {
            $userId = (int) $recipient->id;

            LocaleContext::withLocale($recipient, function () use ($recipient, $userId, $tenantId, $bellKey, $pushType, $emailNs, $theme, $params, $link, $adminUrl): void {
                $bellMessage = __($bellKey, $params);

                // 1) Bell (tenant-safe writer), flagged important.
                try {
                    \App\Models\Notification::createNotification($userId, $bellMessage, $link, $pushType, true, $tenantId);
                } catch (\Throwable $e) {
                    Log::warning('[Safeguarding] staff bell failed: ' . $e->getMessage(), ['user_id' => $userId]);
                }

                // 2) Device push (separate channel, staff-only).
                try {
                    \App\Services\NotificationDispatcher::fanOutPush($userId, $pushType, $bellMessage, $link);
                } catch (\Throwable $e) {
                    Log::debug('[Safeguarding] staff push failed: ' . $e->getMessage());
                }

                // 3) Email — always sent (time-sensitive), rendered in the
                //    recipient's locale. Metadata only; no case description.
                if (empty($recipient->email)) {
                    return;
                }
                try {
                    $html = \App\Core\EmailTemplateBuilder::make()
                        ->theme($theme)
                        ->title(__($emailNs . 'title', $params))
                        ->paragraph(__($emailNs . 'body', $params))
                        ->button(__($emailNs . 'cta'), $adminUrl)
                        ->render();
                    $subject = __($emailNs . 'subject', $params);
                    $sent = \App\Services\EmailDispatchService::sendRaw($recipient->email, $subject, $html, null, null, null, 'safeguarding', ['tenant_id' => $tenantId]);
                    if (!$sent) {
                        Log::warning('[Safeguarding] staff email returned false from Mailer', ['user_id' => $userId]);
                    }
                } catch (\Throwable $e) {
                    Log::warning('[Safeguarding] staff email send failed', ['user_id' => $userId, 'error' => $e->getMessage()]);
                }
            });
        }
    }

    /**
     * Send a real-time notification + email to all users in this tenant who
     * hold the `safeguarding.view` permission. Best-effort; failures are logged.
     *
     * Email send is wrapped in LocaleContext::withLocale() per recipient so
     * coordinators receive the alert in their own preferred_language.
     */
    private function fanOutCriticalNotification(int $reportId, int $tenantId): void
    {
        if (!Schema::hasTable('notifications') || !Schema::hasTable('user_permissions')) {
            return;
        }

        // Resolve user IDs that hold safeguarding.view in this tenant.
        // Schema differs across installs; use a defensive query that only
        // touches columns we know exist.
        $reviewerIds = collect();
        try {
            $reviewerIds = DB::table('user_permissions as up')
                ->join('permissions as p', 'p.id', '=', 'up.permission_id')
                ->where('p.name', 'safeguarding.view')
                ->where('up.tenant_id', $tenantId)
                ->distinct()
                ->pluck('up.user_id');
        } catch (\Throwable $e) {
            Log::info('[Safeguarding] Fan-out skipped — permissions table layout differs: ' . $e->getMessage());
            return;
        }

        if ($reviewerIds->isEmpty()) {
            return;
        }

        // Hydrate recipient details (email + preferred_language) for the email
        // pass. Defensive against minor users-table column differences.
        $recipients = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->whereIn('id', $reviewerIds->all())
            ->where('status', 'active')
            ->get(['id', 'email', 'first_name', 'last_name', 'profile_type', 'organization_name', 'preferred_language']);

        // Pull the report row + reporter name for the email payload.
        $report = DB::table('safeguarding_reports')
            ->where('tenant_id', $tenantId)
            ->where('id', $reportId)
            ->first();

        $reporter = null;
        if ($report && isset($report->reporter_user_id)) {
            $reporter = DB::table('users')
                ->where('tenant_id', $tenantId)
                ->where('id', (int) $report->reporter_user_id)
                ->first(['first_name', 'last_name', 'profile_type', 'organization_name']);
        }
        $reporterName = $reporter
            ? UserDisplayName::resolve($reporter)
            : '';
        if ($reporterName === '') {
            $reporterName = 'A community member';
        }

        $adminUrl = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . '/admin/caring-community/safeguarding/' . $reportId;

        $reportPayload = [
            'id'             => $report ? (int) $report->id : $reportId,
            'category'       => $report->category ?? null,
            'severity'       => $report->severity ?? 'critical',
            'review_due_at'  => $report->review_due_at ?? null,
            'sla_hours'      => self::REVIEW_SLA_HOURS['critical'],
            'admin_url'      => $adminUrl,
        ];

        $now = now();
        foreach ($recipients as $recipient) {
            $userId = (int) $recipient->id;

            LocaleContext::withLocale($recipient, function () use ($recipient, $reportId, $reportPayload, $reporterName, $tenantId, $userId, $now): void {
                // 1) UI bell — message rendered in recipient's preferred_language.
                try {
                    DB::table('notifications')->insert([
                        'tenant_id'  => $tenantId,
                        'user_id'    => $userId,
                        'type'       => 'safeguarding_critical',
                        'message'    => __('svc_notifications.safeguarding.critical_report_submitted'),
                        'link'       => '/admin/caring-community/safeguarding/' . $reportId,
                        'is_read'    => 0,
                        'created_at' => $now,
                    ]);
                } catch (\Throwable $e) {
                    Log::warning('[Safeguarding] Notification insert failed: ' . $e->getMessage());
                }

                // 2) Email alert — subject + body rendered in recipient's preferred_language.
                if (empty($recipient->email)) {
                    return;
                }

                try {
                    // SafeguardingCriticalMail is a Laravel Mailable, but
                    // Laravel's default Mail facade uses SMTP which is NOT
                    // configured in prod — so Mail::to(...)->send(...) silently
                    // dropped every critical safeguarding alert.
                    //
                    // Render the Mailable to HTML and dispatch via the platform
                    // Mailer (Postmark via .env or per-tenant config). All other
                    // outgoing email in the platform routes this way.
                    $mailable = new SafeguardingCriticalMail($reportPayload, $reporterName);
                    $subject  = (string) ($mailable->envelope()->subject ?? __('safeguarding.critical.subject'));
                    $html     = $mailable->render();
                    $sent     = \App\Services\EmailDispatchService::sendRaw($recipient->email, $subject, $html, null, null, null, 'safeguarding', ['tenant_id' => $tenantId]);
                    if (!$sent) {
                        Log::warning('[Safeguarding] Critical email returned false from Mailer', [
                            'user_id' => $userId,
                        ]);
                    }
                } catch (\Throwable $e) {
                    Log::warning('[Safeguarding] Critical email send failed', [
                        'user_id' => $userId,
                        'error'   => $e->getMessage(),
                    ]);
                }
            });
        }
    }

    private function formatRow(object $r): array
    {
        $reporterName = $this->fullName((string) ($r->reporter_first ?? ''), (string) ($r->reporter_last ?? ''));
        $subjectName = $this->fullName((string) ($r->subj_first ?? ''), (string) ($r->subj_last ?? ''));
        $assigneeName = $this->fullName((string) ($r->assignee_first ?? ''), (string) ($r->assignee_last ?? ''));

        $now = now();
        $reviewDue = $r->review_due_at ? (string) $r->review_due_at : null;
        $isOpen = in_array((string) $r->status, ['submitted', 'triaged', 'investigating'], true);
        $isOverdue = $isOpen && $reviewDue !== null && strtotime($reviewDue) < $now->timestamp;

        return [
            'id'                       => (int) $r->id,
            'reporter_id'              => (int) $r->reporter_user_id,
            'reporter_name'            => $reporterName,
            'subject_user_id'          => $r->subject_user_id !== null ? (int) $r->subject_user_id : null,
            'subject_user_name'        => $subjectName !== '' ? $subjectName : null,
            'subject_organisation_id'  => $r->subject_organisation_id !== null ? (int) $r->subject_organisation_id : null,
            'category'                 => (string) $r->category,
            'severity'                 => (string) $r->severity,
            'description'              => (string) $r->description,
            'evidence_url'             => $r->evidence_url ? (string) $r->evidence_url : null,
            'status'                   => (string) $r->status,
            'assigned_to_user_id'      => $r->assigned_to_user_id !== null ? (int) $r->assigned_to_user_id : null,
            'assigned_to_name'         => $assigneeName !== '' ? $assigneeName : null,
            'review_due_at'            => $reviewDue,
            'is_overdue'               => $isOverdue,
            'escalated'                => (bool) $r->escalated,
            'escalated_at'             => $r->escalated_at ? (string) $r->escalated_at : null,
            'resolution_notes'         => $r->resolution_notes ? (string) $r->resolution_notes : null,
            'resolved_at'              => $r->resolved_at ? (string) $r->resolved_at : null,
            'created_at'               => (string) $r->created_at,
            'updated_at'               => (string) $r->updated_at,
        ];
    }

    private function fullName(string $first, string $last): string
    {
        return trim($first . ' ' . $last);
    }

    private function userBelongsToTenant(int $userId, int $tenantId): bool
    {
        return DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('id', $userId)
            ->exists();
    }

    private function organisationBelongsToTenant(int $organisationId, int $tenantId): bool
    {
        foreach (['vol_organizations', 'organizations'] as $table) {
            if (!Schema::hasTable($table)) {
                continue;
            }
            if (DB::table($table)
                ->where('tenant_id', $tenantId)
                ->where('id', $organisationId)
                ->exists()) {
                return true;
            }
        }

        return false;
    }
}
