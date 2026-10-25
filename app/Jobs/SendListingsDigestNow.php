<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Jobs;

use App\Core\TenantContext;
use App\Services\AuditLogService;
use App\Services\ListingsDigestService;
use Carbon\CarbonImmutable;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

/**
 * An admin's "send every current offer and request now".
 *
 * One email per member, so it runs on the queue rather than in the admin's
 * request, and in batches: each job emails the next BATCH members after
 * $afterUserId and then queues the job for the batch after that. Horizon
 * stops a job after 55 seconds, so one long job would be cut off part way.
 *
 * Not retried: a batch that failed half way has already emailed some members,
 * and a retry would email them again.
 */
final class SendListingsDigestNow implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    public const BATCH = 40;

    public int $tries = 1;
    public int $timeout = 50;

    /**
     * @param array{sent: int, skipped_empty: int, failed: int} $totals running totals across batches
     */
    public function __construct(
        public readonly int $tenantId,
        public readonly int $adminUserId,
        public readonly int $afterUserId = 0,
        public readonly ?string $startedAt = null,
        public readonly array $totals = ['sent' => 0, 'skipped_empty' => 0, 'failed' => 0],
    ) {
        $this->onQueue('emails');
    }

    public function handle(ListingsDigestService $digest): void
    {
        // Every batch uses the time the admin pressed the button, so the whole
        // send is one round-up in the "already sent" record.
        $now = $this->startedAt !== null ? CarbonImmutable::parse($this->startedAt) : CarbonImmutable::now();

        TenantContext::setById($this->tenantId);
        try {
            $batch = $digest->sendAllBatch($this->tenantId, $this->afterUserId, self::BATCH, $now);

            $totals = [
                'sent' => $this->totals['sent'] + $batch['sent'],
                'skipped_empty' => $this->totals['skipped_empty'] + $batch['skipped_empty'],
                'failed' => $this->totals['failed'] + $batch['failed'],
            ];

            if (!$batch['done']) {
                self::dispatch($this->tenantId, $this->adminUserId, $batch['last_user_id'], $now->toIso8601String(), $totals);

                return;
            }

            Log::info('ListingsDigest: admin send finished', ['tenant_id' => $this->tenantId] + $totals);
            try {
                app(AuditLogService::class)->logAdminAction('listings_digest_send_finished', $this->adminUserId, null, $totals);
            } catch (\Throwable $e) {
                Log::warning('ListingsDigest: audit log failed', ['error' => $e->getMessage()]);
            }
        } finally {
            TenantContext::reset();
        }
    }
}
