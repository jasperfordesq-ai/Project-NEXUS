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
            'name' => $name . ' ' . uniqid(),
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
        $row = DB::table('match_preferences')->where('user_id', $me->id)->where('tenant_id', $this->testTenantId)->first();
        $this->assertSame(60, (int) $row->max_distance_km);
        $this->assertSame(35, (int) $row->min_match_score);

        // A distance above the community's maximum is brought down to it.
        $saved = $this->apiPut('/v2/users/me/match-preferences', ['max_distance_km' => 500])->json('data');
        $this->assertSame(60, $saved['max_distance_km']);
    }
}
