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
use App\Exceptions\EventAttendanceException;
use App\Models\Event;
use App\Models\EventAttendance;
use App\Models\User;
use App\Policies\EventPolicy;
use App\Support\Events\EventAttendanceResult;
use App\Support\Events\EventAttendanceTransitionResult;
use BackedEnum;
use DateTimeInterface;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use JsonException;

/** Serialized, tenant-safe attendance recording boundary. */
final class EventAttendanceService
{
    private const LEGACY_ATTENDANCE_REGISTRATION_STATES = ['going', 'attended'];
    private const MAX_NOTES_LENGTH = 4000;
    private const MAX_REASON_LENGTH = 4000;
    private const OUTBOX_ACTION = 'event.attendance.recorded';
    private const TRANSITION_OUTBOX_ACTION = 'event.attendance.transitioned';

    public function __construct(
        private readonly EventPolicy $policy,
        private readonly EventCreditService $creditService,
        private readonly EventDomainOutboxService $outbox,
    ) {
    }

    public function record(
        int $eventId,
        int $attendeeId,
        User $actor,
        ?float $hoursOverride = null,
        ?string $notes = null,
        ?string $idempotencyKey = null,
    ): EventAttendanceResult {
        $tenantId = TenantContext::currentId();
        if ($tenantId === null || $tenantId <= 0) {
            throw new EventAttendanceException('event_attendance_tenant_context_missing');
        }
        if ($eventId <= 0 || $attendeeId <= 0 || (int) $actor->getKey() <= 0) {
            throw new EventAttendanceException('event_attendance_subject_invalid');
        }

        $notes = $this->normalizeNotes($notes);
        $this->validateHours($hoursOverride);
        $idempotencyKey = $this->normalizeIdempotencyKey(
            $idempotencyKey,
            $tenantId,
            $eventId,
            $attendeeId,
        );

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $attendeeId,
            $actor,
            $notes,
            $idempotencyKey,
        ): EventAttendanceResult {
            /** @var Event|null $event */
            $event = Event::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey($eventId)
                ->sharedLock()
                ->first();
            if ($event === null) {
                throw new EventAttendanceException('event_attendance_event_not_found');
            }

            /** @var User|null $persistedActor */
            $persistedActor = User::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey((int) $actor->getKey())
                ->where('status', 'active')
                ->whereNull('deleted_at')
                ->first();
            if ($persistedActor === null || ! $this->policy->manageAttendance($persistedActor, $event)) {
                throw new EventAttendanceException('event_attendance_authorization_denied');
            }

            $this->assertEventAcceptsAttendance($event);

            /** @var User|null $attendee */
            $attendee = User::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey($attendeeId)
                ->where('status', 'active')
                ->whereNull('deleted_at')
                ->lockForUpdate()
                ->first();
            if ($attendee === null) {
                throw new EventAttendanceException('event_attendance_attendee_not_found');
            }

            $canonicalRegistration = DB::table('event_registrations')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('user_id', $attendeeId)
                ->where('capacity_pool_key', $this->defaultCapacityPool())
                ->lockForUpdate()
                ->first(['id', 'registration_state']);
            $legacyRegistration = DB::table('event_rsvps')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('user_id', $attendeeId)
                ->lockForUpdate()
                ->first(['id', 'status']);
            if ($canonicalRegistration !== null) {
                if ((string) $canonicalRegistration->registration_state !== 'confirmed') {
                    throw new EventAttendanceException('event_attendance_registration_required');
                }
            } elseif ($legacyRegistration === null
                || ! in_array(
                    (string) $legacyRegistration->status,
                    self::LEGACY_ATTENDANCE_REGISTRATION_STATES,
                    true,
                )) {
                throw new EventAttendanceException('event_attendance_registration_required');
            }

            /** @var EventAttendance|null $existing */
            $existing = EventAttendance::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('user_id', $attendeeId)
                ->lockForUpdate()
                ->first();
            if ($existing !== null) {
                return new EventAttendanceResult($existing, 'already_checked_in', 'disabled', null, null);
            }

            $now = now();
            $inserted = DB::table('event_attendance')->insertOrIgnore([
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'user_id' => $attendeeId,
                'attendance_status' => 'checked_in',
                'attendance_version' => 1,
                'status_changed_at' => $now,
                'status_changed_by' => (int) $persistedActor->getKey(),
                'checked_in_at' => $now,
                'checked_in_by' => (int) $persistedActor->getKey(),
                'hours_credited' => null,
                'notes' => $notes,
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            /** @var EventAttendance|null $attendance */
            $attendance = EventAttendance::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('user_id', $attendeeId)
                ->lockForUpdate()
                ->first();
            if ($attendance === null) {
                throw new EventAttendanceException('event_attendance_insert_failed');
            }
            if ($inserted !== 1) {
                return new EventAttendanceResult($attendance, 'already_checked_in', 'disabled', null, null);
            }

            if ($legacyRegistration !== null) {
                DB::table('event_rsvps')
                    ->where('tenant_id', $tenantId)
                    ->where('id', (int) $legacyRegistration->id)
                    ->update([
                        'status' => 'attended',
                        'updated_at' => $now,
                    ]);
            } elseif ((bool) config('events.registration.legacy_dual_write', true)) {
                DB::table('event_rsvps')->insert([
                    'tenant_id' => $tenantId,
                    'event_id' => $eventId,
                    'user_id' => $attendeeId,
                    'status' => 'attended',
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }

            try {
                $metadata = json_encode([
                    'schema_version' => 1,
                    'credit_mode' => (string) config('events.attendance_credit_mode', 'off'),
                ], JSON_THROW_ON_ERROR);
            } catch (JsonException $exception) {
                throw new EventAttendanceException('event_attendance_metadata_invalid');
            }

            try {
                $activityId = (int) DB::table('event_attendance_activity')->insertGetId([
                    'tenant_id' => $tenantId,
                    'event_id' => $eventId,
                    'attendance_id' => (int) $attendance->getKey(),
                    'user_id' => $attendeeId,
                    'actor_user_id' => (int) $persistedActor->getKey(),
                    'attendance_version' => 1,
                    'action' => 'check_in',
                    'from_status' => null,
                    'to_status' => 'checked_in',
                    'idempotency_key' => $idempotencyKey,
                    'reason' => null,
                    'metadata' => $metadata,
                    'created_at' => $now,
                ]);
            } catch (QueryException $exception) {
                if ($this->isUniqueConflict($exception)) {
                    throw new EventAttendanceException('event_attendance_idempotency_conflict');
                }

                throw $exception;
            }

            $credit = $this->creditService->settleAttendance(
                $event,
                $attendance,
                $attendee,
                $persistedActor,
            );
            // Still fail-closed, but against an explicit allow-set rather than
            // "disabled only": an UNRECOGNISED status means some writer we did
            // not review returned it, and that must abort rather than be
            // treated as success.
            if (! in_array($credit['status'] ?? null, EventCreditService::SETTLED_STATUSES, true)) {
                throw new EventAttendanceException('event_attendance_credit_writer_not_authorized');
            }
            $creditStatus = (string) $credit['status'];

            $outbox = $this->outbox->record(
                $tenantId,
                $eventId,
                1,
                self::OUTBOX_ACTION,
                "event:{$tenantId}:{$eventId}:attendance:{$attendeeId}:v1",
                [
                    'schema_version' => 1,
                    'tenant_id' => $tenantId,
                    'event_id' => $eventId,
                    'attendance_id' => (int) $attendance->getKey(),
                    'attendee_user_id' => $attendeeId,
                    'actor_user_id' => (int) $persistedActor->getKey(),
                    'attendance_version' => 1,
                    'status' => 'checked_in',
                    'credit_status' => $creditStatus,
                    'occurred_at' => $now->toIso8601String(),
                ],
            );

            $attendance->refresh();

            return new EventAttendanceResult(
                $attendance,
                'checked_in',
                $creditStatus,
                $activityId,
                (int) $outbox['id'],
            );
        }, 3);
    }

    public function transition(
        int $eventId,
        int $attendeeId,
        EventAttendanceAction $action,
        User $actor,
        int $expectedVersion,
        ?string $reason,
        string $idempotencyKey,
    ): EventAttendanceTransitionResult {
        $tenantId = TenantContext::currentId();
        if ($tenantId === null || $tenantId <= 0) {
            throw new EventAttendanceException('event_attendance_tenant_context_missing');
        }
        if ($eventId <= 0 || $attendeeId <= 0 || (int) $actor->getKey() <= 0) {
            throw new EventAttendanceException('event_attendance_subject_invalid');
        }
        if ($expectedVersion < 0) {
            throw new EventAttendanceException('event_attendance_version_invalid');
        }
        $reason = $this->normalizeTransitionReason($reason, $action);
        $idempotencyKey = $this->normalizeTransitionIdempotencyKey(
            $idempotencyKey,
            $tenantId,
            $eventId,
            $attendeeId,
            $action,
        );

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $attendeeId,
            $action,
            $actor,
            $expectedVersion,
            $reason,
            $idempotencyKey,
        ): EventAttendanceTransitionResult {
            /** @var Event|null $event */
            $event = Event::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey($eventId)
                ->sharedLock()
                ->first();
            if ($event === null) {
                throw new EventAttendanceException('event_attendance_event_not_found');
            }

            /** @var User|null $persistedActor */
            $persistedActor = User::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey((int) $actor->getKey())
                ->where('status', 'active')
                ->whereNull('deleted_at')
                ->first();
            if ($persistedActor === null
                || ! $this->policy->manageAttendance($persistedActor, $event)) {
                throw new EventAttendanceException('event_attendance_authorization_denied');
            }

            /** @var User|null $attendee */
            $attendee = User::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey($attendeeId)
                ->where('status', 'active')
                ->whereNull('deleted_at')
                ->lockForUpdate()
                ->first();
            if ($attendee === null) {
                throw new EventAttendanceException('event_attendance_attendee_not_found');
            }

            $replay = DB::table('event_attendance_activity')
                ->where('tenant_id', $tenantId)
                ->where('idempotency_key', $idempotencyKey)
                ->first();
            if ($replay !== null) {
                $replayReason = is_string($replay->reason ?? null)
                    ? trim($replay->reason)
                    : null;
                if ((int) $replay->event_id !== $eventId
                    || (int) $replay->user_id !== $attendeeId
                    || (string) $replay->action !== $action->value
                    || max(0, (int) $replay->attendance_version - 1) !== $expectedVersion
                    || $replayReason !== $reason) {
                    throw new EventAttendanceException('event_attendance_idempotency_conflict');
                }
                /** @var EventAttendance|null $replayedAttendance */
                $replayedAttendance = EventAttendance::withoutGlobalScopes()
                    ->where('tenant_id', $tenantId)
                    ->whereKey((int) $replay->attendance_id)
                    ->first();
                if ($replayedAttendance === null) {
                    throw new EventAttendanceException('event_attendance_fact_missing');
                }
                if ((int) $replayedAttendance->attendance_version
                        !== (int) $replay->attendance_version
                    || $this->attendanceState($replayedAttendance, null)
                        !== $this->stateFromStored($replay->to_status ?? null)) {
                    throw new EventAttendanceException('event_attendance_idempotency_conflict');
                }

                return new EventAttendanceTransitionResult(
                    $replayedAttendance,
                    $action,
                    $this->stateFromStored($replay->from_status ?? null),
                    $this->stateFromStored($replay->to_status ?? null),
                    false,
                    true,
                    (int) $replay->id,
                    null,
                );
            }

            $this->assertEventAllowsTransition($event, $action);
            $canonicalRegistration = DB::table('event_registrations')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('user_id', $attendeeId)
                ->where('capacity_pool_key', $this->defaultCapacityPool())
                ->lockForUpdate()
                ->first(['id', 'registration_state']);
            $legacyRegistration = DB::table('event_rsvps')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('user_id', $attendeeId)
                ->lockForUpdate()
                ->first(['id', 'status']);

            /** @var EventAttendance|null $attendance */
            $attendance = EventAttendance::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('user_id', $attendeeId)
                ->lockForUpdate()
                ->first();
            $currentVersion = $attendance === null
                ? 0
                : max(1, (int) ($attendance->attendance_version ?? 1));
            if ($expectedVersion !== $currentVersion) {
                throw new EventAttendanceException('event_attendance_version_conflict');
            }
            if ($action->requiresExistingFact() && $attendance === null) {
                throw new EventAttendanceException('event_attendance_transition_invalid');
            }

            $fromState = $this->attendanceState(
                $attendance,
                is_string($legacyRegistration?->status ?? null)
                    ? $legacyRegistration->status
                    : null,
            );
            if (in_array($action, [EventAttendanceAction::CheckIn, EventAttendanceAction::NoShow], true)) {
                $this->assertConfirmedRegistration($canonicalRegistration, $legacyRegistration);
            }

            $undoes = null;
            $toState = match ($action) {
                EventAttendanceAction::CheckIn => $fromState === EventAttendanceState::NotCheckedIn
                    ? EventAttendanceState::CheckedIn
                    : throw new EventAttendanceException('event_attendance_transition_invalid'),
                EventAttendanceAction::CheckOut => $fromState === EventAttendanceState::CheckedIn
                    ? EventAttendanceState::CheckedOut
                    : throw new EventAttendanceException('event_attendance_transition_invalid'),
                EventAttendanceAction::NoShow => $fromState === EventAttendanceState::NotCheckedIn
                    ? EventAttendanceState::NoShow
                    : throw new EventAttendanceException('event_attendance_transition_invalid'),
                EventAttendanceAction::Undo => $this->undoTarget(
                    $tenantId,
                    $eventId,
                    $attendeeId,
                    $attendance,
                    $undoes,
                ),
            };

            $now = now();
            $nextVersion = $currentVersion + 1;
            $before = [
                'state' => $fromState->value,
                'checked_in_at' => $this->dateTimeString($attendance?->checked_in_at),
                'checked_in_by' => $attendance?->checked_in_by !== null
                    ? (int) $attendance->checked_in_by
                    : null,
                'checked_out_at' => $this->dateTimeString($attendance?->checked_out_at),
                'legacy_status' => is_string($legacyRegistration?->status ?? null)
                    ? $legacyRegistration->status
                    : null,
            ];
            $attributes = $this->transitionAttributes(
                $action,
                $toState,
                $attendance,
                $undoes,
                (int) $persistedActor->getKey(),
                $nextVersion,
                $now,
            );

            if ($attendance === null) {
                $inserted = DB::table('event_attendance')->insertOrIgnore([
                    'tenant_id' => $tenantId,
                    'event_id' => $eventId,
                    'user_id' => $attendeeId,
                    ...$attributes,
                    'hours_credited' => null,
                    'notes' => null,
                    'created_at' => $now,
                ]);
                if ($inserted !== 1) {
                    throw new EventAttendanceException('event_attendance_version_conflict');
                }
            } else {
                $updated = DB::table('event_attendance')
                    ->where('tenant_id', $tenantId)
                    ->where('id', (int) $attendance->getKey())
                    ->where(function (Builder $version) use ($attendance, $currentVersion): void {
                        if ($attendance->attendance_version === null) {
                            $version->whereNull('attendance_version')
                                ->orWhere('attendance_version', $currentVersion);
                        } else {
                            $version->where('attendance_version', $currentVersion);
                        }
                    })
                    ->update($attributes);
                if ($updated !== 1) {
                    throw new EventAttendanceException('event_attendance_version_conflict');
                }
            }

            /** @var EventAttendance|null $stored */
            $stored = EventAttendance::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('user_id', $attendeeId)
                ->lockForUpdate()
                ->first();
            if ($stored === null) {
                throw new EventAttendanceException('event_attendance_fact_missing');
            }

            $this->projectLegacyAttendance(
                $tenantId,
                $eventId,
                $attendeeId,
                $legacyRegistration,
                $canonicalRegistration,
                $toState,
                $undoes,
                $now,
            );

            $metadata = $this->transitionMetadata(
                $before,
                $stored,
                $undoes !== null ? (int) $undoes->id : null,
            );
            try {
                $activityId = (int) DB::table('event_attendance_activity')->insertGetId([
                    'tenant_id' => $tenantId,
                    'event_id' => $eventId,
                    'attendance_id' => (int) $stored->getKey(),
                    'user_id' => $attendeeId,
                    'actor_user_id' => (int) $persistedActor->getKey(),
                    'attendance_version' => $nextVersion,
                    'action' => $action->value,
                    'from_status' => $fromState->value,
                    'to_status' => $toState->value,
                    'idempotency_key' => $idempotencyKey,
                    'reason' => $reason,
                    'metadata' => $metadata,
                    'created_at' => $now,
                ]);
            } catch (QueryException $exception) {
                if ($this->isUniqueConflict($exception)) {
                    throw new EventAttendanceException('event_attendance_idempotency_conflict');
                }

                throw $exception;
            }

            if ($action === EventAttendanceAction::CheckIn) {
                $credit = $this->creditService->settleAttendance(
                    $event,
                    $stored,
                    $attendee,
                    $persistedActor,
                );
                // Same allow-set posture as record(): an unrecognised status is
                // an unreviewed writer and still aborts.
                if (! in_array($credit['status'] ?? null, EventCreditService::SETTLED_STATUSES, true)) {
                    throw new EventAttendanceException('event_attendance_credit_writer_not_authorized');
                }
            }

            $outbox = $this->outbox->record(
                $tenantId,
                $eventId,
                $nextVersion,
                self::TRANSITION_OUTBOX_ACTION,
                "event:{$tenantId}:{$eventId}:attendance:{$attendeeId}:v{$nextVersion}",
                [
                    'schema_version' => 2,
                    'tenant_id' => $tenantId,
                    'event_id' => $eventId,
                    'attendance_id' => (int) $stored->getKey(),
                    'attendee_user_id' => $attendeeId,
                    'actor_user_id' => (int) $persistedActor->getKey(),
                    'attendance_version' => $nextVersion,
                    'action' => $action->value,
                    'from_status' => $fromState->value,
                    'to_status' => $toState->value,
                    'occurred_at' => $now->toIso8601String(),
                ],
            );
            $stored->refresh();

            return new EventAttendanceTransitionResult(
                $stored,
                $action,
                $fromState,
                $toState,
                true,
                false,
                $activityId,
                (int) $outbox['id'],
            );
        }, 3);
    }

