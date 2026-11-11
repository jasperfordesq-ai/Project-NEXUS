<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E122;

use App\Core\TenantContext;
use App\Models\User;
use App\Support\Names\NameAudience;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Laravel\TestCase;

/**
 * E-122 stage 4 — the central surname rule is switched on.
 *
 * Owner rule, 10 November 2026: "No surnames should be anywhere on the site
 * apart from for admins"; "Brokers too" (in their own community); and, asked
 * whether to switch the rule on: "Yes, switch it on".
 *
 * Three things had to be true before the switch could move:
 *
 *  A. a blank surname sent by an edit form never erases the stored surname
 *     (a screen that was not sent `last_name` can post it back empty);
 *  B. the hand-written "first names unless an administrator" blocks on the
 *     member-facing screens admit brokers and coordinators of the SAME
 *     community, as the central rule does — and nobody else;
 *  D. the switch is on as shipped.
 */
class SurnameStage4Test extends TestCase
{
    use DatabaseTransactions;

    private const FIRST = 'Zqxfirstmember';
    private const LAST = 'Zqxsurnamemember';
    private const SELF_FIRST = 'Zqxfirstself';
    private const SELF_LAST = 'Zqxsurnameself';

    private const OTHER_COMMUNITY = 999;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
        Cache::flush();
        TenantContext::setById($this->testTenantId);
    }

    // ------------------------------------------------------------------
    // D. The switch
    // ------------------------------------------------------------------

    public function test_the_surname_rule_is_switched_on_as_shipped(): void
    {
        $this->assertTrue(NameAudience::enforced());
    }

    // ------------------------------------------------------------------
    // A. A blank surname never erases a surname
    // ------------------------------------------------------------------

    /**
     * @return array<string, array{0: mixed}>
     */
    public static function blankSurnames(): array
    {
        return [
            'empty string' => [''],
            'null' => [null],
            'spaces' => ['   '],
            'tab and newline' => ["\t\n"],
        ];
    }

    #[DataProvider('blankSurnames')]
    public function test_a_blank_surname_from_an_edit_form_leaves_the_stored_surname_alone(mixed $blank): void
    {
        $me = $this->me();
        $this->signInAs($me);

        $response = $this->apiPut('/v2/users/me', [
            'first_name' => self::SELF_FIRST,
            'last_name' => $blank,
            'bio' => 'E-122 blank surname',
        ])->assertStatus(200);

        $row = DB::table('users')->where('tenant_id', $this->testTenantId)->where('id', $me->id)
            ->first(['first_name', 'last_name', 'name', 'bio']);

        $this->assertSame(self::SELF_LAST, $row->last_name, 'A blank last_name means "unchanged", never "erase".');
        $this->assertSame(self::SELF_FIRST . ' ' . self::SELF_LAST, $row->name, 'The stored display name keeps the surname.');
        $this->assertSame('E-122 blank surname', $row->bio, 'The rest of the save still happens.');
        $this->assertSame(self::SELF_LAST, $response->json('data.last_name'));
    }

    public function test_a_blank_surname_alone_is_a_save_that_changes_nothing(): void
    {
        $me = $this->me();
        $this->signInAs($me);

        $this->apiPut('/v2/users/me', ['last_name' => ''])->assertStatus(200);

        $this->assertSame(self::SELF_LAST, $this->stored($me, 'last_name'));
        $this->assertSame(self::SELF_FIRST . ' ' . self::SELF_LAST, $this->stored($me, 'name'));
    }

    public function test_a_real_new_surname_is_still_saved(): void
    {
        $me = $this->me();
        $this->signInAs($me);

        $this->apiPut('/v2/users/me', ['last_name' => '  Zqxsurnamemarried '])->assertStatus(200);

        $this->assertSame('Zqxsurnamemarried', $this->stored($me, 'last_name'));
        $this->assertSame(self::SELF_FIRST . ' Zqxsurnamemarried', $this->stored($me, 'name'));
    }

    // ------------------------------------------------------------------
    // B. Brokers too — on the hand-written member-facing name blocks
    // ------------------------------------------------------------------

    /**
     * @return array<string, array{0: array<string, mixed>}>
     */
    public static function staffOfTheCommunity(): array
    {
        return [
            'admin' => [['role' => 'admin']],
            'broker' => [['role' => 'broker']],
            'coordinator' => [['role' => 'coordinator']],
        ];
    }

    /** @param array<string, mixed> $staff */
    #[DataProvider('staffOfTheCommunity')]
    public function test_staff_of_the_community_see_surnames_on_the_member_screens(array $staff): void
    {
        $member = $this->member();
        $viewer = $this->person($staff);
        $groupId = $this->groupWith($member, $viewer);
        $this->connect($viewer, $member);
        $this->signInAs($viewer);

        $full = self::FIRST . ' ' . self::LAST;

        $directory = $this->apiGet('/v2/users?q=' . self::FIRST . '&limit=100')->assertStatus(200);
        $row = collect($directory->json('data'))->firstWhere('id', $member->id);
        $this->assertNotNull($row, 'The member is in the directory.');
        $this->assertSame($full, $row['name'], 'Member directory.');
        $this->assertSame(self::LAST, $row['last_name'] ?? null, 'Member directory last_name.');

        $profile = $this->apiGet('/v2/users/' . $member->id)->assertStatus(200);
        $this->assertSame($full, $profile->json('data.name'), 'Profile page.');
        $this->assertSame(self::LAST, $profile->json('data.last_name'), 'Profile page last_name.');

        $members = $this->apiGet("/v2/groups/{$groupId}/members")->assertStatus(200);
        $this->assertStringContainsString(self::LAST, (string) $members->getContent(), 'Group member list.');

        $connections = $this->apiGet('/v2/connections')->assertStatus(200);
        $this->assertStringContainsString(self::LAST, (string) $connections->getContent(), 'Connections list.');
    }

    /**
     * @return array<string, array{0: array<string, mixed>, 1: int|null}>
     */
    public static function everyoneElse(): array
    {
        return [
            'ordinary member' => [['role' => 'member'], null],
            'broker whose account is not approved' => [['role' => 'broker', 'is_approved' => false], null],
        ];
    }

    /** @param array<string, mixed> $viewerAttributes */
    #[DataProvider('everyoneElse')]
    public function test_everyone_else_sees_first_names_on_the_member_screens(array $viewerAttributes, ?int $unused): void
    {
        unset($unused);
        $member = $this->member();
        $viewer = $this->person($viewerAttributes);
        $groupId = $this->groupWith($member, $viewer);
        $this->connect($viewer, $member);
        $this->signInAs($viewer);

        foreach ([
            '/v2/users?q=' . self::FIRST . '&limit=100',
            '/v2/users/' . $member->id,
            "/v2/groups/{$groupId}/members",
            '/v2/connections',
        ] as $uri) {
            $response = $this->apiGet($uri);
            if ($response->getStatusCode() !== 200) {
                // An unapproved account is refused outright on some screens;
                // a refusal shows nobody's surname.
                $this->assertStringNotContainsString(self::LAST, (string) $response->getContent(), $uri);

                continue;
            }
            $this->assertStringNotContainsString(self::LAST, (string) $response->getContent(), "GET {$uri} must not carry the surname.");
        }
    }

    public function test_a_broker_of_another_community_is_not_staff_here(): void
    {
        $visitor = $this->person(['role' => 'broker'], self::OTHER_COMMUNITY);

        TenantContext::setById($this->testTenantId);
        $this->assertFalse(
            \App\Support\Members\MemberProfileVisibility::viewerSeesSurnames((int) $visitor->id),
            'A broker sees surnames in their OWN community only.'
        );
        $this->assertFalse(\App\Support\Members\MemberProfileVisibility::viewerIsAdmin((int) $visitor->id));
    }

    public function test_the_surname_rule_does_not_make_a_broker_an_administrator(): void
    {
        $broker = $this->person(['role' => 'broker']);

        $this->assertTrue(\App\Support\Members\MemberProfileVisibility::viewerSeesSurnames((int) $broker->id));
        $this->assertFalse(
            \App\Support\Members\MemberProfileVisibility::viewerIsAdmin((int) $broker->id),
            'viewerIsAdmin() still decides private profiles, exact coordinates and hidden members; a broker is not one.'
        );
    }

    public function test_a_broker_still_gets_rounded_coordinates_on_another_members_profile(): void
    {
        $member = $this->member(['latitude' => 53.349805, 'longitude' => -6.260310]);
        $this->signInAs($this->person(['role' => 'broker']));

        $profile = $this->apiGet('/v2/users/' . $member->id)->assertStatus(200);

        $this->assertSame(self::LAST, $profile->json('data.last_name'), 'The surname is shown to a broker…');
        $this->assertEqualsWithDelta(53.35, (float) $profile->json('data.latitude'), 0.000001, '…the exact location is still for administrators.');
    }

    // ------------------------------------------------------------------
    // What the search index hands back is shaped for whoever is looking
    // ------------------------------------------------------------------

    /**
     * The members index stores `last_name`, and the listings index stores the
     * author's name as it was when the listing was indexed. Whether the
     * engine answers at all depends on the environment (it does in
     * production, usually not in a test run), so the shaping of its hits is
     * pinned here directly.
     */
    public function test_search_index_hits_carry_no_surname_for_a_member_and_keep_it_for_staff(): void
    {
        $author = $this->member();
        $userHit = ['id' => $author->id, 'first_name' => self::FIRST, 'last_name' => self::LAST, 'profile_type' => 'individual'];
        $listingHit = ['id' => 1, 'user_id' => $author->id, 'title' => 'Indexed listing', 'author_name' => self::FIRST . ' ' . self::LAST];

        $shapeUser = new \ReflectionMethod(\App\Services\SearchService::class, 'publicUserHit');
        $shapeUser->setAccessible(true);
        $shapeListings = new \ReflectionMethod(\App\Services\SearchService::class, 'publicListingHits');
        $shapeListings->setAccessible(true);

        $this->signInAs($this->person());
        $this->assertArrayNotHasKey('last_name', $shapeUser->invoke(null, $userHit));
        $this->assertSame(self::FIRST, $shapeUser->invoke(null, $userHit)['first_name']);
        $this->assertSame(self::FIRST, $shapeListings->invoke(null, [$listingHit], $this->testTenantId)[0]['author_name']);

        auth()->forgetGuards();
        $this->signInAs($this->person(['role' => 'broker']));
        $this->assertSame(self::LAST, $shapeUser->invoke(null, $userHit)['last_name']);
        $this->assertSame(
            self::FIRST . ' ' . self::LAST,
            $shapeListings->invoke(null, [$listingHit], $this->testTenantId)[0]['author_name'],
        );
    }

    // ------------------------------------------------------------------
    // A payload cached for the whole community is built with public names
    // ------------------------------------------------------------------

    public function test_explore_warmed_by_an_administrator_shows_a_member_no_surname(): void
    {
        $member = $this->member();
        \App\Models\Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $member->id,
            'status' => 'active',
            'title' => 'E-122 explore listing ' . bin2hex(random_bytes(3)),
            'view_count' => 99999,
        ]);
        TenantContext::setById($this->testTenantId);

        // An administrator opens Explore first: its sections are cached for
        // the whole community, not per viewer.
        $this->signInAs($this->person(['role' => 'admin', 'is_admin' => 1]));
        $warm = $this->apiGet('/v2/explore')->assertStatus(200);
        $this->assertStringContainsString(self::FIRST, (string) $warm->getContent(), 'The seeded listing is on Explore — otherwise this proves nothing.');

        // …and a member opens it while that cache is still warm.
        $this->signInAs($this->person());
        $served = $this->apiGet('/v2/explore')->assertStatus(200);

        $this->assertStringContainsString(self::FIRST, (string) $served->getContent());
        $this->assertStringNotContainsString(self::LAST, (string) $served->getContent(), 'A cache warmed by staff must not hand members a surname.');
    }

    // ------------------------------------------------------------------

    private function signInAs(User $user): void
    {
        Sanctum::actingAs($user, ['*']);
        TenantContext::setById($this->testTenantId);
    }

    /** @param array<string, mixed> $overrides */
    private function member(array $overrides = []): User
    {
        return $this->person(array_merge([
            'first_name' => self::FIRST,
            'last_name' => self::LAST,
            'name' => self::FIRST . ' ' . self::LAST,
        ], $overrides));
    }

    private function me(): User
    {
        return $this->person([
            'first_name' => self::SELF_FIRST,
            'last_name' => self::SELF_LAST,
            'name' => self::SELF_FIRST . ' ' . self::SELF_LAST,
        ]);
    }

    private function stored(User $user, string $column): ?string
    {
        return DB::table('users')
            ->where('tenant_id', $this->testTenantId)
            ->where('id', $user->id)
            ->value($column);
    }

    private function connect(User $a, User $b): void
    {
        DB::table('connections')->insert([
            'tenant_id' => $this->testTenantId,
            'requester_id' => $a->id,
            'receiver_id' => $b->id,
            'status' => 'accepted',
            'created_at' => now(),
        ]);
    }

    private function groupWith(User ...$members): int
    {
        $groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $members[0]->id,
            'name' => 'E-122 stage 4 ' . bin2hex(random_bytes(3)),
            'visibility' => 'public',
            'is_active' => 1,
            'created_at' => now(),
        ]);
        foreach ($members as $member) {
            DB::table('group_members')->insert([
                'tenant_id' => $this->testTenantId,
                'group_id' => $groupId,
                'user_id' => $member->id,
                'role' => 'member',
                'status' => 'active',
            ]);
        }

        return $groupId;
    }

    /** @param array<string, mixed> $overrides */
    private function person(array $overrides = [], ?int $tenantId = null): User
    {
        $user = User::factory()->forTenant($tenantId ?? $this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 0,
            'is_god' => 0,
            'onboarding_completed' => true,
            'privacy_profile' => 'public',
        ], $overrides));
        TenantContext::setById($this->testTenantId);

        return $user;
    }
}
