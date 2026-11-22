<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Support\Billing\BillingLock;
use App\Support\Billing\BillingSettings;
use App\Support\Billing\JoiningGate;
use App\Support\Billing\OverLimitRule;
use Illuminate\Support\Facades\DB;

/**
 * A community's payment standing: who it pays, whether it is suspended for
 * non-payment, and whether the platform team has exempted it.
 *
 * This service decides nothing about WHO may call it — every caller checks
 * that first (the platform team endpoints, and later a parent's manager
 * through SuperPanelAccess). It refuses what must never happen whoever asks,
 * records every change against the person who made it, and forgets the lock
 * cache so the change is visible at once.
 *
 * Refusals are `\DomainException` with one of these messages, which callers
 * map to a translated error: `tenant_not_found`,
 * `platform_tenant_not_billable`, `community_is_exempt`,
 * `exempt_reason_required`, `paid_until_invalid`, and for payments recorded
 * by hand and the payer: `payment_paid_until_required`,
 * `payment_received_on_invalid`, `payment_method_invalid`,
 * `payment_amount_invalid`, `payment_currency_invalid`, `payer_invalid`,
 * `payer_needs_parent`; for voiding a payment: `payment_not_found`,
 * `payment_card_not_voidable`, `payment_already_voided`,
 * `payment_void_reason_required`; and for the over-limit rule:
 * `over_limit_action_invalid`, `over_limit_days_invalid`,
 * `over_limit_rule_not_allowed`.
 */
final class BillingStandingService
{
    public const PAYERS = ['platform_card', 'platform_invoice', 'parent', 'not_billed'];

    /** How a payment recorded by hand arrived. */
    public const PAYMENT_METHODS = ['bank_transfer', 'cheque', 'cash', 'card', 'other'];

    private const REFERENCE_MAX = 190;

    /**
     * Why a community is paused. Recorded so that settling one never lifts the
     * other: paying up does not open a community paused for being over its
     * member limit, and getting back under the limit does not open one paused
     * for not paying.
     */
    public const REASONS = ['non_payment', 'over_limit'];

    private const NOTE_MAX = 500;

    /**
     * @return array{
     *   tenant_id:int, payer:string, payer_is_default:bool, paid_until:?string,
     *   suspended_at:?string, suspension_source:?string, suspension_note:?string,
     *   suspension_reason:?string, over_limit_since:?string,
     *   exempt:bool, exempt_reason:?string, locked:bool, locked_by_tenant_id:?int
     * }
     */
    public static function get(int $tenantId): array
    {
        $row = self::row($tenantId);
        $reason = BillingLock::reasonFor($tenantId);
        $storedPayer = $row->payer ?? null;

        return [
            'tenant_id' => $tenantId,
            'payer' => $storedPayer ?? self::defaultPayer($tenantId),
            'payer_is_default' => $storedPayer === null,
            'paid_until' => isset($row->paid_until) ? substr((string) $row->paid_until, 0, 10) : null,
            'suspended_at' => isset($row->suspended_at) ? (string) $row->suspended_at : null,
            'suspension_source' => isset($row->suspended_at) ? (string) ($row->suspension_source ?? 'manual') : null,
            'suspension_note' => isset($row->suspended_at) ? ($row->suspension_note ?? null) : null,
            // A pause from before reasons were recorded was for non-payment:
            // that was the only kind there was.
            'suspension_reason' => isset($row->suspended_at) ? (string) ($row->suspension_reason ?? 'non_payment') : null,
            'over_limit_since' => isset($row->over_limit_since) ? substr((string) $row->over_limit_since, 0, 10) : null,
            'exempt' => !empty($row->exempt),
            'exempt_reason' => !empty($row->exempt) ? ($row->exempt_reason ?? null) : null,
            'locked' => $reason !== null,
            'locked_by_tenant_id' => $reason['tenant_id'] ?? null,
        ];
    }

    /**
     * Who a community pays when nobody has said otherwise.
     *
     * The platform's own community is never billed. A community directly under
     * it pays the platform — by card when it holds a card subscription Stripe
     * has not ended, by invoice otherwise. Anything deeper pays its direct
     * parent.
     *
     * "A card subscription Stripe has not ended" is
     * TenantBillingService::hasLiveCardSubscription(): a community whose card
     * has just failed is still a card payer. It used to become "by invoice"
     * at that moment, which switched off the wait for Stripe's retries.
     */
    public static function defaultPayer(int $tenantId): string
    {
        if ($tenantId === 1) {
            return 'not_billed';
        }

        $tenant = self::requireTenant($tenantId);
        $parentId = $tenant->parent_id !== null ? (int) $tenant->parent_id : null;

        if ($parentId !== null && $parentId > 1) {
            return 'parent';
        }

        return TenantBillingService::hasLiveCardSubscription($tenantId) ? 'platform_card' : 'platform_invoice';
    }

    /**
     * Suspend a community. `$actedBy` null = the system. `$reason` is
     * `non_payment` (every pause a person makes) or `over_limit` (only the
     * daily check's member-limit clock).
     */
    public static function suspend(int $tenantId, ?int $actedBy, string $source, ?string $note = null, string $reason = 'non_payment'): void
    {
        if (!in_array($source, ['auto', 'manual'], true)) {
            throw new \InvalidArgumentException("Unknown suspension source: {$source}");
        }
        if (!in_array($reason, self::REASONS, true)) {
            throw new \InvalidArgumentException("Unknown suspension reason: {$reason}");
        }

        self::requireBillable($tenantId);
        $row = self::row($tenantId);

        if (!empty($row->exempt)) {
            throw new \DomainException('community_is_exempt');
        }

        if (isset($row->suspended_at)) {
            return;
        }

        $note = self::cleanNote($note);
        $now = now();

        self::write($tenantId, [
            'suspended_at' => $now,
            'suspended_by_user_id' => $actedBy,
            'suspension_source' => $source,
            'suspension_note' => $note,
            'suspension_reason' => $reason,
        ]);

        TenantBillingService::logAudit(
            $tenantId,
            $actedBy,
            'standing_suspended',
            ['suspended_at' => null],
            ['suspended_at' => $now->toDateTimeString(), 'source' => $source, 'reason' => $reason],
            $note
        );

        BillingLock::flush();
    }

