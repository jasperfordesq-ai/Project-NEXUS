<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Console\Commands;

use App\Services\LegalPublicationDeliveryService;
use Illuminate\Console\Command;

final class ProcessLegalPublicationDeliveries extends Command
{
    protected $signature = 'legal:process-publication-emails {--limit=100}';
    protected $description = 'Process the durable policy publication email ledger.';

    public function handle(LegalPublicationDeliveryService $service): int
    {
        $limit = filter_var($this->option('limit'), FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 500]]);
        if ($limit === false) {
            return self::INVALID;
        }
        $this->line('processed=' . $service->processBatch($limit));
        return self::SUCCESS;
    }
}
