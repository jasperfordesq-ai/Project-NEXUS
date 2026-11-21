<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Billing;

use App\Services\BillingStandingService;
use App\Services\StripeSubscriptionService;
use Illuminate\Support\Facades\DB;

/**
 * The terms a plan applies on, worked out from `pay_plans` as the platform
 * team has edited it and, for a community that pays its parent, from that
 * parent's own version of the plan (`hub_plan_terms`).
 *
 * StandardPlans::TIERS only seeds a fresh database. Everything that shows or
 * acts on a plan reads it from here, so an edited member number or price is
 * the one used everywhere at once.
 *
 * The rule: the plan that applies to a community is the plan it is assigned
 * to and, when it pays its direct parent (and that parent is not the
 * platform's own community), the parent's changes on top, field by field.
 * Only the direct parent's; every hub starts from the platform's defaults.
 * A community that pays the platform is always on the default terms.
 *
 * @phpstan-type DefaultTerms array{
 *     plan_id: int, slug: string, name: string, description: ?string,
 *     max_users: ?int,
 *     price_monthly: ?float, price_yearly: ?float, setup_fee: ?float,
 *     price_monthly_gbp: ?float, price_yearly_gbp: ?float, setup_fee_gbp: ?float,
 *     terms: 'default', hub_tenant_id: null, is_standard: bool
 * }
 * @phpstan-type Terms array{
 *     plan_id: int, slug: string, name: string, description: ?string,
 *     max_users: ?int, currency: 'eur'|'gbp',
 *     price_monthly: ?float, price_yearly: ?float, setup_fee: ?float,
 *     terms: 'default'|'hub', hub_tenant_id: ?int, is_standard: bool
 * }
 * @phpstan-type HubPlan array{
 *     plan_id: int, slug: string, name: string, description: ?string,
 *     max_users: ?int,
 *     price_monthly: ?float, price_yearly: ?float, setup_fee: ?float,
 *     price_monthly_gbp: ?float, price_yearly_gbp: ?float, setup_fee_gbp: ?float,
 *     is_offered: bool, changed: bool, changed_fields: list<string>,
 *     default: array<string, mixed>, communities_on_plan: int
 * }
 */
final class PlanTerms
{
    /**
     * How long one process trusts what it read. A queue worker lives for
     * hours; this bounds how stale its view of an edited plan can be, and
     * flush() clears it at once in the process that made the edit.
     */
    private const MEMO_SECONDS = 60;

    /**
     * The largest member number and amount any plan (default or a hub's) may
     * hold: refused with a message beyond these, not left to fail in the
     * database. Money columns are DECIMAL(10,2).
     */
    public const MAX_MEMBER_NUMBER = 10000000;
    public const MAX_MONEY = 99999999.99;
    public const MAX_NAME_LENGTH = 100;
    public const MAX_DESCRIPTION_LENGTH = 5000;

    /** The values a hub can change; null in its row = follow the default. */
    public const VALUE_FIELDS = [
        'name', 'description', 'max_users',
        'price_monthly', 'price_yearly', 'setup_fee',
        'price_monthly_gbp', 'price_yearly_gbp', 'setup_fee_gbp',
    ];

    /** The money fields, as [euro column => pound column]. */
    private const MONEY = [
        'price_monthly' => 'price_monthly_gbp',
        'price_yearly'  => 'price_yearly_gbp',
        'setup_fee'     => 'setup_fee_gbp',
    ];

    /** An assignment in one of these is the plan a community is on. */
    private const CURRENT_STATUSES = ['active', 'trial', 'trialing'];

    /** @var list<DefaultTerms>|null */
    private static ?array $defaults = null;

    private static int $readAt = 0;

    /** @var array<int, array{at: int, rows: array<int, object>}> hub id => its rows by plan id */
    private static array $hubRows = [];

