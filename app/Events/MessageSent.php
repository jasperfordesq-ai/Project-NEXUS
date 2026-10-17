<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Events;

use App\Models\Message;
use App\Models\MessageAttachment;
use App\Models\User;
use App\Support\Members\MemberProfileVisibility;
use App\Support\Messaging\MessagePairId;
use App\Support\Messaging\MessageSenderSummary;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Contracts\Broadcasting\ShouldRescue;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Fired when a member sends a one-to-one message.
 *
 * Listeners (bell + email + push, broker review copy, federation push) read
 * the model properties. The broadcast half is the live `new-message` event
 * both clients bind on the member's own channel:
 *
 *   private-tenant.{T}.user.{receiver_id}   — the recipient (web and the shipped mobile app)
 *   private-tenant.{T}.chat.{min}-{max}     — the pair channel (web echo for the sender's other tabs)
 *
 * It is deliberately NOT sent to the sender's own user channel: the installed
 * mobile build bumps its unread badge for any `new-message` there that no
 * visible thread acknowledges.
 *
 * Until 2026-10-17 this went out as `message.sent` on
 * `conversation.{crc32}`, a channel the auth layer only grants to members with
 * a `conversation_participants` row — which one-to-one chats never have — and
 * that no client subscribed to. Nothing live ever arrived.
 */
class MessageSent implements ShouldBroadcast, ShouldRescue
{
    use Dispatchable, InteractsWithSockets;

    /**
     * Pusher caps an event at 10 KB and a message body may be 10,000 characters.
     * A cut body is flagged so the web re-polls for the canonical row.
     */
    public const MAX_BROADCAST_BODY_BYTES = 6000;

    /**
     * Only the seven fields the listeners and the broadcast read survive onto
     * the queue (`MessageSenderSummary`); a full User model is accepted for
     * the callers' convenience and trimmed here.
     */
    public readonly MessageSenderSummary $sender;

    public function __construct(
        public readonly Message $message,
        User|MessageSenderSummary $sender,
        public readonly int $conversationId,
        public readonly int $tenantId,
    ) {
        $this->sender = $sender instanceof User ? MessageSenderSummary::fromUser($sender) : $sender;
    }

    /**
     * @return array<int, PrivateChannel>
     */
    public function broadcastOn(): array
    {
        $senderId = (int) $this->message->sender_id;
        $receiverId = (int) $this->message->receiver_id;

        return [
            new PrivateChannel("tenant.{$this->tenantId}.user.{$receiverId}"),
            new PrivateChannel("tenant.{$this->tenantId}." . MessagePairId::chatSuffix($senderId, $receiverId)),
        ];
    }

    public function broadcastAs(): string
    {
        return 'new-message';
    }

    /**
     * One payload that satisfies both shipped clients: the flat keys the web
     * `NewMessageEvent` handler reads, plus `{conversation_id, message}` for the
     * mobile validator. The sender is trimmed to four fields (F-085: never a
     * User row) and surnamed per the member-visibility rule (F-084) because
     * one payload reaches every viewer.
     *
     * @return array<string, mixed>
     */
    public function broadcastWith(): array
    {
        $message = $this->message;
        $body = (string) ($message->body ?? '');
        $truncated = false;
        if (strlen($body) > self::MAX_BROADCAST_BODY_BYTES) {
            $body = mb_strcut($body, 0, self::MAX_BROADCAST_BODY_BYTES);
            $truncated = true;
        }

        $createdAt = $message->created_at?->toISOString();
        $timestamp = $message->created_at?->getTimestamp() ?? time();
        $senderId = (int) $message->sender_id;
        $receiverId = (int) $message->receiver_id;

        return [
            'id'              => (int) $message->id,
            'sender_id'       => $senderId,
            'receiver_id'     => $receiverId,
            'body'            => $body,
            'created_at'      => $createdAt,
            'timestamp'       => $timestamp,
            'conversation_id' => $this->conversationId,
            'message'         => [
                'id'             => (int) $message->id,
                'body'           => $body,
                'sender_id'      => $senderId,
                'receiver_id'    => $receiverId,
                'sender'         => $this->senderSummary(),
                'created_at'     => $createdAt,
                // Recipient perspective: the only subscriber of the user channel is the receiver.
                'is_own'         => false,
                'is_read'        => (bool) $message->is_read,
                'is_edited'      => (bool) $message->is_edited,
                'is_deleted'     => (bool) $message->is_deleted,
                'is_voice'       => (bool) $message->is_voice,
                'audio_url'      => $message->audio_url,
                'audio_duration' => $message->audio_duration !== null ? (int) $message->audio_duration : null,
                // Both clients type this as Record<string, number>; a PHP [] would encode as a list.
                'reactions'      => (object) [],
                'attachments'    => $this->attachmentSummaries(),
                'listing_id'     => $message->listing_id !== null ? (int) $message->listing_id : null,
                'context_type'   => $message->context_type,
                'context_id'     => $message->context_id !== null ? (int) $message->context_id : null,
                'is_truncated'   => $truncated,
            ],
        ];
    }

    /**
     * @return array{id: int, name: string, first_name: ?string, avatar_url: ?string}
     */
    private function senderSummary(): array
    {
        $row = MemberProfileVisibility::withoutSurname([
            'id'                => $this->sender->id,
            'name'              => $this->sender->name,
            'first_name'        => $this->sender->first_name,
            'last_name'         => $this->sender->last_name,
            'profile_type'      => $this->sender->profile_type,
            'organization_name' => $this->sender->organization_name,
            'avatar_url'        => $this->sender->avatar_url,
        ]);

        return [
            'id'         => (int) $row['id'],
            'name'       => (string) ($row['name'] ?? ''),
            'first_name' => $row['first_name'] ?? null,
            'avatar_url' => $row['avatar_url'] ?? null,
        ];
    }

    /**
     * Only an already-loaded relation is mapped. The event is serialised onto
     * the queue and `broadcastWith()` runs on the worker, where there is no
     * tenant context — a lazy load there would silently return nothing or the
     * wrong tenant's rows. `MessageDeliveryOutboxService` loads them.
     *
     * @return list<array{id: int, url: string, type: string, name: string, size: int, mime_type: ?string}>
     */
    private function attachmentSummaries(): array
    {
        if (! $this->message->relationLoaded('attachments')) {
            return [];
        }

        /** @var \Illuminate\Database\Eloquent\Collection<int, MessageAttachment> $attachments */
        $attachments = $this->message->getRelation('attachments');

        return $attachments
            ->map(static fn (MessageAttachment $attachment): array => [
                'id'        => (int) $attachment->getKey(),
                'url'       => $attachment->url,
                'type'      => $attachment->type,
                'name'      => $attachment->name,
                'size'      => $attachment->size,
                'mime_type' => $attachment->mime_type,
            ])
            ->values()
            ->all();
    }
}
