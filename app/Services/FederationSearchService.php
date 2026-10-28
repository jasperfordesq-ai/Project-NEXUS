<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Services\FederationExternalApiClient;
use App\Services\FederationExternalPartnerService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * FederationSearchService — Advanced search for federated members across partner timebanks.
 *
 * Supports filtering by skills, location, service reach, radius (Haversine), and full-text search.
 * Uses raw DB:: queries for complex SQL with Haversine distance calculations.
 */
class FederationSearchService
{
    /** Cache TTL for cross-tenant queries (5 minutes) */
    private const CACHE_TTL = 300;

    /**
     * Cached wrapper for searchMembers.
     */
    public function cachedSearchMembers(array $partnerTenantIds, array $filters): array
    {
        if (empty($partnerTenantIds)) {
            return $this->searchMembers($partnerTenantIds, $filters);
        }

        $cacheKey = 'fed_search_' . md5(json_encode([
            'caller_tenant' => TenantContext::getId(),
            'tenants' => $partnerTenantIds,
            'filters' => $filters,
        ]));

        try {
            $cached = Cache::get($cacheKey);
            if ($cached !== null && is_array($cached)) {
                $cached['from_cache'] = true;
                return $cached;
            }
        } catch (\Throwable $e) {
            // Cache unavailable — fall through
        }

        $result = $this->searchMembers($partnerTenantIds, $filters);
        $result['from_cache'] = false;

        try {
            Cache::put($cacheKey, $result, self::CACHE_TTL);
        } catch (\Throwable $e) {
            // Caching failed — still return result
        }

        return $result;
    }

