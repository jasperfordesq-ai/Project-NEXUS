<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Listeners;

use App\Events\MessageSent;
use App\Listeners\NotifyMessageReceived;
use App\Models\Message;
use App\Models\User;
use App\Services\NotificationDispatcher;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * @runTestsInSeparateProcesses
 * @preserveGlobalState disabled
 */
class NotifyMessageReceivedTest extends TestCase
{
    private $dispatcherAlias;

    protected function setUp(): void
    {
        // App\Services\NotificationDispatcher may already be autoloaded by app
        // boot or an earlier test in the combined run, so the alias mock MUST be
        // created before parent::setUp() and tolerate the class already existing.
        // shouldIgnoreMissing() makes boot-time/static calls no-ops; per-test
        // expectations are layered on the shared instance in each test.
        $this->dispatcherAlias = Mockery::mock('alias:' . NotificationDispatcher::class)->shouldIgnoreMissing();
        parent::setUp();
    }

    public function test_implements_should_queue(): void
    {
        $this->assertTrue(
            in_array(ShouldQueue::class, class_implements(NotifyMessageReceived::class))
        );
    }

    public function test_handle_dispatches_notification_to_recipient(): void
    {
        // Messages are now 1-to-1 direct messages: the recipient is the
        // Message->receiver_id, not a list of conversation_participants. The
        // listener resolves the recipient locale, builds the HTML email, then
        // dispatches a single notification (link points at the SENDER's thread).
        $sender = new User();
        $sender->id = 10;
        $sender->first_name = 'Bob';

        $message = new Message();
        $message->receiver_id = 20;
        $message->body = 'Hello there';
        $message->is_voice = false;

        // conversationId arg is retained on the event but the recipient is the receiver_id.
        $event = new MessageSent($message, $sender, 42, $this->testTenantId);

        // The HTML email is built via the real EmailTemplateBuilder against the
        // test tenant context; only the dispatcher call is asserted. Link is the
        // sender's thread: /messages/{senderId}. Content renders via emails.message.in_app_content.
        // The push context names the sender, groups the tray by sender, and
        // carries the first line of the message for members who opted in to
        // previews (FCMPushService drops it otherwise).
        $this->dispatcherAlias
            ->shouldReceive('dispatch')
            ->once()
            ->with(
                20,
                'global',
                null,
                'new_message',
                'Bob sent you a message',
                '/messages/10',
                Mockery::type('string'),
                false,
                null,
                null,
                null,
                ['actor' => 'Bob', 'thread_id' => 'message:10', 'preview' => 'Hello there']
            )
            ->andReturn(true);

        $listener = new NotifyMessageReceived();
        $listener->handle($event);
    }

    public function test_voice_message_passes_no_preview(): void
    {
        $sender = new User();
        $sender->id = 10;
        $sender->first_name = 'Bob';

        $message = new Message();
        $message->receiver_id = 20;
        $message->body = '';
        $message->is_voice = true;

        $event = new MessageSent($message, $sender, 42, $this->testTenantId);

        $this->dispatcherAlias
            ->shouldReceive('dispatch')
            ->once()
            ->with(
                20,
                'global',
                null,
                'new_message',
                'Bob sent you a message',
                '/messages/10',
                Mockery::type('string'),
                false,
                null,
                null,
                null,
                ['actor' => 'Bob', 'thread_id' => 'message:10']
            )
            ->andReturn(true);

        (new NotifyMessageReceived())->handle($event);
    }

    public function test_email_opt_out_branch_pushes_with_the_same_context(): void
    {
        DB::beginTransaction();
        try {
            $recipientId = (int) User::factory()->create(['tenant_id' => $this->testTenantId])->id;
            DB::table('users')->where('id', $recipientId)->update([
                'notification_preferences' => json_encode(['email_messages' => 0]),
            ]);
            \App\Core\TenantContext::setById($this->testTenantId);

            $sender = new User();
            $sender->id = 10;
            $sender->first_name = 'Bob';

            $message = new Message();
            $message->receiver_id = $recipientId;
            $message->body = '<p>Hello <b>there</b></p>';
            $message->is_voice = false;

            $event = new MessageSent($message, $sender, 42, $this->testTenantId);

            $this->dispatcherAlias->shouldNotReceive('dispatch');
            $this->dispatcherAlias
                ->shouldReceive('fanOutPush')
                ->once()
                ->with(
                    $recipientId,
                    'new_message',
                    'Bob sent you a message',
                    '/messages/10',
                    false,
                    ['actor' => 'Bob', 'thread_id' => 'message:10', 'preview' => 'Hello there']
                );

            (new NotifyMessageReceived())->handle($event);
        } finally {
            DB::rollBack();
        }
    }

    public function test_handle_catches_exceptions_and_logs_error(): void
    {
        $sender = new User();
        $sender->id = 10;
        $sender->first_name = 'Bob';

        $message = new Message();
        $event = new MessageSent($message, $sender, 42, 2);

        DB::shouldReceive('table')
            ->andThrow(new \RuntimeException('DB error'));

        Log::shouldReceive('error')
            ->once()
            ->with('NotifyMessageReceived listener failed', Mockery::type('array'));

        $listener = new NotifyMessageReceived();
        $listener->handle($event);
    }
}
