<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use App\Core\TenantContext;
use App\Services\GroupLifecycleService;

/**
 * Check for inactive groups and update their lifecycle status.
 *
 * Scheduled: daily via Laravel scheduler.
 */
class CheckInactiveGroupsCommand extends Command
{
    protected $signature = 'groups:check-inactive
        {--tenant= : Specific tenant ID (default: all)}
        {--apply : Actually hide the groups. Without this the command only reports.}';

    protected $description = 'Report groups that look inactive (use --apply to hide them)';

    public function handle(): int
    {
        $specificTenant = $this->option('tenant');
        $apply = (bool) $this->option('apply');

        if ($specificTenant) {
            $tenantIds = [(int) $specificTenant];
        } else {
            $tenantIds = DB::table('tenants')
                ->where('is_active', true)
                ->pluck('id')
                ->toArray();
        }

        $totalStats = ['dormant' => 0, 'archived' => 0, 'protected' => 0];
        $halted = [];

        foreach ($tenantIds as $tenantId) {
            TenantContext::setById($tenantId);
            $stats = GroupLifecycleService::checkInactiveGroups($tenantId, $apply);
            $totalStats['dormant'] += $stats['dormant'];
            $totalStats['archived'] += $stats['archived'];
            $totalStats['protected'] += $stats['protected'];

            if (! empty($stats['halted'])) {
                $halted[] = $tenantId;
                $this->error("Tenant {$tenantId}: refused — the run would have transitioned too large a share of the directory. No group was changed.");
                continue;
            }

            if (! $apply) {
                if ($stats['planned'] > 0 || $stats['protected'] > 0) {
                    $this->line("Tenant {$tenantId}: {$stats['planned']} would be hidden, {$stats['protected']} protected");
                }

                continue;
            }

            if ($stats['dormant'] > 0 || $stats['archived'] > 0) {
                $this->info("Tenant {$tenantId}: {$stats['dormant']} dormant, {$stats['archived']} archived, {$stats['protected']} protected");
            }
        }

        if (! $apply) {
            $this->newLine();
            $this->warn('Report only — nothing was changed. Groups are never hidden automatically (owner decision, 2026-08-18);');
            $this->warn('pass --apply to hide them, or use the admin panel to archive one group at a time.');

            if ($halted !== []) {
                $this->error('Refused for tenant(s): ' . implode(', ', $halted));

                return Command::FAILURE;
            }

            return Command::SUCCESS;
        }

        $this->info("Done. Total: {$totalStats['dormant']} dormant, {$totalStats['archived']} archived, {$totalStats['protected']} protected.");

        if ($halted !== []) {
            $this->error('Refused for tenant(s): ' . implode(', ', $halted));

            return Command::FAILURE;
        }

        return Command::SUCCESS;
    }
}
