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
 * 20 November 2026, at the owner's instruction, and re-read against it on
 * 21 November 2026 (both currencies). This constant is the single source: the
 * migrations that write the `pay_plans` rows and the tests that check them all
 * read it, so a price can never be right in one and wrong in the other.
 *
 * Euro prices go in the existing `price_monthly` / `price_yearly` columns; the
 * pound prices sit beside them. Annual is ten months' price. Communities,
 * storage and emails are recorded and shown, never enforced: only the member
 * number is acted on.
 *
 * Each `description` opens with the pricing page's member band ("101 to 300
 * active members") and then its "Best for" line, so a plan says how many
 * members it allows wherever only its description is shown (owner, 21 Nov
 * 2026). `support` is the page's first-reply line for the tier. The setup fee
 * is NOT written into the description: it differs by currency and a hub can
 * change it, so every screen reads it from the `setup_fee` columns instead.
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
     *     description: string, support: string
     * }>
     */
    public const TIERS = [
        'spark' => [
            'name' => 'Spark', 'tier_level' => 1, 'max_users' => 100,
            'price_monthly_gbp' => 150, 'setup_fee_gbp' => 0, 'price_yearly_gbp' => 1500,
            'price_monthly' => 175, 'setup_fee' => 0, 'price_yearly' => 1750,
            'max_communities' => 1, 'storage_gb' => 5, 'emails_per_month' => 5000,
            'description' => 'Up to 100 active members. Best for small full-platform pilots that need the whole NEXUS module set.',
            'support' => 'Best-effort first reply by next business day',
        ],
        'local' => [
            'name' => 'Local', 'tier_level' => 2, 'max_users' => 300,
            'price_monthly_gbp' => 199, 'setup_fee_gbp' => 645, 'price_yearly_gbp' => 1990,
            'price_monthly' => 229, 'setup_fee' => 750, 'price_yearly' => 2290,
            'max_communities' => 1, 'storage_gb' => 10, 'emails_per_month' => 20000,
            'description' => '101 to 300 active members. Best for established local timebanks that have outgrown a pilot.',
            'support' => 'Best-effort first reply by next business day',
        ],
        'community' => [
            'name' => 'Community', 'tier_level' => 3, 'max_users' => 1000,
            'price_monthly_gbp' => 349, 'setup_fee_gbp' => 2150, 'price_yearly_gbp' => 3490,
            'price_monthly' => 399, 'setup_fee' => 2500, 'price_yearly' => 3990,
            'max_communities' => 3, 'storage_gb' => 25, 'emails_per_month' => 50000,
            'description' => '301 to 1,000 active members. Best for funded local communities and established nonprofit networks.',
            'support' => 'Target first reply within 1 business day',
        ],
        'growth' => [
            'name' => 'Growth', 'tier_level' => 4, 'max_users' => 10000,
            'price_monthly_gbp' => 799, 'setup_fee_gbp' => 3850, 'price_yearly_gbp' => 7990,
            'price_monthly' => 929, 'setup_fee' => 4500, 'price_yearly' => 9290,
            'max_communities' => 10, 'storage_gb' => 100, 'emails_per_month' => 250000,
            'description' => '1,001 to 10,000 active members. Best for regional and multi-programme deployments.',
            'support' => 'Target first reply within 1 business day during agreed business hours',
        ],
        'expansion' => [
            'name' => 'Expansion', 'tier_level' => 5, 'max_users' => 20000,
            'price_monthly_gbp' => 1399, 'setup_fee_gbp' => 5150, 'price_yearly_gbp' => 13990,
            'price_monthly' => 1649, 'setup_fee' => 6000, 'price_yearly' => 16490,
            'max_communities' => 15, 'storage_gb' => 250, 'emails_per_month' => 500000,
            'description' => '10,001 to 20,000 active members. Best for growing networks that have just crossed 10,000 active members and need room before full Scale.',
            'support' => 'Target first reply within 1 business day during agreed business hours',
        ],
        'scale' => [
            'name' => 'Scale', 'tier_level' => 6, 'max_users' => 30000,
            'price_monthly_gbp' => 1999, 'setup_fee_gbp' => 6900, 'price_yearly_gbp' => 19990,
            'price_monthly' => 2299, 'setup_fee' => 8000, 'price_yearly' => 22990,
            'max_communities' => 25, 'storage_gb' => 500, 'emails_per_month' => 1000000,
            'description' => '20,001 to 30,000 active members. Best for larger multi-community programmes.',
            'support' => 'Same-day response needs a support retainer',
        ],
        'network' => [
            'name' => 'Network', 'tier_level' => 7, 'max_users' => 100000,
            'price_monthly_gbp' => 2999, 'setup_fee_gbp' => 8600, 'price_yearly_gbp' => 29990,
            'price_monthly' => 3499, 'setup_fee' => 10000, 'price_yearly' => 34990,
            'max_communities' => 100, 'storage_gb' => 2000, 'emails_per_month' => 5000000,
            'description' => '30,001 to 100,000 active members. Best for national networks and consortia.',
            'support' => 'Urgent incident response needs a support retainer',
        ],
    ];

    /**
     * The descriptions the packages were first written with on 20 November
     * 2026 (the pricing page's "Best for" line alone, no member band). Kept so
     * the migration that fills in the fuller text can tell a description nobody
     * has edited from one the platform team has since changed by hand: only an
     * exact match is replaced.
     *
     * @var array<string, string>
     */
    public const FIRST_DESCRIPTIONS = [
        'spark' => 'Small full-platform pilots that need the whole NEXUS module set.',
        'local' => 'Established local timebanks that have outgrown a pilot.',
        'community' => 'Funded local communities and established nonprofit networks.',
        'growth' => 'Regional and multi-programme deployments.',
        'expansion' => 'Growing networks that have just crossed 10,000 active members and need room before full Scale.',
        'scale' => 'Larger multi-community programmes.',
        'network' => 'National networks and consortia.',
    ];

    /** On every tier ("Included in every managed plan" on the pricing page). */
    private const INCLUDED_IN_EVERY_PLAN = [
        'Full stable module set',
        'Standard and accessible (WCAG 2.2 AA) front ends',
        'Managed hosting, monitoring, daily backups and security patching',
        'One standard NEXUS subdomain with HTTPS',
        'No per-member or per-transaction commission',
    ];

    /**
     * What a package includes, one line each, as its `features` list: the
     * tier's own allowances and support line from the pricing page, then what
     * every managed plan includes. Built from TIERS so the list can never
     * disagree with the numbers stored beside it.
     *
     * The member number and the setup fee are deliberately not in here: they
     * are read from their own columns wherever a plan is shown, because a hub
     * can change both.
     *
     * @return list<string>
     */
    public static function features(string $slug): array
    {
        $tier = self::TIERS[$slug] ?? null;
        if ($tier === null) {
            return [];
        }

        $communities = $tier['max_communities'] === 1
            ? '1 community'
            : 'Up to ' . number_format($tier['max_communities']) . ' communities';

        $storage = $tier['storage_gb'] >= 1000 && $tier['storage_gb'] % 1000 === 0
            ? number_format(intdiv($tier['storage_gb'], 1000)) . ' TB storage'
            : number_format($tier['storage_gb']) . ' GB storage';

        $features = [
            $communities,
            $storage,
            number_format($tier['emails_per_month']) . ' emails a month',
            'Support: ' . $tier['support'],
        ];

        if ($slug === 'spark') {
            $features[] = 'Included in Timebanking UK membership';
        }

        return array_merge($features, self::INCLUDED_IN_EVERY_PLAN);
    }

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
