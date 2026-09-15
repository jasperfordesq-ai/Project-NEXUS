<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\Models\JobApplication;
use App\Models\JobApplicationHistory;
use App\Models\JobOffer;
use App\Models\JobVacancy;
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

            // Only the job poster can create an offer
            if ((int) $application->vacancy->user_id !== $employerUserId) {
                return false;
            }

            if ((int) $application->user_id === $employerUserId) {
                return false;
            }

            if ($keyHash !== null && $requestHash !== null) {
                $replay = self::creationReplay($tenantId, $applicationId, $keyHash, $requestHash);
                if ($replay === false) return false;
                if ($replay instanceof JobOffer) {
                    app(JobHiringDeliveryService::class)->dispatchForEvent($tenantId, 'offer_received', (int) $replay->id, (int) $application->user_id, true);
                    return $replay->toArray();
                }
            }

            // Enforce one offer per application (UNIQUE constraint on application_id).
            if (JobOffer::where('application_id', $applicationId)->exists()) return false;

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

            $candidateId = (int) $application->user_id;
            $offer = DB::transaction(function () use ($tenantId, $application, $applicationId, $employerUserId, $candidateId, $data, $keyHash, $requestHash): JobOffer|false {
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
                    || (int) $vacancy->user_id !== $employerUserId
                    || (int) $lockedApplication->user_id !== $candidateId
                    || in_array((string) ($lockedApplication->stage ?? $lockedApplication->status), ['accepted', 'rejected', 'withdrawn'], true)
                    || (string) $vacancy->status === 'filled') {
                    return false;
                }
                if ($keyHash !== null && $requestHash !== null) {
                    $replay = self::creationReplay($tenantId, $applicationId, $keyHash, $requestHash);
                    if ($replay === false) return false;
                    if ($replay instanceof JobOffer) return $replay;
                }
                if (JobOffer::where('application_id', $applicationId)->exists()) return false;
                $created = JobOffer::create([
                    'tenant_id'      => $tenantId,
                    'vacancy_id'     => (int) $application->vacancy_id,
                    'application_id' => $applicationId,
                    'user_id'        => $candidateId,
                    'creation_idempotency_key_hash' => $keyHash,
                    'creation_request_hash' => $requestHash,
                    'salary_offered' => isset($data['salary_offered']) ? (float) $data['salary_offered'] : null,
                    'salary_currency' => isset($data['salary_currency']) ? strtoupper(trim((string) $data['salary_currency'])) : null,
                    'salary_type'    => $data['salary_type'] ?? null,
                    'start_date'     => $data['start_date'] ?? null,
                    'message'        => isset($data['message']) ? trim((string) $data['message']) : null,
                    'details'        => isset($data['message']) ? trim($data['message']) : (isset($data['details']) ? trim($data['details']) : null),
                    'status'         => 'pending',
                    'expires_at'     => $data['expires_at'] ?? null,
                ]);
                JobHiringDeliveryService::record($tenantId, 'offer_received', (int) $created->id, $candidateId);
                return $created;
            });
            if ($offer === false) return false;

            app(JobHiringDeliveryService::class)->dispatchForEvent($tenantId, 'offer_received', (int) $offer->id, $candidateId, true);

            return $offer->toArray();
        } catch (SafeguardingPolicyException $e) {
            throw $e;
        } catch (\Throwable $e) {
            Log::error('JobOfferService::create failed', ['error' => $e->getMessage()]);
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
        int $applicationId,
        string $keyHash,
        string $requestHash,
    ): JobOffer|false|null {
        $existing = JobOffer::query()
            ->where('tenant_id', $tenantId)
            ->where('application_id', $applicationId)
            ->where('creation_idempotency_key_hash', $keyHash)
            ->first();
        if (!$existing) return null;
        return hash_equals((string) $existing->creation_request_hash, $requestHash) ? $existing : false;
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
                if ($offer->status !== 'accepted') return false;
                $posterId = (int) ($offer->application->vacancy->user_id ?? 0);
                app(JobHiringDeliveryService::class)->dispatchForEvent($tenantId, 'offer_accepted', $offerId, $posterId, true);
                if ($offer->application->vacancy->type === 'timebank' && (float) $offer->application->vacancy->time_credits > 0) {
                    app(JobHiringDeliveryService::class)->dispatchForEvent($tenantId, 'offer_credits_earned', $offerId, $candidateUserId, true);
                }
                return true;
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
            $creditInfo = DB::transaction(function () use ($offer, $offerId, $candidateUserId, $tenantId) {
                // Serialize all accepts for this vacancy.
                $vacancy = JobVacancy::where('id', (int) $offer->vacancy_id)
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->first();
                if (!$vacancy) {
                    return false;
                }

                // Lock and re-read the offer after the vacancy lock. Reject uses
                // the same order, so accept/reject cannot both consume pending.
                $lockedOffer = JobOffer::where('id', $offerId)
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->first();
                if (!$lockedOffer || $lockedOffer->status !== 'pending') {
                    return false;
                }

                $application = JobApplication::where('id', (int) $lockedOffer->application_id)
                    ->where('tenant_id', $tenantId)
                    ->where('vacancy_id', (int) $lockedOffer->vacancy_id)
                    ->lockForUpdate()
                    ->first();
                if (!$application || (int) $application->user_id !== $candidateUserId) {
                    return false;
                }
                $previousStatus = (string) ($application->stage ?? $application->status ?? 'applied');
                if (in_array($previousStatus, ['accepted', 'rejected', 'withdrawn'], true)) {
                    return false;
                }

                // Another candidate already filled this single-position role.
                if ($vacancy->status === 'filled') {
                    Log::info('JobOfferService::accept rejected — vacancy already filled', [
                        'offer_id'   => $offerId,
                        'vacancy_id' => (int) $offer->vacancy_id,
                    ]);
                    return false;
                }

                $lockedOffer->update([
                    'status'       => 'accepted',
                    'responded_at' => now(),  // column added via 2026_03_27_000000 migration
                ]);

                // Update application status to accepted
                $application->update([
                    'status' => 'accepted',
                    'stage'  => 'accepted',
                ]);
                JobApplicationHistory::create([
                    'application_id' => (int) $application->id,
                    'from_status' => $previousStatus,
                    'to_status' => 'accepted',
                    'changed_by' => $candidateUserId,
                    'changed_at' => now(),
                ]);
                DB::table('job_interviews')
                    ->where('tenant_id', $tenantId)
                    ->where('vacancy_id', (int) $lockedOffer->vacancy_id)
                    ->whereIn('status', ['proposed', 'accepted'])
                    ->update(['status' => 'cancelled', 'updated_at' => now()]);

                // Update vacancy status to filled
                $vacancy->update(['status' => 'filled']);

                // Withdraw any other pending offers for this single-position vacancy so a
                // second candidate cannot also accept after the role is filled.
                JobOffer::where('tenant_id', $tenantId)
                    ->where('vacancy_id', (int) $offer->vacancy_id)
                    ->where('id', '!=', $offerId)
                    ->where('status', 'pending')
                    ->update(['status' => 'withdrawn', 'responded_at' => now()]);

                JobHiringDeliveryService::record($tenantId, 'offer_accepted', (int) $lockedOffer->id, (int) $vacancy->user_id);

                // Auto-credit time credits for timebank jobs. Runs exactly once: the
                // pending→accepted transition above is serialized by the vacancy lock.
                if ($vacancy->type === 'timebank' && (float) $vacancy->time_credits > 0) {
                    $candidateId  = (int) $application->user_id;
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

                    JobHiringDeliveryService::record($tenantId, 'offer_credits_earned', (int) $lockedOffer->id, $candidateId);

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

            $posterId = (int) ($offer->application->vacancy->user_id ?? 0);
            app(JobHiringDeliveryService::class)->dispatchForEvent($tenantId, 'offer_accepted', $offerId, $posterId, true);
            if (is_array($creditInfo)) {
                app(JobHiringDeliveryService::class)->dispatchForEvent($tenantId, 'offer_credits_earned', $offerId, (int) $creditInfo['candidate_id'], true);
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

            $posterId = (int) ($offer->application->vacancy->user_id ?? 0);
            if ($posterId <= 0) return false;

            if ($offer->status !== 'pending') {
                if ($offer->status !== 'rejected') return false;
                app(JobHiringDeliveryService::class)->dispatchForEvent($tenantId, 'offer_rejected', $offerId, $posterId, true);
                return true;
            }

            $rejected = DB::transaction(function () use ($offer, $offerId, $tenantId, $posterId): bool {
                // Match accept's lock order so an accept/reject race has one winner.
                $vacancy = JobVacancy::where('id', (int) $offer->vacancy_id)
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->first();
                $lockedOffer = JobOffer::where('id', $offerId)
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->first();
                if (!$vacancy || !$lockedOffer || $lockedOffer->status !== 'pending') {
                    return false;
                }
                $lockedOffer->update([
                    'status'       => 'rejected',
                    'responded_at' => now(),
                ]);
                JobHiringDeliveryService::record($tenantId, 'offer_rejected', (int) $lockedOffer->id, $posterId);
                return true;
            });
            if (!$rejected) {
                return false;
            }

            app(JobHiringDeliveryService::class)->dispatchForEvent($tenantId, 'offer_rejected', $offerId, $posterId, true);

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
                if ($offer->status !== 'withdrawn') return false;
                $candidateId = (int) ($offer->application->user_id ?? 0);
                app(JobHiringDeliveryService::class)->dispatchForEvent($tenantId, 'offer_withdrawn', $offerId, $candidateId, true);
                return true;
            }

            $candidateId = (int) ($offer->application->user_id ?? 0);
            $withdrawn = DB::transaction(function () use ($offer, $offerId, $tenantId, $candidateId): bool {
                $vacancy = JobVacancy::where('id', (int) $offer->vacancy_id)
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->first();
                $lockedOffer = JobOffer::where('id', $offerId)
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->first();
                if (!$vacancy || !$lockedOffer || $lockedOffer->status !== 'pending') return false;
                $lockedOffer->update(['status' => 'withdrawn']);
                JobHiringDeliveryService::record($tenantId, 'offer_withdrawn', (int) $lockedOffer->id, $candidateId);
                return true;
            }, 3);
            if (!$withdrawn) return false;
            app(JobHiringDeliveryService::class)->dispatchForEvent($tenantId, 'offer_withdrawn', $offerId, $candidateId, true);

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
