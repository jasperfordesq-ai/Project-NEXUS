<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\CaringCommunity;

use App\Support\Wallet\OpeningBalance;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * NationalKissDashboardService.
 *
 * Cross-tenant aggregation service powering the National KISS Foundation
 * dashboard. This is one of a small handful of services that BYPASSES the
 * normal `TenantContext::getId()` scoping rule on purpose — the whole point
 * of the dashboard is to compare and roll up data across all KISS
 * cooperative tenants.
 *
 * Privacy guarantees:
 *
 *  - Member counts are bucketed (never raw integers). The methods never
 *    return individual member identifiers, emails, names, or PII.
 *  - Returned cooperative rows include slug + name + bucket only.
 *  - Cross-tenant queries are scoped to tenants flagged
 *    `tenant_category = 'kiss_cooperative'` AND `is_active = 1`.
 *
 * Caller must hold the `national.kiss_dashboard.view` permission. Authorization
 * is enforced at the controller layer; this service trusts its caller.
 */
class NationalKissDashboardService
{
    private const CACHE_TTL_SECONDS = 3600;

    /**
     * Returns all tenants flagged as KISS cooperatives.
     *
     * BYPASSES tenant scoping intentionally: this is a cross-tenant lookup.
     * Result is cached for 1h. Member counts are bucketed for privacy.
     *
     * @return array<int, array{tenant_id:int, slug:string, name:string, locale:?string, member_count_bracket:string}>
     */
    public function listCooperatives(): array
    {
        return Cache::remember('national_kiss.cooperatives', self::CACHE_TTL_SECONDS, function (): array {
            if (! Schema::hasColumn('tenants', 'tenant_category')) {
                return [];
            }

            $rows = DB::select(
                "SELECT t.id, t.slug, t.name, t.configuration
                 FROM tenants t
                 WHERE t.tenant_category = 'kiss_cooperative'
                   AND t.is_active = 1
                 ORDER BY t.name ASC"
            );

            $out = [];
            foreach ($rows as $row) {
                $tenantId = (int) $row->id;
                $config = $this->decodeJson($row->configuration ?? null);
                $locale = is_array($config) ? ($config['default_locale'] ?? $config['locale'] ?? null) : null;

                $memberCount = $this->memberCount($tenantId);

                $out[] = [
                    'tenant_id' => $tenantId,
                    'slug' => (string) $row->slug,
                    'name' => (string) $row->name,
                    'locale' => $locale ? (string) $locale : null,
                    'member_count_bracket' => $this->bucketMembers($memberCount),
                ];
            }

            return $out;
        });
    }

