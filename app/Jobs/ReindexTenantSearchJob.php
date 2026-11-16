<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Jobs;

use App\Core\TenantContext;
use App\Services\PlatformTeam\SearchRebuildService;
use App\Services\SearchReindexService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\MaxAttemptsExceededException;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

/**
 * Rebuild one community's search, started from the platform team panel.
 *
 * Runs SearchReindexService::reindexTenant() for every kind of entry (the
 * same work `scripts/sync_search_index.php --tenant=<id>` does) and keeps its
 * progress in the cache (SearchRebuildService::cacheKey()) so the page can
 * show it: running → done, or failed. It adds and updates entries; it never
 * empties the community's search first.
 *
 * One try: a rebuild is safe to run again, but a person starts it, and a
 * person can start it again. 🔴 Every way out of handle() writes a final
 * state first; failed() covers a worker that stopped or timed out.
 *
 * 🔴 The redis queue's retry_after is 90 seconds, shorter than a rebuild of a
 * large community. The queue may then hand the job out a second time while the
 * first is still working; with one try that second delivery fails at once with
 * MaxAttemptsExceededException. failed() leaves a record that is still
 * running and still reporting alone in that case, so the first run's result
 * is the one shown.
 */
class ReindexTenantSearchJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;

    /** A large community, one row at a time, each waiting for the search server's verdict. */
    public int $timeout = 3600;

    public bool $failOnTimeout = true;

    public function __construct(
        public int $tenantId,
        public ?int $requestedBy = null,
    ) {
        $this->onQueue('search');
    }

    public function handle(SearchReindexService $reindex, SearchRebuildService $record): void
    {
        $running = [
            'state' => 'running',
            'started_at' => now()->toIso8601String(),
            'finished_at' => null,
            'counts' => null,
            'errors' => 0,
        ];
        $record->write($this->tenantId, $running);

        try {
            if (!$record->reachable()) {
                throw new \RuntimeException('The search service could not be reached');
            }

            $result = TenantContext::runForTenant(
                $this->tenantId,
                fn (): array => $reindex->reindexTenant(
                    $this->tenantId,
                    null,
                    false,
                    // Keep the record fresh as the work goes, so a long rebuild
                    // is never mistaken for one that stopped reporting.
                    function (string $event) use ($record, $running): void {
                        if (in_array($event, ['batch', 'done', 'empty'], true)) {
                            $record->write($this->tenantId, $running);
                        }
                    },
                ),
            );
        } catch (\Throwable $e) {
            $this->writeFailed($record, $running['started_at']);
            Log::error('ReindexTenantSearchJob: search rebuild failed', [
                'tenant_id' => $this->tenantId,
                'requested_by' => $this->requestedBy,
                'exception' => $e::class,
                'message' => $e->getMessage(),
            ]);

            throw $e;
        }

        $counts = [];
        $errors = 0;
        foreach (SearchReindexService::TYPES as $type) {
            $counts[$type] = (int) ($result[$type]['indexed'] ?? 0);
            $errors += (int) ($result[$type]['errors'] ?? 0);
        }

        $record->write($this->tenantId, [
            'state' => 'done',
            'started_at' => $running['started_at'],
            'finished_at' => now()->toIso8601String(),
            'counts' => $counts,
            'errors' => $errors,
        ]);

        Log::info('ReindexTenantSearchJob: search rebuilt', [
            'tenant_id' => $this->tenantId,
            'requested_by' => $this->requestedBy,
            'counts' => $counts,
            'errors' => $errors,
        ]);
    }

    public function failed(\Throwable $e): void
    {
        $record = app(SearchRebuildService::class);
        $state = $record->read($this->tenantId);

        if (
            $e instanceof MaxAttemptsExceededException
            && $state !== null
            && ($state['state'] ?? null) === 'running'
            && !$record->isStale($state)
        ) {
            Log::warning('ReindexTenantSearchJob: a second delivery was given up while the first run is still reporting', [
                'tenant_id' => $this->tenantId,
            ]);

            return;
        }

        $this->writeFailed($record, is_array($state) ? ($state['started_at'] ?? null) : null);
        Log::error('ReindexTenantSearchJob permanently failed', [
            'tenant_id' => $this->tenantId,
            'requested_by' => $this->requestedBy,
            'exception' => $e::class,
            'error' => $e->getMessage(),
        ]);
    }

    private function writeFailed(SearchRebuildService $record, ?string $startedAt): void
    {
        $record->write($this->tenantId, [
            'state' => 'failed',
            'started_at' => $startedAt,
            'finished_at' => now()->toIso8601String(),
            'counts' => null,
            'errors' => 0,
        ]);
    }
}
