<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use Tests\Laravel\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;

/**
 * Feature tests for RegistrationController — user registration (public, rate-limited).
 */
class RegistrationControllerTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        if (session_status() === PHP_SESSION_ACTIVE) {
            $_SESSION = [];
            session_destroy();
        }
        RateLimiter::clear('api:registration:ip:127.0.0.1');
        RateLimiter::clear('api:registration:ip:::1');
        RateLimiter::clear('register_success_ip:127.0.0.1');
        RateLimiter::clear('register_success_ip:::1');
        \Illuminate\Support\Facades\Cache::forget('register_tenant_breaker:' . $this->testTenantId);
        \Illuminate\Support\Facades\Cache::forget('register_tenant_breaker:' . $this->testTenantId . ':ttl');
        \Illuminate\Support\Facades\Cache::forget('register_tenant_hourly:' . $this->testTenantId);

        // Ensure registration is OPEN for the test tenant. A persistent local test DB
        // can hold a stale `general.registration_mode = closed` row (e.g. left by other
        // suites), which makes every register request 403 REGISTRATION_CLOSED. Seed
        // 'open' explicitly so these tests exercise the real validation pipeline.
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'general.registration_mode'],
            [
                'setting_value' => 'open',
                'setting_type' => 'string',
                'updated_at' => now(),
            ]
        );
        DB::table('tenant_registration_policies')->updateOrInsert(
            ['tenant_id' => $this->testTenantId],
            [
                'registration_mode' => 'open',
                'verification_level' => 'none',
                'post_verification' => 'activate',
                'fallback_mode' => 'none',
                'require_email_verify' => 1,
                'is_active' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
        app(\App\Services\TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);
    }

    // ------------------------------------------------------------------
    //  POST /v2/auth/register (PUBLIC, rate-limited)
    // ------------------------------------------------------------------

    public function test_register_requires_fields(): void
    {
        $response = $this->apiPost('/v2/auth/register', []);

        $this->assertContains($response->getStatusCode(), [400, 422]);
    }

    public function test_register_requires_email(): void
    {
        $response = $this->apiPost('/v2/auth/register', [
            'first_name' => 'Test',
            'last_name' => 'User',
            'password' => 'StrongPassword123!',
        ]);

        $this->assertContains($response->getStatusCode(), [400, 422]);
    }

    public function test_register_requires_password(): void
    {
        $response = $this->apiPost('/v2/auth/register', [
            'first_name' => 'Test',
            'last_name' => 'User',
            'email' => 'newuser@gmail.com',
        ]);

        $this->assertContains($response->getStatusCode(), [400, 422]);
    }

    public function test_register_requires_phone(): void
    {
        $response = $this->apiPost('/v2/auth/register', [
            'first_name' => 'Test',
            'last_name' => 'User',
            'email' => 'newuser-' . uniqid() . '@gmail.com',
            'location' => 'Toronto, Canada',
            'password' => 'CoffeeMugSundayMorningPhpUnitTest2026',
            'password_confirmation' => 'CoffeeMugSundayMorningPhpUnitTest2026',
        ]);

        $this->assertContains($response->getStatusCode(), [400, 422]);
    }

    public function test_register_requires_location(): void
    {
        $response = $this->apiPost('/v2/auth/register', [
            'first_name' => 'Test',
            'last_name' => 'User',
            'email' => 'newuser-' . uniqid() . '@gmail.com',
            'phone' => '+15551234567',
            'password' => 'CoffeeMugSundayMorningPhpUnitTest2026',
            'password_confirmation' => 'CoffeeMugSundayMorningPhpUnitTest2026',
        ]);

        $this->assertContains($response->getStatusCode(), [400, 422]);
    }

    public function test_register_rejects_invalid_phone(): void
    {
        $response = $this->apiPost('/v2/auth/register', [
            'first_name' => 'Test',
            'last_name' => 'User',
            'email' => 'newuser-' . uniqid() . '@gmail.com',
            'location' => 'Toronto, Canada',
            'phone' => 'not-a-phone',
            'password' => 'CoffeeMugSundayMorningPhpUnitTest2026',
            'password_confirmation' => 'CoffeeMugSundayMorningPhpUnitTest2026',
        ]);

        $this->assertContains($response->getStatusCode(), [400, 422]);
    }

    public function test_register_happy_path(): void
    {
        $response = $this->apiPost('/v2/auth/register', [
            'first_name' => 'Test',
            'last_name' => 'User',
            'email' => 'newuser-' . uniqid() . '@gmail.com',
            'location' => 'Toronto, Canada',
            'phone' => '+15551234567',
            'password' => 'CoffeeMugSundayMorningPhpUnitTest2026',
            'password_confirmation' => 'CoffeeMugSundayMorningPhpUnitTest2026',
            'terms_accepted' => true,
            // Backdate so the >= 5s min-form-time bot gate passes.
            'form_started_at' => (int) (microtime(true) * 1000) - 6000,
            'latitude' => 43.6532,
            'longitude' => -79.3832,
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201], 'Response body: ' . $response->getContent());
    }

    /**
     * 🔴 Registration validated `terms_accepted` and then discarded it. The
     * versioned `user_legal_acceptances` table already existed — including an
     * `acceptance_method` enum whose 'registration' value had never once been
     * written — and LegalDocumentService::acceptAll() was already built for this
     * and already defaulted to 'registration'. It simply had no caller. The only
     * versioned record a member ever got was created later, at first login, by the
     * legal gate and stamped 'login_prompt', so between registering and first
     * logging in there was no evidence of which terms they had agreed to.
     */
    public function test_register_pins_the_accepted_terms_version(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();

        $documentId = (int) DB::table('legal_documents')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'document_type' => 'terms',
            'title' => 'Terms',
            'slug' => 'terms-' . uniqid(),
            'requires_acceptance' => 1,
            'acceptance_required_for' => 'registration',
            'notify_on_update' => 0,
            'is_active' => 1,
            'created_by' => $admin->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // No tenant_id on this table — versions are tenant-scoped through their
        // parent document.
        $versionId = (int) DB::table('legal_document_versions')->insertGetId([
            'document_id' => $documentId,
            'version_number' => '2.4',
            'content' => 'The terms in force at the moment this member registered.',
            'is_current' => 1,
            'is_draft' => 0,
            'effective_date' => now()->toDateString(),
            'created_by' => $admin->id,
            'published_by' => $admin->id,
            'published_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('legal_documents')->where('id', $documentId)
            ->update(['current_version_id' => $versionId]);

        $email = 'termsversion-' . uniqid() . '@gmail.com';

        $response = $this->apiPost('/v2/auth/register', [
            'first_name' => 'Terms',
            'last_name' => 'Tester',
            'email' => $email,
            'location' => 'Toronto, Canada',
            'phone' => '+15551234567',
            'password' => 'CoffeeMugSundayMorningPhpUnitTest2026',
            'password_confirmation' => 'CoffeeMugSundayMorningPhpUnitTest2026',
            'terms_accepted' => true,
            'form_started_at' => (int) (microtime(true) * 1000) - 6000,
            'latitude' => 43.6532,
            'longitude' => -79.3832,
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201], 'Response body: ' . $response->getContent());

        $userId = (int) DB::table('users')
            ->where('tenant_id', $this->testTenantId)
            ->where('email', $email)
            ->value('id');
        $this->assertGreaterThan(0, $userId);

        $acceptance = DB::table('user_legal_acceptances')
            ->where('user_id', $userId)
            ->where('version_id', $versionId)
            ->first();

        $this->assertNotNull(
            $acceptance,
            'Registering must record WHICH version of the terms the member accepted.'
        );
        // The specific version, not just "the terms".
        $this->assertSame('2.4', $acceptance->version_number);
        $this->assertEquals($documentId, (int) $acceptance->document_id);
        // 'registration', not the 'login_prompt' the legal gate would later stamp.
        $this->assertSame('registration', $acceptance->acceptance_method);
        $this->assertNotNull($acceptance->accepted_at);
    }

    public function test_register_still_succeeds_when_the_tenant_has_no_legal_documents(): void
    {
        // No version exists to pin, so nothing is recorded — that is the honest
        // outcome, and it must not break registration.
        DB::table('legal_documents')->where('tenant_id', $this->testTenantId)->update(['is_active' => 0]);

        $email = 'nolegal-' . uniqid() . '@gmail.com';

        $response = $this->apiPost('/v2/auth/register', [
            'first_name' => 'No',
            'last_name' => 'Legal',
            'email' => $email,
            'location' => 'Toronto, Canada',
            'phone' => '+15551234567',
            'password' => 'CoffeeMugSundayMorningPhpUnitTest2026',
            'password_confirmation' => 'CoffeeMugSundayMorningPhpUnitTest2026',
            'terms_accepted' => true,
            'form_started_at' => (int) (microtime(true) * 1000) - 6000,
            'latitude' => 43.6532,
            'longitude' => -79.3832,
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201], 'Response body: ' . $response->getContent());

        $userId = (int) DB::table('users')
            ->where('tenant_id', $this->testTenantId)
            ->where('email', $email)
            ->value('id');
        $this->assertGreaterThan(0, $userId, 'Registration must still create the account.');
    }

    /**
     * 🔴 The React app has always been built to consume `requires_approval` —
     * AuthContext reads it and RegisterPage has a dedicated "awaiting approval"
     * panel — but registration never returned it, so that panel was unreachable and
     * every new member saw only "check your email". Not an edge case:
     * requiresAdminApproval() returns TRUE when the setting is unset, so this is the
     * DEFAULT experience for a new community.
     */
    public function test_register_reports_that_approval_is_required(): void
    {
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'general.admin_approval'],
            ['setting_value' => '1', 'setting_type' => 'boolean', 'updated_at' => now()]
        );

        $response = $this->apiPost('/v2/auth/register', [
            'first_name' => 'Pending',
            'last_name' => 'Applicant',
            'email' => 'pending-' . uniqid() . '@gmail.com',
            'location' => 'Toronto, Canada',
            'phone' => '+15551234567',
            'password' => 'CoffeeMugSundayMorningPhpUnitTest2026',
            'password_confirmation' => 'CoffeeMugSundayMorningPhpUnitTest2026',
            'terms_accepted' => true,
            'form_started_at' => (int) (microtime(true) * 1000) - 6000,
            'latitude' => 43.6532,
            'longitude' => -79.3832,
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201], 'Response body: ' . $response->getContent());
        $this->assertTrue(
            $response->json('data.requires_approval'),
            'Registration must tell the member they are awaiting approval.'
        );
    }

    public function test_register_reports_no_approval_needed_when_the_setting_is_off(): void
    {
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'general.admin_approval'],
            ['setting_value' => '0', 'setting_type' => 'boolean', 'updated_at' => now()]
        );

        $response = $this->apiPost('/v2/auth/register', [
            'first_name' => 'Self',
            'last_name' => 'Serve',
            'email' => 'selfserve-' . uniqid() . '@gmail.com',
            'location' => 'Toronto, Canada',
            'phone' => '+15551234567',
            'password' => 'CoffeeMugSundayMorningPhpUnitTest2026',
            'password_confirmation' => 'CoffeeMugSundayMorningPhpUnitTest2026',
            'terms_accepted' => true,
            'form_started_at' => (int) (microtime(true) * 1000) - 6000,
            'latitude' => 43.6532,
            'longitude' => -79.3832,
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201], 'Response body: ' . $response->getContent());
        $this->assertFalse($response->json('data.requires_approval'));
    }

    public function test_register_is_blocked_when_admin_registration_mode_is_closed(): void
    {
        DB::table('tenant_registration_policies')->updateOrInsert(
            ['tenant_id' => $this->testTenantId],
            [
                'registration_mode' => 'open',
                'verification_level' => 'none',
                'post_verification' => 'activate',
                'fallback_mode' => 'none',
                'require_email_verify' => 1,
                'is_active' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'general.registration_mode'],
            [
                'setting_value' => 'closed',
                'setting_type' => 'string',
                'updated_at' => now(),
            ]
        );
        app(\App\Services\TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);

        $email = 'closed-registration-' . uniqid() . '@gmail.com';
        $response = $this->apiPost('/v2/auth/register', [
            'first_name' => 'Closed',
            'last_name' => 'Tenant',
            'email' => $email,
            'location' => 'Toronto, Canada',
            'phone' => '+15551234567',
            'password' => 'CoffeeMugSundayMorningPhpUnitTest2026',
            'password_confirmation' => 'CoffeeMugSundayMorningPhpUnitTest2026',
            'terms_accepted' => true,
            'form_started_at' => (int) (microtime(true) * 1000) - 6000,
            'latitude' => 43.6532,
            'longitude' => -79.3832,
        ]);

        $response->assertStatus(403);
        $body = json_decode((string) $response->getContent(), true);
        $this->assertSame(\App\Core\ApiErrorCodes::REGISTRATION_CLOSED, $body['errors'][0]['code'] ?? null);
        $this->assertDatabaseMissing('users', [
            'tenant_id' => $this->testTenantId,
            'email' => $email,
        ]);
    }

    public function test_register_rejects_missing_terms_acceptance(): void
    {
        $response = $this->apiPost('/v2/auth/register', [
            'first_name' => 'Test',
            'last_name' => 'User',
            'email' => 'newuser-' . uniqid() . '@gmail.com',
            'location' => 'Toronto, Canada',
            'phone' => '+15551234567',
            'password' => 'CoffeeMugSundayMorningPhpUnitTest2026',
            'password_confirmation' => 'CoffeeMugSundayMorningPhpUnitTest2026',
            'form_started_at' => (int) (microtime(true) * 1000) - 6000,
            'latitude' => 43.6532,
            'longitude' => -79.3832,
            // terms_accepted intentionally omitted
        ]);

        $this->assertSame(422, $response->getStatusCode());
        $body = json_decode((string) $response->getContent(), true);
        $this->assertSame('TERMS_REQUIRED', $body['errors'][0]['code'] ?? null);
    }

    public function test_register_rejects_password_mismatch(): void
    {
        $response = $this->apiPost('/v2/auth/register', [
            'first_name' => 'Test',
            'last_name' => 'User',
            'email' => 'newuser-' . uniqid() . '@gmail.com',
            'location' => 'Toronto, Canada',
            'phone' => '+15551234567',
            'password' => 'StrongPassword123!',
            'password_confirmation' => 'DifferentPassword123!',
            'terms_accepted' => true,
            'form_started_at' => (int) (microtime(true) * 1000) - 6000,
            'latitude' => 43.6532,
            'longitude' => -79.3832,
        ]);

        $this->assertSame(422, $response->getStatusCode());
        $body = json_decode((string) $response->getContent(), true);
        $this->assertSame('PASSWORD_MISMATCH', $body['errors'][0]['code'] ?? null);
    }

    public function test_register_rejects_unverified_location(): void
    {
        // Verified-location enforcement (reject free-text location with no coords)
        // is OPT-IN per tenant via REGISTRATION_REQUIRE_VERIFIED_LOCATION; it is off
        // by default so tenants without Google Maps aren't bricked. Enable it for
        // this test so the free-text bypass we've seen in the wild is rejected.
        putenv('REGISTRATION_REQUIRE_VERIFIED_LOCATION=true');

        try {
            $response = $this->apiPost('/v2/auth/register', [
                'first_name' => 'Test',
                'last_name' => 'User',
                'email' => 'newuser-' . uniqid() . '@gmail.com',
                'location' => '555',
                'phone' => '+15551234567',
                'password' => 'CoffeeMugSundayMorningPhpUnitTest2026',
                'password_confirmation' => 'CoffeeMugSundayMorningPhpUnitTest2026',
                'terms_accepted' => true,
                'form_started_at' => (int) (microtime(true) * 1000) - 6000,
                // latitude / longitude intentionally omitted — simulates the
                // free-text bypass we've seen in the wild.
            ]);

            $this->assertSame(422, $response->getStatusCode());
            $body = json_decode((string) $response->getContent(), true);
            $this->assertSame('LOCATION_NOT_VERIFIED', $body['errors'][0]['code'] ?? null);
        } finally {
            putenv('REGISTRATION_REQUIRE_VERIFIED_LOCATION');
        }
    }

    public function test_register_rejects_disposable_email_domain(): void
    {
        $response = $this->apiPost('/v2/auth/register', [
            'first_name' => 'Test',
            'last_name' => 'User',
            'email' => 'temp-' . uniqid() . '@mailinator.com',
            'location' => 'Toronto, Canada',
            'phone' => '+15551234567',
            'password' => 'CoffeeMugSundayMorningPhpUnitTest2026',
            'password_confirmation' => 'CoffeeMugSundayMorningPhpUnitTest2026',
            'terms_accepted' => true,
            'form_started_at' => (int) (microtime(true) * 1000) - 6000,
            'latitude' => 43.6532,
            'longitude' => -79.3832,
        ]);

        $this->assertSame(422, $response->getStatusCode());
        $body = json_decode((string) $response->getContent(), true);
        $this->assertSame('EMAIL_DISPOSABLE', $body['errors'][0]['code'] ?? null);
    }

    public function test_register_rejects_disposable_subdomain(): void
    {
        $response = $this->apiPost('/v2/auth/register', [
            'first_name' => 'Test',
            'last_name' => 'User',
            'email' => 'temp-' . uniqid() . '@foo.mailinator.com',
            'location' => 'Toronto, Canada',
            'phone' => '+15551234567',
            'password' => 'CoffeeMugSundayMorningPhpUnitTest2026',
            'password_confirmation' => 'CoffeeMugSundayMorningPhpUnitTest2026',
            'terms_accepted' => true,
            'form_started_at' => (int) (microtime(true) * 1000) - 6000,
            'latitude' => 43.6532,
            'longitude' => -79.3832,
        ]);

        $this->assertSame(422, $response->getStatusCode());
        $body = json_decode((string) $response->getContent(), true);
        $this->assertSame('EMAIL_DISPOSABLE', $body['errors'][0]['code'] ?? null);
    }

    public function test_register_rejects_email_with_no_mail_servers(): void
    {
        // `.invalid` is reserved by RFC 6761 to NEVER resolve — no real
        // domain will ever exist there, so this assertion is stable across
        // every CI environment that has DNS.
        $response = $this->apiPost('/v2/auth/register', [
            'first_name' => 'Test',
            'last_name' => 'User',
            'email' => 'newuser-' . uniqid() . '@nothing-here-' . uniqid() . '.invalid',
            'location' => 'Toronto, Canada',
            'phone' => '+15551234567',
            'password' => 'CoffeeMugSundayMorningPhpUnitTest2026',
            'password_confirmation' => 'CoffeeMugSundayMorningPhpUnitTest2026',
            'terms_accepted' => true,
            'form_started_at' => (int) (microtime(true) * 1000) - 6000,
            'latitude' => 43.6532,
            'longitude' => -79.3832,
        ]);

        $this->assertSame(422, $response->getStatusCode());
        $body = json_decode((string) $response->getContent(), true);
        $this->assertSame('EMAIL_DOMAIN_INVALID', $body['errors'][0]['code'] ?? null);
    }

    public function test_register_rejects_when_daily_ip_cap_exceeded(): void
    {
        // Burn the default cap (5) of successful slots for this IP.
        for ($i = 0; $i < 5; $i++) {
            RateLimiter::hit('register_success_ip:127.0.0.1', 86400);
            RateLimiter::hit('register_success_ip:::1', 86400);
        }

        $response = $this->apiPost('/v2/auth/register', [
            'first_name' => 'Test',
            'last_name' => 'User',
            'email' => 'newuser-' . uniqid() . '@gmail.com',
            'location' => 'Toronto, Canada',
            'phone' => '+15551234567',
            'password' => 'CoffeeMugSundayMorningPhpUnitTest2026',
            'password_confirmation' => 'CoffeeMugSundayMorningPhpUnitTest2026',
            'terms_accepted' => true,
            'form_started_at' => (int) (microtime(true) * 1000) - 6000,
            'latitude' => 43.6532,
            'longitude' => -79.3832,
        ]);

        $this->assertSame(429, $response->getStatusCode());
        $body = json_decode((string) $response->getContent(), true);
        $this->assertSame('REGISTRATION_DAILY_LIMIT', $body['errors'][0]['code'] ?? null);
    }

    public function test_register_rejects_when_tenant_breaker_tripped(): void
    {
        // Trip the breaker directly via the cache key the service reads.
        \Illuminate\Support\Facades\Cache::put('register_tenant_breaker:' . $this->testTenantId, true, 3600);

        try {
            $response = $this->apiPost('/v2/auth/register', [
                'first_name' => 'Test',
                'last_name' => 'User',
                'email' => 'newuser-' . uniqid() . '@gmail.com',
                'location' => 'Toronto, Canada',
                'phone' => '+15551234567',
                'password' => 'StrongPassword123!',
                'password_confirmation' => 'StrongPassword123!',
                'terms_accepted' => true,
                'form_started_at' => (int) (microtime(true) * 1000) - 6000,
                'latitude' => 43.6532,
                'longitude' => -79.3832,
            ]);

            $this->assertSame(503, $response->getStatusCode());
            $body = json_decode((string) $response->getContent(), true);
            $this->assertSame('REGISTRATION_TENANT_PAUSED', $body['errors'][0]['code'] ?? null);
        } finally {
            \Illuminate\Support\Facades\Cache::forget('register_tenant_breaker:' . $this->testTenantId);
            \Illuminate\Support\Facades\Cache::forget('register_tenant_breaker:' . $this->testTenantId . ':ttl');
        }
    }

    public function test_register_rejects_null_island_coordinates(): void
    {
        $response = $this->apiPost('/v2/auth/register', [
            'first_name' => 'Test',
            'last_name' => 'User',
            'email' => 'newuser-' . uniqid() . '@gmail.com',
            'location' => 'Anywhere',
            'phone' => '+15551234567',
            'password' => 'CoffeeMugSundayMorningPhpUnitTest2026',
            'password_confirmation' => 'CoffeeMugSundayMorningPhpUnitTest2026',
            'terms_accepted' => true,
            'form_started_at' => (int) (microtime(true) * 1000) - 6000,
            'latitude' => 0,
            'longitude' => 0,
        ]);

        $this->assertSame(422, $response->getStatusCode());
        $body = json_decode((string) $response->getContent(), true);
        $this->assertSame('LOCATION_NOT_VERIFIED', $body['errors'][0]['code'] ?? null);
    }
}
