<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Events;

use App\Core\TenantContext;
use App\Exceptions\EventBroadcastException;
use App\Models\Event;
use App\Models\User;
use App\Policies\EventPolicy;
use App\Services\EventConfigurationService;
use Illuminate\Support\Facades\Schema;
use Throwable;
use App\Support\Authorization\CrossTenantEntry;

/** Shared tenant, authorization, validation, and hashing boundary for broadcasts. */
final class EventBroadcastFoundationSupport
{
    public const MAX_BODY_LENGTH = 20_000;

    /** @var list<string> */
    public const TABLES = [
        'event_broadcasts',
        'event_broadcast_history',
        'event_broadcast_deliveries',
        'event_broadcast_delivery_attempts',
        'event_registrations',
        'event_waitlist_entries',
        'event_attendance',
    ];

    /** @var array<string,list<string>> */
    private const REQUIRED_COLUMNS = [
        'event_broadcasts' => [
            'id', 'tenant_id', 'event_id', 'occurrence_key', 'variant', 'status',
            'broadcast_version', 'audience_segments', 'channels', 'body', 'content_hash',
            'scheduled_at', 'recipient_count', 'delivery_count', 'delivered_count',
            'suppressed_count', 'dead_letter_count',
        ],
        'event_broadcast_history' => [
            'id', 'tenant_id', 'event_id', 'broadcast_id', 'broadcast_version',
            'action', 'from_status', 'to_status', 'idempotency_hash', 'request_hash',
            'content_hash', 'metadata', 'created_at',
        ],
        'event_broadcast_deliveries' => [
            'id', 'tenant_id', 'event_id', 'broadcast_id', 'frozen_broadcast_version',
            'recipient_user_id', 'channel', 'delivery_key', 'status', 'attempts',
            'available_at', 'next_attempt_at', 'claim_token', 'claimed_at',
        ],
        'event_broadcast_delivery_attempts' => [
            'id', 'tenant_id', 'event_id', 'broadcast_id', 'delivery_id',
            'attempt_number', 'outcome', 'provider', 'provider_evidence_id',
            'reason_code', 'metadata', 'created_at',
        ],
        'event_registrations' => ['tenant_id', 'event_id', 'user_id', 'registration_state'],
        'event_waitlist_entries' => ['tenant_id', 'event_id', 'user_id', 'queue_state', 'offer_expires_at'],
        'event_attendance' => ['tenant_id', 'event_id', 'user_id', 'attendance_status'],
    ];

    public function assertSchema(): void
    {
        foreach (self::TABLES as $table) {
            if (! Schema::hasTable($table)
                || ! Schema::hasColumns($table, self::REQUIRED_COLUMNS[$table] ?? [])) {
                throw new EventBroadcastException('event_broadcast_schema_unavailable');
            }
        }
    }

    public function tenantId(): int
    {
        $tenantId = TenantContext::currentId();
        if ($tenantId === null || $tenantId <= 0) {
            throw new EventBroadcastException('event_broadcast_tenant_context_missing');
        }

        try {
            if (! TenantContext::hasFeature('events')) {
                throw new EventBroadcastException('event_broadcast_feature_disabled');
            }
        } catch (EventBroadcastException $exception) {
            throw $exception;
        } catch (Throwable) {
            throw new EventBroadcastException('event_broadcast_feature_unavailable');
        }

        return $tenantId;
    }

    public function assertCreationEnabled(int $tenantId): void
    {
        if (! (bool) app(EventConfigurationService::class)->value(
            'organizer_broadcasts_enabled',
            true,
            $tenantId,
        )) {
            throw new EventBroadcastException('event_broadcast_feature_disabled');
        }
    }

    public function event(int $tenantId, int $eventId, bool $lock = false): Event
    {
        $query = Event::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($eventId)
            ->where('is_recurring_template', false)
            ->whereNotNull('occurrence_key')
            ->where('occurrence_key', '<>', '');
        if ($lock) {
            $query->lockForUpdate();
        }
        $event = $query->first();
        if ($event === null) {
            throw new EventBroadcastException('event_broadcast_event_not_found');
        }

        return $event;
    }

    public function actor(int $tenantId, User|int $actor, bool $lock = false): User
    {
        $actorId = $actor instanceof User ? (int) $actor->getKey() : $actor;
        $query = User::withoutGlobalScopes()
            ->whereKey($actorId)
            ->where('status', 'active')
            ->whereNull('deleted_at');
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
        if ($persisted === null) {
            throw new EventBroadcastException('event_broadcast_actor_invalid');
        }

        return $persisted;
    }

    public function authorize(User $actor, Event $event): void
    {
        if (! app(EventPolicy::class)->broadcast($actor, $event)) {
            throw new EventBroadcastException('event_broadcast_authorization_denied');
        }
    }

    public function body(string $body): string
    {
        if (trim($body) === '' || mb_strlen($body) > self::MAX_BODY_LENGTH) {
            throw new EventBroadcastException('event_broadcast_body_invalid');
        }

        // Do not trim, normalize, translate, or otherwise mutate organizer prose.
        return $body;
    }

    public function idempotencyHash(string $key): string
    {
        $key = trim($key);
        if ($key === '' || mb_strlen($key) > 191) {
            throw new EventBroadcastException('event_broadcast_idempotency_key_invalid');
        }

        return hash('sha256', 'event-broadcast:v1:' . $key);
    }

    /** @param array<string,mixed> $payload */
    public function requestHash(array $payload): string
    {
        return hash('sha256', json_encode(
            self::canonicalize($payload),
            JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
        ));
    }

    /** @return array<mixed> */
    private static function canonicalize(array $value): array
    {
        if (! array_is_list($value)) {
            ksort($value);
        }
        foreach ($value as $key => $item) {
            if (is_array($item)) {
                $value[$key] = self::canonicalize($item);
            }
        }

        return $value;
    }
}
