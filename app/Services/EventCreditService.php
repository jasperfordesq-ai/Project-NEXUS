<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Models\Event;
use App\Models\EventAttendance;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Attendance-triggered time-credit rewards ("skill gifting"), fail-closed.
 *
 * A reward requires THREE independent switches, so no single misconfiguration
 * can start moving credits:
 *
 *   1. env  EVENTS_ATTENDANCE_CREDIT_MODE=treasury
 *   2. tenant feature flag `event_attendance_credits`
 *   3. a per-event `attendance_credit_amount`
 *
 * Any unrecognised mode still fails closed and logs at critical, which is how
 * this class behaved when no writer existed at all.
 *
 * The reviewed funding model is a COMMUNITY MINT: credits are created against
 * the community (`sender_id IS NULL`) rather than debited from the organiser or
 * from another member, so hosting an event is never a personal cost. The
 * durable claim in `event_attendance_credit_claims` is the idempotency record —
 * deliberately not mutable RSVP state, which is what the previous
 * implementation misused.
 *
 * Granting a reward must never break the thing it is rewarding: a failure is
 * recorded on the claim and reported back, and the caller keeps the check-in.
 */
final class EventCreditService
{
    public const CLAIM_TYPE = 'attendance_reward';

    public const TRANSACTION_TYPE = 'event_attendance_reward';

    public const FUNDING_SOURCE = 'tenant_treasury';

    /** Recognised outcomes. Anything else means the writer is not authorised. */
    public const SETTLED_STATUSES = [
        'disabled',
        'skipped',
        'settled',
        'already_settled',
        'deferred_failed',
    ];

    public function __construct(
        private readonly WalletService $wallet,
    ) {}

    /**
     * @return array{status:string,claim_id:int|null,transaction_id:int|null,amount?:float}
     */
    public function settleAttendance(
        Event $event,
        EventAttendance $attendance,
        User $attendee,
        User $actor,
    ): array {
        $mode = strtolower(trim((string) config('events.attendance_credit_mode', 'off')));

        if ($mode === 'off') {
            return $this->outcome('disabled');
        }

        if ($mode !== 'treasury') {
            Log::critical('Unsupported event attendance credit mode failed closed', [
                'mode' => $mode,
                'tenant_id' => (int) $event->tenant_id,
                'event_id' => (int) $event->getKey(),
                'attendance_id' => (int) $attendance->getKey(),
                'attendee_id' => (int) $attendee->getKey(),
                'actor_id' => (int) $actor->getKey(),
            ]);

            return $this->outcome('disabled');
        }

        $tenantId = (int) $event->tenant_id;

        if (! $this->tenantAllowsRewards($tenantId)) {
            return $this->outcome('skipped');
        }

        $amount = $this->resolveAmount($event);
        if ($amount === null) {
            return $this->outcome('skipped');
        }

        // Self-award guard: an organiser checking themselves in would mint to
        // themselves on their own event. Mirrors volunteering, where a
        // volunteer cannot verify their own hours.
        if ((int) $attendee->getKey() === (int) $actor->getKey()) {
            return $this->outcome('skipped');
        }

        return $this->mintReward($event, $attendance, $attendee, $actor, $tenantId, $amount);
    }

