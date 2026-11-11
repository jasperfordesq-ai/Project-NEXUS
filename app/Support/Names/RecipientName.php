<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Names;

use App\Support\UserDisplayName;
use Illuminate\Support\Facades\DB;

/**
 * The name of one member as ANOTHER member may see it — for text that is
 * written now and read later by someone else (E-122).
 *
 * A bell notification, a push message or an email is built during the
 * sender's request ("Mary liked your post"), so the audience the request
 * would give is the wrong one twice over: the sender is "self", which keeps
 * their own surname; and a sender who is staff may see surnames the recipient
 * may not. The only audience that matters for such text is the person who
 * will read it.
 *
 * A recipient who is an administrator, broker or coordinator of the community
 * gets the full name; everyone else gets the first name, or an organisation's
 * trading name.
 */
final class RecipientName
{
    /**
     * @param int|object|array<string, mixed>|null $actor     a user id, or a row / model of the person being named
     * @param int|object|array<string, mixed>|null $recipient a user id, or anything carrying `id`; null = nobody in particular (public name)
     */
    public static function of(int|object|array|null $actor, int|object|array|null $recipient, ?string $fallback = null): string
    {
        $row = self::nameParts($actor);
        if ($row === null) {
            return (string) ($fallback ?? '');
        }

        return NameAudience::forRecipient(
            $recipient,
            static fn (): string => UserDisplayName::resolve($row, $fallback),
        );
    }

    /**
     * The parts a display name is built from. A row that already carries a
     * first name is used as it is; anything else (a bare id, or a row selected
     * with only the stored `name`) is looked up by id, so a stored full name
     * is never cut at its first space to guess a first name.
     *
     * @param int|object|array<string, mixed>|null $actor
     * @return array<string, mixed>|null
     */
    private static function nameParts(int|object|array|null $actor): ?array
    {
        if ($actor === null) {
            return null;
        }

        if (! is_int($actor)) {
            $firstName = data_get($actor, 'first_name');
            if (is_string($firstName) && trim($firstName) !== '') {
                return [
                    'id' => data_get($actor, 'id'),
                    'first_name' => $firstName,
                    'last_name' => data_get($actor, 'last_name'),
                    'profile_type' => data_get($actor, 'profile_type'),
                    'organization_name' => data_get($actor, 'organization_name'),
                    'name' => data_get($actor, 'name'),
                ];
            }
            $id = (int) data_get($actor, 'id', 0);
            if ($id <= 0) {
                // No first name and nothing to look up: all there is is the
                // stored name, which {@see UserDisplayName} reduces to its
                // first word for anyone who may not see surnames.
                $stored = data_get($actor, 'name');

                return is_string($stored) && trim($stored) !== ''
                    ? ['name' => $stored, 'profile_type' => data_get($actor, 'profile_type'), 'organization_name' => data_get($actor, 'organization_name')]
                    : null;
            }
            $actor = $id;
        }

        if ($actor <= 0) {
            return null;
        }

        // By id alone: the caller already holds this person as the actor of
        // something the recipient is being told about.
        $row = DB::table('users')
            ->where('id', $actor)
            ->first(['id', 'first_name', 'last_name', 'profile_type', 'organization_name', 'name']);

        return $row === null ? null : (array) $row;
    }
}