    /**
     * Advanced search for federated members.
     */
    public function searchMembers(array $partnerTenantIds, array $filters): array
    {
        if (empty($partnerTenantIds)) {
            return ['members' => [], 'total' => 0, 'filters_applied' => [], 'has_more' => false];
        }

        $placeholders = implode(',', array_fill(0, count($partnerTenantIds), '?'));
        $params = $partnerTenantIds;
        $filtersApplied = [];

        $sql = "SELECT u.id,
                       COALESCE(NULLIF(u.name, ''), TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')))) as name,
                       u.avatar_url, u.bio, u.tenant_id,
                       t.name as tenant_name,
                       fus.service_reach,
                       CASE WHEN fus.show_location_federated = 1 THEN u.location ELSE NULL END as location,
                       CASE WHEN fus.show_location_federated = 1 THEN u.latitude ELSE NULL END as latitude,
                       CASE WHEN fus.show_location_federated = 1 THEN u.longitude ELSE NULL END as longitude,
                       CASE WHEN fus.show_skills_federated = 1 THEN u.skills ELSE NULL END as skills,
                       fus.messaging_enabled_federated,
                       fus.transactions_enabled_federated,
                       fus.travel_radius_km
                FROM users u
                INNER JOIN tenants t ON u.tenant_id = t.id
                INNER JOIN federation_user_settings fus ON u.id = fus.user_id
                WHERE u.tenant_id IN ({$placeholders})
                AND u.status = 'active'
                AND u.onboarding_completed = 1
                AND fus.federation_optin = 1
                AND fus.profile_visible_federated = 1
                AND fus.appear_in_federated_search = 1";

        if (!empty($filters['tenant_id']) && in_array($filters['tenant_id'], $partnerTenantIds)) {
            $sql .= " AND u.tenant_id = ?";
            $params[] = $filters['tenant_id'];
            $filtersApplied[] = 'tenant';
        }

        if (!empty($filters['service_reach'])) {
            switch ($filters['service_reach']) {
                case 'remote_ok':
                    $sql .= " AND fus.service_reach IN ('remote_ok', 'travel_ok')";
                    $filtersApplied[] = 'service_reach';
                    break;
                case 'travel_ok':
                    $sql .= " AND fus.service_reach = 'travel_ok'";
                    $filtersApplied[] = 'service_reach';
                    break;
                case 'local_only':
                    $sql .= " AND fus.service_reach = 'local_only'";
                    $filtersApplied[] = 'service_reach';
                    break;
            }
        }

        if (!empty($filters['skills'])) {
            $skillTerms = is_array($filters['skills'])
                ? $filters['skills']
                : array_map('trim', explode(',', $filters['skills']));

            $skillConditions = [];
            foreach ($skillTerms as $skill) {
                if (!empty($skill)) {
                    $skillConditions[] = "(fus.show_skills_federated = 1 AND u.skills LIKE ?)";
                    $params[] = '%' . $skill . '%';
                }
            }
            if (!empty($skillConditions)) {
                $sql .= " AND (" . implode(' OR ', $skillConditions) . ")";
                $filtersApplied[] = 'skills';
            }
        }

        if (!empty($filters['location'])) {
            $sql .= " AND fus.show_location_federated = 1 AND u.location LIKE ?";
            $params[] = '%' . $filters['location'] . '%';
            $filtersApplied[] = 'location';
        }

        if (!empty($filters['latitude']) && !empty($filters['longitude']) && !empty($filters['radius_km'])) {
            $sql .= " AND fus.show_location_federated = 1
                      AND u.latitude IS NOT NULL AND u.longitude IS NOT NULL
                      AND (6371 * acos(
                          cos(radians(?)) * cos(radians(u.latitude)) *
                          cos(radians(u.longitude) - radians(?)) +
                          sin(radians(?)) * sin(radians(u.latitude))
                      )) <= ?";
            $params[] = $filters['latitude'];
            $params[] = $filters['longitude'];
            $params[] = $filters['latitude'];
            $params[] = $filters['radius_km'];
            $filtersApplied[] = 'radius';
        }

        if (!empty($filters['messaging_enabled'])) {
            $sql .= " AND fus.messaging_enabled_federated = 1";
            $filtersApplied[] = 'messaging_enabled';
        }

        if (!empty($filters['transactions_enabled'])) {
            $sql .= " AND fus.transactions_enabled_federated = 1";
            $filtersApplied[] = 'transactions_enabled';
        }

        if (!empty($filters['search'])) {
            $sql .= " AND (
                u.first_name LIKE ? OR u.last_name LIKE ? OR u.name LIKE ? OR
                u.bio LIKE ? OR (fus.show_skills_federated = 1 AND u.skills LIKE ?)
            )";
            $searchTerm = '%' . $filters['search'] . '%';
            $params = array_merge($params, [$searchTerm, $searchTerm, $searchTerm, $searchTerm, $searchTerm]);
            $filtersApplied[] = 'search';
        }

        // Build the WHERE clause portion for reuse in the count query.
        // $sql currently contains "SELECT ... FROM ... WHERE ..." with all conditions.
        // Extract everything after "FROM users u" to reuse the JOIN + WHERE in the count query.
        $fromClause = substr($sql, strpos($sql, 'FROM users u'));
        $countParams = $params; // Same params (no LIMIT/OFFSET yet)

        $orderBy = match ($filters['sort'] ?? 'name') {
            'recent' => " ORDER BY u.created_at DESC",
            'active' => " ORDER BY u.last_active_at DESC",
            default => " ORDER BY u.first_name, u.last_name",
        };
        $sql .= $orderBy;

        $limit = min((int) ($filters['limit'] ?? 30), 100);
        $offset = max(0, (int) ($filters['offset'] ?? 0));
        $sql .= " LIMIT ? OFFSET ?";
        $params[] = $limit;
        $params[] = $offset;

        try {
            // Count query for the real total — only run on the first page to avoid a double
            // COUNT on every "Load More" / paginated request.
            $isFirstPage = ($filters['offset'] ?? 0) === 0;
            if ($isFirstPage) {
                $countSql = "SELECT COUNT(*) as cnt " . $fromClause;
                $totalCount = (int) DB::selectOne($countSql, $countParams)->cnt;
            } else {
                $totalCount = $filters['known_total'] ?? 0;
            }

            $members = array_map(
                fn ($row) => (array) $row,
                DB::select($sql, $params)
            );

            foreach ($members as &$member) {
                $member['skills_array'] = !empty($member['skills'])
                    ? array_map('trim', explode(',', $member['skills']))
                    : [];
            }

            return [
                'members' => $members,
                'total' => $totalCount,
                'filters_applied' => $filtersApplied,
                'has_more' => ($offset + count($members)) < $totalCount,
            ];
        } catch (\Exception $e) {
            Log::error('FederationSearchService::searchMembers error: ' . $e->getMessage());
            return ['members' => [], 'total' => 0, 'filters_applied' => [], 'has_more' => false, 'error' => 'Search failed'];
        }
    }

