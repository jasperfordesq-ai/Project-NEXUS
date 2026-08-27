<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Models\User;
use App\Models\VolOrganization;
use App\Services\VolOrgWalletService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

class VolOrgWalletServiceTest extends TestCase
{
    use DatabaseTransactions;

    /**
     * Re-pin the tenant context to tenant 2 (hour-timebank).
     *
     * Creating a User via the factory fires UserObserver, whose post-create
     * notification path calls TenantContext::reset(). Once reset, the next
     * TenantContext::getId() re-resolves to the Master tenant (id=1) via the
     * host/path fallback. Every VolOrgWalletService method scopes its queries
     * by TenantContext::getId(), so on CI's clean DB the tenant-2 fixtures
     * become invisible ("User/Organization not found") unless the context is
     * re-established *after* fixtures are created and *before* the service is
     * invoked. This mirrors the explicit setById(2) the cross-tenant test
     * already relies on.
     */
    private function pinTenant(int $tenantId = 2): void
    {
        TenantContext::setById($tenantId);
    }

    // -------- Smoke tests (kept) --------

    public function test_class_exists(): void
    {
        $this->assertTrue(class_exists(\App\Services\VolOrgWalletService::class));
    }

    public function test_has_public_methods(): void
    {
        $ref = new \ReflectionClass(\App\Services\VolOrgWalletService::class);
        foreach (['getBalance', 'getTransactions', 'getWalletSummary', 'depositFromUser', 'payVolunteer', 'adminAdjustment'] as $m) {
            $this->assertTrue($ref->hasMethod($m), "Missing method: {$m}");
            $this->assertTrue($ref->getMethod($m)->isPublic(), "Not public: {$m}");
        }
    }

    // -------- Helpers --------

