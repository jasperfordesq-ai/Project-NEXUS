<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E065;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-379 — the admin hours-approval page mints time credits for a SUSPENDED
 * volunteering organisation, with no race required.
 *
 * `POST /v2/admin/volunteering/hours/{id}/verify`
 * (`AdminVolunteerController::verifyHours`) approves logged volunteering hours
 * and mints time credits. Its own comments say it "Mirrors
 * VolunteerService::verifyHours()" — and it does mirror that method's
 * self-verification guard and its idempotency gate. It does **not** mirror the
 * hard freeze:
 *
 *     // Hard-freeze: a suspended (non-approved) org cannot mint new time credits
 *
 * `grep -c isApprovedOrganizationStatus` on the controller returns 0. The
 * organisation is read only as `SELECT id, balance, user_id ... FOR UPDATE` —
 * `status` is not fetched and is never tested, before the lock or inside it.
 *
 * So this is not F-343. F-343 is a race: the freeze exists on the service path
 * and a suspension committed inside a narrow window slipped past it. Here there
 * is no freeze to slip past and no window to hit — a community administrator
 * simply approves a suspended organisation's hours and the credits are minted.
 *
 * Found during E-066 while remediating F-343, by a lane that was forbidden to
 * edit this file. Registered as its own permanent finding: F-343 and F-188 are
 * about `VolunteerService`, and this is a different method in a different class
 * with a different defect.
 */
class F379AdminVerifyHoursOrgFreezeTest extends TestCase
{
    use DatabaseTransactions;

    /** @return array{admin: User, volunteer: User, orgId: int, logId: int} */
    private function suspendedOrganisationWithPendingHours(string $orgStatus): array
    {
        $tenantId = $this->testTenantId;

        $admin = User::factory()->forTenant($tenantId)->admin()->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        $volunteer = User::factory()->forTenant($tenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'balance' => 0,
        ]);

        $orgOwner = User::factory()->forTenant($tenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $orgOwner->id,
            'name' => 'Suspended Org ' . uniqid(),
            'status' => $orgStatus,
            'balance' => 100,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $logId = (int) DB::table('vol_logs')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $volunteer->id,
            'organization_id' => $orgId,
            'hours' => 3,
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return ['admin' => $admin, 'volunteer' => $volunteer, 'orgId' => $orgId, 'logId' => $logId];
    }

    public function test_a_suspended_organisation_cannot_mint_credits_through_the_admin_page(): void
    {
        $f = $this->suspendedOrganisationWithPendingHours('suspended');

        Sanctum::actingAs($f['admin'], ['*']);

        $this->apiPost('/v2/admin/volunteering/hours/' . $f['logId'] . '/verify', [
            'action' => 'approve',
        ]);

        $balance = (float) DB::table('users')->where('id', $f['volunteer']->id)->value('balance');
        $status = (string) DB::table('vol_logs')->where('id', $f['logId'])->value('status');

        $this->assertSame(
            0.0,
            $balance,
            'F-379: a SUSPENDED volunteering organisation minted ' . $balance
            . ' time credits through the admin approval page. No race was needed —'
            . ' AdminVolunteerController::verifyHours never reads the organisation'
            . ' status at all, although its comments claim it mirrors'
            . ' VolunteerService::verifyHours, which does.',
        );

        $this->assertNotSame(
            'approved',
            $status,
            'F-379: the hours were marked approved on behalf of a suspended organisation.',
        );

        $this->assertSame(
            0,
            DB::table('vol_org_transactions')
                ->where('vol_log_id', $f['logId'])
                ->where('type', 'volunteer_payment')
                ->count(),
            'F-379: a payment row was written for a suspended organisation.',
        );
    }

    /**
     * Legitimate-access control, in the same file: an APPROVED organisation must
     * still mint. A fix that simply refuses everything would pass the assertion
     * above and break the feature.
     */
    public function test_an_approved_organisation_still_mints_through_the_admin_page(): void
    {
        $f = $this->suspendedOrganisationWithPendingHours('approved');

        Sanctum::actingAs($f['admin'], ['*']);

        $this->apiPost('/v2/admin/volunteering/hours/' . $f['logId'] . '/verify', [
            'action' => 'approve',
        ])->assertStatus(200);

        $this->assertSame(
            3.0,
            (float) DB::table('users')->where('id', $f['volunteer']->id)->value('balance'),
            'An approved organisation must still mint time credits on approval.',
        );

        $this->assertSame(
            'approved',
            (string) DB::table('vol_logs')->where('id', $f['logId'])->value('status'),
        );
    }

    /**
     * Second control: declining a suspended organisation's hours must still work.
     * The refusal belongs on the minting branch, not on the whole endpoint — an
     * administrator must be able to clear the queue for a suspended organisation.
     */
    public function test_hours_for_a_suspended_organisation_can_still_be_declined(): void
    {
        $f = $this->suspendedOrganisationWithPendingHours('suspended');

        Sanctum::actingAs($f['admin'], ['*']);

        $this->apiPost('/v2/admin/volunteering/hours/' . $f['logId'] . '/verify', [
            'action' => 'decline',
        ])->assertStatus(200);

        $this->assertSame(
            'declined',
            (string) DB::table('vol_logs')->where('id', $f['logId'])->value('status'),
            'An administrator must still be able to decline hours for a suspended organisation.',
        );

        $this->assertSame(
            0.0,
            (float) DB::table('users')->where('id', $f['volunteer']->id)->value('balance'),
        );
    }
}
