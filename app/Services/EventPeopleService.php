<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Enums\EventAttendanceAction;
use App\Enums\EventAttendanceState;
use App\Enums\EventCapacityRegistrationState;
use App\Enums\EventWaitlistQueueState;
use App\Exceptions\EventRegistrationException;
use App\Http\Resources\EventRegistrationResource;
use App\Http\Resources\EventRosterResource;
use App\Models\Event;
use App\Models\EventRegistration;
use App\Models\EventWaitlistEntry;
use App\Models\User;
use App\Policies\EventPolicy;
use App\Support\Events\EventPeopleQuery;
use App\Support\Events\EventRegistrationCompatibility;
use BackedEnum;
use Generator;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/** Canonical, redacted relationship and People read model across three axes. */
final class EventPeopleService
{
    public function __construct(private readonly EventPolicy $policy)
    {
    }

    /** @return array<string,mixed> */
    public function relationship(Event $event, User $member): array
    {
        $tenantId = $this->assertScope($event);
        if ((int) $member->tenant_id !== $tenantId || (int) $member->getKey() <= 0) {
            throw new EventRegistrationException('event_registration_subject_not_found');
        }
        $eventId = (int) $event->getKey();
        $userId = (int) $member->getKey();
        $pool = $this->defaultPool();
        /** @var EventRegistration|null $registration */
        $registration = EventRegistration::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->where('capacity_pool_key', $pool)
            ->first();
        /** @var EventWaitlistEntry|null $waitlist */
        $waitlist = EventWaitlistEntry::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->where('capacity_pool_key', $pool)
            ->first();
        $legacyRsvp = DB::table('event_rsvps')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->value('status');
        $legacyWaitlist = DB::table('event_waitlist')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->first(['status', 'position']);
        $attendance = DB::table('event_attendance')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->first([
                'attendance_status',
                'checked_in_at',
                'checked_out_at',
            ]);

        return EventRegistrationResource::fromCanonical(
            $event,
            $member,
            $registration,
            $waitlist,
            $attendance,
            is_string($legacyRsvp) ? $legacyRsvp : null,
            $legacyWaitlist,
            $this->capacity($event),
        );
    }

    /**
     * @return array{
     *   items:list<array<string,mixed>>,
     *   total:int,
     *   page:int,
     *   per_page:int,
     *   metrics:array<string,int>
     * }
     */
    public function paginate(Event $event, EventPeopleQuery $request): array
    {
        $tenantId = $this->assertScope($event);
        $eventId = (int) $event->getKey();
        $query = $this->filteredPeopleFacts($tenantId, $eventId, $request);
        $total = (clone $query)->count('user_id');
        $facts = $this->sortPeopleFacts($query, $request)
            ->offset(($request->page - 1) * $request->perPage)
            ->limit($request->perPage)
            ->get();

        return [
            'items' => array_map(
                static fn (array $person): array => EventRosterResource::canonicalFromArray($person),
                $facts->map(fn (object $fact): array => $this->peopleRow($fact, $event))->all(),
            ),
            'total' => $total,
            'page' => $request->page,
            'per_page' => $request->perPage,
            'metrics' => $this->metrics($tenantId, $eventId),
        ];
    }

