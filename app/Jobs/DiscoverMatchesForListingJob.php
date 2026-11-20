<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Jobs;

use App\Core\TenantContext;
use App\Services\Matching\MatchDiscoveryService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

/**
 * Has the community's AI look for listings and skills that fit one listing
 * ({@see MatchDiscoveryService}). Queued, so saving a listing never waits
 * for an AI provider; a failure leaves the listing matched by the engine
 * alone.
 */
class DiscoverMatchesForListingJob implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    public int $tries = 1;

    public function __construct(
        public readonly int $tenantId,
        public readonly int $listingId,
    ) {}

    public function handle(MatchDiscoveryService $discovery): void
    {
        try {
            TenantContext::runForTenant($this->tenantId, function () use ($discovery): void {
                $discovery->discover($this->tenantId, $this->listingId);
            });
        } catch (\Throwable $e) {
            Log::warning('[DiscoverMatchesForListingJob] failed', [
                'tenant_id' => $this->tenantId,
                'listing_id' => $this->listingId,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