    /**
     * Lift a suspension. `$actedBy` null = the system.
     *
     * A PERSON lifting a pause for being over the member limit starts a new
     * episode: the first day over is cleared, so the next daily check finds
     * it over afresh, sends a new "over" notice and counts the full days
     * from that notice. (It used to move the first day over to today, which
     * let the next pause come with no warning for it.) The check lifting its
     * own pause (back under the limit) clears the days over itself, so it is
     * not affected.
     */
    public static function restore(int $tenantId, ?int $actedBy, ?string $note = null): void
    {
        self::requireTenant($tenantId);
        $row = self::row($tenantId);

        if (!isset($row->suspended_at)) {
            return;
        }

        $note = self::cleanNote($note);

        $values = [
            'suspended_at' => null,
            'suspended_by_user_id' => null,
            'suspension_source' => null,
            'suspension_note' => null,
            'suspension_reason' => null,
        ];
        if ($actedBy !== null && ($row->suspension_reason ?? null) === 'over_limit' && isset($row->over_limit_since)) {
            $values['over_limit_since'] = null;
        }

        self::write($tenantId, $values);

        TenantBillingService::logAudit(
            $tenantId,
            $actedBy,
            'standing_restored',
            [
                'suspended_at' => (string) $row->suspended_at,
                'source' => $row->suspension_source ?? null,
                'reason' => $row->suspension_reason ?? null,
            ],
            ['suspended_at' => null],
            $note
        );

        BillingLock::flush();
    }

    /**
     * Record the date a community is paid up to. Null = no date is tracked,
     * and nothing automatic ever happens to it.
     *
     * A date in the past is accepted on purpose: it is how "overdue since"
     * is recorded. A date the daily check would not pause for — fewer than
     * `suspend_days_late` days in the past — restores a community the SYSTEM
     * paused for non-payment. One a person paused stays paused until a
     * person restores it: they may have had another reason. A pause for being
     * over the member limit is not about money and is never lifted here.
     *
     * A new date starts the payment notices again: each is sent once per
     * paid-until date.
     */
    public static function setPaidUntil(int $tenantId, ?string $date, ?int $actedBy, ?string $note = null): void
    {
        self::requireBillable($tenantId);

        if ($date !== null) {
            $parsed = \DateTimeImmutable::createFromFormat('!Y-m-d', $date);
            if ($parsed === false || $parsed->format('Y-m-d') !== $date) {
                throw new \DomainException('paid_until_invalid');
            }
        }

        $row = self::row($tenantId);
        $current = isset($row->paid_until) ? substr((string) $row->paid_until, 0, 10) : null;

        if ($current === $date) {
            return;
        }

        $note = self::cleanNote($note);

        if (
            $date !== null
            && isset($row->suspended_at)
            && ($row->suspension_source ?? null) === 'auto'
            && ($row->suspension_reason ?? 'non_payment') === 'non_payment'
            && $date > now()->subDays((int) BillingSettings::get('suspend_days_late'))->toDateString()
        ) {
            self::restore($tenantId, $actedBy, $note);
        }

        // The notice stages start again for the new date. A date that is
        // still ahead keeps the day it was set, so the daily check does not
        // send a reminder whose day had already gone by then (paid on the
        // 30th for the month ahead: no "30 days to go" email on the 31st).
        $setOn = $date !== null && $date >= now()->toDateString() ? now() : null;
        self::write($tenantId, ['paid_until' => $date, 'last_notice_stage' => null, 'last_notice_at' => $setOn]);

        TenantBillingService::logAudit(
            $tenantId,
            $actedBy,
            'standing_paid_until_set',
            ['paid_until' => $current],
            ['paid_until' => $date],
            $note
        );

        BillingLock::flush();
    }

    /**
     * Exempt a community from suspension, or remove the exemption.
     *
     * An exempt community is never suspended: not for its own lateness, and
     * not because a community above it is. Exempting a community that is
     * suspended restores it first.
     */
    public static function setExempt(int $tenantId, bool $exempt, int $actedBy, ?string $reason = null): void
    {
        self::requireBillable($tenantId);
        $reason = self::cleanNote($reason);

        if ($exempt && $reason === null) {
            throw new \DomainException('exempt_reason_required');
        }

        $row = self::row($tenantId);
        $wasExempt = !empty($row->exempt);

        if ($exempt) {
            if (isset($row->suspended_at)) {
                self::restore($tenantId, $actedBy, $reason);
            }

            self::write($tenantId, [
                'exempt' => 1,
                'exempt_reason' => $reason,
                'exempt_by_user_id' => $actedBy,
                'exempt_at' => now(),
            ]);
            if (!$wasExempt) {
                self::restartLimitClock([$tenantId]);
            }

            TenantBillingService::logAudit(
                $tenantId,
                $actedBy,
                'standing_exempted',
                ['exempt' => $wasExempt, 'reason' => $row->exempt_reason ?? null],
                ['exempt' => true, 'reason' => $reason],
                $reason
            );
        } else {
            if (!$wasExempt) {
                return;
            }

            self::write($tenantId, [
                'exempt' => 0,
                'exempt_reason' => null,
                'exempt_by_user_id' => null,
                'exempt_at' => null,
            ]);
            // A count from before the exemption never carries over it: the
            // first run after starts afresh, with a fresh notice.
            self::restartLimitClock([$tenantId]);
            // And the payment warnings: a final warning from before the
            // exemption must not pause it the morning it comes off.
            self::restartPaymentClock([$tenantId]);

            TenantBillingService::logAudit(
                $tenantId,
                $actedBy,
                'standing_exemption_removed',
                ['exempt' => true, 'reason' => $row->exempt_reason ?? null],
                ['exempt' => false],
                $reason
            );
        }

        BillingLock::flush();
        JoiningGate::flush();
    }

