<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Enums\EventOfflineSyncOutcome;
use App\Exceptions\EventOfflineCheckinException;
use App\Models\Event;
use App\Models\EventOfflineSyncBatch;
use App\Models\User;
use App\Policies\EventPolicy;
use Illuminate\Support\Facades\DB;

/** Private, secret-free organizer projection for offline check-in operations. */
final class EventOfflineCheckinProjectionService
{
    public function __construct(private readonly EventPolicy $policy)
    {
    }

    /** @return array<string,mixed> */
    public function workspace(int $eventId, User $actor): array
    {
        [$tenantId, $event] = $this->authorize($eventId, $actor);
        $devices = DB::table('event_checkin_devices')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->orderByDesc('registered_at')
            ->orderByDesc('id')
            ->get([
                'id',
                'public_id',
                'label',
                'registered_by_user_id',
                'device_version',
                'status',
                'registered_at',
                'expires_at',
                'rotated_at',
                'revoked_at',
                'revocation_reason',
            ])
            ->map(static fn (object $device): array => [
                'id' => (int) $device->id,
                'public_id' => (string) $device->public_id,
                'label' => (string) $device->label,
                'registered_by_user_id' => (int) $device->registered_by_user_id,
                'version' => (int) $device->device_version,
                'status' => (string) $device->status,
                'registered_at' => (string) $device->registered_at,
                'expires_at' => (string) $device->expires_at,
                'rotated_at' => is_string($device->rotated_at) ? $device->rotated_at : null,
                'revoked_at' => is_string($device->revoked_at) ? $device->revoked_at : null,
                'revocation_reason' => is_string($device->revocation_reason)
                    ? $device->revocation_reason
                    : null,
            ])
            ->values()
            ->all();
        $batches = DB::table('event_offline_sync_batches')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->orderByDesc('id')
            ->limit(50)
            ->get([
                'id',
                'device_id',
                'client_batch_id',
                'manifest_version',
                'item_count',
                'status',
                'accepted_count',
                'conflict_count',
                'rejected_count',
                'created_at',
                'completed_at',
                'dead_lettered_at',
                'terminal_code',
            ])
            ->map(static fn (object $batch): array => [
                'id' => (int) $batch->id,
                'device_id' => (int) $batch->device_id,
                'client_batch_id' => (string) $batch->client_batch_id,
                'manifest_version' => (int) $batch->manifest_version,
                'item_count' => (int) $batch->item_count,
                'status' => (string) $batch->status,
                'counts' => [
                    'synced' => (int) $batch->accepted_count,
                    'conflict' => (int) $batch->conflict_count,
                    'rejected' => (int) $batch->rejected_count,
                    'pending' => max(
                        0,
                        (int) $batch->item_count
                            - (int) $batch->accepted_count
                            - (int) $batch->conflict_count
                            - (int) $batch->rejected_count,
                    ),
                ],
                'created_at' => (string) $batch->created_at,
                'completed_at' => is_string($batch->completed_at)
                    ? $batch->completed_at
                    : null,
                'dead_lettered_at' => is_string($batch->dead_lettered_at)
                    ? $batch->dead_lettered_at
                    : null,
                'terminal_code' => is_string($batch->terminal_code)
                    ? $batch->terminal_code
                    : null,
            ])
            ->values()
            ->all();

        return [
            'contract_version' => 1,
            'event_id' => $eventId,
            'occurrence_key' => (string) $event->occurrence_key,
            'manifest_version' => (int) $event->checkin_manifest_version,
            'limits' => [
                'replay_window_minutes' => max(
                    1,
                    (int) config('event_checkin.offline_replay_window_minutes', 1440),
                ),
                'batch_max_items' => min(
                    500,
                    max(1, (int) config('event_checkin.sync_batch_max_items', 500)),
                ),
            ],
            'devices' => $devices,
            'recent_batches' => $batches,
            'open_conflicts' => $this->openConflictCount($tenantId, $eventId),
            'permissions' => [
                'manage_devices' => true,
                'download_manifest' => true,
                'sync_offline_queue' => true,
                'resolve_conflicts' => true,
                'manual_fallback_required' => true,
            ],
            'privacy' => [
                'device_secrets_redacted' => true,
                'credential_secrets_redacted' => true,
                'contact_fields_redacted' => true,
                'wallet_effects_supported' => false,
            ],
        ];
    }

    /** @return array<string,mixed> */
    public function batchByClientId(int $eventId, int $deviceId, string $clientBatchId, User $actor): array
    {
        [$tenantId] = $this->authorize($eventId, $actor);
        $batchId = DB::table('event_offline_sync_batches')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('device_id', $deviceId)
            ->where('client_batch_id', $clientBatchId)
            ->value('id');
        if ($batchId === null) {
            throw new EventOfflineCheckinException('event_offline_batch_not_found');
        }

        return $this->batch($eventId, (int) $batchId, $actor);
    }

    /** @return array<string,mixed> */
    public function batchByNonce(int $eventId, int $deviceId, string $nonce, User $actor): array
    {
        [$tenantId] = $this->authorize($eventId, $actor);
        $batchId = DB::table('event_offline_sync_items as item')
            ->join('event_offline_sync_batches as batch', 'batch.id', '=', 'item.batch_id')
            ->where('item.tenant_id', $tenantId)
            ->where('item.event_id', $eventId)
            ->where('batch.tenant_id', $tenantId)
            ->where('batch.event_id', $eventId)
            ->where('batch.device_id', $deviceId)
            ->where('item.client_nonce', $nonce)
            ->value('batch.id');
        if ($batchId === null) {
            throw new EventOfflineCheckinException('event_offline_batch_not_found');
        }

        return $this->batch($eventId, (int) $batchId, $actor);
    }

