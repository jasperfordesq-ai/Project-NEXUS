<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use App\Support\UserDisplayName;

/**
 * ConnectionSuggestionController — "People You May Know" suggestions.
 *
 * Endpoints (v2):
 *   GET /api/v2/connections/suggestions   suggestions()
 */
class ConnectionSuggestionController extends BaseApiController
{
    protected bool $isV2Api = true;

    /**
     * GET /api/v2/connections/suggestions
     *
     * Returns ranked connection suggestions for the authenticated user.
     *
     * Query params: limit (int, default 5, max 20)
     *
     * Ranking factors:
     * 1. Mutual connections count (highest weight)
     * 2. Shared skills/interests
     * 3. Same groups membership
     * 4. Recent activity (prefer active users)
     */
    public function suggestions(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('connection_suggestions', 30, 60);

        $limit = $this->queryInt('limit', 5, 1, 20);
        $tenantId = TenantContext::getId();

        // Get current user's connections (both directions)
        $connectedIds = DB::table('connections')
            ->where('tenant_id', $tenantId)
            ->where('status', 'accepted')
            ->where(function ($q) use ($userId) {
                $q->where('requester_id', $userId)
                  ->orWhere('receiver_id', $userId);
            })
            ->get(['requester_id', 'receiver_id'])
            ->flatMap(fn ($c) => [$c->requester_id, $c->receiver_id])
            ->reject(fn ($id) => $id === $userId)
            ->unique()
            ->values()
            ->toArray();

        // Also exclude pending connections and blocked users
        $pendingIds = DB::table('connections')
            ->where('tenant_id', $tenantId)
            ->where('status', 'pending')
            ->where(function ($q) use ($userId) {
                $q->where('requester_id', $userId)
                  ->orWhere('receiver_id', $userId);
            })
            ->get(['requester_id', 'receiver_id'])
            ->flatMap(fn ($c) => [$c->requester_id, $c->receiver_id])
            ->reject(fn ($id) => $id === $userId)
            ->unique()
            ->values()
            ->toArray();

        $blockedIds = DB::table('user_blocks')
            ->where('tenant_id', $tenantId)
            ->where(function ($q) use ($userId) {
                $q->where('user_id', $userId)
                  ->orWhere('blocked_user_id', $userId);
            })
            ->get(['user_id', 'blocked_user_id'])
            ->flatMap(fn ($b) => [$b->user_id, $b->blocked_user_id])
            ->reject(fn ($id) => $id === $userId)
            ->unique()
            ->values()
            ->toArray();

        $excludeIds = array_unique(array_merge($connectedIds, $pendingIds, $blockedIds, [$userId]));

        if (empty($excludeIds)) {
            $excludeIds = [$userId];
        }

        // Build placeholders for IN clauses
        $excludePlaceholders = implode(',', array_fill(0, count($excludeIds), '?'));
        $connectedPlaceholders = !empty($connectedIds)
            ? implode(',', array_fill(0, count($connectedIds), '?'))
            : '';

        // Query candidates with scoring
        // Mutual connections: count of shared connections (correlated subquery — no derived table,
        // so u.id is accessible from the outer query)
        $mutualSubQuery = '';
        $mutualParams = [];
        if (!empty($connectedIds)) {
            $mutualSubQuery = "(
                SELECT COUNT(DISTINCT
                    CASE WHEN c2.requester_id = u.id THEN c2.receiver_id ELSE c2.requester_id END
                )
                FROM connections c2
                WHERE c2.tenant_id = ?
                AND c2.status = 'accepted'
                AND (c2.requester_id = u.id OR c2.receiver_id = u.id)
                AND CASE WHEN c2.requester_id = u.id THEN c2.receiver_id ELSE c2.requester_id END
                    IN ({$connectedPlaceholders})
            )";
            $mutualParams = array_merge([$tenantId], $connectedIds);
        } else {
            $mutualSubQuery = "0";
        }

