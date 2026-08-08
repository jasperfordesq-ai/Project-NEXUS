<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services\CaringCommunity;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\CaringCommunity\CaringHourGiftService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use InvalidArgumentException;
use RuntimeException;
use Tests\Laravel\TestCase;

class CaringHourGiftServiceTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        // Queue::fake() prevents the sync queue from firing Queue::before() hooks
        // (registered in AppServiceProvider) that call TenantContext::reset().
        // Without this, User::factory()->create() → UserObserver → SyncUserSearchIndexJob
        // (QUEUE_CONNECTION=sync) → Queue::before() → TenantContext::reset() clears
        // the tenant ID before send() can pick it up.
        Queue::fake();

        TenantContext::setById($this->testTenantId);
    }

    private function service(): CaringHourGiftService
    {
        return app(CaringHourGiftService::class);
    }

    /** Create a user in the test tenant with a given balance. */
    private function makeUser(float $balance = 0.0): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(['balance' => $balance]);
    }

    // ─── send() ────────────────────────────────────────────────────────────────

    public function test_send_debits_sender_and_creates_pending_gift(): void
    {
        $sender    = $this->makeUser(10.0);
        $recipient = $this->makeUser(0.0);

        $result = $this->service()->send($sender->id, $recipient->id, 3.0, 'Happy birthday!');

        $this->assertSame('pending', $result['status']);
        $this->assertIsInt($result['gift_id']);

        // Sender debited immediately
        $senderBalance = (float) DB::table('users')->where('id', $sender->id)->value('balance');
        $this->assertEqualsWithDelta(7.0, $senderBalance, 0.001, 'Sender balance should drop by 3 hours.');

        // Recipient NOT yet credited (gift is pending)
        $recipientBalance = (float) DB::table('users')->where('id', $recipient->id)->value('balance');
        $this->assertEqualsWithDelta(0.0, $recipientBalance, 0.001, 'Recipient balance must not change until accept.');

        // Gift row persisted
        $gift = DB::table('caring_hour_gifts')->where('id', $result['gift_id'])->first();
        $this->assertNotNull($gift);
        $this->assertSame((float) $sender->id,    (float) $gift->sender_user_id);
        $this->assertSame((float) $recipient->id, (float) $gift->recipient_user_id);
        $this->assertEqualsWithDelta(3.0, (float) $gift->hours, 0.001);
        $this->assertSame('pending', $gift->status);
        $this->assertSame('Happy birthday!', $gift->message);
    }

    public function test_send_rejects_self_gift(): void
    {
        $user = $this->makeUser(10.0);

        $this->expectException(InvalidArgumentException::class);
        $this->service()->send($user->id, $user->id, 1.0, null);
    }

    public function test_send_rejects_zero_hours(): void
    {
        $sender    = $this->makeUser(10.0);
        $recipient = $this->makeUser(0.0);

        $this->expectException(InvalidArgumentException::class);
        $this->service()->send($sender->id, $recipient->id, 0.0, null);
    }

    public function test_send_rejects_negative_hours(): void
    {
        $sender    = $this->makeUser(10.0);
        $recipient = $this->makeUser(0.0);

        $this->expectException(InvalidArgumentException::class);
        $this->service()->send($sender->id, $recipient->id, -1.0, null);
    }

    public function test_send_rejects_more_than_two_decimal_places(): void
    {
        $sender    = $this->makeUser(10.0);
        $recipient = $this->makeUser(0.0);

        $this->expectException(InvalidArgumentException::class);
        $this->service()->send($sender->id, $recipient->id, 1.005, null);
    }

    public function test_send_rejects_insufficient_balance(): void
    {
        $sender    = $this->makeUser(2.0);
        $recipient = $this->makeUser(0.0);

        $this->expectException(RuntimeException::class);
        $this->service()->send($sender->id, $recipient->id, 5.0, null);
    }

    public function test_send_rejects_recipient_from_different_tenant(): void
    {
        $sender    = $this->makeUser(10.0);
        $recipient = User::factory()->forTenant(999)->create(['balance' => 0.0]);

        $this->expectException(RuntimeException::class);
        $this->service()->send($sender->id, $recipient->id, 1.0, null);
    }

    public function test_send_truncates_empty_string_message_to_null(): void
    {
        $sender    = $this->makeUser(10.0);
        $recipient = $this->makeUser(0.0);

        $result = $this->service()->send($sender->id, $recipient->id, 1.0, '   ');

        $gift = DB::table('caring_hour_gifts')->where('id', $result['gift_id'])->first();
        $this->assertNull($gift->message);
    }

    public function test_send_rejects_message_over_500_chars(): void
    {
        $sender    = $this->makeUser(10.0);
        $recipient = $this->makeUser(0.0);

        $this->expectException(InvalidArgumentException::class);
        $this->service()->send($sender->id, $recipient->id, 1.0, str_repeat('x', 501));
    }

    // ─── accept() ──────────────────────────────────────────────────────────────

    public function test_accept_credits_recipient_and_marks_accepted(): void
    {
        $sender    = $this->makeUser(10.0);
        $recipient = $this->makeUser(0.0);

        $result = $this->service()->send($sender->id, $recipient->id, 4.0, null);
        $this->service()->accept($result['gift_id'], $recipient->id);

        // Recipient credited
        $recipientBalance = (float) DB::table('users')->where('id', $recipient->id)->value('balance');
        $this->assertEqualsWithDelta(4.0, $recipientBalance, 0.001);

        // Sender stays debited
        $senderBalance = (float) DB::table('users')->where('id', $sender->id)->value('balance');
        $this->assertEqualsWithDelta(6.0, $senderBalance, 0.001);

        // Balance conserved: total hours before = 10, after = 6+4 = 10
        $this->assertEqualsWithDelta(10.0, $senderBalance + $recipientBalance, 0.001);

        // Gift row updated
        $gift = DB::table('caring_hour_gifts')->where('id', $result['gift_id'])->first();
        $this->assertSame('accepted', $gift->status);
        $this->assertNotNull($gift->accepted_at);
    }

    public function test_accept_rejects_wrong_recipient(): void
    {
        $sender    = $this->makeUser(10.0);
        $recipient = $this->makeUser(0.0);
        $other     = $this->makeUser(0.0);

        $result = $this->service()->send($sender->id, $recipient->id, 2.0, null);

        $this->expectException(RuntimeException::class);
        $this->service()->accept($result['gift_id'], $other->id);
    }

    public function test_accept_rejects_non_pending_gift(): void
    {
        $sender    = $this->makeUser(10.0);
        $recipient = $this->makeUser(0.0);

        $result = $this->service()->send($sender->id, $recipient->id, 2.0, null);
        $this->service()->accept($result['gift_id'], $recipient->id);

        $this->expectException(RuntimeException::class);
        $this->service()->accept($result['gift_id'], $recipient->id);
    }

    // ─── decline() ─────────────────────────────────────────────────────────────

    public function test_decline_refunds_sender_and_marks_declined(): void
    {
        $sender    = $this->makeUser(10.0);
        $recipient = $this->makeUser(0.0);

        $result = $this->service()->send($sender->id, $recipient->id, 3.0, null);

        // Sender balance after send: 7.0
        $this->service()->decline($result['gift_id'], $recipient->id, 'Not needed, thanks.');

        // Sender refunded
        $senderBalance = (float) DB::table('users')->where('id', $sender->id)->value('balance');
        $this->assertEqualsWithDelta(10.0, $senderBalance, 0.001, 'Sender should be fully refunded on decline.');

        // Recipient still at 0
        $recipientBalance = (float) DB::table('users')->where('id', $recipient->id)->value('balance');
        $this->assertEqualsWithDelta(0.0, $recipientBalance, 0.001);

        // Gift row
        $gift = DB::table('caring_hour_gifts')->where('id', $result['gift_id'])->first();
        $this->assertSame('declined', $gift->status);
        $this->assertNotNull($gift->declined_at);
        $this->assertSame('Not needed, thanks.', $gift->decline_reason);
    }

    public function test_decline_rejects_wrong_recipient(): void
    {
        $sender    = $this->makeUser(10.0);
        $recipient = $this->makeUser(0.0);
        $other     = $this->makeUser(0.0);

        $result = $this->service()->send($sender->id, $recipient->id, 2.0, null);

        $this->expectException(RuntimeException::class);
        $this->service()->decline($result['gift_id'], $other->id, null);
    }

    public function test_decline_rejects_already_accepted_gift(): void
    {
        $sender    = $this->makeUser(10.0);
        $recipient = $this->makeUser(0.0);

        $result = $this->service()->send($sender->id, $recipient->id, 2.0, null);
        $this->service()->accept($result['gift_id'], $recipient->id);

        $this->expectException(RuntimeException::class);
        $this->service()->decline($result['gift_id'], $recipient->id, null);
    }

    // ─── revert() ──────────────────────────────────────────────────────────────

    public function test_revert_refunds_sender_and_marks_reverted(): void
    {
        $sender    = $this->makeUser(10.0);
        $recipient = $this->makeUser(0.0);

        $result = $this->service()->send($sender->id, $recipient->id, 5.0, null);
        $this->service()->revert($result['gift_id'], $sender->id);

        // Sender fully refunded
        $senderBalance = (float) DB::table('users')->where('id', $sender->id)->value('balance');
        $this->assertEqualsWithDelta(10.0, $senderBalance, 0.001);

        $gift = DB::table('caring_hour_gifts')->where('id', $result['gift_id'])->first();
        $this->assertSame('reverted', $gift->status);
        $this->assertNotNull($gift->reverted_at);
    }

    public function test_revert_rejects_wrong_sender(): void
    {
        $sender    = $this->makeUser(10.0);
        $recipient = $this->makeUser(0.0);
        $other     = $this->makeUser(0.0);

        $result = $this->service()->send($sender->id, $recipient->id, 2.0, null);

        $this->expectException(RuntimeException::class);
        $this->service()->revert($result['gift_id'], $other->id);
    }

    public function test_revert_rejects_non_pending_gift(): void
    {
        $sender    = $this->makeUser(10.0);
        $recipient = $this->makeUser(0.0);

        $result = $this->service()->send($sender->id, $recipient->id, 2.0, null);
        $this->service()->accept($result['gift_id'], $recipient->id);

        $this->expectException(RuntimeException::class);
        $this->service()->revert($result['gift_id'], $sender->id);
    }

    // ─── myInbox() ─────────────────────────────────────────────────────────────

    public function test_my_inbox_returns_only_pending_gifts_for_recipient(): void
    {
        $sender    = $this->makeUser(20.0);
        $recipient = $this->makeUser(0.0);

        // One pending gift
        $r1 = $this->service()->send($sender->id, $recipient->id, 1.0, 'Pending gift');

        // One gift that gets accepted — should NOT appear in inbox after accept
        $r2 = $this->service()->send($sender->id, $recipient->id, 2.0, null);
        $this->service()->accept($r2['gift_id'], $recipient->id);

        TenantContext::setById($this->testTenantId);
        $inbox = $this->service()->myInbox($recipient->id);

        $inboxIds = array_column($inbox, 'id');
        $this->assertContains($r1['gift_id'], $inboxIds, 'Pending gift should appear in inbox.');
        $this->assertNotContains($r2['gift_id'], $inboxIds, 'Accepted gift must not appear in inbox.');

        // Verify structure of the pending gift row
        $pending = array_values(array_filter($inbox, fn ($g) => $g['id'] === $r1['gift_id']))[0];
        $this->assertEqualsWithDelta(1.0, $pending['hours'], 0.001);
        $this->assertSame('pending', $pending['status']);
        $this->assertSame('Pending gift', $pending['message']);
        $this->assertArrayHasKey('partner', $pending);
        $this->assertSame((int) $sender->id, $pending['partner']['id']);
    }

    public function test_my_inbox_excludes_other_tenants_gifts(): void
    {
        $sender    = $this->makeUser(10.0);
        $recipient = $this->makeUser(0.0);

        // Insert a row for tenant 999 directly — should never appear for tenant 2
        $otherSender    = User::factory()->forTenant(999)->create(['balance' => 10.0]);
        $otherRecipient = User::factory()->forTenant(999)->create(['balance' => 0.0]);
        DB::table('caring_hour_gifts')->insert([
            'tenant_id'         => 999,
            'sender_user_id'    => $otherSender->id,
            'recipient_user_id' => $recipient->id, // same recipient id, different tenant
            'hours'             => 5.0,
            'status'            => 'pending',
            'created_at'        => now(),
            'updated_at'        => now(),
        ]);

        TenantContext::setById($this->testTenantId);
        $inbox = $this->service()->myInbox($recipient->id);

        foreach ($inbox as $item) {
            // All items in our tenant's inbox must belong to tenant 2
            $row = DB::table('caring_hour_gifts')->where('id', $item['id'])->first();
            $this->assertSame((int) $this->testTenantId, (int) $row->tenant_id);
        }
        $this->addToAssertionCount(1); // Counts even when inbox is empty — loop may run 0 times
    }

    // ─── mySent() ──────────────────────────────────────────────────────────────

    public function test_my_sent_returns_all_statuses_for_sender(): void
    {
        $sender     = $this->makeUser(20.0);
        $recipient1 = $this->makeUser(0.0);
        $recipient2 = $this->makeUser(0.0);

        $r1 = $this->service()->send($sender->id, $recipient1->id, 2.0, 'For r1');
        $r2 = $this->service()->send($sender->id, $recipient2->id, 3.0, 'For r2');
        $this->service()->accept($r1['gift_id'], $recipient1->id);

        TenantContext::setById($this->testTenantId);
        $sent = $this->service()->mySent($sender->id);

        $sentIds = array_column($sent, 'id');
        $this->assertContains($r1['gift_id'], $sentIds, 'Accepted gift should appear in sent list.');
        $this->assertContains($r2['gift_id'], $sentIds, 'Pending gift should appear in sent list.');

        // Verify accepted gift has recipient partner data
        $acceptedRow = array_values(array_filter($sent, fn ($g) => $g['id'] === $r1['gift_id']))[0];
        $this->assertSame('accepted', $acceptedRow['status']);
        $this->assertSame((int) $recipient1->id, $acceptedRow['partner']['id']);
    }
}
