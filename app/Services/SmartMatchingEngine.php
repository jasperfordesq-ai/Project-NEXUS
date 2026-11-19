<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Services\Matching\CandidateRetriever;
use App\Services\Matching\KeywordExtractor;
use App\Services\Matching\ListingEnrichmentService;
use App\Services\Matching\MatchApprovalGate;
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

    // Cache warming: how long a member whose run cached nothing is left alone
    private const WARM_EMPTY_RETRY_HOURS = 24;

    // AI similarity lookups per match run: one per listing, up to this many
    private const SEMANTIC_LISTINGS_PER_RUN = 5;

    // Profile skills matched per member, in each direction (can do / would like)
    private const SKILL_STAND_INS_PER_DIRECTION = 12;

    // Longest listing title or skill name quoted inside a match reason
    private const REASON_TITLE_LENGTH = 60;

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
                // In a community whose service area is local or regional, a
                // member or listing with no location stands at the community's
                // own centre, scored as "somewhere in this community": capped
                // nearness, never called nearby, no distance shown.
                'community_centre_fallback' => true,
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
                // The AI reads each listing once (ListingEnrichmentService).
                'listing_enrichment' => true,
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
     * Whether this community has Smart Matching switched on (Admin > Smart
     * Matching > "Enabled"). Until 17 Nov 2026 nothing read the switch: a
     * community that turned matching off still had matches computed, cached
     * and shown.
     */
    public function isEnabled(): bool
    {
        return (bool) ($this->getConfig()['enabled'] ?? true);
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
     * For up to $limit active users (who have at least one active listing, or
     * no listing but skills on their profile, and no fresh cache entry) it
     * computes matches via findMatchesForUser() and upserts
     * them into match_cache with a 7-day TTL. Tenant-scoped via TenantContext.
     * Expired rows are deleted first, and nothing runs when the community has
     * Smart Matching switched off.
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

        if (!$this->isEnabled()) {
            return $results;
        }

        // Expired rows are removed first. Nothing ever deleted them, so the
        // table only grew, the admin figures counted matches that had long
        // stopped being matches, and (below) one stale row was enough to put
        // its member back in the queue every half hour for ever.
        try {
            DB::delete(
                "DELETE FROM match_cache WHERE tenant_id = ? AND expires_at IS NOT NULL AND expires_at < NOW() LIMIT 5000",
                [$tenantId]
            );
        } catch (\Throwable $e) {
            Log::warning('SmartMatchingEngine::warmUpCache could not remove expired rows', [
                'tenant_id' => $tenantId, 'error' => $e->getMessage(),
            ]);
        }

        // Active users with an active listing and NO unexpired cache row.
        //
        // The old test was "has no row, or has any expired row". A member
        // with nothing to match never gets a row, and a member with one stale
        // row always had an expired one, so both were recomputed on every
        // run. In a community with more such members than the batch size they
        // filled every batch (ordered by last sign-in) and nobody else was
        // ever reached. Members whose last run cached nothing are now skipped
        // for a day (see WARM_EMPTY_RETRY_HOURS), so the queue moves on.
        //
        // Members with no listing but skills on their profile are included:
        // findMatchesForUser() matches them by those skills (skillListings),
        // and so do the Matches page, the alerts and the digest. Left out
        // here, none of their matches reached match_cache, so the admin
        // figures did not count them and the AI never explained one to them.
        //
        // $limit is an internal int (never user input), inlined because PDO
        // cannot reliably bind a LIMIT placeholder under emulated prepares.
        $limit = max(1, (int) $limit);
        $candidates = DB::select(
            "SELECT u.id
             FROM users u
             WHERE u.tenant_id = ?
               AND u.status = 'active'
               AND (
                   EXISTS (
                       SELECT 1 FROM listings l
                       WHERE l.user_id = u.id AND l.tenant_id = u.tenant_id AND l.status = 'active')
                   OR EXISTS (
                       SELECT 1 FROM user_skills us
                       WHERE us.tenant_id = u.tenant_id AND us.user_id = u.id)
                   OR TRIM(COALESCE(u.skills, '')) <> ''
               )
               AND NOT EXISTS (
                   SELECT 1 FROM match_cache mc
                   WHERE mc.user_id = u.id AND mc.tenant_id = u.tenant_id AND mc.expires_at > NOW())
             ORDER BY u.last_login_at DESC
             LIMIT " . ($limit * 4),
            [$tenantId]
        );

        $users = [];
        foreach ($candidates as $candidate) {
            if (Cache::has(self::warmEmptyKey($tenantId, (int) $candidate->id))) {
                continue;
            }
            $users[] = $candidate;
            if (count($users) >= $limit) {
                break;
            }
        }

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
            $cachedBefore = $results['cached'];

            try {
                $runMeta = null;
                $matches = $this->findMatchesForUser($userId, ['limit' => 20], $runMeta);
            } catch (\Throwable $e) {
                Log::warning('SmartMatchingEngine::warmUpCache findMatches failed', [
                    'user_id' => $userId, 'tenant_id' => $tenantId, 'error' => $e->getMessage(),
                ]);
                continue;
            }

            if (empty($matches)) {
                // No matches, or matching paused: come back tomorrow, not in
                // thirty minutes.
                Cache::put(self::warmEmptyKey($tenantId, $userId), 1, now()->addHours(self::WARM_EMPTY_RETRY_HOURS));
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

            if ($results['cached'] === $cachedBefore) {
                // Every write failed: do not retry this member every run either.
                Cache::put(self::warmEmptyKey($tenantId, $userId), 1, now()->addHours(self::WARM_EMPTY_RETRY_HOURS));
            }
        }

        return $results;
    }

    /**
     * The community's main AI switch. A failure reading it means "off":
     * matching then runs on its own, as it does for every community without AI.
     */
    private function aiSwitchedOn(): bool
    {
        try {
            return \App\Services\AI\AIServiceFactory::isEnabled();
        } catch (\Throwable $e) {
            return false;
        }
    }

    private static function warmEmptyKey(int $tenantId, int $userId): string
    {
        return "smart_match_warm_empty:{$tenantId}:{$userId}";
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

        // This service is a container singleton: the flag belongs to ONE run.
        // Left set, every member computed later in the same process (the
        // cache warm-up loops over hundreds) was marked "degraded" too.
        $this->vettingPolicyUnavailable = false;

        if (!$this->isEnabled()) {
            $meta = [
                'needs_location' => false,
                'degraded' => false,
                'degraded_reason' => null,
                'has_active_listings' => true,
                'paused' => false,
                'disabled' => true,
            ];
            return [];
        }

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
                'disabled' => false,
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
                'disabled' => false,
            ];
            return [];
        }

        $userLat = $this->coordOrNull($userData['latitude'] ?? null);
        $userLon = $this->coordOrNull($userData['longitude'] ?? null);
        $hasCoords = $userLat !== null && $userLon !== null;
        $gates = $config['gates'];

        // A local or regional community's centre stands in for missing
        // locations (see gates.community_centre_fallback). Without it a member
        // who never gave a location saw only remote listings, and nobody saw
        // theirs.
        $centre = !empty($gates['community_centre_fallback']) ? $this->communityCentre((int) $tenantId) : null;
        if ($centre !== null) {
            $gates['community_centre'] = $centre;
        }
        $locationApproximate = false;
        if (!$hasCoords && $centre !== null) {
            $userLat = $centre['lat'];
            $userLon = $centre['lon'];
            $locationApproximate = true;
        }

        $degraded = !$hasCoords && !$locationApproximate
            && (bool) ($gates['geo_hard_gate'] ?? true)
            && (($gates['missing_coords_mode'] ?? 'remote_only') !== 'tenant_wide');

        $meta = [
            'needs_location' => !$hasCoords,
            'degraded' => $degraded,
            'degraded_reason' => !$hasCoords ? 'no_coordinates' : null,
            'location_approximate' => $locationApproximate,
            'has_active_listings' => true,
            'paused' => false,
            'disabled' => false,
        ];

        $userListings = $this->getUserListings($userId);

        // The skills on a member's profile are matched too, one at a time,
        // beside whatever they have posted. Most members never post a
        // listing (tenant 2: 274 active members, 56 live listings on 18 Nov
        // 2026). Until 19 Nov 2026 skills counted only for a member with no
        // listing at all: one request posted, and a member who had said they
        // can garden, cook and drive was never again shown a request for any
        // of those.
        $skillStandIns = $this->skillListings($userId, $userData);
        if (empty($userListings)) {
            $meta['has_active_listings'] = false;
            $meta['matched_from_skills'] = $skillStandIns !== [];
        }
        $userListings = array_merge($userListings, $skillStandIns);
        if (empty($userListings)) {
            $coldStart = $this->getColdStartMatches($userId, $userLat, $userLon, $locationApproximate, $gates, $maxDistance, $limit);
            // Cold-start items are browsing suggestions, not real matches, so
            // they are withheld for a pair needing review but never queued.
            $coldStart = app(MatchApprovalGate::class)->filterListingMatches($coldStart, $userId, $tenantId, false);
            $this->applyVettingUnavailabilityToMeta($meta);
            return $coldStart;
        }

        $matches = [];
        $seenIds = [];

        // At most two candidate queries: one for offers, one for requests.
        //
        // Candidates are NOT confined to the categories of the member's own
        // listings any more. They were until 18 Nov 2026, so "mow my lawn"
        // filed under Home & Garden never met "lawn mowing" filed under Odd
        // Jobs: members rarely pick the same category for the same thing, and
        // that wall hid genuine matches before scoring could see them. The
        // scorer still rewards a shared category; a pair from unrelated
        // categories needs real evidence in its wording to reach the minimum
        // score (MatchQualityBenchmarkTest).
        $myListingsByTarget = ['offer' => [], 'request' => []]; // targetType => my listings it answers
        foreach ($userListings as $myListing) {
            $targetType = ($myListing['type'] === 'offer') ? 'request' : 'offer';
            $myListingsByTarget[$targetType][] = $myListing;
        }

        // The member's own "only these categories" choice still confines them.
        $preferredCategoryIds = is_array($categoryFilter)
            ? array_values(array_unique(array_filter(array_map('intval', $categoryFilter))))
            : [];

        $candidatesByTargetType = ['offer' => [], 'request' => []];
        foreach ($myListingsByTarget as $targetType => $mine) {
            if ($mine === []) {
                continue;
            }
            $candidatesByTargetType[$targetType] = $this->candidateRetriever->retrieveBatch(
                $tenantId, $userId, $targetType, $preferredCategoryIds,
                null, $userLat, $userLon, $maxDistance, $gates
            );
            if ($locationApproximate) {
                // Every distance is measured from the community's centre, not
                // from the member, so none of them is the member's distance.
                foreach ($candidatesByTargetType[$targetType] as &$candidate) {
                    $candidate['location_approximate'] = 1;
                }
                unset($candidate);
            }
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
        // Similarity is looked up PER LISTING of the member: one embedding
        // per listing, so a member with a gardening offer and a computer
        // request gets each scored against its own text. (It used to take the
        // first listing's similarities and apply them to every listing.)
        $semanticByListing = []; // myListingId => [candidateListingId => cosine]
        $profileSimByOwner = [];
        if ($scorer !== null && (bool) ($config['ai']['semantic_signal'] ?? true)) {
            try {
                // The enable check itself queries ai_settings — a hiccup there
                // must degrade to the keyword fallback, never break matching.
                if (\App\Services\AI\AIServiceFactory::isEnabled()) {
                    foreach (array_slice($userListings, 0, self::SEMANTIC_LISTINGS_PER_RUN) as $myListing) {
                        $myListingId = (int) ($myListing['id'] ?? 0);
                        if ($myListingId > 0) {
                            $semanticByListing[$myListingId] = $this->embeddingService->findSimilarWithScores(
                                $myListingId, 'listing', $tenantId, 200
                            );
                        }
                    }
                    $profileSimByOwner = $this->embeddingService->findSimilarWithScores(
                        $userId, 'user', $tenantId, 200
                    );
                }
            } catch (\Throwable $e) {
                Log::debug('[SmartMatchingEngine] semantic signal unavailable: ' . $e->getMessage());
            }
        }
        $haveSemantic = array_filter($semanticByListing) !== [] || $profileSimByOwner !== [];

        // AI reading of each listing (ListingEnrichmentService): plain
        // English terms and kinds of help, from whichever provider the
        // community uses. Added to the listing's own words; a listing never
        // read is matched on its own words alone.
        $readings = [];
        if ($this->aiSwitchedOn()) {
            $readingIds = array_column($userListings, 'id');
            foreach ($candidatesByTargetType as $list) {
                foreach ($list as $cand) {
                    $readingIds[] = (int) ($cand['id'] ?? 0);
                }
            }
            try {
                $readings = app(ListingEnrichmentService::class)->tokensFor((int) $tenantId, $readingIds);
            } catch (\Throwable $e) {
                Log::debug('[SmartMatchingEngine] listing readings unavailable: ' . $e->getMessage());
            }
        }

        $listingKeywordCache = [];
        $extractListingKeywords = function (array $listing) use (&$listingKeywordCache, $readings): array {
            $id = (int) ($listing['id'] ?? 0);
            // A profile skill standing in for a listing has no id; it is
            // scored against every candidate, so its words are kept too.
            $key = $id > 0 ? $id : 's:' . ($listing['type'] ?? '') . ':' . ($listing['title'] ?? '');
            if (isset($listingKeywordCache[$key])) {
                return $listingKeywordCache[$key];
            }
            $keywords = KeywordExtractor::extract(
                ($listing['title'] ?? '') . ' ' . ($listing['description'] ?? '')
            );
            if ($id > 0 && isset($readings[$id])) {
                $keywords = array_values(array_unique(array_merge($keywords, $readings[$id])));
            }
            $listingKeywordCache[$key] = $keywords;

            return $keywords;
        };

        // More than one thing of the member's could be what a match answers.
        $severalToMatchOn = count($userListings) > 1;

        // Each candidate is scored against every listing of the member it
        // could answer, and keeps its best pairing. Before, a candidate was
        // only ever compared with the first listing in the same category.
        foreach ($candidatesByTargetType as $targetType => $candidates) {
            $mine = $myListingsByTarget[$targetType];
            if ($mine === []) {
                continue;
            }

            foreach ($candidates as $candidate) {
                $candidateId = (int) ($candidate['id'] ?? 0);
                if (isset($seenIds[$candidateId])) {
                    continue;
                }

                $best = null;
                $bestListing = null;
                $bestBreakdown = null;
                foreach ($mine as $myListing) {
                    if ($scorer !== null && $context !== null) {
                        $myPrepared = $myListing;
                        $myPrepared['keywords'] = $extractListingKeywords($myListing);
                        $candPrepared = $candidate;
                        $candPrepared['keywords'] = $extractListingKeywords($candidate);

                        $cosine = null;
                        $listingSim = $semanticByListing[(int) ($myListing['id'] ?? 0)][$candidateId] ?? null;
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
                        $breakdown = $scoreResult->toBreakdownArray();
                    } else {
                        $matchResult = $this->calculateMatchScore($userData, $userListings, $myListing, $candidate);
                        $breakdown = null;
                    }

                    if ($best === null || $matchResult['score'] > $best['score']) {
                        $best = $matchResult;
                        $bestListing = $myListing;
                        $bestBreakdown = $breakdown;
                    }
                }

                if ($best !== null && $best['score'] >= $minScore) {
                    if ($bestBreakdown !== null) {
                        $candidate['score_breakdown'] = $bestBreakdown;
                    }
                    $candidate['match_score'] = $best['score'];
                    $candidate['match_reasons'] = $this->reasonsNamingWhatIsAnswered(
                        (array) $best['reasons'], $bestListing, $best['exchange'] ?? null, $severalToMatchOn
                    );
                    $candidate['match_breakdown'] = $best['breakdown'];
                    $candidate['distance_km'] = $best['distance'];
                    $candidate['matched_listing'] = $bestListing['title'];
                    $candidate['matched_from_skill'] = !empty($bestListing['from_profile_skills']);
                    $candidate['match_type'] = $best['type'];
                    if (!empty($best['exchange'])) {
                        // The two listings that make this a two-way match.
                        $candidate['mutual_exchange'] = $best['exchange'];
                    }
                    $candidate['algorithm_version'] = $scorer !== null ? 'v2' : 'v1';

                    $matches[] = $candidate;
                    $seenIds[$candidateId] = true;
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
        if (!empty($matches) && !$haveSemantic) {
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

        // The minimum applies to the score the member is shown. It was
        // checked before the learning, dismissal and exposure adjustments,
        // which could then take a match below the member's own minimum.
        $matches = array_values(array_filter(
            $matches,
            fn ($m) => (float) ($m['match_score'] ?? 0) >= (float) $minScore
        ));

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

        // Safeguarding: a pair where either member chose coordinator approval
        // or "restrict matching", or is under monitoring, is never introduced
        // automatically — the match goes to the coordinators' Match Approvals
        // queue and appears only once approved.
        $capped = app(MatchApprovalGate::class)->filterListingMatches($capped, $userId, $tenantId);

        $this->applyVettingUnavailabilityToMeta($meta);

        return array_slice($capped, 0, $limit);
    }

    /**
     * The lowest score this member is shown when the caller names none: their
     * own saved minimum, else the community's configured one. The matches
     * page used to send nothing and get a fixed 30, which silently overrode
     * both the member's setting and the admin's.
     */
    public function effectiveMinScore(int $userId): float
    {
        $config = $this->getConfig();
        $preferences = $this->getUserPreferences($userId);
        $value = $preferences['min_match_score'] ?? $config['min_match_score'] ?? 40;

        return max(0.0, min(100.0, (float) $value));
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
     *  - anti-popularity: −min(6, 2·ln(n/typical)) for an owner who appeared
     *    in the tenant's match_cache over twice as often as the typical
     *    owner in this list did, in the last 7 days
     *  - worked together: completed exchanges with the owner (+4 each, up to
     *    +8), or −8 when this member rated one poorly
     *  - AI judgement: the stored −5..+5 verdict on this match (AI on only)
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

        // Exposure is judged against the TYPICAL owner in this list, not in
        // absolute numbers. Every warmed member caches up to 20 matches, so
        // in an active community almost every owner passed 20 appearances a
        // week and the "anti-popularity" penalty became a flat -6 on nearly
        // everyone: no change to the order, but enough to sink scores under
        // the member's minimum and out of reach of the alert threshold.
        $exposures = [];
        foreach ($ownerIds as $ownerId) {
            $exposures[] = $popularity[$ownerId] ?? 0;
        }
        sort($exposures);
        $typicalExposure = max(1, $exposures[intdiv(count($exposures), 2)] ?? 0);

        // What really happened between the two members: an exchange that was
        // completed (and not rated poorly by this member) counts for them, one
        // this member rated poorly counts against. Read from the exchange
        // records themselves, so every way of making an exchange is covered.
        $worked = [];
        try {
            $worked = $this->matchLearningService->getExchangeOutcomeBoosts($userId, $ownerIds);
        } catch (\Throwable $e) {
            // Best-effort.
        }

        // The AI's judgement of each cached match (MatchExplanationService),
        // -5..+5, where the community has AI on. It used to be added into
        // match_cache.match_score, which no page reads and the next refresh
        // overwrote.
        $aiJudgement = [];
        if ($this->aiSwitchedOn()) {
            try {
                $listingIds = array_values(array_filter(array_map(fn ($m) => (int) ($m['id'] ?? 0), $matches)));
                if ($listingIds !== []) {
                    $placeholders = implode(',', array_fill(0, count($listingIds), '?'));
                    $rows = DB::select(
                        "SELECT listing_id, ai_rerank_delta FROM match_cache
                         WHERE tenant_id = ? AND user_id = ? AND ai_rerank_delta IS NOT NULL
                           AND listing_id IN ($placeholders)",
                        array_merge([$tenantId, $userId], $listingIds)
                    );
                    foreach ($rows as $row) {
                        $aiJudgement[(int) $row->listing_id] = max(-5.0, min(5.0, (float) $row->ai_rerank_delta));
                    }
                }
            } catch (\Throwable $e) {
                // Column not there yet, or the cache unreadable: no judgement.
            }
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
            if ($exposure > 2 * $typicalExposure) {
                $penalty = -min(6.0, 2.0 * log($exposure / $typicalExposure));
                $applied['popularity'] = round($penalty, 2);
            }

            if (isset($worked[$owner]) && $worked[$owner] != 0.0) {
                $applied['worked_together'] = round($worked[$owner], 2);
            }

            $listingId = (int) ($match['id'] ?? 0);
            if (isset($aiJudgement[$listingId]) && $aiJudgement[$listingId] != 0.0) {
                $applied['ai_judgement'] = round($aiJudgement[$listingId], 2);
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
                   AND (l.moderation_status IS NULL OR l.moderation_status = 'approved')
                   AND (l.expires_at IS NULL OR l.expires_at > NOW())
                 ORDER BY l.created_at DESC LIMIT 10",
                [$userId, $tenantId]
            )
        );
    }

    /**
     * Stand-in listings built from the skills on a member's profile, one per
     * skill: what they can do becomes an offer, what they would like help
     * with a request. They carry id 0 and are never stored.
     *
     * @return array<int, array<string, mixed>>
     */
    private function skillListings(int $userId, array $userData): array
    {
        $tenantId = (int) TenantContext::getId();
        $give = [];
        $want = [];

        try {
            $rows = DB::select(
                "SELECT skill_name, is_offering, is_requesting FROM user_skills WHERE tenant_id = ? AND user_id = ?",
                [$tenantId, $userId]
            );
        } catch (\Throwable $e) {
            Log::warning('[SmartMatchingEngine] profile skills unavailable', ['user_id' => $userId, 'error' => $e->getMessage()]);
            $rows = [];
        }
        foreach ($rows as $row) {
            $name = trim((string) ($row->skill_name ?? ''));
            if ($name === '') {
                continue;
            }
            $offering = !empty($row->is_offering);
            $requesting = !empty($row->is_requesting);
            if (!$offering && !$requesting) {
                $offering = true; // older rows carry no direction: a skill is something you can do
            }
            if ($offering) {
                $give[] = $name;
            }
            if ($requesting) {
                $want[] = $name;
            }
        }

        if ($give === [] && $want === []) {
            $give = CrossModuleMatchingService::skillNames((string) ($userData['skills'] ?? ''));
        }

        // One stand-in per skill. They used to be merged into a single
        // listing ("Gardening, Cooking, Computers, Driving, ..."), and every
        // skill added made each of the others count for less: measured 19 Nov
        // 2026, a request for garden help scored 70.6 for a member whose only
        // skill was gardening and 63.2 for one who also had seven others.
        $listings = [];
        foreach (['offer' => $give, 'request' => $want] as $type => $names) {
            $seen = [];
            foreach ($names as $name) {
                $key = mb_strtolower($name);
                if (isset($seen[$key])) {
                    continue;
                }
                $seen[$key] = true;
                if (count($seen) > self::SKILL_STAND_INS_PER_DIRECTION) {
                    break;
                }
                $listings[] = [
                    'id' => 0,
                    'user_id' => $userId,
                    'tenant_id' => $tenantId,
                    'type' => $type,
                    'title' => mb_substr($name, 0, 200),
                    'description' => '',
                    'category_id' => null,
                    'category_name' => null,
                    'service_type' => 'physical_only',
                    'created_at' => null,
                    'from_profile_skills' => true,
                ];
            }
        }

        return $listings;
    }

    /**
     * Put first the reason that says WHICH of the member's listings or skills
     * a match is for, and name both listings of a two-way match.
     *
     * A member with three listings and five skills was shown "Skills match
     * your expertise" and left to work out which. The phrases are stored in
     * English and translated when read (MatchReasonText).
     *
     * @param string[] $reasons
     * @param array<string, mixed> $myListing the member's listing, or the skill standing in for one
     * @param array{you_offer?: string, they_offer?: string}|null $exchange
     * @return string[]
     */
    private function reasonsNamingWhatIsAnswered(array $reasons, array $myListing, ?array $exchange, bool $severalToMatchOn): array
    {
        $short = static function (string $title): string {
            $title = trim((string) preg_replace('/\s+/u', ' ', $title));

            return mb_strlen($title) > self::REASON_TITLE_LENGTH
                ? rtrim(mb_substr($title, 0, self::REASON_TITLE_LENGTH - 1)) . '…'
                : $title;
        };

        if (is_array($exchange) && !empty($exchange['you_offer']) && !empty($exchange['they_offer'])
            && in_array('Mutual exchange possible!', $reasons, true)) {
            $twoWay = sprintf(
                'Two-way match: you offer "%s" and they offer "%s"',
                $short((string) $exchange['you_offer']),
                $short((string) $exchange['they_offer'])
            );
            $reasons = array_values(array_filter($reasons, fn ($r) => $r !== 'Mutual exchange possible!'));
            array_unshift($reasons, $twoWay);

            return $reasons;
        }

        $title = $short((string) ($myListing['title'] ?? ''));
        $fromSkill = !empty($myListing['from_profile_skills']);
        if ($title === '' || (!$fromSkill && !$severalToMatchOn)) {
            return array_values($reasons);
        }

        $isOffer = ($myListing['type'] ?? '') === 'offer';
        if ($fromSkill) {
            $lead = $isOffer ? 'For your skill: ' : 'For something you would like help with: ';
        } else {
            $lead = $isOffer ? 'For your offer: ' : 'For your request: ';
        }
        array_unshift($reasons, $lead . $title);

        return array_values($reasons);
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

    private function getColdStartMatches(
        int $userId,
        ?float $userLat,
        ?float $userLon,
        bool $locationApproximate,
        array $gates,
        float $maxDistance,
        int $limit
    ): array {
        $tenantId = TenantContext::getId();
        $config = $this->getConfig();

        // Same hard gates as the main path — the old cold-start SQL fell back
        // to newest-listings-tenant-wide for users without coordinates and
        // labelled every result "nearby".
        $results = $this->candidateRetriever->retrieveColdStart(
            $tenantId,
            $userId,
            $userLat,
            $userLon,
            $maxDistance,
            $gates,
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
                && !$locationApproximate && empty($listing['location_approximate'])
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
    /**
     * The community's own centre, when its service area is local or regional
     * and it has one. A national or international community has no centre
     * that could stand in for a member's location.
     *
     * @return array{lat: float, lon: float}|null
     */
    private function communityCentre(int $tenantId): ?array
    {
        try {
            $row = DB::table('tenants')->where('id', $tenantId)->first(['latitude', 'longitude', 'service_area']);
        } catch (\Throwable $e) {
            Log::warning('[SmartMatchingEngine] community centre unavailable', ['tenant_id' => $tenantId, 'error' => $e->getMessage()]);
            return null;
        }

        if ($row === null || !in_array((string) ($row->service_area ?? ''), ['local', 'regional'], true)) {
            return null;
        }
        $lat = $this->coordOrNull($row->latitude ?? null);
        $lon = $this->coordOrNull($row->longitude ?? null);

        return $lat !== null && $lon !== null ? ['lat' => $lat, 'lon' => $lon] : null;
    }

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
            // One decision per MEMBER, not per listing: the answer depends
            // only on the two people. It was asked again for every listing,
            // twice each, so an owner with ten listings cost twenty
            // evaluations (each several queries) on every matches page load.
            $allowedByOwner = [];

            foreach ($candidates as $candidate) {
                $owner = (int) ($candidate['user_id'] ?? 0);
                if ($owner <= 0 || $owner === $searcherId) {
                    $filtered[] = $candidate;
                    continue;
                }
                if (isset($allowedByOwner[$owner])) {
                    if ($allowedByOwner[$owner]) {
                        $filtered[] = $candidate;
                    }
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
                $allowedByOwner[$owner] = $searcherToOwner->isAllowed() && $ownerToSearcher->isAllowed();
                if ($allowedByOwner[$owner]) {
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
