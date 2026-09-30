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
 * F-403 (E-069) — a member of staff signed off the monitoring record of their
 * own message, through AdminBrokerController.
 *
 * AdminBrokerController draws the "do not decide a record about yourself" line
 * six times elsewhere — the four exchange routes refuse a caller who is the
 * exchange's requester or provider, and guardBrokerNotListingOwner() refuses a
 * broker acting on their own listing — but the three message-review routes drew
 * none. Each loaded the broker_message_copies row by `id` + `tenant_id` only and
 * wrote `reviewed_by` = the caller:
 *
 *  - reviewMessage()  POST /v2/admin/broker/messages/{id}/review
 *  - approveMessage() POST /v2/admin/broker/messages/{id}/approve
 *  - flagMessage()    POST /v2/admin/broker/messages/{id}/flag
 *
 * A copy exists precisely because someone is being watched. Stamping it reviewed
 * removed it from the broker dashboard's unreviewed count and the safeguarding
 * dashboard's pending count, and put it inside PurgeBrokerMessageCopiesCommand's
 * selection (which deletes only rows with `reviewed_at` set — an unreviewed copy
 * is kept indefinitely). approveMessage also archived the copy with the subject
 * as `decided_by`; flagMessage let the subject write the only narrative a later
 * reader sees and choose its severity.
 *
 * Now a caller who is the copy's sender or receiver is refused on all three.
 * The refusal is not tier-exempt — the exchange-party guards in this same
 * controller refuse an administrator too.
 *
 * Adapted from `.local-docs-archive/security-log/E-069/repro/i/I1BrokerReviewsMessageCopyAboutThemselvesTest.php`
 * and `repro/m/M3BrokerFlagsOwnMessageCopyTest.php`, which asserted the harm;
 * the attack assertions are inverted.
 */
final class F403BrokerCannotReviewOwnMonitoredMessageTest extends TestCase
{
    use DatabaseTransactions;

    public function test_broker_cannot_mark_the_copy_of_their_own_sent_message_reviewed(): void
    {
        $broker = $this->staff('broker');
        $copyId = $this->messageCopy((int) $broker->id, (int) $this->member()->id);

        $unreviewedBefore = $this->unreviewedCount();

        Sanctum::actingAs($broker);
        $this->apiPost("/v2/admin/broker/messages/{$copyId}/review", ['notes' => 'nothing to see'])
            ->assertStatus(403);

        $row = DB::table('broker_message_copies')->where('id', $copyId)->first();
        $this->assertNull($row->reviewed_at, 'the copy is still unreviewed');
        $this->assertNull($row->reviewed_by);
        $this->assertNull($row->review_notes, 'the subject did not write the case note');
        $this->assertSame($unreviewedBefore, $this->unreviewedCount(), 'it is still in the review queue');
    }

    public function test_broker_cannot_mark_the_copy_of_a_message_sent_to_them_reviewed(): void
    {
        $broker = $this->staff('broker');
        $copyId = $this->messageCopy((int) $this->member()->id, (int) $broker->id);

        Sanctum::actingAs($broker);
        $this->apiPost("/v2/admin/broker/messages/{$copyId}/review", ['notes' => 'nothing to see'])
            ->assertStatus(403);

        $this->assertNull(
            DB::table('broker_message_copies')->where('id', $copyId)->value('reviewed_at'),
            'the receiver is as much the subject of the monitoring as the sender'
        );
    }

    public function test_broker_cannot_approve_and_archive_the_copy_of_their_own_message(): void
    {
        $broker = $this->staff('broker');
        $copyId = $this->messageCopy((int) $broker->id, (int) $this->member()->id);

        Sanctum::actingAs($broker);
        $this->apiPost("/v2/admin/broker/messages/{$copyId}/approve", ['notes' => 'self approved'])
            ->assertStatus(403);

        $row = DB::table('broker_message_copies')->where('id', $copyId)->first();
        $this->assertNull($row->archived_at, 'the copy was not archived');
        $this->assertNull($row->archive_id);
        $this->assertNull($row->reviewed_at);
        $this->assertSame(
            0,
            DB::table('broker_review_archives')->where('broker_copy_id', $copyId)->count(),
            'no archive names the subject as the decision-maker'
        );
    }

