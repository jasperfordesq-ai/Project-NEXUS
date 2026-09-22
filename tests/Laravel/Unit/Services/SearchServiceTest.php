<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\SearchService;
use App\Models\User;
use App\Models\Listing;
use App\Models\Event;
use App\Models\Group;
use Mockery;

class SearchServiceTest extends TestCase
{
    private SearchService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new SearchService(
            new User(),
            new Listing(),
            new Event(),
            new Group(),
        );
    }

    // ── isAvailable ──

    public function test_isAvailable_returns_false_when_meilisearch_not_running(): void
    {
        // CI runs with no Meilisearch, so isAvailable() must report false and
        // every search falls back to SQL. A local `npm run dev:docker` DOES
        // start Meilisearch, and this assertion is about the absent case only —
        // asserting it unconditionally made the pre-commit gate fail on any
        // commit touching this file on a normally-configured dev machine.
        // Nothing is weakened: in CI the assertion runs exactly as before.
        if (SearchService::isAvailable()) {
            $this->markTestSkipped('Meilisearch is reachable here; this test covers the absent case.');
        }

        $this->assertFalse(SearchService::isAvailable());
    }

    // ── suggestions ──

    public function test_suggestions_returns_empty_for_short_term(): void
    {
        $result = $this->service->suggestions('a');
        $this->assertEquals([], $result['listings']);
        $this->assertEquals([], $result['users']);
        $this->assertEquals([], $result['events']);
        $this->assertEquals([], $result['groups']);
    }

    // ── search ──

    public function test_search_returns_array_keys_for_all_types(): void
    {
        $result = $this->service->search('test', null, 5);
        $this->assertArrayHasKey('users', $result);
        $this->assertArrayHasKey('listings', $result);
        $this->assertArrayHasKey('events', $result);
        $this->assertArrayHasKey('groups', $result);
    }

    public function test_search_filters_by_single_type(): void
    {
        $result = $this->service->search('test', 'users', 5);
        $this->assertArrayHasKey('users', $result);
        $this->assertArrayNotHasKey('listings', $result);
        $this->assertArrayNotHasKey('events', $result);
        $this->assertArrayNotHasKey('groups', $result);
    }

    // ── unifiedSearch ──

    public function test_unifiedSearch_returns_expected_structure(): void
    {
        $result = $this->service->unifiedSearch('test', null, ['limit' => 5]);
        $this->assertArrayHasKey('items', $result);
        $this->assertArrayHasKey('has_more', $result);
        $this->assertArrayHasKey('total', $result);
        $this->assertArrayHasKey('query', $result);
        $this->assertEquals('test', $result['query']);
    }

    public function test_unifiedSearch_caps_limit_at_50(): void
    {
        $result = $this->service->unifiedSearch('test', null, ['limit' => 200]);
        // Should not crash, limit is internally capped
        $this->assertIsArray($result['items']);
    }

    // ── trending ──

    public function test_trending_returns_array(): void
    {
        $result = $this->service->trending();
        $this->assertIsArray($result);
    }

    // ── indexListing / removeListing ──

    public function test_indexListing_skips_when_meilisearch_unavailable(): void
    {
        // The behaviour under test is the SKIP, so it only exists when
        // Meilisearch is absent. With Meilisearch reachable the method proceeds
        // to index and the bare Mockery listing has no expectations, which is a
        // test-environment artefact rather than a defect. See the note on
        // test_isAvailable_returns_false_when_meilisearch_not_running.
        if (SearchService::isAvailable()) {
            $this->markTestSkipped('Meilisearch is reachable here; the skip path cannot be exercised.');
        }

        $listing = Mockery::mock(Listing::class);
        SearchService::indexListing($listing);
        $this->assertTrue(true); // no exception thrown
    }

    public function test_removeListing_skips_when_meilisearch_unavailable(): void
    {
        if (SearchService::isAvailable()) {
            $this->markTestSkipped('Meilisearch is reachable here; the skip path cannot be exercised.');
        }

        $this->service->removeListing(1);
        $this->assertTrue(true); // no exception thrown
    }

    // ── member search opt-out (users.privacy_search) ──────────────────────────
    //
    // `privacy_search` is the member's own "show my profile in member search
    // results" switch (that is the label members actually see). The member
    // directory, Explore, member ranking and UserService all honour it. Global
    // search and autocomplete did not, on EITHER path, so a member who had
    // switched it off was still returned by /v2/search and /v2/search/suggestions
    // with their name, avatar and bio.
    //
    // Meilisearch is not running in the test environment (see
    // test_isAvailable_returns_false_when_meilisearch_not_running), so these
    // exercise the SQL paths. The Meilisearch paths revalidate their hit ids
    // through MemberDirectoryVisibility::visibleIds(), which is pinned
    // separately below and cannot diverge from the predicate used here.

    /** @return array{0:int,1:int} listed member id, opted-out member id */
    private function seedListedAndOptedOutMembers(string $token): array
    {
        $tenantId = (int) \App\Core\TenantContext::getId();

        $listed = User::factory()->forTenant($tenantId)->create([
            'first_name' => $token,
            'last_name' => 'Listed',
            'status' => 'active',
            'privacy_search' => 1,
        ]);
        $optedOut = User::factory()->forTenant($tenantId)->create([
            'first_name' => $token,
            'last_name' => 'Hidden',
            'status' => 'active',
            'privacy_search' => 0,
        ]);

        return [(int) $listed->id, (int) $optedOut->id];
    }

    public function test_unifiedSearch_excludes_members_who_opted_out_of_member_search(): void
    {
        $token = 'OptOutUni' . random_int(100000, 999999);
        [$listed, $optedOut] = $this->seedListedAndOptedOutMembers($token);

        try {
            $result = $this->service->unifiedSearch($token, null, ['limit' => 50, 'type' => 'users']);
            $ids = array_map('intval', array_column($result['items'], 'id'));

            $this->assertContains($listed, $ids, 'A listed member must still be found by global search.');
            $this->assertNotContains(
                $optedOut,
                $ids,
                'A member with privacy_search = 0 must not be returned by global search.'
            );
        } finally {
            \Illuminate\Support\Facades\DB::table('users')->whereIn('id', [$listed, $optedOut])->delete();
        }
    }

    public function test_suggestions_exclude_members_who_opted_out_of_member_search(): void
    {
        $token = 'OptOutSug' . random_int(100000, 999999);
        [$listed, $optedOut] = $this->seedListedAndOptedOutMembers($token);

        try {
            $result = $this->service->suggestions($token, 10);
            $ids = array_map('intval', array_column($result['users'], 'id'));

            $this->assertContains($listed, $ids, 'A listed member must still autocomplete.');
            $this->assertNotContains(
                $optedOut,
                $ids,
                'A member with privacy_search = 0 must not appear in search autocomplete.'
            );
        } finally {
            \Illuminate\Support\Facades\DB::table('users')->whereIn('id', [$listed, $optedOut])->delete();
        }
    }

    public function test_search_excludes_members_who_opted_out_of_member_search(): void
    {
        $token = 'OptOutSrch' . random_int(100000, 999999);
        [$listed, $optedOut] = $this->seedListedAndOptedOutMembers($token);

        try {
            $result = $this->service->search($token, 'users', 50);
            $ids = array_map('intval', array_column($result['users'], 'id'));

            $this->assertContains($listed, $ids);
            $this->assertNotContains(
                $optedOut,
                $ids,
                'A member with privacy_search = 0 must not be returned by SearchService::search().'
            );
        } finally {
            \Illuminate\Support\Facades\DB::table('users')->whereIn('id', [$listed, $optedOut])->delete();
        }
    }

    /**
     * The revalidation step the Meilisearch branches use. Pinned directly
     * because Meilisearch is not running in the test environment, so the
     * engine-backed branches cannot be exercised end to end here — this proves
     * the predicate they hand their hit ids to.
     */
    public function test_visibleIds_drops_members_who_opted_out_of_member_search(): void
    {
        $token = 'OptOutIds' . random_int(100000, 999999);
        [$listed, $optedOut] = $this->seedListedAndOptedOutMembers($token);
        $tenantId = (int) \App\Core\TenantContext::getId();

        try {
            $visible = \App\Support\Members\MemberDirectoryVisibility::visibleIds(
                [$optedOut, $listed],
                $tenantId,
            );

            $this->assertContains($listed, $visible);
            $this->assertNotContains($optedOut, $visible);
        } finally {
            \Illuminate\Support\Facades\DB::table('users')->whereIn('id', [$listed, $optedOut])->delete();
        }
    }

    /**
     * A NULL privacy_search predates the column and means "listed". Pinned so
     * the predicate can never be simplified to a bare `= 1`, which would hide
     * every legacy member from search at once.
     */
    public function test_visibleIds_keeps_members_with_a_null_privacy_search(): void
    {
        $tenantId = (int) \App\Core\TenantContext::getId();
        $legacy = User::factory()->forTenant($tenantId)->create([
            'status' => 'active',
            'privacy_search' => null,
        ]);

        try {
            $visible = \App\Support\Members\MemberDirectoryVisibility::visibleIds(
                [(int) $legacy->id],
                $tenantId,
            );
            $this->assertSame([(int) $legacy->id], $visible);
        } finally {
            \Illuminate\Support\Facades\DB::table('users')->where('id', $legacy->id)->delete();
        }
    }
}
