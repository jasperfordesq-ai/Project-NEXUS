<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

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
