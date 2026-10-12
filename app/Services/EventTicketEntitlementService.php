<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Enums\EventTicketEntitlementStatus;
use App\Enums\EventTicketKind;
use App\Enums\EventTicketTypeStatus;
use App\Exceptions\EventTicketingException;
use App\Models\Event;
use App\Models\EventTicketEntitlement;
use App\Models\User;
use App\Policies\EventPolicy;
use App\Support\Events\EventTicketEligibilityPolicy;
use App\Support\Events\EventTicketingSupport;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use stdClass;

/** Serialized free-ticket allocation and exactly-once cancellation boundary. */
final class EventTicketEntitlementService
{
    public function __construct(
        private readonly EventTicketingSupport $support = new EventTicketingSupport(),
        private readonly EventTicketEligibilityPolicy $eligibility = new EventTicketEligibilityPolicy(),
        private readonly EventPolicy $policy = new EventPolicy(),
    ) {
    }

    /** @return array{entitlement:EventTicketEntitlement,changed:bool,confirmed_units_after:int} */
    public function allocateSelf(
        int $eventId,
        int $ticketTypeId,
        int $registrationId,
        User|int $member,
        int $units,
        string $idempotencyKey,
    ): array {
        return $this->allocate(
            $eventId,
            $ticketTypeId,
            $registrationId,
            $member,
            $member,
            $units,
            $idempotencyKey,
            false,
        );
    }

    /** @return array{entitlement:EventTicketEntitlement,changed:bool,confirmed_units_after:int} */
    public function allocateForMember(
        int $eventId,
        int $ticketTypeId,
        int $registrationId,
        int $targetUserId,
        User|int $actor,
        int $units,
        string $idempotencyKey,
    ): array {
        return $this->allocate(
            $eventId,
            $ticketTypeId,
            $registrationId,
            $targetUserId,
            $actor,
            $units,
            $idempotencyKey,
            true,
        );
    }

