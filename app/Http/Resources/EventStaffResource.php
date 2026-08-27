<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Resources;

use App\Enums\EventStaffCapability;
use App\Enums\EventStaffRole;
use App\Models\EventStaffAssignment;
use App\Models\EventStaffAssignmentHistory;
use BackedEnum;
use DateTimeInterface;
use App\Support\UserDisplayName;

/** Canonical, audit-bearing representation of one delegated Events role. */
final class EventStaffResource
{
    /** @return array<string, mixed> */
    public static function fromModel(EventStaffAssignment $assignment): array
    {
        $role = $assignment->role instanceof EventStaffRole
            ? $assignment->role
            : EventStaffRole::tryFrom((string) $assignment->getAttribute('role'));
        $history = $assignment->relationLoaded('history')
            ? $assignment->history->values()
            : collect();
        $latestHistory = $history->last();
        $user = $assignment->relationLoaded('user') ? $assignment->user : null;
        $name = $user === null
            ? null
            : UserDisplayName::resolve($user);

        return [
            'id' => (int) $assignment->getKey(),
            'event_id' => (int) $assignment->event_id,
            'member' => [
                'id' => (int) $assignment->user_id,
                'name' => $name !== '' ? $name : null,
                'first_name' => $user?->first_name,
                'last_name' => $user?->last_name,
                'avatar_url' => $user?->avatar_url,
            ],
            'role' => $role?->value ?? (string) $assignment->getRawOriginal('role'),
            'capabilities' => $role === null
                ? []
                : array_map(
                    static fn (EventStaffCapability $capability): string => $capability->value,
                    $role->capabilities(),
                ),
            'status' => self::enumValue($assignment->status),
            'effective' => $assignment->isEffective(),
            'version' => (int) $assignment->assignment_version,
            'granted_at' => self::timestamp($assignment->granted_at),
            'granted_by_user_id' => (int) $assignment->granted_by,
            'revoked_at' => self::timestamp($assignment->revoked_at),
            'revoked_by_user_id' => $assignment->revoked_by === null
                ? null
                : (int) $assignment->revoked_by,
            'expires_at' => self::timestamp($assignment->expires_at),
            'history_metadata' => [
                'immutable' => true,
                'entry_count' => $history->count(),
                'latest_entry_id' => $latestHistory instanceof EventStaffAssignmentHistory
                    ? (int) $latestHistory->getKey()
                    : null,
                'latest_version' => $latestHistory instanceof EventStaffAssignmentHistory
                    ? (int) $latestHistory->assignment_version
                    : null,
            ],
            'history' => $history
                ->filter(static fn ($entry): bool => $entry instanceof EventStaffAssignmentHistory)
                ->map(static fn (EventStaffAssignmentHistory $entry): array => self::history($entry))
                ->all(),
            'created_at' => self::timestamp($assignment->created_at),
            'updated_at' => self::timestamp($assignment->updated_at),
        ];
    }

    /** @return array<string, mixed> */
    private static function history(EventStaffAssignmentHistory $entry): array
    {
        return [
            'id' => (int) $entry->getKey(),
            'version' => (int) $entry->assignment_version,
            'action' => (string) $entry->action,
            'from_status' => self::enumValue($entry->from_status),
            'to_status' => self::enumValue($entry->to_status),
            'previous_expires_at' => self::timestamp($entry->previous_expires_at),
            'new_expires_at' => self::timestamp($entry->new_expires_at),
            'actor_user_id' => (int) $entry->actor_user_id,
            'idempotency_key' => $entry->idempotency_key,
            'metadata' => is_array($entry->metadata) ? $entry->metadata : [],
            'created_at' => self::timestamp($entry->created_at),
            'immutable' => true,
        ];
    }

    private static function enumValue(mixed $value): ?string
    {
        if ($value instanceof BackedEnum) {
            return (string) $value->value;
        }

        return $value === null || $value === '' ? null : (string) $value;
    }

    private static function timestamp(mixed $value): ?string
    {
        if ($value instanceof DateTimeInterface) {
            return $value->format(DATE_ATOM);
        }

        return $value === null || $value === '' ? null : (string) $value;
    }
}
