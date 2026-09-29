<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E061;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\CaringCommunity\CaringRegionalPointService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-225 — regional points.
 *
 * (1) Marketplace redemption burned a member's points against an order total
 *     the client asserted, and no checkout ever applied the resulting
 *     "discount". Until a real order integration exists the redemption path
 *     must refuse cleanly: no debit, no ledger row, and no screen or quote
 *     advertising it.
 * (2) Transfers are addressed by member id; the API must refuse a recipient
 *     who is outside the community or whose account is not active.
 *
 * Caring Community is off on staging, so each test switches it on itself.
 */
class F225RegionalPointsRedemptionAndTransferTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 2;

    protected function setUp(): void
    {
        parent::setUp();
        $this->mock(\App\Services\EmailDispatchService::class, fn ($mock) => $mock->shouldReceive('send')->andReturn(true));
        \Illuminate\Support\Facades\Http::fake();

        $features = [];
        $raw = DB::table('tenants')->where('id', self::TENANT_ID)->value('features');
        if (is_string($raw) && $raw !== '') {
            $decoded = json_decode($raw, true);
            $features = is_array($decoded) ? $decoded : [];
        }
        $features['caring_community'] = true;
        DB::table('tenants')->where('id', self::TENANT_ID)->update(['features' => json_encode($features)]);

        TenantContext::setById(self::TENANT_ID);
    }

    private function makeUser(string $status = 'active', int $tenantId = self::TENANT_ID): int
    {
        $email = 'f225-' . bin2hex(random_bytes(6)) . '@example.test';

        return (int) DB::table('users')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => 'F225 Member',
            'first_name' => 'F225',
            'last_name' => 'Member',
            'email' => $email,
            'username' => 'f225_' . bin2hex(random_bytes(4)),
            'password' => password_hash('password', PASSWORD_BCRYPT),
            'balance' => 0,
            'status' => $status,
            'is_approved' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function makeListing(int $sellerId, float $price): int
    {
        return (int) DB::table('marketplace_listings')->insertGetId([
            'tenant_id' => self::TENANT_ID,
            'user_id' => $sellerId,
            'title' => 'F225 listing',
            'description' => 'Synthetic listing for F-225.',
            'price' => $price,
            'price_currency' => 'CHF',
            'price_type' => 'fixed',
            'quantity' => 1,
            'delivery_method' => 'pickup',
            'seller_type' => 'private',
            'status' => 'active',
            'moderation_status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function service(): CaringRegionalPointService
    {
        return app(CaringRegionalPointService::class);
    }

    private function redemptionCount(int $memberId): int
    {
        return DB::table('caring_regional_point_transactions')
            ->where('tenant_id', self::TENANT_ID)
            ->where('user_id', $memberId)
            ->where('type', 'redemption')
            ->count();
    }

    public function test_redemption_with_inflated_client_total_is_refused_and_debits_nothing(): void
    {
        $member = $this->makeUser();
        $seller = $this->makeUser();
        $admin = $this->makeUser();
        $listing = $this->makeListing($seller, 10.0);

        $service = $this->service();
        $service->updateConfig(self::TENANT_ID, ['enabled' => true, 'marketplace_redemption_enabled' => true]);
        $service->issue($member, 300, 'Synthetic balance', $admin);
        $service->updateMarketplaceSellerSettings($seller, true, 10, 25);

        Sanctum::actingAs(User::findOrFail($member));
        // A CHF 10 listing, but the client claims a CHF 1,000 order so a
        // 25% cap would allow a CHF 250 "discount" (2,500 points).
        $response = $this->apiPost('/v2/caring-community/regional-points/marketplace/redeem', [
            'seller_id' => $seller,
            'listing_id' => $listing,
            'points_to_use' => 200,
            'order_total_chf' => 1000,
        ]);

        $response->assertStatus(403);
        $this->assertSame('FEATURE_UNAVAILABLE', $response->json('errors.0.code'));
        $this->assertEqualsWithDelta(300.0, $service->memberSummary($member)['account']['balance'], 0.001);
        $this->assertSame(0, $this->redemptionCount($member));
    }

    public function test_redemption_is_refused_at_the_service_layer_too(): void
    {
        $member = $this->makeUser();
        $seller = $this->makeUser();
        $admin = $this->makeUser();
        $listing = $this->makeListing($seller, 100.0);

        $service = $this->service();
        $service->updateConfig(self::TENANT_ID, ['enabled' => true, 'marketplace_redemption_enabled' => true]);
        $service->issue($member, 300, 'Synthetic balance', $admin);
        $service->updateMarketplaceSellerSettings($seller, true, 10, 25);

        $refusal = null;
        try {
            $service->redeemForMarketplaceDiscount($member, $seller, $listing, 200, 100);
        } catch (\RuntimeException $e) {
            $refusal = $e->getMessage();
        }
        $this->assertSame(__('api.caring_regional_points_marketplace_unavailable'), $refusal);

        $this->assertEqualsWithDelta(300.0, $service->memberSummary($member)['account']['balance'], 0.001);
        $this->assertSame(0, $this->redemptionCount($member));
    }

    public function test_quote_and_member_config_do_not_advertise_redemption(): void
    {
        $member = $this->makeUser();
        $seller = $this->makeUser();
        $admin = $this->makeUser();
        $listing = $this->makeListing($seller, 100.0);

        $service = $this->service();
        $service->updateConfig(self::TENANT_ID, ['enabled' => true, 'marketplace_redemption_enabled' => true]);
        $service->issue($member, 300, 'Synthetic balance', $admin);
        $service->updateMarketplaceSellerSettings($seller, true, 10, 25);

        $quote = $service->calculateMarketplaceDiscount($member, $seller, $listing, 100);
        $this->assertFalse($quote['accepts']);
        $this->assertSame('feature_unavailable', $quote['reason']);

        $this->assertFalse($service->memberSummary($member)['config']['marketplace_redemption_enabled']);

        // The admin sees the stored choice plus the fact that it cannot take effect.
        $adminConfig = $service->getConfig(self::TENANT_ID);
        $this->assertTrue($adminConfig['marketplace_redemption_enabled']);
        $this->assertFalse($adminConfig['marketplace_redemption_available']);
    }

    public function test_transfer_refuses_recipient_whose_account_is_not_active(): void
    {
        $sender = $this->makeUser();
        $admin = $this->makeUser();
        $service = $this->service();
        $service->updateConfig(self::TENANT_ID, ['enabled' => true, 'member_transfers_enabled' => true]);
        $service->issue($sender, 50, 'Synthetic balance', $admin);

        $suspended = $this->makeUser('suspended');
        $deleted = $this->makeUser();
        DB::table('users')->where('id', $deleted)->update(['deleted_at' => now()]);
        $otherTenant = $this->makeUser('active', 999);

        Sanctum::actingAs(User::findOrFail($sender));
        foreach ([$suspended, $deleted, $otherTenant] as $recipient) {
            $this->apiPost('/v2/caring-community/regional-points/transfer', [
                'recipient_user_id' => $recipient,
                'points' => 5,
            ])->assertStatus(422);
            $this->assertSame(0, DB::table('caring_regional_point_transactions')
                ->where('tenant_id', self::TENANT_ID)
                ->where('user_id', $recipient)
                ->count());
        }

        $this->assertEqualsWithDelta(50.0, $service->memberSummary($sender)['account']['balance'], 0.001);
    }

    public function test_transfer_to_an_active_member_still_succeeds(): void
    {
        $sender = $this->makeUser();
        $recipient = $this->makeUser();
        $admin = $this->makeUser();
        $service = $this->service();
        $service->updateConfig(self::TENANT_ID, ['enabled' => true, 'member_transfers_enabled' => true]);
        $service->issue($sender, 50, 'Synthetic balance', $admin);

        Sanctum::actingAs(User::findOrFail($sender));
        $this->apiPost('/v2/caring-community/regional-points/transfer', [
            'recipient_user_id' => $recipient,
            'points' => 5,
        ])->assertStatus(201);

        $this->assertEqualsWithDelta(45.0, $service->memberSummary($sender)['account']['balance'], 0.001);
        $this->assertEqualsWithDelta(5.0, $service->memberSummary($recipient)['account']['balance'], 0.001);
    }
}