    private function assertEventAllowsTransition(
        Event $event,
        EventAttendanceAction $action,
    ): void {
        if ($action === EventAttendanceAction::CheckIn) {
            $this->assertEventAcceptsAttendance($event);

            return;
        }
        if ((bool) $event->getAttribute('is_recurring_template')) {
            throw new EventAttendanceException('event_attendance_concrete_occurrence_required');
        }
        if ($action !== EventAttendanceAction::NoShow) {
            // Checkout and a reasoned correction remain available after the
            // operational window so an immutable record can be completed.
            return;
        }

        $publication = $this->normalizedState($event->getAttribute('publication_status'));
        $operational = $this->normalizedState($event->getAttribute('operational_status'));
        $legacy = $this->normalizedState($event->getAttribute('status')) ?: 'active';
        if (($publication !== '' && $publication !== 'published')
            || in_array($operational, ['cancelled', 'postponed'], true)
            || in_array($legacy, ['draft', 'cancelled'], true)) {
            throw new EventAttendanceException('event_attendance_event_unavailable');
        }
        $start = $this->carbon($event->getAttribute('start_time'));
        if ($start === null) {
            throw new EventAttendanceException('event_attendance_schedule_invalid');
        }
        if (now()->lt($start)) {
            throw new EventAttendanceException('event_attendance_no_show_too_early');
        }
    }

