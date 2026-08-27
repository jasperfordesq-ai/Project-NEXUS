<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;

/**
 * VolunteerMatchingService — matches volunteers to opportunities and shifts
 * based on skills, availability, location, and past activity.
 *
 * All queries are tenant-scoped via TenantContext.
 */
class VolunteerMatchingService
{
    public function __construct()
    {
    }

    /**
     * Find the best volunteer matches for a given opportunity.
     *
     * Scores users based on:
     *  - Skill overlap between user_skills and opportunity skills_needed
     *  - Past volunteer activity (approved hours)
     *  - Whether the user has already applied (excluded)
     *
     * @return array  List of matched users with scores, sorted by score desc
     */
    public function findMatches(int $tenantId, int $opportunityId, int $limit = 10): array
    {
        $opp = DB::table('vol_opportunities')
            ->where('id', $opportunityId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$opp) {
            return [];
        }

        // Parse skills needed from the opportunity
        $neededSkills = self::parseSkills($opp->skills_needed ?? '');

        // Get users who have NOT already applied to this opportunity
        $alreadyApplied = DB::table('vol_applications')
            ->where('opportunity_id', $opportunityId)
            ->where('tenant_id', $tenantId)
            ->pluck('user_id')
            ->all();

        // Get active volunteers in this tenant (users with approved hours or active signups)
        $query = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->select('id', 'first_name', 'last_name', 'profile_type', 'organization_name', 'avatar_url');

        if (!empty($alreadyApplied)) {
            $query->whereNotIn('id', $alreadyApplied);
        }

        $candidates = $query->limit(200)->get();

        if ($candidates->isEmpty()) {
            return [];
        }

        $candidateIds = $candidates->pluck('id')->all();

        // Batch-fetch user skills
        $userSkillsRaw = DB::table('user_skills')
            ->where('tenant_id', $tenantId)
            ->whereIn('user_id', $candidateIds)
            ->where('is_offering', true)
            ->select('user_id', 'skill_name')
            ->get()
            ->groupBy('user_id');

        // Batch-fetch approved hours per user
        $userHours = DB::table('vol_logs')
            ->where('tenant_id', $tenantId)
            ->whereIn('user_id', $candidateIds)
            ->where('status', 'approved')
            ->selectRaw('user_id, COALESCE(SUM(hours), 0) as total_hours')
            ->groupBy('user_id')
            ->pluck('total_hours', 'user_id');

        $results = [];

        foreach ($candidates as $user) {
            $userId = (int) $user->id;

            // Skill score (0-60 points)
            $skillScore = 0;
            if (!empty($neededSkills)) {
                $userSkills = ($userSkillsRaw[$userId] ?? collect())
                    ->pluck('skill_name')
                    ->map(fn ($s) => strtolower(trim($s)))
                    ->all();

                $matchCount = 0;
                foreach ($neededSkills as $needed) {
                    foreach ($userSkills as $has) {
                        if (str_contains($has, $needed) || str_contains($needed, $has)) {
                            $matchCount++;
                            break;
                        }
                    }
                }

                $skillScore = count($neededSkills) > 0
                    ? round(($matchCount / count($neededSkills)) * 60)
                    : 0;
            }

            // Experience score (0-30 points) based on total hours
            $hours = (float) ($userHours[$userId] ?? 0);
            $experienceScore = min(30, round($hours / 10 * 5));

            // Activity bonus (0-10 points) — users with any hours get a base bonus
            $activityScore = $hours > 0 ? min(10, 5 + round(log($hours + 1) * 2)) : 0;

            $totalScore = $skillScore + $experienceScore + $activityScore;

            if ($totalScore > 0) {
                $results[] = [
                    'user_id' => $userId,
                    'first_name' => $user->first_name,
                    'last_name' => $user->last_name,
                    'avatar_url' => $user->avatar_url,
                    'match_score' => min(100, $totalScore),
                    'total_hours' => round($hours, 2),
                    'skill_match' => $skillScore,
                ];
            }
        }

        // Sort by score descending
        usort($results, fn ($a, $b) => $b['match_score'] <=> $a['match_score']);

        return array_slice($results, 0, $limit);
    }

