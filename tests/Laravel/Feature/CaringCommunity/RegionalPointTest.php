<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\CaringCommunity;

use App\Core\TenantContext;
use App\Services\CaringCommunity\CaringRegionalPointService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

class RegionalPointTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 2;

    protected function setUp(): void
    {
        parent::setUp();
        $this->mock(\App\Services\EmailDispatchService::class, fn ($mock) => $mock->shouldReceive('send')->andReturn(true));
        \Illuminate\Support\Facades\Http::fake();
        $this->setCaringCommunityFeature(true);
        TenantContext::setById(self::TENANT_ID);
    }

    private function setCaringCommunityFeature(bool $enabled): void
    {
        $tenant = DB::table('tenants')->where('id', self::TENANT_ID)->first();
        $features = [];
        if ($tenant && !empty($tenant->features)) {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : $tenant->features;
            $features = is_array($decoded) ? $decoded : [];
        }
        $features['caring_community'] = $enabled;
        DB::table('tenants')
            ->where('id', self::TENANT_ID)
            ->update(['features' => json_encode($features)]);
    }

    private function makeUser(string $email, int $tenantId = self::TENANT_ID): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => 'Regional Points User',
            'first_name' => 'Regional',
            'last_name' => 'User',
            'email' => $email,
            'username' => 'rp_' . substr(md5($email . microtime(true)), 0, 8),
            'password' => password_hash('password', PASSWORD_BCRYPT),
            'balance' => 0,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function makeApprovedVolLog(int $userId, float $hours = 2.5): int
    {
        return (int) DB::table('vol_logs')->insertGetId([
            'tenant_id' => self::TENANT_ID,
            'user_id' => $userId,
            'organization_id' => null,
            'opportunity_id' => null,
            'date_logged' => now()->toDateString(),
            'hours' => $hours,
            'description' => 'Approved caring support',
            'status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function makeMarketplaceListing(int $sellerId, float $price = 100.0): int
    {
        return (int) DB::table('marketplace_listings')->insertGetId([
            'tenant_id' => self::TENANT_ID,
            'user_id' => $sellerId,
            'title' => 'Regional point marketplace item',
            'description' => 'Listing used by regional point redemption tests.',
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

    public function test_regional_points_are_disabled_by_default(): void
    {
        $userId = $this->makeUser('rp-disabled-' . uniqid() . '@example.test');
        $service = app(CaringRegionalPointService::class);

        $this->assertFalse($service->isEnabled(self::TENANT_ID));

        $this->expectExceptionMessage('Regional points are not enabled for this community.');
        $service->memberSummary($userId);
    }

    public function test_admin_can_enable_without_changing_timebank_balance(): void
    {
        $userId = $this->makeUser('rp-enable-' . uniqid() . '@example.test');
        DB::table('users')->where('id', $userId)->update(['balance' => 12]);

        $service = app(CaringRegionalPointService::class);
        $config = $service->updateConfig(self::TENANT_ID, [
            'enabled' => true,
            'label' => 'Agoris Points',
            'symbol' => 'AGP',
            'auto_issue_enabled' => true,
            'points_per_approved_hour' => 5,
            'member_transfers_enabled' => true,
        ]);

        $this->assertTrue($config['enabled']);
        $this->assertSame('Agoris Points', $config['label']);
        $this->assertSame('AGP', $config['symbol']);
        $this->assertTrue($service->isEnabled(self::TENANT_ID));

        $summary = $service->memberSummary($userId);
        $this->assertEqualsWithDelta(0.0, $summary['account']['balance'], 0.001);

        $timebankBalance = (float) DB::table('users')->where('id', $userId)->value('balance');
        $this->assertEqualsWithDelta(12.0, $timebankBalance, 0.001);
    }

    public function test_issue_and_adjust_write_isolated_ledger(): void
    {
        $userId = $this->makeUser('rp-issue-' . uniqid() . '@example.test');
        $adminId = $this->makeUser('rp-admin-' . uniqid() . '@example.test');
        $service = app(CaringRegionalPointService::class);
        $service->updateConfig(self::TENANT_ID, ['enabled' => true]);

        $issued = $service->issue($userId, 25.5, 'Pilot-region launch bonus', $adminId);
        $this->assertEqualsWithDelta(25.5, $issued['balance'], 0.001);

        $adjusted = $service->adjust($userId, -5.25, 'Correction', $adminId);
        $this->assertEqualsWithDelta(20.25, $adjusted['balance'], 0.001);

        $history = $service->memberHistory($userId);
        $this->assertCount(2, $history);
        $this->assertSame('debit', $history[0]['direction']);
        $this->assertSame('credit', $history[1]['direction']);

        $this->assertDatabaseHas('caring_regional_point_accounts', [
            'tenant_id' => self::TENANT_ID,
            'user_id' => $userId,
        ]);
        $this->assertDatabaseHas('caring_regional_point_transactions', [
            'tenant_id' => self::TENANT_ID,
            'user_id' => $userId,
            'type' => 'admin_issue',
            'direction' => 'credit',
        ]);
    }

    public function test_issue_rejects_users_from_other_tenants(): void
    {
        $otherTenantUser = $this->makeUser('rp-other-' . uniqid() . '@example.test', 999);
        $adminId = $this->makeUser('rp-admin2-' . uniqid() . '@example.test');
        $service = app(CaringRegionalPointService::class);
        $service->updateConfig(self::TENANT_ID, ['enabled' => true]);

        $this->expectExceptionMessage('User not found');
        $service->issue($otherTenantUser, 10, 'Wrong tenant', $adminId);
    }

    public function test_approved_hour_awards_are_opt_in_and_idempotent(): void
    {
        $userId = $this->makeUser('rp-hours-' . uniqid() . '@example.test');
        $adminId = $this->makeUser('rp-hours-admin-' . uniqid() . '@example.test');
        $logId = $this->makeApprovedVolLog($userId, 3.5);
        $service = app(CaringRegionalPointService::class);

        $service->updateConfig(self::TENANT_ID, [
            'enabled' => true,
            'auto_issue_enabled' => false,
            'points_per_approved_hour' => 4,
        ]);

        $this->assertNull($service->awardForApprovedHours(self::TENANT_ID, $userId, $logId, 3.5, $adminId));

        $service->updateConfig(self::TENANT_ID, [
            'enabled' => true,
            'auto_issue_enabled' => true,
            'points_per_approved_hour' => 4,
        ]);

        $award = $service->awardForApprovedHours(self::TENANT_ID, $userId, $logId, 3.5, $adminId);
        $this->assertNotNull($award);
        $this->assertEqualsWithDelta(14.0, $award['points'], 0.001);
        $this->assertFalse($award['already_awarded']);

        $duplicate = $service->awardForApprovedHours(self::TENANT_ID, $userId, $logId, 3.5, $adminId);
        $this->assertNotNull($duplicate);
        $this->assertTrue($duplicate['already_awarded']);
        $this->assertSame($award['transaction_id'], $duplicate['transaction_id']);

        $summary = $service->memberSummary($userId);
        $this->assertEqualsWithDelta(14.0, $summary['account']['balance'], 0.001);

        $transactionCount = DB::table('caring_regional_point_transactions')
            ->where('tenant_id', self::TENANT_ID)
            ->where('reference_type', 'vol_log')
            ->where('reference_id', $logId)
            ->where('type', 'earned_for_hours')
            ->count();

        $this->assertSame(1, $transactionCount);
    }

    public function test_member_transfers_require_toggle_and_move_only_regional_points(): void
    {
        $sender = $this->makeUser('rp-transfer-sender-' . uniqid() . '@example.test');
        $recipient = $this->makeUser('rp-transfer-recipient-' . uniqid() . '@example.test');
        $adminId = $this->makeUser('rp-transfer-admin-' . uniqid() . '@example.test');
        DB::table('users')->where('id', $sender)->update(['balance' => 9]);
        DB::table('users')->where('id', $recipient)->update(['balance' => 1]);

        $service = app(CaringRegionalPointService::class);
        $service->updateConfig(self::TENANT_ID, [
            'enabled' => true,
            'member_transfers_enabled' => false,
        ]);
        $service->issue($sender, 30, 'Seed sender', $adminId);

        $this->expectExceptionMessage('Regional point transfers are not enabled for this community.');
        $service->transferBetweenMembers($sender, $recipient, 7.5, 'Thanks');
    }

    public function test_member_transfer_response_keeps_recipient_balance_private(): void
    {
        $sender = $this->makeUser(uniqid() . '@example.test');
        $recipient = $this->makeUser(uniqid() . '@example.test');
        $admin = $this->makeUser(uniqid() . '@example.test');
        DB::table('users')->whereIn('id', [$sender, $recipient])->update(['is_approved' => true]);
        $service = app(CaringRegionalPointService::class);
        $service->updateConfig(self::TENANT_ID, ['enabled' => true, 'member_transfers_enabled' => true]);
        $service->issue($sender, 30, 'Synthetic sender', $admin);
        $service->issue($recipient, 11, 'Synthetic recipient', $admin);
        \Laravel\Sanctum\Sanctum::actingAs(\App\Models\User::findOrFail($sender));
        $data = $this->apiPost('/v2/caring-community/regional-points/transfer', [
            'recipient_user_id' => $recipient, 'points' => 3,
        ])->assertStatus(201)->json('data');
        $this->assertArrayNotHasKey('recipient_balance', $data);
        $this->assertEquals(27, $data['sender_balance']);
        $this->assertEquals(14, $service->memberSummary($recipient)['account']['balance']);
    }

    public function test_member_transfer_creates_debit_and_credit_pair(): void
    {
        $sender = $this->makeUser('rp-transfer2-sender-' . uniqid() . '@example.test');
        $recipient = $this->makeUser('rp-transfer2-recipient-' . uniqid() . '@example.test');
        $adminId = $this->makeUser('rp-transfer2-admin-' . uniqid() . '@example.test');
        DB::table('users')->where('id', $sender)->update(['balance' => 9]);
        DB::table('users')->where('id', $recipient)->update(['balance' => 1]);

        $service = app(CaringRegionalPointService::class);
        $service->updateConfig(self::TENANT_ID, [
            'enabled' => true,
            'member_transfers_enabled' => true,
        ]);
        $service->issue($sender, 30, 'Seed sender', $adminId);

        $transfer = $service->transferBetweenMembers($sender, $recipient, 7.5, 'Thanks');

        $this->assertEqualsWithDelta(7.5, $transfer['points'], 0.001);
        $this->assertEqualsWithDelta(22.5, $transfer['sender_balance'], 0.001);
        $this->assertArrayNotHasKey('recipient_balance', $transfer);

        $senderSummary = $service->memberSummary($sender);
        $recipientSummary = $service->memberSummary($recipient);
        $this->assertEqualsWithDelta(22.5, $senderSummary['account']['balance'], 0.001);
        $this->assertEqualsWithDelta(7.5, $recipientSummary['account']['balance'], 0.001);

        $this->assertEqualsWithDelta(9.0, (float) DB::table('users')->where('id', $sender)->value('balance'), 0.001);
        $this->assertEqualsWithDelta(1.0, (float) DB::table('users')->where('id', $recipient)->value('balance'), 0.001);

        $this->assertDatabaseHas('caring_regional_point_transactions', [
            'id' => $transfer['sender_transaction_id'],
            'tenant_id' => self::TENANT_ID,
            'user_id' => $sender,
            'type' => 'transfer_out',
            'direction' => 'debit',
            'reference_type' => 'regional_point_transfer',
            'reference_id' => $transfer['recipient_transaction_id'],
        ]);
        $this->assertDatabaseHas('caring_regional_point_transactions', [
            'id' => $transfer['recipient_transaction_id'],
            'tenant_id' => self::TENANT_ID,
            'user_id' => $recipient,
            'type' => 'transfer_in',
            'direction' => 'credit',
            'reference_type' => 'regional_point_transfer',
            'reference_id' => $transfer['sender_transaction_id'],
        ]);
    }

    public function test_marketplace_quote_requires_tenant_and_merchant_opt_in(): void
    {
        $member = $this->makeUser('rp-market-quote-member-' . uniqid() . '@example.test');
        $seller = $this->makeUser('rp-market-quote-seller-' . uniqid() . '@example.test');
        $admin = $this->makeUser('rp-market-quote-admin-' . uniqid() . '@example.test');
        $listing = $this->makeMarketplaceListing($seller, 100);

        $service = app(CaringRegionalPointService::class);
        $service->updateConfig(self::TENANT_ID, [
            'enabled' => true,
            'marketplace_redemption_enabled' => false,
        ]);
        $service->issue($member, 500, 'Seed member', $admin);
        $service->updateMarketplaceSellerSettings($seller, true, 10, 25);

        $disabledQuote = $service->calculateMarketplaceDiscount($member, $seller, $listing, 100);
        $this->assertFalse($disabledQuote['accepts']);
        $this->assertSame('feature_disabled', $disabledQuote['reason']);

        $service->updateConfig(self::TENANT_ID, [
            'enabled' => true,
            'marketplace_redemption_enabled' => true,
        ]);
        $service->updateMarketplaceSellerSettings($seller, false, 10, 25);

        // F-225: with the tenant toggle on, the quote still refuses because no
        // checkout applies a regional-point discount yet.
        $unavailableQuote = $service->calculateMarketplaceDiscount($member, $seller, $listing, 100);
        $this->assertFalse($unavailableQuote['accepts']);
        $this->assertSame('feature_unavailable', $unavailableQuote['reason']);
    }

    /**
     * F-225: previously asserted that the quote capped a discount by balance
     * and seller policy, computed from a client-supplied order total. The
     * redemption path is switched off until a checkout integration derives the
     * total server-side (CaringRegionalPointService::MARKETPLACE_REDEMPTION_AVAILABLE),
     * so an opted-in seller now gets no usable points at all.
     */
    public function test_marketplace_quote_offers_nothing_while_redemption_is_unavailable(): void
    {
        $member = $this->makeUser('rp-market-cap-member-' . uniqid() . '@example.test');
        $seller = $this->makeUser('rp-market-cap-seller-' . uniqid() . '@example.test');
        $admin = $this->makeUser('rp-market-cap-admin-' . uniqid() . '@example.test');
        $listing = $this->makeMarketplaceListing($seller, 100);

        $service = app(CaringRegionalPointService::class);
        $service->updateConfig(self::TENANT_ID, [
            'enabled' => true,
            'marketplace_redemption_enabled' => true,
        ]);
        $service->issue($member, 80, 'Seed member', $admin);
        $service->updateMarketplaceSellerSettings($seller, true, 10, 25);

        $quote = $service->calculateMarketplaceDiscount($member, $seller, $listing, 100);

        $this->assertFalse($quote['accepts']);
        $this->assertSame('feature_unavailable', $quote['reason']);
        $this->assertEqualsWithDelta(0.0, $quote['max_points_usable'], 0.001);
        $this->assertEqualsWithDelta(0.0, $quote['max_discount_chf'], 0.001);
    }

    /**
     * F-225: previously asserted a successful 200-point redemption. It must now
     * refuse before any write, so the member keeps every point.
     */
    public function test_marketplace_redemption_is_refused_and_debits_nothing(): void
    {
        $member = $this->makeUser('rp-market-redeem-member-' . uniqid() . '@example.test');
        $seller = $this->makeUser('rp-market-redeem-seller-' . uniqid() . '@example.test');
        $admin = $this->makeUser('rp-market-redeem-admin-' . uniqid() . '@example.test');
        $listing = $this->makeMarketplaceListing($seller, 100);
        DB::table('users')->where('id', $member)->update(['balance' => 12]);

        $service = app(CaringRegionalPointService::class);
        $service->updateConfig(self::TENANT_ID, [
            'enabled' => true,
            'marketplace_redemption_enabled' => true,
        ]);
        $service->issue($member, 300, 'Seed member', $admin);
        $service->updateMarketplaceSellerSettings($seller, true, 10, 25);

        $refusal = null;
        try {
            $service->redeemForMarketplaceDiscount($member, $seller, $listing, 200, 100);
        } catch (\RuntimeException $e) {
            $refusal = $e->getMessage();
        }

        $this->assertSame('Regional point marketplace redemptions are not available for this community.', $refusal);
        $this->assertEqualsWithDelta(300.0, $service->memberSummary($member)['account']['balance'], 0.001);
        $this->assertEqualsWithDelta(12.0, (float) DB::table('users')->where('id', $member)->value('balance'), 0.001);
        $this->assertDatabaseMissing('caring_regional_point_transactions', [
            'tenant_id' => self::TENANT_ID,
            'user_id' => $member,
            'type' => 'redemption',
        ]);
    }

    /**
     * F-225: the own-listing guard sits behind the unavailability refusal, so
     * an own-listing attempt is now refused with the unavailability message.
     */
    public function test_marketplace_redemption_at_own_listing_is_refused(): void
    {
        $member = $this->makeUser('rp-market-own-member-' . uniqid() . '@example.test');
        $listing = $this->makeMarketplaceListing($member, 100);
        $service = app(CaringRegionalPointService::class);
        $service->updateConfig(self::TENANT_ID, [
            'enabled' => true,
            'marketplace_redemption_enabled' => true,
        ]);
        $service->updateMarketplaceSellerSettings($member, true, 10, 25);

        $this->expectExceptionMessage('Regional point marketplace redemptions are not available for this community.');
        $service->redeemForMarketplaceDiscount($member, $member, $listing, 10, 100);
    }
}
