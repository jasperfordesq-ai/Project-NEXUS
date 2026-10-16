<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\DonationStripeAccountService;
use App\Services\TenantFeatureConfig;
use App\Services\TenantSettingsService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Stripe\HttpClient\ClientInterface;
use Tests\Laravel\TestCase;

/**
 * A community's own Stripe account (Stripe Connect Express), as the admin
 * "Stripe account" page uses it:
 *
 *  - the Express dashboard link is admin-only, refused while nothing is
 *    connected, and never issued for an account this community's own
 *    onboarding did not create (F-263 reach);
 *  - a card payment started on the community's account tells the browser
 *    which account the client_secret belongs to, because Stripe.js can only
 *    confirm it when initialised against that account.
 *
 * Only Stripe's remote HTTP boundary is simulated; nothing calls Stripe.
 */
final class MemberPremiumAdminStripeAccountControllerTest extends TestCase
{
    use DatabaseTransactions;

    private const OWN = 'acct_stripepage_own';
    private const OTHER_COMMUNITY = 'acct_stripepage_other';

    private object $stripeHttp;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::reset();

        $features = TenantFeatureConfig::FEATURE_DEFAULTS;
        $features['member_premium'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);

        config(['services.stripe.secret' => 'sk_test_stripe_account_page']);

        $tenantId = (string) $this->testTenantId;
        $ready = [
            'object' => 'account',
            'charges_enabled' => true,
            'payouts_enabled' => true,
            'details_submitted' => true,
            'requirements' => ['currently_due' => [], 'disabled_reason' => null],
        ];

        $this->stripeHttp = new class ($ready, $tenantId) implements ClientInterface {
            /** @var list<array{method:string,url:string,headers:array<int,string>,params:array<string,mixed>}> */
            public array $requests = [];

            /** @var array<string,array<string,mixed>> */
            private array $accounts;

            /** @param array<string,mixed> $ready */
            public function __construct(array $ready, string $tenantId)
            {
                $this->accounts = [
                    'acct_stripepage_own' => $ready + ['id' => 'acct_stripepage_own', 'metadata' => [
                        'nexus_tenant_id' => $tenantId,
                        'nexus_account_purpose' => 'donations',
                    ]],
                    'acct_stripepage_other' => $ready + ['id' => 'acct_stripepage_other', 'metadata' => [
                        'nexus_tenant_id' => '999264',
                        'nexus_account_purpose' => 'donations',
                    ]],
                ];
            }

            public function request($method, $absUrl, $headers, $params, $hasFile, $apiMode = 'v1'): array
            {
                $method = strtolower((string) $method);
                $url = (string) $absUrl;
                $params = is_array($params) ? $params : [];
                $headers = is_array($headers) ? array_values(array_map('strval', $headers)) : [];
                $this->requests[] = compact('method', 'url', 'headers', 'params');

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

                if ($method === 'post' && preg_match('#/v1/accounts/(acct_[A-Za-z0-9_]+)/login_links$#', $url, $m) === 1) {
                    return [json_encode([
                        'object' => 'login_link',
                        'url' => 'https://connect.stripe.test/express/' . $m[1],
                    ], JSON_THROW_ON_ERROR), 200, []];
                }

                if ($method === 'post' && str_ends_with($url, '/v1/customers')) {
                    return [json_encode([
                        'id' => 'cus_stripepage',
                        'object' => 'customer',
                    ], JSON_THROW_ON_ERROR), 200, []];
                }

                if ($method === 'post' && str_ends_with($url, '/v1/payment_intents')) {
                    return [json_encode([
                        'id' => 'pi_stripepage',
                        'object' => 'payment_intent',
                        'client_secret' => 'pi_stripepage_secret',
                        'status' => 'requires_payment_method',
                    ], JSON_THROW_ON_ERROR), 200, []];
                }

                throw new \RuntimeException("Unexpected Stripe request: {$method} {$url}");
            }
        };
        \Stripe\ApiRequestor::setHttpClient($this->stripeHttp);
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

    private function actingAsAdmin(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());
    }

    /** @return list<string> */
    private function requestedUrls(): array
    {
        return array_map(static fn (array $r): string => $r['url'], $this->stripeHttp->requests);
    }

    public function test_dashboard_link_requires_admin(): void
    {
        $this->storeDirectly(self::OWN);
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->create());

        $this->apiPost('/v2/admin/member-premium/connect/dashboard-link', [])->assertStatus(403);
        $this->assertSame([], $this->stripeHttp->requests, 'A member must not reach Stripe at all');
    }

    public function test_dashboard_link_is_refused_while_nothing_is_connected(): void
    {
        $this->actingAsAdmin();

        $this->apiPost('/v2/admin/member-premium/connect/dashboard-link', [])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'STRIPE_CONNECT_NOT_CONNECTED');
        $this->assertSame([], $this->stripeHttp->requests);
    }

    public function test_dashboard_link_is_never_issued_for_another_communitys_account(): void
    {
        $this->storeDirectly(self::OTHER_COMMUNITY);
        $this->actingAsAdmin();

        $this->apiPost('/v2/admin/member-premium/connect/dashboard-link', [])->assertStatus(500);

        foreach ($this->requestedUrls() as $url) {
            $this->assertFalse(
                str_ends_with($url, '/login_links'),
                'A dashboard login link gives full access to the account, so it must never be minted for a foreign one',
            );
        }
    }

    public function test_dashboard_link_opens_the_communitys_own_express_dashboard(): void
    {
        $this->storeDirectly(self::OWN);
        $this->actingAsAdmin();

        $this->apiPost('/v2/admin/member-premium/connect/dashboard-link', [])
            ->assertOk()
            ->assertJsonPath('data.dashboard_url', 'https://connect.stripe.test/express/' . self::OWN);
    }

    public function test_card_payment_on_the_communitys_account_names_that_account_for_the_browser(): void
    {
        $this->storeDirectly(self::OWN);
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]));
        DB::table('vol_donations')->where('tenant_id', $this->testTenantId)->delete();

        $response = $this->apiPost('/v2/donations/payment-intent', [
            'amount' => 5,
            'currency' => 'EUR',
        ]);

        $response->assertOk()
            ->assertJsonPath('data.client_secret', 'pi_stripepage_secret')
            ->assertJsonPath('data.stripe_account_id', self::OWN);

        $intentRequests = array_values(array_filter(
            $this->stripeHttp->requests,
            static fn (array $r): bool => str_ends_with($r['url'], '/v1/payment_intents'),
        ));
        $this->assertCount(1, $intentRequests);
        $this->assertContains(
            'Stripe-Account: ' . self::OWN,
            $intentRequests[0]['headers'],
            'The PaymentIntent must be created on the community account the browser is told about',
        );
    }

    public function test_card_payment_on_the_platform_account_reports_no_connected_account(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]));
        DB::table('vol_donations')->where('tenant_id', $this->testTenantId)->delete();

        $response = $this->apiPost('/v2/donations/payment-intent', [
            'amount' => 5,
            'currency' => 'EUR',
        ]);

        $response->assertOk()->assertJsonPath('data.stripe_account_id', null);

        foreach ($this->stripeHttp->requests as $request) {
            foreach ($request['headers'] as $header) {
                $this->assertStringStartsNotWith('Stripe-Account:', $header);
            }
        }
    }
}
