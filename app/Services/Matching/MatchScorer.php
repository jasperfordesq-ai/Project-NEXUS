<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\Matching;

/**
 * MatchScorer — pure (no DB, no TenantContext) three-pillar match scoring.
 *
 * Replaces the v1 flat weighted sum with a weighted GEOMETRIC MEAN of three
 * pillars, so a terrible pillar can no longer be averaged away by good ones
 * (multiplicative aggregation, as used in reciprocal-recommender systems):
 *
 *   Core  = 100 × Relevance^wR × Feasibility^wF × Trust^wT   (pillars clamped [0.05, 1])
 *   Final = clamp(Core + bounded additive adjustments, 0, 100)
 *
 * Pillars (sub-weights configurable via config.signals):
 *   Relevance   — category · two-sided directional skills · semantic
 *   Feasibility — proximity (service_type aware) · availability · owner activity
 *   Trust       — Bayesian reviews · trust tier · completed exchanges
 *
 * For location-bound listings (physical_only/location_dependent) proximity
 * additionally CEILINGS the feasibility pillar (≤ proximity + 0.10), and
 * positive adjustments scale with feasibility — otherwise perfect
 * availability/activity/mutuality would average away an unreachable match,
 * which is exactly the v1 failure mode this scorer replaces.
 *
 * The skill signal is RECIPROCAL: forward = what the searcher gives vs what
 * the candidate's owner wants; backward = the reverse. Both directions are
 * combined with a harmonic mean (2fb/(f+b)) so a one-sided fit scores low.
 *
 * Unknown-signal defaults are deliberately deflated (the v1 defaults let a
 * candidate with NO skill/category/quality data score ~55 and clear the
 * visibility threshold on unknowns alone).
 *
 * All inputs are plain arrays assembled by the engine/TenantMatchingContext;
 * this class is deterministic and fully unit-testable in isolation.
 */
final class MatchScorer
{
    // Unknown-signal defaults (deflated vs v1)
    private const DEFAULT_CATEGORY = 0.10;
    private const DEFAULT_SKILL = 0.20;
    private const DEFAULT_SEMANTIC = 0.20;
    private const DEFAULT_AVAILABILITY = 0.60;
    private const DEFAULT_ACTIVITY = 0.30;
    private const REVIEW_PRIOR = 0.72;       // ≈ 3.6★ neutral prior
    private const REVIEW_PRIOR_WEIGHT = 3;   // pseudo-review count

    private const PILLAR_FLOOR = 0.05;
    private const ADJUSTMENT_CAP = 20.0;

    /** Highest nearness credited when a location had to be approximated. */
    private const APPROXIMATE_PROXIMITY_CAP = 0.6;

    /** Embedding cosine range mapped onto 0–1 for the semantic signal. */
    private const SEMANTIC_COSINE_MIN = 0.15;
    private const SEMANTIC_COSINE_MAX = 0.90;

    public function __construct(
        private readonly array $config,
        /** @var array<int, array{name: string, parent_id: ?int}> */
        private readonly array $categories = [],
    ) {}

