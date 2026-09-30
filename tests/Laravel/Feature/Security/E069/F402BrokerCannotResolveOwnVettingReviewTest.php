<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E069;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-402 (E-069) — a member of staff closed the safeguarding vetting review
 * about themselves.
 *
 * Every other vetting decision refuses a self-decision:
 * MemberVettingAttestationService::confirmForCurrentPolicy() and
 * ::revokeForCurrentPolicy() both call assertActorMayDecideForMember(), which
 * throws VETTING_SELF_CONFIRMATION_FORBIDDEN when the actor is the subject.
 * ::resolveReview() (POST /v2/admin/vetting/reviews/{reviewId}/resolve) had no
 * such check — it verified only that the request existed in the caller's tenant
 * and was pending, then stamped status='completed', handled_by = the caller.
 *
 * A pending row is the community's standing instruction to re-check a member's
 * safeguarding clearance (raised per affected member on a policy rotation), and
 * the broker dashboard's queue tile counts exactly those rows. A broker who was
 * themselves in the queue could clear their own entry, so nobody was prompted to
 * re-check their clearance — and the audit row named the subject as the handler.
 *
 * Now the subject is refused, with the same reason code the sibling decisions
 * use. Resolving somebody else's review is untouched.
 *
 * Adapted from `.local-docs-archive/security-log/E-069/repro/h/H2BrokerClosesOwnVettingReviewTest.php`,
 * which asserted the harm; the attack assertions are inverted.
 */
final class F402BrokerCannotResolveOwnVettingReviewTest extends TestCase
{
    use DatabaseTransactions;

    public function test_broker_cannot_resolve_the_vetting_review_about_themselves(): void
    {
        $broker = $this->staff('broker');
        $reviewId = $this->pendingReview((int) $broker->id, (int) $this->admin()->id);

        $pendingBefore = $this->pendingCount();

        Sanctum::actingAs($broker);
        $res = $this->apiPost("/v2/admin/vetting/reviews/{$reviewId}/resolve", [
            'resolution_code' => 'no_change',
        ]);
        $res->assertStatus(403);
        $this->assertStringContainsString('VETTING_SELF_CONFIRMATION_FORBIDDEN', (string) $res->getContent());

        $row = DB::table('safeguarding_vetting_review_requests')->where('id', $reviewId)->first();
        $this->assertSame('pending', (string) $row->status, 'the review about the broker is still open');
        $this->assertNull($row->handled_by, 'nobody is recorded as having handled it');
        $this->assertSame($pendingBefore, $this->pendingCount(), 'the community\'s pending queue is unchanged');
    }

    public function test_an_administrator_cannot_resolve_the_vetting_review_about_themselves_either(): void
    {
        $admin = $this->admin();
        $reviewId = $this->pendingReview((int) $admin->id, (int) $this->admin()->id);

        Sanctum::actingAs($admin);
        $this->apiPost("/v2/admin/vetting/reviews/{$reviewId}/resolve", [
            'resolution_code' => 'no_change',
        ])->assertStatus(403);

        $this->assertSame(
            'pending',
            (string) DB::table('safeguarding_vetting_review_requests')->where('id', $reviewId)->value('status'),
            'the self-decision line is the same one confirm/revoke draw — it is not tier-exempt'
        );
    }

    public function test_control_a_broker_may_still_resolve_another_members_review(): void
    {
        $broker = $this->staff('broker');
        $member = $this->staff('member');
        $reviewId = $this->pendingReview((int) $member->id, (int) $this->admin()->id);

        Sanctum::actingAs($broker);
        $this->apiPost("/v2/admin/vetting/reviews/{$reviewId}/resolve", [
            'resolution_code' => 'member_contacted',
        ])->assertStatus(200);

        $row = DB::table('safeguarding_vetting_review_requests')->where('id', $reviewId)->first();
        $this->assertSame('completed', (string) $row->status, 'ordinary queue work is unaffected');
        $this->assertSame((int) $broker->id, (int) $row->handled_by);
        $this->assertSame('member_contacted', (string) $row->resolution_code);
    }

    public function test_control_an_administrator_may_still_resolve_another_members_review(): void
    {
        $member = $this->staff('member');
        $reviewId = $this->pendingReview((int) $member->id, (int) $this->admin()->id);

        Sanctum::actingAs($this->admin());
        $this->apiPost("/v2/admin/vetting/reviews/{$reviewId}/resolve", [
            'resolution_code' => 'no_change',
        ])->assertStatus(200);

        $this->assertSame(
            'completed',
            (string) DB::table('safeguarding_vetting_review_requests')->where('id', $reviewId)->value('status')
        );
    }

    // ── fixtures ────────────────────────────────────────────────────────────

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

    private function pendingCount(): int
    {
        return (int) DB::table('safeguarding_vetting_review_requests')
            ->where('tenant_id', $this->testTenantId)
            ->where('status', 'pending')
            ->count();
    }

    private function pendingReview(int $subjectId, int $requestedBy): int
    {
        return (int) DB::table('safeguarding_vetting_review_requests')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $subjectId,
            'jurisdiction' => 'IE',
            'scheme_code' => 'f402_scheme',
            'attestation_code' => 'f402_attestation',
            'purpose_code' => 'safeguarded_member_contact',
            'scope_type' => 'tenant',
            'scope_identifier' => '',
            'policy_version' => 'f402:' . uniqid(),
            'status' => 'pending',
            'request_source' => 'policy_rotation',
            'requested_by' => $requestedBy,
            'requested_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
