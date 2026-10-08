<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Builds municipal/KISS impact reporting from existing tenant-scoped activity.
 * Hours brought from another timebank (member import, 'opening_balance') were not
 * exchanged here and are excluded from every figure.
 */
class MunicipalImpactReportService
{
    private const DEFAULT_HOUR_VALUE = 35.0;
    private const DEFAULT_SOCIAL_MULTIPLIER = 2.8;
    private const DEFAULT_CURRENCY = 'CHF';

    public function __construct(private readonly CaringCommunityWorkflowPolicyService $policyService)
    {
    }

    public function summary(int $tenantId, array $filters = []): array
    {
        $policy = $this->policyService->get($tenantId);
        $policy = $this->applyTemplateOverrides($policy, $filters);
        $range = $this->normaliseDateRange($filters, $policy);
        $hourConfig = $this->hourValueConfig($tenantId, $policy);
        $reportContext = $this->reportContext($filters);

        $timebank = $this->timebankSummary($tenantId, $range);
        $volunteering = $this->volunteeringSummary($tenantId, $range);
        $members = $this->memberSummary($tenantId, $range);
        $organisations = $this->organisationSummary($tenantId, $range);
        $requests = $this->requestSummary($tenantId, $range);
        $categories = $this->supportCategories($tenantId, $range);
        $trends = $this->periodTrends($tenantId, $range);

        $verifiedHours = $volunteering['approved_hours'] + $timebank['completed_hours'];
        $directValue = round($verifiedHours * $hourConfig['hour_value'], 2);
        $socialValue = round($directValue * $hourConfig['social_multiplier'], 2);

        $payload = [
            'period' => $range,
            'currency' => $hourConfig['currency'],
            'hour_value' => $hourConfig['hour_value'],
            'social_multiplier' => $hourConfig['social_multiplier'],
            'policy' => [
                'default_period' => $policy['municipal_report_default_period'],
                'include_social_value_estimate' => (bool) $policy['include_social_value_estimate'],
                'default_hour_value_chf' => (int) $policy['default_hour_value_chf'],
            ],
            'report_context' => $reportContext,
            'stats' => [
                'verified_hours' => round($verifiedHours, 1),
                'volunteer_hours' => round($volunteering['approved_hours'], 1),
                'timebank_hours' => round($timebank['completed_hours'], 1),
                'pending_hours' => round($volunteering['pending_hours'], 1),
                'active_members' => $members['active_members'],
                'new_members' => $members['new_members'],
                'participating_members' => $members['participating_members'],
                'trusted_organisations' => $organisations['trusted_organisations'],
                'active_opportunities' => $organisations['active_opportunities'],
                'support_requests' => $requests['support_requests'],
                'support_offers' => $requests['support_offers'],
                'direct_value' => $directValue,
                'social_value' => $policy['include_social_value_estimate'] ? $socialValue : 0.0,
                'total_value' => round($directValue + ($policy['include_social_value_estimate'] ? $socialValue : 0.0), 2),
            ],
            'categories' => $categories,
            'trends' => $trends,
            'readiness_signals' => $this->readinessSignals($verifiedHours, $members, $organisations, $requests),
            'sroi_methodology' => $this->sroiMethodology($hourConfig, (bool) $policy['include_social_value_estimate']),
            'report_pack' => [
                'csv_export' => '/api/v2/admin/reports/municipal_impact/export?format=csv',
                'pdf_export' => '/api/v2/admin/reports/municipal_impact/export?format=pdf',
                'source_reports' => [
                    'hours' => '/admin/reports/hours',
                    'members' => '/admin/reports/members',
                    'impact' => '/admin/impact-report',
                    'volunteering' => '/admin/volunteering',
                ],
            ],
        ];

        $audience = (string) ($reportContext['audience'] ?? 'municipality');
        $payload = $this->attachNarrativeVariant($payload, $audience, $tenantId, $range, $hourConfig, $verifiedHours, $members, $organisations);

        return $payload;
    }

