<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Enums\EventTicketKind;
use App\Enums\EventTicketTypeStatus;
use App\Exceptions\EventTicketingException;
use App\Models\Event;
use App\Models\EventTicketType;
use App\Models\User;
use App\Support\Events\EventTicketEligibilityPolicy;
use App\Support\Events\EventTicketingSupport;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use stdClass;

/** Optimistic, archive-first ticket-class configuration boundary. */
final class EventTicketTypeService
{
    private const FIELDS = [
        'name',
        'description',
        'kind',
        'unit_price_credits',
        'allocation_limit',
        'sales_opens_at',
        'sales_opens_at_utc',
        'sales_closes_at',
        'sales_closes_at_utc',
        'per_member_limit',
        'eligibility_policy',
        'refund_cutoff_at',
        'refund_cutoff_at_utc',
        'organizer_cancel_refundable',
    ];

    public function __construct(
        private readonly EventTicketingSupport $support = new EventTicketingSupport(),
        private readonly EventTicketEligibilityPolicy $eligibility = new EventTicketEligibilityPolicy(),
        private readonly EventTimeCreditTicketGatewayService $timeCreditGateway = new EventTimeCreditTicketGatewayService(),
    ) {
    }

    /**
     * @param array<string,mixed> $attributes
     * @return array{ticket_type:EventTicketType,changed:bool}
     */
    public function create(
        int $eventId,
        User|int $actor,
        array $attributes,
        string $idempotencyKey,
    ): array {
        $this->assertSchema();
        $this->assertKnownFields($attributes);
        $this->assertAliases($attributes);
        $tenantId = $this->support->tenantId();
        $keyHash = $this->support->idempotencyHash($idempotencyKey);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $actor,
            $attributes,
            $keyHash,
        ): array {
            $event = $this->support->concreteEvent($tenantId, $eventId, true);
            $persistedActor = $this->support->actor($tenantId, $actor, true);
            $this->support->authorizeManageFinance($persistedActor, $event);
            $normalized = $this->normalize($tenantId, $event, $attributes, null);
            $requestHash = $this->support->requestHash([
                'action' => 'created',
                'event_id' => $eventId,
                'actor_id' => (int) $persistedActor->id,
                'attributes' => $normalized,
            ]);
            $replay = $this->historyReplay($tenantId, $keyHash, $requestHash);
            if ($replay !== null) {
                return $this->replayResult($tenantId, $eventId, $replay);
            }
            $now = CarbonImmutable::now('UTC');
            $ticketTypeId = (int) DB::table('event_ticket_types')->insertGetId([
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'occurrence_key' => (string) $event->getRawOriginal('occurrence_key'),
                'ticket_version' => 1,
                ...$normalized,
                'status' => EventTicketTypeStatus::Draft->value,
                'created_by' => (int) $persistedActor->id,
                'updated_by' => (int) $persistedActor->id,
                'activated_by' => null,
                'paused_by' => null,
                'archived_by' => null,
                'activated_at' => null,
                'paused_at' => null,
                'archived_at' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            $this->recordHistory(
                $tenantId,
                $eventId,
                $ticketTypeId,
                1,
                'created',
                (int) $persistedActor->id,
                $keyHash,
                $requestHash,
                array_keys($normalized),
                null,
                $now,
            );

            return [
                'ticket_type' => $this->ticketModel($tenantId, $eventId, $ticketTypeId),
                'changed' => true,
            ];
        }, 3);
    }

