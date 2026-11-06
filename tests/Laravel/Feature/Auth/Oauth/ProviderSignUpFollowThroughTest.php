<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Auth\Oauth;

use App\Events\UserRegistered;
use App\Models\User;
use App\Services\RegistrationStaffEmailDeliveryLedger;
use App\Services\TenantSettingsService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Tests\Laravel\TestCase;

/**
 * E-121 — what happens after a Google sign-up or sign-in, beyond the session.
 *
 * Before this, a Google sign-up in a community that approves new members:
 *  - created the account, then told the member "Sign-in failed" (every refusal
 *    became one generic error, and the address carried free text);
 *  - sent the member no welcome email and staff no email at all (only an
 *    in-app alert from the registration policy step), because UserRegistered
 *    never fired on this path;
 *  - and in a community without approval, never granted the starting balance.
 *
 * Now the reason travels through the exchange step, which only the browser
 * that started the sign-in can complete; UserRegistered fires once, after the
 * account is committed, carrying whether the member is waiting; staff hear
 * about it once (the policy step's own alert is switched off for this path);
 * and an open community grants the starting balance.
 */
class ProviderSignUpFollowThroughTest extends TestCase
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

    private function newGoogleEmail(): string
    {
        return 'g.' . uniqid() . '@gmail.com';
    }

    private function userIdFor(string $email): int
    {
        return (int) DB::table('users')->where('tenant_id', $this->testTenantId)->where('email', $email)->value('id');
    }

    // ── telling the member why ───────────────────────────────────────────────

    public function test_a_sign_up_waiting_for_approval_is_told_so_not_that_sign_in_failed(): void
    {
        Event::fake([UserRegistered::class]);
        $this->seedRegistrationMode('open_with_approval');
        $email = $this->newGoogleEmail();

        $callback = $this->signInWithGoogle($this->googleUser('g-wait-' . uniqid(), $email), 'register');

        $location = (string) $callback->headers->get('Location');
        $this->assertStringContainsString('/auth/oauth/callback?', $location);
        $this->assertStringNotContainsString('error=', $location);
        $this->assertStringNotContainsString('message=', $location);

        $exchange = $this->exchangeGoogleCode($this->callbackCodeFrom($callback));
        $exchange->assertStatus(403);
        $exchange->assertJsonPath('success', false);
        $exchange->assertJsonPath('reason', 'pending_approval');
        $exchange->assertJsonPath('is_new', true);
        $this->assertNull($exchange->json('token'));

        $this->assertSame('pending', DB::table('users')->where('id', $this->userIdFor($email))->value('status'));
    }

    public function test_only_the_browser_that_started_the_sign_in_can_read_the_reason(): void
    {
        Event::fake([UserRegistered::class]);
        $this->seedRegistrationMode('open_with_approval');
        $callback = $this->signInWithGoogle($this->googleUser('g-tab-' . uniqid(), $this->newGoogleEmail()), 'register');
        $code = $this->callbackCodeFrom($callback);

        $otherBrowser = $this->exchangeGoogleCode($code, 'Wrong0verifierWrong0verifierWrong0verifier12');
        $otherBrowser->assertStatus(400);
        $this->assertNull($otherBrowser->json('reason'));

        // A wrong verifier is not consumption: the right tab still reads it.
        $this->exchangeGoogleCode($code)->assertJsonPath('reason', 'pending_approval');
    }

    public function test_signing_in_with_a_google_account_that_has_no_account_here_says_so(): void
    {
        $email = $this->newGoogleEmail();

        $callback = $this->signInWithGoogle($this->googleUser('g-none-' . uniqid(), $email), 'login');
        $exchange = $this->exchangeGoogleCode($this->callbackCodeFrom($callback));

        $exchange->assertStatus(403);
        $exchange->assertJsonPath('reason', 'no_account');
        $this->assertSame(0, $this->userIdFor($email));
    }

    public function test_a_community_not_taking_sign_ups_says_so(): void
    {
        $this->seedRegistrationMode('closed');
        $email = $this->newGoogleEmail();

        $callback = $this->signInWithGoogle($this->googleUser('g-closed-' . uniqid(), $email), 'register');
        $exchange = $this->exchangeGoogleCode($this->callbackCodeFrom($callback));

        $exchange->assertStatus(403);
        $exchange->assertJsonPath('reason', 'registration_closed');
        $this->assertSame(0, $this->userIdFor($email));
    }

    public function test_a_suspended_member_signing_in_with_a_linked_google_account_is_told_so(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'suspended',
            'email' => $this->newGoogleEmail(),
            'email_verified_at' => now(),
        ]);
        $googleId = 'g-susp-' . uniqid();
        DB::table('oauth_identities')->insert([
            'user_id' => $member->id,
            'tenant_id' => $this->testTenantId,
            'provider' => 'google',
            'provider_user_id' => $googleId,
            'provider_email' => $member->email,
            'raw_payload' => '{}',
            'linked_at' => now(),
            'last_used_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $callback = $this->signInWithGoogle($this->googleUser($googleId, (string) $member->email), 'login');

        $this->exchangeGoogleCode($this->callbackCodeFrom($callback))
            ->assertStatus(403)
            ->assertJsonPath('reason', 'suspended');
    }

    public function test_a_refusal_found_only_at_the_exchange_is_reported_too(): void
    {
        // First Google sign-in to an existing account by its verified email: the
        // checks run at the exchange, not the callback.
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'suspended',
            'email' => $this->newGoogleEmail(),
            'email_verified_at' => now(),
        ]);

        $callback = $this->signInWithGoogle($this->googleUser('g-late-' . uniqid(), (string) $member->email), 'login');

        $this->exchangeGoogleCode($this->callbackCodeFrom($callback))
            ->assertStatus(403)
            ->assertJsonPath('reason', 'suspended');
    }

    public function test_a_failed_callback_never_carries_free_text_in_the_address(): void
    {
        $callback = $this->get('/api/v2/auth/oauth/google/callback?state=not-a-real-state', $this->withTenantHeader());

        $location = (string) $callback->headers->get('Location');
        $this->assertStringContainsString('error=oauth_failed', $location);
        $this->assertStringNotContainsString('message=', $location);
    }

    // ── welcome, staff alerts, starting balance ──────────────────────────────

    public function test_a_sign_up_waiting_for_approval_fires_the_registration_event_once_and_staff_hear_once(): void
    {
        Event::fake([UserRegistered::class]);
        $this->seedRegistrationMode('open_with_approval');
        $staff = User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'broker',
            'status' => 'active',
            'email' => 'broker.' . uniqid() . '@example.test',
        ]);
        $email = $this->newGoogleEmail();

        $this->signInWithGoogle($this->googleUser('g-event-' . uniqid(), $email), 'register');
        $userId = $this->userIdFor($email);

        Event::assertDispatchedTimes(UserRegistered::class, 1);
        Event::assertDispatched(
            UserRegistered::class,
            fn (UserRegistered $event): bool => (int) $event->user->id === $userId
                && $event->tenantId === $this->testTenantId
                && $event->awaitingApproval === true
        );
        // Staff are told by that event's listener (email + alert); the policy
        // step's own in-app alert is switched off for this path, so nobody
        // gets two.
        $this->assertSame(
            0,
            DB::table('notifications')->where('user_id', $staff->id)->where('type', 'pending_approval')->count()
        );
        // The staff emails are recorded before commit, so a lost process can be
        // recovered later (RecoverCapturedRegistrationStaffAlerts).
        $this->assertTrue(RegistrationStaffEmailDeliveryLedger::hasIntentForRegistrant($this->testTenantId, $userId));
    }

    public function test_an_open_community_grants_the_starting_balance_and_a_plain_welcome(): void
    {
        Event::fake([UserRegistered::class]);
        $this->seedRegistrationMode('open');
        app(TenantSettingsService::class)->set($this->testTenantId, 'wallet.starting_balance', '4');
        $email = $this->newGoogleEmail();

        $this->signInWithGoogle($this->googleUser('g-open-' . uniqid(), $email), 'register');
        $userId = $this->userIdFor($email);

        $this->assertGreaterThan(0, $userId);
        Event::assertDispatched(
            UserRegistered::class,
            fn (UserRegistered $event): bool => (int) $event->user->id === $userId && $event->awaitingApproval === false
        );
        $this->assertSame(
            1,
            DB::table('transactions')
                ->where('tenant_id', $this->testTenantId)
                ->where('receiver_id', $userId)
                ->where('transaction_type', 'starting_balance')
                ->count(),
            'A Google member in an open community gets the same starting balance as everyone else.'
        );
    }

    public function test_an_existing_member_signing_in_is_not_treated_as_a_sign_up(): void
    {
        Event::fake([UserRegistered::class]);
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'email' => $this->newGoogleEmail(),
            'email_verified_at' => now(),
        ]);

        $this->signInWithGoogle($this->googleUser('g-back-' . uniqid(), (string) $member->email), 'login');

        Event::assertNotDispatched(UserRegistered::class);
    }
}