    /**
     * Resolve the least-privilege projection for a manager or check-in staffer.
     *
     * @return array{
     *   items:list<array<string,mixed>>,
     *   total:int,
     *   page:int,
     *   per_page:int,
     *   metrics:array<string,int>
     * }
     */
    public function paginateForActor(
        Event $event,
        User $actor,
        EventPeopleQuery $request,
    ): array {
        $this->assertActorScope($event, $actor);
        if ($this->policy->manageRegistration($actor, $event)
            && $this->policy->viewRoster($actor, $event)
            && $this->policy->viewWaitlist($actor, $event)) {
            $result = $this->paginate($event, $request);
            if (! $this->policy->manageAttendance($actor, $event)) {
                $result['items'] = array_map(
                    static function (array $person): array {
                        $person['management_actions']['check_in'] = false;
                        $person['management_actions']['check_out'] = false;
                        $person['management_actions']['no_show'] = false;
                        $person['management_actions']['undo_attendance'] = false;

                        return $person;
                    },
                    $result['items'],
                );
            }

            return $result;
        }
        if (! $this->policy->viewRoster($actor, $event)
            || ! $this->policy->manageAttendance($actor, $event)) {
            throw new EventRegistrationException('event_registration_authorization_denied');
        }
        if ($request->waitlistState !== null
            || $request->engagementState !== null
            || $request->sort === 'queue_rank') {
            throw new EventRegistrationException('event_registration_people_query_invalid');
        }

        $tenantId = $this->assertScope($event);
        $eventId = (int) $event->getKey();
        $query = $this->filteredPeopleFacts($tenantId, $eventId, $request);
        $query->where(function (Builder $eligible): void {
            $eligible->where('registration_state', EventCapacityRegistrationState::Confirmed->value)
                ->orWhereNotNull('attendance_id');
        });
        $total = (clone $query)->count('user_id');
        $facts = $this->sortPeopleFacts($query, $request)
            ->offset(($request->page - 1) * $request->perPage)
            ->limit($request->perPage)
            ->get();

        return [
            'items' => $facts->map(fn (object $fact): array =>
                EventRosterResource::attendanceFromArray($this->peopleRow($fact, $event)))
                ->all(),
            'total' => $total,
            'page' => $request->page,
            'per_page' => $request->perPage,
            'metrics' => $this->attendanceMetrics($tenantId, $eventId),
        ];
    }

    /**
     * Check-in staff may address only confirmed participants or subjects with
     * an existing durable attendance fact. This boundary prevents arbitrary
     * tenant-member IDs from becoming an identity oracle through mutations.
     */
    public function attendanceSubjectVisible(Event $event, int $userId): bool
    {
        $tenantId = $this->assertScope($event);
        if ($userId <= 0) {
            return false;
        }
        $eventId = (int) $event->getKey();
        if (DB::table('event_attendance')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->exists()) {
            return true;
        }

        $canonical = DB::table('event_registrations')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->where('capacity_pool_key', $this->defaultPool())
            ->first(['registration_state']);
        if ($canonical !== null) {
            return (string) $canonical->registration_state
                === EventCapacityRegistrationState::Confirmed->value;
        }

        return DB::table('event_rsvps')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->whereIn('status', ['going', 'attended'])
            ->exists();
    }

    /**
     * Stream a filtered roster without hydrating the whole event into memory.
     *
     * @return Generator<int,array<string,mixed>>
     */
    public function exportRows(Event $event, EventPeopleQuery $request): Generator
    {
        $tenantId = $this->assertScope($event);
        $eventId = (int) $event->getKey();
        $query = $this->sortPeopleFacts(
            $this->filteredPeopleFacts($tenantId, $eventId, $request),
            $request,
        );

        foreach ($query->cursor() as $fact) {
            yield $this->peopleRow($fact, $event);
        }
    }

    /** @return array{limit:?int,confirmed:int,remaining:?int,is_full:bool} */
    public function capacity(Event $event): array
    {
        $tenantId = $this->assertScope($event);
        $eventId = (int) $event->getKey();
        $confirmedIds = $this->confirmedIds($tenantId, $eventId);
        $confirmed = (clone $confirmedIds)->count('user_id');
        $occupied = $this->capacityOccupiedIds($tenantId, $eventId)->count('user_id');
        $limitValue = $event->getRawOriginal('max_attendees');
        $limit = $limitValue === null || $limitValue === '' ? null : (int) $limitValue;

        return [
            'limit' => $limit,
            'confirmed' => $confirmed,
            'remaining' => $limit === null ? null : max(0, $limit - $occupied),
            'is_full' => $limit !== null && $occupied >= $limit,
        ];
    }

    public function capacityOccupiedCount(Event $event): int
    {
        $tenantId = $this->assertScope($event);

        return $this->capacityOccupiedIds($tenantId, (int) $event->getKey())
            ->count('user_id');
    }

