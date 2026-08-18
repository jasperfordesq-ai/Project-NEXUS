<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Enums\EventCapacityRegistrationState;
use App\Enums\EventNotificationDeliveryMode;
use App\Enums\EventWaitlistQueueState;
use App\Exceptions\EventWaitlistException;
use App\Models\Event;
use App\Models\EventWaitlistEntry;
use App\Models\User;
use App\Policies\EventPolicy;
use App\Support\Events\EventRegistrationAvailability;
use App\Support\Events\EventRegistrationCompatibility;
use App\Support\Events\EventWaitlistTransitionResult;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/** Serialized canonical waitlist writer with expiring, single-use capacity offers. */
final class EventWaitlistService
{
    private const OUTBOX_ACTION_PREFIX = 'event.waitlist.';
    private const MAX_REASON_LENGTH = 4000;

    private readonly EventRegistrationService $registrations;
    private readonly EventDomainOutboxService $outbox;
    private readonly EventWaitlistOfferEnvelopeService $envelopes;
    private readonly EventParticipationEligibilityService $eligibility;
    private readonly EventPolicy $policy;
    private readonly EventReminderScheduleService $reminderSchedules;

    public function __construct(
        ?EventRegistrationService $registrations = null,
        ?EventDomainOutboxService $outbox = null,
        ?EventWaitlistOfferEnvelopeService $envelopes = null,
        ?EventParticipationEligibilityService $eligibility = null,
        ?EventPolicy $policy = null,
        ?EventReminderScheduleService $reminderSchedules = null,
    ) {
        $this->policy = $policy ?? app(EventPolicy::class);
        $this->eligibility = $eligibility ?? app(EventParticipationEligibilityService::class);
        $this->registrations = $registrations
            ?? new EventRegistrationService($outbox, $this->eligibility, $this->policy);
        $this->outbox = $outbox ?? new EventDomainOutboxService();
        $this->envelopes = $envelopes ?? new EventWaitlistOfferEnvelopeService();
        $this->reminderSchedules = $reminderSchedules ?? app(EventReminderScheduleService::class);
    }

