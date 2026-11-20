<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Support\Billing\BillingLock;
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
 * `exempt_reason_required`.
 */
final class BillingStandingService
{
    public const PAYERS = ['platform_card', 'platform_invoice', 'parent', 'not_billed'];

    private const NOTE_MAX = 500;

    /**
     * @return array{
     *   tenant_id:int, payer:string, payer_is_default:bool, paid_until:?string,
     *   suspended_at:?string, suspension_source:?string, suspension_note:?string,
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
     * Suspend a community for non-payment. `$actedBy` null = the system.
     */
    public static function suspend(int $tenantId, ?int $actedBy, string $source, ?string $note = null): void
    {
        if (!in_array($source, ['auto', 'manual'], true)) {
            throw new \InvalidArgumentException("Unknown suspension source: {$source}");
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
        ]);

        TenantBillingService::logAudit(
            $tenantId,
            $actedBy,
            'standing_suspended',
            ['suspended_at' => null],
            ['suspended_at' => $now->toDateTimeString(), 'source' => $source],
            $note
        );

        BillingLock::flush();
    }

    /**
     * Lift a suspension. `$actedBy` null = the system.
     */
    public static function restore(int $tenantId, ?int $actedBy, ?string $note = null): void
    {
        self::requireTenant($tenantId);
        $row = self::row($tenantId);

        if (!isset($row->suspended_at)) {
            return;
        }

        $note = self::cleanNote($note);

        self::write($tenantId, [
            'suspended_at' => null,
            'suspended_by_user_id' => null,
            'suspension_source' => null,
            'suspension_note' => null,
        ]);

        TenantBillingService::logAudit(
            $tenantId,
            $actedBy,
            'standing_restored',
            ['suspended_at' => (string) $row->suspended_at, 'source' => $row->suspension_source ?? null],
            ['suspended_at' => null],
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
