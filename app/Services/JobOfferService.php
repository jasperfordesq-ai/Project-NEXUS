<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\I18n\LocaleContext;
use App\Models\JobApplication;
use App\Models\JobOffer;
use App\Models\JobVacancy;
use App\Models\Notification;
use App\Services\RealtimeService;
use App\Services\WebhookDispatchService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * JobOfferService — Manages job offers sent by employers to candidates.
 *
 * All queries are tenant-scoped via TenantContext::getId().
 */
class JobOfferService
{
    /**
     * Create an offer (employer sends offer to applicant).
     *
     * @param int   $applicationId   The application ID.
     * @param int   $employerUserId  The job poster's user ID.
     * @param array $data            salary_offered, salary_currency, salary_type, start_date, message, expires_at
     * @return array|false           The created offer as array, or false on failure.
     */
    public static function create(int $applicationId, int $employerUserId, array $data): array|false
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

            // Only the job poster can create an offer
            if ((int) $application->vacancy->user_id !== $employerUserId) {
                return false;
            }

            if ((int) $application->user_id === $employerUserId) {
                return false;
            }

            // Enforce one offer per application (UNIQUE constraint on application_id)
            $existing = JobOffer::where('application_id', $applicationId)->exists();
            if ($existing) {
                return false;
            }

            // Don't offer to candidates who withdrew or were rejected, or for a vacancy
            // that has already been filled.
            if (in_array((string) $application->status, ['withdrawn', 'rejected'], true)) {
                return false;
            }
            if ((string) $application->vacancy->status === 'filled') {
                return false;
            }