    private function assertConfirmedRegistration(
        ?object $canonicalRegistration,
        ?object $legacyRegistration,
    ): void {
        if ($canonicalRegistration !== null) {
            if ((string) ($canonicalRegistration->registration_state ?? '') !== 'confirmed') {
                throw new EventAttendanceException('event_attendance_registration_required');
            }

            return;
        }
        if ($legacyRegistration === null
            || ! in_array(
                (string) ($legacyRegistration->status ?? ''),
                self::LEGACY_ATTENDANCE_REGISTRATION_STATES,
                true,
            )) {
            throw new EventAttendanceException('event_attendance_registration_required');
        }
    }

    private function attendanceState(
        ?EventAttendance $attendance,
        ?string $legacyStatus,
    ): EventAttendanceState {
        if ($attendance !== null) {
            $stored = EventAttendanceState::tryFrom(
                $this->normalizedState($attendance->attendance_status),
            );
            if ($stored !== null) {
                return $stored;
            }
            if ($attendance->checked_out_at !== null) {
                return EventAttendanceState::CheckedOut;
            }
            if ($attendance->checked_in_at !== null) {
                return EventAttendanceState::CheckedIn;
            }
        }

        return strtolower(trim((string) $legacyStatus)) === 'attended'
            ? EventAttendanceState::Attended
            : EventAttendanceState::NotCheckedIn;
    }