    /**
     * Compute and attach the audience-specific narrative variant to the report payload.
     * The base payload always contains the same numeric stats; the variant adds extra
     * fields tailored to canton-, municipality-, or cooperative-level readers.
     */
    private function attachNarrativeVariant(
        array $payload,
        string $audience,
        int $tenantId,
        array $range,
        array $hourConfig,
        float $verifiedHours,
        array $members,
        array $organisations,
    ): array {
        switch ($audience) {
            case 'canton':
                $payload['canton_variant'] = $this->cantonVariant($tenantId, $range, $hourConfig, $verifiedHours);
                break;
            case 'cooperative':
                $payload['cooperative_variant'] = $this->cooperativeVariant($tenantId, $range, $members);
                break;
            case 'foundation':
            case 'municipality':
            default:
                $payload['municipality_variant'] = $this->municipalityVariant($tenantId, $range, $organisations);
                break;
        }

        return $payload;
    }

    /**
     * Canton-level narrative: aggregate impact across multiple municipalities,
     * estimated cost-avoidance vs professional care, and year-over-year change.
     */
    private function cantonVariant(int $tenantId, array $range, array $hourConfig, float $verifiedHours): array
    {
        // Cost-avoidance multiplier reflects the rough professional-care equivalency
        // (e.g. paid Spitex visit + admin overhead) on top of the policy hour value.
        $costAvoidanceMultiplier = 1.5;
        $estCostAvoidance = round($verifiedHours * $hourConfig['hour_value'] * $costAvoidanceMultiplier, 2);

        // Year-over-year: same period one year prior.
        $priorRange = [
            'from' => date('Y-m-d', strtotime($range['from'] . ' -1 year')),
            'to' => date('Y-m-d', strtotime($range['to'] . ' -1 year')),
        ];
        $priorHours = $this->verifiedHoursTotal($tenantId, $priorRange);
        $yoyChangePercent = $priorHours > 0
            ? round((($verifiedHours - $priorHours) / $priorHours) * 100, 1)
            : null;

        // Multi-node total: when federation aggregates are available, this number sums
        // across opted-in nodes. For now we surface this tenant's contribution under
        // the same key so the canton-level UI has a stable shape.
        $aggregateMunicipalities = 1;
        $multiNodeTotalHours = round($verifiedHours, 1);

        return [
            'aggregate_municipalities_count' => $aggregateMunicipalities,
            'multi_node_total_hours' => $multiNodeTotalHours,
            'est_cost_avoidance_chf' => $estCostAvoidance,
            'cost_avoidance_multiplier' => $costAvoidanceMultiplier,
            'yoy_change_percent' => $yoyChangePercent,
            'yoy_prior_period' => $priorRange,
            'yoy_prior_hours' => round($priorHours, 1),
        ];
    }

    /**
     * Municipality-level narrative: who participated, named partner orgs, geographic
     * (category) split, and recipient reach.
     */
    private function municipalityVariant(int $tenantId, array $range, array $organisations): array
    {
        $partnerOrgs = [];
        if (Schema::hasTable('vol_organizations') && Schema::hasTable('vol_logs')) {
            $rows = DB::select(
                "SELECT o.id, o.name,
                        COALESCE(SUM(l.hours), 0) AS hours,
                        COUNT(l.id) AS log_count
                 FROM vol_organizations o
                 LEFT JOIN vol_logs l
                        ON l.organization_id = o.id
                       AND l.tenant_id = o.tenant_id
                       AND l.status = 'approved'
                       AND l.date_logged BETWEEN ? AND ?
                 WHERE o.tenant_id = ? AND o.status IN ('approved', 'active')
                 GROUP BY o.id, o.name
                 ORDER BY hours DESC
                 LIMIT 12",
                [$range['from'], $range['to'], $tenantId]
            );
            foreach ($rows as $row) {
                $partnerOrgs[] = [
                    'id' => (int) $row->id,
                    'name' => (string) $row->name,
                    'hours' => round((float) $row->hours, 1),
                    'log_count' => (int) $row->log_count,
                ];
            }
        }

        // Recipients reached: distinct receivers in completed transactions in the period.
        $recipientsReached = 0;
        if (Schema::hasTable('transactions')) {
            $row = DB::selectOne(
                "SELECT COUNT(DISTINCT receiver_id) AS count
                 FROM transactions
                 WHERE tenant_id = ? AND status = 'completed' AND transaction_type <> 'opening_balance'
                   AND DATE(created_at) BETWEEN ? AND ?",
                [$tenantId, $range['from'], $range['to']]
            );
            $recipientsReached = (int) ($row->count ?? 0);
        }

        // Top 5 categories by hours (acts as our geographic-distribution proxy until
        // structured location data is collected on every transaction).
        $topCategories = [];
        if (Schema::hasTable('transactions')) {
            $rows = DB::select(
                "SELECT COALESCE(c.name, 'Uncategorized') AS name,
                        COALESCE(SUM(t.amount), 0) AS hours,
                        COUNT(*) AS count
                 FROM transactions t
                 LEFT JOIN listings l ON l.id = t.listing_id AND l.tenant_id = t.tenant_id
                 LEFT JOIN categories c ON c.id = l.category_id AND c.tenant_id = t.tenant_id
                 WHERE t.tenant_id = ? AND t.status = 'completed' AND t.transaction_type <> 'opening_balance'
                   AND DATE(t.created_at) BETWEEN ? AND ?
                 GROUP BY COALESCE(c.name, 'Uncategorized')
                 ORDER BY hours DESC
                 LIMIT 5",
                [$tenantId, $range['from'], $range['to']]
            );
            foreach ($rows as $row) {
                $topCategories[] = [
                    'name' => (string) $row->name,
                    'hours' => round((float) $row->hours, 1),
                    'count' => (int) $row->count,
                ];
            }
        }

        return [
            'partner_organisations' => $partnerOrgs,
            'partner_organisations_count' => count($partnerOrgs),
            'recipients_reached_count' => $recipientsReached,
            'geographic_distribution' => $topCategories,
            'trusted_organisations_total' => $organisations['trusted_organisations'],
        ];
    }