    /**
     * @return array{status:string,claim_id:int|null,transaction_id:int|null,amount?:float}
     */
    private function mintReward(
        Event $event,
        EventAttendance $attendance,
        User $attendee,
        User $actor,
        int $tenantId,
        float $amount,
    ): array {
        $eventId = (int) $event->getKey();
        $attendeeId = (int) $attendee->getKey();
        $now = now();

        // Deterministic: the same (tenant, event, member, claim type) always
        // produces the same key, so a replay collides on the unique index
        // rather than minting twice.
        $idempotencyKey = sprintf(
            'event_credit:%d:%d:%d:%s',
            $tenantId,
            $eventId,
            $attendeeId,
            self::CLAIM_TYPE,
        );

        try {
            $claimId = (int) DB::table('event_attendance_credit_claims')->insertGetId([
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'attendance_id' => (int) $attendance->getKey(),
                'user_id' => $attendeeId,
                'claim_type' => self::CLAIM_TYPE,
                'idempotency_key' => $idempotencyKey,
                'funding_source_type' => self::FUNDING_SOURCE,
                'funding_source_id' => null,
                'payer_user_id' => null,
                'payee_user_id' => $attendeeId,
                'amount' => $amount,
                'unit' => 'time_credit',
                'status' => 'pending',
                'transaction_id' => null,
                'metadata' => json_encode([
                    'schema_version' => 1,
                    'mode' => 'treasury',
                    'actor_user_id' => (int) $actor->getKey(),
                ], JSON_THROW_ON_ERROR),
                'claimed_at' => $now,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        } catch (UniqueConstraintViolationException) {
            // Already rewarded for this event — the ledger's unique key is the
            // guarantee, not a prior read.
            return $this->outcome('already_settled');
        } catch (QueryException $exception) {
            if ($this->isUniqueConflict($exception)) {
                return $this->outcome('already_settled');
            }

            throw $exception;
        } catch (\JsonException) {
            return $this->outcome('deferred_failed');
        }

        try {
            $transactionId = $this->wallet->mintToMember(
                $tenantId,
                $attendeeId,
                $amount,
                self::TRANSACTION_TYPE,
                __('api.event_attendance_reward_description', ['event' => (string) $event->title]),
            );
        } catch (\Throwable $exception) {
            // The claim stays as the durable record that this was attempted and
            // failed, so an admin can retry it. Attendance is unaffected.
            DB::table('event_attendance_credit_claims')
                ->where('tenant_id', $tenantId)
                ->where('id', $claimId)
                ->update([
                    'status' => 'failed',
                    'failure_code' => 'mint_failed',
                    'failed_at' => now(),
                    'updated_at' => now(),
                ]);

            Log::error('Event attendance reward mint failed', [
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'attendee_id' => $attendeeId,
                'claim_id' => $claimId,
                'error' => $exception->getMessage(),
            ]);

            return $this->outcome('deferred_failed', $claimId, null, $amount);
        }

        DB::table('event_attendance_credit_claims')
            ->where('tenant_id', $tenantId)
            ->where('id', $claimId)
            ->update([
                'status' => 'completed',
                'transaction_id' => $transactionId,
                'completed_at' => now(),
                'updated_at' => now(),
            ]);

        // Record the engagement once the credit is real, so XP and challenge
        // progress reflect verified attendance rather than an RSVP.
        EngagementService::record(
            $attendeeId,
            'event_attendance_verified',
            'event:' . $eventId,
            __('api.event_attendance_reward_description', ['event' => (string) $event->title]),
        );

        return $this->outcome('settled', $claimId, $transactionId, $amount);
    }

    private function tenantAllowsRewards(int $tenantId): bool
    {
        try {
            // TenantContext is request-scoped; a queue or console context may be
            // pointed elsewhere, so verify the flag for the EVENT's tenant.
            if ((int) TenantContext::getId() === $tenantId) {
                return TenantContext::hasFeature('event_attendance_credits');
            }

            $features = DB::table('tenants')->where('id', $tenantId)->value('features');
            $decoded = is_string($features) ? json_decode($features, true) : $features;

            if (! is_array($decoded) || ! array_key_exists('event_attendance_credits', $decoded)) {
                // Absent means the default, which is off.
                return false;
            }

            return (bool) $decoded['event_attendance_credits'];
        } catch (\Throwable $exception) {
            Log::warning('Event attendance reward feature check failed; treating as disabled', [
                'tenant_id' => $tenantId,
                'error' => $exception->getMessage(),
            ]);

            return false;
        }
    }

    /**
     * The reward for this event, clamped to the community's ceiling.
     *
     * Clamps rather than rejects: a stale larger amount left on an existing
     * event must not be able to mint more than the community agreed to.
     */
    private function resolveAmount(Event $event): ?float
    {
        $configured = $event->attendance_credit_amount;

        if ($configured === null || ! is_numeric($configured)) {
            return null;
        }

        $amount = round((float) $configured, 2);
        if ($amount <= 0) {
            return null;
        }

        $ceiling = round((float) config('events.attendance_credit_max', 2.0), 2);
        if ($ceiling <= 0) {
            return null;
        }

        return min($amount, $ceiling);
    }

    private function isUniqueConflict(QueryException $exception): bool
    {
        return ($exception->errorInfo[1] ?? null) === 1062
            || str_contains($exception->getMessage(), 'Duplicate entry');
    }

    /**
     * @return array{status:string,claim_id:int|null,transaction_id:int|null,amount?:float}
     */
    private function outcome(
        string $status,
        ?int $claimId = null,
        ?int $transactionId = null,
        ?float $amount = null,
    ): array {
        $result = [
            'status' => $status,
            'claim_id' => $claimId,
            'transaction_id' => $transactionId,
        ];

        if ($amount !== null) {
            $result['amount'] = $amount;
        }

        return $result;
    }
}
