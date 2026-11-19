<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services\Matching;

use Tests\Laravel\TestCase;
use App\Services\Matching\MatchScorer;
use App\Services\Matching\MatchScoreResult;

/**
 * Pure unit tests for the three-pillar scorer — no DB, no facades, no mocks.
 */
class MatchScorerTest extends TestCase
{
    private function scorer(array $configOverrides = [], array $categories = []): MatchScorer
    {
        $config = array_replace_recursive([
            'proximity' => ['walking_km' => 5, 'local_km' => 15, 'city_km' => 30, 'regional_km' => 50, 'max_km' => 100],
            'pillars' => ['relevance' => 0.45, 'feasibility' => 0.35, 'trust' => 0.20],
            'adjustments' => ['mutual_bonus' => 8, 'freshness_max' => 4],
        ], $configOverrides);

        return new MatchScorer($config, $categories);
    }

    /** A strong, close, trusted baseline pair used by most cases. */
    private function baselinePair(): array
    {
        return [
            'searcher' => [
                'give_keywords' => ['garden' => 1.2, 'prun' => 1.0],
                'want_keywords' => ['plumb' => 1.0],
                'offer_category_ids' => [3],
                'request_category_ids' => [9],
                'availability' => ['weekends'],
            ],
            'searcherListing' => [
                'type' => 'offer', 'category_id' => 3,
                'keywords' => ['garden', 'hedg', 'lawn'],
            ],
            'candidate' => [
                'type' => 'request', 'category_id' => 3, 'category_name' => 'Gardening',
                'keywords' => ['garden', 'lawn', 'mow'],
                'service_type' => 'physical_only', 'distance_km' => 2.0,
                'availability' => ['weekends', 'weekday_evenings'],
                'created_at' => date('Y-m-d H:i:s', time() - 3600),
            ],
            'owner' => [
                'give_keywords' => ['plumb' => 1.4],
                'want_keywords' => ['garden' => 1.0, 'lawn' => 1.0],
                'offer_category_ids' => [9],
                'request_category_ids' => [3],
                'last_active_days' => 2.0,
                'rating_avg' => 4.8, 'rating_count' => 12,
                'trust_tier' => 3, 'completed_tx' => 25,
            ],
        ];
    }

    private function score(array $pair, array $configOverrides = [], array $categories = [], ?float $semantic = null): MatchScoreResult
    {
        return $this->scorer($configOverrides, $categories)->score(
            $pair['searcher'], $pair['searcherListing'], $pair['candidate'], $pair['owner'], $semantic
        );
    }

    // ── Geometric-mean suppression (the core architectural property) ──

    public function test_strong_close_trusted_pair_scores_high(): void
    {
        $result = $this->score($this->baselinePair());

        $this->assertGreaterThan(75, $result->score);
        $this->assertSame('mutual', $result->matchType);
        $this->assertContains('Mutual exchange possible!', $result->reasons);
    }

    public function test_terrible_feasibility_cannot_be_averaged_away_by_perfect_relevance(): void
    {
        $pair = $this->baselinePair();
        // Same perfect relevance/trust, but 400 km away.
        $pair['candidate']['distance_km'] = 400.0;

        $result = $this->score($pair);
        $near = $this->score($this->baselinePair());

        // Under the v1 weighted SUM this pair lost only ~24 points (25% weight);
        // the geometric mean must drag it far below the near-identical pair.
        $this->assertLessThan($near->score - 25, $result->score);
        $this->assertLessThan(55, $result->score);
    }

    public function test_zero_relevance_suppresses_score_even_when_close_and_trusted(): void
    {
        $pair = $this->baselinePair();
        // Nothing in common: different categories, disjoint keywords.
        $pair['searcherListing']['category_id'] = 3;
        $pair['searcherListing']['keywords'] = ['garden'];
        $pair['candidate']['category_id'] = 42;
        $pair['candidate']['keywords'] = ['accord', 'piano'];
        $pair['searcher']['give_keywords'] = ['garden' => 1.0];
        $pair['searcher']['want_keywords'] = [];
        $pair['searcher']['offer_category_ids'] = [3];
        $pair['searcher']['request_category_ids'] = [];
        $pair['owner']['give_keywords'] = ['piano' => 1.0];
        $pair['owner']['want_keywords'] = ['accord' => 1.0];
        $pair['owner']['offer_category_ids'] = [42];
        $pair['owner']['request_category_ids'] = [42];

        $result = $this->score($pair);

        $this->assertLessThan(40, $result->score, 'irrelevant nearby candidates must stay under the visibility floor');
    }

