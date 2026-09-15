<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\CourseCompletionDeliveryService;
use Illuminate\Console\Command;

final class ProcessCourseCompletionDeliveryOutbox extends Command
{
    protected $signature = 'courses:process-completion-outbox {--limit=100 : Maximum pending completions to process}';

    protected $description = 'Repair pending certificate, notification and gamification work for completed courses.';

    public function handle(CourseCompletionDeliveryService $outbox): int
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
