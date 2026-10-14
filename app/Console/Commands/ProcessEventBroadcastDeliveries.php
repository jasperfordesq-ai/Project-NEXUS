<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\EventBroadcastDeliveryConsumer;
use Illuminate\Console\Command;

/** Identity-free bounded worker entrypoint; scheduler wiring is intentionally separate. */
final class ProcessEventBroadcastDeliveries extends Command
{
    protected $signature = 'events:process-broadcasts
        {--tenant= : Restrict processing to one tenant ID}
        {--limit=50 : Maximum delivery facts to claim per batch (1-100)}
        {--budget-seconds= : Keep claiming batches until none is due or this many seconds pass (0 = one batch); default config events.broadcast.budget_seconds}
        {--json : Emit machine-readable summary output}';

    protected $description = 'Process durable per-recipient Event broadcast deliveries';

    public function __construct(
        private readonly EventBroadcastDeliveryConsumer $consumer,
    ) {
        parent::__construct();
    }

    public function handle(): int
    {
        $tenantOption = $this->option('tenant');
        $tenantId = $tenantOption === null || $tenantOption === ''
            ? null
            : filter_var($tenantOption, FILTER_VALIDATE_INT, [
                'options' => ['min_range' => 1],
            ]);
        if ($tenantOption !== null && $tenantOption !== '' && $tenantId === false) {
            $this->error('The tenant option must be a positive integer.');
            return self::INVALID;
        }
        $limit = filter_var($this->option('limit'), FILTER_VALIDATE_INT, [
            'options' => ['min_range' => 1, 'max_range' => 100],
        ]);
        if ($limit === false) {
            $this->error('The limit option must be between 1 and 100.');
            return self::INVALID;
        }

        $budgetOption = $this->option('budget-seconds');
        $budget = $budgetOption === null || $budgetOption === ''
            ? (int) config('events.broadcast.budget_seconds', 50)
            : filter_var($budgetOption, FILTER_VALIDATE_INT, [
                'options' => ['min_range' => 0, 'max_range' => 600],
            ]);
        if ($budget === false) {
            $this->error('The budget-seconds option must be between 0 and 600.');
            return self::INVALID;
        }

        // One batch used to be the whole run, so a large message drained at 50
        // deliveries a minute. Keep going while there is due work and time.
        $deadline = microtime(true) + max(0, (int) $budget);
        $summary = null;
        do {
            $batch = $this->consumer->processBatch(
                (int) $limit,
                $tenantId === null ? null : (int) $tenantId,
            );
            if ($summary === null) {
                $summary = $batch;
            } else {
                foreach ($batch as $key => $value) {
                    $summary[$key] = ($summary[$key] ?? 0) + $value;
                }
            }
        } while ($batch['claimed'] > 0 && microtime(true) < $deadline);
        if ((bool) $this->option('json')) {
            $this->line(json_encode($summary, JSON_THROW_ON_ERROR));
        } else {
            $this->table(
                ['Claimed', 'Delivered', 'Suppressed', 'Retrying', 'Dead-lettered', 'Stale released', 'Closed'],
                [[
                    $summary['claimed'],
                    $summary['delivered'],
                    $summary['suppressed'],
                    $summary['retrying'],
                    $summary['dead_lettered'],
                    $summary['stale_released'],
                    $summary['reconciled'],
                ]],
            );
        }

        return $summary['dead_lettered'] > 0 ? self::FAILURE : self::SUCCESS;
    }
}
