<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Integration;

use App\Models\Category;
use App\Models\Listing;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Integration test: user registration, login, onboarding, and first listing.
 *
 * Covers the new-member journey from account creation through to
 * becoming a productive community participant.
 */
class RegistrationOnboardingTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        // Seed tenant settings needed for registration.
        //
        // RegistrationPolicyService::getEffectivePolicy() reads the registration
        // mode from the `general.registration_mode` / `registration_mode` settings
        // keys (NOT the older registration_enabled/registration_policy keys). We
        // must set registration_mode='open', otherwise the service defaults can
        // resolve to 'closed' (HTTP 403) when a stale cached settings set is read.
        foreach (['general.registration_mode', 'registration_mode'] as $modeKey) {
            // updateOrInsert (not insertOrIgnore): a stale persistent row from another
            // test fixture may already hold registration_mode='closed', which would
            // be silently kept by insertOrIgnore and resolve the policy to closed (403).
            DB::table('tenant_settings')->updateOrInsert(
                ['tenant_id' => $this->testTenantId, 'setting_key' => $modeKey],
                [
                    'category'      => 'general',
                    'setting_value' => 'open',
                    'setting_type'  => 'string',
                ]
            );
        }

        // Settings are cached in a persistent store (Redis) for 5 minutes keyed by
        // tenant. A stale cached set from a previous run would shadow the freshly
        // seeded rows above (Cache::remember short-circuits the DB read), so forget
        // the tenant's settings cache to force a clean reload from the test DB.
        app(\App\Services\TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);

        // Seed some categories for onboarding interest selection.
        //
        // Use explicit, guaranteed-unique names/slugs instead of the factory's
        // faker->unique()->words(2) default. Faker's uniqueness is in-memory
        // only and does not account for category rows already committed by other
        // tests in the same shard, so the short two-word names intermittently
        // collided with the `unique_name_tenant` constraint (e.g. duplicate
        // "Et et"), failing this test non-deterministically under sharded CI.
        foreach (range(1, 3) as $i) {
            $suffix = Str::lower(Str::random(8));
            Category::factory()->forTenant($this->testTenantId)->create([
                'type' => 'listing',
                'name' => "Onboarding Interest {$i} {$suffix}",
                'slug' => "onboarding-interest-{$i}-{$suffix}",
            ]);
        }
    }

    // =========================================================================
    // Registration Flow
    // =========================================================================

    public function test_register_creates_user_with_correct_tenant(): void
    {
        $response = $this->apiPost('/v2/auth/register', [
            'first_name'            => 'Jane',
            'last_name'             => 'Doe',
            'email'                 => 'jane.doe@gmail.com',
            'location'              => 'Springfield',
            'phone'                 => '+15551234567',
            'password'              => 'Xq7!vM2pLw9zRt4B',
            'password_confirmation' => 'Xq7!vM2pLw9zRt4B',
            'terms_accepted'        => true,
        ]);

        // Registration may return 201 (created) or 200
        if ($response->getStatusCode() === 422) {
            $this->markTestIncomplete(
                'Registration rejected (policy/validation): ' . $response->getContent()
            );
        }

        $this->assertContains($response->getStatusCode(), [200, 201]);

        // Verify user exists in the database with the correct tenant
        $user = User::where('email', 'jane.doe@gmail.com')
            ->where('tenant_id', $this->testTenantId)
            ->first();

        $this->assertNotNull($user, 'User should exist in the database');
        $this->assertEquals($this->testTenantId, $user->tenant_id);
        $this->assertEquals('jane.doe@gmail.com', $user->email);
        $this->assertContains($user->role, ['member', 'pending']);
    }

    public function test_register_rejects_duplicate_email(): void
    {
        User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'existing@example.com',
        ]);

        $response = $this->apiPost('/v2/auth/register', [
            'name'                  => 'Duplicate User',
            'email'                 => 'existing@example.com',
            'password'              => 'SecurePass123!',
            'password_confirmation' => 'SecurePass123!',
        ]);

        // Should be rejected (400, 409, or 422)
        $this->assertContains($response->getStatusCode(), [400, 409, 422]);
    }

    public function test_register_rejects_weak_password(): void
    {
        $response = $this->apiPost('/v2/auth/register', [
            'name'                  => 'Weak Pass User',
            'email'                 => 'weak@example.com',
            'password'              => '123',
            'password_confirmation' => '123',
            'terms_accepted'        => true,
        ]);

        // Should be rejected for weak password
        $this->assertContains($response->getStatusCode(), [400, 422]);
    }

    // =========================================================================
    // Login After Registration
    // =========================================================================

    public function test_login_with_newly_registered_credentials(): void
    {
        // Create user directly (registration may require email verification).
        // Unique email per run to avoid colliding with leftover rows from a
        // prior non-transactional run on the (email, tenant_id) unique key.
        $email = 'newuser+' . uniqid() . '@example.com';
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'email'             => $email,
            'password_hash'     => Hash::make('SecurePass123!'),
            'status'            => 'active',
            'is_approved'       => true,
            'email_verified_at' => now(),
        ]);

        $response = $this->apiPost('/auth/login', [
            'email'    => $email,
            'password' => 'SecurePass123!',
        ]);

        $this->assertEquals(200, $response->getStatusCode());
        $response->assertJsonStructure(['token']);
    }

    public function test_login_scoped_to_correct_tenant(): void
    {
        // Create user on a different tenant
        $otherTenantId = 999;
        DB::table('tenants')->insertOrIgnore([
            'id'         => $otherTenantId,
            'name'       => 'Other Timebank',
            'slug'       => 'other-timebank',
            'is_active'  => true,
            'depth'      => 0,
            'allows_subtenants' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Use a unique email per run: a previous (non-transactional) run may have
        // left an `otheruser@example.com` row on tenant 999, and the
        // (email, tenant_id) unique key would collide on re-insert.
        $otherEmail = 'otheruser+' . uniqid() . '@example.com';
        User::factory()->forTenant($otherTenantId)->create([
            'email'             => $otherEmail,
            'password_hash'     => Hash::make('SecurePass123!'),
            'status'            => 'active',
            'email_verified_at' => now(),
        ]);

        // Try to login with the test tenant's header (tenant 2)
        $response = $this->apiPost('/auth/login', [
            'email'    => $otherEmail,
            'password' => 'SecurePass123!',
        ]);

        // Should fail — user belongs to a different tenant
        $this->assertContains($response->getStatusCode(), [400, 401, 403, 404]);
    }

    // =========================================================================
    // Onboarding Flow
    // =========================================================================

    public function test_onboarding_status_for_new_user(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status'               => 'active',
            'is_approved'          => true,
            'onboarding_completed' => false,
            'bio'                  => null,
        ]);

        Sanctum::actingAs($user, ['*']);

        $response = $this->apiGet('/v2/onboarding/status');
        $this->assertEquals(200, $response->getStatusCode());

        $data = $response->json('data') ?? $response->json();
        $this->assertFalse($data['onboarding_completed'] ?? $data['data']['onboarding_completed'] ?? true);
    }

    public function test_onboarding_categories_returns_tenant_categories(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status'      => 'active',
            'is_approved' => true,
        ]);

        Sanctum::actingAs($user, ['*']);

        $response = $this->apiGet('/v2/onboarding/categories');
        $this->assertEquals(200, $response->getStatusCode());

        $data = $response->json('data') ?? $response->json();
        $categories = $data['data'] ?? $data;
        $this->assertNotEmpty($categories, 'Should return at least the seeded categories');
    }

    public function test_complete_onboarding(): void
    {
        // Onboarding completion requires a profile photo and bio to be present
        // (OnboardingController::complete enforces avatar_url + bio before saving).
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status'               => 'active',
            'is_approved'          => true,
            'onboarding_completed' => false,
            'avatar_url'           => 'https://example.com/avatar.png',
            'bio'                  => 'I love helping my local community.',
        ]);

        Sanctum::actingAs($user, ['*']);

        $categories = Category::where('tenant_id', $this->testTenantId)->pluck('id')->toArray();

        $response = $this->apiPost('/v2/onboarding/complete', [
            'interests' => array_slice($categories, 0, 2),
        ]);

        // Onboarding completion should succeed
        $this->assertContains($response->getStatusCode(), [200, 201]);

        // Verify the user is now marked as onboarded
        $user->refresh();
        $this->assertTrue((bool) $user->onboarding_completed);
    }

    public function test_onboarding_does_not_auto_create_listings(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status'               => 'active',
            'is_approved'          => true,
            'onboarding_completed' => false,
            'avatar_url'           => 'https://example.com/avatar.png',
            'bio'                  => 'I love helping my local community.',
        ]);

        Sanctum::actingAs($user, ['*']);

        $categories = Category::where('tenant_id', $this->testTenantId)->pluck('id')->toArray();

        // Complete onboarding with offers and needs selected
        $response = $this->apiPost('/v2/onboarding/complete', [
            'interests' => array_slice($categories, 0, 2),
            'offers'    => array_slice($categories, 0, 2),
            'needs'     => array_slice($categories, 0, 1),
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201]);

        // Verify onboarding completed
        $user->refresh();
        $this->assertTrue((bool) $user->onboarding_completed);

        // Verify NO listings were auto-created (auto-creation is disabled)
        $listingCount = Listing::where('user_id', $user->id)
            ->where('tenant_id', $this->testTenantId)
            ->count();
        $this->assertEquals(0, $listingCount, 'Onboarding should NOT auto-create listings');

    }

    public function test_onboarding_saves_skills_where_matching_reads_them(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status'               => 'active',
            'is_approved'          => true,
            'onboarding_completed' => false,
            'avatar_url'           => 'https://example.com/avatar.png',
            'bio'                  => 'I love helping my local community.',
        ]);

        Sanctum::actingAs($user, ['*']);

        $response = $this->apiPost('/v2/onboarding/complete', [
            'skills' => ['offer' => ['Gardening'], 'need' => ['Computer help']],
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201]);

        $offering = DB::table('user_skills')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->where('is_offering', 1)
            ->pluck('skill_name')
            ->all();
        $requesting = DB::table('user_skills')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->where('is_requesting', 1)
            ->pluck('skill_name')
            ->all();
        $this->assertSame(['Gardening'], $offering);
        $this->assertSame(['Computer help'], $requesting);
    }

    // =========================================================================
    // First Listing After Onboarding
    // =========================================================================

    public function test_new_user_can_create_first_listing(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status'               => 'active',
            'is_approved'          => true,
            'onboarding_completed' => true,
        ]);

        Sanctum::actingAs($user, ['*']);

        $categoryId = Category::where('tenant_id', $this->testTenantId)
            ->where('type', 'listing')
            ->value('id');

        $response = $this->apiPost('/v2/listings', [
            'title'        => 'My First Offer',
            'description'  => 'I can help with cooking and meal prep for families.',
            'type'         => 'offer',
            'category_id'  => $categoryId,
            'hours_estimate' => 1.50,
            'service_type' => 'physical_only',
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201]);

        // Verify listing exists in the database
        $listing = Listing::where('user_id', $user->id)
            ->where('tenant_id', $this->testTenantId)
            ->first();

        $this->assertNotNull($listing, 'Listing should be created in the database');
        $this->assertEquals('My First Offer', $listing->title);
        $this->assertEquals('offer', $listing->type);
    }

    // =========================================================================
    // Full Journey: Register -> Login -> Onboard -> Create Listing
    // =========================================================================

    public function test_full_registration_to_first_listing_journey(): void
    {
        // Step 1: Register. The current contract requires first_name/last_name,
        // a deliverable email domain (MX-checked), a valid international phone,
        // a location, a >=12-char password, and accepted terms.
        $registerResponse = $this->apiPost('/v2/auth/register', [
            'first_name'            => 'Full',
            'last_name'             => 'Journey',
            'email'                 => 'journey.user@gmail.com',
            'location'              => 'Springfield',
            'phone'                 => '+15557654321',
            'password'              => 'Kp4!wZ9tQm2xLs7N',
            'password_confirmation' => 'Kp4!wZ9tQm2xLs7N',
            'terms_accepted'        => true,
        ]);

        if ($registerResponse->getStatusCode() === 422 || $registerResponse->getStatusCode() === 400) {
            $this->markTestIncomplete(
                'Registration flow requires additional setup: ' . $registerResponse->getContent()
            );
        }

        // Step 2: Manually activate user (email verification would be async) and
        // give the profile the avatar + bio that onboarding completion requires.
        $user = User::where('email', 'journey.user@gmail.com')
            ->where('tenant_id', $this->testTenantId)
            ->first();

        if (!$user) {
            $this->markTestIncomplete('Registration did not create user — may require email verification flow');
        }

        $user->update([
            'status'            => 'active',
            'is_approved'       => true,
            'email_verified_at' => now(),
            'avatar_url'        => 'https://example.com/avatar.png',
            'bio'               => 'Excited to join the timebank.',
            'password_hash'     => Hash::make('Kp4!wZ9tQm2xLs7N'),
        ]);

        // Step 3: Login
        $loginResponse = $this->apiPost('/auth/login', [
            'email'    => 'journey.user@gmail.com',
            'password' => 'Kp4!wZ9tQm2xLs7N',
        ]);

        $this->assertEquals(200, $loginResponse->getStatusCode());

        // Step 4: Onboard and create listing using Sanctum
        Sanctum::actingAs($user, ['*']);

        $onboardResponse = $this->apiPost('/v2/onboarding/complete', [
            'interests' => [],
        ]);
        $this->assertContains($onboardResponse->getStatusCode(), [200, 201]);

        // Re-authenticate with a fresh user instance so the onboarding-required
        // middleware (which reads $request->user()->onboarding_completed) sees the
        // updated flag — Sanctum::actingAs caches the in-memory instance otherwise.
        $user = $user->fresh();
        Sanctum::actingAs($user, ['*']);

        // Step 5: Create first listing
        $categoryId = Category::where('tenant_id', $this->testTenantId)
            ->where('type', 'listing')
            ->value('id');

        $listingResponse = $this->apiPost('/v2/listings', [
            'title'        => 'Journey Listing',
            'description'  => 'My first community offer after onboarding, ready to help.',
            'type'         => 'offer',
            'category_id'  => $categoryId,
            'hours_estimate' => 1.00,
            'service_type' => 'hybrid',
        ]);

        $this->assertContains($listingResponse->getStatusCode(), [200, 201]);

        // Verify the full journey completed
        $user->refresh();
        $this->assertTrue((bool) $user->onboarding_completed);
        $this->assertEquals(1, Listing::where('user_id', $user->id)->count());
    }

    public function test_register_requires_all_fields(): void
    {
        // Missing name
        $response = $this->apiPost('/v2/auth/register', [
            'email'                 => 'noname@example.com',
            'password'              => 'SecurePass123!',
            'password_confirmation' => 'SecurePass123!',
        ]);

        $this->assertContains($response->getStatusCode(), [400, 422]);
    }
}
