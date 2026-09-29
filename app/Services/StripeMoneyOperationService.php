<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Exceptions\StripeMoneyOperationUnresolvedException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Stripe\StripeClient;

/**
 * StripeMoneyOperationService — a durable local record for every Stripe call
 * that moves money (F-283).
 *
 * Why it exists. A Stripe idempotency key is kept by Stripe for about 24
 * hours. Before this service, every money-moving call used that key as its ONLY
 * cross-retry guard and wrote the local "this money moved" row only after the
 * call returned. A reply lost to a timeout, or a local failure after the call,
 * followed by a retry more than a day later (Stripe keeps re-delivering a failed
 * webhook for ~3 days; an admin can press release again at any time) could send
 * the same payout, refund or reversal a second time.
 *
 * The contract, per money movement, keyed by a stable operation key (the same
 * string is also the Stripe idempotency key and is written into the Stripe
 * object's metadata as `nexus_operation_key`):
 *
 *   1. A `pending` row is written BEFORE the Stripe call. The key is unique, so
 *      a second attempt finds the row instead of a clean slate.
 *   2. Success → `succeeded` with the Stripe object id. A later attempt returns
 *      that id and never calls Stripe.
 *   3. Stripe answered with a refusal that proves it did not act (4xx other
 *      than 409 / idempotency errors) → `failed`. Retrying is safe.
 *   4. Anything else — connection error, timeout, 5xx, 409, an exception of our
 *      own, a crash that leaves the row `pending` — is `unknown`, never
 *      `failed`. The next attempt first LOOKS THE OBJECT UP in Stripe by its
 *      metadata key: found → adopt it, no second call; Stripe confirms it has
 *      none → send, still under the same idempotency key.
 *
 * Callers still hold their own money-movement lock; this record is what makes a
 * retry safe after the lock and Stripe's key have both gone.
 */
final class StripeMoneyOperationService
{
    public const TABLE = 'stripe_money_operations';

    public const STATUS_PENDING = 'pending';
    public const STATUS_SUCCEEDED = 'succeeded';
    public const STATUS_FAILED = 'failed';
    public const STATUS_UNKNOWN = 'unknown';

    public const METADATA_KEY = 'nexus_operation_key';

    /** Upper bound on objects scanned by one Stripe look-up. */
    private const LOOKUP_SCAN_LIMIT = 1000;