    /**
     * @param array<string,mixed> $attributes
     * @return array{ticket_type:EventTicketType,changed:bool}
     */
    public function update(
        int $eventId,
        int $ticketTypeId,
        User|int $actor,
        array $attributes,
        int $expectedVersion,
        string $idempotencyKey,
    ): array {
        $this->assertSchema();
        $this->assertKnownFields($attributes);
        $this->assertAliases($attributes);
        if ($attributes === []) {
            throw new EventTicketingException('event_ticket_type_update_empty');
        }
        $tenantId = $this->support->tenantId();
        $keyHash = $this->support->idempotencyHash($idempotencyKey);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $ticketTypeId,
            $actor,
            $attributes,
            $expectedVersion,
            $keyHash,
        ): array {
            $event = $this->support->concreteEvent($tenantId, $eventId, true);
            $persistedActor = $this->support->actor($tenantId, $actor, true);
            $this->support->authorizeManageFinance($persistedActor, $event);
            $current = $this->ticketRow($tenantId, $eventId, $ticketTypeId, true);
            $normalized = $this->normalize($tenantId, $event, $attributes, $current);
            $requestHash = $this->support->requestHash([
                'action' => 'updated',
                'event_id' => $eventId,
                'ticket_type_id' => $ticketTypeId,
                'actor_id' => (int) $persistedActor->id,
                'expected_version' => $expectedVersion,
                'attributes' => $normalized,
            ]);
            $replay = $this->historyReplay($tenantId, $keyHash, $requestHash);
            if ($replay !== null) {
                return $this->replayResult($tenantId, $eventId, $replay);
            }
            if ((int) $current->ticket_version !== $expectedVersion) {
                throw new EventTicketingException('event_ticket_type_version_conflict');
            }
            if (! in_array((string) $current->status, [
                EventTicketTypeStatus::Draft->value,
                EventTicketTypeStatus::Paused->value,
            ], true)) {
                throw new EventTicketingException('event_ticket_type_not_editable');
            }
            if ($this->hasEntitlements($tenantId, $eventId, $ticketTypeId)
                && $this->inventoryFieldsChanged($current, $normalized)) {
                throw new EventTicketingException('event_ticket_type_inventory_fields_immutable');
            }
            $version = $expectedVersion + 1;
            $now = CarbonImmutable::now('UTC');
            if (DB::table('event_ticket_types')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('id', $ticketTypeId)
                ->where('ticket_version', $expectedVersion)
                ->update([
                    ...$normalized,
                    'ticket_version' => $version,
                    'updated_by' => (int) $persistedActor->id,
                    'updated_at' => $now,
                ]) !== 1) {
                throw new EventTicketingException('event_ticket_type_version_conflict');
            }
            $this->recordHistory(
                $tenantId,
                $eventId,
                $ticketTypeId,
                $version,
                'updated',
                (int) $persistedActor->id,
                $keyHash,
                $requestHash,
                array_keys($attributes),
                null,
                $now,
            );

            return [
                'ticket_type' => $this->ticketModel($tenantId, $eventId, $ticketTypeId),
                'changed' => true,
            ];
        }, 3);
    }

    /** @return array{ticket_type:EventTicketType,changed:bool} */
    public function activate(
        int $eventId,
        int $ticketTypeId,
        User|int $actor,
        int $expectedVersion,
        string $idempotencyKey,
    ): array {
        return $this->transition(
            $eventId,
            $ticketTypeId,
            $actor,
            $expectedVersion,
            $idempotencyKey,
            EventTicketTypeStatus::Active,
            null,
        );
    }

    /** @return array{ticket_type:EventTicketType,changed:bool} */
    public function pause(
        int $eventId,
        int $ticketTypeId,
        User|int $actor,
        int $expectedVersion,
        string $idempotencyKey,
        string $reason,
    ): array {
        return $this->transition(
            $eventId,
            $ticketTypeId,
            $actor,
            $expectedVersion,
            $idempotencyKey,
            EventTicketTypeStatus::Paused,
            $this->reason($reason),
        );
    }

    /** @return array{ticket_type:EventTicketType,changed:bool} */
    public function archive(
        int $eventId,
        int $ticketTypeId,
        User|int $actor,
        int $expectedVersion,
        string $idempotencyKey,
        string $reason,
    ): array {
        return $this->transition(
            $eventId,
            $ticketTypeId,
            $actor,
            $expectedVersion,
            $idempotencyKey,
            EventTicketTypeStatus::Archived,
            $this->reason($reason),
        );
    }

    /** @return array{ticket_type:EventTicketType,changed:bool} */
    private function transition(
        int $eventId,
        int $ticketTypeId,
        User|int $actor,
        int $expectedVersion,
        string $idempotencyKey,
        EventTicketTypeStatus $target,
        ?string $reason,
    ): array {
        $this->assertSchema();
        $tenantId = $this->support->tenantId();
        $keyHash = $this->support->idempotencyHash($idempotencyKey);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $ticketTypeId,
            $actor,
            $expectedVersion,
            $keyHash,
            $target,
            $reason,
        ): array {
            $event = $this->support->concreteEvent($tenantId, $eventId, true);
            $persistedActor = $this->support->actor($tenantId, $actor, true);
            $this->support->authorizeManageFinance($persistedActor, $event);
            $ticket = $this->ticketRow($tenantId, $eventId, $ticketTypeId, true);
            $requestHash = $this->support->requestHash([
                'action' => $target->value,
                'event_id' => $eventId,
                'ticket_type_id' => $ticketTypeId,
                'actor_id' => (int) $persistedActor->id,
                'expected_version' => $expectedVersion,
                'reason' => $reason,
            ]);
            $replay = $this->historyReplay($tenantId, $keyHash, $requestHash);
            if ($replay !== null) {
                return $this->replayResult($tenantId, $eventId, $replay);
            }
            if ((int) $ticket->ticket_version !== $expectedVersion) {
                throw new EventTicketingException('event_ticket_type_version_conflict');
            }
            $currentStatus = EventTicketTypeStatus::from((string) $ticket->status);
            $allowed = match ($target) {
                EventTicketTypeStatus::Active => in_array(
                    $currentStatus,
                    [EventTicketTypeStatus::Draft, EventTicketTypeStatus::Paused],
                    true,
                ),
                EventTicketTypeStatus::Paused => $currentStatus === EventTicketTypeStatus::Active,
                EventTicketTypeStatus::Archived => $currentStatus !== EventTicketTypeStatus::Archived,
                EventTicketTypeStatus::Draft => false,
            };
            if (! $allowed) {
                throw new EventTicketingException('event_ticket_type_transition_invalid');
            }
            if ($target === EventTicketTypeStatus::Active
                && (string) $ticket->kind === EventTicketKind::TimeCredit->value
                && ! $this->timeCreditGateway->supportsActivation()) {
                throw new EventTicketingException('event_ticket_time_credit_gateway_unavailable');
            }
            $now = CarbonImmutable::now('UTC');
            if ($target === EventTicketTypeStatus::Active
                && CarbonImmutable::parse((string) $ticket->sales_closes_at_utc, 'UTC')->lessThanOrEqualTo($now)) {
                throw new EventTicketingException('event_ticket_sales_window_closed');
            }
            $updates = [
                'status' => $target->value,
                'ticket_version' => $expectedVersion + 1,
                'updated_by' => (int) $persistedActor->id,
                'updated_at' => $now,
            ];
            if ($target === EventTicketTypeStatus::Active) {
                $updates['activated_by'] = (int) $persistedActor->id;
                $updates['activated_at'] = $now;
            } elseif ($target === EventTicketTypeStatus::Paused) {
                $updates['paused_by'] = (int) $persistedActor->id;
                $updates['paused_at'] = $now;
            } else {
                $updates['archived_by'] = (int) $persistedActor->id;
                $updates['archived_at'] = $now;
            }
            if (DB::table('event_ticket_types')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('id', $ticketTypeId)
                ->where('ticket_version', $expectedVersion)
                ->update($updates) !== 1) {
                throw new EventTicketingException('event_ticket_type_version_conflict');
            }
            $action = match ($target) {
                EventTicketTypeStatus::Active => 'activated',
                EventTicketTypeStatus::Paused => 'paused',
                EventTicketTypeStatus::Archived => 'archived',
                EventTicketTypeStatus::Draft => throw new EventTicketingException('event_ticket_type_transition_invalid'),
            };
            $this->recordHistory(
                $tenantId,
                $eventId,
                $ticketTypeId,
                $expectedVersion + 1,
                $action,
                (int) $persistedActor->id,
                $keyHash,
                $requestHash,
                ['status'],
                $reason,
                $now,
            );

            return [
                'ticket_type' => $this->ticketModel($tenantId, $eventId, $ticketTypeId),
                'changed' => true,
            ];
        }, 3);
    }

    /** @param array<string,mixed> $attributes @return array<string,mixed> */
    private function normalize(
        int $tenantId,
        Event $event,
        array $attributes,
        ?stdClass $current,
    ): array {
        $value = static fn (string $field, mixed $default): mixed => array_key_exists($field, $attributes)
            ? $attributes[$field]
            : $default;
        $name = trim((string) $value('name', $current?->name ?? ''));
        if ($name === '' || mb_strlen($name) > 191) {
            throw new EventTicketingException('event_ticket_type_name_invalid');
        }
        $rawDescription = $value('description', $current?->description);
        $description = $rawDescription === null ? null : trim((string) $rawDescription);
        if ($description !== null && mb_strlen($description) > 10000) {
            throw new EventTicketingException('event_ticket_type_description_invalid');
        }
        $kind = EventTicketKind::tryFrom(trim((string) $value('kind', $current?->kind ?? '')));
        if ($kind === null) {
            throw new EventTicketingException('event_ticket_kind_invalid');
        }
        $priceCents = $this->support->creditCents(
            $value('unit_price_credits', $current?->unit_price_credits ?? 0),
        );
        if (($kind === EventTicketKind::Free && $priceCents !== 0)
            || ($kind === EventTicketKind::TimeCredit && $priceCents === 0)) {
            throw new EventTicketingException('event_ticket_kind_price_mismatch');
        }
        $allocation = $this->boundedInt(
            $value('allocation_limit', $current?->allocation_limit),
            1,
            1_000_000,
            'event_ticket_allocation_invalid',
        );
        $perMember = $this->boundedInt(
            $value('per_member_limit', $current?->per_member_limit ?? 1),
            1,
            1000,
            'event_ticket_per_member_limit_invalid',
        );
        if ($perMember > $allocation) {
            throw new EventTicketingException('event_ticket_per_member_limit_invalid');
        }
        $timezone = $this->support->eventTimezone($event);
        $eventStart = $this->support->eventStart($event);
        $opens = $this->instant(
            $attributes,
            'sales_opens_at',
            'sales_opens_at_utc',
            $current?->sales_opens_at_utc,
            $timezone,
            'event_ticket_sales_open_invalid',
        );
        $closes = $this->instant(
            $attributes,
            'sales_closes_at',
            'sales_closes_at_utc',
            $current?->sales_closes_at_utc,
            $timezone,
            'event_ticket_sales_close_invalid',
        );
        $refund = $this->instant(
            $attributes,
            'refund_cutoff_at',
            'refund_cutoff_at_utc',
            $current?->refund_cutoff_at_utc,
            $timezone,
            'event_ticket_refund_cutoff_invalid',
        );
        if ($opens === null || $closes === null || ! $opens->lessThan($closes)
            || $closes->greaterThan($eventStart)) {
            throw new EventTicketingException('event_ticket_sales_window_invalid');
        }
        if ($refund !== null && $refund->greaterThan($eventStart)) {
            throw new EventTicketingException('event_ticket_refund_cutoff_invalid');
        }
        $rawPolicy = array_key_exists('eligibility_policy', $attributes)
            ? $attributes['eligibility_policy']
            : ($current === null
                ? null
                : json_decode((string) $current->eligibility_policy, true, 512, JSON_THROW_ON_ERROR));
        $policy = $this->eligibility->normalize($tenantId, $rawPolicy);
        if (array_key_exists('organizer_cancel_refundable', $attributes)) {
            if (! is_bool($attributes['organizer_cancel_refundable'])) {
                throw new EventTicketingException('event_ticket_refund_policy_invalid');
            }
            $refundable = $attributes['organizer_cancel_refundable'];
        } else {
            $refundable = (bool) ($current?->organizer_cancel_refundable ?? false);
        }
        if ($kind === EventTicketKind::Free) {
            // A free entitlement is released, not refunded. Keep payment-policy
            // fields empty so callers cannot advertise a refund effect that does
            // not exist.
            $refund = null;
            $refundable = false;
        }

        return [
            'name' => $name,
            'description' => $description,
            'kind' => $kind->value,
            'unit_price_credits' => $this->support->credits($priceCents),
            'allocation_limit' => $allocation,
            'sales_opens_at_utc' => $opens,
            'sales_closes_at_utc' => $closes,
            'event_starts_at_utc_snapshot' => $eventStart,
            'event_timezone_snapshot' => $timezone,
            'per_member_limit' => $perMember,
            'eligibility_policy' => json_encode($policy, JSON_THROW_ON_ERROR),
            'refund_cutoff_at_utc' => $refund,
            'organizer_cancel_refundable' => $refundable,
        ];
    }

    /** @param array<string,mixed> $attributes */
    private function instant(
        array $attributes,
        string $localField,
        string $utcField,
        mixed $current,
        string $timezone,
        string $reason,
    ): ?CarbonImmutable
    {
        if (array_key_exists($utcField, $attributes)) {
            return $this->support->inputInstant(
                $attributes[$utcField],
                'UTC',
                $reason,
                $localField,
            );
        }
        if (array_key_exists($localField, $attributes)) {
            return $this->support->inputInstant(
                $attributes[$localField],
                $timezone,
                $reason,
                $localField,
            );
        }
        if ($current === null) {
            return null;
        }
        if (! is_string($current)
            || preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $current) !== 1) {
            throw new EventTicketingException($reason);
        }

        return CarbonImmutable::parse($current, 'UTC')->utc();
    }

    private function boundedInt(mixed $value, int $min, int $max, string $reason): int
    {
        $integer = filter_var($value, FILTER_VALIDATE_INT);
        if ($integer === false || $integer < $min || $integer > $max) {
            throw new EventTicketingException($reason);
        }

        return (int) $integer;
    }

    /** @param array<string,mixed> $attributes */
    private function assertKnownFields(array $attributes): void
    {
        if (array_diff(array_keys($attributes), self::FIELDS) !== []) {
            throw new EventTicketingException('event_ticket_type_fields_unknown');
        }
    }

    /** @param array<string,mixed> $attributes */
    private function assertAliases(array $attributes): void
    {
        foreach ([
            ['sales_opens_at', 'sales_opens_at_utc'],
            ['sales_closes_at', 'sales_closes_at_utc'],
            ['refund_cutoff_at', 'refund_cutoff_at_utc'],
        ] as [$left, $right]) {
            if (array_key_exists($left, $attributes) && array_key_exists($right, $attributes)) {
                throw new EventTicketingException('event_ticket_type_alias_conflict');
            }
        }
    }

    private function reason(string $reason): string
    {
        $reason = trim(strip_tags($reason));
        if ($reason === '' || mb_strlen($reason) > 500) {
            throw new EventTicketingException('event_ticket_transition_reason_invalid');
        }

        return $reason;
    }

    private function hasEntitlements(int $tenantId, int $eventId, int $ticketTypeId): bool
    {
        return DB::table('event_ticket_entitlements')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('ticket_type_id', $ticketTypeId)
            ->exists();
    }

    /** @param array<string,mixed> $normalized */
    private function inventoryFieldsChanged(stdClass $current, array $normalized): bool
    {
        return (string) $current->kind !== (string) $normalized['kind']
            || (string) $current->unit_price_credits !== (string) $normalized['unit_price_credits']
            || (int) $current->allocation_limit !== (int) $normalized['allocation_limit']
            || (int) $current->per_member_limit !== (int) $normalized['per_member_limit'];
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

    private function historyReplay(int $tenantId, string $keyHash, string $requestHash): ?stdClass
    {
        $row = DB::table('event_ticket_type_history')
            ->where('tenant_id', $tenantId)
            ->where('idempotency_hash', $keyHash)
            ->first();
        if ($row !== null && ! hash_equals((string) $row->request_hash, $requestHash)) {
            throw new EventTicketingException('event_ticket_type_idempotency_conflict');
        }

        return $row;
    }

    /** @return array{ticket_type:EventTicketType,changed:bool} */
    private function replayResult(int $tenantId, int $eventId, stdClass $history): array
    {
        $changedFields = json_decode((string) $history->changed_fields, true, 512, JSON_THROW_ON_ERROR);
        $ticketTypeId = is_array($changedFields) ? (int) ($changedFields['ticket_type_id'] ?? 0) : 0;
        if ($ticketTypeId <= 0) {
            throw new EventTicketingException('event_ticket_type_replay_evidence_invalid');
        }

        return [
            'ticket_type' => $this->ticketModel($tenantId, $eventId, $ticketTypeId),
            'changed' => false,
        ];
    }

    /** @param list<string> $fields */
    private function recordHistory(
        int $tenantId,
        int $eventId,
        int $ticketTypeId,
        int $version,
        string $action,
        int $actorId,
        string $keyHash,
        string $requestHash,
        array $fields,
        ?string $reason,
        CarbonImmutable $now,
    ): void {
        sort($fields);
        DB::table('event_ticket_type_history')->insert([
            'tenant_id' => $tenantId,
            'event_id' => $eventId,
            'ticket_type_id' => $ticketTypeId,
            'ticket_version' => $version,
            'action' => $action,
            'actor_user_id' => $actorId,
            'idempotency_hash' => $keyHash,
            'request_hash' => $requestHash,
            'changed_fields' => json_encode([
                'fields' => $fields,
                'ticket_type_id' => $ticketTypeId,
            ], JSON_THROW_ON_ERROR),
            'reason' => $reason,
            'created_at' => $now,
        ]);
    }

    private function ticketModel(int $tenantId, int $eventId, int $ticketTypeId): EventTicketType
    {
        return EventTicketType::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->whereKey($ticketTypeId)
            ->firstOrFail();
    }

    private function assertSchema(): void
    {
        if (! Schema::hasTable('event_ticket_types')
            || ! Schema::hasTable('event_ticket_type_history')) {
            throw new EventTicketingException('event_ticket_type_schema_unavailable');
        }
    }
}