    /**
     * Score one searcher-listing ↔ candidate-listing pair.
     *
     * @param array $searcher {
     *   give_keywords: array<string,float>|string[], want_keywords: array<string,float>|string[],
     *   offer_category_ids: int[], request_category_ids: int[], availability: ?array
     * }
     * @param array $searcherListing Searcher's source listing (type, category_id, keywords[])
     * @param array $candidate Candidate listing row + keywords[] + ?distance_km + service_type + availability + created_at
     * @param array $owner Candidate owner profile {
     *   give_keywords, want_keywords, offer_category_ids, request_category_ids,
     *   last_active_days: ?float, rating_avg: ?float, rating_count: int,
     *   trust_tier: ?float, completed_tx: int
     * }
     * @param float|null $semanticSimilarity Raw embedding cosine (AI on) or null (keyword fallback)
     */
    public function score(
        array $searcher,
        array $searcherListing,
        array $candidate,
        array $owner,
        ?float $semanticSimilarity = null
    ): MatchScoreResult {
        $reasons = [];

        // ── Relevance signals ──────────────────────────────────────────────
        $category = $this->categoryScore(
            $searcherListing['category_id'] ?? null,
            $candidate['category_id'] ?? null
        );
        if ($category >= 0.99) {
            $reasons[] = 'Same category: ' . ($candidate['category_name'] ?? 'General');
        } elseif ($category >= 0.6) {
            $reasons[] = 'Related category: ' . ($candidate['category_name'] ?? 'General');
        }

        [$skill, $forward, $backward] = $this->skillScore($searcher, $searcherListing, $candidate, $owner);
        // "Both ways" only when each side really has something the other
        // wants. A strong ONE-way fit (forward 1.0, combined 0.6) used to
        // clear the 0.5 bar on its own and be described as two-way.
        if (min($forward, $backward) >= 0.3 && $skill >= 0.5) {
            $reasons[] = 'Skills match both ways';
        } elseif (max($forward, $backward) >= 0.5) {
            $reasons[] = 'Skills match your expertise';
        }

        $semantic = $this->semanticScore($searcherListing, $candidate, $semanticSimilarity);
        if ($semanticSimilarity !== null && $semantic >= 0.6) {
            $reasons[] = 'Very similar to what you are looking for';
        } elseif ($semanticSimilarity === null && $semantic >= 0.6 && $this->sameKindOfHelp($searcherListing, $candidate)) {
            $reasons[] = 'Very similar to what you are looking for';
        }

        // ── Feasibility signals ────────────────────────────────────────────
        $serviceType = (string) ($candidate['service_type'] ?? 'physical_only');
        $distance = isset($candidate['distance_km']) && is_numeric($candidate['distance_km'])
            ? (float) $candidate['distance_km'] : null;

        // A distance measured from the community's centre (one side gave no
        // location) only says "somewhere in this community": nearness is
        // capped, never described as close, and no distance is reported.
        if (!empty($candidate['location_approximate']) && $serviceType !== 'remote_only') {
            $proximity = min($this->proximityScore($serviceType, $distance), self::APPROXIMATE_PROXIMITY_CAP);
            $distance = null;
        } else {
            $proximity = $this->proximityScore($serviceType, $distance);
        }
        $prox = $this->proximityBands();
        if ($serviceType === 'remote_only') {
            $reasons[] = 'Can be done remotely';
        } elseif ($distance !== null && $distance <= $prox['walking_km']) {
            $reasons[] = sprintf('Very close: %.1f km away', $distance);
        } elseif ($distance !== null && $distance <= $prox['local_km']) {
            $reasons[] = sprintf('Nearby: %.1f km away', $distance);
        }

        $availability = $this->availabilityScore(
            $searcher['availability'] ?? null,
            $candidate['availability'] ?? null
        );

        $lastActiveDays = isset($owner['last_active_days']) && is_numeric($owner['last_active_days'])
            ? (float) $owner['last_active_days'] : null;
        $activity = $this->activityScore($lastActiveDays);
        if ($lastActiveDays !== null && $lastActiveDays <= 7) {
            $reasons[] = 'Recently active member';
        }

        // ── Trust signals ──────────────────────────────────────────────────
        $ratingCount = (int) ($owner['rating_count'] ?? 0);
        $reviews = $this->reviewScore(
            isset($owner['rating_avg']) && is_numeric($owner['rating_avg']) ? (float) $owner['rating_avg'] : null,
            $ratingCount
        );
        if ($reviews >= 0.85 && $ratingCount >= 3) {
            $reasons[] = 'Highly rated member';
        }

        $trustTier = $this->trustTierScore(
            isset($owner['trust_tier']) && is_numeric($owner['trust_tier']) ? (float) $owner['trust_tier'] : null
        );
        $completion = $this->completionScore((int) ($owner['completed_tx'] ?? 0));

        // ── Pillar aggregation (weighted geometric mean) ───────────────────
        $signalWeights = $this->signalWeights();

        $relevance = $this->weightedAverage([
            'category' => [$category, $signalWeights['relevance']['category']],
            'skill' => [$skill, $signalWeights['relevance']['skill']],
            'semantic' => [$semantic, $signalWeights['relevance']['semantic']],
        ]);
        // Hybrid listings keep a viable remote half even when the physical
        // distance is hopeless — proximity never drops below the remote floor.
        if ($serviceType === 'hybrid') {
            $proximity = max($proximity, 0.5);
        }

        $feasibility = $this->weightedAverage([
            'proximity' => [$proximity, $signalWeights['feasibility']['proximity']],
            'availability' => [$availability, $signalWeights['feasibility']['availability']],
            'activity' => [$activity, $signalWeights['feasibility']['activity']],
        ]);

        // For location-bound listings proximity CEILINGS the pillar: perfect
        // availability/activity must not average away being unreachable (the
        // exact failure mode of the v1 weighted sum).
        if (in_array($serviceType, ['physical_only', 'location_dependent'], true)) {
            $feasibility = min($feasibility, $proximity + 0.10);
        }
        $trust = $this->weightedAverage([
            'reviews' => [$reviews, $signalWeights['trust']['reviews']],
            'trust_tier' => [$trustTier, $signalWeights['trust']['trust_tier']],
            'completion' => [$completion, $signalWeights['trust']['completion']],
        ]);

        $pillars = [
            'relevance' => $this->clampPillar($relevance),
            'feasibility' => $this->clampPillar($feasibility),
            'trust' => $this->clampPillar($trust),
        ];

        $pillarWeights = $this->pillarWeights();
        $core = 100.0;
        foreach ($pillars as $name => $value) {
            $core *= pow($value, $pillarWeights[$name]);
        }

        // ── Bounded additive adjustments ───────────────────────────────────
        $adjustments = [];

        [$matchType, $mutualBonus] = $this->reciprocity($searcher, $owner, $forward, $backward);
        if ($mutualBonus > 0) {
            $adjustments['mutual'] = $mutualBonus;
            $reasons[] = 'Mutual exchange possible!';
        }

        $freshness = $this->freshnessAdjustment($candidate['created_at'] ?? null);
        if ($freshness != 0.0) {
            $adjustments['freshness'] = $freshness;
            if ($freshness > 2) {
                $reasons[] = 'Posted recently';
            }
        }

        // Positive bonuses (mutual, freshness) scale with feasibility — a
        // mutual exchange you cannot physically reach is not worth boosting.
        $positiveScale = min(1.0, $pillars['feasibility'] / 0.5);
        $totalAdjustment = 0.0;
        foreach ($adjustments as $value) {
            $totalAdjustment += $value > 0 ? $value * $positiveScale : $value;
        }
        $totalAdjustment = max(-self::ADJUSTMENT_CAP, min(self::ADJUSTMENT_CAP, $totalAdjustment));
        $final = max(0.0, min(100.0, $core + $totalAdjustment));

        return new MatchScoreResult(
            score: round($final, 1),
            pillars: $pillars,
            signals: [
                'relevance' => ['category' => $category, 'skill' => $skill, 'semantic' => $semantic],
                'feasibility' => ['proximity' => $proximity, 'availability' => $availability, 'activity' => $activity],
                'trust' => ['reviews' => $reviews, 'trust_tier' => $trustTier, 'completion' => $completion],
            ],
            adjustments: $adjustments,
            reasons: array_values(array_unique($reasons)),
            matchType: $matchType,
            distanceKm: $distance !== null ? round($distance, 1) : null,
            serviceType: $serviceType,
        );
    }

