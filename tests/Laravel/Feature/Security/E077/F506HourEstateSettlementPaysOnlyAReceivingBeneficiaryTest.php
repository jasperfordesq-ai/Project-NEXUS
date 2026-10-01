<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E077;

use App\Core\TenantContext;
use App\Services\CaringCommunity\HourEstateService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * E-077 reviewer B, candidate B2 — sibling of F-476 (and F-475), commit 9d6236d40.
 *
 * F-476 fixed group-exchange settlement: (a) it paid suspended members, and (b)
 * the provider credit's affected-row count was DISCARDED, so a participant
 * moved to another community matched nothing and credits were destroyed while
 * the ledger recorded a transfer.
 *
 * HourEstateService::settle() (POST /v2/admin/caring-community/hour-estates/{id}/settle)
 * has both shapes: the beneficiary's status is never read, and the beneficiary
 * increment's return value is discarded while the member's whole balance is
 * debited and a transactions row naming the beneficiary is written.
 *
 * Asserts the CORRECT behaviour, so red reproduces the defect.
 */
final class F506HourEstateSettlementPaysOnlyAReceivingBeneficiaryTest extends TestCase
{
    use DatabaseTransactions;

    private HourEstateService $estates;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        $this->estates = app(HourEstateService::class);
        // No skip guard: the table exists in the schema, and a skipped security
        // test proves nothing (the pre-commit schema-skip budget enforces this).
        $this->assertTrue($this->estates->isAvailable(), 'fixture: caring_hour_estates exists');
    }

    public function test_settlement_does_not_pay_a_suspended_beneficiary(): void
    {
        $member = $this->makeUser('active', 5.0);
        $beneficiary = $this->makeUser('active', 0.0);
        $estateId = $this->makeReportedEstate($member, $beneficiary);

        DB::table('users')->where('id', $beneficiary)->update(['status' => 'suspended']);

        $threw = false;
        try {
            $this->estates->settle($this->testTenantId, $estateId, $this->makeUser('active', 0.0, 'admin'), null);
        } catch (\RuntimeException $e) {
            $threw = true;
        }

        $this->assertSame(0.0, $this->balanceOf($beneficiary), 'F-506: estate hours were paid into a suspended beneficiary');
        $this->assertTrue($threw, 'F-506: the settlement is refused');
        $this->assertSame(5.0, $this->balanceOf($member), 'F-506: nothing is taken from the estate');
        $this->assertSame('reported', DB::table('caring_hour_estates')->where('id', $estateId)->value('status'));
    }

    public function test_settlement_conserves_credits_when_beneficiary_left_the_community(): void
    {
        $otherTenant = (int) DB::table('tenants')->where('id', '!=', $this->testTenantId)->orderBy('id')->value('id');
        $this->assertGreaterThan(0, $otherTenant, 'precondition: a second tenant exists');

        $member = $this->makeUser('active', 5.0);
        $beneficiary = $this->makeUser('active', 0.0);
        $estateId = $this->makeReportedEstate($member, $beneficiary);

        // The beneficiary is moved to another community (AdminSuperController::userMoveTenant shape).
        DB::table('users')->where('id', $beneficiary)->update(['tenant_id' => $otherTenant]);

        $threw = false;
        try {
            $this->estates->settle($this->testTenantId, $estateId, $this->makeUser('active', 0.0, 'admin'), null);
        } catch (\Throwable $e) {
            $threw = true;
        }

        $memberAfter = $this->balanceOf($member);
        $beneficiaryAfter = $this->balanceOf($beneficiary);
        $ledger = DB::table('transactions')
            ->where('tenant_id', $this->testTenantId)
            ->where('sender_id', $member)
            ->where('transaction_type', 'caring_hour_estate')
            ->first(['receiver_id', 'amount']);

        $this->assertSame(
            5.0,
            round($memberAfter + $beneficiaryAfter, 2),
            'F-506: credits destroyed — member=' . $memberAfter . ' beneficiary=' . $beneficiaryAfter
                . ' threw=' . ($threw ? 'yes' : 'no') . ' ledger=' . json_encode($ledger)
                . ' estate_status=' . DB::table('caring_hour_estates')->where('id', $estateId)->value('status'),
        );
        $this->assertTrue($threw, 'F-506: a beneficiary outside the community is refused, not silently skipped');
        $this->assertSame(5.0, $memberAfter, 'F-506: the estate keeps its hours');
        $this->assertNull($ledger, 'F-506: no ledger row claims a transfer that did not happen');
        $this->assertSame('reported', DB::table('caring_hour_estates')->where('id', $estateId)->value('status'));
    }

    public function test_control_active_beneficiary_in_community_is_paid(): void
    {
        $member = $this->makeUser('active', 5.0);
        $beneficiary = $this->makeUser('active', 0.0);
        $estateId = $this->makeReportedEstate($member, $beneficiary);

        $this->estates->settle($this->testTenantId, $estateId, $this->makeUser('active', 0.0, 'admin'), null);

        $this->assertSame(0.0, $this->balanceOf($member));
        $this->assertSame(5.0, $this->balanceOf($beneficiary), 'control: legitimate estate transfer lands');
    }

    private function makeReportedEstate(int $member, int $beneficiary): int
    {
        return (int) DB::table('caring_hour_estates')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'member_user_id' => $member,
            'beneficiary_user_id' => $beneficiary,
            'policy_action' => 'transfer_to_beneficiary',
            'status' => 'reported',
            'reported_balance_hours' => 5.0,
            'nominated_at' => now()->subMonth(),
            'reported_deceased_at' => now()->subDay(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function balanceOf(int $userId): float
    {
        return round((float) DB::table('users')->where('id', $userId)->value('balance'), 2);
    }

    private function makeUser(string $status, float $balance, string $role = 'member'): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'B2 fixture',
            'email' => 'b2-' . bin2hex(random_bytes(10)) . '@example.test',
            'password_hash' => password_hash(bin2hex(random_bytes(16)), PASSWORD_BCRYPT),
            'balance' => $balance,
            'role' => $role,
            'status' => $status,
            'is_active' => $status === 'active',
            'is_approved' => true,
            'onboarding_completed' => true,
            'preferred_language' => 'en',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
