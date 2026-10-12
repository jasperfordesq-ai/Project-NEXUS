<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Enums\EventParticipationDecision;
use App\Enums\EventParticipationDenialAction;
use App\Enums\EventParticipationDenialReason;
use App\Enums\EventParticipationDenialStatus;
use App\Exceptions\EventSafetyException;
use App\Models\EventParticipationDenial;
use App\Models\EventParticipationDenialHistory;
use App\Models\User;
use App\Support\Events\EventSafetyFoundationSupport;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Reviewed safety decisions only; it never mutates participation or communications. */
final class EventParticipationDenialService
{
    public function __construct(
        private readonly EventSafetyFoundationSupport $support = new EventSafetyFoundationSupport(),
    ) {
    }

    /** @return array{denial:EventParticipationDenial,changed:bool} */
    public function record(
        int $eventId,
        User|int $user,
        User|int $reviewer,
        EventParticipationDecision $decision,
        EventParticipationDenialReason $reason,
        DateTimeInterface $effectiveFrom,
        ?DateTimeInterface $effectiveUntil,
        ?int $expectedVersion,
        string $idempotencyKey,
    ): array {
        $this->assertSchema();
        $tenantId = $this->support->tenantId();
        $idempotencyHash = $this->support->idempotencyHash($idempotencyKey);
        $from = CarbonImmutable::instance($effectiveFrom)->utc();
        $until = $effectiveUntil !== null
            ? CarbonImmutable::instance($effectiveUntil)->utc()
            : null;
        if ($until !== null && ! $until->greaterThan($from)) {
            throw new EventSafetyException('event_participation_denial_window_invalid');
        }

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $user,
            $reviewer,
            $decision,
            $reason,
            $from,
            $until,
            $expectedVersion,
            $idempotencyHash,
        ): array {
            $event = $this->support->concreteEvent($tenantId, $eventId, true);
            $persistedUser = $this->support->activeUser($tenantId, $user, true);
            $persistedReviewer = $this->support->activeActor(
                $tenantId,
                $reviewer,
                true,
                'event_safety_actor_not_active',
            );
            $this->support->authorizeManager($persistedReviewer, $event);
            $existing = EventParticipationDenial::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('user_id', (int) $persistedUser->id)
                ->where('active_slot', 1)
                ->lockForUpdate()
                ->first();
            $requestHash = $this->support->requestHash([
                'action' => EventParticipationDenialAction::Recorded->value,
                'event_id' => $eventId,
                'user_id' => (int) $persistedUser->id,
                'reviewer_user_id' => (int) $persistedReviewer->id,
                'decision' => $decision->value,
                'reason_code' => $reason->value,
                'effective_from' => $from,
                'effective_until' => $until,
                'expected_version' => $expectedVersion,
            ]);
            $replay = $this->historyReplay(
                $tenantId,
                $idempotencyHash,
                EventParticipationDenialAction::Recorded,
                $requestHash,
                true,
            );
            if ($replay !== null) {
                return [
                    'denial' => $this->denialModel($tenantId, (int) $replay->denial_id),
                    'changed' => false,
                ];
            }
            $now = CarbonImmutable::now('UTC');
            if ($existing === null) {
                if ($expectedVersion !== null && $expectedVersion !== 0) {
                    throw new EventSafetyException('event_participation_denial_version_conflict');
                }
                $version = 1;
                $denialId = (int) DB::table('event_participation_denials')->insertGetId([
                    'tenant_id' => $tenantId,
                    'event_id' => $eventId,
                    'occurrence_key' => (string) $event->getRawOriginal('occurrence_key'),
                    'user_id' => (int) $persistedUser->id,
                    'decision' => $decision->value,
                    'reason_code' => $reason->value,
                    'status' => EventParticipationDenialStatus::Active->value,
                    'active_slot' => 1,
                    'decision_version' => $version,
                    'reviewed_by_user_id' => (int) $persistedReviewer->id,
                    'effective_from' => $from,
                    'effective_until' => $until,
                    'create_idempotency_hash' => $idempotencyHash,
                    'create_request_hash' => $requestHash,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            } else {
                if ($expectedVersion === null
                    || $expectedVersion !== (int) $existing->decision_version) {
                    throw new EventSafetyException('event_participation_denial_version_conflict');
                }
                $version = $expectedVersion + 1;
                $denialId = (int) $existing->id;
                $updated = DB::table('event_participation_denials')
                    ->where('tenant_id', $tenantId)
                    ->where('id', $denialId)
                    ->where('status', EventParticipationDenialStatus::Active->value)
                    ->where('decision_version', $expectedVersion)
                    ->update([
                        'decision' => $decision->value,
                        'reason_code' => $reason->value,
                        'decision_version' => $version,
                        'reviewed_by_user_id' => (int) $persistedReviewer->id,
                        'effective_from' => $from,
                        'effective_until' => $until,
                        'updated_at' => $now,
                    ]);
                if ($updated !== 1) {
                    throw new EventSafetyException('event_participation_denial_version_conflict');
                }
            }
            $this->insertHistory(
                $tenantId,
                $eventId,
                $denialId,
                (int) $persistedUser->id,
                $version,
                $decision,
                $reason,
                EventParticipationDenialStatus::Active,
                EventParticipationDenialAction::Recorded,
                (int) $persistedReviewer->id,
                $from,
                $until,
                $idempotencyHash,
                $requestHash,
                $now,
            );

            return [
                'denial' => $this->denialModel($tenantId, $denialId),
                'changed' => true,
            ];
        }, 3);
    }

