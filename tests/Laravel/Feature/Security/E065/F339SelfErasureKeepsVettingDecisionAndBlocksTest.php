<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E065;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\Enterprise\GdprService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * E-065 F-339 — a member under safeguarding vetting review must not be able to
 * erase the community's vetting decision, its audit trail, the open review, or
 * the blocks OTHER members placed on them.
 *
 * Before the fix, GdprService::executeAccountDeletion() deleted
 * safeguarding_vetting_review_requests, member_vetting_attestation_events and
 * member_vetting_attestations (step 3y), and user_blocks in BOTH directions
 * (step 3m) — so a row another member created to protect themselves went with
 * the blocked person.
 *
 * Owner decision, 30 September 2026 ("Keep vetting decisions too"): a vetting
 * decision and an open review are preserved under the SAME legal hold as
 * safeguarding reports — that is, the erasure routine simply does not touch
 * them — and other members' blocks are no longer deleted with the erased
 * account. The owner did NOT choose the re-registration-linking variant, so no
 * identifier survives erasure for that purpose; the anonymisation of the users
 * row (email/username freed) is deliberately unchanged.
 *
 * The block the erased member placed on someone else IS still removed: it
 * protects nobody once its author is gone.
 */
class F339SelfErasureKeepsVettingDecisionAndBlocksTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        $this->app['auth']->forgetGuards();
        foreach (['HTTP_X_TENANT_ID', 'HTTP_X_TENANT_SLUG', 'HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION'] as $serverKey) {
            unset($_SERVER[$serverKey]);
        }
        Cache::flush();
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
    }

    public function test_self_erasure_preserves_the_vetting_decision_its_trail_the_open_review_and_other_members_blocks(): void
    {
        $tenantId = $this->testTenantId;

        $subject  = $this->member();
        $staff    = $this->member();
        $blockerA = $this->member();
        $blockerB = $this->member();
        $target   = $this->member();

        $attestationId = $this->attestation($tenantId, (int) $subject->id, (int) $staff->id);
        $eventId       = $this->attestationEvent($tenantId, $attestationId, (int) $subject->id, (int) $staff->id);
        $reviewId      = $this->reviewRequest($tenantId, (int) $subject->id, (int) $staff->id);

        // Two blocks placed BY other members ON the departing member — these are
        // those members' own protection and must survive.
        $blockA = $this->block($tenantId, (int) $blockerA->id, (int) $subject->id, 'Repeated unwanted contact.');
        $blockB = $this->block($tenantId, (int) $blockerB->id, (int) $subject->id, 'Repeated unwanted contact.');

        // A block placed BY the departing member — it protects nobody once its
        // author is gone, so erasure should still remove it.
        $blockOwn = $this->block($tenantId, (int) $subject->id, (int) $target->id, 'E065 F-339 own block.');

        // The reference point: the routine already preserves this one.
        $reportId = $this->safeguardingReport($tenantId, (int) $blockerA->id, (int) $subject->id);

        $this->assertDatabaseHas('member_vetting_attestations', ['id' => $attestationId]);
        $this->assertDatabaseHas('safeguarding_vetting_review_requests', ['id' => $reviewId, 'status' => 'pending']);
        $this->assertSame(2, (int) DB::table('user_blocks')->where('blocked_user_id', $subject->id)->count());

        // The member's own self-service erasure (the code path behind DELETE /v2/users/me).
        (new GdprService($tenantId))->executeAccountDeletion((int) $subject->id);

        $this->assertSame(
            1,
            (int) DB::table('member_vetting_attestations')->where('id', $attestationId)->where('decision', 'refused')->count(),
            'The staff vetting DECISION about the departing member must survive their self-erasure.'
        );
        $this->assertSame(
            1,
            (int) DB::table('member_vetting_attestation_events')->where('id', $eventId)->count(),
            'The before/after trail behind the vetting decision must survive their self-erasure.'
        );
        $this->assertSame(
            1,
            (int) DB::table('safeguarding_vetting_review_requests')->where('id', $reviewId)->where('status', 'pending')->count(),
            'An OPEN staff review of the departing member must survive their self-erasure.'
        );
        $this->assertSame(
            2,
            (int) DB::table('user_blocks')->whereIn('id', [$blockA, $blockB])->count(),
            'Blocks that OTHER members placed on the departing member must survive their self-erasure.'
        );
        $this->assertSame(
            0,
            (int) DB::table('user_blocks')->where('id', $blockOwn)->count(),
            "The departing member's own block protects nobody and is still removed."
        );

        // Unchanged reference point.
        $this->assertDatabaseHas('safeguarding_reports', ['id' => $reportId]);
    }

    public function test_control_erasure_still_removes_the_departing_members_own_personal_data_and_stops_at_the_community_boundary(): void
    {
        $tenantId = $this->testTenantId;

        $otherTenantId = (int) DB::table('tenants')->insertGetId([
            'name'       => 'E065 F-339 isolation tenant',
            'slug'       => 'e065-f339-' . uniqid(),
            'is_active'  => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $subject = $this->member();
        $staff   = $this->member();
        $blocker = $this->member();

        $foreignSubject = User::factory()->forTenant($otherTenantId)->create(['status' => 'active']);
        $foreignStaff   = User::factory()->forTenant($otherTenantId)->create(['status' => 'active']);
        $foreignBlocker = User::factory()->forTenant($otherTenantId)->create(['status' => 'active']);

        $originalEmail = (string) $subject->email;

        $mine    = $this->attestation($tenantId, (int) $subject->id, (int) $staff->id);
        $foreign = $this->attestation($otherTenantId, (int) $foreignSubject->id, (int) $foreignStaff->id);
        $myBlock      = $this->block($tenantId, (int) $blocker->id, (int) $subject->id);
        $foreignBlock = $this->block($otherTenantId, (int) $foreignBlocker->id, (int) $foreignSubject->id);

        (new GdprService($tenantId))->executeAccountDeletion((int) $subject->id);

        // The erasure itself still happened: the identity is anonymised.
        $anonymised = DB::table('users')->where('id', $subject->id)->first();
        $this->assertNotNull($anonymised);
        $this->assertNotSame($originalEmail, (string) $anonymised->email, 'Erasure must still anonymise the account email.');
        $this->assertStringContainsString('@anonymized.local', (string) $anonymised->email);

        // The preserved records are preserved in THIS community …
        $this->assertDatabaseHas('member_vetting_attestations', ['id' => $mine]);
        $this->assertSame(1, (int) DB::table('user_blocks')->where('id', $myBlock)->count());

        // … and nothing in another community was touched either way.
        $this->assertDatabaseHas('member_vetting_attestations', ['id' => $foreign]);
        $this->assertSame(1, (int) DB::table('user_blocks')->where('id', $foreignBlock)->count());

        DB::table('user_blocks')->where('tenant_id', $otherTenantId)->delete();
        DB::table('member_vetting_attestations')->where('tenant_id', $otherTenantId)->delete();
        DB::table('users')->where('tenant_id', $otherTenantId)->delete();
        DB::table('tenants')->where('id', $otherTenantId)->delete();
    }

    // ---------------------------------------------------------------- helpers

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status'      => 'active',
            'is_approved' => true,
        ]);
    }

    private function attestation(int $tenantId, int $userId, int $staffId): int
    {
        return (int) DB::table('member_vetting_attestations')->insertGetId([
            'tenant_id'        => $tenantId,
            'user_id'          => $userId,
            'scheme_code'      => 'e065f339_scheme',
            'attestation_code' => 'e065f339_attestation',
            'purpose_code'     => 'e065f339_purpose',
            'scope_type'       => 'tenant',
            'scope_identifier' => '',
            'decision'         => 'refused',
            'confirmed_by'     => $staffId,
            'confirmed_at'     => now(),
            'policy_version'   => '1',
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);
    }

    private function attestationEvent(int $tenantId, int $attestationId, int $userId, int $staffId): int
    {
        return (int) DB::table('member_vetting_attestation_events')->insertGetId([
            'tenant_id'        => $tenantId,
            'attestation_id'   => $attestationId,
            'user_id'          => $userId,
            'scheme_code'      => 'e065f339_scheme',
            'attestation_code' => 'e065f339_attestation',
            'purpose_code'     => 'e065f339_purpose',
            'scope_type'       => 'tenant',
            'scope_identifier' => '',
            'event_type'       => 'decided',
            'decision_before'  => null,
            'decision_after'   => 'refused',
            'reason_code'      => 'e065f339_reason',
            'actor_user_id'    => $staffId,
            'policy_version'   => '1',
            'created_at'       => now(),
        ]);
    }

    private function reviewRequest(int $tenantId, int $userId, int $staffId): int
    {
        return (int) DB::table('safeguarding_vetting_review_requests')->insertGetId([
            'tenant_id'        => $tenantId,
            'user_id'          => $userId,
            'jurisdiction'     => 'e065f339',
            'scheme_code'      => 'e065f339_scheme',
            'attestation_code' => 'e065f339_attestation',
            'purpose_code'     => 'e065f339_purpose',
            'scope_type'       => 'tenant',
            'scope_identifier' => '',
            'policy_version'   => '1',
            'status'           => 'pending',
            'request_source'   => 'staff_request',
            'requested_by'     => $staffId,
            'requested_at'     => now(),
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);
    }

    private function block(int $tenantId, int $blockerId, int $blockedId, ?string $reason = null): int
    {
        return (int) DB::table('user_blocks')->insertGetId([
            'tenant_id'       => $tenantId,
            'user_id'         => $blockerId,
            'blocked_user_id' => $blockedId,
            'blocker_user_id' => $blockerId,
            'reason'          => $reason,
            'created_at'      => now(),
        ]);
    }

    private function safeguardingReport(int $tenantId, int $reporterId, int $subjectId): int
    {
        return (int) DB::table('safeguarding_reports')->insertGetId([
            'tenant_id'        => $tenantId,
            'reporter_user_id' => $reporterId,
            'subject_user_id'  => $subjectId,
            'category'         => 'inappropriate_behavior',
            'severity'         => 'high',
            'description'      => 'E065 F-339 synthetic concern.',
            'status'           => 'investigating',
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);
    }
}
