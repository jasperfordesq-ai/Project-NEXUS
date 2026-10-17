<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Events;

use App\Events\MessageDeleted;
use App\Support\Messaging\MessagePairId;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Tests\Laravel\TestCase;

/**
 * The live "message deleted" event.
 *
 *   scope=everyone — the sender blanked it for both: both user channels.
 *   scope=self     — the actor hid it from their own view only: the actor's
 *                    user channel alone, so the other member never learns of it.
 */
final class MessageDeletedTest extends TestCase
{
    public function test_implements_should_broadcast(): void
    {
        $this->assertTrue(in_array(ShouldBroadcast::class, class_implements(MessageDeleted::class), true));
    }

    public function test_everyone_scope_targets_both_participants_user_channels(): void
    {
        $names = $this->channelNames($this->event(scope: 'everyone', actorId: 5));

        $this->assertSame(['private-tenant.4.user.5', 'private-tenant.4.user.9'], $names);
    }

    public function test_self_scope_targets_only_the_actors_user_channel(): void
    {
        // The receiver hid the sender's message from their own view.
        $this->assertSame(['private-tenant.4.user.9'], $this->channelNames($this->event(scope: 'self', actorId: 9)));
        // The sender hid their own message from their own view.
        $this->assertSame(['private-tenant.4.user.5'], $this->channelNames($this->event(scope: 'self', actorId: 5)));
    }

    public function test_broadcast_as_is_message_deleted(): void
    {
        $this->assertSame('message.deleted', $this->event()->broadcastAs());
    }

    public function test_broadcast_with_contains_only_scalars_and_the_pair_id(): void
    {
        $payload = $this->event(scope: 'everyone', actorId: 5)->broadcastWith();

        $this->assertSame([
            'id', 'scope', 'actor_id', 'sender_id', 'receiver_id', 'conversation_id', 'deleted_at', 'timestamp',
        ], array_keys($payload));
        $this->assertSame(123, $payload['id']);
        $this->assertSame('everyone', $payload['scope']);
        $this->assertSame(5, $payload['actor_id']);
        $this->assertSame(5, $payload['sender_id']);
        $this->assertSame(9, $payload['receiver_id']);
        $this->assertSame(MessagePairId::of(5, 9), $payload['conversation_id']);
        $this->assertSame('2026-10-17T10:00:00.000000Z', $payload['deleted_at']);
        $this->assertIsInt($payload['timestamp']);
        foreach ($payload as $key => $value) {
            $this->assertTrue(is_scalar($value), "{$key} must be a scalar");
        }
    }

    public function test_rejects_an_unknown_scope(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        $this->event(scope: 'all');
    }

    /** @return list<string> */
    private function channelNames(MessageDeleted $event): array
    {
        return array_map(
            static fn (PrivateChannel $channel): string => $channel->name,
            $event->broadcastOn(),
        );
    }

    private function event(string $scope = 'everyone', int $actorId = 5): MessageDeleted
    {
        return new MessageDeleted(
            tenantId: 4,
            messageId: 123,
            scope: $scope,
            actorId: $actorId,
            senderId: 5,
            receiverId: 9,
            deletedAt: '2026-10-17T10:00:00.000000Z',
        );
    }
}
