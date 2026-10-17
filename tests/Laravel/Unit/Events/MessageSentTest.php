<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Events;

use App\Events\MessageSent;
use App\Models\Message;
use App\Models\MessageAttachment;
use App\Models\User;
use App\Support\Messaging\MessagePairId;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Support\Carbon;
use Tests\Laravel\TestCase;

/**
 * The live "new message" event, as both shipped clients consume it.
 *
 * Until 2026-10-17 this event went out as `message.sent` on
 * `private-tenant.{T}.conversation.{crc32}` — a channel the auth layer only
 * grants to members with a `conversation_participants` row (one-to-one chats
 * have none) and that no client subscribed to anyway. Nothing live ever
 * reached the web or the phone. The contract pinned here is the one the
 * already-installed mobile build binds: `new-message` on the recipient's own
 * user channel with `{conversation_id, message}`, plus the flat keys the web
 * handler reads.
 */
class MessageSentTest extends TestCase
{
    public function test_instantiation_stores_properties_and_trims_the_sender(): void
    {
        $message = new Message();
        $sender = new User();
        $sender->id = 10;
        $sender->first_name = 'Bob';

        $event = new MessageSent($message, $sender, 42, 2);

        $this->assertSame($message, $event->message);
        // Listeners read these three; the summary keeps the model's property names.
        $this->assertSame(10, $event->sender->id);
        $this->assertSame('Bob', $event->sender->first_name);
        $this->assertIsString($event->sender->name);
        $this->assertSame(42, $event->conversationId);
        $this->assertSame(2, $event->tenantId);
    }

    public function test_the_queued_event_carries_no_account_fields_for_the_sender(): void
    {
        // The event is serialised onto the queue as-is (no SerializesModels, by
        // design: the worker has no tenant scope). Until 2026-10-17 the whole
        // User row went with it — password hash included.
        $sender = new User();
        $sender->id = 9;
        $sender->first_name = 'Anna';
        $sender->last_name = 'Example';
        $sender->email = 'anna@example.test';
        $sender->phone = '+1 555 123 4567';
        $sender->password = 'hashed-secret';
        $sender->two_factor_secret = 'totp-seed';

        $event = $this->event(senderId: 9, receiverId: 5, tenantId: 4, sender: $sender);
        $serialised = serialize($event);

        $this->assertInstanceOf(\App\Support\Messaging\MessageSenderSummary::class, $event->sender);
        foreach (['anna@example.test', '+1 555 123 4567', 'hashed-secret', 'totp-seed', 'email', 'password'] as $needle) {
            $this->assertStringNotContainsString($needle, $serialised, "queue payload must not carry {$needle}");
        }
        // And the summary round-trips with what the listeners need.
        $restored = unserialize($serialised);
        $this->assertSame(9, $restored->sender->id);
        $this->assertSame('Anna', $restored->sender->first_name);
    }

    public function test_accepts_a_prebuilt_sender_summary(): void
    {
        $summary = new \App\Support\Messaging\MessageSenderSummary(
            id: 9, name: 'Anna Example', first_name: 'Anna', last_name: 'Example',
            profile_type: 'individual', organization_name: null, avatar_url: null,
        );

        $event = $this->event(senderId: 9, receiverId: 5, tenantId: 4, sender: $summary);

        $this->assertSame($summary, $event->sender);
        $this->assertSame('Anna', $event->broadcastWith()['message']['sender']['name']);
    }

    public function test_implements_should_broadcast(): void
    {
        $this->assertTrue(
            in_array(ShouldBroadcast::class, class_implements(MessageSent::class), true)
        );
    }

    public function test_broadcast_on_targets_recipient_user_channel_and_chat_channel(): void
    {
        $event = $this->event(senderId: 9, receiverId: 5, tenantId: 4);

        $channels = $event->broadcastOn();

        $this->assertCount(2, $channels);
        $this->assertContainsOnlyInstancesOf(PrivateChannel::class, $channels);
        $names = array_map(static fn (PrivateChannel $channel): string => $channel->name, $channels);
        // The recipient's own channel first: that is the one the shipped mobile app listens on.
        $this->assertSame('private-tenant.4.user.5', $names[0]);
        // The pair channel is deterministic (smaller id first) so both members can share it.
        $this->assertSame('private-tenant.4.chat.5-9', $names[1]);
    }

    public function test_broadcast_never_targets_the_senders_own_user_channel(): void
    {
        // The installed mobile build bumps its unread badge for ANY new-message on
        // the user channel that no visible thread acknowledges. An echo to the
        // sender would badge them for their own message.
        $event = $this->event(senderId: 9, receiverId: 5, tenantId: 4);

        $names = array_map(static fn (PrivateChannel $channel): string => $channel->name, $event->broadcastOn());

        $this->assertNotContains('private-tenant.4.user.9', $names);
    }

    public function test_broadcast_as_is_new_message(): void
    {
        $this->assertSame('new-message', $this->event()->broadcastAs());
    }