    // ── Reciprocal (two-sided) skill signal ──

    public function test_one_sided_skill_fit_scores_lower_than_balanced_fit(): void
    {
        $pair = $this->baselinePair();

        // Balanced: forward and backward both match.
        $balanced = $this->score($pair)->signals['relevance']['skill'];

        // One-sided: owner wants what searcher gives, but searcher wants nothing the owner gives.
        $pair['searcher']['want_keywords'] = ['weld' => 1.0];
        $pair['owner']['give_keywords'] = ['piano' => 1.0];
        $oneSided = $this->score($pair)->signals['relevance']['skill'];

        $this->assertGreaterThan($oneSided, $balanced);
        $this->assertGreaterThan(0.0, $oneSided, 'one-sided fit still counts, discounted');
    }

    public function test_mutual_match_type_requires_both_directions(): void
    {
        $pair = $this->baselinePair();
        // Remove the searcher's request + owner's offer → only one direction left.
        $pair['searcher']['request_category_ids'] = [];
        $pair['searcher']['want_keywords'] = [];
        $pair['owner']['offer_category_ids'] = [];
        $pair['owner']['give_keywords'] = [];

        $result = $this->score($pair);

        $this->assertSame('potential', $result->matchType);
        $this->assertArrayNotHasKey('mutual', $result->adjustments);
    }

    public function test_a_shared_category_alone_is_not_a_two_way_match(): void
    {
        // Both members have an offer and a request in category 3, and the
        // four listings have nothing to do with one another. This used to be
        // a "mutual" match, with its bonus and its alert.
        $extract = fn (string $text) => \App\Services\Matching\KeywordExtractor::extract($text);
        $result = $this->scorer()->score(
            [
                'give_keywords' => [], 'want_keywords' => [],
                'offer_category_ids' => [3], 'request_category_ids' => [3], 'availability' => null,
                'offers' => [['title' => 'Ironing', 'keywords' => $extract('Ironing')]],
                'requests' => [['title' => 'Help with the garden shed', 'keywords' => $extract('Help with the garden shed')]],
            ],
            ['type' => 'request', 'category_id' => 3, 'title' => 'Help with the garden shed', 'keywords' => $extract('Help with the garden shed')],
            ['type' => 'offer', 'category_id' => 3, 'title' => 'Hedge trimming', 'keywords' => $extract('Hedge trimming'),
             'service_type' => 'physical_only', 'distance_km' => 2.0, 'created_at' => null],
            [
                'give_keywords' => [], 'want_keywords' => [],
                'offer_category_ids' => [3], 'request_category_ids' => [3],
                'offers' => [['title' => 'Hedge trimming', 'keywords' => $extract('Hedge trimming')]],
                'requests' => [['title' => 'Leaking tap', 'keywords' => $extract('Leaking tap')]],
                'last_active_days' => 2.0, 'rating_count' => 0, 'trust_tier' => 0, 'completed_tx' => 0,
            ]
        );

        $this->assertNotSame('mutual', $result->matchType);
        $this->assertArrayNotHasKey('mutual', $result->adjustments);
        $this->assertNotContains('Mutual exchange possible!', $result->reasons);
        $this->assertNull($result->exchange);
    }

    public function test_two_members_whose_listings_answer_each_other_are_a_two_way_match(): void
    {
        // I ask for garden help and offer French; they offer garden help and
        // ask for French, filed in a different category from mine.
        $extract = fn (string $text) => \App\Services\Matching\KeywordExtractor::extract($text);
        $result = $this->scorer()->score(
            [
                'give_keywords' => [], 'want_keywords' => [],
                'offer_category_ids' => [5], 'request_category_ids' => [3], 'availability' => null,
                'offers' => [['title' => 'French conversation', 'keywords' => $extract('French conversation')]],
                'requests' => [['title' => 'Need someone to mow my lawn', 'keywords' => $extract('Need someone to mow my lawn')]],
            ],
            ['type' => 'request', 'category_id' => 3, 'title' => 'Need someone to mow my lawn', 'keywords' => $extract('Need someone to mow my lawn')],
            ['type' => 'offer', 'category_id' => 3, 'title' => 'Garden help', 'keywords' => $extract('Garden help: mowing and weeding'),
             'service_type' => 'physical_only', 'distance_km' => 2.0, 'created_at' => null],
            [
                'give_keywords' => [], 'want_keywords' => [],
                'offer_category_ids' => [3], 'request_category_ids' => [8],
                'offers' => [['title' => 'Garden help', 'keywords' => $extract('Garden help: mowing and weeding')]],
                'requests' => [['title' => 'French lessons wanted', 'keywords' => $extract('French lessons wanted')]],
                'last_active_days' => 2.0, 'rating_count' => 0, 'trust_tier' => 0, 'completed_tx' => 0,
            ]
        );

        $this->assertSame('mutual', $result->matchType);
        $this->assertContains('Mutual exchange possible!', $result->reasons);
        $this->assertSame(
            ['you_offer' => 'French conversation', 'they_offer' => 'Garden help'],
            $result->exchange,
            'the alert names the two listings that answer each other'
        );
    }

