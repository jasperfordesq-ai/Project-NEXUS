<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Resources;

use App\Support\Events\EventLifecycleCompatibility;

/** Explicit, identity-safe admin projection for Event operations. */
final class AdminEventResource
{
    /** @return array<string,mixed> */
    public static function fromRow(object|array $row): array
    {
        $event = (array) $row;
        $lifecycle = EventLifecycleCompatibility::resolveForListing(
            self::nullableString($event['publication_status'] ?? null),
            self::nullableString($event['operational_status'] ?? null),
            self::nullableString($event['status'] ?? null),
        );
        $confirmed = self::int($event['confirmed_count'] ?? 0);
        $occupied = self::int($event['capacity_occupied_count'] ?? $confirmed);
        $capacity = self::nullableInt($event['max_attendees'] ?? null);

        return [
            'id' => self::int($event['id'] ?? 0),
            'title' => (string) ($event['title'] ?? ''),
            'description' => self::nullableString($event['description'] ?? null),
            'status' => self::nullableString($event['status'] ?? null) ?? 'active',
            'publication_state' => $lifecycle['publication']->value,
            'operational_state' => $lifecycle['operational']->value,
            'lifecycle_version' => self::int($event['lifecycle_version'] ?? 0),
            // True when the legacy `status` column disagrees with the canonical
            // lifecycle columns; the canonical state is what is reported above.
            'lifecycle_inconsistent' => $lifecycle['inconsistent'],
            'start_at' => self::utcIso($event['start_time'] ?? null),
            'end_at' => self::utcIso($event['end_time'] ?? null),
            'timezone' => self::nullableString($event['timezone'] ?? null),
            'all_day' => (bool) ($event['all_day'] ?? false),
            'location' => self::nullableString($event['location'] ?? null),
            'is_recurring_template' => (bool) ($event['is_recurring_template'] ?? false),
            'series' => [
                'root_event_id' => self::nullableInt($event['parent_event_id'] ?? null)
                    ?? self::int($event['id'] ?? 0),
                'is_recurring' => (bool) ($event['is_recurring_template'] ?? false)
                    || self::nullableInt($event['parent_event_id'] ?? null) !== null,
                'occurrence_count' => self::int($event['occurrence_count'] ?? 0),
                'future_occurrence_count' => self::int($event['future_occurrence_count'] ?? 0),
            ],
            'organizer' => [
                'id' => self::int($event['user_id'] ?? 0),
                'display_name' => self::nullableString($event['organizer_name'] ?? null),
            ],
            'group' => self::nullableInt($event['group_id'] ?? null) === null ? null : [
                'id' => self::int($event['group_id']),
                'name' => self::nullableString($event['group_name'] ?? null),
            ],
            'category' => self::nullableInt($event['category_id'] ?? null) === null ? null : [
                'id' => self::int($event['category_id']),
                'name' => self::nullableString($event['category_name'] ?? null),
            ],
            'capacity' => [
                'limit' => $capacity,
                'confirmed' => $confirmed,
                'remaining' => $capacity === null ? null : max(0, $capacity - $occupied),
                'is_full' => $capacity !== null && $occupied >= $capacity,
            ],
            'metrics' => [
                'confirmed_count' => $confirmed,
                'interested_count' => self::int($event['interested_count'] ?? 0),
                'waitlist_count' => self::int($event['waitlist_count'] ?? 0),
                'attendance_count' => self::int($event['attendance_count'] ?? 0),
                'legacy_attended_count' => self::int($event['legacy_attended_count'] ?? 0),
            ],
            'moderation' => [
                'submitted_at' => self::nullableString($event['moderation_submitted_at'] ?? null),
                'submitted_by' => self::nullableInt($event['moderation_submitted_by'] ?? null),
                'decided_at' => self::nullableString($event['moderated_at'] ?? null),
                'decided_by' => self::nullableInt($event['moderated_by'] ?? null),
                'reason' => self::nullableString($event['moderation_reason'] ?? null),
            ],
            'lifecycle_reason' => self::nullableString($event['lifecycle_reason'] ?? null),
            'created_at' => self::utcIso($event['created_at'] ?? null),
            'updated_at' => self::utcIso($event['updated_at'] ?? null),

            // Compatibility aliases for the maintained admin client during its
            // lifecycle-aware table migration.
            'start_date' => self::utcIso($event['start_time'] ?? null),
            'end_date' => self::utcIso($event['end_time'] ?? null),
            'created_by' => self::int($event['user_id'] ?? 0),
            'creator_name' => self::nullableString($event['organizer_name'] ?? null),
            'organizer_name' => self::nullableString($event['organizer_name'] ?? null),
            'attendees_count' => $confirmed,
            'max_attendees' => $capacity,
        ];
    }

    private static function int(mixed $value): int
    {
        return is_numeric($value) ? (int) $value : 0;
    }

    private static function nullableInt(mixed $value): ?int
    {
        return $value !== null && $value !== '' && is_numeric($value) ? (int) $value : null;
    }

    /**
     * Timestamps are stored as zone-less UTC strings. Emitting them unchanged
     * made the admin client parse them as browser-local time and label them
     * with the event's zone, so every time read an hour off in summer (E-104).
     */
    private static function utcIso(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }
        try {
            return \Illuminate\Support\Carbon::parse((string) $value, 'UTC')->toIso8601String();
        } catch (\Throwable) {
            return self::nullableString($value);
        }
    }

    private static function nullableString(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $value = trim((string) $value);

        return $value === '' ? null : $value;
    }
}
