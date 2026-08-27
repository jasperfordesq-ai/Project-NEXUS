<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Events;

use App\I18n\LocaleContext;
use App\Models\Connection;
use App\Models\User;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Contracts\Broadcasting\ShouldRescue;
use Illuminate\Foundation\Events\Dispatchable;
use App\Support\UserDisplayName;

/**
 * Fired when one user sends a connection request to another.
 *
 * Broadcasts privately to the target user for real-time notification.
 */
class ConnectionRequested implements ShouldBroadcast, ShouldRescue
{
    use Dispatchable, InteractsWithSockets;

    public function __construct(
        public readonly Connection $connectionModel,
        public readonly User $requester,
        public readonly User $target,
        public readonly int $tenantId,
    ) {}

    /**
     * Get the channels the event should broadcast on.
     *
     * @return array<int, \Illuminate\Broadcasting\PrivateChannel>
     */
    public function broadcastOn(): array
    {
        return [
            new PrivateChannel("tenant.{$this->tenantId}.user.{$this->target->id}"),
        ];
    }

    /**
     * The event's broadcast name.
     */
    public function broadcastAs(): string
    {
        return 'connection.requested';
    }

    /**
     * Data to broadcast — only include fields the frontend needs.
     * Prevents leaking full User models (email, phone, etc.)
     * and full Connection model internals.
     *
     * @return array<string, mixed>
     */
    public function broadcastWith(): array
    {
        // Fallback name is rendered in the RECIPIENT's (target) locale —
        // this payload is broadcast on the target user's private channel.
        $fallbackName = LocaleContext::withLocale(
            $this->target,
            static fn () => __('emails.common.fallback_someone')
        );

        return [
            'id'           => $this->connectionModel->id,
            'requester_id' => $this->requester->id,
            'requester_name' => UserDisplayName::resolve($this->requester) ?: ($this->requester->name ?? $fallbackName),
            'created_at'   => $this->connectionModel->created_at?->toISOString(),
        ];
    }
}
