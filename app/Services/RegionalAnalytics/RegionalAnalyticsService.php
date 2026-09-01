<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\RegionalAnalytics;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * AG59 — Paid Regional Analytics Product.
 *
 * Computes privacy-bucketed aggregates for paying partners (municipalities, SMEs).
 *
 * PRIVACY GUARANTEES:
 *   - Every aggregate is bucketed into ranges: <50, 50-200, 200-1000, >1000
 *   - Volunteer hours are rounded to the nearest 10
 *   - Postcode aggregation: only the first 3 digits (NUTS3-level)
 *   - Suppression: any segment with N<10 returns null (rendered as "—")
 *   - No individual user IDs, names, or addresses ever appear in payloads
 */
class RegionalAnalyticsService
{
    /** Suppression threshold — segments with fewer members are blanked. */
    public const N_SUPPRESS = 10;

    /** Bucket a count into a public-safe range string. */
    public static function bucketCount(?int $n): ?string
    {
        if ($n === null || $n < self::N_SUPPRESS) {
            return null;
        }
        if ($n < 50) {
            return '<50';
        }
        if ($n < 200) {
            return '50-200';
        }
        if ($n < 1000) {
            return '200-1000';
        }
        return '>1000';
    }

    /** Round hours to nearest 10, or null if below suppression. */
    public static function roundHours(?float $h, int $sampleSize = PHP_INT_MAX): ?int
    {
        if ($h === null || $sampleSize < self::N_SUPPRESS) {
            return null;
        }
        return (int) (round($h / 10) * 10);
    }

    /**
     * Resolve a `last_30d` / `last_90d` / `last_year` token into [$start, $end] Carbon dates.
     */
    public static function resolvePeriod(string $period): array
    {
        $end = Carbon::now();
        return match ($period) {
            'last_90d' => [Carbon::now()->subDays(90), $end],
            'last_year', 'last_12m' => [Carbon::now()->subYear(), $end],
            default => [Carbon::now()->subDays(30), $end],
        };
    }

    /**
     * Regional engagement: bucketed counts of active members, categories,
     * partner orgs, volunteer hours, event participation.
     */
    public function computeRegionalEngagement(int $tenantId, string $period): array
    {
        [$start, $end] = self::resolvePeriod($period);

        $activeMembers = (int) DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->where('last_login_at', '>=', $start)
            ->count();

        $categories = (int) (Schema::hasTable('listings')
            ? DB::table('listings')
                ->where('tenant_id', $tenantId)
                ->whereBetween('created_at', [$start, $end])
                ->distinct('category_id')
                ->count('category_id')
            : 0);

        $partnerOrgs = (int) (Schema::hasTable('organisations')
            ? DB::table('organisations')
                ->where('tenant_id', $tenantId)
                ->where('status', 'active')
                ->count()
            : 0);

        $volunteerHoursRaw = 0.0;
        if (Schema::hasTable('volunteer_hours_log')) {
            $volunteerHoursRaw = (float) DB::table('volunteer_hours_log')
                ->where('tenant_id', $tenantId)
                ->whereBetween('logged_at', [$start, $end])
                ->sum('hours');
        }

        $eventParticipation = 0;
        if (Schema::hasTable('event_attendees') && Schema::hasTable('events')) {
            $eventParticipation = (int) DB::table('event_attendees')
                ->join('events', 'events.id', '=', 'event_attendees.event_id')
                ->where('events.tenant_id', $tenantId)
                ->whereBetween('event_attendees.created_at', [$start, $end])
                ->count();
        }

        return [
            'period' => $period,
            'period_start' => $start->toDateString(),
            'period_end' => $end->toDateString(),
            'active_members_bucket' => self::bucketCount($activeMembers),
            'categories_active_bucket' => self::bucketCount($categories),
            'partner_orgs_bucket' => self::bucketCount($partnerOrgs),
            'volunteer_hours_rounded' => self::roundHours($volunteerHoursRaw, $activeMembers),
            'event_participation_bucket' => self::bucketCount($eventParticipation),
        ];
    }

    /**
     * Demand vs Supply: listings by category × postcode bucket (3-digit), bucketed match-rate.
     */
    public function computeDemandSupplyHeatmap(int $tenantId, string $period): array
    {
        [$start, $end] = self::resolvePeriod($period);

        if (! Schema::hasTable('listings')) {
            return ['period' => $period, 'cells' => []];
        }

        $rows = DB::table('listings')
            ->select('category_id', 'type', DB::raw("LEFT(COALESCE(postcode,''), 3) AS pc3"), DB::raw('COUNT(*) AS cnt'))
            ->where('tenant_id', $tenantId)
            ->whereBetween('created_at', [$start, $end])
            ->groupBy('category_id', 'type', 'pc3')
            ->get();

        // Aggregate offer / request counts per (category × pc3)
        $cells = [];
        foreach ($rows as $r) {
            $key = ($r->category_id ?? 0) . '::' . ($r->pc3 ?? '');
            $cells[$key] ??= [
                'category_id' => (int) ($r->category_id ?? 0),
                'postcode_3' => (string) ($r->pc3 ?? ''),
                'offers' => 0,
                'requests' => 0,
            ];
            if (($r->type ?? '') === 'request') {
                $cells[$key]['requests'] += (int) $r->cnt;
            } else {
                $cells[$key]['offers'] += (int) $r->cnt;
            }
        }

        $output = [];
        foreach ($cells as $cell) {
            $total = $cell['offers'] + $cell['requests'];
            $matchRate = null;
            if ($total >= self::N_SUPPRESS) {
                $matched = min($cell['offers'], $cell['requests']);
                $rate = (int) round(($matched / max(1, $total)) * 100);
                // Bucket match-rate to nearest 10 to avoid exposing precise figures.
                $matchRate = (int) (round($rate / 10) * 10);
            }
            $output[] = [
                'category_id' => $cell['category_id'],
                'postcode_3' => $cell['postcode_3'],
                'offers_bucket' => self::bucketCount($cell['offers']),
                'requests_bucket' => self::bucketCount($cell['requests']),
                'match_rate_bucket' => $matchRate, // null if N<10
            ];
        }

        return [
            'period' => $period,
            'period_start' => $start->toDateString(),
            'period_end' => $end->toDateString(),
            'cells' => $output,
        ];
    }

