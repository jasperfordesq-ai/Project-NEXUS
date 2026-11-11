<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Exceptions\EventRegistrationException;
use App\Models\Event;
use App\Models\User;
use App\Policies\EventPolicy;
use App\Support\Events\EventPeopleQuery;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/** Redacted, immutable cross-ledger timeline for one Event People subject. */
final class EventPeopleHistoryService
{
    public function __construct(private readonly EventPolicy $policy)
    {
    }

    /**
     * @return array{items:list<array<string,mixed>>,total:int,page:int,per_page:int}
     */
    public function paginate(
        Event $event,
        User $member,
        User $actor,
        int $page = 1,
        int $perPage = 50,
    ): array {
        $tenantId = TenantContext::currentId();
        if ($tenantId === null
            || $tenantId <= 0
            || (int) $event->tenant_id !== $tenantId
            || (int) $member->tenant_id !== $tenantId
            || (int) $actor->tenant_id !== $tenantId
            || $page < 1
            || $perPage < 1
            || $perPage > 100) {
            throw new EventRegistrationException('event_registration_people_query_invalid');
        }
        $maximumPage = intdiv(EventPeopleQuery::MAX_ADDRESSABLE_ROWS - 1, $perPage) + 1;
        if ($page > $maximumPage) {
            throw new EventRegistrationException('event_registration_people_query_invalid');
        }
        $canRegistration = $this->policy->manageRegistration($actor, $event);
        $canAttendance = $this->policy->manageAttendance($actor, $event);
        if (! $this->policy->viewRoster($actor, $event)
            || (! $canRegistration && ! $canAttendance)) {
            throw new EventRegistrationException('event_registration_authorization_denied');
        }
        if (! $canRegistration
            && ! $this->attendanceSubjectVisible(
                $tenantId,
                (int) $event->getKey(),
                (int) $member->getKey(),
            )) {
            throw new EventRegistrationException('event_registration_subject_not_found');
        }

        $history = DB::query()->fromSub(
            $this->historyFacts(
                $tenantId,
                (int) $event->getKey(),
                (int) $member->getKey(),
                $canRegistration,
                $canAttendance,
            ),
            'people_history',
        )->leftJoin('users as history_actor', function ($join) use ($tenantId): void {
            $join->on('history_actor.id', '=', 'people_history.actor_user_id')
                ->where('history_actor.tenant_id', '=', $tenantId);
        })->selectRaw(
            // E-122: audience-aware actor name (first name unless staff).
            \App\Support\UserDisplayName::sql('history_actor', 'actor_display_name') . ",\n" . <<<'SQL'
people_history.axis,
people_history.entry_id,
people_history.version,
people_history.sequence,
people_history.action,
people_history.from_state,
people_history.to_state,
people_history.actor_user_id,
people_history.reason,
people_history.created_at
SQL,
        );
        $total = (clone $history)->count('entry_id');
        $rows = $history
            ->orderByDesc('people_history.created_at')
            ->orderByDesc('people_history.entry_id')
            ->orderBy('people_history.axis')
            ->offset(($page - 1) * $perPage)
            ->limit($perPage)
            ->get();

        return [
            'items' => $rows->map(static fn (object $row): array => [
                'axis' => (string) $row->axis,
                'entry_id' => (int) $row->entry_id,
                'version' => (int) $row->version,
                'sequence' => is_numeric($row->sequence ?? null)
                    ? (int) $row->sequence
                    : null,
                'action' => (string) $row->action,
                'from_state' => self::nullableString($row->from_state ?? null),
                'to_state' => (string) $row->to_state,
                'actor' => [
                    'id' => is_numeric($row->actor_user_id ?? null)
                        ? (int) $row->actor_user_id
                        : null,
                    'display_name' => self::nullableString(
                        $row->actor_display_name ?? null,
                    ),
                ],
                'reason' => self::nullableString($row->reason ?? null),
                'created_at' => (string) $row->created_at,
            ])->all(),
            'total' => $total,
            'page' => $page,
            'per_page' => $perPage,
        ];
    }

    private function historyFacts(
        int $tenantId,
        int $eventId,
        int $userId,
        bool $includeRegistration,
        bool $includeAttendance,
    ): Builder {
        $registration = DB::table('event_registration_history')
            ->selectRaw(
                "'registration' AS axis, id AS entry_id, registration_version AS version, NULL AS sequence, action, from_state, to_state, actor_user_id, reason, created_at",
            )
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $userId);
        $waitlist = DB::table('event_waitlist_entry_history')
            ->selectRaw(
                "'waitlist' AS axis, id AS entry_id, queue_version AS version, queue_sequence AS sequence, action, from_state, to_state, actor_user_id, reason, created_at",
            )
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $userId);
        $attendance = DB::table('event_attendance_activity')
            ->selectRaw(
                "'attendance' AS axis, id AS entry_id, attendance_version AS version, NULL AS sequence, action, from_status AS from_state, to_status AS to_state, actor_user_id, reason, created_at",
            )
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $userId);

        if (! $includeRegistration) {
            return $attendance;
        }
        $history = $registration->unionAll($waitlist);

        return $includeAttendance ? $history->unionAll($attendance) : $history;
    }

    private function attendanceSubjectVisible(
        int $tenantId,
        int $eventId,
        int $userId,
    ): bool {
        if (DB::table('event_attendance')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->exists()) {
            return true;
        }
        $pool = trim((string) config(
            'events.registration.default_capacity_pool_key',
            'event',
        )) ?: 'event';
        $canonical = DB::table('event_registrations')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->where('capacity_pool_key', $pool)
            ->first(['registration_state']);
        if ($canonical !== null) {
            return (string) $canonical->registration_state === 'confirmed';
        }

        return DB::table('event_rsvps')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->whereIn('status', ['going', 'attended'])
            ->exists();
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
