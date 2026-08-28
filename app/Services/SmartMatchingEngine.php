<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Services\Matching\CandidateRetriever;
use App\Services\Matching\KeywordExtractor;
use App\Services\Matching\MatchScorer;
use App\Services\Matching\TenantMatchingContext;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * SmartMatchingEngine — Multi-dimensional matching algorithm.
 *
 * Candidate retrieval goes through {@see CandidateRetriever}, which enforces
 * the HARD gates (geo/service_type, missing-coords degraded mode, dormancy,
 * dismissals) before any scoring happens. Physical listings beyond the
 * effective max distance are never scored; remote_only/hybrid listings are
 * distance-exempt.
 *
 * 6-signal scoring pipeline (weighted sum, 0–100):
 *   1. Category Match (25%) — same/related category
 *   2. Skill Complementarity (20%) — Jaccard + proficiency weighting
 *   3. Proximity (25%) — Haversine with piecewise linear decay,
 *      service_type-aware (remote_only fixed 0.9)
 *   4. Temporal Relevance (10%) — exponential freshness decay
 *   5. Reciprocity Potential (15%) — mutual exchange opportunity
 *   6. Quality Signals (5%) — description, images, ratings
 *
 * Post-scoring boosts (bounded additive on the 0–100 scale): semantic
 * embedding +8, KNN member recs +6.
 */
class SmartMatchingEngine
{
    // Scoring weights (sum = 1.0)
    private const WEIGHT_CATEGORY = 0.25;
    private const WEIGHT_SKILL = 0.20;
    private const WEIGHT_PROXIMITY = 0.25;
    private const WEIGHT_FRESHNESS = 0.10;
    private const WEIGHT_RECIPROCITY = 0.15;
    private const WEIGHT_QUALITY = 0.05;

    // Proximity tiers (km)
    private const PROXIMITY_WALKING = 5;
    private const PROXIMITY_LOCAL = 15;
    private const PROXIMITY_CITY = 30;
    private const PROXIMITY_REGIONAL = 50;
    private const PROXIMITY_MAX = 100;

    // Freshness
    private const FRESHNESS_FULL_HOURS = 24;
    private const FRESHNESS_HALF_LIFE_DAYS = 14;
    private const FRESHNESS_MINIMUM = 0.3;

    // Quality
    private const QUALITY_MIN_DESCRIPTION = 50;
    private const QUALITY_RATING_THRESHOLD = 4.0;

    // Cache warming: per-tenant wall-clock budget per cron slot (seconds)
    private const WARM_TIME_BUDGET_SECONDS = 60;

    // In-process caches
    private array $userDataCache = [];
    private ?array $configCache = null;
    private array $categoryCache = [];

    // Set when the safeguarding filter dropped a candidate because the
    // contact gate was UNAVAILABLE (unconfigured/unsupported jurisdiction),
    // as opposed to DENY, which is deliberate protection. Surfaced to the
    // API as meta.degraded_reason so the member is told why the list is
    // short instead of seeing a bare empty state (Sentry 134069538).
    private bool $vettingPolicyUnavailable = false;

    public function __construct(
        private readonly EmbeddingService $embeddingService,
        private readonly CandidateRetriever $candidateRetriever,
        private readonly MatchLearningService $matchLearningService,
    ) {}

    /**
     * Get configuration from tenant settings.
     */
    public function getConfig(): array
    {
        if ($this->configCache !== null) {
            return $this->configCache;
        }

        $defaults = [
            'enabled' => true,
            'max_distance_km' => 50,
            'min_match_score' => 40,
            'hot_match_threshold' => 80,
            'weights' => [
                'category' => self::WEIGHT_CATEGORY,
                'skill' => self::WEIGHT_SKILL,
                'proximity' => self::WEIGHT_PROXIMITY,
                'freshness' => self::WEIGHT_FRESHNESS,
                'reciprocity' => self::WEIGHT_RECIPROCITY,
                'quality' => self::WEIGHT_QUALITY,
            ],
            'proximity' => [
                'walking_km' => self::PROXIMITY_WALKING,
                'local_km' => self::PROXIMITY_LOCAL,
                'city_km' => self::PROXIMITY_CITY,
                'regional_km' => self::PROXIMITY_REGIONAL,
                'max_km' => self::PROXIMITY_MAX,
            ],
            'gates' => [
                // Hard exclusion of physical listings beyond the effective max
                // distance (remote_only/hybrid are always exempt).
                'geo_hard_gate' => true,
                // Searcher without coordinates: 'remote_only' (default) limits
                // them to distance-independent listings + a set-location prompt;
                // 'tenant_wide' restores legacy nationwide reach.
                'missing_coords_mode' => 'remote_only',
                // Exclude listings whose owner hasn't been active in N days.
                'dormancy_days' => 90,
                // Reserved for the owner-level dismissal suppression gate.
                'owner_dismissal_threshold' => 3,
            ],
            // v2 = three-pillar geometric-mean scorer (MatchScorer);
            // 1 = legacy weighted-sum path, kept for one release as rollback.
            'engine_version' => 2,
            'pillars' => [
                'relevance' => 0.45,
                'feasibility' => 0.35,
                'trust' => 0.20,
            ],
            'signals' => [
                'relevance' => ['category' => 0.30, 'skill' => 0.35, 'semantic' => 0.35],
                'feasibility' => ['proximity' => 0.45, 'availability' => 0.20, 'activity' => 0.35],
                'trust' => ['reviews' => 0.45, 'trust_tier' => 0.25, 'completion' => 0.30],
            ],
            'adjustments' => [
                'mutual_bonus' => 8,
                'freshness_max' => 4,
                'semantic_boost' => 8,
                'knn_boost' => 6,
                'owner_cap_per_page' => 2,
            ],
            // Tenant-admin intent for the AI layer. Execution is additionally
            // gated by AIServiceFactory::isEnabled() (per-tenant keys + cost
            // limits), so these being true costs nothing on AI-less tenants.
            'ai' => [
                'semantic_signal' => true,
                'llm_explanations' => true,
                'explanation_top_n' => 5,
            ],
        ];

        $tenantId = TenantContext::getId();

        try {
            $configJson = DB::table('tenants')->where('id', $tenantId)->value('configuration');
            if ($configJson) {
                $configArr = json_decode($configJson, true);
                if (is_array($configArr) && isset($configArr['algorithms']['smart_matching'])) {
                    $tenantCfg = $configArr['algorithms']['smart_matching'];
                    $merged = array_merge($defaults, $tenantCfg);
                    // Nested blocks merge key-by-key so a tenant that has only
                    // saved e.g. weights doesn't wipe the gates defaults (and a
                    // partial gates block keeps default values for missing keys).
                    // ('signals' merges per-pillar inside MatchScorer itself.)
                    foreach (['weights', 'proximity', 'gates', 'pillars', 'adjustments', 'ai'] as $block) {
                        $merged[$block] = array_merge(
                            $defaults[$block],
                            is_array($tenantCfg[$block] ?? null) ? $tenantCfg[$block] : []
                        );
                    }
                    $this->configCache = $merged;
                    return $this->configCache;
                }
            }
        } catch (\Exception $e) {
            Log::error('[SmartMatchingEngine] getConfig DB fetch failed: ' . $e->getMessage());
        }

        $this->configCache = $defaults;
        return $this->configCache;
    }