    /**
     * Aggregate national metrics for the period.
     *
     * BYPASSES tenant scoping: iterates over every cooperative tenant, runs
     * the same scoped query that the per-tenant municipal report would, and
     * sums the results. Cached for 1h keyed by period.
     *
     * @return array<string, mixed>
     */
    public function nationalSummary(string $periodFrom, string $periodTo): array
    {
        $range = $this->normaliseRange($periodFrom, $periodTo);
        $cacheKey = sprintf('national_kiss.summary.%s.%s', $range['from'], $range['to']);

        return Cache::remember($cacheKey, self::CACHE_TTL_SECONDS, function () use ($range): array {
            $cooperatives = $this->listCooperatives();
            $cooperativesCount = count($cooperatives);

            $perCoop = [];
            $totalApprovedHours = 0.0;
            $totalActiveTandems = 0;
            $totalSafeguardingReports = 0;
            $totalRecipientsRaw = 0;
            $totalActiveMembersRaw = 0;
            $activeCoopsCount = 0;

            // Prior-year same period for YoY growth.
            $priorRange = [
                'from' => date('Y-m-d', strtotime($range['from'] . ' -1 year')),
                'to'   => date('Y-m-d', strtotime($range['to'] . ' -1 year')),
            ];
            $totalPriorHours = 0.0;

            foreach ($cooperatives as $coop) {
                $tid = $coop['tenant_id'];
                $hours = $this->approvedHoursForTenant($tid, $range);
                $priorHours = $this->approvedHoursForTenant($tid, $priorRange);
                $tandems = $this->activeTandemCount($tid, $range);
                $reports = $this->safeguardingReports($tid, $range);
                $recipients = $this->distinctRecipients($tid, $range);
                $activeMembers = $this->activeMemberCount($tid, $range);

                if ($hours > 0) {
                    $activeCoopsCount++;
                }

                $perCoop[] = [
                    'tenant_id' => $tid,
                    'slug' => $coop['slug'],
                    'name' => $coop['name'],
                    'hours' => round($hours, 1),
                ];

                $totalApprovedHours += $hours;
                $totalPriorHours += $priorHours;
                $totalActiveTandems += $tandems;
                $totalSafeguardingReports += $reports;
                $totalRecipientsRaw += $recipients;
                $totalActiveMembersRaw += $activeMembers;
            }

            // Top / bottom 5 by hours (bottom 5 = active only — exclude zero-hour coops).
            usort($perCoop, fn ($a, $b) => $b['hours'] <=> $a['hours']);
            $top5 = array_slice($perCoop, 0, 5);

            $activeCoops = array_values(array_filter($perCoop, fn ($c) => $c['hours'] > 0));
            usort($activeCoops, fn ($a, $b) => $a['hours'] <=> $b['hours']);
            $bottom5 = array_slice($activeCoops, 0, 5);

            $yoyGrowth = $totalPriorHours > 0
                ? round((($totalApprovedHours - $totalPriorHours) / $totalPriorHours) * 100, 1)
                : null;

            return [
                'cooperatives_count' => $cooperativesCount,
                'active_cooperatives_count' => $activeCoopsCount,
                'total_approved_hours_national' => round($totalApprovedHours, 1),
                'total_active_members_bucket' => $this->bucketMembers($totalActiveMembersRaw),
                'total_recipients_reached_bucket' => $this->bucketMembers($totalRecipientsRaw),
                'top_5_cooperatives_by_hours' => $top5,
                'bottom_5_active_cooperatives_by_hours' => $bottom5,
                'hours_growth_yoy_pct' => $yoyGrowth,
                'active_tandems_total' => $totalActiveTandems,
                'safeguarding_reports_total' => $totalSafeguardingReports,
                'generated_at' => date('c'),
                'period' => $range,
            ];
        });
    }

    /**
     * Per-cooperative comparative table.
     *
     * BYPASSES tenant scoping: same per-tenant queries the municipal report
     * uses, repeated for every cooperative tenant. Cached 1h.
     *
     * @return array<int, array{tenant_id:int, slug:string, name:string, hours:float, members_bracket:string, recipients_bracket:string, active_tandems:int, retention_rate_pct:float, reciprocity_pct:float, status:string}>
     */
    public function comparativeMetrics(string $periodFrom, string $periodTo): array
    {
        $range = $this->normaliseRange($periodFrom, $periodTo);
        $cacheKey = sprintf('national_kiss.compare.%s.%s', $range['from'], $range['to']);

        return Cache::remember($cacheKey, self::CACHE_TTL_SECONDS, function () use ($range): array {
            $cooperatives = $this->listCooperatives();

            // Prior period (same length, immediately before) for retention.
            $periodLengthDays = max(1, (int) ((strtotime($range['to']) - strtotime($range['from'])) / 86400));
            $priorRange = [
                'from' => date('Y-m-d', strtotime($range['from'] . ' -' . $periodLengthDays . ' days')),
                'to'   => date('Y-m-d', strtotime($range['from'] . ' -1 day')),
            ];
            $priorYearRange = [
                'from' => date('Y-m-d', strtotime($range['from'] . ' -1 year')),
                'to'   => date('Y-m-d', strtotime($range['to'] . ' -1 year')),
            ];

            $rows = [];
            foreach ($cooperatives as $coop) {
                $tid = $coop['tenant_id'];

                $hours = $this->approvedHoursForTenant($tid, $range);
                $priorYearHours = $this->approvedHoursForTenant($tid, $priorYearRange);
                $hoursGrowthPct = $priorYearHours > 0
                    ? (($hours - $priorYearHours) / $priorYearHours) * 100
                    : 0.0;

                $activeMembers = $this->activeMemberCount($tid, $range);
                $recipients = $this->distinctRecipients($tid, $range);
                $tandems = $this->activeTandemCount($tid, $range);

                $current = $this->participantIds($tid, $range);
                $prior = $this->participantIds($tid, $priorRange);
                $retained = count(array_intersect_key($current, $prior));
                $retention = count($prior) > 0 ? ($retained / count($prior)) * 100 : 0.0;

                $reciprocity = $this->reciprocityRate($tid, $range);

                $status = $this->classifyStatus($hoursGrowthPct, $retention);

                $rows[] = [
                    'tenant_id' => $tid,
                    'slug' => $coop['slug'],
                    'name' => $coop['name'],
                    'hours' => round($hours, 1),
                    'members_bracket' => $this->bucketMembers($activeMembers),
                    'recipients_bracket' => $this->bucketMembers($recipients),
                    'active_tandems' => $tandems,
                    'retention_rate_pct' => round($retention, 1),
                    'reciprocity_pct' => round($reciprocity * 100, 1),
                    'status' => $status,
                ];
            }

            return $rows;
        });
    }

