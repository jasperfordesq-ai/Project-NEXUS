<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Resources;

use App\Support\Events\EventContractMapper;

final class EventRosterResource
{
    /** @return array<string, mixed> */
    public static function fromArray(array $attendee): array
    {
        return EventContractMapper::roster($attendee);
    }

    /** @return array<string, mixed> */
    public static function legacyFromArray(array $attendee): array
    {
        return [
            'id' => (int) ($attendee['id'] ?? $attendee['user_id'] ?? 0),
            'name' => $attendee['name'] ?? null,
            'first_name' => $attendee['first_name'] ?? null,
            'last_name' => $attendee['last_name'] ?? null,
            'avatar' => $attendee['avatar'] ?? $attendee['avatar_url'] ?? null,
            'avatar_url' => $attendee['avatar_url'] ?? $attendee['avatar'] ?? null,
            'rsvp_status' => $attendee['rsvp_status'] ?? $attendee['status'] ?? null,
            'status' => $attendee['status'] ?? $attendee['rsvp_status'] ?? null,
            'rsvp_at' => $attendee['rsvp_at'] ?? null,
        ];
    }

    /**
     * Explicit People projection. The whitelist deliberately excludes email,
     * phone, notes, registration answers, token material, and audit reasons.
     *
     * `$includeRequiredAnswers` adds registration.required_answers_outstanding
     * (a yes/no flag, never the answers). It is opt-in (`include=required_answers`)
     * because the store mobile app parses this projection with strict schemas
     * and rejects any field it does not know.
     *
     * @return array<string,mixed>
     */
    public static function canonicalFromArray(array $person, bool $includeRequiredAnswers = false): array
    {
        $projection = [
            'member' => [
                'id' => (int) ($person['user_id'] ?? 0),
                'display_name' => self::nullableString($person['display_name'] ?? null),
                'avatar_url' => self::nullableString($person['avatar_url'] ?? null),
            ],
            'engagement' => [
                'state' => self::nullableString($person['engagement_state'] ?? null) ?? 'none',
                'consumes_capacity' => false,
            ],
            'registration' => [
                'id' => self::nullableInt($person['registration_id'] ?? null),
                'state' => self::nullableString($person['registration_state'] ?? null),
                'version' => self::nullableInt($person['registration_version'] ?? null),
                'capacity_pool_key' => self::nullableString(
                    $person['capacity_pool_key'] ?? null,
                ) ?? 'event',
                'allocation_key' => self::nullableString($person['allocation_key'] ?? null),
                'changed_at' => self::nullableString($person['registration_changed_at'] ?? null),
                'confirmed_at' => self::nullableString($person['confirmed_at'] ?? null),
            ],
            'waitlist' => [
                'id' => self::nullableInt($person['waitlist_entry_id'] ?? null),
                'state' => self::nullableString($person['waitlist_state'] ?? null),
                'version' => self::nullableInt($person['waitlist_version'] ?? null),
                'position' => self::nullableInt($person['waitlist_position'] ?? null),
                'sequence' => self::nullableInt($person['waitlist_sequence'] ?? null),
                'offered_at' => self::nullableString($person['offered_at'] ?? null),
                'offer_expires_at' => self::nullableString(
                    $person['offer_expires_at'] ?? null,
                ),
                'accepted_at' => self::nullableString($person['accepted_at'] ?? null),
            ],
            'attendance' => [
                'id' => self::nullableInt($person['attendance_id'] ?? null),
                'state' => self::nullableString($person['attendance_state'] ?? null)
                    ?? 'not_checked_in',
                'version' => self::nullableInt($person['attendance_version'] ?? null),
                'changed_at' => self::nullableString(
                    $person['attendance_changed_at'] ?? null,
                ),
                'checked_in_at' => self::nullableString($person['checked_in_at'] ?? null),
                'checked_out_at' => self::nullableString($person['checked_out_at'] ?? null),
            ],
            'management_actions' => [
                'approve' => (bool) ($person['can_approve'] ?? false),
                'reject' => (bool) ($person['can_reject'] ?? false),
                'cancel' => (bool) ($person['can_cancel'] ?? false),
                'check_in' => (bool) ($person['can_check_in'] ?? false),
                'check_out' => (bool) ($person['can_check_out'] ?? false),
                'no_show' => (bool) ($person['can_no_show'] ?? false),
                'undo_attendance' => (bool) ($person['can_undo_attendance'] ?? false),
                'idempotency_key_required' => true,
            ],
            'privacy' => [
                'sensitive_fields_redacted' => true,
            ],
        ];

        return self::withRequiredAnswers($projection, $person, $includeRequiredAnswers);
    }

    /**
     * Least-privilege projection for check-in staff. Waitlist facts,
     * engagement, allocation keys, and registration mutations are omitted.
     *
     * @return array<string,mixed>
     */
    public static function attendanceFromArray(array $person, bool $includeRequiredAnswers = false): array
    {
        $projection = [
            'member' => [
                'id' => (int) ($person['user_id'] ?? 0),
                'display_name' => self::nullableString($person['display_name'] ?? null),
                'avatar_url' => self::nullableString($person['avatar_url'] ?? null),
            ],
            'registration' => [
                'state' => self::nullableString($person['registration_state'] ?? null),
            ],
            'attendance' => [
                'id' => self::nullableInt($person['attendance_id'] ?? null),
                'state' => self::nullableString($person['attendance_state'] ?? null)
                    ?? 'not_checked_in',
                'version' => self::nullableInt($person['attendance_version'] ?? null),
                'changed_at' => self::nullableString(
                    $person['attendance_changed_at'] ?? null,
                ),
                'checked_in_at' => self::nullableString($person['checked_in_at'] ?? null),
                'checked_out_at' => self::nullableString($person['checked_out_at'] ?? null),
            ],
            'management_actions' => [
                'check_in' => (bool) ($person['can_check_in'] ?? false),
                'check_out' => (bool) ($person['can_check_out'] ?? false),
                'no_show' => (bool) ($person['can_no_show'] ?? false),
                'undo_attendance' => (bool) ($person['can_undo_attendance'] ?? false),
                'idempotency_key_required' => true,
            ],
            'privacy' => [
                'projection' => 'attendance',
                'sensitive_fields_redacted' => true,
            ],
        ];

        return self::withRequiredAnswers($projection, $person, $includeRequiredAnswers);
    }

    /**
     * @param array<string,mixed> $projection
     * @param array<string,mixed> $person
     * @return array<string,mixed>
     */
    private static function withRequiredAnswers(array $projection, array $person, bool $include): array
    {
        if ($include) {
            $projection['registration']['required_answers_outstanding']
                = (bool) ($person['required_answers_outstanding'] ?? false);
        }

        return $projection;
    }

    private static function nullableInt(mixed $value): ?int
    {
        return is_numeric($value) ? (int) $value : null;
    }

    private static function nullableString(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        $value = trim((string) $value);

        return $value === '' ? null : $value;
    }
}
