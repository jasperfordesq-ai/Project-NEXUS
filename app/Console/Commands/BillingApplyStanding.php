<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\BillingAutomationService;
use App\Support\Billing\BillingSettings;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * The daily billing check, as a command.
 *
 * It was a closure in the scheduler: it could not be run by hand or caught up
 * after a missed morning, it kept no record of having run, and a failure told
 * nobody. The scheduler now calls this command (08:00), and so can a person:
 *
 *   php artisan billing:apply-standing            the real check
 *   php artisan billing:apply-standing --dry-run  what it would do, nothing done
 *
 * It does only what the scheduled run does, and nothing at all while the
 * platform team's switch is off. Running it twice in a day is safe: every
 * notice and every pause is recorded before the next run looks.
 *
 * Each real run leaves a "last ran" record (BillingAutomationService::lastRun())
 * that the Automatic checks card shows. A failure is logged as an error, is
 * recorded, and exits non-zero.
 */
class BillingApplyStanding extends Command
{
    protected $signature = 'billing:apply-standing
                            {--dry-run : List what the check would do today and do none of it}';

    protected $description = 'Run the daily billing check: payment reminders, pauses for non-payment and member-limit notices';

    public function handle(): int
    {
        if ($this->option('dry-run')) {
            $this->printActions(BillingAutomationService::preview());
            $this->line('Dry run: nothing was sent and nothing was changed.');

            return self::SUCCESS;
        }

        if (!BillingSettings::get('automation_enabled')) {
            BillingAutomationService::recordRun('off', 0);
            $this->line('The automatic checks are switched off. Nothing was done.');

            return self::SUCCESS;
        }

        try {
            $actions = BillingAutomationService::run();
        } catch (\Throwable $e) {
            BillingAutomationService::recordRun('failed', 0);
            Log::error('[billing:apply-standing] the daily billing check failed', [
                'error' => $e->getMessage(),
                'exception' => $e::class,
            ]);
            $this->error('The daily billing check failed: ' . $e->getMessage());

            return self::FAILURE;
        }

        BillingAutomationService::recordRun('ok', count($actions));
        $this->printActions($actions);

        return self::SUCCESS;
    }

    /** @param list<array{tenant_id:int, tenant_name:string, clock:string, action:string, detail:array<string, mixed>}> $actions */
    private function printActions(array $actions): void
    {
        if ($actions === []) {
            $this->line('Nothing to do today.');

            return;
        }

        $this->table(
            ['Community', 'Clock', 'Action'],
            array_map(static fn (array $a): array => [
                $a['tenant_name'] . ' (#' . $a['tenant_id'] . ')',
                $a['clock'],
                $a['action'],
            ], $actions)
        );
    }
}
