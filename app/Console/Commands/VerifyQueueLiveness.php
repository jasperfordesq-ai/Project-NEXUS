<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Console\Commands;

use App\Jobs\QueueHeartbeatJob;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Redis;

/**
 * queue:verify-liveness — alarm when queue workers stop processing jobs.
 *
 * Companion to QueueHeartbeatJob: the scheduler dispatches a heartbeat every
 * 5 minutes and stamps dispatched_at; a real worker stamps processed_at.
 * This command (run from the scheduler container, which is independent of
 * the queue container) alarms when heartbeats are being dispatched but stop
 * coming back — the failure mode of the 2026-06-06→11 outage, where Horizon's
 * master ran "healthy" for 5 days while every worker crashed at boot.
 *
 * Alerts go to the error log AND report() (Sentry), throttled to one alert
 * per 6 hours so a weekend outage doesn't flood the inbox. The current
 * verdict is also cached for dashboards (queue_heartbeat:status).
 */
class VerifyQueueLiveness extends Command
{
    protected $signature = 'queue:verify-liveness';

    protected $description = 'Alert when queue heartbeats are dispatched but never processed (dead workers)';

    public const DISPATCHED_AT_KEY = 'queue_heartbeat:dispatched_at';

    public const STATUS_KEY = 'queue_heartbeat:status';

    /**
     * When heartbeat dispatching last (re)started after a gap. A blue/green
     * deploy stops the old colour's scheduler and workers before the new
     * scheduler starts, so the first heartbeat afterwards is checked within
     * seconds of being dispatched — before any worker could run it. That raised
     * a false "workers dead" alarm on every deploy (Sentry NEXUS-PHP-2F).
     */
    public const RESUMED_AT_KEY = 'queue_heartbeat:resumed_at';

    private const ALERT_THROTTLE_KEY = 'queue_heartbeat:alerted';

    /** Heartbeats run every 5 min; 15 min of silence = at least 2 missed. */
    private const STALE_AFTER_SECONDS = 900;

    /** A dispatch gap longer than two heartbeat intervals means dispatching stopped and resumed. */
    private const RESUME_GAP_SECONDS = 600;

    /**
     * Stamp a heartbeat dispatch. Called by the scheduler (bootstrap/app.php)
     * right before QueueHeartbeatJob is dispatched.
     */
    public static function recordDispatch(): void
    {
        $now = now()->getTimestamp();
        $previous = Cache::get(self::DISPATCHED_AT_KEY);

        if ($previous === null || $now - (int) $previous > self::RESUME_GAP_SECONDS) {
            Cache::put(self::RESUMED_AT_KEY, $now, QueueHeartbeatJob::STAMP_TTL_SECONDS);
        }

        Cache::put(self::DISPATCHED_AT_KEY, $now, QueueHeartbeatJob::STAMP_TTL_SECONDS);
    }

    /** One alert per 6 hours. */
    private const ALERT_THROTTLE_SECONDS = 21600;

    public function handle(): int
    {
        $now = now()->getTimestamp();
        $dispatchedAt = Cache::get(self::DISPATCHED_AT_KEY);
        $processedAt = Cache::get(QueueHeartbeatJob::PROCESSED_AT_KEY);

        // No heartbeat dispatched yet (fresh boot / first deploy of this
        // feature) — nothing to judge.
        if ($dispatchedAt === null) {
            $this->info('No heartbeat dispatched yet — skipping.');

            return self::SUCCESS;
        }

        // Workers only get blamed once a heartbeat has had time to round-trip.
        $oldestExpected = $now - self::STALE_AFTER_SECONDS;

        // Dispatching only just resumed after a gap (e.g. the scheduler swap in
        // a blue/green deploy): the heartbeats so far have not had a full window
        // to come back. Judge on a later run — a real outage still alarms once
        // dispatching has been continuous for STALE_AFTER_SECONDS.
        $resumedAt = Cache::get(self::RESUMED_AT_KEY);
        if ($resumedAt !== null && (int) $resumedAt > $oldestExpected
            && ($processedAt === null || (int) $processedAt < (int) $resumedAt)) {
            Cache::put(self::STATUS_KEY, ['state' => 'pending', 'checked_at' => $now, 'resumed_at' => (int) $resumedAt], QueueHeartbeatJob::STAMP_TTL_SECONDS);
            $this->info('Heartbeat dispatching only just resumed — waiting for a full round trip.');

            return self::SUCCESS;
        }
        $healthy = ($dispatchedAt > $oldestExpected) // dispatch side alive recently…
            ? ($processedAt !== null && $processedAt > $oldestExpected) // …so a recent processing stamp is required
            : true; // dispatch side itself idle/stale — scheduler problem, not worker death; don't false-alarm

        if ($healthy) {
            Cache::put(self::STATUS_KEY, ['state' => 'ok', 'checked_at' => $now], QueueHeartbeatJob::STAMP_TTL_SECONDS);
            $this->info('Queue workers healthy.');

            return self::SUCCESS;
        }

        $context = [
            'dispatched_at' => $dispatchedAt,
            'processed_at' => $processedAt,
            'lag_seconds' => $processedAt !== null ? $now - (int) $processedAt : null,
            'queue_lengths' => $this->queueLengths(),
        ];

        Cache::put(self::STATUS_KEY, ['state' => 'failed', 'checked_at' => $now] + $context, QueueHeartbeatJob::STAMP_TTL_SECONDS);
        Log::error('QUEUE LIVENESS FAILED: heartbeats dispatched but not processed — workers are dead or stuck.', $context);

        // Cache::add is atomic — only the first failing run per window reports.
        if (Cache::add(self::ALERT_THROTTLE_KEY, $now, self::ALERT_THROTTLE_SECONDS)) {
            report(new \RuntimeException(
                'Queue workers are not processing jobs: heartbeat dispatched at '
                . date('c', (int) $dispatchedAt) . ' but last processed at '
                . ($processedAt !== null ? date('c', (int) $processedAt) : 'NEVER')
                . '. Check `ps aux | grep horizon:work` in the queue container.'
            ));
        }

        $this->error('Queue workers are NOT processing jobs.');

        return self::FAILURE;
    }

    /**
     * Best-effort pending-job counts for alert context. Never throws.
     *
     * @return array<string, int|string>
     */
    private function queueLengths(): array
    {
        $lengths = [];
        foreach (['federation-high', 'federation', 'default'] as $queue) {
            try {
                $lengths[$queue] = (int) Redis::connection()->llen('queues:' . $queue);
            } catch (\Throwable $e) {
                $lengths[$queue] = 'unavailable';
            }
        }

        return $lengths;
    }
}