    /** @return array{entitlement:EventTicketEntitlement,changed:bool,confirmed_units_after:int} */
    private function allocate(
        int $eventId,
        int $ticketTypeId,
        int $registrationId,
        User|int $target,
        User|int $actor,
        int $units,
        string $idempotencyKey,
        bool $organizerOperation,
    ): array {
        $this->assertSchema();
        if ($units < 1 || $units > 1000) {
            throw new EventTicketingException('event_ticket_units_invalid');
        }
        $tenantId = $this->support->tenantId();
        $keyHash = $this->support->idempotencyHash($idempotencyKey);
        $targetId = $target instanceof User ? (int) $target->getKey() : $target;
        $actorId = $actor instanceof User ? (int) $actor->getKey() : $actor;
        $requestHash = $this->support->requestHash([
            'action' => 'allocated',
            'mode' => $organizerOperation ? 'organizer' : 'self',
            'event_id' => $eventId,
            'ticket_type_id' => $ticketTypeId,
            'registration_id' => $registrationId,
            'user_id' => $targetId,
            'actor_id' => $actorId,
            'units' => $units,
        ]);

        try {
            return DB::transaction(function () use (
                $tenantId,
                $eventId,
                $ticketTypeId,
                $registrationId,
                $targetId,
                $actorId,
                $units,
                $keyHash,
                $requestHash,
                $organizerOperation,
            ): array {
                $event = $this->support->concreteEvent($tenantId, $eventId, false);
                $persistedActor = $this->support->actor($tenantId, $actorId, false);
                // The recipient is always a member of this community, even
                // when the organiser is managing it from a community above.
                $member = $this->support->member($tenantId, $targetId);
            if ($organizerOperation) {
                $this->support->authorizeManageFinance($persistedActor, $event);
            } else {
                if ((int) $persistedActor->id !== (int) $member->id) {
                    throw new EventTicketingException('event_ticket_self_allocation_identity_mismatch');
                }
                $this->support->authorizeView($persistedActor, $event);
            }
            $replay = $this->allocationReplay(
                $tenantId,
                $eventId,
                $ticketTypeId,
                $registrationId,
                (int) $member->id,
                (int) $persistedActor->id,
                $units,
                $keyHash,
                $requestHash,
                false,
            );
            if ($replay !== null) {
                [$confirmedUnits] = $this->confirmedUnitTotalsForUpdate(
                    $tenantId,
                    $eventId,
                    (int) $replay->ticket_type_id,
                    (int) $replay->user_id,
                );

                return [
                    'entitlement' => $this->entitlementModelFromReplay($replay),
                    'changed' => false,
                    'confirmed_units_after' => $confirmedUnits,
                ];
            }
            $registration = DB::table('event_registrations')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('id', $registrationId)
                ->where('user_id', (int) $member->id)
                ->lockForUpdate()
                ->first();
            if ($registration === null || (string) $registration->registration_state !== 'confirmed') {
                throw new EventTicketingException('event_ticket_confirmed_registration_required');
            }
            $ticket = $this->ticketRow($tenantId, $eventId, $ticketTypeId, true);
            // A fast replay check above avoids unnecessary locking for the
            // common case, but it is not a serialization boundary. A competing
            // request can commit the same idempotency key while this request is
            // waiting on the registration or ticket row. Re-check only after
            // both authoritative locks are held so a concurrent replay cannot
            // fall through to the inventory limits and be misreported as sold
            // out.
            $replay = $this->allocationReplay(
                $tenantId,
                $eventId,
                $ticketTypeId,
                $registrationId,
                (int) $member->id,
                (int) $persistedActor->id,
                $units,
                $keyHash,
                $requestHash,
                true,
            );
            if ($replay !== null) {
                [$confirmedUnits] = $this->confirmedUnitTotalsForUpdate(
                    $tenantId,
                    $eventId,
                    (int) $replay->ticket_type_id,
                    (int) $replay->user_id,
                );

                return [
                    'entitlement' => $this->entitlementModelFromReplay($replay),
                    'changed' => false,
                    'confirmed_units_after' => $confirmedUnits,
                ];
            }
            if ((string) $ticket->kind === EventTicketKind::TimeCredit->value) {
                throw new EventTicketingException('event_ticket_time_credit_gateway_unavailable');
            }
            if ((string) $ticket->kind !== EventTicketKind::Free->value
                || (string) $ticket->status !== EventTicketTypeStatus::Active->value
                || (string) $ticket->unit_price_credits !== '0.00') {
                throw new EventTicketingException('event_ticket_free_type_not_allocatable');
            }
            $now = CarbonImmutable::now('UTC');
            $opens = CarbonImmutable::parse((string) $ticket->sales_opens_at_utc, 'UTC')->utc();
            $closes = CarbonImmutable::parse((string) $ticket->sales_closes_at_utc, 'UTC')->utc();
            if ($now->lessThan($opens) || ! $now->lessThan($closes)) {
                throw new EventTicketingException('event_ticket_sales_window_closed');
            }
            $policy = json_decode((string) $ticket->eligibility_policy, true, 512, JSON_THROW_ON_ERROR);
            if (! is_array($policy)) {
                throw new EventTicketingException('event_ticket_eligibility_policy_invalid');
            }
            /** @var array{approved_member_required:bool,minimum_account_age_days:int,required_group_ids:list<int>} $policy */
            $eligibility = $this->eligibility->evaluate($tenantId, $member, $policy, $now);
            if (! $eligibility['eligible']) {
                throw new EventTicketingException('event_ticket_eligibility_denied');
            }
            [$confirmedUnits, $memberUnits] = $this->confirmedUnitTotalsForUpdate(
                $tenantId,
                $eventId,
                $ticketTypeId,
                (int) $member->id,
            );
            if ($confirmedUnits + $units > (int) $ticket->allocation_limit) {
                throw new EventTicketingException('event_ticket_allocation_exhausted');
            }
            if ($memberUnits + $units > (int) $ticket->per_member_limit) {
                throw new EventTicketingException('event_ticket_per_member_limit_exceeded');
            }
            $entitlementId = (int) DB::table('event_ticket_entitlements')->insertGetId([
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'ticket_type_id' => $ticketTypeId,
                'registration_id' => $registrationId,
                'user_id' => (int) $member->id,
                'units' => $units,
                'ticket_kind_snapshot' => EventTicketKind::Free->value,
                'unit_price_credits_snapshot' => '0.00',
                'total_price_credits_snapshot' => '0.00',
                'status' => EventTicketEntitlementStatus::Confirmed->value,
                'entitlement_version' => 1,
                'allocation_idempotency_hash' => $keyHash,
                'allocation_request_hash' => $requestHash,
                'created_by' => (int) $persistedActor->id,
                'cancelled_by' => null,
                'cancellation_reason' => null,
                'confirmed_at' => $now,
                'cancelled_at' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            $after = $confirmedUnits + $units;
            $this->recordEntitlementHistory(
                $tenantId,
                $eventId,
                $ticketTypeId,
                $entitlementId,
                $registrationId,
                (int) $member->id,
                1,
                'confirmed',
                $units,
                (int) $persistedActor->id,
                $keyHash,
                $requestHash,
                null,
                ['allocation_mode' => $organizerOperation ? 'organizer' : 'self'],
                $now,
            );
            $this->recordInventoryHistory(
                $tenantId,
                $eventId,
                $ticketTypeId,
                $entitlementId,
                1,
                'allocated',
                $units,
                $after,
                (int) $persistedActor->id,
                $keyHash,
                $requestHash,
                $now,
            );

            return [
                'entitlement' => $this->entitlementModel($tenantId, $eventId, $entitlementId),
                'changed' => true,
                'confirmed_units_after' => $after,
            ];
            }, 3);
        } catch (QueryException $exception) {
            return $this->recoverAllocationRace(
                $tenantId,
                $eventId,
                $ticketTypeId,
                $registrationId,
                $targetId,
                $actorId,
                $units,
                $keyHash,
                $requestHash,
                $exception,
            );
        }
    }

    /** @return array{entitlement:EventTicketEntitlement,changed:bool,confirmed_units_after:int} */
    public function cancel(
        int $eventId,
        int $entitlementId,
        User|int $actor,
        int $expectedVersion,
        string $reason,
        string $idempotencyKey,
    ): array {
        $this->assertSchema();
        $reason = $this->cancellationReason($reason, false);
        $tenantId = $this->support->tenantId();
        $keyHash = $this->support->idempotencyHash($idempotencyKey);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $entitlementId,
            $actor,
            $expectedVersion,
            $reason,
            $keyHash,
        ): array {
            $event = $this->support->concreteEvent($tenantId, $eventId, false);
            $persistedActor = $this->support->actor($tenantId, $actor, false);
            $candidate = $this->entitlementRow($tenantId, $eventId, $entitlementId, false);
            if ((int) $candidate->user_id === (int) $persistedActor->id) {
                $this->support->authorizeView($persistedActor, $event);
            } else {
                $this->support->authorizeReconcileTickets($persistedActor, $event);
            }
            $requestHash = $this->support->requestHash([
                'action' => 'cancelled',
                'event_id' => $eventId,
                'entitlement_id' => $entitlementId,
                'actor_id' => (int) $persistedActor->id,
                'expected_version' => $expectedVersion,
                'reason' => $reason,
            ]);
            $this->ticketRow($tenantId, $eventId, (int) $candidate->ticket_type_id, true);
            $entitlement = $this->entitlementRow($tenantId, $eventId, $entitlementId, true);
            $this->assertFreeEntitlementSnapshot($entitlement);
            $replay = $this->entitlementHistoryReplay($tenantId, $keyHash, $requestHash, true);
            if ($replay !== null) {
                [$confirmedUnits] = $this->confirmedUnitTotalsForUpdate(
                    $tenantId,
                    $eventId,
                    (int) $candidate->ticket_type_id,
                    (int) $candidate->user_id,
                );

                return [
                    'entitlement' => $this->entitlementModel($tenantId, $eventId, $entitlementId),
                    'changed' => false,
                    'confirmed_units_after' => $confirmedUnits,
                ];
            }
            if ((int) $entitlement->entitlement_version !== $expectedVersion
                || (string) $entitlement->status !== EventTicketEntitlementStatus::Confirmed->value) {
                throw new EventTicketingException('event_ticket_entitlement_version_conflict');
            }
            $version = $expectedVersion + 1;
            $now = CarbonImmutable::now('UTC');
            if (DB::table('event_ticket_entitlements')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('id', $entitlementId)
                ->where('entitlement_version', $expectedVersion)
                ->where('status', EventTicketEntitlementStatus::Confirmed->value)
                ->update([
                    'status' => EventTicketEntitlementStatus::Cancelled->value,
                    'entitlement_version' => $version,
                    'cancelled_by' => (int) $persistedActor->id,
                    'cancellation_reason' => $reason,
                    'cancelled_at' => $now,
                    'updated_at' => $now,
                ]) !== 1) {
                throw new EventTicketingException('event_ticket_entitlement_version_conflict');
            }
            [$after] = $this->confirmedUnitTotalsForUpdate(
                $tenantId,
                $eventId,
                (int) $entitlement->ticket_type_id,
                (int) $entitlement->user_id,
            );
            $this->recordEntitlementHistory(
                $tenantId,
                $eventId,
                (int) $entitlement->ticket_type_id,
                $entitlementId,
                (int) $entitlement->registration_id,
                (int) $entitlement->user_id,
                $version,
                'cancelled',
                (int) $entitlement->units,
                (int) $persistedActor->id,
                $keyHash,
                $requestHash,
                $reason,
                ['release_only' => true, 'refund_executed' => false],
                $now,
            );
            $this->recordInventoryHistory(
                $tenantId,
                $eventId,
                (int) $entitlement->ticket_type_id,
                $entitlementId,
                $version,
                'released',
                -((int) $entitlement->units),
                $after,
                (int) $persistedActor->id,
                $keyHash,
                $requestHash,
                $now,
            );

            return [
                'entitlement' => $this->entitlementModel($tenantId, $eventId, $entitlementId),
                'changed' => true,
                'confirmed_units_after' => $after,
            ];
        }, 3);
    }

