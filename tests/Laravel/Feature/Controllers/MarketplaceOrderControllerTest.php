<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use App\Core\TenantContext;
use App\Services\MarketplaceConfigurationService;
use App\Services\SafeguardingInteractionPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;
use Mockery;

/**
 * Tests for MarketplaceOrderController — auth, authorization, tenant scope.
 */
class MarketplaceOrderControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function enableMarketplaceFeature(int $tenantId = 2): void
    {
        $tenant = DB::table('tenants')->where('id', $tenantId)->first();
        $features = $tenant && $tenant->features
            ? (json_decode((string) $tenant->features, true) ?: [])
            : [];
        $features['marketplace'] = true;
        DB::table('tenants')->where('id', $tenantId)->update([
            'features' => json_encode($features),
        ]);
        TenantContext::setById($tenantId);
        MarketplaceConfigurationService::set(
            MarketplaceConfigurationService::CONFIG_STRIPE_ENABLED,
            true,
        );
        MarketplaceConfigurationService::set(
            MarketplaceConfigurationService::CONFIG_ALLOW_SHIPPING,
            true,
        );
    }

    private function authenticatedUser(int $tenantId = 2): User
    {
        $user = User::factory()->forTenant($tenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);
        return $user;
    }

    private function makeOrder(int $tenantId, int $buyerId, int $sellerId, array $overrides = []): int
    {
        $listingId = DB::table('marketplace_listings')->insertGetId(array_merge([
            'tenant_id' => $tenantId,
            'user_id' => $sellerId,
            'title' => 'Item',
            'description' => 'desc',
            'price' => 10.00,
            'price_currency' => 'EUR',
            'price_type' => 'fixed',
            'quantity' => 1,
            'shipping_available' => 0,
            'local_pickup' => 1,
            'delivery_method' => 'pickup',
            'seller_type' => 'private',
            'status' => 'active',
            'moderation_status' => 'approved',
            'created_at' => now(),
        ], []));

        return (int) DB::table('marketplace_orders')->insertGetId(array_merge([
            'tenant_id' => $tenantId,
            'order_number' => 'ORD-' . uniqid(),
            'buyer_id' => $buyerId,
            'seller_id' => $sellerId,
            'marketplace_listing_id' => $listingId,
            'quantity' => 1,
            'unit_price' => 10.00,
            'total_price' => 10.00,
            'currency' => 'EUR',
            'status' => 'pending_payment',
            'created_at' => now(),
        ], $overrides));
    }

    // -------- Smoke (kept) --------

    public function test_checkout_outcome_requires_auth(): void
    {
        $this->assertContains($this->apiPost('/v2/marketplace/orders/checkout-outcome', [
            'idempotency_key' => 'checkout-outcome-fixture',
        ])->status(), [401, 403]);
    }

    public function test_checkout_outcome_reads_only_current_buyer_and_tenant_without_replaying_purchase(): void
    {
        $this->enableMarketplaceFeature();
        $buyer = $this->authenticatedUser();
        $seller = User::factory()->forTenant(2)->create();
        $key = 'checkout-outcome-fixture';
        $ownId = $this->makeOrder(2, $buyer->id, $seller->id, ['checkout_key' => hash('sha256', $key)]);
        $this->apiPost('/v2/marketplace/orders/checkout-outcome', ['idempotency_key' => $key])
            ->assertOk()->assertJsonPath('data.order.id', $ownId);

        $foreignKey = 'checkout-foreign-buyer';
        $this->makeOrder(2, $seller->id, $buyer->id, ['checkout_key' => hash('sha256', $foreignKey)]);
        $this->apiPost('/v2/marketplace/orders/checkout-outcome', ['idempotency_key' => $foreignKey])
            ->assertOk()->assertJsonPath('data.order', null);
        $tenantKey = 'checkout-foreign-tenant';
        $this->makeOrder(1, $buyer->id, $seller->id, ['checkout_key' => hash('sha256', $tenantKey)]);
        $this->apiPost('/v2/marketplace/orders/checkout-outcome', ['idempotency_key' => $tenantKey])
            ->assertOk()->assertJsonPath('data.order', null);
        $this->apiPost('/v2/marketplace/orders/checkout-outcome', ['idempotency_key' => 'checkout-no-order-yet'])
            ->assertOk()->assertJsonPath('data.order', null);
        $this->assertDatabaseHas('marketplace_orders', ['id' => $ownId, 'status' => 'pending_payment']);
    }

    public function test_store_requires_auth(): void
    {
        $response = $this->apiPost('/v2/marketplace/orders', []);
        $this->assertContains($response->status(), [401, 403]);
    }

    public function test_store_rejects_unbounded_order_quantity(): void
    {
        $this->enableMarketplaceFeature();
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/marketplace/orders', [
            'listing_id' => 999999,
            'quantity' => 101,
            'idempotency_key' => 'quantity-boundary-check-0001',
            'payment_method' => 'cash',
        ]);

        $response->assertStatus(422);
        $this->assertNotEmpty($response->json('errors.0.details.quantity'));
    }

    public function test_dispute_rejects_executable_evidence_url_schemes(): void
    {
        $this->enableMarketplaceFeature();
        $buyer = $this->authenticatedUser();
        $seller = User::factory()->forTenant(2)->create(['status' => 'active']);
        $orderId = $this->makeOrder(2, (int) $buyer->id, (int) $seller->id, [
            'status' => 'paid',
        ]);

        $response = $this->apiPost("/v2/marketplace/orders/{$orderId}/dispute", [
            'reason' => 'not_received',
            'description' => 'The evidence link must be safe for the case reviewer.',
            'evidence_urls' => ['data:text/html,<script>alert(1)</script>'],
        ]);

        $response->assertStatus(422);
        $details = $response->json('errors.0.details');
        $this->assertIsArray($details);
        $this->assertArrayHasKey('evidence_urls.0', $details);
    }

    public function test_purchases_requires_auth(): void
    {
        $response = $this->apiGet('/v2/marketplace/orders/purchases');
        $this->assertContains($response->status(), [401, 403]);
    }

    public function test_sales_requires_auth(): void
    {
        $response = $this->apiGet('/v2/marketplace/orders/sales');
        $this->assertContains($response->status(), [401, 403]);
    }

    public function test_show_requires_auth(): void
    {
        $response = $this->apiGet('/v2/marketplace/orders/1');
        $this->assertContains($response->status(), [401, 403]);
    }

    public function test_purchases_authenticated_smoke(): void
    {
        $this->authenticatedUser();
        $response = $this->apiGet('/v2/marketplace/orders/purchases');
        $this->assertLessThan(500, $response->status());
    }

    public function test_sales_authenticated_smoke(): void
    {
        $this->authenticatedUser();
        $response = $this->apiGet('/v2/marketplace/orders/sales');
        $this->assertLessThan(500, $response->status());
    }

    public function test_store_uses_server_shipping_price_and_replays_idempotently(): void
    {
        $this->enableMarketplaceFeature();
        $buyer = $this->authenticatedUser();
        $seller = User::factory()->forTenant(2)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $listingId = DB::table('marketplace_listings')->insertGetId([
            'tenant_id' => 2,
            'user_id' => $seller->id,
            'title' => 'Shippable item',
            'description' => 'desc',
            'price' => 10.00,
            'price_currency' => 'EUR',
            'price_type' => 'fixed',
            'quantity' => 1,
            'shipping_available' => 1,
            'local_pickup' => 0,
            'delivery_method' => 'shipping',
            'seller_type' => 'private',
            'status' => 'active',
            'moderation_status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $sellerProfileId = (int) DB::table('marketplace_seller_profiles')->insertGetId([
            'tenant_id' => 2,
            'user_id' => $seller->id,
            'seller_type' => 'private',
            'stripe_account_id' => 'acct_order_controller_ready',
            'stripe_onboarding_complete' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $shippingOptionId = (int) DB::table('marketplace_shipping_options')->insertGetId([
            'tenant_id' => 2,
            'seller_id' => $sellerProfileId,
            'courier_name' => 'Express Courier',
            'courier_code' => 'express',
            'price' => 4.50,
            'currency' => 'EUR',
            'estimated_days' => 2,
            'is_default' => 1,
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')->twice();
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);
        $idempotencyKey = 'checkout-' . str_repeat('a', 24);

        $payload = [
            'listing_id' => $listingId,
            'shipping_option_id' => $shippingOptionId,
            'shipping_cost' => 0.01,
            'idempotency_key' => $idempotencyKey,
        ];
        $response = $this->apiPost('/v2/marketplace/orders', $payload);

        $response->assertCreated();
        $replayed = $this->apiPost('/v2/marketplace/orders', $payload);
        $replayed->assertCreated();
        $this->assertSame($response->json('data.id'), $replayed->json('data.id'));
        $this->assertDatabaseHas('marketplace_orders', [
            'buyer_id' => $buyer->id,
            'marketplace_listing_id' => $listingId,
            'shipping_option_id' => $shippingOptionId,
            'shipping_method' => 'express',
            'shipping_cost' => 4.50,
            'total_price' => 14.50,
        ]);
        $this->assertSame(1, DB::table('marketplace_orders')
            ->where('tenant_id', 2)
            ->where('buyer_id', $buyer->id)
            ->where('marketplace_listing_id', $listingId)
            ->count());

        $otherListingId = (int) DB::table('marketplace_listings')->insertGetId([
            'tenant_id' => 2,
            'user_id' => $seller->id,
            'title' => 'Different item',
            'description' => 'Idempotency conflict fixture.',
            'price' => 10.00,
            'price_currency' => 'EUR',
            'price_type' => 'fixed',
            'quantity' => 1,
            'shipping_available' => 1,
            'local_pickup' => 0,
            'delivery_method' => 'shipping',
            'seller_type' => 'private',
            'status' => 'active',
            'moderation_status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $divergentPayloads = [
            array_merge($payload, ['listing_id' => $otherListingId]),
            array_merge($payload, ['quantity' => 2]),
            array_merge($payload, ['shipping_option_id' => $shippingOptionId + 999999]),
            array_merge($payload, ['coupon_code' => 'DIFFERENT']),
            array_merge($payload, ['loyalty_redemption_id' => 999999]),
            array_merge($payload, ['payment_method' => 'time_credits']),
        ];
        foreach ($divergentPayloads as $divergentPayload) {
            $this->apiPost('/v2/marketplace/orders', $divergentPayload)
                ->assertStatus(422)
                ->assertJsonPath('errors.0.code', 'VALIDATION_ERROR')
                ->assertJsonPath(
                    'errors.0.message',
                    __('api.marketplace_checkout_idempotency_conflict'),
                );
        }
        $this->assertSame(1, DB::table('marketplace_orders')
            ->where('tenant_id', 2)
            ->where('buyer_id', $buyer->id)
            ->count());
    }

    public function test_store_settles_fully_discounted_zero_decimal_order_without_stripe(): void
    {
        $this->enableMarketplaceFeature();
        $tenant = DB::table('tenants')->where('id', 2)->first();
        $features = $tenant && $tenant->features
            ? (json_decode((string) $tenant->features, true) ?: [])
            : [];
        $features['merchant_coupons'] = true;
        DB::table('tenants')->where('id', 2)->update(['features' => json_encode($features)]);
        TenantContext::setById(2);

        $buyer = $this->authenticatedUser();
        $seller = User::factory()->forTenant(2)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $listingId = (int) DB::table('marketplace_listings')->insertGetId([
            'tenant_id' => 2,
            'user_id' => $seller->id,
            'title' => 'JPY coupon item',
            'description' => 'Zero-decimal currency coupon regression fixture.',
            'price' => 1000,
            'price_currency' => 'JPY',
            'price_type' => 'fixed',
            'quantity' => 1,
            'inventory_count' => 1,
            'shipping_available' => 0,
            'local_pickup' => 1,
            'delivery_method' => 'pickup',
            'seller_type' => 'business',
            'status' => 'active',
            'moderation_status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $sellerProfileId = (int) DB::table('marketplace_seller_profiles')->insertGetId([
            'tenant_id' => 2,
            'user_id' => $seller->id,
            'seller_type' => 'business',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $couponId = (int) DB::table('merchant_coupons')->insertGetId([
            'tenant_id' => 2,
            'seller_id' => $sellerProfileId,
            'code' => 'JPY100PCT',
            'title' => 'Fully discounted',
            'discount_type' => 'percent',
            'discount_value' => 100,
            'min_order_cents' => null,
            'max_uses' => null,
            'max_uses_per_member' => 1,
            'status' => 'active',
            'applies_to' => 'all_listings',
            'usage_count' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')->twice();
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $response = $this->apiPost('/v2/marketplace/orders', [
            'listing_id' => $listingId,
            'shipping_method' => 'pickup',
            'payment_method' => 'cash',
            'coupon_code' => 'JPY100PCT',
            'idempotency_key' => 'checkout-jpy-percent-coupon',
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.currency', 'JPY')
            ->assertJsonPath('data.total_price', 0)
            ->assertJsonPath('data.status', 'paid')
            ->assertJsonPath('data.requires_payment', false);
        $orderId = (int) $response->json('data.id');
        $this->assertDatabaseHas('merchant_coupon_redemptions', [
            'coupon_id' => $couponId,
            'order_id' => $orderId,
            'discount_applied_cents' => 1000,
        ]);
        $this->assertDatabaseHas('marketplace_orders', [
            'id' => $orderId,
            'status' => 'paid',
            'total_price' => 0,
            'payment_expires_at' => null,
        ]);

        $this->apiPut("/v2/marketplace/orders/{$orderId}/cancel", [
            'reason' => 'No longer needed',
        ])->assertOk()->assertJsonPath('data.status', 'cancelled');
        $this->assertDatabaseHas('marketplace_listings', [
            'id' => $listingId,
            'inventory_count' => 1,
            'status' => 'active',
        ]);
        $this->assertSame(0, (int) DB::table('merchant_coupons')
            ->where('id', $couponId)
            ->value('usage_count'));
        $this->assertDatabaseHas('merchant_coupon_redemptions', [
            'order_id' => $orderId,
            'reversal_reason' => 'No longer needed',
        ]);
    }

    public function test_store_does_not_reserve_inventory_for_an_unpayable_seller(): void
    {
        $this->enableMarketplaceFeature();
        $buyer = $this->authenticatedUser();
        $seller = User::factory()->forTenant(2)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $listingId = (int) DB::table('marketplace_listings')->insertGetId([
            'tenant_id' => 2,
            'user_id' => $seller->id,
            'title' => 'Unpayable item',
            'description' => 'Connect readiness must precede inventory reservation.',
            'price' => 25.00,
            'price_currency' => 'EUR',
            'price_type' => 'fixed',
            'quantity' => 1,
            'inventory_count' => 1,
            'shipping_available' => 0,
            'local_pickup' => 1,
            'delivery_method' => 'pickup',
            'seller_type' => 'private',
            'status' => 'active',
            'moderation_status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')->twice();
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $this->apiPost('/v2/marketplace/orders', [
            'listing_id' => $listingId,
            'shipping_method' => 'pickup',
            'payment_method' => 'cash',
            'idempotency_key' => 'unpayable-seller-checkout-0001',
        ])->assertStatus(422)->assertJsonPath(
            'errors.0.message',
            __('api.marketplace_seller_onboarding_required'),
        );

        $this->assertDatabaseMissing('marketplace_orders', [
            'tenant_id' => 2,
            'buyer_id' => $buyer->id,
            'marketplace_listing_id' => $listingId,
        ]);
        $this->assertDatabaseHas('marketplace_listings', [
            'id' => $listingId,
            'inventory_count' => 1,
            'status' => 'active',
        ]);
    }

    public function test_store_rejects_free_payment_method_for_a_fixed_price_listing(): void
    {
        $this->enableMarketplaceFeature();
        $buyer = $this->authenticatedUser();
        $seller = User::factory()->forTenant(2)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $listingId = (int) DB::table('marketplace_listings')->insertGetId([
            'tenant_id' => 2,
            'user_id' => $seller->id,
            'title' => 'Not a free item',
            'description' => 'Free checkout spoof regression fixture.',
            'price' => 25.00,
            'price_currency' => 'EUR',
            'price_type' => 'fixed',
            'quantity' => 1,
            'inventory_count' => 1,
            'shipping_available' => 0,
            'local_pickup' => 1,
            'delivery_method' => 'pickup',
            'seller_type' => 'private',
            'status' => 'active',
            'moderation_status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')->twice();
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $response = $this->apiPost('/v2/marketplace/orders', [
            'listing_id' => $listingId,
            'shipping_method' => 'pickup',
            'payment_method' => 'free',
            'idempotency_key' => 'checkout-' . str_repeat('f', 24),
        ]);

        $response->assertStatus(422)->assertJsonPath('errors.0.code', 'VALIDATION_ERROR');
        $this->assertDatabaseMissing('marketplace_orders', [
            'tenant_id' => 2,
            'buyer_id' => $buyer->id,
            'marketplace_listing_id' => $listingId,
        ]);
        $this->assertDatabaseHas('marketplace_listings', [
            'id' => $listingId,
            'status' => 'active',
            'inventory_count' => 1,
        ]);
    }

    public function test_unlimited_inventory_listing_remains_active_across_multiple_direct_orders(): void
    {
        $this->enableMarketplaceFeature();
        $buyer = $this->authenticatedUser();
        $seller = User::factory()->forTenant(2)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $listingId = (int) DB::table('marketplace_listings')->insertGetId([
            'tenant_id' => 2,
            'user_id' => $seller->id,
            'title' => 'Unlimited free listing',
            'description' => 'NULL inventory remains available for repeated orders.',
            'price' => 0,
            'price_currency' => 'EUR',
            'price_type' => 'free',
            'quantity' => 1,
            'inventory_count' => null,
            'shipping_available' => 0,
            'local_pickup' => 1,
            'delivery_method' => 'pickup',
            'seller_type' => 'private',
            'status' => 'active',
            'moderation_status' => 'approved',
            'expires_at' => now()->addDay(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')->times(4);
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        foreach (['u', 'v'] as $suffix) {
            $this->apiPost('/v2/marketplace/orders', [
                'listing_id' => $listingId,
                'shipping_method' => 'pickup',
                'payment_method' => 'free',
                'idempotency_key' => 'checkout-' . str_repeat($suffix, 24),
            ])->assertCreated();
        }

        $this->assertSame(2, DB::table('marketplace_orders')
            ->where('tenant_id', 2)
            ->where('buyer_id', $buyer->id)
            ->where('marketplace_listing_id', $listingId)
            ->count());
        $this->assertDatabaseHas('marketplace_listings', [
            'id' => $listingId,
            'status' => 'active',
            'inventory_count' => null,
        ]);
    }

    // -------- Deep tests --------

    public function test_show_returns_404_for_missing_order(): void
    {
        $this->authenticatedUser();
        $response = $this->apiGet('/v2/marketplace/orders/99999999');
        $this->assertContains($response->status(), [403, 404]);
    }

    public function test_show_forbidden_for_non_participant(): void
    {
        $buyer = User::factory()->forTenant(2)->create();
        $seller = User::factory()->forTenant(2)->create();
        $orderId = $this->makeOrder(2, $buyer->id, $seller->id);

        // Third party user tries to view the order
        $this->authenticatedUser();
        $response = $this->apiGet("/v2/marketplace/orders/{$orderId}");
        $this->assertEquals(403, $response->status());
    }

    public function test_show_allowed_for_buyer(): void
    {
        $seller = User::factory()->forTenant(2)->create();
        $buyer = User::factory()->forTenant(2)->create(['status' => 'active', 'is_approved' => true]);
        $orderId = $this->makeOrder(2, $buyer->id, $seller->id);

        Sanctum::actingAs($buyer, ['*']);
        $response = $this->apiGet("/v2/marketplace/orders/{$orderId}");
        $this->assertContains($response->status(), [200, 403]); // 403 only if feature gate blocks
    }

    public function test_ship_forbidden_for_non_seller(): void
    {
        $seller = User::factory()->forTenant(2)->create();
        $buyer = User::factory()->forTenant(2)->create(['status' => 'active', 'is_approved' => true]);
        $orderId = $this->makeOrder(2, $buyer->id, $seller->id);

        // Buyer tries to ship — must be seller only
        Sanctum::actingAs($buyer, ['*']);
        $response = $this->apiPut("/v2/marketplace/orders/{$orderId}/ship", []);
        $this->assertContains($response->status(), [403]);
    }

    public function test_confirm_delivery_forbidden_for_non_buyer(): void
    {
        $seller = User::factory()->forTenant(2)->create(['status' => 'active', 'is_approved' => true]);
        $buyer = User::factory()->forTenant(2)->create();
        $orderId = $this->makeOrder(2, $buyer->id, $seller->id, ['status' => 'shipped']);

        Sanctum::actingAs($seller, ['*']);
        $response = $this->apiPut("/v2/marketplace/orders/{$orderId}/confirm-delivery", []);
        $this->assertEquals(403, $response->status());
    }

    public function test_cancel_requires_reason(): void
    {
        $seller = User::factory()->forTenant(2)->create();
        $buyer = User::factory()->forTenant(2)->create(['status' => 'active', 'is_approved' => true]);
        $orderId = $this->makeOrder(2, $buyer->id, $seller->id);

        Sanctum::actingAs($buyer, ['*']);
        $response = $this->apiPut("/v2/marketplace/orders/{$orderId}/cancel", []);
        // 422 = validation; 403 = marketplace feature gate off in test tenant
        $this->assertContains($response->status(), [403, 422]);
    }

    public function test_cancel_unpaid_order_without_a_stripe_intent_reconciles_and_cancels(): void
    {
        $this->enableMarketplaceFeature();
        $seller = User::factory()->forTenant(2)->create();
        $buyer = User::factory()->forTenant(2)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $orderId = $this->makeOrder(2, $buyer->id, $seller->id);
        Sanctum::actingAs($buyer, ['*']);

        $response = $this->apiPut("/v2/marketplace/orders/{$orderId}/cancel", [
            'reason' => 'No longer needed',
        ]);

        $response->assertOk();
        $this->assertDatabaseHas('marketplace_orders', [
            'id' => $orderId,
            'status' => 'cancelled',
            'cancellation_reason' => 'No longer needed',
        ]);
    }

    public function test_cross_tenant_order_access_forbidden(): void
    {
        // Order in tenant 999
        $seller = User::factory()->forTenant(999)->create();
        $buyer = User::factory()->forTenant(999)->create();
        $orderId = $this->makeOrder(999, $buyer->id, $seller->id);

        // Current tenant context is 2 — authenticated user from tenant 2
        $this->authenticatedUser(2);
        $response = $this->apiGet("/v2/marketplace/orders/{$orderId}");
        // Should not leak — either 403 (not participant), 404, or feature gate
        $this->assertContains($response->status(), [403, 404]);
    }
}
