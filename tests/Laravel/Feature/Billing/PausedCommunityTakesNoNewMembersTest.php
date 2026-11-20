<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Services\Auth\ProviderSignInRefused;
use App\Services\Auth\SocialAuthService;
use App\Services\BillingStandingService;
use App\Services\TenantSettingsService;
use App\Support\Billing\BillingLock;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * A community paused for non-payment takes no new members — whichever way
 * they try to join.
 *
 * The API lock closes POST /v2/auth/register by its address. Signing up
 * through Google or another provider does not go through that address: it
 * comes back through the provider's callback, which sits under the open
 * sign-in prefix and takes the community from signed state, not from the
 * request. So the rule also has to live where the account is created.
 * (Found by the Stage 1 review, 20 Nov 2026. Single sign-on has the same
 * step; its test is in Security/E062/F270SsoProvisionRegistrationPolicyTest.)
 */
final class PausedCommunityTakesNoNewMembersTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        // An open community, so the only thing that can refuse is the pause.
        foreach (['general.registration_mode', 'registration_mode'] as $key) {
            DB::table('tenant_settings')->updateOrInsert(
                ['tenant_id' => $this->testTenantId, 'setting_key' => $key],
                ['setting_value' => 'open', 'setting_type' => 'string', 'updated_at' => now()]
            );
        }
        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);
        DB::table('tenant_registration_policies')->where('tenant_id', $this->testTenantId)->delete();

        BillingLock::flush();
    }

    protected function tearDown(): void
    {
        // parent::tearDown() rolls the transaction back; it must always run.
        // The flush matters here more than anywhere: this test pauses the
        // shared test community, and a cached "paused" must not outlive it.
        try {
            BillingLock::flush();
        } finally {
            parent::tearDown();
        }
    }

    private function providerAccount(string $email): object
    {
        return new class('g_' . bin2hex(random_bytes(6)), $email) {
            public function __construct(private string $id, private string $email)
            {
            }

            public function getId(): string
            {
                return $this->id;
            }

            public function getEmail(): ?string
            {
                return $this->email;
            }

            public function getName(): ?string
            {
                return 'New Member';
            }

            public function getAvatar(): ?string
            {
                return null;
            }

            /** @return array<string, mixed> */
            public function getRaw(): array
            {
                return ['sub' => $this->id, 'email' => $this->email, 'email_verified' => true, 'hd' => 'example.com'];
            }
        };
    }

    public function test_signing_up_through_a_provider_is_refused_for_a_paused_community(): void
    {
        BillingStandingService::suspend($this->testTenantId, null, 'manual');
        $email = 'paused_join_' . bin2hex(random_bytes(5)) . '@example.com';

        try {
            app(SocialAuthService::class)->findOrCreateFromOauth('google', $this->providerAccount($email), $this->testTenantId, time(), true);
            $this->fail('A paused community created a new account through a provider.');
        } catch (ProviderSignInRefused $refused) {
            $this->assertSame(ProviderSignInRefused::REGISTRATION_CLOSED, $refused->reason);
        }

        $this->assertDatabaseMissing('users', ['tenant_id' => $this->testTenantId, 'email' => $email]);
    }

    public function test_signing_up_through_a_provider_still_works_for_an_open_community(): void
    {
        $email = 'open_join_' . bin2hex(random_bytes(5)) . '@example.com';

        $result = app(SocialAuthService::class)->findOrCreateFromOauth('google', $this->providerAccount($email), $this->testTenantId, time(), true);

        $this->assertTrue($result['is_new']);
        $this->assertDatabaseHas('users', ['tenant_id' => $this->testTenantId, 'email' => $email]);
    }

    public function test_an_existing_member_can_still_sign_in_through_a_provider_while_paused(): void
    {
        $email = 'existing_' . bin2hex(random_bytes(5)) . '@example.com';
        $account = $this->providerAccount($email);
        $service = app(SocialAuthService::class);

        $created = $service->findOrCreateFromOauth('google', $account, $this->testTenantId, time(), true);
        BillingStandingService::suspend($this->testTenantId, null, 'manual');

        // An admin who signs in with Google must still get in to see why.
        $again = $service->findOrCreateFromOauth('google', $account, $this->testTenantId, time(), false);

        $this->assertFalse($again['is_new']);
        $this->assertSame((int) $created['user']->id, (int) $again['user']->id);
    }
}