    /**
     * Cooperative-level narrative: member retention, hour reciprocity, tandem
     * relationship count, and average coordinator load.
     */
    private function cooperativeVariant(int $tenantId, array $range, array $members): array
    {
        $periodLengthDays = max(1, (int) ((strtotime($range['to']) - strtotime($range['from'])) / 86400));
        $priorRange = [
            'from' => date('Y-m-d', strtotime($range['from'] . ' -' . $periodLengthDays . ' days')),
            'to' => date('Y-m-d', strtotime($range['from'] . ' -1 day')),
        ];

        $currentParticipants = $this->participantIds($tenantId, $range);
        $priorParticipants = $this->participantIds($tenantId, $priorRange);
        $retainedCount = count(array_intersect_key($currentParticipants, $priorParticipants));
        $retentionRate = count($priorParticipants) > 0
            ? round($retainedCount / count($priorParticipants), 3)
            : 0.0;

        // Reciprocity: of distinct supporters (givers), how many were also receivers
        // in the same period.
        $supporters = [];
        $receivers = [];
        if (Schema::hasTable('vol_logs')) {
            foreach (DB::select(
                "SELECT DISTINCT user_id FROM vol_logs
                 WHERE tenant_id = ? AND status = 'approved' AND date_logged BETWEEN ? AND ?",
                [$tenantId, $range['from'], $range['to']]
            ) as $row) {
                if ($row->user_id) {
                    $supporters[(int) $row->user_id] = true;
                }
            }
        }
        if (Schema::hasTable('transactions')) {
            foreach (DB::select(
                "SELECT DISTINCT sender_id, receiver_id FROM transactions
                 WHERE tenant_id = ? AND status = 'completed' AND transaction_type <> 'opening_balance' AND DATE(created_at) BETWEEN ? AND ?",
                [$tenantId, $range['from'], $range['to']]
            ) as $row) {
                if ($row->sender_id) {
                    $supporters[(int) $row->sender_id] = true;
                }
                if ($row->receiver_id) {
                    $receivers[(int) $row->receiver_id] = true;
                }
            }
        }
        $bothCount = count(array_intersect_key($supporters, $receivers));
        $reciprocityRate = count($supporters) > 0 ? round($bothCount / count($supporters), 3) : 0.0;

        // Tandem count: recurring helper/recipient pairs (>=2 completed transactions
        // in either direction within the period).
        $tandemCount = 0;
        if (Schema::hasTable('transactions')) {
            $row = DB::selectOne(
                "SELECT COUNT(*) AS pair_count FROM (
                     SELECT LEAST(sender_id, receiver_id) AS a,
                            GREATEST(sender_id, receiver_id) AS b,
                            COUNT(*) AS c
                     FROM transactions
                     WHERE tenant_id = ? AND status = 'completed' AND transaction_type <> 'opening_balance'
                       AND DATE(created_at) BETWEEN ? AND ?
                       AND sender_id IS NOT NULL AND receiver_id IS NOT NULL
                     GROUP BY a, b
                     HAVING c >= 2
                 ) pairs",
                [$tenantId, $range['from'], $range['to']]
            );
            $tandemCount = (int) ($row->pair_count ?? 0);
        }

