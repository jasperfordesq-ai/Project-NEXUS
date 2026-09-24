<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Integration;

use App\Core\TenantContext;
use App\Http\Controllers\Api\PartnerApi\PartnerV1Controller;
use App\Models\User;
use App\Services\EmailDispatchService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\Laravel\TestCase;

class PartnerApiWalletReliabilityTest extends TestCase
{
    use DatabaseTransactions;

    public function test_partner_api_users_respect_federation_visibility_and_consent(): void
    {
        $tenantId = $this->testTenantId;
        $visible = User::factory()->forTenant($tenantId)->create([
            'name' => 'Visible Partner API User',
            'status' => 'active',
        ]);
        $hidden = User::factory()->forTenant($tenantId)->create([
            'name' => 'Hidden Partner API User',
            'status' => 'active',
        ]);

        $this->upsertFederationSettings((int) $visible->id, [
            'federation_optin' => 1,
            'profile_visible_federated' => 1,
            'appear_in_federated_search' => 1,
        ]);
        $this->upsertFederationSettings((int) $hidden->id, [
            'federation_optin' => 0,
            'profile_visible_federated' => 0,
            'appear_in_federated_search' => 0,
        ]);

        $response = TenantContext::runForTenant($tenantId, fn () => (new PartnerV1Controller())->listUsers(
            $this->partnerRequest(['users.read', 'users.pii'])
        ));
        $payload = $response->getData(true);
        $ids = array_column($payload['data'] ?? [], 'id');

        $this->assertSame(200, $response->getStatusCode());
        $this->assertContains((int) $visible->id, $ids);
        $this->assertNotContains((int) $hidden->id, $ids);
    }

