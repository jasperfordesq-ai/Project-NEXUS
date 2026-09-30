<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E065;

use App\Models\Group;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * E-065 F-337 — deleting a group must not destroy the community's record of
 * complaints about it.
 *
 * Before the fix, DELETE /api/v2/groups/{id} (GroupsController::destroy ->
 * GroupService::delete -> deleteRelatedGroupRecords) wiped group_content_flags
 * for content_type='group' (open abuse reports AND resolved ones carrying the
 * moderator's decision and notes), group_audit_log (the group's who-did-what
 * trail) and group_approval_requests. The actor need only be the group's
 * owner_id, and any member may create a group (F-093), so any member could
 * erase the evidence against something they ran with one request.
 *
 * The model copied here is AdminSafeguardingController::deleteAssignment:
 * preserve the trail, and record who did it.
 */
class F337GroupDeleteKeepsModerationEvidenceTest extends TestCase
{
    use DatabaseTransactions;

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
        ]);
    }

    /** @return array{0:int,1:int,2:int,3:int,4:int} */
    private function seedGroupWithEvidence(User $owner, User $reporter): array
    {
        $group = Group::factory()->forTenant($this->testTenantId)->create([
            'owner_id' => $owner->id,
            'status' => 'active',
            'is_active' => true,
        ]);

        $pendingFlagId = DB::table('group_content_flags')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'content_type' => 'group',
            'content_id' => (int) $group->id,
            'reported_by' => (int) $reporter->id,
            'reason' => 'harassment',
            'description' => 'E065 F-337 synthetic open report',
            'status' => 'pending',
            'created_at' => now(),
        ]);

        $resolvedFlagId = DB::table('group_content_flags')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'content_type' => 'group',
            'content_id' => (int) $group->id,
            'reported_by' => (int) $reporter->id,
            'reason' => 'hate_speech',
            'description' => 'E065 F-337 synthetic resolved report',
            'status' => 'resolved',
            'moderated_by' => (int) $reporter->id,
            'moderation_action' => 'hide',
            'moderator_notes' => 'E065 F-337 synthetic moderator decision',
            'created_at' => now(),
            'resolved_at' => now(),
        ]);

        $auditId = DB::table('group_audit_log')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'group_id' => (int) $group->id,
            'user_id' => (int) $owner->id,
            'target_user_id' => (int) $reporter->id,
            'action' => 'member_removed',
            'details' => json_encode(['target_user_id' => (int) $reporter->id]),
            'created_at' => now(),
        ]);

        $approvalId = DB::table('group_approval_requests')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'group_id' => (int) $group->id,
            'submitted_by' => (int) $owner->id,
            'submission_notes' => 'E065 F-337 synthetic submission',
            'reviewed_by' => (int) $reporter->id,
            'review_notes' => 'E065 F-337 synthetic review decision',
            'status' => 'rejected',
            'created_at' => now(),
            'reviewed_at' => now(),
        ]);

        return [(int) $group->id, (int) $pendingFlagId, (int) $resolvedFlagId, (int) $auditId, (int) $approvalId];
    }

    public function test_group_owner_delete_preserves_the_abuse_reports_and_the_audit_trail(): void
    {
        $owner = $this->member();
        $reporter = $this->member();
        [$groupId, $pendingFlagId, $resolvedFlagId, $auditId, $approvalId] = $this->seedGroupWithEvidence($owner, $reporter);

        $this->assertTrue(
            DB::table('group_content_flags')->where('id', $pendingFlagId)->exists(),
            'precondition: the open abuse report exists'
        );

        Sanctum::actingAs($owner, ['*']);
        $response = $this->apiDelete('/v2/groups/' . $groupId);

        $this->assertSame(204, $response->status(), 'the owner is still allowed to delete their group');
        $this->assertFalse(
            DB::table('groups')->where('id', $groupId)->exists(),
            'the group itself is still deleted'
        );

        $this->assertTrue(
            DB::table('group_content_flags')->where('id', $pendingFlagId)->exists(),
            'F-337: the OPEN abuse report about the group must survive its deletion'
        );

        $resolved = DB::table('group_content_flags')->where('id', $resolvedFlagId)->first();
        $this->assertNotNull($resolved, 'F-337: the RESOLVED abuse report must survive');
        $this->assertSame(
            'E065 F-337 synthetic moderator decision',
            (string) $resolved->moderator_notes,
            "F-337: the moderator's written decision must survive intact"
        );

        $this->assertTrue(
            DB::table('group_audit_log')->where('id', $auditId)->exists(),
            "F-337: the group's own audit trail must survive its deletion"
        );
        $this->assertTrue(
            DB::table('group_approval_requests')->where('id', $approvalId)->exists(),
            'F-337: the approval/review record must survive its deletion'
        );
    }

    public function test_the_deletion_itself_is_recorded_in_the_group_audit_trail_naming_the_actor(): void
    {
        $owner = $this->member();
        $reporter = $this->member();
        [$groupId] = $this->seedGroupWithEvidence($owner, $reporter);

        Sanctum::actingAs($owner, ['*']);
        $this->apiDelete('/v2/groups/' . $groupId)->assertStatus(204);

        $row = DB::table('group_audit_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('group_id', $groupId)
            ->where('action', 'group_deleted')
            ->first();

        $this->assertNotNull($row, 'F-337: deleting a group must append a group_deleted row to the trail');
        $this->assertSame(
            (int) $owner->id,
            (int) $row->user_id,
            'F-337: the trail must name the member who ordered the deletion'
        );
    }

    public function test_control_a_member_who_is_not_the_owner_is_refused_and_the_evidence_survives(): void
    {
        $owner = $this->member();
        $reporter = $this->member();
        $outsider = $this->member();
        [$groupId, $pendingFlagId, , $auditId] = $this->seedGroupWithEvidence($owner, $reporter);

        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => (int) $outsider->id,
            'role' => 'member',
            'status' => 'active',
            'joined_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Sanctum::actingAs($outsider, ['*']);
        $response = $this->apiDelete('/v2/groups/' . $groupId);

        $this->assertSame(403, $response->status(), 'CONTROL: a non-owner member is still refused');
        $this->assertTrue(
            DB::table('group_content_flags')->where('id', $pendingFlagId)->exists(),
            'CONTROL: report survives a refused delete'
        );
        $this->assertTrue(
            DB::table('group_audit_log')->where('id', $auditId)->exists(),
            'CONTROL: audit row survives a refused delete'
        );
        $this->assertTrue(
            DB::table('groups')->where('id', $groupId)->exists(),
            'CONTROL: group survives a refused delete'
        );
    }
}