    private function makeOrg(int $tenantId = 2, float $balance = 0, ?int $ownerId = null): int
    {
        $owner = $ownerId ?? User::factory()->forTenant($tenantId)->create(['balance' => 0])->id;
        $id = DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $owner,
            'name' => 'Org ' . uniqid(),
            'slug' => 'org-' . uniqid(),
            'status' => 'active',
            'balance' => $balance,
            'created_at' => now(),
        ]);
        return (int) $id;
    }

    // -------- Deep tests --------

    public function test_deposit_increments_balance_and_writes_audit_row(): void
    {
        $user = User::factory()->forTenant(2)->create(['balance' => 100]);
        $orgId = $this->makeOrg(2, 50.00);
        $this->pinTenant();

        $result = VolOrgWalletService::depositFromUser($user->id, $orgId, 25.0);

        $this->assertTrue($result['success'], $result['message'] ?? '');
        $this->assertEquals(75.0, $result['new_balance']);

        $this->assertEquals(75.00, (float) DB::table('vol_organizations')->where('id', $orgId)->value('balance'));
        $this->assertEquals(75, (int) DB::table('users')->where('id', $user->id)->value('balance'));

        $tx = DB::table('vol_org_transactions')->where('vol_organization_id', $orgId)->orderByDesc('id')->first();
        $this->assertNotNull($tx);
        $this->assertEquals('deposit', $tx->type);
        $this->assertEquals(25.00, (float) $tx->amount);
        $this->assertEquals(75.00, (float) $tx->balance_after);
        $this->assertEquals(2, (int) $tx->tenant_id);
    }

    public function test_deposit_writes_the_member_facing_personal_ledger_atomically(): void
    {
        $user = User::factory()->forTenant(2)->create(['balance' => 100]);
        $orgId = $this->makeOrg(2, 50.00);
        $this->pinTenant();

        $result = VolOrgWalletService::depositFromUser(
            $user->id,
            $orgId,
            25.0,
            'Deposit to the volunteer organisation',
            'personal-ledger-' . bin2hex(random_bytes(8)),
        );

        $this->assertTrue($result['success'], $result['message'] ?? '');

        $personalTransaction = DB::table('transactions')
            ->where('tenant_id', 2)
            ->where('sender_id', $user->id)
            ->whereNull('receiver_id')
            ->where('transaction_type', 'volunteer')
            ->latest('id')
            ->first();

        $this->assertNotNull(
            $personalTransaction,
            'A successful organisation deposit must appear in the member wallet history.',
        );
        $this->assertSame(25.0, (float) $personalTransaction->amount);
        $this->assertSame('completed', $personalTransaction->status);
        $this->assertSame('Deposit to the volunteer organisation', $personalTransaction->description);

        $memberHistory = app(\App\Services\WalletService::class)->getTransactions($user->id);
        $historyRow = collect($memberHistory['items'])->firstWhere('id', (int) $personalTransaction->id);
        $this->assertNotNull($historyRow, 'The personal ledger row must be returned by the wallet API service.');
        $this->assertSame('debit', $historyRow['type']);
        $this->assertSame(25.0, $historyRow['amount']);
    }

    public function test_fractional_deposit_is_rejected_whole_hours_only(): void
    {
        $user = User::factory()->forTenant(2)->create(['balance' => 10]);
        $orgId = $this->makeOrg(2, 0.00);
        $this->pinTenant();

        // Fractional deposits are rejected outright — users.balance stores whole
        // hours only. The previous silent (int) floor() quietly moved fewer hours
        // than the UI implied (e.g. 5.75 deposited 5), so a non-integer amount is
        // now an explicit validation failure that changes nothing.
        $result = VolOrgWalletService::depositFromUser($user->id, $orgId, 5.75);

        $this->assertFalse($result['success'], 'Fractional deposit must be rejected');
        $this->assertEquals(10, (int) DB::table('users')->where('id', $user->id)->value('balance'));
        $this->assertEquals(0.00, (float) DB::table('vol_organizations')->where('id', $orgId)->value('balance'));
        $this->assertEquals(0, DB::table('vol_org_transactions')->where('vol_organization_id', $orgId)->count());
    }

    public function test_deposit_rejects_zero_and_negative_amounts(): void
    {
        $user = User::factory()->forTenant(2)->create(['balance' => 100]);
        $orgId = $this->makeOrg(2, 0);
        $this->pinTenant();

        $this->assertFalse(VolOrgWalletService::depositFromUser($user->id, $orgId, 0)['success']);
        $this->assertFalse(VolOrgWalletService::depositFromUser($user->id, $orgId, -5)['success']);

        $this->assertEquals(0.00, (float) DB::table('vol_organizations')->where('id', $orgId)->value('balance'));
        $this->assertEquals(0, DB::table('vol_org_transactions')->where('vol_organization_id', $orgId)->count());
    }

    /**
     * 2026-07-10 audit M2: the suspended-org deposit freeze lived only in the
     * React controller (VolunteerController::orgWalletDeposit), so the
     * accessible frontend — which calls this service directly — let owners
     * keep depositing into a suspended org's wallet. The freeze must live in
     * the service so every caller inherits it.
     */
    public function test_deposit_rejects_non_approved_org_at_service_level(): void
    {
        $user = User::factory()->forTenant(2)->create(['balance' => 100]);
        $orgId = $this->makeOrg(2, 0);
        $this->pinTenant();
        DB::table('vol_organizations')->where('id', $orgId)->update(['status' => 'suspended']);

        $result = VolOrgWalletService::depositFromUser($user->id, $orgId, 10);

        $this->assertFalse($result['success'], 'Deposit into a suspended org must be rejected');
        $this->assertEquals(100, (int) DB::table('users')->where('id', $user->id)->value('balance'));
        $this->assertEquals(0.00, (float) DB::table('vol_organizations')->where('id', $orgId)->value('balance'));
        $this->assertEquals(0, DB::table('vol_org_transactions')->where('vol_organization_id', $orgId)->count());

        // Pending (not-yet-approved) orgs are frozen too.
        DB::table('vol_organizations')->where('id', $orgId)->update(['status' => 'pending']);
        $this->assertFalse(VolOrgWalletService::depositFromUser($user->id, $orgId, 10)['success']);
    }

    public function test_deposit_rejects_insufficient_balance(): void
    {
        $user = User::factory()->forTenant(2)->create(['balance' => 5]);
        $orgId = $this->makeOrg(2, 0);
        $this->pinTenant();

        $result = VolOrgWalletService::depositFromUser($user->id, $orgId, 50);

        $this->assertFalse($result['success']);
        // Rollback: nothing changed
        $this->assertEquals(0.00, (float) DB::table('vol_organizations')->where('id', $orgId)->value('balance'));
        $this->assertEquals(5, (int) DB::table('users')->where('id', $user->id)->value('balance'));
        $this->assertEquals(0, DB::table('vol_org_transactions')->where('vol_organization_id', $orgId)->count());
    }

    /**
     * 🔴 The row locks prevent OVER-SPEND, not duplicate INTENT.
     *
     * A double-click or a network retry of an affordable deposit used to move the
     * credits twice, and both movements looked entirely legitimate in the audit
     * trail. The personal wallet transfer and donate have carried an idempotency
     * key for months; the organisation deposit was the outlier.
     */
    public function test_duplicate_deposit_with_the_same_key_moves_credits_once(): void
    {
        $user = User::factory()->forTenant(2)->create(['balance' => 100]);
        $orgId = $this->makeOrg(2, 50.00);
        $this->pinTenant();

        $key = 'idem-' . bin2hex(random_bytes(8));
        $first = VolOrgWalletService::depositFromUser($user->id, $orgId, 25.0, null, $key);
        $second = VolOrgWalletService::depositFromUser($user->id, $orgId, 25.0, null, $key);

        $this->assertTrue($first['success'], $first['message'] ?? '');
        // The replay reports the SAME outcome — the member is not told their
        // second click failed, because their money did move exactly once.
        $this->assertTrue($second['success'], $second['message'] ?? '');
        $this->assertEquals($first['new_balance'], $second['new_balance']);

        // The credits moved once, and the audit trail records one deposit.
        $this->assertEquals(75, (int) DB::table('users')->where('id', $user->id)->value('balance'));
        $this->assertEquals(75.00, (float) DB::table('vol_organizations')->where('id', $orgId)->value('balance'));
        $this->assertEquals(
            1,
            DB::table('vol_org_transactions')->where('vol_organization_id', $orgId)->where('type', 'deposit')->count()
        );
        $this->assertSame(
            1,
            DB::table('transactions')
                ->where('tenant_id', 2)
                ->where('sender_id', $user->id)
                ->whereNull('receiver_id')
                ->where('transaction_type', 'volunteer')
                ->count(),
            'An idempotent replay must not duplicate the member-facing ledger row.',
        );
    }

    /**
     * Without any key, an accidental double-click is still caught by the 120s
     * content fingerprint — the same fallback WalletService::transfer uses.
     */
    public function test_accidental_double_submit_without_a_key_moves_credits_once(): void
    {
        $user = User::factory()->forTenant(2)->create(['balance' => 100]);
        $orgId = $this->makeOrg(2, 50.00);
        $this->pinTenant();

        VolOrgWalletService::depositFromUser($user->id, $orgId, 10.0);
        VolOrgWalletService::depositFromUser($user->id, $orgId, 10.0);

        $this->assertEquals(90, (int) DB::table('users')->where('id', $user->id)->value('balance'));
        $this->assertEquals(
            1,
            DB::table('vol_org_transactions')->where('vol_organization_id', $orgId)->where('type', 'deposit')->count()
        );
    }

    /**
     * The guard must never collapse two genuinely different deposits. A client
     * that wrongly reuses one key for a different amount still gets both — the
     * fingerprint binds the content, not just the key.
     */
    public function test_same_key_with_a_different_amount_is_a_separate_deposit(): void
    {
        $user = User::factory()->forTenant(2)->create(['balance' => 100]);
        $orgId = $this->makeOrg(2, 50.00);
        $this->pinTenant();

        $key = 'idem-' . bin2hex(random_bytes(8));
        $first = VolOrgWalletService::depositFromUser($user->id, $orgId, 5.0, null, $key);
        $second = VolOrgWalletService::depositFromUser($user->id, $orgId, 7.0, null, $key);

        $this->assertTrue($first['success'], $first['message'] ?? '');
        $this->assertTrue($second['success'], $second['message'] ?? '');
        $this->assertEquals(88, (int) DB::table('users')->where('id', $user->id)->value('balance'));
        $this->assertEquals(
            2,
            DB::table('vol_org_transactions')->where('vol_organization_id', $orgId)->where('type', 'deposit')->count()
        );
    }

    /**
     * A REFUSED deposit must not leave its claim behind: the member fixes the
     * problem and retries with the same key from the same page, and that retry
     * has to be allowed through.
     */
    public function test_a_refused_deposit_does_not_block_a_corrected_retry(): void
    {
        $user = User::factory()->forTenant(2)->create(['balance' => 5]);
        $orgId = $this->makeOrg(2, 50.00);
        $this->pinTenant();

        $key = 'idem-' . bin2hex(random_bytes(8));
        $refused = VolOrgWalletService::depositFromUser($user->id, $orgId, 25.0, null, $key);
        $this->assertFalse($refused['success']);

        // Same key, an amount they can now afford.
        $retry = VolOrgWalletService::depositFromUser($user->id, $orgId, 5.0, null, $key);
        $this->assertTrue($retry['success'], $retry['message'] ?? '');
        $this->assertEquals(0, (int) DB::table('users')->where('id', $user->id)->value('balance'));
    }

    public function test_pay_volunteer_debits_org_credits_volunteer_and_writes_audit(): void
    {
        $admin = User::factory()->forTenant(2)->create();
        $volunteer = User::factory()->forTenant(2)->create(['balance' => 10]);
        $orgId = $this->makeOrg(2, 100.0, $admin->id);
        $this->pinTenant();

        $result = VolOrgWalletService::payVolunteer($orgId, $volunteer->id, 20.0, $admin->id, 'Test pay');

        $this->assertTrue($result['success'], $result['message'] ?? '');
        $this->assertEquals(80.0, $result['new_balance']);

        $this->assertEquals(80.00, (float) DB::table('vol_organizations')->where('id', $orgId)->value('balance'));
        $this->assertEquals(30, (int) DB::table('users')->where('id', $volunteer->id)->value('balance'));

        $tx = DB::table('vol_org_transactions')->where('vol_organization_id', $orgId)->orderByDesc('id')->first();
        $this->assertEquals('volunteer_payment', $tx->type);
        $this->assertEquals(-20.00, (float) $tx->amount);
        $this->assertEquals(80.00, (float) $tx->balance_after);

        // Paired audit in main transactions table
        $this->assertTrue(
            DB::table('transactions')
                ->where('tenant_id', 2)
                ->where('receiver_id', $volunteer->id)
                ->where('amount', 20)
                ->where('transaction_type', 'volunteer')
                ->exists()
        );
    }

    public function test_payVolunteer_rejects_sub_whole_hour_amount(): void
    {
        // VOL-BE-009: 0.5 floors to 0 whole hours — must not phantom-succeed with
        // a zero-amount transaction and a "0 hours paid" email.
        $admin = User::factory()->forTenant(2)->create();
        $volunteer = User::factory()->forTenant(2)->create(['balance' => 0]);
        $orgId = $this->makeOrg(2, 10.0, $admin->id);
        $this->pinTenant();

        $result = VolOrgWalletService::payVolunteer($orgId, $volunteer->id, 0.5, $admin->id);

        $this->assertFalse($result['success']);
        $this->assertEquals(10.00, (float) DB::table('vol_organizations')->where('id', $orgId)->value('balance'));
        $this->assertEquals(0, (int) DB::table('users')->where('id', $volunteer->id)->value('balance'));
        $this->assertFalse(
            DB::table('vol_org_transactions')->where('vol_organization_id', $orgId)->exists()
        );
    }

    public function test_fractional_pay_volunteer_does_not_lose_or_overpay_hours(): void
    {
        $admin = User::factory()->forTenant(2)->create();
        $volunteer = User::factory()->forTenant(2)->create(['balance' => 0]);
        $orgId = $this->makeOrg(2, 10.0, $admin->id);
        $this->pinTenant();

        $result = VolOrgWalletService::payVolunteer($orgId, $volunteer->id, 2.75, $admin->id);

        $this->assertTrue($result['success'], $result['message'] ?? '');
        $this->assertEquals(8.0, (float) $result['new_balance']);
        $this->assertEquals(8.00, (float) DB::table('vol_organizations')->where('id', $orgId)->value('balance'));
        $this->assertEquals(2, (int) DB::table('users')->where('id', $volunteer->id)->value('balance'));

        $orgTx = DB::table('vol_org_transactions')->where('vol_organization_id', $orgId)->orderByDesc('id')->first();
        $this->assertEquals(-2.00, (float) $orgTx->amount);
        $this->assertEquals(8.00, (float) $orgTx->balance_after);

        $mainTx = DB::table('transactions')->where('receiver_id', $volunteer->id)->orderByDesc('id')->first();
        $this->assertEquals(2, (int) $mainTx->amount);
    }

    public function test_pay_volunteer_allows_negative_reconciliation_balance(): void
    {
        $admin = User::factory()->forTenant(2)->create();
        $volunteer = User::factory()->forTenant(2)->create(['balance' => 0]);
        $orgId = $this->makeOrg(2, 5.0, $admin->id);
        $this->pinTenant();

        $result = VolOrgWalletService::payVolunteer($orgId, $volunteer->id, 50.0, $admin->id);

        $this->assertTrue($result['success'], $result['message'] ?? '');
        $this->assertEquals(-45.00, (float) $result['new_balance']);
        $this->assertEquals(-45.00, (float) DB::table('vol_organizations')->where('id', $orgId)->value('balance'));
        $this->assertEquals(50, (int) DB::table('users')->where('id', $volunteer->id)->value('balance'));

        $tx = DB::table('vol_org_transactions')->where('vol_organization_id', $orgId)->orderByDesc('id')->first();
        $this->assertNotNull($tx);
        $this->assertEquals('volunteer_payment', $tx->type);
        $this->assertEquals(-50.00, (float) $tx->amount);
        $this->assertEquals(-45.00, (float) $tx->balance_after);
    }

    public function test_admin_adjustment_positive_and_negative_track_balance_after(): void
    {
        $admin = User::factory()->forTenant(2)->create();
        $orgId = $this->makeOrg(2, 100.0, $admin->id);
        $this->pinTenant();

        $up = VolOrgWalletService::adminAdjustment($orgId, 50.0, $admin->id, 'top up');
        $this->assertTrue($up['success']);
        $this->assertEquals(150.0, $up['new_balance']);

        $down = VolOrgWalletService::adminAdjustment($orgId, -30.0, $admin->id, 'correction');
        $this->assertTrue($down['success']);
        $this->assertEquals(120.0, $down['new_balance']);

        // Cannot adjust into negative
        $bad = VolOrgWalletService::adminAdjustment($orgId, -500.0, $admin->id, 'too much');
        $this->assertFalse($bad['success']);
        $this->assertEquals(120.00, (float) DB::table('vol_organizations')->where('id', $orgId)->value('balance'));

        // Zero rejected
        $this->assertFalse(VolOrgWalletService::adminAdjustment($orgId, 0, $admin->id, 'no-op')['success']);
    }

    public function test_tenant_isolation_prevents_cross_tenant_access(): void
    {
        // Org in tenant 999
        $otherOwner = User::factory()->forTenant(999)->create(['balance' => 100]);
        $otherOrgId = $this->makeOrg(999, 100.0, $otherOwner->id);

        // Current context is tenant 2
        $user2 = User::factory()->forTenant(2)->create(['balance' => 100]);
        $this->pinTenant(2);

        // getBalance returns empty for cross-tenant org
        $bal = VolOrgWalletService::getBalance($otherOrgId);
        $this->assertEquals(0, $bal['balance']);
        $this->assertEquals('', $bal['name']);

        // depositFromUser rejects cross-tenant org
        $result = VolOrgWalletService::depositFromUser($user2->id, $otherOrgId, 10);
        $this->assertFalse($result['success']);

        // Org balance in tenant 999 is unchanged
        $this->assertEquals(100.00, (float) DB::table('vol_organizations')->where('id', $otherOrgId)->value('balance'));
    }

    public function test_get_transactions_returns_paginated_items(): void
    {
        $user = User::factory()->forTenant(2)->create(['balance' => 1000]);
        $orgId = $this->makeOrg(2, 0, $user->id);
        $this->pinTenant();

        // 🔴 Distinct amounts on purpose. Three IDENTICAL keyless deposits are
        // exactly what the anti-double-submit fingerprint collapses into one, so
        // the old fixture (3 × 10 credits) now produces a single transaction and
        // was silently testing the guard rather than pagination.
        foreach ([10, 11, 12] as $amount) {
            $dep = VolOrgWalletService::depositFromUser($user->id, $orgId, $amount);
            $this->assertTrue($dep['success'], $dep['message'] ?? '');
        }

        $result = VolOrgWalletService::getTransactions($orgId, ['limit' => 20]);
        $this->assertCount(3, $result['items']);
        $this->assertFalse($result['has_more']);
        $this->assertEquals('deposit', $result['items'][0]['type']);
    }
}
