<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Enums\EventSessionRegistrationStatus;
use App\Enums\EventSessionResourceType;
use App\Enums\EventSessionStatus;
use App\Enums\EventSessionType;
use App\Enums\EventSessionVisibility;
use App\Exceptions\EventSessionException;
use App\Models\Event;
use App\Models\EventSession;
use App\Models\User;
use App\Policies\EventPolicy;
use BackedEnum;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Throwable;

/** Serialized, tenant-safe domain boundary for a concrete event's agenda. */
final class EventSessionService
{
    private const MAX_DESCRIPTION_LENGTH = 4000;
    private const MAX_SPEAKERS = 50;
    private const MAX_RESOURCES = 50;
    private const SESSION_INPUT_FIELDS = [
        'title',
        'description',
        'session_type',
        'type',
        'visibility',
        'start_at',
        'starts_at',
        'end_at',
        'ends_at',
        'timezone',
        'track_name',
        'track',
        'room_name',
        'room',
        'capacity',
        'speakers',
        'resources',
    ];
    private const SPEAKER_INPUT_FIELDS = ['user_id', 'display_name', 'role_label', 'role'];
    private const RESOURCE_INPUT_FIELDS = ['type', 'resource_type', 'title', 'url', 'visibility'];

    private readonly EventPolicy $policy;

    public function __construct(?EventPolicy $policy = null)
    {
        $this->policy = $policy ?? new EventPolicy();
    }

    /** @return Collection<int,EventSession> */
    public function list(int $eventId, User $viewer, bool $includeCancelled = false): Collection
    {
        if (! $this->schemaAvailable()) {
            return collect();
        }

        return $this->readAgenda($eventId, $viewer, $includeCancelled)['sessions'];
    }

    /**
     * Load the authoritative event and visibility-filtered agenda together so
     * transport layers do not have to repeat tenant or policy decisions.
     *
     * @return array{
     *   event:Event,
     *   sessions:Collection<int,EventSession>,
     *   can_manage:bool,
     *   can_view_registered:bool,
     *   can_view_staff:bool
     * }
     */
    public function readAgenda(
        int $eventId,
        User $viewer,
        bool $includeCancelled = false,
    ): array {
        $this->assertSchemaAvailable();

        $tenantId = $this->tenantIdOrFail();
        $this->assertFeatureEnabled();
        $event = $this->eventOrFail($tenantId, $eventId, false);
        $persistedViewer = $this->actorOrFail($tenantId, $viewer, false);
        if (! $this->policy->view($persistedViewer, $event)) {
            throw new EventSessionException('event_agenda_authorization_denied');
        }
        if ((bool) $event->getRawOriginal('is_recurring_template')) {
            return [
                'event' => $event,
                'sessions' => collect(),
                'can_manage' => false,
                'can_view_registered' => false,
                'can_view_staff' => false,
            ];
        }

        $canManage = $this->policy->manageAgenda($persistedViewer, $event);
        $canViewStaff = $this->policy->viewStaffAgenda($persistedViewer, $event);
        $canViewRegistered = $canViewStaff
            || $this->confirmedEventRegistration(
                $tenantId,
                $eventId,
                (int) $persistedViewer->getKey(),
                false,
            ) !== null;
        $visibilities = [EventSessionVisibility::Public->value];
        if ($canViewRegistered) {
            $visibilities[] = EventSessionVisibility::Registered->value;
        }
        if ($canViewStaff) {
            $visibilities[] = EventSessionVisibility::Staff->value;
        }

        $sessions = EventSession::withoutGlobalScopes()
            ->with($this->speakerRelations())
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->whereIn('visibility', array_values(array_unique($visibilities)))
            ->when(! ($canManage && $includeCancelled), static function ($query): void {
                $query->where('status', EventSessionStatus::Scheduled->value);
            })
            ->orderBy('starts_at_utc')
            ->orderBy('position')
            ->orderBy('id')
            ->get();
        $this->decorateSessionFacts(
            $tenantId,
            $event,
            $persistedViewer,
            $sessions,
            $canManage,
            $canViewRegistered,
            $canViewStaff,
        );

        return [
            'event' => $event,
            'sessions' => $sessions,
            'can_manage' => $canManage,
            'can_view_registered' => $canViewRegistered,
            'can_view_staff' => $canViewStaff,
        ];
    }

    /**
     * @param array<string,mixed> $attributes
     * @return array{session:EventSession,changed:bool,history_id:?int,agenda_version:int}
     */
    public function create(
        int $eventId,
        User $actor,
        array $attributes,
        string $idempotencyKey,
    ): array {
        $this->assertSchemaAvailable();
        $tenantId = $this->tenantIdOrFail();
        $this->assertFeatureEnabled();
        $idempotencyKey = $this->normalizeIdempotencyKey($idempotencyKey);
        $this->assertKnownFields($attributes, self::SESSION_INPUT_FIELDS, 'event_agenda_fields_unknown');
        $this->assertNoAliasCollisions($attributes);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $actor,
            $attributes,
            $idempotencyKey,
        ): array {
            $event = $this->eventOrFail($tenantId, $eventId, true);
            $persistedActor = $this->actorOrFail($tenantId, $actor, true);
            $this->authorizeMutation($persistedActor, $event);
            $this->assertMutableEvent($event);

            $normalized = $this->normalizeCreateAttributes($tenantId, $event, $attributes);
            $requestHash = $this->requestHash([
                'action' => 'created',
                'event_id' => $eventId,
                'actor_user_id' => (int) $persistedActor->id,
                'attributes' => $normalized,
            ]);
            $replay = $this->idempotentReplay(
                $tenantId,
                $eventId,
                null,
                (int) $persistedActor->id,
                'created',
                $idempotencyKey,
                $requestHash,
            );
            if ($replay !== null) {
                return $this->result(
                    (int) $replay->session_id,
                    false,
                    (int) $replay->id,
                    (int) $replay->agenda_version,
                    $persistedActor,
                );
            }

            $this->assertNoConflicts(
                $tenantId,
                $eventId,
                $normalized['starts_at'],
                $normalized['ends_at'],
                $normalized['room_key'],
                $normalized['speakers'],
            );
            $position = ((int) DB::table('event_sessions')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->max('position')) + 1;
            $now = now();
            $sessionId = (int) DB::table('event_sessions')->insertGetId([
                ...$this->sessionStorage($normalized),
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'version' => 1,
                'status' => EventSessionStatus::Scheduled->value,
                'position' => $position,
                'cancellation_reason' => null,
                'created_by' => (int) $persistedActor->id,
                'updated_by' => (int) $persistedActor->id,
                'cancelled_by' => null,
                'cancelled_at' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            $this->replaceSpeakers(
                $tenantId,
                $eventId,
                $sessionId,
                $normalized['speakers'],
                $now,
            );
            $this->replaceResources(
                $tenantId,
                $eventId,
                $sessionId,
                (int) $persistedActor->id,
                $normalized['resources'],
                $now,
            );
            $agendaVersion = $this->advanceAgendaVersion($tenantId, $event, $now);
            $historyId = $this->recordHistory(
                $tenantId,
                $eventId,
                $sessionId,
                (int) $persistedActor->id,
                $agendaVersion,
                'created',
                $idempotencyKey,
                $requestHash,
                [
                    'title',
                    'description',
                    'session_type',
                    'visibility',
                    'capacity',
                    'starts_at_utc',
                    'ends_at_utc',
                    'timezone',
                    'track_name',
                    'room_name',
                    'position',
                    'speakers',
                    'resources',
                ],
                [$sessionId],
                $now,
            );

            return $this->result($sessionId, true, $historyId, $agendaVersion, $persistedActor);
        }, 3);
    }

