<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * ListingRankingService — MatchRank Algorithm for intelligent listing ranking.
 *
 * Scores listings based on relevance, freshness, engagement, proximity,
 * quality, and reciprocity factors, with collaborative filtering boosts.
 */
class ListingRankingService
{
    // Relevance weights
    private const RELEVANCE_CATEGORY_MATCH = 1.5;
    private const RELEVANCE_SEARCH_BOOST = 2.0;

    // Freshness parameters
    private const FRESHNESS_FULL_DAYS = 7;
    private const FRESHNESS_HALF_LIFE_DAYS = 30;
    private const FRESHNESS_MINIMUM = 0.3;

    // Engagement weights
    private const ENGAGEMENT_VIEW_WEIGHT = 0.1;
    private const ENGAGEMENT_INQUIRY_WEIGHT = 1.0;
    private const ENGAGEMENT_SAVE_WEIGHT = 0.5;
    private const ENGAGEMENT_MINIMUM = 1.0;

    // Quality thresholds
    private const QUALITY_MIN_DESCRIPTION_LENGTH = 50;
    private const QUALITY_HAS_IMAGE_BOOST = 1.3;
    private const QUALITY_HAS_LOCATION_BOOST = 1.2;
    private const QUALITY_VERIFIED_OWNER_BOOST = 1.4;

    // Reciprocity parameters
    private const RECIPROCITY_ENABLED = true;
    private const RECIPROCITY_MATCH_BOOST = 1.5;
    private const RECIPROCITY_MUTUAL_BOOST = 2.0;

    // Featured boost — ensures is_featured listings always appear at top
    private const FEATURED_BOOST = 5.0;

    // Cap on how many of the viewer's most-recent saved listings seed the
    // collaborative-filtering "similar" amplification (bounds getSimilarListings calls).
    private const VIEWER_SAVED_LISTINGS_LIMIT = 25;

    private ?array $config = null;
    private array $ownerListingsCache = [];

    /**
     * Get configuration from tenant settings.
     */
    public function getConfig(): array
    {
        if ($this->config !== null) {
            return $this->config;
        }

        $defaults = [
            'enabled' => true,
            'relevance_category_match' => self::RELEVANCE_CATEGORY_MATCH,
            'relevance_search_boost' => self::RELEVANCE_SEARCH_BOOST,
            'freshness_full_days' => self::FRESHNESS_FULL_DAYS,
            'freshness_half_life_days' => self::FRESHNESS_HALF_LIFE_DAYS,
            'freshness_minimum' => self::FRESHNESS_MINIMUM,
            'engagement_view_weight' => self::ENGAGEMENT_VIEW_WEIGHT,
            'engagement_inquiry_weight' => self::ENGAGEMENT_INQUIRY_WEIGHT,
            'engagement_save_weight' => self::ENGAGEMENT_SAVE_WEIGHT,
            'engagement_minimum' => self::ENGAGEMENT_MINIMUM,
            'quality_min_description' => self::QUALITY_MIN_DESCRIPTION_LENGTH,
            'quality_image_boost' => self::QUALITY_HAS_IMAGE_BOOST,
            'quality_location_boost' => self::QUALITY_HAS_LOCATION_BOOST,
            'quality_verified_boost' => self::QUALITY_VERIFIED_OWNER_BOOST,
            'reciprocity_enabled' => self::RECIPROCITY_ENABLED,
            'reciprocity_match_boost' => self::RECIPROCITY_MATCH_BOOST,
            'reciprocity_mutual_boost' => self::RECIPROCITY_MUTUAL_BOOST,
            'geo_enabled' => true,
            'geo_full_radius_km' => 50,
            'geo_decay_per_km' => 0.003,
        ];

        try {
            $tenantId = TenantContext::getId();
            $configJson = DB::table('tenants')
                ->where('id', $tenantId)
                ->value('configuration');

            if ($configJson) {
                $configArr = json_decode($configJson, true);
                if (is_array($configArr) && isset($configArr['algorithms']['listings'])) {
                    $this->config = array_merge($defaults, $configArr['algorithms']['listings']);
                    return $this->config;
                }
            }
        } catch (\Exception $e) {
            // Fall back to defaults
        }

        $this->config = $defaults;
        return $this->config;
    }