    // ═════════════════════════════════════════════════════════════════════
    // RELEVANCE
    // ═════════════════════════════════════════════════════════════════════

    private function categoryScore(mixed $searcherCatId, mixed $candidateCatId): float
    {
        $a = $searcherCatId !== null ? (int) $searcherCatId : null;
        $b = $candidateCatId !== null ? (int) $candidateCatId : null;

        if ($a !== null && $a === $b) {
            return 1.0;
        }
        if ($a === null || $b === null || $a === 0 || $b === 0) {
            return self::DEFAULT_CATEGORY;
        }

        $catA = $this->categories[$a] ?? null;
        $catB = $this->categories[$b] ?? null;

        if ($catA !== null && $catB !== null
            && $catA['parent_id'] !== null && $catA['parent_id'] === $catB['parent_id']) {
            return 0.7;
        }

        // Different categories are related when their NAMES are about the same
        // thing ("Home & Garden" / "Gardening"). This used to be letter overlap
        // (similar_text), which gave "Music & Arts" and "Odd Jobs & Repairs"
        // credit for sharing "&", spaces and a few letters.
        if ($catA !== null && $catB !== null
            && array_intersect($this->categoryTerms($a), $this->categoryTerms($b)) !== []) {
            return 0.6;
        }

        return self::DEFAULT_CATEGORY;
    }

