<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Console\Commands;

use App\Core\TenantContext;
use App\Services\VolunteerWellbeingService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Assess volunteer burnout risk per tenant and refresh wellbeing alerts.
 *
 * Burnout detection previously ran as a side effect of the wellbeing
 * dashboard / my-status GET endpoints, so simply viewing the dashboard wrote
 * to vol_wellbeing_alerts. That write now lives here: this command walks every
 * active tenant, runs the burnout assessment, and upserts the (idempotent,
 * one-per-user) active alert rows the admin wellbeing panel manages. The read
 * endpoints still compute and return live risk, but no longer persist.
 *
 * Each tenant is isolated — a crash in one tenant is logged and skipped so the
 * rest of the run still completes.
 *
 * Scheduled: daily via the Laravel scheduler (see bootstrap/app.php).
 */
class AssessVolunteerWellbeing extends Command
{
    /** When the scan last finished with no community failing (ISO string, UTC); shown on the admin alerts page. */
    public const LAST_OK_CACHE_KEY = 'wellbeing:assess:last_ok_at';

    protected $signature = 'volunteering:assess-wellbeing {--tenant= : Specific tenant ID (default: all active)}';
    protected $description = 'Assess volunteer burnout risk and refresh wellbeing alerts per tenant';

    public function handle(): int
    {
        $specificTenant = $this->option('tenant');

        $tenantIds = $specificTenant
            ? [(int) $specificTenant]
            : DB::table('tenants')
                ->where('is_active', true)
                ->pluck('id')
                ->map(fn ($id): int => (int) $id)
                ->all();

        $totalAtRisk = 0;
        $failures = 0;

        foreach ($tenantIds as $tenantId) {
            try {
                $summary = TenantContext::runForTenant(
                    $tenantId,
                    static fn (): array => VolunteerWellbeingService::runTenantAssessment()
                );
            } catch (\Throwable $e) {
                $failures++;
                // error, not warning: the sentry channel only hears error and above,
                // and a scan that stops raising alerts must be noticed (deep audit O4).
                Log::error('[WellbeingAssessment] tenant assessment crashed', [
                    'tenant_id' => $tenantId,
                    'error' => $e->getMessage(),
                ]);
                $this->warn("Tenant {$tenantId}: assessment failed — {$e->getMessage()}");
                continue;
            }

            $atRisk = (int) ($summary['at_risk'] ?? 0);
            $totalAtRisk += $atRisk;
            if ($atRisk > 0) {
                $this->line("Tenant {$tenantId}: {$atRisk} at-risk volunteer(s) of {$summary['total_assessed']} assessed");
            }
        }

        $this->info("Wellbeing assessment done: {$totalAtRisk} at-risk volunteer(s) across " . count($tenantIds) . ' tenant(s).');

        if ($failures > 0) {
            return self::FAILURE;
        }
        Cache::forever(self::LAST_OK_CACHE_KEY, now()->toIso8601String());

        return self::SUCCESS;
    }
}
