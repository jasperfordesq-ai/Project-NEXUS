<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

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
 * Fired when the receiver of a connection request accepts it.
 *
 * ConnectionRequested fires at request time; this is the counterpart for the
 * acceptance transition.  Broadcasts to the original requester so they get
 * a real-time notification.  Federation listeners use this to propagate the
 * accepted relationship to external partners.
 */
class ConnectionAccepted implements ShouldBroadcast, ShouldRescue
{
    use Dispatchable, InteractsWithSockets;

    public function __construct(
        public readonly Connection $connectionModel,
        public readonly User $requester,
        public readonly User $acceptor,
        public readonly int $tenantId,
    ) {}

    /**
     * Broadcast to the original requester so they see the acceptance in real-time.
     *
     * @return array<int, \Illuminate\Broadcasting\PrivateChannel>
     */
    public function broadcastOn(): array
    {
        return [
            new PrivateChannel("tenant.{$this->tenantId}.user.{$this->requester->id}"),
        ];
    }

    public function broadcastAs(): string
    {
        return 'connection.accepted';
    }

    /**
     * @return array<string, mixed>
     */
    public function broadcastWith(): array
    {
        // Fallback name is rendered in the RECIPIENT's (requester) locale —
        // this payload is broadcast on the requester's private channel.
        $fallbackName = LocaleContext::withLocale(
            $this->requester,
            static fn () => __('emails.common.fallback_someone')
        );

        return [
            'id'           => $this->connectionModel->id,
            'acceptor_id'  => $this->acceptor->id,
            'acceptor_name' => UserDisplayName::resolve($this->acceptor) ?: ($this->acceptor->name ?? $fallbackName),
            'created_at'   => $this->connectionModel->created_at?->toISOString(),
        ];
    }
}