    /** @var array<int, string[]> */
    private array $categoryTermCache = [];

    /** @return string[] words and concepts of a category's name */
    private function categoryTerms(int $categoryId): array
    {
        return $this->categoryTermCache[$categoryId]
            ??= KeywordExtractor::extract((string) ($this->categories[$categoryId]['name'] ?? ''));
    }

    /**
     * Two-sided reciprocal skill score.
     *
     * @return array{0: float, 1: float, 2: float} [combined, forward, backward]
     */
    private function skillScore(array $searcher, array $searcherListing, array $candidate, array $owner): array
    {
        $listingKeywords = fn (array $listing) => array_values((array) ($listing['keywords'] ?? []));

        // Each side twice: the two listings alone, and the listings folded
        // into the members' profile skills (an offer describes what its
        // author gives, a request what they want).
        $searcherGiveListing = $searcherWantListing = $ownerGiveListing = $ownerWantListing = [];
        $searcherGive = $this->normaliseWeighted($searcher['give_keywords'] ?? []);
        $searcherWant = $this->normaliseWeighted($searcher['want_keywords'] ?? []);
        if (($searcherListing['type'] ?? '') === 'offer') {
            $searcherGiveListing = $this->mergeWeighted([], $listingKeywords($searcherListing));
            $searcherGive = $this->mergeWeighted($searcherGive, $listingKeywords($searcherListing));
        } else {
            $searcherWantListing = $this->mergeWeighted([], $listingKeywords($searcherListing));
            $searcherWant = $this->mergeWeighted($searcherWant, $listingKeywords($searcherListing));
        }

        $ownerGive = $this->normaliseWeighted($owner['give_keywords'] ?? []);
        $ownerWant = $this->normaliseWeighted($owner['want_keywords'] ?? []);
        if (($candidate['type'] ?? '') === 'offer') {
            $ownerGiveListing = $this->mergeWeighted([], $listingKeywords($candidate));
            $ownerGive = $this->mergeWeighted($ownerGive, $listingKeywords($candidate));
        } else {
            $ownerWantListing = $this->mergeWeighted([], $listingKeywords($candidate));
            $ownerWant = $this->mergeWeighted($ownerWant, $listingKeywords($candidate));
        }

        // Profile skills only ever ADD evidence. Folded in alone, every
        // unrelated skill a member listed enlarged the union and shrank the
        // overlap, so filling in a profile lowered a member's matches
        // (measured 18 Nov 2026: a genuine pair fell from 79.5 to 71.1 when
        // both members had an ordinary list of other skills).
        $forward = max(
            $this->weightedJaccard($searcherGive, $ownerWant),
            $this->weightedJaccard($searcherGiveListing, $ownerWantListing)
        );
        $backward = max(
            $this->weightedJaccard($ownerGive, $searcherWant),
            $this->weightedJaccard($ownerGiveListing, $searcherWantListing)
        );

        if ($forward <= 0.0 && $backward <= 0.0) {
            $hasAnyData = !empty($searcherGive) || !empty($searcherWant)
                || !empty($ownerGive) || !empty($ownerWant);
            return [$hasAnyData ? 0.0 : self::DEFAULT_SKILL, 0.0, 0.0];
        }

        // A one-way fit counts 0.6 of itself; a second direction adds to it,
        // in proportion to how strong it is. This was a harmonic mean, which
        // a small overlap the other way dragged far BELOW the one-way score
        // (forward 1.0 alone: 0.6; with backward 0.1 added: 0.18).
        $high = max($forward, $backward);
        $low = min($forward, $backward);
        $combined = $high * (0.6 + 0.4 * ($low / $high));

        return [min(1.0, $combined), $forward, $backward];
    }

