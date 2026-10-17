<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Events;

use App\Support\Messaging\MessagePairId;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Contracts\Broadcasting\ShouldRescue;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Fired when either participant toggles an emoji reaction on a one-to-one
 * message.
 *
 * Broadcast as `message.reaction` on both participants' user channels. The
 * payload carries the authoritative per-emoji counts AFTER the toggle, so a
 * client sets them rather than incrementing — two toggles arriving out of
 * order then converge on the server's state. `actor_id` lets a client keep
 * its own "you reacted" marker right when the toggle came from another of its
 * devices. `sender_id` / `receiver_id` are included because the mobile app
 * routes a thread's events by the OTHER member's id and could not derive it
 * from `actor_id` alone when the actor is this member.
 *
 * Scalars and one flat map only: the event is serialised onto the queue and
 * the worker has no tenant context, so nothing here may touch a model.
 */
class MessageReaction implements ShouldBroadcast, ShouldRescue
{
    use Dispatchable, InteractsWithSockets;

    public const ACTION_ADDED = 'added';
    public const ACTION_REMOVED = 'removed';

    /**
     * @param array<string, int> $counts emoji => count, after the toggle
     */
    public function __construct(
        public readonly int $tenantId,
        public readonly int $messageId,
        public readonly string $emoji,
        public readonly string $action,
        public readonly int $actorId,
        public readonly array $counts,
        public readonly int $senderId,
        public readonly int $receiverId,
    ) {
        if (! in_array($action, [self::ACTION_ADDED, self::ACTION_REMOVED], true)) {
            throw new \InvalidArgumentException("Unknown reaction action: {$action}");
        }
    }

    /**
     * @return array<int, PrivateChannel>
     */
    public function broadcastOn(): array
    {
        return [
            new PrivateChannel("tenant.{$this->tenantId}.user.{$this->senderId}"),
            new PrivateChannel("tenant.{$this->tenantId}.user.{$this->receiverId}"),
        ];
    }

    public function broadcastAs(): string
    {
        return 'message.reaction';
    }

    /**
     * @return array<string, int|string|array<string, int>|object>
     */
    public function broadcastWith(): array
    {
        return [
            'message_id'      => $this->messageId,
            'emoji'           => $this->emoji,
            'action'          => $this->action,
            'actor_id'        => $this->actorId,
            // Both clients type this as Record<string, number>; a PHP [] would encode as a list.
            'counts'          => $this->counts === [] ? (object) [] : $this->counts,
            'sender_id'       => $this->senderId,
            'receiver_id'     => $this->receiverId,
            'conversation_id' => MessagePairId::of($this->senderId, $this->receiverId),
            'timestamp'       => time(),
        ];
    }
}