    /**
     * Suggest opportunities for a user based on their skills and interests.
     *
     * @return array  List of opportunity suggestions with match scores
     */
    public function suggestOpportunities(int $tenantId, int $userId, int $limit = 10): array
    {
        // Defense-in-depth: ensure the requesting user can only see their own suggestions
        if (Auth::id() !== $userId) {
            return [];
        }

        // Get user skills
        $userSkills = DB::table('user_skills')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->where('is_offering', true)
            ->pluck('skill_name')
            ->map(fn ($s) => strtolower(trim($s)))
            ->all();

        // Get IDs of opportunities the user has already applied to
        $appliedIds = DB::table('vol_applications')
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->pluck('opportunity_id')
            ->all();

        // Get active, publicly visible opportunities. Enforce the same
        // public-visibility gates as VolunteerService::getOpportunities —
        // is_active alone is not enough: closed/draft opportunities and
        // pending/declined organizations must never surface in suggestions.
        $federationColumnExists = VolunteerService::opportunitiesHaveFederatedColumn();
        $query = DB::table('vol_opportunities as opp')
            ->leftJoin('vol_organizations as org', function ($join) {
                $join->on('opp.organization_id', '=', 'org.id')
                    ->on('opp.tenant_id', '=', 'org.tenant_id');
            })
            ->where('opp.tenant_id', $tenantId)
            ->where('opp.is_active', true)
            ->whereIn('opp.status', VolunteerService::PUBLIC_OPPORTUNITY_STATUSES)
            ->where(function ($outer) use ($federationColumnExists) {
                $outer->whereIn('org.status', VolunteerService::PUBLIC_ORGANIZATION_STATUSES);
                // Federated (imported) opportunities carry no local organisation
                // row — they were vetted at the partner and are gated by
                // is_federated (mirrors VolunteerService::getOpportunities).
                if ($federationColumnExists) {
                    $outer->orWhere('opp.is_federated', 1);
                }
            })
            ->select('opp.id', 'opp.title', 'opp.description', 'opp.location', 'opp.skills_needed',
                     'opp.start_date', 'opp.end_date', 'org.name as organization_name');

        if (!empty($appliedIds)) {
            $query->whereNotIn('opp.id', $appliedIds);
        }

        $opportunities = $query->orderByDesc('opp.id')->limit(100)->get();

        $results = [];

        foreach ($opportunities as $opp) {
            $neededSkills = self::parseSkills($opp->skills_needed ?? '');

            // Skill match score
            $skillScore = 0;
            if (!empty($neededSkills) && !empty($userSkills)) {
                $matchCount = 0;
                foreach ($neededSkills as $needed) {
                    foreach ($userSkills as $has) {
                        if (str_contains($has, $needed) || str_contains($needed, $has)) {
                            $matchCount++;
                            break;
                        }
                    }
                }
                $skillScore = round(($matchCount / count($neededSkills)) * 80);
            } elseif (empty($neededSkills)) {
                // No specific skills required — moderate base score
                $skillScore = 40;
            }

            // Recency bonus — newer opportunities get a small boost (0-20)
            $recencyScore = 20;
            if ($opp->start_date) {
                $daysUntilStart = max(0, (int) now()->diffInDays($opp->start_date, false));
                $recencyScore = $daysUntilStart <= 30 ? 20 : max(5, 20 - (int) ($daysUntilStart / 10));
            }

            $totalScore = min(100, $skillScore + $recencyScore);

            $results[] = [
                'opportunity_id' => (int) $opp->id,
                'title' => $opp->title,
                'description' => $opp->description,
                'location' => $opp->location,
                'organization_name' => $opp->organization_name,
                'start_date' => $opp->start_date,
                'end_date' => $opp->end_date,
                'match_score' => $totalScore,
            ];
        }

        usort($results, fn ($a, $b) => $b['match_score'] <=> $a['match_score']);

        return array_slice($results, 0, $limit);
    }

