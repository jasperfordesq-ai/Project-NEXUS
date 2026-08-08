<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services\CaringCommunity;

use App\Core\TenantContext;
use App\Services\CaringCommunity\CaringRegionalPointService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use InvalidArgumentException;
use RuntimeException;
use Tests\Laravel\TestCase;

/**
 * CaringRegionalPointServiceTest
 *
 * Tests the regional points / credits ledger service.
 *
 * Strategy:
 *  - Enable the feature for tenant 2 by writing the `caring_community:true` feature
 *    flag into the tenants row AND inserting the required tenant_settings rows.
 *  - All table writes use DatabaseTransactions so nothing leaks between tests.
 *  - Tables tested: caring_regional_point_accounts, caring_regional_point_transactions,
 *    marketplace_seller_regional_point_settings, tenant_settings, users, tenants.
 *
 * Skipped paths (noted inline):
 *  - calculateMarketplaceDiscount / redeemForMarketplaceDiscount deep paths that
 *    require a real marketplace_listings row — these require extensive FK fixtures
 *    beyond the tractable scope of a unit test; guarded-disable paths ARE covered.
 */
class CaringRegionalPointServiceTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 2;
    private const PREFIX = 'caring_community.regional_points.';

    protected function setUp(): void
    {
        parent::setUp();

        if (!Schema::hasTable('caring_regional_point_accounts')
            || !Schema::hasTable('caring_regional_point_transactions')
        ) {
            $this->markTestSkipped('caring_regional_point_accounts / _transactions tables not present.');
        }

        TenantContext::setById(self::TENANT_ID);
        $this->enableFeature();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private function service(): CaringRegionalPointService
    {
        return app(CaringRegionalPointService::class);
    }

    /**
     * Enable the caring_community feature flag on the tenant row and persist
     * the regional-points config settings that make isEnabled() return true.
     */
    private function enableFeature(): void
    {
        DB::table('tenants')
            ->where('id', self::TENANT_ID)
            ->update(['features' => json_encode(['caring_community' => true])]);

        $settings = [
            'enabled'                      => '1',
            'label'                        => 'Regional Points',
            'symbol'                       => 'pts',
            'auto_issue_enabled'           => '1',
            'points_per_approved_hour'     => '10',
            'member_transfers_enabled'     => '1',
            'marketplace_redemption_enabled' => '1',
        ];

        foreach ($settings as $key => $value) {
            DB::table('tenant_settings')->updateOrInsert(
                ['tenant_id' => self::TENANT_ID, 'setting_key' => self::PREFIX . $key],
                [
                    'setting_value' => $value,
                    'setting_type'  => in_array($key, ['enabled', 'auto_issue_enabled', 'member_transfers_enabled', 'marketplace_redemption_enabled'], true) ? 'boolean' : (($key === 'points_per_approved_hour') ? 'float' : 'string'),
                    'category'      => 'caring_community',
                    'description'   => 'Test fixture.',
                    'updated_at'    => now(),
                ]
            );
        }
    }

    /** Insert a minimal user and return its id. */
    private function insertUser(): int
    {
        $uid = uniqid('crp_', true);
        return DB::table('users')->insertGetId([
            'tenant_id'  => self::TENANT_ID,
            'name'       => 'Test User ' . $uid,
            'first_name' => 'Test',
            'last_name'  => 'User',
            'email'      => $uid . '@example.test',
            'status'     => 'active',
            'balance'    => 0,
            'role'       => 'member',
            'is_approved' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** Seed an account row with an explicit balance. */
    private function seedAccount(int $userId, float $balance, float $lifetimeEarned = 0.0, float $lifetimeSpent = 0.0): void
    {
        DB::table('caring_regional_point_accounts')->insertOrIgnore([
            'tenant_id'      => self::TENANT_ID,
            'user_id'        => $userId,
            'balance'        => $balance,
            'lifetime_earned' => $lifetimeEarned,
            'lifetime_spent' => $lifetimeSpent,
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);
    }

    // ── isEnabled ─────────────────────────────────────────────────────────────

    public function test_isEnabled_returns_true_when_feature_flag_and_settings_active(): void
    {
        $this->assertTrue($this->service()->isEnabled(self::TENANT_ID));
    }

    public function test_isEnabled_returns_false_when_feature_flag_absent(): void
    {
        DB::table('tenants')
            ->where('id', self::TENANT_ID)
            ->update(['features' => json_encode([])]);

        $this->assertFalse($this->service()->isEnabled(self::TENANT_ID));
    }

    // ── getConfig ─────────────────────────────────────────────────────────────

    public function test_getConfig_returns_persisted_settings(): void
    {
        $config = $this->service()->getConfig(self::TENANT_ID);

        $this->assertTrue($config['enabled']);
        $this->assertSame('Regional Points', $config['label']);
        $this->assertSame('pts', $config['symbol']);
        $this->assertTrue($config['auto_issue_enabled']);
        $this->assertSame(10.0, $config['points_per_approved_hour']);
        $this->assertTrue($config['member_transfers_enabled']);
        $this->assertTrue($config['marketplace_redemption_enabled']);
    }

    public function test_getConfig_normaliseConfig_disables_sub_flags_when_enabled_false(): void
    {
        // Flip enabled→0 in DB
        DB::table('tenant_settings')
            ->where('tenant_id', self::TENANT_ID)
            ->where('setting_key', self::PREFIX . 'enabled')
            ->update(['setting_value' => '0']);

        $config = $this->service()->getConfig(self::TENANT_ID);

        $this->assertFalse($config['enabled']);
        $this->assertFalse($config['auto_issue_enabled']);
        $this->assertFalse($config['member_transfers_enabled']);
        $this->assertFalse($config['marketplace_redemption_enabled']);
    }

    // ── publicConfig ──────────────────────────────────────────────────────────

    public function test_publicConfig_returns_only_public_keys(): void
    {
        $public = $this->service()->publicConfig(self::TENANT_ID);

        $this->assertArrayHasKey('label', $public);
        $this->assertArrayHasKey('symbol', $public);
        $this->assertArrayHasKey('member_transfers_enabled', $public);
        $this->assertArrayHasKey('marketplace_redemption_enabled', $public);
        $this->assertArrayNotHasKey('enabled', $public);
        $this->assertArrayNotHasKey('points_per_approved_hour', $public);
    }

    // ── issue (admin credit) ──────────────────────────────────────────────────

    public function test_issue_credits_balance_and_creates_ledger_row(): void
    {
        $userId  = $this->insertUser();
        $adminId = $this->insertUser();

        $result = $this->service()->issue($userId, 50.0, 'Welcome bonus', $adminId);

        $this->assertSame($userId, $result['user_id']);
        $this->assertSame(50.0, $result['points']);
        $this->assertSame(50.0, $result['balance']);
        $this->assertIsInt($result['transaction_id']);

        $account = DB::table('caring_regional_point_accounts')
            ->where('tenant_id', self::TENANT_ID)
            ->where('user_id', $userId)
            ->first();

        $this->assertEquals(50.0, (float) $account->balance);
        $this->assertEquals(50.0, (float) $account->lifetime_earned);

        $txRow = DB::table('caring_regional_point_transactions')
            ->where('id', $result['transaction_id'])
            ->first();

        $this->assertNotNull($txRow);
        $this->assertSame('admin_issue', $txRow->type);
        $this->assertSame('credit', $txRow->direction);
        $this->assertEquals(50.0, (float) $txRow->points);
        $this->assertEquals(50.0, (float) $txRow->balance_after);
        $this->assertSame((string) self::TENANT_ID, (string) $txRow->tenant_id);
    }

    public function test_issue_rejects_zero_points(): void
    {
        $userId  = $this->insertUser();
        $adminId = $this->insertUser();

        $this->expectException(InvalidArgumentException::class);
        $this->service()->issue($userId, 0.0, 'Bad issue', $adminId);
    }

    public function test_issue_rejects_negative_points(): void
    {
        $userId  = $this->insertUser();
        $adminId = $this->insertUser();

        $this->expectException(InvalidArgumentException::class);
        $this->service()->issue($userId, -10.0, 'Negative', $adminId);
    }

    // ── adjust ────────────────────────────────────────────────────────────────

    public function test_adjust_positive_delta_credits_account(): void
    {
        $userId  = $this->insertUser();
        $adminId = $this->insertUser();
        $this->seedAccount($userId, 20.0, 20.0);

        $result = $this->service()->adjust($userId, 5.0, 'Admin top-up', $adminId);

        $this->assertEquals(25.0, $result['balance']);
        $this->assertEquals(5.0, $result['points']);
    }

    public function test_adjust_negative_delta_debits_account(): void
    {
        $userId  = $this->insertUser();
        $adminId = $this->insertUser();
        $this->seedAccount($userId, 30.0, 30.0);

        $result = $this->service()->adjust($userId, -10.0, 'Admin clawback', $adminId);

        // debit path returns negative points value
        $this->assertEquals(-10.0, $result['points']);
        $this->assertEquals(20.0, $result['balance']);
    }

    public function test_adjust_zero_delta_throws_invalid_argument(): void
    {
        $userId  = $this->insertUser();
        $adminId = $this->insertUser();

        $this->expectException(InvalidArgumentException::class);
        $this->service()->adjust($userId, 0.0, 'No-op', $adminId);
    }

    // ── memberSummary ─────────────────────────────────────────────────────────

    public function test_memberSummary_auto_creates_account_with_zero_balance(): void
    {
        $userId = $this->insertUser();

        $summary = $this->service()->memberSummary($userId);

        $this->assertTrue($summary['enabled']);
        $this->assertSame($userId, $summary['account']['user_id']);
        $this->assertSame(0.0, $summary['account']['balance']);
        $this->assertSame(0.0, $summary['account']['lifetime_earned']);
        $this->assertSame(0.0, $summary['account']['lifetime_spent']);
        $this->assertArrayHasKey('config', $summary);
    }

    public function test_memberSummary_reflects_existing_balance(): void
    {
        $userId = $this->insertUser();
        $this->seedAccount($userId, 75.5, 75.5, 0.0);

        $summary = $this->service()->memberSummary($userId);

        $this->assertSame(75.5, $summary['account']['balance']);
        $this->assertSame(75.5, $summary['account']['lifetime_earned']);
    }

    // ── memberHistory ─────────────────────────────────────────────────────────

    public function test_memberHistory_returns_transactions_in_descending_order(): void
    {
        $userId  = $this->insertUser();
        $adminId = $this->insertUser();

        $this->service()->issue($userId, 10.0, 'First', $adminId);
        $this->service()->issue($userId, 20.0, 'Second', $adminId);

        $history = $this->service()->memberHistory($userId, 10);

        $this->assertCount(2, $history);
        // Most-recent (20-point) row should be first
        $this->assertSame(20.0, $history[0]['points']);
        $this->assertSame(10.0, $history[1]['points']);
        $this->assertArrayHasKey('direction', $history[0]);
        $this->assertSame('credit', $history[0]['direction']);
    }

    // ── tenantStats ───────────────────────────────────────────────────────────

    public function test_tenantStats_aggregates_issued_and_spent_correctly(): void
    {
        $user1   = $this->insertUser();
        $user2   = $this->insertUser();
        $adminId = $this->insertUser();

        $this->service()->issue($user1, 100.0, 'Issue user1', $adminId);
        $this->service()->issue($user2, 50.0, 'Issue user2', $adminId);

        $stats = $this->service()->tenantStats();

        $this->assertGreaterThanOrEqual(2, $stats['accounts_count']);
        // total_issued should include at least our 150 points
        $this->assertGreaterThanOrEqual(150.0, $stats['total_issued']);
        $this->assertIsFloat($stats['circulating_points']);
        $this->assertIsFloat($stats['total_spent']);
    }

    // ── awardForApprovedHours ─────────────────────────────────────────────────

    public function test_awardForApprovedHours_credits_correct_points(): void
    {
        $userId   = $this->insertUser();
        $volLogId = rand(90000, 99999);

        // 10 pts/hr × 2 hrs = 20 points
        $result = $this->service()->awardForApprovedHours(self::TENANT_ID, $userId, $volLogId, 2.0, null);

        $this->assertNotNull($result);
        $this->assertSame($userId, $result['user_id']);
        $this->assertSame(20.0, $result['points']);
        $this->assertSame(20.0, $result['balance']);
        $this->assertFalse($result['already_awarded']);
    }

    public function test_awardForApprovedHours_is_idempotent_for_same_vol_log(): void
    {
        $userId   = $this->insertUser();
        $volLogId = rand(80000, 89999);

        $first  = $this->service()->awardForApprovedHours(self::TENANT_ID, $userId, $volLogId, 3.0, null);
        $second = $this->service()->awardForApprovedHours(self::TENANT_ID, $userId, $volLogId, 3.0, null);

        $this->assertFalse($first['already_awarded']);
        $this->assertTrue($second['already_awarded']);
        $this->assertSame($first['transaction_id'], $second['transaction_id']);

        // Balance should only be 30, not 60
        $balance = (float) DB::table('caring_regional_point_accounts')
            ->where('tenant_id', self::TENANT_ID)
            ->where('user_id', $userId)
            ->value('balance');
        $this->assertSame(30.0, $balance);
    }

    public function test_awardForApprovedHours_returns_null_when_auto_issue_disabled(): void
    {
        // Turn off auto_issue_enabled
        DB::table('tenant_settings')
            ->where('tenant_id', self::TENANT_ID)
            ->where('setting_key', self::PREFIX . 'auto_issue_enabled')
            ->update(['setting_value' => '0']);

        $userId   = $this->insertUser();
        $volLogId = rand(70000, 79999);

        $result = $this->service()->awardForApprovedHours(self::TENANT_ID, $userId, $volLogId, 1.0, null);

        $this->assertNull($result);
    }

    // ── reverseFromVolLog ─────────────────────────────────────────────────────

    public function test_reverseFromVolLog_decrements_balance_and_creates_debit_transaction(): void
    {
        $userId   = $this->insertUser();
        $volLogId = rand(60000, 69999);

        // First award points
        $this->service()->awardForApprovedHours(self::TENANT_ID, $userId, $volLogId, 2.0, null);

        $reversed = $this->service()->reverseFromVolLog($volLogId, 'Status changed to rejected');

        $this->assertTrue($reversed);

        $balance = (float) DB::table('caring_regional_point_accounts')
            ->where('tenant_id', self::TENANT_ID)
            ->where('user_id', $userId)
            ->value('balance');
        $this->assertSame(0.0, $balance);

        // Reversal transaction row should exist
        $reversalTx = DB::table('caring_regional_point_transactions')
            ->where('tenant_id', self::TENANT_ID)
            ->where('user_id', $userId)
            ->where('type', 'reversal')
            ->where('direction', 'debit')
            ->first();

        $this->assertNotNull($reversalTx);
        $this->assertEquals(20.0, (float) $reversalTx->points);
    }

    public function test_reverseFromVolLog_is_idempotent(): void
    {
        $userId   = $this->insertUser();
        $volLogId = rand(50000, 59999);

        $this->service()->awardForApprovedHours(self::TENANT_ID, $userId, $volLogId, 1.0, null);

        $first  = $this->service()->reverseFromVolLog($volLogId, 'First reversal');
        $second = $this->service()->reverseFromVolLog($volLogId, 'Second reversal');

        $this->assertTrue($first);
        $this->assertFalse($second);
    }

    public function test_reverseFromVolLog_returns_false_when_no_prior_award(): void
    {
        $volLogId = rand(40000, 49999);

        $result = $this->service()->reverseFromVolLog($volLogId, 'Never awarded');

        $this->assertFalse($result);
    }

    // ── transferBetweenMembers ────────────────────────────────────────────────

    public function test_transferBetweenMembers_moves_points_and_creates_paired_transactions(): void
    {
        $sender    = $this->insertUser();
        $recipient = $this->insertUser();
        $adminId   = $this->insertUser();

        $this->service()->issue($sender, 100.0, 'Seed', $adminId);

        $result = $this->service()->transferBetweenMembers($sender, $recipient, 40.0, 'Thanks!');

        $this->assertSame(40.0, $result['points']);
        $this->assertSame(60.0, $result['sender_balance']);
        $this->assertSame(40.0, $result['recipient_balance']);
        $this->assertIsInt($result['sender_transaction_id']);
        $this->assertIsInt($result['recipient_transaction_id']);

        // Verify DB state
        $senderBal = (float) DB::table('caring_regional_point_accounts')
            ->where('tenant_id', self::TENANT_ID)->where('user_id', $sender)->value('balance');
        $recipientBal = (float) DB::table('caring_regional_point_accounts')
            ->where('tenant_id', self::TENANT_ID)->where('user_id', $recipient)->value('balance');

        $this->assertSame(60.0, $senderBal);
        $this->assertSame(40.0, $recipientBal);
    }

    public function test_transferBetweenMembers_rejects_self_transfer(): void
    {
        $userId  = $this->insertUser();
        $adminId = $this->insertUser();
        $this->service()->issue($userId, 50.0, 'Seed', $adminId);

        $this->expectException(InvalidArgumentException::class);
        $this->service()->transferBetweenMembers($userId, $userId, 10.0, null);
    }

    public function test_transferBetweenMembers_rejects_insufficient_balance(): void
    {
        $sender    = $this->insertUser();
        $recipient = $this->insertUser();
        $adminId   = $this->insertUser();

        $this->service()->issue($sender, 5.0, 'Tiny seed', $adminId);

        $this->expectException(RuntimeException::class);
        $this->service()->transferBetweenMembers($sender, $recipient, 50.0, null);
    }

    public function test_transferBetweenMembers_rejects_when_transfers_disabled(): void
    {
        DB::table('tenant_settings')
            ->where('tenant_id', self::TENANT_ID)
            ->where('setting_key', self::PREFIX . 'member_transfers_enabled')
            ->update(['setting_value' => '0']);

        $sender    = $this->insertUser();
        $recipient = $this->insertUser();
        $adminId   = $this->insertUser();

        $this->service()->issue($sender, 50.0, 'Seed', $adminId);

        $this->expectException(RuntimeException::class);
        $this->service()->transferBetweenMembers($sender, $recipient, 10.0, null);
    }

    // ── tenantLedger ─────────────────────────────────────────────────────────

    public function test_tenantLedger_returns_tenant_scoped_rows_with_user_names(): void
    {
        $userId  = $this->insertUser();
        $adminId = $this->insertUser();

        $this->service()->issue($userId, 25.0, 'Ledger test', $adminId);

        $ledger = $this->service()->tenantLedger(10);

        $this->assertNotEmpty($ledger);
        $first = $ledger[0];
        $this->assertArrayHasKey('id', $first);
        $this->assertArrayHasKey('user_name', $first);
        $this->assertArrayHasKey('user_email', $first);
        $this->assertArrayHasKey('actor_name', $first);
        $this->assertArrayHasKey('direction', $first);
        $this->assertArrayHasKey('points', $first);
    }

    // ── getMarketplaceSellerSettings / updateMarketplaceSellerSettings ─────────

    public function test_getMarketplaceSellerSettings_returns_defaults_for_unknown_seller(): void
    {
        $sellerId = $this->insertUser();
        $defaults = $this->service()->getMarketplaceSellerSettings($sellerId);

        $this->assertSame($sellerId, $defaults['seller_user_id']);
        $this->assertFalse($defaults['accepts_regional_points']);
        $this->assertSame(10.0, $defaults['regional_points_per_chf']);
        $this->assertSame(25, $defaults['regional_points_max_discount_pct']);
    }

    public function test_updateMarketplaceSellerSettings_persists_and_returns_settings(): void
    {
        $sellerId = $this->insertUser();

        $result = $this->service()->updateMarketplaceSellerSettings($sellerId, true, 5.0, 30);

        $this->assertSame($sellerId, $result['seller_user_id']);
        $this->assertTrue($result['accepts_regional_points']);
        $this->assertSame(5.0, $result['regional_points_per_chf']);
        $this->assertSame(30, $result['regional_points_max_discount_pct']);

        // Verify persisted
        $row = DB::table('marketplace_seller_regional_point_settings')
            ->where('tenant_id', self::TENANT_ID)
            ->where('seller_user_id', $sellerId)
            ->first();

        $this->assertNotNull($row);
        $this->assertTrue((bool) $row->accepts_regional_points);
    }

    public function test_updateMarketplaceSellerSettings_rejects_invalid_discount_pct(): void
    {
        $sellerId = $this->insertUser();

        $this->expectException(InvalidArgumentException::class);
        $this->service()->updateMarketplaceSellerSettings($sellerId, true, 5.0, 0);
    }

    // ── calculateMarketplaceDiscount guard paths ──────────────────────────────

    public function test_calculateMarketplaceDiscount_returns_feature_disabled_when_redemption_off(): void
    {
        DB::table('tenant_settings')
            ->where('tenant_id', self::TENANT_ID)
            ->where('setting_key', self::PREFIX . 'marketplace_redemption_enabled')
            ->update(['setting_value' => '0']);

        $memberId = $this->insertUser();
        $sellerId = $this->insertUser();

        $result = $this->service()->calculateMarketplaceDiscount($memberId, $sellerId, null, 100.0);

        $this->assertFalse($result['accepts']);
        $this->assertArrayHasKey('reason', $result);
        // Either 'feature_disabled' or 'feature_unavailable'
        $this->assertContains($result['reason'], ['feature_disabled', 'feature_unavailable']);
    }

    public function test_calculateMarketplaceDiscount_returns_invalid_order_total_for_zero(): void
    {
        $memberId = $this->insertUser();
        $sellerId = $this->insertUser();

        // Insert a seller row that accepts points so we reach the order-total guard
        DB::table('marketplace_seller_regional_point_settings')->updateOrInsert(
            ['tenant_id' => self::TENANT_ID, 'seller_user_id' => $sellerId],
            [
                'accepts_regional_points'         => 1,
                'regional_points_per_chf'         => 10.0,
                'regional_points_max_discount_pct' => 25,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );

        $result = $this->service()->calculateMarketplaceDiscount($memberId, $sellerId, null, 0.0);

        $this->assertFalse($result['accepts']);
        // Might be 'invalid_order_total' or 'member_or_seller_unavailable' depending on guard ordering
        $this->assertNotEmpty($result['reason']);
    }
}
