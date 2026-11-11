<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\Matching;

use Illuminate\Support\Facades\DB;

/**
 * CandidateRetriever — gated candidate SQL for the Smart Matching engine.
 *
 * Stage 0 of the matching pipeline: every listing this class emits has already
 * passed the HARD gates, so downstream scoring can assume basic feasibility.
 *
 *  - Geo gate: physical listings (service_type physical_only/location_dependent)
 *    must resolve coordinates (listing, falling back to owner) AND lie within
 *    the effective max distance of the searcher. remote_only/hybrid listings
 *    are exempt — distance is irrelevant to a remote exchange.
 *  - Missing-coords searcher (degraded mode): with gates.missing_coords_mode =
 *    'remote_only' (default), a searcher without coordinates only sees
 *    remote/hybrid listings — never the legacy "newest listings tenant-wide"
 *    fallback that produced cross-country "nearby" matches. 'tenant_wide'
 *    restores the legacy reach for genuinely nationwide tenants.
 *  - Dormancy gate: listings whose owner has not been active within
 *    gates.dormancy_days are excluded (NULL last_active_at is treated as
 *    unknown, not dormant — legacy rows never populated it).
 *  - Dismissal gate: listings the searcher has already dismissed are excluded
 *    in SQL instead of post-hoc.
 *
 * A bounding-box pre-filter runs before the Haversine HAVING so the geo gate
 * stays index-assisted at tenant scale. Distances are NULL-safe: candidates
 * without resolvable coordinates get distance_km = NULL (the old
 * COALESCE(..., 0) placed them on Null Island and produced garbage distances).
 */
class CandidateRetriever
{
    /** service_type values exempt from the geo gate (SQL fragment). */
    private const REMOTE_TYPES = "'remote_only','hybrid'";

    /** @var array<string, bool> */
    private array $tableExistsCache = [];

    /**
     * Fetch gated candidates of one target type for the main match path.
     *
     * @param array $categoryIds    Union of the searcher's listing category ids (may be empty)
     * @param array|null $categoryFilter User-preference category filter (used when $categoryIds empty)
     * @param array $gates          gates config block (geo_hard_gate, missing_coords_mode, dormancy_days)
     */
    public function retrieveBatch(
        int $tenantId,
        int $excludeUserId,
        string $targetType,
        array $categoryIds,
        ?array $categoryFilter,
        ?float $userLat,
        ?float $userLon,
        float $maxDistanceKm,
        array $gates,
        int $limit = 400
    ): array {
        return $this->fetch(
            $tenantId, $excludeUserId, $targetType, $categoryIds, $categoryFilter,
            $userLat, $userLon, $maxDistanceKm, $gates, $limit
        );
    }

    /**
     * Fetch gated candidates for a user with no listings yet (cold start).
     * No type/category constraints, but every hard gate still applies — the
     * old cold-start path returned newest listings tenant-wide and labelled
     * them "nearby".
     */
    public function retrieveColdStart(
        int $tenantId,
        int $excludeUserId,
        ?float $userLat,
        ?float $userLon,
        float $maxDistanceKm,
        array $gates,
        int $limit = 20
    ): array {
        return $this->fetch(
            $tenantId, $excludeUserId, null, [], null,
            $userLat, $userLon, $maxDistanceKm, $gates, $limit
        );
    }

