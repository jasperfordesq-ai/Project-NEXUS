<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Enums\EventCapacityRegistrationState;
use App\Enums\EventWaitlistQueueState;
use App\Exceptions\EventRegistrationException;
use App\Exceptions\EventWaitlistException;
use App\Models\Event;
use App\Models\EventRegistration;
use App\Models\EventWaitlistEntry;
use App\Models\User;
use App\Policies\EventPolicy;
use App\Support\Events\EventRegistrationAvailability;
use App\Support\Events\EventRegistrationCompatibility;
use App\Support\Events\EventRegistrationTransitionResult;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/** Serialized canonical capacity-registration writer with legacy projection. */
final class EventRegistrationService
{
    private const OUTBOX_ACTION_PREFIX = 'event.registration.';
    private const MAX_REASON_LENGTH = 4000;

    private readonly EventDomainOutboxService $outbox;
    private readonly EventParticipationEligibilityService $eligibility;
    private readonly EventPolicy $policy;
    private readonly EventReminderScheduleService $reminderSchedules;
    private readonly EventTicketEntitlementService $ticketEntitlements;

    public function __construct(
        ?EventDomainOutboxService $outbox = null,
        ?EventParticipationEligibilityService $eligibility = null,
        ?EventPolicy $policy = null,
        ?EventReminderScheduleService $reminderSchedules = null,
        ?EventTicketEntitlementService $ticketEntitlements = null,
    ) {
        $this->outbox = $outbox ?? new EventDomainOutboxService();
        $this->eligibility = $eligibility ?? app(EventParticipationEligibilityService::class);
        $this->policy = $policy ?? app(EventPolicy::class);
        $this->reminderSchedules = $reminderSchedules ?? app(EventReminderScheduleService::class);
        $this->ticketEntitlements = $ticketEntitlements ?? app(EventTicketEntitlementService::class);
    }

