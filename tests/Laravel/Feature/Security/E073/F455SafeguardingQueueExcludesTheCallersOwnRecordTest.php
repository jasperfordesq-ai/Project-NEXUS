<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E073;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-455 (E-073) — the fifth read path onto `broker_message_copies`.
 *
 * F-436 named four read methods on `AdminBrokerController`. It did not name
 * this one: `AdminSafeguardingController::flaggedMessages()`
 * (GET /v2/admin/safeguarding/flagged-messages, routes/api.php:3026). Its base
 * query had NO party filter at all, so every monitoring copy in the community
 * was returned — the caller's own included — carrying `copy_reason`, the
 * derived severity, the reviewing administrator's private `review_notes`, and
 * `reviewed_by` resolved to the reviewer's NAME.
 *
 * The prerequisite is narrower than F-436's: `requireSafeguardingStaff()`
 * correctly refuses a plain `broker` with 403, so the caller here must hold the
 * explicit `safeguarding.view` (or `.manage`) permission.
 *
 * The route is a work queue, so the fix excludes the caller's own rows rather
 * than refusing the request. These tests assert the CORRECT outcome: they fail
 * while the bug exists.
 *
 * Adapted from `.local-docs-archive/security-log/E-073/repro/h/H2SafeguardingReadPathsHandTheSubjectTheirOwnRecordTest.php`
 * (section A), which asserted the harm; the attack assertions are inverted.
 */
final class F455SafeguardingQueueExcludesTheCallersOwnRecordTest extends TestCase
{
    use DatabaseTransactions;

    private const CONCERN = 'F455-CONCERN-repeated-late-night-contact-with-a-supported-member';
    private const NOTES = 'F455-REVIEWNOTE-do-not-tell-the-subject-refer-to-the-safeguarding-lead';
    private const OTHER_NOTES = 'F455-OTHERNOTE-case-note-about-two-unrelated-members';

    /**
     * The subject of monitoring must not find their own record in the queue —
     * and, in the same response, must still see the record about two other
     * members, so the fix is a filter and not a removal of the feature.
     */
    public function test_the_queue_withholds_the_callers_own_record_as_sender_but_still_serves_the_rest(): void
    {
        $officer = $this->staff('broker');
        $counterparty = $this->staff('member');
        $reviewer = $this->staff('admin');
        $memberA = $this->staff('member');
        $memberB = $this->staff('member');

        $this->grantSafeguardingView((int) $officer->id);

        $ownCopyId = $this->flaggedCopy((int) $officer->id, (int) $counterparty->id, (int) $reviewer->id);
        $otherCopyId = $this->flaggedCopy(
            (int) $memberA->id,
            (int) $memberB->id,
            (int) $reviewer->id,
            self::OTHER_NOTES
        );

        Sanctum::actingAs($officer, ['*']);
        $res = $this->apiGet('/v2/admin/safeguarding/flagged-messages?limit=200');

        self::assertSame(200, $res->getStatusCode(),
            'the queue still answers for a safeguarding.view holder. ' . $res->getContent());

        $ids = array_map(static fn ($r) => (int) $r['id'], $res->json('data') ?? []);

        self::assertNotContains($ownCopyId, $ids,
            'the subject of covert monitoring is not served their own monitoring record');
        self::assertStringNotContainsString(self::NOTES, (string) $res->getContent(),
            'and the reviewing administrator\'s private note about them is nowhere in the body');

        // CONTROL, in the same response: legitimate monitoring is unaffected.
        self::assertContains($otherCopyId, $ids,
            'CONTROL: the same caller still receives the copies about other members');
        self::assertStringContainsString(self::OTHER_NOTES, (string) $res->getContent(),
            'CONTROL: with the case note, which is what makes the queue useful');
    }

    /**
     * Being the RECEIVER of the copied message is the same disclosure. The
     * guard must cover both ends of the conversation.
     */
    public function test_the_queue_withholds_the_callers_own_record_as_receiver(): void
    {
        $officer = $this->staff('broker');
        $counterparty = $this->staff('member');
        $reviewer = $this->staff('admin');

        $this->grantSafeguardingView((int) $officer->id);

        $ownCopyId = $this->flaggedCopy((int) $counterparty->id, (int) $officer->id, (int) $reviewer->id);

        Sanctum::actingAs($officer, ['*']);
        $res = $this->apiGet('/v2/admin/safeguarding/flagged-messages?limit=200');
        self::assertSame(200, $res->getStatusCode(), (string) $res->getContent());

        $ids = array_map(static fn ($r) => (int) $r['id'], $res->json('data') ?? []);
        self::assertNotContains($ownCopyId, $ids,
            'a copy of a message sent TO the caller is withheld from them too');
        self::assertStringNotContainsString(self::NOTES, (string) $res->getContent());
    }