        // Coordinator load: pending volunteer reviews divided by coordinator-role users.
        $pendingReviews = 0;
        if (Schema::hasTable('vol_logs')) {
            $row = DB::selectOne(
                "SELECT COUNT(*) AS count FROM vol_logs
                 WHERE tenant_id = ? AND status = 'pending'",
                [$tenantId]
            );
            $pendingReviews = (int) ($row->count ?? 0);
        }
        $coordinatorCount = (int) DB::selectOne(
            "SELECT COUNT(*) AS count FROM users
             WHERE tenant_id = ? AND is_approved = 1
               AND role IN ('admin', 'super_admin', 'coordinator')",
            [$tenantId]
        )->count;
        $coordinatorLoadAvg = $coordinatorCount > 0
            ? round($pendingReviews / $coordinatorCount, 1)
            : (float) $pendingReviews;

        // Future-care credit balance pool: sum of positive balances held by approved
        // members. This is the reserve the cooperative is implicitly insuring.
        $futureCarePool = 0.0;
        if (Schema::hasColumn('users', 'balance')) {
            $row = DB::selectOne(
                "SELECT COALESCE(SUM(GREATEST(balance, 0)), 0) AS total
                 FROM users
                 WHERE tenant_id = ? AND is_approved = 1",
                [$tenantId]
            );
            $futureCarePool = round((float) ($row->total ?? 0), 1);
        }