    /**
     * National monthly trend for the past 12 months.
     *
     * BYPASSES tenant scoping: computes a single aggregate across all KISS
     * cooperative tenants per month. Cached 1h.
     *
     * @return array<int, array{month:string, total_hours_all_cooperatives:float, active_cooperatives:int}>
     */
    public function nationalTrend(): array
    {
        return Cache::remember('national_kiss.trend.12mo', self::CACHE_TTL_SECONDS, function (): array {
            $cooperatives = $this->listCooperatives();
            $months = [];

            for ($i = 11; $i >= 0; $i--) {
                $monthStart = date('Y-m-01', strtotime("-{$i} months"));
                $monthEnd = date('Y-m-t', strtotime($monthStart));
                $monthRange = ['from' => $monthStart, 'to' => $monthEnd];

                $totalHours = 0.0;
                $activeCount = 0;
                foreach ($cooperatives as $coop) {
                    $tid = $coop['tenant_id'];
                    $h = $this->approvedHoursForTenant($tid, $monthRange);
                    $totalHours += $h;
                    if ($h > 0) {
                        $activeCount++;
                    }
                }

                $months[] = [
                    'month' => substr($monthStart, 0, 7),
                    'total_hours_all_cooperatives' => round($totalHours, 1),
                    'active_cooperatives' => $activeCount,
                ];
            }

            return $months;
        });
    }

    // ─────────────────────────────────────────────────────────────────────
    // Internal — per-tenant queries (each scoped by tenant_id explicitly).
    // ─────────────────────────────────────────────────────────────────────

    private function approvedHoursForTenant(int $tenantId, array $range): float
    {
        $total = 0.0;

        if (Schema::hasTable('vol_logs')) {
            $row = DB::selectOne(
                "SELECT COALESCE(SUM(hours), 0) AS h
                 FROM vol_logs
                 WHERE tenant_id = ?
                   AND status = 'approved'
                   AND date_logged BETWEEN ? AND ?",
                [$tenantId, $range['from'], $range['to']]
            );
            $total += (float) ($row->h ?? 0);
        }

        if (Schema::hasTable('transactions')) {
            // Opening balances (hours a member brought from another timebank
            // through an admin member import) were not given here.
            $row = DB::selectOne(
                "SELECT COALESCE(SUM(amount), 0) AS h
                 FROM transactions
                 WHERE tenant_id = ?
                   AND status = 'completed'
                   AND transaction_type <> ?
                   AND DATE(created_at) BETWEEN ? AND ?",
                [$tenantId, OpeningBalance::TYPE, $range['from'], $range['to']]
            );
            $total += (float) ($row->h ?? 0);
        }

        return $total;
    }

    private function activeTandemCount(int $tenantId, array $range): int
    {
        if (! Schema::hasTable('caring_support_relationships')) {
            return 0;
        }

        // Active tandems: relationships not cancelled/completed before period start.
        $row = DB::selectOne(
            "SELECT COUNT(*) AS c
             FROM caring_support_relationships
             WHERE tenant_id = ?
               AND status IN ('active', 'paused')
               AND start_date <= ?
               AND (end_date IS NULL OR end_date >= ?)",
            [$tenantId, $range['to'], $range['from']]
        );

        return (int) ($row->c ?? 0);
    }

    private function safeguardingReports(int $tenantId, array $range): int
    {
        // Many tenants don't have safeguarding reports populated yet — soft check.
        if (! Schema::hasTable('reports')) {
            return 0;
        }
        if (! Schema::hasColumn('reports', 'tenant_id')) {
            return 0;
        }

        $row = DB::selectOne(
            "SELECT COUNT(*) AS c
             FROM reports
             WHERE tenant_id = ?
               AND DATE(created_at) BETWEEN ? AND ?",
            [$tenantId, $range['from'], $range['to']]
        );

        return (int) ($row->c ?? 0);
    }

