<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\CaringCommunity;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\CaringCommunityWorkflowService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

/**
 * Regression: approving an organisation-backed caring hour log ALWAYS mints time
 * credits. It is never gated by the org's `auto_pay_enabled` flag or by the org
 * wallet having enough balance — the org wallet is a reconciliation figure that
 * is debited unconditionally and allowed to go NEGATIVE, mirroring
 * VolunteerService::applyVolunteerAutoPayment.
 *
 * Previously CaringCommunityWorkflowService::decideReview() skipped payment
 * entirely when auto_pay_enabled=0, and applyOrganizationPayment() returned
 * 'insufficient_balance' when the balance was low — in both cases the log was
 * still committed 'approved', so the carer saw an approved log but was never
 * credited (the verify paths only reprocess 'pending' logs).
 */
class CaringWorkflowDecisionMintingTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        if (!Schema::hasTable('vol_logs') || !Schema::hasTable('vol_organizations')) {
            $this->markTestSkipped('Volunteering tables are not present in the test database.');
        }
        TenantContext::setById($this->testTenantId);
    }

    private function service(): CaringCommunityWorkflowService
    {
        return app(CaringCommunityWorkflowService::class);
    }

    public function test_decide_review_mints_even_when_org_auto_pay_disabled_and_balance_low(): void
    {
        $reviewer  = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $supporter = User::factory()->forTenant($this->testTenantId)->create(['balance' => 0]);
        $owner     = User::factory()->forTenant($this->testTenantId)->create();

        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id'        => $this->testTenantId,
            'user_id'          => $owner->id,
            'name'             => 'KISS Zug',
            // F-478: vol_organizations.status defaults to 'pending', and a
            // non-approved organisation may not mint. This test is about
            // auto_pay and balance NOT gating the mint, so the organisation
            // itself has to be one that is allowed to pay.
            'status'           => 'approved',
            'balance'          => 1,   // far less than the 3 owed
            'auto_pay_enabled' => 0,   // auto-pay OFF — approval must still mint
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);

        $logId = (int) DB::table('vol_logs')->insertGetId([
            'tenant_id'       => $this->testTenantId,
            'user_id'         => $supporter->id,
            'organization_id' => $orgId,
            'date_logged'     => now()->subDay()->toDateString(),
            'hours'           => 3.5,
            'description'     => 'Recurring support visit.',
            'status'          => 'pending',
            'created_at'      => now(),
            'updated_at'      => now(),
        ]);

        $result = $this->service()->decideReview($this->testTenantId, $logId, (int) $reviewer->id, 'approve');

        $this->assertIsArray($result);
        $this->assertSame('approved', $result['status']);
        $this->assertSame('paid', $result['payment_result']);

        $this->assertSame('approved', DB::table('vol_logs')->where('id', $logId)->value('status'));
        // floor(3.5) = 3 minted to the supporter; org debited the same 3 → 1 - 3 = -2.
        $this->assertSame(3, (int) DB::table('users')->where('id', $supporter->id)->value('balance'));
        $this->assertEqualsWithDelta(-2.0, (float) DB::table('vol_organizations')->where('id', $orgId)->value('balance'), 0.001);

        $this->assertDatabaseHas('vol_org_transactions', [
            'tenant_id'           => $this->testTenantId,
            'vol_organization_id' => $orgId,
            'user_id'             => $supporter->id,
            'vol_log_id'          => $logId,
            'type'                => 'volunteer_payment',
        ]);
    }
}
