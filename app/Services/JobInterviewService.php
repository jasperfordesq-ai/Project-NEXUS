<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\Mailer;
use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\I18n\LocaleContext;
use App\Models\JobApplication;
use App\Models\JobInterview;
use App\Models\Notification;
use App\Models\Tenant;
use App\Services\RealtimeService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * JobInterviewService — Manages interview scheduling between employers and candidates.
 *
 * All queries are tenant-scoped via TenantContext::getId().
 */
class JobInterviewService
{
    /**
     * Propose an interview (employer proposes to candidate).
     *
     * @param int   $applicationId   The application ID.
     * @param int   $proposedByUserId The user proposing the interview (employer/job poster).
     * @param array $data             interview_type, scheduled_at, duration_mins, location_notes
     * @return array|false            The created interview as array, or false on failure.
     */
    public static function propose(int $applicationId, int $proposedByUserId, array $data): array|false
    {
        $tenantId = TenantContext::getId();

        try {
            $application = JobApplication::with(['vacancy'])->find($applicationId);

            if (!$application || !$application->vacancy) {
                return false;
            }

            // Scope check — vacancy must belong to this tenant
            if ((int) $application->vacancy->tenant_id !== $tenantId) {
                return false;
            }

            // Only the job poster can propose an interview
            if ((int) $application->vacancy->user_id !== $proposedByUserId) {
                return false;
            }

            if (empty($data['scheduled_at'])) {
                return false;
            }

            // Don't propose interviews for applications the candidate has withdrawn or
            // that have already been rejected.
            if (in_array((string) $application->status, ['withdrawn', 'rejected'], true)) {
                return false;
            }

            app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
                $proposedByUserId,
                (int) $application->user_id,
                $tenantId,
                'job_interview_proposal',
            );

            $interview = JobInterview::create([
                'tenant_id'      => $tenantId,
                'vacancy_id'     => (int) $application->vacancy_id,
                'application_id' => $applicationId,
                'proposed_by'    => $proposedByUserId,
                'interview_type' => $data['interview_type'] ?? 'video',
                'scheduled_at'   => $data['scheduled_at'],
                'duration_mins'  => isset($data['duration_mins']) ? (int) $data['duration_mins'] : 60,
                'location_notes' => $data['location_notes'] ?? null,
                'status'         => 'proposed',
            ]);

            // Notify the candidate
            try {
                $candidateId = (int) $application->user_id;
                $candidate = DB::table('users')
                    ->where('id', $candidateId)
                    ->where('tenant_id', $tenantId)
                    ->select(['id', 'preferred_language'])
                    ->first();

                LocaleContext::withLocale($candidate, function () use ($application, $candidateId) {
                    $jobTitle = $application->vacancy->title ?? __('emails.common.fallback_job');
                    $interviewMsg = __('emails_misc.jobs.interview_requested', ['title' => $jobTitle]);
                    Notification::createNotification(
                        $candidateId,
                        $interviewMsg,
                        "/jobs/{$application->vacancy_id}",
                        'job_application'
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) $candidateId, 'job_application', $interviewMsg, "/jobs/{$application->vacancy_id}");
                    RealtimeService::broadcastAndPush($candidateId, $interviewMsg, [
                        'type'      => 'job_interview_proposed',
                        'job_id'    => (int) $application->vacancy_id,
                        'job_title' => $jobTitle,
                        'message'   => $interviewMsg,
                        'url'       => "/jobs/{$application->vacancy_id}",
                    ]);
                    static::sendInterviewEmail(
                        $candidateId,
                        'emails_misc.jobs.interview_email_subject_proposed',
                        'emails_misc.jobs.interview_requested',
                        ['title' => $jobTitle],
                        "/jobs/{$application->vacancy_id}"
                    );
                });
            } catch (\Throwable $e) {
                Log::warning('JobInterviewService::propose notification failed: ' . $e->getMessage());
            }

