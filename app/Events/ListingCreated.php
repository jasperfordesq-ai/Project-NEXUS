<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Events;

use App\Models\Listing;
use App\Models\User;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Contracts\Broadcasting\ShouldRescue;
use Illuminate\Foundation\Events\Dispatchable;
use App\Support\UserDisplayName;

/**
 * Fired when a new listing (offer or request) is created.
 *
 * Broadcasts to the tenant channel so connected clients can update
 * their feed in real time.
 */
class ListingCreated implements ShouldBroadcast, ShouldRescue
{
    use Dispatchable, InteractsWithSockets;

    public function __construct(
        public readonly Listing $listing,
        public readonly User $user,
        public readonly int $tenantId,
    ) {}

    /**
     * Get the channels the event should broadcast on.
     *
     * Uses PrivateChannel so only authenticated tenant members receive feed
     * updates — a public Channel would allow unauthenticated eavesdropping.
     *
     * @return array<int, PrivateChannel>
     */
    public function broadcastOn(): array
    {
        return [
            new PrivateChannel("tenant.{$this->tenantId}.feed"),
        ];
    }

    /**
     * The event's broadcast name.
     */
    public function broadcastAs(): string
    {
        return 'listing.created';
    }

    /**
     * Data to broadcast — only include fields the frontend needs.
     * Prevents leaking full Listing model (internal flags, admin notes)
     * and full User model (email, phone, etc.).
     *
     * @return array<string, mixed>
     */
    public function broadcastWith(): array
    {
        return [
            'id'          => $this->listing->id,
            'title'       => $this->listing->title,
            'type'        => $this->listing->type,
            'description' => \Illuminate\Support\Str::limit($this->listing->description ?? '', 200),
            'user_id'     => $this->user->id,
            'user_name'   => UserDisplayName::resolve($this->user) ?: ($this->user->name ?? 'Member'),
            'created_at'  => $this->listing->created_at?->toISOString(),
        ];
    }
}
