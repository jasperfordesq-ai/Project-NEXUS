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
 * F-404 (E-069) — the same missing subject check as F-403, on the same table,
 * reached through a different controller and a different gate.
 *
 * POST /v2/admin/safeguarding/flagged-messages/{id}/review →
 * AdminSafeguardingController::reviewMessage(), gated by
 * requireSafeguardingStaff('manage'). It updated the broker_message_copies row
 * by `id` + `tenant_id` + `reviewed_at IS NULL` and wrote `reviewed_by` = the
 * caller, with no comparison against the copy's sender or receiver. Because the
 * gate admits an admin tier outright, a fix to AdminBrokerController (F-403)
 * would not have touched this route.
 *
 * The copy-taking rules (BrokerMessageVisibilityService::evaluateCopyRules —
 * monitored sender, monitored recipient, first contact, new member, high-risk
 * listing, random sample) exclude no one, staff accounts included. So a member
 * of safeguarding staff could close the monitoring record of their own message:
 * it left the safeguarding dashboard's pending count, became purge-eligible, and
 * the audit row named the subject as the reviewer.
 *
 * Adapted from `.local-docs-archive/security-log/E-069/repro/m/M2AdminReviewsSafeguardingCopyOfOwnMessageTest.php`,
 * which asserted the harm; the attack assertions are inverted.
 */
final class F404SafeguardingStaffCannotReviewOwnMessageTest extends TestCase
{
    use DatabaseTransactions;

    public function test_safeguarding_staff_cannot_review_the_copy_of_their_own_sent_message(): void
    {
        $admin = $this->admin();
        $copyId = $this->messageCopy((int) $admin->id, (int) $this->member()->id);

        $pendingBefore = $this->pendingCount();

        Sanctum::actingAs($admin);
        $this->apiPost("/v2/admin/safeguarding/flagged-messages/{$copyId}/review", [
            'notes' => 'reviewed, no concern',
        ])->assertStatus(403);

        $row = DB::table('broker_message_copies')->where('id', $copyId)->first();
        $this->assertNull($row->reviewed_at, 'the copy is still awaiting a reviewer who is not its subject');
        $this->assertNull($row->reviewed_by);
        $this->assertNull($row->review_notes, 'the subject did not write the case note');
        $this->assertSame($pendingBefore, $this->pendingCount(), 'the safeguarding pending queue is unchanged');

        $this->assertSame(
            0,
            DB::table('activity_log')
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', $admin->id)
                ->where('action', 'safeguarding_message_reviewed')
                ->where('entity_id', $copyId)
                ->count(),
            'and no audit row records the subject as the reviewer'
        );
    }

    public function test_safeguarding_staff_cannot_review_the_copy_of_a_message_sent_to_them(): void
    {
        $admin = $this->admin();
        $copyId = $this->messageCopy((int) $this->member()->id, (int) $admin->id);

        Sanctum::actingAs($admin);
        $this->apiPost("/v2/admin/safeguarding/flagged-messages/{$copyId}/review", ['notes' => 'fine'])
            ->assertStatus(403);

        $this->assertNull(
            DB::table('broker_message_copies')->where('id', $copyId)->value('reviewed_at'),
            'the receiver is as much the subject of the monitoring as the sender'
        );
    }

    public function test_control_safeguarding_staff_may_still_review_someone_elses_message_copy(): void
    {
        $copyId = $this->messageCopy((int) $this->member()->id, (int) $this->member()->id);
        $admin = $this->admin();

        Sanctum::actingAs($admin);
        $this->apiPost("/v2/admin/safeguarding/flagged-messages/{$copyId}/review", [
            'notes' => 'reviewed, no concern',
        ])->assertStatus(200);

        $row = DB::table('broker_message_copies')->where('id', $copyId)->first();
        $this->assertSame((int) $admin->id, (int) $row->reviewed_by, 'ordinary safeguarding review is unaffected');
        $this->assertNotNull($row->reviewed_at);
        $this->assertSame('reviewed', (string) $row->action_taken);
    }

    public function test_control_an_unknown_copy_id_still_answers_not_found(): void
    {
        Sanctum::actingAs($this->admin());
        $this->apiPost('/v2/admin/safeguarding/flagged-messages/99999999/review', ['notes' => 'x'])
            ->assertStatus(404);
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => 1]);
    }

    private function admin(): User
    {
        return User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
    }

    private function pendingCount(): int
    {
        return (int) DB::table('broker_message_copies')
            ->where('tenant_id', $this->testTenantId)
            ->whereNull('reviewed_at')
            ->count();
    }

    private function messageCopy(int $senderId, int $receiverId): int
    {
        $messageId = (int) DB::table('messages')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $senderId,
            'receiver_id' => $receiverId,
            'subject' => 'F404 fixture',
            'body' => 'F404 fixture body',
            'created_at' => now(),
        ]);

        $ids = [$senderId, $receiverId];
        sort($ids);

        return (int) DB::table('broker_message_copies')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'original_message_id' => $messageId,
            'conversation_key' => md5(implode('-', $ids)),
            'sender_id' => $senderId,
            'receiver_id' => $receiverId,
            'message_body' => 'F404 fixture body',
            'sent_at' => now(),
            'copy_reason' => 'flagged_user',
            'flagged' => 0,
            'created_at' => now(),
        ]);
    }
}
