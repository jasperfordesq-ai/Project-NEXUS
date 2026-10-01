<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E075;

use App\Core\TenantContext;
use App\Services\CaringCommunityWorkflowService;
use App\Services\SafeguardingInteractionPolicy;
use App\Services\VolunteerService;
use App\Support\SafeguardingInteractionDecision;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * F-478 — the caring-community review decision is the FOURTH mint path that
 * never read the organisation's status. Sibling of F-343 (`b9f99f483`), F-379
 * (`2f9997d11`) and F-384 (`8448b0230`), which closed the other three; none of
 * their fix commits touched this file.
 *
 * `CaringCommunityWorkflowService::decideReview()`, reached by
 * `PUT /v2/admin/caring-community/workflow/reviews/{id}/decision`, approves a
 * pending `vol_logs` row and mints time credits through its own private
 * `applyOrganizationPayment()`. It gated on `status === 'pending'` and on
 * self-review, read the organisation with `if (!$org) return;` — and never
 * tested its status. The organisation lock was
 *
 *     SELECT id, balance FROM vol_organizations WHERE id = ? AND tenant_id = ? FOR UPDATE
 *
 * with `status` absent from the column list, which is the exact shape F-343 was
 * raised on, and `grep -c isApprovedOrganizationStatus` on the whole file
 * returned 0, which is the exact evidence F-379 was raised on.
 *
 * So the hard freeze whose own comment reads "a suspended (non-approved) org
 * cannot mint new time credits" was absent here, before the lock and inside it.
 * No race was needed.
 *
 * These tests assert the CORRECT behaviour: the decision is refused, nothing is
 * minted, the organisation is not debited into deficit, and the hours stay
 * pending. The controls prove the feature still works for an approved
 * organisation and that the decision's own guards are untouched.
 */
final class F478CaringReviewRefusesSuspendedOrganisationTest extends TestCase
{
    use DatabaseTransactions;