    private function semanticScore(array $searcherListing, array $candidate, ?float $cosine): float
    {
        $wording = $this->wordingScore($searcherListing, $candidate);
        if ($cosine !== null) {
            $mapped = ($cosine - self::SEMANTIC_COSINE_MIN)
                / (self::SEMANTIC_COSINE_MAX - self::SEMANTIC_COSINE_MIN);

            // The AI figure can only add to what the wording already shows.
            // It is often not about these two listings at all: a listing
            // posted since the last AI run has no figure, and the engine
            // then passes the two MEMBERS' profile similarity instead, which
            // used to replace clear evidence like "~childcare" on both sides.
            return max(max(0.0, min(1.0, $mapped)), $wording);
        }

        return $wording;
    }

    /** What the two listing texts share, without an AI model. */
    private function wordingScore(array $searcherListing, array $candidate): float
    {
        $a = array_values((array) ($searcherListing['keywords'] ?? []));
        $b = array_values((array) ($candidate['keywords'] ?? []));
        if (empty($a) || empty($b)) {
            return self::DEFAULT_SEMANTIC;
        }

        $intersect = count(array_intersect($a, $b));
        $union = count(array_unique(array_merge($a, $b)));
        $jaccard = $union > 0 ? $intersect / $union : 0.0;

        // Same kind of help ("~childcare" on both sides) is strong evidence
        // even when the wording differs completely: "babysitter needed" and
        // "I can mind your kids" share no word, so word overlap alone scores
        // them as unrelated. Measured against the listing with fewer
        // concepts, so a listing covering two kinds of help still fully
        // answers a request for one of them.
        $conceptsA = array_values(array_filter($a, fn ($k) => is_string($k) && KeywordExtractor::isConcept($k)));
        $conceptsB = array_values(array_filter($b, fn ($k) => is_string($k) && KeywordExtractor::isConcept($k)));
        $conceptOverlap = 0.0;
        if ($conceptsA !== [] && $conceptsB !== []) {
            $conceptOverlap = count(array_intersect($conceptsA, $conceptsB))
                / min(count($conceptsA), count($conceptsB));
        }

        return min(1.0, max($jaccard * 1.5, $conceptOverlap));
    }

    /** Whether the two listings describe the same kind of help (AI-off evidence). */
    private function sameKindOfHelp(array $searcherListing, array $candidate): bool
    {
        $a = array_filter((array) ($searcherListing['keywords'] ?? []), fn ($k) => is_string($k) && KeywordExtractor::isConcept($k));
        $b = array_filter((array) ($candidate['keywords'] ?? []), fn ($k) => is_string($k) && KeywordExtractor::isConcept($k));

        return $a !== [] && array_intersect($a, $b) !== [];
    }

    // ═════════════════════════════════════════════════════════════════════
    // FEASIBILITY
    // ═════════════════════════════════════════════════════════════════════

