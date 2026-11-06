<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E121;

use App\Services\AuthenticationConfigurationService as Settings;
use App\Services\TotpService;
use Tests\Laravel\Feature\Auth\Oauth\DrivesGoogleSignIn;
use Tests\Laravel\Feature\Security\TwoFactor\TwoFactorAuditTestCase;

/**
 * E-121 re-test of the September rule (E-004 P1/P8): signing in with Google
 * never gets round two-factor. Driven through the real redirect, callback and
 * exchange, with Socialite's test double standing in for Google.
 *
 * The code-asked case was already pinned (SocialAuthServiceTest,
 * TwoFactorRecoveryTest); these three had no test on the Google path:
 *  - a community that requires two-factor for members forces set-up;
 *  - a staff member must set it up;
 *  - a device the member trusted is honoured, and the community's own number
 *    of days is what the code screen is offered.
 * If any of these fails, that is a new finding, not a test to adjust.
 */
class GoogleSignInKeepsTwoFactorTest extends TwoFactorAuditTestCase
{
    use DrivesGoogleSignIn;

    protected function setUp(): void
    {
        parent::setUp();
        $this->enableGoogleSignIn();
    }

    protected function tearDown(): void
    {
        $this->restoreGoogleSignIn();
        parent::tearDown();
    }

    private function googleEmail(): string
    {
        return 'p1.' . uniqid() . '@gmail.com';
    }

    public function test_a_community_that_requires_two_factor_makes_a_google_member_set_it_up(): void
    {
        Settings::set(Settings::CONFIG_TWO_FACTOR_REQUIRE_MEMBERS, true, $this->testTenantId);
        $member = $this->member(['email' => $this->googleEmail()]);

        $callback = $this->signInWithGoogle($this->googleUser('g-req-' . uniqid(), (string) $member->email));
        $exchange = $this->exchangeGoogleCode($this->callbackCodeFrom($callback));

        $exchange->assertOk();
        $this->assertTrue($exchange->json('requires_2fa_setup'));
        $this->assertNotEmpty($exchange->json('two_factor_token'));
        $this->assertNull($exchange->json('token'), 'no session before the second factor is set up');
    }

    public function test_a_staff_member_signing_in_with_google_must_set_up_two_factor(): void
    {
        $broker = $this->member(['role' => 'broker', 'email' => $this->googleEmail()]);

        $callback = $this->signInWithGoogle($this->googleUser('g-staff-' . uniqid(), (string) $broker->email));
        $exchange = $this->exchangeGoogleCode($this->callbackCodeFrom($callback));

        $exchange->assertOk();
        $this->assertTrue($exchange->json('requires_2fa_setup'));
        $this->assertNull($exchange->json('token'));
    }

    public function test_a_trusted_device_is_honoured_and_the_communitys_days_are_offered(): void
    {
        Settings::set(Settings::CONFIG_TWO_FACTOR_ALLOW_TRUSTED_DEVICES, true, $this->testTenantId);
        Settings::set(Settings::CONFIG_TWO_FACTOR_TRUSTED_DEVICE_DAYS, 14, $this->testTenantId);
        $member = $this->member(['email' => $this->googleEmail()]);
        $this->enrol($member);
        $googleUser = $this->googleUser('g-trust-' . uniqid(), (string) $member->email);

        // Two-factor on, device not trusted: the code is asked, and the code
        // screen is offered the community's own number of days.
        $first = $this->exchangeGoogleCode($this->callbackCodeFrom($this->signInWithGoogle($googleUser)));
        $first->assertOk();
        $this->assertTrue($first->json('requires_2fa'));
        $this->assertNull($first->json('token'));
        $this->assertTrue($first->json('allow_trusted_device'));
        $this->assertSame(14, $first->json('trusted_device_days'));

        // A device the member trusted is honoured on a Google sign-in too.
        $trusted = TotpService::trustDevice($member->id, null, $this->testTenantId);
        $this->assertIsString($trusted);
        $callback = $this->signInWithGoogle($googleUser);
        $this->withCredentials();
        $this->unencryptedCookies = ['nexus_trusted_device' => $trusted];
        $second = $this->exchangeGoogleCode($this->callbackCodeFrom($callback));

        $second->assertOk();
        $this->assertNotEmpty($second->json('token'), 'a remembered device skips the code');
        $this->assertNull($second->json('requires_2fa'));
    }
}
