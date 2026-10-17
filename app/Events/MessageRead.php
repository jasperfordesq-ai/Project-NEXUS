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
 * Fired when a member reads a one-to-one conversation and at least one
 * message changed from unread to read.
 *
 * Broadcast as `message.read` on two user channels:
 *
 *   private-tenant.{T}.user.{senderId}  — the sender's ticks turn blue
 *   private-tenant.{T}.user.{readerId}  — the reader's other devices clear their badge
 *
 * Clients flip only their own messages with `id <= up_to_message_id`, which
 * is race-safe when the sender posts again between the reader's update and
 * the event's arrival. Scalars only: the event is serialised onto the queue
 * and the worker has no tenant context, so nothing here may touch a model.
 *
 * Two-state model by decision (2026-10-17): sent / read. There is no
 * "delivered" state anywhere on the platform.
 */
class MessageRead implements ShouldBroadcast, ShouldRescue
{
    use Dispatchable, InteractsWithSockets;

    public function __construct(
        public readonly int $tenantId,
        public readonly int $readerId,
        public readonly int $senderId,
        public readonly int $upToMessageId,
        public readonly int $readCount,
        public readonly string $readAt,
        public readonly int $readerUnreadMessages,
    ) {}

    /**
     * @return array<int, PrivateChannel>
     */
    public function broadcastOn(): array
    {
        return [
            new PrivateChannel("tenant.{$this->tenantId}.user.{$this->senderId}"),
            new PrivateChannel("tenant.{$this->tenantId}.user.{$this->readerId}"),
        ];
    }

    public function broadcastAs(): string
    {
        return 'message.read';
    }

    /**
     * @return array<string, int|string>
     */
    public function broadcastWith(): array
    {
        return [
            'reader_id'              => $this->readerId,
            'sender_id'              => $this->senderId,
            'conversation_id'        => MessagePairId::of($this->readerId, $this->senderId),
            'up_to_message_id'       => $this->upToMessageId,
            'read_count'             => $this->readCount,
            'read_at'                => $this->readAt,
            'reader_unread_messages' => $this->readerUnreadMessages,
            'timestamp'              => time(),
        ];
    }
}