    /**
     * Every active standard plan on default terms, smallest member number
     * first. A plan with no member number has no limit, so it sorts last.
     *
     * @return list<DefaultTerms>
     */
    public static function defaults(): array
    {
        if (self::$defaults !== null && (time() - self::$readAt) < self::MEMO_SECONDS) {
            return self::$defaults;
        }

        $rows = DB::select(
            "SELECT id, slug, name, description, max_users,
                    price_monthly, price_yearly, setup_fee,
                    price_monthly_gbp, price_yearly_gbp, setup_fee_gbp, is_standard
             FROM pay_plans
             WHERE is_standard = 1 AND is_active = 1
             ORDER BY (max_users IS NULL) ASC, max_users ASC, tier_level ASC, id ASC"
        );

        self::$defaults = array_map(static fn (object $row): array => [
            'plan_id'           => (int) $row->id,
            'slug'              => (string) $row->slug,
            'name'              => (string) $row->name,
            'description'       => $row->description !== null ? (string) $row->description : null,
            'max_users'         => $row->max_users !== null ? (int) $row->max_users : null,
            'price_monthly'     => self::money($row->price_monthly),
            'price_yearly'      => self::money($row->price_yearly),
            'setup_fee'         => self::money($row->setup_fee),
            'price_monthly_gbp' => self::money($row->price_monthly_gbp),
            'price_yearly_gbp'  => self::money($row->price_yearly_gbp),
            'setup_fee_gbp'     => self::money($row->setup_fee_gbp),
            'terms'             => 'default',
            'hub_tenant_id'     => null,
            'is_standard'       => (bool) $row->is_standard,
        ], $rows);
        self::$readAt = time();

        return self::$defaults;
    }

    /**
     * The smallest default plan that fits $activeMembers (Billing control's
     * suggestion), or null above the largest: that is a bespoke quote, not a
     * package. A plan with no member number fits anyone.
     *
     * @return DefaultTerms|null
     */
    public static function smallestDefaultFitting(int $activeMembers): ?array
    {
        foreach (self::defaults() as $plan) {
            if ($plan['max_users'] === null || $activeMembers <= $plan['max_users']) {
                return $plan;
            }
        }

        return null;
    }

    /**
     * The plan a community is on, as it applies to it, in its own billing
     * currency. Null with no current assignment.
     *
     * A community on a plan that is not an active standard plan (a custom or
     * retired one) is on that plan's own terms: hubs change only the
     * standard plans.
     *
     * @return Terms|null
     */
    public static function forCommunity(int $tenantId): ?array
    {
        $plan = DB::selectOne(
            "SELECT pp.id, pp.slug, pp.name, pp.description, pp.max_users,
                    pp.price_monthly, pp.price_yearly, pp.setup_fee,
                    pp.price_monthly_gbp, pp.price_yearly_gbp, pp.setup_fee_gbp, pp.is_standard
             FROM tenant_plan_assignments tpa
             INNER JOIN pay_plans pp ON pp.id = tpa.pay_plan_id
             WHERE tpa.tenant_id = ? AND tpa.status IN ('active', 'trial', 'trialing')
             ORDER BY (tpa.status = 'active') DESC, tpa.id DESC
             LIMIT 1",
            [$tenantId]
        );
        if ($plan === null) {
            return null;
        }

        $values = [
            'name'              => (string) $plan->name,
            'description'       => $plan->description !== null ? (string) $plan->description : null,
            'max_users'         => $plan->max_users !== null ? (int) $plan->max_users : null,
            'price_monthly'     => self::money($plan->price_monthly),
            'price_yearly'      => self::money($plan->price_yearly),
            'setup_fee'         => self::money($plan->setup_fee),
            'price_monthly_gbp' => self::money($plan->price_monthly_gbp),
            'price_yearly_gbp'  => self::money($plan->price_yearly_gbp),
            'setup_fee_gbp'     => self::money($plan->setup_fee_gbp),
        ];

        $applied = self::applyHubChanges($tenantId, (int) $plan->id, $values);

        return self::inCurrency(
            (int) $plan->id,
            (string) $plan->slug,
            (bool) $plan->is_standard,
            $applied['values'],
            $applied['hub_tenant_id'],
            StripeSubscriptionService::billingCurrencyFor($tenantId)
        );
    }

    /**
     * Every active standard plan as $hubTenantId offers it to the
     * communities that pay it, in the defaults' order (so a row does not jump
     * about on the hub's page as its member number is edited). Tenant 1 has
     * no version of its own: its plans are the defaults.
     *
     * @return list<HubPlan>
     */
    public static function offeredBy(int $hubTenantId): array
    {
        $rows = $hubTenantId > 1 ? self::hubRows($hubTenantId) : [];
        $onPlan = $hubTenantId > 1 ? self::communitiesOnPlans($hubTenantId) : [];

        $plans = [];
        foreach (self::defaults() as $default) {
            $planId = $default['plan_id'];
            $defaultValues = [];
            foreach (self::VALUE_FIELDS as $field) {
                $defaultValues[$field] = $default[$field];
            }

            $row = $rows[$planId] ?? null;
            $changes = $row !== null ? self::changesIn($row) : [];
            $isOffered = $row === null || (int) $row->is_offered === 1;

            $changedFields = array_keys($changes);
            if (!$isOffered) {
                $changedFields[] = 'is_offered';
            }

            $plans[] = array_merge(
                ['plan_id' => $planId, 'slug' => $default['slug']],
                array_merge($defaultValues, $changes),
                [
                    'is_offered'          => $isOffered,
                    'changed'             => $row !== null,
                    'changed_fields'      => $changedFields,
                    'default'             => $defaultValues,
                    'communities_on_plan' => $onPlan[$planId] ?? 0,
                ]
            );
        }

        return $plans;
    }

