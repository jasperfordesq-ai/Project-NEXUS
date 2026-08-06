<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use Illuminate\Support\Facades\DB;

/**
 * Reads the performance samples for /admin/performance.
 *
 * The returned array is the contract the React page reads directly — key names
 * here ARE the key names in PerformanceDashboard.tsx. Changing one without the
 * other puts the page back in the state that started this work, so the shape is
 * pinned by PerformanceSummaryContractTest.
 *
 * Everything is scoped by tenant. Requests that arrived with no tenant resolved
 * are stored under tenant 0 and are therefore invisible here, which is correct:
 * a community admin should not see platform-level traffic.
 */
final class PerformanceInsightsService
{
    /**
     * @return array{
     *     slowest_requests: list<array<string,mixed>>,
     *     slowest_queries: list<array<string,mixed>>,
     *     memory_spikes: list<array<string,mixed>>,
     *     request_volume: array<string,int>,
     *     n_plus_one_warnings: int,
     *     total_requests: int,
     *     total_slow_queries: int,
     *     window_hours: int
     * }
     */
    public function summary(int $tenantId, int $hours): array
    {
        $maxHours = max(1, (int) config('performance.limits.max_window_hours', 720));
        $hours = max(1, min($hours, $maxHours));
        $since = now()->subHours($hours);
        $rows = max(1, (int) config('performance.limits.summary_rows', 20));
        $memorySpikeMb = (float) config('performance.thresholds.memory_spike_mb', 96);

        return [
            'slowest_requests' => $this->slowestRequests($tenantId, $since, $rows),
            'slowest_queries' => $this->slowestQueries($tenantId, $since, $rows),
            'memory_spikes' => $this->memorySpikes($tenantId, $since, $rows, $memorySpikeMb),
            'request_volume' => $this->requestVolume($tenantId, $since),
            'n_plus_one_warnings' => $this->nPlusOneWarnings($tenantId, $since),
            'total_requests' => $this->totalRequests($tenantId, $since),
            'total_slow_queries' => $this->totalSlowQueries($tenantId, $since),
            'window_hours' => $hours,
        ];
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function slowestRequests(int $tenantId, \DateTimeInterface $since, int $limit): array
    {
        $records = DB::table('performance_request_samples')
            ->where('tenant_id', $tenantId)
            ->where('created_at', '>=', $since)
            ->orderByDesc('duration_ms')
            ->limit($limit)
            ->get();

        $out = [];

        foreach ($records as $record) {
            $out[] = [
                'timestamp' => (string) $record->created_at,
                'endpoint' => (string) $record->endpoint,
                'method' => (string) $record->method,
                'duration_ms' => (float) $record->duration_ms,
                'query_count' => (int) $record->query_count,
                'memory_mb' => (float) $record->memory_mb,
                'status_code' => $record->status_code === null ? null : (int) $record->status_code,
                'warnings' => $this->warningsFor($record),
            ];
        }

        return $out;
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function slowestQueries(int $tenantId, \DateTimeInterface $since, int $limit): array
    {
        $records = DB::table('performance_query_samples')
            ->where('tenant_id', $tenantId)
            ->where('created_at', '>=', $since)
            ->orderByDesc('duration_ms')
            ->limit($limit)
            ->get();

        $out = [];

        foreach ($records as $record) {
            $caller = null;

            if ($record->caller_file !== null || $record->caller_class !== null) {
                $caller = [
                    'class' => (string) ($record->caller_class ?? ''),
                    'function' => (string) ($record->caller_function ?? ''),
                    'file' => (string) ($record->caller_file ?? ''),
                    'line' => (int) ($record->caller_line ?? 0),
                ];
            }

            $out[] = [
                'timestamp' => (string) $record->created_at,
                'duration_ms' => (float) $record->duration_ms,
                // Placeholder form as executed — never the bound values.
                'sql' => (string) $record->sql_text,
                'caller' => $caller,
            ];
        }

        return $out;
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function memorySpikes(int $tenantId, \DateTimeInterface $since, int $limit, float $thresholdMb): array
    {
        $records = DB::table('performance_request_samples')
            ->where('tenant_id', $tenantId)
            ->where('created_at', '>=', $since)
            ->where('peak_memory_mb', '>=', $thresholdMb)
            ->orderByDesc('peak_memory_mb')
            ->limit($limit)
            ->get();

        $out = [];

        foreach ($records as $record) {
            $out[] = [
                'timestamp' => (string) $record->created_at,
                'endpoint' => (string) $record->endpoint,
                'memory_mb' => (float) $record->memory_mb,
                'peak_memory_mb' => (float) $record->peak_memory_mb,
            ];
        }

        return $out;
    }

    /**
     * Hour bucket => request count. Comes from the counter table, so it is a
     * true count of every request, not an extrapolation from stored samples.
     *
     * @return array<string,int>
     */
    private function requestVolume(int $tenantId, \DateTimeInterface $since): array
    {
        $records = DB::table('performance_request_hourly')
            ->where('tenant_id', $tenantId)
            ->where('bucket_hour', '>=', $since)
            ->orderBy('bucket_hour')
            ->get();

        $volume = [];

        foreach ($records as $record) {
            $bucket = substr((string) $record->bucket_hour, 0, 13);
            $volume[$bucket] = (int) $record->request_count;
        }

        return $volume;
    }

    private function nPlusOneWarnings(int $tenantId, \DateTimeInterface $since): int
    {
        return (int) DB::table('performance_request_samples')
            ->where('tenant_id', $tenantId)
            ->where('created_at', '>=', $since)
            ->where('n_plus_one_count', '>', 0)
            ->count();
    }

    private function totalRequests(int $tenantId, \DateTimeInterface $since): int
    {
        return (int) DB::table('performance_request_hourly')
            ->where('tenant_id', $tenantId)
            ->where('bucket_hour', '>=', $since)
            ->sum('request_count');
    }

    private function totalSlowQueries(int $tenantId, \DateTimeInterface $since): int
    {
        return (int) DB::table('performance_query_samples')
            ->where('tenant_id', $tenantId)
            ->where('created_at', '>=', $since)
            ->count();
    }

    /**
     * Derived from the row's own numbers rather than stored, so changing a
     * threshold re-labels history instead of leaving stale labels behind.
     *
     * @return list<string>
     */
    private function warningsFor(object $record): array
    {
        $thresholds = (array) config('performance.thresholds', []);
        $warnings = [];

        if ((float) $record->duration_ms >= (float) ($thresholds['slow_request_ms'] ?? 1000)) {
            $warnings[] = 'slow_request';
        }
        if ((float) $record->peak_memory_mb >= (float) ($thresholds['memory_spike_mb'] ?? 96)) {
            $warnings[] = 'high_memory';
        }
        if ((int) $record->n_plus_one_count > 0) {
            $warnings[] = 'n_plus_one';
        }
        if ((int) $record->query_count >= (int) ($thresholds['many_queries'] ?? 50)) {
            $warnings[] = 'many_queries';
        }

        return $warnings;
    }
}
