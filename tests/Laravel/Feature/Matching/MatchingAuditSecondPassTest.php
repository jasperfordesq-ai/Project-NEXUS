<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Matching;

use App\Models\Category;
use App\Models\Group;
use App\Models\Listing;
use App\Models\User;
use App\Services\CronJobRunner;
use App\Services\CrossModuleMatchingService;
use App\Services\GroupMatchingService;
use App\Services\Matching\MatchNotificationService;
use App\Services\SmartMatchingEngine;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Second pass over the matching audit of 19 Nov 2026: the faults left open
 * after the first fix commit, each pinned against a real database.
 */
class MatchingAuditSecondPassTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        app(SmartMatchingEngine::class)->clearCache();
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

    // ---------------------------------------------------------------------

    public function test_an_organisations_listing_is_shown_under_the_organisations_name(): void
    {
        $category = $this->category();
        $me = $this->member();
        $this->listingFor($me, 'offer', $category, ['created_at' => now()->subDays(10)]);
        $cafe = $this->member([
            'first_name' => 'Patricia', 'profile_type' => 'organisation', 'organization_name' => 'Acme Repair Cafe',
        ]);
        $this->listingFor($cafe, 'request', $category, ['title' => 'Hedge needs trimming']);

        $result = app(CrossModuleMatchingService::class)->getAllMatches($me->id, ['modules' => ['listings'], 'min_score' => 0]);

        $match = collect($result['matches'])->firstWhere('title', 'Hedge needs trimming');
        $this->assertNotNull($match);
        $this->assertSame('Acme Repair Cafe', $match['user_name'], 'The page showed the contact person\'s first name; the email shows the organisation');
    }

    public function test_a_chosen_category_that_was_later_switched_off_is_not_an_invisible_filter(): void
    {
        $gone = $this->category('Retired');
        $category = $this->category();
        $me = $this->member();
        $this->listingFor($me, 'offer', $category, ['created_at' => now()->subDays(10)]);
        $posted = $this->listingFor($this->member(), 'request', $category, ['title' => 'Hedge needs trimming']);
        DB::table('match_preferences')->insert([
            'user_id' => $me->id, 'tenant_id' => $this->testTenantId,
            'max_distance_km' => null, 'min_match_score' => null,
            'categories' => json_encode([$gone->id]),
        ]);
        DB::table('categories')->where('id', $gone->id)->update(['is_active' => 0]);

        $matches = app(SmartMatchingEngine::class)->findMatchesForUser($me->id, ['min_score' => 0, 'limit' => 50]);

        $this->assertContains((int) $posted->id, array_map(fn ($m) => (int) $m['id'], $matches), 'A category no page can show or untick was still hiding every match');
    }

    public function test_the_page_is_told_the_strong_match_score_and_where_the_matches_come_from(): void
    {
        $this->setMatchingConfig(['hot_match_threshold' => 72]);
        $category = $this->category();
        $gardener = $this->member();
        DB::table('user_skills')->insert([
            'user_id' => $gardener->id, 'tenant_id' => $this->testTenantId, 'skill_name' => 'Hedge trimming',
            'proficiency' => 'expert', 'is_offering' => 1, 'is_requesting' => 0,
        ]);
        $this->listingFor($this->member(), 'request', $category, ['title' => 'Hedge needs trimming']);

        $meta = app(CrossModuleMatchingService::class)->getAllMatches($gardener->id, ['modules' => ['listings'], 'min_score' => 0])['meta'];

        $this->assertSame(72, $meta['hot_threshold'], 'Every client hard-coded 80 while the alert used the community\'s own figure');
        $this->assertTrue($meta['matched_from_skills']);
        $this->assertFalse($meta['location_approximate']);
    }

    public function test_every_kind_of_match_keeps_a_place_on_a_full_page(): void
    {
        $category = $this->category();
        $me = $this->member();
        $this->listingFor($me, 'offer', $category, ['created_at' => now()->subDays(10)]);
        foreach (range(1, 6) as $n) {
            $this->listingFor($this->member(), 'request', $category, ['title' => "Hedge needs trimming {$n}"]);
        }
        $group = Group::factory()->create(['tenant_id' => $this->testTenantId, 'status' => 'active', 'visibility' => 'public']);
        DB::table('group_match_cache')->insert([
            'tenant_id' => $this->testTenantId, 'user_id' => $me->id, 'group_id' => $group->id,
            'match_score' => 12, 'match_reasons' => '[]', 'algorithm_version' => 'v2', 'status' => 'new',
            'created_at' => now(), 'expires_at' => now()->addDays(7),
        ]);
        $service = app(CrossModuleMatchingService::class);
        if ($service->getAllMatches($me->id, ['modules' => ['groups'], 'min_score' => 0])['matches'] === []) {
            $this->markTestSkipped('Groups are switched off for the test community');
        }

        $page = $service->getAllMatches($me->id, ['limit' => 5, 'min_score' => 0, 'modules' => ['listings', 'groups']]);

        $this->assertCount(5, $page['matches']);
        $this->assertContains('group', array_column($page['matches'], 'module'), 'Six stronger offers and requests pushed the only group suggestion off the page');
    }

    public function test_group_reasons_are_given_in_the_readers_language(): void
    {
        $me = $this->member();
        $group = Group::factory()->create(['tenant_id' => $this->testTenantId, 'status' => 'active', 'visibility' => 'public']);
        // Worked out by the background job, whose language is English.
        DB::table('group_match_cache')->insert([
            'tenant_id' => $this->testTenantId, 'user_id' => $me->id, 'group_id' => $group->id,
            'match_score' => 80, 'match_reasons' => json_encode(['Popular in your community', '3 people you know are members']),
            'algorithm_version' => 'v2', 'status' => 'new', 'created_at' => now(), 'expires_at' => now()->addDays(7),
        ]);

        $previous = app()->getLocale();
        app()->setLocale('ga');
        try {
            $matches = app(GroupMatchingService::class)->getMatchesForUser($me->id, 0, 10);
            $expected = [__('api.group_recommendation_popular'), __('api.group_recommendation_connection_many', ['count' => 3])];
        } finally {
            app()->setLocale($previous);
        }

        $this->assertNotSame('Popular in your community', $expected[0], 'This test needs an Irish translation to compare with');
        $this->assertSame($expected, $matches[0]['match_reasons']);
    }

    public function test_a_new_request_alerts_the_member_who_fits_it_not_only_the_most_recently_active(): void
    {
        $this->setMatchingConfig(['hot_match_threshold' => 45]);
        $gardening = $this->category('Gardening');
        $other = $this->category('Odd jobs');
        // 45 members seen today, each offering something unrelated.
        foreach (range(1, 45) as $n) {
            $this->listingFor($this->member(), 'offer', $other, [
                'title' => "Knitting circle {$n}", 'description' => 'Knitting and crochet for beginners.',
                'created_at' => now()->subDays(20),
            ]);
        }
        // The one member who offers exactly this, last seen three weeks ago.
        $gardener = $this->member(['last_active_at' => now()->subDays(21)]);
        $this->listingFor($gardener, 'offer', $other, [
            'title' => 'Hedge trimming and lawn mowing', 'description' => 'I can trim hedges and mow lawns.',
            'created_at' => now()->subDays(20),
        ]);
        $this->listingFor($this->member(), 'request', $gardening, [
            'title' => 'Hedge needs trimming', 'description' => 'My hedge is overgrown and needs trimming.',
        ]);

        app(MatchNotificationService::class)->notifyForNewListings();

        $this->assertGreaterThanOrEqual(
            1,
            DB::table('notifications')->where('user_id', $gardener->id)->whereIn('type', ['hot_match', 'mutual_match'])->count(),
            'The shortlist was the 40 members seen most recently, whatever they offer'
        );
    }

    public function test_a_failed_match_job_is_not_recorded_as_a_success(): void
    {
        app()->bind(MatchNotificationService::class, fn () => new class {
            public function sendDigests(string $frequency): int
            {
                throw new \RuntimeException('database gone away');
            }
        });
        $method = new \ReflectionMethod(CronJobRunner::class, 'matchDigestInternal');
        $method->setAccessible(true);

        ob_start();
        try {
            $method->invoke(app(CronJobRunner::class), 'monthly');
            $this->fail('The job swallowed its own failure, so the job log recorded "success"');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('database gone away', $e->getMessage());
        } finally {
            ob_end_clean();
        }
    }

    // ---------------------------------------------------------------------
    // Coordinator approvals
    // ---------------------------------------------------------------------

    private function pendingApproval(User $matched, User $owner, array $attrs = []): array
    {
        $listing = $this->listingFor($owner, 'offer', $this->category());
        $id = (int) DB::table('match_approvals')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'user_id' => $matched->id,
            'listing_id' => $listing->id,
            'listing_owner_id' => $owner->id,
            'match_score' => 82.50,
            'match_type' => 'one_way',
            'match_reasons' => json_encode(['Nearby']),
            'status' => 'pending',
            'submitted_at' => now(),
        ], $attrs));

        return [$id, $listing];
    }

    public function test_a_broker_cannot_read_a_match_they_are_one_of_the_two_members_of(): void
    {
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        [$own] = $this->pendingApproval($broker, $this->member(), ['status' => 'rejected', 'review_notes' => 'Safeguarding concern about this member']);
        [$someoneElses] = $this->pendingApproval($this->member(), $this->member());
        Sanctum::actingAs($broker, ['*']);

        $this->apiGet("/v2/admin/matching/approvals/{$own}")->assertStatus(403);

        $list = $this->apiGet('/v2/admin/matching/approvals?limit=100')->assertStatus(200);
        $ids = array_column($list->json('data') ?? [], 'id');
        $this->assertNotContains($own, $ids, 'A colleague\'s reason for rejecting the broker\'s own match was readable by that broker');
        $this->assertContains($someoneElses, $ids);
    }

    public function test_the_longest_waiting_match_is_first_in_the_queue(): void
    {
        [$newer] = $this->pendingApproval($this->member(), $this->member(), ['submitted_at' => now()->subHour()]);
        [$older] = $this->pendingApproval($this->member(), $this->member(), ['submitted_at' => now()->subDays(5)]);
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());

        $ids = array_column($this->apiGet('/v2/admin/matching/approvals?status=pending&limit=100')->json('data') ?? [], 'id');

        $this->assertLessThan(array_search($newer, $ids, true), array_search($older, $ids, true));
    }

    public function test_a_match_cannot_be_approved_after_its_listing_has_closed(): void
    {
        [$id, $listing] = $this->pendingApproval($this->member(), $this->member());
        DB::table('listings')->where('id', $listing->id)->update(['status' => 'closed']);
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());

        $this->apiPost("/v2/admin/matching/approvals/{$id}/approve")->assertStatus(409);

        $this->assertSame('pending', DB::table('match_approvals')->where('id', $id)->value('status'));
        $this->assertSame(0, DB::table('notifications')->where('type', 'match_approved')->where('link', "/listings/{$listing->id}")->count());
    }
}