    private function fetch(
        int $tenantId,
        int $excludeUserId,
        ?string $targetType,
        array $categoryIds,
        ?array $categoryFilter,
        ?float $userLat,
        ?float $userLon,
        float $maxDistanceKm,
        array $gates,
        int $limit
    ): array {
        $hasCoords = $this->hasCoords($userLat, $userLon);
        $geoHardGate = (bool) ($gates['geo_hard_gate'] ?? true);
        $missingCoordsMode = ($gates['missing_coords_mode'] ?? 'remote_only') === 'tenant_wide'
            ? 'tenant_wide' : 'remote_only';
        $dormancyDays = max(0, (int) ($gates['dormancy_days'] ?? 90));

        $params = [];

        $sql = "SELECT l.*,
                       u.first_name, u.last_name, u.avatar_url, u.location as author_location,
                       u.latitude as author_latitude, u.longitude as author_longitude,
                       u.is_verified as author_verified,
                       " . \App\Support\UserDisplayName::sql('u', 'user_name') . ",
                       (SELECT AVG(rating) FROM reviews WHERE receiver_id = u.id AND tenant_id = u.tenant_id) as author_rating,
                       c.name as category_name, c.color as category_color";

        if ($hasCoords) {
            // LEAST/GREATEST clamp keeps acos() in domain when floating rounding
            // pushes the cosine fractionally past ±1 (identical coordinates).
            $sql .= ",
                CASE WHEN COALESCE(l.latitude, u.latitude) IS NULL
                          OR COALESCE(l.longitude, u.longitude) IS NULL THEN NULL
                     ELSE (6371 * ACOS(LEAST(1, GREATEST(-1,
                        COS(RADIANS(?)) * COS(RADIANS(COALESCE(l.latitude, u.latitude))) *
                        COS(RADIANS(COALESCE(l.longitude, u.longitude)) - RADIANS(?)) +
                        SIN(RADIANS(?)) * SIN(RADIANS(COALESCE(l.latitude, u.latitude)))
                     ))))
                END as distance_km";
            array_push($params, $userLat, $userLon, $userLat);
        }

        $sql .= "
                FROM listings l
                JOIN users u ON l.user_id = u.id
                LEFT JOIN categories c ON l.category_id = c.id
                WHERE l.tenant_id = ? AND l.status = 'active' AND l.user_id != ?
                  AND u.status NOT IN ('banned', 'suspended')";
        array_push($params, $tenantId, $excludeUserId);

        if ($targetType !== null) {
            $sql .= " AND l.type = ?";
            $params[] = $targetType;
        }

        if ($dormancyDays > 0) {
            // NULL last_active_at = unknown (legacy rows) — allow rather than starve.
            $sql .= " AND (u.last_active_at IS NULL OR u.last_active_at >= DATE_SUB(NOW(), INTERVAL {$dormancyDays} DAY))";
        }

        if ($this->tableExists('user_blocks')) {
            $sql .= "
                  AND l.user_id NOT IN (SELECT blocked_user_id FROM user_blocks WHERE tenant_id = ? AND user_id = ?)
                  AND l.user_id NOT IN (SELECT user_id FROM user_blocks WHERE tenant_id = ? AND blocked_user_id = ?)";
            array_push($params, $tenantId, $excludeUserId, $tenantId, $excludeUserId);
        }

        if ($this->tableExists('match_dismissals')) {
            $sql .= "
                  AND l.id NOT IN (SELECT listing_id FROM match_dismissals WHERE tenant_id = ? AND user_id = ?)";
            array_push($params, $tenantId, $excludeUserId);

            // Owner-level suppression: repeatedly dismissing one member's
            // listings (>= threshold in 90 days) hides ALL of that member's
            // listings from this searcher.
            $dismissalThreshold = max(1, (int) ($gates['owner_dismissal_threshold'] ?? 3));
            $sql .= "
                  AND l.user_id NOT IN (
                      SELECT l2.user_id FROM match_dismissals md
                      JOIN listings l2 ON md.listing_id = l2.id AND l2.tenant_id = md.tenant_id
                      WHERE md.tenant_id = ? AND md.user_id = ?
                        AND md.created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
                      GROUP BY l2.user_id
                      HAVING COUNT(*) >= {$dismissalThreshold})";
            array_push($params, $tenantId, $excludeUserId);
        }

        if (!empty($categoryIds)) {
            $placeholders = implode(',', array_fill(0, count($categoryIds), '?'));
            $sql .= " AND l.category_id IN ($placeholders)";
            $params = array_merge($params, array_values($categoryIds));
        } elseif (!empty($categoryFilter)) {
            $placeholders = implode(',', array_fill(0, count($categoryFilter), '?'));
            $sql .= " AND l.category_id IN ($placeholders)";
            $params = array_merge($params, array_values($categoryFilter));
        }

        $having = '';

        if ($hasCoords && $geoHardGate) {
            // Physical listings must resolve coordinates inside the bounding box;
            // remote/hybrid pass regardless. The box makes the Haversine HAVING an
            // index-assisted range scan instead of a full-tenant trig pass.
            $box = $this->boundingBox($userLat, $userLon, $maxDistanceKm);
            $sql .= " AND (l.service_type IN (" . self::REMOTE_TYPES . ")
                       OR (COALESCE(l.latitude, u.latitude) IS NOT NULL
                           AND COALESCE(l.longitude, u.longitude) IS NOT NULL
                           AND COALESCE(l.latitude, u.latitude) BETWEEN ? AND ?";
            array_push($params, $box['lat_min'], $box['lat_max']);
            if ($box['lon_min'] !== null) {
                $sql .= " AND COALESCE(l.longitude, u.longitude) BETWEEN ? AND ?";
                array_push($params, $box['lon_min'], $box['lon_max']);
            }
            $sql .= "))";

            $having = " HAVING (service_type IN (" . self::REMOTE_TYPES . ")
                            OR (distance_km IS NOT NULL AND distance_km <= ?))";
        } elseif ($hasCoords) {
            // Geo gate disabled: legacy soft behaviour — plain distance ceiling.
            // NULL distances (unresolvable coords) are excluded, matching the old
            // COALESCE-to-Null-Island outcome without the garbage distance values.
            $having = " HAVING (distance_km IS NOT NULL AND distance_km <= ?)";
        } elseif ($geoHardGate && $missingCoordsMode === 'remote_only') {
            // Degraded mode: searcher has no coordinates — only listings for which
            // distance is irrelevant. The API surfaces needs_location so the
            // frontend can prompt for a location.
            $sql .= " AND l.service_type IN (" . self::REMOTE_TYPES . ")";
        }
        // else: tenant_wide mode or gate off, searcher without coords — legacy
        // tenant-wide reach (deliberate opt-in for nationwide communities).

        if ($having !== '') {
            $sql .= $having;
            $params[] = $maxDistanceKm;
        }

        $sql .= $hasCoords
            ? " ORDER BY (distance_km IS NULL) ASC, distance_km ASC, l.created_at DESC"
            : " ORDER BY l.created_at DESC";

        // $limit is internal (never user input) — inlined because PDO cannot
        // reliably bind a LIMIT placeholder under emulated prepares.
        $sql .= " LIMIT " . max(1, $limit);

        return array_map(fn ($row) => (array) $row, DB::select($sql, $params));
    }