    public function test_different_kinds_of_help_cap_relevance_and_are_flagged(): void
    {
        $extract = fn (string $text) => \App\Services\Matching\KeywordExtractor::extract($text);
        $pair = $this->baselinePair();
        $pair['searcher']['give_keywords'] = [];
        $pair['searcher']['want_keywords'] = [];
        $pair['owner']['give_keywords'] = [];
        $pair['owner']['want_keywords'] = [];
        $pair['searcherListing'] = ['type' => 'request', 'category_id' => 3, 'keywords' => $extract('Guitar lessons wanted')];
        $pair['candidate']['type'] = 'offer';
        $pair['candidate']['keywords'] = $extract('French lessons for beginners');

        $result = $this->score($pair);

        $this->assertLessThanOrEqual(0.10, $result->pillars['relevance']);
        $this->assertLessThan(40, $result->score);
        $this->assertSame([], array_values(array_filter(
            $result->reasons,
            fn ($r) => str_starts_with($r, 'Same category') || str_starts_with($r, 'Very similar')
        )), 'no reason is given for introducing them');
        $this->assertSame(['different_kinds_of_help'], $result->toBreakdownArray()['flags']);

        // A strong AI reading of the two listings overrules the word lists.
        $withAi = $this->score($pair, semantic: 0.85);
        $this->assertGreaterThan(0.10, $withAi->pillars['relevance']);
    }

    // ── Unknown-signal defaults (deflated) ──

    public function test_unknown_everything_scores_below_visibility_threshold(): void
    {
        $result = $this->scorer()->score(
            ['give_keywords' => [], 'want_keywords' => [], 'offer_category_ids' => [], 'request_category_ids' => [], 'availability' => null],
            ['type' => 'offer', 'category_id' => null, 'keywords' => []],
            ['type' => 'request', 'category_id' => null, 'keywords' => [], 'service_type' => 'physical_only', 'distance_km' => null, 'availability' => null, 'created_at' => null],
            ['give_keywords' => [], 'want_keywords' => [], 'offer_category_ids' => [], 'request_category_ids' => [], 'last_active_days' => null, 'rating_avg' => null, 'rating_count' => 0, 'trust_tier' => null, 'completed_tx' => 0]
        );

        // v1 scored ~55 on unknowns alone (defaults 0.4/0.5 + proximity floor).
        $this->assertLessThan(40, $result->score);
    }

    public function test_unknown_availability_is_left_out_not_counted_against_the_match(): void
    {
        // No page lets a member state when they are free, so this is every
        // real match. Counted as 0.60 it held feasibility at 0.92 at best.
        $pair = $this->baselinePair();
        $pair['candidate']['availability'] = null;

        $result = $this->score($pair);

        $this->assertNull($result->signals['feasibility']['availability']);
        $this->assertEqualsWithDelta(1.0, $result->pillars['feasibility'], 0.001, 'next door, owner active this week');
        $this->assertNull($result->toBreakdownArray()['signals']['feasibility']['availability'], 'stored as unknown, not as 0');
    }

    public function test_no_trust_level_is_left_out_not_counted_as_the_lowest(): void
    {
        // Level 0 is what every member has where trust levels are not used.
        $pair = $this->baselinePair();
        $pair['owner']['trust_tier'] = 0;
        $none = $this->score($pair);
        $pair['owner']['trust_tier'] = null;
        $unknown = $this->score($pair);

        $this->assertNull($none->signals['trust']['trust_tier']);
        $this->assertSame($unknown->score, $none->score);

        // Where levels are used, a higher one never scores below a lower one,
        // and holding the first level never scores below holding none.
        $previous = $none->score;
        foreach ([1, 2, 3, 4] as $level) {
            $pair['owner']['trust_tier'] = $level;
            $score = $this->score($pair)->score;
            $this->assertGreaterThanOrEqual($previous, $score, "level {$level}");
            $previous = $score;
        }
    }

