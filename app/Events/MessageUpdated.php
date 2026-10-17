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
 * Fired when the sender edits a one-to-one message.
 *
 * Broadcast as `message.updated` on both participants' user channels:
 *
 *   private-tenant.{T}.user.{receiverId}  — the reader sees the new text
 *   private-tenant.{T}.user.{senderId}    — the sender's other devices follow
 *
 * Scalars only: the event is serialised onto the queue and the worker has no
 * tenant context, so nothing here may touch a model. Clients replace the body
 * and mark the row edited; the web also drops its cached auto-translation for
 * that id so the edited text is translated afresh.
 */
class MessageUpdated implements ShouldBroadcast, ShouldRescue
{
    use Dispatchable, InteractsWithSockets;

    /** Same ceiling as {@see MessageSent}: Pusher caps an event at 10 KB. */
    public const MAX_BROADCAST_BODY_BYTES = MessageSent::MAX_BROADCAST_BODY_BYTES;

    public function __construct(
        public readonly int $tenantId,
        public readonly int $messageId,
        public readonly string $body,
        public readonly string $editedAt,
        public readonly int $senderId,
        public readonly int $receiverId,
    ) {}

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
        return 'message.updated';
    }

    /**
     * @return array<string, int|string|bool>
     */
    public function broadcastWith(): array
    {
        $body = $this->body;
        $truncated = false;
        if (strlen($body) > self::MAX_BROADCAST_BODY_BYTES) {
            $body = mb_strcut($body, 0, self::MAX_BROADCAST_BODY_BYTES);
            $truncated = true;
        }

        return [
            'id'              => $this->messageId,
            'body'            => $body,
            'is_edited'       => true,
            'edited_at'       => $this->editedAt,
            'is_truncated'    => $truncated,
            'sender_id'       => $this->senderId,
            'receiver_id'     => $this->receiverId,
            'conversation_id' => MessagePairId::of($this->senderId, $this->receiverId),
            'timestamp'       => time(),
        ];
    }
}