    /**
     * Release every confirmed zero-value entitlement when its registration exits.
     *
     * The caller owns the registration transaction. This boundary deliberately
     * refuses time-credit or monetary effects: those require a separately
     * approved refund gateway and transaction ledger.
     */
    public function cancelConfirmedForRegistrationExitWithinTransaction(
        int $eventId,
        int $registrationId,
        User|int $actor,
        string $reason,
        string $idempotencyPrefix,
    ): int {
        if (DB::transactionLevel() <= 0) {
            throw new EventTicketingException('event_ticket_registration_exit_transaction_required');
        }
        if (! Schema::hasTable('event_ticket_entitlements')) {
            return 0;
        }
        $tenantId = $this->support->tenantId();
        $hasConfirmedEntitlement = DB::table('event_ticket_entitlements')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('registration_id', $registrationId)
            ->where('status', EventTicketEntitlementStatus::Confirmed->value)
            ->exists();
        if (! $hasConfirmedEntitlement) {
            return 0;
        }
        foreach ([
            'event_ticket_types',
            'event_ticket_entitlement_history',
            'event_ticket_inventory_history',
            'event_registrations',
            'events',
        ] as $requiredTable) {
            if (! Schema::hasTable($requiredTable)) {
                return 0;
            }
        }
        if (! Schema::hasColumn('events', 'is_recurring_template')
            || ! Schema::hasColumn('events', 'occurrence_key')) {
            return 0;
        }
        $eventScope = DB::table('events')
            ->where('tenant_id', $tenantId)
            ->where('id', $eventId)
            ->first(['is_recurring_template', 'occurrence_key']);
        if ($eventScope === null
            || (bool) $eventScope->is_recurring_template
            || trim((string) $eventScope->occurrence_key) === '') {
            return 0;
        }

        $this->assertSchema();
        $reason = $this->cancellationReason($reason, true);
        $idempotencyPrefix = trim($idempotencyPrefix);
        if ($idempotencyPrefix === '') {
            throw new EventTicketingException('event_ticket_idempotency_key_invalid');
        }
        $event = $this->support->concreteEvent($tenantId, $eventId, false);
        $persistedActor = $this->support->actor($tenantId, $actor, false);
        $registration = DB::table('event_registrations')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('id', $registrationId)
            ->lockForUpdate()
            ->first(['id', 'user_id', 'registration_state']);
        if ($registration === null) {
            throw new EventTicketingException('event_ticket_registration_not_found');
        }
        if ((int) $registration->user_id === (int) $persistedActor->id) {
            $this->support->authorizeView($persistedActor, $event);
        } elseif (! $this->policy->manageRegistration($persistedActor, $event)) {
            throw new EventTicketingException('event_ticket_registration_exit_denied');
        }
        if ((string) $registration->registration_state === 'confirmed') {
            throw new EventTicketingException('event_ticket_registration_exit_not_persisted');
        }

        $entitlements = DB::table('event_ticket_entitlements')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('registration_id', $registrationId)
            ->where('status', EventTicketEntitlementStatus::Confirmed->value)
            ->orderBy('ticket_type_id')
            ->orderBy('id')
            ->lockForUpdate()
            ->get();
        $released = 0;
        foreach ($entitlements as $entitlement) {
            $this->assertFreeEntitlementSnapshot($entitlement);
            $expectedVersion = (int) $entitlement->entitlement_version;
            if ($expectedVersion < 1) {
                throw new EventTicketingException('event_ticket_entitlement_version_conflict');
            }
            $version = $expectedVersion + 1;
            $operationKey = 'registration-exit:'
                . hash('sha256', $idempotencyPrefix)
                . ':entitlement:' . (int) $entitlement->id
                . ':v' . $expectedVersion;
            $keyHash = $this->support->idempotencyHash($operationKey);
            $requestHash = $this->support->requestHash([
                'action' => 'cancelled',
                'source' => 'registration_exit',
                'event_id' => $eventId,
                'registration_id' => $registrationId,
                'entitlement_id' => (int) $entitlement->id,
                'actor_id' => (int) $persistedActor->id,
                'expected_version' => $expectedVersion,
                'reason' => $reason,
            ]);
            if ($this->entitlementHistoryReplay($tenantId, $keyHash, $requestHash, true) !== null) {
                throw new EventTicketingException('event_ticket_entitlement_replay_evidence_invalid');
            }
            $now = CarbonImmutable::now('UTC');
            if (DB::table('event_ticket_entitlements')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('id', (int) $entitlement->id)
                ->where('entitlement_version', $expectedVersion)
                ->where('status', EventTicketEntitlementStatus::Confirmed->value)
                ->update([
                    'status' => EventTicketEntitlementStatus::Cancelled->value,
                    'entitlement_version' => $version,
                    'cancelled_by' => (int) $persistedActor->id,
                    'cancellation_reason' => $reason,
                    'cancelled_at' => $now,
                    'updated_at' => $now,
                ]) !== 1) {
                throw new EventTicketingException('event_ticket_entitlement_version_conflict');
            }
            [$after] = $this->confirmedUnitTotalsForUpdate(
                $tenantId,
                $eventId,
                (int) $entitlement->ticket_type_id,
                (int) $entitlement->user_id,
            );
            $this->recordEntitlementHistory(
                $tenantId,
                $eventId,
                (int) $entitlement->ticket_type_id,
                (int) $entitlement->id,
                $registrationId,
                (int) $entitlement->user_id,
                $version,
                'cancelled',
                (int) $entitlement->units,
                (int) $persistedActor->id,
                $keyHash,
                $requestHash,
                $reason,
                [
                    'release_only' => true,
                    'refund_executed' => false,
                    'source' => 'registration_exit',
                ],
                $now,
            );
            $this->recordInventoryHistory(
                $tenantId,
                $eventId,
                (int) $entitlement->ticket_type_id,
                (int) $entitlement->id,
                $version,
                'released',
                -((int) $entitlement->units),
                $after,
                (int) $persistedActor->id,
                $keyHash,
                $requestHash,
                $now,
            );
            $released++;
        }

        return $released;
    }

