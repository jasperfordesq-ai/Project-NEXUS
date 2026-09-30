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
 * F-456 (E-073) — the per-member safeguarding audit trail, read by its own
 * subject.
 *
 * `AdminSafeguardingController::memberActivity()` (:789-829) and
 * `memberActivityCsv()` (:837-889) — GET /v2/admin/safeguarding/members/
 * {userId}/activity and …/activity.csv, routes/api.php:3050-3051 — never
 * compared `{userId}` with the caller. `memberActivity()` writes an
 * `activity_log` row on EVERY view, and `collectMemberAuditEvents()` returns
 * every such row keyed to the subject with the actor's name resolved. So an
 * administrator calling either route on their own id was shown which
 * colleagues had opened their safeguarding record and when, plus the fact that
 * their own messages were being copied and under which `copy_reason`.
 * Oversight of an administrator stops being covert the moment the
 * administrator can enumerate it.
 *
 * These routes are an oversight tool, not a self-service one, so the fix
 * REFUSES the self-request outright (403) rather than serving a redacted
 * trail: a partial trail still confirms that a record exists and how much of
 * it was withheld.
 *
 * 🔴 The CSV export is a second door onto the same collector. A fix applied to
 * the JSON route alone would close nothing, so both are covered here.
 *
 * 🔴 `account_relationships.staff_notes` also appears in that response and is
 * NOT a disclosure — the member-facing route already gives a supported member
 * their own staff notes by design. The last control pins that it still does.
 *
 * Adapted from `.local-docs-archive/security-log/E-073/repro/h/H2SafeguardingReadPathsHandTheSubjectTheirOwnRecordTest.php`
 * (section B), which asserted the harm; the attack assertions are inverted.
 */
final class F456AdminCannotReadTheirOwnSafeguardingTrailTest extends TestCase
{
    use DatabaseTransactions;

    private const VIEWER_MARK = 'F456-COLLEAGUE-VIEW-MARKER';
    private const STAFF_NOTE = 'F456-STAFFNOTE-arranged-at-the-members-own-request';

    public function test_an_administrator_cannot_read_their_own_safeguarding_activity_trail(): void
    {
        $subjectAdmin = $this->staff('admin');
        $colleague = $this->staff('admin');
        $counterparty = $this->staff('member');

        $this->colleagueViewOf((int) $colleague->id, (int) $subjectAdmin->id);
        $this->flaggedCopy((int) $subjectAdmin->id, (int) $counterparty->id, (int) $colleague->id);

        Sanctum::actingAs($subjectAdmin, ['*']);
        $res = $this->apiGet("/v2/admin/safeguarding/members/{$subjectAdmin->id}/activity");

        self::assertSame(403, $res->getStatusCode(),
            'the safeguarding trail kept about the caller is not theirs to open. ' . $res->getContent());

        $body = (string) $res->getContent();
        self::assertStringNotContainsString(self::VIEWER_MARK, $body,
            'the caller is not told that a colleague opened their safeguarding record');
        self::assertStringNotContainsString((string) $colleague->name, $body,
            'nor which colleague it was');
        self::assertStringNotContainsString('flagged_user', $body,
            'nor that their own messages are being copied, nor why');
    }

    /**
     * The refused attempt must not write the view into the trail either: a
     * caller who could stamp their own record would both pollute the evidence
     * and learn, from a later legitimate read, that the route had been tried.
     */
    public function test_the_refused_self_read_is_not_recorded_as_a_view_of_the_record(): void
    {
        $subjectAdmin = $this->staff('admin');

        Sanctum::actingAs($subjectAdmin, ['*']);
        $this->apiGet("/v2/admin/safeguarding/members/{$subjectAdmin->id}/activity")
            ->assertStatus(403);

        self::assertSame(
            0,
            DB::table('activity_log')
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', $subjectAdmin->id)
                ->where('action', 'safeguarding_member_activity_viewed')
                ->where('entity_id', $subjectAdmin->id)
                ->count(),
            'no view row is written for a request that was refused'
        );
    }