    private function proximityScore(string $serviceType, ?float $distanceKm): float
    {
        if ($serviceType === 'remote_only') {
            return 0.9;
        }
        if ($distanceKm === null) {
            return $serviceType === 'hybrid' ? 0.5 : 0.05;
        }

        $prox = $this->proximityBands();

        if ($distanceKm <= $prox['walking_km']) {
            return 1.0;
        }
        if ($distanceKm <= $prox['local_km']) {
            $ratio = ($distanceKm - $prox['walking_km']) / max(0.001, $prox['local_km'] - $prox['walking_km']);
            return 1.0 - ($ratio * 0.1);
        }
        if ($distanceKm <= $prox['city_km']) {
            $ratio = ($distanceKm - $prox['local_km']) / max(0.001, $prox['city_km'] - $prox['local_km']);
            return 0.9 - ($ratio * 0.2);
        }
        if ($distanceKm <= $prox['regional_km']) {
            $ratio = ($distanceKm - $prox['city_km']) / max(0.001, $prox['regional_km'] - $prox['city_km']);
            return 0.7 - ($ratio * 0.2);
        }
        if ($distanceKm <= $prox['max_km']) {
            $ratio = ($distanceKm - $prox['regional_km']) / max(0.001, $prox['max_km'] - $prox['regional_km']);
            return 0.5 - ($ratio * 0.4);
        }

        return max(0.05, 0.1 * ($prox['max_km'] / $distanceKm));
    }

    /**
     * Overlap between the searcher's preferred availability and the listing's
     * stated availability. Unknown on either side is NEUTRAL-positive (0.60):
     * sparse availability data must not punish otherwise-good matches.
     */
    private function availabilityScore(mixed $searcherAvailability, mixed $candidateAvailability): float
    {
        $a = $this->normaliseAvailability($searcherAvailability);
        $b = $this->normaliseAvailability($candidateAvailability);

        if (empty($a) || empty($b)) {
            return self::DEFAULT_AVAILABILITY;
        }

        $overlap = count(array_intersect($a, $b));
        $ratio = $overlap / min(count($a), count($b));

        // Zero overlap on explicitly-stated availabilities is a real conflict.
        return 0.3 + 0.7 * $ratio;
    }

    private function activityScore(?float $lastActiveDays): float
    {
        if ($lastActiveDays === null) {
            return self::DEFAULT_ACTIVITY;
        }
        if ($lastActiveDays <= 7) return 1.0;
        if ($lastActiveDays <= 30) return 0.7;
        if ($lastActiveDays <= 60) return 0.4;
        if ($lastActiveDays <= 90) return 0.2;
        return 0.1;
    }

    // ═════════════════════════════════════════════════════════════════════
    // TRUST
    // ═════════════════════════════════════════════════════════════════════

    /** Bayesian-smoothed rating: few reviews pull toward a neutral prior. */
    private function reviewScore(?float $ratingAvg, int $ratingCount): float
    {
        if ($ratingAvg === null || $ratingCount <= 0) {
            return self::REVIEW_PRIOR;
        }

        $normalised = max(0.0, min(1.0, $ratingAvg / 5.0));

        return (self::REVIEW_PRIOR_WEIGHT * self::REVIEW_PRIOR + $ratingCount * $normalised)
            / (self::REVIEW_PRIOR_WEIGHT + $ratingCount);
    }

    private function trustTierScore(?float $trustTier): float
    {
        if ($trustTier === null) {
            return 0.5;
        }
        return max(0.0, min(1.0, $trustTier / 3.0));
    }

    /**
     * A member with no exchanges yet is unknown, not untrustworthy: they get
     * the credit of about one exchange (0.25), as an unreviewed member gets a
     * neutral review prior. At 0.0 every newcomer's listings scored about 3%
     * below an established member's on this alone, which in a timebank works
     * against exactly the members who most need a first exchange.
     */
    private const NEWCOMER_COMPLETION = 0.25;