    /**
     * Perform one money-moving Stripe call at most once.
     *
     * @param callable(string): string       $send  Makes the Stripe call using the given operation key as
     *                                              its idempotency key and as metadata[nexus_operation_key];
     *                                              returns the Stripe object id.
     * @param callable(string): (string|null) $find Looks the object up in Stripe by that metadata key;
     *                                              returns its id, or null when Stripe definitely has none.
     * @param bool $mayHaveUnrecordedAttempt True when an attempt may already have reached Stripe
     *                                       before this record existed (e.g. a payout already marked
     *                                       scheduled/failed by older code): the first attempt then
     *                                       looks up before sending too.
     *
     * @return string The Stripe object id.
     *
     * @throws StripeMoneyOperationUnresolvedException The outcome is unknown; nothing may be assumed.
     * @throws \Throwable The original Stripe exception when Stripe definitely did not act.
     */
    public static function perform(
        int $tenantId,
        string $operationKey,
        string $kind,
        string $subjectType,
        int $subjectId,
        int $amountMinor,
        string $currency,
        callable $send,
        callable $find,
        bool $mayHaveUnrecordedAttempt = false,
    ): string {
        $inserted = DB::table(self::TABLE)->insertOrIgnore([
            'tenant_id' => $tenantId,
            'operation_key' => $operationKey,
            'kind' => $kind,
            'subject_type' => $subjectType,
            'subject_id' => $subjectId,
            'amount_minor' => max(0, $amountMinor),
            'currency' => strtolower(substr($currency, 0, 3)),
            'status' => self::STATUS_PENDING,
            'attempts' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        if ($inserted === 1) {
            if ($mayHaveUnrecordedAttempt) {
                return self::reconcileThenSend($operationKey, $send, $find, false);
            }

            return self::send($operationKey, $send);
        }

        $row = DB::table(self::TABLE)->where('operation_key', $operationKey)->first();
        if ($row === null) {
            // The insert was ignored but the row cannot be read back. Never
            // guess: treat as unresolved rather than sending blind.
            throw new StripeMoneyOperationUnresolvedException($operationKey);
        }

        if ((int) $row->tenant_id !== $tenantId
            || (string) $row->kind !== $kind
            || (string) $row->subject_type !== $subjectType
            || (int) $row->subject_id !== $subjectId) {
            // The same key names a different movement. That is a programming
            // error, and sending anything under it could move the wrong money.
            Log::critical('StripeMoneyOperation: operation key reused for a different movement — nothing sent', [
                'operation_key' => $operationKey,
                'recorded_kind' => $row->kind,
                'requested_kind' => $kind,
                'recorded_subject' => $row->subject_type . ':' . $row->subject_id,
                'requested_subject' => $subjectType . ':' . $subjectId,
            ]);
            throw new StripeMoneyOperationUnresolvedException($operationKey);
        }
        if ((int) $row->amount_minor !== max(0, $amountMinor)) {
            // Not a reason to block: a recorded success is still returned and
            // an unresolved one is still looked up first. Stripe itself refuses
            // a different amount under the same idempotency key.
            Log::warning('StripeMoneyOperation: retry computed a different amount than the recorded attempt', [
                'operation_key' => $operationKey,
                'recorded_amount_minor' => (int) $row->amount_minor,
                'requested_amount_minor' => $amountMinor,
            ]);
        }

        $status = (string) $row->status;
        if ($status === self::STATUS_SUCCEEDED && (string) ($row->stripe_object_id ?? '') !== '') {
            return (string) $row->stripe_object_id;
        }

        if ($status === self::STATUS_FAILED) {
            // Stripe definitely did not act last time: retrying is safe.
            $reclaimed = DB::table(self::TABLE)
                ->where('id', $row->id)
                ->where('status', self::STATUS_FAILED)
                ->update([
                    'status' => self::STATUS_PENDING,
                    'attempts' => DB::raw('attempts + 1'),
                    'last_error' => null,
                    'updated_at' => now(),
                ]);
            if ($reclaimed !== 1) {
                throw new StripeMoneyOperationUnresolvedException($operationKey);
            }

            return self::send($operationKey, $send);
        }

        // pending (a crash, or a local failure after the call) or unknown
        // (no reply): look before sending again.
        return self::reconcileThenSend($operationKey, $send, $find, true);
    }

    /**
     * Record that Stripe has the object for an operation, when we learn it from
     * somewhere other than the call's own reply (e.g. a webhook carrying our
     * metadata key). Only an unresolved row is changed.
     */
    public static function adopt(string $operationKey, string $stripeObjectId): void
    {
        if ($operationKey === '' || $stripeObjectId === '') {
            return;
        }
        $updated = DB::table(self::TABLE)
            ->where('operation_key', $operationKey)
            ->whereIn('status', [self::STATUS_PENDING, self::STATUS_UNKNOWN])
            ->update([
                'status' => self::STATUS_SUCCEEDED,
                'stripe_object_id' => $stripeObjectId,
                'last_error' => null,
                'completed_at' => now(),
                'updated_at' => now(),
            ]);
        if ($updated > 0) {
            Log::info('StripeMoneyOperation: unresolved operation confirmed from a Stripe event', [
                'operation_key' => $operationKey,
                'stripe_object_id' => $stripeObjectId,
            ]);
        }
    }

    /**
     * Is any operation of this kind for this subject still unresolved
     * (pending or unknown), other than the one named?
     */
    public static function hasUnresolved(
        int $tenantId,
        string $subjectType,
        int $subjectId,
        string $kind,
        ?string $exceptOperationKey = null,
    ): bool {
        $query = DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('subject_type', $subjectType)
            ->where('subject_id', $subjectId)
            ->where('kind', $kind)
            ->whereIn('status', [self::STATUS_PENDING, self::STATUS_UNKNOWN]);
        if ($exceptOperationKey !== null) {
            $query->where('operation_key', '!=', $exceptOperationKey);
        }

        return $query->exists();
    }

    /**
     * Settle every OTHER unresolved operation of this kind for this subject by
     * looking each one up in Stripe. Returns true only when all of them are
     * confirmed absent in Stripe (each is then marked `failed`, since Stripe
     * never acted on it). One that IS found is adopted (`succeeded`) and makes
     * this return false: that money moved, and the local ledger has not caught
     * up yet (the Stripe webhook will record it), so a new movement must wait.
     * A look-up that cannot be completed also returns false.
     *
     * @param callable(string): (string|null) $find
     */
    public static function settleOthersIfAbsent(
        int $tenantId,
        string $subjectType,
        int $subjectId,
        string $kind,
        string $exceptOperationKey,
        callable $find,
    ): bool {
        $keys = DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('subject_type', $subjectType)
            ->where('subject_id', $subjectId)
            ->where('kind', $kind)
            ->whereIn('status', [self::STATUS_PENDING, self::STATUS_UNKNOWN])
            ->where('operation_key', '!=', $exceptOperationKey)
            ->pluck('operation_key');

        $allAbsent = true;
        foreach ($keys as $key) {
            $key = (string) $key;
            try {
                $found = $find($key);
            } catch (\Throwable $exception) {
                Log::warning('StripeMoneyOperation: could not settle an earlier unresolved operation', [
                    'operation_key' => $key,
                    'error' => $exception->getMessage(),
                ]);
                $allAbsent = false;
                continue;
            }
            if (is_string($found) && $found !== '') {
                self::mark($key, self::STATUS_SUCCEEDED, $found, null);
                $allAbsent = false;
                continue;
            }
            self::mark($key, self::STATUS_FAILED, null, 'Confirmed absent in Stripe by a later look-up');
        }

        return $allAbsent;
    }

    /**
     * True only when Stripe answered and the answer proves it did not act on
     * the request. Everything else — no answer, 5xx, 409 (concurrent use of the
     * key), an idempotency conflict (a PREVIOUS request under this key was
     * processed), or any non-Stripe exception — is treated as "may have acted".
     */
    public static function stripeDefinitelyDidNotAct(\Throwable $exception): bool
    {
        if ($exception instanceof \Stripe\Exception\IdempotencyException) {
            return false;
        }
        if ($exception instanceof \Stripe\Exception\InvalidArgumentException) {
            // Raised by the SDK before any request is sent.
            return true;
        }
        if ($exception instanceof \Stripe\Exception\InvalidRequestException
            || $exception instanceof \Stripe\Exception\CardException
            || $exception instanceof \Stripe\Exception\AuthenticationException
            || $exception instanceof \Stripe\Exception\PermissionException) {
            $status = $exception->getHttpStatus();

            return is_int($status) && $status >= 400 && $status < 500 && $status !== 409;
        }

        return false;
    }

    // -----------------------------------------------------------------
    //  Stripe look-ups by metadata key (used as `$find`)
    // -----------------------------------------------------------------

    /**
     * Find a transfer in a transfer group carrying our operation key. When
     * `$legacyMatch` is given, a transfer matching all of those metadata values
     * (from code that did not yet write the operation key) is adopted too.
     *
     * @param array<string,string> $legacyMatch
     */
    public static function findTransfer(
        StripeClient $client,
        string $transferGroup,
        string $operationKey,
        array $legacyMatch = [],
    ): ?string {
        $page = $client->transfers->all(['transfer_group' => $transferGroup, 'limit' => 100]);

        return self::scan($page, $operationKey, $legacyMatch);
    }

    /** Find a refund on a PaymentIntent carrying our operation key. */
    public static function findRefund(
        StripeClient $client,
        string $paymentIntentId,
        string $operationKey,
    ): ?string {
        $page = $client->refunds->all(['payment_intent' => $paymentIntentId, 'limit' => 100]);

        return self::scan($page, $operationKey);
    }

    /** Find a reversal of a transfer carrying our operation key. */
    public static function findTransferReversal(
        StripeClient $client,
        string $transferId,
        string $operationKey,
    ): ?string {
        $page = $client->transfers->allReversals($transferId, ['limit' => 100]);

        return self::scan($page, $operationKey);
    }

    /** Find a refund of an application fee carrying our operation key. */
    public static function findApplicationFeeRefund(
        StripeClient $client,
        string $applicationFeeId,
        string $operationKey,
    ): ?string {
        $page = $client->applicationFees->allRefunds($applicationFeeId, ['limit' => 100]);

        return self::scan($page, $operationKey);
    }

    // -----------------------------------------------------------------
    //  Internals
    // -----------------------------------------------------------------

    /** @param callable(string): string $send */
    private static function send(string $operationKey, callable $send): string
    {
        try {
            $stripeObjectId = (string) $send($operationKey);
        } catch (\Throwable $exception) {
            if (self::stripeDefinitelyDidNotAct($exception)) {
                self::mark($operationKey, self::STATUS_FAILED, null, $exception->getMessage());
                throw $exception;
            }
            self::mark($operationKey, self::STATUS_UNKNOWN, null, $exception->getMessage());
            Log::critical('StripeMoneyOperation: outcome unknown — recorded for reconciliation, will be looked up in Stripe before any re-send', [
                'operation_key' => $operationKey,
                'error_class' => $exception::class,
                'error' => $exception->getMessage(),
            ]);
            throw new StripeMoneyOperationUnresolvedException($operationKey, '', $exception);
        }

        if ($stripeObjectId === '') {
            self::mark($operationKey, self::STATUS_UNKNOWN, null, 'Stripe reply carried no object id');
            throw new StripeMoneyOperationUnresolvedException($operationKey);
        }

        try {
            self::mark($operationKey, self::STATUS_SUCCEEDED, $stripeObjectId, null);
        } catch (\Throwable $exception) {
            // The money moved. The row stays `pending`, which the next attempt
            // resolves by look-up, so do not fail the caller's bookkeeping here.
            Log::critical('StripeMoneyOperation: could not record a completed Stripe call — left pending for look-up', [
                'operation_key' => $operationKey,
                'stripe_object_id' => $stripeObjectId,
                'error' => $exception->getMessage(),
            ]);
        }

        return $stripeObjectId;
    }

    /**
     * @param callable(string): string        $send
     * @param callable(string): (string|null) $find
     */
    private static function reconcileThenSend(
        string $operationKey,
        callable $send,
        callable $find,
        bool $countAttempt,
    ): string {
        try {
            $found = $find($operationKey);
        } catch (\Throwable $exception) {
            self::mark($operationKey, self::STATUS_UNKNOWN, null, 'Stripe look-up failed: ' . $exception->getMessage());
            Log::critical('StripeMoneyOperation: could not look the operation up in Stripe — nothing re-sent', [
                'operation_key' => $operationKey,
                'error' => $exception->getMessage(),
            ]);
            throw new StripeMoneyOperationUnresolvedException($operationKey, '', $exception);
        }

        if (is_string($found) && $found !== '') {
            self::mark($operationKey, self::STATUS_SUCCEEDED, $found, null);
            Log::warning('StripeMoneyOperation: earlier attempt found in Stripe and adopted — not re-sent', [
                'operation_key' => $operationKey,
                'stripe_object_id' => $found,
            ]);

            return $found;
        }

        // Stripe confirms it holds nothing under this key: sending is safe, and
        // is still made under the same idempotency key.
        $update = [
            'status' => self::STATUS_PENDING,
            'updated_at' => now(),
        ];
        if ($countAttempt) {
            $update['attempts'] = DB::raw('attempts + 1');
        }
        DB::table(self::TABLE)->where('operation_key', $operationKey)->update($update);

        return self::send($operationKey, $send);
    }

    private static function mark(string $operationKey, string $status, ?string $stripeObjectId, ?string $error): void
    {
        $values = [
            'status' => $status,
            'last_error' => $error !== null ? mb_substr($error, 0, 500) : null,
            'updated_at' => now(),
        ];
        if ($stripeObjectId !== null) {
            $values['stripe_object_id'] = $stripeObjectId;
        }
        if ($status === self::STATUS_SUCCEEDED) {
            $values['completed_at'] = now();
        }
        DB::table(self::TABLE)->where('operation_key', $operationKey)->update($values);
    }

    /**
     * @param \Stripe\Collection<\Stripe\StripeObject> $page
     * @param array<string,string> $legacyMatch
     */
    private static function scan(\Stripe\Collection $page, string $operationKey, array $legacyMatch = []): ?string
    {
        $seen = 0;
        foreach ($page->autoPagingIterator() as $object) {
            if (++$seen > self::LOOKUP_SCAN_LIMIT) {
                // Refuse to conclude "absent" from a partial scan.
                throw new \RuntimeException('Stripe look-up exceeded the scan limit for ' . $operationKey);
            }
            $metadata = $object->metadata ?? null;
            if ($metadata === null) {
                continue;
            }
            if (isset($metadata[self::METADATA_KEY]) && (string) $metadata[self::METADATA_KEY] === $operationKey) {
                return (string) $object->id;
            }
            if ($legacyMatch !== []) {
                $matches = true;
                foreach ($legacyMatch as $field => $expected) {
                    if (! isset($metadata[$field]) || (string) $metadata[$field] !== $expected) {
                        $matches = false;
                        break;
                    }
                }
                if ($matches) {
                    return (string) $object->id;
                }
            }
        }

        return null;
    }
}
