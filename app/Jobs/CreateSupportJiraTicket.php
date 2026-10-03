<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Jobs;

use App\Core\TenantContext;
use App\Models\SupportReport;
use App\Services\SupportJiraTicketService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Copies a saved support report to the Jira help desk.
 *
 * Dispatched by SupportReportController after the report is stored, so a Jira
 * outage can never lose a report or slow the member's request. A failure is
 * recorded on the report (jira_last_error), logged at error, and re-thrown so
 * the queue retries with backoff. The service records the ticket key the
 * moment the ticket exists, so a retry never raises a duplicate.
 */
final class CreateSupportJiraTicket implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    public int $tries = 5;

    /** @var list<int> Retries span about 17 minutes, so a member whose
     *  ticket cannot be raised gets the fallback receipt the same hour. */
    public array $backoff = [30, 120, 300, 600];

    public int $timeout = 60;

    public function __construct(
        public readonly int $reportId,
        public readonly int $tenantId,
    ) {
        $this->onQueue('default');
    }

    public function handle(): void
    {
        if (!SupportJiraTicketService::isEnabled()) {
            return;
        }

        $previousTenantId = TenantContext::currentId();

        try {
            TenantContext::setById($this->tenantId);

            $report = SupportReport::withoutGlobalScopes()
                ->where('tenant_id', $this->tenantId)
                ->find($this->reportId);
            if (!$report) {
                return;
            }

            try {
                app(SupportJiraTicketService::class)->sync($report);
            } catch (\Throwable $e) {
                Log::error('[CreateSupportJiraTicket] Jira ticket creation failed', [
                    'report_id' => $this->reportId,
                    'tenant_id' => $this->tenantId,
                    'attempt' => $this->job?->attempts(),
                    'error' => $e->getMessage(),
                ]);

                // Every failure is visible on the report in the admin console,
                // not only the ones Jira answered with an HTTP status.
                if (!$report->jira_issue_key) {
                    $report->jira_last_error = Str::limit(
                        'Attempt ' . (int) ($this->job?->attempts() ?? 1) . ': ' . $e->getMessage(),
                        500,
                        '',
                    );
                    $report->save();
                }

                throw $e;
            }
        } finally {
            TenantContext::restoreAfterScopedListener($previousTenantId);
        }
    }

    public function failed(?\Throwable $exception): void
    {
        Log::error('[CreateSupportJiraTicket] gave up after all retries; the report is saved but has no Jira ticket', [
            'report_id' => $this->reportId,
            'tenant_id' => $this->tenantId,
            'error' => $exception?->getMessage(),
        ]);
    }
}
