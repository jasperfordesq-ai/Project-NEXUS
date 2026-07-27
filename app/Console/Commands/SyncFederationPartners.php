<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Console\Commands;

use App\Services\FederationExternalApiClient;
use App\Services\FederationExternalPartnerService;
use App\Services\FederationFeatureService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Sync metadata for all active external federation partners.
 *
 * Runs a health check and fetches member counts + partner identity
 * from each active external partner's API. Updates partner_member_count,
 * partner_name, last_sync_at, and status in the database.
 *
 * Scheduled to run hourly via bootstrap/app.php.
 */
class SyncFederationPartners extends Command
{
    protected $signature = 'federation:sync-partners
                            {--tenant= : Sync partners for a specific tenant only}';

    protected $description = 'Sync metadata (health, member count, name) for all active external federation partners';

    public function handle(): int
    {
        // Every outbound call below would be blocked by the kill switch anyway;
        // returning early keeps the hourly run from logging a blocked call per
        // partner. Previously this command health-checked partners even during
        // an emergency lockdown.
        if (! app(FederationFeatureService::class)->isExternalFederationEnabled()) {
            $this->info('External federation is disabled — skipping partner sync.');
            return self::SUCCESS;
        }

        $tenantFilter = $this->option('tenant') ? (int) $this->option('tenant') : null;

        // Get all tenants that have external partners
        $query = "SELECT DISTINCT tenant_id FROM federation_external_partners WHERE status IN ('active', 'pending')";
        $params = [];
        if ($tenantFilter) {
            $query .= " AND tenant_id = ?";
            $params[] = $tenantFilter;
        }

        $tenants = DB::select($query, $params);
        $totalSynced = 0;
        $totalFailed = 0;

        foreach ($tenants as $tenant) {
            $tenantId = (int) $tenant->tenant_id;

            try {
                \App\Core\TenantContext::setById($tenantId);
            } catch (\Throwable $e) {
                Log::warning("[federation:sync-partners] Failed to set tenant context for {$tenantId}: " . $e->getMessage());
                continue;
            }

            $partners = DB::select(
                "SELECT id, name, status FROM federation_external_partners WHERE tenant_id = ? AND status IN ('active', 'pending')",
                [$tenantId]
            );

            foreach ($partners as $partner) {
                $partnerId = (int) $partner->id;
                $partnerName = $partner->name;

                try {
                    // Health check
                    $health = FederationExternalApiClient::healthCheck($partnerId);

                    if ($health['success']) {
                        // Fetch member count from /timebanks
                        $memberCount = 0;
                        $syncedName = null;

                        try {
                            $tbInfo = FederationExternalApiClient::get($partnerId, '/timebanks');
                            if (($tbInfo['success'] ?? false) && !empty($tbInfo['data'])) {
                                $firstTb = is_array($tbInfo['data']) ? ($tbInfo['data'][0] ?? null) : null;
                                if ($firstTb) {
                                    $memberCount = (int) ($firstTb['member_count'] ?? 0);
                                    $syncedName = $firstTb['name'] ?? null;
                                }
                            }
                        } catch (\Throwable) {
                            // Non-critical
                        }

                        DB::update(
                            "UPDATE federation_external_partners SET
                                partner_member_count = ?,
                                partner_name = COALESCE(NULLIF(?, ''), partner_name),
                                last_sync_at = NOW(),
                                error_count = 0,
                                last_error = NULL,
                                status = 'active'
                             WHERE id = ? AND tenant_id = ?",
                            [$memberCount, $syncedName, $partnerId, $tenantId]
                        );

                        $totalSynced++;
                        $this->line("  <info>✓</info> {$partnerName} — {$memberCount} members");
                    } else {
                        $error = $health['error'] ?? 'Health check failed';
                        DB::update(
                            "UPDATE federation_external_partners SET
                                last_error = ?,
                                error_count = error_count + 1,
                                last_sync_at = NOW()
                             WHERE id = ? AND tenant_id = ?",
                            [substr($error, 0, 500), $partnerId, $tenantId]
                        );

                        $totalFailed++;
                        $this->line("  <comment>✗</comment> {$partnerName} — {$error}");
                    }
                } catch (\Throwable $e) {
                    $totalFailed++;
                    Log::warning("[federation:sync-partners] Partner #{$partnerId} ({$partnerName}) sync failed: " . $e->getMessage());
                    $this->line("  <error>✗</error> {$partnerName} — " . $e->getMessage());
                }
            }
        }

        $this->info("Sync complete: {$totalSynced} synced, {$totalFailed} failed.");

        if ($totalSynced > 0 || $totalFailed > 0) {
            Log::info('[federation:sync-partners] completed', [
                'synced' => $totalSynced,
                'failed' => $totalFailed,
            ]);
        }

        return self::SUCCESS;
    }
}