    /**
     * Clear cached data.
     */
    public function clearCache(): void
    {
        $this->configCache = null;
        $this->userDataCache = [];
        $this->categoryCache = [];
    }

    /**
     * Warm the persistent match cache (the `match_cache` table) for active users
     * in the current tenant.
     *
     * This is the SOLE writer of `match_cache`, which backs the matching
     * analytics, new-match notifications and the matches dashboards. The static
     * legacy version was dropped in the Laravel-migration refactor (commit
     * 7bc2a1629), which left the scheduled "warm-match-cache" task calling an
     * undefined method every 30 minutes (a per-tenant fatal in the scheduler
     * logs) and the cache permanently unpopulated. Restored here as an instance
     * method on the DI service.
     *
     * For up to $limit active users (who have at least one active listing and no
     * fresh cache entry) it computes matches via findMatchesForUser() and upserts
     * them into match_cache with a 7-day TTL. Tenant-scoped via TenantContext.
     *
     * @return array{processed:int, cached:int}
     */
    public function warmUpCache(int $limit = 50): array
    {
        $results = ['processed' => 0, 'cached' => 0];
        $tenantId = TenantContext::getId();
        if (!$tenantId) {
            return $results;
        }

        // This service is a container singleton (AppServiceProvider), so the
        // per-tenant scheduler loop reuses ONE instance. Reset the in-process
        // caches (configCache is not tenant-keyed; userDataCache is per-user) so
        // each tenant warms with its own config instead of the previous tenant's.
        $this->clearCache();

        // Active users with an active listing whose cache is missing or expired.
        // $limit is an internal int (never user input) — inlined because PDO
        // cannot reliably bind a LIMIT placeholder under emulated prepares.
        $users = DB::select(
            "SELECT DISTINCT u.id
             FROM users u
             INNER JOIN listings l
                 ON u.id = l.user_id AND l.status = 'active' AND l.tenant_id = u.tenant_id
             LEFT JOIN match_cache mc
                 ON u.id = mc.user_id AND mc.tenant_id = ?
             WHERE u.tenant_id = ?
               AND u.status = 'active'
               AND (mc.id IS NULL OR mc.expires_at < NOW())
             ORDER BY u.last_login_at DESC
             LIMIT " . max(1, (int) $limit),
            [$tenantId, $tenantId]
        );

        $hasV2Columns = $this->matchCacheHasV2Columns();

        // Per-tenant wall-clock budget: a heavy tenant must not starve the
        // rest of the 30-min cron tick. Users not reached stay uncached and
        // are picked up by the next slot (the warm query orders by recency
        // and skips fresh cache entries).
        $startedAt = microtime(true);

        foreach ($users as $row) {
            if ((microtime(true) - $startedAt) > self::WARM_TIME_BUDGET_SECONDS) {
                Log::info('SmartMatchingEngine::warmUpCache time budget reached — carrying over', [
                    'tenant_id' => $tenantId,
                    'processed' => $results['processed'],
                    'remaining' => count($users) - $results['processed'],
                ]);
                break;
            }

            $userId = (int) $row->id;
            $results['processed']++;

            try {
                $runMeta = null;
                $matches = $this->findMatchesForUser($userId, ['limit' => 20], $runMeta);
            } catch (\Throwable $e) {
                Log::warning('SmartMatchingEngine::warmUpCache findMatches failed', [
                    'user_id' => $userId, 'tenant_id' => $tenantId, 'error' => $e->getMessage(),
                ]);
                continue;
            }

            foreach ($matches as $match) {
                $listingId = (int) ($match['id'] ?? 0);
                if ($listingId <= 0) {
                    continue;
                }
                // findMatchesForUser scores are 0–100, same scale as
                // match_cache.match_score. (A former min(1.0, …) * 100 clamp
                // here wrote every cached entry as exactly 100.00, feeding
                // garbage to analytics and hot-match notifications.)
                $score = round(min(100.0, max(0.0, (float) ($match['match_score'] ?? 0))), 2);
                $distance = (isset($match['distance_km']) && is_numeric($match['distance_km'])
                    && $match['distance_km'] >= 0 && $match['distance_km'] < 999999)
                    ? round((float) $match['distance_km'], 2)
                    : null;
                $type = in_array($match['match_type'] ?? 'one_way', ['one_way', 'potential', 'mutual', 'cold_start'], true)
                    ? ($match['match_type'] ?? 'one_way')
                    : 'one_way';
                $reasons = json_encode($match['match_reasons'] ?? [], JSON_UNESCAPED_UNICODE) ?: '[]';

                try {
                    // ON DUPLICATE KEY UPDATE deliberately leaves `status` untouched
                    // so a user's interaction state (viewed/contacted/…) survives a re-warm.
                    if ($hasV2Columns) {
                        $breakdown = isset($match['score_breakdown']) && is_array($match['score_breakdown'])
                            ? (json_encode($match['score_breakdown'], JSON_UNESCAPED_UNICODE) ?: null)
                            : null;
                        $gateFlags = [];
                        if (($match['service_type'] ?? '') === 'remote_only') {
                            $gateFlags[] = 'remote_exempt';
                        }
                        if (!empty($runMeta['degraded'])) {
                            $gateFlags[] = 'degraded_mode';
                        }
                        $algorithmVersion = (string) ($match['algorithm_version'] ?? 'v1');

                        DB::insert(
                            "INSERT INTO match_cache
                                (user_id, listing_id, tenant_id, match_score, distance_km, match_type, match_reasons,
                                 score_breakdown, gate_flags, algorithm_version, status, created_at, expires_at)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', NOW(), DATE_ADD(NOW(), INTERVAL 7 DAY))
                             ON DUPLICATE KEY UPDATE
                                match_score = VALUES(match_score),
                                distance_km = VALUES(distance_km),
                                match_type = VALUES(match_type),
                                match_reasons = VALUES(match_reasons),
                                score_breakdown = VALUES(score_breakdown),
                                gate_flags = VALUES(gate_flags),
                                algorithm_version = VALUES(algorithm_version),
                                expires_at = DATE_ADD(NOW(), INTERVAL 7 DAY)",
                            [
                                $userId, $listingId, $tenantId, $score, $distance, $type, $reasons,
                                $breakdown, $gateFlags !== [] ? implode(',', $gateFlags) : null, $algorithmVersion,
                            ]
                        );
                    } else {
                        DB::insert(
                            "INSERT INTO match_cache
                                (user_id, listing_id, tenant_id, match_score, distance_km, match_type, match_reasons, status, created_at, expires_at)
                             VALUES (?, ?, ?, ?, ?, ?, ?, 'new', NOW(), DATE_ADD(NOW(), INTERVAL 7 DAY))
                             ON DUPLICATE KEY UPDATE
                                match_score = VALUES(match_score),
                                distance_km = VALUES(distance_km),
                                match_type = VALUES(match_type),
                                match_reasons = VALUES(match_reasons),
                                expires_at = DATE_ADD(NOW(), INTERVAL 7 DAY)",
                            [$userId, $listingId, $tenantId, $score, $distance, $type, $reasons]
                        );
                    }
                    $results['cached']++;
                } catch (\Throwable $e) {
                    Log::warning('SmartMatchingEngine::warmUpCache cache write failed', [
                        'user_id' => $userId, 'listing_id' => $listingId, 'error' => $e->getMessage(),
                    ]);
                }
            }
        }

        return $results;
    }

