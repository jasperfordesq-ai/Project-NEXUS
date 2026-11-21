<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Billing;

use Illuminate\Support\Facades\DB;

/**
 * The terms a plan applies on, worked out from `pay_plans` as the platform
 * team has edited it.
 *
 * StandardPlans::TIERS only seeds a fresh database. Everything that shows or
 * acts on a plan reads it from here, so an edited member number or price is
 * the one used everywhere at once.
 *
 * This first part holds the default terms only (no community, so both
 * currencies are given). Hub terms are added on top later.
 *
 * @phpstan-type DefaultTerms array{
 *     plan_id: int, slug: string, name: string, description: ?string,
 *     max_users: ?int,
 *     price_monthly: ?float, price_yearly: ?float, setup_fee: ?float,
 *     price_monthly_gbp: ?float, price_yearly_gbp: ?float, setup_fee_gbp: ?float,
 *     terms: 'default', hub_tenant_id: null, is_standard: bool
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

    /** @var list<DefaultTerms>|null */
    private static ?array $defaults = null;

    private static int $readAt = 0;

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

    /** Forget what this process read. Call after every change to a plan. */
    public static function flush(): void
    {
        self::$defaults = null;
        self::$readAt = 0;
    }

    private static function money(mixed $value): ?float
    {
        return $value !== null ? (float) $value : null;
    }
}
