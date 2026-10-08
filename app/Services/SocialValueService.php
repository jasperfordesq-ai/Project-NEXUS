<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\DB;

/**
 * SocialValueService — Native Eloquent implementation for SROI (Social Return on Investment) reporting.
 *
 * Uses the `social_value_config` table for per-tenant configuration and calculates
 * social value from transactions, events, volunteer hours, and community engagement.
 */
class SocialValueService
{
    /**
     * Default SROI configuration values.
     *
     * The counterfactual coefficients (deadweight/displacement/attribution 10%,
     * drop-off 70%, discount 3.5%) follow the 2023 Timebank Ireland SROI study
     * and HM Treasury Green Book discounting guidance.
     */
    private const DEFAULTS = [
        'hour_value_currency' => 'GBP',
        'hour_value_amount'   => 15.00,
        'social_multiplier'   => 3.50,
        'reporting_period'    => 'annually',
        'investment_amount'   => null,
        'deadweight_pct'      => 10.00,
        'displacement_pct'    => 10.00,
        'attribution_pct'     => 10.00,
        'dropoff_pct'         => 70.00,
        'discount_rate_pct'   => 3.50,
        'projection_years'    => 2,
    ];

    /**
     * Transaction types that are NOT person-to-person service hours and must
     * never be monetised as social impact: system credit issuance and
     * member-to-member credit gifts. Everything else (transfer, exchange,
     * federation, volunteer, job_completion, ...) represents real exchanged hours.
     */
    public const EXCLUDED_TRANSACTION_TYPES = [
        'starting_balance',
        'opening_balance', // OpeningBalance::TYPE — hours brought from another timebank (member import)
        'admin_grant',
        'community_fund',
        'donation',
    ];

    public function __construct()
    {
    }

    /**
     * Calculate the Social Return on Investment for a tenant.
     *
     * @param int   $tenantId
     * @param array $dateRange ['from' => 'Y-m-d', 'to' => 'Y-m-d']
     * @return array
     */
    public function calculateSROI(int $tenantId, array $dateRange = []): array
    {
        $config = $this->getConfig($tenantId);
        $hourValue = (float) $config['hour_value_amount'];
        $multiplier = (float) $config['social_multiplier'];
        $currency = $config['hour_value_currency'];

        // Build date conditions
        $dateConditions = $this->buildDateConditions($dateRange);
        $dateBindings = $this->buildDateBindings($dateRange);
        $typeExclusion = self::transactionTypeExclusionSql();
        $typeExclusionAliased = self::transactionTypeExclusionSql('t.');

        // 1. Total exchanged service hours (amount = hours in this timebank).
        //    System credit issuance and credit gifts are excluded — they are
        //    not service hours and would inflate the impact claim.
        $txQuery = "SELECT
                COALESCE(SUM(amount), 0) AS total_hours,
                COUNT(*) AS total_transactions
            FROM transactions
            WHERE tenant_id = ? AND status = 'completed' {$typeExclusion}
            {$dateConditions}";
        $txResult = DB::selectOne($txQuery, array_merge([$tenantId], $dateBindings));
        $totalHours = (float) ($txResult->total_hours ?? 0);
        $totalTransactions = (int) ($txResult->total_transactions ?? 0);

        // 2. Unique active members (participated in transactions)
        $memberQuery = "SELECT COUNT(DISTINCT user_id) AS active_members FROM (
                SELECT sender_id AS user_id FROM transactions WHERE tenant_id = ? AND status = 'completed' {$typeExclusion} {$dateConditions}
                UNION
                SELECT receiver_id AS user_id FROM transactions WHERE tenant_id = ? AND status = 'completed' {$typeExclusion} {$dateConditions}
            ) AS active_users";
        $memberResult = DB::selectOne($memberQuery, array_merge(
            [$tenantId],
            $dateBindings,
            [$tenantId],
            $dateBindings
        ));
        $activeMembers = (int) ($memberResult->active_members ?? 0);

