<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\EmailDispatchService;
use Tests\Laravel\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

/**
 * Feature tests for EmailVerificationController — email verification and resend.
 *
 * These are public endpoints (rate-limited) — no auth required.
 */
class EmailVerificationControllerTest extends TestCase
{
    use DatabaseTransactions;

    /**
     * Defensively reset state that earlier (unrelated) tests in the full suite
     * can leak into this class and that is NOT rolled back by DatabaseTransactions.
     *
     * Hypothesis for the polluted failure of test_resend_verification_requires_email:
     * resendVerification() runs requireAuth() first (expects 401 when anonymous), but
     * BaseApiController::resolveSanctumUserOptionally() probes Auth::guard('sanctum')->user()
     * — a stale Sanctum actingAs() user left by a prior test makes the endpoint treat the
     * caller as authenticated, skip the 401, then fall through to its file-based
     * App\Core\RateLimiter (429) or a missing-user 404 — both outside [400,401,422].
     *
     * Resets, smallest-first:
     *  - forgetGuards(): drop any leaked actingAs() user so anonymous stays anonymous.
     *  - TenantContext reset + re-pin: clear stale token/header tenant ids before re-pinning 2.
     *  - Cache::flush(): clear Laravel cache-backed limiter counters (array driver, safe).
     *  - clear App\Core\RateLimiter file dir: that limiter is file-backed, NOT in the cache,
     *    so a leaked resend counter file would otherwise survive into this run.
     */
    protected function setUp(): void
    {
        parent::setUp();

        $this->app['auth']->forgetGuards();

        // forgetGuards() does NOT clear the legacy PHP session superglobal, and
        // BaseApiController::resolveUserId() falls back to $_SESSION['user_id']
        // when no guard user exists — a leaked legacy session id from an earlier
        // test makes the anonymous resend request authenticate as a user that
        // doesn't exist in this tenant (404 instead of 401).
        unset($_SESSION['user_id']);

        TenantContext::reset();
        TenantContext::setById($this->testTenantId);

        Cache::flush();

        $rateLimitDir = sys_get_temp_dir() . '/nexus_ratelimit';
        if (is_dir($rateLimitDir)) {
            foreach (glob($rateLimitDir . '/*.json') ?: [] as $file) {
                @unlink($file);
            }
        }
    }

    // ------------------------------------------------------------------
    //  POST /auth/verify-email (public, rate-limited)
    // ------------------------------------------------------------------

    public function test_verify_email_requires_token(): void
    {
        $response = $this->apiPost('/auth/verify-email', []);

        $this->assertContains($response->getStatusCode(), [400, 422]);
    }

    public function test_verify_email_rejects_invalid_token(): void
    {
        $response = $this->apiPost('/auth/verify-email', [
            'token' => 'invalid-token-abc123',
        ]);

        $this->assertContains($response->getStatusCode(), [400, 404, 422]);
    }

    public function test_verify_email_accepts_a_sha256_stored_token(): void
    {
        // Regression: tokens are now stored as sha256(token) so verification
        // is one indexed lookup. The old bcrypt scheme password_verify()'d
        // EVERY unexpired token in the tenant (~100ms each) — a registration
        // wave of a few hundred pending users made this public endpoint hang
        // for 30+ seconds and time out.
        $this->ensureEmailVerificationTokenTable();

        $user = User::factory()->forTenant($this->testTenantId)->create([
            'email_verified_at' => null,
            'is_verified' => false,
            'is_approved' => true,
            'status' => 'pending',
        ]);

        $plaintext = bin2hex(random_bytes(32));
        DB::table('email_verification_tokens')->insert([
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'token' => hash('sha256', $plaintext),
            'expires_at' => now()->addDay(),
        ]);

        $response = $this->apiPost('/auth/verify-email', ['token' => $plaintext]);

        $response->assertOk();
        $this->assertNotNull(DB::table('users')->where('id', $user->id)->value('email_verified_at'));
    }

