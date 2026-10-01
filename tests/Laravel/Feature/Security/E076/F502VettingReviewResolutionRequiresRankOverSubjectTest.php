<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E076;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-502 (E-076) — a broker must not close the safeguarding vetting REVIEW
 * REQUEST about an account they do not outrank.
 *
 * F-421 added a rank comparison to the vetting DECISION paths through
 * `MemberVettingAttestationService::assertActorMayDecideForMember()`.
 * `resolveReview()` (POST /v2/admin/vetting/reviews/{id}/resolve, broker-or-
 * admin) drew only F-402's self-decision line and then nothing, so a broker
 * could discharge the community's standing instruction to re-check an
 * ADMINISTRATOR's clearance — and nobody was prompted again.
 *
 * These tests assert the CORRECT behaviour and fail before the fix. Controls in
 * the same file: a broker may still resolve an ordinary member's review; an
 * administrator may still resolve a peer administrator's review; the
 * self-decision refusal still fires with its own reason code.
 */
final class F502VettingReviewResolutionRequiresRankOverSubjectTest extends TestCase
{
    use DatabaseTransactions;

    /** HARM — the broker is refused against an administrator. */
    public function test_a_broker_cannot_resolve_an_administrators_vetting_review(): void
    {
        $broker = $this->staff('broker');
        $admin = $this->admin();
        $reviewId = $this->pendingReview((int) $admin->id, (int) $this->admin()->id);

        Sanctum::actingAs($broker);
        $res = $this->apiPost("/v2/admin/vetting/reviews/{$reviewId}/resolve", [
            'resolution_code' => 'no_change',
        ]);

        $this->assertSame(403, $res->getStatusCode(), 'F-502: the broker must be refused. ' . $res->getContent());
        $this->assertStringContainsString('INSUFFICIENT_PERMISSIONS', (string) $res->getContent());
        $this->assertStillPending($reviewId);
    }

    /**
     * HARM — the same against a network administrator whose authority is held
     * only in the flags (the canonical grant since E-074), not the role string.
     */
    public function test_a_broker_cannot_resolve_a_flag_only_network_administrators_review(): void
    {
        $broker = $this->staff('broker');
        $networkAdmin = $this->staff('member');
        DB::table('users')->where('id', $networkAdmin->id)->update(['is_tenant_super_admin' => 1]);
        $reviewId = $this->pendingReview((int) $networkAdmin->id, (int) $this->admin()->id);

        Sanctum::actingAs($broker);
        $res = $this->apiPost("/v2/admin/vetting/reviews/{$reviewId}/resolve", [
            'resolution_code' => 'no_change',
        ]);

        $this->assertSame(403, $res->getStatusCode(), 'F-502: rank is read from the flags too. ' . $res->getContent());
        $this->assertStillPending($reviewId);
    }

    /** HARM — a broker does not outrank a fellow broker either. */
    public function test_a_broker_cannot_resolve_a_fellow_brokers_vetting_review(): void
    {
        $broker = $this->staff('broker');
        $peer = $this->staff('broker');
        $reviewId = $this->pendingReview((int) $peer->id, (int) $this->admin()->id);

        Sanctum::actingAs($broker);
        $this->apiPost("/v2/admin/vetting/reviews/{$reviewId}/resolve", [
            'resolution_code' => 'no_change',
        ])->assertStatus(403);
        $this->assertStillPending($reviewId);
    }

    /** CONTROL — ordinary queue work: a broker resolves a member's review. */
    public function test_control_a_broker_may_still_resolve_an_ordinary_members_review(): void
    {
        $broker = $this->staff('broker');
        $member = $this->staff('member');
        $reviewId = $this->pendingReview((int) $member->id, (int) $this->admin()->id);

        Sanctum::actingAs($broker);
        $this->apiPost("/v2/admin/vetting/reviews/{$reviewId}/resolve", [
            'resolution_code' => 'member_contacted',
        ])->assertStatus(200);

        $row = DB::table('safeguarding_vetting_review_requests')->where('id', $reviewId)->first();
        $this->assertSame('completed', (string) $row->status);
        $this->assertSame((int) $broker->id, (int) $row->handled_by);
    }

    /** CONTROL — admin-tier latitude: an administrator resolves a peer's review. */
    public function test_control_an_administrator_may_still_resolve_a_peer_administrators_review(): void
    {
        $peer = $this->admin();
        $reviewId = $this->pendingReview((int) $peer->id, (int) $this->admin()->id);

        Sanctum::actingAs($this->admin());
        $this->apiPost("/v2/admin/vetting/reviews/{$reviewId}/resolve", [
            'resolution_code' => 'no_change',
        ])->assertStatus(200);

        $this->assertSame(
            'completed',
            (string) DB::table('safeguarding_vetting_review_requests')->where('id', $reviewId)->value('status')
        );
    }

    /** CONTROL — F-402's self-decision refusal still fires with its own code. */
    public function test_control_the_self_decision_refusal_keeps_its_reason_code(): void
    {
        $broker = $this->staff('broker');
        $reviewId = $this->pendingReview((int) $broker->id, (int) $this->admin()->id);

        Sanctum::actingAs($broker);
        $res = $this->apiPost("/v2/admin/vetting/reviews/{$reviewId}/resolve", [
            'resolution_code' => 'no_change',
        ]);
        $res->assertStatus(403);
        $this->assertStringContainsString('VETTING_SELF_CONFIRMATION_FORBIDDEN', (string) $res->getContent());
        $this->assertStillPending($reviewId);
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    private function assertStillPending(int $reviewId): void
    {
        $row = DB::table('safeguarding_vetting_review_requests')->where('id', $reviewId)->first();
        $this->assertSame('pending', (string) $row->status, 'the review is still open');
        $this->assertNull($row->handled_by, 'nobody is recorded as having handled it');
    }

    private function staff(string $role): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'role' => $role, 'status' => 'active', 'is_approved' => 1,
        ]);
    }

    private function admin(): User
    {
        return User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
    }

    private function pendingReview(int $subjectId, int $requestedBy): int
    {
        return (int) DB::table('safeguarding_vetting_review_requests')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $subjectId,
            'jurisdiction' => 'IE',
            'scheme_code' => 'f502_scheme',
            'attestation_code' => 'f502_attestation',
            'purpose_code' => 'safeguarded_member_contact',
            'scope_type' => 'tenant',
            'scope_identifier' => '',
            'policy_version' => 'f502:' . uniqid(),
            'status' => 'pending',
            'request_source' => 'policy_rotation',
            'requested_by' => $requestedBy,
            'requested_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