    /**
     * Record a payment that did not come through Stripe — a bank transfer, a
     * cheque — and move the paid-until date to what it pays for. Returns the
     * new payment's id.
     *
     * The date moves through setPaidUntil(), inside the same transaction as
     * the payment row, so the notice stages, lifting an automatic non-payment
     * pause and the audit entry happen exactly as for a date set directly,
     * and once. A payment may be recorded for an exempt community and for a
     * card payer: money that arrived is recorded whoever it came from.
     *
     * `$payeeTenantId` is who was paid: null = the platform, otherwise the
     * parent community the payment was made to. The caller decides it (the
     * platform team's endpoint from who the community pays; a hub manager's
     * from BranchPayments::payeeFor()); it is stored so a hub's manager sees
     * the payments made to that hub and no others.
     *
     * @param array<string, mixed> $payment paid_until, received_on, method,
     *                                      reference?, amount?, currency?
     */
    public static function recordPayment(int $tenantId, array $payment, int $actedBy, ?int $payeeTenantId = null): int
    {
        self::requireBillable($tenantId);

        $paidUntil = $payment['paid_until'] ?? null;
        if ($paidUntil === null || $paidUntil === '') {
            throw new \DomainException('payment_paid_until_required');
        }
        if (!is_string($paidUntil) || !self::isDate($paidUntil)) {
            throw new \DomainException('paid_until_invalid');
        }

        $receivedOn = $payment['received_on'] ?? null;
        // Not in the future. One day of slack: the screen sends the browser's
        // own today, which east of the server's clock is its tomorrow.
        if (!is_string($receivedOn) || !self::isDate($receivedOn) || $receivedOn > now()->addDay()->toDateString()) {
            throw new \DomainException('payment_received_on_invalid');
        }

        $method = $payment['method'] ?? null;
        if (!is_string($method) || !in_array($method, self::PAYMENT_METHODS, true)) {
            throw new \DomainException('payment_method_invalid');
        }

        $reference = $payment['reference'] ?? null;
        $reference = is_string($reference) || is_int($reference) || is_float($reference)
            ? trim((string) $reference)
            : '';
        $reference = $reference === '' ? null : mb_substr($reference, 0, self::REFERENCE_MAX);

        $amount = self::cleanAmount($payment['amount'] ?? null);

        // A currency means nothing without an amount, so it is not kept.
        $currency = null;
        if ($amount !== null) {
            $currency = $payment['currency'] ?? null;
            if (!is_string($currency) || preg_match('/^[A-Z]{3}$/', $currency) !== 1) {
                throw new \DomainException('payment_currency_invalid');
            }
        }

        if ($payeeTenantId !== null && $payeeTenantId <= 1) {
            $payeeTenantId = null;
        }

        return (int) DB::transaction(function () use ($tenantId, $paidUntil, $receivedOn, $method, $reference, $amount, $currency, $actedBy, $payeeTenantId): int {
            $row = self::row($tenantId);
            $before = isset($row->paid_until) ? substr((string) $row->paid_until, 0, 10) : null;

            // A payment that leaves the date where it is, or moves it back,
            // would be stored and change nothing else: no reminders started
            // again, no community reopened, while the screen says "recorded".
            // Correcting a date is setPaidUntil()'s job, not a payment's.
            if ($before !== null && $paidUntil <= $before) {
                throw new \DomainException('payment_paid_until_not_later');
            }

            $id = (int) DB::table('billing_payments')->insertGetId([
                'tenant_id' => $tenantId,
                'received_on' => $receivedOn,
                'method' => $method,
                'reference' => $reference,
                'amount' => $amount,
                'currency' => $currency,
                'paid_until_before' => $before,
                'paid_until_after' => $paidUntil,
                'recorded_by_user_id' => $actedBy,
                'created_at' => now(),
                'payee_tenant_id' => $payeeTenantId,
            ]);

            // The audit note points at the payment record rather than
            // repeating it: the method and reference are what a person
            // reading the log looks for.
            $note = "payment {$id}: {$method}" . ($reference !== null ? ", {$reference}" : '');
            self::setPaidUntil($tenantId, $paidUntil, $actedBy, $note);

            return $id;
        });
    }

    /**
     * Record a card payment Stripe reported as paid. Returns the new
     * payment's id, or null when nothing was written.
     *
     * Once per Stripe invoice, however many times Stripe sends the event: the
     * invoice id is unique on the table, and a second insert is ignored.
     *
     * Nothing is written, and that is not a fault, for: the platform's own
     * community (never billed), an event with no invoice id (nothing to tell
     * a second delivery by), and an invoice on which nothing was paid (a
     * credit note, a 100% coupon).
     *
     * This does NOT move the paid-until date. The caller has already done
     * that from the subscription's period, forward only; `paid_until_before`
     * and `paid_until_after` are told to it so the row reads like every other.
     *
     * @param array<string, mixed> $facts stripe_invoice_id, amount_paid (in
     *                                    the currency's smallest unit),
     *                                    currency, paid_at (timestamp)?,
     *                                    stripe_payment_intent_id?,
     *                                    stripe_charge_id?,
     *                                    paid_until_before?, paid_until_after?
     */
    public static function recordCardPayment(int $tenantId, array $facts): ?int
    {
        if ($tenantId <= 1) {
            return null;
        }

        $invoiceId = self::cleanStripeId($facts['stripe_invoice_id'] ?? null);
        if ($invoiceId === null) {
            return null;
        }

        $cents = $facts['amount_paid'] ?? null;
        if (!is_int($cents) && !(is_string($cents) && ctype_digit($cents))) {
            return null;
        }
        $cents = (int) $cents;
        if ($cents <= 0) {
            return null;
        }

        $currency = strtoupper(trim((string) ($facts['currency'] ?? '')));
        if (preg_match('/^[A-Z]{3}$/', $currency) !== 1) {
            return null;
        }

        self::requireTenant($tenantId);

        $paidAt = $facts['paid_at'] ?? null;
        $receivedOn = is_numeric($paidAt) && (int) $paidAt > 0
            ? date('Y-m-d', (int) $paidAt)
            : now()->toDateString();

        $before = self::dateOrNull($facts['paid_until_before'] ?? null);
        // The column is not nullable. With no date on record (Stripe could
        // not say what the payment pays up to), the day it was paid is the
        // only date known.
        $after = self::dateOrNull($facts['paid_until_after'] ?? null) ?? $receivedOn;

        $inserted = DB::table('billing_payments')->insertOrIgnore([
            'tenant_id' => $tenantId,
            'received_on' => $receivedOn,
            'method' => 'card',
            'reference' => mb_substr($invoiceId, 0, self::REFERENCE_MAX),
            'amount' => number_format($cents / 100, 2, '.', ''),
            'currency' => $currency,
            'paid_until_before' => $before,
            'paid_until_after' => $after,
            'recorded_by_user_id' => null,
            'created_at' => now(),
            'payee_tenant_id' => null,
            'stripe_invoice_id' => $invoiceId,
            'stripe_payment_intent_id' => self::cleanStripeId($facts['stripe_payment_intent_id'] ?? null),
            'stripe_charge_id' => self::cleanStripeId($facts['stripe_charge_id'] ?? null),
        ]);
        if ($inserted === 0) {
            return null;
        }

        $id = (int) DB::table('billing_payments')->where('stripe_invoice_id', $invoiceId)->value('id');

        TenantBillingService::logAudit(
            $tenantId,
            null,
            'payment_recorded',
            null,
            ['payment_id' => $id, 'method' => 'card', 'amount' => number_format($cents / 100, 2, '.', ''), 'currency' => $currency],
            "payment {$id}: card, {$invoiceId}"
        );

        return $id;
    }