    /**
     * Get the match score between a specific opportunity and user.
     *
     * @return float  Score between 0.0 and 100.0
     */
    public function getMatchScore(int $tenantId, int $opportunityId, int $userId): float
    {
        $matches = $this->findMatches($tenantId, $opportunityId, 200);

        foreach ($matches as $match) {
            if ((int) $match['user_id'] === $userId) {
                return (float) $match['match_score'];
            }
        }

        // User wasn't in the match results — compute a basic score
        $opp = DB::table('vol_opportunities')
            ->where('id', $opportunityId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$opp) {
            return 0.0;
        }

        $neededSkills = self::parseSkills($opp->skills_needed ?? '');
        if (empty($neededSkills)) {
            return 50.0; // No skills required — neutral score
        }

        $userSkills = DB::table('user_skills')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->where('is_offering', true)
            ->pluck('skill_name')
            ->map(fn ($s) => strtolower(trim($s)))
            ->all();

        $matchCount = 0;
        foreach ($neededSkills as $needed) {
            foreach ($userSkills as $has) {
                if (str_contains($has, $needed) || str_contains($needed, $has)) {
                    $matchCount++;
                    break;
                }
            }
        }

        return round(($matchCount / count($neededSkills)) * 100, 1);
    }

    /**
     * Get recommended shifts for a user based on skills, availability, and past activity.
     *
     * Called by VolunteerController::recommendedShifts().
     *
     * @param int   $userId
     * @param array $options  'limit' (int), 'min_match_score' (int 0-100)
     * @return array  List of recommended shifts with match metadata
     */
    public function getRecommendedShifts(int $userId, array $options = []): array
    {
        $tenantId = TenantContext::getId();
        $limit = min((int) ($options['limit'] ?? 10), 20);
        $minScore = max(0, min(100, (int) ($options['min_match_score'] ?? 20)));

        // Get user skills
        $userSkills = DB::table('user_skills')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->where('is_offering', true)
            ->pluck('skill_name')
            ->map(fn ($s) => strtolower(trim($s)))
            ->all();

        // Get shifts the user is already signed up for. Live shift signups are
        // vol_applications rows with a shift_id — vol_shift_signups is a legacy
        // table nothing writes to anymore.
        $signedUpShifts = DB::table('vol_applications')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->whereNotNull('shift_id')
            ->whereIn('status', ['pending', 'approved'])
            ->pluck('shift_id')
            ->all();

        // Get applied opportunity IDs
        $appliedOppIds = DB::table('vol_applications')
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->pluck('opportunity_id')
            ->all();

        // Get upcoming shifts with their opportunities
        $query = DB::table('vol_shifts as s')
            ->join('vol_opportunities as opp', function ($join) {
                $join->on('s.opportunity_id', '=', 'opp.id')
                    ->on('s.tenant_id', '=', 'opp.tenant_id');
            })
            ->leftJoin('vol_organizations as org', function ($join) {
                $join->on('opp.organization_id', '=', 'org.id')
                    ->on('opp.tenant_id', '=', 'org.tenant_id');
            })
            ->where('s.tenant_id', $tenantId)
            ->where('opp.is_active', true)
            ->whereIn('opp.status', ['open', 'active'])
            ->whereIn('org.status', ['approved', 'active'])
            ->where('s.start_time', '>', now())
            ->select(
                's.id as shift_id', 's.start_time', 's.end_time', 's.capacity',
                's.required_skills',
                'opp.id as opportunity_id', 'opp.title', 'opp.description',
                'opp.location', 'opp.skills_needed',
                'org.name as organization_name'
            )
            ->orderBy('s.start_time');

        if (!empty($signedUpShifts)) {
            $query->whereNotIn('s.id', $signedUpShifts);
        }

        $shifts = $query->limit(100)->get();

        // Count current signups per shift
        $shiftIds = $shifts->pluck('shift_id')->all();
        $signupCounts = [];
        if (!empty($shiftIds)) {
            // Capacity is consumed by approved applications (same rule as
            // VolunteerService shift assignment) — not the legacy signups table.
            $signupCounts = DB::table('vol_applications')
                ->whereIn('shift_id', $shiftIds)
                ->where('tenant_id', $tenantId)
                ->where('status', 'approved')
                ->selectRaw('shift_id, COUNT(*) as cnt')
                ->groupBy('shift_id')
                ->pluck('cnt', 'shift_id')
                ->all();
        }

        $results = [];

        foreach ($shifts as $shift) {
            $currentSignups = (int) ($signupCounts[$shift->shift_id] ?? 0);
            $capacity = $shift->capacity !== null ? (int) $shift->capacity : null;

            // Skip full shifts
            if ($capacity !== null && $currentSignups >= $capacity) {
                continue;
            }

            // Skill matching — use shift's required_skills first, fall back to opportunity skills_needed
            $requiredSkills = self::parseSkills($shift->required_skills ?? '');
            if (empty($requiredSkills)) {
                $requiredSkills = self::parseSkills($shift->skills_needed ?? '');
            }

            $skillScore = 0;
            if (!empty($requiredSkills) && !empty($userSkills)) {
                $matchCount = 0;
                foreach ($requiredSkills as $needed) {
                    foreach ($userSkills as $has) {
                        if (str_contains($has, $needed) || str_contains($needed, $has)) {
                            $matchCount++;
                            break;
                        }
                    }
                }
                $skillScore = round(($matchCount / count($requiredSkills)) * 60);
            } elseif (empty($requiredSkills)) {
                $skillScore = 30; // No specific skills — moderate base
            }

            // Urgency bonus — shifts sooner get more weight (0-25)
            $hoursUntil = max(0, (int) now()->diffInHours($shift->start_time, false));
            $urgencyScore = $hoursUntil <= 48 ? 25 : ($hoursUntil <= 168 ? 15 : 5);

            // Availability bonus — shifts with fewer signups relative to capacity (0-15).
            // Unlimited-capacity shifts ($capacity === null) are always fully
            // available; treating them as fill-rate 1 zeroed their availability
            // score and made them rank below nearly-full limited shifts.
            if ($capacity === null) {
                $availabilityScore = 15;
            } else {
                $fillRate = $capacity > 0 ? $currentSignups / $capacity : 1;
                $availabilityScore = round((1 - $fillRate) * 15);
            }

            $totalScore = min(100, $skillScore + $urgencyScore + $availabilityScore);

            // Apply minimum score filter
            if ($totalScore < $minScore) {
                continue;
            }

            // Flag if user already applied to this opportunity
            $alreadyApplied = in_array((int) $shift->opportunity_id, $appliedOppIds, true);

            $results[] = [
                'shift_id' => (int) $shift->shift_id,
                'opportunity_id' => (int) $shift->opportunity_id,
                'title' => $shift->title,
                'organization_name' => $shift->organization_name,
                'location' => $shift->location,
                'start_time' => $shift->start_time,
                'end_time' => $shift->end_time,
                'capacity' => $capacity,
                'current_signups' => $currentSignups,
                // null capacity = unlimited: report null, not (0 - signups) → 0.
                'spots_remaining' => $capacity === null ? null : max(0, $capacity - $currentSignups),
                'match_score' => $totalScore,
                'already_applied' => $alreadyApplied,
            ];
        }

        usort($results, fn ($a, $b) => $b['match_score'] <=> $a['match_score']);

        return array_slice($results, 0, $limit);
    }

    /**
     * Parse a skills string (comma-separated or JSON array) into an array of lowercase skill keywords.
     */
    private static function parseSkills(string $raw): array
    {
        $raw = trim($raw);
        if ($raw === '') {
            return [];
        }

        // Try JSON decode first (skills stored as JSON array in some columns)
        $decoded = json_decode($raw, true);
        if (is_array($decoded)) {
            return array_map(fn ($s) => strtolower(trim((string) $s)), $decoded);
        }

        // Fall back to comma-separated
        return array_filter(
            array_map(fn ($s) => strtolower(trim($s)), explode(',', $raw)),
            fn ($s) => $s !== ''
        );
    }
}
