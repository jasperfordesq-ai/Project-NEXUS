<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services\Verein;

use Tests\Laravel\TestCase;
use App\Services\Verein\VereinFederationService;
use App\Core\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use InvalidArgumentException;
use RuntimeException;

/**
 * VereinFederationServiceTest
 *
 * Tests the public surface of VereinFederationService:
 *   - setConsent() / getConsent()   (scope upsert, validation, default)
 *   - getNetworkVereine()            (municipality filter, inactive exclusion)
 *   - shareEvent() / withdrawEventShare() / getSharedEvents()
 *   - sendCrossInvitation() / respondToInvitation() / listInvitationsForUser()
 *   - expireOldInvitations()
 *
 * IDs use the 99500+ range to avoid collisions with tenant-2 data.
 * MAIL_MAILER=array prevents SMTP hangs.
 * DatabaseTransactions rolls back every test.
 *
 * Skipped: email sending side-effects (best-effort in service, caught internally).
 * getMunicipalityCalendar() skipped: joins on events.user_id=vol_organizations.user_id
 * which requires a fully-seeded events row — covered by integration tests.
 */
class VereinFederationServiceTest extends TestCase
{
    use DatabaseTransactions;

    private VereinFederationService $svc;
    private int $tenantId = 2; // hour-timebank test tenant

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        TenantContext::setById($this->tenantId);
        $this->svc = new VereinFederationService();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Insert a vol_organizations row of org_type='club' and return its id.
     */
    private function insertVerein(string $name = 'Test Verein', string $municipality = 'MU01'): int
    {
        static $vc = 0;
        $vc++;
        $userId = $this->insertUser();

        $id = DB::table('vol_organizations')->insertGetId([
            'tenant_id'   => $this->tenantId,
            'user_id'     => $userId,
            'name'        => $name . ' #' . $vc,
            'slug'        => 'verein-' . $vc . '-' . substr(md5((string) microtime(true)), 0, 6),
            'org_type'    => 'club',
            'status'      => 'active',
            'created_at'  => now(),
            'updated_at'  => now(),
        ]);

        return (int) $id;
    }

    /**
     * Insert a minimal users row and return its id.
     */
    private function insertUser(string $suffix = ''): int
    {
        static $uc = 0;
        $uc++;
        return (int) DB::table('users')->insertGetId([
            'tenant_id'   => $this->tenantId,
            'name'        => 'Verein User ' . $uc . $suffix,
            'first_name'  => 'Verein',
            'last_name'   => 'User' . $uc,
            'email'       => 'vereinuser.' . $uc . $suffix . '@test.test',
            'status'      => 'active',
            'role'        => 'member',
            'is_approved' => 1,
            'balance'     => 0,
            'created_at'  => now(),
            'updated_at'  => now(),
        ]);
    }

    /**
     * Insert an org_members row to make a user an active 'volunteer' of an org.
     */
    private function joinOrg(int $userId, int $orgId): void
    {
        DB::table('org_members')->insertOrIgnore([
            'tenant_id'       => $this->tenantId,
            'organization_id' => $orgId,
            'org_type'        => 'volunteer',
            'user_id'         => $userId,
            'role'            => 'member',
            'status'          => 'active',
            'created_at'      => now(),
            'updated_at'      => now(),
        ]);
    }

