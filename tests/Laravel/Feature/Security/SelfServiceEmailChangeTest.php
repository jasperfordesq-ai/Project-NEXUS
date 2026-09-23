<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security;

use App\Models\User;
use App\Services\Auth\SocialAuthService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-037 (E-024): the member profile endpoint must not change the account's
 * email address.
 *
 * PUT /api/v2/users/me used to accept `email` with no password, no
 * confirmation sent to the new address, and no reset of `email_verified_at`.
 * A borrowed session could therefore move an account to an attacker's
 * mailbox and finish the takeover with an ordinary password reset, and a
 * member could claim somebody else's address while staying "verified" — which
 * made that person's Google sign-in resolve to the member's account.
 *
 * No first-party client changes email through this endpoint (React and the
 * native app never send it; web-uk refuses the action outright), so the fix is
 * to refuse a change here. Echoing the member's CURRENT address back, which
 * clients that post the whole profile do, must keep working.
 */
class SelfServiceEmailChangeTest extends TestCase
{
    use DatabaseTransactions;

    private function member(string $email): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'email' => $email,
            'email_verified_at' => now()->subYear(),
        ]);
        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    public function test_profile_update_refuses_a_new_email_address(): void
    {
        $user = $this->member('owner-' . uniqid() . '@example.org');
        $verifiedAt = DB::table('users')->where('id', $user->id)->value('email_verified_at');

        $response = $this->apiPut('/v2/users/me', ['email' => 'someone.else@gmail.com']);

        $response->assertStatus(422);
        $this->assertSame('EMAIL_CHANGE_NOT_AVAILABLE', $response->json('errors.0.code'));
        $this->assertSame('email', $response->json('errors.0.field'));

        $row = DB::table('users')->where('id', $user->id)->first(['email', 'email_verified_at']);
        $this->assertSame($user->email, $row->email);
        $this->assertSame($verifiedAt, $row->email_verified_at);
    }

    public function test_a_password_does_not_unlock_the_change_on_this_endpoint(): void
    {
        $user = $this->member('owner-' . uniqid() . '@example.org');

        $response = $this->apiPut('/v2/users/me', [
            'email' => 'someone.else@gmail.com',
            'current_password' => 'password',
        ]);

        $response->assertStatus(422);
        $this->assertSame($user->email, DB::table('users')->where('id', $user->id)->value('email'));
    }

    public function test_the_whole_update_is_refused_not_partly_applied(): void
    {
        $user = $this->member('owner-' . uniqid() . '@example.org');
        DB::table('users')->where('id', $user->id)->update(['bio' => 'before']);

        $this->apiPut('/v2/users/me', ['email' => 'someone.else@gmail.com', 'bio' => 'after'])
            ->assertStatus(422);

        $this->assertSame('before', DB::table('users')->where('id', $user->id)->value('bio'));
    }

    public function test_echoing_the_current_address_back_still_saves_the_profile(): void
    {
        $email = 'owner-' . uniqid() . '@example.org';
        $user = $this->member($email);

        $response = $this->apiPut('/v2/users/me', [
            'email' => '  ' . strtoupper($email) . ' ',
            'bio' => 'Updated bio',
        ]);

        $response->assertStatus(200);
        $row = DB::table('users')->where('id', $user->id)->first(['email', 'bio']);
        $this->assertSame($email, $row->email);
        $this->assertSame('Updated bio', $row->bio);
    }

    public function test_a_refused_change_cannot_capture_someone_elses_google_sign_in(): void
    {
        $this->member('owner-' . uniqid() . '@example.org');
        $this->apiPut('/v2/users/me', ['email' => 'victim.person@gmail.com'])->assertStatus(422);

        $google = (new \Laravel\Socialite\Two\User())
            ->setRaw(['sub' => 'g-victim-1', 'email' => 'victim.person@gmail.com', 'email_verified' => true])
            ->map(['id' => 'g-victim-1', 'email' => 'victim.person@gmail.com', 'name' => 'Victim']);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('OAuth login cannot create a new account');
        app(SocialAuthService::class)->findOrCreateFromOauth('google', $google, $this->testTenantId, time(), false);
    }
}
