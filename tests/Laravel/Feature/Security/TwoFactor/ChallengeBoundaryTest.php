<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\TwoFactor;

/** P1, P2, P9 — the half-authenticated state can reach nothing but setup and verify. */
class ChallengeBoundaryTest extends TwoFactorAuditTestCase
{
    public function test_setup_challenge_cannot_reach_any_route_but_setup_and_verify(): void
    {
        $admin = $this->member(['role' => 'admin']); // required, not enrolled
        $login = $this->apiPost('/auth/login', ['email' => $admin->email, 'password' => 'test-password']);
        $login->assertOk()->assertJsonPath('requires_2fa_setup', true)->assertJsonMissingPath('access_token');
        $token = $login->json('two_factor_token');

        foreach (['/v2/auth/2fa/recovery-codes', '/v2/auth/2fa/disable', '/v2/auth/2fa/trusted-devices/revoke'] as $path) {
            $this->apiPost($path, ['two_factor_token' => $token, 'code' => '123456', 'password' => 'test-password'])->assertStatus(401);
        }
        $this->apiGet('/v2/users/me?two_factor_token=' . $token)->assertStatus(401);
        $this->apiGet('/v2/auth/2fa/status?two_factor_token=' . $token)->assertStatus(401);
        // The setup token is not a login-completion token either.
        $this->apiPost('/totp/verify', ['two_factor_token' => $token, 'code' => '123456'])->assertStatus(401);
    }

    public function test_invalid_challenge_does_not_fall_back_to_the_bearer(): void
    {
        $member = $this->member();
        $this->apiPost('/v2/auth/2fa/setup', ['two_factor_token' => 'bogus'], $this->bearer($member))
            ->assertStatus(401)->assertJsonPath('errors.0.code', 'AUTH_2FA_TOKEN_EXPIRED');
        $this->apiPost('/v2/auth/2fa/verify', ['two_factor_token' => '', 'code' => '123456'], $this->bearer($member))
            ->assertStatus(401);
    }

    public function test_login_challenge_dies_after_five_attempts_and_the_right_code_no_longer_works(): void
    {
        $member = $this->member();
        $secret = $this->enrol($member);
        $token = $this->challenge($member);

        for ($i = 0; $i < 4; $i++) {
            $this->apiPost('/totp/verify', ['two_factor_token' => $token, 'code' => '000000'])->assertStatus(401);
        }
        $this->apiPost('/totp/verify', ['two_factor_token' => $token, 'code' => '000000'])
            ->assertStatus(401)->assertJsonPath('errors.0.code', 'AUTH_2FA_MAX_ATTEMPTS');

        $late = $this->apiPost('/totp/verify', ['two_factor_token' => $token, 'code' => $this->code($secret)]);
        $this->assertContains($late->status(), [401, 429], 'a consumed challenge must never complete login');
        $this->assertNull($late->json('access_token'));
    }

    public function test_attempts_never_extend_the_deadline_and_an_expired_challenge_is_refused(): void
    {
        $member = $this->member();
        $secret = $this->enrol($member);
        $token = $this->challenge($member);

        $before = \Illuminate\Support\Facades\Cache::get('2fa_challenge:' . $token);
        $this->apiPost('/totp/verify', ['two_factor_token' => $token, 'code' => '000000'])->assertStatus(401);
        $after = \Illuminate\Support\Facades\Cache::get('2fa_challenge:' . $token);
        $this->assertSame($before['expires_at'], $after['expires_at'], 'a failed attempt must not move the deadline');

        $this->expireChallenge($token);
        $this->apiPost('/totp/verify', ['two_factor_token' => $token, 'code' => $this->code($secret)])
            ->assertStatus(401)->assertJsonPath('errors.0.code', 'AUTH_2FA_TOKEN_EXPIRED');
    }

    public function test_challenge_is_bound_to_the_account_that_created_it(): void
    {
        $alice = $this->member();
        $bob = $this->member();
        $bobSecret = $this->enrol($bob);
        $this->enrol($alice);
        $aliceToken = $this->challenge($alice);

        // Bob's valid code against Alice's challenge must fail — the challenge names the user.
        $this->apiPost('/totp/verify', ['two_factor_token' => $aliceToken, 'code' => $this->code($bobSecret)])->assertStatus(401);
    }
}
