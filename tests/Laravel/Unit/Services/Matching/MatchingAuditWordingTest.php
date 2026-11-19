<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services\Matching;

use App\Services\Matching\KeywordExtractor;
use App\Services\Matching\MatchScorer;
use PHPUnit\Framework\TestCase;

/**
 * Word and direction faults found by the matching audit of 19 Nov 2026.
 * Pure: no database.
 */
class MatchingAuditWordingTest extends TestCase
{
    /** @return string[] */
    private function kinds(string $text): array
    {
        return array_values(array_filter(
            KeywordExtractor::extract($text),
            fn (string $k) => KeywordExtractor::isConcept($k)
        ));
    }

    public function test_a_van_is_recognised_as_help_with_moving(): void
    {
        // "van" is also the Dutch for "of", and was thrown away as a filler
        // word before the moving list could see it.
        $this->assertContains('~moving', $this->kinds('Man with a van'));
        $this->assertContains('~moving', $this->kinds('I have my own van'));
        $this->assertContains('~moving', $this->kinds('Van hire and help'));
    }

    public function test_dutch_van_is_still_a_filler_word(): void
    {
        $this->assertNotContains('~moving', $this->kinds('Hulp van iemand met de tuin'));
        $this->assertNotContains('van', KeywordExtractor::extract('Hulp van iemand met de tuin'));
    }

    public function test_tape_is_not_a_tap(): void
    {
        $this->assertNotContains('~plumbing', $this->kinds('Tape measure to borrow'));
        $this->assertNotContains('~plumbing', $this->kinds('Old video tapes'));
        $this->assertContains('~plumbing', $this->kinds('Leaking tap'));
    }

    public function test_weight_lifting_is_not_a_lift_in_a_car(): void
    {
        $this->assertNotContains('~transport', $this->kinds('Weight lifting buddy'));
        $this->assertContains('~fitness', $this->kinds('Weight lifting buddy'));
        $this->assertContains('~transport', $this->kinds('Lifts to town'));
    }

    public function test_a_portrait_is_art(): void
    {
        $this->assertContains('~arts', $this->kinds('Portrait painting for my mother'));
        $this->assertContains('~arts', $this->kinds('Oil painting for beginners'));
    }

    public function test_bridge_repair_is_not_a_card_game(): void
    {
        $this->assertNotContains('~games', $this->kinds('Bridge repair'));
        $this->assertContains('~games', $this->kinds('Bridge club on Tuesdays'));
        $this->assertContains('~games', $this->kinds('Bridge partner wanted'));
    }

    public function test_us_and_go_are_not_words_a_match_can_rest_on(): void
    {
        $words = KeywordExtractor::extract('Come and join us, we go walking');
        $this->assertNotContains('us', $words);
        $this->assertNotContains('go', $words);
    }

    public function test_care_and_car_are_different_words(): void
    {
        $this->assertNotContains('car', KeywordExtractor::extract('Elderly care'));
        $this->assertContains('car', KeywordExtractor::extract('Car wash'));
    }

    // ---------------------------------------------------------------------

    /** @return array<string, float> */
    private function weighted(string $text): array
    {
        return array_fill_keys(KeywordExtractor::extract($text), 1.0);
    }

    private function listing(string $type, string $title, ?int $categoryId): array
    {
        return [
            'type' => $type, 'title' => $title, 'category_id' => $categoryId, 'category_name' => 'A category',
            'keywords' => KeywordExtractor::extract($title), 'service_type' => 'physical_only',
            'distance_km' => 2.0, 'created_at' => date('Y-m-d H:i:s', time() - 10 * 86400),
        ];
    }

    private function member(string $gives, string $wants): array
    {
        return [
            'give_keywords' => $this->weighted($gives), 'want_keywords' => $this->weighted($wants),
            'offer_category_ids' => [], 'request_category_ids' => [], 'offers' => [], 'requests' => [],
            'availability' => null, 'last_active_days' => 1.0, 'rating_avg' => null, 'rating_count' => 0,
            'trust_tier' => 0, 'completed_tx' => 0,
        ];
    }

    public function test_a_listing_is_not_lifted_by_skills_that_point_the_other_way(): void
    {
        $scorer = new MatchScorer([], [2 => ['name' => 'Money', 'parent_id' => null], 3 => ['name' => 'Learning', 'parent_id' => null]]);
        $myRequest = $this->listing('request', 'Help with my tax return', 2);
        $theirOffer = $this->listing('offer', 'Local history talks', 3);

        $plain = $scorer->score($this->member('', ''), $myRequest, $theirOffer, $this->member('', ''))->toLegacyArray();
        // I can garden; they want a gardener. True of the two members, and
        // nothing to do with whether their history talk answers my tax return.
        $withSkills = $scorer->score($this->member('Gardening', ''), $myRequest, $theirOffer, $this->member('', 'Gardening'))->toLegacyArray();

        $this->assertLessThan(40.0, $withSkills['score'], 'An unrelated listing was shown as a match for my request');
        $this->assertLessThanOrEqual($plain['score'], $withSkills['score']);
        $this->assertNotContains('Skills match your expertise', $withSkills['reasons']);
    }

    public function test_skills_that_fit_the_listing_being_scored_still_count(): void
    {
        $scorer = new MatchScorer([], []);
        $myOffer = $this->listing('offer', 'Odd jobs', null);
        $theirRequest = $this->listing('request', 'Someone to sort my garden', null);

        $without = $scorer->score($this->member('', ''), $myOffer, $theirRequest, $this->member('', ''))->toLegacyArray();
        $with = $scorer->score($this->member('Gardening', ''), $myOffer, $theirRequest, $this->member('', ''))->toLegacyArray();

        $this->assertGreaterThan($without['score'], $with['score']);
    }
}