    private function filteredPeopleFacts(
        int $tenantId,
        int $eventId,
        EventPeopleQuery $request,
    ): Builder {
        $query = DB::query()->fromSub(
            $this->peopleFacts($tenantId, $eventId),
            'people',
        );

        if ($request->search !== null) {
            $needle = str_replace(
                ['!', '%', '_'],
                ['!!', '!%', '!_'],
                mb_strtolower($request->search),
            );
            $query->where(function (Builder $search) use ($needle): void {
                $search->whereRaw(
                    "LOWER(people.display_name) LIKE ? ESCAPE '!'",
                    ["%{$needle}%"],
                )->orWhereRaw(
                    "LOWER(people.username) LIKE ? ESCAPE '!'",
                    ["%{$needle}%"],
                );
            });
        }
        $this->applyNullableFilter(
            $query,
            'registration_state',
            $request->registrationState,
        );
        if ($request->waitlistState === 'active') {
            $query->whereNotNull('active_queue_rank');
        } else {
            $this->applyNullableFilter(
                $query,
                'waitlist_state',
                $request->waitlistState,
            );
        }
        $this->applyNullableFilter(
            $query,
            'attendance_state',
            $request->attendanceState,
        );
        if ($request->engagementState !== null) {
            $query->where('engagement_state', $request->engagementState);
        }

        return $query;
    }