    public function test_verify_email_still_accepts_a_legacy_bcrypt_stored_token(): void
    {
        // Rows written before the sha256 switch hold bcrypt hashes; they must
        // keep verifying until they expire (24h TTL) after the deploy.
        $this->ensureEmailVerificationTokenTable();

        $user = User::factory()->forTenant($this->testTenantId)->create([
            'email_verified_at' => null,
            'is_verified' => false,
            'is_approved' => true,
            'status' => 'pending',
        ]);

        $plaintext = bin2hex(random_bytes(32));
        DB::table('email_verification_tokens')->insert([
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'token' => password_hash($plaintext, PASSWORD_DEFAULT),
            'expires_at' => now()->addDay(),
        ]);

        $response = $this->apiPost('/auth/verify-email', ['token' => $plaintext]);

        $response->assertOk();
        $this->assertNotNull(DB::table('users')->where('id', $user->id)->value('email_verified_at'));
    }

    public function test_verify_email_rejects_a_token_from_another_tenant(): void
    {
        // Security: a verification token issued for tenant A must NOT verify a
        // user when the request resolves under tenant B. The lookup is tenant-
        // scoped (WHERE tenant_id = ? AND token = ?), so a foreign token is
        // invalid here and must never flip the foreign user to verified.
        $this->ensureEmailVerificationTokenTable();

        $otherTenantId = 999; // seeded active in TestCase::setUpTenantContext

        $foreignUser = User::factory()->forTenant($otherTenantId)->create([
            'email_verified_at' => null,
            'is_verified' => false,
            'is_approved' => true,
            'status' => 'pending',
        ]);

        $plaintext = bin2hex(random_bytes(32));
        DB::table('email_verification_tokens')->insert([
            'user_id' => $foreignUser->id,
            'tenant_id' => $otherTenantId,
            'token' => hash('sha256', $plaintext),
            'expires_at' => now()->addDay(),
        ]);

        // Request resolves under the default test tenant (2), not 999.
        TenantContext::setById($this->testTenantId);
        $response = $this->apiPost('/auth/verify-email', ['token' => $plaintext]);

        $this->assertContains($response->getStatusCode(), [400, 404]);

        // The foreign user must remain unverified.
        $this->assertNull(DB::table('users')->where('id', $foreignUser->id)->value('email_verified_at'));
    }

    public function test_verify_email_does_not_activate_an_unapproved_user(): void
    {
        // Approval gate: on tenants that require admin approval, confirming the
        // email must NOT bypass approval. The account stays pending.
        $this->ensureEmailVerificationTokenTable();

        // Make the tenant policy explicit (B2 fix keys activation off this flag).
        app(\App\Services\TenantSettingsService::class)
            ->set($this->testTenantId, 'admin_approval', 'true', 'boolean');

        $user = User::factory()->forTenant($this->testTenantId)->create([
            'email_verified_at' => null,
            'is_verified' => false,
            'is_approved' => false, // NOT approved yet
            'status' => 'pending',
        ]);

        $plaintext = bin2hex(random_bytes(32));
        DB::table('email_verification_tokens')->insert([
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'token' => hash('sha256', $plaintext),
            'expires_at' => now()->addDay(),
        ]);

        TenantContext::setById($this->testTenantId);
        $response = $this->apiPost('/auth/verify-email', ['token' => $plaintext]);

        $response->assertOk();

        $row = DB::table('users')->where('id', $user->id)->first();
        // Email is confirmed...
        $this->assertNotNull($row->email_verified_at);
        $this->assertEquals(1, (int) $row->is_verified);
        // ...but the account stays pending because it is not approved.
        $this->assertSame('pending', $row->status);
    }

    public function test_verify_email_activates_an_already_approved_pending_user(): void
    {
        // The positive side of the gate: an approved, email-pending user becomes
        // active the moment they confirm their email.
        $this->ensureEmailVerificationTokenTable();

        $user = User::factory()->forTenant($this->testTenantId)->create([
            'email_verified_at' => null,
            'is_verified' => false,
            'is_approved' => true, // already approved
            'status' => 'pending',
        ]);

        $plaintext = bin2hex(random_bytes(32));
        DB::table('email_verification_tokens')->insert([
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'token' => hash('sha256', $plaintext),
            'expires_at' => now()->addDay(),
        ]);

        TenantContext::setById($this->testTenantId);
        $response = $this->apiPost('/auth/verify-email', ['token' => $plaintext]);

        $response->assertOk();

        $row = DB::table('users')->where('id', $user->id)->first();
        $this->assertNotNull($row->email_verified_at);
        $this->assertSame('active', $row->status);
    }

