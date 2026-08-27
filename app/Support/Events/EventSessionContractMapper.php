<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Events;

use App\Models\Event;
use App\Models\EventSession;
use BackedEnum;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Crypt;
use Throwable;
use App\Support\UserDisplayName;

/** Privacy-safe serializer for the independent Events agenda v1 contract. */
final class EventSessionContractMapper
{
    public const CONTRACT_VERSION = 1;

    /**
     * @param iterable<EventSession|array<string,mixed>> $sessions
     * @param array<string,mixed> $facts
     * @return array<string,mixed>
     */
    public static function agenda(Event|array $event, iterable $sessions, array $facts = []): array
    {
        $eventData = self::source($event);
        $canManage = (bool) ($facts['can_manage'] ?? false);
        $projected = [];
        foreach ($sessions as $session) {
            $projected[] = self::session($session, $canManage);
        }
        usort($projected, static function (array $left, array $right): int {
            return [$left['start_at'], $left['position'], $left['id']]
                <=> [$right['start_at'], $right['position'], $right['id']];
        });

        return [
            'contract_version' => self::CONTRACT_VERSION,
            'event_id' => self::intValue($eventData['id'] ?? 0),
            'agenda_version' => max(
                0,
                self::intValue($facts['agenda_version'] ?? $eventData['agenda_version'] ?? 0),
            ),
            'timezone' => self::nullableString($eventData['timezone'] ?? null) ?? 'UTC',
            // The parent event's lifecycle travels WITH the agenda. Sessions
            // carry their own status ('scheduled') which says nothing about
            // whether the event still exists, so an agenda for a cancelled
            // event used to render every session as perfectly live. Nothing
            // cascades to event_sessions on cancellation by design — the
            // agenda is preserved as a record — so the honest fix is to tell
            // the client the truth about the parent.
            'event_status' => [
                'operational_status' => self::enumValue(
                    $eventData['operational_status'] ?? 'scheduled',
                ),
                'publication_status' => self::enumValue(
                    $eventData['publication_status'] ?? 'published',
                ),
                'is_cancelled' => self::enumValue(
                    $eventData['operational_status'] ?? 'scheduled',
                ) === 'cancelled',
            ],
            'permissions' => [
                'manage' => $canManage,
            ],
            'sessions' => $projected,
        ];
    }