    private function peopleFacts(int $tenantId, int $eventId): Builder
    {
        $pool = $this->defaultPool();
        $participants = DB::query()->fromSub(
            $this->participantIds($tenantId, $eventId),
            'participant_ids',
        );

        return $participants
            ->join('users as people_user', function ($join) use ($tenantId): void {
                $join->on('people_user.id', '=', 'participant_ids.user_id')
                    ->where('people_user.tenant_id', '=', $tenantId)
                    ->where('people_user.status', '=', 'active')
                    ->whereNull('people_user.deleted_at');
            })
            ->leftJoin('event_registrations as canonical_registration', function ($join) use (
                $tenantId,
                $eventId,
                $pool,
            ): void {
                $join->on('canonical_registration.user_id', '=', 'participant_ids.user_id')
                    ->where('canonical_registration.tenant_id', '=', $tenantId)
                    ->where('canonical_registration.event_id', '=', $eventId)
                    ->where('canonical_registration.capacity_pool_key', '=', $pool);
            })
            ->leftJoin('event_rsvps as legacy_rsvp', function ($join) use (
                $tenantId,
                $eventId,
            ): void {
                $join->on('legacy_rsvp.user_id', '=', 'participant_ids.user_id')
                    ->where('legacy_rsvp.tenant_id', '=', $tenantId)
                    ->where('legacy_rsvp.event_id', '=', $eventId);
            })
            ->leftJoin('event_waitlist_entries as canonical_waitlist', function ($join) use (
                $tenantId,
                $eventId,
                $pool,
            ): void {
                $join->on('canonical_waitlist.user_id', '=', 'participant_ids.user_id')
                    ->where('canonical_waitlist.tenant_id', '=', $tenantId)
                    ->where('canonical_waitlist.event_id', '=', $eventId)
                    ->where('canonical_waitlist.capacity_pool_key', '=', $pool);
            })
            ->leftJoin('event_waitlist as legacy_waitlist', function ($join) use (
                $tenantId,
                $eventId,
            ): void {
                $join->on('legacy_waitlist.user_id', '=', 'participant_ids.user_id')
                    ->where('legacy_waitlist.tenant_id', '=', $tenantId)
                    ->where('legacy_waitlist.event_id', '=', $eventId);
            })
            ->leftJoin('event_attendance as attendance', function ($join) use (
                $tenantId,
                $eventId,
            ): void {
                $join->on('attendance.user_id', '=', 'participant_ids.user_id')
                    ->where('attendance.tenant_id', '=', $tenantId)
                    ->where('attendance.event_id', '=', $eventId);
            })
            ->leftJoin('event_attendance_activity as current_attendance_activity', function ($join) use (
                $tenantId,
                $eventId,
            ): void {
                $join->on('current_attendance_activity.attendance_id', '=', 'attendance.id')
                    ->on(
                        'current_attendance_activity.attendance_version',
                        '=',
                        'attendance.attendance_version',
                    )
                    ->where('current_attendance_activity.tenant_id', '=', $tenantId)
                    ->where('current_attendance_activity.event_id', '=', $eventId);
            })
            ->leftJoinSub(
                $this->activeWaitlistRanks($tenantId, $eventId),
                'active_waitlist',
                'active_waitlist.user_id',
                '=',
                'participant_ids.user_id',
            )
            ->selectRaw(
                <<<'SQL'
participant_ids.user_id,
COALESCE(
    NULLIF(TRIM(people_user.name), ''),
    NULLIF(TRIM(CONCAT_WS(' ', NULLIF(people_user.first_name, ''), NULLIF(people_user.last_name, ''))), '')
) AS display_name,
people_user.username,
people_user.avatar_url,
CASE WHEN legacy_rsvp.status IN ('interested', 'maybe') THEN 'interested' ELSE 'none' END AS engagement_state,
canonical_registration.id AS registration_id,
CASE
    WHEN canonical_registration.id IS NOT NULL THEN canonical_registration.registration_state
    WHEN legacy_rsvp.status IN ('going', 'attended') THEN 'confirmed'
    WHEN legacy_rsvp.status = 'invited' THEN 'invited'
    WHEN legacy_rsvp.status IN ('not_going', 'declined') THEN 'declined'
    WHEN legacy_rsvp.status = 'cancelled' THEN 'cancelled'
    ELSE NULL
END AS registration_state,
canonical_registration.registration_version,
COALESCE(canonical_registration.capacity_pool_key, ?) AS capacity_pool_key,
canonical_registration.allocation_key,
CASE
    WHEN canonical_registration.id IS NOT NULL THEN canonical_registration.state_changed_at
    WHEN legacy_rsvp.status IN ('going', 'attended', 'invited', 'not_going', 'declined', 'cancelled') THEN COALESCE(legacy_rsvp.updated_at, legacy_rsvp.created_at)
    ELSE NULL
END AS registration_changed_at,
CASE
    WHEN canonical_registration.id IS NOT NULL THEN canonical_registration.confirmed_at
    WHEN legacy_rsvp.status IN ('going', 'attended') THEN COALESCE(legacy_rsvp.updated_at, legacy_rsvp.created_at)
    ELSE NULL
END AS confirmed_at,
canonical_waitlist.id AS waitlist_entry_id,
CASE
    WHEN canonical_waitlist.id IS NOT NULL THEN canonical_waitlist.queue_state
    WHEN legacy_waitlist.status = 'waiting' THEN 'waiting'
    WHEN legacy_waitlist.status = 'promoted' THEN 'accepted'
    WHEN legacy_waitlist.status = 'expired' THEN 'expired'
    WHEN legacy_waitlist.status = 'cancelled' THEN 'cancelled'
    ELSE NULL
END AS waitlist_state,
canonical_waitlist.queue_version AS waitlist_version,
COALESCE(canonical_waitlist.queue_sequence, legacy_waitlist.position) AS waitlist_sequence,
active_waitlist.active_queue_rank,
canonical_waitlist.offered_at,
canonical_waitlist.offer_expires_at,
canonical_waitlist.accepted_at,
attendance.id AS attendance_id,
attendance.attendance_version,
current_attendance_activity.id AS attendance_activity_id,
current_attendance_activity.action AS attendance_activity_action,
CASE
    WHEN attendance.attendance_status IS NOT NULL THEN attendance.attendance_status
    WHEN attendance.checked_out_at IS NOT NULL THEN 'checked_out'
    WHEN attendance.checked_in_at IS NOT NULL THEN 'checked_in'
    WHEN legacy_rsvp.status = 'attended' THEN 'attended'
    ELSE 'not_checked_in'
END AS attendance_state,
attendance.checked_in_at,
attendance.checked_out_at,
CASE
    WHEN attendance.id IS NOT NULL THEN COALESCE(attendance.status_changed_at, attendance.updated_at, attendance.checked_out_at, attendance.checked_in_at)
    WHEN legacy_rsvp.status = 'attended' THEN COALESCE(legacy_rsvp.updated_at, legacy_rsvp.created_at)
    ELSE NULL
END AS attendance_changed_at
SQL,
                [$pool],
            );
    }