    private function stateFromStored(mixed $value): EventAttendanceState
    {
        return EventAttendanceState::tryFrom($this->normalizedState($value))
            ?? EventAttendanceState::NotCheckedIn;
    }

    private function undoTarget(
        int $tenantId,
        int $eventId,
        int $attendeeId,
        ?EventAttendance $attendance,
        ?object &$undoes,
    ): EventAttendanceState {
        if ($attendance === null) {
            throw new EventAttendanceException('event_attendance_transition_invalid');
        }
        $latest = DB::table('event_attendance_activity')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('attendance_id', (int) $attendance->getKey())
            ->where('user_id', $attendeeId)
            ->orderByDesc('attendance_version')
            ->orderByDesc('id')
            ->lockForUpdate()
            ->first();
        if ($latest === null || (string) $latest->action === EventAttendanceAction::Undo->value) {
            throw new EventAttendanceException('event_attendance_undo_unavailable');
        }
        $current = $this->attendanceState($attendance, null);
        if ($current !== $this->stateFromStored($latest->to_status ?? null)) {
            throw new EventAttendanceException('event_attendance_history_conflict');
        }

        $undoes = $latest;

        return $this->stateFromStored($latest->from_status ?? null);
    }

    /** @return array<string,mixed> */
    private function transitionAttributes(
        EventAttendanceAction $action,
        EventAttendanceState $toState,
        ?EventAttendance $attendance,
        ?object $undoes,
        int $actorId,
        int $nextVersion,
        Carbon $now,
    ): array {
        $checkedInAt = $attendance?->checked_in_at;
        $checkedInBy = $attendance?->checked_in_by;
        $checkedOutAt = $attendance?->checked_out_at;

        if ($action === EventAttendanceAction::CheckIn) {
            $checkedInAt = $now;
            $checkedInBy = $actorId;
            $checkedOutAt = null;
        } elseif ($action === EventAttendanceAction::CheckOut) {
            $checkedOutAt = $now;
        } elseif ($action === EventAttendanceAction::NoShow) {
            $checkedInAt = null;
            $checkedInBy = null;
            $checkedOutAt = null;
        } elseif ($action === EventAttendanceAction::Undo) {
            $snapshot = $this->activityBeforeSnapshot($undoes);
            $checkedInAt = $snapshot['checked_in_at'] ?? null;
            $checkedInBy = is_numeric($snapshot['checked_in_by'] ?? null)
                ? (int) $snapshot['checked_in_by']
                : null;
            $checkedOutAt = $snapshot['checked_out_at'] ?? null;

            if ($snapshot === []) {
                [$checkedInAt, $checkedInBy, $checkedOutAt] = match ($toState) {
                    EventAttendanceState::NotCheckedIn,
                    EventAttendanceState::NoShow => [null, null, null],
                    EventAttendanceState::CheckedIn,
                    EventAttendanceState::Attended => [
                        $attendance?->checked_in_at,
                        $attendance?->checked_in_by,
                        null,
                    ],
                    EventAttendanceState::CheckedOut => [
                        $attendance?->checked_in_at,
                        $attendance?->checked_in_by,
                        $attendance?->checked_out_at,
                    ],
                };
            }
        }

        return [
            'attendance_status' => $toState->value,
            'attendance_version' => $nextVersion,
            'status_changed_at' => $now,
            'status_changed_by' => $actorId,
            'checked_in_at' => $checkedInAt,
            'checked_in_by' => $checkedInBy,
            'checked_out_at' => $checkedOutAt,
            'updated_at' => $now,
        ];
    }

