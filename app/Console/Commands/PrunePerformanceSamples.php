<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * Delete performance samples past their retention window.
 *
 * Without this the diagnostics tables grow for ever. Detail rows expire sooner
 * than the hourly counters, because the counters are one tiny row per tenant per
 * hour and they are what the volume chart draws from — keeping three months of
 * those costs almost nothing, while three months of request detail would not.
 *
 * Deletes in bounded batches so a first run on a long-neglected table cannot
 * hold a large transaction open against live traffic.
 */
final class PrunePerformanceSamples extends Command
{
    protected $signature = 'performance:prune
        {--batch=5000 : Rows deleted per statement}
        {--dry-run : Report what would be deleted without deleting it}';

    protected $description = 'Delete performance samples older than the configured retention window';

    public function handle(): int
    {
        $batch = max(100, (int) $this->option('batch'));
        $dryRun = (bool) $this->option('dry-run');

        $detailCutoff = now()->subDays(max(1, (int) config('performance.retention_days', 14)));
        $hourlyCutoff = now()->subDays(max(1, (int) config('performance.hourly_retention_days', 90)));

        $targets = [
            ['table' => 'performance_query_samples', 'column' => 'created_at', 'cutoff' => $detailCutoff],
            ['table' => 'performance_request_samples', 'column' => 'created_at', 'cutoff' => $detailCutoff],
            ['table' => 'performance_request_hourly', 'column' => 'bucket_hour', 'cutoff' => $hourlyCutoff],
        ];

        $totals = [];

        foreach ($targets as $target) {
            $table = (string) $target['table'];

            if (! Schema::hasTable($table)) {
                $this->warn("SKIP {$table} — table not present");
                continue;
            }

            $deleted = $dryRun
                ? (int) DB::table($table)->where($target['column'], '<', $target['cutoff'])->count()
                : $this->deleteInBatches($table, (string) $target['column'], $target['cutoff'], $batch);

            $totals[$table] = $deleted;
            $verb = $dryRun ? 'would delete' : 'deleted';
            $this->info(sprintf('%s: %s %d row(s) older than %s', $table, $verb, $deleted, $target['cutoff']->toDateTimeString()));
        }

        if (! $dryRun && array_sum($totals) > 0) {
            Log::info('Pruned performance samples', $totals);
        }

        return self::SUCCESS;
    }

    private function deleteInBatches(string $table, string $column, \DateTimeInterface $cutoff, int $batch): int
    {
        $deleted = 0;

        do {
            $affected = DB::table($table)
                ->where($column, '<', $cutoff)
                ->limit($batch)
                ->delete();

            $deleted += $affected;
        } while ($affected === $batch);

        return $deleted;
    }
}
