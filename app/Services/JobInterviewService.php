<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\I18n\LocaleContext;
use App\Models\JobApplication;
use App\Models\JobInterview;
use App\Models\JobVacancy;
use App\Models\Notification;
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

        $idempotencyKey = trim((string) ($data['idempotency_key'] ?? ''));
        unset($data['idempotency_key']);
        if ($idempotencyKey !== '' && (strlen($idempotencyKey) < 8 || strlen($idempotencyKey) > 191)) {
            return false;
        }
        $keyHash = $idempotencyKey === '' ? null : hash('sha256', $idempotencyKey);
        $requestHash = $keyHash === null ? null : self::creationRequestHash($applicationId, $data);

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

            try {
                $scheduledAt = \Carbon\Carbon::parse((string) $data['scheduled_at']);
            } catch (\Throwable) {
                return false;
            }
            if ($scheduledAt->lessThanOrEqualTo(now())) {
                return false;
            }
            $data['scheduled_at'] = $scheduledAt->toDateTimeString();
            $interviewType = (string) ($data['interview_type'] ?? 'video');
            if (!in_array($interviewType, ['video', 'phone', 'in_person'], true)) {
                return false;
            }
            $duration = (int) ($data['duration_mins'] ?? 60);
            if ($duration < 5 || $duration > 480) {
                return false;
            }
            $data['interview_type'] = $interviewType;
            $data['duration_mins'] = $duration;

            if ($keyHash !== null && $requestHash !== null) {
                $existing = self::creationReplay($tenantId, $proposedByUserId, $keyHash, $requestHash);
                if ($existing === false) return false;
                if ($existing instanceof JobInterview) {
                    app(JobHiringDeliveryService::class)->dispatchForEvent($tenantId, 'interview_proposed', (int) $existing->id, (int) $application->user_id, true);
                    return $existing->toArray();
                }
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

            $candidateId = (int) $application->user_id;
            $interview = DB::transaction(function () use ($tenantId, $application, $applicationId, $proposedByUserId, $candidateId, $data, $keyHash, $requestHash): JobInterview|false {
                $vacancy = JobVacancy::where('id', (int) $application->vacancy_id)
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->first();
                $lockedApplication = JobApplication::where('id', $applicationId)
                    ->where('tenant_id', $tenantId)
                    ->where('vacancy_id', (int) $application->vacancy_id)
                    ->lockForUpdate()
                    ->first();
                if (!$vacancy || !$lockedApplication
                    || (int) $vacancy->user_id !== $proposedByUserId
                    || (int) $lockedApplication->user_id !== $candidateId
                    || in_array((string) ($lockedApplication->stage ?? $lockedApplication->status), ['accepted', 'rejected', 'withdrawn'], true)
                    || (string) $vacancy->status === 'filled') {
                    return false;
                }
                if ($keyHash !== null && $requestHash !== null) {
                    $existing = self::creationReplay($tenantId, $proposedByUserId, $keyHash, $requestHash);
                    if ($existing === false) return false;
                    if ($existing instanceof JobInterview) return $existing;
                }
                $created = JobInterview::create([
                    'tenant_id'      => $tenantId,
                    'vacancy_id'     => (int) $application->vacancy_id,
                    'application_id' => $applicationId,
                    'proposed_by'    => $proposedByUserId,
                    'creation_idempotency_key_hash' => $keyHash,
                    'creation_request_hash' => $requestHash,
                    'interview_type' => $data['interview_type'] ?? 'video',
                    'scheduled_at'   => $data['scheduled_at'],
                    'duration_mins'  => isset($data['duration_mins']) ? (int) $data['duration_mins'] : 60,
                    'location_notes' => $data['location_notes'] ?? null,
                    'status'         => 'proposed',
                ]);
                JobHiringDeliveryService::record($tenantId, 'interview_proposed', (int) $created->id, $candidateId);
                return $created;
            });
            if ($interview === false) return false;

            app(JobHiringDeliveryService::class)->dispatchForEvent($tenantId, 'interview_proposed', (int) $interview->id, $candidateId, true);

            return $interview->toArray();
        } catch (SafeguardingPolicyException $e) {
            throw $e;
        } catch (\Throwable $e) {
            Log::error('JobInterviewService::propose failed', ['error' => $e->getMessage()]);
            return false;
        }
    }

    private static function creationRequestHash(int $applicationId, array $data): string
    {
        ksort($data);
        return hash('sha256', json_encode(
            ['application_id' => $applicationId, 'data' => $data],
            JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
        ));
    }

    private static function creationReplay(
        int $tenantId,
        int $proposedByUserId,
        string $keyHash,
        string $requestHash,
    ): JobInterview|false|null {
        $existing = JobInterview::query()
            ->where('tenant_id', $tenantId)
            ->where('proposed_by', $proposedByUserId)
            ->where('creation_idempotency_key_hash', $keyHash)
            ->first();
        if (!$existing) return null;
        return hash_equals((string) $existing->creation_request_hash, $requestHash) ? $existing : false;
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
                if ($interview->status !== 'accepted') return false;
                $posterId = (int) ($interview->application->vacancy->user_id ?? 0);
                app(JobHiringDeliveryService::class)->dispatchForEvent($tenantId, 'interview_accepted', $interviewId, $posterId, true);
                return true;
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

            $accepted = DB::transaction(function () use ($interview, $interviewId, $userId, $notes, $tenantId): bool {
                $vacancy = JobVacancy::where('tenant_id', $tenantId)
                    ->where('id', (int) $interview->vacancy_id)
                    ->lockForUpdate()
                    ->first();
                $application = JobApplication::where('tenant_id', $tenantId)
                    ->where('id', (int) $interview->application_id)
                    ->where('vacancy_id', (int) $interview->vacancy_id)
                    ->lockForUpdate()
                    ->first();
                $lockedInterview = JobInterview::where('tenant_id', $tenantId)
                    ->where('id', $interviewId)
                    ->lockForUpdate()
                    ->first();
                if (!$vacancy || !$application || !$lockedInterview || (int) $application->user_id !== $userId) {
                    return false;
                }
                if ($lockedInterview->status !== 'proposed') {
                    return $lockedInterview->status === 'accepted';
                }
                $applicationStatus = (string) ($application->stage ?? $application->status ?? 'applied');
                if (in_array($applicationStatus, ['accepted', 'rejected', 'withdrawn'], true)) {
                    return false;
                }
                $lockedInterview->update([
                    'status' => 'accepted',
                    'candidate_notes' => $notes ? trim($notes) : null,
                ]);
                JobHiringDeliveryService::record($tenantId, 'interview_accepted', (int) $lockedInterview->id, (int) $vacancy->user_id);
                return true;
            }, 3);
            if (!$accepted) {
                return false;
            }

            app(JobHiringDeliveryService::class)->dispatchForEvent($tenantId, 'interview_accepted', $interviewId, $posterId, true);

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
                if ($interview->status !== 'declined') return false;
                $posterId = (int) ($interview->application->vacancy->user_id ?? 0);
                app(JobHiringDeliveryService::class)->dispatchForEvent($tenantId, 'interview_declined', $interviewId, $posterId, true);
                return true;
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

            $declined = DB::transaction(function () use ($interview, $interviewId, $userId, $notes, $tenantId): bool {
                $vacancy = JobVacancy::where('tenant_id', $tenantId)
                    ->where('id', (int) $interview->vacancy_id)
                    ->lockForUpdate()
                    ->first();
                $application = JobApplication::where('tenant_id', $tenantId)
                    ->where('id', (int) $interview->application_id)
                    ->where('vacancy_id', (int) $interview->vacancy_id)
                    ->lockForUpdate()
                    ->first();
                $lockedInterview = JobInterview::where('tenant_id', $tenantId)
                    ->where('id', $interviewId)
                    ->lockForUpdate()
                    ->first();
                if (!$vacancy || !$application || !$lockedInterview || (int) $application->user_id !== $userId) {
                    return false;
                }
                if ($lockedInterview->status !== 'proposed') {
                    return $lockedInterview->status === 'declined';
                }
                $applicationStatus = (string) ($application->stage ?? $application->status ?? 'applied');
                if (in_array($applicationStatus, ['accepted', 'rejected', 'withdrawn'], true)) {
                    return false;
                }
                $lockedInterview->update([
                    'status' => 'declined',
                    'candidate_notes' => $notes ? trim($notes) : null,
                ]);
                JobHiringDeliveryService::record($tenantId, 'interview_declined', (int) $lockedInterview->id, (int) $vacancy->user_id);
                return true;
            }, 3);
            if (!$declined) {
                return false;
            }

            app(JobHiringDeliveryService::class)->dispatchForEvent($tenantId, 'interview_declined', $interviewId, $posterId, true);

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
                if ($interview->status !== 'cancelled') return false;
                $candidateId = (int) ($interview->application->user_id ?? 0);
                app(JobHiringDeliveryService::class)->dispatchForEvent($tenantId, 'interview_cancelled', $interviewId, $candidateId, true);
                return true;
            }

            $candidateId = (int) ($interview->application->user_id ?? 0);
            $cancelled = DB::transaction(function () use ($interview, $interviewId, $tenantId, $candidateId): bool {
                $vacancy = JobVacancy::where('id', (int) $interview->vacancy_id)
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->first();
                $application = JobApplication::where('id', (int) $interview->application_id)
                    ->where('tenant_id', $tenantId)
                    ->where('vacancy_id', (int) $interview->vacancy_id)
                    ->lockForUpdate()
                    ->first();
                $lockedInterview = JobInterview::where('id', $interviewId)
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->first();
                if (!$vacancy || !$application || !$lockedInterview
                    || !in_array((string) $lockedInterview->status, ['proposed', 'accepted'], true)) {
                    return false;
                }
                $lockedInterview->update(['status' => 'cancelled']);
                JobHiringDeliveryService::record($tenantId, 'interview_cancelled', (int) $lockedInterview->id, $candidateId);
                return true;
            }, 3);
            if (!$cancelled) return false;
            app(JobHiringDeliveryService::class)->dispatchForEvent($tenantId, 'interview_cancelled', $interviewId, $candidateId, true);

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

                    $scheduledAt = $interview->scheduled_at
                        ->locale(\App\I18n\FormattingLocale::carbon())
                        ->isoFormat('lll');
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
                                    RealtimeService::broadcastOnly((int) $candidateId, __('emails_misc.jobs.interview_reminder_push_title'), [
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
                                    "/jobs/{$interview->vacancy_id}#applications"
                                )) {
                                    $emailOk = false;
                                    return;
                                }

                                try {
                                    Notification::createNotification(
                                        (int) $posterId,
                                        $message,
                                        "/jobs/{$interview->vacancy_id}#applications",
                                        'job_interview_proposed'
                                    );
                                    \App\Services\NotificationDispatcher::fanOutPush((int) $posterId, 'job_interview_proposed', $message, "/jobs/{$interview->vacancy_id}#applications");
                                    RealtimeService::broadcastOnly((int) $posterId, __('emails_misc.jobs.interview_reminder_push_title'), [
                                        'type'      => 'job_interview_reminder',
                                        'job_id'    => (int) $interview->vacancy_id,
                                        'job_title' => $jobTitle,
                                        'message'   => $message,
                                        'url'       => "/jobs/{$interview->vacancy_id}#applications",
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
