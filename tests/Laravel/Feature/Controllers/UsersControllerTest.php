<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\Listing;
use App\Models\User;
use App\Services\EmailDispatchService;
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
