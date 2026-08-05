<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for AdminTimebankingController.
 *
 * Covers stats, alerts, updateAlert, adjustBalance, orgWallets,
 * userReport, userStatement.
 */
class AdminTimebankingControllerTest extends TestCase
{
    use DatabaseTransactions;

    // ================================================================
    // STATS — GET /v2/admin/timebanking/stats
    // ================================================================

    public function test_stats_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/timebanking/stats');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'data' => [
                'total_transactions',
                'total_volume',
                'avg_transaction',
                'active_alerts',
                'top_earners',
                'top_spenders',
            ],
        ]);
    }

    public function test_stats_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/timebanking/stats');

        $response->assertStatus(403);
    }

    public function test_stats_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/timebanking/stats');

        $response->assertStatus(401);
    }

    // ================================================================
    // ALERTS — GET /v2/admin/timebanking/alerts
    // ================================================================

    public function test_alerts_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/timebanking/alerts');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_alerts_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/timebanking/alerts');

        $response->assertStatus(403);
    }

    // ================================================================
    // ADJUST BALANCE — POST /v2/admin/timebanking/adjust-balance
    // ================================================================

    public function test_adjust_balance_requires_user_id(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/timebanking/adjust-balance', [
            'amount' => 5.0,
            'reason' => 'Test adjustment',
        ]);

        $response->assertStatus(400);
    }

    public function test_adjust_balance_requires_nonzero_amount(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/timebanking/adjust-balance', [
            'user_id' => 1,
            'amount' => 0,
            'reason' => 'Test adjustment',
        ]);

        $response->assertStatus(400);
    }

    public function test_adjust_balance_requires_reason(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/timebanking/adjust-balance', [
            'user_id' => 1,
            'amount' => 5.0,
        ]);

        $response->assertStatus(400);
    }

    public function test_adjust_balance_returns_404_for_nonexistent_user(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/timebanking/adjust-balance', [
            'user_id' => 99999,
            'amount' => 5.0,
            'reason' => 'Test adjustment',
        ]);

        $response->assertStatus(404);
    }

    public function test_adjust_balance_returns_200_for_valid_request(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $user = User::factory()->forTenant($this->testTenantId)->create(['balance' => 10.0]);
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/timebanking/adjust-balance', [
            'user_id' => $user->id,
            'amount' => 5.0,
            'reason' => 'Bonus credits',
        ]);

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'data' => ['user_id', 'previous_balance', 'adjustment', 'new_balance'],
        ]);
    }

    public function test_adjust_balance_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPost('/v2/admin/timebanking/adjust-balance', [
            'user_id' => 1,
            'amount' => 5.0,
            'reason' => 'Test',
        ]);

        $response->assertStatus(403);
    }

    public function test_adjust_balance_creates_transaction_record(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $user = User::factory()->forTenant($this->testTenantId)->create(['balance' => 10.0]);
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/timebanking/adjust-balance', [
            'user_id' => $user->id,
            'amount' => 5.0,
            'reason' => 'Transaction integrity test',
        ]);

        $response->assertStatus(200);

        // Verify balance was updated
        $updatedUser = \Illuminate\Support\Facades\DB::selectOne(
            'SELECT balance FROM users WHERE id = ?',
            [$user->id]
        );
        $this->assertEquals(15.0, (float) $updatedUser->balance);

        // Verify transaction record was created
        $txn = \Illuminate\Support\Facades\DB::selectOne(
            "SELECT * FROM transactions WHERE tenant_id = ? AND receiver_id = ? AND description LIKE '%Transaction integrity test%'",
            [$this->testTenantId, $user->id]
        );
        $this->assertNotNull($txn, 'Transaction record must exist after balance adjustment');
        $this->assertEquals(5.0, (float) $txn->amount);
    }

    public function test_adjust_balance_rejects_negative_result(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $user = User::factory()->forTenant($this->testTenantId)->create(['balance' => 3.0]);
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/timebanking/adjust-balance', [
            'user_id' => $user->id,
            'amount' => -10.0,
            'reason' => 'Overdraft test',
        ]);

        $response->assertStatus(400);

        // Verify balance was NOT changed (transaction rolled back)
        $updatedUser = \Illuminate\Support\Facades\DB::selectOne(
            'SELECT balance FROM users WHERE id = ?',
            [$user->id]
        );
        $this->assertEquals(3.0, (float) $updatedUser->balance);
    }

    public function test_adjust_balance_negative_amount_creates_correct_transaction(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $user = User::factory()->forTenant($this->testTenantId)->create(['balance' => 20.0]);
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/timebanking/adjust-balance', [
            'user_id' => $user->id,
            'amount' => -5.0,
            'reason' => 'Deduction test',
        ]);

        $response->assertStatus(200);
        $data = $response->json('data');
        $this->assertEquals(20.0, $data['previous_balance']);
        $this->assertEquals(15.0, $data['new_balance']);
        $this->assertEquals(-5.0, $data['adjustment']);

        // A deduction is a ONE-SIDED treasury movement: the member is the sender
        // and the other side is NULL.
        //
        // This assertion previously required `receiver_id === admin->id`, which
        // codified a real defect rather than catching it: the admin was recorded
        // as the counterparty while their own users.balance was never moved, so
        // the ledger did not reconcile for them and every adjustment inflated
        // their apparent total_earned/total_spent on the admin dashboard (both are
        // derived with SUM(amount) GROUP BY receiver_id/sender_id).
        $txn = \Illuminate\Support\Facades\DB::selectOne(
            "SELECT * FROM transactions WHERE tenant_id = ? AND sender_id = ? AND description LIKE '%Deduction test%'",
            [$this->testTenantId, $user->id]
        );
        $this->assertNotNull($txn);
        $this->assertNull($txn->receiver_id, 'An admin adjustment must not name the admin as counterparty.');
        $this->assertEquals(5.0, (float) $txn->amount);
        $this->assertSame('admin_grant', $txn->transaction_type, 'An admin adjustment must be distinguishable from a member transfer.');
    }

    public function test_adjust_balance_credit_is_one_sided_and_typed(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $user = User::factory()->forTenant($this->testTenantId)->create(['balance' => 1.0]);
        Sanctum::actingAs($admin);

        $this->apiPost('/v2/admin/timebanking/adjust-balance', [
            'user_id' => $user->id,
            'amount' => 4.0,
            'reason' => 'Credit test',
        ])->assertStatus(200);

        $txn = \Illuminate\Support\Facades\DB::selectOne(
            "SELECT * FROM transactions WHERE tenant_id = ? AND receiver_id = ? AND description LIKE '%Credit test%'",
            [$this->testTenantId, $user->id]
        );
        $this->assertNotNull($txn);
        $this->assertNull($txn->sender_id, 'A credit adjustment must not name the admin as counterparty.');
        $this->assertSame('admin_grant', $txn->transaction_type);
    }

    public function test_adjust_balance_writes_an_audit_row_with_before_and_after(): void
    {
        // For most of this endpoint's life both its docblock and its route comment
        // claimed the action was audited, and nothing was written anywhere. The
        // mandatory reason survived only as a text prefix on the transaction
        // description. This is the regression guard for that.
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $user = User::factory()->forTenant($this->testTenantId)->create(['balance' => 10.0]);
        Sanctum::actingAs($admin);

        $this->apiPost('/v2/admin/timebanking/adjust-balance', [
            'user_id' => $user->id,
            'amount' => -2.5,
            'reason' => 'Corrected a duplicated exchange',
        ])->assertStatus(200);

        $row = \Illuminate\Support\Facades\DB::selectOne(
            "SELECT * FROM org_audit_log
             WHERE tenant_id = ? AND action = 'member_balance_adjusted' AND target_user_id = ?
             ORDER BY id DESC LIMIT 1",
            [$this->testTenantId, $user->id]
        );

        $this->assertNotNull($row, 'A balance adjustment must leave an audit row.');
        $this->assertEquals($admin->id, (int) $row->user_id, 'The audit row must record the acting admin.');

        $details = json_decode((string) $row->details, true);
        $this->assertIsArray($details);
        $this->assertSame('Corrected a duplicated exchange', $details['reason']);
        $this->assertEquals(-2.5, (float) $details['adjustment']);
        $this->assertEquals(10.0, (float) $details['previous_balance']);
        $this->assertEquals(7.5, (float) $details['new_balance']);
    }

    // ================================================================
    // ORG WALLETS — GET /v2/admin/timebanking/org-wallets
    // ================================================================

    public function test_org_wallets_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/timebanking/org-wallets');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_org_wallets_reports_live_volunteer_org_data(): void
    {
        // Regression (audit M3, fix-not-delete): this dashboard previously read
        // the abandoned community-org tables (org_wallets/org_transactions) and
        // always returned empty. It now reports the live vol_organizations
        // wallet balance, the vol_org_transactions ledger, and active
        // org_type='volunteer' member counts.
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($admin);

        $db = \Illuminate\Support\Facades\DB::class;
        $orgId = (int) $db::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => 'Live Wallet Org ' . uniqid(),
            'slug' => 'live-wallet-org-' . uniqid(),
            'description' => 'Org for wallet dashboard regression coverage.',
            'status' => 'active',
            'balance' => 7.50,
            'created_at' => now(),
        ]);

        foreach ([[$owner->id, 'owner'], [$member->id, 'member']] as [$uid, $role]) {
            $db::table('org_members')->insert([
                'tenant_id' => $this->testTenantId,
                'organization_id' => $orgId,
                'org_type' => 'volunteer',
                'user_id' => $uid,
                'role' => $role,
                'status' => 'active',
                'created_at' => now(),
            ]);
        }

        // Ledger: +10 deposit (money in), -2.5 volunteer payment (money out).
        $db::table('vol_org_transactions')->insert([
            ['tenant_id' => $this->testTenantId, 'vol_organization_id' => $orgId, 'user_id' => $owner->id, 'type' => 'deposit', 'amount' => 10.0, 'balance_after' => 10.0, 'created_at' => now()],
            ['tenant_id' => $this->testTenantId, 'vol_organization_id' => $orgId, 'user_id' => $member->id, 'type' => 'volunteer_payment', 'amount' => -2.5, 'balance_after' => 7.5, 'created_at' => now()],
        ]);

        $response = $this->apiGet('/v2/admin/timebanking/org-wallets');
        $response->assertStatus(200);

        $row = collect($response->json('data'))->firstWhere('org_id', $orgId);
        $this->assertNotNull($row, 'The seeded volunteer org must appear in the wallet dashboard');
        $this->assertEquals(7.5, (float) $row['balance']);
        $this->assertEquals(10.0, (float) $row['total_in']);
        $this->assertEquals(2.5, (float) $row['total_out']);
        $this->assertEquals(2, (int) $row['member_count']);
    }

    // ================================================================
    // USER REPORT — GET /v2/admin/timebanking/user-report
    // ================================================================

    public function test_user_report_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/timebanking/user-report');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_user_report_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/timebanking/user-report');

        $response->assertStatus(403);
    }

    // ================================================================
    // USER STATEMENT — GET /v2/admin/timebanking/user-statement
    // ================================================================

    public function test_user_statement_requires_user_id(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/timebanking/user-statement');

        $response->assertStatus(400);
    }

    public function test_user_statement_returns_404_for_nonexistent_user(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/timebanking/user-statement?user_id=99999');

        $response->assertStatus(404);
    }

    public function test_user_statement_returns_200_for_valid_user(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $user = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/timebanking/user-statement?user_id=' . $user->id);

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'data' => ['user', 'period', 'summary', 'transactions'],
        ]);
    }
}
