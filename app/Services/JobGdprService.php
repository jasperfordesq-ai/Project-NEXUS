<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\JobApplication;
use App\Models\JobInterview;
use App\Models\JobOffer;
use App\Models\JobAlert;
use App\Models\JobSavedProfile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;

/**
 * JobGdprService — GDPR data export and erasure for job-related data.
 */
class JobGdprService
{
    /**
     * Columns removed from the candidate's own export because they identify a
     * third party (the staff member who acted), not the candidate (F-261).
     * Owner decision: the notes written about the candidate stay in the export;
     * only who wrote them is withheld.
     *  - reviewed_by: user id of the employer/staff member who recorded the decision.
     *  - proposed_by: user id of the employer/staff member who proposed the interview.
     */
    public const EXPORT_THIRD_PARTY_APPLICATION_FIELDS = ['reviewed_by'];
    public const EXPORT_THIRD_PARTY_INTERVIEW_FIELDS = ['proposed_by'];

    /**
     * Export all job-related data for a user as a structured array.
     */
    public static function exportUserData(int $userId): array
    {
        $tenantId = TenantContext::getId();

        try {
            $applications = JobApplication::with(['vacancy:id,title,type,status,created_at'])
                ->where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->get()
                ->toArray();

            $interviews = JobInterview::with(['vacancy:id,title'])
                ->where('tenant_id', $tenantId)
                ->whereHas('application', fn($q) => $q->where('user_id', $userId))
                ->get()
                ->toArray();

            $offers = JobOffer::with(['vacancy:id,title'])
                ->where('tenant_id', $tenantId)
                ->whereHas('application', fn($q) => $q->where('user_id', $userId))
                ->get()
                ->toArray();

            $alerts = JobAlert::where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->get(['id','keywords','type','commitment','location','is_active','created_at'])
                ->toArray();

            $savedProfile = JobSavedProfile::where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->first(['cv_filename', 'cv_size', 'headline', 'cover_text', 'created_at', 'updated_at']);

            $applications = self::withoutFields($applications, self::EXPORT_THIRD_PARTY_APPLICATION_FIELDS);
            $interviews = self::withoutFields($interviews, self::EXPORT_THIRD_PARTY_INTERVIEW_FIELDS);

            return [
                'exported_at'   => now()->toIso8601String(),
                'user_id'       => $userId,
                'tenant_id'     => $tenantId,
                'applications'  => $applications,
                'interviews'    => $interviews,
                'offers'        => $offers,
                'alerts'        => $alerts,
                'saved_profile' => $savedProfile ? $savedProfile->toArray() : null,
            ];
        } catch (\Throwable $e) {
            Log::error('JobGdprService::exportUserData failed', ['error' => $e->getMessage()]);
            return [];
        }
    }

    /**
     * Drop the given top-level keys from every exported row.
     *
     * @param array<int, array<string, mixed>> $rows
     * @param list<string> $fields
     * @return array<int, array<string, mixed>>
     */
    private static function withoutFields(array $rows, array $fields): array
    {
        $drop = array_flip($fields);

        return array_map(
            static fn ($row) => is_array($row) ? array_diff_key($row, $drop) : $row,
            $rows
        );
    }

    /**
     * Anonymise all job-related data for a user (GDPR right to erasure).
     * Keeps structural data (applications, interviews) but removes PII.
     */
    public static function eraseUserData(int $userId): bool
    {
        $tenantId = TenantContext::getId();

        try {
            $cvPaths = JobApplication::where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->whereNotNull('cv_path')
                ->pluck('cv_path')
                ->merge(
                    JobSavedProfile::where('tenant_id', $tenantId)
                        ->where('user_id', $userId)
                        ->whereNotNull('cv_path')
                        ->pluck('cv_path')
                )
                ->filter()
                ->unique()
                ->values();

            DB::transaction(function () use ($userId, $tenantId) {
                // Application IDs belonging to this user (tenant-scoped). Used to scrub
                // dependent records — interviews/offers/scorecards/history — that hold
                // free-text PII about the data subject.
                $applicationIds = JobApplication::where('tenant_id', $tenantId)
                    ->where('user_id', $userId)
                    ->pluck('id')
                    ->all();

                // Anonymise applications: clear message, reviewer_notes, cv_path fields
                JobApplication::where('tenant_id', $tenantId)
                    ->where('user_id', $userId)
                    ->update([
                        'message'        => null,
                        'reviewer_notes' => null,
                        'cv_path'        => null,
                        'cv_filename'    => null,
                        'cv_size'        => null,
                    ]);

                if (!empty($applicationIds)) {
                    // Interview notes (incl. location notes that may hold a home address).
                    JobInterview::where('tenant_id', $tenantId)
                        ->whereIn('application_id', $applicationIds)
                        ->update([
                            'candidate_notes'   => null,
                            'interviewer_notes' => null,
                            'location_notes'    => null,
                        ]);

                    // Offer message/details addressed to the candidate. The offer text
                    // column has historically been either `message` (legacy) or `details`
                    // (current model), so scrub whichever exists in this database.
                    $offerScrub = [];
                    foreach (['message', 'details'] as $col) {
                        if (Schema::hasColumn('job_offers', $col)) {
                            $offerScrub[$col] = null;
                        }
                    }
                    if (!empty($offerScrub)) {
                        JobOffer::where('tenant_id', $tenantId)
                            ->whereIn('application_id', $applicationIds)
                            ->update($offerScrub);
                    }

                    // Scorecard assessments written about the candidate. `criteria` is
                    // NOT NULL with a json_valid CHECK, so reset it to an empty array.
                    \App\Models\JobScorecard::where('tenant_id', $tenantId)
                        ->whereIn('application_id', $applicationIds)
                        ->update(['notes' => null, 'criteria' => '[]']);

                    // Status-change history is keyed only by application_id.
                    \App\Models\JobApplicationHistory::whereIn('application_id', $applicationIds)
                        ->update(['notes' => null, 'changed_by' => null]);
                }

                // De-link the user from referral records where they are the referred party.
                \App\Models\JobReferral::where('tenant_id', $tenantId)
                    ->where('referred_user_id', $userId)
                    ->update(['referred_user_id' => null]);

                // De-link the user from their view history (anonymous counts remain).
                DB::table('job_vacancy_views')
                    ->where('tenant_id', $tenantId)
                    ->where('user_id', $userId)
                    ->update(['user_id' => null]);

                // Delete alerts
                JobAlert::where('tenant_id', $tenantId)
                    ->where('user_id', $userId)
                    ->delete();

                // Delete saved profile
                JobSavedProfile::where('tenant_id', $tenantId)
                    ->where('user_id', $userId)
                    ->delete();
            });

            // Best-effort CV file deletion. The DB erasure above is already committed, so
            // an individual file failure is logged but must not abort the erasure — we
            // only downgrade the return value to signal incomplete file cleanup.
            $allFilesDeleted = true;
            foreach ($cvPaths as $path) {
                try {
                    Storage::disk('local')->delete($path);
                } catch (\Throwable $e) {
                    $allFilesDeleted = false;
                    Log::warning('JobGdprService::eraseUserData failed to delete CV file', [
                        'path' => $path,
                        'error' => $e->getMessage(),
                    ]);
                }
            }

            return $allFilesDeleted;
        } catch (\Throwable $e) {
            Log::error('JobGdprService::eraseUserData failed', ['error' => $e->getMessage()]);
            return false;
        }
    }
}