            app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
                $employerUserId,
                (int) $application->user_id,
                $tenantId,
                'job_offer',
            );

            $offer = JobOffer::create([
                'tenant_id'      => $tenantId,
                'vacancy_id'     => (int) $application->vacancy_id,
                'application_id' => $applicationId,
                'user_id'        => (int) $application->user_id,
                'salary_offered' => isset($data['salary_offered']) ? (float) $data['salary_offered'] : null,
                'start_date'     => $data['start_date'] ?? null,
                'details'        => isset($data['message']) ? trim($data['message']) : (isset($data['details']) ? trim($data['details']) : null),
                'status'         => 'pending',
                'expires_at'     => $data['expires_at'] ?? null,
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
                    Notification::createNotification(
                        $candidateId,
                        __('svc_notifications.job_offer.received_bell', ['title' => $jobTitle]),
                        "/jobs/{$application->vacancy_id}",
                        'job_application_status'
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) $candidateId, 'job_application_status', __('svc_notifications.job_offer.received_bell', ['title' => $jobTitle]), "/jobs/{$application->vacancy_id}");
                    RealtimeService::broadcastOnly($candidateId, __('svc_notifications.job_offer.received_push_title'), [
                        'type'      => 'job_offer_received',
                        'job_id'    => (int) $application->vacancy_id,
                        'job_title' => $jobTitle,
                        'message'   => __('svc_notifications.job_offer.received_push_message', ['title' => $jobTitle]),
                        'url'       => "/jobs/{$application->vacancy_id}",
                    ]);
                });
            } catch (\Throwable $e) {
                Log::warning('JobOfferService::create notification failed: ' . $e->getMessage());
            }

            return $offer->toArray();
        } catch (SafeguardingPolicyException $e) {
            throw $e;
        } catch (\Throwable $e) {
            Log::error('JobOfferService::create failed', ['error' => $e->getMessage()]);
            return false;
        }
    }

    /**
     * Accept an offer (candidate accepts).
     *
     * On accept: update application status to 'accepted', update vacancy status to 'filled'.
     *
     * @param int $offerId         The offer ID.
     * @param int $candidateUserId The candidate's user ID.
     * @return bool
     */
    public static function accept(int $offerId, int $candidateUserId): bool
    {
        $tenantId = TenantContext::getId();

        try {
            $offer = JobOffer::with(['application.vacancy'])->find($offerId);

            if (!$offer || (int) $offer->tenant_id !== $tenantId) {
                return false;
            }

            // Only the applicant can accept the offer
            if (!$offer->application || (int) $offer->application->user_id !== $candidateUserId) {
                return false;
            }

            if ($offer->status !== 'pending') {
                return false;
            }

            // Check if the offer has expired
            if ($offer->expires_at && now()->greaterThan($offer->expires_at)) {
                Log::info('JobOfferService::accept rejected — offer expired', [
                    'offer_id'   => $offerId,
                    'expires_at' => $offer->expires_at,
                ]);
                return false;
            }

            $employerUserId = (int) ($offer->application->vacancy->user_id ?? 0);
            if ($employerUserId <= 0) {
                return false;
            }

            $policy = app(SafeguardingInteractionPolicy::class);
            $policy->assertLocalContactAllowed(
                $employerUserId,
                $candidateUserId,
                $tenantId,
                'job_offer_accept',
            );
            $policy->assertLocalContactAllowed(
                $candidateUserId,
                $employerUserId,
                $tenantId,
                'job_offer_accept',
            );

            // Atomically accept the offer, fill the vacancy, withdraw sibling offers and
            // mint timebank credits. Serialized on the vacancy row so that two concurrent
            // accepts — for the same offer, or for two different offers on the same
            // single-position vacancy — can never both succeed and double-credit the
            // candidate or double-fill the role.
            $creditInfo = DB::transaction(function () use ($offer, $offerId, $tenantId) {
                // Serialize all accepts for this vacancy.
                $vacancy = JobVacancy::where('id', (int) $offer->vacancy_id)
                    ->lockForUpdate()
                    ->first();

                // Re-read the offer status inside the lock — guards same-offer double accept.
                if (JobOffer::where('id', $offerId)->value('status') !== 'pending') {
                    return false;
                }

                // Another candidate already filled this single-position role.
                if ($vacancy && $vacancy->status === 'filled') {
                    Log::info('JobOfferService::accept rejected — vacancy already filled', [
                        'offer_id'   => $offerId,
                        'vacancy_id' => (int) $offer->vacancy_id,
                    ]);
                    return false;
                }

                $offer->update([
                    'status'       => 'accepted',
                    'responded_at' => now(),  // column added via 2026_03_27_000000 migration
                ]);

                // Update application status to accepted
                $offer->application->update([
                    'status' => 'accepted',
                    'stage'  => 'accepted',
                ]);

                // Update vacancy status to filled
                if ($vacancy) {
                    $vacancy->update(['status' => 'filled']);
                }

                // Withdraw any other pending offers for this single-position vacancy so a
                // second candidate cannot also accept after the role is filled.
                JobOffer::where('tenant_id', $tenantId)
                    ->where('vacancy_id', (int) $offer->vacancy_id)
                    ->where('id', '!=', $offerId)
                    ->where('status', 'pending')
                    ->update(['status' => 'withdrawn', 'responded_at' => now()]);

                // Auto-credit time credits for timebank jobs. Runs exactly once: the
                // pending→accepted transition above is serialized by the vacancy lock.
                if ($vacancy && $vacancy->type === 'timebank' && (float) $vacancy->time_credits > 0) {
                    $candidateId  = (int) $offer->application->user_id;
                    $creditAmount = (float) $vacancy->time_credits;
                    $jobTitle     = $vacancy->title ?? __('emails.common.fallback_job');

                    \App\Models\Transaction::create([
                        'sender_id'        => (int) $vacancy->user_id,
                        'receiver_id'      => $candidateId,
                        'amount'           => $creditAmount,
                        'transaction_type' => 'job_completion',
                        'description'      => __('api.job_time_credits_earned_description', ['title' => $jobTitle]),
                        'status'           => 'completed',
                    ]);

                    DB::table('users')
                        ->where('id', $candidateId)
                        ->where('tenant_id', $tenantId)
                        ->increment('balance', $creditAmount);

                    // Debit the employer who posted the role so the credit is
                    // SOURCED, not minted. The transactions row above records an
                    // employer→candidate transfer, and every other credit path on
                    // the platform pairs that ledger entry with a real debit of the
                    // sender (see VolunteerService::verifyHours, which debits the
                    // org wallet). Without this leg, a timebank hire created
                    // `time_credits` out of nothing on every accept — and posting a
                    // high-credit timebank job then self-/sock-puppet-accepting it
                    // minted arbitrary credits, breaking the timebanking
                    // conservation invariant. The employer balance may go negative,
                    // matching the volunteer org-wallet reconciliation semantics
                    // (the candidate is always paid the offered credits).
                    DB::table('users')
                        ->where('id', (int) $vacancy->user_id)
                        ->where('tenant_id', $tenantId)
                        ->decrement('balance', $creditAmount);

                    return [
                        'candidate_id'  => $candidateId,
                        'credit_amount' => $creditAmount,
                        'job_title'     => $jobTitle,
                    ];
                }

                return null;
            });

            // Already processed by a concurrent request / role already filled.
            if ($creditInfo === false) {
                return false;
            }

            // Notify the candidate about their earned credits (post-commit).
            if (is_array($creditInfo)) {
                try {
                    $candidateId  = (int) $creditInfo['candidate_id'];
                    $creditAmount = $creditInfo['credit_amount'];
                    $jobTitle     = $creditInfo['job_title'];

                    $candidate = DB::table('users')
                        ->where('id', $candidateId)
                        ->where('tenant_id', $tenantId)
                        ->select(['id', 'preferred_language'])
                        ->first();

                    LocaleContext::withLocale($candidate, function () use ($candidateId, $creditAmount, $jobTitle) {
                        Notification::createNotification(
                            $candidateId,
                            __('svc_notifications.job_offer.credits_earned_bell', ['amount' => $creditAmount, 'title' => $jobTitle]),
                            '/wallet',
                            'transaction'
                        );
                        \App\Services\NotificationDispatcher::fanOutPush((int) $candidateId, 'transaction', __('svc_notifications.job_offer.credits_earned_bell', ['amount' => $creditAmount, 'title' => $jobTitle]), '/wallet');
                        RealtimeService::broadcastOnly($candidateId, __('svc_notifications.job_offer.credits_earned_push_title'), [
                            'type'      => 'job_completion_credits',
                            'amount'    => $creditAmount,
                            'job_title' => $jobTitle,
                            'message'   => __('svc_notifications.job_offer.credits_earned_push_message', ['amount' => $creditAmount, 'title' => $jobTitle]),
                            'url'       => '/wallet',
                        ]);
                    });
                } catch (\Throwable $e) {
                    Log::warning('JobOfferService::accept auto-credit notification failed', ['error' => $e->getMessage()]);
                }
            }

            // Notify the job poster
            try {
                $posterId = $offer->application->vacancy->user_id ?? null;
                if ($posterId) {
                    $poster = DB::table('users')
                        ->where('id', (int) $posterId)
                        ->where('tenant_id', $tenantId)
                        ->select(['id', 'preferred_language'])
                        ->first();

                    LocaleContext::withLocale($poster, function () use ($offer, $posterId) {
                        $jobTitle = $offer->application->vacancy->title ?? __('emails.common.fallback_job');
                        Notification::createNotification(
                            (int) $posterId,
                            __('svc_notifications.job_offer.accepted_bell', ['title' => $jobTitle]),
                            "/jobs/{$offer->vacancy_id}/applications",
                            'job_application_status'
                        );
                        \App\Services\NotificationDispatcher::fanOutPush((int) $posterId, 'job_application_status', __('svc_notifications.job_offer.accepted_bell', ['title' => $jobTitle]), "/jobs/{$offer->vacancy_id}/applications");
                        RealtimeService::broadcastOnly((int) $posterId, __('svc_notifications.job_offer.accepted_push_title', ['title' => $jobTitle]), [
                            'type'      => 'job_offer_accepted',
                            'job_id'    => (int) $offer->vacancy_id,
                            'job_title' => $jobTitle,
                            'message'   => __('svc_notifications.job_offer.accepted_push_message', ['title' => $jobTitle]),
                            'url'       => "/jobs/{$offer->vacancy_id}/applications",
                        ]);
                    });
                }
            } catch (\Throwable $e) {
                Log::warning('JobOfferService::accept notification failed: ' . $e->getMessage());
            }

            // Dispatch webhook
            try {
                WebhookDispatchService::dispatch('job.offer.accepted', [
                    'offer_id'       => $offer->id,
                    'vacancy_id'     => $offer->vacancy_id,
                    'application_id' => $offer->application_id,
                    'user_id'        => $candidateUserId,
                    'tenant_id'      => $tenantId,
                ]);
            } catch (\Throwable $e) {
                Log::warning('JobOfferService::accept webhook dispatch failed: ' . $e->getMessage());
            }

            return true;
        } catch (SafeguardingPolicyException $e) {
            throw $e;
        } catch (\Throwable $e) {
            Log::error('JobOfferService::accept failed', ['error' => $e->getMessage()]);
            return false;
        }
    }

    /**
     * Reject an offer (candidate rejects).
     *
     * @param int $offerId         The offer ID.
     * @param int $candidateUserId The candidate's user ID.
     * @return bool
     */
    public static function reject(int $offerId, int $candidateUserId): bool
    {
        $tenantId = TenantContext::getId();

        try {
            $offer = JobOffer::with(['application.vacancy'])->find($offerId);

            if (!$offer || (int) $offer->tenant_id !== $tenantId) {
                return false;
            }

            // Only the applicant can reject the offer
            if (!$offer->application || (int) $offer->application->user_id !== $candidateUserId) {
                return false;
            }

            if ($offer->status !== 'pending') {
                return false;
            }

            $offer->update([
                'status'       => 'rejected',
                'responded_at' => now(),  // column added via 2026_03_27_000000 migration
            ]);

            // Notify the job poster
            try {
                $posterId = $offer->application->vacancy->user_id ?? null;
                if ($posterId) {
                    $poster = DB::table('users')
                        ->where('id', (int) $posterId)
                        ->where('tenant_id', $tenantId)
                        ->select(['id', 'preferred_language'])
                        ->first();

                    LocaleContext::withLocale($poster, function () use ($offer, $posterId) {
                        $jobTitle = $offer->application->vacancy->title ?? __('emails.common.fallback_job');
                        Notification::createNotification(
                            (int) $posterId,
                            __('svc_notifications.job_offer.rejected_bell', ['title' => $jobTitle]),
                            "/jobs/{$offer->vacancy_id}/applications",
                            'job_application_status'
                        );
                        \App\Services\NotificationDispatcher::fanOutPush((int) $posterId, 'job_application_status', __('svc_notifications.job_offer.rejected_bell', ['title' => $jobTitle]), "/jobs/{$offer->vacancy_id}/applications");
                        RealtimeService::broadcastOnly((int) $posterId, __('svc_notifications.job_offer.rejected_push_title', ['title' => $jobTitle]), [
                            'type'      => 'job_offer_rejected',
                            'job_id'    => (int) $offer->vacancy_id,
                            'job_title' => $jobTitle,
                            'message'   => __('svc_notifications.job_offer.rejected_push_message', ['title' => $jobTitle]),
                            'url'       => "/jobs/{$offer->vacancy_id}/applications",
                        ]);
                    });
                }
            } catch (\Throwable $e) {
                Log::warning('JobOfferService::reject notification failed: ' . $e->getMessage());
            }

            return true;
        } catch (\Throwable $e) {
            Log::error('JobOfferService::reject failed', ['error' => $e->getMessage()]);
            return false;
        }
    }

    /**
     * Withdraw an offer (employer withdraws).
     *
     * @param int $offerId        The offer ID.
     * @param int $employerUserId The employer's user ID.
     * @return bool
     */
    public static function withdraw(int $offerId, int $employerUserId): bool
    {
        $tenantId = TenantContext::getId();

        try {
            $offer = JobOffer::with(['application.vacancy'])->find($offerId);

            if (!$offer || (int) $offer->tenant_id !== $tenantId) {
                return false;
            }

            // Only the job poster can withdraw the offer
            if (!$offer->application || !$offer->application->vacancy ||
                (int) $offer->application->vacancy->user_id !== $employerUserId) {
                return false;
            }

            if (!in_array($offer->status, ['pending'], true)) {
                return false;
            }

            $offer->update(['status' => 'withdrawn']);

            // Notify the candidate
            try {
                $candidateId = $offer->application->user_id ?? null;
                if ($candidateId) {
                    $candidate = DB::table('users')
                        ->where('id', (int) $candidateId)
                        ->where('tenant_id', $tenantId)
                        ->select(['id', 'preferred_language'])
                        ->first();

                    LocaleContext::withLocale($candidate, function () use ($offer, $candidateId) {
                        $jobTitle = $offer->application->vacancy->title ?? __('emails.common.fallback_job');
                        Notification::createNotification(
                            (int) $candidateId,
                            __('svc_notifications.job_offer.withdrawn_bell', ['title' => $jobTitle]),
                            "/jobs/{$offer->vacancy_id}",
                            'job_application_status'
                        );
                        \App\Services\NotificationDispatcher::fanOutPush((int) $candidateId, 'job_application_status', __('svc_notifications.job_offer.withdrawn_bell', ['title' => $jobTitle]), "/jobs/{$offer->vacancy_id}");
                        RealtimeService::broadcastOnly((int) $candidateId, __('svc_notifications.job_offer.withdrawn_push_title', ['title' => $jobTitle]), [
                            'type'      => 'job_offer_withdrawn',
                            'job_id'    => (int) $offer->vacancy_id,
                            'job_title' => $jobTitle,
                            'message'   => __('svc_notifications.job_offer.withdrawn_push_message', ['title' => $jobTitle]),
                            'url'       => "/jobs/{$offer->vacancy_id}",
                        ]);
                    });
                }
            } catch (\Throwable $e) {
                Log::warning('JobOfferService::withdraw notification failed: ' . $e->getMessage());
            }

            return true;
        } catch (\Throwable $e) {
            Log::error('JobOfferService::withdraw failed', ['error' => $e->getMessage()]);
            return false;
        }
    }

    /**
     * Get the offer for a specific application.
     *
     * @param int $applicationId
     * @param int $userId        Must be either the applicant or the job poster.
     * @return array|null
     */
    public static function getForApplication(int $applicationId, int $userId): ?array
    {
        $tenantId = TenantContext::getId();

        try {
            $offer = JobOffer::with(['application.vacancy'])
                ->where('tenant_id', $tenantId)
                ->where('application_id', $applicationId)
                ->first();

            if (!$offer) {
                return null;
            }

            // Access control: must be applicant or job poster
            $isApplicant = $offer->application && (int) $offer->application->user_id === $userId;
            $isPoster = $offer->application && $offer->application->vacancy &&
                        (int) $offer->application->vacancy->user_id === $userId;

            if (!$isApplicant && !$isPoster) {
                return null;
            }

            return $offer->toArray();
        } catch (\Throwable $e) {
            Log::error('JobOfferService::getForApplication failed', ['error' => $e->getMessage()]);
            return null;
        }
    }

    /**
     * Get all pending offers for the current user (candidate view).
     *
     * @param int $userId
     * @return array
     */
    public static function getForUser(int $userId): array
    {
        $tenantId = TenantContext::getId();

        try {
            return JobOffer::with(['vacancy:id,title,user_id', 'application:id,user_id,vacancy_id,status'])
                ->where('tenant_id', $tenantId)
                ->whereHas('application', function ($q) use ($userId) {
                    $q->where('user_id', $userId);
                })
                ->orderByDesc('created_at')
                ->get()
                ->toArray();
        } catch (\Throwable $e) {
            Log::error('JobOfferService::getForUser failed', ['error' => $e->getMessage()]);
            return [];
        }
    }
}