    // =========================================================================
    // MAIN PUBLIC METHODS
    // =========================================================================

    /**
     * Find matches for a user based on their listings.
     *
     * @param array|null $meta Filled with run metadata for the API layer:
     *   needs_location (searcher has no coords), degraded (+reason — remote-only
     *   degraded mode active), has_active_listings (false → cold-start path).
     */
    public function findMatchesForUser(int $userId, array $options = [], ?array &$meta = null): array
    {
        $tenantId = TenantContext::getId();
        $config = $this->getConfig();

        $preferences = $this->getUserPreferences($userId);
        // Effective ceiling: the user's preference can tighten the tenant max
        // but never exceed it.
        $tenantMax = (float) $config['max_distance_km'];
        $userMax = isset($preferences['max_distance_km']) ? (float) $preferences['max_distance_km'] : null;
        $maxDistance = (float) ($options['max_distance'] ?? ($userMax !== null && $userMax > 0 ? min($userMax, $tenantMax) : $tenantMax));
        $minScore = $options['min_score'] ?? $preferences['min_match_score'] ?? $config['min_match_score'];
        $limit = $options['limit'] ?? 20;
        $categoryFilter = $options['categories'] ?? $preferences['categories'] ?? null;

        // Member opt-out: paused matching returns nothing (and the cron warm
        // therefore caches nothing new for them).
        if (!empty($preferences['matching_paused']) && empty($options['ignore_paused'])) {
            $meta = [
                'needs_location' => false,
                'degraded' => false,
                'degraded_reason' => null,
                'has_active_listings' => true,
                'paused' => true,
            ];
            return [];
        }

        $userData = $this->getUserData($userId);
        if (!$userData) {
            $meta = [
                'needs_location' => false,
                'degraded' => false,
                'degraded_reason' => null,
                'has_active_listings' => false,
                'paused' => false,
            ];
            return [];
        }

        $userLat = $this->coordOrNull($userData['latitude'] ?? null);
        $userLon = $this->coordOrNull($userData['longitude'] ?? null);
        $hasCoords = $userLat !== null && $userLon !== null;
        $gates = $config['gates'];
        $degraded = !$hasCoords
            && (bool) ($gates['geo_hard_gate'] ?? true)
            && (($gates['missing_coords_mode'] ?? 'remote_only') !== 'tenant_wide');

        $meta = [
            'needs_location' => !$hasCoords,
            'degraded' => $degraded,
            'degraded_reason' => !$hasCoords ? 'no_coordinates' : null,
            'has_active_listings' => true,
            'paused' => false,
        ];

        $userListings = $this->getUserListings($userId);
        if (empty($userListings)) {
            $meta['has_active_listings'] = false;
            $coldStart = $this->getColdStartMatches($userId, $userData, $maxDistance, $limit);
            $this->applyVettingUnavailabilityToMeta($meta);
            return $coldStart;
        }

        $matches = [];
        $seenIds = [];

        // PERF: Batch candidate lookup. Previous code fired one query per user listing
        // (N+1 over $userListings). Now we group by targetType and issue at most 2 queries
        // (one for 'offer' candidates, one for 'request' candidates), filtered by the
        // union of all relevant category_ids. We then dispatch candidates back to each
        // source listing by matching category_id in PHP.
        $byTargetType = ['offer' => [], 'request' => []]; // targetType => list of category_ids
        $myListingsByTarget = ['offer' => [], 'request' => []]; // targetType => list of myListings
        foreach ($userListings as $myListing) {
            $targetType = ($myListing['type'] === 'offer') ? 'request' : 'offer';
            if (!empty($myListing['category_id'])) {
                $byTargetType[$targetType][] = (int) $myListing['category_id'];
            }
            $myListingsByTarget[$targetType][] = $myListing;
        }

        $candidatesByTargetType = ['offer' => [], 'request' => []];
        foreach ($byTargetType as $targetType => $categoryIds) {
            if (empty($myListingsByTarget[$targetType])) {
                continue;
            }
            $uniqueCatIds = array_values(array_unique($categoryIds));
            $candidatesByTargetType[$targetType] = $this->candidateRetriever->retrieveBatch(
                $tenantId, $userId, $targetType, $uniqueCatIds,
                $categoryFilter, $userLat, $userLon, $maxDistance, $gates
            );
        }

        // Safeguarding: strip candidates whose owners require vetting types the
        // searcher does not hold. Staff roles bypass this at discovery — they
        // still need the full pool for coordination and assignment purposes.
        // National Vetting Bureau Acts 2012–2016 / DBS / PVG / AccessNI.
        foreach ($candidatesByTargetType as $targetType => $list) {
            if (!empty($list)) {
                $candidatesByTargetType[$targetType] = $this->filterCandidatesByVettingRequirements(
                    $list,
                    $userId
                );
            }
        }

        // v2 (default): three-pillar geometric-mean scorer fed by ONE batched
        // context load — the v1 path fired a reciprocity query per candidate.
        // engine_version=1 keeps the legacy weighted-sum path as a rollback.
        $engineVersion = (int) ($config['engine_version'] ?? 2);
        $scorer = null;
        $context = null;
        if ($engineVersion >= 2) {
            try {
                $ownerIds = [];
                foreach ($candidatesByTargetType as $list) {
                    foreach ($list as $cand) {
                        $ownerIds[] = (int) ($cand['user_id'] ?? 0);
                    }
                }
                $context = TenantMatchingContext::load(
                    $tenantId, $userId, $ownerIds, $userListings, $preferences, $userData
                );
                $scorer = new MatchScorer($config, $context->categories);
            } catch (\Throwable $e) {
                Log::warning('[SmartMatchingEngine] v2 context load failed — falling back to v1 scorer', [
                    'user_id' => $userId, 'error' => $e->getMessage(),
                ]);
                $scorer = null;
            }
        }

        // AI semantic signal (v2): embedding cosine per candidate becomes a
        // true relevance-pillar signal instead of the old blunt ×-boost.
        // listing↔listing similarity, blended with 0.8 × profile↔profile
        // similarity (helps members with rich bios and few listings).
        // Every step degrades to the keyword fallback inside MatchScorer.
        $semanticByListing = [];
        $profileSimByOwner = [];
        if ($scorer !== null && (bool) ($config['ai']['semantic_signal'] ?? true)) {
            try {
                // The enable check itself queries ai_settings — a hiccup there
                // must degrade to the keyword fallback, never break matching.
                if (\App\Services\AI\AIServiceFactory::isEnabled()) {
                    $firstListingId = (int) ($userListings[0]['id'] ?? 0);
                    if ($firstListingId > 0) {
                        $semanticByListing = $this->embeddingService->findSimilarWithScores(
                            $firstListingId, 'listing', $tenantId, 200
                        );
                    }
                    $profileSimByOwner = $this->embeddingService->findSimilarWithScores(
                        $userId, 'user', $tenantId, 200
                    );
                }
            } catch (\Throwable $e) {
                Log::debug('[SmartMatchingEngine] semantic signal unavailable: ' . $e->getMessage());
            }
        }

        $listingKeywordCache = [];
        $extractListingKeywords = function (array $listing) use (&$listingKeywordCache): array {
            $key = (int) ($listing['id'] ?? 0);
            if ($key > 0 && isset($listingKeywordCache[$key])) {
                return $listingKeywordCache[$key];
            }
            $keywords = KeywordExtractor::extract(
                ($listing['title'] ?? '') . ' ' . ($listing['description'] ?? '')
            );
            if ($key > 0) {
                $listingKeywordCache[$key] = $keywords;
            }
            return $keywords;
        };

        foreach ($userListings as $myListing) {
            $targetType = ($myListing['type'] === 'offer') ? 'request' : 'offer';
            $myCatId = $myListing['category_id'] ?? null;

            // Dispatch: candidates whose category_id matches this listing, OR all if myCatId null.
            $candidates = [];
            foreach ($candidatesByTargetType[$targetType] as $cand) {
                if ($myCatId === null || (int) ($cand['category_id'] ?? 0) === (int) $myCatId) {
                    $candidates[] = $cand;
                }
            }

            foreach ($candidates as $candidate) {
                if (in_array($candidate['id'], $seenIds)) {
                    continue;
                }

                if ($scorer !== null && $context !== null) {
                    $myPrepared = $myListing;
                    $myPrepared['keywords'] = $extractListingKeywords($myListing);
                    $candPrepared = $candidate;
                    $candPrepared['keywords'] = $extractListingKeywords($candidate);

                    $cosine = null;
                    $listingSim = $semanticByListing[(int) $candidate['id']] ?? null;
                    $ownerSim = $profileSimByOwner[(int) ($candidate['user_id'] ?? 0)] ?? null;
                    if ($listingSim !== null || $ownerSim !== null) {
                        $cosine = max((float) ($listingSim ?? 0.0), 0.8 * (float) ($ownerSim ?? 0.0));
                    }

                    $scoreResult = $scorer->score(
                        $context->searcher,
                        $myPrepared,
                        $candPrepared,
                        $context->owner((int) ($candidate['user_id'] ?? 0)),
                        $cosine
                    );
                    $matchResult = $scoreResult->toLegacyArray();
                    $candidate['score_breakdown'] = $scoreResult->toBreakdownArray();
                } else {
                    $matchResult = $this->calculateMatchScore($userData, $userListings, $myListing, $candidate);
                }

                if ($matchResult['score'] >= $minScore) {
                    $candidate['match_score'] = $matchResult['score'];
                    $candidate['match_reasons'] = $matchResult['reasons'];
                    $candidate['match_breakdown'] = $matchResult['breakdown'];
                    $candidate['distance_km'] = $matchResult['distance'];
                    $candidate['matched_listing'] = $myListing['title'];
                    $candidate['match_type'] = $matchResult['type'];
                    $candidate['algorithm_version'] = $scorer !== null ? 'v2' : 'v1';

                    $matches[] = $candidate;
                    $seenIds[] = $candidate['id'];
                }
            }
        }

        // Learning + diversity adjustments — moved INSIDE the engine so warmed
        // cache entries include them (they used to be applied after the cache
        // in CrossModuleMatchingService, so notifications/analytics never saw
        // them). Batched: three queries total, not per-candidate.
        if (!empty($matches)) {
            $matches = $this->applyLearningAndDiversityAdjustments($matches, $userId, $tenantId, $config);
        }

        // Semantic embedding boost — bounded additive on the 0–100 scale.
        // (The former min(1.0, score × 1.3) treated the score as 0–1 and
        // collapsed every boosted match to 1/100, sinking the BEST matches.)
        // Skipped when the semantic PILLAR signal already consumed the
        // embeddings — that would double-count the same evidence.
        if (!empty($matches) && empty($semanticByListing)) {
            $userListingIds = array_column($userListings, 'id');
            $firstListingId = $userListingIds[0] ?? null;

            if ($firstListingId) {
                $semanticSimilar = $this->embeddingService->findSimilar(
                    (int) $firstListingId, 'listing', $tenantId, 50
                );
                $semanticSet = array_flip($semanticSimilar);

                $semanticBoost = (float) ($config['adjustments']['semantic_boost'] ?? 8);
                foreach ($matches as &$match) {
                    if (isset($semanticSet[$match['id'] ?? 0])) {
                        $match['match_score'] = min(100.0, (float) $match['match_score'] + $semanticBoost);
                        $match['match_reasons'][] = 'Similar to your listing';
                    }
                }
                unset($match);
            }
        }

        // KNN member recommendation boost — bounded additive (same scale fix).
        // recs_members_* holds recommended MEMBER ids, so key on the listing's
        // owner (the old code compared listing ids against member ids).
        $knnKey = "recs_members_{$tenantId}_{$userId}";
        $knnRecs = Cache::get($knnKey);
        if ($knnRecs !== null && !empty($knnRecs)) {
            $knnSet = array_flip($knnRecs);
            $knnBoost = (float) ($config['adjustments']['knn_boost'] ?? 6);
            foreach ($matches as &$match) {
                if (isset($knnSet[$match['user_id'] ?? 0])) {
                    $match['match_score'] = min(100.0, (float) ($match['match_score'] ?? 0) + $knnBoost);
                }
            }
            unset($match);
        }

        usort($matches, fn ($a, $b) => $b['match_score'] <=> $a['match_score']);

        // Anti-popularity page cap: no owner monopolises a result page. The
        // score penalty (applyLearningAndDiversityAdjustments) handles rank;
        // this handles raw slots.
        $ownerCap = max(1, (int) ($config['adjustments']['owner_cap_per_page'] ?? 2));
        $capped = [];
        $perOwner = [];
        foreach ($matches as $match) {
            $owner = (int) ($match['user_id'] ?? 0);
            if ($owner > 0 && ($perOwner[$owner] ?? 0) >= $ownerCap) {
                continue;
            }
            $perOwner[$owner] = ($perOwner[$owner] ?? 0) + 1;
            $capped[] = $match;
        }

        $this->applyVettingUnavailabilityToMeta($meta);

        return array_slice($capped, 0, $limit);
    }