    /**
     * Check if MatchRank is enabled.
     */
    public function isEnabled(): bool
    {
        $config = $this->getConfig();
        return !empty($config['enabled']);
    }

    /**
     * Clear cached config.
     */
    public function clearCache(): void
    {
        $this->config = null;
        $this->ownerListingsCache = [];
    }

    /**
     * Rank a list of listings for a specific viewer.
     *
     * @param array $listings Array of listing data
     * @param int|null $viewerId Viewing user ID (null for anonymous)
     * @param array $options Additional options (search term, filters, etc.)
     * @return array Ranked listings with scores
     */
    public function rankListings(array $listings, ?int $viewerId = null, array $options = []): array
    {
        if (!$this->isEnabled() || empty($listings)) {
            return $listings;
        }

        $this->ownerListingsCache = [];

        // Start a fresh per-request training set for collaborative filtering so all
        // getSimilarListings() calls below reuse one loaded interaction matrix instead
        // of rebuilding it per saved listing.
        \App\Services\CollaborativeFilteringService::flushRequestCache();

        $viewerCoords = ['lat' => null, 'lon' => null];
        $viewerInterests = [];
        $viewerListings = [];

        if ($viewerId) {
            $viewerCoords = $this->getViewerCoordinates($viewerId);
            $viewerInterests = $this->getUserInterests($viewerId);
            $viewerListings = $this->getUserListings($viewerId);
        }

        $searchTerm = $options['search'] ?? null;

        // Collaborative filtering boosts
        $cfSimilarIds = [];
        $cfUserSuggestIds = [];
        if ($viewerId) {
            $tenantId = TenantContext::getId();
            $savedListingIds = $this->getViewerSavedListingIds($viewerId);
            $cfService = new \App\Services\CollaborativeFilteringService();
            foreach ($savedListingIds as $savedId) {
                foreach ($cfService->getSimilarListings($savedId, $tenantId, 10) as $sid) {
                    $cfSimilarIds[$sid] = true;
                }
            }
            foreach ($cfService->getSuggestedListingsForUser($viewerId, $tenantId, 20) as $sid) {
                $cfUserSuggestIds[$sid] = true;
            }
        }

        // Batch-load listings for every distinct listing owner on the page in a single
        // query, so calculateReciprocityScore() reuses the cache instead of issuing one
        // owner-listings query per ranked listing. Only relevant when reciprocity can
        // actually score (viewer has their own listings to reciprocate).
        if ($viewerId && !empty($viewerListings) && !empty($this->getConfig()['reciprocity_enabled'])) {
            $ownerIds = [];
            foreach ($listings as $listing) {
                $ownerId = (int) ($listing['user_id'] ?? 0);
                if ($ownerId > 0) {
                    $ownerIds[$ownerId] = true;
                }
            }
            if (!empty($ownerIds)) {
                $this->ownerListingsCache = $this->getUsersListings(array_keys($ownerIds));
            }
        }

        $rankedListings = [];

        foreach ($listings as $listing) {
            $scores = $this->calculateListingScores($listing, $viewerId, $viewerCoords, $viewerInterests, $viewerListings, $searchTerm);

            $finalScore = $scores['relevance'] * $scores['freshness'] * $scores['engagement'] * $scores['proximity'] * $scores['quality'] * $scores['reciprocity'];

            if (!empty($cfSimilarIds[$listing['id'] ?? 0])) {
                $finalScore *= 1.15;
            }
            if (!empty($cfUserSuggestIds[$listing['id'] ?? 0])) {
                $finalScore *= 1.10;
            }
            if (!empty($listing['is_featured'])) {
                $finalScore *= self::FEATURED_BOOST;
            }

            $listing['_match_rank'] = $finalScore;
            $listing['_score_breakdown'] = $scores;
            $rankedListings[] = $listing;
        }

        usort($rankedListings, fn ($a, $b) => $b['_match_rank'] <=> $a['_match_rank']);

        return $rankedListings;
    }