    /** How long a refund or a closed dispute stays flagged on Billing control. */
    public const PAYMENT_ALERT_DAYS = 60;

    /** Stripe's words for a dispute that has ended with the payment standing. */
    private const DISPUTE_WON = ['won', 'warning_closed'];

    /**
     * The card payment a Stripe charge belongs to, or null.
     *
     * Matched on the charge, the payment intent or the invoice, whichever of
     * them Stripe names: a refund and a dispute are reported against the
     * charge, and the payment was recorded from the invoice. Only a payment
     * Stripe itself reported is ever matched, never one recorded by hand.
     *
     * Null is the ordinary answer for a charge that is not a community's plan
     * payment at all (a donation, a marketplace order).
     *
     * @param array<string, mixed> $ids charge?, payment_intent?, invoice?
     */
    public static function cardPaymentFor(array $ids): ?object
    {
        $charge = self::cleanStripeId($ids['charge'] ?? null);
        $paymentIntent = self::cleanStripeId($ids['payment_intent'] ?? null);
        $invoice = self::cleanStripeId($ids['invoice'] ?? null);
        if ($charge === null && $paymentIntent === null && $invoice === null) {
            return null;
        }

        return DB::table('billing_payments')
            ->whereNotNull('stripe_invoice_id')
            ->where(static function ($q) use ($charge, $paymentIntent, $invoice): void {
                if ($charge !== null) {
                    $q->orWhere('stripe_charge_id', $charge);
                }
                if ($paymentIntent !== null) {
                    $q->orWhere('stripe_payment_intent_id', $paymentIntent);
                }
                if ($invoice !== null) {
                    $q->orWhere('stripe_invoice_id', $invoice);
                }
            })
            ->orderByDesc('id')
            ->first();
    }

    /**
     * Mark a card payment with what Stripe says has been refunded of it, in
     * total. True when that changed the record (a first refund, or a further
     * one); false when the row already says so.
     *
     * Nothing else changes: not the paid-until date, not the community's
     * standing. A person decides what a refund means.
     */
    public static function recordCardRefund(int $paymentId, int $refundedCents, ?string $chargeId = null): bool
    {
        if ($refundedCents <= 0) {
            return false;
        }

        $row = DB::table('billing_payments')->where('id', $paymentId)->whereNotNull('stripe_invoice_id')->first();
        if ($row === null) {
            return false;
        }

        $refunded = number_format($refundedCents / 100, 2, '.', '');
        $before = $row->refunded_amount !== null ? number_format((float) $row->refunded_amount, 2, '.', '') : null;
        if ($before === $refunded) {
            return false;
        }

        $values = ['refunded_amount' => $refunded, 'refunded_at' => now()];
        $chargeId = self::cleanStripeId($chargeId);
        if ($row->stripe_charge_id === null && $chargeId !== null) {
            $values['stripe_charge_id'] = $chargeId;
        }
        DB::table('billing_payments')->where('id', $paymentId)->update($values);

        TenantBillingService::logAudit(
            (int) $row->tenant_id,
            null,
            'payment_refunded',
            ['payment_id' => $paymentId, 'refunded_amount' => $before],
            ['payment_id' => $paymentId, 'refunded_amount' => $refunded, 'currency' => $row->currency],
            "payment {$paymentId}: refunded in Stripe"
        );

        return true;
    }

    /**
     * Mark a card payment with the state of a dispute on it, in Stripe's own
     * word. True when that changed the record; false when the row already
     * says so. `disputed_at` is when the dispute was opened and is set once.
     *
     * Nothing else changes: nothing is paused, and no date moves.
     */
    public static function recordCardDispute(int $paymentId, string $status, ?int $openedAt = null, ?string $chargeId = null): bool
    {
        $status = self::cleanDisputeStatus($status);

        $row = DB::table('billing_payments')->where('id', $paymentId)->whereNotNull('stripe_invoice_id')->first();
        if ($row === null || $row->dispute_status === $status) {
            return false;
        }

        $values = ['dispute_status' => $status];
        if ($row->disputed_at === null) {
            $values['disputed_at'] = $openedAt !== null && $openedAt > 0 ? date('Y-m-d H:i:s', $openedAt) : now();
        }
        $chargeId = self::cleanStripeId($chargeId);
        if ($row->stripe_charge_id === null && $chargeId !== null) {
            $values['stripe_charge_id'] = $chargeId;
        }
        DB::table('billing_payments')->where('id', $paymentId)->update($values);

        TenantBillingService::logAudit(
            (int) $row->tenant_id,
            null,
            'payment_disputed',
            ['payment_id' => $paymentId, 'dispute_status' => $row->dispute_status],
            ['payment_id' => $paymentId, 'dispute_status' => $status],
            "payment {$paymentId}: dispute {$status} in Stripe"
        );

        return true;
    }

    /** Stripe's word for a dispute as stored: lower case, letters and underscores, at most 40. */
    public static function cleanDisputeStatus(mixed $status): string
    {
        $status = is_string($status) ? strtolower(trim($status)) : '';

        return preg_match('/^[a-z_]{1,40}$/', $status) === 1 ? $status : 'unknown';
    }

    /**
     * What a stored dispute status means for a reader: `open` (Stripe still
     * wants an answer, or is deciding), `won` (it ended and the payment
     * stands) or `lost` (the money went back to the cardholder). Null with no
     * dispute.
     */
    public static function disputeState(?string $status): ?string
    {
        if ($status === null || $status === '') {
            return null;
        }
        if ($status === 'lost') {
            return 'lost';
        }

        return in_array($status, self::DISPUTE_WON, true) ? 'won' : 'open';
    }

