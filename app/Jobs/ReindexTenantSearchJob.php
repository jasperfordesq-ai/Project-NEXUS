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
 * Rebuild one community's search, started from the platform team panel, as a
 * chain of short jobs.
 *
 * Each job is one slice: one kind of entry (SearchReindexService::TYPES, in
 * order) and one window of its rows by id — at most WINDOW rows, and it stops
 * itself after TIME_BOX_SECONDS even mid-window. It adds its counts to the
 * cache record (SearchRebuildService::cacheKey()), moves the record's cursor
 * on and hands the next slice to the queue; the last slice writes `done`. The
 * same work `scripts/sync_search_index.php --tenant=<id>` does, in pieces. It
 * adds and updates entries; it never empties the community's search first.
 *
 * 🔴 Why slices (16 Nov 2026): the redis queue hands a job out again after
 * `retry_after` (90 s). A whole community in one job outlived that, so the
 * queue gave it out a second time; with one try the second delivery landed in
 * failed jobs although the rebuild worked, and "run again" there started a
 * rebuild that skipped the "already running" check. A slice stops itself after
 * 40 s and is killed at $timeout (80 s), both inside 90 s.
 *
 * 🔴 A slice only works when the record names its run (`run_id`, set by
 * SearchRebuildService::markQueued()) and its place (`cursor`), and the run is
 * waiting or running. Anything else — a slice of an older run, a slice that
 * already ran, a job from before run ids, "run again" on the failed-jobs page
 * — does nothing and ends cleanly.
 *
 * One try: a person starts a rebuild and can start it again. Every way out of
 * handle() writes a final state first; failed() covers a worker that stopped
 * or timed out, and writes `failed` only if nothing final was written yet.
 */
class ReindexTenantSearchJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    /** Rows of one kind a slice reads at most. */
    public const WINDOW = 500;

    /** A slice stops itself after this long, even mid-window, and carries on in the next. */
    public const TIME_BOX_SECONDS = 40;

    public int $tries = 1;

    /** Killed after this; below the queue's 90-second retry_after, above the time box. */
    public int $timeout = 80;

    public bool $failOnTimeout = true;

    public function __construct(
        public int $tenantId,
        public ?int $requestedBy = null,
        public ?string $runId = null,
        public int $kindIndex = 0,
        public int $afterId = 0,
        public int $window = self::WINDOW,
        public int $timeBoxSeconds = self::TIME_BOX_SECONDS,
    ) {
        $this->onQueue('search');
    }

    public function handle(SearchReindexService $reindex, SearchRebuildService $record): void
    {
        $state = $record->read($this->tenantId);
        if (!$this->isCurrentSlice($state)) {
            Log::info('ReindexTenantSearchJob: a slice that is not the current one did nothing', [
                'tenant_id' => $this->tenantId,
                'kind' => $this->kindIndex,
                'after_id' => $this->afterId,
            ]);

            return;
        }

        /** @var array<string, mixed> $state */
        $partial = is_array($state['partial'] ?? null) ? $state['partial'] : [];
        $errors = (int) ($state['errors'] ?? 0);
        $startedAt = is_string($state['started_at'] ?? null) ? $state['started_at'] : now()->toIso8601String();
        $running = $this->runningState($startedAt, $partial, $errors, $this->kindIndex, $this->afterId);
        $record->write($this->tenantId, $running);

        $kind = SearchReindexService::TYPES[$this->kindIndex];
        $deadline = microtime(true) + max(0, $this->timeBoxSeconds);

        try {
            if (!$record->reachable()) {
                throw new \RuntimeException('The search service could not be reached');
            }

            $result = TenantContext::runForTenant(
                $this->tenantId,
                fn (): array => $reindex->reindexTenant(
                    $this->tenantId,
                    $kind,
                    false,
                    // Keep the record fresh as the work goes, so a slice is
                    // never mistaken for one that stopped reporting.
                    function (string $event) use ($record, $running): void {
                        if ($event === 'batch') {
                            $record->write($this->tenantId, $running);
                        }
                    },
                    $this->afterId,
                    max(1, $this->window),
                    static fn (): bool => microtime(true) >= $deadline,
                ),
            )[$kind];
        } catch (\Throwable $e) {
            $this->writeFailed($record, $startedAt);
            Log::error('ReindexTenantSearchJob: search rebuild failed', [
                'tenant_id' => $this->tenantId,
                'requested_by' => $this->requestedBy,
                'kind' => $kind,
                'exception' => $e::class,
                'message' => $e->getMessage(),
            ]);

            throw $e;
        }

        $partial[$kind] = (int) ($partial[$kind] ?? 0) + (int) $result['indexed'];
        $errors += (int) $result['errors'];

        $nextKind = $this->kindIndex;
        $nextAfter = (int) ($result['last_id'] ?? $this->afterId);
        if ($result['finished'] ?? true) {
            $nextKind++;
            $nextAfter = 0;
        }

        if ($nextKind >= count(SearchReindexService::TYPES)) {
            $this->writeDone($record, $startedAt, $partial, $errors);

            return;
        }

        // The record moves on before the next slice is handed over, so that
        // slice finds itself current even if it starts at once.
        $record->write($this->tenantId, $this->runningState($startedAt, $partial, $errors, $nextKind, $nextAfter));

        try {
            static::dispatch($this->tenantId, $this->requestedBy, $this->runId, $nextKind, $nextAfter, $this->window, $this->timeBoxSeconds);
        } catch (\Throwable $e) {
            $this->writeFailed($record, $startedAt);
            Log::error('ReindexTenantSearchJob: the next slice could not be queued', [
                'tenant_id' => $this->tenantId,
                'exception' => $e::class,
            ]);

            throw $e;
        }
    }

    public function failed(\Throwable $e): void
    {
        $record = app(SearchRebuildService::class);
        $state = $record->read($this->tenantId);

        // A slice of another run (or from before run ids) says nothing about
        // the current one.
        if ($state === null || $this->runId === null || ($state['run_id'] ?? null) !== $this->runId) {
            Log::warning('ReindexTenantSearchJob: a slice that is not the current run was given up', [
                'tenant_id' => $this->tenantId,
                'exception' => $e::class,
            ]);

            return;
        }

        // handle() already wrote the final state: write it once.
        if (!in_array($state['state'] ?? null, ['queued', 'running'], true)) {
            return;
        }

        if ($e instanceof MaxAttemptsExceededException && !$record->isStale($state)) {
            Log::warning('ReindexTenantSearchJob: a second delivery was given up while the run is still reporting', [
                'tenant_id' => $this->tenantId,
            ]);

            return;
        }

        $this->writeFailed($record, is_string($state['started_at'] ?? null) ? $state['started_at'] : null);
        Log::error('ReindexTenantSearchJob permanently failed', [
            'tenant_id' => $this->tenantId,
            'requested_by' => $this->requestedBy,
            'exception' => $e::class,
            'error' => $e->getMessage(),
        ]);
    }

    /** @param array<string, mixed>|null $state */
    private function isCurrentSlice(?array $state): bool
    {
        if ($state === null || $this->runId === null || ($state['run_id'] ?? null) !== $this->runId) {
            return false;
        }
        if (!in_array($state['state'] ?? null, ['queued', 'running'], true)) {
            return false;
        }
        if (!isset(SearchReindexService::TYPES[$this->kindIndex])) {
            return false;
        }
        $cursor = is_array($state['cursor'] ?? null) ? $state['cursor'] : [];

        return (int) ($cursor['kind'] ?? -1) === $this->kindIndex
            && (int) ($cursor['after_id'] ?? -1) === $this->afterId;
    }

    /**
     * @param array<string, int> $partial
     * @return array<string, mixed>
     */
    private function runningState(string $startedAt, array $partial, int $errors, int $kind, int $afterId): array
    {
        return [
            'state' => 'running',
            'started_at' => $startedAt,
            'finished_at' => null,
            'counts' => null,
            'errors' => $errors,
            'run_id' => $this->runId,
            'cursor' => ['kind' => $kind, 'after_id' => $afterId],
            'partial' => $partial,
        ];
    }

    /** @param array<string, int> $partial */
    private function writeDone(SearchRebuildService $record, string $startedAt, array $partial, int $errors): void
    {
        $counts = [];
        foreach (SearchReindexService::TYPES as $type) {
            $counts[$type] = (int) ($partial[$type] ?? 0);
        }

        $record->write($this->tenantId, [
            'state' => 'done',
            'started_at' => $startedAt,
            'finished_at' => now()->toIso8601String(),
            'counts' => $counts,
            'errors' => $errors,
            'run_id' => $this->runId,
        ]);

        Log::info('ReindexTenantSearchJob: search rebuilt', [
            'tenant_id' => $this->tenantId,
            'requested_by' => $this->requestedBy,
            'counts' => $counts,
            'errors' => $errors,
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
            'run_id' => $this->runId,
        ]);
    }
}
