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
 * Fired when a one-to-one message is deleted.
 *
 * Broadcast as `message.deleted`, and WHERE it goes depends on the scope:
 *
 *   everyone — the sender blanked it for both parties (F-210: only the author
 *              may do this): both participants' user channels. Clients show
 *              the tombstone.
 *   self     — the actor hid it from their own view only: the actor's user
 *              channel ALONE. The other member's view is unchanged and they
 *              must never learn that it happened; a client receiving a `self`
 *              event for an actor other than itself ignores it.
 *
 * Scalars only: the event is serialised onto the queue and the worker has no
 * tenant context, so nothing here may touch a model.
 */
class MessageDeleted implements ShouldBroadcast, ShouldRescue
{
    use Dispatchable, InteractsWithSockets;

    public const SCOPE_EVERYONE = 'everyone';
    public const SCOPE_SELF = 'self';

    public function __construct(
        public readonly int $tenantId,
        public readonly int $messageId,
        public readonly string $scope,
        public readonly int $actorId,
        public readonly int $senderId,
        public readonly int $receiverId,
        public readonly string $deletedAt,
    ) {
        if (! in_array($scope, [self::SCOPE_EVERYONE, self::SCOPE_SELF], true)) {
            throw new \InvalidArgumentException("Unknown message delete scope: {$scope}");
        }
    }

    /**
     * @return array<int, PrivateChannel>
     */
    public function broadcastOn(): array
    {
        if ($this->scope === self::SCOPE_SELF) {
            return [new PrivateChannel("tenant.{$this->tenantId}.user.{$this->actorId}")];
        }

        return [
            new PrivateChannel("tenant.{$this->tenantId}.user.{$this->senderId}"),
            new PrivateChannel("tenant.{$this->tenantId}.user.{$this->receiverId}"),
        ];
    }

    public function broadcastAs(): string
    {
        return 'message.deleted';
    }

    /**
     * @return array<string, int|string>
     */
    public function broadcastWith(): array
    {
        return [
            'id'              => $this->messageId,
            'scope'           => $this->scope,
            'actor_id'        => $this->actorId,
            'sender_id'       => $this->senderId,
            'receiver_id'     => $this->receiverId,
            'conversation_id' => MessagePairId::of($this->senderId, $this->receiverId),
            'deleted_at'      => $this->deletedAt,
            'timestamp'       => time(),
        ];
    }
}