    /**
     * Which communities have a card payment that was refunded lately or is
     * disputed, for Billing control's list. A refund is flagged for
     * PAYMENT_ALERT_DAYS from the day it was recorded; a dispute while it is
     * open, and for the same number of days from the day it was opened.
     *
     * @param list<int> $tenantIds
     * @return array<int, array{refunded: bool, disputed: bool}> only communities with a flag
     */
    public static function paymentAlerts(array $tenantIds): array
    {
        $ids = array_values(array_unique(array_map('intval', $tenantIds)));
        if ($ids === []) {
            return [];
        }

        $since = now()->subDays(self::PAYMENT_ALERT_DAYS);
        $alerts = [];

        foreach (array_chunk($ids, 500) as $chunk) {
            $rows = DB::table('billing_payments')
                ->whereIn('tenant_id', $chunk)
                ->where(static function ($q): void {
                    $q->whereNotNull('refunded_at')->orWhereNotNull('dispute_status');
                })
                ->get(['tenant_id', 'refunded_at', 'dispute_status', 'disputed_at']);

            foreach ($rows as $row) {
                $refunded = $row->refunded_at !== null && (string) $row->refunded_at >= $since->toDateTimeString();
                $disputed = $row->dispute_status !== null && (
                    self::disputeState((string) $row->dispute_status) === 'open'
                    || ($row->disputed_at !== null && (string) $row->disputed_at >= $since->toDateTimeString())
                );
                if (!$refunded && !$disputed) {
                    continue;
                }

                $tenantId = (int) $row->tenant_id;
                $alerts[$tenantId] = [
                    'refunded' => ($alerts[$tenantId]['refunded'] ?? false) || $refunded,
                    'disputed' => ($alerts[$tenantId]['disputed'] ?? false) || $disputed,
                ];
            }
        }

        return $alerts;
    }

    /**
     * Void a payment recorded by hand. It is never deleted: the row stays,
     * marked with who voided it, when and why, and the history shows it
     * struck through.
     *
     * Voiding does NOT move the paid-until date by itself. A later payment,
     * or a date set by hand since, may be what the date now rests on, and
     * only the person voiding knows. They may set the date in the same step:
     * give `paid_until` in `$change` (a Y-m-d date, or null to stop tracking
     * one). It goes through setPaidUntil(), in the same transaction, so a
     * date moved back can pause nothing by itself and the audit entry is
     * written once.
     *
     * A card payment Stripe reported is not voided here: it is undone by a
     * refund in Stripe, which is recorded against it when Stripe reports it.
     *
     * `$onlyPaidTo` confines a parent community's manager to the payments
     * made to that parent: any other payment answers `payment_not_found`,
     * exactly as one that does not exist.
     *
     * @param array<string, mixed> $change `paid_until` (optional key)
     */
    public static function voidPayment(int $tenantId, int $paymentId, int $actedBy, ?string $reason, array $change = [], ?int $onlyPaidTo = null): void
    {
        self::requireBillable($tenantId);

        $reason = self::cleanNote($reason);
        if ($reason === null) {
            throw new \DomainException('payment_void_reason_required');
        }

        $setsDate = array_key_exists('paid_until', $change);
        $paidUntil = $change['paid_until'] ?? null;
        if ($setsDate && $paidUntil !== null && (!is_string($paidUntil) || !self::isDate($paidUntil))) {
            throw new \DomainException('paid_until_invalid');
        }

        DB::transaction(function () use ($tenantId, $paymentId, $actedBy, $reason, $setsDate, $paidUntil, $onlyPaidTo): void {
            $query = DB::table('billing_payments')->where('id', $paymentId)->where('tenant_id', $tenantId);
            if ($onlyPaidTo !== null) {
                $query->where('payee_tenant_id', $onlyPaidTo);
            }
            $row = $query->lockForUpdate()->first();

            if ($row === null) {
                throw new \DomainException('payment_not_found');
            }
            if ($row->stripe_invoice_id !== null) {
                throw new \DomainException('payment_card_not_voidable');
            }
            if ($row->voided_at !== null) {
                throw new \DomainException('payment_already_voided');
            }

            $now = now();
            DB::table('billing_payments')->where('id', $paymentId)->where('tenant_id', $tenantId)->update([
                'voided_at' => $now,
                'voided_by_user_id' => $actedBy,
                'void_reason' => $reason,
            ]);

            TenantBillingService::logAudit(
                $tenantId,
                $actedBy,
                'payment_voided',
                [
                    'payment_id' => $paymentId,
                    'method' => (string) $row->method,
                    'reference' => $row->reference,
                    'amount' => $row->amount !== null ? number_format((float) $row->amount, 2, '.', '') : null,
                    'currency' => $row->currency,
                    'received_on' => substr((string) $row->received_on, 0, 10),
                ],
                ['payment_id' => $paymentId, 'voided_at' => $now->toDateTimeString()],
                $reason
            );

            if ($setsDate) {
                self::setPaidUntil($tenantId, $paidUntil, $actedBy, "payment {$paymentId} voided");
            }
        });
    }

    /**
     * A community's payments, newest first: those recorded by hand and the
     * card payments Stripe reported. Every payment, whoever was paid: this is
     * the platform team's view.
     *
     * `source` is `card` for a payment Stripe reported and `manual` for one a
     * person recorded (whatever method they chose, a card taken by phone
     * included). `payee_tenant_id` / `payee_name` are null for a payment made
     * to the platform.
     *
     * @return list<array<string, mixed>>
     */
    public static function payments(int $tenantId, int $limit = 50): array
    {
        self::requireTenant($tenantId);

        return self::paymentList($tenantId, $limit, null, false);
    }

    /**
     * The payments a community made to one parent community, newest first:
     * what that parent's manager may see. A payment made to the platform, or
     * to another parent it had before, is not in the list.
     *
     * A recorder who is on the platform team is not named:
     * `recorded_by_platform_team` is true and the name is null.
     *
     * @return list<array<string, mixed>>
     */
    public static function paymentsPaidTo(int $tenantId, int $payeeTenantId, int $limit = 50): array
    {
        self::requireTenant($tenantId);

        return self::paymentList($tenantId, $limit, $payeeTenantId, true);
    }