    private function activeWaitlistRanks(int $tenantId, int $eventId): Builder
    {
        $pool = $this->defaultPool();
        $canonical = DB::table('event_waitlist_entries as ranked_canonical')
            ->selectRaw('ranked_canonical.user_id, ranked_canonical.queue_sequence AS queue_sequence, 0 AS source_priority')
            ->where('ranked_canonical.tenant_id', $tenantId)
            ->where('ranked_canonical.event_id', $eventId)
            ->where('ranked_canonical.capacity_pool_key', $pool)
            ->where(function (Builder $active): void {
                $active->where('ranked_canonical.queue_state', EventWaitlistQueueState::Waiting->value)
                    ->orWhere(function (Builder $offer): void {
                        $offer->where('ranked_canonical.queue_state', EventWaitlistQueueState::Offered->value)
                            ->where('ranked_canonical.offer_expires_at', '>', now());
                    });
            });
        $legacy = DB::table('event_waitlist as ranked_legacy')
            ->selectRaw('ranked_legacy.user_id, ranked_legacy.position AS queue_sequence, 1 AS source_priority')
            ->where('ranked_legacy.tenant_id', $tenantId)
            ->where('ranked_legacy.event_id', $eventId)
            ->where('ranked_legacy.status', 'waiting')
            ->whereNotExists(function (Builder $exists) use (
                $tenantId,
                $eventId,
                $pool,
            ): void {
                $exists->selectRaw('1')
                    ->from('event_waitlist_entries as ranked_override')
                    ->whereColumn('ranked_override.user_id', 'ranked_legacy.user_id')
                    ->where('ranked_override.tenant_id', $tenantId)
                    ->where('ranked_override.event_id', $eventId)
                    ->where('ranked_override.capacity_pool_key', $pool);
            });

        return DB::query()
            ->fromSub($canonical->unionAll($legacy), 'active_queue')
            ->selectRaw(
                'active_queue.user_id, ROW_NUMBER() OVER (ORDER BY active_queue.queue_sequence ASC, active_queue.source_priority ASC, active_queue.user_id ASC) AS active_queue_rank',
            );
    }

    private function sortPeopleFacts(Builder $query, EventPeopleQuery $request): Builder
    {
        $column = match ($request->sort) {
            'registration_changed' => 'registration_changed_at',
            'queue_rank' => 'active_queue_rank',
            'attendance_changed' => 'attendance_changed_at',
            default => 'display_name',
        };

        return $query
            ->orderByRaw("people.{$column} IS NULL ASC")
            ->orderBy("people.{$column}", $request->direction)
            ->orderBy('people.user_id');
    }

    private function applyNullableFilter(
        Builder $query,
        string $column,
        ?string $value,
    ): void {
        if ($value === null) {
            return;
        }
        if ($value === 'none') {
            $query->whereNull($column);

            return;
        }

        $query->where($column, $value);
    }

