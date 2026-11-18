<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Jobs;

use App\Core\TenantContext;
use App\Services\Matching\ListingEnrichmentService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

/**
 * Has the community's AI read one listing for matching
 * ({@see ListingEnrichmentService}). Queued, so saving a listing never waits
 * for an AI provider; a failure leaves the listing matched on its own words.
 */
class EnrichListingForMatchingJob implements ShouldQueue
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

    public function handle(ListingEnrichmentService $enrichment): void
    {
        try {
            TenantContext::runForTenant($this->tenantId, function () use ($enrichment): void {
                $enrichment->enrich($this->tenantId, $this->listingId);
            });
        } catch (\Throwable $e) {
            Log::warning('[EnrichListingForMatchingJob] failed', [
                'tenant_id' => $this->tenantId,
                'listing_id' => $this->listingId,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