    /**
     * @return list<array<string, mixed>>
     */
    private static function paymentList(int $tenantId, int $limit, ?int $onlyPaidTo, bool $forPayee): array
    {
        $limit = max(1, min(200, $limit));

        // The recorder is joined by id alone, not by tenant: a platform team
        // member belongs to another community than the one they record for.
        $query = DB::table('billing_payments as bp')
            ->leftJoin('users as u', 'u.id', '=', 'bp.recorded_by_user_id')
            ->leftJoin('users as v', 'v.id', '=', 'bp.voided_by_user_id')
            ->leftJoin('tenants as payee', 'payee.id', '=', 'bp.payee_tenant_id')
            ->where('bp.tenant_id', $tenantId);
        if ($onlyPaidTo !== null) {
            $query->where('bp.payee_tenant_id', $onlyPaidTo);
        }

        $rows = $query
            ->orderByDesc('bp.received_on')
            ->orderByDesc('bp.id')
            ->limit($limit)
            ->get([
                'bp.id', 'bp.received_on', 'bp.method', 'bp.reference', 'bp.amount', 'bp.currency',
                'bp.paid_until_before', 'bp.paid_until_after', 'bp.recorded_by_user_id', 'bp.created_at',
                'bp.stripe_invoice_id', 'bp.payee_tenant_id',
                'bp.voided_at', 'bp.void_reason',
                'bp.refunded_amount', 'bp.refunded_at', 'bp.dispute_status', 'bp.disputed_at',
                'payee.name as payee_name',
                'u.is_god as recorder_is_god', 'u.is_super_admin as recorder_is_super_admin',
                'v.is_god as voider_is_god', 'v.is_super_admin as voider_is_super_admin',
                DB::raw("COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.name) AS recorded_by_name"),
                DB::raw("COALESCE(NULLIF(TRIM(CONCAT_WS(' ', v.first_name, v.last_name)), ''), v.name) AS voided_by_name"),
            ]);

        $list = [];
        foreach ($rows as $row) {
            $byPlatformTeam = !empty($row->recorder_is_god) && !empty($row->recorder_is_super_admin);
            $hideRecorder = $forPayee && $byPlatformTeam;
            $voidedByPlatformTeam = !empty($row->voider_is_god) && !empty($row->voider_is_super_admin);
            $hideVoider = $forPayee && $voidedByPlatformTeam;

            $list[] = [
                'id' => (int) $row->id,
                'received_on' => substr((string) $row->received_on, 0, 10),
                'method' => (string) $row->method,
                'reference' => $row->reference !== null ? (string) $row->reference : null,
                'amount' => $row->amount !== null ? number_format((float) $row->amount, 2, '.', '') : null,
                'currency' => $row->currency !== null ? (string) $row->currency : null,
                'paid_until_before' => $row->paid_until_before !== null ? substr((string) $row->paid_until_before, 0, 10) : null,
                'paid_until_after' => substr((string) $row->paid_until_after, 0, 10),
                'recorded_by_user_id' => $row->recorded_by_user_id !== null && !$hideRecorder ? (int) $row->recorded_by_user_id : null,
                'recorded_by_name' => $row->recorded_by_name !== null && !$hideRecorder ? (string) $row->recorded_by_name : null,
                'created_at' => $row->created_at !== null ? (string) $row->created_at : null,
                'source' => $row->stripe_invoice_id !== null ? 'card' : 'manual',
                'payee_tenant_id' => $row->payee_tenant_id !== null ? (int) $row->payee_tenant_id : null,
                'payee_name' => $row->payee_tenant_id !== null && $row->payee_name !== null ? (string) $row->payee_name : null,
                'recorded_by_platform_team' => $byPlatformTeam,
                // A voided payment stays in the list, struck through.
                'voided_at' => $row->voided_at !== null ? (string) $row->voided_at : null,
                'voided_by_name' => $row->voided_at !== null && $row->voided_by_name !== null && !$hideVoider ? (string) $row->voided_by_name : null,
                'voided_by_platform_team' => $row->voided_at !== null && $voidedByPlatformTeam,
                'void_reason' => $row->voided_at !== null && $row->void_reason !== null ? (string) $row->void_reason : null,
                // What a person may do with it: a card payment is undone in
                // Stripe, and a payment is voided once.
                'can_void' => $row->stripe_invoice_id === null && $row->voided_at === null,
                // What Stripe has reported since about a card payment.
                'refunded_amount' => $row->refunded_amount !== null ? number_format((float) $row->refunded_amount, 2, '.', '') : null,
                'refunded_at' => $row->refunded_at !== null ? (string) $row->refunded_at : null,
                'dispute_state' => self::disputeState($row->dispute_status !== null ? (string) $row->dispute_status : null),
                'disputed_at' => $row->disputed_at !== null ? (string) $row->disputed_at : null,
            ];
        }

        return $list;
    }

    /**
     * Say who a community pays. Null = back to the default its place in the
     * tree gives it (defaultPayer()).
     *
     * Nothing is locked by who pays, so no lock cache is forgotten, and the
     * payment notices and pauses are left as they are; the member-limit
     * count starts again (new terms). It does decide who may record
     * the community's payments: a child set to pay the platform leaves its
     * parent's Branch payments page.
     */
    public static function setPayer(int $tenantId, ?string $payer, int $actedBy): void
    {
        $tenant = self::requireBillable($tenantId);

        if ($payer !== null && !in_array($payer, self::PAYERS, true)) {
            throw new \DomainException('payer_invalid');
        }

        // Paying a parent needs a parent that is not the platform itself:
        // the same rule defaultPayer() uses.
        if ($payer === 'parent' && !($tenant->parent_id !== null && (int) $tenant->parent_id > 1)) {
            throw new \DomainException('payer_needs_parent');
        }

        $row = self::row($tenantId);
        $current = isset($row->payer) ? (string) $row->payer : null;
        if ($current === $payer) {
            return;
        }

        self::write($tenantId, ['payer' => $payer]);
        // Who it pays has changed: the payment warnings start again, so a
        // stage reached under the old arrangement (or left over from when it
        // was not billed at all) never pauses it without a fresh warning.
        self::restartPaymentClock([$tenantId]);

        // Who it pays decides whose rule and member number it is held to
        // (its hub's or the platform's): new terms, a fresh count. The daily
        // check would see it from the terms key too; doing it here keeps the
        // lists right at once.
        self::restartLimitClock([$tenantId]);

        TenantBillingService::logAudit(
            $tenantId,
            $actedBy,
            'standing_payer_set',
            ['payer' => $current],
            ['payer' => $payer],
            null
        );
        JoiningGate::flush();
    }

