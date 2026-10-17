<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Events;

use App\Events\MessageReaction;
use App\Support\Messaging\MessagePairId;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Tests\Laravel\TestCase;

/**
 * The live "reaction toggled" event. Either participant may react, so it goes
 * to both user channels and carries the authoritative per-emoji counts after
 * the toggle — clients set, never increment.
 */
final class MessageReactionTest extends TestCase
{
    public function test_implements_should_broadcast(): void
    {
        $this->assertTrue(in_array(ShouldBroadcast::class, class_implements(MessageReaction::class), true));
    }

    public function test_broadcast_on_targets_both_participants_user_channels(): void
    {
        $names = array_map(
            static fn (PrivateChannel $channel): string => $channel->name,
            $this->event()->broadcastOn(),
        );

        $this->assertSame(['private-tenant.4.user.5', 'private-tenant.4.user.9'], $names);
    }

    public function test_broadcast_as_is_message_reaction(): void
    {
        $this->assertSame('message.reaction', $this->event()->broadcastAs());
    }

    public function test_broadcast_with_carries_the_counts_and_the_pair_id(): void
    {
        $payload = $this->event()->broadcastWith();

        $this->assertSame([
            'message_id', 'emoji', 'action', 'actor_id', 'counts',
            'sender_id', 'receiver_id', 'conversation_id', 'timestamp',
        ], array_keys($payload));
        $this->assertSame(123, $payload['message_id']);
        $this->assertSame('👍', $payload['emoji']);
        $this->assertSame('added', $payload['action']);
        $this->assertSame(9, $payload['actor_id']);
        $this->assertSame(['👍' => 2, '❤️' => 1], $payload['counts']);
        $this->assertSame(5, $payload['sender_id']);
        $this->assertSame(9, $payload['receiver_id']);
        $this->assertSame(MessagePairId::of(5, 9), $payload['conversation_id']);
        $this->assertIsInt($payload['timestamp']);
    }

    public function test_empty_counts_encode_as_a_json_object_not_a_list(): void
    {
        // Both clients type `counts` as Record<string, number>; a PHP [] would
        // reach them as `[]` and break the spread.
        $payload = $this->event(action: 'removed', counts: [])->broadcastWith();

        $this->assertSame('{}', json_encode($payload['counts']));
    }

    public function test_rejects_an_unknown_action(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        $this->event(action: 'toggled');
    }

    /** @param array<string, int> $counts */
    private function event(string $action = 'added', array $counts = ['👍' => 2, '❤️' => 1]): MessageReaction
    {
        return new MessageReaction(
            tenantId: 4,
            messageId: 123,
            emoji: '👍',
            action: $action,
            actorId: 9,
            counts: $counts,
            senderId: 5,
            receiverId: 9,
        );
    }
}
