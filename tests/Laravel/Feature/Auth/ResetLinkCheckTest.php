<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Auth;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\Auth\PasswordResetTokens;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\RateLimiter;
use Tests\Laravel\TestCase;

/**
 * AWID focus group, Oct 2026: "When you click on the link on the invite, it
 * didn't work. I had to use Forget Password". Both websites showed the full
 * "Set new password" form for a dead link and only said so after the member
 * had typed a password, with no way to ask for a new link.
 *
 * POST /auth/reset-password/check lets the page find out first. It must:
 *  - say whether the link is live, and whether it is an invitation or a reset
 *    link (so the page can say "set up your account" for an invitation);
 *  - never consume the link, and never reveal the address it belongs to;
 *  - refuse a link issued by another community, exactly as the reset does.
 */
class ResetLinkCheckTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        Cache::flush();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
        foreach (['127.0.0.1', '::1', ''] as $ip) {
            RateLimiter::clear("api:reset_password:ip:{$ip}");
            RateLimiter::clear("api:reset_password_check:ip:{$ip}");
        }
        Http::fake(['api.pwnedpasswords.com/*' => Http::response('', 200)]);
        TenantContext::setById($this->testTenantId);
    }

    private function member(): string
    {
        $email = 'link-check-' . bin2hex(random_bytes(5)) . '@example.test';
        User::factory()->forTenant($this->testTenantId)->create([
            'email' => $email, 'role' => 'member', 'status' => 'active', 'is_approved' => 1,
            'password_hash' => Hash::make('old-link-check-password-123'),
        ]);

        return $email;
    }

    /** A forgot-password link: expires_at NULL, lives one hour from created_at. */
    private function resetLink(string $email): string
    {
        $token = bin2hex(random_bytes(32));
        DB::table('password_resets')->insert([
            'email' => $email,
            'tenant_id' => $this->testTenantId,
            'token' => hash('sha256', $token),
            'created_at' => DB::raw('NOW()'),
        ]);

        return $token;
    }

    private function check(string $token, array $headers = []): \Illuminate\Testing\TestResponse
    {
        return $this->apiPost('/auth/reset-password/check', ['token' => $token], $headers);
    }

    public function test_a_live_invitation_is_reported_valid_and_as_an_invitation(): void
    {
        $email = $this->member();
        $token = app(PasswordResetTokens::class)->issueInvitation($email, $this->testTenantId);

        $response = $this->check($token)->assertStatus(200);

        $this->assertTrue($response->json('data.valid'));
        $this->assertSame('invitation', $response->json('data.kind'));
        $this->assertStringNotContainsString($email, $response->getContent());
    }

    public function test_a_live_forgot_password_link_is_reported_as_a_reset(): void
    {
        $token = $this->resetLink($this->member());

        $response = $this->check($token)->assertStatus(200);

        $this->assertTrue($response->json('data.valid'));
        $this->assertSame('reset', $response->json('data.kind'));
    }

    public function test_an_expired_invitation_is_reported_invalid(): void
    {
        $email = $this->member();
        $token = app(PasswordResetTokens::class)->issueInvitation($email, $this->testTenantId);
        DB::table('password_resets')->where('email', $email)->update([
            'created_at' => DB::raw('DATE_SUB(NOW(), INTERVAL 8 DAY)'),
            'expires_at' => DB::raw('DATE_SUB(NOW(), INTERVAL 1 DAY)'),
        ]);

        $response = $this->check($token)->assertStatus(200);

        $this->assertFalse($response->json('data.valid'));
    }

    public function test_an_hour_old_forgot_password_link_is_reported_invalid(): void
    {
        $email = $this->member();
        $token = $this->resetLink($email);
        DB::table('password_resets')->where('email', $email)
            ->update(['created_at' => DB::raw('DATE_SUB(NOW(), INTERVAL 61 MINUTE)')]);

        $this->assertFalse($this->check($token)->assertStatus(200)->json('data.valid'));
    }

    public function test_a_used_link_is_reported_invalid(): void
    {
        $email = $this->member();
        $token = app(PasswordResetTokens::class)->issueInvitation($email, $this->testTenantId);
        $pw = 'link-check-new-password-' . bin2hex(random_bytes(6));
        $this->apiPost('/auth/reset-password', [
            'token' => $token, 'password' => $pw, 'password_confirmation' => $pw,
        ])->assertStatus(200);

        $this->assertFalse($this->check($token)->assertStatus(200)->json('data.valid'));
    }

    public function test_an_unknown_token_is_reported_invalid(): void
    {
        $this->assertFalse($this->check(bin2hex(random_bytes(32)))->assertStatus(200)->json('data.valid'));
    }

    public function test_a_link_from_another_community_is_reported_invalid(): void
    {
        $email = $this->member();
        $token = app(PasswordResetTokens::class)->issueInvitation($email, $this->testTenantId);

        $response = $this->withHeader('X-Tenant-ID', '1')
            ->postJson('/api/auth/reset-password/check', ['token' => $token])
            ->assertStatus(200);

        $this->assertFalse($response->json('data.valid'));
    }

    public function test_checking_does_not_use_the_link_up(): void
    {
        $email = $this->member();
        $token = app(PasswordResetTokens::class)->issueInvitation($email, $this->testTenantId);

        $this->check($token)->assertStatus(200);
        $this->check($token)->assertStatus(200);

        $this->assertDatabaseHas('password_resets', [
            'email' => $email,
            'tenant_id' => $this->testTenantId,
            'token' => hash('sha256', $token),
        ]);
        $pw = 'link-check-after-check-' . bin2hex(random_bytes(6));
        $this->apiPost('/auth/reset-password', [
            'token' => $token, 'password' => $pw, 'password_confirmation' => $pw,
        ])->assertStatus(200);
    }

    public function test_a_missing_token_is_a_validation_error(): void
    {
        $this->apiPost('/auth/reset-password/check', [])->assertStatus(400);
    }
}