    /**
     * A community's own rule for going over its member number, and the days
     * over before it acts. Null = follow the default (its hub's for its
     * children when it pays its hub, else the platform's). The action and the
     * days are separate: either may follow the default while the other is set.
     *
     * Who may call this is the caller's business (the platform team, or a hub
     * manager through BranchPayments). Refused whoever asks: tenant 1, an
     * unknown action or day count, and "move up" for a card payer
     * (OverLimitRule::refusalFor()).
     *
     * A change restarts the community's days-over count (DESIGN 6.4): the
     * next daily check sends a fresh notice under the new rule, and nothing
     * acts on it the next morning.
     */
    public static function setOverLimitRule(int $tenantId, ?string $action, ?int $graceDays, int $actedBy): void
    {
        self::requireBillable($tenantId);
        self::requireValidRule($action, $graceDays);

        $current = OverLimitRule::own($tenantId);

        // Only SETTING "move up" on a card payer is refused. A value already
        // stored (from before it paid by card) may be saved again, or its days
        // changed; it is still followed as warn only.
        if ($action !== $current['action'] && OverLimitRule::refusalFor($tenantId, $action) !== null) {
            throw new \DomainException('over_limit_rule_not_allowed');
        }
        $next = ['action' => $action, 'grace_days' => $graceDays];
        if ($current === $next) {
            return;
        }

        DB::transaction(static function () use ($tenantId, $current, $next, $actedBy): void {
            self::write($tenantId, ['over_limit_action' => $next['action'], 'over_limit_grace_days' => $next['grace_days']]);
            self::restartLimitClock([$tenantId]);

            TenantBillingService::logAudit($tenantId, $actedBy, 'standing_over_limit_rule_set', $current, $next, null);
        });
        JoiningGate::flush();
    }

    /**
     * The default a hub sets for the communities that pay it. Null = they
     * follow the platform's. May be "move up": for a child that pays by card
     * it resolves to warn only.
     *
     * Clears no count here: the daily check sees from each child's terms key
     * (OverLimitRule::termsKey()) whether this changed the terms it is held
     * to, and restarts exactly those children with a fresh notice.
     */
    public static function setChildrenOverLimitRule(int $hubTenantId, ?string $action, ?int $graceDays, int $actedBy): void
    {
        self::requireBillable($hubTenantId);
        self::requireValidRule($action, $graceDays);

        $current = OverLimitRule::childrenDefault($hubTenantId);
        $next = ['action' => $action, 'grace_days' => $graceDays];
        if ($current === $next) {
            return;
        }

        DB::transaction(static function () use ($hubTenantId, $current, $next, $actedBy): void {
            self::write($hubTenantId, [
                'children_over_limit_action' => $next['action'],
                'children_over_limit_grace_days' => $next['grace_days'],
            ]);

            TenantBillingService::logAudit($hubTenantId, $actedBy, 'standing_children_over_limit_rule_set', $current, $next, null);
        });
        JoiningGate::flush();
    }

    /**
     * Record that the community's one-off setup fee was taken by card, once:
     * a later call leaves the first date alone.
     */
    public static function recordSetupFeePaid(int $tenantId): void
    {
        $row = self::row($tenantId);
        if ($row !== null && ($row->setup_fee_paid_at ?? null) !== null) {
            return;
        }

        self::write($tenantId, ['setup_fee_paid_at' => now()]);
    }

    /**
     * A community has been moved under another parent.
     *
     * The move had no billing code at all. Two things follow from it:
     *
     *  - A stored "pays its parent" on a community now directly under the
     *    platform names a payee it no longer has: notices went to tenant 1's
     *    managers as if they were its hub. The stored payer is cleared, so it
     *    pays the platform by default.
     *  - Whoever it pays, and the plans that apply to it, may have changed.
     *    Its payment warnings and its member-limit count start again, so
     *    nothing reached under the old arrangement pauses it under the new.
     *
     * The paid-until date is left alone: it is a date a person recorded, and
     * only a person knows whether it still stands with the new payee.
     */
    public static function communityMoved(int $tenantId, int $newParentId): void
    {
        if ($tenantId <= 1) {
            return;
        }

        $row = self::row($tenantId);
        if ($row !== null && ($row->payer ?? null) === 'parent' && $newParentId <= 1) {
            self::write($tenantId, ['payer' => null]);
            TenantBillingService::logAudit(
                $tenantId,
                null,
                'standing_payer_set',
                ['payer' => 'parent'],
                ['payer' => null],
                'Moved directly under the platform: it has no parent community to pay'
            );
        }

        self::restartPaymentClock([$tenantId]);
        self::restartLimitClock([$tenantId]);
        \App\Support\Billing\PlanTerms::flush();
        BillingLock::flush();
        JoiningGate::flush();
    }

    /**
     * Start the payment warnings again for these communities: the recorded
     * stage and its date are cleared, so the next run begins with "now due"
     * and a pause comes only after a final warning has stood its time.
     *
     * A community that is paused keeps its record (it is closed already, and
     * a restore handles its own restart). The member-limit count has had
     * this protection since it was built; the payment warnings did not, so a
     * community that reached "final warning", was then exempted or set to
     * "not billed" (or the checks were switched off) for months, was paused
     * on that old warning the first morning it applied again.
     *
     * @param list<int>|null $tenantIds null = every community
     */
    public static function restartPaymentClock(?array $tenantIds): void
    {
        if ($tenantIds === []) {
            return;
        }

        $query = DB::table('tenant_billing_standing')
            ->whereNull('suspended_at')
            ->where(static function ($q): void {
                $q->whereNotNull('last_notice_stage')->orWhereNotNull('last_notice_at');
            });
        if ($tenantIds !== null) {
            $query->whereIn('tenant_id', $tenantIds);
        }

        $query->update(['last_notice_stage' => null, 'last_notice_at' => null, 'updated_at' => now()]);
    }

