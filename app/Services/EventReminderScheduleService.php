<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use Carbon\CarbonImmutable;
use App\Enums\EventNotificationDeliveryMode;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;
use RuntimeException;

/** Versioned schedule calculator and cancellation/reconciliation boundary. */
final class EventReminderScheduleService
{
    /** @var list<string> */
    private const ACTIVE_STATUSES = ['pending', 'queued'];

    public function __construct(
        private readonly EventReminderPreferenceService $preferences,
        private readonly ?EventDomainOutboxService $outbox = null,
    ) {}

    public function rolloutMode(): string
    {
        return $this->reminderMode();
    }

    /** Bulk safety boundary used when the tenant Events module is disabled. */
    public function cancelForDisabledTenant(): int
    {
        return $this->transactional(function (): int {
            $tenantId = $this->tenantId();
            $now = now();
            $canonical = DB::table('event_reminder_schedules')
                ->where('tenant_id', $tenantId)
                ->whereIn('status', self::ACTIVE_STATUSES)
                ->update([
                    'status' => 'cancelled',
                    'reason_code' => 'event_module_disabled',
                    'cancelled_at' => $now,
                    'updated_at' => $now,
                ]);
            $legacy = DB::table('event_reminders')
                ->where('tenant_id', $tenantId)
                ->where('status', 'pending')
                ->update(['status' => 'cancelled', 'updated_at' => $now]);

            return $canonical + $legacy;
        });
    }