    private function completionScore(int $completedTx): float
    {
        if ($completedTx <= 0) {
            return self::NEWCOMER_COMPLETION;
        }
        return max(self::NEWCOMER_COMPLETION, min(1.0, log(1 + $completedTx) / log(21)));
    }

    // ═════════════════════════════════════════════════════════════════════
    // ADJUSTMENTS
    // ═════════════════════════════════════════════════════════════════════

    /**
     * Reciprocity via listing category sets (v1 semantics) with a directional
     * skill fallback: strong two-way skill fit counts as mutual interest even
     * before both parties have posted complementary listings.
     *
     * @return array{0: string, 1: float} [matchType, mutualBonus]
     */
    private function reciprocity(array $searcher, array $owner, float $forward, float $backward): array
    {
        $searcherOffers = array_map('intval', (array) ($searcher['offer_category_ids'] ?? []));
        $searcherRequests = array_map('intval', (array) ($searcher['request_category_ids'] ?? []));
        $ownerOffers = array_map('intval', (array) ($owner['offer_category_ids'] ?? []));
        $ownerRequests = array_map('intval', (array) ($owner['request_category_ids'] ?? []));

        $theyNeedMe = !empty(array_intersect($searcherOffers, $ownerRequests)) || $forward >= 0.3;
        $iNeedThem = !empty(array_intersect($ownerOffers, $searcherRequests)) || $backward >= 0.3;

        $mutualBonus = (float) ($this->config['adjustments']['mutual_bonus'] ?? 8);

        if ($theyNeedMe && $iNeedThem) {
            return ['mutual', $mutualBonus];
        }
        if ($theyNeedMe || $iNeedThem) {
            return ['potential', 0.0];
        }
        return ['one_way', 0.0];
    }

    /** +max→0 over the first 72h, −3 beyond 60 days (replaces the 10% weight). */
    private function freshnessAdjustment(?string $createdAt): float
    {
        if (!$createdAt) {
            return 0.0;
        }
        $created = strtotime($createdAt);
        if ($created === false) {
            return 0.0;
        }

        $ageHours = (time() - $created) / 3600;
        $freshMax = (float) ($this->config['adjustments']['freshness_max'] ?? 4);

        if ($ageHours <= 72) {
            return round($freshMax * (1 - max(0.0, $ageHours) / 72), 2);
        }
        if ($ageHours > 60 * 24) {
            return -3.0;
        }
        return 0.0;
    }

    // ═════════════════════════════════════════════════════════════════════
    // HELPERS
    // ═════════════════════════════════════════════════════════════════════

    /** @return array{walking_km: float, local_km: float, city_km: float, regional_km: float, max_km: float} */
    private function proximityBands(): array
    {
        $prox = (array) ($this->config['proximity'] ?? []);
        return [
            'walking_km' => (float) ($prox['walking_km'] ?? 5),
            'local_km' => (float) ($prox['local_km'] ?? 15),
            'city_km' => (float) ($prox['city_km'] ?? 30),
            'regional_km' => (float) ($prox['regional_km'] ?? 50),
            'max_km' => (float) ($prox['max_km'] ?? 100),
        ];
    }

    /** @return array{relevance: float, feasibility: float, trust: float} normalised to sum 1 */
    private function pillarWeights(): array
    {
        $cfg = (array) ($this->config['pillars'] ?? []);
        $weights = [
            'relevance' => max(0.0, (float) ($cfg['relevance'] ?? 0.45)),
            'feasibility' => max(0.0, (float) ($cfg['feasibility'] ?? 0.35)),
            'trust' => max(0.0, (float) ($cfg['trust'] ?? 0.20)),
        ];
        $sum = array_sum($weights);
        if ($sum <= 0) {
            return ['relevance' => 0.45, 'feasibility' => 0.35, 'trust' => 0.20];
        }
        return array_map(fn ($w) => $w / $sum, $weights);
    }

