<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Concerns;

use App\Services\FederationFeatureService;
use Illuminate\Support\Facades\DB;

/**
 * Opt a test into external partner federation.
 *
 * The external federation kill switch ships DISABLED, so every inbound external
 * protocol surface (Komunitin, Credit Commons, legacy v1, partner webhooks,
 * cross-platform hour transfers, aggregates, Nexus ingest) answers 503 by
 * default and all outbound partner calls are refused.
 *
 * Tests that exercise those surfaces must opt in explicitly. This is deliberate:
 * a new external route added WITHOUT a kill-switch gate then fails its own test
 * loudly, rather than being silently permitted by a globally permissive fixture.
 */
trait EnablesExternalFederation
{
    /**
     * @param array<int, string>|null $protocols Defaults to every protocol.
     */
    protected function enableExternalFederation(?array $protocols = null): void
    {
        $protocols ??= FederationFeatureService::externalProtocolNames();

        $row = [
            'federation_enabled' => 1,
            'emergency_lockdown_active' => 0,
            'external_federation_enabled' => 1,
            // MUST be set explicitly. `whitelist_mode_enabled` has a column
            // DEFAULT of 1, so when this updateOrInsert *inserts* the control
            // row it would otherwise switch whitelist mode ON and every partner
            // request would 403 with TENANT_NOT_WHITELISTED — a different gate
            // than the one this trait exists to open. 0 matches what
            // FederationFeatureService::initializeSystemDefaults() seeds.
            'whitelist_mode_enabled' => 0,
            'updated_at' => now(),
        ];

        foreach ($protocols as $protocol) {
            $column = FederationFeatureService::externalProtocolColumn($protocol);
            if ($column !== null) {
                $row[$column] = 1;
            }
        }

        DB::table('federation_system_control')->updateOrInsert(['id' => 1], $row);

        app(FederationFeatureService::class)->clearCache();
    }
}
