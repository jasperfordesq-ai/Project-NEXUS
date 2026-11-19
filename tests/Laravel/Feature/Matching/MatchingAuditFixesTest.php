<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Matching;

use App\Core\TenantContext;
use App\Models\Category;
use App\Models\Group;
use App\Models\Listing;
use App\Models\User;
use App\Services\CronJobRunner;
use App\Services\CrossModuleMatchingService;
use App\Services\Matching\CandidateRetriever;
use App\Services\Matching\MatchNotificationService;
use App\Services\Matching\TenantMatchingContext;
use App\Services\MatchingService;
use App\Services\MatchLearningService;
use App\Services\NotificationSettingsService;
use App\Services\SmartMatchingEngine;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * The faults found by the matching audit of 19 Nov 2026, each pinned against
 * a real database. All 324 matching tests passed while every one of these was
 * live, which is why each has its own test here.
 */
class MatchingAuditFixesTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        app(SmartMatchingEngine::class)->clearCache();
    }

    protected function tearDown(): void
    {
        TenantContext::setById($this->testTenantId);
        app(SmartMatchingEngine::class)->clearCache();
        parent::tearDown();
    }

    private function setMatchingConfig(int $tenantId, array $changes): void
    {
        $raw = DB::table('tenants')->where('id', $tenantId)->value('configuration');
        $config = is_string($raw) ? (json_decode($raw, true) ?: []) : [];
        $config['algorithms']['smart_matching'] = array_merge($config['algorithms']['smart_matching'] ?? [], $changes);
        DB::table('tenants')->where('id', $tenantId)->update(['configuration' => json_encode($config)]);
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

    // ---------------------------------------------------------------------
    // One community's settings must never be used for another
    // ---------------------------------------------------------------------

    public function test_each_community_reads_its_own_matching_settings_within_one_process(): void
    {
        $other = (int) DB::table('tenants')->where('id', '!=', $this->testTenantId)->orderBy('id')->value('id');
        $this->assertGreaterThan(0, $other, 'This test needs a second community in the test database');

        $this->setMatchingConfig($this->testTenantId, ['enabled' => true, 'hot_match_threshold' => 80]);
        $this->setMatchingConfig($other, ['enabled' => false, 'hot_match_threshold' => 95]);

        // The alert and digest jobs walk every community in ONE process,
        // with one shared engine, exactly like this.
        $engine = app(SmartMatchingEngine::class);
        TenantContext::setById($this->testTenantId);
        $this->assertTrue($engine->isEnabled());

        TenantContext::setById($other);
        $this->assertFalse(
            app(SmartMatchingEngine::class)->isEnabled(),
            'The second community was given the first one\'s "matching on" switch'
        );
        $this->assertSame(95, (int) app(SmartMatchingEngine::class)->getConfig()['hot_match_threshold']);
    }

    // ---------------------------------------------------------------------
    // A member who never chose a distance or a minimum follows the community
    // ---------------------------------------------------------------------

    public function test_saving_notification_settings_does_not_narrow_a_members_matches(): void
    {
        $this->setMatchingConfig($this->testTenantId, ['max_distance_km' => 60, 'min_match_score' => 35]);
        app(SmartMatchingEngine::class)->clearCache();
        $member = $this->member();

        app(NotificationSettingsService::class)->updateAtomically(
            $member->id,
            $this->testTenantId,
            [],
            ['notification_frequency' => 'monthly', 'notify_hot_matches' => true, 'notify_mutual_matches' => true],
            'monthly',
        );

        $prefs = MatchingService::getPreferences($member->id);
        $this->assertSame(60, $prefs['max_distance_km'], 'The database default of 25 km was taken as the member\'s own choice');
        $this->assertSame(35, $prefs['min_match_score'], 'The database default of 50% was taken as the member\'s own choice');
        $this->assertSame(35.0, app(SmartMatchingEngine::class)->effectiveMinScore($member->id));
        $this->assertSame('monthly', $prefs['notification_frequency']);
    }

    public function test_saving_one_match_setting_does_not_freeze_the_communitys_distance_and_minimum(): void
    {
        $member = $this->member();
        Sanctum::actingAs($member, ['*']);

        $this->apiPut('/v2/users/me/match-preferences', ['matching_paused' => true])->assertStatus(200);

        $row = DB::table('match_preferences')->where('user_id', $member->id)->where('tenant_id', $this->testTenantId)->first();
        $this->assertNotNull($row);
        $this->assertSame(1, (int) $row->matching_paused);
        $this->assertNull($row->max_distance_km, 'A distance the member never chose was stored as their own');
        $this->assertNull($row->min_match_score, 'A minimum the member never chose was stored as their own');

        // ... so a later change by the community still reaches them.
        $this->setMatchingConfig($this->testTenantId, ['min_match_score' => 30]);
        app(SmartMatchingEngine::class)->clearCache();
        $this->assertSame(30, MatchingService::getPreferences($member->id)['min_match_score']);
    }

    // ---------------------------------------------------------------------
    // Alerts and digests
    // ---------------------------------------------------------------------

    public function test_a_strong_match_alert_email_is_queued_to_go_now_not_with_a_later_digest(): void
    {
        $this->setMatchingConfig($this->testTenantId, ['hot_match_threshold' => 60]);
        app(SmartMatchingEngine::class)->clearCache();
        $category = $this->category();
        $me = $this->member();
        $this->listingFor($me, 'offer', $category, ['created_at' => now()->subDays(10)]);
        $neighbour = $this->member(['first_name' => 'Orla']);
        $this->listingFor($neighbour, 'request', $category, ['title' => 'Hedge needs trimming']);

        app(MatchNotificationService::class)->notifyForNewListings();

        $email = DB::table('notification_queue')->where('user_id', $me->id)->where('activity_type', 'hot_match')->first();
        $this->assertNotNull($email);
        $this->assertSame(
            'instant',
            (string) $email->frequency,
            'Queued under a digest frequency, the alert email is replaced by one plain line, weeks later, or never sent'
        );
        $this->assertStringContainsString('Hedge needs trimming', (string) $email->email_body);
        $this->assertStringNotContainsString('&amp;bull;', (string) $email->email_body, 'The dot between two reasons was printed as the text "&bull;"');
    }

    public function test_the_digest_reaches_members_beyond_the_first_two_hundred(): void
    {
        // 200 members who joined earlier (lower ids), each eligible for the
        // monthly digest through a profile skill.
        User::factory()->forTenant($this->testTenantId)->count(200)->create([
            'status' => 'active',
            'is_approved' => 1,
            'skills' => 'zzzfillerskill',
            'last_active_at' => now(),
        ]);

        $category = $this->category();
        $me = $this->member();
        $this->listingFor($me, 'offer', $category, ['created_at' => now()->subDays(40)]);
        $neighbour = $this->member();
        $this->listingFor($neighbour, 'request', $category, ['title' => 'Hedge needs trimming', 'created_at' => now()->subDays(2)]);

        app(MatchNotificationService::class)->sendDigests('monthly');

        $this->assertSame(
            1,
            DB::table('notifications')->where('user_id', $me->id)->where('type', 'match_digest')->count(),
            'Only the 200 longest-standing members were ever considered for a digest'
        );
    }

    public function test_the_fortnightly_digest_runs_every_second_monday_across_a_53_week_year(): void
    {
        $runs = fn (string $date): bool => CronJobRunner::isFortnightlyMatchDigestDay(new \DateTimeImmutable($date . ' 09:00:00'));

        $this->assertTrue($runs('2026-11-23'));
        $this->assertFalse($runs('2026-11-30'));
        $this->assertTrue($runs('2026-12-07'));
        $this->assertTrue($runs('2026-12-21'));
        $this->assertFalse($runs('2026-12-28'));
        // ISO week 1 of 2027: skipped by "even week numbers only", which left
        // three weeks between digests that each look back two.
        $this->assertTrue($runs('2027-01-04'));
        $this->assertFalse($runs('2027-01-11'));
        $this->assertTrue($runs('2027-01-18'));
        $this->assertFalse($runs('2026-12-08'), 'Only Mondays');
    }

    // ---------------------------------------------------------------------
    // "Not interested"
    // ---------------------------------------------------------------------

    public function test_hiding_a_match_as_too_far_is_not_held_against_its_owner_or_its_category(): void
    {
        $category = $this->category();
        $me = $this->member();
        $neighbour = $this->member();
        $listing = $this->listingFor($neighbour, 'request', $category);
        Sanctum::actingAs($me, ['*']);

        $this->apiPost("/v2/matches/{$listing->id}/dismiss", ['reason' => 'too_far'])->assertStatus(200);

        $this->assertTrue(DB::table('match_dismissals')->where('user_id', $me->id)->where('listing_id', $listing->id)->exists());
        $this->assertSame(
            0,
            DB::table('match_history')->where('user_id', $me->id)->where('listing_id', $listing->id)->where('action', 'dismiss')->count(),
            '"Too far" says nothing about the member or the kind of help'
        );
        $this->assertSame([], app(MatchLearningService::class)->getCategoryAffinities($me->id));
    }

    public function test_hiding_a_match_as_not_relevant_is_still_learned_from(): void
    {
        $category = $this->category();
        $me = $this->member();
        $listing = $this->listingFor($this->member(), 'request', $category);
        Sanctum::actingAs($me, ['*']);

        $this->apiPost("/v2/matches/{$listing->id}/dismiss", ['reason' => 'not_relevant'])->assertStatus(200);

        $this->assertSame(
            1,
            DB::table('match_history')->where('user_id', $me->id)->where('listing_id', $listing->id)->where('action', 'dismiss')->count()
        );
    }

    public function test_one_dismissal_does_not_count_as_a_settled_dislike_of_the_whole_category(): void
    {
        $category = $this->category();
        $me = $this->member();
        $listing = $this->listingFor($this->member(), 'request', $category);

        app(MatchLearningService::class)->recordInteraction($me->id, $listing->id, 'dismissed', []);

        $affinity = app(MatchLearningService::class)->getCategoryAffinities($me->id)[$category->id] ?? null;
        $this->assertNotNull($affinity);
        $this->assertLessThan(0.0, $affinity);
        $this->assertGreaterThan(
            -0.5,
            $affinity,
            'One click took the full five points off every listing in the category'
        );
    }

    public function test_three_too_far_dismissals_do_not_hide_everything_a_member_has_posted(): void
    {
        $category = $this->category();
        $me = $this->member();
        $neighbour = $this->member();
        $fourth = null;
        foreach (range(1, 4) as $n) {
            $listing = $this->listingFor($neighbour, 'request', $category);
            if ($n <= 3) {
                DB::table('match_dismissals')->insert([
                    'tenant_id' => $this->testTenantId, 'user_id' => $me->id,
                    'listing_id' => $listing->id, 'reason' => 'too_far', 'created_at' => now(),
                ]);
            } else {
                $fourth = $listing;
            }
        }

        $candidates = app(CandidateRetriever::class)->retrieveBatch(
            $this->testTenantId, $me->id, 'request', [], null, 51.5, -0.12, 50.0,
            ['geo_hard_gate' => true, 'dormancy_days' => 90, 'owner_dismissal_threshold' => 3]
        );

        $this->assertContains((int) $fourth->id, array_map(fn ($c) => (int) $c['id'], $candidates));
    }

    public function test_a_too_far_dismissal_does_not_mark_down_the_same_members_other_listings(): void
    {
        $category = $this->category();
        $me = $this->member();
        $this->listingFor($me, 'offer', $category, ['created_at' => now()->subDays(10)]);
        $neighbour = $this->member();
        $hidden = $this->listingFor($neighbour, 'request', $category, ['title' => 'Hedge needs trimming']);
        $other = $this->listingFor($neighbour, 'request', $category, ['title' => 'Lawn needs mowing']);
        DB::table('match_dismissals')->insert([
            'tenant_id' => $this->testTenantId, 'user_id' => $me->id,
            'listing_id' => $hidden->id, 'reason' => 'too_far', 'created_at' => now(),
        ]);

        $matches = app(SmartMatchingEngine::class)->findMatchesForUser($me->id, ['min_score' => 0, 'limit' => 50]);

        $match = collect($matches)->firstWhere('id', $other->id);
        $this->assertNotNull($match);
        $this->assertArrayNotHasKey('dismissed_similar', $match['score_breakdown']['adjustments'] ?? []);
    }

    // ---------------------------------------------------------------------
    // Pause, and what counts towards trust
    // ---------------------------------------------------------------------

    public function test_a_paused_member_is_shown_no_matches_of_any_kind(): void
    {
        $me = $this->member();
        $group = Group::factory()->create([
            'tenant_id' => $this->testTenantId,
            'status' => 'active',
            'visibility' => 'public',
        ]);
        DB::table('group_match_cache')->insert([
            'tenant_id' => $this->testTenantId, 'user_id' => $me->id, 'group_id' => $group->id,
            'match_score' => 90, 'match_reasons' => '[]', 'algorithm_version' => 'v2', 'status' => 'new',
            'created_at' => now(), 'expires_at' => now()->addDays(7),
        ]);
        $service = app(CrossModuleMatchingService::class);

        // Not paused: the group is offered (so the next assertion means something).
        $before = $service->getAllMatches($me->id, ['modules' => ['groups'], 'min_score' => 0]);
        if ($before['matches'] === []) {
            $this->markTestSkipped('Groups are switched off for the test community');
        }

        DB::table('match_preferences')->insert([
            'user_id' => $me->id, 'tenant_id' => $this->testTenantId, 'matching_paused' => 1,
        ]);

        $paused = $service->getAllMatches($me->id, ['modules' => ['listings', 'groups'], 'min_score' => 0]);
        $this->assertTrue($paused['meta']['paused']);
        $this->assertSame([], $paused['matches'], '"Pause matching" paused offers and requests only');
    }

    public function test_only_published_reviews_count_towards_a_members_trust(): void
    {
        $me = $this->member();
        $owner = $this->member();
        foreach (['rejected', 'pending', 'approved'] as $status) {
            DB::table('reviews')->insert([
                'tenant_id' => $this->testTenantId,
                'reviewer_id' => $this->member()->id,
                'receiver_id' => $owner->id,
                'rating' => $status === 'approved' ? 4 : 5,
                'status' => $status,
                'created_at' => now(),
            ]);
        }

        $context = TenantMatchingContext::load($this->testTenantId, $me->id, [$owner->id]);

        $this->assertSame(1, $context->owner($owner->id)['rating_count'], 'A review a moderator rejected still counted');
        $this->assertSame(4.0, $context->owner($owner->id)['rating_avg']);
    }
}