    /**
     * @param array<string,mixed> $attributes
     * @return array{session:EventSession,changed:bool,history_id:?int,agenda_version:int}
     */
    public function update(
        int $eventId,
        int $sessionId,
        User $actor,
        array $attributes,
        int $expectedVersion,
        string $idempotencyKey,
    ): array {
        $this->assertSchemaAvailable();
        $tenantId = $this->tenantIdOrFail();
        $this->assertFeatureEnabled();
        $this->assertPositiveVersion($expectedVersion, 'event_agenda_expected_version_invalid');
        $idempotencyKey = $this->normalizeIdempotencyKey($idempotencyKey);
        $this->assertKnownFields($attributes, self::SESSION_INPUT_FIELDS, 'event_agenda_fields_unknown');
        $this->assertNoAliasCollisions($attributes);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $sessionId,
            $actor,
            $attributes,
            $expectedVersion,
            $idempotencyKey,
        ): array {
            $event = $this->eventOrFail($tenantId, $eventId, true);
            $persistedActor = $this->actorOrFail($tenantId, $actor, true);
            $this->authorizeMutation($persistedActor, $event);
            $this->assertMutableEvent($event);
            $session = $this->sessionRowOrFail($tenantId, $eventId, $sessionId, true);
            $normalized = $this->normalizeUpdateAttributes($tenantId, $event, $session, $attributes);
            $requestHash = $this->requestHash([
                'action' => 'updated',
                'event_id' => $eventId,
                'session_id' => $sessionId,
                'actor_user_id' => (int) $persistedActor->id,
                'expected_version' => $expectedVersion,
                'attributes' => $normalized,
            ]);
            $replay = $this->idempotentReplay(
                $tenantId,
                $eventId,
                $sessionId,
                (int) $persistedActor->id,
                'updated',
                $idempotencyKey,
                $requestHash,
            );
            if ($replay !== null) {
                return $this->result(
                    $sessionId,
                    false,
                    (int) $replay->id,
                    (int) $replay->agenda_version,
                    $persistedActor,
                );
            }
            if ((string) $session->status !== EventSessionStatus::Scheduled->value) {
                throw new EventSessionException('event_agenda_session_cancelled');
            }
            if ((int) $session->version !== $expectedVersion) {
                throw new EventSessionException('event_agenda_version_conflict');
            }

            $currentSpeakers = $this->storedSpeakers($tenantId, $eventId, $sessionId, true);
            $currentResources = $this->storedResources($tenantId, $eventId, $sessionId, true);
            $changedFields = $this->changedFields(
                $session,
                $currentSpeakers,
                $currentResources,
                $normalized,
            );
            if ($changedFields === []) {
                return $this->result(
                    $sessionId,
                    false,
                    null,
                    (int) ($event->getRawOriginal('agenda_version') ?? 0),
                    $persistedActor,
                );
            }

            $this->assertNoConflicts(
                $tenantId,
                $eventId,
                $normalized['starts_at'],
                $normalized['ends_at'],
                $normalized['room_key'],
                $normalized['speakers'],
                $sessionId,
            );
            $this->assertCapacitySupportsRegistrations(
                $tenantId,
                $eventId,
                $sessionId,
                $normalized['capacity'],
            );
            $nextVersion = $this->nextVersion($session->version);
            $now = now();
            $updated = DB::table('event_sessions')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('id', $sessionId)
                ->where('version', $expectedVersion)
                ->update([
                    ...$this->sessionStorage($normalized),
                    'version' => $nextVersion,
                    'updated_by' => (int) $persistedActor->id,
                    'updated_at' => $now,
                ]);
            if ($updated !== 1) {
                throw new EventSessionException('event_agenda_concurrent_write_failed');
            }
            if (in_array('speakers', $changedFields, true)) {
                $this->replaceSpeakers(
                    $tenantId,
                    $eventId,
                    $sessionId,
                    $normalized['speakers'],
                    $now,
                );
            }
            if (in_array('resources', $changedFields, true)) {
                $this->replaceResources(
                    $tenantId,
                    $eventId,
                    $sessionId,
                    (int) $persistedActor->id,
                    $normalized['resources'],
                    $now,
                );
            }
            $agendaVersion = $this->advanceAgendaVersion($tenantId, $event, $now);
            $historyId = $this->recordHistory(
                $tenantId,
                $eventId,
                $sessionId,
                (int) $persistedActor->id,
                $agendaVersion,
                'updated',
                $idempotencyKey,
                $requestHash,
                $changedFields,
                [$sessionId],
                $now,
            );

            return $this->result($sessionId, true, $historyId, $agendaVersion, $persistedActor);
        }, 3);
    }

    /** @return array{session:EventSession,changed:bool,history_id:?int,agenda_version:int} */
    public function cancel(
        int $eventId,
        int $sessionId,
        User $actor,
        string $reason,
        int $expectedVersion,
        string $idempotencyKey,
    ): array {
        $this->assertSchemaAvailable();
        $tenantId = $this->tenantIdOrFail();
        $this->assertFeatureEnabled();
        $this->assertPositiveVersion($expectedVersion, 'event_agenda_expected_version_invalid');
        $idempotencyKey = $this->normalizeIdempotencyKey($idempotencyKey);
        $reason = $this->requiredText($reason, 500, 'event_agenda_cancellation_reason_invalid');

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $sessionId,
            $actor,
            $reason,
            $expectedVersion,
            $idempotencyKey,
        ): array {
            $event = $this->eventOrFail($tenantId, $eventId, true);
            $persistedActor = $this->actorOrFail($tenantId, $actor, true);
            $this->authorizeMutation($persistedActor, $event);
            $this->assertMutableEvent($event);
            $requestHash = $this->requestHash([
                'action' => 'cancelled',
                'event_id' => $eventId,
                'session_id' => $sessionId,
                'actor_user_id' => (int) $persistedActor->id,
                'expected_version' => $expectedVersion,
                'reason' => $reason,
            ]);
            $replay = $this->idempotentReplay(
                $tenantId,
                $eventId,
                $sessionId,
                (int) $persistedActor->id,
                'cancelled',
                $idempotencyKey,
                $requestHash,
            );
            if ($replay !== null) {
                return $this->result(
                    $sessionId,
                    false,
                    (int) $replay->id,
                    (int) $replay->agenda_version,
                    $persistedActor,
                );
            }

            $session = $this->sessionRowOrFail($tenantId, $eventId, $sessionId, true);
            if ((string) $session->status === EventSessionStatus::Cancelled->value) {
                return $this->result(
                    $sessionId,
                    false,
                    null,
                    (int) ($event->getRawOriginal('agenda_version') ?? 0),
                    $persistedActor,
                );
            }
            if ((int) $session->version !== $expectedVersion) {
                throw new EventSessionException('event_agenda_version_conflict');
            }

            $nextVersion = $this->nextVersion($session->version);
            $now = now();
            $updated = DB::table('event_sessions')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('id', $sessionId)
                ->where('version', $expectedVersion)
                ->update([
                    'status' => EventSessionStatus::Cancelled->value,
                    'version' => $nextVersion,
                    'cancellation_reason' => $reason,
                    'cancelled_by' => (int) $persistedActor->id,
                    'cancelled_at' => $now,
                    'updated_by' => (int) $persistedActor->id,
                    'updated_at' => $now,
                ]);
            if ($updated !== 1) {
                throw new EventSessionException('event_agenda_concurrent_write_failed');
            }
            $agendaVersion = $this->advanceAgendaVersion($tenantId, $event, $now);
            $historyId = $this->recordHistory(
                $tenantId,
                $eventId,
                $sessionId,
                (int) $persistedActor->id,
                $agendaVersion,
                'cancelled',
                $idempotencyKey,
                $requestHash,
                ['status', 'cancellation_reason', 'cancelled_at'],
                [$sessionId],
                $now,
            );

            return $this->result($sessionId, true, $historyId, $agendaVersion, $persistedActor);
        }, 3);
    }

    /**
     * @param list<int> $orderedSessionIds
     * @return array{sessions:Collection<int,EventSession>,changed:bool,history_id:?int,agenda_version:int}
     */
    public function reorder(
        int $eventId,
        User $actor,
        array $orderedSessionIds,
        int $expectedAgendaVersion,
        string $idempotencyKey,
    ): array {
        $this->assertSchemaAvailable();
        $tenantId = $this->tenantIdOrFail();
        $this->assertFeatureEnabled();
        if ($expectedAgendaVersion < 0) {
            throw new EventSessionException('event_agenda_expected_version_invalid');
        }
        $orderedSessionIds = $this->normalizeOrderedIds($orderedSessionIds);
        $idempotencyKey = $this->normalizeIdempotencyKey($idempotencyKey);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $actor,
            $orderedSessionIds,
            $expectedAgendaVersion,
            $idempotencyKey,
        ): array {
            $event = $this->eventOrFail($tenantId, $eventId, true);
            $persistedActor = $this->actorOrFail($tenantId, $actor, true);
            $this->authorizeMutation($persistedActor, $event);
            $this->assertMutableEvent($event);
            $requestHash = $this->requestHash([
                'action' => 'reordered',
                'event_id' => $eventId,
                'actor_user_id' => (int) $persistedActor->id,
                'expected_agenda_version' => $expectedAgendaVersion,
                'ordered_session_ids' => $orderedSessionIds,
            ]);
            $replay = $this->idempotentReplay(
                $tenantId,
                $eventId,
                null,
                (int) $persistedActor->id,
                'reordered',
                $idempotencyKey,
                $requestHash,
            );
            if ($replay !== null) {
                return [
                    'sessions' => $this->loadScheduledSessions(
                        $tenantId,
                        $event,
                        $persistedActor,
                    ),
                    'changed' => false,
                    'history_id' => (int) $replay->id,
                    'agenda_version' => (int) $replay->agenda_version,
                ];
            }

            $currentAgendaVersion = (int) ($event->getRawOriginal('agenda_version') ?? 0);
            if ($currentAgendaVersion !== $expectedAgendaVersion) {
                throw new EventSessionException('event_agenda_version_conflict');
            }
            $current = DB::table('event_sessions')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('status', EventSessionStatus::Scheduled->value)
                ->orderBy('position')
                ->orderBy('id')
                ->lockForUpdate()
                ->get(['id', 'version']);
            $currentIds = $current->pluck('id')->map(static fn (mixed $id): int => (int) $id)->all();
            $expectedIds = $currentIds;
            $requestedIds = $orderedSessionIds;
            sort($expectedIds, SORT_NUMERIC);
            sort($requestedIds, SORT_NUMERIC);
            if ($expectedIds !== $requestedIds) {
                throw new EventSessionException('event_agenda_reorder_set_invalid');
            }
            if ($currentIds === $orderedSessionIds) {
                return [
                    'sessions' => $this->loadScheduledSessions(
                        $tenantId,
                        $event,
                        $persistedActor,
                    ),
                    'changed' => false,
                    'history_id' => null,
                    'agenda_version' => $currentAgendaVersion,
                ];
            }

            $byId = $current->keyBy('id');
            $affected = [];
            $now = now();
            foreach ($orderedSessionIds as $offset => $sessionId) {
                $row = $byId->get($sessionId);
                if ($row === null) {
                    throw new EventSessionException('event_agenda_reorder_set_invalid');
                }
                $position = $offset + 1;
                $updated = DB::table('event_sessions')
                    ->where('tenant_id', $tenantId)
                    ->where('event_id', $eventId)
                    ->where('id', $sessionId)
                    ->where('version', (int) $row->version)
                    ->update([
                        'position' => $position,
                        'version' => $this->nextVersion($row->version),
                        'updated_by' => (int) $persistedActor->id,
                        'updated_at' => $now,
                    ]);
                if ($updated !== 1) {
                    throw new EventSessionException('event_agenda_concurrent_write_failed');
                }
                $affected[] = $sessionId;
            }

            $agendaVersion = $this->advanceAgendaVersion($tenantId, $event, $now);
            $historyId = $this->recordHistory(
                $tenantId,
                $eventId,
                null,
                (int) $persistedActor->id,
                $agendaVersion,
                'reordered',
                $idempotencyKey,
                $requestHash,
                ['position'],
                $affected,
                $now,
            );

            return [
                'sessions' => $this->loadScheduledSessions(
                    $tenantId,
                    $event,
                    $persistedActor,
                ),
                'changed' => true,
                'history_id' => $historyId,
                'agenda_version' => $agendaVersion,
            ];
        }, 3);
    }

    /**
     * Reserve the current member's place without changing their canonical
     * event registration, ticket, attendance, or wallet state.
     *
     * @return array{session:EventSession,changed:bool,history_id:?int,agenda_version:int,registration_version:int}
     */
    public function registerSession(
        int $eventId,
        int $sessionId,
        User $actor,
        int $expectedVersion,
        string $idempotencyKey,
    ): array {
        $this->assertSchemaAvailable();
        $tenantId = $this->tenantIdOrFail();
        $this->assertFeatureEnabled();
        if ($expectedVersion < 0) {
            throw new EventSessionException('event_agenda_registration_expected_version_invalid');
        }
        $idempotencyKey = $this->normalizeIdempotencyKey($idempotencyKey);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $sessionId,
            $actor,
            $expectedVersion,
            $idempotencyKey,
        ): array {
            $event = $this->eventOrFail($tenantId, $eventId, true);
            $persistedActor = $this->actorOrFail($tenantId, $actor, true);
            if (! $this->policy->view($persistedActor, $event)) {
                throw new EventSessionException('event_agenda_authorization_denied');
            }
            $this->assertMutableEvent($event);
            $session = $this->sessionRowOrFail($tenantId, $eventId, $sessionId, true);
            if (! $this->canViewSession($persistedActor, $event, $session)) {
                throw new EventSessionException('event_agenda_authorization_denied');
            }
            if ((string) $session->status !== EventSessionStatus::Scheduled->value) {
                throw new EventSessionException('event_agenda_session_cancelled');
            }
            $requestHash = $this->requestHash([
                'action' => EventSessionRegistrationStatus::Registered->value,
                'event_id' => $eventId,
                'session_id' => $sessionId,
                'actor_user_id' => (int) $persistedActor->id,
                'expected_version' => $expectedVersion,
            ]);
            $replay = $this->sessionRegistrationReplay(
                $tenantId,
                $eventId,
                $sessionId,
                (int) $persistedActor->id,
                EventSessionRegistrationStatus::Registered->value,
                $idempotencyKey,
                $requestHash,
            );
            if ($replay !== null) {
                return $this->sessionRegistrationResult(
                    $sessionId,
                    $persistedActor,
                    false,
                    (int) $replay->id,
                    (int) ($event->getRawOriginal('agenda_version') ?? 0),
                );
            }

            $eventRegistration = $this->confirmedEventRegistration(
                $tenantId,
                $eventId,
                (int) $persistedActor->id,
                true,
            );
            if ($eventRegistration === null) {
                throw new EventSessionException('event_agenda_registration_eligibility_required');
            }
            $eventRegistrationVersion = (int) $eventRegistration->registration_version;
            $registration = $this->sessionRegistrationRow(
                $tenantId,
                $eventId,
                $sessionId,
                (int) $persistedActor->id,
                true,
            );
            $currentVersion = $registration === null ? 0 : (int) $registration->version;
            if ($currentVersion !== $expectedVersion) {
                throw new EventSessionException('event_agenda_registration_version_conflict');
            }

            $capacity = $session->capacity === null ? null : (int) $session->capacity;
            $isActiveForCurrentEligibility = $registration !== null
                && (string) $registration->status === EventSessionRegistrationStatus::Registered->value
                && (int) $registration->event_registration_id === (int) $eventRegistration->id
                && (int) $registration->event_registration_version === $eventRegistrationVersion;
            if (! $isActiveForCurrentEligibility
                && $capacity !== null
                && $this->activeSessionRegistrationCount($tenantId, $eventId, $sessionId) >= $capacity) {
                throw new EventSessionException('event_agenda_session_capacity_full');
            }
            $now = now();
            $nextVersion = $currentVersion + 1;
            if ($registration === null) {
                $registrationId = (int) DB::table('event_session_registrations')->insertGetId([
                    'tenant_id' => $tenantId,
                    'event_id' => $eventId,
                    'session_id' => $sessionId,
                    'user_id' => (int) $persistedActor->id,
                    'event_registration_id' => (int) $eventRegistration->id,
                    'event_registration_version' => $eventRegistrationVersion,
                    'version' => $nextVersion,
                    'status' => EventSessionRegistrationStatus::Registered->value,
                    'registered_at' => $now,
                    'withdrawn_at' => null,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            } else {
                $registrationId = (int) $registration->id;
                $updated = DB::table('event_session_registrations')
                    ->where('tenant_id', $tenantId)
                    ->where('event_id', $eventId)
                    ->where('session_id', $sessionId)
                    ->where('user_id', (int) $persistedActor->id)
                    ->where('version', $currentVersion)
                    ->update([
                        'event_registration_id' => (int) $eventRegistration->id,
                        'event_registration_version' => $eventRegistrationVersion,
                        'version' => $nextVersion,
                        'status' => EventSessionRegistrationStatus::Registered->value,
                        'registered_at' => $now,
                        'withdrawn_at' => null,
                        'updated_at' => $now,
                    ]);
                if ($updated !== 1) {
                    throw new EventSessionException('event_agenda_concurrent_write_failed');
                }
            }
            $historyId = $this->recordSessionRegistrationHistory(
                $tenantId,
                $eventId,
                $sessionId,
                $registrationId,
                (int) $persistedActor->id,
                (int) $eventRegistration->id,
                $eventRegistrationVersion,
                $nextVersion,
                EventSessionRegistrationStatus::Registered->value,
                $idempotencyKey,
                $requestHash,
                $now,
            );

            return $this->sessionRegistrationResult(
                $sessionId,
                $persistedActor,
                true,
                $historyId,
                (int) ($event->getRawOriginal('agenda_version') ?? 0),
            );
        }, 5);
    }

    /**
     * Withdraw only the session-level place. This deliberately remains valid
     * after canonical event eligibility changes so stale capacity can be freed.
     *
     * @return array{session:?EventSession,changed:bool,history_id:?int,agenda_version:int,registration_version:int}
     */
    public function withdrawSession(
        int $eventId,
        int $sessionId,
        User $actor,
        int $expectedVersion,
        string $idempotencyKey,
    ): array {
        $this->assertSchemaAvailable();
        $tenantId = $this->tenantIdOrFail();
        $this->assertFeatureEnabled();
        if ($expectedVersion < 0) {
            throw new EventSessionException('event_agenda_registration_expected_version_invalid');
        }
        $idempotencyKey = $this->normalizeIdempotencyKey($idempotencyKey);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $sessionId,
            $actor,
            $expectedVersion,
            $idempotencyKey,
        ): array {
            $event = $this->eventOrFail($tenantId, $eventId, true);
            $persistedActor = $this->actorOrFail($tenantId, $actor, true);
            if (! $this->policy->view($persistedActor, $event)) {
                throw new EventSessionException('event_agenda_authorization_denied');
            }
            $this->sessionRowOrFail($tenantId, $eventId, $sessionId, true);
            $requestHash = $this->requestHash([
                'action' => EventSessionRegistrationStatus::Withdrawn->value,
                'event_id' => $eventId,
                'session_id' => $sessionId,
                'actor_user_id' => (int) $persistedActor->id,
                'expected_version' => $expectedVersion,
            ]);
            $replay = $this->sessionRegistrationReplay(
                $tenantId,
                $eventId,
                $sessionId,
                (int) $persistedActor->id,
                EventSessionRegistrationStatus::Withdrawn->value,
                $idempotencyKey,
                $requestHash,
            );
            if ($replay !== null) {
                return $this->sessionRegistrationResult(
                    $sessionId,
                    $persistedActor,
                    false,
                    (int) $replay->id,
                    (int) ($event->getRawOriginal('agenda_version') ?? 0),
                );
            }

            $registration = $this->sessionRegistrationRow(
                $tenantId,
                $eventId,
                $sessionId,
                (int) $persistedActor->id,
                true,
            );
            $currentVersion = $registration === null ? 0 : (int) $registration->version;
            if ($currentVersion !== $expectedVersion) {
                throw new EventSessionException('event_agenda_registration_version_conflict');
            }
            if ($registration === null) {
                throw new EventSessionException('event_agenda_session_registration_not_found');
            }

            $nextVersion = $this->nextVersion($currentVersion);
            $now = now();
            $updated = DB::table('event_session_registrations')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('session_id', $sessionId)
                ->where('user_id', (int) $persistedActor->id)
                ->where('version', $currentVersion)
                ->update([
                    'version' => $nextVersion,
                    'status' => EventSessionRegistrationStatus::Withdrawn->value,
                    'withdrawn_at' => $now,
                    'updated_at' => $now,
                ]);
            if ($updated !== 1) {
                throw new EventSessionException('event_agenda_concurrent_write_failed');
            }
            $historyId = $this->recordSessionRegistrationHistory(
                $tenantId,
                $eventId,
                $sessionId,
                (int) $registration->id,
                (int) $persistedActor->id,
                (int) $registration->event_registration_id,
                (int) $registration->event_registration_version,
                $nextVersion,
                EventSessionRegistrationStatus::Withdrawn->value,
                $idempotencyKey,
                $requestHash,
                $now,
            );

            return $this->sessionRegistrationResult(
                $sessionId,
                $persistedActor,
                true,
                $historyId,
                (int) ($event->getRawOriginal('agenda_version') ?? 0),
            );
        }, 5);
    }

    /** @param array<string,mixed> $attributes @return array<string,mixed> */
    private function normalizeCreateAttributes(int $tenantId, Event $event, array $attributes): array
    {
        $timezone = $this->eventTimezone($event, $attributes['timezone'] ?? null);
        $startsAt = $this->inputInstant(
            $attributes['start_at'] ?? $attributes['starts_at'] ?? null,
            $timezone,
            'event_agenda_start_invalid',
        );
        $endsAt = $this->inputInstant(
            $attributes['end_at'] ?? $attributes['ends_at'] ?? null,
            $timezone,
            'event_agenda_end_invalid',
        );
        $this->assertWithinEvent($event, $startsAt, $endsAt);
        $speakers = $this->normalizeSpeakers($tenantId, $attributes['speakers'] ?? []);
        $room = $this->optionalText(
            $attributes['room_name'] ?? $attributes['room'] ?? null,
            120,
            'event_agenda_room_invalid',
        );

        return [
            'title' => $this->requiredText(
                $attributes['title'] ?? null,
                191,
                'event_agenda_title_invalid',
            ),
            'description' => $this->optionalDescription($attributes['description'] ?? null),
            'session_type' => $this->enum(
                EventSessionType::class,
                $attributes['session_type'] ?? $attributes['type'] ?? EventSessionType::Session,
                'event_agenda_type_invalid',
            ),
            'visibility' => $this->enum(
                EventSessionVisibility::class,
                $attributes['visibility'] ?? EventSessionVisibility::Public,
                'event_agenda_visibility_invalid',
            ),
            'capacity' => $this->optionalCapacity($attributes['capacity'] ?? null),
            'starts_at' => $startsAt,
            'ends_at' => $endsAt,
            'timezone' => $timezone,
            'track_name' => $this->optionalText(
                $attributes['track_name'] ?? $attributes['track'] ?? null,
                120,
                'event_agenda_track_invalid',
            ),
            'room_name' => $room,
            'room_key' => $this->roomKey($room),
            'speakers' => $speakers,
            'resources' => $this->normalizeResources($attributes['resources'] ?? []),
        ];
    }

    /** @param array<string,mixed> $attributes @return array<string,mixed> */
    private function normalizeUpdateAttributes(
        int $tenantId,
        Event $event,
        object $session,
        array $attributes,
    ): array {
        $timezone = $this->eventTimezone(
            $event,
            array_key_exists('timezone', $attributes)
                ? $attributes['timezone']
                : $session->timezone,
        );
        $startsAt = array_key_exists('start_at', $attributes) || array_key_exists('starts_at', $attributes)
            ? $this->inputInstant(
                $attributes['start_at'] ?? $attributes['starts_at'],
                $timezone,
                'event_agenda_start_invalid',
            )
            : CarbonImmutable::parse((string) $session->starts_at_utc, 'UTC')->utc();
        $endsAt = array_key_exists('end_at', $attributes) || array_key_exists('ends_at', $attributes)
            ? $this->inputInstant(
                $attributes['end_at'] ?? $attributes['ends_at'],
                $timezone,
                'event_agenda_end_invalid',
            )
            : CarbonImmutable::parse((string) $session->ends_at_utc, 'UTC')->utc();
        $this->assertWithinEvent($event, $startsAt, $endsAt);
        $room = $this->optionalText(
            array_key_exists('room_name', $attributes)
                ? $attributes['room_name']
                : (array_key_exists('room', $attributes) ? $attributes['room'] : $session->room_name),
            120,
            'event_agenda_room_invalid',
        );

        return [
            'title' => $this->requiredText(
                array_key_exists('title', $attributes) ? $attributes['title'] : $session->title,
                191,
                'event_agenda_title_invalid',
            ),
            'description' => $this->optionalDescription(
                array_key_exists('description', $attributes)
                    ? $attributes['description']
                    : $session->description,
            ),
            'session_type' => $this->enum(
                EventSessionType::class,
                array_key_exists('session_type', $attributes)
                    ? $attributes['session_type']
                    : (array_key_exists('type', $attributes) ? $attributes['type'] : $session->session_type),
                'event_agenda_type_invalid',
            ),
            'visibility' => $this->enum(
                EventSessionVisibility::class,
                array_key_exists('visibility', $attributes)
                    ? $attributes['visibility']
                    : $session->visibility,
                'event_agenda_visibility_invalid',
            ),
            'capacity' => array_key_exists('capacity', $attributes)
                ? $this->optionalCapacity($attributes['capacity'])
                : ($session->capacity === null ? null : (int) $session->capacity),
            'starts_at' => $startsAt,
            'ends_at' => $endsAt,
            'timezone' => $timezone,
            'track_name' => $this->optionalText(
                array_key_exists('track_name', $attributes)
                    ? $attributes['track_name']
                    : (array_key_exists('track', $attributes) ? $attributes['track'] : $session->track_name),
                120,
                'event_agenda_track_invalid',
            ),
            'room_name' => $room,
            'room_key' => $this->roomKey($room),
            'speakers' => array_key_exists('speakers', $attributes)
                ? $this->normalizeSpeakers($tenantId, $attributes['speakers'])
                : $this->storedSpeakers(
                    $tenantId,
                    (int) $session->event_id,
                    (int) $session->id,
                    true,
                ),
            'resources' => array_key_exists('resources', $attributes)
                ? $this->normalizeResources($attributes['resources'])
                : $this->storedResources(
                    $tenantId,
                    (int) $session->event_id,
                    (int) $session->id,
                    true,
                ),
        ];
    }

    /** @return array<string,mixed> */
    private function sessionStorage(array $normalized): array
    {
        return [
            'title' => $normalized['title'],
            'description' => $normalized['description'],
            'session_type' => $normalized['session_type']->value,
            'visibility' => $normalized['visibility']->value,
            'capacity' => $normalized['capacity'],
            'starts_at_utc' => $normalized['starts_at']->format('Y-m-d H:i:s'),
            'ends_at_utc' => $normalized['ends_at']->format('Y-m-d H:i:s'),
            'timezone' => $normalized['timezone'],
            'track_name' => $normalized['track_name'],
            'room_name' => $normalized['room_name'],
            'room_key' => $normalized['room_key'],
        ];
    }

    /**
     * @param list<array<string,mixed>> $currentSpeakers
     * @param list<array<string,mixed>> $currentResources
     * @return list<string>
     */
    private function changedFields(
        object $session,
        array $currentSpeakers,
        array $currentResources,
        array $normalized,
    ): array
    {
        $checks = [
            'title' => [(string) $session->title, $normalized['title']],
            'description' => [$session->description, $normalized['description']],
            'session_type' => [(string) $session->session_type, $normalized['session_type']->value],
            'visibility' => [(string) $session->visibility, $normalized['visibility']->value],
            'capacity' => [
                $session->capacity === null ? null : (int) $session->capacity,
                $normalized['capacity'],
            ],
            'starts_at_utc' => [
                CarbonImmutable::parse((string) $session->starts_at_utc, 'UTC')->format('Y-m-d H:i:s'),
                $normalized['starts_at']->format('Y-m-d H:i:s'),
            ],
            'ends_at_utc' => [
                CarbonImmutable::parse((string) $session->ends_at_utc, 'UTC')->format('Y-m-d H:i:s'),
                $normalized['ends_at']->format('Y-m-d H:i:s'),
            ],
            'timezone' => [(string) $session->timezone, $normalized['timezone']],
            'track_name' => [$session->track_name, $normalized['track_name']],
            'room_name' => [$session->room_name, $normalized['room_name']],
            'speakers' => [$currentSpeakers, $normalized['speakers']],
            'resources' => [$currentResources, $normalized['resources']],
        ];

        $changed = [];
        foreach ($checks as $field => [$before, $after]) {
            if ($this->canonicalize($before) !== $this->canonicalize($after)) {
                $changed[] = $field;
            }
        }

        return $changed;
    }

    /** @return list<array{user_id:?int,display_name:?string,role_label:?string,position:int}> */
    private function normalizeSpeakers(int $tenantId, mixed $rawSpeakers): array
    {
        if (! is_array($rawSpeakers) || ! array_is_list($rawSpeakers)
            || count($rawSpeakers) > self::MAX_SPEAKERS) {
            throw new EventSessionException('event_agenda_speakers_invalid');
        }

        $speakers = [];
        $memberIds = [];
        $externalKeys = [];
        foreach ($rawSpeakers as $offset => $rawSpeaker) {
            if (! is_array($rawSpeaker)) {
                throw new EventSessionException('event_agenda_speaker_invalid');
            }
            $this->assertKnownFields(
                $rawSpeaker,
                self::SPEAKER_INPUT_FIELDS,
                'event_agenda_speaker_fields_unknown',
            );
            if (array_key_exists('role_label', $rawSpeaker) && array_key_exists('role', $rawSpeaker)) {
                throw new EventSessionException('event_agenda_speaker_fields_ambiguous');
            }
            $userId = isset($rawSpeaker['user_id']) && is_numeric($rawSpeaker['user_id'])
                ? (int) $rawSpeaker['user_id']
                : null;
            if ($userId !== null && $userId <= 0) {
                throw new EventSessionException('event_agenda_speaker_invalid');
            }
            $displayName = $this->optionalText(
                $rawSpeaker['display_name'] ?? null,
                191,
                'event_agenda_speaker_invalid',
            );
            if (($userId === null) === ($displayName === null)) {
                throw new EventSessionException('event_agenda_speaker_identity_invalid');
            }
            $role = $this->optionalText(
                $rawSpeaker['role_label'] ?? $rawSpeaker['role'] ?? null,
                120,
                'event_agenda_speaker_role_invalid',
            );
            if ($userId !== null) {
                if (isset($memberIds[$userId])) {
                    throw new EventSessionException('event_agenda_speaker_duplicate');
                }
                $memberIds[$userId] = true;
            } else {
                $externalKey = mb_strtolower($displayName . '|' . ($role ?? ''), 'UTF-8');
                if (isset($externalKeys[$externalKey])) {
                    throw new EventSessionException('event_agenda_speaker_duplicate');
                }
                $externalKeys[$externalKey] = true;
            }
            $speakers[] = [
                'user_id' => $userId,
                'display_name' => $displayName,
                'role_label' => $role,
                'position' => $offset + 1,
            ];
        }

        if ($memberIds !== []) {
            $ids = array_map('intval', array_keys($memberIds));
            sort($ids, SORT_NUMERIC);
            $persisted = DB::table('users')
                ->where('tenant_id', $tenantId)
                ->whereIn('id', $ids)
                ->where('status', 'active')
                ->whereNull('deleted_at')
                ->orderBy('id')
                ->lockForUpdate()
                ->pluck('id')
                ->map(static fn (mixed $id): int => (int) $id)
                ->all();
            if ($persisted !== $ids) {
                throw new EventSessionException('event_agenda_speaker_member_invalid');
            }
        }

        return $speakers;
    }

    /** @return list<array{user_id:?int,display_name:?string,role_label:?string,position:int}> */
    private function storedSpeakers(int $tenantId, int $eventId, int $sessionId, bool $lock): array
    {
        $query = DB::table('event_session_speakers')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('session_id', $sessionId)
            ->orderBy('position')
            ->orderBy('id');
        if ($lock) {
            $query->lockForUpdate();
        }

        return $query->get(['user_id', 'display_name', 'role_label', 'position'])
            ->map(static fn (object $speaker): array => [
                'user_id' => $speaker->user_id === null ? null : (int) $speaker->user_id,
                'display_name' => $speaker->display_name === null ? null : (string) $speaker->display_name,
                'role_label' => $speaker->role_label === null ? null : (string) $speaker->role_label,
                'position' => (int) $speaker->position,
            ])
            ->all();
    }

    /** @param list<array<string,mixed>> $speakers */
    private function replaceSpeakers(
        int $tenantId,
        int $eventId,
        int $sessionId,
        array $speakers,
        DateTimeInterface $now,
    ): void {
        DB::table('event_session_speakers')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('session_id', $sessionId)
            ->delete();
        if ($speakers === []) {
            return;
        }

        DB::table('event_session_speakers')->insert(array_map(
            static fn (array $speaker): array => [
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'session_id' => $sessionId,
                'user_id' => $speaker['user_id'],
                'display_name' => $speaker['display_name'],
                'role_label' => $speaker['role_label'],
                'position' => $speaker['position'],
                'created_at' => $now,
                'updated_at' => $now,
            ],
            $speakers,
        ));
    }

    /**
     * @return list<array{
     *   resource_type:EventSessionResourceType,
     *   visibility:EventSessionVisibility,
     *   title:string,
     *   url:string,
     *   position:int
     * }>
     */
    private function normalizeResources(mixed $rawResources): array
    {
        if (! is_array($rawResources)
            || ! array_is_list($rawResources)
            || count($rawResources) > self::MAX_RESOURCES) {
            throw new EventSessionException('event_agenda_resources_invalid');
        }

        $resources = [];
        $identities = [];
        foreach ($rawResources as $offset => $rawResource) {
            if (! is_array($rawResource)) {
                throw new EventSessionException('event_agenda_resource_invalid');
            }
            $this->assertKnownFields(
                $rawResource,
                self::RESOURCE_INPUT_FIELDS,
                'event_agenda_resource_fields_unknown',
            );
            if (array_key_exists('type', $rawResource)
                && array_key_exists('resource_type', $rawResource)) {
                throw new EventSessionException('event_agenda_resource_fields_ambiguous');
            }
            /** @var EventSessionResourceType $type */
            $type = $this->enum(
                EventSessionResourceType::class,
                $rawResource['resource_type'] ?? $rawResource['type'] ?? null,
                'event_agenda_resource_type_invalid',
            );
            /** @var EventSessionVisibility $visibility */
            $visibility = $this->enum(
                EventSessionVisibility::class,
                $rawResource['visibility'] ?? EventSessionVisibility::Public,
                'event_agenda_resource_visibility_invalid',
            );
            if ($type->isProtectedMedia() && $visibility === EventSessionVisibility::Public) {
                throw new EventSessionException('event_agenda_resource_media_visibility_invalid');
            }
            $url = $this->secureResourceUrl($rawResource['url'] ?? null);
            $identity = hash('sha256', $type->value . "\0" . $url);
            if (isset($identities[$identity])) {
                throw new EventSessionException('event_agenda_resource_duplicate');
            }
            $identities[$identity] = true;
            $resources[] = [
                'resource_type' => $type,
                'visibility' => $visibility,
                'title' => $this->requiredText(
                    $rawResource['title'] ?? null,
                    191,
                    'event_agenda_resource_title_invalid',
                ),
                'url' => $url,
                'position' => $offset + 1,
            ];
        }

        return $resources;
    }

    /** @return list<array<string,mixed>> */
    private function storedResources(int $tenantId, int $eventId, int $sessionId, bool $lock): array
    {
        $query = DB::table('event_session_resources')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('session_id', $sessionId)
            ->orderBy('position')
            ->orderBy('id');
        if ($lock) {
            $query->lockForUpdate();
        }

        return $query->get([
            'resource_type',
            'visibility',
            'title',
            'url_ciphertext',
            'position',
        ])->map(function (object $resource): array {
            try {
                $url = Crypt::decryptString((string) $resource->url_ciphertext);
            } catch (Throwable) {
                throw new EventSessionException('event_agenda_resource_decryption_failed');
            }

            return [
                'resource_type' => (string) $resource->resource_type,
                'visibility' => (string) $resource->visibility,
                'title' => (string) $resource->title,
                'url' => $url,
                'position' => (int) $resource->position,
            ];
        })->all();
    }

    /** @param list<array<string,mixed>> $resources */
    private function replaceResources(
        int $tenantId,
        int $eventId,
        int $sessionId,
        int $actorId,
        array $resources,
        DateTimeInterface $now,
    ): void {
        DB::table('event_session_resources')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('session_id', $sessionId)
            ->delete();
        if ($resources === []) {
            return;
        }

        DB::table('event_session_resources')->insert(array_map(
            static fn (array $resource): array => [
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'session_id' => $sessionId,
                'resource_type' => $resource['resource_type']->value,
                'visibility' => $resource['visibility']->value,
                'title' => $resource['title'],
                'url_ciphertext' => Crypt::encryptString($resource['url']),
                'position' => $resource['position'],
                'created_by' => $actorId,
                'updated_by' => $actorId,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            $resources,
        ));
    }

    private function assertCapacitySupportsRegistrations(
        int $tenantId,
        int $eventId,
        int $sessionId,
        ?int $capacity,
    ): void {
        if ($capacity !== null
            && $this->activeSessionRegistrationCount($tenantId, $eventId, $sessionId) > $capacity) {
            throw new EventSessionException('event_agenda_capacity_below_registrations');
        }
    }

    private function activeSessionRegistrationCount(
        int $tenantId,
        int $eventId,
        int $sessionId,
    ): int {
        return (int) DB::table('event_session_registrations as session_registration')
            ->join('event_registrations as event_registration', function ($join): void {
                $join->on('event_registration.tenant_id', '=', 'session_registration.tenant_id')
                    ->on('event_registration.event_id', '=', 'session_registration.event_id')
                    ->on('event_registration.id', '=', 'session_registration.event_registration_id')
                    ->on('event_registration.user_id', '=', 'session_registration.user_id');
            })
            ->where('session_registration.tenant_id', $tenantId)
            ->where('session_registration.event_id', $eventId)
            ->where('session_registration.session_id', $sessionId)
            ->where('session_registration.status', EventSessionRegistrationStatus::Registered->value)
            ->where('event_registration.registration_state', 'confirmed')
            ->whereColumn(
                'event_registration.registration_version',
                'session_registration.event_registration_version',
            )
            ->count();
    }

    /** @param list<array<string,mixed>> $speakers */
    private function assertNoConflicts(
        int $tenantId,
        int $eventId,
        CarbonImmutable $startsAt,
        CarbonImmutable $endsAt,
        ?string $roomKey,
        array $speakers,
        ?int $excludeSessionId = null,
    ): void {
        $start = $startsAt->format('Y-m-d H:i:s');
        $end = $endsAt->format('Y-m-d H:i:s');
        if ($roomKey !== null) {
            $roomConflict = DB::table('event_sessions')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('room_key', $roomKey)
                ->where('status', EventSessionStatus::Scheduled->value)
                ->where('starts_at_utc', '<', $end)
                ->where('ends_at_utc', '>', $start)
                ->when($excludeSessionId !== null, static function ($query) use ($excludeSessionId): void {
                    $query->where('id', '<>', $excludeSessionId);
                })
                ->exists();
            if ($roomConflict) {
                throw new EventSessionException('event_agenda_room_conflict');
            }
        }

        $memberIds = array_values(array_filter(array_map(
            static fn (array $speaker): ?int => $speaker['user_id'],
            $speakers,
        )));
        if ($memberIds === []) {
            return;
        }
        $speakerConflict = DB::table('event_session_speakers as speaker')
            ->join('event_sessions as session', 'session.id', '=', 'speaker.session_id')
            ->where('speaker.tenant_id', $tenantId)
            ->whereIn('speaker.user_id', $memberIds)
            ->where('session.tenant_id', $tenantId)
            ->where('session.status', EventSessionStatus::Scheduled->value)
            ->where('session.starts_at_utc', '<', $end)
            ->where('session.ends_at_utc', '>', $start)
            ->when($excludeSessionId !== null, static function ($query) use ($excludeSessionId): void {
                $query->where('session.id', '<>', $excludeSessionId);
            })
            ->exists();
        if ($speakerConflict) {
            throw new EventSessionException('event_agenda_speaker_conflict');
        }
    }

    private function assertWithinEvent(
        Event $event,
        CarbonImmutable $startsAt,
        CarbonImmutable $endsAt,
    ): void {
        if (! $startsAt->lessThan($endsAt)) {
            throw new EventSessionException('event_agenda_time_range_invalid');
        }
        try {
            $rawStart = $event->getRawOriginal('start_time');
            $rawEnd = $event->getRawOriginal('end_time');
            if (! is_string($rawStart) || trim($rawStart) === ''
                || ! is_string($rawEnd) || trim($rawEnd) === '') {
                throw new \RuntimeException('event_bounds_missing');
            }
            $eventStart = CarbonImmutable::parse($rawStart, 'UTC')->utc();
            $eventEnd = CarbonImmutable::parse($rawEnd, 'UTC')->utc();
        } catch (Throwable) {
            throw new EventSessionException('event_agenda_event_bounds_invalid');
        }
        if ($startsAt->lessThan($eventStart) || $endsAt->greaterThan($eventEnd)) {
            throw new EventSessionException('event_agenda_outside_event_bounds');
        }
    }

    private function inputInstant(mixed $value, string $timezone, string $reason): CarbonImmutable
    {
        if (! $value instanceof DateTimeInterface
            && (! is_string($value)
                || preg_match('/(?:Z|[+-][0-9]{2}:[0-9]{2})$/', trim($value)) !== 1)) {
            throw new EventSessionException($reason);
        }

        try {
            $instant = $value instanceof DateTimeInterface
                ? CarbonImmutable::instance($value)
                : CarbonImmutable::parse(trim($value));
        } catch (Throwable) {
            throw new EventSessionException($reason);
        }
        if ($instant->getOffset() !== $instant->setTimezone($timezone)->getOffset()) {
            throw new EventSessionException('event_agenda_timezone_offset_mismatch');
        }

        return $instant->utc();
    }

    private function eventTimezone(Event $event, mixed $requested): string
    {
        $eventTimezone = trim((string) ($event->getRawOriginal('timezone') ?: 'UTC'));
        if (! in_array($eventTimezone, timezone_identifiers_list(), true)) {
            throw new EventSessionException('event_agenda_event_timezone_invalid');
        }
        $requestedTimezone = $requested === null ? $eventTimezone : trim((string) $requested);
        if ($requestedTimezone !== $eventTimezone) {
            throw new EventSessionException('event_agenda_timezone_mismatch');
        }

        return $eventTimezone;
    }

    private function assertMutableEvent(Event $event): void
    {
        if ((bool) $event->getRawOriginal('is_recurring_template')) {
            throw new EventSessionException('event_agenda_template_unsupported');
        }
        $publication = trim((string) $event->getRawOriginal('publication_status'));
        $operational = trim((string) $event->getRawOriginal('operational_status'));
        $legacy = trim((string) $event->getRawOriginal('status'));
        if ($publication === 'archived' || in_array($operational, ['cancelled', 'completed'], true)
            || in_array($legacy, ['archived', 'cancelled', 'canceled', 'completed'], true)) {
            throw new EventSessionException('event_agenda_event_read_only');
        }
    }

    private function authorizeMutation(User $actor, Event $event): void
    {
        if (! $this->policy->manageAgenda($actor, $event)) {
            throw new EventSessionException('event_agenda_authorization_denied');
        }
    }

    private function eventOrFail(int $tenantId, int $eventId, bool $lock): Event
    {
        $query = Event::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($eventId);
        if ($lock) {
            $query->lockForUpdate();
        }
        $event = $query->first();
        if ($event === null) {
            throw new EventSessionException('event_agenda_event_not_found');
        }

        return $event;
    }

    private function actorOrFail(int $tenantId, User $actor, bool $lock): User
    {
        $query = User::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey((int) $actor->getKey())
            ->where('status', 'active')
            ->whereNull('deleted_at');
        if ($lock) {
            $query->lockForUpdate();
        }
        $persisted = $query->first();
        if ($persisted === null) {
            throw new EventSessionException('event_agenda_actor_invalid');
        }

        return $persisted;
    }

    private function sessionRowOrFail(
        int $tenantId,
        int $eventId,
        int $sessionId,
        bool $lock,
    ): object {
        $query = DB::table('event_sessions')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('id', $sessionId);
        if ($lock) {
            $query->lockForUpdate();
        }
        $session = $query->first();
        if ($session === null) {
            throw new EventSessionException('event_agenda_session_not_found');
        }

        return $session;
    }

    private function advanceAgendaVersion(
        int $tenantId,
        Event $event,
        DateTimeInterface $now,
    ): int {
        $current = (int) ($event->getRawOriginal('agenda_version') ?? 0);
        $next = $this->nextVersion($current);
        $updated = DB::table('events')
            ->where('tenant_id', $tenantId)
            ->where('id', (int) $event->getKey())
            ->where('agenda_version', $current)
            ->update([
                'agenda_version' => $next,
                'updated_at' => $now,
            ]);
        if ($updated !== 1) {
            throw new EventSessionException('event_agenda_concurrent_write_failed');
        }
        $event->setRawAttributes([
            ...$event->getAttributes(),
            'agenda_version' => $next,
        ], true);

        return $next;
    }

    /** @param list<string> $changedFields @param list<int> $affectedSessionIds */
    private function recordHistory(
        int $tenantId,
        int $eventId,
        ?int $sessionId,
        int $actorId,
        int $agendaVersion,
        string $action,
        string $idempotencyKey,
        string $requestHash,
        array $changedFields,
        array $affectedSessionIds,
        DateTimeInterface $now,
    ): int {
        return (int) DB::table('event_session_history')->insertGetId([
            'tenant_id' => $tenantId,
            'event_id' => $eventId,
            'session_id' => $sessionId,
            'actor_user_id' => $actorId,
            'agenda_version' => $agendaVersion,
            'action' => $action,
            'idempotency_key' => $idempotencyKey,
            'request_hash' => $requestHash,
            'changed_fields' => json_encode(array_values($changedFields), JSON_THROW_ON_ERROR),
            'affected_session_ids' => json_encode(array_values($affectedSessionIds), JSON_THROW_ON_ERROR),
            'created_at' => $now,
        ]);
    }

    private function idempotentReplay(
        int $tenantId,
        int $eventId,
        ?int $sessionId,
        int $actorId,
        string $action,
        string $idempotencyKey,
        string $requestHash,
    ): ?object {
        $history = DB::table('event_session_history')
            ->where('tenant_id', $tenantId)
            ->where('idempotency_key', $idempotencyKey)
            ->lockForUpdate()
            ->first();
        if ($history === null) {
            return null;
        }
        $sessionMatches = match ($action) {
            'created' => $history->session_id !== null,
            'reordered' => $history->session_id === null,
            default => $sessionId !== null && (int) $history->session_id === $sessionId,
        };
        if ((int) $history->event_id !== $eventId
            || ! $sessionMatches
            || (int) $history->actor_user_id !== $actorId
            || (string) $history->action !== $action
            || ! hash_equals((string) $history->request_hash, $requestHash)) {
            throw new EventSessionException('event_agenda_idempotency_conflict');
        }

        return $history;
    }

    private function confirmedEventRegistration(
        int $tenantId,
        int $eventId,
        int $userId,
        bool $lock,
    ): ?object {
        $query = DB::table('event_registrations')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->where('registration_state', 'confirmed')
            ->orderByDesc('id');
        if ($lock) {
            $query->lockForUpdate();
        }

        return $query->first(['id', 'registration_version']);
    }

    private function sessionRegistrationRow(
        int $tenantId,
        int $eventId,
        int $sessionId,
        int $userId,
        bool $lock,
    ): ?object {
        $query = DB::table('event_session_registrations')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('session_id', $sessionId)
            ->where('user_id', $userId);
        if ($lock) {
            $query->lockForUpdate();
        }

        return $query->first();
    }

    private function sessionRegistrationReplay(
        int $tenantId,
        int $eventId,
        int $sessionId,
        int $actorId,
        string $action,
        string $idempotencyKey,
        string $requestHash,
    ): ?object {
        $history = DB::table('event_session_registration_history')
            ->where('tenant_id', $tenantId)
            ->where('idempotency_key', $idempotencyKey)
            ->lockForUpdate()
            ->first();
        if ($history === null) {
            return null;
        }
        if ((int) $history->event_id !== $eventId
            || (int) $history->session_id !== $sessionId
            || (int) $history->user_id !== $actorId
            || (int) $history->actor_user_id !== $actorId
            || (string) $history->action !== $action
            || ! hash_equals((string) $history->request_hash, $requestHash)) {
            throw new EventSessionException('event_agenda_registration_idempotency_conflict');
        }

        return $history;
    }

    private function recordSessionRegistrationHistory(
        int $tenantId,
        int $eventId,
        int $sessionId,
        int $registrationId,
        int $actorId,
        int $eventRegistrationId,
        int $eventRegistrationVersion,
        int $registrationVersion,
        string $action,
        string $idempotencyKey,
        string $requestHash,
        DateTimeInterface $now,
    ): int {
        return (int) DB::table('event_session_registration_history')->insertGetId([
            'tenant_id' => $tenantId,
            'event_id' => $eventId,
            'session_id' => $sessionId,
            'registration_id' => $registrationId,
            'user_id' => $actorId,
            'event_registration_id' => $eventRegistrationId,
            'event_registration_version' => $eventRegistrationVersion,
            'actor_user_id' => $actorId,
            'registration_version' => $registrationVersion,
            'action' => $action,
            'idempotency_key' => $idempotencyKey,
            'request_hash' => $requestHash,
            'created_at' => $now,
        ]);
    }

    /**
     * @return array{session:?EventSession,changed:bool,history_id:?int,agenda_version:int,registration_version:int}
     */
    private function sessionRegistrationResult(
        int $sessionId,
        User $viewer,
        bool $changed,
        ?int $historyId,
        int $agendaVersion,
    ): array {
        $result = $this->result(
            $sessionId,
            $changed,
            $historyId,
            $agendaVersion,
            $viewer,
        );
        $result['registration_version'] = max(
            0,
            (int) $result['session']->getAttribute('viewer_registration_version'),
        );
        $visibilityAttribute = $result['session']->getAttribute('visibility');
        $visibility = $visibilityAttribute instanceof EventSessionVisibility
            ? $visibilityAttribute->value
            : (string) $visibilityAttribute;
        $visible = match ($visibility) {
            EventSessionVisibility::Public->value => true,
            EventSessionVisibility::Registered->value => (bool) $result['session']
                ->getAttribute('viewer_can_view_registered'),
            EventSessionVisibility::Staff->value => (bool) $result['session']
                ->getAttribute('viewer_can_view_staff'),
            default => false,
        };
        if (! $visible) {
            // Withdrawal remains an exit-only operation after permissions change,
            // but the mutation must not disclose a now-hidden staff session.
            $result['session'] = null;
        }

        return $result;
    }

    private function canViewSession(User $viewer, Event $event, object $session): bool
    {
        return match ((string) ($session->visibility ?? '')) {
            EventSessionVisibility::Public->value => $this->policy->view($viewer, $event),
            EventSessionVisibility::Registered->value => $this->policy->viewRegisteredAgenda($viewer, $event),
            EventSessionVisibility::Staff->value => $this->policy->viewStaffAgenda($viewer, $event),
            default => false,
        };
    }

    /** @param Collection<int,EventSession> $sessions */
    private function decorateSessionFacts(
        int $tenantId,
        Event $event,
        User $viewer,
        Collection $sessions,
        bool $canManage,
        bool $canViewRegistered,
        bool $canViewStaff,
    ): void {
        if ($sessions->isEmpty()) {
            return;
        }

        $eventId = (int) $event->getKey();
        $viewerId = (int) $viewer->getKey();
        $sessionIds = $sessions->pluck('id')
            ->map(static fn (mixed $id): int => (int) $id)
            ->all();
        $canonicalRegistration = DB::table('event_registrations')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $viewerId)
            ->where('registration_state', 'confirmed')
            ->orderByDesc('id')
            ->first(['id', 'registration_version']);
        $viewerRegistrations = DB::table('event_session_registrations')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $viewerId)
            ->whereIn('session_id', $sessionIds)
            ->get([
                'session_id',
                'event_registration_id',
                'event_registration_version',
                'version',
                'status',
            ])
            ->keyBy('session_id');
        $registeredCounts = DB::table('event_session_registrations as session_registration')
            ->join('event_registrations as event_registration', function ($join): void {
                $join->on('event_registration.tenant_id', '=', 'session_registration.tenant_id')
                    ->on('event_registration.event_id', '=', 'session_registration.event_id')
                    ->on('event_registration.id', '=', 'session_registration.event_registration_id')
                    ->on('event_registration.user_id', '=', 'session_registration.user_id');
            })
            ->where('session_registration.tenant_id', $tenantId)
            ->where('session_registration.event_id', $eventId)
            ->whereIn('session_registration.session_id', $sessionIds)
            ->where('session_registration.status', EventSessionRegistrationStatus::Registered->value)
            ->where('event_registration.registration_state', 'confirmed')
            ->whereColumn(
                'event_registration.registration_version',
                'session_registration.event_registration_version',
            )
            ->groupBy('session_registration.session_id')
            ->selectRaw('session_registration.session_id, COUNT(*) AS registered_count')
            ->pluck('registered_count', 'session_registration.session_id');

        foreach ($sessions as $session) {
            $sessionId = (int) $session->getKey();
            $registered = (int) ($registeredCounts->get($sessionId) ?? 0);
            $capacity = $session->capacity === null ? null : (int) $session->capacity;
            $isFull = $capacity !== null && $registered >= $capacity;
            $viewerRegistration = $viewerRegistrations->get($sessionId);
            $persistedStatus = $viewerRegistration === null
                ? null
                : (string) $viewerRegistration->status;
            $eligible = $canonicalRegistration !== null;
            $activeForCurrentEligibility = $viewerRegistration !== null
                && $canonicalRegistration !== null
                && $persistedStatus === EventSessionRegistrationStatus::Registered->value
                && (int) $viewerRegistration->event_registration_id
                    === (int) $canonicalRegistration->id
                && (int) $viewerRegistration->event_registration_version
                    === (int) $canonicalRegistration->registration_version;
            $state = match (true) {
                $activeForCurrentEligibility => 'registered',
                $persistedStatus === EventSessionRegistrationStatus::Registered->value => 'ineligible',
                $persistedStatus === EventSessionRegistrationStatus::Withdrawn->value => 'withdrawn',
                default => 'not_registered',
            };
            $sessionStatus = $session->status instanceof BackedEnum
                ? (string) $session->status->value
                : (string) $session->status;
            $session->setAttribute('capacity_registered', $registered);
            $session->setAttribute('viewer_registration_state', $state);
            $session->setAttribute(
                'viewer_registration_version',
                $viewerRegistration === null ? 0 : (int) $viewerRegistration->version,
            );
            $session->setAttribute(
                'viewer_can_register',
                $eligible
                    && $sessionStatus === EventSessionStatus::Scheduled->value
                    && ! $activeForCurrentEligibility
                    && ! $isFull,
            );
            $session->setAttribute(
                'viewer_can_withdraw',
                $persistedStatus === EventSessionRegistrationStatus::Registered->value,
            );
            $session->setAttribute('viewer_can_view_registered', $canViewRegistered);
            $session->setAttribute('viewer_can_view_staff', $canViewStaff);
            $session->setAttribute('viewer_can_manage', $canManage);
        }
    }

    /** @return array{session:EventSession,changed:bool,history_id:?int,agenda_version:int} */
    private function result(
        int $sessionId,
        bool $changed,
        ?int $historyId,
        int $agendaVersion,
        User $viewer,
    ): array {
        $tenantId = $this->tenantIdOrFail();
        $session = EventSession::withoutGlobalScopes()
            ->with($this->speakerRelations())
            ->where('tenant_id', $tenantId)
            ->find($sessionId);
        if ($session === null) {
            throw new EventSessionException('event_agenda_persistence_failed');
        }
        $event = $this->eventOrFail($tenantId, (int) $session->event_id, false);
        $canManage = $this->policy->manageAgenda($viewer, $event);
        $canViewStaff = $this->policy->viewStaffAgenda($viewer, $event);
        $canViewRegistered = $canViewStaff
            || $this->confirmedEventRegistration(
                $tenantId,
                (int) $event->getKey(),
                (int) $viewer->getKey(),
                false,
            ) !== null;
        $this->decorateSessionFacts(
            $tenantId,
            $event,
            $viewer,
            collect([$session]),
            $canManage,
            $canViewRegistered,
            $canViewStaff,
        );

        return [
            'session' => $session,
            'changed' => $changed,
            'history_id' => $historyId,
            'agenda_version' => $agendaVersion,
        ];
    }

    /** @return Collection<int,EventSession> */
    private function loadScheduledSessions(int $tenantId, Event $event, User $viewer): Collection
    {
        $sessions = EventSession::withoutGlobalScopes()
            ->with($this->speakerRelations())
            ->where('tenant_id', $tenantId)
            ->where('event_id', (int) $event->getKey())
            ->where('status', EventSessionStatus::Scheduled->value)
            ->orderBy('position')
            ->orderBy('id')
            ->get();
        $this->decorateSessionFacts(
            $tenantId,
            $event,
            $viewer,
            $sessions,
            true,
            true,
            true,
        );

        return $sessions;
    }

    /** @return array<int|string,mixed> */
    private function speakerRelations(): array
    {
        return [
            'speakers.user:id,tenant_id,name,first_name,last_name,profile_type,organization_name,avatar_url',
            'resources',
        ];
    }

    private function tenantIdOrFail(): int
    {
        $tenantId = TenantContext::currentId();
        if ($tenantId === null || $tenantId <= 0) {
            throw new EventSessionException('event_agenda_tenant_context_missing');
        }

        return $tenantId;
    }

    private function assertFeatureEnabled(): void
    {
        try {
            if (TenantContext::hasFeature('events')) {
                return;
            }
        } catch (Throwable) {
            // Fail closed below.
        }

        throw new EventSessionException('event_agenda_feature_disabled');
    }

    private function assertSchemaAvailable(): void
    {
        if (! $this->schemaAvailable()) {
            throw new EventSessionException('event_agenda_schema_unavailable');
        }
    }

    private function schemaAvailable(): bool
    {
        return Schema::hasTable('event_sessions')
            && Schema::hasTable('event_session_speakers')
            && Schema::hasTable('event_session_history')
            && Schema::hasTable('event_session_resources')
            && Schema::hasTable('event_session_registrations')
            && Schema::hasTable('event_session_registration_history')
            && Schema::hasColumn('event_sessions', 'capacity')
            && Schema::hasColumn('events', 'agenda_version');
    }

    private function normalizeIdempotencyKey(string $key): string
    {
        $key = trim($key);
        if ($key === '' || mb_strlen($key) > 191 || $this->hasControlCharacters($key)) {
            throw new EventSessionException('event_agenda_idempotency_key_invalid');
        }

        return $key;
    }

    /** @param array<mixed,mixed> $input @param list<string> $allowed */
    private function assertKnownFields(array $input, array $allowed, string $reason): void
    {
        foreach (array_keys($input) as $field) {
            if (! is_string($field) || ! in_array($field, $allowed, true)) {
                throw new EventSessionException($reason);
            }
        }
    }

    /** @param array<string,mixed> $attributes */
    private function assertNoAliasCollisions(array $attributes): void
    {
        foreach ([
            ['session_type', 'type'],
            ['start_at', 'starts_at'],
            ['end_at', 'ends_at'],
            ['track_name', 'track'],
            ['room_name', 'room'],
        ] as [$canonical, $alias]) {
            if (array_key_exists($canonical, $attributes) && array_key_exists($alias, $attributes)) {
                throw new EventSessionException('event_agenda_fields_ambiguous');
            }
        }
    }

    /** @param list<int> $ids @return list<int> */
    private function normalizeOrderedIds(array $ids): array
    {
        $normalized = [];
        foreach ($ids as $id) {
            if (! is_int($id) && ! (is_string($id) && ctype_digit($id))) {
                throw new EventSessionException('event_agenda_reorder_set_invalid');
            }
            $id = (int) $id;
            if ($id <= 0 || in_array($id, $normalized, true)) {
                throw new EventSessionException('event_agenda_reorder_set_invalid');
            }
            $normalized[] = $id;
        }

        return $normalized;
    }

    private function requiredText(mixed $value, int $max, string $reason): string
    {
        $value = $this->plainText($value);
        if ($value === null || mb_strlen($value) > $max || $this->hasControlCharacters($value)
            || preg_match('/[\r\n]/u', $value) === 1) {
            throw new EventSessionException($reason);
        }

        return $value;
    }

    private function optionalText(mixed $value, int $max, string $reason): ?string
    {
        $value = $this->plainText($value);
        if ($value !== null && (mb_strlen($value) > $max || $this->hasControlCharacters($value)
            || preg_match('/[\r\n]/u', $value) === 1)) {
            throw new EventSessionException($reason);
        }

        return $value;
    }

    private function optionalDescription(mixed $value): ?string
    {
        $value = $this->plainText($value);
        if ($value !== null && (mb_strlen($value) > self::MAX_DESCRIPTION_LENGTH
            || $this->hasControlCharacters($value))) {
            throw new EventSessionException('event_agenda_description_invalid');
        }

        return $value;
    }

    private function optionalCapacity(mixed $value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }
        $parsed = filter_var(
            $value,
            FILTER_VALIDATE_INT,
            ['options' => ['min_range' => 1, 'max_range' => 100000]],
        );
        if ($parsed === false) {
            throw new EventSessionException('event_agenda_capacity_invalid');
        }

        return (int) $parsed;
    }

    private function secureResourceUrl(mixed $value): string
    {
        if (! is_string($value)) {
            throw new EventSessionException('event_agenda_resource_url_invalid');
        }
        $url = trim($value);
        if ($url === '' || mb_strlen($url) > 2048 || $this->hasControlCharacters($url)
            || filter_var($url, FILTER_VALIDATE_URL) === false) {
            throw new EventSessionException('event_agenda_resource_url_invalid');
        }
        $parts = parse_url($url);
        if (! is_array($parts)
            || strtolower((string) ($parts['scheme'] ?? '')) !== 'https'
            || trim((string) ($parts['host'] ?? '')) === ''
            || isset($parts['user'])
            || isset($parts['pass'])) {
            throw new EventSessionException('event_agenda_resource_url_invalid');
        }

        return $url;
    }

    private function plainText(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        if (! is_string($value) && ! $value instanceof \Stringable) {
            return null;
        }
        $value = trim(html_entity_decode(strip_tags((string) $value), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        if ($value === '') {
            return null;
        }
        return $value;
    }

    private function hasControlCharacters(string $value): bool
    {
        return preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', $value) === 1;
    }

    private function roomKey(?string $room): ?string
    {
        if ($room === null) {
            return null;
        }
        $normalized = preg_replace('/\s+/u', ' ', mb_strtolower(trim($room), 'UTF-8'));

        return hash('sha256', $normalized ?? $room);
    }

    /** @param class-string<BackedEnum> $enum */
    private function enum(string $enum, mixed $value, string $reason): BackedEnum
    {
        if ($value instanceof $enum) {
            return $value;
        }
        if (! is_string($value)) {
            throw new EventSessionException($reason);
        }
        $resolved = $enum::tryFrom(trim($value));
        if ($resolved === null) {
            throw new EventSessionException($reason);
        }

        return $resolved;
    }

    private function assertPositiveVersion(int $version, string $reason): void
    {
        if ($version <= 0) {
            throw new EventSessionException($reason);
        }
    }

    private function nextVersion(mixed $current): int
    {
        if (! is_numeric($current) || (int) $current < 0 || (int) $current >= PHP_INT_MAX) {
            throw new EventSessionException('event_agenda_version_invalid');
        }

        return (int) $current + 1;
    }

    private function requestHash(array $payload): string
    {
        return hash('sha256', json_encode($this->canonicalize($payload), JSON_THROW_ON_ERROR));
    }

    private function canonicalize(mixed $value): mixed
    {
        if ($value instanceof BackedEnum) {
            return $value->value;
        }
        if ($value instanceof DateTimeInterface) {
            return CarbonImmutable::instance($value)->utc()->format('Y-m-d\TH:i:s.u\Z');
        }
        if (! is_array($value)) {
            return $value;
        }
        if (array_is_list($value)) {
            return array_map(fn (mixed $item): mixed => $this->canonicalize($item), $value);
        }
        ksort($value);
        foreach ($value as $key => $item) {
            $value[$key] = $this->canonicalize($item);
        }

        return $value;
    }
}
