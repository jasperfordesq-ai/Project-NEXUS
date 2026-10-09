<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\MemberImport;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\EmailDispatchService;
use App\Services\MemberImport\InvitationOutbox;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

/**
 * The welcome-invitation outbox: who may be queued, and a paced sender that
 * never emails a member twice, never emails someone who signed in, is held or
 * is suppressed, and never lets an invitation silently vanish.
 */
final class InvitationOutboxTest extends TestCase
{
    use DatabaseTransactions;

    private const REQUEST = '33333333-3333-4333-8333-333333333333';
    private const OTHER_REQUEST = '44444444-4444-4444-8444-444444444444';

    private OutboxCapturingEmailDispatch $mail;

    private InvitationOutbox $outbox;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        Cache::flush();
        $this->mail = new OutboxCapturingEmailDispatch();
        app()->instance(EmailDispatchService::class, $this->mail);
        TenantContext::setById($this->testTenantId);
        DB::table('tenants')->where('id', $this->testTenantId)->update(['domain' => 'invite-outbox.example']);
        // Frozen at a whole second, so stored DATETIMEs compare exactly.
        Carbon::setTestNow(Carbon::now()->startOfSecond());
        $this->outbox = app(InvitationOutbox::class);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    // ------------------------------------------------------------ fixtures