    public function test_broker_cannot_flag_the_copy_of_their_own_message(): void
    {
        $broker = $this->staff('broker');
        $copyId = $this->messageCopy((int) $broker->id, (int) $this->member()->id);

        Sanctum::actingAs($broker);
        $this->apiPost("/v2/admin/broker/messages/{$copyId}/flag", [
            'reason' => 'nothing of concern here', 'severity' => 'info',
        ])->assertStatus(403);

        $row = DB::table('broker_message_copies')->where('id', $copyId)->first();
        $this->assertSame(0, (int) $row->flagged, 'the subject did not file their own copy');
        $this->assertNull($row->flag_reason, 'the subject did not author the narrative');
        $this->assertNull($row->reviewed_at, 'and the copy did not leave the unreviewed queue');
    }

    public function test_an_administrator_is_refused_on_their_own_message_copy_too(): void
    {
        $admin = $this->admin();
        $copyId = $this->messageCopy((int) $admin->id, (int) $this->member()->id);

        Sanctum::actingAs($admin);
        $this->apiPost("/v2/admin/broker/messages/{$copyId}/review", ['notes' => 'fine'])->assertStatus(403);

        $this->assertNull(
            DB::table('broker_message_copies')->where('id', $copyId)->value('reviewed_at'),
            'the conflict-of-interest line the exchange routes draw for admins applies here too'
        );
    }

    public function test_control_a_broker_may_still_review_someone_elses_message_copy(): void
    {
        $broker = $this->staff('broker');
        $copyId = $this->messageCopy((int) $this->member()->id, (int) $this->member()->id);

        Sanctum::actingAs($broker);
        $this->apiPost("/v2/admin/broker/messages/{$copyId}/review", ['notes' => 'ordinary moderation'])
            ->assertStatus(200);

        $row = DB::table('broker_message_copies')->where('id', $copyId)->first();
        $this->assertSame((int) $broker->id, (int) $row->reviewed_by);
        $this->assertNotNull($row->reviewed_at);
    }

    public function test_control_a_broker_may_still_approve_and_flag_someone_elses_message_copy(): void
    {
        $broker = $this->staff('broker');
        $flagId = $this->messageCopy((int) $this->member()->id, (int) $this->member()->id);
        $approveId = $this->messageCopy((int) $this->member()->id, (int) $this->member()->id);

        Sanctum::actingAs($broker);
        $this->apiPost("/v2/admin/broker/messages/{$flagId}/flag", [
            'reason' => 'needs a second look', 'severity' => 'concern',
        ])->assertStatus(200);
        $this->apiPost("/v2/admin/broker/messages/{$approveId}/approve", ['notes' => 'no concern'])
            ->assertStatus(200);

        $this->assertSame(1, (int) DB::table('broker_message_copies')->where('id', $flagId)->value('flagged'));
        $this->assertNotNull(
            DB::table('broker_message_copies')->where('id', $approveId)->value('archive_id'),
            'ordinary moderation is unaffected — only the subject is refused'
        );
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    private function staff(string $role): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'role' => $role, 'status' => 'active', 'is_approved' => 1,
        ]);
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => 1]);
    }

    private function admin(): User
    {
        return User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
    }

    private function unreviewedCount(): int
    {
        return (int) DB::table('broker_message_copies')
            ->where('tenant_id', $this->testTenantId)
            ->whereNull('reviewed_at')
            ->count();
    }

    /** A message plus the broker copy the monitoring rules would have taken of it. */
    private function messageCopy(int $senderId, int $receiverId): int
    {
        $messageId = (int) DB::table('messages')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $senderId,
            'receiver_id' => $receiverId,
            'subject' => 'F403 fixture',
            'body' => 'F403 fixture body',
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
            'message_body' => 'F403 fixture body',
            'sent_at' => now(),
            'copy_reason' => 'flagged_user',
            'flagged' => 0,
            'created_at' => now(),
        ]);
    }
}