    private function assertFreeEntitlementSnapshot(stdClass $entitlement): void
    {
        if ((string) $entitlement->ticket_kind_snapshot !== EventTicketKind::Free->value
            || $this->support->creditCents((string) $entitlement->unit_price_credits_snapshot) !== 0
            || $this->support->creditCents((string) $entitlement->total_price_credits_snapshot) !== 0) {
            throw new EventTicketingException('event_ticket_time_credit_gateway_unavailable');
        }
    }

    private function cancellationReason(string $reason, bool $truncateWithEvidence): string
    {
        $reason = trim(strip_tags($reason));
        $reason = trim((string) preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $reason));
        if ($reason === '') {
            throw new EventTicketingException('event_ticket_cancellation_reason_invalid');
        }
        if (mb_strlen($reason) <= 500) {
            return $reason;
        }
        if (! $truncateWithEvidence) {
            throw new EventTicketingException('event_ticket_cancellation_reason_invalid');
        }

        return mb_substr($reason, 0, 420)
            . '… [sha256:' . hash('sha256', $reason) . ']';
    }

    private function ticketRow(int $tenantId, int $eventId, int $ticketTypeId, bool $lock): stdClass
    {
        $query = DB::table('event_ticket_types')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('id', $ticketTypeId);
        if ($lock) {
            $query->lockForUpdate();
        }
        $row = $query->first();
        if ($row === null) {
            throw new EventTicketingException('event_ticket_type_not_found');
        }

        return $row;
    }

    private function entitlementRow(int $tenantId, int $eventId, int $entitlementId, bool $lock): stdClass
    {
        $query = DB::table('event_ticket_entitlements')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('id', $entitlementId);
        if ($lock) {
            $query->lockForUpdate();
        }
        $row = $query->first();
        if ($row === null) {
            throw new EventTicketingException('event_ticket_entitlement_not_found');
        }

        return $row;
    }

    private function allocationReplay(
        int $tenantId,
        int $eventId,
        int $ticketTypeId,
        int $registrationId,
        int $userId,
        int $actorId,
        int $units,
        string $keyHash,
        string $requestHash,
        bool $lock,
    ): ?stdClass {
        $query = DB::table('event_ticket_entitlements')
            ->where('tenant_id', $tenantId)
            ->where('allocation_idempotency_hash', $keyHash);
        if ($lock) {
            $query->lockForUpdate();
        }
        $row = $query->first();
        if ($row === null) {
            return null;
        }
        if (! hash_equals((string) $row->allocation_request_hash, $requestHash)
            || (int) $row->event_id !== $eventId
            || (int) $row->ticket_type_id !== $ticketTypeId
            || (int) $row->registration_id !== $registrationId
            || (int) $row->user_id !== $userId
            || (int) $row->created_by !== $actorId
            || (int) $row->units !== $units) {
            throw new EventTicketingException('event_ticket_entitlement_idempotency_conflict');
        }

        $historyQuery = DB::table('event_ticket_entitlement_history')
            ->where('tenant_id', $tenantId)
            ->where('idempotency_hash', $keyHash);
        $inventoryQuery = DB::table('event_ticket_inventory_history')
            ->where('tenant_id', $tenantId)
            ->where('idempotency_hash', $keyHash);
        if ($lock) {
            $historyQuery->lockForUpdate();
            $inventoryQuery->lockForUpdate();
        }
        $history = $historyQuery->first();
        $inventory = $inventoryQuery->first();
        if ($history === null || $inventory === null
            || ! hash_equals((string) $history->request_hash, $requestHash)
            || ! hash_equals((string) $inventory->request_hash, $requestHash)
            || (int) $history->event_id !== $eventId
            || (int) $history->ticket_type_id !== $ticketTypeId
            || (int) $history->entitlement_id !== (int) $row->id
            || (int) $history->registration_id !== $registrationId
            || (int) $history->user_id !== $userId
            || (int) $history->actor_user_id !== $actorId
            || (int) $history->units !== $units
            || (int) $history->entitlement_version !== 1
            || (string) $history->action !== 'confirmed'
            || (int) $inventory->event_id !== $eventId
            || (int) $inventory->ticket_type_id !== $ticketTypeId
            || (int) $inventory->entitlement_id !== (int) $row->id
            || (int) $inventory->actor_user_id !== $actorId
            || (int) $inventory->quantity_delta !== $units
            || (int) $inventory->entitlement_version !== 1
            || (string) $inventory->action !== 'allocated') {
            throw new EventTicketingException('event_ticket_entitlement_replay_evidence_invalid');
        }

        return $row;
    }

    /** @return array{0:int,1:int} */
    private function confirmedUnitTotalsForUpdate(
        int $tenantId,
        int $eventId,
        int $ticketTypeId,
        int $userId,
    ): array {
        $rows = DB::table('event_ticket_entitlements')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('ticket_type_id', $ticketTypeId)
            ->where('status', EventTicketEntitlementStatus::Confirmed->value)
            ->lockForUpdate()
            ->get(['user_id', 'units']);

        return [
            (int) $rows->sum('units'),
            (int) $rows->where('user_id', $userId)->sum('units'),
        ];
    }

    /** @return array{entitlement:EventTicketEntitlement,changed:bool,confirmed_units_after:int} */
    private function recoverAllocationRace(
        int $tenantId,
        int $eventId,
        int $ticketTypeId,
        int $registrationId,
        int $userId,
        int $actorId,
        int $units,
        string $keyHash,
        string $requestHash,
        QueryException $exception,
    ): array {
        $replay = $this->allocationReplay(
            $tenantId,
            $eventId,
            $ticketTypeId,
            $registrationId,
            $userId,
            $actorId,
            $units,
            $keyHash,
            $requestHash,
            false,
        );
        if ($replay !== null) {
            return [
                'entitlement' => $this->entitlementModelFromReplay($replay),
                'changed' => false,
                'confirmed_units_after' => $this->support->confirmedUnits(
                    $tenantId,
                    $eventId,
                    $ticketTypeId,
                ),
            ];
        }

        $message = $exception->getMessage();
        foreach ([
            'event_ticket_allocation_exhausted',
            'event_ticket_per_member_limit_exceeded',
            'event_ticket_free_type_not_allocatable',
            'event_ticket_confirmed_registration_required',
            'event_ticket_free_snapshot_required',
        ] as $reason) {
            if (str_contains($message, $reason)) {
                throw new EventTicketingException($reason, 0, $exception);
            }
        }
        if (str_contains($message, 'uq_event_ticket_entitlement_key')
            || str_contains($message, 'Duplicate entry')) {
            throw new EventTicketingException(
                'event_ticket_entitlement_idempotency_conflict',
                0,
                $exception,
            );
        }

        throw new EventTicketingException('event_ticket_allocation_persistence_failed', 0, $exception);
    }

    private function entitlementHistoryReplay(
        int $tenantId,
        string $keyHash,
        string $requestHash,
        bool $lock,
    ): ?stdClass {
        $query = DB::table('event_ticket_entitlement_history')
            ->where('tenant_id', $tenantId)
            ->where('idempotency_hash', $keyHash);
        if ($lock) {
            $query->lockForUpdate();
        }
        $row = $query->first();
        if ($row !== null && ! hash_equals((string) $row->request_hash, $requestHash)) {
            throw new EventTicketingException('event_ticket_entitlement_idempotency_conflict');
        }

        return $row;
    }

    /** @param array<string,mixed> $metadata */
    private function recordEntitlementHistory(
        int $tenantId,
        int $eventId,
        int $ticketTypeId,
        int $entitlementId,
        int $registrationId,
        int $userId,
        int $version,
        string $action,
        int $units,
        int $actorId,
        string $keyHash,
        string $requestHash,
        ?string $reason,
        array $metadata,
        CarbonImmutable $now,
    ): void {
        DB::table('event_ticket_entitlement_history')->insert([
            'tenant_id' => $tenantId,
            'event_id' => $eventId,
            'ticket_type_id' => $ticketTypeId,
            'entitlement_id' => $entitlementId,
            'registration_id' => $registrationId,
            'user_id' => $userId,
            'entitlement_version' => $version,
            'action' => $action,
            'units' => $units,
            'ticket_kind_snapshot' => EventTicketKind::Free->value,
            'unit_price_credits_snapshot' => '0.00',
            'total_price_credits_snapshot' => '0.00',
            'actor_user_id' => $actorId,
            'idempotency_hash' => $keyHash,
            'request_hash' => $requestHash,
            'reason' => $reason,
            'metadata' => json_encode($metadata, JSON_THROW_ON_ERROR),
            'created_at' => $now,
        ]);
    }

    private function recordInventoryHistory(
        int $tenantId,
        int $eventId,
        int $ticketTypeId,
        int $entitlementId,
        int $version,
        string $action,
        int $delta,
        int $after,
        int $actorId,
        string $keyHash,
        string $requestHash,
        CarbonImmutable $now,
    ): void {
        DB::table('event_ticket_inventory_history')->insert([
            'tenant_id' => $tenantId,
            'event_id' => $eventId,
            'ticket_type_id' => $ticketTypeId,
            'entitlement_id' => $entitlementId,
            'entitlement_version' => $version,
            'action' => $action,
            'quantity_delta' => $delta,
            'confirmed_units_after' => $after,
            'actor_user_id' => $actorId,
            'idempotency_hash' => $keyHash,
            'request_hash' => $requestHash,
            'created_at' => $now,
        ]);
    }

    private function entitlementModel(
        int $tenantId,
        int $eventId,
        int $entitlementId,
    ): EventTicketEntitlement {
        return EventTicketEntitlement::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->whereKey($entitlementId)
            ->firstOrFail();
    }

    private function entitlementModelFromReplay(stdClass $replay): EventTicketEntitlement
    {
        return (new EventTicketEntitlement())->newFromBuilder((array) $replay);
    }

    private function assertSchema(): void
    {
        foreach ([
            'event_ticket_types',
            'event_ticket_entitlements',
            'event_ticket_entitlement_history',
            'event_ticket_inventory_history',
        ] as $table) {
            if (! Schema::hasTable($table)) {
                throw new EventTicketingException('event_ticket_entitlement_schema_unavailable');
            }
        }
    }
}
