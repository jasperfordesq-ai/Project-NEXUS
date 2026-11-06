<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Auth\Oauth;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * E-121 — a sign-in through Google (or SSO) records "last signed in", as a
 * password sign-in (AuthController) and a code entry (TotpController) do.
 *
 * Without it, a Google member who never needs a code counted as "never signed
 * in": the admin "re-invite members who never signed in" email could go to
 * them, and inactivity lists and sign-in streaks missed them.
 */
class ProviderSignInRecordsSignInTimeTest extends TestCase
{
    use DatabaseTransactions;
    use DrivesGoogleSignIn;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        $this->enableGoogleSignIn();
    }

    protected function tearDown(): void
    {
        $this->restoreGoogleSignIn();
        parent::tearDown();
    }

    public function test_a_returning_member_signing_in_with_google_records_the_time(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'email' => 'back.' . uniqid() . '@gmail.com',
            'email_verified_at' => now(),
            'last_login_at' => null,
        ]);

        $callback = $this->signInWithGoogle($this->googleUser('g-time-' . uniqid(), (string) $member->email), 'login');
        $this->exchangeGoogleCode($this->callbackCodeFrom($callback))->assertOk();

        $this->assertNotNull(DB::table('users')->where('id', $member->id)->value('last_login_at'));
    }

    public function test_a_new_member_signed_straight_in_records_the_time(): void
    {
        $this->seedRegistrationMode('open');
        $email = 'new.time.' . uniqid() . '@gmail.com';

        $callback = $this->signInWithGoogle($this->googleUser('g-newtime-' . uniqid(), $email), 'register');
        $this->exchangeGoogleCode($this->callbackCodeFrom($callback))->assertOk();

        $this->assertNotNull(
            DB::table('users')->where('tenant_id', $this->testTenantId)->where('email', $email)->value('last_login_at')
        );
    }
}