    // ------------------------------------------------------------------
    //  POST /auth/resend-verification (public, rate-limited)
    // ------------------------------------------------------------------

    public function test_resend_verification_requires_email(): void
    {
        $response = $this->apiPost('/auth/resend-verification', []);

        $this->assertContains($response->getStatusCode(), [400, 401, 422]);
    }

    public function test_resend_verification_does_not_rotate_token_when_send_fails(): void
    {
        $this->ensureEmailVerificationTokenTable();

        $user = User::factory()->forTenant($this->testTenantId)->create([
            'email_verified_at' => null,
            'is_verified' => false,
            'preferred_language' => 'en',
        ]);
        Sanctum::actingAs($user, ['*']);

        $oldTokenId = DB::table('email_verification_tokens')->insertGetId([
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'token' => password_hash('still-valid-token', PASSWORD_DEFAULT),
            'expires_at' => now()->addDay(),
        ]);

        app()->instance(EmailDispatchService::class, new FailingEmailDispatchService());

        $response = $this->apiPost('/auth/resend-verification', []);

        $response->assertStatus(503);
        $this->assertSame(1, DB::table('email_verification_tokens')
            ->where('user_id', $user->id)
            ->where('tenant_id', $this->testTenantId)
            ->count());
        $this->assertTrue(DB::table('email_verification_tokens')->where('id', $oldTokenId)->exists());
    }

    public function test_resend_verification_replaces_token_after_send_acceptance(): void
    {
        $this->ensureEmailVerificationTokenTable();

        $user = User::factory()->forTenant($this->testTenantId)->create([
            'email_verified_at' => null,
            'is_verified' => false,
            'preferred_language' => 'en',
        ]);
        Sanctum::actingAs($user, ['*']);

        $oldTokenId = DB::table('email_verification_tokens')->insertGetId([
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'token' => password_hash('old-token', PASSWORD_DEFAULT),
            'expires_at' => now()->addDay(),
        ]);

        app()->instance(EmailDispatchService::class, new SuccessfulEmailDispatchService());

        $response = $this->apiPost('/auth/resend-verification', []);

        $response->assertOk();
        $this->assertSame(1, DB::table('email_verification_tokens')
            ->where('user_id', $user->id)
            ->where('tenant_id', $this->testTenantId)
            ->count());
        $this->assertFalse(DB::table('email_verification_tokens')->where('id', $oldTokenId)->exists());
    }

    // ------------------------------------------------------------------
    //  POST /auth/resend-verification-by-email (public, rate-limited)
    // ------------------------------------------------------------------

    public function test_resend_verification_by_email_requires_email(): void
    {
        $response = $this->apiPost('/auth/resend-verification-by-email', []);

        $this->assertContains($response->getStatusCode(), [200, 429]);
    }