    public function join(
        int $eventId,
        int $userId,
        User $actor,
        string $idempotencyKey,
        ?string $capacityPoolKey = null,
        ?string $allocationKey = null,
    ): EventWaitlistTransitionResult {
        $tenantId = $this->tenantId();
        if (! (bool) app(EventConfigurationService::class)->value('waitlist_enabled', true, $tenantId)) {
            throw new EventWaitlistException('event_waitlist_tenant_disabled');
        }
        $pool = $this->capacityPool($capacityPoolKey);
        $allocation = $this->allocationKey($allocationKey);
        $key = $this->idempotencyKey(
            $idempotencyKey,
            "join:{$tenantId}:{$eventId}:{$userId}:{$pool}",
        );

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $userId,
            $actor,
            $key,
            $pool,
            $allocation,
        ): EventWaitlistTransitionResult {
            $event = $this->lockEligibleEvent($tenantId, $eventId);
            [$subject, $persistedActor] = $this->lockParticipants($tenantId, $userId, $actor);
            $this->assertActorAuthorized($event, $subject, $persistedActor);
            $this->eligibility->assertCanParticipate(
                $event,
                $subject,
                'event_waitlist',
            );

            $replay = $this->replay(
                $tenantId,
                $eventId,
                $userId,
                $pool,
                EventWaitlistQueueState::Waiting,
                $key,
            );
            if ($replay !== null) {
                return $replay;
            }

            $entry = $this->lockedEntry($tenantId, $eventId, $userId, $pool);
            if ($entry !== null && in_array($entry->queue_state, [
                EventWaitlistQueueState::Waiting,
                EventWaitlistQueueState::Offered,
            ], true)) {
                return new EventWaitlistTransitionResult($entry, false, false, null, null);
            }

            $registrationState = $this->registrations->stateFor($eventId, $userId, $pool);
            if ($registrationState?->consumesCapacity()) {
                throw new EventWaitlistException('event_waitlist_registration_confirmed');
            }

            $legacy = $entry === null ? $this->legacyEntryLocked($tenantId, $eventId, $userId) : null;
            $legacyState = (bool) config('events.registration.legacy_dual_read', true)
                ? EventRegistrationCompatibility::waitlistFromLegacy(
                    is_object($legacy) && is_string($legacy->status) ? $legacy->status : null,
                )
                : null;
            $canonicalizing = $entry === null && $legacyState === EventWaitlistQueueState::Waiting;

            if (! $canonicalizing) {
                $available = $this->registrations->availableSlotsLocked($event, $pool);
                if ($available === null) {
                    throw new EventWaitlistException('event_waitlist_finite_capacity_required');
                }
                if ($available > 0) {
                    throw new EventWaitlistException('event_waitlist_capacity_available');
                }
            }

            $sequence = $canonicalizing
                ? $this->legacySequenceLocked($tenantId, $eventId, $pool, $legacy)
                : $this->nextSequenceLocked($tenantId, $eventId, $pool);
            $now = now();
            if ($entry === null) {
                $entry = $this->createWaitingEntry(
                    $tenantId,
                    $eventId,
                    (int) $subject->getKey(),
                    (int) $persistedActor->getKey(),
                    $pool,
                    $allocation,
                    $sequence,
                    $now,
                );
                $from = $legacyState;
                $action = $canonicalizing ? 'canonicalized' : 'joined';
                $version = 1;
            } else {
                $from = $entry->queue_state;
                if (! $from->canTransitionTo(EventWaitlistQueueState::Waiting)) {
                    throw new EventWaitlistException('event_waitlist_transition_invalid');
                }
                $version = (int) $entry->queue_version + 1;
                $entry->forceFill([
                    'allocation_key' => $allocation,
                    'queue_state' => EventWaitlistQueueState::Waiting->value,
                    'queue_version' => $version,
                    'queue_sequence' => $sequence,
                    'state_changed_at' => $now,
                    'state_changed_by' => (int) $persistedActor->getKey(),
                    'offered_at' => null,
                    'offer_expires_at' => null,
                    'offer_token_hash' => null,
                    'offer_token_used_at' => null,
                    'accepted_at' => null,
                    'accepted_registration_id' => null,
                    'expired_at' => null,
                    'cancelled_at' => null,
                ])->save();
                $action = 'rejoined';
            }

            return $this->recordMutation(
                $event,
                $entry,
                $persistedActor,
                $from,
                EventWaitlistQueueState::Waiting,
                $action,
                $key,
                $version,
                null,
                ['queue_sequence' => $sequence],
                $now,
            );
        }, 5);
    }

    public function withdraw(
        int $eventId,
        int $userId,
        User $actor,
        string $idempotencyKey,
        ?string $capacityPoolKey = null,
        ?string $reason = null,
    ): EventWaitlistTransitionResult {
        $tenantId = $this->tenantId();
        $pool = $this->capacityPool($capacityPoolKey);
        $reason = $this->reason($reason);
        $key = $this->idempotencyKey(
            $idempotencyKey,
            "withdraw:{$tenantId}:{$eventId}:{$userId}:{$pool}",
        );

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $userId,
            $actor,
            $key,
            $pool,
            $reason,
        ): EventWaitlistTransitionResult {
            $event = $this->lockEvent($tenantId, $eventId);
            [$subject, $persistedActor] = $this->lockParticipants($tenantId, $userId, $actor);
            $this->assertActorAuthorized($event, $subject, $persistedActor);
            $replay = $this->replay(
                $tenantId,
                $eventId,
                $userId,
                $pool,
                EventWaitlistQueueState::Cancelled,
                $key,
            );
            if ($replay !== null) {
                return $replay;
            }
            if ((int) $persistedActor->getKey() !== (int) $subject->getKey()
                && $reason === null) {
                throw new EventWaitlistException('event_registration_reason_required');
            }

            $entry = $this->lockedEntry($tenantId, $eventId, $userId, $pool);
            if ($entry === null) {
                throw new EventWaitlistException('event_waitlist_entry_not_found');
            }
            if ($entry->queue_state === EventWaitlistQueueState::Cancelled) {
                return new EventWaitlistTransitionResult($entry, false, false, null, null);
            }
            if (! in_array($entry->queue_state, [
                EventWaitlistQueueState::Waiting,
                EventWaitlistQueueState::Offered,
            ], true)) {
                throw new EventWaitlistException('event_waitlist_withdrawal_invalid');
            }

            $from = $entry->queue_state;
            $now = now();
            $version = (int) $entry->queue_version + 1;
            $entry->forceFill([
                'queue_state' => EventWaitlistQueueState::Cancelled->value,
                'queue_version' => $version,
                'state_changed_at' => $now,
                'state_changed_by' => (int) $persistedActor->getKey(),
                'cancelled_at' => $now,
            ])->save();

            $result = $this->recordMutation(
                $event,
                $entry,
                $persistedActor,
                $from,
                EventWaitlistQueueState::Cancelled,
                'withdrawn',
                $key,
                $version,
                $reason,
                [],
                $now,
            );

            if ($from !== EventWaitlistQueueState::Offered
                || ! $this->timedOffersEnabled()) {
                return $result;
            }

            $next = $this->offerNextWithinTransaction(
                $event,
                $pool,
                null,
                "withdraw-release:{$result->historyId}",
            );

            return new EventWaitlistTransitionResult(
                $result->entry,
                true,
                false,
                $result->historyId,
                $result->outboxId,
                null,
                null,
                $next?->entry,
                $next?->offerToken,
            );
        }, 5);
    }

    /** Legacy-route adapter with lock-derived idempotency and canonical facts. */
    public function joinCompatibility(
        int $eventId,
        int $userId,
        User $actor,
        ?string $requestKey = null,
    ): EventWaitlistTransitionResult {
        $tenantId = $this->tenantId();
        $pool = $this->capacityPool(null);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $userId,
            $actor,
            $requestKey,
            $pool,
        ): EventWaitlistTransitionResult {
            $this->lockEligibleEvent($tenantId, $eventId);
            $this->lockParticipants($tenantId, $userId, $actor);
            $entry = $this->lockedEntry($tenantId, $eventId, $userId, $pool);
            $legacy = $entry === null && (bool) config('events.registration.legacy_dual_read', true)
                ? $this->legacyEntryLocked($tenantId, $eventId, $userId)
                : null;
            $from = $entry?->queue_state
                ?? EventRegistrationCompatibility::waitlistFromLegacy(
                    is_object($legacy) && is_string($legacy->status) ? $legacy->status : null,
                );
            $version = $entry === null ? 0 : (int) $entry->queue_version;
            $identity = $this->compatibilityIdentity(
                $requestKey,
                'waitlist-join',
                $version,
                $from?->value,
                EventWaitlistQueueState::Waiting->value,
            );

            return $this->join($eventId, $userId, $actor, $identity, $pool);
        }, 5);
    }

    public function withdrawCompatibility(
        int $eventId,
        int $userId,
        User $actor,
        ?string $requestKey = null,
        ?string $reason = null,
    ): ?EventWaitlistTransitionResult {
        $tenantId = $this->tenantId();
        $pool = $this->capacityPool(null);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $userId,
            $actor,
            $requestKey,
            $reason,
            $pool,
        ): ?EventWaitlistTransitionResult {
            $this->lockEvent($tenantId, $eventId);
            $this->lockParticipants($tenantId, $userId, $actor);
            $entry = $this->lockedEntry($tenantId, $eventId, $userId, $pool);
            if ($entry === null && (bool) config('events.registration.legacy_dual_read', true)) {
                $legacy = $this->legacyEntryLocked($tenantId, $eventId, $userId);
                $legacyState = EventRegistrationCompatibility::waitlistFromLegacy(
                    is_object($legacy) && is_string($legacy->status) ? $legacy->status : null,
                );
                if ($legacyState === EventWaitlistQueueState::Waiting) {
                    $bootstrapKey = $this->compatibilityIdentity(
                        $requestKey,
                        'waitlist-bootstrap',
                        0,
                        $legacyState->value,
                        EventWaitlistQueueState::Waiting->value,
                    );
                    $this->join($eventId, $userId, $actor, $bootstrapKey, $pool);
                    $entry = $this->lockedEntry($tenantId, $eventId, $userId, $pool);
                }
            }
            if ($entry === null || ! in_array($entry->queue_state, [
                EventWaitlistQueueState::Waiting,
                EventWaitlistQueueState::Offered,
                EventWaitlistQueueState::Cancelled,
            ], true)) {
                return null;
            }
            $identity = $this->compatibilityIdentity(
                $requestKey,
                'waitlist-withdraw',
                (int) $entry->queue_version,
                $entry->queue_state->value,
                EventWaitlistQueueState::Cancelled->value,
            );

            return $this->withdraw(
                $eventId,
                $userId,
                $actor,
                $identity,
                $pool,
                $reason,
            );
        }, 5);
    }

    public function offerNext(
        int $eventId,
        ?User $actor,
        string $idempotencyKey,
        ?string $capacityPoolKey = null,
    ): ?EventWaitlistTransitionResult {
        $tenantId = $this->tenantId();
        $pool = $this->capacityPool($capacityPoolKey);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $actor,
            $idempotencyKey,
            $pool,
        ): ?EventWaitlistTransitionResult {
            $event = $this->lockEligibleEvent($tenantId, $eventId);
            $persistedActor = $actor === null ? null : $this->lockActor($tenantId, $actor);
            if ($persistedActor === null
                || ! $this->policy->manageRegistration($persistedActor, $event)) {
                throw new EventWaitlistException('event_registration_authorization_denied');
            }

            return $this->offerNextWithinTransaction(
                $event,
                $pool,
                $persistedActor,
                $idempotencyKey,
            );
        }, 5);
    }

    /** Caller must hold the Event row lock in the current transaction. */
    public function offerNextWithinTransaction(
        Event $event,
        string $capacityPoolKey,
        ?User $actor,
        string $idempotencyKey,
    ): ?EventWaitlistTransitionResult {
        if (DB::transactionLevel() <= 0) {
            throw new EventWaitlistException('event_waitlist_transaction_required');
        }
        if (! $this->timedOffersEnabled()) {
            throw new EventWaitlistException('event_waitlist_timed_offers_disabled');
        }

        $tenantId = $this->tenantId();
        $eventId = (int) $event->getKey();
        $pool = $this->capacityPool($capacityPoolKey);
        if ((int) $event->tenant_id !== $tenantId || $eventId <= 0) {
            throw new EventWaitlistException('event_waitlist_event_scope_invalid');
        }
        $this->assertEligibleEvent($event);
        $persistedActor = $actor === null ? null : $this->lockActor($tenantId, $actor);
        if ($persistedActor !== null
            && ! $this->policy->manageRegistration($persistedActor, $event)) {
            throw new EventWaitlistException('event_registration_authorization_denied');
        }
        $key = $this->idempotencyKey(
            $idempotencyKey,
            "offer:{$tenantId}:{$eventId}:{$pool}",
        );

        $history = DB::table('event_waitlist_entry_history')
            ->where('tenant_id', $tenantId)
            ->where('idempotency_key', $key)
            ->lockForUpdate()
            ->first();
        if ($history !== null) {
            if ((int) $history->event_id !== $eventId
                || (string) $history->capacity_pool_key !== $pool
                || (string) $history->to_state !== EventWaitlistQueueState::Offered->value) {
                throw new EventWaitlistException('event_waitlist_idempotency_conflict');
            }
            $entry = EventWaitlistEntry::withoutGlobalScopes()
                ->whereKey((int) $history->waitlist_entry_id)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();
            if ($entry === null
                || $entry->queue_state !== EventWaitlistQueueState::Offered
                || (int) $entry->queue_version !== (int) $history->queue_version) {
                throw new EventWaitlistException('event_waitlist_idempotency_conflict');
            }

            // Plaintext is intentionally unrecoverable after the first response.
            return new EventWaitlistTransitionResult(
                $entry,
                false,
                true,
                (int) $history->id,
                $this->outboxId($tenantId, $this->outboxKey($tenantId, $key)),
            );
        }

        $available = $this->registrations->availableSlotsLocked($event, $pool);
        if ($available === null) {
            throw new EventWaitlistException('event_waitlist_finite_capacity_required');
        }
        if ($available < 1) {
            return null;
        }

        /** @var EventWaitlistEntry|null $entry */
        $entry = EventWaitlistEntry::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('capacity_pool_key', $pool)
            ->where('queue_state', EventWaitlistQueueState::Waiting->value)
            ->orderBy('queue_sequence')
            ->orderBy('id')
            ->lockForUpdate()
            ->first();
        if ($entry === null) {
            return null;
        }

        $token = bin2hex(random_bytes(32));
        $now = now();
        $expiresAt = $now->copy()->addMinutes($this->offerTtlMinutes());
        $version = (int) $entry->queue_version + 1;
        $entry->forceFill([
            'queue_state' => EventWaitlistQueueState::Offered->value,
            'queue_version' => $version,
            'state_changed_at' => $now,
            'state_changed_by' => $persistedActor?->getKey(),
            'offered_at' => $now,
            'offer_expires_at' => $expiresAt,
            'offer_token_hash' => hash('sha256', $token),
            'offer_token_used_at' => null,
            'accepted_at' => null,
            'accepted_registration_id' => null,
            'expired_at' => null,
            'cancelled_at' => null,
        ])->save();

        $result = $this->recordMutation(
            $event,
            $entry,
            $persistedActor,
            EventWaitlistQueueState::Waiting,
            EventWaitlistQueueState::Offered,
            'offered',
            $key,
            $version,
            null,
            [
                'offered_at' => $now->toIso8601String(),
                'offer_expires_at' => $expiresAt->toIso8601String(),
            ],
            $now,
            $token,
        );

        return new EventWaitlistTransitionResult(
            $result->entry,
            true,
            false,
            $result->historyId,
            $result->outboxId,
            $token,
        );
    }

    public function acceptOffer(
        int $eventId,
        int $userId,
        string $offerToken,
        User $actor,
        string $idempotencyKey,
        ?string $capacityPoolKey = null,
    ): EventWaitlistTransitionResult {
        if ((int) $actor->getKey() !== $userId) {
            throw new EventWaitlistException('event_waitlist_offer_self_acceptance_required');
        }
        $tenantId = $this->tenantId();
        $pool = $this->capacityPool($capacityPoolKey);
        $offerToken = trim($offerToken);
        if ($offerToken === '' || mb_strlen($offerToken) > 512) {
            throw new EventWaitlistException('event_waitlist_offer_token_invalid');
        }
        return $this->acceptOfferInternal(
            $tenantId,
            $eventId,
            $userId,
            $offerToken,
            $actor,
            $idempotencyKey,
            $pool,
            false,
        );
    }

    /**
     * Accept the authenticated member's active offer from in-app state.
     *
     * The plaintext token may be unavailable when email delivery is disabled;
     * only the exact offer subject may use this path.
     */
    public function acceptActiveOffer(
        int $eventId,
        int $userId,
        User $actor,
        string $idempotencyKey,
        ?string $capacityPoolKey = null,
    ): EventWaitlistTransitionResult {
        if ((int) $actor->getKey() !== $userId) {
            throw new EventWaitlistException('event_waitlist_offer_self_acceptance_required');
        }
        $tenantId = $this->tenantId();
        $pool = $this->capacityPool($capacityPoolKey);

        return $this->acceptOfferInternal(
            $tenantId,
            $eventId,
            $userId,
            null,
            $actor,
            $idempotencyKey,
            $pool,
            true,
        );
    }

    private function acceptOfferInternal(
        int $tenantId,
        int $eventId,
        int $userId,
        ?string $offerToken,
        User $actor,
        string $idempotencyKey,
        string $pool,
        bool $authenticatedSelf,
    ): EventWaitlistTransitionResult {
        $key = $this->idempotencyKey(
            $idempotencyKey,
            "accept:{$tenantId}:{$eventId}:{$userId}:{$pool}",
        );

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $userId,
            $offerToken,
            $actor,
            $key,
            $pool,
            $authenticatedSelf,
        ): EventWaitlistTransitionResult {
            $event = $this->lockEligibleEvent($tenantId, $eventId);
            [$subject, $persistedActor] = $this->lockParticipants($tenantId, $userId, $actor);
            $this->assertActorAuthorized($event, $subject, $persistedActor);
            if ($authenticatedSelf && (int) $persistedActor->getKey() !== $userId) {
                throw new EventWaitlistException('event_waitlist_offer_self_acceptance_required');
            }
            $replay = $this->replay(
                $tenantId,
                $eventId,
                $userId,
                $pool,
                EventWaitlistQueueState::Accepted,
                $key,
            );
            if ($replay !== null) {
                return $replay;
            }

            $entry = $this->lockedEntry($tenantId, $eventId, $userId, $pool);
            if ($entry === null || $entry->queue_state !== EventWaitlistQueueState::Offered) {
                throw new EventWaitlistException('event_waitlist_offer_not_active');
            }
            $expiresAt = $this->carbon($entry->getRawOriginal('offer_expires_at'));
            if ($expiresAt === null || ! $expiresAt->isFuture()) {
                throw new EventWaitlistException('event_waitlist_offer_expired');
            }
            $storedHash = $entry->getRawOriginal('offer_token_hash');
            if (! is_string($storedHash)
                || strlen($storedHash) !== 64
                || $entry->getRawOriginal('offer_token_used_at') !== null) {
                throw new EventWaitlistException('event_waitlist_offer_token_invalid');
            }
            if ($offerToken !== null
                && ! hash_equals($storedHash, hash('sha256', $offerToken))) {
                throw new EventWaitlistException('event_waitlist_offer_token_invalid');
            }

            $registration = $this->registrations->confirmFromWaitlistLocked(
                $event,
                $entry,
                $persistedActor,
                "waitlist-accept:{$key}",
            );
            $now = now();
            $version = (int) $entry->queue_version + 1;
            $entry->forceFill([
                'queue_state' => EventWaitlistQueueState::Accepted->value,
                'queue_version' => $version,
                'state_changed_at' => $now,
                'state_changed_by' => (int) $persistedActor->getKey(),
                'offer_token_used_at' => $now,
                'accepted_at' => $now,
                'accepted_registration_id' => (int) $registration->registration->getKey(),
            ])->save();

            $result = $this->recordMutation(
                $event,
                $entry,
                $persistedActor,
                EventWaitlistQueueState::Offered,
                EventWaitlistQueueState::Accepted,
                'accepted',
                $key,
                $version,
                null,
                ['registration_id' => (int) $registration->registration->getKey()],
                $now,
            );

            return new EventWaitlistTransitionResult(
                $result->entry,
                true,
                false,
                $result->historyId,
                $result->outboxId,
                null,
                $registration->registration,
            );
        }, 5);
    }

    /**
     * Expire due offers exactly once and advance one queue place per released offer.
     *
     * @return list<EventWaitlistTransitionResult>
     */
    public function expireDueForEvent(
        int $eventId,
        ?User $actor = null,
        int $limit = 100,
        ?Carbon $now = null,
        ?string $capacityPoolKey = null,
    ): array {
        $tenantId = $this->tenantId();
        $pool = $this->capacityPool($capacityPoolKey);
        $limit = max(1, min($limit, 1000));
        $now ??= now();

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $actor,
            $limit,
            $now,
            $pool,
        ): array {
            $event = $this->lockEvent($tenantId, $eventId);
            $persistedActor = $actor === null ? null : $this->lockActor($tenantId, $actor);
            if ($persistedActor !== null
                && ! $this->policy->manageRegistration($persistedActor, $event)) {
                throw new EventWaitlistException('event_registration_authorization_denied');
            }
            /** @var list<EventWaitlistEntry> $entries */
            $entries = EventWaitlistEntry::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('capacity_pool_key', $pool)
                ->where('queue_state', EventWaitlistQueueState::Offered->value)
                ->whereNotNull('offer_expires_at')
                ->where('offer_expires_at', '<=', $now)
                ->orderBy('offer_expires_at')
                ->orderBy('queue_sequence')
                ->orderBy('id')
                ->limit($limit)
                ->lockForUpdate()
                ->get()
                ->all();

            $results = [];
            foreach ($entries as $entry) {
                // The locked query and state transition make expiry single-shot.
                if ($entry->queue_state !== EventWaitlistQueueState::Offered) {
                    continue;
                }
                $version = (int) $entry->queue_version + 1;
                $key = $this->idempotencyKey(
                    'automatic-expiry',
                    "expire:{$tenantId}:{$eventId}:{$entry->getKey()}:{$version}",
                );
                $entry->forceFill([
                    'queue_state' => EventWaitlistQueueState::Expired->value,
                    'queue_version' => $version,
                    'state_changed_at' => $now,
                    'state_changed_by' => $persistedActor?->getKey(),
                    'expired_at' => $now,
                ])->save();
                $result = $this->recordMutation(
                    $event,
                    $entry,
                    $persistedActor,
                    EventWaitlistQueueState::Offered,
                    EventWaitlistQueueState::Expired,
                    'expired',
                    $key,
                    $version,
                    null,
                    ['offer_expires_at' => $entry->offer_expires_at?->toIso8601String()],
                    $now,
                );

                $next = EventRegistrationAvailability::isRegistrable($event)
                    && $this->timedOffersEnabled()
                    ? $this->offerNextWithinTransaction(
                        $event,
                        $pool,
                        $persistedActor,
                        "expiry-release:{$result->historyId}",
                    )
                    : null;
                $results[] = new EventWaitlistTransitionResult(
                    $result->entry,
                    true,
                    false,
                    $result->historyId,
                    $result->outboxId,
                    null,
                    null,
                    $next?->entry,
                    $next?->offerToken,
                );
            }

            return $results;
        }, 5);
    }

    /**
     * Cancel every active canonical queue fact during a terminal lifecycle
     * transition. The caller owns the Event row lock and surrounding transaction.
     *
     * @return array{cancelled:int,recipient_user_ids:list<int>}
     */
    public function cancelActiveForLifecycleWithinTransaction(
        Event $event,
        User $actor,
        string $reason,
        string $idempotencyPrefix,
    ): array {
        if (DB::transactionLevel() <= 0) {
            throw new EventWaitlistException('event_waitlist_transaction_required');
        }
        $tenantId = $this->tenantId();
        $eventId = (int) $event->getKey();
        $reason = $this->reason($reason);
        if ((int) $event->tenant_id !== $tenantId || $eventId <= 0) {
            throw new EventWaitlistException('event_waitlist_event_scope_invalid');
        }
        if ($reason === null) {
            throw new EventWaitlistException('event_registration_reason_required');
        }
        $persistedActor = $this->lockActor($tenantId, $actor);
        if (! $this->policy->manageRegistration($persistedActor, $event)) {
            throw new EventWaitlistException('event_registration_authorization_denied');
        }

        /** @var list<EventWaitlistEntry> $entries */
        $entries = EventWaitlistEntry::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->whereIn('queue_state', [
                EventWaitlistQueueState::Waiting->value,
                EventWaitlistQueueState::Offered->value,
            ])
            ->orderBy('id')
            ->lockForUpdate()
            ->get()
            ->all();

        $cancelled = 0;
        $recipientIds = [];
        foreach ($entries as $entry) {
            $from = $entry->queue_state;
            $now = now();
            $nextVersion = (int) $entry->queue_version + 1;
            $key = $this->idempotencyKey(
                "{$idempotencyPrefix}:waitlist:{$entry->getKey()}:v{$nextVersion}",
                "lifecycle-cancel:{$tenantId}:{$eventId}:{$entry->getKey()}",
            );
            $entry->forceFill([
                'queue_state' => EventWaitlistQueueState::Cancelled->value,
                'queue_version' => $nextVersion,
                'state_changed_at' => $now,
                'state_changed_by' => (int) $persistedActor->getKey(),
                'offer_token_hash' => null,
                'offer_token_used_at' => $from === EventWaitlistQueueState::Offered
                    ? $now
                    : $entry->offer_token_used_at,
                'cancelled_at' => $now,
            ])->save();
            $result = $this->recordMutation(
                $event,
                $entry,
                $persistedActor,
                $from,
                EventWaitlistQueueState::Cancelled,
                'cancelled',
                $key,
                $nextVersion,
                $reason,
                ['source' => 'event_lifecycle_service'],
                $now,
            );
            if ($result->changed) {
                $cancelled++;
                $recipientIds[] = (int) $entry->user_id;
            }
        }

        return [
            'cancelled' => $cancelled,
            'recipient_user_ids' => array_values(array_unique($recipientIds)),
        ];
    }

    /** Canonical-first read during the legacy compatibility window. */
    public function stateFor(
        int $eventId,
        int $userId,
        ?string $capacityPoolKey = null,
    ): ?EventWaitlistQueueState {
        $tenantId = $this->tenantId();
        $pool = $this->capacityPool($capacityPoolKey);
        /** @var EventWaitlistEntry|null $entry */
        $entry = EventWaitlistEntry::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->where('capacity_pool_key', $pool)
            ->first();
        if ($entry !== null) {
            return $entry->queue_state;
        }
        if (! (bool) config('events.registration.legacy_dual_read', true)) {
            return null;
        }
        $legacy = DB::table('event_waitlist')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->value('status');

        return EventRegistrationCompatibility::waitlistFromLegacy(
            is_string($legacy) ? $legacy : null,
        );
    }

    private function createWaitingEntry(
        int $tenantId,
        int $eventId,
        int $userId,
        int $actorId,
        string $pool,
        ?string $allocation,
        int $sequence,
        Carbon $now,
    ): EventWaitlistEntry {
        try {
            $id = (int) DB::table('event_waitlist_entries')->insertGetId([
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'user_id' => $userId,
                'capacity_pool_key' => $pool,
                'allocation_key' => $allocation,
                'queue_state' => EventWaitlistQueueState::Waiting->value,
                'queue_version' => 1,
                'queue_sequence' => $sequence,
                'state_changed_at' => $now,
                'state_changed_by' => $actorId,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        } catch (QueryException $exception) {
            if ($this->isUniqueConflict($exception)) {
                throw new EventWaitlistException('event_waitlist_concurrent_conflict');
            }
            throw $exception;
        }

        /** @var EventWaitlistEntry $entry */
        $entry = EventWaitlistEntry::withoutGlobalScopes()
            ->whereKey($id)
            ->lockForUpdate()
            ->firstOrFail();

        return $entry;
    }

    private function recordMutation(
        Event $event,
        EventWaitlistEntry $entry,
        ?User $actor,
        ?EventWaitlistQueueState $from,
        EventWaitlistQueueState $to,
        string $action,
        string $idempotencyKey,
        int $version,
        ?string $reason,
        array $metadata,
        Carbon $now,
        ?string $offerToken = null,
    ): EventWaitlistTransitionResult {
        $tenantId = (int) $entry->tenant_id;
        $eventId = (int) $entry->event_id;
        if ((int) $event->getKey() !== $eventId || (int) $event->tenant_id !== $tenantId) {
            throw new EventWaitlistException('event_waitlist_event_scope_invalid');
        }
        try {
            $historyId = (int) DB::table('event_waitlist_entry_history')->insertGetId([
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'waitlist_entry_id' => (int) $entry->getKey(),
                'user_id' => (int) $entry->user_id,
                'actor_user_id' => $actor?->getKey(),
                'capacity_pool_key' => (string) $entry->capacity_pool_key,
                'allocation_key' => $entry->allocation_key,
                'queue_version' => $version,
                'queue_sequence' => (int) $entry->queue_sequence,
                'action' => $action,
                'from_state' => $from?->value,
                'to_state' => $to->value,
                'idempotency_key' => $idempotencyKey,
                'reason' => $reason,
                'metadata' => json_encode(array_merge([
                    'schema_version' => 1,
                    'source' => 'event_waitlist_service',
                ], $metadata), JSON_THROW_ON_ERROR),
                'created_at' => $now,
            ]);
        } catch (QueryException $exception) {
            if ($this->isUniqueConflict($exception)) {
                throw new EventWaitlistException('event_waitlist_idempotency_conflict');
            }
            throw $exception;
        }

        $this->writeLegacyWaitlist($entry, $to, $now);
        $outboxKey = $this->outboxKey($tenantId, $idempotencyKey);
        $domainAction = self::OUTBOX_ACTION_PREFIX . $action;
        $outbox = $this->outbox->record(
            $tenantId,
            $eventId,
            $version,
            $domainAction,
            $outboxKey,
            [
                'schema_version' => 1,
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'waitlist_entry_id' => (int) $entry->getKey(),
                'user_id' => (int) $entry->user_id,
                'actor_user_id' => $actor?->getKey(),
                'capacity_pool_key' => (string) $entry->capacity_pool_key,
                'allocation_key' => $entry->allocation_key,
                'queue_version' => $version,
                'queue_sequence' => (int) $entry->queue_sequence,
                'from_state' => $from?->value,
                'to_state' => $to->value,
                'reason' => $reason,
                'occurred_at' => $now->toIso8601String(),
            ],
        );
        if ($to === EventWaitlistQueueState::Offered) {
            if ($offerToken === null || $offerToken === '') {
                throw new EventWaitlistException('event_waitlist_offer_envelope_unavailable');
            }
            $this->envelopes->seal(
                $entry,
                (int) $outbox['id'],
                $domainAction,
                $offerToken,
            );
        } elseif (in_array($to, [
            EventWaitlistQueueState::Accepted,
            EventWaitlistQueueState::Expired,
            EventWaitlistQueueState::Cancelled,
        ], true)) {
            $this->envelopes->eraseForTerminalEntry($entry, $to, $now);
        }
        if (in_array($to, [
            EventWaitlistQueueState::Expired,
            EventWaitlistQueueState::Cancelled,
        ], true)) {
            $this->reminderSchedules->cancelForRegistrationExit(
                $eventId,
                (int) $entry->user_id,
                'waitlist_' . $to->value,
            );
        }
        $entry->refresh();

        return new EventWaitlistTransitionResult(
            $entry,
            true,
            false,
            $historyId,
            (int) $outbox['id'],
        );
    }

    private function replay(
        int $tenantId,
        int $eventId,
        int $userId,
        string $pool,
        EventWaitlistQueueState $target,
        string $idempotencyKey,
    ): ?EventWaitlistTransitionResult {
        $history = DB::table('event_waitlist_entry_history')
            ->where('tenant_id', $tenantId)
            ->where('idempotency_key', $idempotencyKey)
            ->lockForUpdate()
            ->first();
        if ($history === null) {
            return null;
        }
        if ((int) $history->event_id !== $eventId
            || (int) $history->user_id !== $userId
            || (string) $history->capacity_pool_key !== $pool
            || (string) $history->to_state !== $target->value) {
            throw new EventWaitlistException('event_waitlist_idempotency_conflict');
        }
        /** @var EventWaitlistEntry|null $entry */
        $entry = EventWaitlistEntry::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey((int) $history->waitlist_entry_id)
            ->lockForUpdate()
            ->first();
        if ($entry === null
            || $entry->queue_state !== $target
            || (int) $entry->queue_version !== (int) $history->queue_version) {
            throw new EventWaitlistException('event_waitlist_idempotency_conflict');
        }
        if (in_array($target, [
            EventWaitlistQueueState::Expired,
            EventWaitlistQueueState::Cancelled,
        ], true)) {
            $this->reminderSchedules->cancelForRegistrationExit(
                $eventId,
                $userId,
                'waitlist_' . $target->value,
            );
        }

        return new EventWaitlistTransitionResult(
            $entry,
            false,
            true,
            (int) $history->id,
            $this->outboxId($tenantId, $this->outboxKey($tenantId, $idempotencyKey)),
            null,
            $target === EventWaitlistQueueState::Accepted
                ? $entry->acceptedRegistration()->withoutGlobalScopes()->first()
                : null,
        );
    }

    private function writeLegacyWaitlist(
        EventWaitlistEntry $entry,
        EventWaitlistQueueState $state,
        Carbon $now,
    ): void {
        if (! (bool) config('events.registration.legacy_dual_write', true)) {
            return;
        }
        $legacy = $this->legacyEntryLocked(
            (int) $entry->tenant_id,
            (int) $entry->event_id,
            (int) $entry->user_id,
        );
        $values = [
            'position' => (int) $entry->queue_sequence,
            'status' => EventRegistrationCompatibility::waitlistToLegacy($state),
            'updated_at' => $now,
            'promoted_at' => null,
            'cancelled_at' => null,
        ];
        if ($state === EventWaitlistQueueState::Accepted) {
            $values['promoted_at'] = $now;
        }
        if ($state === EventWaitlistQueueState::Cancelled) {
            $values['cancelled_at'] = $now;
        }
        if ($legacy === null) {
            DB::table('event_waitlist')->insert(array_merge($values, [
                'tenant_id' => (int) $entry->tenant_id,
                'event_id' => (int) $entry->event_id,
                'user_id' => (int) $entry->user_id,
                'created_at' => $now,
            ]));
            return;
        }
        DB::table('event_waitlist')->where('id', (int) $legacy->id)->update($values);
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
            throw new EventWaitlistException('event_waitlist_event_not_found');
        }
        return $event;
    }

    private function assertActorAuthorized(Event $event, User $subject, User $actor): void
    {
        if ((int) $actor->getKey() === (int) $subject->getKey()) {
            return;
        }
        if (! $this->policy->manageRegistration($actor, $event)) {
            throw new EventWaitlistException('event_registration_authorization_denied');
        }
    }

    private function assertEligibleEvent(Event $event): void
    {
        $availability = EventRegistrationAvailability::evaluate($event);
        if ($availability === EventRegistrationAvailability::AVAILABLE) {
            return;
        }

        throw match ($availability) {
            EventRegistrationAvailability::CONCRETE_OCCURRENCE_REQUIRED =>
                new EventWaitlistException('event_waitlist_concrete_occurrence_required'),
            EventRegistrationAvailability::STARTED =>
                new EventWaitlistException('event_waitlist_event_started'),
            default => new EventWaitlistException('event_waitlist_event_unavailable'),
        };
    }

    /** @return array{0:User,1:User} */
    private function lockParticipants(int $tenantId, int $userId, User $actor): array
    {
        if ($userId <= 0 || (int) $actor->getKey() <= 0) {
            throw new EventWaitlistException('event_waitlist_subject_invalid');
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
            throw new EventWaitlistException('event_waitlist_subject_not_found');
        }

        return [$subject, $persistedActor];
    }

    private function lockActor(int $tenantId, User $actor): User
    {
        // The actor's own row — never tenant-scoped (see
        // EventRegistrationService::lockActor()). The waitlist SUBJECT stays
        // tenant-scoped in lockParticipants().
        /** @var User|null $persistedActor */
        $persistedActor = User::withoutGlobalScopes()
            ->whereKey((int) $actor->getKey())
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->lockForUpdate()
            ->first();
        if ($persistedActor === null) {
            throw new EventWaitlistException('event_waitlist_actor_not_found');
        }

        return $persistedActor;
    }

    private function lockedEntry(
        int $tenantId,
        int $eventId,
        int $userId,
        string $pool,
    ): ?EventWaitlistEntry {
        /** @var EventWaitlistEntry|null $entry */
        $entry = EventWaitlistEntry::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->where('capacity_pool_key', $pool)
            ->lockForUpdate()
            ->first();

        return $entry;
    }

    private function legacyEntryLocked(int $tenantId, int $eventId, int $userId): ?object
    {
        if (! (bool) config('events.registration.legacy_dual_read', true)
            && ! (bool) config('events.registration.legacy_dual_write', true)) {
            return null;
        }

        return DB::table('event_waitlist')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->lockForUpdate()
            ->first();
    }

    private function nextSequenceLocked(int $tenantId, int $eventId, string $pool): int
    {
        $canonicalMax = DB::table('event_waitlist_entries')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('capacity_pool_key', $pool)
            ->max('queue_sequence');
        $legacyMax = (bool) config('events.registration.legacy_dual_read', true)
            ? DB::table('event_waitlist')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->max('position')
            : null;

        return max((int) $canonicalMax, (int) $legacyMax) + 1;
    }

    private function legacySequenceLocked(
        int $tenantId,
        int $eventId,
        string $pool,
        ?object $legacy,
    ): int {
        $position = is_numeric($legacy->position ?? null) ? (int) $legacy->position : 0;
        if ($position > 0) {
            $alreadyUsed = DB::table('event_waitlist_entries')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('capacity_pool_key', $pool)
                ->where('queue_sequence', $position)
                ->exists();
            if (! $alreadyUsed) {
                return $position;
            }
        }

        return $this->nextSequenceLocked($tenantId, $eventId, $pool);
    }

    private function tenantId(): int
    {
        $tenantId = TenantContext::currentId();
        if ($tenantId === null || $tenantId <= 0) {
            throw new EventWaitlistException('event_waitlist_tenant_context_missing');
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
            throw new EventWaitlistException('event_waitlist_capacity_pool_invalid');
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
            throw new EventWaitlistException('event_waitlist_allocation_key_unavailable');
        }

        return $allocation;
    }

    private function idempotencyKey(string $key, string $scope): string
    {
        $key = trim($key);
        if ($key === '' || mb_strlen($key) > 191) {
            throw new EventWaitlistException('event_waitlist_idempotency_key_invalid');
        }

        return hash('sha256', "event-waitlist:v1:{$scope}:{$key}");
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
                throw new EventWaitlistException('event_waitlist_idempotency_key_invalid');
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
            throw new EventWaitlistException('event_waitlist_reason_too_long');
        }

        return $reason;
    }

    public function timedOffersEnabled(): bool
    {
        if (! (bool) config('events.registration.timed_waitlist_offers_enabled', false)) {
            return false;
        }
        if (! (bool) app(EventConfigurationService::class)->value(
            'timed_waitlist_offers_enabled',
            false,
            $this->tenantId(),
        )) {
            return false;
        }

        try {
            $mode = EventNotificationDeliveryModeResolver::resolve($this->tenantId());
            if ($mode !== EventNotificationDeliveryMode::OutboxAuthoritative
                || ! EventNotificationDeliveryModeResolver::consumerEnabled()) {
                return false;
            }
            $configuredChannels = config('events.notification_delivery.channels');
            if (! is_array($configuredChannels)) {
                return false;
            }
            $validatedChannels = array_values(array_intersect(
                ['email', 'in_app', 'push'],
                $configuredChannels,
            ));
            if (! in_array('in_app', $validatedChannels, true)) {
                return false;
            }
            $this->envelopes->assertCryptoAvailable();
        } catch (\Throwable $exception) {
            Log::critical('Timed event waitlist offers failed their readiness check', [
                'tenant_id' => TenantContext::currentId(),
                'error_type' => $exception::class,
                'reason_code' => $exception instanceof EventWaitlistException
                    ? $exception->reasonCode
                    : 'event_waitlist_readiness_failed',
            ]);

            return false;
        }

        return true;
    }

    private function offerTtlMinutes(): int
    {
        $minutes = (int) config('events.registration.offer_ttl_minutes', 15);
        if ($minutes < 1 || $minutes > 10080) {
            throw new EventWaitlistException('event_waitlist_offer_ttl_invalid');
        }

        return $minutes;
    }

    private function outboxKey(int $tenantId, string $idempotencyKey): string
    {
        return "event-waitlist:{$tenantId}:{$idempotencyKey}";
    }

    private function outboxId(int $tenantId, string $key): ?int
    {
        $id = DB::table('event_domain_outbox')
            ->where('tenant_id', $tenantId)
            ->where('idempotency_key', $key)
            ->value('id');

        return is_numeric($id) ? (int) $id : null;
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
}