        // Shared groups
        $sharedGroupsSubQuery = "(
            SELECT COUNT(DISTINCT gm2.group_id)
            FROM group_members gm2
            INNER JOIN group_members gm3 ON gm3.group_id = gm2.group_id
                AND gm3.user_id = ?
                AND gm3.tenant_id = ?
            WHERE gm2.user_id = u.id
            AND gm2.tenant_id = ?
        )";
        $sharedGroupsParams = [$userId, $tenantId, $tenantId];

        // Recency score: users active in last 30 days get a boost
        $recencyCase = "CASE WHEN u.last_active_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 2 ELSE 0 END";

        $sql = "
            SELECT
                u.id,
                COALESCE(u.name, CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS name,
                u.avatar_url,
                u.bio,
                u.skills,
                {$mutualSubQuery} AS mutual_connections_count,
                {$sharedGroupsSubQuery} AS shared_groups_count,
                ({$mutualSubQuery} * 5 + {$sharedGroupsSubQuery} * 2 + {$recencyCase}) AS score
            FROM users u
            WHERE u.tenant_id = ?
            AND u.id NOT IN ({$excludePlaceholders})
            AND u.is_active = 1
            AND u.status != 'suspended'
            ORDER BY score DESC, u.last_active_at DESC
            LIMIT ?
        ";

        $params = array_merge(
            $mutualParams,
            $sharedGroupsParams,
            $mutualParams,        // score: mutual part
            $sharedGroupsParams,  // score: shared_groups part (was missing — caused HY093 mismatch)
            [$tenantId],
            $excludeIds,
            [$limit]
        );

        try {
            $candidates = DB::select($sql, $params);
        } catch (\Throwable $e) {
            // Fallback: simple query without scoring if complex query fails
            \Log::warning('Connection suggestions complex query failed, using simple fallback', [
                'error' => $e->getMessage(),
            ]);

            $candidates = DB::table('users')
                ->where('tenant_id', $tenantId)
                ->whereNotIn('id', $excludeIds)
                ->where('is_active', 1)
                ->where('status', '!=', 'suspended')
                ->orderByDesc('last_active_at')
                ->limit($limit)
                ->get(['id', 'name', 'first_name', 'last_name', 'profile_type', 'organization_name', 'avatar_url', 'bio', 'skills'])
                ->map(function ($u) {
                    $u->name = $u->name ?: UserDisplayName::resolve($u);
                    $u->mutual_connections_count = 0;
                    $u->shared_groups_count = 0;
                    return $u;
                })
                ->toArray();
        }

        // Get shared skills for each candidate
        $currentUserSkills = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->value('skills');

        $userSkillsList = [];
        if ($currentUserSkills) {
            $decoded = json_decode($currentUserSkills, true);
            if (is_array($decoded)) {
                $userSkillsList = array_map('strtolower', $decoded);
            }
        }

        $suggestions = [];
        foreach ($candidates as $candidate) {
            $candidateSkills = [];
            $sharedSkills = [];
            $rawSkills = is_string($candidate->skills ?? null)
                ? json_decode($candidate->skills, true)
                : ($candidate->skills ?? []);

            if (is_array($rawSkills)) {
                $candidateSkills = $rawSkills;
                if (!empty($userSkillsList)) {
                    $sharedSkills = array_values(array_filter(
                        $candidateSkills,
                        fn ($s) => in_array(strtolower($s), $userSkillsList, true)
                    ));
                }
            }

            $suggestions[] = [
                'id' => (int) $candidate->id,
                'name' => $candidate->name ?: '',
                'avatar_url' => $candidate->avatar_url ?? null,
                'bio' => $candidate->bio ?? null,
                'mutual_connections_count' => (int) ($candidate->mutual_connections_count ?? 0),
                'shared_skills' => array_slice($sharedSkills, 0, 5),
                'connection_status' => 'none',
            ];
        }

        return $this->respondWithData(['suggestions' => $suggestions]);
    }
}