    /**
     * Build a ranked listings SQL query.
     *
     * @return array{sql: string, params: array}
     */
    public function buildRankedQuery(?int $viewerId = null, array $filters = []): array
    {
        $config = $this->getConfig();
        $tenantId = TenantContext::getId();

        $viewerCoords = ['lat' => null, 'lon' => null];
        if ($viewerId) {
            $viewerCoords = $this->getViewerCoordinates($viewerId);
        }

        $freshnessSql = $this->getFreshnessScoreSql();
        $engagementSql = $this->getEngagementScoreSql();
        $qualitySql = $this->getQualityScoreSql();
        $geoSql = $this->getGeoScoreSql($viewerCoords['lat'], $viewerCoords['lon']);

        $totalScoreSql = "({$freshnessSql}) * ({$engagementSql}) * ({$qualitySql}) * ({$geoSql})";

        $sql = "
            SELECT
                l.*,
                " . \App\Support\UserDisplayName::sql('u', 'author_name') . ",
                u.avatar_url,
                u.location as user_location,
                u.latitude as owner_lat,
                u.longitude as owner_lon,
                c.name as category_name,
                c.color as category_color,
                ({$freshnessSql}) as freshness_score,
                ({$engagementSql}) as engagement_score,
                ({$qualitySql}) as quality_score,
                ({$geoSql}) as geo_score,
                ({$totalScoreSql}) as match_rank
            FROM listings l
            JOIN users u ON l.user_id = u.id
            LEFT JOIN categories c ON l.category_id = c.id AND c.tenant_id = l.tenant_id
            WHERE l.tenant_id = ?
            AND l.status = 'active'
            AND u.status != 'banned'
        ";

        $params = [$tenantId];

        if (!empty($filters['type'])) {
            if (is_array($filters['type'])) {
                $placeholders = str_repeat('?,', count($filters['type']) - 1) . '?';
                $sql .= " AND l.type IN ($placeholders)";
                $params = array_merge($params, $filters['type']);
            } else {
                $sql .= " AND l.type = ?";
                $params[] = $filters['type'];
            }
        }

        if (!empty($filters['category_id'])) {
            $sql .= " AND l.category_id = ?";
            $params[] = $filters['category_id'];
        }

        if (!empty($filters['user_id'])) {
            $sql .= " AND l.user_id = ?";
            $params[] = $filters['user_id'];
        }

        if (!empty($filters['search'])) {
            $sql .= " AND (l.title LIKE ? OR l.description LIKE ?)";
            $escaped = str_replace(['%', '_'], ['\%', '\_'], $filters['search']);
            $searchTerm = '%' . $escaped . '%';
            $params[] = $searchTerm;
            $params[] = $searchTerm;
        }

        if ($viewerId && empty($filters['include_own'])) {
            $sql .= " AND l.user_id != ?";
            $params[] = $viewerId;
        }

        $sql .= " ORDER BY match_rank DESC, l.created_at DESC";

        if (!empty($filters['limit'])) {
            $sql .= " LIMIT " . (int) $filters['limit'];
        }

        return ['sql' => $sql, 'params' => $params];
    }

    // =========================================================================
    // SCORE CALCULATION
    // =========================================================================

    private function calculateListingScores(array $listing, ?int $viewerId, array $viewerCoords, array $viewerInterests, array $viewerListings, ?string $searchTerm): array
    {
        return [
            'relevance' => $this->calculateRelevanceScore($listing, $viewerInterests, $searchTerm),
            'freshness' => $this->calculateFreshnessScore($listing),
            'engagement' => $this->calculateEngagementScore($listing),
            'proximity' => $this->calculateProximityScore($listing, $viewerCoords),
            'quality' => $this->calculateQualityScore($listing),
            'reciprocity' => $this->calculateReciprocityScore($listing, $viewerListings),
        ];
    }

    private function calculateRelevanceScore(array $listing, array $viewerInterests, ?string $searchTerm): float
    {
        $config = $this->getConfig();
        $score = 1.0;

        if (!empty($listing['category_id']) && in_array($listing['category_id'], $viewerInterests)) {
            $score *= $config['relevance_category_match'];
        }

        if ($searchTerm) {
            $title = mb_strtolower($listing['title'] ?? '');
            $description = mb_strtolower($listing['description'] ?? '');
            $search = mb_strtolower($searchTerm);

            if (mb_strpos($title, $search) !== false) {
                $score *= $config['relevance_search_boost'];
            } elseif (mb_strpos($description, $search) !== false) {
                $score *= ($config['relevance_search_boost'] * 0.7);
            }
        }

        return $score;
    }