    /** @return array<string,mixed> */
    private function activityBeforeSnapshot(?object $activity): array
    {
        if ($activity === null || ! is_string($activity->metadata ?? null)) {
            return [];
        }
        try {
            $metadata = json_decode($activity->metadata, true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            return [];
        }
        $before = is_array($metadata) ? ($metadata['before'] ?? null) : null;

        return is_array($before) ? $before : [];
    }

    private function projectLegacyAttendance(
        int $tenantId,
        int $eventId,
        int $attendeeId,
        ?object $legacyRegistration,
        ?object $canonicalRegistration,
        EventAttendanceState $toState,
        ?object $undoes,
        Carbon $now,
    ): void {
        $desired = match ($toState) {
            EventAttendanceState::CheckedIn,
            EventAttendanceState::CheckedOut,
            EventAttendanceState::Attended => 'attended',
            EventAttendanceState::NotCheckedIn => $this->legacyStatusBefore($undoes)
                ?? 'going',
            EventAttendanceState::NoShow => null,
        };
        if ($legacyRegistration !== null) {
            if ($desired !== null && (string) $legacyRegistration->status !== $desired) {
                DB::table('event_rsvps')
                    ->where('tenant_id', $tenantId)
                    ->where('id', (int) $legacyRegistration->id)
                    ->update(['status' => $desired, 'updated_at' => $now]);
            }

            return;
        }
        if (! (bool) config('events.registration.legacy_dual_write', true)
            || $canonicalRegistration === null
            || (string) ($canonicalRegistration->registration_state ?? '') !== 'confirmed'
            || $desired === null) {
            return;
        }
        DB::table('event_rsvps')->insertOrIgnore([
            'tenant_id' => $tenantId,
            'event_id' => $eventId,
            'user_id' => $attendeeId,
            'status' => $desired,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }

    private function legacyStatusBefore(?object $activity): ?string
    {
        $value = $this->activityBeforeSnapshot($activity)['legacy_status'] ?? null;
        if (! is_string($value)) {
            return null;
        }
        $value = strtolower(trim($value));

        return in_array($value, self::LEGACY_ATTENDANCE_REGISTRATION_STATES, true)
            ? $value
            : null;
    }

    /** @param array<string,mixed> $before */
    private function transitionMetadata(
        array $before,
        EventAttendance $stored,
        ?int $undoneActivityId,
    ): string {
        try {
            return json_encode([
                'schema_version' => 2,
                'credit_mode' => (string) config('events.attendance_credit_mode', 'off'),
                'before' => $before,
                'after' => [
                    'state' => (string) $stored->attendance_status,
                    'checked_in_at' => $this->dateTimeString($stored->checked_in_at),
                    'checked_in_by' => $stored->checked_in_by !== null
                        ? (int) $stored->checked_in_by
                        : null,
                    'checked_out_at' => $this->dateTimeString($stored->checked_out_at),
                ],
                'undone_activity_id' => $undoneActivityId,
            ], JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new EventAttendanceException('event_attendance_metadata_invalid');
        }
    }

    private function normalizeTransitionReason(
        ?string $reason,
        EventAttendanceAction $action,
    ): ?string {
        $reason = $reason !== null ? trim($reason) : null;
        if ($reason === '') {
            $reason = null;
        }
        if ($action->requiresReason() && $reason === null) {
            throw new EventAttendanceException('event_attendance_reason_required');
        }
        if ($reason !== null && mb_strlen($reason) > self::MAX_REASON_LENGTH) {
            throw new EventAttendanceException('event_attendance_reason_too_long');
        }

        return $reason;
    }

    private function normalizeTransitionIdempotencyKey(
        string $key,
        int $tenantId,
        int $eventId,
        int $attendeeId,
        EventAttendanceAction $action,
    ): string {
        $key = trim($key);
        if ($key === '' || mb_strlen($key) > 191) {
            throw new EventAttendanceException('event_attendance_idempotency_key_invalid');
        }

        return hash('sha256', implode('|', [
            'event-attendance-v2',
            $tenantId,
            $eventId,
            $attendeeId,
            $action->value,
            $key,
        ]));
    }

    private function dateTimeString(mixed $value): ?string
    {
        if ($value instanceof DateTimeInterface) {
            return $value->format('Y-m-d H:i:s');
        }
        if (! is_string($value) || trim($value) === '') {
            return null;
        }

        return trim($value);
    }

    private function assertEventAcceptsAttendance(Event $event): void
    {
        if ((bool) $event->getAttribute('is_recurring_template')) {
            throw new EventAttendanceException('event_attendance_concrete_occurrence_required');
        }

        $publication = $this->normalizedState($event->getAttribute('publication_status'));
        $operational = $this->normalizedState($event->getAttribute('operational_status'));
        $legacy = $this->normalizedState($event->getAttribute('status')) ?: 'active';
        if (($publication !== '' && $publication !== 'published')
            || in_array($operational, ['cancelled', 'postponed'], true)
            || in_array($legacy, ['draft', 'cancelled'], true)) {
            throw new EventAttendanceException('event_attendance_event_unavailable');
        }

        $start = $this->carbon($event->getAttribute('start_time'));
        $end = $this->carbon($event->getAttribute('end_time')) ?? $start;
        if ($start === null) {
            throw new EventAttendanceException('event_attendance_schedule_invalid');
        }

        $opensBefore = max(0, (int) config('events.attendance.opens_before_minutes', 30));
        $closesAfter = max(0, (int) config('events.attendance.closes_after_hours', 24));
        $now = now();
        if ($now->lt($start->copy()->subMinutes($opensBefore))) {
            throw new EventAttendanceException('event_attendance_too_early');
        }
        if ($end !== null && $now->gt($end->copy()->addHours($closesAfter))) {
            throw new EventAttendanceException('event_attendance_window_closed');
        }
    }

    private function normalizeNotes(?string $notes): ?string
    {
        if ($notes === null) {
            return null;
        }

        $notes = trim($notes);
        if ($notes === '') {
            return null;
        }
        if (mb_strlen($notes) > self::MAX_NOTES_LENGTH) {
            throw new EventAttendanceException('event_attendance_notes_too_long');
        }

        return $notes;
    }

    private function validateHours(?float $hours): void
    {
        if ($hours !== null) {
            throw new EventAttendanceException('event_attendance_hours_unavailable');
        }
    }

    private function normalizeIdempotencyKey(
        ?string $key,
        int $tenantId,
        int $eventId,
        int $attendeeId,
    ): string {
        $scope = "event-attendance:v1:{$tenantId}:{$eventId}:{$attendeeId}:check-in";
        if ($key === null || trim($key) === '') {
            return $scope;
        }

        $key = trim($key);
        if (mb_strlen($key) > 191) {
            throw new EventAttendanceException('event_attendance_idempotency_key_invalid');
        }

        return substr(hash('sha256', $scope . ':' . $key), 0, 64);
    }

    private function defaultCapacityPool(): string
    {
        $pool = trim((string) config(
            'events.registration.default_capacity_pool_key',
            'event',
        ));

        return $pool === '' ? 'event' : $pool;
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

    private function isUniqueConflict(QueryException $exception): bool
    {
        return in_array((string) ($exception->errorInfo[0] ?? ''), ['23000', '23505'], true);
    }

    private function normalizedState(mixed $value): string
    {
        if ($value instanceof BackedEnum) {
            $value = $value->value;
        }

        return strtolower(trim(is_scalar($value) ? (string) $value : ''));
    }
}
