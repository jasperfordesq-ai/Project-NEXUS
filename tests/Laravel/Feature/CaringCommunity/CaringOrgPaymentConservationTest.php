<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\CaringCommunity;

use App\Models\User;
use App\Services\CaringCommunityWorkflowService;
use App\Services\CaringSupportRelationshipService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use ReflectionMethod;
use Tests\Laravel\TestCase;

/**
 * Regression: paying a carer/volunteer from a vol_organization wallet for logged
 * hours must CONSERVE credits — the org must be debited the SAME whole-hour amount
 * the worker is credited.
 *
 * Both caring "apply organization payment" helpers debited the org by the raw,
 * possibly-fractional $hours but credited the worker floor($hours), so a 2.5h log
 * took 2.5 from the org and gave 2 to the worker — destroying 0.5 — and a sub-one-
 * hour log debited a fraction while crediting nothing. The canonical
 * VolunteerService::verifyHours deliberately debits floor($hours) ("keep
 * fractional remainders in the org wallet"). Both helpers now do the same.
 *
 * The payment helper is private and only reachable via a heavy, permission-gated
 * logHours fixture chain, so this drives it directly via reflection (it is pure
 * raw-SQL with an explicit tenant_id — no model scopes / console drift involved).
 */
class CaringOrgPaymentConservationTest extends TestCase
{
    use DatabaseTransactions;

    /** @return array<int, class-string> */
    private function services(): array
    {
        return [CaringSupportRelationshipService::class, CaringCommunityWorkflowService::class];
    }

    private function makeUser(float $balance): int
    {
        $tid = $this->testTenantId;
        $u = User::factory()->forTenant($tid)->create();
        DB::table('users')->where('id', $u->id)->update(['tenant_id' => $tid, 'balance' => $balance]);

        return (int) $u->id;
    }

    private function makeOrg(int $ownerId, float $balance): int
    {
        return (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id'  => $this->testTenantId,
            'user_id'    => $ownerId,
            'name'       => 'Conservation test org',
            // F-478: vol_organizations.status defaults to 'pending', and a
            // non-approved organisation may not mint. This fixture is about
            // conservation arithmetic, so it needs an organisation that is
            // allowed to pay at all.
            'status'     => 'approved',
            'balance'    => $balance,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function makeVolLog(int $userId, float $hours): int
    {
        return (int) DB::table('vol_logs')->insertGetId([
            'tenant_id'   => $this->testTenantId,
            'user_id'     => $userId,
            'date_logged' => now()->toDateString(),
            'hours'       => $hours,
            'created_at'  => now(),
            'updated_at'  => now(),
        ]);
    }

    private function pay(string $class, int $orgId, int $ownerId, int $workerId, int $logId, float $hours): string
    {
        $service = app($class);
        $method  = new ReflectionMethod($class, 'applyOrganizationPayment');
        $method->setAccessible(true);

        return (string) $method->invoke($service, $this->testTenantId, $orgId, $ownerId, $workerId, $logId, $hours);
    }

    public function test_fractional_hours_payment_conserves_credits_in_both_services(): void
    {
        foreach ($this->services() as $class) {
            $owner  = $this->makeUser(0.0);
            $worker = $this->makeUser(0.0);
            $orgId  = $this->makeOrg($owner, 10.0);
            $logId  = $this->makeVolLog($worker, 2.5);

            $result = $this->pay($class, $orgId, $owner, $worker, $logId, 2.5);
            $this->assertSame('paid', $result, "$class should report the payment as paid");

            $orgBalance    = (float) DB::table('vol_organizations')->where('id', $orgId)->value('balance');
            $workerBalance = (float) DB::table('users')->where('id', $worker)->value('balance');

            // Worker is credited floor(2.5) = 2; org is debited the SAME 2 (the 0.5
            // remainder stays in the org wallet — NOT destroyed as 2.5 - 2).
            $this->assertEqualsWithDelta(2.0, $workerBalance, 0.001, "$class: worker credited floor(2.5)=2");
            $this->assertEqualsWithDelta(8.0, $orgBalance, 0.001, "$class: org debited 2 (not 2.5) — remainder retained");
            $this->assertEqualsWithDelta(10.0 - $orgBalance, $workerBalance, 0.001, "$class: org debit == worker credit (conserved)");
        }
    }

    public function test_sub_one_hour_payment_destroys_nothing_in_both_services(): void
    {
        foreach ($this->services() as $class) {
            $owner  = $this->makeUser(0.0);
            $worker = $this->makeUser(0.0);
            $orgId  = $this->makeOrg($owner, 10.0);
            $logId  = $this->makeVolLog($worker, 0.5);

            $this->pay($class, $orgId, $owner, $worker, $logId, 0.5);

            $orgBalance    = (float) DB::table('vol_organizations')->where('id', $orgId)->value('balance');
            $workerBalance = (float) DB::table('users')->where('id', $worker)->value('balance');

            // floor(0.5) = 0 whole credits → nothing moves; the old code debited 0.5
            // from the org and credited the worker nothing (0.5 destroyed).
            $this->assertEqualsWithDelta(10.0, $orgBalance, 0.001, "$class: sub-one-hour log debits nothing (no destruction)");
            $this->assertEqualsWithDelta(0.0, $workerBalance, 0.001, "$class: sub-one-hour log credits nothing");
        }
    }

    /**
     * Regression: approval ALWAYS mints time credits — never gated by the org
     * wallet balance. The org wallet is a reconciliation figure that is debited
     * unconditionally and allowed to go NEGATIVE (classic timebanking, mirroring
     * VolunteerService::applyVolunteerAutoPayment). Both caring helpers previously
     * returned 'insufficient_balance' and paid nothing, silently leaving the
     * carer's approved hours permanently unminted.
     */
    public function test_payment_mints_even_when_org_balance_insufficient_in_both_services(): void
    {
        foreach ($this->services() as $class) {
            $owner  = $this->makeUser(0.0);
            $worker = $this->makeUser(0.0);
            $orgId  = $this->makeOrg($owner, 1.0); // only 1 credit — far less than the 3 owed
            $logId  = $this->makeVolLog($worker, 3.0);

            $result = $this->pay($class, $orgId, $owner, $worker, $logId, 3.0);
            $this->assertSame('paid', $result, "$class: approval mints even when the org balance is insufficient");

            $orgBalance    = (float) DB::table('vol_organizations')->where('id', $orgId)->value('balance');
            $workerBalance = (float) DB::table('users')->where('id', $worker)->value('balance');

            $this->assertEqualsWithDelta(3.0, $workerBalance, 0.001, "$class: worker is credited the full 3 whole hours");
            $this->assertEqualsWithDelta(-2.0, $orgBalance, 0.001, "$class: org wallet is debited into a NEGATIVE balance");
            $this->assertEqualsWithDelta(1.0 - $orgBalance, $workerBalance, 0.001, "$class: org debit == worker credit (conserved)");

            // A ledger row is written recording the (negative) balance_after.
            $this->assertDatabaseHas('vol_org_transactions', [
                'tenant_id'           => $this->testTenantId,
                'vol_organization_id' => $orgId,
                'user_id'             => $worker,
                'vol_log_id'          => $logId,
                'type'                => 'volunteer_payment',
            ]);
        }
    }
}
