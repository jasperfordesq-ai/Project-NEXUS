<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E073;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-436 (E-073 C-1) — the read side of F-403.
 *
 * `AdminBrokerController::guardNotMessageParty()` (:1240-1246) was applied to
 * the three WRITE methods on `broker_message_copies` and to none of the reads,
 * so the subject of safeguarding monitoring — when that subject holds the
 * `broker` role and so reaches `/v2/admin/broker/*` — could read the
 * assessment written about them: `copy_reason`, `flagged`, `flag_reason`,
 * `flag_severity`, the reviewing administrator's private `review_notes` and
 * `reviewed_by`, plus the archived `decision_notes` / `decided_by_name`.
 *
 * Also covered here, under the same finding: `showExchange()` (:481), the
 * broker-reachable exchange read E-073 slice H noted and nobody drove. It
 * publishes `listing_risk_tags.*` for the exchange's listing — including
 * `risk_notes`, which the schema itself labels "Internal broker notes" and
 * which no member-facing route anywhere discloses — plus the counterparty's
 * email address. The four exchange WRITE methods already refuse a party
 * (:593, :660, :786, :845); the read did not.
 *
 * 🔴 These assertions state the CORRECT outcome: they fail while the bug
 * exists and pass once the guard is applied. Each attack case is paired with a
 * legitimate-access control differing only in whether the caller is a party.
 */
final class BrokerSelfMonitoringReadGuardTest extends TestCase
{
    use DatabaseTransactions;

