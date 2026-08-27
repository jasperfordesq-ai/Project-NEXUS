<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\JobVacancy;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * JobModerationService — Admin approval workflow for job vacancies.
 *
 * Handles pending review queue, approval/rejection/flagging of jobs,
 * and moderation statistics. Checks typed jobs configuration first, then the
 * legacy `jobs_require_moderation` tenant setting for older tenants.
 */
class JobModerationService
{
    /**
     * Check whether the current tenant requires job moderation.
     */
    public static function isModerationEnabled(int $tenantId): bool
    {
        $configured = TenantContext::getSetting(JobConfigurationService::CONFIG_MODERATION_ENABLED, null);
        if ($configured !== null) {
            if (is_bool($configured)) {
                return $configured;
            }

            return filter_var($configured, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? false;
        }

        $setting = TenantContext::getSetting('jobs_require_moderation', false);

        // Support both boolean and string representations
        if (is_string($setting)) {
            return in_array(strtolower($setting), ['true', '1', 'yes'], true);
        }

        return (bool) $setting;
    }

    /**
     * Get jobs awaiting review (moderation_status = 'pending_review').
     *
     * @return array{items: array, total: int}
     */
    public static function getPendingJobs(int $tenantId, int $limit = 50, int $offset = 0): array
    {
        $query = JobVacancy::where('tenant_id', $tenantId)
            ->where('moderation_status', 'pending_review')
            ->with(['creator:id,first_name,last_name,profile_type,organization_name,avatar_url'])
            ->orderByDesc('created_at');

        $total = $query->count();

        $items = $query->offset($offset)->limit($limit)->get()->map(function ($job) {
            return [
                'id' => $job->id,
                'title' => $job->title,
                'description' => $job->description,
                'type' => $job->type,
                'category' => $job->category,
                'location' => $job->location,
                'status' => $job->status,
                'moderation_status' => $job->moderation_status,
                'moderation_notes' => $job->moderation_notes,
                'spam_score' => $job->spam_score,
                'spam_flags' => $job->spam_flags,
                'created_at' => $job->created_at?->toIso8601String(),
                'poster_name' => $job->creator
                    ? UserDisplayName::resolve($job->creator)
                    : null,
                'poster_avatar' => $job->creator?->avatar_url,
                'user_id' => $job->user_id,
            ];
        })->all();

        return [
            'items' => $items,
            'total' => $total,
        ];
    }

    /**
     * Approve a job vacancy — sets moderation_status to 'approved' and status to 'open'.
     */
    public static function approveJob(int $jobId, int $adminId, ?string $notes = null): bool
    {
        $tenantId = TenantContext::getId();

        $job = JobVacancy::where('id', $jobId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$job) {
            return false;
        }

        try {
            $job->update([
                'moderation_status' => 'approved',
                'moderation_notes' => $notes,
                'moderated_by' => $adminId,
                'moderated_at' => now(),
                'status' => 'open',
            ]);

            Log::info("Job #{$jobId} approved by admin #{$adminId}", [
                'tenant_id' => $tenantId,
                'job_id' => $jobId,
            ]);

            // Notify the job poster — render in poster's preferred_language, not admin's locale
            try {
                $poster = User::select('id', 'email', 'first_name', 'preferred_language')->find($job->user_id);
                LocaleContext::withLocale($poster, function () use ($job, $jobId, $poster) {
                    Notification::createNotification(
                        (int) $job->user_id,
                        __('emails_misc.jobs.posting_approved'),
                        "/jobs/{$jobId}",
                        'job_moderation'
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) ($job->user_id), 'job_moderation', __('emails_misc.jobs.posting_approved'), "/jobs/{$jobId}");

                    // Durable email — the bell + push above leave no lasting record.
                    if ($poster && !empty($poster->email)) {
                        // Subject is a plain-text MIME header and title() escapes
                        // at render — only the raw-HTML paragraph() needs escaping.
                        $titleRaw = (string) $job->title;
                        $title = htmlspecialchars($titleRaw, ENT_QUOTES, 'UTF-8');
                        $subject = __('emails_misc.jobs.posting_approved_subject', ['title' => $titleRaw]);
                        $html = \App\Core\EmailTemplateBuilder::make()
                            ->theme('success')
                            ->title($subject)
                            ->paragraph(__('emails_misc.jobs.posting_approved_email_body', ['title' => $title]))
                            ->button(__('emails_misc.jobs.posting_approved_cta'), \App\Core\EmailTemplateBuilder::tenantUrl("/jobs/{$jobId}"))
                            ->render();
                        \App\Services\EmailDispatchService::sendRaw($poster->email, $subject, $html, null, null, null, 'job_moderation', ['tenant_id' => (int) $job->tenant_id]);
                    }
                });
            } catch (\Throwable $e) {
                Log::warning('JobModerationService::approveJob notification failed', [
                    'job_id' => $jobId,
                    'user_id' => $job->user_id,
                    'error' => $e->getMessage(),
                ]);
            }

            return true;
        } catch (\Throwable $e) {
            Log::error('JobModerationService::approveJob failed: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Reject a job vacancy — sets moderation_status to 'rejected' and status to 'closed'.
     */
    public static function rejectJob(int $jobId, int $adminId, string $reason): bool
    {
        $tenantId = TenantContext::getId();

        $job = JobVacancy::where('id', $jobId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$job) {
            return false;
        }

        try {
            $job->update([
                'moderation_status' => 'rejected',
                'moderation_notes' => $reason,
                'moderated_by' => $adminId,
                'moderated_at' => now(),
                'status' => 'closed',
            ]);

            Log::info("Job #{$jobId} rejected by admin #{$adminId}: {$reason}", [
                'tenant_id' => $tenantId,
                'job_id' => $jobId,
            ]);

            // Notify the job poster — render in poster's preferred_language, not admin's locale
            try {
                $poster = User::select('id', 'email', 'first_name', 'preferred_language')->find($job->user_id);
                LocaleContext::withLocale($poster, function () use ($job, $jobId, $poster, $reason) {
                    Notification::createNotification(
                        (int) $job->user_id,
                        __('emails_misc.jobs.posting_not_approved'),
                        "/jobs/{$jobId}",
                        'job_moderation'
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) ($job->user_id), 'job_moderation', __('emails_misc.jobs.posting_not_approved'), "/jobs/{$jobId}");

                    // Durable email with the rejection reason — a negative
                    // outcome especially needs a lasting, actionable record.
                    if ($poster && !empty($poster->email)) {
                        $title = htmlspecialchars((string) $job->title, ENT_QUOTES, 'UTF-8');
                        $safeReason = htmlspecialchars((string) $reason, ENT_QUOTES, 'UTF-8');
                        $subject = __('emails_misc.jobs.posting_not_approved_subject', ['title' => $title]);
                        $html = \App\Core\EmailTemplateBuilder::make()
                            ->theme('danger')
                            ->title($subject)
                            ->paragraph(__('emails_misc.jobs.posting_not_approved_email_body', ['title' => $title, 'reason' => $safeReason]))
                            ->button(__('emails_misc.jobs.posting_not_approved_cta'), \App\Core\EmailTemplateBuilder::tenantUrl("/jobs/{$jobId}"))
                            ->render();
                        \App\Services\EmailDispatchService::sendRaw($poster->email, $subject, $html, null, null, null, 'job_moderation', ['tenant_id' => (int) $job->tenant_id]);
                    }
                });
            } catch (\Throwable $e) {
                Log::warning('JobModerationService::rejectJob notification failed', [
                    'job_id' => $jobId,
                    'user_id' => $job->user_id,
                    'error' => $e->getMessage(),
                ]);
            }

            return true;
        } catch (\Throwable $e) {
            Log::error('JobModerationService::rejectJob failed: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Flag a job vacancy for further review.
     */
    public static function flagJob(int $jobId, int $adminId, string $reason): bool
    {
        $tenantId = TenantContext::getId();

        $job = JobVacancy::where('id', $jobId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$job) {
            return false;
        }

        try {
            $job->update([
                'moderation_status' => 'flagged',
                'moderation_notes' => $reason,
                'moderated_by' => $adminId,
                'moderated_at' => now(),
            ]);

            Log::info("Job #{$jobId} flagged by admin #{$adminId}: {$reason}", [
                'tenant_id' => $tenantId,
                'job_id' => $jobId,
            ]);

            return true;
        } catch (\Throwable $e) {
            Log::error('JobModerationService::flagJob failed: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Get moderation statistics for the current tenant.
     *
     * @return array{pending: int, approved_today: int, rejected_today: int, flagged: int, total_reviewed: int}
     */
    public static function getModerationStats(int $tenantId): array
    {
        $today = now()->startOfDay();

        $pending = JobVacancy::where('tenant_id', $tenantId)
            ->where('moderation_status', 'pending_review')
            ->count();

        $approvedToday = JobVacancy::where('tenant_id', $tenantId)
            ->where('moderation_status', 'approved')
            ->where('moderated_at', '>=', $today)
            ->count();

        $rejectedToday = JobVacancy::where('tenant_id', $tenantId)
            ->where('moderation_status', 'rejected')
            ->where('moderated_at', '>=', $today)
            ->count();

        $flagged = JobVacancy::where('tenant_id', $tenantId)
            ->where('moderation_status', 'flagged')
            ->count();

        $totalReviewed = JobVacancy::where('tenant_id', $tenantId)
            ->whereNotNull('moderated_at')
            ->count();

        return [
            'pending' => $pending,
            'approved_today' => $approvedToday,
            'rejected_today' => $rejectedToday,
            'flagged' => $flagged,
            'total_reviewed' => $totalReviewed,
        ];
    }
}