    private function calculateFreshnessScore(array $listing): float
    {
        $config = $this->getConfig();
        $createdAt = $listing['created_at'] ?? null;
        $updatedAt = $listing['updated_at'] ?? null;
        $relevantDate = $updatedAt && $updatedAt > $createdAt ? $updatedAt : $createdAt;

        if (!$relevantDate) {
            return $config['freshness_minimum'];
        }

        $daysSince = max(0, (time() - strtotime($relevantDate)) / 86400);

        if ($daysSince <= $config['freshness_full_days']) {
            return 1.0;
        }

        $decayDays = $daysSince - $config['freshness_full_days'];
        $halfLife = $config['freshness_half_life_days'];
        $decayFactor = exp(-0.693 * $decayDays / $halfLife);

        return max($config['freshness_minimum'], $decayFactor);
    }

    private function calculateEngagementScore(array $listing): float
    {
        $config = $this->getConfig();
        $views = (int) ($listing['view_count'] ?? 0);
        $contacts = (int) ($listing['contact_count'] ?? 0);
        $saves = (int) ($listing['save_count'] ?? 0);
        $n = $views + $contacts + $saves;

        if ($n === 0) {
            return $config['engagement_minimum'];
        }

        $rawWeighted = ($views * $config['engagement_view_weight']) + ($contacts * $config['engagement_inquiry_weight']) + ($saves * $config['engagement_save_weight']);
        $priorStrength = 10.0;
        $priorMean = 0.5;
        $bayesian = ($priorStrength * $priorMean + $rawWeighted) / ($priorStrength + $n);

        return min(2.0, max($config['engagement_minimum'], 1.0 + $bayesian));
    }

    private function calculateProximityScore(array $listing, array $viewerCoords): float
    {
        $config = $this->getConfig();
        if (!$config['geo_enabled'] || $viewerCoords['lat'] === null || $viewerCoords['lon'] === null) {
            return 1.0;
        }

        $listingLat = $listing['latitude'] ?? $listing['owner_lat'] ?? null;
        $listingLon = $listing['longitude'] ?? $listing['owner_lon'] ?? null;

        if ($listingLat === null || $listingLon === null) {
            return 1.0;
        }

        $distance = $this->calculateDistance($viewerCoords['lat'], $viewerCoords['lon'], (float) $listingLat, (float) $listingLon);

        if ($distance <= $config['geo_full_radius_km']) {
            return 1.0;
        }

        $distanceBeyond = $distance - $config['geo_full_radius_km'];
        $decay = $distanceBeyond * $config['geo_decay_per_km'];

        return max(0.1, 1.0 - $decay);
    }

    private function calculateQualityScore(array $listing): float
    {
        $config = $this->getConfig();
        $score = 1.0;

        if (strlen($listing['description'] ?? '') >= $config['quality_min_description']) {
            $score *= 1.1;
        }
        if (!empty($listing['image_url'])) {
            $score *= $config['quality_image_boost'];
        }
        if (!empty($listing['location']) || !empty($listing['latitude'])) {
            $score *= $config['quality_location_boost'];
        }
        if (!empty($listing['owner_verified'])) {
            $score *= $config['quality_verified_boost'];
        }

        return $score;
    }

    private function calculateReciprocityScore(array $listing, array $viewerListings): float
    {
        $config = $this->getConfig();
        if (!$config['reciprocity_enabled'] || empty($viewerListings)) {
            return 1.0;
        }

        $listingType = $listing['type'] ?? '';
        $listingCategory = $listing['category_id'] ?? null;
        $listingOwnerId = $listing['user_id'] ?? null;

        $offerMatchesNeed = false;
        foreach ($viewerListings as $vl) {
            if ($listingType === 'request' && $vl['type'] === 'offer' && $vl['category_id'] == $listingCategory) {
                $offerMatchesNeed = true;
                break;
            }
            if ($listingType === 'offer' && $vl['type'] === 'request' && $vl['category_id'] == $listingCategory) {
                $offerMatchesNeed = true;
                break;
            }
        }

        $needMatchesOffer = false;
        if ($offerMatchesNeed && $listingOwnerId) {
            if (!isset($this->ownerListingsCache[$listingOwnerId])) {
                $this->ownerListingsCache[$listingOwnerId] = $this->getUserListings($listingOwnerId);
            }
            $ownerListings = $this->ownerListingsCache[$listingOwnerId];
            foreach ($viewerListings as $vl) {
                foreach ($ownerListings as $ol) {
                    if ($vl['type'] === 'offer' && $ol['type'] === 'request' && $ol['category_id'] == $vl['category_id']) {
                        $needMatchesOffer = true;
                        break 2;
                    }
                    if ($vl['type'] === 'request' && $ol['type'] === 'offer' && $ol['category_id'] == $vl['category_id']) {
                        $needMatchesOffer = true;
                        break 2;
                    }
                }
            }
        }

        if ($offerMatchesNeed && $needMatchesOffer) {
            return $config['reciprocity_mutual_boost'];
        } elseif ($offerMatchesNeed) {
            return $config['reciprocity_match_boost'];
        }

        return 1.0;
    }

