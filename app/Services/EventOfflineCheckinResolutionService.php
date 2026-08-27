<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Enums\EventAttendanceAction;
use App\Enums\EventOfflineSyncOutcome;
use App\Exceptions\EventAttendanceException;
use App\Exceptions\EventOfflineCheckinException;
use App\Models\Event;
use App\Models\EventOfflineSyncDecision;
use App\Models\EventOfflineSyncItem;
use App\Models\User;
use App\Policies\EventPolicy;
use App\Support\Events\EventCheckinSecurity;
use App\Support\Events\EventOfflineSyncDecisionResult;
use Illuminate\Support\Facades\DB;
use App\Support\UserDisplayName;

/** Organizer-only projection and append-only resolution of offline conflicts. */
final class EventOfflineCheckinResolutionService
{
    public function __construct(
        private readonly EventOfflineCheckinSyncService $sync,
        private readonly EventAttendanceService $attendance,
        private readonly EventPolicy $policy,
    ) {
    }

    /**
     * @return array{items:list<array<string,mixed>>,total:int,page:int,per_page:int,privacy:array<string,bool>}
     */
    public function conflicts(
        int $eventId,
        User $actor,
        int $page = 1,
        int $perPage = 25,
    ): array {
        [$tenantId] = $this->authorize($eventId, $actor);
        $page = max(1, $page);
        $perPage = max(1, min(100, $perPage));
        $latestVersions = DB::table('event_offline_sync_decisions')
            ->select('tenant_id', 'item_id')
            ->selectRaw('MAX(decision_version) AS latest_version')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->groupBy('tenant_id', 'item_id');
        $base = DB::table('event_offline_sync_decisions as decision')
            ->joinSub($latestVersions, 'latest', static function ($join): void {
                $join->on('latest.tenant_id', '=', 'decision.tenant_id')
                    ->on('latest.item_id', '=', 'decision.item_id')
                    ->on('latest.latest_version', '=', 'decision.decision_version');
            })
            ->join('event_offline_sync_items as item', static function ($join): void {
                $join->on('item.tenant_id', '=', 'decision.tenant_id')
                    ->on('item.event_id', '=', 'decision.event_id')
                    ->on('item.id', '=', 'decision.item_id');
            })
            ->join('event_offline_sync_batches as batch', static function ($join): void {
                $join->on('batch.tenant_id', '=', 'item.tenant_id')
                    ->on('batch.event_id', '=', 'item.event_id')
                    ->on('batch.id', '=', 'item.batch_id');
            })
            ->leftJoin('event_checkin_devices as device', static function ($join): void {
                $join->on('device.tenant_id', '=', 'batch.tenant_id')
                    ->on('device.event_id', '=', 'batch.event_id')
                    ->on('device.id', '=', 'batch.device_id');
            })
            ->leftJoin('users as member', static function ($join): void {
                $join->on('member.tenant_id', '=', 'item.tenant_id')
                    ->on('member.id', '=', 'item.user_id');
            })
            ->leftJoin('event_attendance as attendance', static function ($join): void {
                $join->on('attendance.tenant_id', '=', 'item.tenant_id')
                    ->on('attendance.event_id', '=', 'item.event_id')
                    ->on('attendance.user_id', '=', 'item.user_id');
            })
            ->where('decision.tenant_id', $tenantId)
            ->where('decision.event_id', $eventId)
            ->where('decision.outcome', EventOfflineSyncOutcome::Conflict->value);
        $total = (clone $base)->count('decision.id');
        $rows = $base
            ->orderByDesc('decision.created_at')
            ->orderByDesc('decision.id')
            ->offset(($page - 1) * $perPage)
            ->limit($perPage)
            ->get([
                'item.id as item_id',
                'item.batch_id',
                'item.user_id',
                'item.operation',
                'item.observed_at',
                'item.expected_attendance_version',
                'item.submitted_reason',
                'decision.decision_version',
                'decision.decision_code',
                'decision.created_at as decided_at',
                'batch.client_batch_id',
                'batch.device_id',
                'device.label as device_label',
                'member.name as member_name',
                'member.first_name as member_first_name',
                'member.last_name as member_last_name', 'member.profile_type as member_profile_type', 'member.organization_name as member_organization_name',
                'member.username as member_username',
                'attendance.attendance_status',
                'attendance.attendance_version',
            ]);

        $items = [];
        foreach ($rows as $row) {
            $items[] = [
                'item_id' => (int) $row->item_id,
                'batch_id' => (int) $row->batch_id,
                'client_batch_id' => (string) $row->client_batch_id,
                'member' => [
                    'id' => (int) $row->user_id,
                    'display_name' => $this->displayName($row),
                ],
                'operation' => (string) $row->operation,
                'observed_at' => (string) $row->observed_at,
                'submitted_reason' => is_string($row->submitted_reason)
                    ? $row->submitted_reason
                    : null,
                'expected_attendance_version' => (int) $row->expected_attendance_version,
                'current_attendance' => [
                    'state' => is_string($row->attendance_status)
                        ? $row->attendance_status
                        : 'not_checked_in',
                    'version' => max(0, (int) ($row->attendance_version ?? 0)),
                ],
                'conflict' => [
                    'decision_version' => (int) $row->decision_version,
                    'code' => (string) $row->decision_code,
                    'decided_at' => (string) $row->decided_at,
                ],
                'device' => [
                    'id' => (int) $row->device_id,
                    'label' => is_string($row->device_label) ? $row->device_label : null,
                ],
            ];
        }

        return [
            'items' => $items,
            'total' => $total,
            'page' => $page,
            'per_page' => $perPage,
            'privacy' => [
                'credential_redacted' => true,
                'contact_fields_redacted' => true,
                'free_text_member_profile_redacted' => true,
            ],
        ];
    }