    /** @return array<string,mixed> */
    private function peopleRow(object $fact, Event $event): array
    {
        $registrationState = EventCapacityRegistrationState::tryFrom(
            self::nullableString($fact->registration_state ?? null) ?? '',
        );
        $attendanceState = EventAttendanceState::tryFrom(
            self::nullableString($fact->attendance_state ?? null) ?? '',
        ) ?? EventAttendanceState::NotCheckedIn;
        $confirmed = $registrationState === EventCapacityRegistrationState::Confirmed;
        $attendanceId = is_numeric($fact->attendance_id ?? null)
            ? (int) $fact->attendance_id
            : null;
        $attendanceVersion = $attendanceId === null
            ? null
            : max(1, is_numeric($fact->attendance_version ?? null)
                ? (int) $fact->attendance_version
                : 1);
        $attendanceActivityId = is_numeric($fact->attendance_activity_id ?? null)
            ? (int) $fact->attendance_activity_id
            : null;
        $attendanceActivityAction = self::nullableString(
            $fact->attendance_activity_action ?? null,
        );
        $actionAvailability = $this->attendanceActionAvailability($event);

        return [
            'user_id' => (int) $fact->user_id,
            'display_name' => self::nullableString($fact->display_name ?? null),
            'avatar_url' => self::nullableString($fact->avatar_url ?? null),
            'engagement_state' => self::nullableString($fact->engagement_state ?? null) ?? 'none',
            'registration_id' => $fact->registration_id ?? null,
            'registration_state' => $registrationState?->value,
            'registration_version' => $registrationState === null
                ? null
                : (is_numeric($fact->registration_version ?? null)
                    ? (int) $fact->registration_version
                    : 0),
            'capacity_pool_key' => $fact->capacity_pool_key ?? $this->defaultPool(),
            'allocation_key' => $fact->allocation_key ?? null,
            'registration_changed_at' => $fact->registration_changed_at ?? null,
            'confirmed_at' => $fact->confirmed_at ?? null,
            'waitlist_entry_id' => $fact->waitlist_entry_id ?? null,
            'waitlist_state' => self::nullableString($fact->waitlist_state ?? null),
            'waitlist_version' => $fact->waitlist_version ?? null,
            'waitlist_position' => $fact->active_queue_rank ?? null,
            'waitlist_sequence' => $fact->waitlist_sequence ?? null,
            'offered_at' => $fact->offered_at ?? null,
            'offer_expires_at' => $fact->offer_expires_at ?? null,
            'accepted_at' => $fact->accepted_at ?? null,
            'attendance_id' => $attendanceId,
            'attendance_version' => $attendanceVersion,
            'attendance_state' => $attendanceState->value,
            'attendance_changed_at' => $fact->attendance_changed_at ?? null,
            'checked_in_at' => $fact->checked_in_at ?? null,
            'checked_out_at' => $fact->checked_out_at ?? null,
            'can_approve' => $registrationState !== null
                && $registrationState !== EventCapacityRegistrationState::Confirmed
                && $registrationState->canTransitionTo(EventCapacityRegistrationState::Confirmed),
            'can_reject' => $registrationState !== null
                && $registrationState !== EventCapacityRegistrationState::Declined
                && $registrationState->canTransitionTo(EventCapacityRegistrationState::Declined),
            'can_cancel' => $registrationState !== null
                && $registrationState !== EventCapacityRegistrationState::Cancelled
                && $registrationState->canTransitionTo(EventCapacityRegistrationState::Cancelled),
            'can_check_in' => $confirmed
                && $attendanceState === EventAttendanceState::NotCheckedIn
                && $actionAvailability['check_in'],
            'can_check_out' => $attendanceState === EventAttendanceState::CheckedIn
                && $actionAvailability['fact_mutation'],
            'can_no_show' => $confirmed
                && $attendanceState === EventAttendanceState::NotCheckedIn
                && $actionAvailability['no_show'],
            'can_undo_attendance' => $attendanceId !== null
                && $attendanceVersion !== null
                && $attendanceVersion > 0
                && $attendanceState !== EventAttendanceState::NotCheckedIn
                && $attendanceActivityId !== null
                && $attendanceActivityAction !== EventAttendanceAction::Undo->value
                && $actionAvailability['fact_mutation'],
        ];
    }

    /** @return array<string,int> */
    private function metrics(int $tenantId, int $eventId): array
    {
        $waitlisted = DB::query()
            ->fromSub($this->activeWaitlistIds($tenantId, $eventId), 'waitlisted')
            ->count('user_id');
        $attendance = $this->attendanceStateMetrics($tenantId, $eventId);

        return [
            'confirmed' => $this->confirmedIds($tenantId, $eventId)->count(),
            'waitlisted' => $waitlisted,
            ...$attendance,
        ];
    }

    /** @return array<string,int> */
    private function attendanceMetrics(int $tenantId, int $eventId): array
    {
        return [
            'confirmed' => $this->confirmedIds($tenantId, $eventId)->count(),
            ...$this->attendanceStateMetrics($tenantId, $eventId),
        ];
    }