    /** @return array<string,mixed> */
    public function batch(int $eventId, int $batchId, User $actor): array
    {
        [$tenantId] = $this->authorize($eventId, $actor);
        /** @var EventOfflineSyncBatch|null $batch */
        $batch = EventOfflineSyncBatch::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->whereKey($batchId)
            ->first();
        if ($batch === null) {
            throw new EventOfflineCheckinException('event_offline_batch_not_found');
        }
        $latestVersions = DB::table('event_offline_sync_decisions')
            ->select('tenant_id', 'item_id')
            ->selectRaw('MAX(decision_version) AS latest_version')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('batch_id', $batchId)
            ->groupBy('tenant_id', 'item_id');
        $items = DB::table('event_offline_sync_items as item')
            ->leftJoinSub($latestVersions, 'latest', static function ($join): void {
                $join->on('latest.tenant_id', '=', 'item.tenant_id')
                    ->on('latest.item_id', '=', 'item.id');
            })
            ->leftJoin('event_offline_sync_decisions as decision', static function ($join): void {
                $join->on('decision.tenant_id', '=', 'latest.tenant_id')
                    ->on('decision.item_id', '=', 'latest.item_id')
                    ->on('decision.decision_version', '=', 'latest.latest_version');
            })
            ->where('item.tenant_id', $tenantId)
            ->where('item.event_id', $eventId)
            ->where('item.batch_id', $batchId)
            ->orderBy('item.item_position')
            ->get([
                'item.id',
                'item.item_position',
                'item.client_nonce',
                'item.operation',
                'item.observed_at',
                'item.expected_attendance_version',
                'decision.decision_version',
                'decision.outcome',
                'decision.decision_code',
                'decision.decision_reason',
                'decision.created_at as decided_at',
            ])
            ->map(static function (object $item): array {
                $outcome = is_string($item->outcome) ? $item->outcome : 'pending';

                return [
                    'id' => (int) $item->id,
                    'position' => (int) $item->item_position,
                    'client_nonce' => (string) $item->client_nonce,
                    'operation' => (string) $item->operation,
                    'observed_at' => (string) $item->observed_at,
                    'expected_attendance_version' => (int) $item->expected_attendance_version,
                    'state' => $outcome === EventOfflineSyncOutcome::Accepted->value
                        ? 'synced'
                        : $outcome,
                    'decision_version' => $item->decision_version !== null
                        ? (int) $item->decision_version
                        : null,
                    'code' => is_string($item->decision_code)
                        ? $item->decision_code
                        : null,
                    'reason' => is_string($item->decision_reason)
                        ? $item->decision_reason
                        : null,
                    'decided_at' => is_string($item->decided_at)
                        ? $item->decided_at
                        : null,
                ];
            })
            ->values()
            ->all();

        return [
            'contract_version' => 1,
            'event_id' => $eventId,
            'batch' => [
                'id' => (int) $batch->id,
                'client_batch_id' => (string) $batch->client_batch_id,
                'status' => $batch->status->value,
                'item_count' => (int) $batch->item_count,
                'accepted_count' => (int) $batch->accepted_count,
                'conflict_count' => (int) $batch->conflict_count,
                'rejected_count' => (int) $batch->rejected_count,
                'created_at' => $batch->created_at?->toIso8601String(),
                'completed_at' => $batch->completed_at?->toIso8601String(),
            ],
            'items' => $items,
            'privacy' => [
                'credential_redacted' => true,
                'attendee_identity_redacted' => true,
            ],
        ];
    }

    /** @return array{int,Event} */
    private function authorize(int $eventId, User $actor): array
    {
        $tenantId = TenantContext::currentId();
        if ($tenantId === null || $tenantId <= 0) {
            throw new EventOfflineCheckinException('event_checkin_tenant_context_missing');
        }
        /** @var User|null $persisted */
        $persisted = User::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey((int) $actor->id)
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->first();
        /** @var Event|null $event */
        $event = Event::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($eventId)
            ->first();
        if ($persisted === null || $event === null
            || ! $this->policy->manageAttendance($persisted, $event)) {
            throw new EventOfflineCheckinException('event_checkin_authorization_denied');
        }

        return [$tenantId, $event];
    }

    private function openConflictCount(int $tenantId, int $eventId): int
    {
        $latest = DB::table('event_offline_sync_decisions')
            ->select('tenant_id', 'item_id')
            ->selectRaw('MAX(decision_version) AS latest_version')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->groupBy('tenant_id', 'item_id');

        return DB::table('event_offline_sync_decisions as decision')
            ->joinSub($latest, 'latest', static function ($join): void {
                $join->on('latest.tenant_id', '=', 'decision.tenant_id')
                    ->on('latest.item_id', '=', 'decision.item_id')
                    ->on('latest.latest_version', '=', 'decision.decision_version');
            })
            ->where('decision.tenant_id', $tenantId)
            ->where('decision.event_id', $eventId)
            ->where('decision.outcome', EventOfflineSyncOutcome::Conflict->value)
            ->count();
    }
}
