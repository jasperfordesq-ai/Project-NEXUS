<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Auth;

use App\Services\TwoFactorChallengeManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Tests\Laravel\TestCase;

class MfaChallengeRateLimitTest extends TestCase
{
    public function test_valid_challenges_share_account_limits_across_tokens_but_not_other_accounts(): void
    {
        $manager = app(TwoFactorChallengeManager::class);
        $first = $manager->create(910001, ['totp'], 103);
        $replacement = $manager->create(910001, ['totp'], 103);
        $other = $manager->create(910002, ['totp'], 103);
        $limiter = RateLimiter::limiter('mfa-challenge');
        $request = fn ($token) => Request::create('/totp/verify', 'POST', ['two_factor_token' => $token], [], [], ['REMOTE_ADDR' => '127.0.0.1']);
        $limits = $limiter($request($first));
        $this->assertSame($limits[0]->key, $limiter($request($replacement))[0]->key);
        $this->assertNotSame($limits[0]->key, $limiter($request($other))[0]->key);
        $this->assertSame(5, $limits[0]->maxAttempts);
        $this->assertSame(600, $limits[1]->maxAttempts);
        $this->assertSame($limits[1]->key, $limiter($request($other))[1]->key);
    }

    public function test_invalid_challenges_cannot_multiply_the_ip_allowance(): void
    {
        $limiter = RateLimiter::limiter('mfa-challenge');
        $request = fn ($token) => Request::create('/totp/verify', 'POST', ['two_factor_token' => $token], [], [], ['REMOTE_ADDR' => '127.0.0.1']);
        $this->assertSame($limiter($request('invalid-one'))[0]->key, $limiter($request('invalid-two'))[0]->key);
    }
}
