<?php
// Copyright Â© 2024â€“2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Listeners;

use App\Core\TenantContext;
use App\Events\MessageSent;
use App\Services\BrokerMessageVisibilityService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * Checks every sent message against broker visibility rules and copies
 * it to the broker review queue when criteria are met.
 *
 * Criteria (evaluated by BrokerMessageVisibilityService):
 * - Sender is under safeguarding monitoring (flagged user)
 * - First contact between two members
 * - Sender is a new member (within monitoring window)
 * - Message relates to a high-risk listing
 * - Random compliance sampling
 *
 * Queued so it never delays message delivery to the recipient.
 */
class CopyMessageForBrokerReview implements ShouldQueue
{
    /**
     * Fail fast rather than letting redis re-deliver mid-flight. The queue's
     * retry_after is 90s; a slow run released back to another worker would
     * copy the same message to the broker review queue twice. Killing at 60s
     * and not retrying keeps one message → at most one broker copy.
     * Belt-and-braces with the Cache guard in handle().
     */
    public int $tries = 1;
    public int $timeout = 60;

    public function __construct()
    {
        //
    }

    public function handle(MessageSent $event): void
    {
        // Idempotency guard: suppress duplicate/concurrent re-deliveries for the
        // same message so it is copied to the broker queue at most once.
        $messageId = (int) ($event->message->id ?? 0);
        $guardTenantId = (int) ($event->tenantId ?? 0);
        $handledKey = null;
        $claimKey = null;
        $claimAcquired = false;
        if ($messageId > 0) {
            $handledKey = 'copy_message_broker_review:done:' . $guardTenantId . ':' . $messageId;
            $claimKey = 'copy_message_broker_review:claim:' . $guardTenantId . ':' . $messageId;
            if (Cache::has($handledKey)) {
                Log::info('CopyMessageForBrokerReview: duplicate delivery suppressed', ['message_id' => $messageId, 'tenant_id' => $guardTenantId]);
                return;
            }
            $claimAcquired = Cache::add($claimKey, 1, now()->addMinutes(5));
            if (!$claimAcquired) {
                Log::info('CopyMessageForBrokerReview: concurrent delivery suppressed', ['message_id' => $messageId, 'tenant_id' => $guardTenantId]);
                return;
            }
        }

        $previousTenantId = TenantContext::currentId();

        try {
            $message = $event->message;
            $senderId = (int) $message->sender_id;
            $receiverId = (int) $message->receiver_id;
            $listingId = $message->listing_id ? (int) $message->listing_id : null;

            // Set tenant context for the queued job â€” required for HasTenantScope
            // trait and any service that reads TenantContext::getId().
            // F-288: setById() returns false when the community no longer
            // exists. Bail, as NotifyMessageReceived and
            // CopyGroupMessageForBrokerReview do, rather than run the review
            // rules (which read and write first-contact / monitoring rows)
            // under whatever community this worker was last left in.
            if (!$event->tenantId || !TenantContext::setById($event->tenantId)) {
                Log::warning('CopyMessageForBrokerReview: tenant not found, skipping', [
                    'tenant_id' => $event->tenantId,
                    'message_id' => $message->id ?? null,
                ]);
                return;
            }

            /** @var BrokerMessageVisibilityService $visibilityService */
            $visibilityService = app(BrokerMessageVisibilityService::class);

            $copyReason = $visibilityService->shouldCopyMessage($senderId, $receiverId, $listingId);

            if ($copyReason !== null) {
                $visibilityService->copyMessageForBroker($message->id, $copyReason);
            }

            // Mark handled only after the visibility check ran to completion so
            // a redis re-delivery cannot copy the message a second time.
            if ($handledKey !== null) {
                Cache::put($handledKey, 1, now()->addHour());
            }
        } catch (\Throwable $e) {
            Log::error('CopyMessageForBrokerReview: failed', [
                'message_id' => $event->message->id ?? null,
                'tenant_id' => $event->tenantId ?? null,
                'error' => $e->getMessage(),
            ]);
        } finally {
            if ($claimAcquired && $claimKey !== null) {
                Cache::forget($claimKey);
            }
            TenantContext::restoreAfterScopedListener($previousTenantId);
        }
    }
}