    /**
     * Plans $tenantId can be put on, in its own billing currency: its
     * parent's offered plans when it pays its parent, else the defaults.
     * Smallest effective member number first: a hub may have reordered them.
     *
     * @return list<Terms>
     */
    public static function availableTo(int $tenantId): array
    {
        $currency = StripeSubscriptionService::billingCurrencyFor($tenantId);
        $hubId = self::hubFor($tenantId);

        $out = [];
        if ($hubId === null) {
            foreach (self::defaults() as $plan) {
                $out[] = self::inCurrency($plan['plan_id'], $plan['slug'], $plan['is_standard'], $plan, null, $currency);
            }

            return $out;
        }

        foreach (self::offeredBy($hubId) as $plan) {
            if (!$plan['is_offered']) {
                continue;
            }
            // On the hub's terms when the hub changed a value, not merely
            // whether it offers the plan. Every plan offered is standard.
            $valuesChanged = array_diff($plan['changed_fields'], ['is_offered']) !== [];
            $out[] = self::inCurrency($plan['plan_id'], $plan['slug'], true, $plan, $valuesChanged ? $hubId : null, $currency);
        }

        return self::sortByMembers($out);
    }

    /**
     * The smallest plan in availableTo() whose member number fits
     * $activeMembers; null when none fits. A plan with no member number fits
     * anyone.
     *
     * @return Terms|null
     */
    public static function smallestFitting(int $tenantId, int $activeMembers): ?array
    {
        foreach (self::availableTo($tenantId) as $plan) {
            if ($plan['max_users'] === null || $activeMembers <= $plan['max_users']) {
                return $plan;
            }
        }

        return null;
    }

    /**
     * The community whose version of the plans applies to $tenantId, or null
     * when the defaults do: it must pay its parent, and that parent must not
     * be the platform's own community. Read fresh every time, so a change of
     * payer takes effect at once.
     *
     * Same answer as BillingStandingService::get()['payer'] === 'parent'
     * with the direct parent above tenant 1, without the lock lookup get()
     * also makes; defaultPayer() is still the one definition of an unset
     * payer.
     */
    public static function hubFor(int $tenantId): ?int
    {
        if ($tenantId <= 1) {
            return null;
        }

        $row = DB::selectOne(
            'SELECT t.parent_id, s.payer
             FROM tenants t
             LEFT JOIN tenant_billing_standing s ON s.tenant_id = t.id
             WHERE t.id = ?',
            [$tenantId]
        );
        if ($row === null || $row->parent_id === null || (int) $row->parent_id <= 1) {
            return null;
        }

        $payer = $row->payer ?? BillingStandingService::defaultPayer($tenantId);

        return $payer === 'parent' ? (int) $row->parent_id : null;
    }

    /**
     * $values (a plan's default values, both currencies) with the hub's
     * changes on top when hub terms apply to $tenantId for $planId. For the
     * callers that already hold the plan's row and must not look up a
     * currency per community (the daily check, Billing control).
     *
     * @param array<string, mixed> $values keyed by VALUE_FIELDS
     * @return array{values: array<string, mixed>, terms: 'default'|'hub', hub_tenant_id: ?int}
     */
    public static function applyHubChanges(int $tenantId, int $planId, array $values): array
    {
        $hubId = self::hubFor($tenantId);
        // Hubs change only the active standard plans.
        $isOfferable = in_array($planId, array_column(self::defaults(), 'plan_id'), true);
        $row = ($hubId !== null && $isOfferable) ? (self::hubRows($hubId)[$planId] ?? null) : null;
        $changes = $row !== null ? self::changesIn($row) : [];

        if ($changes === []) {
            return ['values' => $values, 'terms' => 'default', 'hub_tenant_id' => null];
        }

        return ['values' => array_merge($values, $changes), 'terms' => 'hub', 'hub_tenant_id' => $hubId];
    }