    /** @return array<string,mixed> */
    public static function session(
        EventSession|array $session,
        bool $canManage = false,
    ): array
    {
        $sessionModel = $session instanceof EventSession ? $session : null;
        $data = self::source($session);
        $speakers = is_iterable($data['speakers'] ?? null) ? $data['speakers'] : [];
        $projectedSpeakers = [];
        foreach ($speakers as $speaker) {
            if ($speaker instanceof Model || is_array($speaker)) {
                $projectedSpeakers[] = self::speaker($speaker);
            }
        }
        usort($projectedSpeakers, static fn (array $left, array $right): int =>
            [$left['position'], $left['member_id'] ?? PHP_INT_MAX, $left['display_name'] ?? '']
                <=> [$right['position'], $right['member_id'] ?? PHP_INT_MAX, $right['display_name'] ?? '']);

        $canManage = $canManage || (bool) (
            $sessionModel?->getAttribute('viewer_can_manage')
            ?? $data['viewer_can_manage']
            ?? false
        );
        $canViewRegistered = $canManage
            || (bool) (
                $sessionModel?->getAttribute('viewer_can_view_registered')
                ?? $data['viewer_can_view_registered']
                ?? false
            );
        $canViewStaff = $canManage
            || (bool) (
                $sessionModel?->getAttribute('viewer_can_view_staff')
                ?? $data['viewer_can_view_staff']
                ?? false
            );
        $resources = $sessionModel !== null && $sessionModel->relationLoaded('resources')
            ? $sessionModel->getRelation('resources')
            : ($data['resources'] ?? []);
        $projectedResources = [];
        if (is_iterable($resources)) {
            foreach ($resources as $resource) {
                if ($resource instanceof Model || is_array($resource)) {
                    $projected = self::resource(
                        $resource,
                        $canViewRegistered,
                        $canViewStaff,
                    );
                    if ($projected !== null) {
                        $projectedResources[] = $projected;
                    }
                }
            }
        }
        usort($projectedResources, static fn (array $left, array $right): int =>
            [$left['position'], $left['id']] <=> [$right['position'], $right['id']]);
        $capacityLimit = self::nullableInt($data['capacity'] ?? null);
        $capacityRegistered = max(
            0,
            self::intValue(
                $sessionModel?->getAttribute('capacity_registered')
                ?? $data['capacity_registered']
                ?? 0,
            ),
        );
        $capacityRemaining = $capacityLimit === null
            ? null
            : max(0, $capacityLimit - $capacityRegistered);
        $registrationState = self::nullableString(
            $sessionModel?->getAttribute('viewer_registration_state')
            ?? $data['viewer_registration_state']
            ?? null,
        ) ?? 'not_registered';
        if (! in_array($registrationState, [
            'not_registered',
            'registered',
            'withdrawn',
            'ineligible',
        ], true)) {
            $registrationState = 'not_registered';
        }

        return [
            'id' => self::intValue($data['id'] ?? 0),
            'version' => max(1, self::intValue($data['version'] ?? 1)),
            'title' => self::publicText($data['title'] ?? null) ?? '',
            'description' => self::publicText($data['description'] ?? null),
            'type' => self::enumValue($data['session_type'] ?? $data['type'] ?? 'session'),
            'visibility' => self::enumValue($data['visibility'] ?? 'public'),
            'capacity' => [
                'limit' => $capacityLimit,
                'registered' => $capacityRegistered,
                'remaining' => $capacityRemaining,
                'is_full' => $capacityLimit !== null && $capacityRemaining === 0,
            ],
            'registration' => [
                'state' => $registrationState,
                'version' => max(
                    0,
                    self::intValue(
                        $sessionModel?->getAttribute('viewer_registration_version')
                        ?? $data['viewer_registration_version']
                        ?? 0,
                    ),
                ),
                'can_register' => (bool) (
                    $sessionModel?->getAttribute('viewer_can_register')
                    ?? $data['viewer_can_register']
                    ?? false
                ),
                'can_withdraw' => (bool) (
                    $sessionModel?->getAttribute('viewer_can_withdraw')
                    ?? $data['viewer_can_withdraw']
                    ?? false
                ),
            ],
            'status' => self::enumValue($data['status'] ?? 'scheduled'),
            'start_at' => self::dateString($data['starts_at_utc'] ?? $data['start_at'] ?? null),
            'end_at' => self::dateString($data['ends_at_utc'] ?? $data['end_at'] ?? null),
            'timezone' => self::nullableString($data['timezone'] ?? null) ?? 'UTC',
            'track' => self::publicText($data['track_name'] ?? $data['track'] ?? null),
            'room' => self::publicText($data['room_name'] ?? $data['room'] ?? null),
            'position' => max(0, self::intValue($data['position'] ?? 0)),
            'cancellation_reason' => $canManage
                ? self::publicText($data['cancellation_reason'] ?? null)
                : null,
            'speakers' => $projectedSpeakers,
            'resources' => $projectedResources,
        ];
    }