    /**
     * F-024 (E-013): the public resend-verification-by-email endpoint must not
     * leak account existence through response timing. It returns an identical
     * generic message either way, but sending the verification email inline —
     * only for an existing, unverified account — made that address answer
     * measurably slower than an unknown one. The reset work must be dispatched
     * to the queue and run out-of-process, and the request must dispatch the job
     * IDENTICALLY whether or not the account exists.
     */
    public function test_resend_verification_by_email_queues_identically_and_never_sends_inline(): void
    {
        \Illuminate\Support\Facades\Queue::fake();
        $this->ensureEmailVerificationTokenTable();

        $existing = 'verify-queue-' . uniqid('', true) . '@example.test';
        User::factory()->forTenant($this->testTenantId)->create([
            'email' => $existing,
            'email_verified_at' => null,
            'is_verified' => false,
        ]);
        $missing = 'no-such-' . uniqid('', true) . '@example.test';

        $existingResponse = $this->apiPost('/auth/resend-verification-by-email', ['email' => $existing]);
        $missingResponse = $this->apiPost('/auth/resend-verification-by-email', ['email' => $missing]);

        $existingResponse->assertStatus(200);
        $missingResponse->assertStatus(200);

        // Dispatched identically for an account that exists and one that does not,
        // so response timing reveals nothing (the account lookup lives in the job).
        \Illuminate\Support\Facades\Queue::assertPushed(\App\Jobs\SendEmailVerificationResend::class, 2);
        \Illuminate\Support\Facades\Queue::assertPushed(
            \App\Jobs\SendEmailVerificationResend::class,
            static fn (\App\Jobs\SendEmailVerificationResend $job): bool => $job->email === $existing
        );
        \Illuminate\Support\Facades\Queue::assertPushed(
            \App\Jobs\SendEmailVerificationResend::class,
            static fn (\App\Jobs\SendEmailVerificationResend $job): bool => $job->email === $missing
        );

        // Byte-identical responses — no message oracle either.
        $this->assertSame($existingResponse->getContent(), $missingResponse->getContent());
    }

    /** The queued job sends and stores a token for an existing, unverified account. */
    public function test_send_email_verification_resend_job_sends_for_existing_unverified(): void
    {
        $this->ensureEmailVerificationTokenTable();
        $email = 'verify-job-' . uniqid('', true) . '@example.test';
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'email' => $email,
            'email_verified_at' => null,
            'is_verified' => false,
        ]);
        app()->instance(EmailDispatchService::class, new SuccessfulEmailDispatchService());

        (new \App\Jobs\SendEmailVerificationResend($email, $this->testTenantId))
            ->handle(app(\App\Services\EmailVerificationSender::class));

        TenantContext::setById($this->testTenantId);
        $this->assertSame(1, DB::table('email_verification_tokens')
            ->where('user_id', $user->id)
            ->where('tenant_id', $this->testTenantId)
            ->count());
    }

    /** The queued job sends nothing for an unknown address or an already-verified account. */
    public function test_send_email_verification_resend_job_is_silent_for_verified_or_missing(): void
    {
        $this->ensureEmailVerificationTokenTable();
        $verified = 'verify-done-' . uniqid('', true) . '@example.test';
        $verifiedUser = User::factory()->forTenant($this->testTenantId)->create([
            'email' => $verified,
            'email_verified_at' => now(),
            'is_verified' => true,
        ]);
        app()->instance(EmailDispatchService::class, new SuccessfulEmailDispatchService());

        (new \App\Jobs\SendEmailVerificationResend($verified, $this->testTenantId))
            ->handle(app(\App\Services\EmailVerificationSender::class));
        (new \App\Jobs\SendEmailVerificationResend('nobody-' . uniqid('', true) . '@example.test', $this->testTenantId))
            ->handle(app(\App\Services\EmailVerificationSender::class));

        TenantContext::setById($this->testTenantId);
        $this->assertSame(0, DB::table('email_verification_tokens')
            ->where('user_id', $verifiedUser->id)
            ->where('tenant_id', $this->testTenantId)
            ->count());
    }

    private function ensureEmailVerificationTokenTable(): void
    {
        DB::statement("
            CREATE TABLE IF NOT EXISTS `email_verification_tokens` (
                `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                `user_id` INT UNSIGNED NOT NULL,
                `tenant_id` INT(11) NOT NULL,
                `token` VARCHAR(255) NOT NULL,
                `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                `expires_at` TIMESTAMP NOT NULL,
                INDEX `idx_user_id` (`user_id`),
                INDEX `idx_tenant_id` (`tenant_id`),
                INDEX `idx_tenant_user` (`tenant_id`, `user_id`),
                INDEX `idx_expires_at` (`expires_at`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");
    }
}

class FailingEmailDispatchService extends EmailDispatchService
{
    public function send(string $to, string $subject, string $body, array $options = []): bool
    {
        return false;
    }
}

class SuccessfulEmailDispatchService extends EmailDispatchService
{
    public function send(string $to, string $subject, string $body, array $options = []): bool
    {
        return true;
    }
}
