<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Jobs;

use App\Core\TenantContext;
use App\Services\Matching\TextReadingService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

/**
 * Has the community's AI read one profile skill, volunteering opportunity
 * or event for matching ({@see TextReadingService}). Queued; a failure
 * leaves the text matched on its own words.
 */
class ReadTextForMatchingJob implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    public int $tries = 1;

    public function __construct(
        public readonly int $tenantId,
        public readonly string $text,
        public readonly string $source,
    ) {}

    public function handle(TextReadingService $readings): void
    {
        try {
            TenantContext::runForTenant($this->tenantId, function () use ($readings): void {
                $readings->read($this->tenantId, $this->text, $this->source);
            });
        } catch (\Throwable $e) {
            Log::warning('[ReadTextForMatchingJob] failed', [
                'tenant_id' => $this->tenantId,
                'source' => $this->source,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
