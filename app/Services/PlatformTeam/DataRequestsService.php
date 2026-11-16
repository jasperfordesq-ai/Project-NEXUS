<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\PlatformTeam;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Platform team panel → Data requests.
 *
 * Per community: how many data requests (`gdpr_requests`) are open (pending
 * or processing), in total and by kind; how many are overdue (open for more
 * than 30 days); how many are nearly due (open 25 to 30 days); how many days
 * the oldest open one has waited; how many were completed in the last 90 days.
 *
 * The rules are the existing ones, not new ones:
 *   - the 30-day rule and its clock, `COALESCE(requested_at, created_at)`, are
 *     App\Services\Enterprise\GdprService::complianceScore()'s (getStatistics()
 *     uses the same 30 days on `requested_at` alone; the fallback only matters
 *     for a row whose `requested_at` is NULL);
 *   - the 25-day warning is App\Console\Commands\OverdueGdprRequestCheck's
 *     default `--days`.
 * GdprService itself is not called: it is bound to one community.
 *
 * "Completed in the last 90 days" is dated by `processed_at`, which is what
 * GdprService stamps on completion, and nothing else: `updated_at` moves
 * whenever the row is touched, so it cannot date a completion. A completed
 * row with no `processed_at` is counted on its own, platform-wide, as
 * `totals.completed_without_date`.
 *
 * 🔴 Cross-community on purpose: no `tenant_id` filter, because the question
 * is "is any community leaving data requests unanswered". Correct only because
 * nothing below the platform team can call it. Counts only: every query below
 * selects `tenant_id`, `request_type` and aggregates, never a request's id, its
 * member, `verification_token`, `export_file_path`, `metadata`, `notes` or
 * `rejection_reason`.
 *
 * One grouped query per figure across every community, never one per
 * community. A figure that cannot be read is null in every row and named in
 * `unavailable` (logged at error), never shown as zero.
 */
final class DataRequestsService
{
    public const OVERDUE_AFTER_DAYS = 30;

    public const NEARLY_DUE_FROM_DAYS = 25;

    public const COMPLETED_WINDOW_DAYS = 90;

    /** The `request_type` enum, in the order the page shows it. */
    public const REQUEST_TYPES = ['access', 'erasure', 'rectification', 'restriction', 'portability', 'objection'];

    private const OPEN_STATUSES = ['pending', 'processing'];

    private const CLOCK = 'COALESCE(requested_at, created_at)';

