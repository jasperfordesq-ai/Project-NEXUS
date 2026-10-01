<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E075;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\CaringCommunityWorkflowService;
use App\Services\SafeguardingInteractionPolicy;
use App\Services\VolunteerService;
use App\Services\WalletService;
use App\Support\SafeguardingInteractionDecision;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Mockery;
use ReflectionMethod;
use Tests\Laravel\TestCase;

/**
 * F-475 — approving volunteered hours must not mint time credits into an
 * account an administrator has suspended or banned.
 *
 * `WalletService::NON_RECEIVING_STATUSES` documents itself as shared by "every
 * path that moves credits to a member … so the rule cannot drift between them
 * (F-105/F-106)". E-074 made one-to-one exchange completion consult it (F-442,
 * `9049e0e16`). Volunteering hour approval is the same kind of path — it MINTS
 * straight into `users.balance`, with no member row debited — and had four arms
 * that never asked:
 *
 *   app/Services/VolunteerService.php                  verifyHours()
 *   app/Services/VolunteerService.php                  applyVolunteerAutoPayment()
 *   app/Http/Controllers/Api/AdminVolunteerController  verifyHours()
 *   app/Services/CaringCommunityWorkflowService        applyOrganizationPayment()
 *
 * Every one of them was hardened against a suspended ORGANISATION (F-343,
 * F-379, F-384) and none of them read the MEMBER's `users.status`.
 *
 * These tests assert the CORRECT behaviour: the approval is refused, nothing is
 * minted, and the hours stay pending so they can be approved normally once the
 * suspension is lifted. The controls prove the feature still works.
 */
