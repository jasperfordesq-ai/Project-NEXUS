<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Billing;

use App\Core\SuperPanelAccess;
use App\Services\BillingStandingService;
use App\Services\TenantBillingService;
use Illuminate\Support\Facades\DB;

/**
 * Who may change a hub's own version of the plans (Branch plans), and the
 * writes that change it.
 *
 * One rule, used by the list and by every write, so the screen can never
 * offer a hub the server then refuses.
 *
 * Reach is the owner's rule (below, never above, never beside;
 * `canManageTenant()`), with one addition that applies to these hub-level
 * settings only: a manager may edit its OWN community's version. Those terms
 * are about the communities below it and change nothing about the hub's own
 * plan, limit or standing. The platform's own community (tenant 1) has no
 * version, for anyone: its children pay the platform on the default terms.
 */
final class BranchPlans
{
    public const NOT_IN_REACH = 'not_in_reach';
    public const PLAN_IN_USE = 'plan_in_use';

    /**
     * Null when the caller may change $hubTenantId's plan terms and its
     * children's default, else why not. A community that does not exist is
     * answered exactly like one out of reach.
     */
    public static function refusalForHub(int $hubTenantId): ?string
    {
        if ($hubTenantId <= 1) {
            return self::NOT_IN_REACH;
        }

        $access = SuperPanelAccess::getAccess();
        if (empty($access['granted'])) {
            return self::NOT_IN_REACH;
        }

        $isOwn = (int) ($access['tenant_id'] ?? 0) === $hubTenantId;
        if (!$isOwn && !SuperPanelAccess::canManageTenant($hubTenantId)) {
            return self::NOT_IN_REACH;
        }

        // A platform-wide super admin "can manage" any id, including one that
        // does not exist.
        if (!DB::table('tenants')->where('id', $hubTenantId)->exists()) {
            return self::NOT_IN_REACH;
        }

        return null;
    }

    /**
     * Hubs the caller may edit, in tree order: every community in reach
     * (its own included) that may have communities below it or has some.
     *
     * @return list<array{id: int, name: string, depth: int, children_paying: int}>
     */
    public static function hubs(): array
    {
        $scope = SuperPanelAccess::getScopeClause('t');

        // "Pays that hub": stored as paying its parent, or nothing stored and
        // no card (BillingStandingService::paysParentSql()).
        $rows = DB::select(
            "SELECT t.id, t.name, t.depth, t.allows_subtenants,
                    (SELECT COUNT(*)
                       FROM tenants c
                       LEFT JOIN tenant_billing_standing s ON s.tenant_id = c.id
                      WHERE c.parent_id = t.id AND " . BillingStandingService::paysParentSql('c.id', 's') . ") AS children_paying,
                    (SELECT COUNT(*) FROM tenants k WHERE k.parent_id = t.id) AS children
             FROM tenants t
             WHERE t.id > 1 AND {$scope['sql']}
             ORDER BY t.path ASC, t.name ASC",
            $scope['params']
        );

        $hubs = [];
        foreach ($rows as $row) {
            $id = (int) $row->id;
            if ((int) $row->children === 0 && (int) $row->allows_subtenants !== 1) {
                continue;
            }
            if (self::refusalForHub($id) !== null) {
                continue;
            }
            $hubs[] = [
                'id' => $id,
                'name' => (string) $row->name,
                'depth' => (int) $row->depth,
                'children_paying' => (int) $row->children_paying,
            ];
        }

        return $hubs;
    }