        return [
            'member_retention_rate' => $retentionRate,
            'retained_members_count' => $retainedCount,
            'reciprocity_rate' => $reciprocityRate,
            'reciprocal_members_count' => $bothCount,
            'tandem_count' => $tandemCount,
            'coordinator_load_avg' => $coordinatorLoadAvg,
            'pending_reviews_total' => $pendingReviews,
            'coordinator_count' => $coordinatorCount,
            'future_care_credit_pool' => $futureCarePool,
            'active_members_total' => $members['active_members'],
        ];
    }

    private function verifiedHoursTotal(int $tenantId, array $range): float
    {
        $timebank = $this->timebankSummary($tenantId, $range);
        $volunteering = $this->volunteeringSummary($tenantId, $range);
        return $timebank['completed_hours'] + $volunteering['approved_hours'];
    }

    /**
     * @return array<int, true> Map of user IDs that participated in the period.
     */
    private function participantIds(int $tenantId, array $range): array
    {
        $ids = [];
        if (Schema::hasTable('vol_logs')) {
            foreach (DB::select(
                "SELECT DISTINCT user_id FROM vol_logs
                 WHERE tenant_id = ? AND status = 'approved' AND date_logged BETWEEN ? AND ?",
                [$tenantId, $range['from'], $range['to']]
            ) as $row) {
                if ($row->user_id) {
                    $ids[(int) $row->user_id] = true;
                }
            }
        }
        if (Schema::hasTable('transactions')) {
            foreach (DB::select(
                "SELECT DISTINCT sender_id, receiver_id FROM transactions
                 WHERE tenant_id = ? AND status = 'completed' AND transaction_type <> 'opening_balance' AND DATE(created_at) BETWEEN ? AND ?",
                [$tenantId, $range['from'], $range['to']]
            ) as $row) {
                if ($row->sender_id) {
                    $ids[(int) $row->sender_id] = true;
                }
                if ($row->receiver_id) {
                    $ids[(int) $row->receiver_id] = true;
                }
            }
        }
        return $ids;
    }

    private function sroiMethodology(array $hourConfig, bool $includeSocialValue): array
    {
        return [
            'formula' => [
                'verified_hours' => __('api.municipal_sroi_formula_verified_hours'),
                'direct_value' => __('api.municipal_sroi_formula_direct_value', [
                    'currency' => $hourConfig['currency'],
                    'hour_value' => $hourConfig['hour_value'],
                ]),
                'social_value' => $includeSocialValue
                    ? __('api.municipal_sroi_formula_social_value', ['multiplier' => $hourConfig['social_multiplier']])
                    : __('api.municipal_sroi_formula_social_value_disabled'),
                'total_value' => __('api.municipal_sroi_formula_total_value'),
            ],
            'inputs' => [
                [
                    'key' => 'approved_volunteer_hours',
                    'label' => __('api.municipal_sroi_input_approved_hours'),
                    'source_table' => 'vol_logs',
                    'filter' => 'status=approved',
                ],
                [
                    'key' => 'completed_timebank_hours',
                    'label' => __('api.municipal_sroi_input_timebank_hours'),
                    'source_table' => 'transactions',
                    'filter' => 'status=completed',
                ],
                [
                    'key' => 'hour_value',
                    'label' => __('api.municipal_sroi_input_hour_value'),
                    'source_table' => 'social_value_config',
                    'filter' => 'tenant scoped configuration',
                ],
                [
                    'key' => 'social_multiplier',
                    'label' => __('api.municipal_sroi_input_multiplier'),
                    'source_table' => 'social_value_config',
                    'filter' => 'tenant scoped configuration',
                ],
            ],
            'assumptions' => [
                __('api.municipal_sroi_assumption_verified_only'),
                __('api.municipal_sroi_assumption_no_cash_transfer'),
                __('api.municipal_sroi_assumption_multiplier_configurable'),
            ],
            'caveat' => __('api.municipal_sroi_caveat'),
        ];
    }

    public function exportData(int $tenantId, array $filters = []): array
    {
        $summary = $this->summary($tenantId, $filters);
        $stats = $summary['stats'];

        $rows = [
            ['Reporting Period', $summary['period']['from'] . ' to ' . $summary['period']['to'], 'Municipal/KISS reporting window'],
            ['Verified Hours', $stats['verified_hours'], 'Approved volunteer hours plus completed timebank transactions'],
            ['Volunteer Hours', $stats['volunteer_hours'], 'Approved volunteering logs'],
            ['Timebank Hours', $stats['timebank_hours'], 'Completed member-to-member transactions'],
            ['Pending Hours', $stats['pending_hours'], 'Volunteer logs awaiting coordinator review'],
            ['Active Members', $stats['active_members'], 'Approved members active in the reporting period'],
            ['New Members', $stats['new_members'], 'Approved members who joined in the reporting period'],
            ['Participating Members', $stats['participating_members'], 'Distinct members with verified hours or completed transactions'],
            ['Trusted Organisations', $stats['trusted_organisations'], 'Approved or active partner organisations'],
            ['Active Opportunities', $stats['active_opportunities'], 'Open volunteering opportunities'],
            ['Support Requests', $stats['support_requests'], 'Active request listings'],
            ['Support Offers', $stats['support_offers'], 'Active offer listings'],
            ['Direct Value', $stats['direct_value'], $summary['currency'] . ' value at ' . $summary['hour_value'] . ' per hour'],
            ['Social Value', $stats['social_value'], 'Direct value multiplied by ' . $summary['social_multiplier']],
            ['Total Value', $stats['total_value'], 'Direct plus social value'],
        ];

        foreach ($summary['categories'] as $category) {
            $rows[] = [
                'Support Category: ' . $category['name'],
                $category['hours'],
                $category['count'] . ' verified exchanges or logs',
            ];
        }

        foreach ($summary['trends'] as $trend) {
            $rows[] = [
                'Monthly Trend: ' . $trend['period'],
                $trend['verified_hours'],
                $trend['participants'] . ' participants, ' . $trend['activities'] . ' activities',
            ];
        }

        return [
            'headers' => ['Metric', 'Value', 'Notes'],
            'rows' => $rows,
        ];
    }

    private function reportContext(array $filters): array
    {
        $audience = (string) ($filters['audience'] ?? 'municipality');
        if (!in_array($audience, ['municipality', 'canton', 'cooperative', 'foundation'], true)) {
            $audience = 'municipality';
        }

        $sections = $filters['sections'] ?? ['summary', 'hours', 'members', 'organisations', 'categories', 'trends', 'trust'];
        if (is_string($sections)) {
            $decoded = json_decode($sections, true);
            $sections = is_array($decoded) ? $decoded : explode(',', $sections);
        }

        $sections = array_values(array_filter(array_map('strval', is_array($sections) ? $sections : [])));

        return [
            'audience' => $audience,
            'template_name' => isset($filters['template_name']) ? (string) $filters['template_name'] : null,
            'sections' => $sections === [] ? ['summary', 'hours', 'members', 'organisations', 'categories', 'trends', 'trust'] : $sections,
        ];
    }

    private function readinessSignals(float $verifiedHours, array $members, array $organisations, array $requests): array
    {
        return [
            [
                'key' => 'municipal_value',
                'status' => $verifiedHours > 0 ? 'ready' : 'needs_data',
                'value' => round($verifiedHours, 1),
            ],
            [
                'key' => 'participation',
                'status' => $members['participating_members'] > 0 ? 'ready' : 'needs_data',
                'value' => $members['participating_members'],
            ],
            [
                'key' => 'partner_network',
                'status' => $organisations['trusted_organisations'] > 0 ? 'ready' : 'needs_data',
                'value' => $organisations['trusted_organisations'],
            ],
            [
                'key' => 'local_exchange',
                'status' => ($requests['support_requests'] + $requests['support_offers']) > 0 ? 'ready' : 'needs_data',
                'value' => $requests['support_requests'] + $requests['support_offers'],
            ],
        ];
    }

    private function normaliseDateRange(array $filters, array $policy): array
    {
        $to = !empty($filters['date_to']) ? (string) $filters['date_to'] : date('Y-m-d');
        if (!empty($filters['date_from'])) {
            return ['from' => (string) $filters['date_from'], 'to' => $to];
        }

        $from = match ($policy['municipal_report_default_period'] ?? 'last_90_days') {
            'last_30_days' => date('Y-m-d', strtotime($to . ' -30 days')),
            'year_to_date' => date('Y-01-01', strtotime($to)),
            'previous_quarter' => $this->previousQuarterStart($to),
            default => date('Y-m-d', strtotime($to . ' -90 days')),
        };

        if (($policy['municipal_report_default_period'] ?? '') === 'previous_quarter') {
            $to = $this->previousQuarterEnd($to);
        }

        return ['from' => $from, 'to' => $to];
    }

    private function hourValueConfig(int $tenantId, array $policy): array
    {
        $config = Schema::hasTable('social_value_config')
            ? DB::table('social_value_config')->where('tenant_id', $tenantId)->first()
            : null;

        return [
            'hour_value' => (float) ($config->hour_value_amount ?? $policy['default_hour_value_chf'] ?? self::DEFAULT_HOUR_VALUE),
            'social_multiplier' => (float) ($config->social_multiplier ?? self::DEFAULT_SOCIAL_MULTIPLIER),
            'currency' => (string) ($config->hour_value_currency ?? self::DEFAULT_CURRENCY),
        ];
    }

    private function applyTemplateOverrides(array $policy, array $filters): array
    {
        if (!empty($filters['date_preset'])) {
            $policy['municipal_report_default_period'] = (string) $filters['date_preset'];
        }

        if (array_key_exists('include_social_value', $filters) && $filters['include_social_value'] !== null) {
            $policy['include_social_value_estimate'] = filter_var($filters['include_social_value'], FILTER_VALIDATE_BOOLEAN);
        }

        if (isset($filters['hour_value_chf']) && $filters['hour_value_chf'] !== '') {
            $policy['default_hour_value_chf'] = max(0, min(500, (int) $filters['hour_value_chf']));
        }

        return $policy;
    }

    private function previousQuarterStart(string $date): string
    {
        $timestamp = strtotime($date) ?: time();
        $quarter = (int) ceil((int) date('n', $timestamp) / 3);
        $previousQuarter = $quarter === 1 ? 4 : $quarter - 1;
        $year = (int) date('Y', $timestamp) - ($quarter === 1 ? 1 : 0);
        $month = (($previousQuarter - 1) * 3) + 1;

        return sprintf('%04d-%02d-01', $year, $month);
    }

    private function previousQuarterEnd(string $date): string
    {
        return date('Y-m-t', strtotime($this->previousQuarterStart($date) . ' +2 months'));
    }

    private function timebankSummary(int $tenantId, array $range): array
    {
        if (!Schema::hasTable('transactions')) {
            return ['completed_hours' => 0.0];
        }

        $row = DB::selectOne(
            "SELECT COALESCE(SUM(amount), 0) AS completed_hours
             FROM transactions
             WHERE tenant_id = ? AND status = 'completed' AND transaction_type <> 'opening_balance' AND DATE(created_at) BETWEEN ? AND ?",
            [$tenantId, $range['from'], $range['to']]
        );

        return ['completed_hours' => (float) ($row->completed_hours ?? 0)];
    }

    private function volunteeringSummary(int $tenantId, array $range): array
    {
        if (!Schema::hasTable('vol_logs')) {
            return ['approved_hours' => 0.0, 'pending_hours' => 0.0];
        }

        $row = DB::selectOne(
            "SELECT
                COALESCE(SUM(CASE WHEN status = 'approved' THEN hours ELSE 0 END), 0) AS approved_hours,
                COALESCE(SUM(CASE WHEN status = 'pending' THEN hours ELSE 0 END), 0) AS pending_hours
             FROM vol_logs
             WHERE tenant_id = ? AND date_logged BETWEEN ? AND ?",
            [$tenantId, $range['from'], $range['to']]
        );

        return [
            'approved_hours' => (float) ($row->approved_hours ?? 0),
            'pending_hours' => (float) ($row->pending_hours ?? 0),
        ];
    }

    private function memberSummary(int $tenantId, array $range): array
    {
        $activeMembers = (int) DB::selectOne(
            "SELECT COUNT(*) AS count
             FROM users
             WHERE tenant_id = ? AND is_approved = 1
                AND (last_active_at IS NULL OR DATE(last_active_at) BETWEEN ? AND ?)",
            [$tenantId, $range['from'], $range['to']]
        )->count;

        $newMembers = (int) DB::selectOne(
            "SELECT COUNT(*) AS count
             FROM users
             WHERE tenant_id = ? AND is_approved = 1 AND DATE(created_at) BETWEEN ? AND ?",
            [$tenantId, $range['from'], $range['to']]
        )->count;

        $participantIds = [];

        if (Schema::hasTable('vol_logs')) {
            $rows = DB::select(
                "SELECT DISTINCT user_id FROM vol_logs
                 WHERE tenant_id = ? AND status = 'approved' AND date_logged BETWEEN ? AND ?",
                [$tenantId, $range['from'], $range['to']]
            );
            foreach ($rows as $row) {
                $participantIds[(int) $row->user_id] = true;
            }
        }

        if (Schema::hasTable('transactions')) {
            $rows = DB::select(
                "SELECT DISTINCT sender_id, receiver_id FROM transactions
                 WHERE tenant_id = ? AND status = 'completed' AND transaction_type <> 'opening_balance' AND DATE(created_at) BETWEEN ? AND ?",
                [$tenantId, $range['from'], $range['to']]
            );
            foreach ($rows as $row) {
                if ($row->sender_id) {
                    $participantIds[(int) $row->sender_id] = true;
                }
                if ($row->receiver_id) {
                    $participantIds[(int) $row->receiver_id] = true;
                }
            }
        }

        return [
            'active_members' => $activeMembers,
            'new_members' => $newMembers,
            'participating_members' => count($participantIds),
        ];
    }

    private function organisationSummary(int $tenantId, array $range): array
    {
        $trustedOrganisations = 0;
        $activeOpportunities = 0;

        if (Schema::hasTable('vol_organizations')) {
            $trustedOrganisations = (int) DB::selectOne(
                "SELECT COUNT(*) AS count FROM vol_organizations
                 WHERE tenant_id = ? AND status IN ('approved', 'active')",
                [$tenantId]
            )->count;
        }

        if (Schema::hasTable('vol_opportunities')) {
            $activeOpportunities = (int) DB::selectOne(
                "SELECT COUNT(*) AS count FROM vol_opportunities
                 WHERE tenant_id = ? AND status IN ('active', 'published', 'open')
                    AND DATE(created_at) <= ?",
                [$tenantId, $range['to']]
            )->count;
        }

        return [
            'trusted_organisations' => $trustedOrganisations,
            'active_opportunities' => $activeOpportunities,
        ];
    }

    private function requestSummary(int $tenantId, array $range): array
    {
        if (!Schema::hasTable('listings')) {
            return ['support_requests' => 0, 'support_offers' => 0];
        }

        $row = DB::selectOne(
            "SELECT
                SUM(CASE WHEN type IN ('request', 'need') THEN 1 ELSE 0 END) AS support_requests,
                SUM(CASE WHEN type IN ('offer', 'service') THEN 1 ELSE 0 END) AS support_offers
             FROM listings
             WHERE tenant_id = ? AND status = 'active' AND DATE(created_at) <= ?",
            [$tenantId, $range['to']]
        );

        return [
            'support_requests' => (int) ($row->support_requests ?? 0),
            'support_offers' => (int) ($row->support_offers ?? 0),
        ];
    }

    private function supportCategories(int $tenantId, array $range): array
    {
        $rows = [];

        if (Schema::hasTable('transactions')) {
            $rows = DB::select(
                "SELECT COALESCE(c.name, 'Uncategorized') AS name,
                        COALESCE(SUM(t.amount), 0) AS hours,
                        COUNT(*) AS count
                 FROM transactions t
                 LEFT JOIN listings l ON l.id = t.listing_id AND l.tenant_id = t.tenant_id
                 LEFT JOIN categories c ON c.id = l.category_id AND c.tenant_id = t.tenant_id
                 WHERE t.tenant_id = ? AND t.status = 'completed' AND t.transaction_type <> 'opening_balance' AND DATE(t.created_at) BETWEEN ? AND ?
                 GROUP BY COALESCE(c.name, 'Uncategorized')
                 ORDER BY hours DESC
                 LIMIT 8",
                [$tenantId, $range['from'], $range['to']]
            );
        }

        return array_map(fn($row) => [
            'name' => (string) $row->name,
            'hours' => round((float) $row->hours, 1),
            'count' => (int) $row->count,
        ], $rows);
    }

    private function periodTrends(int $tenantId, array $range): array
    {
        $trendMap = [];

        if (Schema::hasTable('transactions')) {
            $rows = DB::select(
                "SELECT DATE_FORMAT(created_at, '%Y-%m') AS period,
                        COALESCE(SUM(amount), 0) AS hours,
                        COUNT(*) AS activities,
                        COUNT(DISTINCT sender_id) + COUNT(DISTINCT receiver_id) AS participants
                 FROM transactions
                 WHERE tenant_id = ? AND status = 'completed' AND transaction_type <> 'opening_balance' AND DATE(created_at) BETWEEN ? AND ?
                 GROUP BY DATE_FORMAT(created_at, '%Y-%m')",
                [$tenantId, $range['from'], $range['to']]
            );
            foreach ($rows as $row) {
                $trendMap[$row->period] = [
                    'period' => $row->period,
                    'verified_hours' => (float) $row->hours,
                    'activities' => (int) $row->activities,
                    'participants' => (int) $row->participants,
                ];
            }
        }

        if (Schema::hasTable('vol_logs')) {
            $rows = DB::select(
                "SELECT DATE_FORMAT(date_logged, '%Y-%m') AS period,
                        COALESCE(SUM(hours), 0) AS hours,
                        COUNT(*) AS activities,
                        COUNT(DISTINCT user_id) AS participants
                 FROM vol_logs
                 WHERE tenant_id = ? AND status = 'approved' AND date_logged BETWEEN ? AND ?
                 GROUP BY DATE_FORMAT(date_logged, '%Y-%m')",
                [$tenantId, $range['from'], $range['to']]
            );
            foreach ($rows as $row) {
                $period = $row->period;
                $trendMap[$period] ??= [
                    'period' => $period,
                    'verified_hours' => 0.0,
                    'activities' => 0,
                    'participants' => 0,
                ];
                $trendMap[$period]['verified_hours'] += (float) $row->hours;
                $trendMap[$period]['activities'] += (int) $row->activities;
                $trendMap[$period]['participants'] += (int) $row->participants;
            }
        }

        ksort($trendMap);

        return array_map(fn($row) => [
            'period' => $row['period'],
            'verified_hours' => round((float) $row['verified_hours'], 1),
            'activities' => (int) $row['activities'],
            'participants' => (int) $row['participants'],
        ], array_values($trendMap));
    }
}
