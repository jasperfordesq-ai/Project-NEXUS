<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Console\Commands;

use App\Services\SupportJiraTicketService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * Mirror Jira help-desk ticket status back onto support reports (Jira → platform
 * only). A no-op while SUPPORT_JIRA_ENABLED is off.
 *
 * Always exits 0 — a scheduled command's non-zero exit becomes Sentry noise;
 * failures are logged at error instead.
 */
class SyncSupportJiraStatus extends Command
{
    protected $signature = 'support:jira-sync-status';

    protected $description = 'Copy the status of Jira help-desk tickets back onto their support reports';

    public function handle(SupportJiraTicketService $service): int
    {
        try {
            $result = $service->syncStatuses();
            $this->info(sprintf(
                'Checked %d report(s), updated %d, failed batches %d.',
                $result['checked'],
                $result['updated'],
                $result['failed_batches'],
            ));
        } catch (\Throwable $e) {
            Log::error('support:jira-sync-status failed', ['error' => $e->getMessage()]);
            $this->error('Failed: ' . $e->getMessage());
        }

        return self::SUCCESS;
    }
}
