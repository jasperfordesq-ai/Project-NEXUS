<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Enums\EventOfflineSyncBatchStatus;
use App\Enums\EventOfflineSyncOperation;
use App\Enums\EventOfflineSyncOutcome;
use App\Exceptions\EventOfflineCheckinException;
use App\Models\EventCheckinCredential;
use App\Models\EventOfflineSyncBatch;
use App\Models\EventOfflineSyncDecision;
use App\Models\EventOfflineSyncItem;
use App\Support\Events\EventCheckinSecurity;
use App\Support\Events\EventOfflineSyncClaim;
use App\Support\Events\EventOfflineSyncDecisionResult;
use App\Support\Events\EventOfflineSyncStageResult;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use JsonException;

/** Durable offline staging and claim ledger. It never mutates canonical attendance. */
final class EventOfflineCheckinSyncService
{
    public function __construct(private readonly EventCheckinDeviceService $devices)
    {
    }

    /**
     * @param list<array{
     *   client_nonce:string,
     *   operation:EventOfflineSyncOperation|string,
     *   observed_at:DateTimeInterface|string,
     *   expected_attendance_version:int,
     *   credential_fingerprint:string,
     *   credential_hash_reference:string,
     *   reason?:?string
     * }> $items
     */
    public function stage(
        int $eventId,
        string $deviceSecret,
        int $actorUserId,
        string $clientBatchId,
        int $manifestVersion,
        array $items,
    ): EventOfflineSyncStageResult {
        $tenantId = $this->tenantId();
        $clientBatchId = $this->clientIdentifier($clientBatchId, 'event_offline_batch_id_invalid');
        $maximum = min(500, max(1, (int) config('event_checkin.sync_batch_max_items', 500)));
        if ($items === [] || count($items) > $maximum) {
            throw new EventOfflineCheckinException('event_offline_batch_size_invalid');
        }
        if ($manifestVersion < 0) {
            throw new EventOfflineCheckinException('event_offline_manifest_version_invalid');
        }

        $normalized = $this->normalizeItems($items);
        $batchHash = $this->hashPayload([
            'schema_version' => 1,
            'event_id' => $eventId,
            'client_batch_id' => $clientBatchId,
            'manifest_version' => $manifestVersion,
            'items' => $normalized,
        ]);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $deviceSecret,
            $actorUserId,
            $clientBatchId,
            $manifestVersion,
            $normalized,
            $batchHash,
        ): EventOfflineSyncStageResult {
            $device = $this->devices->verify($eventId, $deviceSecret, $actorUserId);
            $event = DB::table('events')
                ->where('tenant_id', $tenantId)
                ->where('id', $eventId)
                ->first(['id', 'occurrence_key', 'checkin_manifest_version']);
            if ($event === null || ! is_string($event->occurrence_key)) {
                throw new EventOfflineCheckinException('event_checkin_event_not_found');
            }
            if ($manifestVersion > (int) $event->checkin_manifest_version) {
                throw new EventOfflineCheckinException('event_offline_manifest_version_ahead');
            }

            $replay = EventOfflineSyncBatch::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('device_id', (int) $device->id)
                ->where('client_batch_id', $clientBatchId)
                ->lockForUpdate()
                ->first();
            if ($replay !== null) {
                if (! EventCheckinSecurity::matches((string) $replay->payload_hash, $batchHash)
                    || (int) $replay->event_id !== $eventId
                    || (int) $replay->submitted_by_user_id !== $actorUserId) {
                    throw new EventOfflineCheckinException('event_offline_batch_idempotency_conflict');
                }

                return new EventOfflineSyncStageResult(
                    $replay,
                    EventOfflineSyncItem::withoutGlobalScopes()
                        ->where('tenant_id', $tenantId)
                        ->where('batch_id', (int) $replay->id)
                        ->orderBy('item_position')
                        ->get(),
                    false,
                );
            }

            $nonces = array_column($normalized, 'client_nonce');
            if (count($nonces) !== count(array_unique($nonces))) {
                throw new EventOfflineCheckinException('event_offline_nonce_duplicate');
            }
            if (EventOfflineSyncItem::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('device_id', (int) $device->id)
                ->whereIn('client_nonce', $nonces)
                ->exists()) {
                throw new EventOfflineCheckinException('event_offline_nonce_conflict');
            }

            $fingerprints = array_values(array_unique(array_column(
                $normalized,
                'credential_fingerprint',
            )));
            $credentialCandidates = EventCheckinCredential::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->whereIn('token_fingerprint', $fingerprints)
                ->get()
                ->groupBy('token_fingerprint');

            $now = CarbonImmutable::now('UTC');
            $batchId = (int) DB::table('event_offline_sync_batches')->insertGetId([
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'occurrence_key' => (string) $event->occurrence_key,
                'device_id' => (int) $device->id,
                'submitted_by_user_id' => $actorUserId,
                'client_batch_id' => $clientBatchId,
                'payload_hash' => $batchHash,
                'manifest_version' => $manifestVersion,
                'item_count' => count($normalized),
                'status' => EventOfflineSyncBatchStatus::Pending->value,
                'claim_attempts' => 0,
                'available_at' => $now,
                'accepted_count' => 0,
                'conflict_count' => 0,
                'rejected_count' => 0,
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            $rows = [];
            foreach ($normalized as $position => $item) {
                $credential = $this->matchingCredential(
                    $credentialCandidates->get($item['credential_fingerprint'], collect()),
                    $item['credential_hash_reference'],
                );
                $rows[] = [
                    'tenant_id' => $tenantId,
                    'event_id' => $eventId,
                    'batch_id' => $batchId,
                    'device_id' => (int) $device->id,
                    'item_position' => $position + 1,
                    'client_nonce' => $item['client_nonce'],
                    'operation' => $item['operation'],
                    'observed_at' => $item['observed_at'],
                    'expected_attendance_version' => $item['expected_attendance_version'],
                    'credential_fingerprint' => $item['credential_fingerprint'],
                    'credential_hash_reference' => $item['credential_hash_reference'],
                    'credential_id' => $credential?->id,
                    'registration_id' => $credential?->registration_id,
                    'user_id' => $credential?->user_id,
                    'submitted_reason' => $item['reason'],
                    'submitted_payload_hash' => $this->hashPayload($item),
                    'initial_outcome' => EventOfflineSyncOutcome::Pending->value,
                    'created_at' => $now,
                ];
            }
            DB::table('event_offline_sync_items')->insert($rows);

            return new EventOfflineSyncStageResult(
                EventOfflineSyncBatch::withoutGlobalScopes()->findOrFail($batchId),
                EventOfflineSyncItem::withoutGlobalScopes()
                    ->where('tenant_id', $tenantId)
                    ->where('batch_id', $batchId)
                    ->orderBy('item_position')
                    ->get(),
                true,
            );
        }, 3);
    }