    /** @return array<string, array<string, float>> per-pillar signal weights */
    private function signalWeights(): array
    {
        $cfg = (array) ($this->config['signals'] ?? []);
        $defaults = [
            'relevance' => ['category' => 0.30, 'skill' => 0.35, 'semantic' => 0.35],
            'feasibility' => ['proximity' => 0.45, 'availability' => 0.20, 'activity' => 0.35],
            'trust' => ['reviews' => 0.45, 'trust_tier' => 0.25, 'completion' => 0.30],
        ];

        foreach ($defaults as $pillar => $signals) {
            foreach ($signals as $key => $default) {
                if (isset($cfg[$pillar][$key]) && is_numeric($cfg[$pillar][$key])) {
                    $defaults[$pillar][$key] = max(0.0, (float) $cfg[$pillar][$key]);
                }
            }
        }

        return $defaults;
    }

    /** @param array<string, array{0: float, 1: float}> $entries value/weight pairs */
    private function weightedAverage(array $entries): float
    {
        $sum = 0.0;
        $weightSum = 0.0;
        foreach ($entries as [$value, $weight]) {
            $sum += $value * $weight;
            $weightSum += $weight;
        }
        return $weightSum > 0 ? $sum / $weightSum : 0.0;
    }

    private function clampPillar(float $value): float
    {
        return max(self::PILLAR_FLOOR, min(1.0, $value));
    }

    /** Accepts term=>weight maps or plain term lists; returns term=>weight. */
    private function normaliseWeighted(mixed $keywords): array
    {
        $out = [];
        foreach ((array) $keywords as $key => $value) {
            if (is_string($key)) {
                $out[$key] = is_numeric($value) ? max(0.1, (float) $value) : 1.0;
            } elseif (is_string($value) && $value !== '') {
                $out[$value] = 1.0;
            }
        }
        return $out;
    }

    /** @param array<string, float> $weighted */
    private function mergeWeighted(array $weighted, array $plainTerms): array
    {
        foreach ($plainTerms as $term) {
            if (is_string($term) && $term !== '' && !isset($weighted[$term])) {
                $weighted[$term] = 1.0;
            }
        }
        return $weighted;
    }

    /**
     * Jaccard on term sets, scaled by the mean proficiency weight of the
     * overlap (capped ×1.4) and a ×1.5 small-set compensation, clamped to 1.
     *
     * @param array<string, float> $a
     * @param array<string, float> $b
     */
    private function weightedJaccard(array $a, array $b): float
    {
        if (empty($a) || empty($b)) {
            return 0.0;
        }

        $intersect = array_intersect_key($a, $b);
        if (empty($intersect)) {
            return 0.0;
        }

        $union = count($a) + count($b) - count($intersect);
        $jaccard = $union > 0 ? count($intersect) / $union : 0.0;

        $weightSum = 0.0;
        foreach ($intersect as $term => $weightA) {
            $weightSum += max($weightA, $b[$term]);
        }
        $avgWeight = $weightSum / count($intersect);

        return min(1.0, $jaccard * min(1.4, $avgWeight) * 1.5);
    }

    /** Flatten availability JSON/arrays into a comparable set of string tokens. */
    private function normaliseAvailability(mixed $availability): array
    {
        if (is_string($availability) && $availability !== '') {
            $decoded = json_decode($availability, true);
            $availability = $decoded !== null ? $decoded : [$availability];
        }
        if (!is_array($availability)) {
            return [];
        }

        $tokens = [];
        array_walk_recursive($availability, function ($value, $key) use (&$tokens) {
            if (is_string($value) && $value !== '') {
                $tokens[] = strtolower(trim($value));
            } elseif ($value === true && is_string($key)) {
                $tokens[] = strtolower(trim($key));
            }
        });

        return array_values(array_unique(array_filter($tokens)));
    }
}
