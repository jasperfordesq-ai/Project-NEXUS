<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\TenantFeatureConfig;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Stripe\HttpClient\ClientInterface;
use Tests\Laravel\TestCase;

/**
 * "Manage my support" for a supporter whose recurring donation lives in the
 * community's own Stripe account. Stripe refuses a Billing Portal session on
 * a connected account unless a portal configuration exists there, and an
 * Express account has no dashboard to save one in — so the platform must
 * create one (once) and name it on every portal session.
 *
 * Only Stripe's remote HTTP boundary is simulated; nothing calls Stripe.
 */
final class MemberPremiumConnectedBillingPortalTest extends TestCase
{
    use DatabaseTransactions;

    private const ACCOUNT = 'acct_portal_test_tenant';

    private object $stripeHttp;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::reset();

        $features = TenantFeatureConfig::FEATURE_DEFAULTS;
        $features['member_premium'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);
        config(['services.stripe.secret' => 'sk_test_portal']);

        DB::table('member_subscriptions')->where('tenant_id', $this->testTenantId)->delete();

        $this->stripeHttp = new class implements ClientInterface {
            /** @var list<array{method:string,url:string,headers:array<int,string>,params:array<string,mixed>}> */
            public array $requests = [];

            /** @var list<array<string,mixed>> */
            public array $existingConfigurations = [];

            public function request($method, $absUrl, $headers, $params, $hasFile, $apiMode = 'v1'): array
            {
                $method = strtolower((string) $method);
                $url = (string) $absUrl;
                $params = is_array($params) ? $params : [];
                $headers = is_array($headers) ? array_values(array_map('strval', $headers)) : [];
                $this->requests[] = compact('method', 'url', 'headers', 'params');

                if ($method === 'get' && str_contains($url, '/v1/billing_portal/configurations')) {
                    return [json_encode([
                        'object' => 'list',
                        'data' => $this->existingConfigurations,
                        'has_more' => false,
                    ], JSON_THROW_ON_ERROR), 200, []];
                }

                if ($method === 'post' && str_ends_with($url, '/v1/billing_portal/configurations')) {
                    return [json_encode(['id' => 'bpc_created', 'object' => 'billing_portal.configuration'], JSON_THROW_ON_ERROR), 200, []];
                }

                if ($method === 'post' && str_ends_with($url, '/v1/billing_portal/sessions')) {
                    return [json_encode([
                        'object' => 'billing_portal.session',
                        'url' => 'https://billing.stripe.test/session/' . ($params['configuration'] ?? 'none'),
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
        parent::tearDown();
    }

    private function supporterWithSubscription(?string $stripeAccountId): User
    {
        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $tierId = DB::table('member_premium_tiers')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'slug' => 'portal-' . strtolower(\Illuminate\Support\Str::random(6)),
            'name' => 'Portal tier',
            'monthly_price_cents' => 500,
            'yearly_price_cents' => 5000,
            'features' => json_encode([]),
            'sort_order' => 0,
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('member_subscriptions')->insert([
            'user_id' => $member->id,
            'tenant_id' => $this->testTenantId,
            'tier_id' => $tierId,
            'stripe_subscription_id' => 'sub_portal_' . $member->id,
            'stripe_customer_id' => 'cus_portal_' . $member->id,
            'payment_route' => $stripeAccountId ? 'tenant_connect' : 'platform_default',
            'stripe_account_id' => $stripeAccountId,
            'status' => 'active',
            'billing_interval' => 'monthly',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $member;
    }

    /** @return list<array{method:string,url:string,headers:array<int,string>,params:array<string,mixed>}> */
    private function requestsTo(string $suffix): array
    {
        return array_values(array_filter(
            $this->stripeHttp->requests,
            static fn (array $r): bool => str_contains($r['url'], $suffix),
        ));
    }

    public function test_portal_on_a_connected_account_creates_the_configuration_it_needs_and_names_it(): void
    {
        Sanctum::actingAs($this->supporterWithSubscription(self::ACCOUNT));

        $this->apiPost('/v2/member-premium/billing-portal', [])
            ->assertOk()
            ->assertJsonPath('data.portal_url', 'https://billing.stripe.test/session/bpc_created');

        $created = $this->requestsTo('/v1/billing_portal/configurations');
        $this->assertCount(2, $created, 'one lookup, then one create');
        $this->assertSame('post', $created[1]['method']);
        $this->assertContains('Stripe-Account: ' . self::ACCOUNT, $created[1]['headers']);
        $this->assertSame('true', (string) $created[1]['params']['features']['subscription_cancel']['enabled']);

        $sessions = $this->requestsTo('/v1/billing_portal/sessions');
        $this->assertCount(1, $sessions);
        $this->assertSame('bpc_created', $sessions[0]['params']['configuration']);
        $this->assertContains('Stripe-Account: ' . self::ACCOUNT, $sessions[0]['headers']);
    }

    public function test_portal_on_a_connected_account_reuses_an_existing_configuration(): void
    {
        $this->stripeHttp->existingConfigurations = [['id' => 'bpc_existing', 'object' => 'billing_portal.configuration', 'active' => true]];
        Sanctum::actingAs($this->supporterWithSubscription(self::ACCOUNT));

        $this->apiPost('/v2/member-premium/billing-portal', [])
            ->assertOk()
            ->assertJsonPath('data.portal_url', 'https://billing.stripe.test/session/bpc_existing');

        foreach ($this->requestsTo('/v1/billing_portal/configurations') as $request) {
            $this->assertSame('get', $request['method'], 'No configuration may be created when one exists');
        }
    }

    public function test_portal_on_the_platform_account_is_unchanged(): void
    {
        Sanctum::actingAs($this->supporterWithSubscription(null));

        $this->apiPost('/v2/member-premium/billing-portal', [])
            ->assertOk()
            ->assertJsonPath('data.portal_url', 'https://billing.stripe.test/session/none');

        $this->assertSame([], $this->requestsTo('/v1/billing_portal/configurations'));
        $sessions = $this->requestsTo('/v1/billing_portal/sessions');
        $this->assertCount(1, $sessions);
        $this->assertArrayNotHasKey('configuration', $sessions[0]['params']);
        foreach ($sessions[0]['headers'] as $header) {
            $this->assertStringStartsNotWith('Stripe-Account:', $header);
        }
    }
}