    /**
     * Every community's member-limit count starts again, as
     * restartLimitClock() does for a few. Only the member-limit clock's
     * memory is cleared (with every `joining_closed_notice_key`, task 7A);
     * the payment clock is not touched.
     */
    public static function restartAllLimitClocks(): void
    {
        // Every community's member-limit count starts again, except one
        // paused for being over: it stays paused until a lift condition
        // holds, as with a terms change. Called when the automatic checks are
        // switched on, so the first run warns before it pauses anybody: the
        // screens said nothing would happen while the checks were off.
        DB::table('tenant_billing_standing')
            ->where(static function ($q): void {
                $q->whereNull('suspended_at')
                    ->orWhereNull('suspension_reason')
                    ->orWhere('suspension_reason', '<>', 'over_limit');
            })
            ->where(static function ($q): void {
                $q->whereNotNull('over_limit_since')
                    ->orWhereNotNull('limit_notice_stage')
                    ->orWhereNotNull('limit_notice_at');
            })
            ->update([
                'over_limit_since' => null,
                'limit_notice_stage' => null,
                'limit_notice_at' => null,
                'updated_at' => now(),
            ]);

        // Nobody is told any more that a community above closed their door
        // (task 7A): the community above is warned afresh on the first run,
        // under terms that may read the same, and a notice from before the
        // checks were off must not shut a door. No email: nothing acted while
        // they were off. The first run tells each community below again
        // before its door shuts.
        DB::table('tenant_billing_standing')
            ->whereNotNull('joining_closed_notice_key')
            ->update([
                'joining_closed_notice_key' => null,
                'updated_at' => now(),
            ]);
    }

    /**
     * The days-over count starts again for these communities, and the next
     * daily check re-sends the notice for the stage each is at: it finds the
     * community over, records that day as the first day over, and names a
     * pause (or a move) the full number of days from then.
     *
     * Only the member-limit clock's memory is cleared. A pause is neither
     * lifted nor made here, and the payment clock is not touched. A community
     * with no standing row has nothing to restart, and none is made.
     *
     * @param list<int> $tenantIds
     */
    public static function restartLimitClock(array $tenantIds): void
    {
        $ids = array_values(array_unique(array_map('intval', $tenantIds)));
        if ($ids === []) {
            return;
        }

        foreach (array_chunk($ids, 500) as $chunk) {
            DB::table('tenant_billing_standing')
                ->whereIn('tenant_id', $chunk)
                ->update([
                    'over_limit_since' => null,
                    'limit_notice_stage' => null,
                    'limit_notice_at' => null,
                    'updated_at' => now(),
                ]);
        }
    }

    private static function requireValidRule(mixed $action, mixed $graceDays): void
    {
        if (!OverLimitRule::isValidAction($action)) {
            throw new \DomainException('over_limit_action_invalid');
        }
        if (!OverLimitRule::isValidDays($graceDays)) {
            throw new \DomainException('over_limit_days_invalid');
        }
    }

    /**
     * The daily check's own memory for a community: which notice it sent last
     * and since when it has been over its member limit, and whether it has
     * been told that a community above it closed its door
     * (`joining_closed_notice_key`, task 7A). Not a change in standing, so
     * not audited (the notices themselves are in the mail log).
     *
     * @param array<string, mixed> $values
     */
    public static function recordCheckState(int $tenantId, array $values): void
    {
        $allowed = ['last_notice_stage', 'last_notice_at', 'over_limit_since', 'limit_notice_stage', 'limit_notice_at', 'limit_terms_key', 'joining_closed_notice_key'];
        $unknown = array_diff(array_keys($values), $allowed);
        if ($unknown !== []) {
            throw new \InvalidArgumentException('Not check state: ' . implode(', ', $unknown));
        }
        if ($values === []) {
            return;
        }

        self::requireTenant($tenantId);
        self::write($tenantId, $values);
    }

    private static function row(int $tenantId): ?object
    {
        return DB::table('tenant_billing_standing')->where('tenant_id', $tenantId)->first();
    }

    /**
     * @param array<string, mixed> $values
     */
    private static function write(int $tenantId, array $values): void
    {
        $now = now();
        $exists = DB::table('tenant_billing_standing')->where('tenant_id', $tenantId)->exists();

        if ($exists) {
            DB::table('tenant_billing_standing')
                ->where('tenant_id', $tenantId)
                ->update($values + ['updated_at' => $now]);

            return;
        }

        DB::table('tenant_billing_standing')->insert(
            $values + ['tenant_id' => $tenantId, 'created_at' => $now, 'updated_at' => $now]
        );
    }

    private static function requireTenant(int $tenantId): object
    {
        $tenant = $tenantId > 0
            ? DB::table('tenants')->where('id', $tenantId)->first(['id', 'parent_id'])
            : null;

        if (!$tenant) {
            throw new \DomainException('tenant_not_found');
        }

        return $tenant;
    }

    private static function requireBillable(int $tenantId): object
    {
        if ($tenantId === 1) {
            throw new \DomainException('platform_tenant_not_billable');
        }

        return self::requireTenant($tenantId);
    }

    /** A real calendar date written exactly as Y-m-d. */
    private static function isDate(string $value): bool
    {
        $parsed = \DateTimeImmutable::createFromFormat('!Y-m-d', $value);

        return $parsed !== false && $parsed->format('Y-m-d') === $value;
    }

    /** The value when it is a real Y-m-d date, else null. */
    private static function dateOrNull(mixed $value): ?string
    {
        return is_string($value) && self::isDate($value) ? $value : null;
    }

    /** A Stripe object id as stored (at most 190 characters), or null. */
    private static function cleanStripeId(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $value = trim($value);

        return $value === '' || mb_strlen($value) > 190 ? null : $value;
    }

    /**
     * An amount as the decimal string the column stores ("120.00"), or null
     * for none. Refused: negative, more than two decimals, more than the
     * column holds (9999999999.99), or anything that is not a number.
     */
    private static function cleanAmount(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (is_int($value)) {
            $text = (string) $value;
        } elseif (is_float($value) && is_finite($value)) {
            // PHP writes a float as the shortest text that reads back the
            // same, so 240.5 is "240.5" and 1.0E+20 fails the pattern below.
            $text = (string) $value;
        } elseif (is_string($value)) {
            $text = trim($value);
        } else {
            throw new \DomainException('payment_amount_invalid');
        }

        if (preg_match('/^(\d{1,10})(?:\.(\d{1,2}))?$/', $text, $m) !== 1) {
            throw new \DomainException('payment_amount_invalid');
        }

        return $m[1] . '.' . str_pad($m[2] ?? '', 2, '0');
    }

    private static function cleanNote(?string $note): ?string
    {
        $note = trim((string) $note);

        return $note === '' ? null : mb_substr($note, 0, self::NOTE_MAX);
    }
}
