<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Support\Billing\BillingLock;
use App\Support\Billing\BillingSettings;
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
 * `exempt_reason_required`, `paid_until_invalid`.
 */
final class BillingStandingService
{
    public const PAYERS = ['platform_card', 'platform_invoice', 'parent', 'not_billed'];

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
     * it pays the platform — by card when it has a live Stripe subscription,
     * by invoice otherwise. Anything deeper pays its direct parent.
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

        $hasCard = DB::table('tenant_plan_assignments')
            ->where('tenant_id', $tenantId)
            ->whereNotNull('stripe_subscription_id')
            ->whereIn('status', ['active', 'trial'])
            ->exists();

        return $hasCard ? 'platform_card' : 'platform_invoice';
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
     * A PERSON lifting a pause for being over the member limit restarts that
     * limit's grace period from today: otherwise the daily check, still
     * counting from the first day over, would pause it again next morning.
     * The check lifting its own pause (back under the limit) clears the days
     * over itself, so it is not affected.
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
            $values['over_limit_since'] = now()->toDateString();
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

        self::write($tenantId, ['paid_until' => $date, 'last_notice_stage' => null, 'last_notice_at' => null]);

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
    }

    /**
     * The daily check's own memory for a community: which notice it sent last
     * and since when it has been over its member limit. Not a change in
     * standing, so not audited (the notices themselves are in the mail log).
     *
     * @param array<string, mixed> $values
     */
    public static function recordCheckState(int $tenantId, array $values): void
    {
        $allowed = ['last_notice_stage', 'last_notice_at', 'over_limit_since', 'limit_notice_stage', 'limit_notice_at'];
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

    private static function requireBillable(int $tenantId): void
    {
        if ($tenantId === 1) {
            throw new \DomainException('platform_tenant_not_billable');
        }

        self::requireTenant($tenantId);
    }

    private static function cleanNote(?string $note): ?string
    {
        $note = trim((string) $note);

        return $note === '' ? null : mb_substr($note, 0, self::NOTE_MAX);
    }
}