    /**
     * Bounded additive adjustments computed from the searcher's history and
     * tenant-wide exposure counts (three batched queries, no per-candidate
     * lookups):
     *
     *  - learning: past interactions with the owner (±10) + category affinity
     *    (±5), clamped ±15 — the MatchLearningService signals
     *  - dismissed-similar: −8 when the searcher previously dismissed a
     *    listing by the same owner in the same category
     *  - anti-popularity: −min(6, 2·ln(1+n)) where n = times this owner
     *    appeared in the tenant's match_cache in the last 7 days
     */
    private function applyLearningAndDiversityAdjustments(array $matches, int $userId, int $tenantId, array $config): array
    {
        $ownerIds = array_values(array_filter(array_unique(array_map(
            fn ($m) => (int) ($m['user_id'] ?? 0),
            $matches
        ))));
        if (empty($ownerIds)) {
            return $matches;
        }

        $ownerBoosts = [];
        $affinities = [];
        try {
            $ownerBoosts = $this->matchLearningService->getOwnerInteractionBoosts($userId, $ownerIds);
            $affinities = $this->matchLearningService->getCategoryAffinities($userId);
        } catch (\Throwable $e) {
            // Learning signals are best-effort.
        }

        // Owner+category pairs the searcher dismissed in the last 90 days.
        $dismissedPairs = [];
        try {
            $placeholders = implode(',', array_fill(0, count($ownerIds), '?'));
            $rows = DB::select(
                "SELECT DISTINCT l.user_id as owner_id, l.category_id
                 FROM match_dismissals md
                 JOIN listings l ON md.listing_id = l.id AND l.tenant_id = md.tenant_id
                 WHERE md.tenant_id = ? AND md.user_id = ?
                   AND md.created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
                   AND l.user_id IN ($placeholders)",
                array_merge([$tenantId, $userId], $ownerIds)
            );
            foreach ($rows as $row) {
                $dismissedPairs[((int) $row->owner_id) . ':' . ((int) ($row->category_id ?? 0))] = true;
            }
        } catch (\Throwable $e) {
            // Table may not exist — non-fatal.
        }

        // Tenant-wide owner exposure over the last 7 days (popularity bias guard).
        $popularity = [];
        try {
            $placeholders = implode(',', array_fill(0, count($ownerIds), '?'));
            $rows = DB::select(
                "SELECT l.user_id as owner_id, COUNT(*) as cnt
                 FROM match_cache mc
                 JOIN listings l ON mc.listing_id = l.id
                 WHERE mc.tenant_id = ? AND mc.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                   AND l.user_id IN ($placeholders)
                 GROUP BY l.user_id",
                array_merge([$tenantId], $ownerIds)
            );
            foreach ($rows as $row) {
                $popularity[(int) $row->owner_id] = (int) $row->cnt;
            }
        } catch (\Throwable $e) {
            // Non-fatal.
        }

        foreach ($matches as &$match) {
            $owner = (int) ($match['user_id'] ?? 0);
            $categoryId = (int) ($match['category_id'] ?? 0);
            $applied = [];

            $learning = ($ownerBoosts[$owner] ?? 0.0) + (($affinities[$categoryId] ?? 0.0) * 5.0);
            $learning = max(-15.0, min(15.0, $learning));
            if ($learning != 0.0) {
                $applied['learning'] = round($learning, 2);
            }

            if (isset($dismissedPairs[$owner . ':' . $categoryId])) {
                $applied['dismissed_similar'] = -8.0;
            }

            $exposure = $popularity[$owner] ?? 0;
            if ($exposure > 0) {
                $penalty = -min(6.0, 2.0 * log(1 + $exposure));
                $applied['popularity'] = round($penalty, 2);
            }

            if ($applied !== []) {
                $match['match_score'] = max(0.0, min(100.0, (float) $match['match_score'] + array_sum($applied)));
                if (isset($match['score_breakdown']['adjustments']) && is_array($match['score_breakdown']['adjustments'])) {
                    $match['score_breakdown']['adjustments'] += $applied;
                }
            }
        }
        unset($match);

        return $matches;
    }