    public function claimNext(?int $eventId = null, ?int $leaseSeconds = null): ?EventOfflineSyncClaim
    {
        $tenantId = $this->tenantId();
        $lease = $leaseSeconds
            ?? max(15, (int) config('event_checkin.sync_claim_seconds', 120));
        if ($lease < 15 || $lease > 900) {
            throw new EventOfflineCheckinException('event_offline_claim_lease_invalid');
        }
        $maximumAttempts = min(100, max(1, (int) config(
            'event_checkin.sync_claim_max_attempts',
            10,
        )));

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $lease,
            $maximumAttempts,
        ): ?EventOfflineSyncClaim {
            $now = CarbonImmutable::now('UTC');
            for ($terminalized = 0; $terminalized < 100; $terminalized++) {
                $query = EventOfflineSyncBatch::withoutGlobalScopes()
                    ->where('tenant_id', $tenantId)
                    ->where(static function ($candidate) use ($now): void {
                        $candidate->where(static function ($pending) use ($now): void {
                            $pending->where('status', EventOfflineSyncBatchStatus::Pending->value)
                                ->where('available_at', '<=', $now);
                        })->orWhere(static function ($abandoned) use ($now): void {
                            $abandoned->where('status', EventOfflineSyncBatchStatus::Processing->value)
                                ->where('claim_expires_at', '<=', $now);
                        });
                    })
                    ->orderBy('available_at')
                    ->orderBy('id')
                    ->lockForUpdate();
                if ($eventId !== null) {
                    $query->where('event_id', $eventId);
                }
                $batch = $query->first();
                if ($batch === null) {
                    return null;
                }
                if ((int) $batch->claim_attempts >= $maximumAttempts) {
                    DB::table('event_offline_sync_batches')
                        ->where('tenant_id', $tenantId)
                        ->where('id', (int) $batch->id)
                        ->update($this->deadLetterUpdates(
                            $now,
                            'claim_attempts_exhausted',
                            null,
                            null,
                        ));
                    continue;
                }

                $claimToken = EventCheckinSecurity::generateSecret('nxc1_');
                $verifier = EventCheckinSecurity::verifier($claimToken, 'nxc1_');
                DB::table('event_offline_sync_batches')
                    ->where('tenant_id', $tenantId)
                    ->where('id', (int) $batch->id)
                    ->update([
                        'status' => EventOfflineSyncBatchStatus::Processing->value,
                        'claim_attempts' => (int) $batch->claim_attempts + 1,
                        'claim_token_hash' => $verifier['hash'],
                        'claimed_at' => $now,
                        'claim_expires_at' => $now->addSeconds($lease),
                        'last_claimed_at' => $now,
                        'updated_at' => $now,
                    ]);

                return new EventOfflineSyncClaim(
                    EventOfflineSyncBatch::withoutGlobalScopes()->findOrFail((int) $batch->id),
                    $claimToken,
                );
            }

            return null;
        }, 3);
    }

    /** Claim one known batch for synchronous API processing or an explicit retry. */
    public function claimBatch(int $batchId, ?int $leaseSeconds = null): ?EventOfflineSyncClaim
    {
        if ($batchId <= 0) {
            throw new EventOfflineCheckinException('event_offline_batch_not_found');
        }
        $tenantId = $this->tenantId();
        $lease = $leaseSeconds
            ?? max(15, (int) config('event_checkin.sync_claim_seconds', 120));
        if ($lease < 15 || $lease > 900) {
            throw new EventOfflineCheckinException('event_offline_claim_lease_invalid');
        }
        $maximumAttempts = min(100, max(1, (int) config(
            'event_checkin.sync_claim_max_attempts',
            10,
        )));

        return DB::transaction(function () use (
            $tenantId,
            $batchId,
            $lease,
            $maximumAttempts,
        ): ?EventOfflineSyncClaim {
            $now = CarbonImmutable::now('UTC');
            $batch = EventOfflineSyncBatch::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey($batchId)
                ->lockForUpdate()
                ->first();
            if ($batch === null) {
                throw new EventOfflineCheckinException('event_offline_batch_not_found');
            }
            if (in_array($batch->status, [
                EventOfflineSyncBatchStatus::Completed,
                EventOfflineSyncBatchStatus::DeadLetter,
            ], true)) {
                return null;
            }
            $claimable = ($batch->status === EventOfflineSyncBatchStatus::Pending
                    && $batch->available_at->lessThanOrEqualTo($now))
                || ($batch->status === EventOfflineSyncBatchStatus::Processing
                    && $batch->claim_expires_at !== null
                    && $batch->claim_expires_at->lessThanOrEqualTo($now));
            if (! $claimable) {
                return null;
            }
            if ((int) $batch->claim_attempts >= $maximumAttempts) {
                DB::table('event_offline_sync_batches')
                    ->where('tenant_id', $tenantId)
                    ->where('id', $batchId)
                    ->update($this->deadLetterUpdates(
                        $now,
                        'claim_attempts_exhausted',
                        null,
                        null,
                    ));

                return null;
            }

            $claimToken = EventCheckinSecurity::generateSecret('nxc1_');
            $verifier = EventCheckinSecurity::verifier($claimToken, 'nxc1_');
            DB::table('event_offline_sync_batches')
                ->where('tenant_id', $tenantId)
                ->where('id', $batchId)
                ->update([
                    'status' => EventOfflineSyncBatchStatus::Processing->value,
                    'claim_attempts' => (int) $batch->claim_attempts + 1,
                    'claim_token_hash' => $verifier['hash'],
                    'claimed_at' => $now,
                    'claim_expires_at' => $now->addSeconds($lease),
                    'last_claimed_at' => $now,
                    'updated_at' => $now,
                ]);

            return new EventOfflineSyncClaim(
                EventOfflineSyncBatch::withoutGlobalScopes()->findOrFail($batchId),
                $claimToken,
            );
        }, 3);
    }

    public function releaseClaim(int $batchId, string $claimToken, int $delaySeconds = 0): EventOfflineSyncBatch
    {
        $tenantId = $this->tenantId();
        $verifier = EventCheckinSecurity::verifier($claimToken, 'nxc1_');
        if ($delaySeconds < 0 || $delaySeconds > 3600) {
            throw new EventOfflineCheckinException('event_offline_retry_delay_invalid');
        }

        return DB::transaction(function () use (
            $tenantId,
            $batchId,
            $verifier,
            $delaySeconds,
        ): EventOfflineSyncBatch {
            $batch = EventOfflineSyncBatch::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey($batchId)
                ->lockForUpdate()
                ->first();
            $this->assertClaim($batch, $verifier['hash'], false);
            $now = CarbonImmutable::now('UTC');
            $maximumAttempts = min(100, max(1, (int) config(
                'event_checkin.sync_claim_max_attempts',
                10,
            )));
            if ((int) $batch->claim_attempts >= $maximumAttempts) {
                DB::table('event_offline_sync_batches')
                    ->where('tenant_id', $tenantId)
                    ->where('id', $batchId)
                    ->update(array_merge(
                        $this->deadLetterUpdates(
                            $now,
                            'claim_attempts_exhausted',
                            null,
                            null,
                        ),
                        ['last_released_at' => $now],
                    ));

                return EventOfflineSyncBatch::withoutGlobalScopes()->findOrFail($batchId);
            }
            DB::table('event_offline_sync_batches')
                ->where('tenant_id', $tenantId)
                ->where('id', $batchId)
                ->update([
                    'status' => EventOfflineSyncBatchStatus::Pending->value,
                    'available_at' => $now->addSeconds($delaySeconds),
                    'claim_token_hash' => null,
                    'claimed_at' => null,
                    'claim_expires_at' => null,
                    'last_released_at' => $now,
                    'updated_at' => $now,
                ]);

            return EventOfflineSyncBatch::withoutGlobalScopes()->findOrFail($batchId);
        }, 3);
    }

    public function deadLetter(
        int $batchId,
        string $claimToken,
        int $actorUserId,
        string $terminalCode,
        ?string $terminalReason,
    ): EventOfflineSyncBatch {
        $tenantId = $this->tenantId();
        $verifier = EventCheckinSecurity::verifier($claimToken, 'nxc1_');
        $terminalCode = $this->normalizedCode(
            $terminalCode,
            'event_offline_terminal_code_invalid',
        );
        $terminalReason = EventCheckinSecurity::sanitizedText($terminalReason, 500, false);

        return DB::transaction(function () use (
            $tenantId,
            $batchId,
            $actorUserId,
            $verifier,
            $terminalCode,
            $terminalReason,
        ): EventOfflineSyncBatch {
            $batch = EventOfflineSyncBatch::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey($batchId)
                ->lockForUpdate()
                ->first();
            $this->assertClaim($batch, $verifier['hash'], true);
            $this->assertActiveActor($tenantId, $actorUserId);
            $now = CarbonImmutable::now('UTC');
            DB::table('event_offline_sync_batches')
                ->where('tenant_id', $tenantId)
                ->where('id', $batchId)
                ->update($this->deadLetterUpdates(
                    $now,
                    $terminalCode,
                    $terminalReason,
                    $actorUserId,
                ));

            return EventOfflineSyncBatch::withoutGlobalScopes()->findOrFail($batchId);
        }, 3);
    }

    public function decide(
        int $batchId,
        int $itemId,
        string $claimToken,
        int $actorUserId,
        EventOfflineSyncOutcome $outcome,
        string $decisionCode,
        ?string $decisionReason,
        ?int $attendanceVersionBefore,
        ?int $attendanceVersionAfter,
        ?int $attendanceActivityId,
        string $idempotencyKey,
    ): EventOfflineSyncDecisionResult {
        if (! $outcome->isDecision()) {
            throw new EventOfflineCheckinException('event_offline_decision_outcome_invalid');
        }
        if (($attendanceVersionBefore !== null && $attendanceVersionBefore < 0)
            || ($attendanceVersionAfter !== null && $attendanceVersionAfter < 0)
            || ($attendanceActivityId !== null && $attendanceActivityId <= 0)) {
            throw new EventOfflineCheckinException('event_offline_decision_attendance_invalid');
        }
        if ($outcome === EventOfflineSyncOutcome::Accepted
            && ($attendanceVersionBefore === null
                || $attendanceVersionAfter === null
                || $attendanceActivityId === null
                || $attendanceVersionAfter <= $attendanceVersionBefore)) {
            throw new EventOfflineCheckinException('event_offline_decision_attendance_required');
        }
        if ($outcome !== EventOfflineSyncOutcome::Accepted
            && ($attendanceVersionAfter !== null || $attendanceActivityId !== null)) {
            throw new EventOfflineCheckinException('event_offline_decision_attendance_forbidden');
        }

        $tenantId = $this->tenantId();
        $claimVerifier = EventCheckinSecurity::verifier($claimToken, 'nxc1_');
        $idempotencyHash = EventCheckinSecurity::idempotencyHash($idempotencyKey);
        $decisionCode = $this->normalizedCode(
            $decisionCode,
            'event_offline_decision_code_invalid',
        );
        $decisionReason = EventCheckinSecurity::sanitizedText($decisionReason, 500, false);
        $requestHash = $this->hashPayload([
            'batch_id' => $batchId,
            'item_id' => $itemId,
            'actor_user_id' => $actorUserId,
            'outcome' => $outcome->value,
            'decision_code' => $decisionCode,
            'decision_reason' => $decisionReason,
            'attendance_version_before' => $attendanceVersionBefore,
            'attendance_version_after' => $attendanceVersionAfter,
            'attendance_activity_id' => $attendanceActivityId,
        ]);

        return DB::transaction(function () use (
            $tenantId,
            $batchId,
            $itemId,
            $claimVerifier,
            $actorUserId,
            $outcome,
            $decisionCode,
            $decisionReason,
            $attendanceVersionBefore,
            $attendanceVersionAfter,
            $attendanceActivityId,
            $idempotencyHash,
            $requestHash,
        ): EventOfflineSyncDecisionResult {
            $batch = EventOfflineSyncBatch::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey($batchId)
                ->lockForUpdate()
                ->first();
            if ($batch === null) {
                throw new EventOfflineCheckinException('event_offline_batch_not_found');
            }

            $replay = EventOfflineSyncDecision::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('idempotency_key_hash', $idempotencyHash)
                ->first();
            if ($replay !== null) {
                if (! EventCheckinSecurity::matches((string) $replay->request_hash, $requestHash)) {
                    throw new EventOfflineCheckinException('event_offline_decision_idempotency_conflict');
                }

                return new EventOfflineSyncDecisionResult($replay, $batch, false);
            }

            $this->assertClaim($batch, $claimVerifier['hash'], true);
            $this->assertActiveActor($tenantId, $actorUserId);
            $item = EventOfflineSyncItem::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('event_id', (int) $batch->event_id)
                ->where('batch_id', $batchId)
                ->whereKey($itemId)
                ->first();
            if ($item === null) {
                throw new EventOfflineCheckinException('event_offline_item_not_found');
            }
            if ($outcome === EventOfflineSyncOutcome::Accepted) {
                $activity = DB::table('event_attendance_activity')
                    ->where('tenant_id', $tenantId)
                    ->where('event_id', (int) $batch->event_id)
                    ->where('id', $attendanceActivityId)
                    ->first(['id', 'user_id', 'attendance_version']);
                if ($activity === null
                    || $item->user_id === null
                    || (int) $activity->user_id !== (int) $item->user_id
                    || (int) $activity->attendance_version !== $attendanceVersionAfter) {
                    throw new EventOfflineCheckinException(
                        'event_offline_decision_attendance_evidence_invalid',
                    );
                }
            }
            if (EventOfflineSyncDecision::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('item_id', $itemId)
                ->exists()) {
                throw new EventOfflineCheckinException('event_offline_item_already_decided');
            }

            $now = CarbonImmutable::now('UTC');
            $decisionId = (int) DB::table('event_offline_sync_decisions')->insertGetId([
                'tenant_id' => $tenantId,
                'event_id' => (int) $batch->event_id,
                'batch_id' => $batchId,
                'item_id' => $itemId,
                'decision_version' => 1,
                'outcome' => $outcome->value,
                'decision_code' => $decisionCode,
                'decision_reason' => $decisionReason,
                'attendance_version_before' => $attendanceVersionBefore,
                'attendance_version_after' => $attendanceVersionAfter,
                'attendance_activity_id' => $attendanceActivityId,
                'decided_by_user_id' => $actorUserId,
                'idempotency_key_hash' => $idempotencyHash,
                'request_hash' => $requestHash,
                'created_at' => $now,
            ]);

            $counts = DB::table('event_offline_sync_decisions')
                ->where('tenant_id', $tenantId)
                ->where('batch_id', $batchId)
                ->selectRaw("SUM(CASE WHEN outcome = 'accepted' THEN 1 ELSE 0 END) AS accepted_count")
                ->selectRaw("SUM(CASE WHEN outcome = 'conflict' THEN 1 ELSE 0 END) AS conflict_count")
                ->selectRaw("SUM(CASE WHEN outcome = 'rejected' THEN 1 ELSE 0 END) AS rejected_count")
                ->first();
            $accepted = (int) ($counts->accepted_count ?? 0);
            $conflicts = (int) ($counts->conflict_count ?? 0);
            $rejected = (int) ($counts->rejected_count ?? 0);
            $completed = $accepted + $conflicts + $rejected === (int) $batch->item_count;
            $updates = [
                'accepted_count' => $accepted,
                'conflict_count' => $conflicts,
                'rejected_count' => $rejected,
                'updated_at' => $now,
            ];
            if ($completed) {
                $updates = array_merge($updates, [
                    'status' => EventOfflineSyncBatchStatus::Completed->value,
                    'claim_token_hash' => null,
                    'claimed_at' => null,
                    'claim_expires_at' => null,
                    'completed_at' => $now,
                ]);
            }
            DB::table('event_offline_sync_batches')
                ->where('tenant_id', $tenantId)
                ->where('id', $batchId)
                ->update($updates);

            return new EventOfflineSyncDecisionResult(
                EventOfflineSyncDecision::withoutGlobalScopes()->findOrFail($decisionId),
                EventOfflineSyncBatch::withoutGlobalScopes()->findOrFail($batchId),
                true,
            );
        }, 3);
    }

    /**
     * Append an organizer resolution after an initial conflict. Terminal batch
     * counters remain immutable evidence of the original replay result; readers
     * use the latest decision_version for the resolved state.
     */
    public function resolveConflict(
        int $batchId,
        int $itemId,
        int $actorUserId,
        int $expectedDecisionVersion,
        EventOfflineSyncOutcome $outcome,
        string $decisionCode,
        string $decisionReason,
        ?int $attendanceVersionBefore,
        ?int $attendanceVersionAfter,
        ?int $attendanceActivityId,
        string $idempotencyKey,
    ): EventOfflineSyncDecisionResult {
        if (! in_array($outcome, [
            EventOfflineSyncOutcome::Accepted,
            EventOfflineSyncOutcome::Rejected,
        ], true) || $expectedDecisionVersion <= 0) {
            throw new EventOfflineCheckinException('event_offline_resolution_outcome_invalid');
        }
        if ($outcome === EventOfflineSyncOutcome::Accepted
            && ($attendanceVersionBefore === null
                || $attendanceVersionAfter === null
                || $attendanceActivityId === null
                || $attendanceVersionAfter <= $attendanceVersionBefore)) {
            throw new EventOfflineCheckinException('event_offline_decision_attendance_required');
        }
        if ($outcome === EventOfflineSyncOutcome::Rejected
            && ($attendanceVersionAfter !== null || $attendanceActivityId !== null)) {
            throw new EventOfflineCheckinException('event_offline_decision_attendance_forbidden');
        }

        $tenantId = $this->tenantId();
        $this->assertActiveActor($tenantId, $actorUserId);
        $idempotencyHash = EventCheckinSecurity::idempotencyHash($idempotencyKey);
        $decisionCode = $this->normalizedCode(
            $decisionCode,
            'event_offline_decision_code_invalid',
        );
        $decisionReason = EventCheckinSecurity::sanitizedText(
            $decisionReason,
            500,
            true,
        );
        $requestHash = $this->hashPayload([
            'batch_id' => $batchId,
            'item_id' => $itemId,
            'actor_user_id' => $actorUserId,
            'expected_decision_version' => $expectedDecisionVersion,
            'outcome' => $outcome->value,
            'decision_code' => $decisionCode,
            'decision_reason' => $decisionReason,
            'attendance_version_before' => $attendanceVersionBefore,
            'attendance_version_after' => $attendanceVersionAfter,
            'attendance_activity_id' => $attendanceActivityId,
        ]);

        return DB::transaction(function () use (
            $tenantId,
            $batchId,
            $itemId,
            $actorUserId,
            $expectedDecisionVersion,
            $outcome,
            $decisionCode,
            $decisionReason,
            $attendanceVersionBefore,
            $attendanceVersionAfter,
            $attendanceActivityId,
            $idempotencyHash,
            $requestHash,
        ): EventOfflineSyncDecisionResult {
            $batch = EventOfflineSyncBatch::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey($batchId)
                ->first();
            $item = EventOfflineSyncItem::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('batch_id', $batchId)
                ->whereKey($itemId)
                ->first();
            if ($batch === null || $item === null) {
                throw new EventOfflineCheckinException('event_offline_item_not_found');
            }

            $replay = EventOfflineSyncDecision::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('idempotency_key_hash', $idempotencyHash)
                ->first();
            if ($replay !== null) {
                if (! EventCheckinSecurity::matches((string) $replay->request_hash, $requestHash)) {
                    throw new EventOfflineCheckinException('event_offline_decision_idempotency_conflict');
                }

                return new EventOfflineSyncDecisionResult($replay, $batch, false);
            }

            $latest = EventOfflineSyncDecision::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('item_id', $itemId)
                ->orderByDesc('decision_version')
                ->lockForUpdate()
                ->first();
            if ($latest === null
                || (int) $latest->decision_version !== $expectedDecisionVersion
                || $latest->outcome !== EventOfflineSyncOutcome::Conflict) {
                throw new EventOfflineCheckinException('event_offline_resolution_conflict');
            }
            if ($outcome === EventOfflineSyncOutcome::Accepted) {
                $activity = DB::table('event_attendance_activity')
                    ->where('tenant_id', $tenantId)
                    ->where('event_id', (int) $batch->event_id)
                    ->where('id', $attendanceActivityId)
                    ->first(['id', 'user_id', 'attendance_version']);
                if ($activity === null || $item->user_id === null
                    || (int) $activity->user_id !== (int) $item->user_id
                    || (int) $activity->attendance_version !== $attendanceVersionAfter) {
                    throw new EventOfflineCheckinException(
                        'event_offline_decision_attendance_evidence_invalid',
                    );
                }
            }

            $decisionId = (int) DB::table('event_offline_sync_decisions')->insertGetId([
                'tenant_id' => $tenantId,
                'event_id' => (int) $batch->event_id,
                'batch_id' => $batchId,
                'item_id' => $itemId,
                'decision_version' => $expectedDecisionVersion + 1,
                'outcome' => $outcome->value,
                'decision_code' => $decisionCode,
                'decision_reason' => $decisionReason,
                'attendance_version_before' => $attendanceVersionBefore,
                'attendance_version_after' => $attendanceVersionAfter,
                'attendance_activity_id' => $attendanceActivityId,
                'decided_by_user_id' => $actorUserId,
                'idempotency_key_hash' => $idempotencyHash,
                'request_hash' => $requestHash,
                'created_at' => CarbonImmutable::now('UTC'),
            ]);

            return new EventOfflineSyncDecisionResult(
                EventOfflineSyncDecision::withoutGlobalScopes()->findOrFail($decisionId),
                $batch,
                true,
            );
        }, 3);
    }

    /**
     * @param list<array{
     *   client_nonce:string,
     *   operation:EventOfflineSyncOperation|string,
     *   observed_at:DateTimeInterface|string,
     *   expected_attendance_version:int,
     *   credential_fingerprint:string,
     *   credential_hash_reference:string,
     *   reason?:?string
     * }> $items
     * @return list<array{
     *   client_nonce:string,
     *   operation:string,
     *   observed_at:string,
     *   expected_attendance_version:int,
     *   credential_fingerprint:string,
     *   credential_hash_reference:string,
     *   reason:?string
     * }>
     */
    private function normalizeItems(array $items): array
    {
        $now = CarbonImmutable::now('UTC');
        $oldest = $now->subMinutes(max(
            1,
            (int) config('event_checkin.offline_replay_window_minutes', 1440),
        ));
        $latest = $now->addMinutes(max(
            0,
            (int) config('event_checkin.future_clock_skew_minutes', 5),
        ));
        $normalized = [];

        foreach ($items as $item) {
            $nonce = $this->clientIdentifier(
                (string) ($item['client_nonce'] ?? ''),
                'event_offline_nonce_invalid',
            );
            $operationValue = $item['operation'] ?? null;
            $operation = $operationValue instanceof EventOfflineSyncOperation
                ? $operationValue
                : EventOfflineSyncOperation::tryFrom((string) $operationValue);
            if ($operation === null) {
                throw new EventOfflineCheckinException('event_offline_operation_invalid');
            }
            $observedAt = $this->observedAt($item['observed_at'] ?? null);
            if ($observedAt->isBefore($oldest) || $observedAt->isAfter($latest)) {
                throw new EventOfflineCheckinException('event_offline_observed_at_outside_window');
            }
            $expectedVersion = filter_var(
                $item['expected_attendance_version'] ?? null,
                FILTER_VALIDATE_INT,
            );
            if ($expectedVersion === false || $expectedVersion < 0) {
                throw new EventOfflineCheckinException('event_offline_attendance_version_invalid');
            }
            $fingerprint = strtolower(trim((string) ($item['credential_fingerprint'] ?? '')));

            // PROOF OF SCAN. The manifest hands the device each registrant's
            // credential hash so it can verify a scan offline — but if sync
            // then accepts that same hash back as the evidence, a device with
            // the manifest can fabricate a check-in for anyone on the list
            // without ever meeting them. When the device sends the raw
            // credential it actually scanned, we derive the hash ourselves;
            // the manifest hash cannot be reversed into the raw value, so
            // that item is genuine. Optional, so existing devices keep
            // working — they are simply recorded as unproven.
            $rawCredential = $item['credential'] ?? null;
            if (is_string($rawCredential) && trim($rawCredential) !== '') {
                $derived = EventCheckinSecurity::credentialVerifier($rawCredential);
                $hash = EventCheckinSecurity::hashReference(
                    $derived['hash'],
                    $derived['fingerprint'],
                );
                $fingerprint = $derived['fingerprint'];
            } else {
                if ((bool) config('events.offline_checkin.require_scan_proof', false)) {
                    throw new EventOfflineCheckinException('event_offline_scan_proof_required');
                }
                $hash = EventCheckinSecurity::hashReference(
                    (string) ($item['credential_hash_reference'] ?? ''),
                    $fingerprint,
                );
            }

            $reason = EventCheckinSecurity::sanitizedText($item['reason'] ?? null, 500, false);

            $normalized[] = [
                'client_nonce' => $nonce,
                'operation' => $operation->value,
                'observed_at' => $observedAt->format('Y-m-d H:i:s.u'),
                'expected_attendance_version' => $expectedVersion,
                'credential_fingerprint' => $fingerprint,
                'credential_hash_reference' => $hash,
                'reason' => $reason,
            ];
        }

        return $normalized;
    }

    private function observedAt(mixed $value): CarbonImmutable
    {
        try {
            if ($value instanceof DateTimeInterface) {
                return CarbonImmutable::instance($value)->utc();
            }
            if (! is_string($value) || trim($value) === '') {
                throw new EventOfflineCheckinException('event_offline_observed_at_invalid');
            }

            return CarbonImmutable::parse($value)->utc();
        } catch (EventOfflineCheckinException $exception) {
            throw $exception;
        } catch (\Throwable) {
            throw new EventOfflineCheckinException('event_offline_observed_at_invalid');
        }
    }

    private function clientIdentifier(string $value, string $reason): string
    {
        $value = trim($value);
        if (strlen($value) < 8 || strlen($value) > 100
            || preg_match('/^[A-Za-z0-9._:-]+$/D', $value) !== 1) {
            throw new EventOfflineCheckinException($reason);
        }

        return $value;
    }

    private function normalizedCode(string $value, string $reason): string
    {
        $value = strtolower(trim($value));
        if (preg_match('/^[a-z0-9][a-z0-9._-]{1,63}$/D', $value) !== 1) {
            throw new EventOfflineCheckinException($reason);
        }

        return $value;
    }

    private function assertActiveActor(int $tenantId, int $actorUserId): void
    {
        if ($actorUserId <= 0 || ! DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('id', $actorUserId)
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->exists()) {
            throw new EventOfflineCheckinException('event_offline_decision_actor_invalid');
        }
    }

    /** @return array<string,mixed> */
    private function deadLetterUpdates(
        CarbonImmutable $now,
        string $code,
        ?string $reason,
        ?int $actorUserId,
    ): array {
        return [
            'status' => EventOfflineSyncBatchStatus::DeadLetter->value,
            'claim_token_hash' => null,
            'claimed_at' => null,
            'claim_expires_at' => null,
            'dead_lettered_at' => $now,
            'terminal_code' => $code,
            'terminal_reason' => $reason,
            'terminal_by_user_id' => $actorUserId,
            'updated_at' => $now,
        ];
    }

    /** @param Collection<int,EventCheckinCredential> $candidates */
    private function matchingCredential(Collection $candidates, string $hash): ?EventCheckinCredential
    {
        foreach ($candidates as $candidate) {
            if (EventCheckinSecurity::matches((string) $candidate->token_hash, $hash)) {
                return $candidate;
            }
        }

        return null;
    }

    private function assertClaim(
        ?EventOfflineSyncBatch $batch,
        string $candidateHash,
        bool $requireUnexpired,
    ): void {
        if ($batch === null) {
            throw new EventOfflineCheckinException('event_offline_batch_not_found');
        }
        if ($batch->status !== EventOfflineSyncBatchStatus::Processing
            || ! is_string($batch->claim_token_hash)
            || ! EventCheckinSecurity::matches($batch->claim_token_hash, $candidateHash)) {
            throw new EventOfflineCheckinException('event_offline_claim_invalid');
        }
        if ($requireUnexpired
            && ($batch->claim_expires_at === null
                || ! $batch->claim_expires_at->isAfter(CarbonImmutable::now('UTC')))) {
            throw new EventOfflineCheckinException('event_offline_claim_expired');
        }
    }

    /** @param array<string,mixed> $payload */
    private function hashPayload(array $payload): string
    {
        try {
            return hash('sha256', json_encode(
                $payload,
                JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
            ));
        } catch (JsonException) {
            throw new EventOfflineCheckinException('event_offline_payload_invalid');
        }
    }

    private function tenantId(): int
    {
        $tenantId = TenantContext::currentId();
        if ($tenantId === null || $tenantId <= 0) {
            throw new EventOfflineCheckinException('event_checkin_tenant_context_missing');
        }

        return $tenantId;
    }
}