    /**
     * Insert an events row and return its id.
     */
    private function insertEvent(int $userId): int
    {
        return (int) DB::table('events')->insertGetId([
            'tenant_id'  => $this->tenantId,
            'user_id'    => $userId,
            'title'      => 'Test Event ' . mt_rand(1000, 9999),
            'start_time' => now()->addDays(3),
            'status'     => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    // ── setConsent / getConsent ────────────────────────────────────────────────

    public function test_getConsent_returns_default_none_when_no_row_exists(): void
    {
        $vereinId = $this->insertVerein('No Consent Verein');

        $result = $this->svc->getConsent($vereinId);

        $this->assertSame($vereinId, $result['organization_id']);
        $this->assertSame('none', $result['sharing_scope']);
        $this->assertFalse($result['is_active']);
    }

    public function test_setConsent_throws_on_non_existent_verein(): void
    {
        $this->expectException(InvalidArgumentException::class);

        $this->svc->setConsent(999999997, 'events', 'MU01');
    }

    public function test_setConsent_throws_on_invalid_scope(): void
    {
        $vereinId = $this->insertVerein('Invalid Scope Verein');

        $this->expectException(InvalidArgumentException::class);

        $this->svc->setConsent($vereinId, 'invalid_scope', 'MU01');
    }

    public function test_setConsent_persists_events_scope_and_is_active(): void
    {
        $vereinId = $this->insertVerein('Events Verein');

        $result = $this->svc->setConsent($vereinId, 'events', 'MU01');

        $this->assertSame('events', $result['sharing_scope']);
        $this->assertTrue($result['is_active']);
        $this->assertSame('MU01', $result['municipality_code']);
    }

    public function test_setConsent_scope_none_marks_is_active_false(): void
    {
        $vereinId = $this->insertVerein('Inactive Verein');

        // First enable
        $this->svc->setConsent($vereinId, 'events', 'MU01');

        // Then opt-out
        $result = $this->svc->setConsent($vereinId, 'none', 'MU01');

        $this->assertFalse($result['is_active']);
        $this->assertSame('none', $result['sharing_scope']);
    }

    public function test_setConsent_is_idempotent_on_double_call(): void
    {
        $vereinId = $this->insertVerein('Idempotent Verein');

        $this->svc->setConsent($vereinId, 'both', 'MU02');
        $result = $this->svc->setConsent($vereinId, 'both', 'MU02');

        // Only one row in DB
        $count = DB::table('verein_federation_consents')
            ->where('organization_id', $vereinId)
            ->count();
        $this->assertSame(1, $count);
        $this->assertSame('both', $result['sharing_scope']);
    }

    // ── getNetworkVereine ─────────────────────────────────────────────────────

    public function test_getNetworkVereine_returns_empty_when_self_has_no_consent(): void
    {
        $vereinId = $this->insertVerein('No Net Verein');

        $result = $this->svc->getNetworkVereine($vereinId);

        $this->assertSame([], $result);
    }

    public function test_getNetworkVereine_returns_other_active_vereine_in_same_municipality(): void
    {
        $v1 = $this->insertVerein('Net Verein A');
        $v2 = $this->insertVerein('Net Verein B');

        $muni = 'MU-NET-' . mt_rand(1000, 9999);
        $this->svc->setConsent($v1, 'events', $muni);
        $this->svc->setConsent($v2, 'events', $muni);

        $network = $this->svc->getNetworkVereine($v1);

        $ids = array_column($network, 'organization_id');
        $this->assertContains($v2, $ids);
        $this->assertNotContains($v1, $ids); // self excluded
    }

    public function test_getNetworkVereine_excludes_vereine_with_inactive_consent(): void
    {
        $v1 = $this->insertVerein('Active Net Verein');
        $v2 = $this->insertVerein('Inactive Net Verein');

        $muni = 'MU-INACT-' . mt_rand(1000, 9999);
        $this->svc->setConsent($v1, 'events', $muni);
        $this->svc->setConsent($v2, 'none', $muni); // opted out

        $network = $this->svc->getNetworkVereine($v1);

        $ids = array_column($network, 'organization_id');
        $this->assertNotContains($v2, $ids);
    }

    // ── shareEvent ────────────────────────────────────────────────────────────

    public function test_shareEvent_throws_when_event_not_found(): void
    {
        $sourceId = $this->insertVerein('Source Verein');
        $this->svc->setConsent($sourceId, 'events', 'MU-SH01');

        $this->expectException(InvalidArgumentException::class);

        $actorId = (int) DB::table('vol_organizations')->where('id', $sourceId)->value('user_id');
        $this->svc->shareEvent(999999999, [$sourceId], $sourceId, $actorId);
    }

    public function test_shareEvent_throws_when_source_not_consenting(): void
    {
        $sourceId = $this->insertVerein('Non-Consenting Source');
        $targetId = $this->insertVerein('Target');

        $userId  = DB::table('vol_organizations')->where('id', $sourceId)->value('user_id');
        $eventId = $this->insertEvent((int) $userId);

        $this->expectException(RuntimeException::class);

        $this->svc->shareEvent($eventId, [$targetId], $sourceId, (int) $userId);
    }

    public function test_shareEvent_returns_shared_count(): void
    {
        $muni     = 'MU-SH-' . mt_rand(1000, 9999);
        $sourceId = $this->insertVerein('Share Source');
        $targetId = $this->insertVerein('Share Target');

        $this->svc->setConsent($sourceId, 'events', $muni);
        $this->svc->setConsent($targetId, 'events', $muni);

        $userId  = DB::table('vol_organizations')->where('id', $sourceId)->value('user_id');
        $eventId = $this->insertEvent((int) $userId);

        $result = $this->svc->shareEvent($eventId, [$targetId], $sourceId, (int) $userId);

        $this->assertSame(1, $result['shared']);
        $this->assertSame(0, $result['skipped']);
    }

    public function test_shareEvent_skips_duplicate_active_share(): void
    {
        $muni     = 'MU-DUP-' . mt_rand(1000, 9999);
        $sourceId = $this->insertVerein('Dup Source');
        $targetId = $this->insertVerein('Dup Target');

        $this->svc->setConsent($sourceId, 'events', $muni);
        $this->svc->setConsent($targetId, 'events', $muni);

        $userId  = DB::table('vol_organizations')->where('id', $sourceId)->value('user_id');
        $eventId = $this->insertEvent((int) $userId);

        $this->svc->shareEvent($eventId, [$targetId], $sourceId, (int) $userId);
        $result = $this->svc->shareEvent($eventId, [$targetId], $sourceId, (int) $userId);

        $this->assertSame(0, $result['shared']);
        $this->assertSame(1, $result['skipped']);
    }

    public function test_shareEvent_skips_source_as_target(): void
    {
        $muni     = 'MU-SELF-' . mt_rand(1000, 9999);
        $sourceId = $this->insertVerein('Self Source');

        $this->svc->setConsent($sourceId, 'events', $muni);

        $userId  = DB::table('vol_organizations')->where('id', $sourceId)->value('user_id');
        $eventId = $this->insertEvent((int) $userId);

        $result = $this->svc->shareEvent($eventId, [$sourceId], $sourceId, (int) $userId);

        $this->assertSame(0, $result['shared']);
        $this->assertSame(1, $result['skipped']);
    }

    // ── withdrawEventShare ────────────────────────────────────────────────────

    public function test_withdrawEventShare_returns_true_and_changes_status(): void
    {
        $muni     = 'MU-WD-' . mt_rand(1000, 9999);
        $sourceId = $this->insertVerein('Withdraw Source');
        $targetId = $this->insertVerein('Withdraw Target');

        $this->svc->setConsent($sourceId, 'events', $muni);
        $this->svc->setConsent($targetId, 'events', $muni);

        $userId  = DB::table('vol_organizations')->where('id', $sourceId)->value('user_id');
        $eventId = $this->insertEvent((int) $userId);

        $this->svc->shareEvent($eventId, [$targetId], $sourceId, (int) $userId);

        $shareId = DB::table('verein_event_shares')
            ->where('tenant_id', $this->tenantId)
            ->where('event_id', $eventId)
            ->where('target_organization_id', $targetId)
            ->value('id');

        $this->assertNotNull($shareId);

        $ok = $this->svc->withdrawEventShare((int) $shareId, $sourceId);

        $this->assertTrue($ok);

        $status = DB::table('verein_event_shares')->where('id', $shareId)->value('status');
        $this->assertSame('withdrawn', $status);
    }

    public function test_withdrawEventShare_returns_false_for_wrong_source(): void
    {
        $muni     = 'MU-WDWRONG-' . mt_rand(1000, 9999);
        $sourceId = $this->insertVerein('Wrong Withdraw Source');
        $targetId = $this->insertVerein('Wrong Withdraw Target');

        $this->svc->setConsent($sourceId, 'events', $muni);
        $this->svc->setConsent($targetId, 'events', $muni);

        $userId  = DB::table('vol_organizations')->where('id', $sourceId)->value('user_id');
        $eventId = $this->insertEvent((int) $userId);

        $this->svc->shareEvent($eventId, [$targetId], $sourceId, (int) $userId);

        $shareId = DB::table('verein_event_shares')
            ->where('tenant_id', $this->tenantId)
            ->where('event_id', $eventId)
            ->value('id');

        $wrongSourceId = $this->insertVerein('Imposter');
        $ok            = $this->svc->withdrawEventShare((int) $shareId, $wrongSourceId);

        $this->assertFalse($ok);
    }

    // ── sendCrossInvitation ────────────────────────────────────────────────────

    public function test_sendCrossInvitation_throws_when_member_sharing_disabled(): void
    {
        $sourceId = $this->insertVerein('No Members Source');
        $targetId = $this->insertVerein('No Members Target');
        // consent with events-only (not members)
        $muni = 'MU-NOMS-' . mt_rand(1000, 9999);
        $this->svc->setConsent($sourceId, 'events', $muni);
        $this->svc->setConsent($targetId, 'events', $muni);

        $inviterId  = $this->insertUser();
        $inviteeId  = $this->insertUser();

        $this->expectException(RuntimeException::class);

        $this->svc->sendCrossInvitation($sourceId, $targetId, $inviterId, $inviteeId, null);
    }

    public function test_sendCrossInvitation_throws_when_invitee_not_member_of_source(): void
    {
        $muni     = 'MU-NOTM-' . mt_rand(1000, 9999);
        $sourceId = $this->insertVerein('Source (notmember)');
        $targetId = $this->insertVerein('Target (notmember)');

        $this->svc->setConsent($sourceId, 'members', $muni);
        $this->svc->setConsent($targetId, 'members', $muni);

        $inviterId = $this->insertUser();
        $inviteeId = $this->insertUser(); // NOT joined to sourceId

        $this->joinOrg($inviterId, $sourceId); // inviter IS a member; invitee is not

        $this->expectException(InvalidArgumentException::class);

        $this->svc->sendCrossInvitation($sourceId, $targetId, $inviterId, $inviteeId, null);
    }

    public function test_sendCrossInvitation_persists_invitation_with_sent_status(): void
    {
        $muni     = 'MU-CINV-' . mt_rand(1000, 9999);
        $sourceId = $this->insertVerein('Cross Inv Source');
        $targetId = $this->insertVerein('Cross Inv Target');

        $this->svc->setConsent($sourceId, 'members', $muni);
        $this->svc->setConsent($targetId, 'members', $muni);

        $inviterId = $this->insertUser();
        $inviteeId = $this->insertUser();

        $this->joinOrg($inviterId, $sourceId);
        $this->joinOrg($inviteeId, $sourceId);

        $invitation = $this->svc->sendCrossInvitation($sourceId, $targetId, $inviterId, $inviteeId, 'Please join!');

        $this->assertSame('sent', $invitation['status']);
        $this->assertSame($sourceId, $invitation['source_organization_id']);
        $this->assertSame($targetId, $invitation['target_organization_id']);
        $this->assertSame($inviteeId, $invitation['invitee_user_id']);
    }

    public function test_sendCrossInvitation_throws_when_inviter_not_member_of_source(): void
    {
        // Regression (audit M4): the inviter MUST belong to the source Verein.
        // Without this, any authenticated user could send invitations "from" a
        // club they have no relationship with.
        $muni     = 'MU-INVITER-' . mt_rand(1000, 9999);
        $sourceId = $this->insertVerein('Inviter Source');
        $targetId = $this->insertVerein('Inviter Target');

        $this->svc->setConsent($sourceId, 'members', $muni);
        $this->svc->setConsent($targetId, 'members', $muni);

        $inviterId = $this->insertUser(); // NOT joined to sourceId
        $inviteeId = $this->insertUser();
        $this->joinOrg($inviteeId, $sourceId); // invitee IS a member

        $this->expectException(InvalidArgumentException::class);

        $this->svc->sendCrossInvitation($sourceId, $targetId, $inviterId, $inviteeId, null);
    }

    // ── respondToInvitation ────────────────────────────────────────────────────

    public function test_respondToInvitation_accept_changes_status_to_accepted(): void
    {
        $muni     = 'MU-RESP-' . mt_rand(1000, 9999);
        $sourceId = $this->insertVerein('Resp Source');
        $targetId = $this->insertVerein('Resp Target');

        $this->svc->setConsent($sourceId, 'members', $muni);
        $this->svc->setConsent($targetId, 'members', $muni);

        $inviterId = $this->insertUser();
        $inviteeId = $this->insertUser();

        $this->joinOrg($inviterId, $sourceId);
        $this->joinOrg($inviteeId, $sourceId);

        $invitation = $this->svc->sendCrossInvitation($sourceId, $targetId, $inviterId, $inviteeId, null);

        $result = $this->svc->respondToInvitation($invitation['id'], $inviteeId, 'accept');

        $this->assertSame('accepted', $result['status']);
    }

    public function test_respondToInvitation_decline_changes_status_to_declined(): void
    {
        $muni     = 'MU-DEC-' . mt_rand(1000, 9999);
        $sourceId = $this->insertVerein('Decline Source');
        $targetId = $this->insertVerein('Decline Target');

        $this->svc->setConsent($sourceId, 'members', $muni);
        $this->svc->setConsent($targetId, 'members', $muni);

        $inviterId = $this->insertUser();
        $inviteeId = $this->insertUser();

        $this->joinOrg($inviterId, $sourceId);
        $this->joinOrg($inviteeId, $sourceId);

        $invitation = $this->svc->sendCrossInvitation($sourceId, $targetId, $inviterId, $inviteeId, null);

        $result = $this->svc->respondToInvitation($invitation['id'], $inviteeId, 'decline');

        $this->assertSame('declined', $result['status']);
    }

    public function test_respondToInvitation_throws_on_invalid_action(): void
    {
        $muni     = 'MU-INVACT-' . mt_rand(1000, 9999);
        $sourceId = $this->insertVerein('InvAct Source');
        $targetId = $this->insertVerein('InvAct Target');

        $this->svc->setConsent($sourceId, 'both', $muni);
        $this->svc->setConsent($targetId, 'both', $muni);

        $inviterId = $this->insertUser();
        $inviteeId = $this->insertUser();

        $this->joinOrg($inviterId, $sourceId);
        $this->joinOrg($inviteeId, $sourceId);

        $invitation = $this->svc->sendCrossInvitation($sourceId, $targetId, $inviterId, $inviteeId, null);

        $this->expectException(InvalidArgumentException::class);

        $this->svc->respondToInvitation($invitation['id'], $inviteeId, 'maybe');
    }

    public function test_respondToInvitation_throws_when_already_responded(): void
    {
        $muni     = 'MU-DBLRESP-' . mt_rand(1000, 9999);
        $sourceId = $this->insertVerein('DblResp Source');
        $targetId = $this->insertVerein('DblResp Target');

        $this->svc->setConsent($sourceId, 'members', $muni);
        $this->svc->setConsent($targetId, 'members', $muni);

        $inviterId = $this->insertUser();
        $inviteeId = $this->insertUser();

        $this->joinOrg($inviterId, $sourceId);
        $this->joinOrg($inviteeId, $sourceId);

        $invitation = $this->svc->sendCrossInvitation($sourceId, $targetId, $inviterId, $inviteeId, null);
        $this->svc->respondToInvitation($invitation['id'], $inviteeId, 'accept');

        $this->expectException(RuntimeException::class);

        $this->svc->respondToInvitation($invitation['id'], $inviteeId, 'decline');
    }

    // ── listInvitationsForUser ─────────────────────────────────────────────────

    public function test_listInvitationsForUser_returns_invitation_for_invitee(): void
    {
        $muni     = 'MU-LST-' . mt_rand(1000, 9999);
        $sourceId = $this->insertVerein('List Source');
        $targetId = $this->insertVerein('List Target');

        $this->svc->setConsent($sourceId, 'both', $muni);
        $this->svc->setConsent($targetId, 'both', $muni);

        $inviterId = $this->insertUser();
        $inviteeId = $this->insertUser();

        $this->joinOrg($inviterId, $sourceId);
        $this->joinOrg($inviteeId, $sourceId);

        $this->svc->sendCrossInvitation($sourceId, $targetId, $inviterId, $inviteeId, null);

        $list = $this->svc->listInvitationsForUser($inviteeId);

        $inviteeIds = array_column($list, 'id');
        $this->assertNotEmpty($list);
        $statuses = array_column($list, 'status');
        // All statuses should be known values
        foreach ($statuses as $s) {
            $this->assertContains($s, ['sent', 'accepted', 'declined', 'expired']);
        }
    }

    // ── expireOldInvitations ──────────────────────────────────────────────────

    public function test_expireOldInvitations_marks_overdue_invitations_expired(): void
    {
        $muni     = 'MU-EXP-' . mt_rand(1000, 9999);
        $sourceId = $this->insertVerein('Expire Source');
        $targetId = $this->insertVerein('Expire Target');

        $this->svc->setConsent($sourceId, 'members', $muni);
        $this->svc->setConsent($targetId, 'members', $muni);

        $inviteeId = $this->insertUser();
        $this->joinOrg($inviteeId, $sourceId);

        // Directly insert an already-expired invitation
        $pastExpiry = now()->subDays(5);
        $invId = DB::table('verein_cross_invitations')->insertGetId([
            'source_organization_id' => $sourceId,
            'target_organization_id' => $targetId,
            'tenant_id'   => $this->tenantId,
            'inviter_user_id' => $this->insertUser(),
            'invitee_user_id' => $inviteeId,
            'status'      => 'sent',
            'sent_at'     => $pastExpiry,
            'expires_at'  => $pastExpiry,
            'created_at'  => $pastExpiry,
            'updated_at'  => $pastExpiry,
        ]);

        $count = $this->svc->expireOldInvitations();

        $this->assertGreaterThanOrEqual(1, $count);

        $status = DB::table('verein_cross_invitations')->where('id', $invId)->value('status');
        $this->assertSame('expired', $status);
    }

    public function test_expireOldInvitations_does_not_expire_non_sent(): void
    {
        // An already-accepted invitation should NOT be expired
        $muni     = 'MU-NOEXP-' . mt_rand(1000, 9999);
        $sourceId = $this->insertVerein('NoExp Source');
        $targetId = $this->insertVerein('NoExp Target');

        $inviteeId = $this->insertUser();
        $this->joinOrg($inviteeId, $sourceId);

        $pastExpiry = now()->subDays(10);
        $invId = DB::table('verein_cross_invitations')->insertGetId([
            'source_organization_id' => $sourceId,
            'target_organization_id' => $targetId,
            'tenant_id'   => $this->tenantId,
            'inviter_user_id' => $this->insertUser(),
            'invitee_user_id' => $inviteeId,
            'status'      => 'accepted',  // already responded
            'sent_at'     => $pastExpiry,
            'expires_at'  => $pastExpiry,
            'created_at'  => $pastExpiry,
            'updated_at'  => $pastExpiry,
        ]);

        $this->svc->expireOldInvitations();

        $status = DB::table('verein_cross_invitations')->where('id', $invId)->value('status');
        $this->assertSame('accepted', $status); // unchanged
    }
}