    public function transition(
        int $eventId,
        int $userId,
        EventCapacityRegistrationState $target,
        User $actor,
        string $idempotencyKey,
        ?string $capacityPoolKey = null,
        ?string $allocationKey = null,
        ?string $reason = null,
        ?int $expectedVersion = null,
    ): EventRegistrationTransitionResult {
        $tenantId = $this->tenantId();
        if (in_array($target, [
            EventCapacityRegistrationState::Invited,
            EventCapacityRegistrationState::Pending,
            EventCapacityRegistrationState::Confirmed,
        ], true) && ! (bool) app(EventConfigurationService::class)->value('registration_enabled', true, $tenantId)) {
            throw new EventRegistrationException('event_registration_tenant_disabled');
        }
        $pool = $this->capacityPool($capacityPoolKey);
        $allocation = $this->allocationKey($allocationKey);
        $key = $this->idempotencyKey(
            $idempotencyKey,
            "registration:{$tenantId}:{$eventId}:{$userId}:{$pool}:{$target->value}",
        );
        $reason = $this->reason($reason);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $userId,
            $target,
            $actor,
            $key,
            $pool,
            $allocation,
            $reason,
            $expectedVersion,
        ): EventRegistrationTransitionResult {
            $event = in_array($target, [
                EventCapacityRegistrationState::Declined,
                EventCapacityRegistrationState::Cancelled,
            ], true)
                ? $this->lockEvent($tenantId, $eventId)
                : $this->lockEligibleEvent($tenantId, $eventId);
            [$subject, $persistedActor] = $this->lockParticipants($tenantId, $userId, $actor);

            return $this->transitionLocked(
                $event,
                $subject,
                $persistedActor,
                $target,
                $key,
                $pool,
                $allocation,
                $reason,
                null,
                true,
                $expectedVersion,
            );
        }, 5);
    }

    public function confirm(
        int $eventId,
        int $userId,
        User $actor,
        string $idempotencyKey,
        ?string $capacityPoolKey = null,
    ): EventRegistrationTransitionResult {
        return $this->transition(
            $eventId,
            $userId,
            EventCapacityRegistrationState::Confirmed,
            $actor,
            $idempotencyKey,
            $capacityPoolKey,
        );
    }

    public function withdraw(
        int $eventId,
        int $userId,
        User $actor,
        string $idempotencyKey,
        ?string $capacityPoolKey = null,
        ?string $reason = null,
    ): EventRegistrationTransitionResult {
        return $this->transition(
            $eventId,
            $userId,
            EventCapacityRegistrationState::Cancelled,
            $actor,
            $idempotencyKey,
            $capacityPoolKey,
            null,
            $reason,
        );
    }

    /**
     * Compatibility writer for legacy RSVP routes.
     *
     * Without a client key, identity is derived while holding the Event and
     * registration locks from the current monotonic version/state and target.
     * This makes double-clicks no-ops while permitting later state cycles.
     */
    public function confirmCompatibility(
        int $eventId,
        int $userId,
        User $actor,
        ?string $requestKey = null,
    ): EventRegistrationTransitionResult {
        $result = $this->transitionCompatibility(
            $eventId,
            $userId,
            EventCapacityRegistrationState::Confirmed,
            $actor,
            $requestKey,
            false,
        );
        if ($result === null) {
            throw new EventRegistrationException('event_registration_transition_invalid');
        }

        return $result;
    }

    public function withdrawCompatibility(
        int $eventId,
        int $userId,
        User $actor,
        ?string $requestKey = null,
        ?string $reason = null,
    ): ?EventRegistrationTransitionResult {
        return $this->transitionCompatibility(
            $eventId,
            $userId,
            EventCapacityRegistrationState::Cancelled,
            $actor,
            $requestKey,
            true,
            $reason,
        );
    }

    private function transitionCompatibility(
        int $eventId,
        int $userId,
        EventCapacityRegistrationState $target,
        User $actor,
        ?string $requestKey,
        bool $requireExisting,
        ?string $reason = null,
    ): ?EventRegistrationTransitionResult {
        $tenantId = $this->tenantId();
        $pool = $this->capacityPool(null);
        $reason = $this->reason($reason);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $userId,
            $target,
            $actor,
            $requestKey,
            $requireExisting,
            $pool,
            $reason,
        ): ?EventRegistrationTransitionResult {
            $event = in_array($target, [
                EventCapacityRegistrationState::Declined,
                EventCapacityRegistrationState::Cancelled,
            ], true)
                ? $this->lockEvent($tenantId, $eventId)
                : $this->lockEligibleEvent($tenantId, $eventId);
            [$subject, $persistedActor] = $this->lockParticipants(
                $tenantId,
                $userId,
                $actor,
            );
            $registration = $this->lockedRegistration(
                $tenantId,
                $eventId,
                $userId,
                $pool,
            );
            $legacyState = $registration === null
                && (bool) config('events.registration.legacy_dual_read', true)
                ? $this->legacyStateLocked($tenantId, $eventId, $userId)
                : null;
            $from = $registration?->registration_state ?? $legacyState;
            if ($requireExisting && $from === null) {
                return null;
            }
            $version = $registration === null
                ? 0
                : (int) $registration->registration_version;
            $identity = $this->compatibilityIdentity(
                $requestKey,
                'registration',
                $version,
                $from?->value,
                $target->value,
            );
            $key = $this->idempotencyKey(
                $identity,
                "compatibility-registration:{$tenantId}:{$eventId}:{$userId}:{$pool}:{$target->value}",
            );

            return $this->transitionLocked(
                $event,
                $subject,
                $persistedActor,
                $target,
                $key,
                $pool,
                null,
                $reason,
                null,
                true,
            );
        }, 5);
    }

    /** Canonical-first read with a non-capacity legacy engagement fail-open. */
    public function stateFor(
        int $eventId,
        int $userId,
        ?string $capacityPoolKey = null,
    ): ?EventCapacityRegistrationState {
        $tenantId = $this->tenantId();
        $pool = $this->capacityPool($capacityPoolKey);
        /** @var EventRegistration|null $registration */
        $registration = EventRegistration::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->where('capacity_pool_key', $pool)
            ->first();
        if ($registration !== null) {
            return $registration->registration_state;
        }
        if (! (bool) config('events.registration.legacy_dual_read', true)) {
            return null;
        }

        $legacy = DB::table('event_rsvps')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->value('status');

        return EventRegistrationCompatibility::registrationFromLegacy(
            is_string($legacy) ? $legacy : null,
        );
    }

    /**
     * Accept a locked queue offer without adding a second capacity claim.
     * Caller must hold the Event and waitlist-entry row locks in a transaction.
     */
    public function confirmFromWaitlistLocked(
        Event $event,
        EventWaitlistEntry $entry,
        User $actor,
        string $idempotencyKey,
    ): EventRegistrationTransitionResult {
        if (DB::transactionLevel() <= 0) {
            throw new EventRegistrationException('event_registration_transaction_required');
        }
        $tenantId = (int) $event->getAttribute('tenant_id');
        if ($tenantId !== $this->tenantId()
            || (int) $entry->tenant_id !== $tenantId
            || (int) $entry->event_id !== (int) $event->getKey()) {
            throw new EventRegistrationException('event_registration_offer_scope_invalid');
        }
        $this->assertEligibleEvent($event);
        [$subject, $persistedActor] = $this->lockParticipants(
            $tenantId,
            (int) $entry->user_id,
            $actor,
        );
        $key = $this->idempotencyKey(
            $idempotencyKey,
            "registration-offer:{$tenantId}:{$event->getKey()}:{$entry->getKey()}",
        );

        return $this->transitionLocked(
            $event,
            $subject,
            $persistedActor,
            EventCapacityRegistrationState::Confirmed,
            $key,
            (string) $entry->capacity_pool_key,
            is_string($entry->allocation_key) ? $entry->allocation_key : null,
            null,
            (int) $entry->getKey(),
            false,
        );
    }

    /**
     * Cancel every active canonical registration during a terminal lifecycle
     * transition. The caller owns the Event row lock and surrounding transaction.
     *
     * @return array{cancelled:int,reminders_cancelled:int,recipient_user_ids:list<int>}
     */
    public function cancelActiveForLifecycleWithinTransaction(
        Event $event,
        User $actor,
        string $reason,
        string $idempotencyPrefix,
    ): array {
        if (DB::transactionLevel() <= 0) {
            throw new EventRegistrationException('event_registration_transaction_required');
        }
        $tenantId = $this->tenantId();
        $eventId = (int) $event->getKey();
        $reason = $this->reason($reason);
        if ((int) $event->tenant_id !== $tenantId || $eventId <= 0) {
            throw new EventRegistrationException('event_registration_event_scope_invalid');
        }
        if ($reason === null) {
            throw new EventRegistrationException('event_registration_reason_required');
        }
        $persistedActor = $this->lockActor($tenantId, $actor);
        if (! $this->policy->manageRegistration($persistedActor, $event)) {
            throw new EventRegistrationException('event_registration_authorization_denied');
        }

        /** @var list<EventRegistration> $registrations */
        $registrations = EventRegistration::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->whereIn('registration_state', [
                EventCapacityRegistrationState::Invited->value,
                EventCapacityRegistrationState::Pending->value,
                EventCapacityRegistrationState::Confirmed->value,
            ])
            ->orderBy('id')
            ->lockForUpdate()
            ->get()
            ->all();

        $cancelled = 0;
        $remindersCancelled = 0;
        $recipientIds = [];
        foreach ($registrations as $registration) {
            /** @var User|null $subject */
            $subject = User::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey((int) $registration->user_id)
                ->lockForUpdate()
                ->first();
            if ($subject === null) {
                throw new EventRegistrationException('event_registration_subject_not_found');
            }
            if ($registration->registration_state === EventCapacityRegistrationState::Confirmed) {
                $remindersCancelled += DB::table('event_reminders')
                    ->where('tenant_id', $tenantId)
                    ->where('event_id', $eventId)
                    ->where('user_id', (int) $registration->user_id)
                    ->where('status', 'pending')
                    ->count('id');
            }
            $nextVersion = (int) $registration->registration_version + 1;
            $key = $this->idempotencyKey(
                "{$idempotencyPrefix}:registration:{$registration->getKey()}:v{$nextVersion}",
                "lifecycle-cancel:{$tenantId}:{$eventId}:{$registration->getKey()}",
            );
            $result = $this->transitionLocked(
                $event,
                $subject,
                $persistedActor,
                EventCapacityRegistrationState::Cancelled,
                $key,
                (string) $registration->capacity_pool_key,
                is_string($registration->allocation_key)
                    ? $registration->allocation_key
                    : null,
                $reason,
                null,
                false,
            );
            if ($result->changed) {
                $cancelled++;
                $recipientIds[] = (int) $registration->user_id;
            }
        }

        return [
            'cancelled' => $cancelled,
            'reminders_cancelled' => $remindersCancelled,
            'recipient_user_ids' => array_values(array_unique($recipientIds)),
        ];
    }

    /** Caller must hold the Event row lock. Null means unlimited capacity. */
    public function availableSlotsLocked(
        Event $event,
        string $capacityPoolKey,
        ?int $excludeWaitlistEntryId = null,
    ): ?int {
        if (DB::transactionLevel() <= 0) {
            throw new EventRegistrationException('event_registration_transaction_required');
        }
        $capacity = $event->getAttribute('max_attendees');
        if ($capacity === null || $capacity === '') {
            return null;
        }
        $limit = (int) $capacity;
        if ($limit <= 0) {
            throw new EventRegistrationException('event_registration_capacity_invalid');
        }

        return max(0, $limit - $this->occupiedUserIdsLocked(
            (int) $event->tenant_id,
            (int) $event->getKey(),
            $capacityPoolKey,
            $excludeWaitlistEntryId,
        )->count());
    }

    private function transitionLocked(
        Event $event,
        User $subject,
        User $actor,
        EventCapacityRegistrationState $target,
        string $idempotencyKey,
        string $pool,
        ?string $allocation,
        ?string $reason,
        ?int $acceptedWaitlistEntryId,
        bool $advanceWaitlistOnRelease,
        ?int $expectedVersion = null,
    ): EventRegistrationTransitionResult {
        $tenantId = (int) $event->tenant_id;
        $eventId = (int) $event->getKey();
        $userId = (int) $subject->getKey();

        $this->assertActorAuthorized($event, $subject, $actor);

        if (in_array($target, [
            EventCapacityRegistrationState::Invited,
            EventCapacityRegistrationState::Pending,
            EventCapacityRegistrationState::Confirmed,
        ], true)) {
            $this->eligibility->assertCanParticipate(
                $event,
                $subject,
                'event_registration',
            );
        }

        $replay = DB::table('event_registration_history')
            ->where('tenant_id', $tenantId)
            ->where('idempotency_key', $idempotencyKey)
            ->lockForUpdate()
            ->first();
        if ($replay !== null) {
            $replayReason = is_string($replay->reason ?? null)
                ? trim($replay->reason)
                : null;
            if ((int) $replay->event_id !== $eventId
                || (int) $replay->user_id !== $userId
                || (string) $replay->capacity_pool_key !== $pool
                || (string) $replay->to_state !== $target->value
                || $replayReason !== $reason
                || ($expectedVersion !== null
                    && max(0, (int) $replay->registration_version - 1)
                        !== $expectedVersion)) {
                throw new EventRegistrationException('event_registration_idempotency_conflict');
            }
            $registration = $this->lockedRegistration($tenantId, $eventId, $userId, $pool);
            if ($registration === null
                || $registration->registration_state !== $target
                || (int) $registration->registration_version
                    !== (int) $replay->registration_version) {
                throw new EventRegistrationException('event_registration_idempotency_conflict');
            }

            $this->reconcileReminderState($registration, $target);
            if (! $target->consumesCapacity()) {
                $this->ticketEntitlements->cancelConfirmedForRegistrationExitWithinTransaction(
                    $eventId,
                    (int) $registration->getKey(),
                    $actor,
                    $reason ?? 'registration_cancelled',
                    $idempotencyKey,
                );
            }

            return new EventRegistrationTransitionResult(
                $registration,
                false,
                true,
                (int) $replay->id,
                $this->outboxId($tenantId, $this->outboxKey($tenantId, $idempotencyKey)),
            );
        }

        $registration = $this->lockedRegistration($tenantId, $eventId, $userId, $pool);
        $currentVersion = $registration === null
            ? 0
            : (int) $registration->registration_version;
        if ($expectedVersion !== null && $expectedVersion !== $currentVersion) {
            throw new EventRegistrationException('event_registration_version_conflict');
        }
        $legacyState = $registration === null && (bool) config('events.registration.legacy_dual_read', true)
            ? $this->legacyStateLocked($tenantId, $eventId, $userId)
            : null;
        $from = $registration?->registration_state ?? $legacyState;
        $canonicalizing = $registration === null && $from === $target;
        $managerActing = (int) $actor->getKey() !== $userId;

        if ($managerActing
            && in_array($target, [
                EventCapacityRegistrationState::Declined,
                EventCapacityRegistrationState::Cancelled,
            ], true)
            && $reason === null) {
            throw new EventRegistrationException('event_registration_reason_required');
        }
        if ($managerActing
            && $target === EventCapacityRegistrationState::Confirmed
            && $from !== EventCapacityRegistrationState::Confirmed
            && ! in_array($from, [
                EventCapacityRegistrationState::Invited,
                EventCapacityRegistrationState::Pending,
            ], true)) {
            throw new EventRegistrationException('event_registration_transition_invalid');
        }

        if ($registration !== null && $registration->registration_state === $target) {
            $this->reconcileReminderState($registration, $target);
            return new EventRegistrationTransitionResult($registration, false, false, null, null);
        }
        if ($from !== null && ! $from->canTransitionTo($target)) {
            throw new EventRegistrationException('event_registration_transition_invalid');
        }

        $wasConsuming = $from?->consumesCapacity() ?? false;
        if ($target->consumesCapacity() && ! $wasConsuming) {
            $activeOwnOffer = EventWaitlistEntry::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('user_id', $userId)
                ->where('capacity_pool_key', $pool)
                ->where('queue_state', EventWaitlistQueueState::Offered->value)
                ->when(
                    $acceptedWaitlistEntryId !== null,
                    fn ($query) => $query->where('id', '!=', $acceptedWaitlistEntryId),
                )
                ->lockForUpdate()
                ->exists();
            if ($activeOwnOffer) {
                throw new EventRegistrationException('event_registration_offer_acceptance_required');
            }
            $available = $this->availableSlotsLocked($event, $pool, $acceptedWaitlistEntryId);
            if ($available !== null && $available < 1) {
                throw new EventRegistrationException('event_registration_capacity_full');
            }
        }

        $now = now();
        $version = $registration === null ? 1 : ((int) $registration->registration_version + 1);
        $values = [
            'tenant_id' => $tenantId,
            'event_id' => $eventId,
            'user_id' => $userId,
            'capacity_pool_key' => $pool,
            'allocation_key' => $allocation,
            'registration_state' => $target->value,
            'registration_version' => $version,
            'state_changed_at' => $now,
            'state_changed_by' => (int) $actor->getKey(),
            'updated_at' => $now,
            $this->stateTimestampColumn($target) => $now,
        ];
        if ($registration === null) {
            $values['created_at'] = $now;
            $registrationId = (int) DB::table('event_registrations')->insertGetId($values);
            /** @var EventRegistration $registration */
            $registration = EventRegistration::withoutGlobalScopes()
                ->whereKey($registrationId)
                ->lockForUpdate()
                ->firstOrFail();
        } else {
            $registration->forceFill($values);
            $registration->save();
        }

        $cancelledPendingReminders = $this->reconcileReminderState($registration, $target);
        $releasedTicketEntitlements = 0;
        if ($wasConsuming && ! $target->consumesCapacity()) {
            $releasedTicketEntitlements = $this->ticketEntitlements
                ->cancelConfirmedForRegistrationExitWithinTransaction(
                    $eventId,
                    (int) $registration->getKey(),
                    $actor,
                    $reason ?? 'registration_cancelled',
                    $idempotencyKey,
                );
        }

        $action = $canonicalizing ? 'canonicalized' : $target->value;
        try {
            $historyId = (int) DB::table('event_registration_history')->insertGetId([
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'registration_id' => (int) $registration->getKey(),
                'user_id' => $userId,
                'actor_user_id' => (int) $actor->getKey(),
                'capacity_pool_key' => $pool,
                'allocation_key' => $allocation,
                'registration_version' => $version,
                'action' => $action,
                'from_state' => $from?->value,
                'to_state' => $target->value,
                'idempotency_key' => $idempotencyKey,
                'reason' => $reason,
                'metadata' => json_encode([
                    'schema_version' => 1,
                    'source' => 'event_registration_service',
                    'accepted_waitlist_entry_id' => $acceptedWaitlistEntryId,
                    'cancelled_pending_reminders' => $cancelledPendingReminders,
                    'released_ticket_entitlements' => $releasedTicketEntitlements,
                ], JSON_THROW_ON_ERROR),
                'created_at' => $now,
            ]);
        } catch (QueryException $exception) {
            if ($this->isUniqueConflict($exception)) {
                throw new EventRegistrationException('event_registration_idempotency_conflict');
            }
            throw $exception;
        }

        $this->writeLegacyRegistration($tenantId, $eventId, $userId, $target, $now);
        $outboxKey = $this->outboxKey($tenantId, $idempotencyKey);
        $outbox = $this->outbox->record(
            $tenantId,
            $eventId,
            $version,
            self::OUTBOX_ACTION_PREFIX . $action,
            $outboxKey,
            [
                'schema_version' => 1,
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'registration_id' => (int) $registration->getKey(),
                'user_id' => $userId,
                'actor_user_id' => (int) $actor->getKey(),
                'capacity_pool_key' => $pool,
                'allocation_key' => $allocation,
                'registration_version' => $version,
                'from_state' => $from?->value,
                'to_state' => $target->value,
                'reason' => $reason,
                'cancelled_pending_reminders' => $cancelledPendingReminders,
                'released_ticket_entitlements' => $releasedTicketEntitlements,
                'occurred_at' => $now->toIso8601String(),
            ],
        );

        $released = $wasConsuming && ! $target->consumesCapacity();
        $offered = null;
        $offerToken = null;
        if ($released
            && $advanceWaitlistOnRelease
            && app(EventWaitlistService::class)->timedOffersEnabled()) {
            try {
                $offer = app(EventWaitlistService::class)->offerNextWithinTransaction(
                    $event,
                    $pool,
                    null,
                    "registration-release:{$historyId}",
                );
                $offered = $offer?->entry;
                $offerToken = $offer?->offerToken;
            } catch (EventWaitlistException $exception) {
                if ($exception->reasonCode !== 'event_waitlist_timed_offers_disabled') {
                    throw $exception;
                }
            }
        }

        $registration->refresh();

        return new EventRegistrationTransitionResult(
            $registration,
            true,
            false,
            $historyId,
            (int) $outbox['id'],
            $released,
            $offered,
            $offerToken,
        );
    }

    private function reconcileReminderState(
        EventRegistration $registration,
        EventCapacityRegistrationState $state,
    ): int {
        $eventId = (int) $registration->event_id;
        $userId = (int) $registration->user_id;
        if ($state === EventCapacityRegistrationState::Confirmed) {
            $this->reminderSchedules->reconcileConfirmedRegistration(
                $eventId,
                $userId,
                (int) $registration->getKey(),
                (int) $registration->registration_version,
            );

            return 0;
        }

        return $this->reminderSchedules->cancelForRegistrationExit(
            $eventId,
            $userId,
            'registration_' . $state->value,
        );
    }

    private function assertActorAuthorized(Event $event, User $subject, User $actor): void
    {
        if ((int) $actor->getKey() === (int) $subject->getKey()) {
            return;
        }
        if (! $this->policy->manageRegistration($actor, $event)) {
            throw new EventRegistrationException('event_registration_authorization_denied');
        }
    }

    private function lockEligibleEvent(int $tenantId, int $eventId): Event
    {
        $event = $this->lockEvent($tenantId, $eventId);
        $this->assertEligibleEvent($event);

        return $event;
    }

    private function lockEvent(int $tenantId, int $eventId): Event
    {
        /** @var Event|null $event */
        $event = Event::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($eventId)
            ->lockForUpdate()
            ->first();
        if ($event === null) {
            throw new EventRegistrationException('event_registration_event_not_found');
        }
        return $event;
    }

    private function assertEligibleEvent(Event $event): void
    {
        $availability = EventRegistrationAvailability::evaluate($event);
        if ($availability === EventRegistrationAvailability::AVAILABLE) {
            return;
        }

        throw match ($availability) {
            EventRegistrationAvailability::CONCRETE_OCCURRENCE_REQUIRED =>
                new EventRegistrationException('event_registration_concrete_occurrence_required'),
            EventRegistrationAvailability::STARTED =>
                new EventRegistrationException('event_registration_event_started'),
            default => new EventRegistrationException('event_registration_event_unavailable'),
        };
    }

    /** @return array{0:User,1:User} */
    private function lockParticipants(int $tenantId, int $userId, User $actor): array
    {
        if ($userId <= 0 || (int) $actor->getKey() <= 0) {
            throw new EventRegistrationException('event_registration_subject_invalid');
        }
        /** @var User|null $subject */
        $subject = User::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($userId)
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->lockForUpdate()
            ->first();
        $persistedActor = $this->lockActor($tenantId, $actor);
        if ($subject === null) {
            throw new EventRegistrationException('event_registration_subject_not_found');
        }

        return [$subject, $persistedActor];
    }

    private function lockActor(int $tenantId, User $actor): User
    {
        // Auth is GLOBAL; only resources are tenant-scoped. The actor's own
        // row is re-read by authenticated id alone — a tenant predicate here
        // refused managers whose account row lives on another tenant, and it
        // refused them AFTER the controller had already authorised them, so
        // fixing only the outer lookup would have changed nothing. The
        // registration SUBJECT stays tenant-scoped in lockParticipants();
        // authority is decided by EventPolicy::manageRegistration in
        // assertActorAuthorized() against the tenant-scoped event.
        /** @var User|null $persistedActor */
        $persistedActor = User::withoutGlobalScopes()
            ->whereKey((int) $actor->getKey())
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->lockForUpdate()
            ->first();
        if ($persistedActor === null) {
            throw new EventRegistrationException('event_registration_actor_invalid');
        }

        return $persistedActor;
    }

    private function lockedRegistration(
        int $tenantId,
        int $eventId,
        int $userId,
        string $pool,
    ): ?EventRegistration {
        /** @var EventRegistration|null $registration */
        $registration = EventRegistration::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->where('capacity_pool_key', $pool)
            ->lockForUpdate()
            ->first();

        return $registration;
    }

    private function legacyStateLocked(
        int $tenantId,
        int $eventId,
        int $userId,
    ): ?EventCapacityRegistrationState {
        $status = DB::table('event_rsvps')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->lockForUpdate()
            ->value('status');

        return EventRegistrationCompatibility::registrationFromLegacy(
            is_string($status) ? $status : null,
        );
    }

    private function occupiedUserIdsLocked(
        int $tenantId,
        int $eventId,
        string $pool,
        ?int $excludeWaitlistEntryId,
    ): \Illuminate\Support\Collection {
        $canonical = DB::table('event_registrations')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('capacity_pool_key', $pool)
            ->where('registration_state', EventCapacityRegistrationState::Confirmed->value)
            ->lockForUpdate()
            ->pluck('user_id');
        $legacy = collect();
        $defaultPool = $this->capacityPool(null);
        if ((bool) config('events.registration.legacy_dual_read', true)
            && $pool === $defaultPool) {
            $legacy = DB::table('event_rsvps')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->whereIn('status', ['going', 'attended'])
                ->whereNotExists(function ($canonical) use (
                    $tenantId,
                    $eventId,
                    $defaultPool,
                ): void {
                    $canonical->selectRaw('1')
                        ->from('event_registrations as canonical_registration')
                        ->whereColumn('canonical_registration.user_id', 'event_rsvps.user_id')
                        ->where('canonical_registration.tenant_id', $tenantId)
                        ->where('canonical_registration.event_id', $eventId)
                        ->where('canonical_registration.capacity_pool_key', $defaultPool);
                })
                ->lockForUpdate()
                ->pluck('user_id');
        }
        $offers = DB::table('event_waitlist_entries')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('capacity_pool_key', $pool)
            ->where('queue_state', EventWaitlistQueueState::Offered->value)
            ->where('offer_expires_at', '>', now())
            ->when(
                $excludeWaitlistEntryId !== null,
                fn ($query) => $query->where('id', '!=', $excludeWaitlistEntryId),
            )
            ->lockForUpdate()
            ->pluck('user_id');

        return $canonical
            ->merge($legacy)
            ->merge($offers)
            ->map(static fn (mixed $id): int => (int) $id)
            ->filter(static fn (int $id): bool => $id > 0)
            ->unique()
            ->values();
    }

    private function writeLegacyRegistration(
        int $tenantId,
        int $eventId,
        int $userId,
        EventCapacityRegistrationState $state,
        Carbon $now,
    ): void {
        if (! (bool) config('events.registration.legacy_dual_write', true)) {
            return;
        }
        $legacy = DB::table('event_rsvps')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->lockForUpdate()
            ->first(['id', 'status']);
        if ($legacy !== null
            && in_array((string) $legacy->status, ['interested', 'maybe'], true)
            && in_array($state, [
                EventCapacityRegistrationState::Invited,
                EventCapacityRegistrationState::Pending,
            ], true)) {
            return;
        }

        $legacyState = EventRegistrationCompatibility::registrationToLegacy($state);
        if ($legacy === null) {
            DB::table('event_rsvps')->insert([
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'user_id' => $userId,
                'status' => $legacyState,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            return;
        }
        DB::table('event_rsvps')->where('id', (int) $legacy->id)->update([
            'status' => $legacyState,
            'updated_at' => $now,
        ]);
    }

    private function tenantId(): int
    {
        $tenantId = TenantContext::currentId();
        if ($tenantId === null || $tenantId <= 0) {
            throw new EventRegistrationException('event_registration_tenant_context_missing');
        }

        return $tenantId;
    }

    private function capacityPool(?string $pool): string
    {
        $default = trim((string) config(
            'events.registration.default_capacity_pool_key',
            EventRegistrationCompatibility::DEFAULT_CAPACITY_POOL,
        ));
        $pool = trim($pool ?? $default);
        if ($pool === '' || mb_strlen($pool) > 100
            || preg_match('/^[A-Za-z0-9._:-]+$/', $pool) !== 1
            || $pool !== $default) {
            throw new EventRegistrationException('event_registration_capacity_pool_invalid');
        }

        return $pool;
    }

    private function allocationKey(?string $allocation): ?string
    {
        if ($allocation === null || trim($allocation) === '') {
            return null;
        }
        $allocation = trim($allocation);
        if (! (bool) config('events.registration.allow_allocation_keys', false)
            || mb_strlen($allocation) > 191) {
            throw new EventRegistrationException('event_registration_allocation_key_unavailable');
        }

        return $allocation;
    }

    private function idempotencyKey(string $key, string $scope): string
    {
        $key = trim($key);
        if ($key === '' || mb_strlen($key) > 191) {
            throw new EventRegistrationException('event_registration_idempotency_key_invalid');
        }

        return hash('sha256', "event-registration:v1:{$scope}:{$key}");
    }

    private function compatibilityIdentity(
        ?string $requestKey,
        string $axis,
        int $version,
        ?string $from,
        string $target,
    ): string {
        if ($requestKey !== null) {
            $requestKey = trim($requestKey);
            if ($requestKey === '' || mb_strlen($requestKey) > 191) {
                throw new EventRegistrationException('event_registration_idempotency_key_invalid');
            }

            return "compatibility:v1:header:" . hash('sha256', $requestKey);
        }

        return implode(':', [
            'compatibility',
            'v1',
            $axis,
            (string) $version,
            $from ?? 'none',
            $target,
        ]);
    }

    private function reason(?string $reason): ?string
    {
        if ($reason === null || trim($reason) === '') {
            return null;
        }
        $reason = trim($reason);
        if (mb_strlen($reason) > self::MAX_REASON_LENGTH) {
            throw new EventRegistrationException('event_registration_reason_too_long');
        }

        return $reason;
    }

    private function stateTimestampColumn(EventCapacityRegistrationState $state): string
    {
        return $state->value . '_at';
    }

    private function outboxKey(int $tenantId, string $idempotencyKey): string
    {
        return "event-registration:{$tenantId}:{$idempotencyKey}";
    }

    private function outboxId(int $tenantId, string $key): ?int
    {
        $id = DB::table('event_domain_outbox')
            ->where('tenant_id', $tenantId)
            ->where('idempotency_key', $key)
            ->value('id');

        return is_numeric($id) ? (int) $id : null;
    }

    private function isUniqueConflict(QueryException $exception): bool
    {
        return in_array((string) ($exception->errorInfo[0] ?? ''), ['23000', '23505'], true);
    }
}