    /**
     * The paging total must be filtered as well. If only the page were
     * filtered, the row would simply reappear on another page — and the count
     * would still tell the subject that a record about them exists.
     */
    public function test_the_paging_total_is_filtered_too_so_the_row_cannot_reappear_on_another_page(): void
    {
        $subject = $this->staff('broker');
        $bystander = $this->staff('broker');
        $counterparty = $this->staff('member');
        $reviewer = $this->staff('admin');

        $this->grantSafeguardingView((int) $subject->id);
        $this->grantSafeguardingView((int) $bystander->id);

        $this->flaggedCopy((int) $subject->id, (int) $counterparty->id, (int) $reviewer->id);

        Sanctum::actingAs($subject, ['*']);
        $subjectTotal = (int) $this->apiGet('/v2/admin/safeguarding/flagged-messages?limit=1')
            ->json('meta.total');

        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($bystander, ['*']);
        $bystanderTotal = (int) $this->apiGet('/v2/admin/safeguarding/flagged-messages?limit=1')
            ->json('meta.total');

        self::assertSame($bystanderTotal - 1, $subjectTotal,
            'the subject\'s own row is removed from the count as well as from the page');
    }

    /**
     * CONTROL — the record about the subject is still there for everyone else.
     * The fix hides a row from one caller; it does not delete safeguarding
     * evidence or hide it from the staff who need it.
     */
    public function test_control_another_safeguarding_officer_still_reads_the_record_about_the_subject(): void
    {
        $subject = $this->staff('broker');
        $bystander = $this->staff('broker');
        $counterparty = $this->staff('member');
        $reviewer = $this->staff('admin');

        $this->grantSafeguardingView((int) $bystander->id);

        $copyId = $this->flaggedCopy((int) $subject->id, (int) $counterparty->id, (int) $reviewer->id);

        Sanctum::actingAs($bystander, ['*']);
        $res = $this->apiGet('/v2/admin/safeguarding/flagged-messages?limit=200');
        self::assertSame(200, $res->getStatusCode(), (string) $res->getContent());

        $ids = array_map(static fn ($r) => (int) $r['id'], $res->json('data') ?? []);
        self::assertContains($copyId, $ids,
            'CONTROL: a colleague who is not a party still receives the monitoring record');
        self::assertStringContainsString(self::NOTES, (string) $res->getContent(),
            'CONTROL: including the case note, which is the point of the queue');
    }

    // ----- fixtures -----

    /**
     * `requireSafeguardingStaff()` admits admin tiers outright and otherwise
     * requires the explicit `safeguarding.view` / `safeguarding.manage`
     * permission. A plain `broker` is refused 403, so the non-admin
     * safeguarding officer this route exists for must be granted it.
     */
    private function grantSafeguardingView(int $userId): void
    {
        $permId = DB::table('permissions')->where('name', 'safeguarding.view')->value('id');
        if ($permId === null) {
            $permId = DB::table('permissions')->insertGetId([
                'name' => 'safeguarding.view',
                'display_name' => 'View safeguarding',
                'category' => 'safeguarding',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
        DB::table('user_permissions')->insert([
            'user_id' => $userId,
            'permission_id' => $permId,
            'granted' => 1,
            'tenant_id' => $this->testTenantId,
            'granted_at' => now(),
        ]);
    }

    private function staff(string $role): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        DB::table('users')->where('id', $u->id)->update([
            'role' => $role,
            'is_admin' => $role === 'admin' ? 1 : 0,
        ]);

        return User::find($u->id);
    }

    private function flaggedCopy(int $senderId, int $receiverId, int $reviewerId, string $notes = self::NOTES): int
    {
        $messageId = (int) DB::table('messages')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $senderId,
            'receiver_id' => $receiverId,
            'subject' => 'F455 fixture',
            'body' => 'synthetic fixture body',
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
            'message_body' => 'synthetic fixture body',
            'sent_at' => now(),
            'copy_reason' => 'flagged_user',
            'flagged' => 1,
            'flag_reason' => self::CONCERN,
            'flag_severity' => 'urgent',
            'reviewed_by' => $reviewerId,
            'reviewed_at' => now(),
            'review_notes' => $notes,
            'created_at' => now(),
        ]);
    }
}
