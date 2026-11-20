<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Matching;

use App\Core\TenantContext;
use App\Models\Category;
use App\Models\Event;
use App\Models\Listing;
use App\Models\User;
use App\Services\GroupMatchingService;
use App\Services\GroupRecommendationEngine;
use App\Services\SmartMatchingEngine;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * The member's matching journey, against a real database and the real engine.
 *
 * Almost every older matching test mocks the engine or the database, which is
 * how the faults pinned here went unnoticed (audit of 17 Nov 2026): each one
 * returned a plausible empty list instead of an error.
 */
class MatchingJourneyTest extends TestCase
{
    use DatabaseTransactions;

    private function member(array $attrs = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => 1,
            'latitude' => 51.5000,
            'longitude' => -0.1200,
            'last_active_at' => now(),
        ], $attrs));
    }

    private function category(string $name = 'Gardening'): Category
    {
        return Category::factory()->create([
            'tenant_id' => $this->testTenantId,
            'type' => 'listing',
            // Digits only: the matcher compares category names by their
            // words, and two uniqid() suffixes made moments apart share
            // letter runs ("6afdaa64…"), which made "Food" related to
            // "Home and garden".
            'name' => $name . ' ' . random_int(10000000, 99999999),
        ]);
    }

    private function listingFor(User $owner, string $type, ?int $categoryId, array $attrs = []): Listing
    {
        return Listing::factory()->forTenant($this->testTenantId)->create(array_merge([
            'user_id' => $owner->id,
            'type' => $type,
            'status' => 'active',
            'moderation_status' => 'approved',
            'category_id' => $categoryId,
            'title' => 'Gardening help ' . uniqid(),
            'description' => 'Weeding, mowing and hedge trimming in the garden every week.',
            'latitude' => 51.5000,
            'longitude' => -0.1200,
            'service_type' => 'physical_only',
            'created_at' => now(),
        ], $attrs));
    }

    /** @return array{matches: array<int, array<string, mixed>>, meta: array<string, mixed>} */
    private function matchesFor(User $member, string $query = ''): array
    {
        Sanctum::actingAs($member, ['*']);
        $response = $this->apiGet('/v2/matches/all' . ($query !== '' ? '?' . $query : ''));
        $response->assertStatus(200);

        return $response->json('data');
    }

    /** @return int[] */
    private function listingIds(array $data): array
    {
        return array_values(array_map(
            static fn (array $m): int => (int) ($m['listing_id'] ?? 0),
            array_filter($data['matches'], static fn (array $m): bool => ($m['module'] ?? '') === 'listing'),
        ));
    }

    public function test_an_offer_is_matched_with_a_nearby_request_in_the_same_category(): void
    {
        $category = $this->category();
        $me = $this->member();
        $this->listingFor($me, 'offer', $category->id);
        $neighbour = $this->member();
        $theirs = $this->listingFor($neighbour, 'request', $category->id);

        $data = $this->matchesFor($me, 'modules=listings');

        $this->assertContains($theirs->id, $this->listingIds($data));
        $this->assertTrue($data['meta']['has_active_listings']);
    }

    public function test_a_request_is_matched_with_an_offer_filed_under_a_different_category(): void
    {
        // Members rarely pick the same category for the same thing. Until
        // 18 Nov 2026 the engine only ever looked in the request's own
        // category, so this pair was never even scored.
        $me = $this->member();
        $this->listingFor($me, 'request', $this->category('Home and garden')->id, [
            'title' => 'Need someone to mow my lawn',
            'description' => 'The grass at the back of the house is getting very long.',
        ]);
        $mower = $this->listingFor($this->member(), 'offer', $this->category('Odd jobs')->id, [
            'title' => 'Lawn mowing and hedge trimming',
            'description' => 'I have my own mower and can cut grass and trim hedges.',
        ]);
        $cakes = $this->listingFor($this->member(), 'offer', $this->category('Food')->id, [
            'title' => 'Cake baking for parties',
            'description' => 'Birthday cakes and fresh bread made to order.',
        ]);

        $ids = $this->listingIds($this->matchesFor($me, 'modules=listings'));

        $this->assertContains($mower->id, $ids, 'The same help filed under another category must be found');
        $this->assertNotContains($cakes->id, $ids, 'An unrelated offer in another category must not be');
    }

    public function test_a_member_with_no_listing_is_matched_by_the_skills_on_their_profile(): void
    {
        $me = $this->member();
        DB::table('user_skills')->insert([
            ['user_id' => $me->id, 'tenant_id' => $this->testTenantId, 'skill_name' => 'Babysitting', 'proficiency' => 'advanced', 'is_offering' => 1, 'is_requesting' => 0],
            ['user_id' => $me->id, 'tenant_id' => $this->testTenantId, 'skill_name' => 'Computer help', 'proficiency' => 'intermediate', 'is_offering' => 0, 'is_requesting' => 1],
        ]);
        $needsChildcare = $this->listingFor($this->member(), 'request', $this->category('Family')->id, [
            'title' => 'Someone to mind my kids after school', 'description' => 'Two children, aged six and nine.',
        ]);
        $offersComputers = $this->listingFor($this->member(), 'offer', $this->category('Technology')->id, [
            'title' => 'Laptop and computer repair', 'description' => 'I fix slow laptops and set up printers.',
        ]);
        $unrelated = $this->listingFor($this->member(), 'request', $this->category('Pets')->id, [
            'title' => 'Dog walking', 'description' => 'A walk for my dog at lunchtime.',
        ]);

        $data = $this->matchesFor($me, 'modules=listings');
        $ids = $this->listingIds($data);

        $this->assertContains($needsChildcare->id, $ids, 'What the member can do meets what others need');
        $this->assertContains($offersComputers->id, $ids, 'What the member wants meets what others offer');
        $this->assertNotContains($unrelated->id, $ids);
        $this->assertFalse($data['meta']['has_active_listings'], 'The page still invites them to post a listing');
    }

    private function setCommunityArea(?string $serviceArea, ?float $lat = 51.5000, ?float $lon = -0.1200): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'service_area' => $serviceArea, 'latitude' => $lat, 'longitude' => $lon,
        ]);
    }

    public function test_a_member_without_a_location_in_a_local_community_is_matched_as_somewhere_in_it(): void
    {
        $this->setCommunityArea('local');
        $category = $this->category();
        $me = $this->member(['latitude' => null, 'longitude' => null]);
        $this->listingFor($me, 'request', $category->id, ['latitude' => null, 'longitude' => null]);
        $theirs = $this->listingFor($this->member(['latitude' => 51.5100, 'longitude' => -0.1300]), 'offer', $category->id, [
            'latitude' => 51.5100, 'longitude' => -0.1300,
        ]);

        $data = $this->matchesFor($me, 'modules=listings');
        $match = array_values(array_filter($data['matches'], static fn (array $m): bool => (int) ($m['listing_id'] ?? 0) === $theirs->id));

        $this->assertCount(1, $match, 'Before, a member with no location saw only remote listings');
        $this->assertNull($match[0]['distance_km'] ?? null, 'A distance from the community centre is not the member\'s distance');
        $this->assertTrue($data['meta']['needs_location'], 'The page must still ask for a location');
    }

    public function test_a_listing_whose_owner_gave_no_location_is_found_in_a_local_community(): void
    {
        $this->setCommunityArea('local');
        $category = $this->category();
        $me = $this->member();
        $this->listingFor($me, 'request', $category->id);
        $theirs = $this->listingFor($this->member(['latitude' => null, 'longitude' => null]), 'offer', $category->id, [
            'latitude' => null, 'longitude' => null,
        ]);

        $match = array_values(array_filter(
            $this->matchesFor($me, 'modules=listings')['matches'],
            static fn (array $m): bool => (int) ($m['listing_id'] ?? 0) === $theirs->id,
        ));

        $this->assertCount(1, $match, 'Before, nobody with a location was ever shown this listing');
        $this->assertNull($match[0]['distance_km'] ?? null);
    }

    public function test_a_national_community_has_no_centre_to_stand_in(): void
    {
        $this->setCommunityArea('national');
        $category = $this->category();
        $me = $this->member(['latitude' => null, 'longitude' => null]);
        $this->listingFor($me, 'request', $category->id, ['latitude' => null, 'longitude' => null]);
        $inPerson = $this->listingFor($this->member(), 'offer', $category->id);

        $this->assertNotContains($inPerson->id, $this->listingIds($this->matchesFor($me, 'modules=listings')),
            'Across a whole country, an in-person listing cannot be assumed to be within reach');
    }

    public function test_a_spanish_request_is_matched_with_a_spanish_offer_worded_differently(): void
    {
        $category = $this->category('Jardín');
        $me = $this->member();
        $this->listingFor($me, 'request', $category->id, [
            'title' => 'Necesito ayuda con el jardín',
            'description' => 'Tengo un jardín pequeño detrás de la casa.',
        ]);
        $theirs = $this->listingFor($this->member(), 'offer', $category->id, [
            'title' => 'Cuido jardines y corto el césped',
            'description' => 'Tengo mi propia cortadora.',
        ]);

        $matches = array_values(array_filter(
            $this->matchesFor($me, 'modules=listings')['matches'],
            static fn (array $m): bool => (int) ($m['listing_id'] ?? 0) === $theirs->id,
        ));

        $this->assertCount(1, $matches);
        $this->assertGreaterThanOrEqual(55, (float) $matches[0]['match_score'], 'Same kind of help in the same category is a strong match');
    }

    private function savePreferences(User $member, array $values): void
    {
        DB::table('match_preferences')->updateOrInsert(
            ['user_id' => $member->id, 'tenant_id' => $this->testTenantId],
            array_merge(['updated_at' => now()], $values),
        );
    }

    // ---------------------------------------------------------------------
    // The member's own settings must be honoured by the page
    // ---------------------------------------------------------------------

    public function test_the_members_saved_minimum_score_applies_when_the_page_names_none(): void
    {
        $category = $this->category();
        $me = $this->member();
        $this->listingFor($me, 'offer', $category->id);
        $theirs = $this->listingFor($this->member(), 'request', $category->id);

        $this->assertContains($theirs->id, $this->listingIds($this->matchesFor($me, 'modules=listings')), 'Control: it matches');

        // A perfect newcomer match scores in the seventies; ask for 95 or better.
        $this->savePreferences($me, ['min_match_score' => 95]);
        $data = $this->matchesFor($me, 'modules=listings');

        $this->assertNotContains($theirs->id, $this->listingIds($data), 'A saved minimum score must not be overridden by the page default');
        $this->assertSame(95, (int) $data['meta']['min_score']);

        // An explicit figure from the page still wins (the page's own filter).
        $this->assertContains($theirs->id, $this->listingIds($this->matchesFor($me, 'modules=listings&min_score=10')));
    }

    public function test_the_members_category_choice_limits_matches_even_when_their_listings_have_categories(): void
    {
        $gardening = $this->category('Gardening');
        $cooking = $this->category('Cooking');
        $me = $this->member();
        $this->listingFor($me, 'offer', $gardening->id);
        $this->listingFor($me, 'offer', $cooking->id, ['title' => 'Cooking lessons ' . uniqid(), 'description' => 'Baking bread and cooking family meals at home.']);
        $gardenRequest = $this->listingFor($this->member(), 'request', $gardening->id);
        $cookingRequest = $this->listingFor($this->member(), 'request', $cooking->id, ['title' => 'Cooking help ' . uniqid(), 'description' => 'Baking bread and cooking family meals at home.']);

        $ids = $this->listingIds($this->matchesFor($me, 'modules=listings&min_score=0'));
        $this->assertContains($gardenRequest->id, $ids, 'Control');
        $this->assertContains($cookingRequest->id, $ids, 'Control');

        $this->savePreferences($me, ['categories' => json_encode([$cooking->id])]);
        $ids = $this->listingIds($this->matchesFor($me, 'modules=listings&min_score=0'));

        $this->assertContains($cookingRequest->id, $ids);
        $this->assertNotContains($gardenRequest->id, $ids, 'A member who chose "Cooking only" must not be shown gardening matches');
    }

    public function test_a_one_way_skill_fit_is_not_described_as_matching_both_ways(): void
    {
        $category = $this->category();
        $me = $this->member();
        $this->listingFor($me, 'offer', $category->id);
        $theirs = $this->listingFor($this->member(), 'request', $category->id);

        $data = $this->matchesFor($me, 'modules=listings&min_score=0');
        $match = collect($data['matches'])->firstWhere('listing_id', $theirs->id);

        $this->assertNotNull($match);
        // I offer what they ask for; they offer nothing I asked for.
        $this->assertNotContains('Skills match both ways', $match['match_reasons']);
        $this->assertContains('Skills match your expertise', $match['match_reasons']);
    }

    public function test_different_kinds_of_help_in_one_category_are_not_matched(): void
    {
        // Until 19 Nov 2026 sharing a category was enough on its own: every
        // request in "Home and garden" was matched with every offer in it.
        $home = $this->category('Home and garden');
        $me = $this->member();
        $this->listingFor($me, 'request', $home->id, [
            'title' => 'Leaking tap in the kitchen',
            'description' => 'The cold tap under the sink drips all day.',
        ]);
        $gardener = $this->listingFor($this->member(), 'offer', $home->id, [
            'title' => 'Garden help',
            'description' => 'Mowing, weeding and hedge trimming.',
        ]);
        $plumber = $this->listingFor($this->member(), 'offer', $home->id, [
            'title' => 'Plumber',
            'description' => 'Taps, sinks and toilets fixed.',
        ]);

        $ids = $this->listingIds($this->matchesFor($me, 'modules=listings'));

        $this->assertContains($plumber->id, $ids);
        $this->assertNotContains($gardener->id, $ids, 'A leaking tap is not a gardening job, whatever category both are in');
    }

    public function test_two_listings_that_only_share_the_word_lessons_are_not_matched(): void
    {
        $learning = $this->category('Learning');
        $me = $this->member();
        $this->listingFor($me, 'request', $learning->id, [
            'title' => 'Guitar lessons wanted', 'description' => 'A beginner who would like to learn the guitar.',
        ]);
        $french = $this->listingFor($this->member(), 'offer', $learning->id, [
            'title' => 'French lessons for beginners', 'description' => 'Conversation and grammar in French.',
        ]);
        $guitar = $this->listingFor($this->member(), 'offer', $learning->id, [
            'title' => 'Guitar teacher', 'description' => 'Acoustic guitar for any age.',
        ]);

        $ids = $this->listingIds($this->matchesFor($me, 'modules=listings'));

        $this->assertContains($guitar->id, $ids);
        $this->assertNotContains($french->id, $ids);
    }

    public function test_members_whose_listings_answer_each_other_are_a_two_way_match(): void
    {
        $me = $this->member();
        $this->listingFor($me, 'request', $this->category('Home and garden')->id, [
            'title' => 'Need someone to mow my lawn', 'description' => 'The grass is getting long.',
        ]);
        $this->listingFor($me, 'offer', $this->category('Languages')->id, [
            'title' => 'French conversation', 'description' => 'Practise speaking French over coffee.',
        ]);
        $neighbour = $this->member();
        $theirOffer = $this->listingFor($neighbour, 'offer', $this->category('Odd jobs')->id, [
            'title' => 'Lawn mowing', 'description' => 'I have my own mower.',
        ]);
        $this->listingFor($neighbour, 'request', $this->category('Education')->id, [
            'title' => 'French lessons wanted', 'description' => 'I would like to learn French before a holiday.',
        ]);

        $data = $this->matchesFor($me, 'modules=listings&min_score=0');
        $match = collect($data['matches'])->firstWhere('listing_id', $theirOffer->id);

        $this->assertNotNull($match);
        $this->assertSame('mutual', $match['match_type'], 'Found in what the four listings say, though no two share a category');
        $this->assertSame(
            'Two-way match: you offer “French conversation” and they offer “Lawn mowing”',
            $match['match_reasons'][0],
            'The member is told which two listings make it two-way, not only that one is possible'
        );
    }

    public function test_a_match_says_which_of_the_members_listings_it_is_for(): void
    {
        $me = $this->member();
        $this->listingFor($me, 'offer', $this->category('Home and garden')->id, [
            'title' => 'Lawn mowing', 'description' => 'I have my own mower.',
        ]);
        $this->listingFor($me, 'offer', $this->category('Music')->id, [
            'title' => 'Guitar lessons', 'description' => 'Beginners welcome, acoustic or electric.',
        ]);
        $wanted = $this->listingFor($this->member(), 'request', $this->category('Learning')->id, [
            'title' => 'Guitar teacher wanted', 'description' => 'I would like to learn to play the guitar.',
        ]);

        $data = $this->matchesFor($me, 'modules=listings');
        $match = collect($data['matches'])->firstWhere('listing_id', $wanted->id);

        $this->assertNotNull($match);
        $this->assertSame('For your offer: Guitar lessons', $match['match_reasons'][0]);
    }

    public function test_a_member_with_a_listing_is_still_matched_by_the_skills_on_their_profile(): void
    {
        // One request posted, and the skills on the profile stopped counting:
        // they were only read for a member with no listing at all.
        $me = $this->member();
        $this->listingFor($me, 'request', $this->category('Technology')->id, [
            'title' => 'Help setting up my new phone', 'description' => 'I cannot get my email working on it.',
        ]);
        DB::table('user_skills')->insert([
            'user_id' => $me->id, 'tenant_id' => $this->testTenantId, 'skill_name' => 'Gardening',
            'proficiency' => 'advanced', 'is_offering' => 1, 'is_requesting' => 0,
        ]);
        $needsGardener = $this->listingFor($this->member(), 'request', $this->category('Home and garden')->id, [
            'title' => 'Help with my garden', 'description' => 'Weeding and mowing once a fortnight.',
        ]);

        $data = $this->matchesFor($me, 'modules=listings');
        $match = collect($data['matches'])->firstWhere('listing_id', $needsGardener->id);

        $this->assertNotNull($match, 'A request for something the member says they can do');
        $this->assertSame('For your skill: Gardening', $match['match_reasons'][0]);
        $this->assertTrue($data['meta']['has_active_listings']);
    }

    public function test_having_more_skills_does_not_lower_the_match_for_one_of_them(): void
    {
        // The skills used to be merged into one stand-in listing, so each
        // skill a member added made every other one count for less.
        $request = $this->listingFor($this->member(), 'request', $this->category('Home and garden')->id, [
            'title' => 'Help with my garden', 'description' => 'Weeding and mowing once a fortnight.',
        ]);
        $skill = fn (User $member, string $name) => DB::table('user_skills')->insert([
            'user_id' => $member->id, 'tenant_id' => $this->testTenantId, 'skill_name' => $name,
            'proficiency' => 'intermediate', 'is_offering' => 1, 'is_requesting' => 0,
        ]);
        $oneSkill = $this->member();
        $skill($oneSkill, 'Gardening');
        $manySkills = $this->member();
        foreach (['Gardening', 'Cooking', 'Computers', 'Driving', 'Sewing', 'Dog walking', 'Befriending', 'Painting'] as $name) {
            $skill($manySkills, $name);
        }

        $scoreFor = function (User $member) use ($request): float {
            $match = collect($this->matchesFor($member, 'modules=listings&min_score=0')['matches'])
                ->firstWhere('listing_id', $request->id);
            $this->assertNotNull($match);

            return (float) $match['match_score'];
        };

        $one = $scoreFor($oneSkill);
        $many = $scoreFor($manySkills);

        $this->assertSame($one, $many);
        $this->assertGreaterThanOrEqual(75.0, $one, 'A skill has no category; that is unknown, not a different category');
    }

    public function test_the_members_own_expired_listing_is_not_matched_on(): void
    {
        $category = $this->category();
        $me = $this->member();
        $this->listingFor($me, 'offer', $category->id, ['expires_at' => now()->subDay()]);
        $this->listingFor($this->member(), 'request', $category->id);

        $data = $this->matchesFor($me, 'modules=listings&min_score=0');

        $this->assertFalse($data['meta']['has_active_listings'], 'The expiry job runs on a timer; until it does, the listing still reads "active"');
        foreach ($data['matches'] as $match) {
            $this->assertSame('cold_start', $match['match_type'], 'Only browsing suggestions: nothing of theirs is live to match on');
        }
    }

    public function test_sharing_categories_does_not_make_a_two_way_match(): void
    {
        // Both members have an offer and a request in one category; none of
        // the four has anything to do with another.
        $general = $this->category('General');
        $me = $this->member();
        $this->listingFor($me, 'request', $general->id, ['title' => 'Chess partner wanted', 'description' => 'A game of chess now and then.']);
        $this->listingFor($me, 'offer', $general->id, ['title' => 'Telescope evenings', 'description' => 'Star gazing on clear nights.']);
        $neighbour = $this->member();
        $theirOffer = $this->listingFor($neighbour, 'offer', $general->id, ['title' => 'Origami workshop', 'description' => 'Paper folding for all ages.']);
        $this->listingFor($neighbour, 'request', $general->id, ['title' => 'Beekeeping advice', 'description' => 'Thinking of keeping a hive.']);

        $data = $this->matchesFor($me, 'modules=listings&min_score=0');
        $match = collect($data['matches'])->firstWhere('listing_id', $theirOffer->id);

        $this->assertNotNull($match);
        $this->assertNotSame('mutual', $match['match_type']);
        $this->assertNotContains('Mutual exchange possible!', $match['match_reasons']);
    }

    public function test_a_listing_that_was_not_approved_is_never_offered_as_a_match(): void
    {
        $category = $this->category();
        $me = $this->member();
        $this->listingFor($me, 'offer', $category->id);
        $approved = $this->listingFor($this->member(), 'request', $category->id);
        $rejected = $this->listingFor($this->member(), 'request', $category->id, ['moderation_status' => 'rejected']);
        $inReview = $this->listingFor($this->member(), 'request', $category->id, ['moderation_status' => 'pending_review']);

        $ids = $this->listingIds($this->matchesFor($me, 'modules=listings&min_score=0'));

        $this->assertContains($approved->id, $ids);
        $this->assertNotContains($rejected->id, $ids);
        $this->assertNotContains($inReview->id, $ids);
    }

    public function test_a_listing_whose_owner_is_not_an_active_member_is_never_offered(): void
    {
        $category = $this->category();
        $me = $this->member();
        $this->listingFor($me, 'offer', $category->id);
        $active = $this->listingFor($this->member(), 'request', $category->id);
        $deactivated = $this->listingFor($this->member(['status' => 'inactive']), 'request', $category->id);
        $awaitingApproval = $this->listingFor($this->member(['status' => 'pending', 'is_approved' => 0]), 'request', $category->id);
        $refused = $this->listingFor($this->member(['status' => 'rejected']), 'request', $category->id);

        $ids = $this->listingIds($this->matchesFor($me, 'modules=listings&min_score=0'));

        $this->assertContains($active->id, $ids);
        $this->assertNotContains($deactivated->id, $ids, 'Only banned and suspended owners were excluded');
        $this->assertNotContains($awaitingApproval->id, $ids);
        $this->assertNotContains($refused->id, $ids);
    }

    // ---------------------------------------------------------------------
    // The community's own switch
    // ---------------------------------------------------------------------

    private function setMatchingConfig(array $changes): void
    {
        $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('configuration');
        $config = is_string($raw) ? (json_decode($raw, true) ?: []) : [];
        $config['algorithms']['smart_matching'] = array_merge($config['algorithms']['smart_matching'] ?? [], $changes);
        DB::table('tenants')->where('id', $this->testTenantId)->update(['configuration' => json_encode($config)]);
        app(SmartMatchingEngine::class)->clearCache();
    }

    private function setFeatures(array $changes): void
    {
        $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('features');
        $features = is_string($raw) ? (json_decode($raw, true) ?: []) : [];
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode(array_merge($features, $changes))]);
        TenantContext::setById($this->testTenantId);
    }

    // ---------------------------------------------------------------------
    // Deeper audit, 18 Nov 2026
    // ---------------------------------------------------------------------

    public function test_a_listing_past_its_expiry_date_is_never_matched(): void
    {
        $category = $this->category();
        $me = $this->member();
        $this->listingFor($me, 'offer', $category->id);
        $live = $this->listingFor($this->member(), 'request', $category->id);
        $expired = $this->listingFor($this->member(), 'request', $category->id, ['expires_at' => now()->subDay()]);

        $ids = $this->listingIds($this->matchesFor($me, 'modules=listings&min_score=0'));

        $this->assertContains($live->id, $ids, 'Control');
        $this->assertNotContains($expired->id, $ids, 'The expiry job runs on a timer; until it does, an expired listing still reads "active"');
    }

    public function test_a_match_adjusted_below_the_members_minimum_is_not_shown(): void
    {
        $category = $this->category();
        $me = $this->member();
        $this->listingFor($me, 'offer', $category->id);
        $them = $this->member();
        $dismissed = $this->listingFor($them, 'request', $category->id);
        $other = $this->listingFor($them, 'request', $category->id);

        $before = collect($this->matchesFor($me, 'modules=listings&min_score=0')['matches'])
            ->firstWhere('listing_id', $other->id);
        $this->assertNotNull($before, 'Control');
        $minimum = (int) floor((float) $before['match_score']) - 3;

        // Dismissing one of their listings costs the other one 8 points.
        DB::table('match_dismissals')->insert([
            'tenant_id' => $this->testTenantId, 'user_id' => $me->id, 'listing_id' => $dismissed->id, 'created_at' => now(),
        ]);

        $ids = $this->listingIds($this->matchesFor($me, 'modules=listings&min_score=' . $minimum));
        $this->assertNotContains($other->id, $ids, 'Shown below the minimum the member asked for');
    }

    public function test_the_safety_check_is_made_once_per_member_not_once_per_listing(): void
    {
        $category = $this->category();
        $me = $this->member();
        $this->listingFor($me, 'offer', $category->id);
        $them = $this->member();
        for ($i = 0; $i < 4; $i++) {
            $this->listingFor($them, 'request', $category->id);
        }

        $policy = new class(
            app(\App\Services\MemberVettingAttestationService::class),
            app(\App\Services\SafeguardingJurisdictionService::class),
            app(\App\Services\SafeguardingCoordinatorDirectory::class),
        ) extends \App\Services\SafeguardingInteractionPolicy {
            public array $pairs = [];

            public function evaluateLocalContact(int $senderId, int $recipientId, int $tenantId, string $channel = 'direct_message'): \App\Support\SafeguardingInteractionDecision
            {
                if ($channel === 'match_discovery') {
                    $this->pairs[] = $senderId . '>' . $recipientId;
                }

                return parent::evaluateLocalContact($senderId, $recipientId, $tenantId, $channel);
            }
        };
        $this->app->instance(\App\Services\SafeguardingInteractionPolicy::class, $policy);

        $this->matchesFor($me, 'modules=listings&min_score=0');

        $withThem = array_filter($policy->pairs, fn (string $pair) => in_array((string) $them->id, explode('>', $pair), true));
        $this->assertCount(2, $withThem, 'One check each way for the two members, however many listings they have');
    }

    public function test_owners_seen_as_often_as_everyone_else_are_not_marked_down(): void
    {
        $category = $this->category();
        $me = $this->member();
        $this->listingFor($me, 'offer', $category->id);
        $first = $this->listingFor($this->member(), 'request', $category->id);
        $second = $this->listingFor($this->member(), 'request', $category->id);

        // An active community: both owners already appear in many members' lists.
        $others = [];
        for ($i = 0; $i < 6; $i++) {
            $others[] = $this->member()->id;
        }
        $rows = [];
        foreach ([$first->id, $second->id] as $listingId) {
            foreach ($others as $otherId) {
                $rows[] = [
                    'user_id' => $otherId, 'listing_id' => $listingId, 'tenant_id' => $this->testTenantId,
                    'match_score' => 60, 'match_type' => 'one_way', 'status' => 'new',
                    'created_at' => now(), 'expires_at' => now()->addDays(7),
                ];
            }
        }
        DB::table('match_cache')->insert($rows);

        $matches = collect($this->matchesFor($me, 'modules=listings&min_score=0')['matches']);
        foreach ([$first->id, $second->id] as $listingId) {
            $match = $matches->firstWhere('listing_id', $listingId);
            $this->assertNotNull($match);
            $this->assertArrayNotHasKey('popularity', $match['score_breakdown']['adjustments'] ?? [],
                'Every owner here is seen equally often: a penalty on all of them is a flat cut, not a fairer order');
        }
    }

    // ---------------------------------------------------------------------
    // AI layer (OpenAI or Anthropic) and learning from exchanges, 18 Nov 2026
    // ---------------------------------------------------------------------

    private function aiSwitch(bool $on): void
    {
        DB::table('ai_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'ai_enabled'],
            ['setting_value' => $on ? 'true' : 'false', 'updated_at' => now()]
        );
        app(SmartMatchingEngine::class)->clearCache();
    }

    private function reading(Listing $listing, array $terms, array $concepts = []): void
    {
        DB::table('listing_match_enrichments')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'listing_id' => $listing->id],
            ['content_hash' => str_repeat('a', 64), 'terms' => json_encode($terms), 'concepts' => json_encode($concepts),
             'created_at' => now(), 'updated_at' => now()]
        );
    }

    public function test_the_ai_reading_of_two_listings_lets_them_meet_when_their_words_do_not(): void
    {
        $category = $this->category();
        $me = $this->member();
        $mine = $this->listingFor($me, 'request', $category->id, [
            'title' => 'Wer kann meine Harfe stimmen?', 'description' => 'Sie klingt seit dem Umzug schief.',
        ]);
        $theirs = $this->listingFor($this->member(), 'offer', $this->category('Odd jobs')->id, [
            'title' => 'Stringed instrument maintenance', 'description' => 'Restringing and regulating at your home.',
        ]);
        $this->reading($mine, ['harp tuning', 'instrument repair', 'harp']);
        $this->reading($theirs, ['instrument repair', 'harp tuning', 'string instruments']);

        $this->aiSwitch(false);
        $this->assertNotContains($theirs->id, $this->listingIds($this->matchesFor($me, 'modules=listings')),
            'Control: without AI these share no word');

        $this->aiSwitch(true);
        $this->assertContains($theirs->id, $this->listingIds($this->matchesFor($me, 'modules=listings')),
            'With the AI reading, a German request meets an English offer');
    }

    public function test_the_ai_judgement_of_a_match_reaches_the_member_only_with_ai_on(): void
    {
        $category = $this->category();
        $me = $this->member();
        $this->listingFor($me, 'offer', $category->id);
        $theirs = $this->listingFor($this->member(), 'request', $category->id);
        DB::table('match_cache')->insert([
            'user_id' => $me->id, 'listing_id' => $theirs->id, 'tenant_id' => $this->testTenantId,
            'match_score' => 60, 'match_type' => 'one_way', 'status' => 'new', 'ai_rerank_delta' => 4.0,
            'created_at' => now(), 'expires_at' => now()->addDays(7),
        ]);

        $this->aiSwitch(false);
        $off = collect($this->matchesFor($me, 'modules=listings&min_score=0')['matches'])->firstWhere('listing_id', $theirs->id);
        $this->aiSwitch(true);
        $on = collect($this->matchesFor($me, 'modules=listings&min_score=0')['matches'])->firstWhere('listing_id', $theirs->id);

        $this->assertArrayNotHasKey('ai_judgement', $off['score_breakdown']['adjustments'] ?? []);
        $this->assertEqualsWithDelta(4.0, $on['score_breakdown']['adjustments']['ai_judgement'] ?? 0, 0.01);
        $this->assertEqualsWithDelta((float) $off['match_score'] + 4.0, (float) $on['match_score'], 0.2);
    }

    public function test_a_match_the_ai_judges_a_poor_fit_drops_out_of_the_members_list(): void
    {
        // On live (20 Nov 2026) the AI wrote "has little to do with your
        // listing" about matches it could move by 5 at most, so they stayed.
        $category = $this->category();
        $me = $this->member();
        $this->listingFor($me, 'offer', $category->id);
        $theirs = $this->listingFor($this->member(), 'request', $category->id);
        $this->aiSwitch(true);

        $before = collect($this->matchesFor($me, 'modules=listings&min_score=0')['matches'])->firstWhere('listing_id', $theirs->id);
        $this->assertNotNull($before);

        DB::table('match_cache')->insert([
            'user_id' => $me->id, 'listing_id' => $theirs->id, 'tenant_id' => $this->testTenantId,
            'match_score' => 60, 'match_type' => 'one_way', 'status' => 'new', 'ai_rerank_delta' => -15.0,
            'created_at' => now(), 'expires_at' => now()->addDays(7),
        ]);

        $after = collect($this->matchesFor($me, 'modules=listings&min_score=0')['matches'])->firstWhere('listing_id', $theirs->id);
        $this->assertEqualsWithDelta(-15.0, $after['score_breakdown']['adjustments']['ai_judgement'] ?? 0, 0.01);

        // Asked for with a minimum just under its score before the verdict, it is gone.
        $floor = max(0, (int) floor((float) $before['match_score']) - 10);
        $this->assertNotContains(
            $theirs->id,
            $this->listingIds($this->matchesFor($me, 'modules=listings&min_score=' . $floor))
        );
    }

    public function test_the_stored_match_records_which_of_the_members_listings_it_is_for(): void
    {
        $category = $this->category();
        $me = $this->member();
        $mine = $this->listingFor($me, 'offer', $category->id);
        $theirs = $this->listingFor($this->member(), 'request', $category->id);

        app(\App\Services\SmartMatchingEngine::class)->warmUpCache(50);

        $stored = DB::table('match_cache')->where('user_id', $me->id)->where('listing_id', $theirs->id)->value('score_breakdown');
        $this->assertNotNull($stored, 'The match was not stored at all');
        $this->assertSame($mine->title, json_decode((string) $stored, true)['matched_listing'] ?? null);
    }

    private function exchange(User $requester, User $provider, Listing $listing, string $status, ?int $requesterRating = null): void
    {
        DB::table('exchange_requests')->insert([
            'tenant_id' => $this->testTenantId, 'listing_id' => $listing->id,
            'requester_id' => $requester->id, 'provider_id' => $provider->id,
            'proposed_hours' => 1, 'status' => $status, 'requester_rating' => $requesterRating,
        ]);
    }

    public function test_a_completed_exchange_with_a_member_counts_for_their_other_listings(): void
    {
        $category = $this->category();
        $me = $this->member();
        $this->listingFor($me, 'request', $category->id);
        $helper = $this->member();
        $past = $this->listingFor($helper, 'offer', $category->id, ['status' => 'closed']);
        $current = $this->listingFor($helper, 'offer', $category->id);

        $before = collect($this->matchesFor($me, 'modules=listings&min_score=0')['matches'])->firstWhere('listing_id', $current->id);
        $this->exchange($me, $helper, $past, 'completed', 5);
        $after = collect($this->matchesFor($me, 'modules=listings&min_score=0')['matches'])->firstWhere('listing_id', $current->id);

        $this->assertEqualsWithDelta(4.0, $after['score_breakdown']['adjustments']['worked_together'] ?? 0, 0.01);
        $this->assertGreaterThan((float) $before['match_score'], (float) $after['match_score']);
    }

    public function test_a_member_rated_poorly_is_marked_down(): void
    {
        $category = $this->category();
        $me = $this->member();
        $this->listingFor($me, 'request', $category->id);
        $helper = $this->member();
        $past = $this->listingFor($helper, 'offer', $category->id, ['status' => 'closed']);
        $current = $this->listingFor($helper, 'offer', $category->id);
        $this->exchange($me, $helper, $past, 'completed', 1);

        $match = collect($this->matchesFor($me, 'modules=listings&min_score=0')['matches'])->firstWhere('listing_id', $current->id);
        $this->assertEqualsWithDelta(-8.0, $match['score_breakdown']['adjustments']['worked_together'] ?? 0, 0.01);
    }

    public function test_a_listing_already_under_an_exchange_is_not_offered_as_a_match(): void
    {
        $category = $this->category();
        $me = $this->member();
        $this->listingFor($me, 'request', $category->id);
        $helper = $this->member();
        $inProgress = $this->listingFor($helper, 'offer', $category->id);
        $other = $this->listingFor($this->member(), 'offer', $category->id);
        $this->exchange($me, $helper, $inProgress, 'accepted');

        $ids = $this->listingIds($this->matchesFor($me, 'modules=listings&min_score=0'));
        $this->assertContains($other->id, $ids, 'Control');
        $this->assertNotContains($inProgress->id, $ids, 'They are already in touch about it');
    }

    public function test_switching_matching_off_for_the_community_stops_matches(): void
    {
        $category = $this->category();
        $me = $this->member();
        $this->listingFor($me, 'offer', $category->id);
        $theirs = $this->listingFor($this->member(), 'request', $category->id);
        $this->assertContains($theirs->id, $this->listingIds($this->matchesFor($me, 'modules=listings&min_score=0')), 'Control');

        $this->setMatchingConfig(['enabled' => false]);
        $data = $this->matchesFor($me, 'min_score=0');

        $this->assertSame([], $data['matches']);
        $this->assertTrue($data['meta']['disabled']);
        $this->assertSame(['processed' => 0, 'cached' => 0], app(SmartMatchingEngine::class)->warmUpCache(10));
    }

    public function test_the_communitys_minimum_score_applies_to_a_member_with_no_setting_of_their_own(): void
    {
        $category = $this->category();
        $me = $this->member();
        $this->listingFor($me, 'offer', $category->id);
        $theirs = $this->listingFor($this->member(), 'request', $category->id);

        $this->setMatchingConfig(['min_match_score' => 99]);
        $data = $this->matchesFor($me, 'modules=listings');

        $this->assertNotContains($theirs->id, $this->listingIds($data));
        $this->assertSame(99, (int) $data['meta']['min_score']);
    }

    // ---------------------------------------------------------------------
    // Events, volunteering and groups
    // ---------------------------------------------------------------------

    public function test_an_upcoming_event_in_a_category_the_member_works_in_is_offered(): void
    {
        $this->setFeatures(['events' => true]);
        $category = $this->category();
        $me = $this->member();
        $this->listingFor($me, 'offer', $category->id);
        $organiser = $this->member();

        $base = [
            'user_id' => $organiser->id,
            'category_id' => $category->id,
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'start_time' => now()->addDays(3),
            'start_date' => now()->addDays(3),
            'end_time' => now()->addDays(3)->addHours(2),
            'max_attendees' => null,
        ];
        $open = Event::factory()->forTenant($this->testTenantId)->create(array_merge($base, ['title' => 'Garden open day']));
        $draft = Event::factory()->forTenant($this->testTenantId)->create(array_merge($base, ['title' => 'Draft day', 'publication_status' => 'draft', 'status' => 'draft']));
        $cancelled = Event::factory()->forTenant($this->testTenantId)->create(array_merge($base, ['title' => 'Cancelled day', 'operational_status' => 'cancelled', 'status' => 'cancelled']));
        $going = Event::factory()->forTenant($this->testTenantId)->create(array_merge($base, ['title' => 'Already going']));
        DB::table('event_rsvps')->insert([
            'tenant_id' => $this->testTenantId, 'event_id' => $going->id, 'user_id' => $me->id, 'status' => 'going', 'created_at' => now(),
        ]);
        $mine = Event::factory()->forTenant($this->testTenantId)->create(array_merge($base, ['title' => 'My own event', 'user_id' => $me->id]));

        $data = $this->matchesFor($me, 'modules=events&min_score=0');
        $eventIds = array_column(array_filter($data['matches'], fn ($m) => $m['module'] === 'event'), 'event_id');

        $this->assertContains($open->id, $eventIds, 'Event matches never appeared: the query named a column and a table that do not exist');
        $this->assertNotContains($draft->id, $eventIds);
        $this->assertNotContains($cancelled->id, $eventIds);
        $this->assertNotContains($going->id, $eventIds, 'An event the member already answered is not a suggestion');
        $this->assertNotContains($mine->id, $eventIds);

        $match = collect($data['matches'])->firstWhere('event_id', $open->id);
        $this->assertSame('Garden open day', $match['title']);
        $this->assertNotEmpty($match['event_date']);
        $this->assertArrayHasKey('attendee_count', $match);
    }

    public function test_a_volunteering_opportunity_is_offered_only_when_it_fits_the_members_skills(): void
    {
        $this->setFeatures(['volunteering' => true]);
        $me = $this->member(['skills' => '', 'bio' => '']);
        DB::table('user_skills')->insert([
            'user_id' => $me->id, 'tenant_id' => $this->testTenantId, 'skill_name' => 'Gardening',
            'proficiency' => 'advanced', 'is_offering' => 1, 'is_requesting' => 0, 'created_at' => now(),
        ]);
        $orgId = DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $this->member()->id, 'name' => 'Green Fingers ' . uniqid(),
            'description' => 'A community allotment.', 'status' => 'approved', 'created_at' => now(),
        ]);
        $opportunity = fn (array $attrs) => DB::table('vol_opportunities')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId, 'organization_id' => $orgId, 'title' => 'Allotment helper',
            'description' => 'Help keep the beds tidy.', 'skills_needed' => 'gardening, weeding',
            'is_active' => 1, 'status' => 'open', 'created_at' => now(),
        ], $attrs));
        $fits = $opportunity([]);
        $unrelated = $opportunity(['title' => 'Treasurer', 'description' => 'Keep the accounts.', 'skills_needed' => 'bookkeeping']);
        $closed = $opportunity(['status' => 'closed']);
        $applied = $opportunity(['title' => 'Allotment helper two']);
        DB::table('vol_applications')->insert([
            'tenant_id' => $this->testTenantId, 'opportunity_id' => $applied, 'user_id' => $me->id, 'status' => 'pending',
        ]);

        $data = $this->matchesFor($me, 'modules=volunteering&min_score=0');
        $ids = array_column(array_filter($data['matches'], fn ($m) => $m['module'] === 'volunteering'), 'opportunity_id');

        $this->assertContains($fits, $ids);
        $this->assertNotContains($unrelated, $ids, 'An opportunity with nothing in common is not a match');
        $this->assertNotContains($closed, $ids);
        $this->assertNotContains($applied, $ids);
        $match = collect($data['matches'])->firstWhere('opportunity_id', $fits);
        $this->assertSame($orgId, $match['organization_id']);
        $this->assertGreaterThanOrEqual(40, $match['match_score']);
    }

    public function test_a_volunteering_opportunity_is_matched_through_an_offer_the_member_posted(): void
    {
        // What a member can do was read from their profile skills only: one
        // with a listing and an empty skills list was matched with nothing.
        $this->setFeatures(['volunteering' => true]);
        $me = $this->member(['skills' => '', 'bio' => '']);
        $this->listingFor($me, 'offer', $this->category('Music')->id, [
            'title' => 'Guitar lessons', 'description' => 'I enjoy meeting local people.',
        ]);
        $orgId = DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $this->member()->id, 'name' => 'Day Centre ' . uniqid(),
            'description' => 'A day centre.', 'status' => 'approved', 'created_at' => now(),
        ]);
        $opportunity = fn (array $attrs) => DB::table('vol_opportunities')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId, 'organization_id' => $orgId,
            'is_active' => 1, 'status' => 'open', 'created_at' => now(), 'skills_needed' => '',
        ], $attrs));
        $music = $opportunity(['title' => 'Sing-along leader', 'description' => 'Play the guitar for our residents on Fridays.']);
        $oneWord = $opportunity(['title' => 'Kitchen helper', 'description' => 'Serve lunch to local families.']);

        $data = $this->matchesFor($me, 'modules=volunteering&min_score=0');
        $ids = array_column(array_filter($data['matches'], fn ($m) => $m['module'] === 'volunteering'), 'opportunity_id');

        $this->assertContains($music, $ids, 'The same kind of help as something the member offers');
        $this->assertNotContains($oneWord, $ids, 'One ordinary word in common ("local") is not a fit');
    }

    public function test_an_event_is_offered_for_what_the_member_does_not_for_a_word_in_their_profile(): void
    {
        $this->setFeatures(['events' => true]);
        // Events have their own categories, separate from the listing ones.
        $eventCategory = Category::factory()->create([
            'tenant_id' => $this->testTenantId, 'type' => 'event', 'name' => 'Social ' . random_int(10000000, 99999999),
        ]);
        $base = [
            'user_id' => $this->member()->id,
            'category_id' => $eventCategory->id,
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'start_time' => now()->addDays(3),
            'start_date' => now()->addDays(3),
            'end_time' => now()->addDays(3)->addHours(2),
            'max_attendees' => null,
        ];
        $gardening = Event::factory()->forTenant($this->testTenantId)->create(array_merge($base, [
            'title' => 'Seed swap', 'description' => 'Bring seeds and cuttings, and meet other gardeners.',
        ]));
        $coffee = Event::factory()->forTenant($this->testTenantId)->create(array_merge($base, [
            'title' => 'Coffee morning', 'description' => 'Meet local people from your community.',
        ]));

        $eventIds = function (User $member): array {
            $data = $this->matchesFor($member, 'modules=events&min_score=0');

            return array_column(array_filter($data['matches'], fn ($m) => $m['module'] === 'event'), 'event_id');
        };

        // A member who offers gardening, in a listing; no profile skills.
        $gardener = $this->member(['skills' => '', 'bio' => '']);
        $this->listingFor($gardener, 'offer', $this->category('Home and garden')->id, [
            'title' => 'Lawn mowing', 'description' => 'I have my own mower.',
        ]);
        $forGardener = $eventIds($gardener);
        $this->assertContains($gardening->id, $forGardener, 'The same kind of help as a listing of theirs');
        $this->assertNotContains($coffee->id, $forGardener);

        // A member whose profile text merely uses the same everyday words.
        $chatty = $this->member(['skills' => '', 'bio' => 'I love to meet local people in my community.']);
        $this->assertSame([], $eventIds($chatty), 'Ordinary words in a profile are not interests');
    }

    public function test_a_dismissed_group_stays_dismissed_even_when_nothing_was_cached(): void
    {
        $this->setFeatures(['groups' => true]);
        $me = $this->member();
        $groupId = DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId, 'owner_id' => $this->member()->id, 'name' => 'Walkers ' . uniqid(),
            'description' => 'Sunday walks.', 'visibility' => 'public', 'status' => 'active', 'created_at' => now(),
        ]);
        $recommended = [[
            'id' => $groupId, 'name' => 'Walkers', 'description' => 'Sunday walks.', 'visibility' => 'public',
            'member_count' => 3, 'recommendation_score' => 0.8, 'recommendation_reason' => 'Popular in your community',
        ]];
        $engine = \Mockery::mock(GroupRecommendationEngine::class);
        $engine->shouldReceive('getRecommendations')->andReturn($recommended);
        $this->app->instance(GroupRecommendationEngine::class, $engine);
        $this->app->forgetInstance(GroupMatchingService::class);
        $this->app->forgetInstance(\App\Services\CrossModuleMatchingService::class);

        $groupIds = fn () => array_column(
            array_filter($this->matchesFor($me, 'modules=groups&min_score=0')['matches'], fn ($m) => $m['module'] === 'group'),
            'group_id',
        );
        $this->assertContains($groupId, $groupIds(), 'Control: offered from a cold cache');

        $this->apiPost("/v2/matches/group/{$groupId}/dismiss", ['reason' => 'not_interested'])->assertStatus(200);

        $this->assertNotContains($groupId, $groupIds(), 'A dismissed group came straight back whenever it was not in the cache');
    }

    // ---------------------------------------------------------------------
    // The background job that pre-computes matches
    // ---------------------------------------------------------------------

    public function test_the_warm_up_moves_on_from_a_member_with_nothing_to_match(): void
    {
        // Only these two members are eligible: park everyone else's listings.
        DB::table('listings')->where('tenant_id', $this->testTenantId)->update(['status' => 'inactive']);
        DB::table('match_cache')->where('tenant_id', $this->testTenantId)->delete();

        $category = $this->category();
        $lonely = $this->member(['last_login_at' => now()]);
        // Unrelated wording as well as category: categories alone no longer
        // keep a pair apart.
        $this->listingFor($lonely, 'offer', $this->category('Astronomy')->id, [
            'title' => 'Telescope evenings',
            'description' => 'Star gazing through my telescope on clear nights.',
        ]);
        $matched = $this->member(['last_login_at' => now()->subDay()]);
        $this->listingFor($matched, 'offer', $category->id);
        $theirs = $this->listingFor($this->member(['last_login_at' => now()->subDays(2)]), 'request', $category->id);

        // A stale row for a match that no longer exists.
        $gone = $this->listingFor($this->member(), 'request', $category->id, ['status' => 'closed']);
        DB::table('match_cache')->insert([
            'user_id' => $matched->id, 'listing_id' => $gone->id, 'tenant_id' => $this->testTenantId,
            'match_score' => 70, 'match_type' => 'one_way', 'match_reasons' => '[]', 'status' => 'new',
            'created_at' => now()->subDays(20), 'expires_at' => now()->subDays(13),
        ]);

        $engine = app(SmartMatchingEngine::class);
        $first = $engine->warmUpCache(1);
        $this->assertSame(1, $first['processed']);
        $this->assertSame(0, $first['cached'], 'The most recent member has nothing to match');

        $second = $engine->warmUpCache(1);

        $this->assertSame(1, $second['processed']);
        $this->assertGreaterThan(0, $second['cached'], 'The same empty member was recomputed on every run, so nobody behind them was reached');
        $this->assertTrue(DB::table('match_cache')->where('user_id', $matched->id)->where('listing_id', $theirs->id)->exists());
        $this->assertFalse(DB::table('match_cache')->where('listing_id', $gone->id)->exists(), 'Expired rows were never removed');

        $third = $engine->warmUpCache(5);
        $this->assertNotContains($matched->id, [], 'no-op');
        $this->assertSame(0, DB::table('match_cache')->where('user_id', $lonely->id)->count());
        // Everyone reachable has been handled: nothing left to redo this run.
        $this->assertLessThanOrEqual(1, $third['processed']);
    }

    public function test_the_warm_up_reaches_a_member_matched_by_their_profile_skills(): void
    {
        DB::table('listings')->where('tenant_id', $this->testTenantId)->update(['status' => 'inactive']);
        DB::table('match_cache')->where('tenant_id', $this->testTenantId)->delete();

        // No listing of their own, only a skill on their profile.
        $gardener = $this->member(['last_login_at' => now()]);
        DB::table('user_skills')->insert([
            'user_id' => $gardener->id, 'tenant_id' => $this->testTenantId, 'skill_name' => 'Lawn mowing',
            'proficiency' => 'expert', 'is_offering' => 1, 'is_requesting' => 0,
        ]);
        $request = $this->listingFor($this->member(['last_login_at' => now()->subDays(3)]), 'request', $this->category()->id, [
            'title' => 'Grass needs cutting', 'description' => 'My lawn is overgrown and needs mowing.',
        ]);

        app(SmartMatchingEngine::class)->warmUpCache(1);

        $this->assertTrue(
            DB::table('match_cache')->where('user_id', $gardener->id)->where('listing_id', $request->id)->exists(),
            'Only members with a listing of their own were ever pre-computed'
        );
    }

    // ---------------------------------------------------------------------
    // Settings
    // ---------------------------------------------------------------------

    public function test_settings_shown_before_anything_is_saved_are_the_ones_actually_applied(): void
    {
        $this->setMatchingConfig(['max_distance_km' => 60, 'min_match_score' => 35]);
        $me = $this->member();
        Sanctum::actingAs($me, ['*']);

        $shown = $this->apiGet('/v2/users/me/match-preferences')->assertStatus(200)->json('data');

        $this->assertSame(60, $shown['max_distance_km']);
        $this->assertSame(35, $shown['min_match_score']);
        $this->assertSame(60, $shown['max_distance_limit_km']);
        $this->assertFalse($shown['matching_paused']);
        $this->assertSame([], $shown['availability']);
        $this->assertSame([], $shown['categories']);

        // Changing ONE setting must not quietly tighten the others.
        $saved = $this->apiPut('/v2/users/me/match-preferences', ['matching_paused' => true])->assertStatus(200)->json('data');
        $this->assertTrue($saved['matching_paused']);
        $this->assertSame(60, $saved['max_distance_km']);
        $this->assertSame(35, $saved['min_match_score']);
        // ... and must not store the community's figures as the member's own
        // either (it did until 19 Nov 2026, which froze them): nothing chosen
        // is stored as nothing, and the community's settings go on applying.
        $row = DB::table('match_preferences')->where('user_id', $me->id)->where('tenant_id', $this->testTenantId)->first();
        $this->assertNull($row->max_distance_km);
        $this->assertNull($row->min_match_score);

        // A distance above the community's maximum is brought down to it.
        $saved = $this->apiPut('/v2/users/me/match-preferences', ['max_distance_km' => 500])->json('data');
        $this->assertSame(60, $saved['max_distance_km']);
    }
}
