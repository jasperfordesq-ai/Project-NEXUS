<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Exceptions\EventLifecycleHistoryException;
use App\Models\Event;
use App\Models\EventStatusHistory;
use App\Models\User;
use App\Policies\EventPolicy;
use App\Support\Events\EventLifecycleHistoryCursor;
use Illuminate\Support\Facades\Schema;

/** Tenant-safe, policy-scoped query boundary for immutable Event lifecycle history. */
final class EventLifecycleHistoryQueryService
{
    private readonly EventPolicy $policy;

    public function __construct(?EventPolicy $policy = null)
    {
        $this->policy = $policy ?? new EventPolicy();
    }

    /**
     * @return array{
     *   event:Event,
     *   items:list<EventStatusHistory>,
     *   meta:array{per_page:int,next_cursor:?string,has_more:bool}
     * }
     */
    public function index(
        int $eventId,
        User|int $actor,
        ?string $cursor = null,
        int $perPage = 20,
    ): array {
        $tenantId = TenantContext::currentId();
        if ($tenantId === null || $tenantId <= 0) {
            throw new EventLifecycleHistoryException('event_lifecycle_history_tenant_context_missing');
        }
        if (! Schema::hasTable('event_status_history')) {
            throw new EventLifecycleHistoryException('event_lifecycle_history_schema_unavailable');
        }
        if ($eventId <= 0) {
            throw new EventLifecycleHistoryException('event_lifecycle_history_event_not_found');
        }

        /** @var Event|null $event */
        $event = Event::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($eventId)
            ->first();
        if ($event === null) {
            throw new EventLifecycleHistoryException('event_lifecycle_history_event_not_found');
        }

        $actorId = $actor instanceof User ? (int) $actor->getKey() : $actor;
        /** @var User|null $persistedActor */
        $persistedActor = User::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($actorId)
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->first();
        if ($persistedActor === null || ! $this->policy->manage($persistedActor, $event)) {
            throw new EventLifecycleHistoryException('event_lifecycle_history_authorization_denied');
        }

        $perPage = max(1, min(100, $perPage));
        $cursorId = $cursor === null
            ? null
            : EventLifecycleHistoryCursor::decode($cursor, $eventId);

        $query = EventStatusHistory::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->with(['actor' => static function ($query) use ($tenantId): void {
                $query->withoutGlobalScopes()
                    ->where('tenant_id', $tenantId)
                    ->select(['id', 'tenant_id', 'first_name', 'last_name', 'profile_type', 'organization_name']);
            }])
            ->orderByDesc('id');
        if ($cursorId !== null) {
            $query->where('id', '<', $cursorId);
        }

        $history = $query->limit($perPage + 1)->get();
        $hasMore = $history->count() > $perPage;
        $items = $history->take($perPage)->values();
        $last = $items->last();

        return [
            'event' => $event,
            'items' => $items->all(),
            'meta' => [
                'per_page' => $perPage,
                'next_cursor' => $hasMore && $last instanceof EventStatusHistory
                    ? EventLifecycleHistoryCursor::encode($eventId, (int) $last->getKey())
                    : null,
                'has_more' => $hasMore,
            ],
        ];
    }
}
