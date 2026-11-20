<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Matching;

use App\Models\Category;
use App\Models\Listing;
use App\Models\User;
use App\Services\SmartMatchingEngine;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * What the engine knows about a member's skills beyond the bare list
 * (20 Nov 2026): how good they say they are, whether other members have
 * endorsed the skill, and the help they have actually given.
 */
class MatchingSkillIntelligenceTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        app(SmartMatchingEngine::class)->clearCache();
    }

    private function member(array $attrs = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active', 'is_approved' => 1,
            'latitude' => 51.5000, 'longitude' => -0.1200, 'last_active_at' => now(),
        ], $attrs));
    }

    private function category(): Category
    {
        return Category::factory()->create([
            'tenant_id' => $this->testTenantId, 'type' => 'listing', 'name' => 'Gardening ' . uniqid(),
        ]);
    }

    private function listingFor(User $owner, string $type, Category $category, array $attrs = []): Listing
    {
        return Listing::factory()->forTenant($this->testTenantId)->create(array_merge([
            'user_id' => $owner->id, 'type' => $type, 'status' => 'active', 'moderation_status' => 'approved',
            'category_id' => $category->id, 'title' => 'Hedge needs trimming',
            'description' => 'My hedge is overgrown and needs trimming.',
            'latitude' => 51.5000, 'longitude' => -0.1200, 'service_type' => 'physical_only',
            'created_at' => now()->subDays(5),
        ], $attrs));
    }

    private function skill(User $member, string $name, string $proficiency): int
    {
        return (int) DB::table('user_skills')->insertGetId([
            'user_id' => $member->id, 'tenant_id' => $this->testTenantId, 'skill_name' => $name,
            'proficiency' => $proficiency, 'is_offering' => 1, 'is_requesting' => 0,
        ]);
    }

    /** @return array<string, mixed>|null */
    private function matchFor(User $member, Listing $listing): ?array
    {
        $matches = app(SmartMatchingEngine::class)->findMatchesForUser($member->id, ['min_score' => 0, 'limit' => 50]);

        return collect($matches)->firstWhere('id', $listing->id);
    }

    public function test_an_endorsed_expert_is_matched_more_strongly_than_a_beginner(): void
    {
        $request = $this->listingFor($this->member(), 'request', $this->category());
        $expert = $this->member();
        $skillId = $this->skill($expert, 'Hedge trimming', 'expert');
        foreach (range(1, 2) as $n) {
            DB::table('skill_endorsements')->insert([
                'endorser_id' => $this->member()->id, 'endorsed_id' => $expert->id, 'skill_id' => $skillId,
                'skill_name' => 'Hedge trimming', 'tenant_id' => $this->testTenantId,
            ]);
        }
        $beginner = $this->member();
        $this->skill($beginner, 'Hedge trimming', 'beginner');

        $forExpert = $this->matchFor($expert, $request);
        $forBeginner = $this->matchFor($beginner, $request);

        $this->assertNotNull($forExpert);
        $this->assertNotNull($forBeginner);
        $this->assertGreaterThan(
            $forBeginner['match_score'],
            $forExpert['match_score'],
            'An expert whose skill two members endorsed scored the same as a beginner'
        );
        $this->assertGreaterThan(0, $forExpert['score_breakdown']['adjustments']['skill_evidence'] ?? 0);
    }

    private function completedExchange(User $helper, Listing $requestListing, array $attrs = []): void
    {
        // The helper answered someone's request: on a request listing the
        // listing owner is the "provider" column and the helper the "requester".
        DB::table('exchange_requests')->insert(array_merge([
            'tenant_id' => $this->testTenantId, 'listing_id' => $requestListing->id,
            'requester_id' => $helper->id, 'provider_id' => $requestListing->user_id,
            'proposed_hours' => 2, 'status' => 'completed', 'completed_at' => now()->subDays(30),
            'created_at' => now()->subDays(40),
        ], $attrs));
    }

    public function test_help_a_member_has_given_before_counts_as_something_they_can_do(): void
    {
        $category = $this->category();
        $helper = $this->member(); // no listing, no skills on their profile
        $done = $this->listingFor($this->member(), 'request', $category, [
            'title' => 'Hedge trimming for my garden', 'status' => 'completed',
        ]);
        $this->completedExchange($helper, $done);
        $new = $this->listingFor($this->member(), 'request', $category, ['title' => 'Hedge needs trimming']);

        $match = $this->matchFor($helper, $new);

        $this->assertNotNull($match, 'A member who has done this very thing, but never listed a skill, was matched with nothing');
        $this->assertNotSame('cold_start', $match['match_type']);
        $this->assertStringStartsWith('For help you have given before: ', $match['match_reasons'][0]);
    }

    public function test_help_that_was_rated_poorly_is_not_counted(): void
    {
        $category = $this->category();
        $helper = $this->member();
        $done = $this->listingFor($this->member(), 'request', $category, [
            'title' => 'Hedge trimming for my garden', 'status' => 'completed',
        ]);
        // The person helped rated it 1 out of 5.
        $this->completedExchange($helper, $done, ['provider_rating' => 1]);
        $new = $this->listingFor($this->member(), 'request', $category, ['title' => 'Hedge needs trimming']);

        $match = $this->matchFor($helper, $new);

        $this->assertTrue($match === null || $match['match_type'] === 'cold_start');
    }

    public function test_a_member_known_only_by_help_they_gave_is_alerted_to_a_new_request(): void
    {
        $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('configuration');
        $config = is_string($raw) ? (json_decode($raw, true) ?: []) : [];
        $config['algorithms']['smart_matching']['hot_match_threshold'] = 45;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['configuration' => json_encode($config)]);
        app(SmartMatchingEngine::class)->clearCache();

        $category = $this->category();
        $helper = $this->member();
        $done = $this->listingFor($this->member(), 'request', $category, [
            'title' => 'Hedge trimming for my garden', 'status' => 'completed',
        ]);
        $this->completedExchange($helper, $done);
        $this->listingFor($this->member(), 'request', $category, ['title' => 'Hedge needs trimming', 'created_at' => now()]);

        app(\App\Services\Matching\MatchNotificationService::class)->notifyForNewListings();

        $this->assertGreaterThanOrEqual(
            1,
            DB::table('notifications')->where('user_id', $helper->id)->whereIn('type', ['hot_match', 'mutual_match'])->count(),
            'Only members with a listing or a profile skill were ever considered for an alert'
        );
    }
}
