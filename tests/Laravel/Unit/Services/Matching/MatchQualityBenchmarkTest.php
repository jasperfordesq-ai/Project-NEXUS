<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services\Matching;

use App\Services\Matching\KeywordExtractor;
use App\Services\Matching\MatchScorer;
use Tests\Laravel\TestCase;

/**
 * The measuring stick for matching quality WITHOUT an AI model: labelled
 * request/offer pairs, written the way members write them, in several
 * languages, filed in the categories members would realistically pick.
 *
 * Genuine pairs must be shown (score at or above the default minimum of 40);
 * pairs that only share a word by coincidence must not be. Every other signal
 * is held at an ordinary value (3 km apart, owner active this week, no
 * reviews yet) so the score difference comes from the text alone.
 *
 * Before 18 Nov 2026 most genuine pairs here shared no word at all and
 * scored on the category alone, accented words were cut in half
 * ("jardín" → "jard"), and "walk my dog" outscored "mow my lawn" against a
 * gardening offer. Add a pair whenever a real mismatch is reported.
 */
class MatchQualityBenchmarkTest extends TestCase
{
    private const MIN_SHOWN = 40.0;

    private const CATEGORIES = [
        1 => 'Home & Garden',
        2 => 'Children & Family',
        3 => 'Computers & Technology',
        4 => 'Transport',
        5 => 'Learning & Languages',
        6 => 'Work & Admin',
        7 => 'Music & Arts',
        8 => 'Health & Wellbeing',
        9 => 'Pets',
        10 => 'Odd Jobs & Repairs',
        11 => 'Social',
        12 => 'Food & Cooking',
        13 => 'Cars & Bikes',
    ];

    /** @return array<string, array{0: string, 1: int, 2: string, 3: int}> request, its category, offer, its category */
    public static function genuinePairs(): array
    {
        return [
            'lawn / garden help' => ['Need someone to mow my lawn', 1, 'Garden help: mowing, weeding and hedge trimming', 1],
            'babysitter / childcare' => ['Babysitter needed on Friday evenings', 2, 'Childcare - I can mind your kids', 2],
            'kids after school / babysitter (other category)' => ['Someone to look after my kids after school', 2, 'Experienced babysitter', 11],
            'slow laptop / computer repair (other category)' => ['My laptop is very slow', 3, 'Computer repair and IT support', 10],
            'hospital lifts / driving (other category)' => ['Lifts to hospital appointments', 4, 'Driving: I can bring you to the doctor', 8],
            'CV / resume writing' => ['Help with my CV', 6, 'Resume writing and job applications', 6],
            'French practice / lessons' => ['Conversation practice in French', 5, 'French lessons for beginners', 5],
            'shelves / flatpack (other category)' => ['Help putting up shelves', 1, 'Shelf and flat pack assembly', 10],
            'leaking tap / plumber (other category)' => ['Leaking tap in the kitchen', 1, 'Plumber: taps, sinks and toilets', 10],
            'Spanish: guitar classes (other category)' => ['Busco clases de guitarra', 7, 'Doy clases de guitarra española', 5],
            'Spanish: garden' => ['Necesito ayuda con el jardín', 1, 'Cuido jardines y corto el césped', 1],
            'German: lawn' => ['Hilfe beim Rasenmähen gesucht', 1, 'Gartenarbeit und Rasenmähen', 1],
            'French: garden' => ['Cherche aide pour le jardinage', 1, 'Je peux tondre votre pelouse', 1],
            'Italian: computer' => ['Aiuto con il computer portatile', 3, 'Riparazione computer e assistenza', 3],
            'Portuguese: lift to hospital (other category)' => ['Preciso de boleia para o hospital', 4, 'Posso conduzir ao médico', 8],
            'Dutch: painting (other category)' => ['Hulp bij het schilderen van mijn kamer', 1, 'Schilder en behanger', 10],
            'Polish: garden' => ['Pomoc w ogrodzie', 1, 'Koszenie trawy i ogrodnictwo', 1],
        ];
    }

    /** @return array<string, array{0: string, 1: int, 2: string, 3: int}> */
    public static function coincidentalPairs(): array
    {
        return [
            'dog walking / walking group' => ['Someone to walk my dog', 9, 'Walking group for older people', 11],
            'piano lessons / moving a piano' => ['Piano lessons for my daughter', 7, 'Help moving a piano or heavy furniture', 10],
            'cake baking / car repair' => ['Cake baking for a party', 12, 'Car repair and servicing', 13],
            'knitting / computer help' => ['Knitting circle', 7, 'Computer help for beginners', 3],
            'airport lift / lawn mowing' => ['Lift to the airport', 4, 'Gardening and lawn mowing', 1],
            'tax return / dog walking' => ['Help with my tax return', 6, 'Dog walking', 9],
        ];
    }

    /** @dataProvider genuinePairs */
    public function test_genuine_pair_is_shown(string $request, int $requestCategory, string $offer, int $offerCategory): void
    {
        $score = $this->score($request, $requestCategory, $offer, $offerCategory);

        $this->assertGreaterThanOrEqual(self::MIN_SHOWN, $score, sprintf(
            '"%s" should be offered "%s" (scored %.1f). Words: %s | %s',
            $request, $offer, $score,
            implode(',', KeywordExtractor::extract($request)), implode(',', KeywordExtractor::extract($offer))
        ));
    }

