<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\JobApplication;
use App\Models\JobScorecard;
use Illuminate\Support\Facades\Log;

class JobScorecardService
{
    /**
     * Upsert a scorecard for an application (reviewer creates or updates their own).
     *
     * @param int   $applicationId
     * @param int   $reviewerId
     * @param array $data  criteria (array of {label, score, max_score}), notes
     * @return array|false
     */
    public static function upsert(int $applicationId, int $reviewerId, array $data): array|false
    {
        $tenantId = TenantContext::getId();

        try {
            $application = JobApplication::with('vacancy')->find($applicationId);
            if (!$application || !$application->vacancy) return false;
            if ((int) $application->vacancy->tenant_id !== $tenantId) return false;

            $criteria  = $data['criteria'] ?? [];
            $totalScore = 0;
            $maxScore   = 0;
            foreach ($criteria as $c) {
                $totalScore += (float) ($c['score'] ?? 0);
                $maxScore   += (float) ($c['max_score'] ?? 10);
            }

            $scorecard = JobScorecard::updateOrCreate(
                ['application_id' => $applicationId, 'reviewer_id' => $reviewerId],
                [
                    'tenant_id'   => $tenantId,
                    'vacancy_id'  => (int) $application->vacancy_id,
                    'criteria'    => $criteria,
                    'total_score' => $totalScore,
                    'max_score'   => $maxScore ?: 100,
                    'notes'       => isset($data['notes']) ? trim($data['notes']) : null,
                ]
            );

            return $scorecard->toArray();
        } catch (\Throwable $e) {
            Log::error('JobScorecardService::upsert failed', ['error' => $e->getMessage()]);
            return false;
        }
    }

    /**
     * Get all scorecards for an application (employer/team view).
     */
    public static function getForApplication(int $applicationId): array
    {
        $tenantId = TenantContext::getId();

        try {
            return JobScorecard::with(['reviewer:id,first_name,last_name,profile_type,organization_name,avatar_url'])
                ->where('tenant_id', $tenantId)
                ->where('application_id', $applicationId)
                ->orderByDesc('updated_at')
                ->get()
                ->toArray();
        } catch (\Throwable $e) {
            Log::error('JobScorecardService::getForApplication failed', ['error' => $e->getMessage()]);
            return [];
        }
    }

    /**
     * Get the current user's scorecard for an application.
     */
    public static function getMine(int $applicationId, int $reviewerId): ?array
    {
        $tenantId = TenantContext::getId();

        try {
            $card = JobScorecard::where('tenant_id', $tenantId)
                ->where('application_id', $applicationId)
                ->where('reviewer_id', $reviewerId)
                ->first();

            return $card?->toArray();
        } catch (\Throwable $e) {
            Log::error('JobScorecardService::getMine failed', ['error' => $e->getMessage()]);
            return null;
        }
    }
}