    /**
     * Build the current schedule generation for one confirmed registration.
     * The method safely joins an existing transaction used by the registration
     * writer, or starts its own when invoked by recovery tooling.
     *
     * @return list<array<string,mixed>>
     */
    public function reconcileConfirmedRegistration(
        int $eventId,
        int $userId,
        int $registrationId,
        ?int $expectedRegistrationVersion = null,
    ): array {
        return $this->transactional(function () use (
            $eventId,
            $userId,
            $registrationId,
            $expectedRegistrationVersion,
        ): array {
            $tenantId = $this->tenantId();
            $event = $this->lockedEvent($tenantId, $eventId);
            $this->lockActiveUser($tenantId, $userId);
            $registration = DB::table('event_registrations')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('user_id', $userId)
                ->where('id', $registrationId)
                ->lockForUpdate()
                ->first(['id', 'registration_state', 'registration_version', 'confirmed_at', 'state_changed_at']);
            if ($registration === null || (string) $registration->registration_state !== 'confirmed') {
                throw new InvalidArgumentException('event_reminder_confirmed_registration_required');
            }
            $registrationVersion = (int) $registration->registration_version;
            if ($expectedRegistrationVersion !== null
                && $expectedRegistrationVersion !== $registrationVersion) {
                throw new RuntimeException('event_reminder_registration_version_conflict');
            }

            /** @var Collection<int,object> $existing */
            $existing = DB::table('event_reminder_schedules')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('user_id', $userId)
                ->lockForUpdate()
                ->get();
            $resolved = EventNotificationPreferenceResolver::resolveForEvent(
                $userId,
                $tenantId,
                $eventId,
            );
            if (! $resolved['reminders_enabled']) {
                $this->closeActiveSchedules($tenantId, $eventId, $userId, 'cancelled', 'reminders_disabled');
                return [];
            }

            // A reminder that was already due when the member's place was
            // confirmed has nothing to tell them: they have just registered.
            // That comparison only holds for the occurrence they registered
            // for. Once the event has been rescheduled since (an earlier
            // calendar generation exists for this registration), a reminder
            // the new time makes overdue is a genuine catch-up.
            $rescheduledSinceRegistration = $existing->contains(static fn (object $schedule): bool =>
                (int) ($schedule->registration_id ?? 0) === $registrationId
                && (int) $schedule->registration_version === $registrationVersion
                && (int) $schedule->event_calendar_sequence !== (int) $event->calendar_sequence);
            $confirmedAtRaw = $registration->confirmed_at ?? $registration->state_changed_at ?? null;
            $confirmedAt = $rescheduledSinceRegistration || $confirmedAtRaw === null
                ? null
                : CarbonImmutable::parse((string) $confirmedAtRaw, 'UTC')->utc();

            $rules = $this->preferences->activeRules($eventId, $userId, true);
            $desired = $rules !== [] ? $rules : $this->defaultRules();
            $desiredScheduleIds = [];
            $result = [];
            foreach ($desired as $rule) {
                $offset = (int) $rule['offset_minutes'];
                $ruleId = isset($rule['id']) ? (int) $rule['id'] : null;
                $ruleVersion = (int) ($rule['rule_version'] ?? 0);
                $sameOccurrence = $existing->filter(static function (object $schedule) use (
                    $registrationId,
                    $registrationVersion,
                    $event,
                    $offset,
                ): bool {
                    return (int) ($schedule->registration_id ?? 0) === $registrationId
                        && (int) $schedule->registration_version === $registrationVersion
                        && (int) $schedule->event_calendar_sequence === (int) $event->calendar_sequence
                        && (int) $schedule->offset_minutes === $offset;
                });
                $delivered = $sameOccurrence
                    ->where('status', 'delivered')
                    ->sortByDesc('schedule_version')
                    ->first();
                $matching = $sameOccurrence->filter(static function (object $schedule) use (
                    $ruleId,
                    $ruleVersion,
                ): bool {
                    return (int) ($schedule->rule_id ?? 0) === (int) ($ruleId ?? 0)
                        && (int) $schedule->rule_version === $ruleVersion;
                });
                $current = $delivered ?? $matching->sortByDesc('schedule_version')->first();
                if ($current !== null
                    && ! in_array((string) $current->status, ['cancelled', 'superseded'], true)) {
                    $desiredScheduleIds[] = (int) $current->id;
                    $result[] = (array) $current;
                    continue;
                }

                $scheduleVersion = (int) $existing
                    ->where('offset_minutes', $offset)
                    ->max('schedule_version') + 1;
                $timing = $this->timing($event, $offset, $confirmedAt);
                $id = (int) DB::table('event_reminder_schedules')->insertGetId([
                    'tenant_id' => $tenantId,
                    'event_id' => $eventId,
                    'user_id' => $userId,
                    'rule_id' => $ruleId,
                    'registration_id' => $registrationId,
                    'offset_minutes' => $offset,
                    'rule_version' => $ruleVersion,
                    'registration_version' => $registrationVersion,
                    'event_calendar_sequence' => (int) $event->calendar_sequence,
                    'schedule_version' => max(1, $scheduleVersion),
                    'scheduled_for' => $timing['scheduled_for'],
                    'deliver_until' => $timing['deliver_until'],
                    'status' => $timing['status'],
                    'reason_code' => $timing['reason_code'],
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
                $desiredScheduleIds[] = $id;
                $created = DB::table('event_reminder_schedules')
                    ->where('tenant_id', $tenantId)
                    ->where('id', $id)
                    ->first();
                if ($created !== null) {
                    $result[] = (array) $created;
                    $existing->push($created);
                }
            }

            DB::table('event_reminder_schedules')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('user_id', $userId)
                ->whereIn('status', self::ACTIVE_STATUSES)
                ->when(
                    $desiredScheduleIds !== [],
                    static fn ($query) => $query->whereNotIn('id', $desiredScheduleIds),
                )
                ->update([
                    'status' => 'superseded',
                    'reason_code' => 'schedule_generation_superseded',
                    'superseded_at' => now(),
                    'updated_at' => now(),
                ]);

            return $result;
        });
    }

    public function cancelForRegistrationExit(
        int $eventId,
        int $userId,
        string $reasonCode = 'registration_inactive',
    ): int {
        $reasonCode = $this->reasonCode($reasonCode);

        return $this->transactional(function () use ($eventId, $userId, $reasonCode): int {
            $tenantId = $this->tenantId();
            $this->lockEventForCancellation($tenantId, $eventId);
            $this->lockActiveUser($tenantId, $userId, false);

            $canonical = DB::table('event_reminder_schedules')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('user_id', $userId)
                ->whereIn('status', self::ACTIVE_STATUSES)
                ->update([
                    'status' => 'cancelled',
                    'reason_code' => $reasonCode,
                    'cancelled_at' => now(),
                    'updated_at' => now(),
                ]);

            $legacy = DB::table('event_reminders')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('user_id', $userId)
                ->where('status', 'pending')
                ->update([
                    'status' => 'cancelled',
                    'updated_at' => now(),
                ]);

            return $canonical + $legacy;
        });
    }

    /**
     * Registration exits are a cleanup boundary, not a reminder-creation
     * boundary. Historical/imported registrations can still reference a
     * recurrence template, and those members must always be able to leave.
     */
    private function lockEventForCancellation(int $tenantId, int $eventId): void
    {
        $event = DB::table('events')
            ->where('tenant_id', $tenantId)
            ->where('id', $eventId)
            ->lockForUpdate()
            ->first(['id']);
        if ($event === null) {
            throw new InvalidArgumentException('event_reminder_event_not_found');
        }
    }

    /**
     * Close every live schedule for an event after a lifecycle transition.
     * Queued schedules retain their outbox link so the consumer can record a
     * per-channel supersession instead of silently discarding delivery evidence.
     */
    public function closeForEvent(
        int $eventId,
        string $status,
        string $reasonCode,
    ): int {
        if (! in_array($status, ['cancelled', 'superseded'], true)) {
            throw new InvalidArgumentException('event_reminder_terminal_status_invalid');
        }
        $reasonCode = $this->reasonCode($reasonCode);

        return $this->transactional(function () use ($eventId, $status, $reasonCode): int {
            $tenantId = $this->tenantId();
            $event = DB::table('events')
                ->where('tenant_id', $tenantId)
                ->where('id', $eventId)
                ->lockForUpdate()
                ->first(['id']);
            if ($event === null) {
                throw new InvalidArgumentException('event_reminder_event_not_found');
            }
            $now = now();
            $canonical = DB::table('event_reminder_schedules')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->whereIn('status', self::ACTIVE_STATUSES)
                ->update([
                    'status' => $status,
                    'reason_code' => $reasonCode,
                    'cancelled_at' => $status === 'cancelled' ? $now : null,
                    'superseded_at' => $status === 'superseded' ? $now : null,
                    'updated_at' => $now,
                ]);
            $legacy = DB::table('event_reminders')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('status', 'pending')
                ->update(['status' => 'cancelled', 'updated_at' => $now]);

            return $canonical + $legacy;
        });
    }

    /**
     * Recover schedule drift in a bounded pass. This is the asynchronous side
     * of event-time, timezone, all-day and lifecycle changes: request writers
     * only advance calendar/lifecycle versions; the scheduler rebuilds each
     * confirmed registration without an O(N) request-time fanout.
     */
    public function reconcileDrift(int $limit = 200): int
    {
        $tenantId = $this->tenantId();
        $limit = max(1, min(1000, $limit));
        $registrations = DB::table('event_registrations as registration')
            ->join('events as event', function ($join): void {
                $join->on('event.id', '=', 'registration.event_id')
                    ->on('event.tenant_id', '=', 'registration.tenant_id');
            })
            ->where('registration.tenant_id', $tenantId)
            ->where('registration.registration_state', 'confirmed')
            ->where('event.is_recurring_template', false)
            ->where(function ($query): void {
                $query->where('event.publication_status', 'published')
                    ->orWhere(function ($legacy): void {
                        $legacy->whereNull('event.publication_status')
                            ->where('event.status', 'active');
                    });
            })
            ->where(function ($query): void {
                $query->where('event.operational_status', 'scheduled')
                    ->orWhereNull('event.operational_status');
            })
            ->whereNotExists(function ($query): void {
                $query->selectRaw('1')
                    ->from('event_reminder_schedules as schedule')
                    ->whereColumn('schedule.tenant_id', 'registration.tenant_id')
                    ->whereColumn('schedule.event_id', 'registration.event_id')
                    ->whereColumn('schedule.user_id', 'registration.user_id')
                    ->whereColumn('schedule.registration_id', 'registration.id')
                    ->whereColumn('schedule.registration_version', 'registration.registration_version')
                    ->whereColumn('schedule.event_calendar_sequence', 'event.calendar_sequence')
                    // Any non-obsolete row proves that the current generation
                    // was reconciled. Restricting this to live rows caused
                    // fully delivered registrations to be selected forever,
                    // eventually starving later drift behind the batch limit.
                    ->whereNotIn('schedule.status', ['cancelled', 'superseded']);
            })
            ->orderBy('registration.id')
            ->limit($limit)
            ->get(['registration.id', 'registration.event_id', 'registration.user_id', 'registration.registration_version']);

        $reconciled = 0;
        foreach ($registrations as $registration) {
            $this->reconcileConfirmedRegistration(
                (int) $registration->event_id,
                (int) $registration->user_id,
                (int) $registration->id,
                (int) $registration->registration_version,
            );
            $reconciled++;
        }

        return $reconciled;
    }

    /**
     * Atomically materialize exact `event.reminder.due` facts. Canonical mode
     * is deliberately fail-closed unless the authoritative outbox consumer is
     * also enabled; the repository defaults therefore cannot send by accident.
     *
     * @return array{queued:int,shadowed:int,suppressed:int,disabled:bool,mode:string}
     */
    public function queueDueSchedules(int $limit = 200): array
    {
        $tenantId = $this->tenantId();
        $limit = max(1, min(1000, $limit));
        $mode = $this->reminderMode();
        $summary = [
            'queued' => 0,
            'shadowed' => 0,
            'suppressed' => 0,
            'disabled' => $mode === 'legacy',
            'mode' => $mode,
        ];
        if ($mode === 'legacy') {
            return $summary;
        }

        $productionMode = EventNotificationDeliveryMode::ShadowOutbox;
        if ($mode === 'canonical') {
            $productionMode = EventNotificationDeliveryModeResolver::resolve($tenantId);
            if ($productionMode !== EventNotificationDeliveryMode::OutboxAuthoritative
                || ! EventNotificationDeliveryModeResolver::consumerEnabled()) {
                throw new RuntimeException('event_reminder_canonical_delivery_not_ready');
            }
        }

        return $this->transactional(function () use (
            $tenantId,
            $limit,
            $mode,
            $productionMode,
            $summary,
        ): array {
            $now = now();
            $rows = DB::table('event_reminder_schedules')
                ->where('tenant_id', $tenantId)
                ->where('status', 'pending')
                ->where('scheduled_for', '<=', $now)
                ->orderBy('scheduled_for')
                ->orderBy('id')
                ->limit($limit)
                ->lockForUpdate()
                ->get();

            foreach ($rows as $schedule) {
                if ($schedule->deliver_until !== null
                    && CarbonImmutable::parse((string) $schedule->deliver_until, 'UTC')->isPast()) {
                    DB::table('event_reminder_schedules')
                        ->where('tenant_id', $tenantId)
                        ->where('id', (int) $schedule->id)
                        ->where('status', 'pending')
                        ->update([
                            'status' => 'suppressed',
                            'reason_code' => 'outside_recovery_horizon',
                            'updated_at' => $now,
                        ]);
                    $summary['suppressed']++;
                    continue;
                }

                $identity = 'schedule:' . (int) $schedule->id
                    . ':v' . (int) $schedule->schedule_version;
                $outbox = ($this->outbox ?? new EventDomainOutboxService())->record(
                    $tenantId,
                    (int) $schedule->event_id,
                    max(1, (int) $schedule->schedule_version),
                    'event.reminder.due',
                    "event-reminder-due:{$tenantId}:{$schedule->id}:v{$schedule->schedule_version}",
                    [
                        'schema_version' => 1,
                        'tenant_id' => $tenantId,
                        'event_id' => (int) $schedule->event_id,
                        'recipient_user_id' => (int) $schedule->user_id,
                        'user_id' => (int) $schedule->user_id,
                        'schedule_id' => (int) $schedule->id,
                        'schedule_version' => (int) $schedule->schedule_version,
                        'rule_id' => $schedule->rule_id === null ? null : (int) $schedule->rule_id,
                        'registration_id' => $schedule->registration_id === null ? null : (int) $schedule->registration_id,
                        'registration_version' => (int) $schedule->registration_version,
                        'event_calendar_sequence' => (int) $schedule->event_calendar_sequence,
                        'offset_minutes' => (int) $schedule->offset_minutes,
                        'scheduled_for' => CarbonImmutable::parse((string) $schedule->scheduled_for, 'UTC')->toIso8601String(),
                        'deliver_until' => $schedule->deliver_until === null
                            ? null
                            : CarbonImmutable::parse((string) $schedule->deliver_until, 'UTC')->toIso8601String(),
                        'reminder_identity' => $identity,
                        'occurred_at' => $now->toIso8601String(),
                    ],
                    $productionMode,
                );

                if ($mode === 'shadow') {
                    $summary['shadowed']++;
                    continue;
                }

                $updated = DB::table('event_reminder_schedules')
                    ->where('tenant_id', $tenantId)
                    ->where('id', (int) $schedule->id)
                    ->where('status', 'pending')
                    ->whereNull('outbox_id')
                    ->update([
                        'status' => 'queued',
                        'outbox_id' => (int) $outbox['id'],
                        'queued_at' => $now,
                        'updated_at' => $now,
                    ]);
                $summary['queued'] += $updated;
            }

            return $summary;
        });
    }

    /** Recalculate every currently confirmed registration for one event. */
    public function reconcileEventSchedule(int $eventId): int
    {
        return $this->transactional(function () use ($eventId): int {
            $tenantId = $this->tenantId();
            $this->lockedEvent($tenantId, $eventId);
            $registrations = DB::table('event_registrations')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('registration_state', 'confirmed')
                ->orderBy('id')
                ->get(['id', 'user_id', 'registration_version']);

            $count = 0;
            foreach ($registrations as $registration) {
                $count += count($this->reconcileConfirmedRegistration(
                    $eventId,
                    (int) $registration->user_id,
                    (int) $registration->id,
                    (int) $registration->registration_version,
                ));
            }

            return $count;
        });
    }

    /** @return list<array<string,mixed>> */
    public function dueSchedules(int $limit = 200): array
    {
        $tenantId = $this->tenantId();
        $limit = max(1, min(1000, $limit));

        return DB::table('event_reminder_schedules')
            ->where('tenant_id', $tenantId)
            ->where('status', 'pending')
            ->where('scheduled_for', '<=', now())
            ->where(static function ($query): void {
                $query->whereNull('deliver_until')->orWhere('deliver_until', '>=', now());
            })
            ->orderBy('scheduled_for')
            ->orderBy('id')
            ->limit($limit)
            ->get()
            ->map(static fn (object $row): array => (array) $row)
            ->all();
    }

    /** @return list<array<string,int|bool|null>> */
    private function defaultRules(): array
    {
        $configured = config('events.reminders.default_offsets_minutes', [1440, 60]);
        if (! is_array($configured)) {
            throw new RuntimeException('event_reminder_default_offsets_invalid');
        }
        $minimum = max(1, (int) config('events.reminders.minimum_offset_minutes', 5));
        $maximum = max($minimum, (int) config('events.reminders.maximum_offset_minutes', 525600));
        $maximumRules = max(1, min(50, (int) config('events.reminders.max_rules_per_event', 10)));
        $offsets = [];
        foreach ($configured as $offset) {
            if (! is_int($offset) || $offset < $minimum || $offset > $maximum) {
                throw new RuntimeException('event_reminder_default_offsets_invalid');
            }
            $offsets[$offset] = true;
        }
        if ($offsets === [] || count($offsets) > $maximumRules) {
            throw new RuntimeException('event_reminder_default_offsets_invalid');
        }
        krsort($offsets);

        return array_map(
            static fn (int $offset): array => [
                'offset_minutes' => $offset,
                'enabled' => true,
                'rule_version' => 0,
            ],
            array_keys($offsets),
        );
    }

    /** @return array{scheduled_for:CarbonImmutable,deliver_until:CarbonImmutable,status:string,reason_code:?string} */
    private function timing(object $event, int $offset, ?CarbonImmutable $confirmedAt = null): array
    {
        $start = CarbonImmutable::parse((string) $event->start_time, 'UTC')->utc();
        $scheduled = $start->subMinutes($offset);
        $horizonMinutes = max(1, (int) config('events.reminders.catch_up_horizon_minutes', 1440));
        $horizonEnd = $scheduled->addMinutes($horizonMinutes);
        $deliverUntil = $horizonEnd->lessThan($start) ? $horizonEnd : $start;
        $now = CarbonImmutable::now('UTC');
        $available = $this->eventIsDeliverable($event);

        $status = 'pending';
        $reason = null;
        if (! $available) {
            $status = 'suppressed';
            $reason = 'event_unavailable';
        } elseif ($now->greaterThanOrEqualTo($start)) {
            $status = 'suppressed';
            $reason = 'event_started';
        } elseif ($scheduled->lessThanOrEqualTo($now) && $now->greaterThan($deliverUntil)) {
            $status = 'suppressed';
            $reason = 'outside_recovery_horizon';
        } elseif ($confirmedAt !== null && $scheduled->lessThanOrEqualTo($confirmedAt)) {
            $status = 'suppressed';
            $reason = 'registered_after_due';
        } elseif ($scheduled->lessThanOrEqualTo($now)) {
            $reason = 'catch_up_due';
        }

        return [
            'scheduled_for' => $scheduled,
            'deliver_until' => $deliverUntil,
            'status' => $status,
            'reason_code' => $reason,
        ];
    }

    private function eventIsDeliverable(object $event): bool
    {
        $publication = (string) ($event->publication_status ?? '');
        $operational = (string) ($event->operational_status ?? '');
        $legacy = (string) ($event->status ?? '');

        return ($publication === 'published' || ($publication === '' && $legacy === 'active'))
            && ($operational === 'scheduled' || $operational === '');
    }

    private function closeActiveSchedules(
        int $tenantId,
        int $eventId,
        int $userId,
        string $status,
        string $reason,
    ): int {
        return DB::table('event_reminder_schedules')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->whereIn('status', self::ACTIVE_STATUSES)
            ->update([
                'status' => $status,
                'reason_code' => $reason,
                'cancelled_at' => $status === 'cancelled' ? now() : null,
                'superseded_at' => $status === 'superseded' ? now() : null,
                'updated_at' => now(),
            ]);
    }

    private function lockedEvent(int $tenantId, int $eventId): object
    {
        $event = DB::table('events')
            ->where('tenant_id', $tenantId)
            ->where('id', $eventId)
            ->where('is_recurring_template', false)
            ->lockForUpdate()
            ->first([
                'id',
                'start_time',
                'calendar_sequence',
                'status',
                'publication_status',
                'operational_status',
            ]);
        if ($event === null) {
            throw new InvalidArgumentException('event_reminder_concrete_event_not_found');
        }

        return $event;
    }

    private function lockActiveUser(int $tenantId, int $userId, bool $required = true): ?object
    {
        $user = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('id', $userId)
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->lockForUpdate()
            ->first(['id']);
        if ($required && $user === null) {
            throw new InvalidArgumentException('event_reminder_user_not_found');
        }

        return $user;
    }

    private function reasonCode(string $reason): string
    {
        $reason = trim($reason);
        if ($reason === '' || mb_strlen($reason) > 100
            || preg_match('/^[a-z0-9_]+$/', $reason) !== 1) {
            throw new InvalidArgumentException('event_reminder_reason_code_invalid');
        }

        return $reason;
    }

    private function reminderMode(): string
    {
        $raw = config('events.reminders.mode', 'canonical');
        if (! is_string($raw)) {
            throw new RuntimeException('event_reminder_mode_invalid');
        }
        $mode = trim($raw);
        if (! in_array($mode, ['legacy', 'shadow', 'canonical'], true)) {
            throw new RuntimeException('event_reminder_mode_invalid');
        }

        return $mode;
    }

    /**
     * @template T
     * @param callable(): T $callback
     * @return T
     */
    private function transactional(callable $callback): mixed
    {
        if (DB::transactionLevel() > 0) {
            return $callback();
        }

        return DB::transaction($callback, 3);
    }

    private function tenantId(): int
    {
        $tenantId = TenantContext::currentId();
        if ($tenantId === null || $tenantId <= 0) {
            throw new RuntimeException('event_reminder_tenant_context_missing');
        }

        return $tenantId;
    }
}