    // =========================================================================
    // SQL SCORE SNIPPETS
    // =========================================================================

    private function getFreshnessScoreSql(): string
    {
        $config = $this->getConfig();
        $fullDays = (float) $config['freshness_full_days'];
        $halfLife = (float) $config['freshness_half_life_days'];
        $minimum = (float) $config['freshness_minimum'];

        return "
            CASE
                WHEN DATEDIFF(NOW(), COALESCE(l.updated_at, l.created_at)) <= {$fullDays} THEN 1.0
                ELSE GREATEST({$minimum}, EXP(-0.693 * (DATEDIFF(NOW(), COALESCE(l.updated_at, l.created_at)) - {$fullDays}) / {$halfLife}))
            END
        ";
    }

    private function getEngagementScoreSql(): string
    {
        $config = $this->getConfig();
        $viewW = (float) $config['engagement_view_weight'];
        $contactW = (float) $config['engagement_inquiry_weight'];
        $saveW = (float) $config['engagement_save_weight'];
        $minimum = (float) $config['engagement_minimum'];

        return "
            LEAST(2.0, GREATEST({$minimum},
                1.0 + ((10.0 * 0.5 + (COALESCE(l.view_count, 0) * {$viewW} + COALESCE(l.contact_count, 0) * {$contactW} + COALESCE(l.save_count, 0) * {$saveW})) / (10.0 + COALESCE(l.view_count, 0) + COALESCE(l.contact_count, 0) + COALESCE(l.save_count, 0)))
            ))
        ";
    }

    private function getQualityScoreSql(): string
    {
        $config = $this->getConfig();
        $minDesc = (int) $config['quality_min_description'];
        $imageBoost = (float) $config['quality_image_boost'];
        $locationBoost = (float) $config['quality_location_boost'];

        return "
            (1.0
                * CASE WHEN CHAR_LENGTH(COALESCE(l.description, '')) >= {$minDesc} THEN 1.1 ELSE 1.0 END
                * CASE WHEN COALESCE(l.image_url, '') != '' THEN {$imageBoost} ELSE 1.0 END
                * CASE WHEN COALESCE(l.location, '') != '' OR l.latitude IS NOT NULL THEN {$locationBoost} ELSE 1.0 END
            )
        ";
    }

    private function getGeoScoreSql(?float $viewerLat, ?float $viewerLon): string
    {
        $config = $this->getConfig();
        if (!$config['geo_enabled'] || $viewerLat === null || $viewerLon === null) {
            return '1.0';
        }

        $fullRadius = (float) $config['geo_full_radius_km'];
        $decayRate = (float) $config['geo_decay_per_km'];

        // Haversine distance formula
        $latRad = deg2rad($viewerLat);
        $lonRad = deg2rad($viewerLon);
        $distSql = function (string $latCol, string $lonCol, string $alias) use ($viewerLat, $viewerLon) {
            return "6371 * 2 * ASIN(SQRT(POWER(SIN((RADIANS({$alias}.{$latCol}) - RADIANS({$viewerLat})) / 2), 2) + COS(RADIANS({$viewerLat})) * COS(RADIANS({$alias}.{$latCol})) * POWER(SIN((RADIANS({$alias}.{$lonCol}) - RADIANS({$viewerLon})) / 2), 2)))";
        };

        $distL = $distSql('latitude', 'longitude', 'l');
        $distU = $distSql('latitude', 'longitude', 'u');

        return "
            CASE
                WHEN l.latitude IS NOT NULL AND l.longitude IS NOT NULL THEN
                    CASE WHEN {$distL} <= {$fullRadius} THEN 1.0 ELSE GREATEST(0.1, 1.0 - (({$distL} - {$fullRadius}) * {$decayRate})) END
                WHEN u.latitude IS NOT NULL AND u.longitude IS NOT NULL THEN
                    CASE WHEN {$distU} <= {$fullRadius} THEN 1.0 ELSE GREATEST(0.1, 1.0 - (({$distU} - {$fullRadius}) * {$decayRate})) END
                ELSE 1.0
            END
        ";
    }

