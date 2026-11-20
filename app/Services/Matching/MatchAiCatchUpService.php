<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\Matching;

use App\Jobs\DiscoverMatchesForListingJob;
use App\Jobs\ReadTextForMatchingJob;
use Illuminate\Support\Facades\Log;

/**
 * Queues the AI work still owed for one community, a few items per run:
 * profile skills, volunteering opportunities and events not yet read
 * ({@see TextReadingService}), and listings the AI has not yet looked for
 * matches for ({@see MatchDiscoveryService}).
 *
 * Called from the half-hourly matching run. It catches up after a community
 * switches AI on, picks up skills and opportunities as they are added, and
 * retries what failed. Each service returns nothing while the community's
 * AI is off, its own switch is off, or it is paused after a provider
 * failure, so this costs a community without AI nothing.
 */
class MatchAiCatchUpService
{
    public const READINGS_PER_RUN = 20;
    public const DISCOVERIES_PER_RUN = 10;

    public function __construct(
        private readonly TextReadingService $readings,
        private readonly MatchDiscoveryService $discovery,
    ) {}

    /** @return array{readings: int, discoveries: int} how many jobs were queued */
    public function queueFor(int $tenantId): array
    {
        $queued = ['readings' => 0, 'discoveries' => 0];

        try {
            foreach ($this->readings->textsNeedingReading($tenantId, self::READINGS_PER_RUN) as $item) {
                ReadTextForMatchingJob::dispatch($tenantId, $item['text'], $item['source']);
                $queued['readings']++;
            }
        } catch (\Throwable $e) {
            Log::warning('[MatchAiCatchUpService] readings not queued', ['tenant_id' => $tenantId, 'error' => $e->getMessage()]);
        }

        try {
            foreach ($this->discovery->listingsNeedingDiscovery($tenantId, self::DISCOVERIES_PER_RUN) as $listingId) {
                DiscoverMatchesForListingJob::dispatch($tenantId, $listingId);
                $queued['discoveries']++;
            }
        } catch (\Throwable $e) {
            Log::warning('[MatchAiCatchUpService] discoveries not queued', ['tenant_id' => $tenantId, 'error' => $e->getMessage()]);
        }

        return $queued;
    }
}