        // 3. Events held
        $eventQuery = "SELECT COUNT(*) AS total_events, COALESCE(SUM(
                CASE WHEN end_time IS NOT NULL AND start_time IS NOT NULL
                    THEN TIMESTAMPDIFF(HOUR, start_time, end_time) ELSE 0 END
            ), 0) AS event_hours
            FROM events
            WHERE tenant_id = ? AND status IN ('active', 'completed')
            {$this->buildDateConditions($dateRange, 'start_time')}";
        $eventResult = DB::selectOne($eventQuery, array_merge([$tenantId], $this->buildDateBindings($dateRange)));
        $totalEvents = (int) ($eventResult->total_events ?? 0);
        $eventHours = (float) ($eventResult->event_hours ?? 0);

        // 4. Listings created
        $listingQuery = "SELECT COUNT(*) AS total_listings
            FROM listings WHERE tenant_id = ? AND status = 'active'
            {$this->buildDateConditions($dateRange)}";
        $listingResult = DB::selectOne($listingQuery, array_merge([$tenantId], $this->buildDateBindings($dateRange)));
        $totalListings = (int) ($listingResult->total_listings ?? 0);

        // 5. Calculate monetary values
        $directValue = $totalHours * $hourValue;
        $socialValue = $directValue * $multiplier;
        $totalValue = $directValue + $socialValue;

        // 6. Hours by category breakdown
        $categoryQuery = "SELECT
                c.name AS category_name,
                COALESCE(SUM(t.amount), 0) AS hours,
                COUNT(*) AS transaction_count
            FROM transactions t
            LEFT JOIN listings l ON l.id = t.listing_id AND l.tenant_id = t.tenant_id
            LEFT JOIN categories c ON c.id = l.category_id AND c.tenant_id = t.tenant_id
            WHERE t.tenant_id = ? AND t.status = 'completed' {$typeExclusionAliased}
            {$this->buildDateConditions($dateRange, 't.created_at')}
            GROUP BY c.name
            ORDER BY hours DESC
            LIMIT 20";
        $categories = DB::select($categoryQuery, array_merge([$tenantId], $this->buildDateBindings($dateRange)));

        $categoryBreakdown = array_map(function ($row) use ($hourValue, $multiplier) {
            $hours = (float) $row->hours;
            $direct = $hours * $hourValue;
            return [
                'category'          => $row->category_name ?? 'Uncategorized',
                'hours'             => $hours,
                'transaction_count' => (int) $row->transaction_count,
                'direct_value'      => round($direct, 2),
                'social_value'      => round($direct * $multiplier, 2),
            ];
        }, $categories);

        // 7. Monthly trend (last 12 months)
        $trendQuery = "SELECT
                DATE_FORMAT(created_at, '%Y-%m') AS month,
                COALESCE(SUM(amount), 0) AS hours,
                COUNT(*) AS transactions
            FROM transactions
            WHERE tenant_id = ? AND status = 'completed' {$typeExclusion}
                AND created_at >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
            GROUP BY DATE_FORMAT(created_at, '%Y-%m')
            ORDER BY month ASC";
        $trends = DB::select($trendQuery, [$tenantId]);

        $monthlyTrend = array_map(function ($row) use ($hourValue, $multiplier) {
            $hours = (float) $row->hours;
            $direct = $hours * $hourValue;
            return [
                'month'        => $row->month,
                'hours'        => $hours,
                'transactions' => (int) $row->transactions,
                'direct_value' => round($direct, 2),
                'social_value' => round($direct * $multiplier, 2),
                'total_value'  => round($direct + ($direct * $multiplier), 2),
            ];
        }, $trends);

        // 8. Methodology-correct SROI projection (Social Value International
        //    model): outcomes × proxies, counterfactual deductions, drop-off,
        //    discounting, ratio against total investment.
        $outcomes = $this->getOutcomes($tenantId);
        $sroi = self::computeSroiProjection($config, $outcomes);

        return [
            'config'   => [
                'hour_value_currency' => $currency,
                'hour_value_amount'   => $hourValue,
                'social_multiplier'   => $multiplier,
                'reporting_period'    => $config['reporting_period'],
                'investment_amount'   => $config['investment_amount'],
                'deadweight_pct'      => $config['deadweight_pct'],
                'displacement_pct'    => $config['displacement_pct'],
                'attribution_pct'     => $config['attribution_pct'],
                'dropoff_pct'         => $config['dropoff_pct'],
                'discount_rate_pct'   => $config['discount_rate_pct'],
                'projection_years'    => $config['projection_years'],
            ],
            'sroi'     => $sroi,
            'outcomes' => $outcomes,
            'summary'  => [
                'total_hours'        => round($totalHours, 2),
                'total_transactions' => $totalTransactions,
                'active_members'     => $activeMembers,
                'total_events'       => $totalEvents,
                'event_hours'        => round($eventHours, 2),
                'total_listings'     => $totalListings,
                'direct_value'       => round($directValue, 2),
                'social_value'       => round($socialValue, 2),
                'total_value'        => round($totalValue, 2),
                'currency'           => $currency,
            ],
            'categories'    => $categoryBreakdown,
            'monthly_trend' => $monthlyTrend,
            'date_range'    => $dateRange,
        ];
    }

    /**
     * Get the SROI configuration for a tenant.
     */
    public function getConfig(int $tenantId): array
    {
        $row = DB::table('social_value_config')
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$row) {
            return self::DEFAULTS;
        }

        return [
            'hour_value_currency' => $row->hour_value_currency ?? self::DEFAULTS['hour_value_currency'],
            'hour_value_amount'   => (float) ($row->hour_value_amount ?? self::DEFAULTS['hour_value_amount']),
            'social_multiplier'   => (float) ($row->social_multiplier ?? self::DEFAULTS['social_multiplier']),
            'reporting_period'    => $row->reporting_period ?? self::DEFAULTS['reporting_period'],
            'investment_amount'   => isset($row->investment_amount) ? (float) $row->investment_amount : null,
            'deadweight_pct'      => (float) ($row->deadweight_pct ?? self::DEFAULTS['deadweight_pct']),
            'displacement_pct'    => (float) ($row->displacement_pct ?? self::DEFAULTS['displacement_pct']),
            'attribution_pct'     => (float) ($row->attribution_pct ?? self::DEFAULTS['attribution_pct']),
            'dropoff_pct'         => (float) ($row->dropoff_pct ?? self::DEFAULTS['dropoff_pct']),
            'discount_rate_pct'   => (float) ($row->discount_rate_pct ?? self::DEFAULTS['discount_rate_pct']),
            'projection_years'    => (int) ($row->projection_years ?? self::DEFAULTS['projection_years']),
        ];
    }

    /**
     * Save the SROI configuration for a tenant.
     */
    public function saveConfig(int $tenantId, array $config): bool
    {
        $data = [
            'hour_value_currency' => $config['hour_value_currency'] ?? self::DEFAULTS['hour_value_currency'],
            'hour_value_amount'   => (float) ($config['hour_value_amount'] ?? self::DEFAULTS['hour_value_amount']),
            'social_multiplier'   => (float) ($config['social_multiplier'] ?? self::DEFAULTS['social_multiplier']),
            'reporting_period'    => $config['reporting_period'] ?? self::DEFAULTS['reporting_period'],
            'investment_amount'   => array_key_exists('investment_amount', $config) && $config['investment_amount'] !== null
                ? (float) $config['investment_amount'] : null,
            'deadweight_pct'      => (float) ($config['deadweight_pct'] ?? self::DEFAULTS['deadweight_pct']),
            'displacement_pct'    => (float) ($config['displacement_pct'] ?? self::DEFAULTS['displacement_pct']),
            'attribution_pct'     => (float) ($config['attribution_pct'] ?? self::DEFAULTS['attribution_pct']),
            'dropoff_pct'         => (float) ($config['dropoff_pct'] ?? self::DEFAULTS['dropoff_pct']),
            'discount_rate_pct'   => (float) ($config['discount_rate_pct'] ?? self::DEFAULTS['discount_rate_pct']),
            'projection_years'    => max(1, min(10, (int) ($config['projection_years'] ?? self::DEFAULTS['projection_years']))),
            'updated_at'          => now(),
        ];

        $exists = DB::table('social_value_config')
            ->where('tenant_id', $tenantId)
            ->exists();

        if ($exists) {
            DB::table('social_value_config')
                ->where('tenant_id', $tenantId)
                ->update($data);
        } else {
            $data['tenant_id'] = $tenantId;
            $data['created_at'] = now();
            DB::table('social_value_config')->insert($data);
        }

        return true;
    }

    /**
     * Outcome categories for a tenant (stakeholder quantity × financial proxy).
     *
     * @return array<int, array{id:int,name:string,quantity:int,proxy_value:float,proxy_source:?string,sort_order:int}>
     */
    public function getOutcomes(int $tenantId): array
    {
        return DB::table('social_value_outcomes')
            ->where('tenant_id', $tenantId)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get()
            ->map(fn ($row) => [
                'id'           => (int) $row->id,
                'name'         => (string) $row->name,
                'quantity'     => (int) $row->quantity,
                'proxy_value'  => (float) $row->proxy_value,
                'proxy_source' => $row->proxy_source,
                'sort_order'   => (int) $row->sort_order,
            ])
            ->all();
    }

    /**
     * Replace the tenant's outcome categories with the provided set.
     *
     * @param array<int, array{name:string,quantity:int|float,proxy_value:int|float,proxy_source?:?string}> $outcomes
     */
    public function saveOutcomes(int $tenantId, array $outcomes): bool
    {
        DB::transaction(function () use ($tenantId, $outcomes) {
            DB::table('social_value_outcomes')->where('tenant_id', $tenantId)->delete();

            $rows = [];
            foreach (array_values($outcomes) as $i => $outcome) {
                $name = trim((string) ($outcome['name'] ?? ''));
                if ($name === '') {
                    continue;
                }
                $rows[] = [
                    'tenant_id'    => $tenantId,
                    'name'         => mb_substr($name, 0, 150),
                    'quantity'     => max(0, (int) ($outcome['quantity'] ?? 0)),
                    'proxy_value'  => max(0.0, (float) ($outcome['proxy_value'] ?? 0)),
                    'proxy_source' => isset($outcome['proxy_source']) && $outcome['proxy_source'] !== ''
                        ? mb_substr((string) $outcome['proxy_source'], 0, 255) : null,
                    'sort_order'   => $i,
                    'created_at'   => now(),
                    'updated_at'   => now(),
                ];
            }

            if ($rows !== []) {
                DB::table('social_value_outcomes')->insert($rows);
            }
        });

        return true;
    }

    /**
     * Methodology-correct SROI projection (Social Value International model,
     * as applied in the 2023 Timebank Ireland study):
     *
     *   gross           = Σ (quantity × proxy_value) over outcome categories
     *   year-1 net      = gross × (1−deadweight) × (1−displacement) × (1−attribution)
     *   year-n retained = year-1 net × (1−dropoff)^(n−1)
     *   year-n PV       = retained / (1+discount)^(n−1)   (year 1 undiscounted)
     *   TPV             = Σ yearly PV
     *   ratio           = TPV / investment                (null when no investment set)
     *
     * Pure function of config + outcomes; every coefficient used is echoed in
     * the result for auditability (SROI principle 6: be transparent).
     *
     * @param array $config   Output of getConfig()
     * @param array $outcomes Output of getOutcomes()
     */
    public static function computeSroiProjection(array $config, array $outcomes): array
    {
        $deadweight  = ((float) ($config['deadweight_pct'] ?? self::DEFAULTS['deadweight_pct'])) / 100;
        $displacement = ((float) ($config['displacement_pct'] ?? self::DEFAULTS['displacement_pct'])) / 100;
        $attribution = ((float) ($config['attribution_pct'] ?? self::DEFAULTS['attribution_pct'])) / 100;
        $dropoff     = ((float) ($config['dropoff_pct'] ?? self::DEFAULTS['dropoff_pct'])) / 100;
        $discount    = ((float) ($config['discount_rate_pct'] ?? self::DEFAULTS['discount_rate_pct'])) / 100;
        $years       = max(1, min(10, (int) ($config['projection_years'] ?? self::DEFAULTS['projection_years'])));
        $investment  = isset($config['investment_amount']) && $config['investment_amount'] !== null
            ? (float) $config['investment_amount'] : null;

        $gross = 0.0;
        foreach ($outcomes as $outcome) {
            $gross += max(0, (int) ($outcome['quantity'] ?? 0)) * max(0.0, (float) ($outcome['proxy_value'] ?? 0));
        }

        $yearOneNet = $gross * (1 - $deadweight) * (1 - $displacement) * (1 - $attribution);

        $yearly = [];
        $totalPresentValue = 0.0;
        for ($year = 1; $year <= $years; $year++) {
            $retained = $yearOneNet * (1 - $dropoff) ** ($year - 1);
            $presentValue = $retained / (1 + $discount) ** ($year - 1);
            $totalPresentValue += $presentValue;
            $yearly[] = [
                'year'          => $year,
                'retained'      => round($retained, 2),
                'present_value' => round($presentValue, 2),
            ];
        }

        $ratio = ($investment !== null && $investment > 0)
            ? round($totalPresentValue / $investment, 2)
            : null;

        return [
            'gross_value'         => round($gross, 2),
            'year_one_net'        => round($yearOneNet, 2),
            'yearly'              => $yearly,
            'total_present_value' => round($totalPresentValue, 2),
            'investment_amount'   => $investment,
            'sroi_ratio'          => $ratio,
            'is_configured'       => $ratio !== null && $gross > 0,
            'coefficients'        => [
                'deadweight_pct'    => round($deadweight * 100, 2),
                'displacement_pct'  => round($displacement * 100, 2),
                'attribution_pct'   => round($attribution * 100, 2),
                'dropoff_pct'       => round($dropoff * 100, 2),
                'discount_rate_pct' => round($discount * 100, 2),
                'projection_years'  => $years,
            ],
        ];
    }

    /**
     * SQL fragment excluding non-service transaction types (system credit
     * issuance and credit gifts) from hour aggregation. Values are class
     * constants, never user input.
     */
    public static function transactionTypeExclusionSql(string $columnPrefix = ''): string
    {
        $quoted = implode("','", self::EXCLUDED_TRANSACTION_TYPES);

        return "AND {$columnPrefix}transaction_type NOT IN ('{$quoted}')";
    }

    /**
     * Build SQL date condition fragment.
     */
    private function buildDateConditions(array $dateRange, string $column = 'created_at'): string
    {
        $conditions = '';
        if (!empty($dateRange['from'])) {
            $conditions .= " AND {$column} >= ?";
        }
        if (!empty($dateRange['to'])) {
            $conditions .= " AND {$column} <= ?";
        }
        return $conditions;
    }

    /**
     * Build bindings array for date conditions. A date-only 'to' bound is
     * widened to end-of-day so the final day's activity is included.
     */
    private function buildDateBindings(array $dateRange): array
    {
        $bindings = [];
        if (!empty($dateRange['from'])) {
            $bindings[] = $dateRange['from'];
        }
        if (!empty($dateRange['to'])) {
            $to = $dateRange['to'];
            $bindings[] = strlen($to) === 10 ? $to . ' 23:59:59' : $to;
        }
        return $bindings;
    }
}