    /**
     * Get available skills across all federated members for autocomplete.
     */
    public function getAvailableSkills(array $partnerTenantIds, string $query = '', int $limit = 20): array
    {
        if (empty($partnerTenantIds)) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($partnerTenantIds), '?'));
        $params = $partnerTenantIds;

        try {
            $sql = "SELECT DISTINCT u.skills
                    FROM users u
                    INNER JOIN federation_user_settings fus ON u.id = fus.user_id
                    WHERE u.tenant_id IN ({$placeholders})
                    AND u.status = 'active'
                    AND u.onboarding_completed = 1
                    AND fus.federation_optin = 1
                    AND fus.show_skills_federated = 1
                    AND u.skills IS NOT NULL AND u.skills != ''";

            if (!empty($query)) {
                $sql .= " AND u.skills LIKE ?";
                $params[] = '%' . $query . '%';
            }

            $sql .= " LIMIT 500";

            $results = array_map(
                fn ($row) => $row->skills,
                DB::select($sql, $params)
            );

            $allSkills = [];
            foreach ($results as $skillString) {
                $skills = array_map('trim', explode(',', $skillString));
                foreach ($skills as $skill) {
                    if (!empty($skill)) {
                        $skillLower = strtolower($skill);
                        if (!isset($allSkills[$skillLower])) {
                            $allSkills[$skillLower] = $skill;
                        }
                    }
                }
            }

            if (!empty($query)) {
                $queryLower = strtolower($query);
                $allSkills = array_filter($allSkills, fn ($skill) => stripos($skill, $queryLower) !== false);
            }

            $skills = array_values($allSkills);
            sort($skills, SORT_NATURAL | SORT_FLAG_CASE);

            return array_slice($skills, 0, $limit);
        } catch (\Exception $e) {
            Log::error('FederationSearchService::getAvailableSkills error: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Get available locations across all federated members for autocomplete.
     */
    public function getAvailableLocations(array $partnerTenantIds, string $query = '', int $limit = 20): array
    {
        if (empty($partnerTenantIds)) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($partnerTenantIds), '?'));
        $params = $partnerTenantIds;

        try {
            $sql = "SELECT DISTINCT u.location
                    FROM users u
                    INNER JOIN federation_user_settings fus ON u.id = fus.user_id
                    WHERE u.tenant_id IN ({$placeholders})
                    AND u.status = 'active'
                    AND u.onboarding_completed = 1
                    AND fus.federation_optin = 1
                    AND fus.show_location_federated = 1
                    AND u.location IS NOT NULL AND u.location != ''";

            if (!empty($query)) {
                $sql .= " AND u.location LIKE ?";
                $params[] = '%' . $query . '%';
            }

            $sql .= " ORDER BY u.location LIMIT ?";
            $params[] = $limit;

            return array_map(fn ($row) => $row->location, DB::select($sql, $params));
        } catch (\Exception $e) {
            Log::error('FederationSearchService::getAvailableLocations error: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Find federated members by skills.
     *
     * @param int[]    $partnerTenantIds Partner tenant IDs to search
     * @param string[] $skills           Skills to search for
     * @param int|null $excludeUserId    User ID to exclude from results
     * @param int      $limit            Max results
     * @return array
     */
    public function findMembersBySkills(array $partnerTenantIds, array $skills, ?int $excludeUserId = null, int $limit = 20): array
    {
        if (empty($partnerTenantIds) || empty($skills)) {
            return [];
        }

        $filters = ['skills' => $skills, 'limit' => $limit];
        $result = $this->searchMembers($partnerTenantIds, $filters);

        $members = $result['members'] ?? [];

        if ($excludeUserId !== null) {
            $members = array_values(array_filter($members, fn ($m) => (int) ($m['id'] ?? 0) !== $excludeUserId));
        }

        return $members;
    }

    /**
     * Search external members via federation partners' APIs.
     *
     * Queries each active external partner's API in sequence, merging results.
     * One failing partner does not break the entire search — errors are collected.
     *
     * @return array{members: array, total: int, partners_queried: int, errors: array}
     */
    public function searchExternalMembers(int $tenantId, array $filters): array
    {
        $allMembers = [];
        $errors = [];
        $partnersQueried = 0;

        try {
            $partners = FederationExternalPartnerService::getActivePartners($tenantId);
        } catch (\Throwable $e) {
            Log::error('FederationSearchService::searchExternalMembers failed to get partners', [
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);
            return [
                'members'          => [],
                'total'            => 0,
                'partners_queried' => 0,
                'errors'           => ['Failed to retrieve external partners: ' . $e->getMessage()],
            ];
        }

        foreach ($partners as $partner) {
            $partnerId = $partner['id'] ?? null;
            $partnerName = $partner['name'] ?? ('Partner #' . $partnerId);

            if ($partnerId === null) {
                continue;
            }

            // Respect the allow_member_search permission flag
            if (empty($partner['allow_member_search'])) {
                continue;
            }

            try {
                $partnersQueried++;
                $results = FederationExternalApiClient::fetchMembers($partnerId, $filters);

                if (isset($results['success']) && $results['success'] && !empty($results['data'])) {
                    foreach ($results['data'] as $member) {
                        $member['partner_id'] = $partnerId;
                        $member['partner_name'] = $partnerName;
                        $allMembers[] = $member;
                    }
                }
            } catch (\Throwable $e) {
                Log::warning('FederationSearchService::searchExternalMembers partner query failed', [
                    'tenant_id' => $tenantId,
                    'partner_id' => $partnerId,
                    'partner_name' => $partnerName,
                    'error' => $e->getMessage(),
                ]);
                $errors[] = "Partner '{$partnerName}' (#{$partnerId}): " . $e->getMessage();
            }
        }

        return [
            'members'          => $allMembers,
            'total'            => count($allMembers),
            'partners_queried' => $partnersQueried,
            'errors'           => $errors,
        ];
    }

    /**
     * Search all federated members (internal + external).
     *
     * @return array{members: array, total: int, internal_count: int, external_count: int, has_more: bool}
     */
    public function searchAllFederatedMembers(array $partnerTenantIds, int $tenantId, array $filters): array
    {
        $internal = $this->searchMembers($partnerTenantIds, $filters);
        $external = $this->searchExternalMembers($tenantId, $filters);

        $allMembers = array_merge($internal['members'] ?? [], $external['members'] ?? []);

        return [
            'members'        => $allMembers,
            'total'          => count($allMembers),
            'internal_count' => $internal['total'] ?? 0,
            'external_count' => $external['total'] ?? 0,
            'has_more'       => ($internal['has_more'] ?? false) || count($external['members'] ?? []) > 0,
        ];
    }

    /**
     * Search external listings via federation partners' APIs.
     *
     * Queries each active external partner's API for listings, merging results.
     * One failing partner does not break the entire search — errors are collected.
     *
     * @return array{listings: array, total: int, partners_queried: int, errors: array}
     */
    public function searchExternalListings(int $tenantId, array $filters): array
    {
        $allListings = [];
        $errors = [];
        $partnersQueried = 0;

        try {
            $partners = FederationExternalPartnerService::getActivePartnersForListings($tenantId);
        } catch (\Throwable $e) {
            Log::error('FederationSearchService::searchExternalListings failed to get partners', [
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);
            return [
                'listings'         => [],
                'total'            => 0,
                'partners_queried' => 0,
                'errors'           => ['Failed to retrieve external partners: ' . $e->getMessage()],
            ];
        }

        foreach ($partners as $partner) {
            $partnerId = $partner['id'] ?? null;
            $partnerName = $partner['name'] ?? ('Partner #' . $partnerId);

            if ($partnerId === null) {
                continue;
            }

            try {
                $partnersQueried++;
                $results = FederationExternalApiClient::fetchListings($partnerId, $filters);

                if (isset($results['success']) && $results['success'] && !empty($results['data'])) {
                    foreach ($results['data'] as $listing) {
                        $listing['partner_id'] = $partnerId;
                        $listing['partner_name'] = $partnerName;
                        $allListings[] = $listing;
                    }
                }
            } catch (\Throwable $e) {
                Log::warning('FederationSearchService::searchExternalListings partner query failed', [
                    'tenant_id' => $tenantId,
                    'partner_id' => $partnerId,
                    'partner_name' => $partnerName,
                    'error' => $e->getMessage(),
                ]);
                $errors[] = "Partner '{$partnerName}' (#{$partnerId}): " . $e->getMessage();
            }
        }

        return [
            'listings'         => $allListings,
            'total'            => count($allListings),
            'partners_queried' => $partnersQueried,
            'errors'           => $errors,
        ];
    }

    /**
     * Get search statistics for display.
     */
    public function getSearchStats(array $partnerTenantIds): array
    {
        $empty = ['total_members' => 0, 'remote_available' => 0, 'travel_available' => 0, 'messaging_enabled' => 0, 'transactions_enabled' => 0];

        if (empty($partnerTenantIds)) {
            return $empty;
        }

        $placeholders = implode(',', array_fill(0, count($partnerTenantIds), '?'));

        try {
            $result = DB::selectOne("
                SELECT
                    COUNT(*) as total_members,
                    SUM(CASE WHEN fus.service_reach IN ('remote_ok', 'travel_ok') THEN 1 ELSE 0 END) as remote_available,
                    SUM(CASE WHEN fus.service_reach = 'travel_ok' THEN 1 ELSE 0 END) as travel_available,
                    SUM(CASE WHEN fus.messaging_enabled_federated = 1 THEN 1 ELSE 0 END) as messaging_enabled,
                    SUM(CASE WHEN fus.transactions_enabled_federated = 1 THEN 1 ELSE 0 END) as transactions_enabled
                FROM users u
                INNER JOIN federation_user_settings fus ON u.id = fus.user_id
                WHERE u.tenant_id IN ({$placeholders})
                AND u.status = 'active'
                AND u.onboarding_completed = 1
                AND fus.federation_optin = 1
                AND fus.profile_visible_federated = 1
                AND fus.appear_in_federated_search = 1
            ", $partnerTenantIds);

            return [
                'total_members' => (int) ($result->total_members ?? 0),
                'remote_available' => (int) ($result->remote_available ?? 0),
                'travel_available' => (int) ($result->travel_available ?? 0),
                'messaging_enabled' => (int) ($result->messaging_enabled ?? 0),
                'transactions_enabled' => (int) ($result->transactions_enabled ?? 0),
            ];
        } catch (\Exception $e) {
            Log::error('FederationSearchService::getSearchStats error: ' . $e->getMessage());
            return $empty;
        }
    }
}