    public function test_broadcast_with_matches_mobile_and_web_contract(): void
    {
        $event = $this->event(senderId: 9, receiverId: 5, tenantId: 4, body: 'hello there');

        $payload = $event->broadcastWith();

        // Flat keys the web NewMessageEvent handler reads.
        foreach (['id', 'sender_id', 'receiver_id', 'body', 'created_at', 'timestamp', 'conversation_id', 'message'] as $key) {
            $this->assertArrayHasKey($key, $payload, "missing top-level key {$key}");
        }
        $this->assertSame(123, $payload['id']);
        $this->assertSame(9, $payload['sender_id']);
        $this->assertSame(5, $payload['receiver_id']);
        $this->assertSame('hello there', $payload['body']);
        $this->assertSame(MessagePairId::of(9, 5), $payload['conversation_id']);
        $this->assertIsInt($payload['timestamp']);

        // Nested message the mobile validator requires ({conversation_id:number, message:object}).
        $message = $payload['message'];
        foreach ([
            'id', 'body', 'sender_id', 'receiver_id', 'sender', 'created_at', 'is_own', 'is_read',
            'is_edited', 'is_deleted', 'is_voice', 'audio_url', 'audio_duration', 'reactions',
            'attachments', 'listing_id', 'context_type', 'context_id', 'is_truncated',
        ] as $key) {
            $this->assertArrayHasKey($key, $message, "missing message key {$key}");
        }
        $this->assertSame(['id', 'name', 'first_name', 'avatar_url'], array_keys($message['sender']));
        $this->assertSame(9, $message['sender']['id']);
        // One payload fans out to the recipient; own-ness is the recipient's perspective.
        $this->assertFalse($message['is_own']);
        $this->assertFalse($message['is_read']);
        $this->assertFalse($message['is_truncated']);
        // Both clients type reactions as Record<string, number>; an empty PHP array would encode as [].
        $this->assertStringContainsString('"reactions":{}', json_encode($payload));
        $this->assertSame([], $message['attachments']);
    }

    public function test_broadcast_with_never_leaks_account_fields(): void
    {
        $sender = new User();
        $sender->id = 9;
        $sender->name = 'Anna Example';
        $sender->first_name = 'Anna';
        $sender->last_name = 'Example';
        $sender->email = 'anna@example.test';
        $sender->phone = '+1 555 123 4567';
        $sender->password = 'hashed-secret';

        $event = $this->event(senderId: 9, receiverId: 5, tenantId: 4, sender: $sender);

        $json = json_encode($event->broadcastWith());

        $this->assertStringNotContainsString('email', $json);
        $this->assertStringNotContainsString('phone', $json);
        $this->assertStringNotContainsString('last_name', $json);
        $this->assertStringNotContainsString('password', $json);
        $this->assertStringNotContainsString('Example', $json);
        // Surname rule (F-084): the broadcast name is the first name only.
        $this->assertSame('Anna', $event->broadcastWith()['message']['sender']['name']);
    }

    public function test_broadcast_with_maps_loaded_attachments_only(): void
    {
        $attachment = new MessageAttachment();
        $attachment->setRawAttributes([
            'id' => 7,
            'message_id' => 123,
            'file_name' => 'photo.png',
            'file_size' => 1234,
            'mime_type' => 'image/png',
            'file_type' => 'image',
            'file_path' => '/srv/private/photo.png',
        ]);
        $withAttachment = $this->event();
        $withAttachment->message->setRelation('attachments', collect([$attachment]));

        $attachments = $withAttachment->broadcastWith()['message']['attachments'];

        $this->assertCount(1, $attachments);
        $this->assertSame([
            'id' => 7,
            'url' => '/api/v2/messages/123/attachments/7',
            'type' => 'image',
            'name' => 'photo.png',
            'size' => 1234,
            'mime_type' => 'image/png',
        ], $attachments[0]);
        $this->assertStringNotContainsString('file_path', json_encode($attachments));

        // Not loaded: the queue worker has no tenant scope, so the event must never lazy-load.
        $this->assertSame([], $this->event()->broadcastWith()['message']['attachments']);
    }

    public function test_broadcast_with_truncates_long_bodies_and_flags_it(): void
    {
        $event = $this->event(body: str_repeat('a', 7000));

        $payload = $event->broadcastWith();

        $this->assertLessThanOrEqual(6000, strlen($payload['message']['body']));
        $this->assertSame($payload['message']['body'], $payload['body']);
        $this->assertTrue($payload['message']['is_truncated']);
    }

    private function event(
        int $senderId = 9,
        int $receiverId = 5,
        int $tenantId = 4,
        string $body = 'hello',
        User|\App\Support\Messaging\MessageSenderSummary|null $sender = null,
    ): MessageSent {
        $message = new Message();
        $message->id = 123;
        $message->sender_id = $senderId;
        $message->receiver_id = $receiverId;
        $message->body = $body;
        $message->is_read = false;
        $message->is_voice = false;
        $message->created_at = Carbon::parse('2026-10-17 10:00:00');

        if ($sender === null) {
            $sender = new User();
            $sender->id = $senderId;
            $sender->name = 'Anna Example';
            $sender->first_name = 'Anna';
            $sender->last_name = 'Example';
        }

        return new MessageSent($message, $sender, MessagePairId::of($senderId, $receiverId), $tenantId);
    }
}
