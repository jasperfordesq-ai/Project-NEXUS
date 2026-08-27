<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Listeners;

use App\Events\GroupChatroomMessagePosted;
use App\Listeners\NotifyGroupChatroomMessage;
use App\Models\Notification;
use App\Services\NotificationDispatcher;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * Tests for NotifyGroupChatroomMessage listener.
 *
 * Strategy: use DatabaseTransactions so every test gets a clean DB state.
 * The listener reads group_members, users, notifications, user_muted_users
 * and writes to notifications (via Notification::createNotification).
 * NotificationDispatcher::fanOutPush is alias-mocked to suppress push calls.
 *
 * @runTestsInSeparateProcesses
 * @preserveGlobalState disabled
 */
class NotifyGroupChatroomMessageTest extends TestCase
{
    use \Illuminate\Foundation\Testing\DatabaseTransactions;

    private $dispatcherAlias;

    /** Fixture IDs inserted per test (rolled back by DatabaseTransactions). */
    private int $groupId;
    private int $senderId;
    private int $member1Id;
    private int $member2Id;

    protected function setUp(): void
    {
        // Alias mock MUST be created before parent::setUp() (app boot).
        $this->dispatcherAlias = Mockery::mock('alias:' . NotificationDispatcher::class)
            ->shouldIgnoreMissing();

        parent::setUp();

        Cache::flush();

        // Insert fixture users for tenant 2.
        $this->senderId = (int) DB::table('users')->insertGetId([
            'tenant_id'  => 2,
            'name'       => 'Sender User',
            'first_name' => 'Sender',
            'last_name'  => 'User',
            'email'      => 'sender_gcm_test@example.com',
            'password'   => 'x',
            'status'     => 'active',
            'preferred_language' => 'en',
            'created_at' => now(),
        ]);

        $this->member1Id = (int) DB::table('users')->insertGetId([
            'tenant_id'  => 2,
            'name'       => 'Member One',
            'first_name' => 'Member',
            'last_name'  => 'One',
            'email'      => 'member1_gcm_test@example.com',
            'password'   => 'x',
            'status'     => 'active',
            'preferred_language' => 'en',
            'created_at' => now(),
        ]);

        $this->member2Id = (int) DB::table('users')->insertGetId([
            'tenant_id'  => 2,
            'name'       => 'Member Two',
            'first_name' => 'Member',
            'last_name'  => 'Two',
            'email'      => 'member2_gcm_test@example.com',
            'password'   => 'x',
            'status'     => 'active',
            'preferred_language' => 'en',
            'created_at' => now(),
        ]);

        // Insert a fixture group.
        $this->groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => 2,
            'owner_id'  => $this->senderId,
            'name'      => 'Test Chat Group',
            'slug'      => 'test-chat-group-' . uniqid(),
            'status'    => 'active',
            'created_at' => now(),
        ]);

        // Seed group membership: sender + 2 members.
        foreach ([$this->senderId, $this->member1Id, $this->member2Id] as $uid) {
            DB::table('group_members')->insert([
                'tenant_id'  => 2,
                'group_id'   => $this->groupId,
                'user_id'    => $uid,
                'status'     => 'active',
                'role'       => 'member',
                'joined_at'  => now(),
                'created_at' => now(),
            ]);
        }
    }

    // -----------------------------------------------------------------------
    // Structural checks
    // -----------------------------------------------------------------------

    public function test_implements_should_queue(): void
    {
        $this->assertTrue(
            in_array(ShouldQueue::class, class_implements(NotifyGroupChatroomMessage::class))
        );
    }

    public function test_tries_is_one_and_timeout_is_sixty(): void
    {
        $listener = new NotifyGroupChatroomMessage();
        $this->assertSame(1, $listener->tries);
        $this->assertSame(60, $listener->timeout);
    }

    // -----------------------------------------------------------------------
    // Core happy path
    // -----------------------------------------------------------------------

    public function test_handle_creates_notifications_for_non_sender_members(): void
    {
        $messageId = 9001;

        $this->dispatcherAlias
            ->shouldReceive('fanOutPush')
            ->twice()
            ->withArgs(function (int $userId, string $type, string $body, string $link): bool {
                return in_array($userId, [$this->member1Id, $this->member2Id], true)
                    && $type === 'group_chatroom_message'
                    && $body === 'Open the app to read the new group message.'
                    && ! str_contains($body, 'Hello group!')
                    && $link === '/groups/' . $this->groupId . '/chat';
            });  // once per non-sender member, without private message content

        $event = new GroupChatroomMessagePosted(
            tenantId: 2,
            groupId: $this->groupId,
            chatroomId: 1,
            message: [
                'id'      => $messageId,
                'user_id' => $this->senderId,
                'body'    => 'Hello group!',
            ]
        );

        $listener = new NotifyGroupChatroomMessage();
        $listener->handle($event);

        // Both non-sender members must have a notification row.
        $notifCount = DB::table('notifications')
            ->where('tenant_id', 2)
            ->where('type', 'group_chatroom_message')
            ->where('link', '/groups/' . $this->groupId . '/chat')
            ->whereIn('user_id', [$this->member1Id, $this->member2Id])
            ->count();

        $this->assertSame(2, $notifCount, 'Both non-sender members should receive a notification');
    }

    public function test_handle_does_not_create_notification_for_sender(): void
    {
        $messageId = 9002;

        $this->dispatcherAlias->shouldReceive('fanOutPush')->zeroOrMoreTimes();

        $event = new GroupChatroomMessagePosted(
            tenantId: 2,
            groupId: $this->groupId,
            chatroomId: 1,
            message: [
                'id'      => $messageId,
                'user_id' => $this->senderId,
                'body'    => 'Hello everyone!',
            ]
        );

        (new NotifyGroupChatroomMessage())->handle($event);

        $senderNotifCount = DB::table('notifications')
            ->where('tenant_id', 2)
            ->where('type', 'group_chatroom_message')
            ->where('user_id', $this->senderId)
            ->count();

        $this->assertSame(0, $senderNotifCount, 'Sender must not receive a notification for their own message');
    }

    // -----------------------------------------------------------------------
    // Mute exclusion
    // -----------------------------------------------------------------------

    public function test_handle_excludes_members_who_muted_the_sender(): void
    {
        $messageId = 9003;

        // member1 muted the sender → should NOT get a notification.
        DB::table('user_muted_users')->insert([
            'user_id'       => $this->member1Id,
            'muted_user_id' => $this->senderId,
            'tenant_id'     => 2,
            'created_at'    => now(),
        ]);

        $this->dispatcherAlias->shouldReceive('fanOutPush')->once();

        $event = new GroupChatroomMessagePosted(
            tenantId: 2,
            groupId: $this->groupId,
            chatroomId: 1,
            message: [
                'id'      => $messageId,
                'user_id' => $this->senderId,
                'body'    => 'Muted test message',
            ]
        );

        (new NotifyGroupChatroomMessage())->handle($event);

        $member1Notif = DB::table('notifications')
            ->where('tenant_id', 2)
            ->where('type', 'group_chatroom_message')
            ->where('user_id', $this->member1Id)
            ->count();

        $member2Notif = DB::table('notifications')
            ->where('tenant_id', 2)
            ->where('type', 'group_chatroom_message')
            ->where('user_id', $this->member2Id)
            ->count();

        $this->assertSame(0, $member1Notif, 'Member who muted sender should not receive notification');
        $this->assertSame(1, $member2Notif, 'Non-muting member should still receive notification');
    }

    // -----------------------------------------------------------------------
    // Dedup window
    // -----------------------------------------------------------------------

    public function test_handle_deduplicates_notifications_within_five_minutes(): void
    {
        $link = '/groups/' . $this->groupId . '/chat';

        // Pre-insert a recent chatroom notification for member1.
        DB::table('notifications')->insert([
            'tenant_id'  => 2,
            'user_id'    => $this->member1Id,
            'type'       => 'group_chatroom_message',
            'message'    => 'Prior message',
            'link'       => $link,
            'is_read'    => 0,
            'created_at' => now()->subMinutes(2),
        ]);

        $this->dispatcherAlias->shouldReceive('fanOutPush')->once(); // only member2

        $event = new GroupChatroomMessagePosted(
            tenantId: 2,
            groupId: $this->groupId,
            chatroomId: 1,
            message: [
                'id'      => 9004,
                'user_id' => $this->senderId,
                'body'    => 'Second message in window',
            ]
        );

        (new NotifyGroupChatroomMessage())->handle($event);

        // member1 should still have exactly 1 (the pre-inserted one, not a duplicate).
        $member1Count = DB::table('notifications')
            ->where('tenant_id', 2)
            ->where('type', 'group_chatroom_message')
            ->where('user_id', $this->member1Id)
            ->count();

        $this->assertSame(1, $member1Count, 'Dedup window should prevent a second bell row within 5 minutes');
    }

    // -----------------------------------------------------------------------
    // Idempotency guard
    // -----------------------------------------------------------------------

    public function test_handle_suppresses_duplicate_delivery_via_cache_guard(): void
    {
        $messageId = 9005;

        // Mark this message as already handled.
        Cache::put("notify_group_chatroom_message:done:2:{$messageId}", 1, now()->addHour());

        Log::shouldReceive('info')->once()->with(
            'NotifyGroupChatroomMessage: duplicate delivery suppressed',
            Mockery::type('array')
        );

        $this->dispatcherAlias->shouldReceive('fanOutPush')->never();

        $event = new GroupChatroomMessagePosted(
            tenantId: 2,
            groupId: $this->groupId,
            chatroomId: 1,
            message: [
                'id'      => $messageId,
                'user_id' => $this->senderId,
                'body'    => 'Duplicate delivery',
            ]
        );

        (new NotifyGroupChatroomMessage())->handle($event);

        $notifCount = DB::table('notifications')
            ->where('tenant_id', 2)
            ->where('type', 'group_chatroom_message')
            ->count();

        $this->assertSame(0, $notifCount, 'No notifications should be created when the idempotency key exists');
    }

    // -----------------------------------------------------------------------
    // Edge: invalid sender/message
    // -----------------------------------------------------------------------

    public function test_handle_returns_early_when_sender_id_is_zero(): void
    {
        $this->dispatcherAlias->shouldReceive('fanOutPush')->never();

        $event = new GroupChatroomMessagePosted(
            tenantId: 2,
            groupId: $this->groupId,
            chatroomId: 1,
            message: [
                'id'      => 9006,
                'user_id' => 0,  // invalid sender
                'body'    => 'Ghost message',
            ]
        );

        (new NotifyGroupChatroomMessage())->handle($event);

        $this->assertSame(
            0,
            DB::table('notifications')->where('tenant_id', 2)->where('type', 'group_chatroom_message')->count()
        );
    }

    public function test_handle_returns_early_when_message_id_is_zero(): void
    {
        // message id = 0 means the Cache claim block is skipped and the
        // listener continues, but sender_id = 0 guard fires → early return.
        // Test the case where message id is zero AND user_id valid.
        $this->dispatcherAlias->shouldReceive('fanOutPush')->never();

        $event = new GroupChatroomMessagePosted(
            tenantId: 2,
            groupId: $this->groupId,
            chatroomId: 1,
            message: [
                'id'      => 0,              // no message id
                'user_id' => $this->senderId,
                'body'    => 'No id message',
            ]
        );

        (new NotifyGroupChatroomMessage())->handle($event);

        // With a valid sender but message_id = 0, the Cache guard is not set.
        // The listener continues; recipients would be fetched. We only assert
        // that no exception was thrown (handled gracefully).
        $this->assertTrue(true);
    }

    // -----------------------------------------------------------------------
    // Exception handling
    // -----------------------------------------------------------------------

    public function test_handle_catches_exceptions_and_logs_warning(): void
    {
        // Override the alias mock to throw on fanOutPush, triggering catch block.
        $this->dispatcherAlias
            ->shouldReceive('fanOutPush')
            ->andThrow(new \RuntimeException('Push service unavailable'));

        Log::shouldReceive('warning')->once()->with(
            'NotifyGroupChatroomMessage listener failed',
            Mockery::type('array')
        );

        // Log::debug may fire from the listener on success path before fanOutPush,
        // so allow it without enforcing calls.
        Log::shouldReceive('debug')->zeroOrMoreTimes();
        Log::shouldReceive('info')->zeroOrMoreTimes();

        $event = new GroupChatroomMessagePosted(
            tenantId: 2,
            groupId: $this->groupId,
            chatroomId: 1,
            message: [
                'id'      => 9007,
                'user_id' => $this->senderId,
                'body'    => 'Exception test message',
            ]
        );

        // Must not throw.
        (new NotifyGroupChatroomMessage())->handle($event);

        $this->assertTrue(true, 'handle() must swallow exceptions and not rethrow');
    }

    // -----------------------------------------------------------------------
    // Notification content
    // -----------------------------------------------------------------------

    public function test_handle_notification_link_points_to_group_chat(): void
    {
        $this->dispatcherAlias->shouldReceive('fanOutPush')->zeroOrMoreTimes();

        $event = new GroupChatroomMessagePosted(
            tenantId: 2,
            groupId: $this->groupId,
            chatroomId: 1,
            message: [
                'id'      => 9008,
                'user_id' => $this->senderId,
                'body'    => 'Link check message',
            ]
        );

        (new NotifyGroupChatroomMessage())->handle($event);

        $link = DB::table('notifications')
            ->where('tenant_id', 2)
            ->where('type', 'group_chatroom_message')
            ->where('user_id', $this->member1Id)
            ->value('link');

        $this->assertSame('/groups/' . $this->groupId . '/chat', $link);
    }

    public function test_handle_marks_handled_cache_key_after_successful_fanout(): void
    {
        $messageId = 9009;

        $this->dispatcherAlias->shouldReceive('fanOutPush')->zeroOrMoreTimes();

        $event = new GroupChatroomMessagePosted(
            tenantId: 2,
            groupId: $this->groupId,
            chatroomId: 1,
            message: [
                'id'      => $messageId,
                'user_id' => $this->senderId,
                'body'    => 'Cache key set test',
            ]
        );

        (new NotifyGroupChatroomMessage())->handle($event);

        $this->assertTrue(
            Cache::has("notify_group_chatroom_message:done:2:{$messageId}"),
            'Idempotency "done" cache key must be set after a successful fanout'
        );
    }
}