    /** @return array{checked_in:int,checked_out:int,no_show:int,attended:int} */
    private function attendanceStateMetrics(int $tenantId, int $eventId): array
    {
        $attendance = DB::table('event_attendance')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->selectRaw(
                <<<'SQL'
SUM(CASE
    WHEN attendance_status = 'checked_in'
      OR (attendance_status IS NULL AND checked_in_at IS NOT NULL AND checked_out_at IS NULL)
    THEN 1 ELSE 0 END) AS checked_in,
SUM(CASE
    WHEN attendance_status = 'checked_out'
      OR (attendance_status IS NULL AND checked_out_at IS NOT NULL)
    THEN 1 ELSE 0 END) AS checked_out,
SUM(CASE WHEN attendance_status = 'no_show' THEN 1 ELSE 0 END) AS no_show,
SUM(CASE WHEN attendance_status = 'attended' THEN 1 ELSE 0 END) AS attended
SQL,
            )
            ->first();

        return [
            'checked_in' => (int) ($attendance?->checked_in ?? 0),
            'checked_out' => (int) ($attendance?->checked_out ?? 0),
            'no_show' => (int) ($attendance?->no_show ?? 0),
            'attended' => (int) ($attendance?->attended ?? 0),
        ];
    }

    /** @return array{check_in:bool,no_show:bool,fact_mutation:bool} */
    private function attendanceActionAvailability(Event $event): array
    {
        if ((bool) $event->getAttribute('is_recurring_template')) {
            return ['check_in' => false, 'no_show' => false, 'fact_mutation' => false];
        }
        $publication = $this->normalizedState($event->getAttribute('publication_status'));
        $operational = $this->normalizedState($event->getAttribute('operational_status'));
        $legacy = $this->normalizedState($event->getAttribute('status')) ?: 'active';
        if (($publication !== '' && $publication !== 'published')
            || in_array($operational, ['cancelled', 'postponed'], true)
            || in_array($legacy, ['draft', 'cancelled'], true)) {
            return ['check_in' => false, 'no_show' => false, 'fact_mutation' => true];
        }

        $start = $this->carbon($event->getAttribute('start_time'));
        if ($start === null) {
            return ['check_in' => false, 'no_show' => false, 'fact_mutation' => true];
        }
        $end = $this->carbon($event->getAttribute('end_time')) ?? $start;
        $now = now();
        $opensBefore = max(0, (int) config('events.attendance.opens_before_minutes', 30));
        $closesAfter = max(0, (int) config('events.attendance.closes_after_hours', 24));

        return [
            'check_in' => ! $now->lt($start->copy()->subMinutes($opensBefore))
                && ! $now->gt($end->copy()->addHours($closesAfter)),
            'no_show' => ! $now->lt($start),
            'fact_mutation' => true,
        ];
    }

    private function assertActorScope(Event $event, User $actor): void
    {
        // Auth is GLOBAL; only resources are tenant-scoped. This compared the
        // ACTOR's home tenant against the event's and so hid the roster from
        // network admins, platform admins and an event's own cross-tenant
        // organiser. The event is still scope-asserted, and EventPolicy still
        // decides which projection the actor may see.
        $this->assertScope($event);
        if ((int) $actor->getKey() <= 0
            || (string) $actor->status !== 'active'
            || $actor->deleted_at !== null) {
            throw new EventRegistrationException('event_registration_authorization_denied');
        }
    }

    private function carbon(mixed $value): ?Carbon
    {
        if ($value === null || $value === '') {
            return null;
        }
        try {
            return Carbon::parse($value, 'UTC');
        } catch (\Throwable) {
            return null;
        }
    }

    private function normalizedState(mixed $value): string
    {
        if ($value instanceof BackedEnum) {
            $value = $value->value;
        }

        return strtolower(trim(is_scalar($value) ? (string) $value : ''));
    }

