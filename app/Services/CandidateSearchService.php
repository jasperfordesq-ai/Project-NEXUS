<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * CandidateSearchService — Search community members who have opted in
 * to being discoverable by employers (resume_searchable = 1).
 *
 * All queries are tenant-scoped via explicit tenant_id parameter.
 */
class CandidateSearchService
{
    /**
     * Search users who have resume_searchable = 1.
     *
     * @param array $filters Supported keys: keywords, skills (array), location, limit, offset
     * @param int   $tenantId
     * @return array{items: array, total: int}
     */
    public function search(array $filters, int $tenantId): array
    {
        $limit = min((int) ($filters['limit'] ?? 20), 100);
        $offset = max((int) ($filters['offset'] ?? 0), 0);

        $query = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('resume_searchable', 1)
            ->where('status', 'active')
            ->select(
                'id',
                'first_name',
                'last_name', 'profile_type', 'organization_name',
                'avatar_url',
                'resume_headline',
                'skills',
                'location',
                'last_login_at',
                'bio'
            );

        // Keyword search: search bio, skills, headline, resume_summary
        if (!empty($filters['keywords'])) {
            $term = '%' . $filters['keywords'] . '%';
            $query->where(function ($q) use ($term) {
                $q->where('bio', 'LIKE', $term)
                  ->orWhere('skills', 'LIKE', $term)
                  ->orWhere('resume_headline', 'LIKE', $term)
                  ->orWhere('resume_summary', 'LIKE', $term)
                  ->orWhereRaw("CONCAT(first_name, ' ', last_name) LIKE ?", [$term]);
            });
        }

        // Skills filter: match any of the provided skills
        if (!empty($filters['skills']) && is_array($filters['skills'])) {
            $query->where(function ($q) use ($filters) {
                foreach ($filters['skills'] as $skill) {
                    $skill = trim($skill);
                    if ($skill !== '') {
                        $q->orWhere('skills', 'LIKE', '%' . $skill . '%');
                    }
                }
            });
        }

        // Location filter
        if (!empty($filters['location'])) {
            $locationTerm = '%' . $filters['location'] . '%';
            $query->where('location', 'LIKE', $locationTerm);
        }

        // Get total count before pagination
        $total = (clone $query)->count();

        // Apply pagination and ordering
        $rows = $query
            ->orderByDesc('last_login_at')
            ->orderByDesc('id')
            ->offset($offset)
            ->limit($limit)
            ->get();

        $items = $rows->map(function ($row) {
            $skills = [];
            if (!empty($row->skills)) {
                $skills = array_map('trim', explode(',', $row->skills));
            }

            return [
                'id' => (int) $row->id,
                'first_name' => $row->first_name,
                'last_name' => $row->last_name,
                'name' => UserDisplayName::resolve($row),
                'avatar_url' => $row->avatar_url,
                'headline' => $row->resume_headline,
                'skills' => $skills,
                'location' => $row->location,
                'last_active' => $row->last_login_at,
            ];
        })->values()->all();

        return [
            'items' => $items,
            'total' => $total,
        ];
    }

    /**
     * Get full profile for one candidate (must have resume_searchable = 1).
     *
     * @param int $userId
     * @param int $tenantId
     * @return array|null
     */
    public function getCandidateProfile(int $userId, int $tenantId): ?array
    {
        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('resume_searchable', 1)
            ->where('status', 'active')
            ->select(
                'id',
                'first_name',
                'last_name', 'profile_type', 'organization_name',
                'avatar_url',
                'resume_headline',
                'resume_summary',
                'skills',
                'location',
                'bio',
                'last_login_at',
                'created_at'
            )
            ->first();

        if (!$user) {
            return null;
        }

        $skills = [];
        if (!empty($user->skills)) {
            $skills = array_map('trim', explode(',', $user->skills));
        }

        return [
            'id' => (int) $user->id,
            'first_name' => $user->first_name,
            'last_name' => $user->last_name,
            'name' => UserDisplayName::resolve($user),
            'avatar_url' => $user->avatar_url,
            'headline' => $user->resume_headline,
            'summary' => $user->resume_summary,
            'skills' => $skills,
            'location' => $user->location,
            'bio' => $user->bio,
            'last_active' => $user->last_login_at,
            'member_since' => $user->created_at,
        ];
    }

    /**
     * Update resume visibility for a user.
     *
     * @param int  $userId
     * @param int  $tenantId
     * @param bool $searchable
     * @return bool
     */
    public function updateResumeVisibility(int $userId, int $tenantId, bool $searchable): bool
    {
        try {
            DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', $tenantId)
                ->update(['resume_searchable' => $searchable ? 1 : 0]);

            return true;
        } catch (\Throwable $e) {
            Log::error('CandidateSearchService::updateResumeVisibility failed: ' . $e->getMessage());
            return false;
        }
    }
}