    /**
     * Get "hot" matches (high score + close proximity).
     */
    public function getHotMatches(int $userId, int $limit = 5): array
    {
        $config = $this->getConfig();
        $hotThreshold = $config['hot_match_threshold'];

        $matches = $this->findMatchesForUser($userId, [
            'max_distance' => self::PROXIMITY_LOCAL,
            'min_score' => $hotThreshold,
            'limit' => $limit,
        ]);

        return array_filter($matches, fn ($m) => $m['match_score'] >= $hotThreshold);
    }

    /**
     * Get mutual matches (both parties can benefit).
     */
    public function getMutualMatches(int $userId, int $limit = 10): array
    {
        $matches = $this->findMatchesForUser($userId, ['limit' => 50]);
        $mutual = array_filter($matches, fn ($m) => $m['match_type'] === 'mutual');
        usort($mutual, fn ($a, $b) => $b['match_score'] <=> $a['match_score']);

        return array_slice($mutual, 0, $limit);
    }

    // =========================================================================
    // SCORING
    // =========================================================================

    /**
     * Calculate match score between user and a candidate listing.
     */
    public function calculateMatchScore(
        array $userData,
        array $userListings,
        array $myListing,
        array $candidateListing
    ): array {
        $config = $this->getConfig();
        $weights = $config['weights'];

        $scores = [
            'category' => 0, 'skill' => 0, 'proximity' => 0,
            'freshness' => 0, 'reciprocity' => 0, 'quality' => 0,
        ];
        $reasons = [];

        // 1. Category
        $scores['category'] = $this->calculateCategoryScore($myListing, $candidateListing);
        if ($scores['category'] >= 0.8) {
            $reasons[] = "Same category: " . ($candidateListing['category_name'] ?? 'General');
        }

        // 2. Skill
        $scores['skill'] = $this->calculateSkillScore($userData, $myListing, $candidateListing);
        if ($scores['skill'] >= 0.5) {
            $reasons[] = "Skills match your expertise";
        }

        // 3. Proximity — service_type aware. Remote listings score a fixed 0.9
        // (distance is irrelevant to them); unknown distance is neutral for
        // hybrid and a heavy penalty for physical listings.
        $serviceType = $candidateListing['service_type'] ?? 'physical_only';
        $distance = $this->calculateDistance(
            $userData['latitude'] ?? 0, $userData['longitude'] ?? 0,
            $candidateListing['latitude'] ?? $candidateListing['author_latitude'] ?? 0,
            $candidateListing['longitude'] ?? $candidateListing['author_longitude'] ?? 0
        );
        $hasDistance = $distance < PHP_FLOAT_MAX;

        if ($serviceType === 'remote_only') {
            $scores['proximity'] = 0.9;
            $reasons[] = "Can be done remotely";
        } elseif (!$hasDistance) {
            $scores['proximity'] = ($serviceType === 'hybrid') ? 0.5 : 0.05;
        } else {
            $scores['proximity'] = $this->calculateProximityScore($distance);
            if ($distance <= self::PROXIMITY_WALKING) {
                $reasons[] = sprintf("Very close: %.1f km away", $distance);
            } elseif ($distance <= self::PROXIMITY_LOCAL) {
                $reasons[] = sprintf("Nearby: %.1f km away", $distance);
            }
        }

        // 4. Freshness
        $scores['freshness'] = $this->calculateFreshnessScore($candidateListing['created_at'] ?? null);
        if ($scores['freshness'] >= 0.9) {
            $reasons[] = "Posted recently";
        }

        // 5. Reciprocity
        $reciprocityResult = $this->calculateReciprocityScore($userListings, $candidateListing);
        $scores['reciprocity'] = $reciprocityResult['score'];
        $matchType = $reciprocityResult['type'];
        if ($matchType === 'mutual') {
            $reasons[] = "Mutual exchange possible!";
        }

        // 6. Quality
        $scores['quality'] = $this->calculateQualityScore($candidateListing);
        if ($scores['quality'] >= 0.8) {
            $reasons[] = "Highly rated member";
        }

        // Weighted final score (0-100)
        $finalScore = 0;
        foreach ($scores as $key => $value) {
            $finalScore += $value * $weights[$key];
        }
        $finalScore = round($finalScore * 100, 1);

        return [
            'score' => $finalScore,
            'reasons' => $reasons,
            'breakdown' => $scores,
            // NULL when unresolvable — the old PHP_FLOAT_MAX leaked a 1.8e308
            // "distance" into the API and cache layers.
            'distance' => $hasDistance ? round($distance, 1) : null,
            'type' => $matchType,
            'service_type' => $serviceType,
        ];
    }

