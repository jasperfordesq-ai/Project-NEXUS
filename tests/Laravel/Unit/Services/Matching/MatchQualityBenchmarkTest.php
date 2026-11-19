<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services\Matching;

use App\Services\Matching\KeywordExtractor;
use App\Services\Matching\MatchConcepts;
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
            // Added 19 Nov 2026 (second measuring round).
            'new phone / tech support' => ['Help setting up my new phone', 3, 'Tech support: smartphones, tablets and email', 3],
            'ironing' => ['Someone to iron shirts', 1, 'Ironing and laundry help', 1],
            'company for mother / befriending' => ['Company for my elderly mother', 11, 'Befriending visits and a chat', 11],
            'puncture / bicycle repairs' => ['Fix a puncture on my bike', 13, 'Bicycle repairs', 13],
            'hemming / sewing (other category)' => ['Hem two pairs of trousers', 10, 'Sewing and clothes alterations', 7],
            'dog minding / pet sitting' => ['Dog minding while I am in hospital', 9, 'Pet sitting', 9],
            'haircut / hairdresser' => ['Cut my hair at home', 8, 'Mobile hairdresser', 8],
            'Zoom / computer lessons (other category)' => ['Teach me to use Zoom', 3, 'Computer lessons for beginners', 5],
            'maths grinds / maths tutor' => ['Maths grinds for Leaving Cert', 5, 'Maths tutor', 5],
            'homework / maths tutor (other category)' => ['Homework help for my son', 2, 'Maths tutor', 5],
            'paint hallway / decorating (other category)' => ['Someone to paint my hallway', 1, 'Painting and decorating', 10],
            'attic / decluttering' => ['Help clearing out the attic', 1, 'Decluttering and tidying', 1],
            'gutters (other category)' => ['Gutters need clearing', 1, 'Gutter cleaning and odd jobs', 10],
            'moving a sofa / removals (other category)' => ['Need a hand moving a sofa', 10, 'Man with a van, removals', 4],
            'guitar teacher / guitar lessons' => ['Guitar teacher wanted', 7, 'Guitar lessons', 7],
            'thesis / proofreading' => ['Proofread my thesis', 6, 'Proofreading and editing', 6],
            'translation (other category)' => ['Translate a letter from Polish', 6, 'Polish to English translation', 5],
            'meal / dinners' => ['Cook a meal for my father once a week', 12, 'Home cooked dinners', 12],
            'tax return / bookkeeping' => ['Tax return help', 6, 'Bookkeeping and accounts', 6],
            'toddler / childminder' => ['Minding my toddler on Tuesday mornings', 2, 'Childminder with experience', 2],
            'learn to knit / knitting lessons' => ['Learn to knit', 7, 'Knitting lessons', 7],
            'email on the iPad / tablets and phones' => ['Sort out my email on the iPad', 3, 'Help with tablets and phones', 3],
            'grass cutting / lawn mowing' => ['Grass cutting', 1, 'Lawn mowing', 1],
            'light fitting / electrician (other category)' => ['Change a light fitting', 1, 'Electrician: sockets, lights and fuse boards', 10],
        ];
    }

    /**
     * Two listings a member filed in the SAME category that are plainly
     * different kinds of help. Until 19 Nov 2026 every one of these was shown
     * as a match: the shared category alone was worth 47, above the minimum,
     * and two listings that both said "lessons" scored 62.
     *
     * @return array<string, array{0: string, 1: int, 2: string, 3: int}>
     */
    public static function differentKindsOfHelp(): array
    {
        return [
            'leaking tap / garden help' => ['Leaking tap in the kitchen', 1, 'Garden help: mowing, weeding and hedge trimming', 1],
            'shelves / ironing' => ['Help putting up shelves', 1, 'Ironing and laundry help', 1],
            'babysitter / maths tutor' => ['Babysitter needed on Friday evenings', 2, 'Maths tutor for teenagers', 2],
            'CV / tax returns' => ['Help with my CV', 6, 'Tax returns and bookkeeping', 6],
            'French conversation / maths tutor' => ['Conversation practice in French', 5, 'Maths tutor', 5],
            'guitar teacher / knitting circle' => ['Guitar teacher wanted', 7, 'Knitting and crochet circle', 7],
            'guitar lessons / French lessons' => ['Guitar lessons wanted', 5, 'French lessons for beginners', 5],
            'Spanish lessons / driving lessons' => ['Spanish lessons', 5, 'Learn to drive: driving lessons', 5],
            'cooking classes / yoga classes' => ['Cooking classes', 8, 'Yoga classes', 8],
            'airport lift / removals' => ['Lift to the airport', 4, 'Man with a van, removals', 4],
            'haircut / yoga' => ['Cut my hair at home', 8, 'Yoga for beginners', 8],
            'window cleaning / decorating' => ['Window cleaning', 1, 'Painting and decorating', 1],
            'paint hallway / lawn mowing' => ['Someone to paint my hallway', 1, 'Lawn mowing', 1],
            'dog walking / walking group' => ['Someone to walk my dog', 11, 'Walking group for older people', 11],
            'swimming lessons for kids / babysitter' => ['Swimming lessons for my kids', 2, 'Babysitter', 2],
            'French conversation / Spanish lessons' => ['Conversation practice in French', 5, 'Spanish lessons', 5],
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

    /** @dataProvider differentKindsOfHelp */
    public function test_different_kinds_of_help_are_not_matched_by_category_alone(string $request, int $requestCategory, string $offer, int $offerCategory): void
    {
        // Hidden even at the most favourable: an established, well-reviewed
        // owner and a listing posted an hour ago.
        $score = $this->score($request, $requestCategory, $offer, $offerCategory, 'established', 1);

        $this->assertLessThan(self::MIN_SHOWN, $score, sprintf(
            '"%s" should NOT be offered "%s" (scored %.1f). Words: %s | %s',
            $request, $offer, $score,
            implode(',', KeywordExtractor::extract($request)), implode(',', KeywordExtractor::extract($offer))
        ));
    }

    /** @dataProvider coincidentalPairs */
    public function test_coincidental_pair_stays_hidden_for_an_established_owner(string $request, int $requestCategory, string $offer, int $offerCategory): void
    {
        $score = $this->score($request, $requestCategory, $offer, $offerCategory, 'established');

        $this->assertLessThan(self::MIN_SHOWN, $score, sprintf('"%s" / "%s" scored %.1f', $request, $offer, $score));
    }

    public function test_an_excellent_new_listing_can_reach_the_alert_threshold(): void
    {
        // Same category, same kind of help, 3 km away, owner active this
        // week, posted an hour ago, and the owner is a NEW member with no
        // reviews and no exchanges: most members of a real community. Until
        // 19 Nov 2026 this scored 79 at best, so the "strong match" alert
        // (80 and over) could not be sent for a new member's listing at all.
        $score = $this->score('Need someone to mow my lawn', 1, 'Lawn mowing and garden help', 1, 'newcomer', 1);

        $this->assertGreaterThanOrEqual(80.0, $score);
    }

    public function test_a_merely_related_listing_does_not_reach_the_alert_threshold(): void
    {
        // Same category and nothing else known in common: never an alert,
        // however well established the owner and however new the listing.
        $score = $this->score('Help with the garden shed', 1, 'Curtain fitting', 1, 'established', 1);

        $this->assertLessThan(80.0, $score);
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
        $this->assertTrue($shares('my new phone', 'computer help'));
        $this->assertTrue($shares('gutters need clearing', 'cleaning'));
        // "Odd jobs" is not a request for help finding work.
        $this->assertFalse($shares('odd jobs', 'help with my CV'));
    }

    public function test_how_help_is_given_and_who_it_is_for_are_not_kinds_of_help(): void
    {
        $generic = fn (string $text) => array_values(array_filter(
            KeywordExtractor::extract($text),
            fn ($k) => KeywordExtractor::isConcept($k) && MatchConcepts::isGeneric($k)
        ));
        $specific = fn (string $text) => array_values(array_filter(
            KeywordExtractor::extract($text),
            fn ($k) => KeywordExtractor::isConcept($k) && !MatchConcepts::isGeneric($k)
        ));

        // "Lessons" says how, "for my kids" says who for: neither says what.
        $this->assertSame(['~teaching'], $generic('lessons'));
        $this->assertSame([], $specific('lessons'));
        $this->assertSame([], $specific('for my kids'));
        // A babysitter is childcare, and is for children.
        $this->assertSame(['~childcare'], $specific('babysitter'));
        // School subjects are a kind of help in their own right.
        $this->assertSame(['~schoolwork'], $specific('maths homework'));
        // "French" names the language; that it is a language is the general part.
        $this->assertSame(['~lang_french'], $specific('French conversation'));
        $this->assertSame(['~languages'], $generic('French conversation'));
        $this->assertSame([], $specific('language exchange'));
    }

    public function test_related_trades_are_not_treated_as_different_kinds(): void
    {
        $this->assertTrue(MatchConcepts::related('~plumbing', '~diy'));
        $this->assertTrue(MatchConcepts::related('~diy', '~plumbing'));
        $this->assertFalse(MatchConcepts::related('~lang_french', '~lang_spanish'));
        $this->assertFalse(MatchConcepts::related('~plumbing', '~gardening'));
    }

    /**
     * @param string $owner 'newcomer' (no reviews, no exchanges: most real members)
     *                      or 'established' (ten five-star reviews, twenty exchanges)
     * @param int $postedHoursAgo age of the offer (240 = ten days, past the "new" bonus)
     */
    private function score(
        string $request,
        int $requestCategory,
        string $offer,
        int $offerCategory,
        string $owner = 'newcomer',
        int $postedHoursAgo = 240
    ): float {
        $categories = [];
        foreach (self::CATEGORIES as $id => $name) {
            $categories[$id] = ['name' => $name, 'parent_id' => null];
        }
        $scorer = new MatchScorer([], $categories);

        // trust_tier 0 is what every member carries unless their community
        // uses trust levels, which no live community does.
        $ownerProfile = $owner === 'established'
            ? ['last_active_days' => 1, 'rating_avg' => 5.0, 'rating_count' => 10, 'trust_tier' => 0, 'completed_tx' => 20]
            : ['last_active_days' => 3, 'rating_count' => 0, 'trust_tier' => 0, 'completed_tx' => 0];

        $result = $scorer->score(
            ['give_keywords' => [], 'want_keywords' => [], 'offer_category_ids' => [], 'request_category_ids' => [$requestCategory], 'availability' => null],
            ['type' => 'request', 'category_id' => $requestCategory, 'title' => $request, 'keywords' => KeywordExtractor::extract($request)],
            [
                'type' => 'offer', 'category_id' => $offerCategory, 'category_name' => self::CATEGORIES[$offerCategory],
                'title' => $offer,
                'keywords' => KeywordExtractor::extract($offer), 'distance_km' => 3.0, 'service_type' => 'physical_only',
                'created_at' => date('Y-m-d H:i:s', time() - $postedHoursAgo * 3600),
            ],
            $ownerProfile + ['give_keywords' => [], 'want_keywords' => [], 'offer_category_ids' => [$offerCategory], 'request_category_ids' => []],
            null
        );

        return $result->score;
    }
}