    /** @dataProvider coincidentalPairs */
    public function test_coincidental_pair_is_not_shown(string $request, int $requestCategory, string $offer, int $offerCategory): void
    {
        $score = $this->score($request, $requestCategory, $offer, $offerCategory);

        $this->assertLessThan(self::MIN_SHOWN, $score, sprintf(
            '"%s" should NOT be offered "%s" (scored %.1f). Words: %s | %s',
            $request, $offer, $score,
            implode(',', KeywordExtractor::extract($request)), implode(',', KeywordExtractor::extract($offer))
        ));
    }

    public function test_every_genuine_pair_outranks_every_coincidental_pair_in_the_same_category(): void
    {
        // The hardest case: a careless member files both in one category, so
        // the category cannot tell them apart and only the words can.
        $genuine = [];
        foreach (self::genuinePairs() as $label => [$request, , $offer]) {
            $genuine[$label] = $this->score($request, 1, $offer, 1);
        }
        $coincidental = [];
        foreach (self::coincidentalPairs() as $label => [$request, , $offer]) {
            $coincidental[$label] = $this->score($request, 1, $offer, 1);
        }

        $this->assertGreaterThan(
            max($coincidental),
            min($genuine),
            'Weakest genuine: ' . array_search(min($genuine), $genuine, true)
                . ' ' . min($genuine) . '; strongest coincidental: '
                . array_search(max($coincidental), $coincidental, true) . ' ' . max($coincidental)
        );
    }

    public function test_accented_words_survive_whole(): void
    {
        $this->assertContains('jardin', KeywordExtractor::extract('Necesito ayuda con el jardín'));
        $this->assertContains('rasenmahen', KeywordExtractor::extract('Hilfe beim Rasenmähen'));
        // Same result with or without the accent: the accent no longer splits the word.
        $this->assertSame(KeywordExtractor::extract('cesped'), KeywordExtractor::extract('césped'));
        $words = array_filter(KeywordExtractor::extract('césped'), fn ($k) => !KeywordExtractor::isConcept($k));
        $this->assertCount(1, $words);
    }

    public function test_filler_words_are_dropped_in_other_languages_too(): void
    {
        $words = KeywordExtractor::extract('Necesito ayuda con el jardín');
        foreach (['necesito', 'ayuda', 'con'] as $filler) {
            $this->assertNotContains($filler, $words);
        }
        $this->assertNotContains('hilfe', KeywordExtractor::extract('Hilfe beim Rasenmähen gesucht'));
    }

    public function test_short_terms_that_mean_something_are_kept(): void
    {
        $this->assertContains('cv', KeywordExtractor::extract('Help with my CV'));
    }

    public function test_word_forms_reach_the_same_stem(): void
    {
        $stem = fn (string $w) => KeywordExtractor::extract($w)[0] ?? null;

        $this->assertSame($stem('mow'), $stem('mowing'));
        $this->assertSame($stem('mow'), $stem('mower'));
        $this->assertSame($stem('shelf'), $stem('shelves'));
        $this->assertSame($stem('drive'), $stem('driving'));
        $this->assertSame($stem('babysit'), $stem('babysitter'));
        $this->assertSame($stem('jardín'), $stem('jardines'));
        $this->assertSame($stem('tree'), $stem('trees'));
    }

    public function test_different_words_for_the_same_help_share_a_concept(): void
    {
        $shares = function (string $a, string $b): bool {
            $concepts = fn (string $text) => array_filter(KeywordExtractor::extract($text), [KeywordExtractor::class, 'isConcept']);
            return array_intersect($concepts($a), $concepts($b)) !== [];
        };

        $this->assertTrue($shares('babysitter', 'childcare'));
        $this->assertTrue($shares('my laptop', 'computer repair'));
        $this->assertTrue($shares('lawn', 'garden'));
        $this->assertTrue($shares('garden', 'jardín'));
        $this->assertTrue($shares('garden', 'Garten'));
        $this->assertTrue($shares('lifts', 'driving'));
        $this->assertTrue($shares('flat pack', 'furniture assembly'));
        $this->assertFalse($shares('piano lessons', 'moving a piano'));
    }

    private function score(string $request, int $requestCategory, string $offer, int $offerCategory): float
    {
        $categories = [];
        foreach (self::CATEGORIES as $id => $name) {
            $categories[$id] = ['name' => $name, 'parent_id' => null];
        }
        $scorer = new MatchScorer([], $categories);

        $result = $scorer->score(
            ['give_keywords' => [], 'want_keywords' => [], 'offer_category_ids' => [], 'request_category_ids' => [$requestCategory], 'availability' => null],
            ['type' => 'request', 'category_id' => $requestCategory, 'keywords' => KeywordExtractor::extract($request)],
            [
                'type' => 'offer', 'category_id' => $offerCategory, 'category_name' => self::CATEGORIES[$offerCategory],
                'keywords' => KeywordExtractor::extract($offer), 'distance_km' => 3.0, 'service_type' => 'physical_only',
                'created_at' => date('Y-m-d H:i:s', time() - 10 * 86400),
            ],
            ['last_active_days' => 3, 'rating_count' => 0, 'trust_tier' => 1, 'completed_tx' => 2,
             'give_keywords' => [], 'want_keywords' => [], 'offer_category_ids' => [$offerCategory], 'request_category_ids' => []],
            null
        );

        return $result->score;
    }
}