    /** @return array<string,mixed>|null */
    private static function resource(
        Model|array $resource,
        bool $canViewRegistered,
        bool $canViewStaff,
    ): ?array {
        $data = self::source($resource);
        $visibility = self::enumValue($data['visibility'] ?? 'public');
        $isVisible = match ($visibility) {
            'public' => true,
            'registered' => $canViewRegistered,
            'staff' => $canViewStaff,
            default => false,
        };
        $type = self::enumValue($data['resource_type'] ?? $data['type'] ?? 'link');
        $protected = in_array($type, ['stream', 'recording'], true);
        if (! $isVisible || ($protected && ! $canViewRegistered && ! $canViewStaff)) {
            return null;
        }

        $url = null;
        try {
            if ($resource instanceof Model) {
                $ciphertext = $resource->getRawOriginal('url_ciphertext');
                if (is_string($ciphertext) && $ciphertext !== '') {
                    $url = Crypt::decryptString($ciphertext);
                }
            } else {
                $url = self::nullableString($data['url'] ?? null);
            }
        } catch (Throwable) {
            $url = null;
        }
        if (! self::isSafeHttpsUrl($url)) {
            $url = null;
        }

        return [
            'id' => self::intValue($data['id'] ?? 0),
            'type' => $type,
            'title' => self::publicText($data['title'] ?? null) ?? '',
            'visibility' => $visibility,
            'position' => max(0, self::intValue($data['position'] ?? 0)),
            'protected' => $protected,
            'available' => $url !== null,
            'url' => $url,
        ];
    }

    /** @return array<string,mixed> */
    private static function speaker(Model|array $speaker): array
    {
        $data = self::source($speaker);
        $user = isset($data['user']) && ($data['user'] instanceof Model || is_array($data['user']))
            ? self::source($data['user'])
            : [];
        $memberId = self::nullableInt($data['user_id'] ?? null);
        $displayName = self::publicText($data['display_name'] ?? null);
        if ($memberId !== null && $user !== []) {
            $displayName = self::displayName($user) ?? $displayName;
        }

        return [
            'kind' => $memberId === null ? 'external' : 'member',
            'member_id' => $memberId,
            'display_name' => $displayName,
            'role' => self::publicText($data['role_label'] ?? $data['role'] ?? null),
            'position' => max(0, self::intValue($data['position'] ?? 0)),
        ];
    }

    /** @return array<string,mixed> */
    private static function source(Model|array $source): array
    {
        return $source instanceof Model ? $source->toArray() : $source;
    }

    /** @param array<string,mixed> $user */
    private static function displayName(array $user): ?string
    {
        $name = self::publicText($user['display_name'] ?? $user['name'] ?? null);
        if ($name !== null) {
            return $name;
        }

        return self::publicText(trim(
            UserDisplayName::resolve($user),
        ));
    }

    private static function dateString(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        try {
            $date = $value instanceof DateTimeInterface
                ? CarbonImmutable::instance($value)
                : CarbonImmutable::parse((string) $value);

            return $date->utc()->toIso8601String();
        } catch (Throwable) {
            return null;
        }
    }

    private static function enumValue(mixed $value): string
    {
        return $value instanceof BackedEnum
            ? (string) $value->value
            : trim((string) $value);
    }

    private static function publicText(mixed $value): ?string
    {
        $value = self::nullableString($value);
        if ($value === null) {
            return null;
        }

        $plain = trim(html_entity_decode(strip_tags($value), ENT_QUOTES | ENT_HTML5, 'UTF-8'));

        return $plain !== '' ? $plain : null;
    }

    private static function nullableString(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $value = trim((string) $value);

        return $value !== '' ? $value : null;
    }

    private static function intValue(mixed $value): int
    {
        return is_numeric($value) ? (int) $value : 0;
    }

    private static function nullableInt(mixed $value): ?int
    {
        return is_numeric($value) && (int) $value > 0 ? (int) $value : null;
    }

    private static function isSafeHttpsUrl(?string $url): bool
    {
        if ($url === null || filter_var($url, FILTER_VALIDATE_URL) === false) {
            return false;
        }
        $parts = parse_url($url);

        return is_array($parts)
            && strtolower((string) ($parts['scheme'] ?? '')) === 'https'
            && trim((string) ($parts['host'] ?? '')) !== ''
            && ! isset($parts['user'])
            && ! isset($parts['pass']);
    }
}