    private CaringCommunityWorkflowService $workflow;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        $this->allowSafeguarding();
        $this->workflow = app(CaringCommunityWorkflowService::class);
    }

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }

    // ------------------------------------------------------------------
    //  THE HARM
    // ------------------------------------------------------------------

    public function test_a_suspended_organisation_cannot_mint_through_the_caring_review_decision(): void
    {
        $orgOwner = $this->makeUser('active');
        $orgId = $this->makeOrganization($orgOwner, 'suspended');
        $volunteer = $this->makeUser('active');
        $reviewer = $this->makeUser('active');
        $logId = $this->makePendingLog($volunteer, $orgId, 3.0);

        $this->assertFalse(
            VolunteerService::isApprovedOrganizationStatus('suspended'),
            'precondition: the platform predicate says this organisation may not mint',
        );

        $result = $this->workflow->decideReview($this->testTenantId, $logId, $reviewer, 'approve');

        $this->assertNull($result, 'F-478: the decision must be refused');
        $this->assertSame(
            0.0,
            $this->balanceOf($volunteer),
            'F-478: a suspended organisation minted time credits',
        );
        $this->assertSame(
            'pending',
            (string) DB::table('vol_logs')->where('id', $logId)->value('status'),
            'F-478: the hours must stay pending rather than be approved with nothing minted',
        );
        $this->assertSame(
            0.0,
            round((float) DB::table('vol_organizations')->where('id', $orgId)->value('balance'), 2),
            'F-478: the suspended organisation was debited into deficit',
        );
        $this->assertSame(
            0,
            DB::table('vol_org_transactions')->where('vol_log_id', $logId)->count(),
            'F-478: a payment record was written for a refused decision',
        );
    }

    /**
     * An organisation that was never approved at all — still `pending` — must be
     * refused too, so this is not only about a later suspension.
     */
    public function test_a_never_approved_organisation_cannot_mint_either(): void
    {
        $orgOwner = $this->makeUser('active');
        $orgId = $this->makeOrganization($orgOwner, 'pending');
        $volunteer = $this->makeUser('active');
        $reviewer = $this->makeUser('active');
        $logId = $this->makePendingLog($volunteer, $orgId, 2.0);

        $result = $this->workflow->decideReview($this->testTenantId, $logId, $reviewer, 'approve');

        $this->assertNull($result);
        $this->assertSame(0.0, $this->balanceOf($volunteer));
        $this->assertSame(
            'pending',
            (string) DB::table('vol_logs')->where('id', $logId)->value('status'),
        );
    }

    // ------------------------------------------------------------------
    //  LEGITIMATE-ACCESS CONTROLS
    // ------------------------------------------------------------------

    /**
     * CONTROL. The same decision on an APPROVED organisation pays normally —
     * the behaviour the fix must preserve, and proof the fixture reaches the
     * minting branch.
     */
    public function test_control_an_approved_organisation_still_mints_normally(): void
    {
        $orgOwner = $this->makeUser('active');
        $orgId = $this->makeOrganization($orgOwner, 'approved');
        $volunteer = $this->makeUser('active');
        $reviewer = $this->makeUser('active');
        $logId = $this->makePendingLog($volunteer, $orgId, 3.0);

        $result = $this->workflow->decideReview($this->testTenantId, $logId, $reviewer, 'approve');

        $this->assertNotNull($result);
        $this->assertSame(3.0, $this->balanceOf($volunteer));
        $this->assertSame(
            'approved',
            (string) DB::table('vol_logs')->where('id', $logId)->value('status'),
        );
    }

    /**
     * CONTROL. Declining a suspended organisation's hours must still be allowed —
     * the freeze stops the MINT, not the review queue. This mirrors the comment
     * on the hard freeze in `VolunteerService::verifyHours()`: "Declining pending
     * hours stays allowed (no value movement) so admins can still clear the
     * queue during suspension."
     */
    public function test_control_declining_a_suspended_organisations_hours_is_still_allowed(): void
    {
        $orgOwner = $this->makeUser('active');
        $orgId = $this->makeOrganization($orgOwner, 'suspended');
        $volunteer = $this->makeUser('active');
        $reviewer = $this->makeUser('active');
        $logId = $this->makePendingLog($volunteer, $orgId, 3.0);

        $result = $this->workflow->decideReview($this->testTenantId, $logId, $reviewer, 'decline');

        $this->assertNotNull($result, 'declining moves no value and must stay available');
        $this->assertSame(0.0, $this->balanceOf($volunteer));
        $this->assertSame(
            'declined',
            (string) DB::table('vol_logs')->where('id', $logId)->value('status'),
        );
    }

    /**
     * CONTROL. The rule exists and holds on the sibling route the register
     * already fixed: `VolunteerService::verifyHours()` refuses the identical
     * suspended organisation and mints nothing (F-343). That is what shows this
     * path was the one that was missed, and that the fix matches its siblings.
     */
    public function test_control_the_sibling_route_still_refuses_the_same_suspended_organisation(): void
    {
        $orgOwner = $this->makeUser('active');
        $orgId = $this->makeOrganization($orgOwner, 'suspended');
        $volunteer = $this->makeUser('active');
        $logId = $this->makePendingLog($volunteer, $orgId, 3.0);

        $ok = VolunteerService::verifyHours($logId, $orgOwner, 'approve');

        $this->assertFalse($ok, 'the hardened sibling route still refuses');
        $this->assertSame(0.0, $this->balanceOf($volunteer));
        $this->assertSame(
            'pending',
            (string) DB::table('vol_logs')->where('id', $logId)->value('status'),
        );
    }

    /**
     * CONTROL. The decision route's own guards still work: a reviewer cannot
     * decide their own log, and a repeated decision pays exactly once.
     */
    public function test_control_the_decision_guards_still_hold(): void
    {
        $orgOwner = $this->makeUser('active');
        $orgId = $this->makeOrganization($orgOwner, 'approved');
        $volunteer = $this->makeUser('active');
        $reviewer = $this->makeUser('active');
        $ownLogId = $this->makePendingLog($volunteer, $orgId, 3.0);

        $self = $this->workflow->decideReview($this->testTenantId, $ownLogId, $volunteer, 'approve');
        $this->assertNull($self, 'a member cannot decide their own log');
        $this->assertSame(0.0, $this->balanceOf($volunteer));

        $this->workflow->decideReview($this->testTenantId, $ownLogId, $reviewer, 'approve');
        $this->workflow->decideReview($this->testTenantId, $ownLogId, $reviewer, 'approve');
        $this->assertSame(3.0, $this->balanceOf($volunteer), 'paid exactly once');
    }

    // ------------------------------------------------------------------
    //  Fixtures
    // ------------------------------------------------------------------

    private function balanceOf(int $userId): float
    {
        return round((float) DB::table('users')->where('id', $userId)->value('balance'), 2);
    }

    private function makeOrganization(int $ownerId, string $status): int
    {
        return (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'name' => 'F478 organisation ' . bin2hex(random_bytes(4)),
            'slug' => 'f478-' . bin2hex(random_bytes(6)),
            'status' => $status,
            'balance' => 0.00,
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
            'description' => 'F478 fixture hours',
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function makeUser(string $status): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'F478 fixture',
            'email' => 'f478-' . bin2hex(random_bytes(10)) . '@example.test',
            'password_hash' => password_hash(bin2hex(random_bytes(16)), PASSWORD_BCRYPT),
            'balance' => 0.0,
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
            policyVersion: 'e075-f478',
        );
    }
}
