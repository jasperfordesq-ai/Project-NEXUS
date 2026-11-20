<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Billing;

/**
 * The seven standard hosting packages, sized by active members.
 *
 * Copied from the public pricing page (project-nexus.net/hosting) on
 * 20 November 2026, at the owner's instruction. This constant is the single
 * source: the migration that writes the `pay_plans` rows and the tests that
 * check them both read it, so a price can never be right in one and wrong in
 * the other.
 *
 * Euro prices go in the existing `price_monthly` / `price_yearly` columns; the
 * pound prices sit beside them. Annual is ten months' price. Communities,
 * storage and emails are recorded and shown, never enforced: only the member
 * number is acted on.
 *
 * Each `description` is the pricing page's own "Best for" line.
 *
 * "An active member is someone who signs in at least once in a typical
 * 90 days" (the pricing page's own definition), hence ACTIVE_WINDOW_DAYS.
 */
final class StandardPlans
{
    public const ACTIVE_WINDOW_DAYS = 90;

    /**
     * Keyed by slug, smallest first. `max_users` is the active-member limit.
     *
     * @var array<string, array{
     *     name: string, tier_level: int, max_users: int,
     *     price_monthly_gbp: int, setup_fee_gbp: int, price_yearly_gbp: int,
     *     price_monthly: int, setup_fee: int, price_yearly: int,
     *     max_communities: int, storage_gb: int, emails_per_month: int,
     *     description: string
     * }>
     */
    public const TIERS = [
        'spark' => [
            'name' => 'Spark', 'tier_level' => 1, 'max_users' => 100,
            'price_monthly_gbp' => 150, 'setup_fee_gbp' => 0, 'price_yearly_gbp' => 1500,
            'price_monthly' => 175, 'setup_fee' => 0, 'price_yearly' => 1750,
            'max_communities' => 1, 'storage_gb' => 5, 'emails_per_month' => 5000,
            'description' => 'Small full-platform pilots that need the whole NEXUS module set.',
        ],
        'local' => [
            'name' => 'Local', 'tier_level' => 2, 'max_users' => 300,
            'price_monthly_gbp' => 199, 'setup_fee_gbp' => 645, 'price_yearly_gbp' => 1990,
            'price_monthly' => 229, 'setup_fee' => 750, 'price_yearly' => 2290,
            'max_communities' => 1, 'storage_gb' => 10, 'emails_per_month' => 20000,
            'description' => 'Established local timebanks that have outgrown a pilot.',
        ],
        'community' => [
            'name' => 'Community', 'tier_level' => 3, 'max_users' => 1000,
            'price_monthly_gbp' => 349, 'setup_fee_gbp' => 2150, 'price_yearly_gbp' => 3490,
            'price_monthly' => 399, 'setup_fee' => 2500, 'price_yearly' => 3990,
            'max_communities' => 3, 'storage_gb' => 25, 'emails_per_month' => 50000,
            'description' => 'Funded local communities and established nonprofit networks.',
        ],
        'growth' => [
            'name' => 'Growth', 'tier_level' => 4, 'max_users' => 10000,
            'price_monthly_gbp' => 799, 'setup_fee_gbp' => 3850, 'price_yearly_gbp' => 7990,
            'price_monthly' => 929, 'setup_fee' => 4500, 'price_yearly' => 9290,
            'max_communities' => 10, 'storage_gb' => 100, 'emails_per_month' => 250000,
            'description' => 'Regional and multi-programme deployments.',
        ],
        'expansion' => [
            'name' => 'Expansion', 'tier_level' => 5, 'max_users' => 20000,
            'price_monthly_gbp' => 1399, 'setup_fee_gbp' => 5150, 'price_yearly_gbp' => 13990,
            'price_monthly' => 1649, 'setup_fee' => 6000, 'price_yearly' => 16490,
            'max_communities' => 15, 'storage_gb' => 250, 'emails_per_month' => 500000,
            'description' => 'Growing networks that have just crossed 10,000 active members and need room before full Scale.',
        ],
        'scale' => [
            'name' => 'Scale', 'tier_level' => 6, 'max_users' => 30000,
            'price_monthly_gbp' => 1999, 'setup_fee_gbp' => 6900, 'price_yearly_gbp' => 19990,
            'price_monthly' => 2299, 'setup_fee' => 8000, 'price_yearly' => 22990,
            'max_communities' => 25, 'storage_gb' => 500, 'emails_per_month' => 1000000,
            'description' => 'Larger multi-community programmes.',
        ],
        'network' => [
            'name' => 'Network', 'tier_level' => 7, 'max_users' => 100000,
            'price_monthly_gbp' => 2999, 'setup_fee_gbp' => 8600, 'price_yearly_gbp' => 29990,
            'price_monthly' => 3499, 'setup_fee' => 10000, 'price_yearly' => 34990,
            'max_communities' => 100, 'storage_gb' => 2000, 'emails_per_month' => 5000000,
            'description' => 'National networks and consortia.',
        ],
    ];

    /**
     * The smallest standard package whose member limit fits, or null above the
     * largest (that is an Enterprise Custom quote, which has no package).
     */
    public static function slugForMemberCount(int $activeMembers): ?string
    {
        foreach (self::TIERS as $slug => $tier) {
            if ($activeMembers <= $tier['max_users']) {
                return $slug;
            }
        }

        return null;
    }

    /** @return list<string> */
    public static function slugs(): array
    {
        return array_keys(self::TIERS);
    }
}