final class F475VolunteerApprovalRefusesSuspendedMemberTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        $this->allowSafeguarding();
    }

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }

    // ------------------------------------------------------------------
    //  ARM 1 — VolunteerService::verifyHours()
    // ------------------------------------------------------------------

    public function test_verify_hours_refuses_to_mint_to_a_suspended_volunteer(): void
    {
        $orgAdmin = $this->makeUser(0.0, 'active');
        $orgId = $this->makeOrganization($orgAdmin);
        $volunteer = $this->makeUser(0.0, 'suspended');
        $logId = $this->makePendingLog($volunteer, $orgId, 4.0);

        $this->assertFalse(
            WalletService::canReceiveCredits('suspended'),
            'precondition: the shared platform rule refuses a suspended recipient',
        );

        $ok = VolunteerService::verifyHours($logId, $orgAdmin, 'approve');

        $this->assertFalse($ok, 'F-475: the approval must be refused');
        $this->assertSame(
            0.0,
            $this->balanceOf($volunteer),
            'F-475: a suspended account was minted time credits',
        );
        $this->assertSame(
            'pending',
            (string) DB::table('vol_logs')->where('id', $logId)->value('status'),
            'F-475: the hours must stay pending so they can be approved once the suspension is lifted',
        );
        $this->assertSame(
            0,
            DB::table('transactions')
                ->where('tenant_id', $this->testTenantId)
                ->where('receiver_id', $volunteer)
                ->where('transaction_type', 'volunteer')
                ->count(),
            'F-475: a ledger row was written for a payment that must not happen',
        );
    }

    public function test_verify_hours_refuses_to_mint_to_a_banned_volunteer(): void
    {
        $orgAdmin = $this->makeUser(0.0, 'active');
        $orgId = $this->makeOrganization($orgAdmin);
        $volunteer = $this->makeUser(0.0, 'banned');
        $logId = $this->makePendingLog($volunteer, $orgId, 3.0);

        $ok = VolunteerService::verifyHours($logId, $orgAdmin, 'approve');

        $this->assertFalse($ok);
        $this->assertSame(0.0, $this->balanceOf($volunteer), 'F-475: a banned account was minted time credits');
    }

    /**
     * The community's total time-credit stock must not grow: this path MINTS,
     * so an unrefused approval creates new credits and parks them on a barred
     * account.
     */
    public function test_verify_hours_does_not_grow_the_communitys_credit_stock(): void
    {
        $orgAdmin = $this->makeUser(0.0, 'active');
        $orgId = $this->makeOrganization($orgAdmin);
        $volunteer = $this->makeUser(0.0, 'suspended');
        $logId = $this->makePendingLog($volunteer, $orgId, 6.0);

        $before = $this->tenantCreditStock();
        VolunteerService::verifyHours($logId, $orgAdmin, 'approve');
        $after = $this->tenantCreditStock();

        $this->assertEqualsWithDelta(
            0.0,
            $after - $before,
            0.005,
            'F-475: time credits were created and given to a suspended account',
        );
    }

    // ------------------------------------------------------------------
    //  ARM 2 — VolunteerService::applyVolunteerAutoPayment()
    // ------------------------------------------------------------------

    /**
     * The auto-approve twin of arm 1. It is a private static called from
     * logHours() when the tenant's caring-workflow policy auto-approves, so it
     * is driven directly here rather than through several layers of tenant
     * configuration.
     */
    public function test_the_auto_payment_path_refuses_to_mint_to_a_suspended_volunteer(): void
    {
        $orgOwner = $this->makeUser(0.0, 'active');
        $orgId = $this->makeOrganization($orgOwner);
        $volunteer = $this->makeUser(0.0, 'suspended');
        $logId = $this->makePendingLog($volunteer, $orgId, 4.0);

        $outcome = $this->callAutoPayment($orgId, $orgOwner, $volunteer, $logId, 4.0);

        $this->assertNotSame('paid', $outcome, 'F-475: the auto-payment path paid a suspended account');
        $this->assertSame(
            0.0,
            $this->balanceOf($volunteer),
            'F-475: the auto-payment path minted into a suspended account',
        );
        $this->assertSame(
            0,
            DB::table('vol_org_transactions')->where('vol_log_id', $logId)->count(),
            'F-475: an organisation payment row was written for a refused payment',
        );
    }

    // ------------------------------------------------------------------
    //  ARM 3 — AdminVolunteerController::verifyHours()
    // ------------------------------------------------------------------

    public function test_the_admin_approval_page_refuses_to_mint_to_a_suspended_volunteer(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        $orgOwner = $this->makeUser(0.0, 'active');
        $orgId = $this->makeOrganization($orgOwner);
        $volunteer = $this->makeUser(0.0, 'suspended');
        $logId = $this->makePendingLog($volunteer, $orgId, 4.0);

        Sanctum::actingAs($admin, ['*']);
        $this->apiPost('/v2/admin/volunteering/hours/' . $logId . '/verify', ['action' => 'approve']);

        $this->assertSame(
            0.0,
            $this->balanceOf($volunteer),
            'F-475: the admin approval page minted time credits into a suspended account',
        );
        $this->assertNotSame(
            'approved',
            (string) DB::table('vol_logs')->where('id', $logId)->value('status'),
            'F-475: the hours were marked approved for an account that may not be paid',
        );
    }

    // ------------------------------------------------------------------
    //  ARM 4 — CaringCommunityWorkflowService::applyOrganizationPayment()
    // ------------------------------------------------------------------

    public function test_the_caring_review_decision_refuses_to_mint_to_a_suspended_volunteer(): void
    {
        $workflow = app(CaringCommunityWorkflowService::class);

        $orgOwner = $this->makeUser(0.0, 'active');
        $orgId = $this->makeOrganization($orgOwner);
        $volunteer = $this->makeUser(0.0, 'suspended');
        $reviewer = $this->makeUser(0.0, 'active');
        $logId = $this->makePendingLog($volunteer, $orgId, 3.0);

        $workflow->decideReview($this->testTenantId, $logId, $reviewer, 'approve');

        $this->assertSame(
            0.0,
            $this->balanceOf($volunteer),
            'F-475: the caring review decision minted time credits into a suspended account',
        );
        $this->assertSame(
            'pending',
            (string) DB::table('vol_logs')->where('id', $logId)->value('status'),
            'F-475: the hours must stay pending rather than be approved with nothing minted',
        );
    }

    // ------------------------------------------------------------------
    //  LEGITIMATE-ACCESS CONTROLS
    // ------------------------------------------------------------------

    /**
     * CONTROL. Identical in every respect except the member's account status:
     * an ACTIVE volunteer is still paid on all four arms. This is the behaviour
     * the fix must preserve, and it proves each fixture reaches the paying
     * branch rather than falling at some earlier hurdle.
     */
    public function test_control_an_active_volunteer_is_still_paid_on_every_arm(): void
    {
        // Arm 1 — VolunteerService::verifyHours()
        $orgAdmin = $this->makeUser(0.0, 'active');
        $orgId = $this->makeOrganization($orgAdmin);
        $volunteer = $this->makeUser(0.0, 'active');
        $logId = $this->makePendingLog($volunteer, $orgId, 4.0);

        $this->assertTrue(VolunteerService::verifyHours($logId, $orgAdmin, 'approve'));
        $this->assertSame(4.0, $this->balanceOf($volunteer), 'arm 1 still pays an active volunteer');
        $this->assertSame(
            'approved',
            (string) DB::table('vol_logs')->where('id', $logId)->value('status'),
        );

        // Arm 2 — VolunteerService::applyVolunteerAutoPayment()
        $autoVolunteer = $this->makeUser(0.0, 'active');
        $autoLogId = $this->makePendingLog($autoVolunteer, $orgId, 2.0);
        $this->assertSame('paid', $this->callAutoPayment($orgId, $orgAdmin, $autoVolunteer, $autoLogId, 2.0));
        $this->assertSame(2.0, $this->balanceOf($autoVolunteer), 'arm 2 still pays an active volunteer');

        // Arm 3 — AdminVolunteerController::verifyHours()
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $adminVolunteer = $this->makeUser(0.0, 'active');
        $adminLogId = $this->makePendingLog($adminVolunteer, $orgId, 3.0);
        Sanctum::actingAs($admin, ['*']);
        $this->apiPost('/v2/admin/volunteering/hours/' . $adminLogId . '/verify', ['action' => 'approve']);
        $this->assertSame(3.0, $this->balanceOf($adminVolunteer), 'arm 3 still pays an active volunteer');

        // Arm 4 — CaringCommunityWorkflowService::decideReview()
        $caringVolunteer = $this->makeUser(0.0, 'active');
        $reviewer = $this->makeUser(0.0, 'active');
        $caringLogId = $this->makePendingLog($caringVolunteer, $orgId, 5.0);
        $result = app(CaringCommunityWorkflowService::class)
            ->decideReview($this->testTenantId, $caringLogId, $reviewer, 'approve');
        $this->assertNotNull($result);
        $this->assertSame(5.0, $this->balanceOf($caringVolunteer), 'arm 4 still pays an active volunteer');
    }

    /**
     * CONTROL. The organisation-side rule the register already holds (F-343 /
     * F-379 / F-384) still refuses: a SUSPENDED organisation mints nothing even
     * for a perfectly active volunteer. That is what shows the check added here
     * is the MEMBER's, and that it did not displace the organisation's.
     */
    public function test_control_a_suspended_organisation_still_mints_nothing(): void
    {
        $orgAdmin = $this->makeUser(0.0, 'active');
        $orgId = $this->makeOrganization($orgAdmin, 'suspended');
        $volunteer = $this->makeUser(0.0, 'active');
        $logId = $this->makePendingLog($volunteer, $orgId, 4.0);

        $ok = VolunteerService::verifyHours($logId, $orgAdmin, 'approve');

        $this->assertFalse($ok, 'the organisation rule still refuses');
        $this->assertSame(0.0, $this->balanceOf($volunteer));
        $this->assertSame(
            'pending',
            (string) DB::table('vol_logs')->where('id', $logId)->value('status'),
        );
    }

    /**
     * CONTROL. Declining a suspended member's hours is still allowed — the fix
     * must stop the MINT, not freeze the review queue. Administrators can still
     * clear pending work for a suspended account.
     */
    public function test_control_declining_a_suspended_members_hours_is_still_allowed(): void
    {
        $orgAdmin = $this->makeUser(0.0, 'active');
        $orgId = $this->makeOrganization($orgAdmin);
        $volunteer = $this->makeUser(0.0, 'suspended');
        $logId = $this->makePendingLog($volunteer, $orgId, 4.0);

        $ok = VolunteerService::verifyHours($logId, $orgAdmin, 'decline');

        $this->assertTrue($ok, 'declining moves no value and must stay available');
        $this->assertSame(0.0, $this->balanceOf($volunteer));
        $this->assertNotSame(
            'pending',
            (string) DB::table('vol_logs')->where('id', $logId)->value('status'),
        );
    }

    // ------------------------------------------------------------------
    //  Fixtures
    // ------------------------------------------------------------------

    private function callAutoPayment(
        int $orgId,
        int $orgOwnerId,
        int $volunteerId,
        int $logId,
        float $hours,
    ): string {
        $method = new ReflectionMethod(VolunteerService::class, 'applyVolunteerAutoPayment');
        $method->setAccessible(true);

        return (string) $method->invoke(
            null,
            $this->testTenantId,
            $orgId,
            $orgOwnerId,
            $volunteerId,
            $logId,
            $hours,
        );
    }

    private function balanceOf(int $userId): float
    {
        return round((float) DB::table('users')->where('id', $userId)->value('balance'), 2);
    }

    private function tenantCreditStock(): float
    {
        return (float) DB::table('users')->where('tenant_id', $this->testTenantId)->sum('balance');
    }

    private function makeOrganization(int $ownerId, string $status = 'approved'): int
    {
        return (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'name' => 'F475 organisation ' . bin2hex(random_bytes(4)),
            'slug' => 'f475-' . bin2hex(random_bytes(6)),
            'status' => $status,
            'balance' => 100.00,
            'auto_pay_enabled' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function makePendingLog(int $volunteerId, int $orgId, float $hours): int
    {
        return (int) DB::table('vol_logs')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $volunteerId,
            'organization_id' => $orgId,
            'date_logged' => now()->subDay()->toDateString(),
            'hours' => $hours,
            'description' => 'F475 fixture hours',
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function makeUser(float $balance, string $status): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'F475 fixture',
            'email' => 'f475-' . bin2hex(random_bytes(10)) . '@example.test',
            'password_hash' => password_hash(bin2hex(random_bytes(16)), PASSWORD_BCRYPT),
            'balance' => $balance,
            'role' => 'member',
            'status' => $status,
            'is_active' => $status === 'active',
            'is_approved' => true,
            'onboarding_completed' => true,
            'preferred_language' => 'en',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function allowSafeguarding(): void
    {
        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('evaluateLocalContact')->andReturn($this->allowDecision());
        $policy->shouldReceive('evaluateCrossTenantContact')->andReturn($this->allowDecision());
        $policy->shouldReceive('evaluateExternalContact')->andReturn($this->allowDecision());
        $policy->shouldReceive('assertLocalContactAllowed')->andReturnNull();
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);
    }

    private function allowDecision(): SafeguardingInteractionDecision
    {
        return new SafeguardingInteractionDecision(
            status: SafeguardingInteractionDecision::ALLOW,
            code: 'ALLOWED',
            recipientTenantId: $this->testTenantId,
            purposeCode: 'safeguarded_member_contact',
            scopeType: 'tenant',
            scopeIdentifier: '',
            policyVersion: 'e075-f475',
        );
    }
}