    private function distinctRecipients(int $tenantId, array $range): int
    {
        if (! Schema::hasTable('transactions')) {
            return 0;
        }

        $row = DB::selectOne(
            "SELECT COUNT(DISTINCT receiver_id) AS c
             FROM transactions
             WHERE tenant_id = ?
               AND status = 'completed'
               AND DATE(created_at) BETWEEN ? AND ?",
            [$tenantId, $range['from'], $range['to']]
        );

        return (int) ($row->c ?? 0);
    }

    private function activeMemberCount(int $tenantId, array $range): int
    {
        return count($this->participantIds($tenantId, $range));
    }

    private function memberCount(int $tenantId): int
    {
        if (! Schema::hasTable('users')) {
            return 0;
        }

        $row = DB::selectOne(
            "SELECT COUNT(*) AS c
             FROM users
             WHERE tenant_id = ?
               AND status = 'active'",
            [$tenantId]
        );

        return (int) ($row->c ?? 0);
    }

    /**
     * @return array<int, true>
     */
    private function participantIds(int $tenantId, array $range): array
    {
        $ids = [];

        if (Schema::hasTable('vol_logs')) {
            foreach (DB::select(
                "SELECT DISTINCT user_id FROM vol_logs
                 WHERE tenant_id = ? AND status = 'approved'
                   AND date_logged BETWEEN ? AND ?",
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
                 WHERE tenant_id = ? AND status = 'completed'
                   AND DATE(created_at) BETWEEN ? AND ?",
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

    private function reciprocityRate(int $tenantId, array $range): float
    {
        if (! Schema::hasTable('transactions')) {
            return 0.0;
        }

        $supporters = [];
        $receivers = [];

        foreach (DB::select(
            "SELECT DISTINCT sender_id, receiver_id FROM transactions
             WHERE tenant_id = ? AND status = 'completed'
               AND DATE(created_at) BETWEEN ? AND ?",
            [$tenantId, $range['from'], $range['to']]
        ) as $row) {
            if ($row->sender_id) {
                $supporters[(int) $row->sender_id] = true;
            }
            if ($row->receiver_id) {
                $receivers[(int) $row->receiver_id] = true;
            }
        }

        if (count($supporters) === 0) {
            return 0.0;
        }

        $both = count(array_intersect_key($supporters, $receivers));

        return $both / count($supporters);
    }

    /**
     * Classify a cooperative's status given hours growth and retention.
     *
     *   thriving  := hours_growth_pct  >=  10  AND retention_pct >= 80
     *   struggling:= hours_growth_pct  <  -10  OR  retention_pct <  50
     *   stable    := otherwise
     */
    private function classifyStatus(float $hoursGrowthPct, float $retentionPct): string
    {
        if ($hoursGrowthPct < -10.0 || $retentionPct < 50.0) {
            return 'struggling';
        }
        if ($hoursGrowthPct >= 10.0 && $retentionPct >= 80.0) {
            return 'thriving';
        }
        return 'stable';
    }

    /**
     * Bucket a raw count into a privacy-preserving bracket label.
     */
    private function bucketMembers(int $count): string
    {
        return match (true) {
            $count <= 0 => '0',
            $count < 10 => '1-9',
            $count < 25 => '10-24',
            $count < 50 => '25-49',
            $count < 100 => '50-99',
            $count < 250 => '100-249',
            $count < 500 => '250-499',
            $count < 1000 => '500-999',
            $count < 2500 => '1000-2499',
            $count < 5000 => '2500-4999',
            default => '5000+',
        };
    }

    /**
     * @return array{from:string, to:string}
     */
    private function normaliseRange(string $from, string $to): array
    {
        $fromTs = strtotime($from);
        $toTs = strtotime($to);

        if (! $fromTs || ! $toTs) {
            $toTs = time();
            $fromTs = strtotime('-90 days', $toTs);
        }

        if ($fromTs > $toTs) {
            [$fromTs, $toTs] = [$toTs, $fromTs];
        }

        return [
            'from' => date('Y-m-d', $fromTs),
            'to'   => date('Y-m-d', $toTs),
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function decodeJson(?string $raw): ?array
    {
        if ($raw === null || $raw === '') {
            return null;
        }
        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : null;
    }
}