    private function participantIds(int $tenantId, int $eventId): Builder
    {
        $pool = $this->defaultPool();
        $query = DB::table('event_registrations')
            ->select('user_id')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('capacity_pool_key', $pool);

        return $query
            ->union(DB::table('event_rsvps')->select('user_id')
                ->where('tenant_id', $tenantId)->where('event_id', $eventId))
            ->union(DB::table('event_waitlist_entries')->select('user_id')
                ->where('tenant_id', $tenantId)->where('event_id', $eventId)
                ->where('capacity_pool_key', $pool))
            ->union(DB::table('event_waitlist')->select('user_id')
                ->where('tenant_id', $tenantId)->where('event_id', $eventId))
            ->union(DB::table('event_attendance')->select('user_id')
                ->where('tenant_id', $tenantId)->where('event_id', $eventId));
    }

    private function confirmedIds(int $tenantId, int $eventId): Builder
    {
        $pool = $this->defaultPool();
        $query = DB::table('event_registrations')
            ->select('user_id')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('capacity_pool_key', $pool)
            ->where('registration_state', EventCapacityRegistrationState::Confirmed->value);

        $legacy = DB::table('event_rsvps')
                ->select('user_id')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->whereIn('status', ['going', 'attended'])
                ->whereNotExists(function ($canonical) use (
                    $tenantId,
                    $eventId,
                    $pool,
                ): void {
                    $canonical->selectRaw('1')
                        ->from('event_registrations as canonical_registration')
                        ->whereColumn('canonical_registration.user_id', 'event_rsvps.user_id')
                        ->where('canonical_registration.tenant_id', $tenantId)
                        ->where('canonical_registration.event_id', $eventId)
                        ->where('canonical_registration.capacity_pool_key', $pool);
                });

        return DB::query()->fromSub($query->union($legacy), 'confirmed');
    }

    private function activeWaitlistIds(int $tenantId, int $eventId): Builder
    {
        $pool = $this->defaultPool();
        $query = DB::table('event_waitlist_entries')
            ->select('user_id')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('capacity_pool_key', $pool)
            ->where(function (Builder $active): void {
                $active->where('queue_state', EventWaitlistQueueState::Waiting->value)
                    ->orWhere(function (Builder $offer): void {
                        $offer->where('queue_state', EventWaitlistQueueState::Offered->value)
                            ->where('offer_expires_at', '>', now());
                    });
            });

        $legacy = DB::table('event_waitlist')
                ->select('user_id')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('status', 'waiting')
                ->whereNotExists(function ($canonical) use (
                    $tenantId,
                    $eventId,
                    $pool,
                ): void {
                    $canonical->selectRaw('1')
                        ->from('event_waitlist_entries as canonical_waitlist')
                        ->whereColumn('canonical_waitlist.user_id', 'event_waitlist.user_id')
                        ->where('canonical_waitlist.tenant_id', $tenantId)
                        ->where('canonical_waitlist.event_id', $eventId)
                        ->where('canonical_waitlist.capacity_pool_key', $pool);
                });

        return $query->union($legacy);
    }

    private function activeOfferIds(int $tenantId, int $eventId): Builder
    {
        return DB::table('event_waitlist_entries')
            ->select('user_id')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('capacity_pool_key', $this->defaultPool())
            ->where('queue_state', EventWaitlistQueueState::Offered->value)
            ->where('offer_expires_at', '>', now());
    }

    private function capacityOccupiedIds(int $tenantId, int $eventId): Builder
    {
        return DB::query()->fromSub(
            $this->confirmedIds($tenantId, $eventId)
                ->select('user_id')
                ->union($this->activeOfferIds($tenantId, $eventId)),
            'capacity_occupied',
        );
    }

    private function assertScope(Event $event): int
    {
        $tenantId = TenantContext::currentId();
        if ($tenantId === null || $tenantId <= 0
            || (int) $event->tenant_id !== $tenantId
            || (int) $event->getKey() <= 0) {
            throw new EventRegistrationException('event_registration_event_not_found');
        }

        return $tenantId;
    }

    private function defaultPool(): string
    {
        $pool = trim((string) config(
            'events.registration.default_capacity_pool_key',
            EventRegistrationCompatibility::DEFAULT_CAPACITY_POOL,
        ));

        return $pool === '' ? EventRegistrationCompatibility::DEFAULT_CAPACITY_POOL : $pool;
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
