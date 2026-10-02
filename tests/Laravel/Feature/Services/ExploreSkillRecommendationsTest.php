<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Services;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\ExploreService;
use App\Services\MatchLearningService;
use App\Services\SmartMatchingEngine;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Explore's "Recommended for you" listings, driven by the member's own skills
 * (user_skills) — the list the onboarding wizard and Settings → Skills fill.
 *
 * A brand-new member has no listings, so the matching engine has nothing to
 * match from; their skills are the only signal Explore has for them.
 */
class ExploreSkillRecommendationsTest extends TestCase
{
    use DatabaseTransactions;

    private ExploreService $service;
    private int $memberId;
    private int $neighbourId;

    protected function setUp(): void
    {
        parent::setUp();

        // Isolate the skills sources: no smart matches, no learning boost.
        $engine = \Mockery::mock(SmartMatchingEngine::class);
        $engine->shouldReceive('findMatchesForUser')->andReturn([]);
        $engine->shouldReceive('extractKeywords')->andReturn([]);
        $learning = \Mockery::mock(MatchLearningService::class);
        $learning->shouldReceive('getHistoricalBoost')->andReturn(0.0);
        $this->service = new ExploreService($engine, $learning);

        $this->memberId = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active'])->id;
        $this->neighbourId = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active'])->id;
        TenantContext::setById($this->testTenantId);
    }

    private function skill(int $userId, string $name, bool $offering, bool $requesting): void
    {
        DB::table('user_skills')->insert([
            'user_id' => $userId, 'tenant_id' => $this->testTenantId, 'skill_name' => $name,
            'proficiency' => 'intermediate', 'is_offering' => (int) $offering, 'is_requesting' => (int) $requesting,
        ]);
    }

    private function category(string $name, ?int $tenantId = null): int
    {
        return (int) DB::table('categories')->insertGetId([
            'tenant_id' => $tenantId ?? $this->testTenantId,
            'name' => $name,
            'slug' => 'explore-skill-' . uniqid(),
        ]);
    }

    private function listing(int $userId, string $title, string $type, ?int $categoryId = null, ?int $tenantId = null): int
    {
        return (int) DB::table('listings')->insertGetId([
            'tenant_id' => $tenantId ?? $this->testTenantId,
            'user_id' => $userId,
            'title' => $title,
            'description' => 'Test listing for Explore skill recommendations.',
            'type' => $type,
            'status' => 'active',
            'category_id' => $categoryId,
            'created_at' => now(),
        ]);
    }

    /** @return array<int, array<string, mixed>> keyed by listing id */
    private function recommended(): array
    {
        $method = new \ReflectionMethod(ExploreService::class, 'getRecommendedListings');
        $method->setAccessible(true);
        $rows = $method->invoke($this->service, $this->testTenantId, $this->memberId);

        return array_column($rows, null, 'id');
    }

    public function test_a_need_brings_up_offers_named_after_it(): void
    {
        $this->skill($this->memberId, 'Dog walking', false, true);
        $offer = $this->listing($this->neighbourId, 'Happy to do dog walking at weekends', 'offer');

        $recs = $this->recommended();

        $this->assertArrayHasKey($offer, $recs);
        $this->assertSame('Offers help with something you need', $recs[$offer]['match_reason']);
    }

    public function test_a_need_brings_up_offers_in_the_category_of_the_same_name(): void
    {
        // The wizard suggests the community's listing categories, so a need
        // is often literally a category name.
        $this->skill($this->memberId, 'Home and Garden', false, true);
        $garden = $this->category('Home and Garden');
        $offer = $this->listing($this->neighbourId, 'Hedge trimming', 'offer', $garden);

        $this->assertArrayHasKey($offer, $this->recommended());
    }

    public function test_a_need_does_not_bring_up_requests_the_members_own_listings_or_other_communities(): void
    {
        $this->skill($this->memberId, 'Dog walking', false, true);
        $request = $this->listing($this->neighbourId, 'Looking for dog walking help', 'request');
        $own = $this->listing($this->memberId, 'I offer dog walking too', 'offer');
        $otherTenantUser = User::factory()->forTenant(999)->create(['status' => 'active'])->id;
        TenantContext::setById($this->testTenantId);
        $elsewhere = $this->listing($otherTenantUser, 'Dog walking in another community', 'offer', null, 999);

        $recs = $this->recommended();

        $this->assertArrayNotHasKey($request, $recs);
        $this->assertArrayNotHasKey($own, $recs);
        $this->assertArrayNotHasKey($elsewhere, $recs);
    }

    public function test_an_offered_skill_brings_up_listings_tagged_with_it(): void
    {
        // Until 2026-10-02 this source queried listing_skill_tags.skill_name,
        // a column that does not exist (it is `tag`); the error was swallowed
        // and the source never returned anything.
        $this->skill($this->memberId, 'Bookkeeping', true, false);
        $tagged = $this->listing($this->neighbourId, 'Help with my accounts', 'request');
        DB::table('listing_skill_tags')->insert([
            'tenant_id' => $this->testTenantId, 'listing_id' => $tagged, 'tag' => 'Bookkeeping',
        ]);

        $recs = $this->recommended();

        $this->assertArrayHasKey($tagged, $recs);
        // The listing can also arrive through collaborative filtering (+15),
        // whose reason is listed first, so assert the skill boost via the
        // score: without the tag match it would be 15 at most.
        $this->assertGreaterThanOrEqual(30, $recs[$tagged]['match_score']);
    }
}