    /** @return array{denial:EventParticipationDenial,changed:bool} */
    public function withdraw(
        int $eventId,
        int $denialId,
        User|int $reviewer,
        int $expectedVersion,
        string $idempotencyKey,
    ): array {
        return $this->terminalTransition(
            $eventId,
            $denialId,
            $reviewer,
            $expectedVersion,
            EventParticipationDenialAction::Withdrawn,
            $idempotencyKey,
        );
    }

    /** @return array{denial:EventParticipationDenial,changed:bool} */
    public function expire(
        int $eventId,
        int $denialId,
        User|int $reviewer,
        int $expectedVersion,
        string $idempotencyKey,
    ): array {
        return $this->terminalTransition(
            $eventId,
            $denialId,
            $reviewer,
            $expectedVersion,
            EventParticipationDenialAction::Expired,
            $idempotencyKey,
        );
    }

    /** @return array{denial:EventParticipationDenial,changed:bool} */
    private function terminalTransition(
        int $eventId,
        int $denialId,
        User|int $reviewer,
        int $expectedVersion,
        EventParticipationDenialAction $action,
        string $idempotencyKey,
    ): array {
        $this->assertSchema();
        $tenantId = $this->support->tenantId();
        $idempotencyHash = $this->support->idempotencyHash($idempotencyKey);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $denialId,
            $reviewer,
            $expectedVersion,
            $action,
            $idempotencyHash,
        ): array {
            $event = $this->support->concreteEvent($tenantId, $eventId, true);
            $persistedReviewer = $this->support->activeActor(
                $tenantId,
                $reviewer,
                true,
                'event_safety_actor_not_active',
            );
            $this->support->authorizeManager($persistedReviewer, $event);
            $denial = EventParticipationDenial::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->whereKey($denialId)
                ->lockForUpdate()
                ->first();
            if ($denial === null) {
                throw new EventSafetyException('event_participation_denial_not_found');
            }
            $this->support->activeUser($tenantId, (int) $denial->user_id, true);
            $requestHash = $this->support->requestHash([
                'action' => $action->value,
                'event_id' => $eventId,
                'denial_id' => $denialId,
                'reviewer_user_id' => (int) $persistedReviewer->id,
                'expected_version' => $expectedVersion,
            ]);
            $replay = $this->historyReplay(
                $tenantId,
                $idempotencyHash,
                $action,
                $requestHash,
                true,
            );
            if ($replay !== null) {
                return ['denial' => $this->denialModel($tenantId, $denialId), 'changed' => false];
            }
            if ((string) $denial->getRawOriginal('status')
                    !== EventParticipationDenialStatus::Active->value
                || (int) $denial->decision_version !== $expectedVersion) {
                throw new EventSafetyException('event_participation_denial_version_conflict');
            }
            if ($action === EventParticipationDenialAction::Expired
                && ($denial->effective_until === null
                    || $denial->effective_until->isFuture())) {
                throw new EventSafetyException('event_participation_denial_not_expired');
            }
            $status = $action === EventParticipationDenialAction::Withdrawn
                ? EventParticipationDenialStatus::Withdrawn
                : EventParticipationDenialStatus::Expired;
            $version = $expectedVersion + 1;
            $now = CarbonImmutable::now('UTC');
            $updates = [
                'status' => $status->value,
                'active_slot' => null,
                'decision_version' => $version,
                'updated_at' => $now,
            ];
            if ($status === EventParticipationDenialStatus::Withdrawn) {
                $updates += [
                    'withdrawn_by_user_id' => (int) $persistedReviewer->id,
                    'withdrawn_at' => $now,
                ];
            } else {
                $updates += [
                    'expired_by_user_id' => (int) $persistedReviewer->id,
                    'expired_at' => $now,
                ];
            }
            $updated = DB::table('event_participation_denials')
                ->where('tenant_id', $tenantId)
                ->where('id', $denialId)
                ->where('status', EventParticipationDenialStatus::Active->value)
                ->where('decision_version', $expectedVersion)
                ->update($updates);
            if ($updated !== 1) {
                throw new EventSafetyException('event_participation_denial_version_conflict');
            }
            $this->insertHistory(
                $tenantId,
                $eventId,
                $denialId,
                (int) $denial->user_id,
                $version,
                EventParticipationDecision::from((string) $denial->getRawOriginal('decision')),
                EventParticipationDenialReason::from((string) $denial->getRawOriginal('reason_code')),
                $status,
                $action,
                (int) $persistedReviewer->id,
                $denial->effective_from,
                $denial->effective_until,
                $idempotencyHash,
                $requestHash,
                $now,
            );

            return ['denial' => $this->denialModel($tenantId, $denialId), 'changed' => true];
        }, 3);
    }

    private function historyReplay(
        int $tenantId,
        string $idempotencyHash,
        EventParticipationDenialAction $action,
        string $requestHash,
        bool $lock,
    ): ?EventParticipationDenialHistory {
        $query = EventParticipationDenialHistory::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('idempotency_hash', $idempotencyHash);
        if ($lock) {
            $query->lockForUpdate();
        }
        $history = $query->first();
        if ($history === null) {
            return null;
        }
        if ((string) $history->getRawOriginal('action') !== $action->value
            || ! hash_equals((string) $history->request_hash, $requestHash)) {
            throw new EventSafetyException('event_safety_idempotency_conflict');
        }

        return $history;
    }

    private function insertHistory(
        int $tenantId,
        int $eventId,
        int $denialId,
        int $userId,
        int $version,
        EventParticipationDecision $decision,
        EventParticipationDenialReason $reason,
        EventParticipationDenialStatus $status,
        EventParticipationDenialAction $action,
        int $reviewerId,
        CarbonImmutable $from,
        ?CarbonImmutable $until,
        string $idempotencyHash,
        string $requestHash,
        CarbonImmutable $now,
    ): void {
        DB::table('event_participation_denial_history')->insert([
            'tenant_id' => $tenantId,
            'event_id' => $eventId,
            'denial_id' => $denialId,
            'user_id' => $userId,
            'decision_version' => $version,
            'decision' => $decision->value,
            'reason_code' => $reason->value,
            'status' => $status->value,
            'action' => $action->value,
            'reviewer_user_id' => $reviewerId,
            'effective_from' => $from,
            'effective_until' => $until,
            'idempotency_hash' => $idempotencyHash,
            'request_hash' => $requestHash,
            'created_at' => $now,
        ]);
    }

    private function denialModel(int $tenantId, int $id): EventParticipationDenial
    {
        return EventParticipationDenial::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->findOrFail($id);
    }

    private function assertSchema(): void
    {
        foreach ([
            'event_participation_denials',
            'event_participation_denial_history',
        ] as $table) {
            if (! Schema::hasTable($table)) {
                throw new EventSafetyException('event_safety_schema_unavailable');
            }
        }
    }
}