    // =========================================================================
    // SCORING COMPONENT METHODS
    // =========================================================================

    private function fetchCategory(int $categoryId): ?array
    {
        if (isset($this->categoryCache[$categoryId])) {
            return $this->categoryCache[$categoryId];
        }

        try {
            $row = DB::table('categories')
                ->where('id', $categoryId)
                ->where('tenant_id', TenantContext::getId())
                ->select('name', 'parent_id')
                ->first();

            if ($row) {
                $this->categoryCache[$categoryId] = [
                    'name' => (string) $row->name,
                    'parent_id' => isset($row->parent_id) ? (int) $row->parent_id : null,
                ];
                return $this->categoryCache[$categoryId];
            }
        } catch (\Exception $e) {
            // DB unavailable
        }

        return null;
    }

    private function calculateCategoryScore(array $myListing, array $candidate): float
    {
        $myId = $myListing['category_id'] ?? null;
        $candidateId = $candidate['category_id'] ?? null;

        if ($myId && $myId === $candidateId) {
            return 1.0;
        }
        if (!$myId || !$candidateId) {
            return 0.15;
        }

        $myCat = $this->fetchCategory((int) $myId);
        $candidateCat = $this->fetchCategory((int) $candidateId);

        if ($myCat !== null && $candidateCat !== null &&
            $myCat['parent_id'] !== null && $myCat['parent_id'] === $candidateCat['parent_id']) {
            return 0.7;
        }

        if ($myCat !== null && $candidateCat !== null) {
            similar_text($myCat['name'], $candidateCat['name'], $pct);
            return (float) max(0.15, $pct / 100 * 0.8);
        }

        return 0.15;
    }

    private function calculateSkillScore(array $userData, array $myListing, array $candidate): float
    {
        // 🔴 A member's skills were almost entirely invisible here, and this is the core of
        // what a timebank does.
        //
        // `SkillTaxonomyService::getProficiencyWeightedSkills()` keys skills by
        // `strtolower(trim($name))` — the raw name. Listing text, however, goes through
        // `KeywordExtractor::extract()`, which splits on words AND stems. The two sides were
        // then compared with `array_intersect`, so they could only ever agree when a skill's
        // raw name already equalled its own stem. Measured 2026-08-23:
        //
        //   skill "gardening" -> key 'gardening'  |  listing text -> token 'garden'   no match
        //   skill "cleaning"  -> key 'cleaning'   |  listing text -> token 'clean'    no match
        //   skill "plumbing"  -> key 'plumbing'   |  listing text -> token 'plumb'    no match
        //   skill "tutoring"  -> key 'tutoring'   |  listing text -> token 'tutor'    no match
        //   skill "dog walking" -> key 'dog walking' | tokens 'dog','walk'            no match
        //
        // Only a handful of skills — ones already in stem form, like 'garden' or 'childcare'
        // — could contribute anything at all. Running the skill names through the SAME
        // extractor puts both sides in one token space and fixes multi-word skills at the
        // same time.
        $skillsWeighted = $userData['skills_weighted'] ?? [];
        $skillTokenWeights = [];
        foreach ($skillsWeighted as $skillName => $weight) {
            foreach ($this->extractKeywords((string) $skillName) as $token) {
                // A token shared by two skills takes the higher proficiency, so naming a
                // skill twice at different levels cannot dilute it.
                $skillTokenWeights[$token] = max($skillTokenWeights[$token] ?? 0.0, (float) $weight);
            }
        }

        $userSkills = !empty($skillTokenWeights)
            ? array_keys($skillTokenWeights)
            : $this->extractKeywords((string) ($userData['skills'] ?? ''));

        $myKeywords = $this->extractKeywords($myListing['title'] . ' ' . ($myListing['description'] ?? ''));
        $candidateKeywords = $this->extractKeywords($candidate['title'] . ' ' . ($candidate['description'] ?? ''));

        $allUserKeywords = array_unique(array_merge($userSkills, $myKeywords));

        if (empty($allUserKeywords) || empty($candidateKeywords)) {
            return 0.4;
        }

        $matches = array_intersect($allUserKeywords, $candidateKeywords);
        $union = count(array_unique(array_merge($allUserKeywords, $candidateKeywords)));
        $jaccard = $union > 0 ? count($matches) / $union : 0;

        if (!empty($skillTokenWeights) && !empty($matches)) {
            $totalWeight = 0.0;
            $weighted = 0;
            foreach ($matches as $m) {
                if (isset($skillTokenWeights[$m])) {
                    $totalWeight += $skillTokenWeights[$m];
                    $weighted++;
                }
            }
            if ($weighted > 0) {
                $jaccard *= min(1.4, $totalWeight / $weighted);
            }
        }

        return min(1.0, $jaccard * 1.5);
    }