    /**
     * @return array{
     *   overdue_after_days: int,
     *   nearly_due_from_days: int,
     *   completed_window_days: int,
     *   request_types: list<string>,
     *   unavailable: list<string>,
     *   totals: array<string, mixed>,
     *   communities: list<array<string, mixed>>
     * }
     */
    public function overview(): array
    {
        $now = Carbon::now();
        $overdueBefore = $now->copy()->subDays(self::OVERDUE_AFTER_DAYS);
        $nearlyDueBefore = $now->copy()->subDays(self::NEARLY_DUE_FROM_DAYS);
        $completedSince = $now->copy()->subDays(self::COMPLETED_WINDOW_DAYS);

        $unavailable = [];
        $figure = static function (string $name, callable $read) use (&$unavailable): ?array {
            try {
                return $read();
            } catch (\Throwable $e) {
                Log::error('Platform team data requests: a figure could not be read', [
                    'figure' => $name,
                    'exception' => $e::class,
                    'message' => $e->getMessage(),
                ]);
                $unavailable[] = $name;

                return null;
            }
        };

        $openByType = $figure('open', function (): array {
            $out = [];
            $rows = $this->open()
                ->groupBy('tenant_id', 'request_type')
                ->get(['tenant_id', 'request_type', DB::raw('COUNT(*) as cnt')]);
            foreach ($rows as $row) {
                $out[(int) $row->tenant_id][(string) $row->request_type] = (int) $row->cnt;
            }

            return $out;
        });
        $overdue = $figure('overdue', fn (): array => $this->countByCommunity(
            $this->open()->whereRaw(self::CLOCK . ' < ?', [$overdueBefore])
        ));
        $nearlyDue = $figure('nearly_due', fn (): array => $this->countByCommunity(
            $this->open()
                ->whereRaw(self::CLOCK . ' >= ?', [$overdueBefore])
                ->whereRaw(self::CLOCK . ' < ?', [$nearlyDueBefore])
        ));
        $oldest = $figure('oldest_open_days', function () use ($now): array {
            $out = [];
            $rows = $this->open()
                ->whereRaw(self::CLOCK . ' IS NOT NULL')
                ->groupBy('tenant_id')
                ->get(['tenant_id', DB::raw('MIN(' . self::CLOCK . ') as oldest')]);
            foreach ($rows as $row) {
                $out[(int) $row->tenant_id] = max(0, (int) floor(Carbon::parse((string) $row->oldest)->diffInDays($now, true)));
            }

            return $out;
        });
        $completed = $figure('completed_last_90_days', fn (): array => $this->countByCommunity(
            DB::table('gdpr_requests')
                ->where('status', 'completed')
                ->where('processed_at', '>=', $completedSince)
        ));
        // Completed with no completion date: not dated by `updated_at`, which
        // moves whenever the row is touched. One platform-wide count.
        $withoutDate = $figure('completed_without_date', fn (): array => [
            'n' => (int) DB::table('gdpr_requests')
                ->where('status', 'completed')
                ->whereNull('processed_at')
                ->count(),
        ]);

        $communities = [];
        foreach (DB::table('tenants')->orderBy('name')->orderBy('id')->get(['id', 'name', 'slug', 'is_active']) as $tenant) {
            $id = (int) $tenant->id;
            $byType = null;
            if ($openByType !== null) {
                $byType = [];
                foreach (self::REQUEST_TYPES as $type) {
                    $byType[$type] = $openByType[$id][$type] ?? 0;
                }
            }

            $communities[] = [
                'id' => $id,
                'name' => (string) $tenant->name,
                'slug' => $tenant->slug !== null ? (string) $tenant->slug : null,
                'is_active' => !empty($tenant->is_active),
                // An open request of a kind outside the enum cannot exist (the column
                // is an enum), so the total is the sum of the kinds.
                'open' => $byType === null ? null : array_sum($byType),
                'open_by_type' => $byType,
                'overdue' => $overdue === null ? null : ($overdue[$id] ?? 0),
                'nearly_due' => $nearlyDue === null ? null : ($nearlyDue[$id] ?? 0),
                // Null both when nothing is open and when it cannot be read; the
                // page tells the two apart through `open` and `unavailable`.
                'oldest_open_days' => $oldest === null ? null : ($oldest[$id] ?? null),
                'completed_last_90_days' => $completed === null ? null : ($completed[$id] ?? 0),
            ];
        }

        return [
            'overdue_after_days' => self::OVERDUE_AFTER_DAYS,
            'nearly_due_from_days' => self::NEARLY_DUE_FROM_DAYS,
            'completed_window_days' => self::COMPLETED_WINDOW_DAYS,
            'request_types' => self::REQUEST_TYPES,
            'unavailable' => $unavailable,
            'totals' => self::totals($communities, $unavailable) + [
                'completed_without_date' => $withoutDate === null ? null : $withoutDate['n'],
            ],
            'communities' => $communities,
        ];
    }

    /**
     * @param list<array<string, mixed>> $communities
     * @param list<string> $unavailable
     * @return array<string, mixed>
     */
    private static function totals(array $communities, array $unavailable): array
    {
        $sum = static function (string $key) use ($communities, $unavailable): ?int {
            return in_array($key, $unavailable, true)
                ? null
                : array_sum(array_map(static fn (array $row): int => (int) $row[$key], $communities));
        };

        $byType = null;
        if (!in_array('open', $unavailable, true)) {
            $byType = [];
            foreach (self::REQUEST_TYPES as $type) {
                $byType[$type] = array_sum(array_map(static fn (array $row): int => (int) $row['open_by_type'][$type], $communities));
            }
        }

        $oldest = null;
        if (!in_array('oldest_open_days', $unavailable, true)) {
            $ages = array_filter(array_column($communities, 'oldest_open_days'), static fn ($v): bool => $v !== null);
            $oldest = $ages === [] ? null : max($ages);
        }

        return [
            'communities' => count($communities),
            'open' => $sum('open'),
            'open_by_type' => $byType,
            'overdue' => $sum('overdue'),
            'nearly_due' => $sum('nearly_due'),
            'oldest_open_days' => $oldest,
            'completed_last_90_days' => $sum('completed_last_90_days'),
        ];
    }

    /** Open = pending or processing, as GdprService::getStatistics() counts it. */
    private function open(): Builder
    {
        return DB::table('gdpr_requests')->whereIn('status', self::OPEN_STATUSES);
    }

    /** @return array<int, int> community id => count */
    private function countByCommunity(Builder $query): array
    {
        $out = [];
        foreach ($query->groupBy('tenant_id')->get(['tenant_id', DB::raw('COUNT(*) as cnt')]) as $row) {
            $out[(int) $row->tenant_id] = (int) $row->cnt;
        }

        return $out;
    }
}