    /**
     * Store the hub's changes to one plan, merged over what it had. A row
     * left with nothing changed and the plan offered is deleted, not kept.
     * The caller has checked reach, the plan, and the values.
     *
     * Throws DomainException(PLAN_IN_USE) when the change would stop
     * offering a plan a community that pays this hub is on. That is decided
     * inside the write's transaction, with the row locked, so two requests
     * cannot both pass it. Only the step from offered to hidden is refused:
     * a plan already hidden that a child is on (the platform team can assign
     * anything) must still be editable.
     *
     * Two managers saving the same new row at once: the row is claimed with
     * an insert-or-nothing on the unique key, so neither sees a duplicate-key
     * error, and a deadlock between them is retried once.
     *
     * @param array<string, mixed> $values VALUE_FIELDS present in the request (null = follow the default)
     */
    public static function saveTerms(int $hubTenantId, int $planId, array $values, ?bool $isOffered, int $actedBy): void
    {
        DB::transaction(function () use ($hubTenantId, $planId, $values, $isOffered, $actedBy): void {
            $claimed = DB::affectingStatement(
                'INSERT INTO hub_plan_terms (hub_tenant_id, pay_plan_id, is_offered, updated_by_user_id, created_at, updated_at)
                 VALUES (?, ?, 1, ?, NOW(), NOW())
                 ON DUPLICATE KEY UPDATE id = id',
                [$hubTenantId, $planId, $actedBy]
            ) === 1;

            $locked = DB::table('hub_plan_terms')
                ->where('hub_tenant_id', $hubTenantId)
                ->where('pay_plan_id', $planId)
                ->lockForUpdate()
                ->first();
            // A row this call just claimed is empty: there was nothing before.
            $current = $claimed ? null : $locked;
            $old = $current !== null ? self::auditValues($current) : null;

            $next = [];
            foreach (PlanTerms::VALUE_FIELDS as $field) {
                $next[$field] = array_key_exists($field, $values) ? $values[$field] : ($current->{$field} ?? null);
            }
            $wasOffered = $current === null || (int) $current->is_offered === 1;
            $next['is_offered'] = $isOffered ?? $wasOffered;

            if ($wasOffered && !$next['is_offered'] && self::communitiesOnPlan($hubTenantId, $planId) > 0) {
                throw new \DomainException(self::PLAN_IN_USE);
            }

            $isEmpty = $next['is_offered'] && array_filter(
                array_intersect_key($next, array_flip(PlanTerms::VALUE_FIELDS)),
                static fn ($v): bool => $v !== null
            ) === [];

            if ($isEmpty) {
                DB::table('hub_plan_terms')->where('id', $locked->id)->delete();
                $new = null;
            } else {
                $write = $next;
                $write['is_offered'] = $next['is_offered'] ? 1 : 0;
                $write['updated_by_user_id'] = $actedBy;
                $write['updated_at'] = now();
                DB::table('hub_plan_terms')->where('id', $locked->id)->update($write);
                $new = self::auditValues(DB::table('hub_plan_terms')->where('id', $locked->id)->first());
            }

            if ($old !== $new) {
                TenantBillingService::logAudit($hubTenantId, $actedBy, 'hub_plan_terms_changed', $old, $new, null);
            }
        }, 2);

        PlanTerms::flush();
    }

    /** Put one plan back to the defaults. Audited only when there was something to remove. */
    public static function resetTerms(int $hubTenantId, int $planId, int $actedBy): void
    {
        DB::transaction(function () use ($hubTenantId, $planId, $actedBy): void {
            $current = DB::table('hub_plan_terms')
                ->where('hub_tenant_id', $hubTenantId)
                ->where('pay_plan_id', $planId)
                ->lockForUpdate()
                ->first();
            if ($current === null) {
                return;
            }

            DB::table('hub_plan_terms')->where('id', $current->id)->delete();
            TenantBillingService::logAudit($hubTenantId, $actedBy, 'hub_plan_terms_changed', self::auditValues($current), null, null);
        });

        PlanTerms::flush();
    }

    /**
     * Communities that pay this hub and are on $planId now. A plan with any
     * cannot stop being offered.
     */
    public static function communitiesOnPlan(int $hubTenantId, int $planId): int
    {
        foreach (PlanTerms::offeredBy($hubTenantId) as $plan) {
            if ($plan['plan_id'] === $planId) {
                return $plan['communities_on_plan'];
            }
        }

        return 0;
    }

    /** @return array<string, mixed> */
    private static function auditValues(object $row): array
    {
        $values = ['plan_id' => (int) $row->pay_plan_id];
        foreach (PlanTerms::VALUE_FIELDS as $field) {
            $value = $row->{$field};
            $values[$field] = match (true) {
                $value === null => null,
                $field === 'max_users' => (int) $value,
                in_array($field, ['name', 'description'], true) => (string) $value,
                default => (float) $value,
            };
        }
        $values['is_offered'] = (int) $row->is_offered === 1;

        return $values;
    }
}
