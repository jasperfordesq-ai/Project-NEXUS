<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Enums\EventBroadcastDeliveryStatus;
use App\Exceptions\EventBroadcastException;
use App\Http\Resources\EventBroadcastHistoryResource;
use App\Http\Resources\EventBroadcastResource;
use App\Models\EventBroadcast;
use App\Models\EventBroadcastHistory;
use App\Models\User;
use App\Support\Events\EventBroadcastFoundationSupport;
use Illuminate\Support\Facades\DB;

/** Authorized organizer read model; all participant detail remains internal. */
final class EventBroadcastQueryService
{
    public function __construct(
        private readonly EventBroadcastFoundationSupport $support = new EventBroadcastFoundationSupport(),
    ) {
    }

    /** @return array{items:list<array<string,mixed>>,total:int,page:int,per_page:int} */
    public function paginateForEvent(
        int $eventId,
        User|int $actor,
        int $page = 1,
        int $perPage = 20,
        bool $includeSummary = false,
    ): array {
        $this->support->assertSchema();
        $tenantId = $this->support->tenantId();
        $event = $this->support->event($tenantId, $eventId);
        $persistedActor = $this->support->actor($tenantId, $actor);
        $this->support->authorize($persistedActor, $event);
        $page = max(1, $page);
        $perPage = max(1, min(100, $perPage));
        $query = EventBroadcast::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId);
        $total = (clone $query)->count();
        $models = $query
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->offset(($page - 1) * $perPage)
            ->limit($perPage)
            ->get();
        $summaries = $includeSummary ? $this->summaries($tenantId, $models->all()) : [];
        $items = $models
            ->map(static fn (EventBroadcast $broadcast): array => EventBroadcastResource::fromModel(
                $broadcast,
                false,
                $includeSummary ? ($summaries[(int) $broadcast->id] ?? null) : null,
            ))
            ->all();

        return [
            'items' => $items,
            'total' => $total,
            'page' => $page,
            'per_page' => $perPage,
        ];
    }

    /**
     * @return array{
     *   broadcast:array<string,mixed>,
     *   history:list<array<string,mixed>>,
     *   history_meta:array{current_page:int,per_page:int,total:int,total_pages:int,has_more:bool}
     * }
     */
    public function detail(
        int $broadcastId,
        User|int $actor,
        int $historyPage = 1,
        int $historyPerPage = 50,
        bool $includeSummary = false,
    ): array
    {
        $this->support->assertSchema();
        $tenantId = $this->support->tenantId();
        $broadcast = EventBroadcast::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($broadcastId)
            ->first();
        if ($broadcast === null) {
            throw new EventBroadcastException('event_broadcast_not_found');
        }
        $event = $this->support->event($tenantId, (int) $broadcast->event_id);
        $persistedActor = $this->support->actor($tenantId, $actor);
        $this->support->authorize($persistedActor, $event);
        $historyPage = max(1, $historyPage);
        $historyPerPage = max(1, min(100, $historyPerPage));
        $historyQuery = EventBroadcastHistory::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('broadcast_id', $broadcastId);
        $historyTotal = (clone $historyQuery)->count();
        $historyTotalPages = $historyTotal === 0
            ? 0
            : (int) ceil($historyTotal / $historyPerPage);
        $historyPage = $historyTotalPages === 0
            ? 1
            : min($historyPage, $historyTotalPages);
        $history = $historyQuery
            ->orderBy('broadcast_version')
            ->orderBy('id')
            ->offset(($historyPage - 1) * $historyPerPage)
            ->limit($historyPerPage)
            ->get()
            ->map(static fn (EventBroadcastHistory $item): array =>
                EventBroadcastHistoryResource::fromModel($item))
            ->all();

        return [
            'broadcast' => EventBroadcastResource::fromModel(
                $broadcast,
                true,
                $includeSummary ? ($this->summaries($tenantId, [$broadcast])[(int) $broadcast->id] ?? null) : null,
            ),
            'history' => $history,
            'history_meta' => [
                'current_page' => $historyPage,
                'per_page' => $historyPerPage,
                'total' => $historyTotal,
                'total_pages' => $historyTotalPages,
                'has_more' => $historyPage < $historyTotalPages,
            ],
        ];
    }

    /**
     * Aggregate, identity-free delivery reasons per broadcast (E-106): how many
     * deliveries were skipped and why, how many could not be delivered and why.
     * Counts only — never a recipient, address or provider message.
     *
     * @param list<EventBroadcast> $broadcasts
     * @return array<int,array{excerpt:?string,skipped_reasons:array<string,int>,failed_reasons:array<string,int>}>
     */
    private function summaries(int $tenantId, array $broadcasts): array
    {
        $summaries = [];
        foreach ($broadcasts as $broadcast) {
            $summaries[(int) $broadcast->id] = [
                'excerpt' => EventBroadcastResource::excerpt(
                    is_string($broadcast->body) ? $broadcast->body : null,
                ),
                'skipped_reasons' => [],
                'failed_reasons' => [],
            ];
        }
        if ($summaries === []) {
            return [];
        }
        $rows = DB::table('event_broadcast_deliveries')
            ->where('tenant_id', $tenantId)
            ->whereIn('broadcast_id', array_keys($summaries))
            ->whereIn('status', [
                EventBroadcastDeliveryStatus::Suppressed->value,
                EventBroadcastDeliveryStatus::DeadLetter->value,
            ])
            ->selectRaw('broadcast_id, status, COALESCE(suppression_reason, last_error_code) AS reason, COUNT(*) AS aggregate')
            ->groupBy('broadcast_id', 'status', 'reason')
            ->get();
        foreach ($rows as $row) {
            $id = (int) $row->broadcast_id;
            $reason = is_string($row->reason) && preg_match('/^[a-z0-9_]{1,100}$/', $row->reason) === 1
                ? $row->reason
                : 'unknown';
            $bucket = (string) $row->status === EventBroadcastDeliveryStatus::Suppressed->value
                ? 'skipped_reasons'
                : 'failed_reasons';
            $summaries[$id][$bucket][$reason] = ($summaries[$id][$bucket][$reason] ?? 0) + (int) $row->aggregate;
        }

        return $summaries;
    }
}