    /**
     * 🔴 The whole point of the finding: the CSV export is the unguarded twin.
     */
    public function test_the_csv_export_refuses_the_same_self_read(): void
    {
        $subjectAdmin = $this->staff('admin');
        $colleague = $this->staff('admin');

        $this->colleagueViewOf((int) $colleague->id, (int) $subjectAdmin->id);

        Sanctum::actingAs($subjectAdmin, ['*']);
        $res = $this->apiGet("/v2/admin/safeguarding/members/{$subjectAdmin->id}/activity.csv");

        self::assertSame(403, $res->getStatusCode(),
            'the export is closed to the subject too. ' . $res->getContent());
        self::assertStringNotContainsString(self::VIEWER_MARK, (string) $res->getContent());

        self::assertSame(
            0,
            DB::table('activity_log')
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', $subjectAdmin->id)
                ->where('action', 'safeguarding_member_activity_exported')
                ->where('entity_id', $subjectAdmin->id)
                ->count(),
            'and no export row is written for a request that was refused'
        );
    }

    /**
     * CONTROL — the same administrator, on the same two routes, reading
     * ANOTHER member's trail. The attack variant differs only in whose id is
     * in the path, so this is what proves the fix is a guard and not a
     * removal of the oversight tool.
     */
    public function test_control_the_same_administrator_may_still_read_another_members_trail_json_and_csv(): void
    {
        $admin = $this->staff('admin');
        $other = $this->staff('member');
        $colleague = $this->staff('admin');

        $this->colleagueViewOf((int) $colleague->id, (int) $other->id);

        Sanctum::actingAs($admin, ['*']);

        $json = $this->apiGet("/v2/admin/safeguarding/members/{$other->id}/activity");
        self::assertSame(200, $json->getStatusCode(), (string) $json->getContent());
        self::assertSame((int) $other->id, (int) $json->json('data.member.id'));
        self::assertStringContainsString(self::VIEWER_MARK, (string) $json->getContent(),
            'CONTROL: legitimate oversight of another member is unaffected');

        $csv = $this->apiGet("/v2/admin/safeguarding/members/{$other->id}/activity.csv");
        self::assertSame(200, $csv->getStatusCode());
        self::assertStringContainsString(self::VIEWER_MARK, $csv->streamedContent(),
            'CONTROL: and so is the export of another member\'s trail');
    }

    /**
     * CONTROL — a supported member still reads the staff notes recorded on
     * their own guardian arrangement, through the member-facing route that has
     * always given them. The fix above must not take that away as a side
     * effect.
     */
    public function test_control_a_supported_member_still_reads_their_own_guardian_staff_notes(): void
    {
        $ward = $this->staff('member');
        $guardian = $this->staff('member');
        $staff = $this->staff('admin');

        DB::table('account_relationships')->insert([
            'parent_user_id' => $guardian->id,
            'child_user_id' => $ward->id,
            'tenant_id' => $this->testTenantId,
            'relationship_type' => 'guardian',
            'permissions' => json_encode(['can_view_activity' => true]),
            'status' => 'active',
            'proposed_by_user_id' => $staff->id,
            'staff_notes' => self::STAFF_NOTE,
            'approved_at' => now(),
            'created_at' => now(),
        ]);

        Sanctum::actingAs($ward, ['*']);
        $res = $this->apiGet('/v2/safeguarding/my-guardians');
        self::assertSame(200, $res->getStatusCode(), (string) $res->getContent());
        self::assertStringContainsString(self::STAFF_NOTE, (string) $res->getContent(),
            'CONTROL: the supported member still sees the notes about their own arrangement');
    }

    // ----- fixtures -----

    private function colleagueViewOf(int $actorId, int $subjectId): void
    {
        DB::table('activity_log')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $actorId,
            'action' => 'safeguarding_member_activity_viewed',
            'action_type' => 'safeguarding',
            'entity_type' => 'user',
            'entity_id' => $subjectId,
            'details' => json_encode(['marker' => self::VIEWER_MARK]),
            'created_at' => now(),
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

    private function flaggedCopy(int $senderId, int $receiverId, int $reviewerId): int
    {
        $messageId = (int) DB::table('messages')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $senderId,
            'receiver_id' => $receiverId,
            'subject' => 'F456 fixture',
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
            'reviewed_by' => $reviewerId,
            'reviewed_at' => now(),
            'created_at' => now(),
        ]);
    }
}