    private function calculateProximityScore(float $distanceKm): float
    {
        $config = $this->getConfig();
        $prox = $config['proximity'];

        if ($distanceKm <= $prox['walking_km']) return 1.0;
        if ($distanceKm <= $prox['local_km']) {
            $ratio = ($distanceKm - $prox['walking_km']) / ($prox['local_km'] - $prox['walking_km']);
            return 1.0 - ($ratio * 0.1);
        }
        if ($distanceKm <= $prox['city_km']) {
            $ratio = ($distanceKm - $prox['local_km']) / ($prox['city_km'] - $prox['local_km']);
            return 0.9 - ($ratio * 0.2);
        }
        if ($distanceKm <= $prox['regional_km']) {
            $ratio = ($distanceKm - $prox['city_km']) / ($prox['regional_km'] - $prox['city_km']);
            return 0.7 - ($ratio * 0.2);
        }
        if ($distanceKm <= $prox['max_km']) {
            $ratio = ($distanceKm - $prox['regional_km']) / ($prox['max_km'] - $prox['regional_km']);
            return 0.5 - ($ratio * 0.4);
        }

        return max(0.05, 0.1 * ($prox['max_km'] / $distanceKm));
    }

    private function calculateFreshnessScore(?string $createdAt): float
    {
        if (!$createdAt) return 0.5;

        $created = strtotime($createdAt);
        $ageHours = (time() - $created) / 3600;

        if ($ageHours <= self::FRESHNESS_FULL_HOURS) return 1.0;

        $halfLifeHours = self::FRESHNESS_HALF_LIFE_DAYS * 24;
        $decayFactor = pow(0.5, ($ageHours - self::FRESHNESS_FULL_HOURS) / $halfLifeHours);

        return max(self::FRESHNESS_MINIMUM, $decayFactor);
    }

    private function calculateReciprocityScore(array $userListings, array $candidate): array
    {
        $candidateOwnerId = $candidate['user_id'];
        $tenantId = TenantContext::getId();

        $candidateListings = DB::select(
            "SELECT type, category_id, title FROM listings
             WHERE user_id = ? AND tenant_id = ? AND status = 'active'",
            [$candidateOwnerId, $tenantId]
        );
        $candidateListings = array_map(fn ($r) => (array) $r, $candidateListings);

        if (empty($candidateListings)) {
            return ['score' => 0.3, 'type' => 'one_way'];
        }

        $userOfferCats = array_column(array_filter($userListings, fn ($l) => $l['type'] === 'offer'), 'category_id');
        $userRequestCats = array_column(array_filter($userListings, fn ($l) => $l['type'] === 'request'), 'category_id');
        $candOfferCats = array_column(array_filter($candidateListings, fn ($l) => $l['type'] === 'offer'), 'category_id');
        $candRequestCats = array_column(array_filter($candidateListings, fn ($l) => $l['type'] === 'request'), 'category_id');

        $candidateNeedsUserOffer = !empty(array_intersect($userOfferCats, $candRequestCats));
        $userNeedsCandidateOffer = !empty(array_intersect($candOfferCats, $userRequestCats));

        if ($candidateNeedsUserOffer && $userNeedsCandidateOffer) {
            return ['score' => 1.0, 'type' => 'mutual'];
        }
        if ($candidateNeedsUserOffer || $userNeedsCandidateOffer) {
            return ['score' => 0.7, 'type' => 'potential'];
        }

        return ['score' => 0.4, 'type' => 'one_way'];
    }

    private function calculateQualityScore(array $candidate): float
    {
        $score = 0.5;
        $descLength = strlen($candidate['description'] ?? '');
        if ($descLength >= self::QUALITY_MIN_DESCRIPTION) $score += 0.1;
        if ($descLength >= self::QUALITY_MIN_DESCRIPTION * 2) $score += 0.1;
        if (!empty($candidate['image_url'])) $score += 0.1;
        if (!empty($candidate['author_verified']) || !empty($candidate['is_verified'])) $score += 0.1;
        $rating = $candidate['author_rating'] ?? $candidate['avg_rating'] ?? 0;
        if ($rating >= self::QUALITY_RATING_THRESHOLD) $score += 0.1;

        return min(1.0, $score);
    }

    // =========================================================================
    // UTILITY METHODS
    // =========================================================================

    private function calculateDistance(float $lat1, float $lon1, float $lat2, float $lon2): float
    {
        if (!$lat1 || !$lon1 || !$lat2 || !$lon2) return PHP_FLOAT_MAX;

        $earthRadius = 6371;
        $dLat = deg2rad($lat2 - $lat1);
        $dLon = deg2rad($lon2 - $lon1);
        $a = sin($dLat / 2) * sin($dLat / 2) +
            cos(deg2rad($lat1)) * cos(deg2rad($lat2)) *
            sin($dLon / 2) * sin($dLon / 2);
        $c = 2 * atan2(sqrt($a), sqrt(1 - $a));

        return $earthRadius * $c;
    }

    /**
     * Extract keywords from text with light stemming. Delegates to the shared
     * {@see KeywordExtractor} so the batch context loader and pure scorer
     * normalise text identically. Kept public for BC (CrossModuleMatchingService
     * and others call it).
     */
    public function extractKeywords(string $text): array
    {
        return KeywordExtractor::extract($text);
    }

    // =========================================================================
    // DATA LOADING
    // =========================================================================

    private function getUserData(int $userId): ?array
    {
        if (isset($this->userDataCache[$userId])) {
            return $this->userDataCache[$userId];
        }

        $tenantId = TenantContext::getId();

        $rows = DB::select(
            "SELECT u.*,
                    COALESCE(u.latitude, 0) as latitude,
                    COALESCE(u.longitude, 0) as longitude,
                    (SELECT AVG(rating) FROM reviews WHERE receiver_id = u.id AND tenant_id = u.tenant_id) as avg_rating,
                    (SELECT COUNT(*) FROM transactions WHERE (sender_id = u.id OR receiver_id = u.id) AND tenant_id = u.tenant_id AND status = 'completed') as transaction_count
             FROM users u
             WHERE u.id = ? AND u.tenant_id = ?",
            [$userId, $tenantId]
        );

        $user = !empty($rows) ? (array) $rows[0] : null;

        if ($user) {
            // Enrich with proficiency-weighted skills
            try {
                $weighted = \App\Services\SkillTaxonomyService::getProficiencyWeightedSkills($userId, $tenantId);
                $user['skills_weighted'] = $weighted;
                if (!empty($weighted)) {
                    $user['skills_proficiency_keys'] = array_keys($weighted);
                }
            } catch (\Throwable $e) {
                // SkillTaxonomyService error — continue without weighted skills
            }

            $this->userDataCache[$userId] = $user;
        }

        return $user;
    }

    private function getUserListings(int $userId): array
    {
        $tenantId = TenantContext::getId();

        return array_map(
            fn ($row) => (array) $row,
            DB::select(
                "SELECT l.*, c.name as category_name
                 FROM listings l
                 LEFT JOIN categories c ON l.category_id = c.id
                 WHERE l.user_id = ? AND l.tenant_id = ? AND l.status = 'active'
                 ORDER BY l.created_at DESC LIMIT 10",
                [$userId, $tenantId]
            )
        );
    }

