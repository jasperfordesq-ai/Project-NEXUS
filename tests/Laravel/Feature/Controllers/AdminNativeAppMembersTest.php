<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * GET /v2/admin/config/native-app/members
 *
 * The admin "Phone app" page's list: every member of THIS community who has
 * the app, one row each. A member has the app when they have a registered
 * phone (notifications allowed) or a live sign-in made through the phone app
 * (which exists whether or not they allowed notifications).
 */
class AdminNativeAppMembersTest extends TestCase
{
    use DatabaseTransactions;
    use NativeAppFixtures;

    private const ENDPOINT = '/v2/admin/config/native-app/members';

    protected function setUp(): void
    {
        parent::setUp();
        $this->clearPhoneAppRecords();
    }

    private function actingAsAdmin(): User
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        return $admin;
    }

    private function member(array $attributes = [], ?int $tenantId = null): User
    {
        return User::factory()->forTenant($tenantId ?? $this->testTenantId)->create($attributes);
    }

    /** @return list<int> */
    private function listedIds(string $query = ''): array
    {
        return array_column($this->apiGet(self::ENDPOINT . $query)->assertOk()->json('data'), 'user_id');
    }

    // ================================================================
    // Authorisation
    // ================================================================

    public function test_returns_401_for_unauthenticated(): void
    {
        $this->apiGet(self::ENDPOINT)->assertStatus(401);
    }

    public function test_returns_403_for_regular_member(): void
    {
        Sanctum::actingAs($this->member());

        $this->apiGet(self::ENDPOINT)->assertStatus(403);
    }

    public function test_returns_403_for_broker(): void
    {
        Sanctum::actingAs($this->member(['role' => 'broker']));

        $this->apiGet(self::ENDPOINT)->assertStatus(403);
    }

    // ================================================================
    // Who is listed
    // ================================================================

    public function test_lists_a_member_with_a_registered_phone(): void
    {
        $this->actingAsAdmin();
        $member = $this->member(['first_name' => 'Aoife', 'last_name' => 'Brennan', 'email' => 'aoife@example.test']);
        $this->registerDevice($member->id, $this->testTenantId, 'ios');

        $this->apiGet(self::ENDPOINT)
            ->assertOk()
            ->assertJsonPath('data.0.user_id', $member->id)
            ->assertJsonPath('data.0.display_name', 'Aoife Brennan')
            ->assertJsonPath('data.0.email', 'aoife@example.test')
            ->assertJsonPath('data.0.phones', ['ios'])
            ->assertJsonPath('data.0.notifications_on', true)
            ->assertJsonPath('meta.total', 1);
    }

    public function test_lists_a_member_signed_in_on_the_app_who_turned_notifications_off(): void
    {
        // Review focus 1. Until 13 Nov 2026 this member was invisible: the page
        // only knew about phones that had registered for notifications.
        $this->actingAsAdmin();
        $member = $this->member();
        $this->signIn($member->id, $this->testTenantId);

        $this->apiGet(self::ENDPOINT)
            ->assertOk()
            ->assertJsonPath('data.0.user_id', $member->id)
            ->assertJsonPath('data.0.phones', [])
            ->assertJsonPath('data.0.notifications_on', false)
            ->assertJsonPath('meta.total', 1);
    }

    public function test_does_not_list_a_member_who_signed_out_of_the_app(): void
    {
        // Review focus 2: signing out revokes the session and removes the phone.
        $this->actingAsAdmin();
        $member = $this->member();
        $this->signIn($member->id, $this->testTenantId, state: 'revoked');

        $this->assertSame([], $this->listedIds());
    }

    public function test_does_not_list_a_member_whose_app_sign_in_has_expired(): void
    {
        $this->actingAsAdmin();
        $member = $this->member();
        $this->signIn($member->id, $this->testTenantId, state: 'expired');

        $this->assertSame([], $this->listedIds());
    }

    public function test_does_not_list_a_member_signed_in_on_the_website_only(): void
    {
        $this->actingAsAdmin();
        $member = $this->member();
        $this->signIn($member->id, $this->testTenantId, fromPhoneApp: false);

        $this->assertSame([], $this->listedIds());
    }

    public function test_never_lists_a_member_of_another_community(): void
    {
        // Review focus 3.
        $this->actingAsAdmin();
        $ours = $this->member();
        $theirs = $this->member(['first_name' => 'Ghost', 'last_name' => 'Ofanothertenant'], self::OTHER_TENANT_ID);
        $theirsAppOnly = $this->member([], self::OTHER_TENANT_ID);

        $this->registerDevice($ours->id, $this->testTenantId);
        $this->registerDevice($theirs->id, self::OTHER_TENANT_ID);
        $this->signIn($theirsAppOnly->id, self::OTHER_TENANT_ID);

        $response = $this->apiGet(self::ENDPOINT)->assertOk();

        $this->assertSame([$ours->id], array_column($response->json('data'), 'user_id'));
        $response->assertJsonPath('meta.total', 1);
        $response->assertJsonMissing(['display_name' => 'Ghost Ofanothertenant']);
    }

    public function test_a_phone_recorded_here_for_another_communitys_member_is_not_listed(): void
    {
        // The phone table has no foreign key tying its community to the
        // member's. A row that says "this community" for an account that
        // belongs to another one must not put that account's name and email in
        // front of this community's admin: the member has to belong here too.
        $this->actingAsAdmin();
        $outsider = $this->member(
            ['first_name' => 'Ghost', 'last_name' => 'Ofanothertenant', 'email' => 'ghost@example.test'],
            self::OTHER_TENANT_ID
        );
        $this->registerDevice($outsider->id, $this->testTenantId);

        $response = $this->apiGet(self::ENDPOINT)->assertOk();

        $response->assertJsonPath('data', []);
        $response->assertJsonPath('meta.total', 0);
        $response->assertJsonMissing(['email' => 'ghost@example.test']);
    }

    public function test_someone_elses_live_session_does_not_make_a_signed_out_member_look_signed_in(): void
    {
        // "Live" must be the member's OWN session, as TokenService checks it
        // (family, member and community together) — not merely any live session
        // that happens to carry the same family reference.
        $this->actingAsAdmin();
        $signedOut = $this->member();
        $someoneElse = $this->member();
        $family = hash('sha256', 'shared-family-' . uniqid('', true));

        \Illuminate\Support\Facades\DB::table('refresh_session_activity')->insert([
            'family_hash' => $family,
            'tenant_id' => $this->testTenantId,
            'user_id' => $signedOut->id,
            'last_activity_at' => now(),
            'from_phone_app' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        \Illuminate\Support\Facades\DB::table('refresh_token_sessions')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $someoneElse->id,
            'family_hash' => $family,
            'jti_hash' => hash('sha256', 'jti-' . uniqid('', true)),
            'issued_at' => now(),
            'expires_at' => now()->addDays(7),
            'family_expires_at' => now()->addDays(30),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->assertSame([], $this->listedIds());
    }

    public function test_a_member_with_two_phones_is_one_row_showing_both(): void
    {
        // Review focus 4.
        $this->actingAsAdmin();
        $member = $this->member();
        $this->registerDevice($member->id, $this->testTenantId, 'ios');
        $this->registerDevice($member->id, $this->testTenantId, 'android');
        $this->signIn($member->id, $this->testTenantId);

        $this->apiGet(self::ENDPOINT)
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.phones', ['android', 'ios'])
            ->assertJsonPath('data.0.notifications_on', true)
            ->assertJsonPath('meta.total', 1);
    }

    public function test_names_an_organisation_by_its_trading_name(): void
    {
        $this->actingAsAdmin();
        $org = $this->member([
            'profile_type' => 'organisation',
            'organization_name' => 'Mallow Menshed CLG',
            'first_name' => 'Declan',
            'last_name' => 'Contact',
        ]);
        $this->registerDevice($org->id, $this->testTenantId);

        $this->apiGet(self::ENDPOINT)
            ->assertOk()
            ->assertJsonPath('data.0.display_name', 'Mallow Menshed CLG');
    }

    // ================================================================
    // Dates
    // ================================================================

    public function test_last_opened_is_the_most_recent_use_and_first_seen_the_earliest(): void
    {
        $this->actingAsAdmin();
        $member = $this->member();

        // An ended sign-in from September is still the first time we saw the app.
        $this->signIn($member->id, $this->testTenantId, state: 'revoked', signedInAt: now()->subDays(60), lastActivityAt: now()->subDays(50));
        $this->registerDevice($member->id, $this->testTenantId, 'android', now()->subDays(20), now()->subDays(5));
        $this->signIn($member->id, $this->testTenantId, signedInAt: now()->subDays(10), lastActivityAt: now()->subHours(2));

        $row = $this->apiGet(self::ENDPOINT)->assertOk()->json('data.0');

        $this->assertSame(now()->subDays(60)->toDateString(), substr((string) $row['first_seen_at'], 0, 10));
        $this->assertSame(now()->subHours(2)->toDateString(), substr((string) $row['last_opened_at'], 0, 10));
    }

    public function test_most_recently_opened_comes_first(): void
    {
        $this->actingAsAdmin();
        $older = $this->member();
        $newer = $this->member();
        $this->registerDevice($older->id, $this->testTenantId, 'android', now()->subDays(9), now()->subDays(8));
        $this->registerDevice($newer->id, $this->testTenantId, 'android', now()->subDays(9), now()->subDay());

        $this->assertSame([$newer->id, $older->id], $this->listedIds());
    }

    // ================================================================
    // Search and paging
    // ================================================================

    public function test_search_finds_by_name_email_or_username(): void
    {
        $this->actingAsAdmin();
        $aoife = $this->member(['first_name' => 'Aoife', 'last_name' => 'Brennan', 'email' => 'aoife.b@example.test', 'username' => 'aoifeb']);
        $conor = $this->member(['first_name' => 'Conor', 'last_name' => 'Walsh', 'email' => 'conor.w@example.test', 'username' => 'cwalsh']);
        $this->registerDevice($aoife->id, $this->testTenantId);
        $this->registerDevice($conor->id, $this->testTenantId);

        $this->assertSame([$aoife->id], $this->listedIds('?q=brenn'));
        $this->assertSame([$aoife->id], $this->listedIds('?q=Aoife%20Brennan'));
        $this->assertSame([$conor->id], $this->listedIds('?q=conor.w%40example'));
        $this->assertSame([$conor->id], $this->listedIds('?q=cwalsh'));
        $this->assertSame([], $this->listedIds('?q=nobody-by-this-name'));
    }

    public function test_search_treats_percent_and_underscore_as_ordinary_characters(): void
    {
        // Review focus 5: `%` and `_` are wildcards in LIKE. Typed into the
        // search box they must match themselves, not "everyone".
        $this->actingAsAdmin();
        $member = $this->member(['first_name' => 'Aoife', 'last_name' => 'Brennan', 'username' => 'aoifeb']);
        $this->registerDevice($member->id, $this->testTenantId);

        $this->assertSame([], $this->listedIds('?q=%25'));
        $this->assertSame([], $this->listedIds('?q=Aoif_'));
    }

    public function test_pages_through_the_list_with_a_total(): void
    {
        $this->actingAsAdmin();
        foreach (range(1, 3) as $i) {
            $member = $this->member();
            $this->registerDevice($member->id, $this->testTenantId, 'android', now()->subDays(10), now()->subDays($i));
        }

        $this->apiGet(self::ENDPOINT . '?per_page=2')
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('meta.total', 3)
            ->assertJsonPath('meta.current_page', 1)
            ->assertJsonPath('meta.per_page', 2)
            ->assertJsonPath('meta.total_pages', 2);

        $this->apiGet(self::ENDPOINT . '?per_page=2&page=2')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('meta.current_page', 2);
    }

    public function test_page_size_is_capped(): void
    {
        $this->actingAsAdmin();

        $this->apiGet(self::ENDPOINT . '?per_page=500')
            ->assertOk()
            ->assertJsonPath('meta.per_page', 100);
    }

    public function test_an_empty_community_answers_an_empty_list_not_an_error(): void
    {
        $this->actingAsAdmin();

        $this->apiGet(self::ENDPOINT)
            ->assertOk()
            ->assertJsonPath('data', [])
            ->assertJsonPath('meta.total', 0);
    }
}
