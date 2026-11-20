<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\Matching;

use App\Jobs\DiscoverMatchesForListingJob;
use App\Jobs\ReadTextForMatchingJob;
use App\Services\AI\AIServiceFactory;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
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

    /**
     * What the AI has done for this community's matching, for the admin's
     * Matching settings page: counts only, no listing or member text.
     *
     * @return array{listings_active: int, listings_read: int, listings_searched: int, texts_read: int, poor_fits: int, paused: bool}
     */
    public function status(int $tenantId): array
    {
        $status = ['listings_active' => 0, 'listings_read' => 0, 'listings_searched' => 0, 'texts_read' => 0, 'poor_fits' => 0, 'paused' => false];

        try {
            $active = fn () => DB::table('listings as l')
                ->where('l.tenant_id', $tenantId)
                ->where('l.status', 'active')
                ->where(function ($q) {
                    $q->whereNull('l.moderation_status')->orWhere('l.moderation_status', 'approved');
                });
            $status['listings_active'] = (int) $active()->count();
            foreach (['listings_read' => 'listing_match_enrichments', 'listings_searched' => 'listing_match_discoveries'] as $key => $table) {
                $status[$key] = (int) $active()
                    ->join($table . ' as r', function ($join) {
                        $join->on('r.listing_id', '=', 'l.id')->on('r.tenant_id', '=', 'l.tenant_id');
                    })
                    ->count();
            }
            $status['texts_read'] = (int) DB::table('match_text_readings')->where('tenant_id', $tenantId)->count();
            // Stored matches the AI judged a poor fit (an explanation's
            // verdict, or an alert it held), kept for a week.
            $status['poor_fits'] = (int) DB::table('match_cache')
                ->where('tenant_id', $tenantId)
                ->where('ai_rerank_delta', '<=', -10)
                ->where('expires_at', '>', now())
                ->count();
            $status['paused'] = Cache::has(ListingEnrichmentService::backoffKey($tenantId))
                || Cache::has(TextReadingService::backoffKey($tenantId))
                || Cache::has(MatchDiscoveryService::backoffKey($tenantId));
        } catch (\Throwable $e) {
            Log::warning('[MatchAiCatchUpService] status unavailable', ['tenant_id' => $tenantId, 'error' => $e->getMessage()]);
        }

        return $status;
    }

    /**
     * Whether the "similar meaning" figures (EmbeddingService) can be made
     * for this community: they come from OpenAI's embeddings API alone, so
     * they need the community's AI on and an OpenAI key of its own. With any
     * other provider that part does nothing; the AI's readings and its
     * search for matches do the same job through an ordinary chat request.
     */
    public function semanticAvailable(int $tenantId): bool
    {
        try {
            return AIServiceFactory::isEnabledForTenant($tenantId)
                && trim((string) DB::table('ai_settings')
                    ->where('tenant_id', $tenantId)
                    ->where('setting_key', 'openai_api_key')
                    ->value('setting_value')) !== '';
        } catch (\Throwable $e) {
            return false;
        }
    }
}
