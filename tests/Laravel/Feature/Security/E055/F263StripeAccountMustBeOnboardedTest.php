<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E055;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\DonationStripeAccountService;
use App\Services\TenantSettingsService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Stripe\HttpClient\ClientInterface;
use Tests\Laravel\TestCase;

/**
 * F-263 (E-055 G-4) — a community admin could bind ANY `acct_…` id as the
 * community's donation/premium Stripe account (format check only), routing the
 * community's payments into another community's or a seller's connected
 * account. Owner decision: only accounts created by this platform's own
 * Stripe Connect onboarding FOR THAT community are accepted — on save, and
 * again at charge time so an id saved before the fix stops being used.
 *
 * Only Stripe's remote HTTP boundary is simulated; nothing calls Stripe.
 */
final class F263StripeAccountMustBeOnboardedTest extends TestCase
{
    use DatabaseTransactions;

    private const OWN = 'acct_f263own';
    private const OTHER_COMMUNITY = 'acct_f263othercommunity';
    private const SELLER = 'acct_f263seller';
    private const ARBITRARY = 'acct_f263arbitrary';

    private object $stripeHttp;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
        config(['services.stripe.secret' => 'sk_test_f263_onboarded_only']);

        $tenantId = (string) $this->testTenantId;
        $ready = [
            'object' => 'account',
            'charges_enabled' => true,
            'payouts_enabled' => true,
            'details_submitted' => true,
            'requirements' => ['currently_due' => [], 'disabled_reason' => null],
        ];

        $this->stripeHttp = new class ($ready, $tenantId) implements ClientInterface {
            /** @var list<array{method:string,url:string,params:array}> */
            public array $requests = [];

            /** @var array<string,array<string,mixed>> */
            private array $accounts;

            /** @param array<string,mixed> $ready */
            public function __construct(array $ready, string $tenantId)
            {
                $this->accounts = [
                    // Created by this community's own donations onboarding.
                    'acct_f263own' => $ready + ['id' => 'acct_f263own', 'metadata' => [
                        'nexus_tenant_id' => $tenantId,
                        'nexus_account_purpose' => 'donations',
                    ]],
                    // Another community's donations onboarding.
                    'acct_f263othercommunity' => $ready + ['id' => 'acct_f263othercommunity', 'metadata' => [
                        'nexus_tenant_id' => '999263',
                        'nexus_account_purpose' => 'donations',
                    ]],
                    // A marketplace seller in the SAME community.
                    'acct_f263seller' => $ready + ['id' => 'acct_f263seller', 'metadata' => [
                        'nexus_tenant_id' => $tenantId,
                        'nexus_user_id' => '42',
                    ]],
                ];
            }

            public function request($method, $absUrl, $headers, $params, $hasFile, $apiMode = 'v1'): array
            {
                $method = strtolower((string) $method);
                $url = (string) $absUrl;
                $params = is_array($params) ? $params : [];
                $this->requests[] = compact('method', 'url', 'params');

                if ($method === 'get' && preg_match('#/v1/accounts/(acct_[A-Za-z0-9_]+)$#', $url, $m) === 1) {
                    if (isset($this->accounts[$m[1]])) {
                        return [json_encode($this->accounts[$m[1]], JSON_THROW_ON_ERROR), 200, []];
                    }

                    return [json_encode(['error' => [
                        'type' => 'invalid_request_error',
                        'code' => 'resource_missing',
                        'message' => 'No such account',
                    ]], JSON_THROW_ON_ERROR), 404, []];
                }

                if ($method === 'post' && str_ends_with($url, '/v1/account_links')) {
                    return [json_encode([
                        'object' => 'account_link',
                        'url' => 'https://connect.stripe.test/setup/' . ($params['account'] ?? ''),
                    ], JSON_THROW_ON_ERROR), 200, []];
                }

                throw new \RuntimeException("Unexpected Stripe request: {$method} {$url}");
            }
        };
        \Stripe\ApiRequestor::setHttpClient($this->stripeHttp);

        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());
    }

    protected function tearDown(): void
    {
        \Stripe\ApiRequestor::setHttpClient(null);
        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);
        parent::tearDown();
    }

    private function storeDirectly(string $accountId): void
    {
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => DonationStripeAccountService::SETTING_CONNECT_ACCOUNT_ID],
            ['setting_value' => $accountId, 'setting_type' => 'string'],
        );
        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);
    }

    private function stored(): ?string
    {
        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);

        return DonationStripeAccountService::accountIdForTenant($this->testTenantId);
    }

    public function test_foreign_and_arbitrary_account_ids_are_refused_and_not_stored(): void
    {
        foreach ([self::OTHER_COMMUNITY, self::SELLER, self::ARBITRARY] as $foreign) {
            $response = $this->apiPut('/v2/admin/member-premium/settings', [
                'stripe_connect_account_id' => $foreign,
            ]);

            $response->assertStatus(422);
            $this->assertSame('stripe_connect_account_id', $response->json('errors.0.field'), $foreign);
            $this->assertNull($this->stored(), "{$foreign} must not be stored");
        }
    }

    public function test_foreign_id_saved_before_the_fix_is_not_used_for_charges(): void
    {
        foreach ([self::OTHER_COMMUNITY, self::SELLER, self::ARBITRARY] as $foreign) {
            $this->storeDirectly($foreign);

            $this->assertNull(
                DonationStripeAccountService::accountIdForTenantReadyForCharges($this->testTenantId),
                "{$foreign} must not receive charges",
            );
            $this->assertSame(
                DonationStripeAccountService::ROUTE_PLATFORM_DEFAULT,
                DonationStripeAccountService::chargeRouteForTenant($this->testTenantId),
            );

            $payload = DonationStripeAccountService::settingsPayloadForTenant($this->testTenantId);
            $this->assertSame('', $payload['active_stripe_account_id']);
            $this->assertNotSame('ready', $payload['account_status']['state']);
        }
    }

    public function test_onboarding_does_not_resume_a_foreign_saved_account(): void
    {
        $this->storeDirectly(self::OTHER_COMMUNITY);

        $this->apiPost('/v2/admin/member-premium/connect/onboarding', [])->assertStatus(500);

        foreach ($this->stripeHttp->requests as $request) {
            $this->assertFalse(
                str_ends_with($request['url'], '/v1/account_links'),
                'No onboarding link may be issued for another community\'s account',
            );
        }
    }

    public function test_control_own_onboarded_account_saves_and_receives_charges(): void
    {
        $this->apiPut('/v2/admin/member-premium/settings', [
            'stripe_connect_account_id' => self::OWN,
        ])->assertOk()->assertJsonPath('data.settings.active_stripe_account_id', self::OWN);

        $this->assertSame(self::OWN, $this->stored());
        $this->assertSame(
            self::OWN,
            DonationStripeAccountService::accountIdForTenantReadyForCharges($this->testTenantId),
        );

        $this->apiPost('/v2/admin/member-premium/connect/onboarding', [])
            ->assertOk()
            ->assertJsonPath('data.onboarding_url', 'https://connect.stripe.test/setup/' . self::OWN);

        // Clearing the account remains allowed.
        $this->apiPut('/v2/admin/member-premium/settings', [
            'stripe_connect_account_id' => '',
        ])->assertOk();
        $this->assertNull($this->stored());
    }
}
