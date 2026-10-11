<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Events;

use App\Exceptions\EventRegistrationException;

/** Normalized, bounded query contract for the canonical Event People workspace. */
final readonly class EventPeopleQuery
{
    public const MAX_ADDRESSABLE_ROWS = 10_000;

    /** @var list<string> */
    private const REGISTRATION_STATES = [
        'none', 'invited', 'pending', 'confirmed', 'declined', 'cancelled',
    ];

    /** @var list<string> */
    private const WAITLIST_STATES = [
        'none', 'active', 'waiting', 'offered', 'accepted', 'expired', 'cancelled',
    ];

    /** @var list<string> */
    private const ATTENDANCE_STATES = [
        'not_checked_in', 'checked_in', 'checked_out', 'attended', 'no_show',
    ];

    /** @var list<string> */
    private const ENGAGEMENT_STATES = ['none', 'interested'];

    /**
     * Opt-in additions to the People projection. Each is absent by default
     * because the store mobile app parses the response with strict schemas.
     *
     * @var list<string>
     */
    private const INCLUDES = ['required_answers'];

    /** @var list<string> */
    private const SORTS = [
        'name', 'registration_changed', 'queue_rank', 'attendance_changed',
    ];

    public function __construct(
        public int $page = 1,
        public int $perPage = 25,
        public ?string $search = null,
        public ?string $registrationState = null,
        public ?string $waitlistState = null,
        public ?string $attendanceState = null,
        public ?string $engagementState = null,
        public string $sort = 'name',
        public string $direction = 'asc',
        public bool $includeRequiredAnswers = false,
    ) {
        if ($page < 1 || $perPage < 1 || $perPage > 100) {
            throw new EventRegistrationException('event_registration_people_query_invalid');
        }
        $maximumPage = intdiv(self::MAX_ADDRESSABLE_ROWS - 1, $perPage) + 1;
        if ($page > $maximumPage) {
            throw new EventRegistrationException('event_registration_people_query_invalid');
        }
        if ($search !== null && mb_strlen($search) > 100) {
            throw new EventRegistrationException('event_registration_people_query_invalid');
        }
        $this->assertAllowed($registrationState, self::REGISTRATION_STATES);
        $this->assertAllowed($waitlistState, self::WAITLIST_STATES);
        $this->assertAllowed($attendanceState, self::ATTENDANCE_STATES);
        $this->assertAllowed($engagementState, self::ENGAGEMENT_STATES);
        if (! in_array($sort, self::SORTS, true)
            || ! in_array($direction, ['asc', 'desc'], true)) {
            throw new EventRegistrationException('event_registration_people_query_invalid');
        }
    }

    /** @param array<string,mixed> $input */
    public static function fromArray(array $input): self
    {
        return new self(
            page: self::integer($input['page'] ?? 1),
            perPage: self::integer($input['per_page'] ?? 25),
            search: self::nullable($input['search'] ?? null),
            registrationState: self::filter($input['registration_state'] ?? null),
            waitlistState: self::filter($input['waitlist_state'] ?? null),
            attendanceState: self::filter($input['attendance_state'] ?? null),
            engagementState: self::filter($input['engagement_state'] ?? null),
            sort: self::nullable($input['sort'] ?? null) ?? 'name',
            direction: strtolower(self::nullable($input['direction'] ?? null) ?? 'asc'),
            includeRequiredAnswers: in_array(
                'required_answers',
                self::includes($input['include'] ?? null),
                true,
            ),
        );
    }

    /** @return list<string> */
    private static function includes(mixed $value): array
    {
        $value = self::nullable($value);
        if ($value === null) {
            return [];
        }
        $includes = array_map('trim', explode(',', strtolower($value)));
        foreach ($includes as $include) {
            if (! in_array($include, self::INCLUDES, true)) {
                throw new EventRegistrationException('event_registration_people_query_invalid');
            }
        }

        return $includes;
    }

    /** @return array<string,string|int|null> */
    public function meta(): array
    {
        return [
            'search' => $this->search,
            'registration_state' => $this->registrationState,
            'waitlist_state' => $this->waitlistState,
            'attendance_state' => $this->attendanceState,
            'engagement_state' => $this->engagementState,
            'sort' => $this->sort,
            'direction' => $this->direction,
        ];
    }

    /** @param list<string> $allowed */
    private function assertAllowed(?string $value, array $allowed): void
    {
        if ($value !== null && ! in_array($value, $allowed, true)) {
            throw new EventRegistrationException('event_registration_people_query_invalid');
        }
    }

    private static function integer(mixed $value): int
    {
        if (is_int($value)) {
            return $value;
        }
        if (is_string($value) && preg_match('/^[0-9]+$/', $value) === 1) {
            return (int) $value;
        }

        throw new EventRegistrationException('event_registration_people_query_invalid');
    }

    private static function filter(mixed $value): ?string
    {
        $value = strtolower(self::nullable($value) ?? '');

        return $value === '' || $value === 'all' ? null : $value;
    }

    private static function nullable(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        if (! is_string($value)) {
            throw new EventRegistrationException('event_registration_people_query_invalid');
        }

        $value = trim($value);

        return $value === '' ? null : $value;
    }
}
