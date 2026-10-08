<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Models\Listing;
use App\Models\User;
use App\Services\EmailDispatchService;
use App\Services\UserService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for UsersController.
 *
 * Covers profile, update, search, preferences, theme, language, password,
 * delete account, notifications, consent, sessions, nearby, listings.
 */
class UsersControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function authenticatedUser(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    // ================================================================
    // ME — Happy path
    // ================================================================

    public function test_me_returns_own_profile(): void
    {
        $user = $this->authenticatedUser([
            'first_name' => 'John',
            'last_name' => 'Doe',
        ]);

        $response = $this->apiGet('/v2/users/me');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    /**
     * The Create-Event button is driven by this field, so /me must report the
     * same decision POST /v2/events enforces. Without it the client shows a
     * button that only refuses after the whole form has been filled in.
     */
    public function test_me_reports_the_event_creation_capability(): void
    {
        $this->authenticatedUser();
        $this->setEventCreationRole('members');

        $this->apiGet('/v2/users/me')
            ->assertStatus(200)
            ->assertJsonPath('data.can_create_events', true);
    }

    public function test_me_reports_the_capability_as_false_when_creation_is_restricted(): void
    {
        $this->authenticatedUser(['role' => 'member']);
        $this->setEventCreationRole('admins');

        $this->apiGet('/v2/users/me')
            ->assertStatus(200)
            ->assertJsonPath('data.can_create_events', false);
    }

    public function test_me_reports_the_capability_as_true_for_an_admin_on_a_restricted_community(): void
    {
        $this->authenticatedUser(['role' => 'admin']);
        $this->setEventCreationRole('admins');

        $this->apiGet('/v2/users/me')
            ->assertStatus(200)
            ->assertJsonPath('data.can_create_events', true);
    }

    /**
     * Every client asks the server whether to prompt for a town, so the rule
     * lives in one place: NULL, empty and spaces-only all count as missing.
     *
     * @return array<string, array{0: ?string, 1: bool}>
     */
    public static function locationMissingProvider(): array
    {
        return [
            'null'        => [null, true],
            'empty'       => ['', true],
            'spaces only' => ['   ', true],
            'tab/newline' => ["\t \n", true],
            'a town'      => ['Cork', false],
            'padded town' => ['  Cork  ', false],
        ];
    }

    /**
     * @dataProvider locationMissingProvider
     */
    public function test_me_reports_whether_the_location_is_missing(?string $location, bool $expectedMissing): void
    {
        $user = $this->authenticatedUser();
        DB::table('users')->where('id', $user->id)->update(['location' => $location]);

        $this->apiGet('/v2/users/me')
            ->assertStatus(200)
            ->assertJsonPath('data.location_missing', $expectedMissing);
    }

    public function test_the_location_flag_is_private_to_the_member_and_absent_from_public_profiles(): void
    {
        $this->authenticatedUser();
        $other = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'location' => null,
        ]);

        $response = $this->apiGet('/v2/users/' . $other->id);

        $response->assertStatus(200);
        $this->assertArrayNotHasKey('location_missing', $response->json('data'));
    }

    // ================================================================
    // UPDATE ME — location validation (light hardening, 9 Oct 2026)
    // ================================================================

    public function test_update_profile_accepts_a_town_with_coordinates_and_clears_the_flag(): void
    {
        $user = $this->authenticatedUser();
        DB::table('users')->where('id', $user->id)->update(['location' => null]);

        $this->apiPut('/v2/users/me', [
            'location' => 'Cork, Ireland',
            'latitude' => 51.8985,
            'longitude' => -8.4756,
        ])->assertStatus(200)
            ->assertJsonPath('data.location', 'Cork, Ireland')
            ->assertJsonPath('data.location_missing', false);
    }

    public function test_update_profile_accepts_numeric_string_coordinates(): void
    {
        $this->authenticatedUser();

        $this->apiPut('/v2/users/me', [
            'location' => 'Cork',
            'latitude' => '51.8985',
            'longitude' => '-8.4756',
        ])->assertStatus(200);
    }

    public function test_update_profile_accepts_a_town_with_no_coordinates_or_null_coordinates(): void
    {
        $this->authenticatedUser();

        $this->apiPut('/v2/users/me', ['location' => 'Cork'])->assertStatus(200);
        $this->apiPut('/v2/users/me', [
            'location' => 'Cork',
            'latitude' => null,
            'longitude' => null,
        ])->assertStatus(200);
    }

    public function test_update_profile_refuses_a_location_longer_than_255_characters(): void
    {
        $this->authenticatedUser();

        $this->apiPut('/v2/users/me', ['location' => str_repeat('a', 256)])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'location');

        $this->apiPut('/v2/users/me', ['location' => str_repeat('a', 255)])
            ->assertStatus(200);
    }

    public function test_update_profile_measures_the_location_after_trimming(): void
    {
        $this->authenticatedUser();

        $this->apiPut('/v2/users/me', ['location' => str_repeat(' ', 20) . str_repeat('a', 255) . str_repeat(' ', 20)])
            ->assertStatus(200);
    }

    public function test_update_profile_refuses_a_location_that_is_not_text(): void
    {
        $this->authenticatedUser();

        $this->apiPut('/v2/users/me', ['location' => ['Cork']])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'location');
    }

    /**
     * @return array<string, array{0: mixed, 1: mixed, 2: string}>
     */
    public static function badCoordinatesProvider(): array
    {
        return [
            'latitude too high'   => [90.5, 10, 'latitude'],
            'latitude too low'    => [-91, 10, 'latitude'],
            'longitude too high'  => [10, 180.1, 'longitude'],
            'longitude too low'   => [10, -181, 'longitude'],
            'latitude text'       => ['north', 10, 'latitude'],
            'longitude text'      => [10, 'east', 'longitude'],
            'latitude array'      => [[1], 10, 'latitude'],
        ];
    }

    /**
     * @dataProvider badCoordinatesProvider
     */
    public function test_update_profile_refuses_out_of_range_or_non_numeric_coordinates(mixed $lat, mixed $lng, string $field): void
    {
        $this->authenticatedUser();

        $this->apiPut('/v2/users/me', [
            'location' => 'Somewhere',
            'latitude' => $lat,
            'longitude' => $lng,
        ])->assertStatus(422)
            ->assertJsonPath('errors.0.field', $field);
    }

    public function test_update_profile_accepts_the_edges_of_the_valid_range(): void
    {
        $this->authenticatedUser();

        $this->apiPut('/v2/users/me', ['latitude' => 90, 'longitude' => 180])->assertStatus(200);
        $this->apiPut('/v2/users/me', ['latitude' => -90, 'longitude' => -180])->assertStatus(200);
    }

    public function test_update_profile_refuses_null_island_but_allows_a_single_zero(): void
    {
        $user = $this->authenticatedUser();

        $this->apiPut('/v2/users/me', ['location' => 'Nowhere', 'latitude' => 0, 'longitude' => 0])
            ->assertStatus(422);
        $this->apiPut('/v2/users/me', ['location' => 'Nowhere', 'latitude' => '0.0', 'longitude' => '0'])
            ->assertStatus(422);

        // The equator and the prime meridian are real places.
        $this->apiPut('/v2/users/me', ['location' => 'Quito', 'latitude' => 0, 'longitude' => -78.5])
            ->assertStatus(200);
        $this->apiPut('/v2/users/me', ['location' => 'Greenwich', 'latitude' => 51.48, 'longitude' => 0])
            ->assertStatus(200);

        $this->assertNotSame('Nowhere', DB::table('users')->where('id', $user->id)->value('location'));
    }

    public function test_a_refused_location_update_changes_nothing(): void
    {
        $user = $this->authenticatedUser();
        DB::table('users')->where('id', $user->id)->update(['location' => 'Galway', 'bio' => 'Before']);

        $this->apiPut('/v2/users/me', ['bio' => 'After', 'location' => str_repeat('a', 300)])
            ->assertStatus(422);

        $row = DB::table('users')->where('id', $user->id)->first();
        $this->assertSame('Galway', $row->location);
        $this->assertSame('Before', $row->bio);
    }

    private function setEventCreationRole(string $role): void
    {
        $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('configuration');
        $configuration = is_string($raw) ? (json_decode($raw, true) ?: []) : (is_array($raw) ? $raw : []);
        $configuration['events'] = array_merge($configuration['events'] ?? [], ['creation_role' => $role]);
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'configuration' => json_encode($configuration),
        ]);
    }

    // ================================================================
    // ME — Authentication required
    // ================================================================

    public function test_me_returns_401_without_auth(): void
    {
        $response = $this->apiGet('/v2/users/me');

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // UPDATE ME — Happy path
    // ================================================================

    public function test_update_profile_returns_updated_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPut('/v2/users/me', [
            'bio' => 'Updated bio text',
            'location' => 'Cork',
        ]);

        $this->assertContains($response->getStatusCode(), [200, 422]);
    }

    public function test_verified_member_cannot_clear_date_of_birth_with_json_null(): void
    {
        // An adult date: under-18 accounts cannot hold a session (adults-only, 2026-09-25).
        $dateOfBirth = now()->subYears(30)->toDateString();
        $user = $this->authenticatedUser([
            'date_of_birth' => $dateOfBirth,
            'bio' => 'Before',
        ]);

        DB::table('member_verification_badges')->insert([
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'badge_type' => 'id_verified',
            'verified_by' => $user->id,
            'granted_at' => now(),
        ]);

        $this->apiPut('/v2/users/me', [
            'date_of_birth' => null,
            'bio' => 'After',
        ])->assertStatus(200);

        $user->refresh();
        $this->assertSame($dateOfBirth, (string) $user->date_of_birth);
        $this->assertSame('After', $user->bio);
    }

    public function test_verified_member_lock_uses_home_tenant_while_browsing_another_tenant(): void
    {
        // An adult date: under-18 accounts cannot hold a session (adults-only, 2026-09-25).
        $dateOfBirth = now()->subYears(30)->toDateString();
        $user = $this->authenticatedUser(['date_of_birth' => $dateOfBirth]);
        DB::table('member_verification_badges')->insert([
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'badge_type' => 'id_verified',
            'verified_by' => $user->id,
            'granted_at' => now(),
        ]);
        DB::table('tenants')->insertOrIgnore([
            'id' => 999,
            'name' => 'Viewed Tenant',
            'slug' => 'viewed-tenant',
            'is_active' => true,
            'depth' => 0,
            'allows_subtenants' => false,
        ]);
        TenantContext::setById(999);

        $this->assertTrue(UserService::updateProfile($user->id, ['date_of_birth' => null]));

        $this->assertSame(
            $dateOfBirth,
            (string) User::withoutGlobalScopes()->findOrFail($user->id)->date_of_birth
        );
    }

    // ================================================================
    // UPDATE ME — Authentication required
    // ================================================================

    public function test_update_profile_returns_401_without_auth(): void
    {
        $response = $this->apiPut('/v2/users/me', [
            'bio' => 'Unauthorized',
        ]);

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // SHOW USER — Happy path
    // ================================================================

    public function test_show_returns_public_profile(): void
    {
        $this->authenticatedUser();
        $otherUser = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
        ]);

        $response = $this->apiGet("/v2/users/{$otherUser->id}");

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // SHOW USER — Not found
    // ================================================================

    public function test_show_returns_404_for_nonexistent_user(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/users/999999');

        $response->assertStatus(404);
    }

    /**
     * A profile withheld by its owner's privacy setting must say WHICH refusal it
     * is, not just 404.
     *
     * 🔴 Both privacy branches in UserService::getPublicProfile() returned null
     * with no error code, so the controller fell through to a bare NOT_FOUND. Every
     * client then told the viewer "Page not found" about a real member who had
     * simply chosen to be visible only to their connections — the same class of
     * lie that PROFILE_INCOMPLETE already had its own code to avoid.
     *
     * The status stays 404 on purpose: a restricted profile must not be confirmed
     * to exist by status code alone. The distinction rides on the code, which is
     * what this test pins.
     */
    public function test_show_reports_a_connections_only_profile_as_private_not_missing(): void
    {
        $this->authenticatedUser();
        $otherUser = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'privacy_profile' => 'connections',
        ]);

        $response = $this->apiGet("/v2/users/{$otherUser->id}");

        $response->assertStatus(404);
        $response->assertJsonPath('errors.0.code', 'PROFILE_PRIVATE');
    }

    /**
     * The companion guard: a member who genuinely is not there must still report
     * NOT_FOUND. If PROFILE_PRIVATE leaked onto absent users, the accessible
     * frontend would tell members that a deleted account was "only shown to
     * connections" — which reads as though the person is still around.
     */
    public function test_show_reports_a_missing_user_as_not_found_not_private(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/users/999999');

        $response->assertStatus(404);
        $response->assertJsonPath('errors.0.code', 'NOT_FOUND');
    }

    /**
     * A public profile must not be affected by the new branch at all.
     */
    public function test_show_still_returns_a_public_profile_to_a_signed_in_member(): void
    {
        $this->authenticatedUser();
        $otherUser = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'privacy_profile' => 'public',
        ]);

        $response = $this->apiGet("/v2/users/{$otherUser->id}");

        $response->assertStatus(200);
    }

    public function test_pending_registration_profile_is_staff_only_until_activation(): void
    {
        $member = $this->authenticatedUser(['role' => 'member']);
        $pending = User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => 'PendingSynthetic',
            'last_name' => 'PrivateSurname',
            'location' => 'Synthetic location',
            'status' => 'pending',
            'is_approved' => false,
            'onboarding_completed' => false,
            'privacy_profile' => 'public',
        ]);

        $memberResponse = $this->apiGet("/v2/users/{$pending->id}");
        $memberResponse->assertStatus(404);
        $memberResponse->assertJsonPath('errors.0.code', 'PROFILE_PRIVATE');
        $this->assertStringNotContainsString('PendingSynthetic', $memberResponse->getContent());

        foreach (['broker', 'coordinator', 'admin'] as $role) {
            $staff = User::factory()->forTenant($this->testTenantId)->create([
                'role' => $role, 'status' => 'active', 'is_approved' => true,
            ]);
            Sanctum::actingAs($staff, ['*']);
            $this->apiGet("/v2/users/{$pending->id}")
                ->assertStatus(200)
                ->assertJsonPath('data.first_name', 'PendingSynthetic')
                ->assertJsonMissingPath('data.email');
        }

        $pending->update(['status' => 'active', 'is_approved' => true]);
        Sanctum::actingAs($member, ['*']);
        $this->apiGet("/v2/users/{$pending->id}")
            ->assertStatus(200)
            ->assertJsonPath('data.first_name', 'PendingSynthetic');
    }

    public function test_active_but_unapproved_profile_is_still_staff_only(): void
    {
        $member = $this->authenticatedUser(['role' => 'member']);
        $unapproved = User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => 'UnapprovedSynthetic',
            'status' => 'active',
            'is_approved' => false,
            'onboarding_completed' => true,
            'privacy_profile' => 'public',
        ]);

        $this->apiGet("/v2/users/{$unapproved->id}")
            ->assertStatus(404)
            ->assertJsonPath('errors.0.code', 'PROFILE_PRIVATE');

        $staff = User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'admin', 'status' => 'active', 'is_approved' => true,
        ]);
        Sanctum::actingAs($staff, ['*']);
        $this->apiGet("/v2/users/{$unapproved->id}")
            ->assertStatus(200)
            ->assertJsonPath('data.first_name', 'UnapprovedSynthetic');

        $unapproved->update(['is_approved' => true]);
        Sanctum::actingAs($member, ['*']);
        $this->apiGet("/v2/users/{$unapproved->id}")
            ->assertStatus(200)
            ->assertJsonPath('data.first_name', 'UnapprovedSynthetic');
    }

    // ================================================================
    // SHOW USER — Tenant isolation
    // ================================================================

    public function test_show_cannot_access_user_from_different_tenant(): void
    {
        DB::table('tenants')->insertOrIgnore([
            'id' => 999, 'name' => 'Other', 'slug' => 'other',
            'is_active' => true, 'depth' => 0, 'allows_subtenants' => false,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $otherUser = User::factory()->forTenant(999)->create([
            'status' => 'active',
        ]);

        $this->authenticatedUser();

        $response = $this->apiGet("/v2/users/{$otherUser->id}");

        // Should return 404 because user belongs to different tenant
        $this->assertContains($response->getStatusCode(), [404, 403]);
    }

    // ================================================================
    // SEARCH
    // ================================================================

    public function test_search_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/users?q=test');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_pending_and_unapproved_members_are_absent_from_search_and_directory(): void
    {
        $this->authenticatedUser(['role' => 'member']);
        $directoryBefore = $this->apiGet('/v2/users?sort=name&limit=1');
        $directoryBefore->assertStatus(200);
        $initialTotal = (int) $directoryBefore->json('meta.total_items');
        $base = [
            'privacy_profile' => 'public',
            'privacy_search' => true,
            'onboarding_completed' => true,
            'avatar_url' => '/uploads/test/c1-visibility-avatar.png',
            'bio' => 'Synthetic approved-profile visibility check.',
            'latitude' => 53.3498,
            'longitude' => -6.2603,
        ];
        $pending = User::factory()->forTenant($this->testTenantId)->create(array_merge($base, [
            'first_name' => 'C1VisibilityFixturePending',
            'status' => 'pending', 'is_approved' => false,
        ]));
        $unapproved = User::factory()->forTenant($this->testTenantId)->create(array_merge($base, [
            'first_name' => 'C1VisibilityFixtureUnapproved',
            'status' => 'active', 'is_approved' => false,
        ]));
        $approved = User::factory()->forTenant($this->testTenantId)->create(array_merge($base, [
            'first_name' => 'C1VisibilityFixtureApproved',
            'status' => 'active', 'is_approved' => true,
        ]));

        $search = $this->apiGet('/v2/users/search?q=C1VisibilityFixture&limit=100');
        $search->assertStatus(200);
        $searchIds = array_map('intval', array_column($search->json('data.items') ?? [], 'id'));
        $this->assertNotContains($pending->id, $searchIds);
        $this->assertNotContains($unapproved->id, $searchIds);
        $this->assertContains($approved->id, $searchIds);

        $directory = $this->apiGet('/v2/users?sort=name&limit=1');
        $directory->assertStatus(200);
        $this->assertSame($initialTotal + 1, (int) $directory->json('meta.total_items'));

        TenantContext::setById($this->testTenantId);
        $ranked = app(\App\Services\MemberRankingService::class)->rankMembers(
            $this->testTenantId, 100, 0, 'C1VisibilityFixture'
        );
        $rankedIds = array_map('intval', array_column($ranked['items'], 'user_id'));
        $this->assertNotContains($pending->id, $rankedIds);
        $this->assertNotContains($unapproved->id, $rankedIds);
        $this->assertContains($approved->id, $rankedIds);

        $nearby = $this->apiGet('/v2/members/nearby?lat=53.3498&lon=-6.2603&radius_km=1&limit=100&q=C1VisibilityFixture');
        $nearby->assertStatus(200);
        $nearbyIds = array_map('intval', array_column($nearby->json('data') ?? [], 'id'));
        $this->assertNotContains($pending->id, $nearbyIds);
        $this->assertNotContains($unapproved->id, $nearbyIds);
        $this->assertContains($approved->id, $nearbyIds);
    }

    // ================================================================
    // MEMBER DIRECTORY (INDEX)
    // ================================================================

    public function test_index_returns_member_directory(): void
    {
        $this->authenticatedUser();
        User::factory()->forTenant($this->testTenantId)->count(3)->create([
            'status' => 'active',
        ]);

        $response = $this->apiGet('/v2/users');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data', 'meta']);
    }

    /**
     * The directory tells members how many of the community it is showing.
     * `community_total` counts everyone active, `directory_total` only those it
     * may list — here one of the three has opted out of appearing in search, so
     * the two numbers must differ by exactly that member. Both exclude the
     * viewer, so they are directly comparable.
     */
    public function test_index_meta_reports_community_and_directory_totals(): void
    {
        $this->authenticatedUser();

        // The tenant is seeded, so assert on the movement these three cause
        // rather than on absolute totals.
        $before = $this->apiGet('/v2/users')->assertStatus(200)->json('meta');

        User::factory()->forTenant($this->testTenantId)->count(2)->create([
            'status' => 'active',
            'privacy_search' => 1,
        ]);
        $optedOut = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'privacy_search' => 0,
        ]);

        $after = $this->apiGet('/v2/users')->assertStatus(200)->json('meta');

        $this->assertSame(3, $after['community_total'] - $before['community_total']);
        $this->assertSame(2, $after['directory_total'] - $before['directory_total']);
        $this->assertContains('directory_opt_in', $after['directory_criteria']);

        // The opted-out member is counted in the community but never listed.
        $listed = array_column($this->apiGet('/v2/users?sort=name&limit=100')->json('data'), 'id');
        $this->assertNotContains($optedOut->id, $listed);
    }

    /**
     * The directory has never filtered on last login, and the explanation shown
     * to members must not imply it does. A member who has not signed in for
     * years is still listed.
     */
    public function test_index_lists_members_who_have_not_logged_in_recently(): void
    {
        $this->authenticatedUser();

        $dormant = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'privacy_search' => 1,
            'onboarding_completed' => 1,
            'avatar_url' => '/uploads/test/dormant-avatar.png',
            'bio' => 'Dormant member directory regression fixture.',
            'last_login_at' => now()->subYears(3),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Sort newest first so this fresh fixture is in the first page even
        // when a shared development database has more than 100 active users.
        $response = $this->apiGet('/v2/users?sort=joined&order=DESC&limit=100');

        $response->assertStatus(200);
        $this->assertContains($dormant->id, array_column($response->json('data'), 'id'));
    }

    // ================================================================
    // STATS
    // ================================================================

    public function test_stats_returns_profile_stats(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/me/stats');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_stats_returns_401_without_auth(): void
    {
        $response = $this->apiGet('/v2/me/stats');

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // PREFERENCES — Happy path
    // ================================================================

    public function test_get_preferences_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/users/me/preferences');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'data' => ['privacy', 'notifications', 'accessibility'],
        ]);
    }

    /**
     * Regression: privacy toggles saved via PUT /preferences must actually persist.
     *
     * privacy_profile/privacy_search were missing from User::$fillable, so
     * UserService::updatePrivacy()'s fill()/save() silently dropped them — the React
     * settings page reported "saved" while the DB never changed (profile visibility +
     * search indexing reverted). Guards the $fillable declaration on the User model.
     */
    public function test_update_preferences_persists_privacy_toggles(): void
    {
        $user = $this->authenticatedUser();

        // Establish a known starting point directly (independent of fill semantics).
        DB::table('users')->where('id', $user->id)->update([
            'privacy_profile' => 'public',
            'privacy_search'  => 1,
        ]);

        $response = $this->apiPut('/v2/users/me/preferences', [
            'privacy' => [
                'privacy_profile' => 'connections',
                'privacy_search'  => false,
            ],
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.privacy.privacy_profile', 'connections');

        $row = DB::table('users')->where('id', $user->id)->first();
        $this->assertSame('connections', $row->privacy_profile);
        $this->assertSame(0, (int) $row->privacy_search);
    }

    public function test_update_preferences_rejects_invalid_privacy_search_boolean(): void
    {
        $user = $this->authenticatedUser();
        DB::table('users')->where('id', $user->id)->update(['privacy_search' => 1]);

        $this->apiPut('/v2/users/me/preferences', [
            'privacy' => [
                'privacy_search' => 'sometimes',
            ],
        ])->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'VALIDATION_ERROR');

        $this->assertSame(
            1,
            (int) DB::table('users')->where('id', $user->id)->value('privacy_search'),
        );
    }

    public function test_update_preferences_notification_payload_cannot_mass_assign_identity_columns(): void
    {
        $user = $this->authenticatedUser();
        $otherUser = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        $ownPreferenceId = DB::table('user_notification_preferences')->insertGetId([
            'user_id' => $user->id,
            'email_messages' => 1,
        ]);
        $otherPreferenceId = DB::table('user_notification_preferences')->insertGetId([
            'user_id' => $otherUser->id,
            'email_messages' => 1,
        ]);

        $this->apiPut('/v2/users/me/preferences', [
            'notifications' => [
                'id' => $otherPreferenceId,
                'user_id' => $otherUser->id,
                'email_messages' => false,
            ],
        ])->assertStatus(200);

        $this->assertDatabaseHas('user_notification_preferences', [
            'id' => $ownPreferenceId,
            'user_id' => $user->id,
            'email_messages' => 0,
        ]);
        $this->assertDatabaseHas('user_notification_preferences', [
            'id' => $otherPreferenceId,
            'user_id' => $otherUser->id,
            'email_messages' => 1,
        ]);
    }

    // ================================================================
    // PREFERENCES — Authentication required
    // ================================================================

    public function test_get_preferences_returns_401_without_auth(): void
    {
        $response = $this->apiGet('/v2/users/me/preferences');

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // THEME — Validation
    // ================================================================

    public function test_update_theme_returns_400_for_invalid_theme(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPut('/v2/users/me/theme', [
            'theme' => 'neon',
        ]);

        $response->assertStatus(400);
    }

    public function test_update_theme_accepts_valid_theme(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPut('/v2/users/me/theme', [
            'theme' => 'dark',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.theme', 'dark');
    }

    public function test_update_theme_preferences_persists_accessibility_profile(): void
    {
        $user = $this->authenticatedUser([
            'theme_preferences' => json_encode([
                'accent_color' => '#6366f1',
                'font_size' => 'medium',
                'density' => 'comfortable',
                'high_contrast' => false,
            ]),
        ]);

        $response = $this->apiPut('/v2/users/me/theme-preferences', [
            'large_text' => true,
            'high_contrast' => true,
            'reduced_motion' => true,
            'simplified_layout' => true,
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.theme_preferences.accent_color', '#6366f1');
        $response->assertJsonPath('data.theme_preferences.large_text', true);
        $response->assertJsonPath('data.theme_preferences.high_contrast', true);
        $response->assertJsonPath('data.theme_preferences.reduced_motion', true);
        $response->assertJsonPath('data.theme_preferences.simplified_layout', true);

        $stored = DB::table('users')->where('id', $user->id)->value('theme_preferences');
        $stored = json_decode((string) $stored, true);

        $this->assertTrue($stored['large_text']);
        $this->assertTrue($stored['reduced_motion']);
        $this->assertTrue($stored['simplified_layout']);
        $this->assertSame('#6366f1', $stored['accent_color']);
    }

    public function test_update_theme_returns_401_without_auth(): void
    {
        $response = $this->apiPut('/v2/users/me/theme', [
            'theme' => 'dark',
        ]);

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // LANGUAGE — Validation
    // ================================================================

    public function test_update_language_accepts_platform_supported_arabic_when_tenant_uses_defaults(): void
    {
        $user = $this->authenticatedUser(['preferred_language' => 'en']);

        $response = $this->apiPut('/v2/users/me/language', [
            'language' => 'ar',
        ]);

        $response->assertStatus(200)
            ->assertJsonPath('data.language', 'ar');
        $this->assertSame('ar', DB::table('users')->where('id', $user->id)->value('preferred_language'));
    }

    public function test_update_language_returns_400_for_invalid_language(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPut('/v2/users/me/language', [
            'language' => 'klingon',
        ]);

        $response->assertStatus(400);
    }

    public function test_update_language_returns_401_without_auth(): void
    {
        $response = $this->apiPut('/v2/users/me/language', [
            'language' => 'en',
        ]);

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // PASSWORD — Validation
    // ================================================================

    public function test_update_password_returns_400_without_current_password(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/users/me/password', [
            'new_password' => 'new-password-123',
        ]);

        $response->assertStatus(400);
    }

    public function test_update_password_returns_400_without_new_password(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/users/me/password', [
            'current_password' => 'old-password',
        ]);

        $response->assertStatus(400);
    }

    public function test_update_password_returns_401_without_auth(): void
    {
        $response = $this->apiPost('/v2/users/me/password', [
            'current_password' => 'old',
            'new_password' => 'new',
        ]);

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    public function test_update_password_sends_security_bell_and_email(): void
    {
        $user = $this->authenticatedUser([
            'email' => 'password-change-' . uniqid('', true) . '@example.test',
            'password_hash' => Hash::make('old-password-123'),
            'preferred_language' => 'en',
        ]);

        $mailer = new class extends EmailDispatchService {
            public array $calls = [];

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                $this->calls[] = compact('to', 'subject', 'body', 'options');

                return true;
            }
        };
        app()->instance(EmailDispatchService::class, $mailer);

        $response = $this->apiPost('/v2/users/me/password', [
            'current_password' => 'old-password-123',
            'new_password' => 'new-password-123',
        ]);

        $response->assertStatus(200);

        $this->assertDatabaseHas('notifications', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'type' => 'password_changed',
        ]);

        // Assert on the security_alert email specifically, not the TOTAL call
        // count: other legitimate emails (e.g. admin notifications) can fire in
        // the same request depending on what earlier test files left in the
        // shared tenant, so a total-count pin is order-dependent — it broke
        // shard 4 when the 2026-08-03 reshard changed this file's neighbours.
        $securityAlerts = array_values(array_filter(
            $mailer->calls,
            static fn (array $call): bool => ($call['options']['category'] ?? null) === 'security_alert'
        ));
        $this->assertCount(1, $securityAlerts);
        $this->assertSame($user->email, $securityAlerts[0]['to']);
        $this->assertSame($this->testTenantId, $securityAlerts[0]['options']['tenant_id']);
    }

    // ================================================================
    // DELETE ACCOUNT — Authentication required
    // ================================================================

    public function test_delete_account_returns_401_without_auth(): void
    {
        $response = $this->apiDelete('/v2/users/me');

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    public function test_delete_account_sends_account_deleted_email_with_explicit_tenant(): void
    {
        $user = $this->authenticatedUser([
            'email' => 'delete-account-' . uniqid('', true) . '@example.test',
            'first_name' => 'Delete',
            'name' => 'Delete Me',
            'password_hash' => Hash::make('delete-password-123'),
            'preferred_language' => 'en',
        ]);

        $mailer = new class extends EmailDispatchService {
            public array $calls = [];

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                $this->calls[] = compact('to', 'subject', 'body', 'options');

                return true;
            }
        };
        app()->instance(EmailDispatchService::class, $mailer);

        $response = $this->apiDelete('/v2/users/me', [
            'password' => 'delete-password-123',
        ]);

        $response->assertStatus(200);

        // Same rationale as the security_alert assertion above: pin the
        // account_deleted email itself, not the total number of emails the
        // deletion request happened to send. The total varies with tenant
        // state left by earlier files in the shard (observed: 2 calls on CI
        // shard 4 after the 2026-08-03 reshard; 1 call when the file runs
        // alone) — the goodbye email is what this test exists to prove.
        $accountDeleted = array_values(array_filter(
            $mailer->calls,
            static fn (array $call): bool => ($call['options']['category'] ?? null) === 'account_deleted'
        ));
        $this->assertCount(1, $accountDeleted);
        $this->assertSame($user->email, $accountDeleted[0]['to']);
        $this->assertSame($this->testTenantId, $accountDeleted[0]['options']['tenant_id']);
    }

    // ================================================================
    // MY LISTINGS
    // ================================================================

    public function test_my_listings_returns_data(): void
    {
        $user = $this->authenticatedUser();
        Listing::factory()->forTenant($this->testTenantId)->count(2)->create([
            'user_id' => $user->id,
        ]);

        $response = $this->apiGet('/v2/users/me/listings');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_my_listings_returns_401_without_auth(): void
    {
        $response = $this->apiGet('/v2/users/me/listings');

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // USER LISTINGS
    // ================================================================

    public function test_user_listings_returns_data(): void
    {
        $user = $this->authenticatedUser();
        $otherUser = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
        ]);
        Listing::factory()->forTenant($this->testTenantId)->count(2)->create([
            'user_id' => $otherUser->id,
        ]);

        $response = $this->apiGet("/v2/users/{$otherUser->id}/listings");

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // NOTIFICATION PREFERENCES
    // ================================================================

    public function test_notification_preferences_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/users/me/notifications');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_update_notification_preferences_returns_400_without_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPut('/v2/users/me/notifications', []);

        $response->assertStatus(400);
    }

    // ================================================================
    // NEARBY MEMBERS — Validation
    // ================================================================

    public function test_nearby_returns_400_without_coordinates(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/members/nearby');

        $response->assertStatus(400);
    }

    public function test_nearby_returns_data_with_valid_coordinates(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/members/nearby?lat=53.35&lon=-6.26');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // NEARBY MEMBERS — Radius filter actually filters (regression guard)
    // ================================================================

    public function test_nearby_members_excludes_distant_members(): void
    {
        // Dublin city centre ≈ 53.3498, -6.2603
        // Cork city centre ≈ 51.8985, -8.4756  (~258 km away)
        $this->authenticatedUser();

        $near = User::factory()->forTenant($this->testTenantId)->create([
            'status'           => 'active',
            'is_approved'      => true,
            'latitude'         => 53.3490,
            'longitude'        => -6.2600,
            'privacy_search'   => 1,
        ]);

        $far = User::factory()->forTenant($this->testTenantId)->create([
            'status'           => 'active',
            'is_approved'      => true,
            'latitude'         => 51.8985,
            'longitude'        => -8.4756,
            'privacy_search'   => 1,
        ]);

        // 10 km radius centred on Dublin — Cork must be excluded
        $response = $this->apiGet('/v2/members/nearby?lat=53.3498&lon=-6.2603&radius_km=10');

        $response->assertStatus(200);
        $data = collect($response->json('data'));

        $ids = $data->pluck('id');
        $this->assertTrue($ids->contains($near->id), 'Nearby member should appear in results');
        $this->assertFalse($ids->contains($far->id), 'Distant member (Cork) must be excluded by radius filter');
    }

    // ================================================================
    // SESSIONS
    // ================================================================

    public function test_sessions_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/users/me/sessions');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_sessions_returns_401_without_auth(): void
    {
        $response = $this->apiGet('/v2/users/me/sessions');

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // CONSENT — Authentication required
    // ================================================================

    public function test_get_consent_returns_401_without_auth(): void
    {
        $response = $this->apiGet('/v2/users/me/consent');

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    public function test_update_consent_returns_400_without_slug(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPut('/v2/users/me/consent', [
            'given' => true,
        ]);

        $response->assertStatus(400);
    }

    /**
     * 🔴 An unrecognised consent slug must be a 422, never a 500.
     *
     * Found by driving the accessible frontend's profile-settings form against a database
     * whose `consent_types` table was empty. GdprService threw
     * InvalidArgumentException("Invalid consent type: ...") and the controller answered
     * 500, so: error monitoring recorded a server fault for a bad request, and the
     * frontend told the member their profile update had failed even though their name and
     * photo had both saved (both PUTs returned 200) — a 500 is indistinguishable from a
     * real outage, so it had to assume the worst.
     */
    public function test_update_consent_returns_422_for_an_unknown_consent_slug(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPut('/v2/users/me/consent', [
            'slug'  => 'definitely-not-a-real-consent-type',
            'given' => true,
        ]);

        $response->assertStatus(422);
        $this->assertNotSame(500, $response->getStatusCode());

        $payload = json_decode($response->getContent(), true);
        $error = $payload['errors'][0] ?? [];
        $this->assertSame('VALIDATION_ERROR', $error['code'] ?? null);
        $this->assertSame('slug', $error['field'] ?? null, 'The rejected field must be named so a client can point at it.');
    }

    // ================================================================
    // GDPR REQUEST — Validation
    // ================================================================

    public function test_gdpr_request_returns_400_for_invalid_type(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/users/me/gdpr-request', [
            'type' => 'invalid',
        ]);

        $response->assertStatus(400);
    }

    public function test_gdpr_request_returns_401_without_auth(): void
    {
        $response = $this->apiPost('/v2/users/me/gdpr-request', [
            'type' => 'access',
        ]);

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    public function test_gdpr_consent_uses_the_request_tenant_when_controller_was_resolved_early(): void
    {
        $user = $this->authenticatedUser();
        DB::table('user_consents')->insert([
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'consent_type' => 'settings_request_tenant_test',
            'consent_given' => 1,
            'consent_text' => 'Request-tenant regression fixture.',
            'consent_version' => '1.0',
            'given_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Reproduce production controller construction before ResolveTenant:
        // the old injected GdprService captured tenant 999 here and returned no
        // tenant-2 consent even though the API request subsequently resolved 2.
        \App\Core\TenantContext::setById(999);
        $controller = $this->app->make(\App\Http\Controllers\Api\UsersController::class);
        $this->app->instance(\App\Http\Controllers\Api\UsersController::class, $controller);

        $this->apiGet('/v2/users/me/consent')
            ->assertStatus(200)
            ->assertJsonPath('data.0.consent_type_slug', 'settings_request_tenant_test');
    }
}
