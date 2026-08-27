<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Resources;

use App\Models\EventStatusHistory;
use App\Models\User;
use BackedEnum;
use DateTimeInterface;
use App\Support\UserDisplayName;

/** Allowlisted manager projection of immutable Event lifecycle evidence. */
final class EventLifecycleHistoryResource
{
    /** @return array<string,mixed> */
    public static function fromModel(EventStatusHistory $history): array
    {
        $actor = $history->relationLoaded('actor') && $history->actor instanceof User
            ? $history->actor
            : null;
        $displayName = $actor === null
            ? null
            : UserDisplayName::resolve($actor);

        return [
            'id' => (int) $history->getKey(),
            'lifecycle_version' => (int) $history->lifecycle_version,
            'publication' => [
                'from' => self::enum($history->from_publication_status),
                'to' => self::enum($history->to_publication_status),
            ],
            'operational' => [
                'from' => self::enum($history->from_operational_status),
                'to' => self::enum($history->to_operational_status),
            ],
            'reason' => self::nullableString($history->reason),
            'actor' => [
                'id' => (int) $history->actor_user_id,
                'display_name' => $displayName === null || $displayName === ''
                    ? null
                    : $displayName,
            ],
            'evidence' => self::evidence($history->metadata),
            'created_at' => self::timestamp($history->created_at),
            'immutable' => true,
        ];
    }

    private static function enum(mixed $value): string
    {
        if ($value instanceof BackedEnum) {
            return (string) $value->value;
        }

        return (string) $value;
    }

    /** @return array<string,mixed> */
    private static function evidence(mixed $metadata): array
    {
        if (! is_array($metadata)) {
            return [
                'axes_changed' => [],
                'cascade' => [],
                'series' => null,
                'notifications_suppressed' => false,
            ];
        }

        $axes = is_array($metadata['axes_changed'] ?? null)
            ? array_values(array_filter(
                $metadata['axes_changed'],
                static fn (mixed $axis): bool => is_string($axis)
                    && in_array($axis, ['publication', 'operational'], true),
            ))
            : [];
        $cascade = is_array($metadata['cascade'] ?? null)
            ? $metadata['cascade']
            : [];
        $safeCascade = [];
        foreach ([
            'reminders_cancelled',
            'waitlist_cancelled',
            'registrations_cancelled',
        ] as $key) {
            if (isset($cascade[$key]) && is_numeric($cascade[$key])) {
                $safeCascade[$key] = max(0, (int) $cascade[$key]);
            }
        }

        $series = null;
        $rawSeries = $metadata['series'] ?? null;
        if (is_array($rawSeries)
            && isset($rawSeries['root_event_id'])
            && is_numeric($rawSeries['root_event_id'])
            && (int) $rawSeries['root_event_id'] > 0
            && in_array($rawSeries['member_type'] ?? null, ['template', 'occurrence'], true)) {
            $series = [
                'root_event_id' => (int) $rawSeries['root_event_id'],
                'member_type' => (string) $rawSeries['member_type'],
            ];
        }

        return [
            'axes_changed' => $axes,
            'cascade' => $safeCascade,
            'series' => $series,
            'notifications_suppressed' => ($metadata['notifications_suppressed'] ?? false) === true,
        ];
    }

    private static function nullableString(mixed $value): ?string
    {
        return is_string($value) && trim($value) !== '' ? $value : null;
    }

    private static function timestamp(mixed $value): ?string
    {
        if ($value instanceof DateTimeInterface) {
            return $value->format(DATE_ATOM);
        }

        return is_string($value) && trim($value) !== '' ? $value : null;
    }
}
