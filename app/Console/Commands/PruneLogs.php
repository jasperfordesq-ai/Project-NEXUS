<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * Prune unbounded logging tables to keep them within retention windows.
 *
 * Runs daily via bootstrap/app.php withSchedule(). Uses chunked DELETE
 * (1000 rows per iteration) to avoid long locks on large tables.
 */
class PruneLogs extends Command
{
    protected $signature = 'nexus:prune-logs
                            {--chunk=1000 : Number of rows to delete per iteration}';

    protected $description = 'Prune old rows from unbounded logging tables (cron_logs, error_404_log, activity_log, api_logs, federation_api_logs, federation_messages, sign_in_failure_hours, push_log)';

    /**
     * Retention policy per table (in days) and the timestamp column to filter on.
     *
     * federation_messages: 90-day retention keeps audit trail for disputes while
     * preventing unbounded growth on busy federation networks.
     * Override via FEDERATION_MESSAGES_RETENTION_DAYS env var if needed.
     *
     * @var array<int, array{table: string, days: int, column: string}>
     */
    private const RETENTION = [
        ['table' => 'cron_logs',             'days' => 90,  'column' => 'executed_at'],
        ['table' => 'error_404_log',         'days' => 30,  'column' => 'last_seen_at'],
        ['table' => 'activity_log',          'days' => 180, 'column' => 'created_at'],
        ['table' => 'api_logs',              'days' => 30,  'column' => 'created_at'],
        ['table' => 'federation_api_logs',   'days' => 30,  'column' => 'created_at'],
        ['table' => 'federation_messages',   'days' => 90,  'column' => 'created_at'],
        // Failed sign-ins counted by the hour (Platform team panel → Security). Counts only.
        ['table' => 'sign_in_failure_hours', 'days' => 90,  'column' => 'hour_start'],
        // One row per push notification sent (Platform team panel → Push notifications).
        // Pruned across every community; idx_push_log_created_at serves this delete.
        ['table' => 'push_log',              'days' => 180, 'column' => 'created_at'],
    ];

    /**
     * How many days the nightly clean-up keeps rows of $table, or null when
     * the table is not cleaned up by this command. Lets a screen state the
     * period without repeating the number.
     */
    public static function retentionDaysFor(string $table): ?int
    {
        foreach (self::RETENTION as $policy) {
            if ($policy['table'] === $table) {
                return $policy['days'];
            }
        }

        return null;
    }

    public function handle(): int
    {
        $chunk = max(1, (int) $this->option('chunk'));
        $totalDeleted = 0;
        $summary = [];

        foreach (self::RETENTION as $policy) {
            $table = $policy['table'];
            $days = $policy['days'];
            $column = $policy['column'];

            if (!Schema::hasTable($table)) {
                $this->warn("Skipping {$table} — table does not exist.");
                continue;
            }

            $deleted = $this->pruneTable($table, $column, $days, $chunk);
            $totalDeleted += $deleted;
            $summary[$table] = $deleted;

            $this->info("Pruned {$deleted} row(s) from {$table} older than {$days} days.");
        }

        Log::info('Pruned log tables', [
            'summary' => $summary,
            'total_deleted' => $totalDeleted,
        ]);

        return self::SUCCESS;
    }

    /**
     * Delete rows older than N days in chunks to avoid long row locks.
     */
    private function pruneTable(string $table, string $column, int $days, int $chunk): int
    {
        $total = 0;

        while (true) {
            $rows = DB::delete(
                "DELETE FROM `{$table}` WHERE `{$column}` < DATE_SUB(NOW(), INTERVAL ? DAY) LIMIT ?",
                [$days, $chunk]
            );

            if ($rows <= 0) {
                break;
            }

            $total += $rows;

            if ($rows < $chunk) {
                break;
            }
        }

        return $total;
    }
}