    /** Values a monitoring subject must never be shown about themselves. */
    private const CONCERN = 'F436-CONCERN-repeated-unsolicited-contact';
    private const NOTES = 'F436-REVIEWNOTE-escalate-to-safeguarding-lead';
    private const DECISION_NOTES = 'F436-DECISION-keep-under-observation';
    private const RISK_NOTES = 'F436-RISKNOTE-owner-has-no-insurance-cover';

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
        $this->app['auth']->forgetGuards();
        Cache::flush();
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
    }

    // ---------------------------------------------------------------- reads
    // that must now be refused

    /** The monitored broker must not read the monitoring record about them. */
    public function test_the_message_detail_route_refuses_the_subject_of_the_record(): void
    {
        $broker = $this->staff('broker');
        $counterparty = $this->staff('member');
        $reviewer = $this->staff('admin');

        $copyId = $this->flaggedCopy((int) $broker->id, (int) $counterparty->id, (int) $reviewer->id);

        Sanctum::actingAs($broker, ['*']);
        $res = $this->apiGet("/v2/admin/broker/messages/{$copyId}");

        self::assertSame(403, $res->getStatusCode(),
            'the subject of monitoring must not read their own record: ' . $res->getContent());
        self::assertStringNotContainsString(self::CONCERN, (string) $res->getContent(),
            'the concern recorded about the caller must not reach them');
        self::assertStringNotContainsString(self::NOTES, (string) $res->getContent(),
            'the reviewer\'s private note must not reach the subject');
    }

    /** A receiver is a party too, not only a sender. */
    public function test_the_message_detail_route_refuses_the_receiver_as_well(): void
    {
        $broker = $this->staff('broker');
        $counterparty = $this->staff('member');
        $reviewer = $this->staff('admin');

        $copyId = $this->flaggedCopy((int) $counterparty->id, (int) $broker->id, (int) $reviewer->id);

        Sanctum::actingAs($broker, ['*']);
        $res = $this->apiGet("/v2/admin/broker/messages/{$copyId}");

        self::assertSame(403, $res->getStatusCode(),
            'the receiving party is a subject of the record too: ' . $res->getContent());
    }

    /**
     * The queue is a work list, so the caller's own row is EXCLUDED rather
     * than the whole route refused — the queue still works, the subject's own
     * row simply is not in it.
     */
    public function test_the_message_queue_excludes_the_callers_own_monitoring_row(): void
    {
        $broker = $this->staff('broker');
        $counterparty = $this->staff('member');
        $reviewer = $this->staff('admin');

        $ownCopyId = $this->flaggedCopy((int) $broker->id, (int) $counterparty->id, (int) $reviewer->id);

        Sanctum::actingAs($broker, ['*']);
        $res = $this->apiGet('/v2/admin/broker/messages?filter=flagged&per_page=100');

        self::assertSame(200, $res->getStatusCode(), (string) $res->getContent());
        $ids = array_map(static fn ($r) => (int) $r['id'], $res->json('data') ?? []);
        self::assertNotContains($ownCopyId, $ids,
            'the caller\'s own monitoring row must not be in the queue they are shown');
        self::assertStringNotContainsString(self::CONCERN, (string) $res->getContent(),
            'the concern about the caller must not appear in the list body');
    }

    /** The archived decision about the caller is refused as well. */
    public function test_the_archive_detail_route_refuses_the_subject(): void
    {
        $broker = $this->staff('broker');
        $counterparty = $this->staff('member');
        $reviewer = $this->staff('admin');

        $copyId = $this->flaggedCopy((int) $broker->id, (int) $counterparty->id, (int) $reviewer->id);
        $archiveId = $this->archive($copyId, (int) $broker->id, (int) $counterparty->id, (int) $reviewer->id);

        Sanctum::actingAs($broker, ['*']);
        $res = $this->apiGet("/v2/admin/broker/archives/{$archiveId}");

        self::assertSame(403, $res->getStatusCode(),
            'the subject must not read the archived decision about them: ' . $res->getContent());
        self::assertStringNotContainsString(self::DECISION_NOTES, (string) $res->getContent());
    }

    /** And the archive list excludes it, so the archive id cannot be fished for. */
    public function test_the_archive_list_excludes_the_callers_own_row(): void
    {
        $broker = $this->staff('broker');
        $counterparty = $this->staff('member');
        $reviewer = $this->staff('admin');

        $copyId = $this->flaggedCopy((int) $broker->id, (int) $counterparty->id, (int) $reviewer->id);
        $archiveId = $this->archive($copyId, (int) $broker->id, (int) $counterparty->id, (int) $reviewer->id);

        Sanctum::actingAs($broker, ['*']);
        $res = $this->apiGet('/v2/admin/broker/archives?per_page=100');

        self::assertSame(200, $res->getStatusCode(), (string) $res->getContent());
        $ids = array_map(static fn ($r) => (int) $r['id'], $res->json('data') ?? []);
        self::assertNotContains($archiveId, $ids,
            'the caller\'s own archived decision must not be in the list they are shown');
    }

    /**
     * F-436, extended: the exchange detail route hands a party the internal
     * broker risk notes on their own listing and the counterparty's email.
     */
    public function test_the_exchange_detail_route_refuses_a_party_to_the_exchange(): void
    {
        $broker = $this->staff('broker');
        $requester = $this->staff('member');

        $exchangeId = $this->exchange((int) $requester->id, (int) $broker->id);

        Sanctum::actingAs($broker, ['*']);
        $res = $this->apiGet("/v2/admin/broker/exchanges/{$exchangeId}");

        self::assertSame(403, $res->getStatusCode(),
            'a party to the exchange must not read the broker record of it: ' . $res->getContent());
        self::assertStringNotContainsString(self::RISK_NOTES, (string) $res->getContent(),
            'the internal risk note on the caller\'s own listing must not reach them');
        self::assertStringNotContainsString((string) $requester->email, (string) $res->getContent(),
            'the counterparty\'s email must not be handed to a party');
    }

    // ------------------------------------------------------------- controls
    // legitimate moderation is unaffected

    /** CONTROL — the same broker still reads a copy about two other members. */
    public function test_control_the_same_broker_may_still_read_a_copy_about_other_members(): void
    {
        $broker = $this->staff('broker');
        $memberA = $this->staff('member');
        $memberB = $this->staff('member');
        $reviewer = $this->staff('admin');

        $copyId = $this->flaggedCopy((int) $memberA->id, (int) $memberB->id, (int) $reviewer->id);

        Sanctum::actingAs($broker, ['*']);
        $res = $this->apiGet("/v2/admin/broker/messages/{$copyId}");

        self::assertSame(200, $res->getStatusCode(), (string) $res->getContent());
        $copy = $res->json('data.copy');
        self::assertSame(self::CONCERN, (string) $copy['flag_reason'],
            'CONTROL: a broker moderating other members still sees the record');
        self::assertSame(self::NOTES, (string) $copy['review_notes'],
            'CONTROL: and the reviewer notes with it');
    }

    /** CONTROL — the queue still carries copies about other members. */
    public function test_control_the_message_queue_still_lists_copies_about_other_members(): void
    {
        $broker = $this->staff('broker');
        $memberA = $this->staff('member');
        $memberB = $this->staff('member');
        $reviewer = $this->staff('admin');

        $copyId = $this->flaggedCopy((int) $memberA->id, (int) $memberB->id, (int) $reviewer->id);

        Sanctum::actingAs($broker, ['*']);
        $res = $this->apiGet('/v2/admin/broker/messages?filter=flagged&per_page=100');

        self::assertSame(200, $res->getStatusCode(), (string) $res->getContent());
        $ids = array_map(static fn ($r) => (int) $r['id'], $res->json('data') ?? []);
        self::assertContains($copyId, $ids,
            'CONTROL: the moderation queue still shows copies about other members');
    }

    /** CONTROL — the same broker still reads an archive about other members. */
    public function test_control_the_same_broker_may_still_read_an_archive_about_others(): void
    {
        $broker = $this->staff('broker');
        $memberA = $this->staff('member');
        $memberB = $this->staff('member');
        $reviewer = $this->staff('admin');

        $copyId = $this->flaggedCopy((int) $memberA->id, (int) $memberB->id, (int) $reviewer->id);
        $archiveId = $this->archive($copyId, (int) $memberA->id, (int) $memberB->id, (int) $reviewer->id);

        Sanctum::actingAs($broker, ['*']);
        $res = $this->apiGet("/v2/admin/broker/archives/{$archiveId}");

        self::assertSame(200, $res->getStatusCode(), (string) $res->getContent());
        self::assertSame(self::DECISION_NOTES, (string) $res->json('data.decision_notes'),
            'CONTROL: a broker reviewing other members still reads the archived decision');

        $listRes = $this->apiGet('/v2/admin/broker/archives?per_page=100');
        $ids = array_map(static fn ($r) => (int) $r['id'], $listRes->json('data') ?? []);
        self::assertContains($archiveId, $ids,
            'CONTROL: the archive list still shows decisions about other members');
    }

    /** CONTROL — the same broker still reads an exchange between two others. */
    public function test_control_the_same_broker_may_still_read_an_exchange_between_others(): void
    {
        $broker = $this->staff('broker');
        $requester = $this->staff('member');
        $provider = $this->staff('member');

        $exchangeId = $this->exchange((int) $requester->id, (int) $provider->id);

        Sanctum::actingAs($broker, ['*']);
        $res = $this->apiGet("/v2/admin/broker/exchanges/{$exchangeId}");

        self::assertSame(200, $res->getStatusCode(), (string) $res->getContent());
        self::assertSame(self::RISK_NOTES, (string) $res->json('data.risk_tag.risk_notes'),
            'CONTROL: a broker vetting other members\' exchange still sees the risk note');
    }

    /**
     * RE-TEST of F-403 — the write guard this fix extends still refuses the
     * same row, so this is a residual gap closed, not a rediscovery.
     */
    public function test_retest_f403_the_write_guard_still_refuses_the_same_row(): void
    {
        $broker = $this->staff('broker');
        $counterparty = $this->staff('member');
        $reviewer = $this->staff('admin');
        $copyId = $this->flaggedCopy((int) $broker->id, (int) $counterparty->id, (int) $reviewer->id);

        Sanctum::actingAs($broker, ['*']);

        foreach ([
            "/v2/admin/broker/messages/{$copyId}/review",
            "/v2/admin/broker/messages/{$copyId}/approve",
            "/v2/admin/broker/messages/{$copyId}/flag",
        ] as $write) {
            $res = $this->apiPost($write, ['notes' => 'x', 'reason' => 'x', 'severity' => 'info']);
            self::assertSame(403, $res->getStatusCode(),
                "F-403 write guard HELD check failed for {$write}: " . $res->getContent());
        }
    }

    // ----- fixtures -----

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

    /** A message, the monitoring copy of it, and an administrator's concern. */
    private function flaggedCopy(int $senderId, int $receiverId, int $reviewerId): int
    {
        $messageId = (int) DB::table('messages')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $senderId,
            'receiver_id' => $receiverId,
            'subject' => 'F436 fixture',
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
            'review_notes' => self::NOTES,
            'created_at' => now(),
        ]);
    }

    /** The archived decision taken on that monitoring copy. */
    private function archive(int $copyId, int $senderId, int $receiverId, int $decidedBy): int
    {
        $archiveId = (int) DB::table('broker_review_archives')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'broker_copy_id' => $copyId,
            'sender_id' => $senderId,
            'sender_name' => 'Fixture Sender',
            'receiver_id' => $receiverId,
            'receiver_name' => 'Fixture Receiver',
            'copy_reason' => 'flagged_user',
            'target_message_body' => 'synthetic fixture body',
            'target_message_sent_at' => now(),
            'conversation_snapshot' => '[]',
            'decision' => 'flagged',
            'decision_notes' => self::DECISION_NOTES,
            'decided_by' => $decidedBy,
            'decided_by_name' => 'Fixture Reviewer',
            'decided_at' => now(),
            'flag_reason' => self::CONCERN,
            'flag_severity' => 'urgent',
            'created_at' => now(),
        ]);

        DB::table('broker_message_copies')->where('id', $copyId)->update(['archive_id' => $archiveId]);

        return $archiveId;
    }

    /** An exchange on the provider's listing, with an internal risk note on it. */
    private function exchange(int $requesterId, int $providerId): int
    {
        $listingId = (int) DB::table('listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $providerId,
            'title' => 'F436 fixture listing',
            'description' => 'synthetic fixture',
            'type' => 'offer',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('listing_risk_tags')->insert([
            'tenant_id' => $this->testTenantId,
            'listing_id' => $listingId,
            'risk_level' => 'high',
            'risk_category' => 'safeguarding',
            'risk_notes' => self::RISK_NOTES,
            'member_visible_notes' => 'Please confirm your cover before accepting.',
            'requires_approval' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return (int) DB::table('exchange_requests')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'listing_id' => $listingId,
            'requester_id' => $requesterId,
            'provider_id' => $providerId,
            'proposed_hours' => 2.00,
            'status' => 'pending_broker',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
