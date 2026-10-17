<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Messaging;

use App\Models\User;

/**
 * The seven sender fields a message event needs, and nothing else.
 *
 * `MessageSent` is serialised onto the queue (it is a broadcast event and its
 * listeners are queued). Until 2026-10-17 it carried the sender's full `User`
 * model, so every attribute of the row — password hash, email, phone, 2FA
 * secret — was written to Redis for each message sent. No client ever saw
 * that (`broadcastWith()` always trimmed), but it sat in the queue store for
 * no reason. Adding `SerializesModels` instead would re-load the User on the
 * worker, where there is no tenant scope, and silently fail.
 *
 * Listeners keep reading `$event->sender->id`, `->first_name`, `->name`:
 * the property names are the model's.
 */
final class MessageSenderSummary
{
    public function __construct(
        public readonly int $id,
        public readonly string $name,
        public readonly ?string $first_name,
        public readonly ?string $last_name,
        public readonly string $profile_type,
        public readonly ?string $organization_name,
        public readonly ?string $avatar_url,
    ) {}

    public static function fromUser(User $user): self
    {
        return new self(
            id: (int) $user->id,
            name: (string) ($user->name ?? ''),
            first_name: $user->first_name !== null ? (string) $user->first_name : null,
            last_name: $user->last_name !== null ? (string) $user->last_name : null,
            profile_type: (string) ($user->profile_type ?? 'individual'),
            organization_name: $user->organization_name !== null ? (string) $user->organization_name : null,
            avatar_url: $user->avatar_url !== null ? (string) $user->avatar_url : null,
        );
    }
}
