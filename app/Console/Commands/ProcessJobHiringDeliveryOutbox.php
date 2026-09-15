<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\JobHiringDeliveryService;
use Illuminate\Console\Command;

final class ProcessJobHiringDeliveryOutbox extends Command
{
    protected $signature = 'jobs:process-hiring-delivery-outbox {--limit=100 : Maximum pending hiring events to process}';

    protected $description = 'Repair pending member notifications for committed job offers and interviews.';

    public function handle(JobHiringDeliveryService $outbox): int
    {
        $limit = filter_var($this->option('limit'), FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 500]]);
        if ($limit === false) {
            $this->error('The --limit option must be an integer between 1 and 500.');
            return self::INVALID;
        }

        foreach ($outbox->processBatch((int) $limit) as $key => $value) {
            $this->line($key . '=' . $value);
        }

        return self::SUCCESS;
    }
}