    public function test_partner_api_listings_respect_owner_consent_and_listing_visibility(): void
    {
        $tenantId = $this->testTenantId;
        $visibleOwner = User::factory()->forTenant($tenantId)->create(['status' => 'active']);
        $hiddenOwner = User::factory()->forTenant($tenantId)->create(['status' => 'active']);
        $this->upsertFederationSettings((int) $visibleOwner->id, [
            'federation_optin' => 1,
            'profile_visible_federated' => 1,
            'appear_in_federated_search' => 1,
        ]);
        $this->upsertFederationSettings((int) $hiddenOwner->id, [
            'federation_optin' => 0,
            'profile_visible_federated' => 0,
            'appear_in_federated_search' => 0,
        ]);

        $visibleListingId = (int) DB::table('listings')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $visibleOwner->id,
            'title' => 'Federated partner listing',
            'description' => 'Visible to partner APIs.',
            'type' => 'offer',
            'status' => 'active',
            'federated_visibility' => 'listed',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('listings')->insert([
            [
                'tenant_id' => $tenantId,
                'user_id' => $visibleOwner->id,
                'title' => 'Private partner listing',
                'description' => 'Not visible to partner APIs.',
                'type' => 'offer',
                'status' => 'active',
                'federated_visibility' => 'none',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'tenant_id' => $tenantId,
                'user_id' => $hiddenOwner->id,
                'title' => 'Hidden owner partner listing',
                'description' => 'Owner opted out.',
                'type' => 'offer',
                'status' => 'active',
                'federated_visibility' => 'listed',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $response = TenantContext::runForTenant($tenantId, fn () => (new PartnerV1Controller())->listListings(
            $this->partnerRequest(['listings.read'])
        ));
        $payload = $response->getData(true);
        $ids = array_column($payload['data'] ?? [], 'id');

        $this->assertSame(200, $response->getStatusCode());
        $this->assertContains($visibleListingId, $ids);
        $this->assertNotContains('Private partner listing', array_column($payload['data'] ?? [], 'title'));
        $this->assertNotContains('Hidden owner partner listing', array_column($payload['data'] ?? [], 'title'));
    }

    public function test_partner_wallet_balance_reads_live_user_balance(): void
    {
        $tenantId = $this->testTenantId;
        $user = User::factory()->forTenant($tenantId)->create([
            'balance' => 7.00,
            'status' => 'active',
        ]);
        $this->upsertFederationSettings((int) $user->id, [
            'federation_optin' => 1,
            'profile_visible_federated' => 1,
            'transactions_enabled_federated' => 1,
        ]);

        $response = TenantContext::runForTenant($tenantId, fn () => (new PartnerV1Controller())->walletBalance((int) $user->id));
        $payload = $response->getData(true);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame(7.0, (float) $payload['data']['balance_hours']);
    }

    public function test_partner_wallet_balance_requires_federation_wallet_visibility(): void
    {
        $tenantId = $this->testTenantId;
        $user = User::factory()->forTenant($tenantId)->create([
            'balance' => 7.00,
            'status' => 'active',
        ]);
        $this->upsertFederationSettings((int) $user->id, [
            'federation_optin' => 0,
            'profile_visible_federated' => 0,
            'transactions_enabled_federated' => 1,
        ]);

        $response = TenantContext::runForTenant($tenantId, fn () => (new PartnerV1Controller())->walletBalance((int) $user->id));

        $this->assertSame(404, $response->getStatusCode());
        $this->assertSame('USER_NOT_FOUND', $response->getData(true)['errors'][0]['code'] ?? null);
    }

    public function test_partner_wallet_credit_uses_live_wallet_and_partner_scoped_idempotency(): void
    {
        $tenantId = $this->testTenantId;
        $user = User::factory()->forTenant($tenantId)->create([
            'balance' => 1.00,
            'email' => 'partner-credit-' . uniqid('', true) . '@example.test',
            'status' => 'active',
        ]);
        $this->upsertFederationSettings((int) $user->id, [
            'federation_optin' => 1,
            'profile_visible_federated' => 1,
            'transactions_enabled_federated' => 1,
        ]);
        $partnerId = $this->createPartner($tenantId, 'credit-partner');
        $otherPartnerId = $this->createPartner($tenantId, 'other-partner');
        $this->createWebhookSubscription($partnerId, 'https://93.184.216.34/hook');
        $this->createWebhookSubscription($otherPartnerId, 'https://93.184.216.35/hook');

        Http::fake(fn () => Http::response([], 204));
        $mailer = $this->fakeMailer();
        app()->instance(EmailDispatchService::class, $mailer);

        $first = TenantContext::runForTenant($tenantId, fn () => (new PartnerV1Controller())->walletCredit($this->walletCreditRequest($partnerId, [
            'user_id' => $user->id,
            'hours' => 2,
            'reference' => 'bank-ref-1',
            'note' => 'Settled transfer',
        ])));
        $second = TenantContext::runForTenant($tenantId, fn () => (new PartnerV1Controller())->walletCredit($this->walletCreditRequest($partnerId, [
            'user_id' => $user->id,
            'hours' => 2,
            'reference' => 'bank-ref-1',
            'note' => 'Settled transfer',
        ])));

        $this->assertSame(201, $first->getStatusCode());
        $this->assertSame(200, $second->getStatusCode());
        $this->assertTrue($second->getData(true)['data']['replayed']);
        $this->assertSame(3.0, (float) DB::table('users')->where('id', $user->id)->value('balance'));
        $this->assertSame(1, DB::table('transactions')->where('tenant_id', $tenantId)->where('receiver_id', $user->id)->where('transaction_type', 'other')->count());
        $this->assertSame(1, DB::table('api_partner_wallet_credits')->where('tenant_id', $tenantId)->where('partner_id', $partnerId)->where('reference', 'bank-ref-1')->count());
        $this->assertCount(1, $mailer->calls);

        Http::assertSentCount(1);
        Http::assertSent(fn ($request) => $request->url() === 'https://93.184.216.34/hook');
    }

    public function test_partner_wallet_credit_reference_conflict_does_not_mutate_wallet(): void
    {
        $tenantId = $this->testTenantId;
        $user = User::factory()->forTenant($tenantId)->create([
            'balance' => 1.00,
            'status' => 'active',
        ]);
        $this->upsertFederationSettings((int) $user->id, [
            'federation_optin' => 1,
            'profile_visible_federated' => 1,
            'transactions_enabled_federated' => 1,
        ]);
        $partnerId = $this->createPartner($tenantId, 'conflict-partner');
        app()->instance(EmailDispatchService::class, $this->fakeMailer());

        TenantContext::runForTenant($tenantId, fn () => (new PartnerV1Controller())->walletCredit($this->walletCreditRequest($partnerId, [
            'user_id' => $user->id,
            'hours' => 2,
            'reference' => 'same-ref',
        ])));

        $response = TenantContext::runForTenant($tenantId, fn () => (new PartnerV1Controller())->walletCredit($this->walletCreditRequest($partnerId, [
            'user_id' => $user->id,
            'hours' => 3,
            'reference' => 'same-ref',
        ])));

        $this->assertSame(409, $response->getStatusCode());
        $this->assertSame(3.0, (float) DB::table('users')->where('id', $user->id)->value('balance'));
        $this->assertSame(1, DB::table('transactions')->where('tenant_id', $tenantId)->where('receiver_id', $user->id)->count());
    }

    public function test_partner_wallet_credit_requires_federation_transaction_consent(): void
    {
        $tenantId = $this->testTenantId;
        $user = User::factory()->forTenant($tenantId)->create([
            'balance' => 1.00,
            'status' => 'active',
        ]);
        $this->upsertFederationSettings((int) $user->id, [
            'federation_optin' => 1,
            'profile_visible_federated' => 1,
            'transactions_enabled_federated' => 0,
        ]);
        $partnerId = $this->createPartner($tenantId, 'blocked-wallet-partner');
        app()->instance(EmailDispatchService::class, $this->fakeMailer());

        $response = TenantContext::runForTenant($tenantId, fn () => (new PartnerV1Controller())->walletCredit($this->walletCreditRequest($partnerId, [
            'user_id' => $user->id,
            'hours' => 2,
            'reference' => 'blocked-ref',
        ])));

        $this->assertSame(404, $response->getStatusCode());
        $this->assertSame(1.0, (float) DB::table('users')->where('id', $user->id)->value('balance'));
        $this->assertSame(0, DB::table('transactions')->where('tenant_id', $tenantId)->where('receiver_id', $user->id)->count());
        $this->assertSame(0, DB::table('api_partner_wallet_credits')->where('tenant_id', $tenantId)->where('partner_id', $partnerId)->count());
    }

    public function test_partner_webhook_subscription_errors_use_translated_messages(): void
    {
        $tenantId = $this->testTenantId;
        $partnerId = $this->createPartner($tenantId, 'webhook-validation-partner');

        $response = TenantContext::runForTenant($tenantId, fn () => (new PartnerV1Controller())->createWebhookSubscription(
            $this->webhookSubscriptionRequest($partnerId, [])
        ));

        $this->assertSame(422, $response->getStatusCode());
        $this->assertSame(__('api.partner_webhook_event_types_and_target_required'), $response->getData(true)['errors'][0]['message'] ?? null);
    }

    private function createPartner(int $tenantId, string $slug): int
    {
        // F-175: the Partner API is now gated by the per-tenant `partner_api` feature.
        $features = json_decode((string) (DB::table('tenants')->where('id', $tenantId)->value('features') ?: '{}'), true) ?: [];
        $features['partner_api'] = true;
        DB::table('tenants')->where('id', $tenantId)->update(['features' => json_encode($features)]);

        return (int) DB::table('api_partners')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => ucfirst(str_replace('-', ' ', $slug)),
            'slug' => $slug . '-' . uniqid(),
            'status' => 'active',
            'is_sandbox' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function createWebhookSubscription(int $partnerId, string $url): void
    {
        DB::table('api_webhook_subscriptions')->insert([
            'tenant_id' => DB::table('api_partners')->where('id', $partnerId)->value('tenant_id'),
            'partner_id' => $partnerId,
            'event_types' => json_encode(['wallet.credited']),
            'target_url' => $url,
            'secret' => 'whsec_test',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function walletCreditRequest(int $partnerId, array $payload): Request
    {
        $request = Request::create('/api/partner/v1/wallet/credit', 'POST', $payload);
        $partner = DB::table('api_partners')->where('id', $partnerId)->first();
        $request->attributes->set('partner', [
            'id' => $partnerId,
            'name' => (string) $partner->name,
            'slug' => (string) $partner->slug,
        ]);

        return $request;
    }

    private function webhookSubscriptionRequest(int $partnerId, array $payload): Request
    {
        $request = Request::create('/api/partner/v1/webhooks', 'POST', $payload);
        $partner = DB::table('api_partners')->where('id', $partnerId)->first();
        $request->attributes->set('partner', [
            'id' => $partnerId,
            'name' => (string) $partner->name,
            'slug' => (string) $partner->slug,
        ]);

        return $request;
    }

    private function partnerRequest(array $scopes = []): Request
    {
        $request = Request::create('/api/partner/v1/users', 'GET');
        $request->attributes->set('partner_scopes', $scopes);

        return $request;
    }

    private function upsertFederationSettings(int $userId, array $overrides): void
    {
        DB::table('federation_user_settings')->updateOrInsert(
            ['user_id' => $userId],
            array_merge([
                'federation_optin' => 1,
                'profile_visible_federated' => 1,
                'appear_in_federated_search' => 1,
                'messaging_enabled_federated' => 1,
                'transactions_enabled_federated' => 1,
                'updated_at' => now(),
            ], $overrides)
        );
    }

    private function fakeMailer(): EmailDispatchService
    {
        return new class extends EmailDispatchService {
            /** @var list<array{to:string,subject:string,body:string,options:array<string,mixed>}> */
            public array $calls = [];

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                $this->calls[] = compact('to', 'subject', 'body', 'options');

                return true;
            }
        };
    }
}
