<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Jobs\SendPasswordResetEmail;
use App\Models\User;
use App\Services\EmailDispatchService;
use App\Services\TokenService;
use Tests\Laravel\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\RateLimiter;

/**
 * Feature tests for PasswordResetController — forgot password and reset (public).
 */
class PasswordResetControllerTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        Cache::flush();
        foreach (['forgot_password', 'reset_password'] as $action) {
            RateLimiter::clear("api:{$action}:ip:127.0.0.1");
            RateLimiter::clear("api:{$action}:ip:::1");
            RateLimiter::clear("api:{$action}:ip:");
        }
    }

    // ------------------------------------------------------------------
    //  POST /auth/forgot-password (PUBLIC, rate-limited)
    // ------------------------------------------------------------------

    public function test_forgot_password_requires_email(): void
    {
        $response = $this->apiPost('/auth/forgot-password', []);

        $this->assertContains($response->getStatusCode(), [400, 422, 429]);
    }

    public function test_forgot_password_accepts_email(): void
    {
        $response = $this->apiPost('/auth/forgot-password', [
            'email' => 'nonexistent@example.com',
        ]);

        // Should return 200 even for non-existent emails (security best practice)
        $this->assertContains($response->getStatusCode(), [200, 404, 422, 429]);
    }

    public function test_forgot_password_preserves_existing_token_when_email_send_fails(): void
    {
        $email = 'reset-preserve-' . uniqid('', true) . '@example.test';
        User::factory()->forTenant($this->testTenantId)->create([
            'email' => $email,
            'status' => 'active',
            'is_approved' => true,
            'password_hash' => Hash::make('old-password-123'),
        ]);

        $oldToken = hash('sha256', 'previous-reset-token');
        DB::table('password_resets')->insert([
            'email' => $email,
            'tenant_id' => $this->testTenantId,
            'token' => $oldToken,
            'created_at' => now(),
        ]);

        app()->instance(EmailDispatchService::class, new PasswordResetFailingEmailDispatchService());

        $response = $this->apiPost('/auth/forgot-password', ['email' => $email]);

        $response->assertStatus(200);
        $this->assertSame(1, DB::table('password_resets')
            ->where('email', $email)
            ->where('tenant_id', $this->testTenantId)
            ->count());
        $this->assertSame($oldToken, DB::table('password_resets')
            ->where('email', $email)
            ->where('tenant_id', $this->testTenantId)
            ->value('token'));
    }

    public function test_forgot_password_rotates_token_only_after_email_send_acceptance(): void
    {
        $email = 'reset-rotate-' . uniqid('', true) . '@example.test';
        User::factory()->forTenant($this->testTenantId)->create([
            'email' => $email,
            'status' => 'active',
            'is_approved' => true,
            'password_hash' => Hash::make('old-password-123'),
        ]);

        $oldToken = hash('sha256', 'previous-reset-token');
        DB::table('password_resets')->insert([
            'email' => $email,
            'tenant_id' => $this->testTenantId,
            'token' => $oldToken,
            'created_at' => now(),
        ]);

        $mailer = new PasswordResetSuccessfulEmailDispatchService();
        app()->instance(EmailDispatchService::class, $mailer);

        $response = $this->apiPost('/auth/forgot-password', ['email' => $email]);

        $response->assertStatus(200);
        $this->assertCount(1, $mailer->calls);
        $this->assertSame($email, $mailer->calls[0]['to']);
        $this->assertSame('password_reset', $mailer->calls[0]['options']['category']);
        $this->assertSame($this->testTenantId, $mailer->calls[0]['options']['tenant_id']);
        $this->assertSame(1, DB::table('password_resets')
            ->where('email', $email)
            ->where('tenant_id', $this->testTenantId)
            ->count());
        $this->assertNotSame($oldToken, DB::table('password_resets')
            ->where('email', $email)
            ->where('tenant_id', $this->testTenantId)
            ->value('token'));
    }

    /**
     * F-023 (E-013): forgot-password must not leak account existence through
     * response timing. The reset email was sent INLINE, and only for an account
     * that exists, so an existing address responded measurably slower than an
     * unknown one — a timing oracle that defeats the deliberately generic
     * response message. The platform runs under mod_php (no early response
     * flush), so the reset work is dispatched to the QUEUE and runs
     * out-of-process. The request must dispatch the job IDENTICALLY whether or
     * not the account exists (the account lookup lives in the job), so the
     * request path does the same constant work for every address, and it must
     * send nothing inline.
     */
    public function test_forgot_password_queues_reset_and_never_sends_inline(): void
    {
        \Illuminate\Support\Facades\Queue::fake();

        $existing = 'reset-queue-' . uniqid('', true) . '@example.test';
        User::factory()->forTenant($this->testTenantId)->create([
            'email' => $existing,
            'status' => 'active',
            'is_approved' => true,
            'password_hash' => Hash::make('old-password-123'),
        ]);
        $missing = 'no-such-' . uniqid('', true) . '@example.test';

        // A recording mailer proves nothing is sent inside the request.
        $mailer = new PasswordResetSuccessfulEmailDispatchService();
        app()->instance(EmailDispatchService::class, $mailer);

        $existingResponse = $this->apiPost('/auth/forgot-password', ['email' => $existing]);
        $missingResponse = $this->apiPost('/auth/forgot-password', ['email' => $missing]);

        $existingResponse->assertStatus(200);
        $missingResponse->assertStatus(200);

        // The email is never sent inside the request for either address — with
        // Queue::fake() the job is recorded, not run, so an inline send would be
        // the only way $mailer->calls could be non-empty.
        $this->assertCount(
            0,
            $mailer->calls,
            'Reset email was sent inside the request — that inline send is the F-023 timing oracle.'
        );

        // The reset work is dispatched to the queue IDENTICALLY for an account
        // that exists and one that does not, so response timing reveals nothing.
        \Illuminate\Support\Facades\Queue::assertPushed(SendPasswordResetEmail::class, 2);
        \Illuminate\Support\Facades\Queue::assertPushed(
            SendPasswordResetEmail::class,
            static fn (SendPasswordResetEmail $job): bool => $job->email === $existing
        );
        \Illuminate\Support\Facades\Queue::assertPushed(
            SendPasswordResetEmail::class,
            static fn (SendPasswordResetEmail $job): bool => $job->email === $missing
        );

        // And the response bodies are byte-identical, so there is no message oracle either.
        $this->assertSame($existingResponse->getContent(), $missingResponse->getContent());
    }

    /**
     * The queued job carries out the reset for a real account: it sends the
     * email and rotates the stored token — the behaviour that used to run inline.
     */
    public function test_send_password_reset_email_job_sends_for_an_existing_account(): void
    {
        $email = 'reset-job-' . uniqid('', true) . '@example.test';
        User::factory()->forTenant($this->testTenantId)->create([
            'email' => $email,
            'status' => 'active',
            'is_approved' => true,
            'password_hash' => Hash::make('old-password-123'),
        ]);

        $mailer = new PasswordResetSuccessfulEmailDispatchService();
        app()->instance(EmailDispatchService::class, $mailer);

        (new SendPasswordResetEmail($email, $this->testTenantId))->handle();

        $this->assertCount(1, $mailer->calls);
        $this->assertSame($email, $mailer->calls[0]['to']);
        $this->assertSame('password_reset', $mailer->calls[0]['options']['category']);
        $this->assertSame(1, DB::table('password_resets')
            ->where('email', $email)
            ->where('tenant_id', $this->testTenantId)
            ->count());
    }

    /**
     * The queued job sends nothing for an address with no account — the branch
     * whose absence, when run inline, created the timing difference.
     */
    public function test_send_password_reset_email_job_is_silent_for_unknown_account(): void
    {
        $mailer = new PasswordResetSuccessfulEmailDispatchService();
        app()->instance(EmailDispatchService::class, $mailer);

        (new SendPasswordResetEmail('nobody-' . uniqid('', true) . '@example.test', $this->testTenantId))->handle();

        $this->assertCount(0, $mailer->calls);
    }

    // ------------------------------------------------------------------
    //  POST /auth/reset-password (PUBLIC, rate-limited)
    // ------------------------------------------------------------------

    public function test_reset_password_requires_token(): void
    {
        $response = $this->apiPost('/auth/reset-password', [
            'password' => 'NewPassword123!',
        ]);

        $this->assertContains($response->getStatusCode(), [400, 422, 429]);
    }

    public function test_reset_password_rejects_invalid_token(): void
    {
        $response = $this->apiPost('/auth/reset-password', [
            'token' => 'invalid-token-xyz',
            'password' => 'NewPassword123!',
            'password_confirmation' => 'NewPassword123!',
        ]);

        $this->assertContains($response->getStatusCode(), [400, 404, 422]);
    }

    public function test_reset_password_rejects_valid_token_from_another_tenant_without_consuming_it(): void
    {
        $email = 'cross-tenant-reset-' . uniqid('', true) . '@example.test';
        $oldPassword = 'old-cross-tenant-password-123';
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'email' => $email,
            'status' => 'active',
            'is_approved' => true,
            'password_hash' => Hash::make($oldPassword),
        ]);
        $plainToken = bin2hex(random_bytes(32));
        DB::table('password_resets')->insert([
            'email' => $email,
            'tenant_id' => $this->testTenantId,
            'token' => hash('sha256', $plainToken),
            'created_at' => now(),
        ]);
        Http::fake(['api.pwnedpasswords.com/*' => Http::response('', 200)]);

        $response = $this->withHeader('X-Tenant-ID', '1')->postJson('/api/auth/reset-password', [
            'token' => $plainToken,
            'password' => 'new-cross-tenant-password-456',
            'password_confirmation' => 'new-cross-tenant-password-456',
        ]);

        $response->assertStatus(400);
        $this->assertTrue(Hash::check(
            $oldPassword,
            (string) DB::table('users')->where('id', $user->id)->value('password_hash')
        ));
        $this->assertDatabaseHas('password_resets', [
            'email' => $email,
            'tenant_id' => $this->testTenantId,
            'token' => hash('sha256', $plainToken),
        ]);
    }

    public function test_reset_password_rolls_back_when_session_revocation_fails(): void
    {
        $email = 'reset-revocation-failure-' . uniqid('', true) . '@example.test';
        $oldPassword = 'old-password-value-123';
        $newPassword = 'new-password-value-' . uniqid();
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'email' => $email,
            'status' => 'active',
            'is_approved' => true,
            'password_hash' => Hash::make($oldPassword),
        ]);
        $plainToken = bin2hex(random_bytes(32));
        $storedToken = hash('sha256', $plainToken);
        DB::table('password_resets')->insert([
            'email' => $email,
            'tenant_id' => $this->testTenantId,
            'token' => $storedToken,
            'created_at' => now(),
        ]);
        Http::fake(['api.pwnedpasswords.com/*' => Http::response('', 200)]);

        $tokens = \Mockery::mock(TokenService::class);
        $tokens->shouldReceive('revokeAllTokensForUser')
            ->once()
            ->with((int) $user->id, 'password_reset')
            ->andReturn(0);
        app()->instance(TokenService::class, $tokens);

        $this->apiPost('/auth/reset-password', [
            'token' => $plainToken,
            'password' => $newPassword,
            'password_confirmation' => $newPassword,
        ])->assertStatus(500);

        $this->assertTrue(Hash::check(
            $oldPassword,
            (string) DB::table('users')->where('id', $user->id)->value('password_hash')
        ));
        $this->assertDatabaseHas('password_resets', [
            'email' => $email,
            'tenant_id' => $this->testTenantId,
            'token' => $storedToken,
        ]);
    }
}

class PasswordResetFailingEmailDispatchService extends EmailDispatchService
{
    public function send(string $to, string $subject, string $body, array $options = []): bool
    {
        return false;
    }
}

class PasswordResetSuccessfulEmailDispatchService extends EmailDispatchService
{
    public array $calls = [];

    public function send(string $to, string $subject, string $body, array $options = []): bool
    {
        $this->calls[] = compact('to', 'subject', 'body', 'options');

        return true;
    }
}
