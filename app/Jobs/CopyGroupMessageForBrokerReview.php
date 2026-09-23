<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Jobs;

use App\Core\TenantContext;
use App\Services\BrokerMessageVisibilityService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\Log;

/**
 * Broker review for one group-conversation message (F-086).
 *
 * The group counterpart of the CopyMessageForBrokerReview listener: group
 * messages have no single receiver and do not raise MessageSent, so they are
 * evaluated here against the same copy rules. Queued for the same reason as
 * the listener — copying notifies and may email brokers, which must never
 * delay the sender's request. Runs once, like the listener; the
 * (tenant_id, original_message_id) unique index keeps it to one copy.
 */
final class CopyGroupMessageForBrokerReview implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;

    public int $tries = 1;
    public int $timeout = 60;

    /** @param list<int> $recipientIds */
    public function __construct(
        public readonly int $tenantId,
        public readonly int $messageId,
        public readonly int $senderId,
        public readonly array $recipientIds,
    ) {}

    public function handle(): void
    {
        $previousTenantId = TenantContext::currentId();

        try {
            TenantContext::setById($this->tenantId);
            app(BrokerMessageVisibilityService::class)
                ->copyGroupMessageIfRequired($this->messageId, $this->senderId, $this->recipientIds);
        } catch (\Throwable $e) {
            Log::error('CopyGroupMessageForBrokerReview: failed', [
                'tenant_id' => $this->tenantId,
                'message_id' => $this->messageId,
                'error' => $e->getMessage(),
            ]);
        } finally {
            TenantContext::restoreAfterScopedListener($previousTenantId);
        }
    }
}