            return $interview->toArray();
        } catch (SafeguardingPolicyException $e) {
            throw $e;
        } catch (\Throwable $e) {
            Log::error('JobInterviewService::propose failed', ['error' => $e->getMessage()]);
            return false;
        }
    }

    /**
     * Accept an interview (candidate accepts).
     *
     * @param int         $interviewId The interview ID.
     * @param int         $userId      The candidate's user ID.
     * @param string|null $notes       Optional candidate notes.
     * @return bool
     */
    public static function accept(int $interviewId, int $userId, ?string $notes = null): bool
    {
        $tenantId = TenantContext::getId();

        try {
            $interview = JobInterview::with(['application.vacancy'])->find($interviewId);

            if (!$interview || (int) $interview->tenant_id !== $tenantId) {
                return false;
            }

            // Only the applicant can accept
            if (!$interview->application || (int) $interview->application->user_id !== $userId) {
                return false;
            }

            if ($interview->status !== 'proposed') {
                return false;
            }

            $posterId = (int) ($interview->application->vacancy->user_id ?? 0);
            if ($posterId <= 0) {
                return false;
            }

            $policy = app(SafeguardingInteractionPolicy::class);
            $policy->assertLocalContactAllowed(
                $posterId,
                $userId,
                $tenantId,
                'job_interview_accept',
            );
            $policy->assertLocalContactAllowed(
                $userId,
                $posterId,
                $tenantId,
                'job_interview_accept',
            );

            $interview->update([
                'status'          => 'accepted',
                'candidate_notes' => $notes ? trim($notes) : null,
            ]);

            // Notify the job poster
            try {
                $posterId = $interview->application->vacancy->user_id ?? null;
                if ($posterId) {
                    $poster = DB::table('users')
                        ->where('id', (int) $posterId)
                        ->where('tenant_id', $tenantId)
                        ->select(['id', 'preferred_language'])
                        ->first();

                    LocaleContext::withLocale($poster, function () use ($interview, $posterId) {
                        $jobTitle = $interview->application->vacancy->title ?? __('emails.common.fallback_job');
                        $acceptMsg = __('emails_misc.jobs.interview_accepted', ['title' => $jobTitle]);
                        Notification::createNotification(
                            (int) $posterId,
                            $acceptMsg,
                            "/jobs/{$interview->vacancy_id}/applications",
                            'job_application_status'
                        );
                        \App\Services\NotificationDispatcher::fanOutPush((int) $posterId, 'job_application_status', $acceptMsg, "/jobs/{$interview->vacancy_id}/applications");
                        RealtimeService::broadcastAndPush((int) $posterId, $acceptMsg, [
                            'type'      => 'job_interview_accepted',
                            'job_id'    => (int) $interview->vacancy_id,
                            'job_title' => $jobTitle,
                            'message'   => $acceptMsg,
                            'url'       => "/jobs/{$interview->vacancy_id}/applications",
                        ]);
                        static::sendInterviewEmail(
                            (int) $posterId,
                            'emails_misc.jobs.interview_email_subject_accepted',
                            'emails_misc.jobs.interview_accepted',
                            ['title' => $jobTitle],
                            "/jobs/{$interview->vacancy_id}/applications"
                        );
                    });
                }
            } catch (\Throwable $e) {
                Log::warning('JobInterviewService::accept notification failed: ' . $e->getMessage());
            }

            return true;
        } catch (SafeguardingPolicyException $e) {
            throw $e;
        } catch (\Throwable $e) {
            Log::error('JobInterviewService::accept failed', ['error' => $e->getMessage()]);
            return false;
        }
    }

    /**
     * Decline an interview (candidate declines).
     *
     * @param int         $interviewId The interview ID.
     * @param int         $userId      The candidate's user ID.
     * @param string|null $notes       Optional candidate notes.
     * @return bool
     */
    public static function decline(int $interviewId, int $userId, ?string $notes = null): bool
    {
        $tenantId = TenantContext::getId();

        try {
            $interview = JobInterview::with(['application.vacancy'])->find($interviewId);

            if (!$interview || (int) $interview->tenant_id !== $tenantId) {
                return false;
            }

            // Only the applicant can decline
            if (!$interview->application || (int) $interview->application->user_id !== $userId) {
                return false;
            }

            if ($interview->status !== 'proposed') {
                return false;
            }

            $posterId = (int) ($interview->application->vacancy->user_id ?? 0);
            if ($notes !== null && trim($notes) !== '' && $posterId > 0) {
                $decision = app(SafeguardingInteractionPolicy::class)->evaluateLocalContact(
                    $userId,
                    $posterId,
                    $tenantId,
                    'job_interview_decline_note',
                );
                if (! $decision->isAllowed()) {
                    $notes = null;
                }
            }

            $interview->update([
                'status'          => 'declined',
                'candidate_notes' => $notes ? trim($notes) : null,
            ]);

            // Notify the job poster
            try {
                $posterId = $interview->application->vacancy->user_id ?? null;
                if ($posterId) {
                    $poster = DB::table('users')
                        ->where('id', (int) $posterId)
                        ->where('tenant_id', $tenantId)
                        ->select(['id', 'preferred_language'])
                        ->first();

                    LocaleContext::withLocale($poster, function () use ($interview, $posterId) {
                        $jobTitle = $interview->application->vacancy->title ?? __('emails.common.fallback_job');
                        $declineMsg = __('emails_misc.jobs.interview_declined', ['title' => $jobTitle]);
                        Notification::createNotification(
                            (int) $posterId,
                            $declineMsg,
                            "/jobs/{$interview->vacancy_id}/applications",
                            'job_application_status'
                        );
                        \App\Services\NotificationDispatcher::fanOutPush((int) $posterId, 'job_application_status', $declineMsg, "/jobs/{$interview->vacancy_id}/applications");
                        RealtimeService::broadcastAndPush((int) $posterId, $declineMsg, [
                            'type'      => 'job_interview_declined',
                            'job_id'    => (int) $interview->vacancy_id,
                            'job_title' => $jobTitle,
                            'message'   => $declineMsg,
                            'url'       => "/jobs/{$interview->vacancy_id}/applications",
                        ]);
                        static::sendInterviewEmail(
                            (int) $posterId,
                            'emails_misc.jobs.interview_email_subject_declined',
                            'emails_misc.jobs.interview_declined',
                            ['title' => $jobTitle],
                            "/jobs/{$interview->vacancy_id}/applications"
                        );
                    });
                }
            } catch (\Throwable $e) {
                Log::warning('JobInterviewService::decline notification failed: ' . $e->getMessage());
            }

            return true;
        } catch (\Throwable $e) {
            Log::error('JobInterviewService::decline failed', ['error' => $e->getMessage()]);
            return false;
        }
    }

    /**
     * Get interviews for a vacancy (employer view).
     *
     * @param int $vacancyId
     * @return array
     */
    public static function getForVacancy(int $vacancyId): array
    {
        $tenantId = TenantContext::getId();

        try {
            return JobInterview::with(['application.applicant:id,first_name,last_name,profile_type,organization_name,avatar_url'])
                ->where('tenant_id', $tenantId)
                ->where('vacancy_id', $vacancyId)
                ->orderByDesc('scheduled_at')
                ->get()
                ->toArray();
        } catch (\Throwable $e) {
            Log::error('JobInterviewService::getForVacancy failed', ['error' => $e->getMessage()]);
            return [];
        }
    }

    /**
     * Get interviews for the current user (candidate view).
     *
     * @param int $userId
     * @return array
     */
    public static function getForUser(int $userId): array
    {
        $tenantId = TenantContext::getId();

        try {
            return JobInterview::with(['vacancy:id,title,user_id'])
                ->where('tenant_id', $tenantId)
                ->whereHas('application', function ($q) use ($userId) {
                    $q->where('user_id', $userId);
                })
                ->orderByDesc('scheduled_at')
                ->get()
                ->toArray();
        } catch (\Throwable $e) {
            Log::error('JobInterviewService::getForUser failed', ['error' => $e->getMessage()]);
            return [];
        }
    }

    /**
     * Cancel an interview (employer cancels).
     *
     * @param int $interviewId
     * @param int $userId The employer's user ID.
     * @return bool
     */
    public static function cancel(int $interviewId, int $userId): bool
    {
        $tenantId = TenantContext::getId();

        try {
            $interview = JobInterview::with(['application.vacancy'])->find($interviewId);

            if (!$interview || (int) $interview->tenant_id !== $tenantId) {
                return false;
            }

            // Only the job poster (proposed_by) can cancel
            if ((int) $interview->proposed_by !== $userId) {
                return false;
            }

            if (in_array($interview->status, ['completed', 'cancelled'], true)) {
                return false;
            }

            $interview->update(['status' => 'cancelled']);

            // Notify the candidate
            try {
                $candidateId = $interview->application->user_id ?? null;
                if ($candidateId) {
                    $candidate = DB::table('users')
                        ->where('id', (int) $candidateId)
                        ->where('tenant_id', $tenantId)
                        ->select(['id', 'preferred_language'])
                        ->first();

                    LocaleContext::withLocale($candidate, function () use ($interview, $candidateId) {
                        $jobTitle = $interview->application->vacancy->title ?? __('emails.common.fallback_job');
                        $cancelMsg = __('emails_misc.jobs.interview_cancelled', ['title' => $jobTitle]);
                        Notification::createNotification(
                            (int) $candidateId,
                            $cancelMsg,
                            "/jobs/{$interview->vacancy_id}",
                            'job_application_status'
                        );
                        \App\Services\NotificationDispatcher::fanOutPush((int) $candidateId, 'job_application_status', $cancelMsg, "/jobs/{$interview->vacancy_id}");
                        RealtimeService::broadcastAndPush((int) $candidateId, $cancelMsg, [
                            'type'      => 'job_interview_cancelled',
                            'job_id'    => (int) $interview->vacancy_id,
                            'job_title' => $jobTitle,
                            'message'   => $cancelMsg,
                            'url'       => "/jobs/{$interview->vacancy_id}",
                        ]);
                        static::sendInterviewEmail(
                            (int) $candidateId,
                            'emails_misc.jobs.interview_email_subject_cancelled',
                            'emails_misc.jobs.interview_cancelled',
                            ['title' => $jobTitle],
                            "/jobs/{$interview->vacancy_id}"
                        );
                    });
                }
            } catch (\Throwable $e) {
                Log::warning('JobInterviewService::cancel notification failed: ' . $e->getMessage());
            }

            return true;
        } catch (\Throwable $e) {
            Log::error('JobInterviewService::cancel failed', ['error' => $e->getMessage()]);
            return false;
        }
    }

    /**
     * Send interview reminders for upcoming interviews across all tenants.
     *
     * Sends reminders at two windows: 24 hours before and 1 hour before.
     * Uses separate sent markers so the 24h reminder does not suppress the
     * later 1h reminder.
     * Called from the Laravel scheduler (bootstrap/app.php).
     *
     * @return array{reminders_sent: int, errors: int}
     */
    public static function sendReminders(): array
    {
        $sent = 0;
        $errors = 0;

        try {
            $now = now();

            // Find interviews in either reminder window. Each window has its
            // own marker because users naturally expect both 24h and 1h emails.
            $upcoming = JobInterview::withoutGlobalScopes()
                ->with([
                    'application' => function ($query) {
                        $query->withoutGlobalScopes()
                            ->select(['id', 'tenant_id', 'vacancy_id', 'user_id']);
                    },
                    'vacancy' => function ($query) {
                        $query->withoutGlobalScopes()
                            ->select(['id', 'tenant_id', 'title', 'user_id']);
                    },
                ])
                ->whereIn('status', ['proposed', 'accepted'])
                ->whereNotNull('tenant_id')
                ->where('scheduled_at', '>', $now)
                ->where('scheduled_at', '<=', $now->copy()->addHours(24))
                ->where(function ($query) use ($now) {
                    $query->where(function ($q) use ($now) {
                        $q->where('scheduled_at', '<=', $now->copy()->addHour())
                            ->whereNull('reminder_1h_sent_at');
                    })->orWhere(function ($q) use ($now) {
                        $q->where('scheduled_at', '>', $now->copy()->addHour())
                            ->whereNull('reminder_24h_sent_at');
                    });
                })
                ->get();

            foreach ($upcoming as $interview) {
                $previousTenantId = TenantContext::currentId();
                try {
                    $emailOk = true;

                    // Set tenant context for this interview
                    $tenantId = (int) $interview->tenant_id;
                    TenantContext::setById($tenantId);

                    $scheduledAt = $interview->scheduled_at->format('M j, g:i A');
                    $isOneHourWindow = $interview->scheduled_at->lessThanOrEqualTo($now->copy()->addHour());
                    $hoursUntil = max(1, (int) ceil($now->diffInMinutes($interview->scheduled_at) / 60));
                    $windowColumn = $isOneHourWindow ? 'reminder_1h_sent_at' : 'reminder_24h_sent_at';

                    if ($interview->{$windowColumn} !== null) {
                        continue;
                    }

                    $lock = Cache::lock("job-interview-reminder:{$tenantId}:{$interview->id}:{$windowColumn}", 600);
                    if (!$lock->get()) {
                        continue;
                    }

                    try {
                        // Notify the candidate (render message in candidate's locale)
                        $candidateId = $interview->application->user_id ?? null;
                        if ($candidateId) {
                            $candidate = DB::table('users')
                                ->where('id', (int) $candidateId)
                                ->where('tenant_id', $tenantId)
                                ->select(['id', 'preferred_language'])
                                ->first();

                            LocaleContext::withLocale($candidate, function () use (&$emailOk, $interview, $candidateId, $isOneHourWindow, $hoursUntil, $scheduledAt) {
                                $jobTitle  = $interview->vacancy->title ?? __('emails.common.fallback_job');
                                $timeLabel = $isOneHourWindow ? __('emails_misc.jobs.interview_in_1_hour') : __('emails_misc.jobs.interview_in_hours', ['hours' => $hoursUntil]);
                                $message   = __('emails_misc.jobs.interview_reminder', ['title' => $jobTitle, 'time_label' => $timeLabel, 'scheduled_at' => $scheduledAt]);
                                $params = ['title' => $jobTitle, 'time_label' => $timeLabel, 'scheduled_at' => $scheduledAt];
                                if (static::interviewReminderEmailAlreadySent((int) $candidateId, 'emails_misc.jobs.interview_email_subject_reminder', $params)) {
                                    return;
                                }
                                if (!static::sendInterviewEmail(
                                    (int) $candidateId,
                                    'emails_misc.jobs.interview_email_subject_reminder',
                                    'emails_misc.jobs.interview_reminder',
                                    $params,
                                    "/jobs/{$interview->vacancy_id}"
                                )) {
                                    $emailOk = false;
                                    return;
                                }

                                try {
                                    Notification::createNotification(
                                        (int) $candidateId,
                                        $message,
                                        "/jobs/{$interview->vacancy_id}",
                                        'job_interview_proposed'
                                    );
                                    \App\Services\NotificationDispatcher::fanOutPush((int) $candidateId, 'job_interview_proposed', $message, "/jobs/{$interview->vacancy_id}");
                                    RealtimeService::broadcastAndPush((int) $candidateId, __('emails_misc.jobs.interview_reminder_push_title'), [
                                        'type'      => 'job_interview_reminder',
                                        'job_id'    => (int) $interview->vacancy_id,
                                        'job_title' => $jobTitle,
                                        'message'   => $message,
                                        'url'       => "/jobs/{$interview->vacancy_id}",
                                    ]);
                                } catch (\Throwable $e) {
                                    Log::warning('JobInterviewService::sendReminders candidate bell/push failed after email send', [
                                        'interview_id' => $interview->id,
                                        'user_id' => (int) $candidateId,
                                        'error' => $e->getMessage(),
                                    ]);
                                }
                            });
                        }

                        // Notify the employer/interviewer (render message in poster's locale)
                        $posterId = $interview->vacancy->user_id ?? null;
                        if ($posterId) {
                            $poster = DB::table('users')
                                ->where('id', (int) $posterId)
                                ->where('tenant_id', $tenantId)
                                ->select(['id', 'preferred_language'])
                                ->first();

                            LocaleContext::withLocale($poster, function () use (&$emailOk, $interview, $posterId, $isOneHourWindow, $hoursUntil, $scheduledAt) {
                                $jobTitle  = $interview->vacancy->title ?? __('emails.common.fallback_job');
                                $timeLabel = $isOneHourWindow ? __('emails_misc.jobs.interview_in_1_hour') : __('emails_misc.jobs.interview_in_hours', ['hours' => $hoursUntil]);
                                $message   = __('emails_misc.jobs.interview_reminder', ['title' => $jobTitle, 'time_label' => $timeLabel, 'scheduled_at' => $scheduledAt]);
                                $params = ['title' => $jobTitle, 'time_label' => $timeLabel, 'scheduled_at' => $scheduledAt];
                                if (static::interviewReminderEmailAlreadySent((int) $posterId, 'emails_misc.jobs.interview_email_subject_reminder', $params)) {
                                    return;
                                }
                                if (!static::sendInterviewEmail(
                                    (int) $posterId,
                                    'emails_misc.jobs.interview_email_subject_reminder',
                                    'emails_misc.jobs.interview_reminder',
                                    $params,
                                    "/jobs/{$interview->vacancy_id}/applications"
                                )) {
                                    $emailOk = false;
                                    return;
                                }

                                try {
                                    Notification::createNotification(
                                        (int) $posterId,
                                        $message,
                                        "/jobs/{$interview->vacancy_id}/applications",
                                        'job_interview_proposed'
                                    );
                                    \App\Services\NotificationDispatcher::fanOutPush((int) $posterId, 'job_interview_proposed', $message, "/jobs/{$interview->vacancy_id}/applications");
                                    RealtimeService::broadcastAndPush((int) $posterId, __('emails_misc.jobs.interview_reminder_push_title'), [
                                        'type'      => 'job_interview_reminder',
                                        'job_id'    => (int) $interview->vacancy_id,
                                        'job_title' => $jobTitle,
                                        'message'   => $message,
                                        'url'       => "/jobs/{$interview->vacancy_id}/applications",
                                    ]);
                                } catch (\Throwable $e) {
                                    Log::warning('JobInterviewService::sendReminders poster bell/push failed after email send', [
                                        'interview_id' => $interview->id,
                                        'user_id' => (int) $posterId,
                                        'error' => $e->getMessage(),
                                    ]);
                                }
                            });
                        }

                        if ($emailOk) {
                            DB::table('job_interviews')
                                ->where('id', $interview->id)
                                ->where('tenant_id', $tenantId)
                                ->whereNull($windowColumn)
                                ->update([
                                    $windowColumn => now(),
                                    'reminder_sent_at' => now(),
                                    'updated_at' => now(),
                                ]);
                            $sent++;
                        } else {
                            $errors++;
                            Log::warning('JobInterviewService::sendReminders email failed; reminder not marked sent', [
                                'interview_id' => $interview->id,
                            ]);
                        }
                    } finally {
                        $lock->release();
                    }
                } catch (\Throwable $e) {
                    $errors++;
                    Log::warning('JobInterviewService::sendReminders failed for interview ' . $interview->id, [
                        'error' => $e->getMessage(),
                    ]);
                } finally {
                    if ($previousTenantId !== null) {
                        TenantContext::setById($previousTenantId);
                    } else {
                        TenantContext::reset();
                    }
                }
            }
        } catch (\Throwable $e) {
            Log::error('JobInterviewService::sendReminders failed', ['error' => $e->getMessage()]);
        }

        return ['reminders_sent' => $sent, 'errors' => $errors];
    }

    // =========================================================================
    // PRIVATE HELPERS
    // =========================================================================

    /**
     * Send an interview lifecycle email to a user.
     *
     * @param int    $userId     Recipient user ID
     * @param string $subjectKey Translation key for the email subject
     * @param string $messageKey Translation key for the notification message (reused as body)
     * @param array  $params     Translation params (must include 'title')
     * @param string $jobLink    URL to include as CTA
     */
    private static function interviewReminderEmailAlreadySent(int $userId, string $subjectKey, array $params): bool
    {
        $tenantId = TenantContext::getId();
        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->select(['email', 'preferred_language'])
            ->first();

        if (!$user || empty($user->email)) {
            return false;
        }

        $subject = LocaleContext::withLocale($user, fn () => __($subjectKey, $params));

        return DB::table('email_log')
            ->where('tenant_id', $tenantId)
            ->where('recipient_email', $user->email)
            ->where('category', 'job_interview')
            ->where('subject', $subject)
            ->whereIn('status', ['sent', 'delivered'])
            ->exists();
    }

    private static function sendInterviewEmail(int $userId, string $subjectKey, string $messageKey, array $params, string $jobLink): bool
    {
        try {
            $tenantId = TenantContext::getId();
            $user     = DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', $tenantId)
                ->select(['email', 'first_name', 'name', 'preferred_language'])
                ->first();

            if (!$user || empty($user->email)) {
                return false;
            }

            return (bool) LocaleContext::withLocale($user, function () use ($user, $userId, $subjectKey, $messageKey, $params, $jobLink, $tenantId) {
                $firstName  = $user->first_name ?? $user->name ?? __('emails.common.fallback_name');
                $bodyText   = __($messageKey, $params);
                $subject    = __($subjectKey, $params);
                $fullUrl    = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . $jobLink;

                $html = EmailTemplateBuilder::make()
                    ->title(__('emails_misc.jobs.interview_email_title'))
                    ->previewText($bodyText)
                    ->greeting($firstName)
                    ->paragraph($bodyText)
                    ->button(__('emails_misc.jobs.interview_email_cta'), $fullUrl)
                    ->render();

                if (!\App\Services\EmailDispatchService::sendRaw($user->email, $subject, $html, null, null, null, 'job_interview', ['tenant_id' => $tenantId])) {
                    Log::warning('[JobInterviewService] Interview email failed', ['user_id' => $userId, 'subject_key' => $subjectKey]);
                    return false;
                }

                return true;
            });
        } catch (\Throwable $e) {
            Log::warning('[JobInterviewService] sendInterviewEmail error: ' . $e->getMessage());
            return false;
        }
    }
}
