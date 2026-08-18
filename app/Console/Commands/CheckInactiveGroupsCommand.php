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
    protected $signature = 'groups:check-inactive {--tenant= : Specific tenant ID (default: all)}';
    protected $description = 'Check for inactive groups and mark them dormant/archived';

    public function handle(): int
    {
        $specificTenant = $this->option('tenant');

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
            $stats = GroupLifecycleService::checkInactiveGroups($tenantId);
            $totalStats['dormant'] += $stats['dormant'];
            $totalStats['archived'] += $stats['archived'];
            $totalStats['protected'] += $stats['protected'];

            if (! empty($stats['halted'])) {
                $halted[] = $tenantId;
                $this->error("Tenant {$tenantId}: refused — the run would have transitioned too large a share of the directory. No group was changed.");
                continue;
            }

            if ($stats['dormant'] > 0 || $stats['archived'] > 0) {
                $this->info("Tenant {$tenantId}: {$stats['dormant']} dormant, {$stats['archived']} archived, {$stats['protected']} protected");
            }
        }

        $this->info("Done. Total: {$totalStats['dormant']} dormant, {$totalStats['archived']} archived, {$totalStats['protected']} protected.");

        if ($halted !== []) {
            $this->error('Refused for tenant(s): ' . implode(', ', $halted));

            return Command::FAILURE;
        }

        return Command::SUCCESS;
    }
}