    private function member(array $extra = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'email' => 'outbox-' . bin2hex(random_bytes(6)) . '@outbox-mail.example.org',
            'first_name' => 'Iris', 'role' => 'member', 'status' => 'active',
            'is_approved' => 1, 'last_login_at' => null,
        ], $extra));
    }

    private function admin(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(['role' => 'admin', 'status' => 'active']);
    }

    private function row(int $userId, string $request = self::REQUEST): object
    {
        $row = DB::table('member_invitation_outbox')
            ->where('tenant_id', $this->testTenantId)->where('user_id', $userId)->where('request_key', $request)->first();
        $this->assertNotNull($row, "no outbox row for user {$userId}");

        return $row;
    }

    private function queue(User $member, string $request = self::REQUEST, ?int $by = null): object
    {
        $result = $this->outbox->enqueue($this->testTenantId, [$member->id], InvitationOutbox::SOURCE_ADMIN_BULK, $request, $by);
        $this->assertSame(1, $result['queued'], 'the member was queued');

        return $this->row($member->id, $request);
    }

    private function drain(int $limit = 50): array
    {
        return $this->outbox->drain($limit, 50.0, 0);
    }

    private function suppress(string $email): void
    {
        DB::table('email_suppression')->insert([
            'email' => $email, 'reason' => 'bounce', 'suppressed_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function advance(int $minutes): void
    {
        Carbon::setTestNow(Carbon::now()->addMinutes($minutes));
    }

    private function liveInvitations(string $email): int
    {
        return DB::table('password_resets')->where('email', $email)->where('tenant_id', $this->testTenantId)
            ->whereNotNull('expires_at')->count();
    }

    // --------------------------------------------------------- eligibility

    public function test_eligibility_applies_every_rule_and_reports_each_member_once(): void
    {
        $plain = $this->member();
        $signedIn = $this->member(['last_login_at' => now()->subDay()]);
        $held = $this->member(['status' => 'pending']);
        $suspended = $this->member(['status' => 'suspended']);
        $adminRole = $this->member(['role' => 'admin']);
        $broker = $this->member(['role' => 'broker']);
        $flagged = $this->member(['is_admin' => 1]);
        $tenantSuper = $this->member(['is_tenant_super_admin' => 1]);
        $suppressed = $this->member();
        $this->suppress($suppressed->email);
        $queued = $this->member();
        $this->queue($queued, self::OTHER_REQUEST);
        $recent = $this->member();
        $this->queue($recent, self::OTHER_REQUEST);
        DB::table('member_invitation_outbox')->where('user_id', $recent->id)
            ->update(['status' => 'sent', 'sent_at' => now()->subHours(23)]);
        $longAgo = $this->member();
        $this->queue($longAgo, self::OTHER_REQUEST);
        DB::table('member_invitation_outbox')->where('user_id', $longAgo->id)
            ->update(['status' => 'sent', 'sent_at' => now()->subHours(25)]);
        $otherTenant = User::factory()->forTenant(1)->create(['role' => 'member', 'status' => 'active', 'last_login_at' => null]);

        $result = $this->outbox->eligibility($this->testTenantId, [
            $plain->id, $signedIn->id, $held->id, $suspended->id, $adminRole->id, $broker->id, $flagged->id,
            $tenantSuper->id, $suppressed->id, $queued->id, $recent->id, $longAgo->id, $otherTenant->id, 999999999,
            $plain->id, // a repeated id is reported once
        ]);

        $this->assertSame([$plain->id, $longAgo->id], $result['eligible']);
        $this->assertSame([$otherTenant->id, 999999999], $result['skipped'][InvitationOutbox::SKIP_NOT_FOUND]);
        $this->assertSame([$adminRole->id, $broker->id, $flagged->id, $tenantSuper->id], $result['skipped'][InvitationOutbox::SKIP_NOT_MEMBER]);
        $this->assertSame([$held->id, $suspended->id], $result['skipped'][InvitationOutbox::SKIP_NOT_ACTIVE]);
        $this->assertSame([$signedIn->id], $result['skipped'][InvitationOutbox::SKIP_SIGNED_IN]);
        $this->assertSame([$suppressed->id], $result['skipped'][InvitationOutbox::SKIP_SUPPRESSED]);
        $this->assertSame([$queued->id], $result['skipped'][InvitationOutbox::SKIP_ALREADY_QUEUED]);
        $this->assertSame([$recent->id], $result['skipped'][InvitationOutbox::SKIP_RECENTLY_INVITED]);
    }

    public function test_eligibility_works_past_one_chunk(): void
    {
        $member = $this->member();
        $ids = range(900000001, 900000700);
        $ids[] = $member->id;

        $result = $this->outbox->eligibility($this->testTenantId, $ids);

        $this->assertSame([$member->id], $result['eligible']);
        $this->assertCount(700, $result['skipped'][InvitationOutbox::SKIP_NOT_FOUND]);
    }

    // ------------------------------------------------------------- enqueue

    public function test_enqueue_is_idempotent_and_reports_counts_and_an_eta(): void
    {
        $a = $this->member();
        $b = $this->member();
        $staff = $this->admin();

        $first = $this->outbox->enqueue($this->testTenantId, [$a->id, $b->id, $staff->id], InvitationOutbox::SOURCE_ADMIN_BULK, self::REQUEST, 7);
        $this->assertSame(2, $first['queued']);
        $this->assertSame(1, $first['skipped'][InvitationOutbox::SKIP_NOT_MEMBER]);
        $this->assertGreaterThanOrEqual(1, $first['eta_minutes']);

        $row = $this->row($a->id);
        $this->assertSame('pending', $row->status);
        $this->assertSame('admin_bulk', $row->source);
        $this->assertSame(7, (int) $row->requested_by);
        $this->assertSame(now()->toDateTimeString(), $row->available_at);

        $again = $this->outbox->enqueue($this->testTenantId, [$a->id, $b->id], InvitationOutbox::SOURCE_ADMIN_BULK, self::REQUEST, 7);
        $this->assertSame(0, $again['queued']);
        $this->assertSame(2, $again['skipped'][InvitationOutbox::SKIP_ALREADY_QUEUED]);
        $this->assertSame(0, $again['eta_minutes']);
        $this->assertSame(2, DB::table('member_invitation_outbox')->whereIn('user_id', [$a->id, $b->id])->count());
        $this->assertSame(2, $this->outbox->pendingCount($this->testTenantId));
    }

    public function test_enqueue_rejects_an_unknown_source(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->outbox->enqueue($this->testTenantId, [1], 'newsletter', self::REQUEST, null);
    }

    public function test_enqueue_one_in_transaction_writes_an_import_row(): void
    {
        $member = $this->member();

        DB::transaction(fn () => $this->outbox->enqueueOneInTransaction($this->testTenantId, $member->id, self::REQUEST, 5));

        $row = $this->row($member->id);
        $this->assertSame('import', $row->source);
        $this->assertSame('pending', $row->status);
        $this->assertSame(5, (int) $row->requested_by);
    }

    public function test_minutes_to_send_follows_the_senders_pace(): void
    {
        $this->assertSame(0, InvitationOutbox::minutesToSend(0));
        $this->assertSame(1, InvitationOutbox::minutesToSend(1));
        $this->assertSame(1, InvitationOutbox::minutesToSend(InvitationOutbox::SENDS_PER_MINUTE));
        $this->assertSame(2, InvitationOutbox::minutesToSend(InvitationOutbox::SENDS_PER_MINUTE + 1));
        $this->assertSame((int) ceil(5000 / InvitationOutbox::SENDS_PER_MINUTE), InvitationOutbox::minutesToSend(5000));

        // The queue's estimate is the same sum over everything still waiting, platform-wide.
        $this->queue($this->member());
        $waiting = DB::table('member_invitation_outbox')->whereIn('status', ['pending', 'processing'])->count();
        $this->assertSame(InvitationOutbox::minutesToSend($waiting), $this->outbox->etaMinutes());
        $this->assertGreaterThanOrEqual(1, $this->outbox->etaMinutes());
    }

    // --------------------------------------------------------------- drain

    public function test_drain_sends_with_a_link_issued_at_send_time_and_logs_it(): void
    {
        $admin = $this->admin();
        $member = $this->member(['preferred_language' => 'de']);
        $this->queue($member, self::REQUEST, $admin->id);
        $this->assertSame(0, $this->liveInvitations($member->email), 'no link exists until the email goes');

        $summary = $this->drain();

        $this->assertGreaterThanOrEqual(1, $summary['sent']);
        $row = $this->row($member->id);
        $this->assertSame('sent', $row->status);
        $this->assertSame(now()->toDateTimeString(), $row->sent_at);
        $this->assertNull($row->claim_token);
        $this->assertNull($row->last_error);
        $this->assertSame(1, (int) $row->attempts);

        $this->assertSame(1, $this->mail->countFor($member->email));
        $body = $this->mail->lastFor($member->email)['body'];
        $this->assertStringContainsString('https://invite-outbox.example/password/reset?token=', $body);
        $this->assertStringContainsString('Passwort festlegen', $body, 'rendered in the member\'s language');
        $this->assertSame(1, $this->liveInvitations($member->email));

        $this->assertSame(1, DB::table('activity_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $admin->id)
            ->where('action', 'member_invitation_sent')
            ->where('details', "Sent welcome invitation to user #{$member->id} (bulk)")
            ->count());

        $this->drain();
        $this->assertSame(1, $this->mail->countFor($member->email), 'a sent row is never sent again');
    }

    public function test_an_import_row_without_a_requester_is_logged_by_the_system(): void
    {
        $member = $this->member();
        $this->outbox->enqueueOneInTransaction($this->testTenantId, $member->id, self::REQUEST, 0);
        DB::table('member_invitation_outbox')->where('user_id', $member->id)->update(['requested_by' => null]);

        $this->drain();

        $this->assertSame('sent', $this->row($member->id)->status);
        $this->assertSame(1, DB::table('activity_log')->whereNull('user_id')
            ->where('action', 'member_invitation_sent')
            ->where('details', "Sent welcome invitation to user #{$member->id} (import)")->count());
    }

    public function test_a_member_who_signs_in_after_being_queued_is_skipped(): void
    {
        $member = $this->member();
        $this->queue($member);
        DB::table('users')->where('id', $member->id)->update(['last_login_at' => now()]);

        $this->drain();

        $row = $this->row($member->id);
        $this->assertSame('skipped', $row->status);
        $this->assertSame(InvitationOutbox::SKIP_SIGNED_IN, $row->skip_reason);
        $this->assertNull($row->claim_token);
        $this->assertSame(0, $this->mail->countFor($member->email));
        $this->assertSame(0, $this->liveInvitations($member->email));
    }

    public function test_a_member_held_after_being_queued_is_skipped_not_active(): void
    {
        $member = $this->member();
        $this->queue($member);
        DB::table('users')->where('id', $member->id)->update(['status' => 'pending']);

        $this->drain();

        $row = $this->row($member->id);
        $this->assertSame('skipped', $row->status);
        $this->assertSame(InvitationOutbox::SKIP_NOT_ACTIVE, $row->skip_reason);
        $this->assertSame(0, $this->mail->countFor($member->email));
    }

    public function test_a_member_promoted_to_staff_after_being_queued_is_skipped_not_member(): void
    {
        $member = $this->member();
        $this->queue($member);
        DB::table('users')->where('id', $member->id)->update(['is_admin' => 1]);

        $this->drain();

        $this->assertSame(InvitationOutbox::SKIP_NOT_MEMBER, $this->row($member->id)->skip_reason);
        $this->assertSame(0, $this->mail->countFor($member->email));
    }

    public function test_a_suppressed_address_is_skipped_for_good_and_never_retried(): void
    {
        $member = $this->member();
        $this->queue($member);
        $this->suppress($member->email);

        $this->drain();
        $row = $this->row($member->id);
        $this->assertSame('skipped', $row->status);
        $this->assertSame(InvitationOutbox::SKIP_SUPPRESSED, $row->skip_reason);

        $this->advance(60 * 24 * 2);
        $this->drain();

        $after = $this->row($member->id);
        $this->assertSame('skipped', $after->status);
        $this->assertSame(1, (int) $after->attempts, 'never claimed again');
        $this->assertSame(0, $this->mail->countFor($member->email));
    }

    public function test_a_failing_send_backs_off_then_gives_up_after_five_attempts_with_every_link_revoked(): void
    {
        $this->mail->succeed = false;
        $member = $this->member();
        $this->queue($member);

        $expectedDelays = [1 => 5, 2 => 20, 3 => 45, 4 => 80];
        foreach ($expectedDelays as $attempt => $delay) {
            $summary = $this->drain();
            $this->assertGreaterThanOrEqual(1, $summary['retrying']);

            $row = $this->row($member->id);
            $this->assertSame('pending', $row->status, "attempt {$attempt} is retried");
            $this->assertSame($attempt, (int) $row->attempts);
            $this->assertSame(now()->addMinutes($delay)->toDateTimeString(), $row->available_at, "attempt {$attempt} backs off {$delay} min");
            $this->assertSame('RuntimeException: Welcome email send returned false', $row->last_error);
            $this->assertNull($row->claim_token);
            $this->assertSame(0, $this->liveInvitations($member->email), "attempt {$attempt}'s link was revoked");

            // Not due yet: nothing is sent early.
            $this->advance($delay - 1);
            $this->drain();
            $this->assertSame($attempt, (int) $this->row($member->id)->attempts, 'not retried before its backoff');
            $this->advance(1);
        }

        $summary = $this->drain();
        $this->assertGreaterThanOrEqual(1, $summary['failed']);
        $row = $this->row($member->id);
        $this->assertSame('failed', $row->status);
        $this->assertSame(5, (int) $row->attempts);
        $this->assertSame('RuntimeException: Welcome email send returned false', $row->last_error);
        $this->assertSame(5, $this->mail->countFor($member->email), 'five attempts, no more');
        $this->assertSame(0, $this->liveInvitations($member->email));

        $this->advance(60 * 24 * 3);
        $this->drain();
        $this->assertSame(5, $this->mail->countFor($member->email), 'a failed row is terminal');
        $this->assertSame('failed', $this->row($member->id)->status);
    }

    public function test_a_second_drain_running_at_the_same_time_never_takes_the_rows_the_first_holds(): void
    {
        $first = $this->member();
        $second = $this->member();
        $rowFirst = $this->queue($first);
        $this->queue($second);
        // Make the order deterministic: $first is due a second earlier.
        DB::table('member_invitation_outbox')->where('id', $rowFirst->id)->update(['available_at' => now()->subSecond()]);

        $nested = null;
        $this->mail->onSend = function () use (&$nested): void {
            // While the first drain is mid-send, a second one starts.
            $nested = $this->outbox->drain(50, 50.0, 0);
        };

        $outer = $this->outbox->drain(1, 50.0, 0);

        $this->assertSame(1, $outer['claimed']);
        $this->assertNotNull($nested);
        $this->assertSame(1, $this->mail->countFor($first->email));
        $this->assertSame(1, $this->mail->countFor($second->email));
        $this->assertSame('sent', $this->row($first->id)->status);
        $this->assertSame('sent', $this->row($second->id)->status);
        $this->assertSame(1, (int) $this->row($first->id)->attempts, 'the held row was claimed once');
    }

    public function test_a_fresh_claim_is_not_taken_but_a_stale_one_is_reclaimed_and_sent(): void
    {
        $member = $this->member();
        $row = $this->queue($member);
        DB::table('member_invitation_outbox')->where('id', $row->id)->update([
            'status' => 'processing', 'claim_token' => 'dead-worker-token', 'claimed_at' => now()->subMinutes(9), 'attempts' => 1,
        ]);

        $this->drain();
        $held = $this->row($member->id);
        $this->assertSame('processing', $held->status, 'a 9-minute-old claim still belongs to its worker');
        $this->assertSame('dead-worker-token', $held->claim_token);
        $this->assertSame(0, $this->mail->countFor($member->email));

        $this->advance(2);
        $this->drain();

        $reclaimed = $this->row($member->id);
        $this->assertSame('sent', $reclaimed->status, 'an 11-minute-old claim is taken back and sent');
        $this->assertSame(2, (int) $reclaimed->attempts);
        $this->assertSame(1, $this->mail->countFor($member->email));
    }

    public function test_the_dead_worker_cannot_overwrite_a_reclaimed_row(): void
    {
        $member = $this->member();
        $row = $this->queue($member);
        DB::table('member_invitation_outbox')->where('id', $row->id)->update([
            'status' => 'processing', 'claim_token' => 'dead-worker-token', 'claimed_at' => now()->subMinutes(11), 'attempts' => 1,
        ]);
        $this->drain();

        // The old worker wakes and tries to record a failure with its old token.
        $changed = DB::table('member_invitation_outbox')->where('id', $row->id)
            ->where('status', 'processing')->where('claim_token', 'dead-worker-token')
            ->update(['status' => 'pending']);

        $this->assertSame(0, $changed);
        $this->assertSame('sent', $this->row($member->id)->status);
    }

    public function test_a_send_interrupted_half_way_is_given_up_and_never_sent_twice(): void
    {
        $member = $this->member();
        $row = $this->queue($member);
        // The worker marked the send as started, then died before recording the result.
        DB::table('member_invitation_outbox')->where('id', $row->id)->update([
            'status' => 'processing', 'claim_token' => 'dead-worker-token', 'claimed_at' => now()->subMinutes(11),
            'attempts' => 1, 'last_error' => 'send_started',
        ]);

        $summary = $this->drain();

        $after = $this->row($member->id);
        $this->assertSame('failed', $after->status);
        $this->assertStringContainsString('never emailed twice', (string) $after->last_error);
        $this->assertGreaterThanOrEqual(1, $summary['failed']);
        $this->assertSame(0, $this->mail->countFor($member->email));
    }

    public function test_two_requests_for_one_member_send_one_email(): void
    {
        $member = $this->member();
        $one = $this->queue($member, self::REQUEST);
        // A second request raced past eligibility and queued the same member.
        DB::table('member_invitation_outbox')->insert([
            'tenant_id' => $this->testTenantId, 'user_id' => $member->id, 'request_key' => self::OTHER_REQUEST,
            'source' => 'admin_bulk', 'status' => 'pending', 'attempts' => 0,
            'available_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('member_invitation_outbox')->where('id', $one->id)->update(['available_at' => now()->subSecond()]);

        // The second row is picked up by another drain while the first is being sent.
        $this->mail->onSend = fn () => $this->outbox->drain(50, 50.0, 0);
        $this->outbox->drain(1, 50.0, 0);

        $this->assertSame(1, $this->mail->countFor($member->email));
        $this->assertSame('sent', $this->row($member->id, self::REQUEST)->status);
        $second = $this->row($member->id, self::OTHER_REQUEST);
        $this->assertSame('pending', $second->status, 'handed back while the member was being sent');
        $this->assertSame(0, (int) $second->attempts, 'a hand-back is not an attempt');

        $this->advance(2);
        $this->drain();

        $second = $this->row($member->id, self::OTHER_REQUEST);
        $this->assertSame('skipped', $second->status);
        $this->assertSame(InvitationOutbox::SKIP_RECENTLY_INVITED, $second->skip_reason);
        $this->assertSame(1, $this->mail->countFor($member->email));
    }

    public function test_a_member_being_sent_by_another_server_is_handed_back_for_a_minute(): void
    {
        $member = $this->member();
        $row = $this->queue($member);
        $lock = sprintf('nexus_member_invite_%d_%d', $this->testTenantId, $member->id);

        $default = config('database.default');
        config(['database.connections.invite_lock_probe' => config("database.connections.{$default}")]);
        $other = DB::connection('invite_lock_probe');
        $this->assertSame(1, (int) $other->selectOne('SELECT GET_LOCK(?, 0) AS got', [$lock])->got);

        try {
            $summary = $this->drain();
        } finally {
            $other->selectOne('SELECT RELEASE_LOCK(?) AS r', [$lock]);
            DB::purge('invite_lock_probe');
        }

        $this->assertGreaterThanOrEqual(1, $summary['released']);
        $after = $this->row($member->id);
        $this->assertSame('pending', $after->status);
        $this->assertSame(0, (int) $after->attempts);
        $this->assertSame(now()->addMinute()->toDateTimeString(), $after->available_at);
        $this->assertSame(0, $this->mail->countFor($member->email));
        $this->assertSame($row->id, $after->id);
    }

    public function test_rows_not_reached_before_the_budget_runs_out_are_handed_back_untried(): void
    {
        $member = $this->member();
        $this->queue($member);

        $summary = $this->outbox->drain(50, 0.0, 0);

        $this->assertGreaterThanOrEqual(1, $summary['released']);
        $row = $this->row($member->id);
        $this->assertSame('pending', $row->status);
        $this->assertSame(0, (int) $row->attempts);
        $this->assertNull($row->claim_token);
        $this->assertSame(0, $this->mail->countFor($member->email));
    }

    // ------------------------------------------ fix round 1: every invitation path

    /** Back-date this member's newest password_resets row on the DATABASE clock it was written with. */
    private function ageNewestResetRow(string $email, int $minutes): void
    {
        DB::statement(
            'UPDATE password_resets SET created_at = NOW() - INTERVAL ? MINUTE
              WHERE email = ? AND tenant_id = ? ORDER BY created_at DESC LIMIT 1',
            [$minutes, $email, $this->testTenantId]
        );
    }

    public function test_a_manual_resend_ten_minutes_ago_makes_a_member_recently_invited_for_bulk(): void
    {
        $member = $this->member();
        app(\App\Services\Auth\WelcomeInvitationMailer::class)->send(User::findById($member->id, true), true);
        $this->ageNewestResetRow($member->email, 10);

        $result = $this->outbox->eligibility($this->testTenantId, [$member->id]);

        $this->assertSame([], $result['eligible']);
        $this->assertSame([$member->id], $result['skipped'][InvitationOutbox::SKIP_RECENTLY_INVITED]);
    }

    public function test_a_manual_resend_after_queueing_makes_the_queued_row_skip_at_send_time(): void
    {
        $member = $this->member();
        $this->queue($member);
        app(\App\Services\Auth\WelcomeInvitationMailer::class)->send(User::findById($member->id, true), true);
        $this->ageNewestResetRow($member->email, 10);

        $this->drain();

        $row = $this->row($member->id);
        $this->assertSame('skipped', $row->status);
        $this->assertSame(InvitationOutbox::SKIP_RECENTLY_INVITED, $row->skip_reason);
        $this->assertSame(1, $this->mail->countFor($member->email), 'only the manual email');
    }

    public function test_a_plain_password_reset_or_an_old_invitation_does_not_count_as_recent(): void
    {
        $reset = $this->member();
        // A forgot-password link: expires_at NULL.
        DB::table('password_resets')->insert([
            'email' => $reset->email, 'tenant_id' => $this->testTenantId,
            'token' => hash('sha256', 'plain-reset'), 'created_at' => DB::raw('NOW()'), 'expires_at' => null,
        ]);
        $old = $this->member();
        app(\App\Services\Auth\WelcomeInvitationMailer::class)->send(User::findById($old->id, true), true);
        $this->ageNewestResetRow($old->email, 25 * 60);

        $result = $this->outbox->eligibility($this->testTenantId, [$reset->id, $old->id]);
        $this->assertSame([$reset->id, $old->id], $result['eligible']);

        $this->queue($reset);
        $this->drain();
        $this->assertSame('sent', $this->row($reset->id)->status);
    }

    public function test_a_sibling_row_interrupted_mid_send_counts_as_recent(): void
    {
        $failedSibling = $this->member();
        $this->queue($failedSibling, self::OTHER_REQUEST);
        DB::table('member_invitation_outbox')->where('user_id', $failedSibling->id)->update([
            'status' => 'failed', 'attempts' => 1, 'updated_at' => now()->subHour(),
            'last_error' => 'Interrupted while sending; not retried so the member is never emailed twice',
        ]);
        $sendingSibling = $this->member();
        $this->queue($sendingSibling, self::OTHER_REQUEST);
        DB::table('member_invitation_outbox')->where('user_id', $sendingSibling->id)->update([
            'status' => 'processing', 'claim_token' => 'another-worker', 'claimed_at' => now()->subMinutes(2),
            'attempts' => 1, 'last_error' => 'send_started', 'updated_at' => now()->subMinutes(2),
        ]);

        $check = $this->outbox->eligibility($this->testTenantId, [$failedSibling->id]);
        $this->assertSame([$failedSibling->id], $check['skipped'][InvitationOutbox::SKIP_RECENTLY_INVITED]);

        // Second rows that raced past eligibility.
        foreach ([$failedSibling, $sendingSibling] as $member) {
            DB::table('member_invitation_outbox')->insert([
                'tenant_id' => $this->testTenantId, 'user_id' => $member->id, 'request_key' => self::REQUEST,
                'source' => 'admin_bulk', 'status' => 'pending', 'attempts' => 0,
                'available_at' => now(), 'created_at' => now(), 'updated_at' => now(),
            ]);
        }

        $this->drain();

        foreach ([$failedSibling, $sendingSibling] as $member) {
            $row = $this->row($member->id, self::REQUEST);
            $this->assertSame('skipped', $row->status);
            $this->assertSame(InvitationOutbox::SKIP_RECENTLY_INVITED, $row->skip_reason);
            $this->assertSame(0, $this->mail->countFor($member->email));
        }
    }

    public function test_an_unapproved_member_is_not_active_in_eligibility_and_at_send_time(): void
    {
        $unapproved = $this->member(['is_approved' => 0]);
        $check = $this->outbox->eligibility($this->testTenantId, [$unapproved->id]);
        $this->assertSame([$unapproved->id], $check['skipped'][InvitationOutbox::SKIP_NOT_ACTIVE]);

        $member = $this->member();
        $this->queue($member);
        DB::table('users')->where('id', $member->id)->update(['is_approved' => 0]);
        $this->drain();

        $this->assertSame(InvitationOutbox::SKIP_NOT_ACTIVE, $this->row($member->id)->skip_reason);
        $this->assertSame(0, $this->mail->countFor($member->email));
    }

    public function test_an_undeliverable_address_is_skipped_once_and_never_retried(): void
    {
        $member = $this->member(['email' => 'outbox-' . bin2hex(random_bytes(4)) . '@nowhere.invalid']);
        $check = $this->outbox->eligibility($this->testTenantId, [$member->id]);
        $this->assertSame([$member->id], $check['skipped'][InvitationOutbox::SKIP_UNDELIVERABLE]);

        // Queued anyway (the import path does not ask eligibility()).
        $this->outbox->enqueueOneInTransaction($this->testTenantId, $member->id, self::REQUEST, 1);
        $this->drain();

        $row = $this->row($member->id);
        $this->assertSame('skipped', $row->status);
        $this->assertSame(InvitationOutbox::SKIP_UNDELIVERABLE, $row->skip_reason);
        $this->assertSame(0, $this->mail->countFor($member->email), 'no send attempted');
        $this->assertSame(0, $this->liveInvitations($member->email));

        $this->advance(60 * 24);
        $this->drain();
        $this->assertSame(1, (int) $this->row($member->id)->attempts, 'never claimed again');
    }

    public function test_a_database_error_keeps_the_members_address_out_of_last_error(): void
    {
        $member = $this->member();
        $this->queue($member);
        $driver = new \PDOException("SQLSTATE[23000]: Integrity constraint violation: 1062 Duplicate entry '{$member->email}'");
        $driver->errorInfo = ['23000', 1062, "Duplicate entry '{$member->email}'"];
        $this->mail->throw = new \Illuminate\Database\QueryException(
            'mysql', 'insert into email_log (email) values (?)', [$member->email], $driver
        );

        $this->drain();

        $row = $this->row($member->id);
        $this->assertSame('pending', $row->status, 'retried later');
        $this->assertStringNotContainsString($member->email, (string) $row->last_error);
        $this->assertStringNotContainsString('@', (string) $row->last_error);
        $this->assertStringContainsString('QueryException', (string) $row->last_error);
        $this->assertStringContainsString('23000', (string) $row->last_error);
        $this->assertLessThanOrEqual(500, mb_strlen((string) $row->last_error));
    }

    public function test_an_email_address_in_any_other_error_message_is_redacted(): void
    {
        $member = $this->member();
        $this->queue($member);
        $this->mail->throw = new \RuntimeException("Mailbox {$member->email} rejected by provider");

        $this->drain();

        $error = (string) $this->row($member->id)->last_error;
        $this->assertStringNotContainsString($member->email, $error);
        $this->assertStringContainsString('rejected by provider', $error);
    }

    public function test_the_command_prunes_finished_rows_older_than_thirty_days(): void
    {
        $rows = [];
        foreach (['sent', 'skipped', 'failed', 'pending'] as $status) {
            $member = $this->member();
            $rows[$status] = $this->queue($member)->id;
            DB::table('member_invitation_outbox')->where('id', $rows[$status])->update([
                'status' => $status, 'updated_at' => now()->subDays(31),
                // A pending row 31 days old is merely not due; it is never pruned.
                'available_at' => now()->addYear(),
            ]);
        }
        $recentMember = $this->member();
        $recent = $this->queue($recentMember)->id;
        DB::table('member_invitation_outbox')->where('id', $recent)->update(['status' => 'sent', 'updated_at' => now()->subDays(29)]);

        $this->assertSame(0, Artisan::call('members:send-invitations', ['--gap-ms' => 0]));
        $this->assertMatchesRegularExpression('/pruned=[1-9]/', Artisan::output());

        $left = DB::table('member_invitation_outbox')->whereIn('id', array_merge(array_values($rows), [$recent]))->pluck('id')->all();
        sort($left);
        $expected = [$rows['pending'], $recent];
        sort($expected);
        $this->assertSame($expected, $left);
    }

    // ------------------------------------------------------------- command

    public function test_the_command_respects_its_limit_and_exits_zero(): void
    {
        $members = [$this->member(), $this->member(), $this->member()];
        foreach ($members as $i => $member) {
            $row = $this->queue($member);
            // Ahead of anything else due, in this order.
            DB::table('member_invitation_outbox')->where('id', $row->id)->update(['available_at' => now()->subYears(5)->addSeconds($i)]);
        }

        $exit = Artisan::call('members:send-invitations', ['--limit' => 2, '--gap-ms' => 0]);

        $this->assertSame(0, $exit);
        $this->assertStringContainsString('claimed=2', Artisan::output());
        $this->assertSame(1, $this->mail->countFor($members[0]->email));
        $this->assertSame(1, $this->mail->countFor($members[1]->email));
        $this->assertSame(0, $this->mail->countFor($members[2]->email));
        $this->assertSame('pending', $this->row($members[2]->id)->status);
    }

    public function test_the_command_rejects_a_bad_limit(): void
    {
        $this->assertSame(2, Artisan::call('members:send-invitations', ['--limit' => 0]));
    }

    public function test_the_command_is_scheduled_every_minute_on_one_server_without_overlap(): void
    {
        Artisan::call('list');
        $event = collect(app(Schedule::class)->events())
            ->first(fn ($e) => is_string($e->command) && str_contains($e->command, 'members:send-invitations'));

        $this->assertNotNull($event, 'members:send-invitations is scheduled');
        $this->assertSame('* * * * *', $event->expression);
        $this->assertTrue($event->withoutOverlapping);
        $this->assertSame(10, $event->expiresAt);
        $this->assertTrue($event->onOneServer);
        $this->assertSame('members-send-invitations', $event->description);
    }
}

/** Records every email instead of sending it; can fail, and can run code mid-send. */
class OutboxCapturingEmailDispatch extends EmailDispatchService
{
    /** @var array<int, array{to:string, subject:string, body:string, options:array<string,mixed>}> */
    public array $sent = [];

    public bool $succeed = true;

    /** Run once, during the next send (to start a second drain mid-send). */
    public ?\Closure $onSend = null;

    /** Thrown from every send when set. */
    public ?\Throwable $throw = null;

    public function send(string $to, string $subject, string $body, array $options = []): bool
    {
        $this->sent[] = ['to' => $to, 'subject' => $subject, 'body' => $body, 'options' => $options];
        if ($this->onSend !== null) {
            $hook = $this->onSend;
            $this->onSend = null;
            $hook();
        }
        if ($this->throw !== null) {
            throw $this->throw;
        }

        return $this->succeed;
    }

    public function countFor(string $to): int
    {
        return count(array_filter($this->sent, fn ($m) => $m['to'] === $to));
    }

    /** @return array{to:string, subject:string, body:string, options:array<string,mixed>} */
    public function lastFor(string $to): array
    {
        $mine = array_values(array_filter($this->sent, fn ($m) => $m['to'] === $to));
        \PHPUnit\Framework\Assert::assertNotEmpty($mine, "no email was sent to {$to}");

        return end($mine);
    }
}