    public function test_conflicting_stated_availability_is_penalised(): void
    {
        $pair = $this->baselinePair();
        $pair['searcher']['availability'] = ['weekday_mornings'];
        $pair['candidate']['availability'] = ['weekends'];

        $result = $this->score($pair);

        $this->assertEqualsWithDelta(0.30, $result->signals['feasibility']['availability'], 0.001);
    }

    // ── Service-type awareness ──

    public function test_remote_only_candidate_is_distance_exempt(): void
    {
        $pair = $this->baselinePair();
        $pair['candidate']['service_type'] = 'remote_only';
        $pair['candidate']['distance_km'] = null;

        $result = $this->score($pair);

        $this->assertEqualsWithDelta(0.9, $result->signals['feasibility']['proximity'], 0.001);
        $this->assertNull($result->distanceKm);
        $this->assertContains('Can be done remotely', $result->reasons);
    }

    public function test_physical_candidate_with_unknown_distance_is_heavily_penalised(): void
    {
        $pair = $this->baselinePair();
        $pair['candidate']['distance_km'] = null;

        $result = $this->score($pair);

        $this->assertEqualsWithDelta(0.05, $result->signals['feasibility']['proximity'], 0.001);
    }

    // ── Trust signals ──

    public function test_few_reviews_pull_toward_neutral_prior(): void
    {
        $pair = $this->baselinePair();

        // One 5-star review must NOT read as a perfect 1.0 trust signal.
        $pair['owner']['rating_avg'] = 5.0;
        $pair['owner']['rating_count'] = 1;
        $oneReview = $this->score($pair)->signals['trust']['reviews'];

        $pair['owner']['rating_count'] = 20;
        $manyReviews = $this->score($pair)->signals['trust']['reviews'];

        $this->assertLessThan($manyReviews, $oneReview);
        $this->assertLessThan(0.85, $oneReview);
        $this->assertGreaterThan(0.95, $manyReviews);
    }

    public function test_dormant_owner_drags_feasibility(): void
    {
        $pair = $this->baselinePair();
        $pair['owner']['last_active_days'] = 85.0;

        $active = $this->score($this->baselinePair());
        $dormant = $this->score($pair);

        $this->assertLessThan($active->score, $dormant->score);
        $this->assertEqualsWithDelta(0.2, $dormant->signals['feasibility']['activity'], 0.001);
    }

    // ── Clamps, bounds, config ──

    public function test_score_is_always_within_0_100(): void
    {
        $pair = $this->baselinePair();
        $pair['candidate']['created_at'] = date('Y-m-d H:i:s'); // max freshness

        $result = $this->score($pair);

        $this->assertGreaterThanOrEqual(0.0, $result->score);
        $this->assertLessThanOrEqual(100.0, $result->score);
    }

    public function test_semantic_cosine_is_mapped_onto_unit_range(): void
    {
        $pair = $this->baselinePair();
        // Texts that share nothing, so only the AI figure speaks.
        $pair['searcherListing']['keywords'] = ['telescop', 'astronom'];
        $pair['candidate']['keywords'] = ['plumb', 'tap'];

        $low = $this->score($pair, semantic: 0.15)->signals['relevance']['semantic'];
        $high = $this->score($pair, semantic: 0.90)->signals['relevance']['semantic'];
        $out = $this->score($pair, semantic: 0.05)->signals['relevance']['semantic'];

        $this->assertEqualsWithDelta(0.0, $low, 0.001);
        $this->assertEqualsWithDelta(1.0, $high, 0.001);
        $this->assertEqualsWithDelta(0.0, $out, 0.001);
    }

