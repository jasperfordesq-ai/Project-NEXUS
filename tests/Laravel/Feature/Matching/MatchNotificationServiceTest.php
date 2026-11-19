<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Matching;

use App\Models\Category;
use App\Models\Listing;
use App\Models\User;
use App\Services\Matching\MatchNotificationService;
use App\Services\SafeguardingTriggerService;
use App\Services\SmartMatchingEngine;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Match alerts and the match digest, against a real database.
 *
 * Before 17 Nov 2026 neither was ever sent: the hourly alert ended in a stub
 * that returned 0, and the digest crashed on every member behind a bare catch
 * (and would have emailed RANDOM members as "matches" had it not). There was
 * no test of either, which is why nobody knew.
 */
class MatchNotificationServiceTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        // A newcomer's best possible match scores in the seventies, so bring
        // the "hot" bar within reach for these fixtures.
        $this->setMatchingConfig(['hot_match_threshold' => 60]);
    }

    private function setMatchingConfig(array $changes): void
    {
        $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('configuration');
        $config = is_string($raw) ? (json_decode($raw, true) ?: []) : [];
        $config['algorithms']['smart_matching'] = array_merge($config['algorithms']['smart_matching'] ?? [], $changes);
        DB::table('tenants')->where('id', $this->testTenantId)->update(['configuration' => json_encode($config)]);
        app(SmartMatchingEngine::class)->clearCache();
    }

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

    private function listingFor(User $owner, string $type, Category $category, array $attrs = []): Listing
    {
        return Listing::factory()->forTenant($this->testTenantId)->create(array_merge([
            'user_id' => $owner->id,
            'type' => $type,
            'status' => 'active',
            'moderation_status' => 'approved',
            'category_id' => $category->id,
            'title' => 'Gardening help ' . uniqid(),
            'description' => 'Weeding, mowing and hedge trimming in the garden every week.',
            'latitude' => 51.5000,
            'longitude' => -0.1200,
            'service_type' => 'physical_only',
            'created_at' => now(),
        ], $attrs));
    }

    private function savePreferences(User $member, array $values): void
    {
        DB::table('match_preferences')->updateOrInsert(
            ['user_id' => $member->id, 'tenant_id' => $this->testTenantId],
            array_merge(['updated_at' => now()], $values),
        );
    }

    /** @return \Illuminate\Support\Collection<int, object> */
    private function notices(User $member, string $type)
    {
        return DB::table('notifications')->where('user_id', $member->id)->where('type', $type)->get();
    }

    private function service(): MatchNotificationService
    {
        return app(MatchNotificationService::class);
    }

    // ---------------------------------------------------------------------
    // The alert for a strong match with a newly posted listing
    // ---------------------------------------------------------------------

    public function test_a_member_is_alerted_once_to_a_strong_match_with_a_new_listing(): void
    {
        $category = $this->category();
        $me = $this->member();
        $this->listingFor($me, 'offer', $category, ['created_at' => now()->subDays(10)]);
        $neighbour = $this->member(['first_name' => 'Orla', 'last_name' => 'Zzyzxsurname']);
        $posted = $this->listingFor($neighbour, 'request', $category, ['title' => 'Hedge needs trimming']);

        $sent = $this->service()->notifyForNewListings();

        $this->assertGreaterThanOrEqual(1, $sent);
        $mine = $this->notices($me, 'hot_match');
        $this->assertCount(1, $mine, 'The scheduled alert ended in a stub that returned 0: nothing was ever sent');
        $this->assertStringContainsString('Hedge needs trimming', (string) $mine[0]->message);
        $this->assertSame("/matches?highlight=listing-{$posted->id}", $mine[0]->link);
        $this->assertStringContainsString('Orla', (string) $mine[0]->message);
        $this->assertStringNotContainsString('Zzyzxsurname', (string) $mine[0]->message, 'A match alert never carries a surname');

        $email = DB::table('notification_queue')->where('user_id', $me->id)->where('activity_type', 'hot_match')->first();
        $this->assertNotNull($email);
        $this->assertStringContainsString('Hedge needs trimming', (string) $email->email_body);
        $this->assertStringNotContainsString('Zzyzxsurname', (string) $email->email_body);

        $this->assertTrue(DB::table('match_notification_sent')->where('tenant_id', $this->testTenantId)
            ->where('listing_id', $posted->id)->where('matched_user_id', $me->id)->exists());

        // The next hourly run must not tell them again, even with the
        // "already worked through" marker gone.
        Cache::flush();
        $this->service()->notifyForNewListings();
        $this->assertCount(1, $this->notices($me, 'hot_match'));
    }

    public function test_a_member_with_no_listing_is_alerted_through_the_skills_on_their_profile(): void
    {
        $this->setMatchingConfig(['hot_match_threshold' => 45]);
        $category = $this->category();
        $gardener = $this->member();
        DB::table('user_skills')->insert([
            'user_id' => $gardener->id, 'tenant_id' => $this->testTenantId, 'skill_name' => 'Lawn mowing',
            'proficiency' => 'expert', 'is_offering' => 1, 'is_requesting' => 0,
        ]);
        $posted = $this->listingFor($this->member(), 'request', $category, [
            'title' => 'Grass needs cutting', 'description' => 'My lawn is overgrown and needs mowing.',
        ]);

        $this->service()->notifyForNewListings();

        $this->assertCount(1, $this->notices($gardener, 'hot_match'), 'Members without a listing were never even considered');
        $this->assertTrue(DB::table('match_notification_sent')->where('listing_id', $posted->id)
            ->where('matched_user_id', $gardener->id)->exists());
    }

    public function test_a_member_with_a_listing_is_alerted_through_a_skill_too(): void
    {
        // They have posted a request of their own, so they were only ever
        // considered for offers answering it. Their profile says they garden.
        $this->setMatchingConfig(['hot_match_threshold' => 75]);
        $gardener = $this->member();
        $this->listingFor($gardener, 'request', $this->category('Technology'), [
            'title' => 'Help setting up my new phone', 'description' => 'I cannot get my email working on it.',
            'created_at' => now()->subDays(10),
        ]);
        DB::table('user_skills')->insert([
            'user_id' => $gardener->id, 'tenant_id' => $this->testTenantId, 'skill_name' => 'Gardening',
            'proficiency' => 'advanced', 'is_offering' => 1, 'is_requesting' => 0,
        ]);
        $posted = $this->listingFor($this->member(), 'request', $this->category('Home and garden'), [
            'title' => 'Help with my garden', 'description' => 'Weeding and mowing once a fortnight.',
        ]);

        $this->service()->notifyForNewListings();

        $this->assertCount(1, $this->notices($gardener, 'hot_match'));
        $this->assertTrue(DB::table('match_notification_sent')->where('listing_id', $posted->id)
            ->where('matched_user_id', $gardener->id)->exists());
    }

    public function test_no_alert_when_the_member_turned_them_off_paused_matching_or_asked_for_no_notifications(): void
    {
        $category = $this->category();
        $off = $this->member();
        $this->listingFor($off, 'offer', $category);
        $this->savePreferences($off, ['notify_hot_matches' => 0, 'notify_mutual_matches' => 0]);
        $never = $this->member();
        $this->listingFor($never, 'offer', $category);
        $this->savePreferences($never, ['notification_frequency' => 'never']);
        $paused = $this->member();
        $this->listingFor($paused, 'offer', $category);
        $this->savePreferences($paused, ['matching_paused' => 1]);
        $control = $this->member();
        $this->listingFor($control, 'offer', $category);

        $this->listingFor($this->member(), 'request', $category);
        $this->service()->notifyForNewListings();

        $this->assertCount(1, $this->notices($control, 'hot_match'), 'Control: a member with default settings is alerted');
        $this->assertCount(0, $this->notices($off, 'hot_match'));
        $this->assertCount(0, $this->notices($never, 'hot_match'));
        $this->assertCount(0, $this->notices($paused, 'hot_match'));
    }

    public function test_no_alert_when_the_community_has_matching_switched_off(): void
    {
        $category = $this->category();
        $me = $this->member();
        $this->listingFor($me, 'offer', $category);
        $this->listingFor($this->member(), 'request', $category);
        $this->setMatchingConfig(['enabled' => false]);

        $this->assertSame(0, $this->service()->notifyForNewListings());
        $this->assertSame(0, $this->service()->sendDigests('monthly'));
        $this->assertCount(0, $this->notices($me, 'hot_match'));
        $this->assertCount(0, $this->notices($me, 'match_digest'));
    }

    public function test_a_two_way_match_below_the_hot_bar_gets_the_mutual_alert(): void
    {
        $this->setMatchingConfig(['hot_match_threshold' => 100]);
        $gardening = $this->category('Gardening');
        $cooking = $this->category('Cooking');
        $me = $this->member();
        $this->listingFor($me, 'offer', $gardening, ['title' => 'I can mow lawns']);
        $this->listingFor($me, 'request', $cooking, ['title' => 'Bread baking lessons wanted', 'description' => 'Baking bread at home.']);
        $neighbour = $this->member();
        $this->listingFor($neighbour, 'offer', $cooking, ['title' => 'Bread baking lessons', 'description' => 'Baking bread at home.']);
        $this->listingFor($neighbour, 'request', $gardening, ['title' => 'Lawn needs mowing']);

        $this->service()->notifyForNewListings();

        $this->assertCount(0, $this->notices($me, 'hot_match'));
        $mutual = $this->notices($me, 'mutual_match');
        $this->assertGreaterThanOrEqual(1, $mutual->count());
        $this->assertStringContainsString('/matches?type=mutual&highlight=listing-', (string) $mutual[0]->link);
    }

    public function test_the_two_way_alert_names_the_two_listings_that_answer_each_other(): void
    {
        $this->setMatchingConfig(['hot_match_threshold' => 100]);
        // No two of the four listings share a category, and each member has
        // an older, unrelated offer as well: picking "their first offer" by
        // category, as the alert used to, would name the wrong one.
        $me = $this->member();
        $this->listingFor($me, 'offer', $this->category('Languages'), [
            'title' => 'French conversation practice', 'description' => 'Speaking French over coffee.',
            'created_at' => now()->subDays(5),
        ]);
        $this->listingFor($me, 'offer', $this->category('Stars'), [
            'title' => 'Telescope evenings', 'description' => 'Star gazing on clear nights.',
            'created_at' => now()->subDays(2),
        ]);
        $this->listingFor($me, 'request', $this->category('Home'), [
            'title' => 'Lawn needs mowing', 'description' => 'The grass is long.',
            'created_at' => now()->subDays(5),
        ]);
        $neighbour = $this->member();
        $this->listingFor($neighbour, 'request', $this->category('Education'), [
            'title' => 'French lessons wanted', 'description' => 'Learning French before a holiday.',
            'created_at' => now()->subDays(5),
        ]);
        $this->listingFor($neighbour, 'offer', $this->category('Odd jobs'), [
            'title' => 'I can mow lawns', 'description' => 'I have my own mower.',
        ]);

        $this->service()->notifyForNewListings();

        $mutual = $this->notices($me, 'mutual_match');
        $this->assertCount(1, $mutual);
        $this->assertStringContainsString('I can mow lawns', (string) $mutual[0]->message);
        $this->assertStringContainsString('French conversation practice', (string) $mutual[0]->message);
        $this->assertStringNotContainsString('Telescope', (string) $mutual[0]->message);
    }

    public function test_no_two_way_alert_for_members_who_only_share_categories(): void
    {
        $this->setMatchingConfig(['hot_match_threshold' => 100]);
        $general = $this->category('General');
        $me = $this->member();
        $this->listingFor($me, 'request', $general, ['title' => 'Chess partner wanted', 'description' => 'A game of chess now and then.']);
        $this->listingFor($me, 'offer', $general, ['title' => 'Telescope evenings', 'description' => 'Star gazing on clear nights.']);
        $neighbour = $this->member();
        $this->listingFor($neighbour, 'offer', $general, ['title' => 'Origami workshop', 'description' => 'Paper folding for all ages.']);
        $this->listingFor($neighbour, 'request', $general, ['title' => 'Beekeeping advice', 'description' => 'Thinking of keeping a hive.']);

        $this->service()->notifyForNewListings();

        $this->assertCount(0, $this->notices($me, 'mutual_match'), 'An offer and a request each in the same category used to be announced as a two-way match');
        $this->assertCount(0, $this->notices($neighbour, 'mutual_match'));
    }

    // ---------------------------------------------------------------------
    // Safeguarding: a notification can never go further than the page
    // ---------------------------------------------------------------------

    public function test_a_member_who_restricted_matching_is_never_named_in_an_alert_or_a_digest(): void
    {
        $category = $this->category();
        $me = $this->member();
        $this->listingFor($me, 'offer', $category);
        $restricted = $this->member();
        $optionId = DB::table('tenant_safeguarding_options')->insertGetId([
            'tenant_id' => $this->testTenantId, 'option_key' => 'notify_gate_' . uniqid(), 'option_type' => 'checkbox',
            'label' => 'Gate', 'description' => 'Gate', 'is_active' => 1, 'is_required' => 0, 'sort_order' => 0,
            'triggers' => json_encode(['restricts_matching' => true]), 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('user_safeguarding_preferences')->insert([
            'tenant_id' => $this->testTenantId, 'user_id' => $restricted->id, 'option_id' => $optionId,
            'selected_value' => '1', 'consent_given_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);
        SafeguardingTriggerService::invalidateCache($restricted->id, $this->testTenantId);
        $held = $this->listingFor($restricted, 'request', $category, ['title' => 'Private request title']);

        $this->service()->notifyForNewListings();
        $this->service()->sendDigests('monthly');

        $this->assertCount(0, $this->notices($me, 'hot_match'));
        $this->assertCount(0, $this->notices($me, 'match_digest'));
        $this->assertFalse(DB::table('notification_queue')->where('user_id', $me->id)
            ->where('email_body', 'like', '%Private request title%')->exists());
        $this->assertSame('pending', DB::table('match_approvals')->where('tenant_id', $this->testTenantId)
            ->where('user_id', $me->id)->where('listing_id', $held->id)->value('status'), 'It goes to the coordinators instead');
    }

    // ---------------------------------------------------------------------
    // The digest
    // ---------------------------------------------------------------------

    public function test_the_digest_lists_real_new_matches_and_is_not_repeated(): void
    {
        // Above the hot bar nothing else would have been alerted first.
        $this->setMatchingConfig(['hot_match_threshold' => 100]);
        $category = $this->category();
        $me = $this->member();
        $this->listingFor($me, 'offer', $category, ['created_at' => now()->subDays(40)]);
        $neighbour = $this->member(['first_name' => 'Niamh', 'last_name' => 'Zzyzxsurname']);
        $recent = $this->listingFor($neighbour, 'request', $category, ['title' => 'Roses need pruning', 'created_at' => now()->subDays(3)]);
        $old = $this->listingFor($this->member(), 'request', $category, ['title' => 'Posted long ago', 'created_at' => now()->subDays(45)]);
        // A member nobody matched with, to prove the digest is not "some members".
        $stranger = $this->member(['first_name' => 'Unrelatedstranger']);

        $this->assertSame(0, $this->service()->sendDigests('daily'), 'A member on the monthly digest is not sent the daily one');

        $sent = $this->service()->sendDigests('monthly');

        $this->assertGreaterThanOrEqual(1, $sent);
        $this->assertCount(1, $this->notices($me, 'match_digest'), 'The digest crashed on every member and never sent');
        $email = DB::table('notification_queue')->where('user_id', $me->id)->where('activity_type', 'match_digest')->first();
        $this->assertNotNull($email);
        $body = (string) $email->email_body;
        $this->assertStringContainsString('Roses need pruning', $body);
        $this->assertStringContainsString('Niamh', $body);
        $this->assertStringNotContainsString('Zzyzxsurname', $body, 'A digest never carries a surname');
        $this->assertStringNotContainsString('Posted long ago', $body, 'Only listings posted since the last digest');
        $this->assertStringNotContainsString('Unrelatedstranger', $body);
        $this->assertStringContainsString('/listings/' . $recent->id, $body);
        $this->assertStringNotContainsString('/listings/' . $old->id, $body);

        $this->service()->sendDigests('monthly');
        $this->assertCount(1, $this->notices($me, 'match_digest'), 'Nothing new, so no second digest');
    }

    public function test_the_digest_follows_the_frequency_the_member_chose(): void
    {
        $this->setMatchingConfig(['hot_match_threshold' => 100]);
        $category = $this->category();
        $daily = $this->member();
        $this->listingFor($daily, 'offer', $category, ['created_at' => now()->subDays(40)]);
        $this->savePreferences($daily, ['notification_frequency' => 'daily']);
        $never = $this->member();
        $this->listingFor($never, 'offer', $category, ['created_at' => now()->subDays(40)]);
        $this->savePreferences($never, ['notification_frequency' => 'never']);
        $this->listingFor($this->member(), 'request', $category, ['created_at' => now()->subHours(3)]);

        $this->service()->sendDigests('daily');
        $this->service()->sendDigests('fortnightly');
        $this->service()->sendDigests('monthly');

        $this->assertCount(1, $this->notices($daily, 'match_digest'));
        $this->assertCount(0, $this->notices($never, 'match_digest'));
    }
}