    // =========================================================================
    // HELPERS
    // =========================================================================

    private function getViewerCoordinates(int $userId): array
    {
        try {
            $user = DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', TenantContext::getId())
                ->select(['latitude', 'longitude'])
                ->first();

            return ['lat' => $user->latitude ?? null, 'lon' => $user->longitude ?? null];
        } catch (\Exception $e) {
            return ['lat' => null, 'lon' => null];
        }
    }

    private function getUserInterests(int $userId): array
    {
        try {
            return DB::table('listings')
                ->where('user_id', $userId)
                ->where('tenant_id', TenantContext::getId())
                ->whereNotNull('category_id')
                ->distinct()
                ->pluck('category_id')
                ->all();
        } catch (\Exception $e) {
            Log::debug('[ListingRanking] getViewerListingCategoryIds failed: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Most-recently saved listing IDs for the viewer, capped for performance.
     *
     * Capped to the {@see self::VIEWER_SAVED_LISTINGS_LIMIT} most-recent saves so the
     * collaborative-filtering amplification loop in rankListings() does a bounded number
     * of getSimilarListings() lookups instead of one per favourite.
     */
    private function getViewerSavedListingIds(int $userId): array
    {
        try {
            return DB::table('listing_favorites as lf')
                ->join('listings as l', 'lf.listing_id', '=', 'l.id')
                ->where('lf.user_id', $userId)
                ->where('l.tenant_id', TenantContext::getId())
                ->orderByDesc('lf.created_at')
                ->orderByDesc('lf.id')
                ->limit(self::VIEWER_SAVED_LISTINGS_LIMIT)
                ->pluck('lf.listing_id')
                ->all();
        } catch (\Exception $e) {
            Log::debug('[ListingRanking] getViewerSavedListingIds failed: ' . $e->getMessage());
            return [];
        }
    }

    private function getUserListings(int $userId): array
    {
        try {
            return DB::table('listings')
                ->where('user_id', $userId)
                ->where('tenant_id', TenantContext::getId())
                ->where('status', 'active')
                ->select(['id', 'type', 'category_id'])
                ->get()
                ->map(fn ($r) => (array) $r)
                ->all();
        } catch (\Exception $e) {
            Log::debug('[ListingRanking] getUserListings failed: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Batch-load active listings for many owners in a single query.
     *
     * Returns a map keyed by owner user id; every requested id is present (empty array
     * when the owner has no active listings) so callers can rely on isset() and never
     * fall back to a per-owner query. Each listing keeps the same shape as
     * {@see self::getUserListings()} (id, type, category_id).
     *
     * @param int[] $userIds
     * @return array<int, array<int, array{id: mixed, type: mixed, category_id: mixed}>>
     */
    private function getUsersListings(array $userIds): array
    {
        $result = [];
        foreach ($userIds as $userId) {
            $result[(int) $userId] = [];
        }

        if (empty($result)) {
            return $result;
        }

        try {
            $rows = DB::table('listings')
                ->whereIn('user_id', array_keys($result))
                ->where('tenant_id', TenantContext::getId())
                ->where('status', 'active')
                ->select(['id', 'user_id', 'type', 'category_id'])
                ->get();

            foreach ($rows as $row) {
                $listing = (array) $row;
                $ownerId = (int) $listing['user_id'];
                unset($listing['user_id']);
                $result[$ownerId][] = $listing;
            }
        } catch (\Exception $e) {
            Log::debug('[ListingRanking] getUsersListings failed: ' . $e->getMessage());
        }

        return $result;
    }

    private function calculateDistance(float $lat1, float $lon1, float $lat2, float $lon2): float
    {
        $earthRadius = 6371;
        $dLat = deg2rad($lat2 - $lat1);
        $dLon = deg2rad($lon2 - $lon1);
        $a = sin($dLat / 2) * sin($dLat / 2) + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLon / 2) * sin($dLon / 2);
        $c = 2 * asin(sqrt($a));
        return $earthRadius * $c;
    }
}
