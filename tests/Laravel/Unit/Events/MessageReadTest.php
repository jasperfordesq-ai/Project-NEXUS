<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Events;

use App\Events\MessageRead;
use App\Support\Messaging\MessagePairId;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Tests\Laravel\TestCase;

/**
 * The live read receipt. Two-state model only (sent / read): the sender's
 * ticks turn blue when this arrives, the reader's other devices clear their
 * badge. No "delivered" state exists anywhere on the platform.
 */
final class MessageReadTest extends TestCase
{
    public function test_implements_should_broadcast(): void
    {
        $this->assertTrue(in_array(ShouldBroadcast::class, class_implements(MessageRead::class), true));
    }

    public function test_broadcast_on_targets_the_sender_and_the_reader_user_channels(): void
    {
        $names = array_map(
            static fn (PrivateChannel $channel): string => $channel->name,
            $this->event()->broadcastOn(),
        );

        $this->assertSame(['private-tenant.4.user.9', 'private-tenant.4.user.5'], $names);
    }

    public function test_broadcast_as_is_message_read(): void
    {
        $this->assertSame('message.read', $this->event()->broadcastAs());
    }

    public function test_broadcast_with_contains_only_scalars_and_the_pair_id(): void
    {
        $payload = $this->event()->broadcastWith();

        $this->assertSame([
            'reader_id', 'sender_id', 'conversation_id', 'up_to_message_id',
            'read_count', 'read_at', 'reader_unread_messages', 'timestamp',
        ], array_keys($payload));
        $this->assertSame(5, $payload['reader_id']);
        $this->assertSame(9, $payload['sender_id']);
        $this->assertSame(MessagePairId::of(5, 9), $payload['conversation_id']);
        $this->assertSame(123, $payload['up_to_message_id']);
        $this->assertSame(3, $payload['read_count']);
        $this->assertSame('2026-10-17T10:00:00.000000Z', $payload['read_at']);
        $this->assertSame(2, $payload['reader_unread_messages']);
        $this->assertIsInt($payload['timestamp']);
        foreach ($payload as $key => $value) {
            $this->assertTrue(is_scalar($value), "{$key} must be a scalar");
        }
    }

    private function event(): MessageRead
    {
        return new MessageRead(
            tenantId: 4,
            readerId: 5,
            senderId: 9,
            upToMessageId: 123,
            readCount: 3,
            readAt: '2026-10-17T10:00:00.000000Z',
            readerUnreadMessages: 2,
        );
    }
}
