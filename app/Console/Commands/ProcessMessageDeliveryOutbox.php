<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\MessageDeliveryOutboxService;
use Illuminate\Console\Command;

final class ProcessMessageDeliveryOutbox extends Command
{
    protected $signature = 'messages:process-delivery-outbox {--limit=100 : Maximum pending messages to process}';

    protected $description = 'Dispatch pending message realtime and notification jobs from the transactional outbox.';

    public function handle(MessageDeliveryOutboxService $outbox): int
    {
        $limit = filter_var($this->option('limit'), FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 500]]);
        if ($limit === false) {
            $this->error('The --limit option must be an integer between 1 and 500.');
            return self::INVALID;
        }

        $summary = $outbox->processBatch((int) $limit);
        foreach ($summary as $key => $value) {
            $this->line($key . '=' . $value);
        }

        return self::SUCCESS;
    }
}
