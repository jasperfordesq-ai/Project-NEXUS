<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Events;

use App\Events\MessageUpdated;
use App\Support\Messaging\MessagePairId;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Tests\Laravel\TestCase;

/**
 * The live "message edited" event. Only the sender can edit, so the receiver
 * learns of the new text here and the sender's other devices get the echo.
 * Scalars only: `broadcastWith()` runs on the queue worker, where there is no
 * tenant context, so nothing here may touch a model.
 */
final class MessageUpdatedTest extends TestCase
{
    public function test_implements_should_broadcast(): void
    {
        $this->assertTrue(in_array(ShouldBroadcast::class, class_implements(MessageUpdated::class), true));
    }

    public function test_broadcast_on_targets_both_participants_user_channels(): void
    {
        $names = array_map(
            static fn (PrivateChannel $channel): string => $channel->name,
            $this->event()->broadcastOn(),
        );

        $this->assertSame(['private-tenant.4.user.5', 'private-tenant.4.user.9'], $names);
    }

    public function test_broadcast_as_is_message_updated(): void
    {
        $this->assertSame('message.updated', $this->event()->broadcastAs());
    }

    public function test_broadcast_with_contains_only_scalars_and_the_pair_id(): void
    {
        $payload = $this->event()->broadcastWith();

        $this->assertSame([
            'id', 'body', 'is_edited', 'edited_at', 'is_truncated',
            'sender_id', 'receiver_id', 'conversation_id', 'timestamp',
        ], array_keys($payload));
        $this->assertSame(123, $payload['id']);
        $this->assertSame('corrected text', $payload['body']);
        $this->assertTrue($payload['is_edited']);
        $this->assertSame('2026-10-17T10:00:00.000000Z', $payload['edited_at']);
        $this->assertFalse($payload['is_truncated']);
        $this->assertSame(5, $payload['sender_id']);
        $this->assertSame(9, $payload['receiver_id']);
        $this->assertSame(MessagePairId::of(5, 9), $payload['conversation_id']);
        $this->assertIsInt($payload['timestamp']);
        foreach ($payload as $key => $value) {
            $this->assertTrue(is_scalar($value), "{$key} must be a scalar");
        }
    }

    public function test_broadcast_with_truncates_long_bodies_and_flags_it(): void
    {
        $long = str_repeat('é', 5000); // 10,000 bytes
        $payload = $this->event(body: $long)->broadcastWith();

        $this->assertTrue($payload['is_truncated']);
        $this->assertLessThanOrEqual(MessageUpdated::MAX_BROADCAST_BODY_BYTES, strlen($payload['body']));
        // mb_strcut never splits a multibyte character.
        $this->assertSame($payload['body'], mb_convert_encoding(mb_convert_encoding($payload['body'], 'UTF-8', 'UTF-8'), 'UTF-8'));
    }

    private function event(string $body = 'corrected text'): MessageUpdated
    {
        return new MessageUpdated(
            tenantId: 4,
            messageId: 123,
            body: $body,
            editedAt: '2026-10-17T10:00:00.000000Z',
            senderId: 5,
            receiverId: 9,
        );
    }
}