    public function test_a_low_ai_figure_never_erases_what_the_wording_shows(): void
    {
        // Both listings are about childcare; the AI figure passed in is the
        // two MEMBERS' profile similarity (no figure for the new listing yet).
        $pair = $this->baselinePair();
        $pair['searcherListing']['keywords'] = \App\Services\Matching\KeywordExtractor::extract('Babysitter needed on Friday evenings');
        $pair['candidate']['keywords'] = \App\Services\Matching\KeywordExtractor::extract('Childcare: I can mind your kids');

        $withoutAi = $this->score($pair)->signals['relevance']['semantic'];
        $withLowAi = $this->score($pair, semantic: 0.10)->signals['relevance']['semantic'];

        $this->assertGreaterThanOrEqual(0.6, $withoutAi);
        $this->assertEqualsWithDelta($withoutAi, $withLowAi, 0.001);
    }

    public function test_a_small_second_direction_never_lowers_the_skill_signal(): void
    {
        $pair = $this->baselinePair();
        $pair['searcher']['give_keywords'] = ['garden' => 1.0, 'mow' => 1.0];
        $pair['owner']['want_keywords'] = ['garden' => 1.0, 'mow' => 1.0];
        $pair['searcher']['want_keywords'] = [];
        $pair['owner']['give_keywords'] = [];
        $oneWay = $this->score($pair)->signals['relevance']['skill'];

        // The owner also offers one thing among many that the searcher wants.
        $pair['searcher']['want_keywords'] = ['knit' => 1.0, 'bake' => 1.0, 'tax' => 1.0, 'ital' => 1.0];
        $pair['owner']['give_keywords'] = ['knit' => 1.0, 'cook' => 1.0, 'iron' => 1.0, 'paint' => 1.0, 'read' => 1.0];
        $twoWay = $this->score($pair)->signals['relevance']['skill'];

        $this->assertGreaterThanOrEqual($oneWay, $twoWay);
    }

    public function test_a_member_with_no_exchanges_yet_is_treated_as_unknown_not_as_poor(): void
    {
        $pair = $this->baselinePair();
        $pair['owner']['completed_tx'] = 0;
        $newcomer = $this->score($pair);
        $pair['owner']['completed_tx'] = 1;
        $oneExchange = $this->score($pair);

        $this->assertEqualsWithDelta(0.25, $newcomer->signals['trust']['completion'], 0.001);
        $this->assertGreaterThanOrEqual($newcomer->score, $oneExchange->score, 'Experience still counts');
    }

    public function test_unrelated_profile_skills_do_not_lower_a_listing_pair(): void
    {
        $pair = $this->baselinePair();
        $plain = $this->score($pair)->score;

        $pair['searcher']['give_keywords'] = array_fill_keys(['cook', 'iron', 'knit', 'bake', 'shop', 'read', 'paint', 'sew'], 1.0);
        $pair['owner']['want_keywords'] = array_fill_keys(['tax', 'ital', 'bike', 'lift', 'drive'], 1.0);
        $rich = $this->score($pair)->score;

        $this->assertGreaterThanOrEqual($plain, $rich, 'Filling in a profile must not cost a member matches');
    }

    public function test_pillar_weights_from_config_are_normalised(): void
    {
        $pair = $this->baselinePair();
        $pair['candidate']['distance_km'] = 400.0;

        // Feasibility-heavy config punishes the distant pair harder.
        $default = $this->score($pair)->score;
        $feasibilityHeavy = $this->score($pair, [
            'pillars' => ['relevance' => 0.2, 'feasibility' => 0.7, 'trust' => 0.1],
        ])->score;

        $this->assertLessThan($default, $feasibilityHeavy);
    }

    public function test_sibling_categories_score_related(): void
    {
        $categories = [
            3 => ['name' => 'Gardening', 'parent_id' => 1],
            4 => ['name' => 'Landscaping', 'parent_id' => 1],
        ];
        $pair = $this->baselinePair();
        $pair['candidate']['category_id'] = 4;

        $result = $this->score($pair, [], $categories);

        $this->assertEqualsWithDelta(0.7, $result->signals['relevance']['category'], 0.001);
    }

    public function test_breakdown_array_shape_for_persistence(): void
    {
        $breakdown = $this->score($this->baselinePair())->toBreakdownArray();

        $this->assertArrayHasKey('pillars', $breakdown);
        $this->assertArrayHasKey('signals', $breakdown);
        $this->assertArrayHasKey('adjustments', $breakdown);
        $this->assertEqualsCanonicalizing(['relevance', 'feasibility', 'trust'], array_keys($breakdown['pillars']));
        $this->assertEqualsCanonicalizing(['category', 'skill', 'semantic'], array_keys($breakdown['signals']['relevance']));
    }
}
