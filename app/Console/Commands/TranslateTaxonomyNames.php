<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Console\Commands;

use App\Core\TenantContext;
use App\Services\Translation\TaxonomyNameLocalizer;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Translates every community's category and skill-category names into every
 * platform language that is still missing (AWID feedback, 30 Oct 2026: members
 * choosing what to offer saw only the admin's English). Existing translations,
 * including an admin's corrections, are never overwritten.
 *
 * Runs nightly to fill anything a provider outage left behind, and once by hand
 * after the first deploy. Each name is sent to the provider at most once per
 * language, so a repeat run costs nothing.
 */
class TranslateTaxonomyNames extends Command
{
    protected $signature = 'taxonomy:translate-names {--tenant= : Specific tenant ID (default: all active)}';

    protected $description = 'Translate category and skill-category names into every platform language';

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

        $filled = 0;
        $failed = 0;
        $crashed = 0;

        foreach ($tenantIds as $tenantId) {
            try {
                $summary = TenantContext::runForTenant(
                    $tenantId,
                    static fn (): array => TaxonomyNameLocalizer::fillCommunity()
                );
            } catch (\Throwable $e) {
                $crashed++;
                Log::error('[TranslateTaxonomyNames] tenant crashed', ['tenant_id' => $tenantId, 'error' => $e->getMessage()]);
                $this->warn("Tenant {$tenantId}: failed — {$e->getMessage()}");
                continue;
            }

            $filled += $summary['filled'];
            $failed += $summary['failed'];
            if ($summary['filled'] > 0 || $summary['failed'] > 0) {
                $this->line("Tenant {$tenantId}: {$summary['filled']} name(s) translated, {$summary['failed']} not, across {$summary['rows']} categories");
            }
        }

        $this->info("Category names: {$filled} translation(s) added, {$failed} could not be translated, across " . count($tenantIds) . ' tenant(s).');

        return $crashed > 0 ? self::FAILURE : self::SUCCESS;
    }
}