    public function resolve(
        int $eventId,
        int $itemId,
        User $actor,
        int $expectedDecisionVersion,
        string $disposition,
        int $expectedAttendanceVersion,
        string $reason,
        string $idempotencyKey,
    ): EventOfflineSyncDecisionResult {
        [$tenantId] = $this->authorize($eventId, $actor);
        try {
            $reason = EventCheckinSecurity::sanitizedText($reason, 500, true);
        } catch (EventOfflineCheckinException) {
            throw new EventOfflineCheckinException('event_offline_resolution_reason_invalid');
        }
        if (! is_string($reason)) {
            throw new EventOfflineCheckinException('event_offline_resolution_reason_invalid');
        }
        if (! in_array($disposition, ['apply', 'reject'], true)
            || $expectedDecisionVersion <= 0 || $expectedAttendanceVersion < 0) {
            throw new EventOfflineCheckinException('event_offline_resolution_invalid');
        }

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $itemId,
            $actor,
            $expectedDecisionVersion,
            $disposition,
            $expectedAttendanceVersion,
            $reason,
            $idempotencyKey,
        ): EventOfflineSyncDecisionResult {
            /** @var EventOfflineSyncItem|null $item */
            $item = EventOfflineSyncItem::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->whereKey($itemId)
                ->lockForUpdate()
                ->first();
            if ($item === null || $item->user_id === null) {
                throw new EventOfflineCheckinException('event_offline_item_not_found');
            }
            $latest = EventOfflineSyncDecision::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('item_id', $itemId)
                ->orderByDesc('decision_version')
                ->lockForUpdate()
                ->first();
            $requestedOutcome = $disposition === 'apply'
                ? EventOfflineSyncOutcome::Accepted
                : EventOfflineSyncOutcome::Rejected;
            $requestedCode = $disposition === 'apply'
                ? 'organizer_applied_offline_transition'
                : 'organizer_kept_current_attendance';
            $idempotencyHash = EventCheckinSecurity::idempotencyHash($idempotencyKey);
            $replay = EventOfflineSyncDecision::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('idempotency_key_hash', $idempotencyHash)
                ->first();
            if ($replay !== null) {
                if ((int) $replay->item_id !== $itemId
                    || (int) $replay->decision_version !== $expectedDecisionVersion + 1
                    || $replay->outcome !== $requestedOutcome
                    || (string) $replay->decision_code !== $requestedCode
                    || (string) $replay->decision_reason !== $reason
                    || (int) $replay->attendance_version_before !== $expectedAttendanceVersion
                    || (int) $replay->decided_by_user_id !== (int) $actor->id) {
                    throw new EventOfflineCheckinException(
                        'event_offline_decision_idempotency_conflict',
                    );
                }

                return $this->sync->resolveConflict(
                    (int) $item->batch_id,
                    (int) $item->id,
                    (int) $actor->id,
                    $expectedDecisionVersion,
                    $requestedOutcome,
                    $requestedCode,
                    $reason,
                    $expectedAttendanceVersion,
                    $replay->attendance_version_after !== null
                        ? (int) $replay->attendance_version_after
                        : null,
                    $replay->attendance_activity_id !== null
                        ? (int) $replay->attendance_activity_id
                        : null,
                    $idempotencyKey,
                );
            }
            if ($latest === null
                || (int) $latest->decision_version !== $expectedDecisionVersion
                || $latest->outcome !== EventOfflineSyncOutcome::Conflict) {
                throw new EventOfflineCheckinException('event_offline_resolution_conflict');
            }

            $before = $expectedAttendanceVersion;
            $after = null;
            $activityId = null;
            $outcome = $requestedOutcome;
            $code = $requestedCode;
            if ($disposition === 'apply') {
                try {
                    $transition = $this->attendance->transition(
                        $eventId,
                        (int) $item->user_id,
                        EventAttendanceAction::from($item->operation->value),
                        $actor,
                        $expectedAttendanceVersion,
                        $reason,
                        $idempotencyKey,
                    );
                } catch (EventAttendanceException $exception) {
                    throw new EventOfflineCheckinException(
                        $exception->reasonCode === 'event_attendance_version_conflict'
                            ? 'event_offline_resolution_conflict'
                            : 'event_offline_resolution_transition_rejected',
                    );
                }
                if ($transition->activityId === null) {
                    throw new EventOfflineCheckinException(
                        'event_offline_attendance_evidence_missing',
                    );
                }
                $outcome = EventOfflineSyncOutcome::Accepted;
                $code = 'organizer_applied_offline_transition';
                $after = (int) $transition->attendance->attendance_version;
                $activityId = $transition->activityId;
            }

            return $this->sync->resolveConflict(
                (int) $item->batch_id,
                (int) $item->id,
                (int) $actor->id,
                $expectedDecisionVersion,
                $outcome,
                $code,
                $reason,
                $before,
                $after,
                $activityId,
                $idempotencyKey,
            );
        }, 3);
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
            throw new EventOfflineCheckinException('event_offline_resolution_forbidden');
        }

        return [$tenantId, $event];
    }

    private function displayName(object $row): string
    {
        $name = trim((string) ($row->member_name ?? ''));
        if ($name !== '') {
            return $name;
        }
        $full = UserDisplayName::resolvePrefixed($row, 'member_');
        if ($full !== '') {
            return $full;
        }

        return trim((string) ($row->member_username ?? ''));
    }
}
