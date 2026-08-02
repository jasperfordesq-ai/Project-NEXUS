<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
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

    public const REVERSAL_CLAIM_TYPE = 'attendance_reward_reversal';

    // ≤30 chars — transactions.transaction_type is varchar(30) and this
    // environment's non-strict sql_mode TRUNCATES rather than rejects, so a
    // longer name would silently store a different string than the label map
    // and every query filter expect.
    public const REVERSAL_TRANSACTION_TYPE = 'event_attendance_reversal';

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
        private readonly EventConfigurationService $config,
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
            // A claim for this subject already exists. If it previously failed
            // (wallet outage, monthly cap), resume it rather than reporting it
            // paid — otherwise a failed claim permanently blocks the member's
            // reward because every later check-in lands here.
            return $this->resumeExistingClaim($tenantId, $eventId, $attendeeId, (string) $event->title);
        } catch (QueryException $exception) {
            if ($this->isUniqueConflict($exception)) {
                return $this->resumeExistingClaim($tenantId, $eventId, $attendeeId, (string) $event->title);
            }

            throw $exception;
        } catch (\JsonException) {
            return $this->outcome('deferred_failed');
        }

        return $this->attemptMint($claimId, $tenantId, $eventId, $attendeeId, $amount, (string) $event->title);
    }

    /**
     * A prior claim for this subject exists; resume it if (and only if) it is
     * sitting in `failed`. The conditional UPDATE is the race guard: of two
     * concurrent resumers, exactly one moves failed→pending and mints.
     *
     * @return array{status:string,claim_id:int|null,transaction_id:int|null,amount?:float}
     */
    private function resumeExistingClaim(
        int $tenantId,
        int $eventId,
        int $attendeeId,
        string $eventTitle,
    ): array {
        $claim = DB::table('event_attendance_credit_claims')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $attendeeId)
            ->where('claim_type', self::CLAIM_TYPE)
            ->first();

        if ($claim === null || (string) $claim->status !== 'failed') {
            return $this->outcome('already_settled');
        }

        $resumed = DB::table('event_attendance_credit_claims')
            ->where('tenant_id', $tenantId)
            ->where('id', (int) $claim->id)
            ->where('status', 'failed')
            ->update([
                'status' => 'pending',
                'failure_code' => null,
                'failed_at' => null,
                'updated_at' => now(),
            ]);

        if ($resumed !== 1) {
            return $this->outcome('already_settled');
        }

        return $this->attemptMint(
            (int) $claim->id,
            $tenantId,
            $eventId,
            $attendeeId,
            $this->clampToCeiling((float) $claim->amount),
            $eventTitle,
        );
    }

    /**
     * Take a claim that is `pending` through the mint: monthly cap, wallet
     * write, completion, engagement. Every exit leaves the claim in a terminal
     * or retryable state — never stranded in `pending` (the wallet failure and
     * cap paths both move it to `failed`).
     *
     * @return array{status:string,claim_id:int|null,transaction_id:int|null,amount?:float}
     */
    private function attemptMint(
        int $claimId,
        int $tenantId,
        int $eventId,
        int $attendeeId,
        float $amount,
        string $eventTitle,
    ): array {
        // Monthly treasury ceiling. Deliberately lock-free: two concurrent
        // check-ins can each pass the read and overshoot the cap by at most one
        // reward (itself capped by attendance_credit_max). That bounded
        // overshoot is preferred over serialising every check-in on a
        // tenant-wide lock.
        $cap = $this->monthlyCap($tenantId);
        if ($cap !== null) {
            $spent = (float) DB::table('event_attendance_credit_claims')
                ->where('tenant_id', $tenantId)
                ->where('claim_type', self::CLAIM_TYPE)
                ->where('status', 'completed')
                ->where('completed_at', '>=', now()->startOfMonth())
                ->sum('amount');

            if ($spent + $amount > $cap) {
                DB::table('event_attendance_credit_claims')
                    ->where('tenant_id', $tenantId)
                    ->where('id', $claimId)
                    ->update([
                        'status' => 'failed',
                        'failure_code' => 'monthly_cap_reached',
                        'failed_at' => now(),
                        'updated_at' => now(),
                    ]);

                // Expected policy outcome, not an incident — hence info. The
                // claim is retryable by an admin (or by a later check-in
                // resume) once the month rolls over or the cap is raised.
                Log::info('Event attendance reward blocked by monthly cap', [
                    'tenant_id' => $tenantId,
                    'event_id' => $eventId,
                    'attendee_id' => $attendeeId,
                    'claim_id' => $claimId,
                    'cap' => $cap,
                    'spent' => $spent,
                    'amount' => $amount,
                ]);

                return $this->outcome('deferred_failed', $claimId, null, $amount);
            }
        }

        // 🔴 Rendered in the ATTENDEE's language, not the actor's. This string
        // is stored permanently in transactions.description and the XP log —
        // the member reads it in their own wallet later. Every caller here is
        // someone ELSE (organiser scanning at the door, admin retrying), so
        // without this wrap a Spanish member's ledger line was frozen in the
        // English of whoever happened to check them in, with no re-render path.
        $description = LocaleContext::withLocale(
            $this->recipientLocale($tenantId, $attendeeId),
            static fn (): string => __('api.event_attendance_reward_description', ['event' => $eventTitle]),
        );

        try {
            // The wallet write and the claim's completion commit TOGETHER.
            // With them separate, a failure of the completion UPDATE after a
            // successful mint stranded the claim at `pending` — a state no
            // retry path accepts — while the money had already moved. Inside
            // one transaction, either both land or the catch below records an
            // honestly-retryable `failed` claim with no money moved.
            // (mintToMember runs its own inner transaction; under an ambient
            // one that is a savepoint, so this nests correctly from the
            // check-in path too.)
            $transactionId = DB::transaction(function () use ($tenantId, $attendeeId, $amount, $description, $claimId): int {
                $transactionId = $this->wallet->mintToMember(
                    $tenantId,
                    $attendeeId,
                    $amount,
                    self::TRANSACTION_TYPE,
                    $description,
                );

                DB::table('event_attendance_credit_claims')
                    ->where('tenant_id', $tenantId)
                    ->where('id', $claimId)
                    ->update([
                        'status' => 'completed',
                        'transaction_id' => $transactionId,
                        'completed_at' => now(),
                        'updated_at' => now(),
                    ]);

                return $transactionId;
            });
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

        // Record the engagement once the credit is real, so XP and challenge
        // progress reflect verified attendance rather than an RSVP. Reuses the
        // recipient-localised description for the same reason: the XP log is
        // read by the member, not by whoever scanned them in.
        EngagementService::record(
            $attendeeId,
            'event_attendance_verified',
            'event:' . $eventId,
            $description,
        );

        return $this->outcome('settled', $claimId, $transactionId, $amount);
    }

    /**
     * Admin-initiated retry of a `failed` reward claim. Same money path as a
     * check-in resume — including the monthly cap, which an admin retry does
     * NOT bypass, so retries cannot be used to spend around the budget.
     *
     * Deliberate: the retry mints the CLAIM's frozen amount (re-clamped to the
     * global ceiling), not the event's current configuration — the claim is
     * the durable record of what was promised at attendance time, and an
     * admin lowering the event's amount later does not rewrite history.
     *
     * @return array{status:string,claim_id:int|null,transaction_id:int|null,amount?:float}
     */
    public function retryClaim(int $tenantId, int $claimId): array
    {
        // The platform mode is the master kill switch for MINTING — with it
        // off, an admin retry must not create credits either. (Reversal stays
        // available with the mode off: it returns money to the community and
        // is exactly what an operator needs after killing the switch.)
        $mode = strtolower(trim((string) config('events.attendance_credit_mode', 'off')));
        if ($mode !== 'treasury') {
            return $this->outcome('disabled');
        }

        $claim = DB::table('event_attendance_credit_claims')
            ->where('tenant_id', $tenantId)
            ->where('id', $claimId)
            ->first();

        if ($claim === null) {
            return $this->outcome('not_found');
        }

        if ((string) $claim->claim_type !== self::CLAIM_TYPE || (string) $claim->status !== 'failed') {
            return $this->outcome('not_retryable', $claimId);
        }

        $resumed = DB::table('event_attendance_credit_claims')
            ->where('tenant_id', $tenantId)
            ->where('id', $claimId)
            ->where('status', 'failed')
            ->update([
                'status' => 'pending',
                'failure_code' => null,
                'failed_at' => null,
                'updated_at' => now(),
            ]);

        if ($resumed !== 1) {
            return $this->outcome('not_retryable', $claimId);
        }

        $eventTitle = (string) (DB::table('events')
            ->where('tenant_id', $tenantId)
            ->where('id', (int) $claim->event_id)
            ->value('title') ?? '');

        return $this->attemptMint(
            $claimId,
            $tenantId,
            (int) $claim->event_id,
            (int) $claim->user_id,
            $this->clampToCeiling((float) $claim->amount),
            $eventTitle,
        );
    }

    /**
     * Admin-initiated reversal of a `completed` reward: a child claim
     * (parent_claim_id) records the reversal, the member's balance is reduced
     * (allowed to go negative — they may have spent the reward), and the
     * original claim moves to `reversed`, which also frees its monthly-cap
     * budget. One reversal per reward, enforced twice: the conditional
     * completed→reversed UPDATE and the child claim's unique subject key.
     *
     * @return array{status:string,claim_id:int|null,transaction_id:int|null,amount?:float}
     */
    public function reverseClaim(int $tenantId, int $claimId, int $actorId, string $reason): array
    {
        $claim = DB::table('event_attendance_credit_claims')
            ->where('tenant_id', $tenantId)
            ->where('id', $claimId)
            ->first();

        if ($claim === null) {
            return $this->outcome('not_found');
        }

        if ((string) $claim->claim_type !== self::CLAIM_TYPE
            || (string) $claim->status !== 'completed'
            || $claim->reversed_at !== null) {
            return $this->outcome('not_reversible', $claimId);
        }

        // Claim the original first — of two concurrent reversals exactly one
        // wins this UPDATE, and a failed reclaim rolls it back below.
        $claimed = DB::table('event_attendance_credit_claims')
            ->where('tenant_id', $tenantId)
            ->where('id', $claimId)
            ->where('status', 'completed')
            ->whereNull('reversed_at')
            ->update([
                'status' => 'reversed',
                'reversed_at' => now(),
                'reversal_code' => 'admin_reversal',
                'updated_at' => now(),
            ]);

        if ($claimed !== 1) {
            return $this->outcome('not_reversible', $claimId);
        }

        $now = now();

        try {
            $childId = (int) DB::table('event_attendance_credit_claims')->insertGetId([
                'tenant_id' => $tenantId,
                'event_id' => (int) $claim->event_id,
                'attendance_id' => (int) $claim->attendance_id,
                'user_id' => (int) $claim->user_id,
                'claim_type' => self::REVERSAL_CLAIM_TYPE,
                'idempotency_key' => sprintf(
                    'event_credit:%d:%d:%d:%s',
                    $tenantId,
                    (int) $claim->event_id,
                    (int) $claim->user_id,
                    self::REVERSAL_CLAIM_TYPE,
                ),
                'funding_source_type' => self::FUNDING_SOURCE,
                'funding_source_id' => null,
                // Reversal flows FROM the member back TO the community.
                'payer_user_id' => (int) $claim->user_id,
                'payee_user_id' => null,
                'amount' => (float) $claim->amount,
                'unit' => 'time_credit',
                'status' => 'pending',
                'transaction_id' => null,
                'parent_claim_id' => $claimId,
                'metadata' => json_encode([
                    'schema_version' => 1,
                    'mode' => 'treasury',
                    'actor_user_id' => $actorId,
                    'reason' => $reason,
                ], JSON_THROW_ON_ERROR),
                'claimed_at' => $now,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        } catch (\Throwable $exception) {
            $isConflict = $exception instanceof UniqueConstraintViolationException
                || ($exception instanceof QueryException && $this->isUniqueConflict($exception));

            if (! $isConflict) {
                $this->restoreReversedClaim($tenantId, $claimId);
                throw $exception;
            }

            // A prior reversal attempt left a child row. Resume it only from
            // `failed`; any other state means a reversal is already in flight
            // or done, so put the original back the way we found it.
            $child = DB::table('event_attendance_credit_claims')
                ->where('tenant_id', $tenantId)
                ->where('event_id', (int) $claim->event_id)
                ->where('user_id', (int) $claim->user_id)
                ->where('claim_type', self::REVERSAL_CLAIM_TYPE)
                ->first();

            $resumed = $child !== null && (string) $child->status === 'failed'
                ? DB::table('event_attendance_credit_claims')
                    ->where('tenant_id', $tenantId)
                    ->where('id', (int) $child->id)
                    ->where('status', 'failed')
                    ->update([
                        'status' => 'pending',
                        'failure_code' => null,
                        'failed_at' => null,
                        'updated_at' => now(),
                    ])
                : 0;

            if ($resumed !== 1) {
                $this->restoreReversedClaim($tenantId, $claimId);

                return $this->outcome('not_reversible', $claimId);
            }

            $childId = (int) $child->id;
        }

        return $this->attemptReclaim($tenantId, $claimId, $childId, $claim);
    }

    /**
     * @param object $claim the ORIGINAL (completed) claim row
     * @return array{status:string,claim_id:int|null,transaction_id:int|null,amount?:float}
     */
    private function attemptReclaim(int $tenantId, int $originalId, int $childId, object $claim): array
    {
        $eventTitle = (string) (DB::table('events')
            ->where('tenant_id', $tenantId)
            ->where('id', (int) $claim->event_id)
            ->value('title') ?? '');

        // Same reasoning as the mint: the member reads this reversal line in
        // their own wallet, so it renders in THEIR language, not the admin's.
        $description = LocaleContext::withLocale(
            $this->recipientLocale($tenantId, (int) $claim->user_id),
            static fn (): string => __('api.event_attendance_reward_reversal_description', ['event' => $eventTitle]),
        );

        try {
            // Same atomicity contract as attemptMint(): the reclaim and the
            // child claim's completion commit together, so the child can never
            // be stranded at `pending` after the money already moved back.
            $transactionId = DB::transaction(function () use ($tenantId, $claim, $childId, $description): int {
                $transactionId = $this->wallet->reclaimFromMember(
                    $tenantId,
                    (int) $claim->user_id,
                    (float) $claim->amount,
                    self::REVERSAL_TRANSACTION_TYPE,
                    $description,
                );

                DB::table('event_attendance_credit_claims')
                    ->where('tenant_id', $tenantId)
                    ->where('id', $childId)
                    ->update([
                        'status' => 'completed',
                        'transaction_id' => $transactionId,
                        'completed_at' => now(),
                        'updated_at' => now(),
                    ]);

                return $transactionId;
            });
        } catch (\Throwable $exception) {
            DB::table('event_attendance_credit_claims')
                ->where('tenant_id', $tenantId)
                ->where('id', $childId)
                ->update([
                    'status' => 'failed',
                    'failure_code' => 'reclaim_failed',
                    'failed_at' => now(),
                    'updated_at' => now(),
                ]);

            // The money did not move, so the original must read as still paid.
            $this->restoreReversedClaim($tenantId, $originalId);

            Log::error('Event attendance reward reversal failed', [
                'tenant_id' => $tenantId,
                'claim_id' => $originalId,
                'reversal_claim_id' => $childId,
                'error' => $exception->getMessage(),
            ]);

            return $this->outcome('reverse_failed', $childId, null, (float) $claim->amount);
        }

        return $this->outcome('reversed', $childId, $transactionId, (float) $claim->amount);
    }

    private function restoreReversedClaim(int $tenantId, int $claimId): void
    {
        DB::table('event_attendance_credit_claims')
            ->where('tenant_id', $tenantId)
            ->where('id', $claimId)
            ->where('status', 'reversed')
            ->update([
                'status' => 'completed',
                'reversed_at' => null,
                'reversal_code' => null,
                'updated_at' => now(),
            ]);
    }

    /** The tenant's monthly treasury ceiling, or null when uncapped. */
    private function monthlyCap(int $tenantId): ?float
    {
        try {
            $cap = $this->config->value('attendance_credit_monthly_cap', null, $tenantId);
        } catch (\Throwable $exception) {
            // A broken config read must not turn into free minting — treat an
            // unreadable cap as the smallest possible budget already spent.
            Log::warning('Event attendance reward monthly cap lookup failed; blocking mint', [
                'tenant_id' => $tenantId,
                'error' => $exception->getMessage(),
            ]);

            return 0.01;
        }

        if ($cap === null || ! is_numeric($cap)) {
            return null;
        }

        $cap = round((float) $cap, 2);

        return $cap > 0 ? $cap : null;
    }

    /**
     * The member's stored language, for rendering ledger text they will read.
     * Null (LocaleContext's no-op) when unknown, so a missing preference can
     * never break a mint.
     */
    private function recipientLocale(int $tenantId, int $userId): ?string
    {
        try {
            $locale = DB::table('users')
                ->where('tenant_id', $tenantId)
                ->where('id', $userId)
                ->value('preferred_language');

            return is_string($locale) && $locale !== '' ? $locale : null;
        } catch (\Throwable) {
            return null;
        }
    }

    private function clampToCeiling(float $amount): float
    {
        $ceiling = round((float) config('events.attendance_credit_max', 2.0), 2);

        return $ceiling > 0 ? min($amount, $ceiling) : $amount;
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
