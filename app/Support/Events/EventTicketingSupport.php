<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Events;

use App\Core\TenantContext;
use App\Exceptions\EventTicketingException;
use App\Models\Event;
use App\Models\User;
use App\Policies\EventPolicy;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Support\Facades\DB;
use Throwable;
use App\Support\Authorization\CrossTenantEntry;

/** Tenant, policy, time, idempotency, and decimal primitives for ticketing. */
final class EventTicketingSupport
{
    private readonly EventPolicy $policy;

    public function __construct(?EventPolicy $policy = null)
    {
        $this->policy = $policy ?? new EventPolicy();
    }

    public function tenantId(): int
    {
        $tenantId = TenantContext::currentId();
        if ($tenantId === null || $tenantId <= 0) {
            throw new EventTicketingException('event_ticket_tenant_context_required');
        }

        return $tenantId;
    }

    public function actor(int $tenantId, User|int $actor, bool $lock = false): User
    {
        $actorId = $actor instanceof User ? (int) $actor->getKey() : $actor;
        $query = User::withoutGlobalScopes()
            ->whereKey($actorId);
        if ($lock) {
            $query->lockForUpdate();
        }
        $persisted = $query->first();
        // Own community, or a crossing CrossTenantEntry admits: a tenant super
        // admin managing a community below its own (owner rule, 12 Oct 2026).
        // Looked up by id, because that account's row is not in this community;
        // outside an HTTP request no crossing is ever admitted.
        if ($persisted !== null && ! CrossTenantEntry::actorMayActIn($persisted, $tenantId)) {
            $persisted = null;
        }
        if ($persisted === null || (string) $persisted->status !== 'active') {
            throw new EventTicketingException('event_ticket_actor_not_found');
        }

        return $persisted;
    }

    /**
     * The MEMBER a ticket is for — strictly a member of this community. Unlike
     * actor(), no crossing is ever admitted: a tenant super admin managing this
     * community from above may allocate tickets, but never receive one here.
     */
    public function member(int $tenantId, User|int $member): User
    {
        $memberId = $member instanceof User ? (int) $member->getKey() : $member;
        $persisted = User::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($memberId)
            ->first();
        if ($persisted === null || (string) $persisted->status !== 'active') {
            throw new EventTicketingException('event_ticket_actor_not_found');
        }

        return $persisted;
    }

    public function concreteEvent(int $tenantId, int $eventId, bool $lock = false): Event
    {
        $query = Event::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($eventId);
        if ($lock) {
            $query->lockForUpdate();
        }
        $event = $query->first();
        if ($event === null) {
            throw new EventTicketingException('event_ticket_event_not_found');
        }
        if ((bool) $event->getRawOriginal('is_recurring_template')
            || trim((string) $event->getRawOriginal('occurrence_key')) === '') {
            throw new EventTicketingException('event_ticket_concrete_occurrence_required');
        }

        return $event;
    }

    public function authorizeManageFinance(User $actor, Event $event): void
    {
        if (! $this->policy->manageFinance($actor, $event)) {
            throw new EventTicketingException('event_ticket_manage_finance_denied');
        }
    }

    public function authorizeReconcileTickets(User $actor, Event $event): void
    {
        if (! $this->policy->reconcileTickets($actor, $event)) {
            throw new EventTicketingException('event_ticket_reconciliation_denied');
        }
    }

    public function authorizeView(User $actor, Event $event): void
    {
        if (! $this->policy->view($actor, $event)) {
            throw new EventTicketingException('event_ticket_view_denied');
        }
    }

    public function eventTimezone(Event $event): string
    {
        $timezone = trim((string) ($event->getRawOriginal('timezone') ?: 'UTC'));
        if (! in_array($timezone, timezone_identifiers_list(), true)) {
            throw new EventTicketingException('event_ticket_event_timezone_invalid');
        }

        return $timezone;
    }

    public function eventStart(Event $event): CarbonImmutable
    {
        $raw = $event->getRawOriginal('start_time');
        if (! is_string($raw) || trim($raw) === '') {
            throw new EventTicketingException('event_ticket_event_start_invalid');
        }
        try {
            return CarbonImmutable::parse($raw, 'UTC')->utc();
        } catch (Throwable) {
            throw new EventTicketingException('event_ticket_event_start_invalid');
        }
    }

    /**
     * @param string|null $field The input being checked, so an offset
     *                           mismatch can name it to the organiser.
     */
    public function inputInstant(
        mixed $value,
        string $timezone,
        string $reason,
        ?string $field = null,
    ): ?CarbonImmutable {
        if ($value === null || $value === '') {
            return null;
        }
        if (! $value instanceof DateTimeInterface
            && (! is_string($value)
                || preg_match(
                    '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/',
                    trim($value),
                ) !== 1)) {
            throw new EventTicketingException($reason);
        }
        try {
            $instant = $value instanceof DateTimeInterface
                ? CarbonImmutable::instance($value)
                : CarbonImmutable::parse(trim($value));
        } catch (Throwable) {
            throw new EventTicketingException($reason);
        }
        if ($instant->getOffset() !== $instant->setTimezone($timezone)->getOffset()) {
            throw new EventTicketingException('event_ticket_timezone_offset_mismatch', field: $field);
        }

        return $instant->utc();
    }

    public function idempotencyHash(string $key): string
    {
        $key = trim($key);
        if ($key === '' || strlen($key) > 512) {
            throw new EventTicketingException('event_ticket_idempotency_key_invalid');
        }

        return hash('sha256', $key);
    }

    /** @param array<string|int,mixed> $payload */
    public function requestHash(array $payload): string
    {
        return hash('sha256', json_encode(
            $this->canonicalize($payload),
            JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
        ));
    }

    public function creditCents(mixed $value): int
    {
        if (is_int($value)) {
            $normalized = (string) $value;
        } elseif (is_float($value)) {
            $normalized = rtrim(rtrim(number_format($value, 2, '.', ''), '0'), '.');
        } elseif (is_string($value)) {
            $normalized = trim($value);
        } else {
            throw new EventTicketingException('event_ticket_credit_price_invalid');
        }
        if (preg_match('/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/', $normalized) !== 1) {
            throw new EventTicketingException('event_ticket_credit_price_invalid');
        }
        [$whole, $fraction] = array_pad(explode('.', $normalized, 2), 2, '');
        $cents = ((int) $whole * 100) + (int) str_pad($fraction, 2, '0');
        if ($cents < 0 || $cents > 10_000_000) {
            throw new EventTicketingException('event_ticket_credit_price_invalid');
        }

        return $cents;
    }

    public function credits(int $cents): string
    {
        if ($cents < 0) {
            throw new EventTicketingException('event_ticket_credit_price_invalid');
        }

        return sprintf('%d.%02d', intdiv($cents, 100), $cents % 100);
    }

    public function confirmedUnits(int $tenantId, int $eventId, int $ticketTypeId): int
    {
        return (int) DB::table('event_ticket_entitlements')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('ticket_type_id', $ticketTypeId)
            ->where('status', 'confirmed')
            ->sum('units');
    }

    private function canonicalize(mixed $value): mixed
    {
        if (! is_array($value)) {
            if ($value instanceof DateTimeInterface) {
                return CarbonImmutable::instance($value)->utc()->format('Y-m-d\TH:i:s.u\Z');
            }

            return $value;
        }
        if (! array_is_list($value)) {
            ksort($value);
        }
        foreach ($value as $key => $item) {
            $value[$key] = $this->canonicalize($item);
        }

        return $value;
    }
}