    private function getUserPreferences(int $userId): array
    {
        $tenantId = TenantContext::getId();
        $config = $this->getConfig();

        try {
            $rows = DB::select(
                "SELECT * FROM match_preferences WHERE user_id = ? AND tenant_id = ?",
                [$userId, $tenantId]
            );

            if (!empty($rows)) {
                $prefs = (array) $rows[0];
                $prefs['categories'] = $prefs['categories'] ? json_decode($prefs['categories'], true) : null;
                return $prefs;
            }
        } catch (\Exception $e) {
            // Table might not exist
        }

        return [
            'max_distance_km' => $config['max_distance_km'],
            'min_match_score' => $config['min_match_score'],
            'notification_frequency' => 'fortnightly',
            'categories' => null,
        ];
    }

    private function getColdStartMatches(int $userId, array $userData, float $maxDistance, int $limit): array
    {
        $tenantId = TenantContext::getId();
        $config = $this->getConfig();

        // Same hard gates as the main path — the old cold-start SQL fell back
        // to newest-listings-tenant-wide for users without coordinates and
        // labelled every result "nearby".
        $results = $this->candidateRetriever->retrieveColdStart(
            $tenantId,
            $userId,
            $this->coordOrNull($userData['latitude'] ?? null),
            $this->coordOrNull($userData['longitude'] ?? null),
            $maxDistance,
            $config['gates'],
            $limit
        );

        // Safeguarding filter — same rule as the main match path. Applied after
        // LIMIT here (cold-start users typically request small result sets, so
        // we accept the occasional short result rather than expanding LIMIT).
        $results = $this->filterCandidatesByVettingRequirements($results, $userId);

        $localKm = (float) ($config['proximity']['local_km'] ?? self::PROXIMITY_LOCAL);

        foreach ($results as &$listing) {
            $coldScore = 35;
            $descLen = strlen($listing['description'] ?? '');
            if ($descLen >= self::QUALITY_MIN_DESCRIPTION) $coldScore += 10;
            if ($descLen >= self::QUALITY_MIN_DESCRIPTION * 2) $coldScore += 5;
            if (!empty($listing['image_url'])) $coldScore += 10;
            if (!empty($listing['author_verified']) || !empty($listing['is_verified'])) $coldScore += 5;

            $distance = isset($listing['distance_km']) && is_numeric($listing['distance_km'])
                ? (float) $listing['distance_km'] : null;

            // Honest reasons: only claim "nearby" when the distance is known.
            if (($listing['service_type'] ?? 'physical_only') === 'remote_only') {
                $reason = 'Remote-friendly listing you might like';
            } elseif ($distance !== null && $distance <= $localKm) {
                $reason = 'Nearby listing that might interest you';
            } else {
                $reason = 'Recently posted in your community';
            }

            $listing['match_score'] = min(65, $coldScore);
            $listing['match_reasons'] = [$reason];
            $listing['match_type'] = 'cold_start';
            $listing['distance_km'] = $distance;
        }

        return $results;
    }

    /**
     * Whether match_cache has the v2 columns (score_breakdown etc.). Probed
     * once per process so the engine works before AND after the migration.
     */
    private ?bool $matchCacheV2ColumnsCache = null;

    private function matchCacheHasV2Columns(): bool
    {
        if ($this->matchCacheV2ColumnsCache !== null) {
            return $this->matchCacheV2ColumnsCache;
        }

        try {
            DB::selectOne("SELECT score_breakdown FROM match_cache LIMIT 1");
            $this->matchCacheV2ColumnsCache = true;
        } catch (\Throwable $e) {
            $this->matchCacheV2ColumnsCache = false;
        }

        return $this->matchCacheV2ColumnsCache;
    }

    /**
     * Normalise a stored coordinate: NULL/0 (the COALESCE sentinel for missing
     * coords) becomes null so the retriever can apply the degraded mode.
     */
    private function coordOrNull(mixed $value): ?float
    {
        $f = (float) ($value ?? 0);
        return $f != 0.0 ? $f : null;
    }

    // =========================================================================
    // SAFEGUARDING FILTER
    // =========================================================================

    /**
     * Remove candidates the searcher cannot contact under the same central,
     * recipient-authoritative policy used by messaging. Ordinary discovery has
     * no role bypass; a policy error returns no candidates rather than exposing
     * protected members.
     *
     * @param array<int, array> $candidates
     * @param int $searcherId The user ID performing the discovery/match request
     * @return array<int, array>
     */
    /**
     * When the safeguarding filter dropped candidates because the policy was
     * UNAVAILABLE, mark the run degraded so the member is told why. An
     * existing reason (no_coordinates) keeps precedence — it already renders
     * its own banner and call to action.
     */
    private function applyVettingUnavailabilityToMeta(?array &$meta): void
    {
        if (! $this->vettingPolicyUnavailable || ! is_array($meta)) {
            return;
        }

        if (($meta['degraded_reason'] ?? null) === null) {
            $meta['degraded'] = true;
            $meta['degraded_reason'] = 'safeguarding_policy_unavailable';
        }
    }

    public function filterCandidatesByVettingRequirements(array $candidates, int $searcherId): array
    {
        if (empty($candidates) || $searcherId <= 0) {
            return $candidates;
        }

        try {
            $tenantId = TenantContext::getId();
            $policy = app(SafeguardingInteractionPolicy::class);
            $filtered = [];

            foreach ($candidates as $candidate) {
                $owner = (int) ($candidate['user_id'] ?? 0);
                if ($owner <= 0 || $owner === $searcherId) {
                    $filtered[] = $candidate;
                    continue;
                }

                $searcherToOwner = $policy->evaluateLocalContact(
                    $searcherId,
                    $owner,
                    $tenantId,
                    'match_discovery',
                );
                $ownerToSearcher = $policy->evaluateLocalContact(
                    $owner,
                    $searcherId,
                    $tenantId,
                    'match_discovery',
                );
                if ($searcherToOwner->isAllowed() && $ownerToSearcher->isAllowed()) {
                    $filtered[] = $candidate;
                } elseif ($searcherToOwner->isUnavailable() || $ownerToSearcher->isUnavailable()) {
                    // UNAVAILABLE is the gate failing closed (unconfigured or
                    // unsupported jurisdiction), not the gate protecting
                    // someone. Remember it so the API can tell the member why
                    // their list is shorter instead of showing a bare empty
                    // state. A DENY drop is the feature working and is
                    // deliberately NOT surfaced.
                    $this->vettingPolicyUnavailable = true;
                }
            }

            return $filtered;
        } catch (\Throwable $e) {
            Log::error('[SmartMatchingEngine] safeguarding policy unavailable; returning no candidates', [
                'error' => $e->getMessage(),
                'searcher_id' => $searcherId,
                'candidate_count' => count($candidates),
            ]);
            return [];
        }
    }
}