    /** Forget what this process read. Call after every change to a plan or to a hub's version of one. */
    public static function flush(): void
    {
        self::$defaults = null;
        self::$readAt = 0;
        self::$hubRows = [];
    }

    /** @return array<int, object> the hub's rows by plan id */
    private static function hubRows(int $hubTenantId): array
    {
        $memo = self::$hubRows[$hubTenantId] ?? null;
        if ($memo !== null && (time() - $memo['at']) < self::MEMO_SECONDS) {
            return $memo['rows'];
        }

        $rows = [];
        foreach (DB::select('SELECT * FROM hub_plan_terms WHERE hub_tenant_id = ?', [$hubTenantId]) as $row) {
            $rows[(int) $row->pay_plan_id] = $row;
        }
        self::$hubRows[$hubTenantId] = ['at' => time(), 'rows' => $rows];

        return $rows;
    }

    /**
     * The values a hub's row sets (non-null), typed.
     *
     * @return array<string, mixed>
     */
    private static function changesIn(object $row): array
    {
        $changes = [];
        foreach (self::VALUE_FIELDS as $field) {
            if ($row->{$field} === null) {
                continue;
            }
            $changes[$field] = match ($field) {
                'name', 'description' => (string) $row->{$field},
                'max_users' => (int) $row->{$field},
                default => (float) $row->{$field},
            };
        }

        return $changes;
    }

    /**
     * How many communities that pay this hub are on each plan now.
     *
     * The hub is above tenant 1, so a child with no stored payer pays it
     * (BillingStandingService::defaultPayer()).
     *
     * @return array<int, int> plan id => communities
     */
    private static function communitiesOnPlans(int $hubTenantId): array
    {
        $statuses = implode(',', array_fill(0, count(self::CURRENT_STATUSES), '?'));
        $rows = DB::select(
            "SELECT tpa.pay_plan_id, COUNT(DISTINCT c.id) AS n
             FROM tenants c
             LEFT JOIN tenant_billing_standing s ON s.tenant_id = c.id
             INNER JOIN tenant_plan_assignments tpa ON tpa.tenant_id = c.id AND tpa.status IN ({$statuses})
             WHERE c.parent_id = ? AND COALESCE(s.payer, 'parent') = 'parent'
             GROUP BY tpa.pay_plan_id",
            array_merge(self::CURRENT_STATUSES, [$hubTenantId])
        );

        $counts = [];
        foreach ($rows as $row) {
            $counts[(int) $row->pay_plan_id] = (int) $row->n;
        }

        return $counts;
    }

    /**
     * @param array<string, mixed> $values both-currency values
     * @return Terms
     */
    private static function inCurrency(int $planId, string $slug, bool $isStandard, array $values, ?int $hubTenantId, string $currency): array
    {
        $terms = [
            'plan_id'     => $planId,
            'slug'        => $slug,
            'name'        => (string) $values['name'],
            'description' => $values['description'],
            'max_users'   => $values['max_users'],
            'currency'    => $currency === 'gbp' ? 'gbp' : 'eur',
        ];
        foreach (self::MONEY as $euro => $pound) {
            $terms[$euro] = $currency === 'gbp' ? $values[$pound] : $values[$euro];
        }
        $terms['terms'] = $hubTenantId !== null ? 'hub' : 'default';
        $terms['hub_tenant_id'] = $hubTenantId;
        $terms['is_standard'] = $isStandard;

        return $terms;
    }

    /**
     * Smallest effective member number first, no number (no limit) last; a
     * tie keeps the defaults' order.
     *
     * @template T of array{max_users: ?int}
     * @param list<T> $plans
     * @return list<T>
     */
    private static function sortByMembers(array $plans): array
    {
        $order = array_keys($plans);
        usort($order, static function (int $a, int $b) use ($plans): int {
            $ma = $plans[$a]['max_users'];
            $mb = $plans[$b]['max_users'];
            if ($ma === null || $mb === null) {
                return [$ma === null, $a] <=> [$mb === null, $b];
            }

            return [$ma, $a] <=> [$mb, $b];
        });

        return array_map(static fn (int $i): array => $plans[$i], $order);
    }

    private static function money(mixed $value): ?float
    {
        return $value !== null ? (float) $value : null;
    }
}