    /**
     * Treat NULL and 0.0 as "no coordinates" — user rows COALESCE missing
     * coords to 0, and (0, 0) is Null Island, not a member location.
     */
    private function hasCoords(?float $lat, ?float $lon): bool
    {
        return $lat !== null && $lon !== null && $lat != 0.0 && $lon != 0.0;
    }

    /**
     * Degrees bounding box for a radius in km. lon_min/lon_max are null near
     * the poles or when the box would wrap the globe (filter skipped there —
     * the Haversine HAVING still enforces the real distance).
     *
     * @return array{lat_min: float, lat_max: float, lon_min: ?float, lon_max: ?float}
     */
    private function boundingBox(float $lat, float $lon, float $maxKm): array
    {
        $latDelta = $maxKm / 111.045;
        $box = [
            'lat_min' => $lat - $latDelta,
            'lat_max' => $lat + $latDelta,
            'lon_min' => null,
            'lon_max' => null,
        ];

        $cosLat = cos(deg2rad($lat));
        if ($cosLat > 0.01) {
            $lonDelta = $maxKm / (111.045 * $cosLat);
            if ($lonDelta < 180) {
                $box['lon_min'] = $lon - $lonDelta;
                $box['lon_max'] = $lon + $lonDelta;
            }
        }

        return $box;
    }

    private function tableExists(string $table): bool
    {
        if (array_key_exists($table, $this->tableExistsCache)) {
            return $this->tableExistsCache[$table];
        }

        try {
            DB::selectOne("SELECT 1 FROM {$table} LIMIT 1");
            $this->tableExistsCache[$table] = true;
        } catch (\Throwable $e) {
            $this->tableExistsCache[$table] = false;
        }

        return $this->tableExistsCache[$table];
    }
}