    /**
     * Demographic breakdown: age buckets and gender, all bucketed.
     */
    public function computeDemographicReport(int $tenantId, string $period): array
    {
        [$start, $end] = self::resolvePeriod($period);

        $ageBuckets = ['<25' => 0, '25-44' => 0, '45-64' => 0, '65+' => 0];
        $genderBuckets = ['M' => 0, 'F' => 0, 'Other' => 0, 'Unspecified' => 0];

        // This query used to select a `gender` column. No table in this schema
        // has ever had one — the platform does not collect gender — so the
        // select failed and took the whole partner dashboard down with it
        // whenever the demographics module was enabled. `gender_buckets` is kept
        // in the response so the payload shape stays stable for subscribers, and
        // every active member is reported as Unspecified, which is the truth.
        $rows = DB::table('users')
            ->select('date_of_birth')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->get();

        foreach ($rows as $u) {
            // Age bucket
            if (! empty($u->date_of_birth)) {
                $age = Carbon::parse($u->date_of_birth)->age;
                if ($age < 25) {
                    $ageBuckets['<25']++;
                } elseif ($age < 45) {
                    $ageBuckets['25-44']++;
                } elseif ($age < 65) {
                    $ageBuckets['45-64']++;
                } else {
                    $ageBuckets['65+']++;
                }
            }

            $genderBuckets['Unspecified']++;
        }

        return [
            'period' => $period,
            'period_start' => $start->toDateString(),
            'period_end' => $end->toDateString(),
            'age_buckets' => array_map(fn ($n) => self::bucketCount($n), $ageBuckets),
            'gender_buckets' => array_map(fn ($n) => self::bucketCount($n), $genderBuckets),
        ];
    }

    /**
     * Anonymised footfall: total page views per public area, distinct visitors bucketed.
     */
    public function computeFootfallAnalytics(int $tenantId, string $period): array
    {
        [$start, $end] = self::resolvePeriod($period);

        $areas = ['feed', 'listings', 'marketplace'];
        $result = [];

        $hasLog = Schema::hasTable('page_view_log');

        foreach ($areas as $area) {
            $views = 0;
            $distinct = 0;
            if ($hasLog) {
                $views = (int) DB::table('page_view_log')
                    ->where('tenant_id', $tenantId)
                    ->where('area', $area)
                    ->whereBetween('created_at', [$start, $end])
                    ->count();
                $distinct = (int) DB::table('page_view_log')
                    ->where('tenant_id', $tenantId)
                    ->where('area', $area)
                    ->whereBetween('created_at', [$start, $end])
                    ->distinct('visitor_hash')
                    ->count('visitor_hash');
            }

            $result[$area] = [
                'page_views_bucket' => self::bucketCount($views),
                'distinct_visitors_bucket' => self::bucketCount($distinct),
            ];
        }

        return [
            'period' => $period,
            'period_start' => $start->toDateString(),
            'period_end' => $end->toDateString(),
            'areas' => $result,
        ];
    }

    /**
     * Build the full bucketed dashboard payload for a subscription.
     */
    public function buildDashboardPayload(int $tenantId, string $period, array $enabledModules): array
    {
        $modules = array_values(array_filter(
            $enabledModules,
            fn ($m) => in_array($m, ['trends', 'demand_supply', 'demographics', 'footfall'], true)
        ));
        if (empty($modules)) {
            $modules = ['trends', 'demand_supply', 'demographics', 'footfall'];
        }

        $payload = [
            'period' => $period,
            'enabled_modules' => $modules,
            'generated_at' => now()->toIso8601String(),
        ];

        if (in_array('trends', $modules, true)) {
            $payload['engagement'] = $this->computeRegionalEngagement($tenantId, $period);
        }
        if (in_array('demand_supply', $modules, true)) {
            $payload['demand_supply'] = $this->computeDemandSupplyHeatmap($tenantId, $period);
        }
        if (in_array('demographics', $modules, true)) {
            $payload['demographics'] = $this->computeDemographicReport($tenantId, $period);
        }
        if (in_array('footfall', $modules, true)) {
            $payload['footfall'] = $this->computeFootfallAnalytics($tenantId, $period);
        }

        return $payload;
    }
}
