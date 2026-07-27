<?php
// Copyright Â© 2024â€“2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Listeners;

use App\Core\TenantContext;
use App\Events\MessageSent;
use App\Services\FederationExternalApiClient;
use App\Services\FederationFeatureService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * PushMessageToFederatedPartner â€” forwards a locally-sent message to an
 * external federation partner when the recipient is federated.
 *
 * Only triggers when the underlying Message row has is_federated=1 AND the
 * receiver user is linked to an external partner. Queued so it never blocks
 * the local conversation UI. The V2 controller's explicit sendMessage()
 * endpoint remains the primary path; this listener is a safety net for
 * local writes that flag a message as federated.
 */
class PushMessageToFederatedPartner implements ShouldQueue
{
    /** Process on the high-priority federation queue to minimise message latency. */
    public string $queue = 'federation-high';

    public int $tries = 3;

    public array $backoff = [60, 300, 900];

    public function __construct(
        private readonly FederationFeatureService $federationFeatureService,
    ) {}

    public function handle(MessageSent $event): void
    {
        $previousTenantId = TenantContext::currentId();

        try {
            if (!TenantContext::setById($event->tenantId)) {
                Log::warning('PushMessageToFederatedPartner: tenant not found, skipping', [
                    'tenant_id'  => $event->tenantId,
                    'message_id' => $event->message->id ?? null,
                ]);
                return;
            }

            if (!TenantContext::hasFeature('federation')) {
                return;
            }

            if (!$this->federationFeatureService->isTenantFederationEnabled($event->tenantId)) {
                return;
            }

            $message = $event->message;

            // Only forward messages explicitly flagged as federated
            if (empty($message->is_federated)) {
                return;
            }

            // Resolve receiver's federated partner â€” by convention, a federated
            // recipient has a row in federation_external_user_map or the message
            // itself carries external_partner_id. We check the message first,
            // then fall back to looking up any external partner whose directory
            // maps the receiver_id.
            $partnerId = (int) ($message->external_partner_id ?? 0);
            $externalReceiverId = $message->external_receiver_id ?? null;

            if ($partnerId <= 0 || !$externalReceiverId) {
                // Try the federation_messages shadow row
                $row = DB::table('federation_messages')
                    ->where('reference_message_id', $message->id)
                    ->where('sender_tenant_id', $event->tenantId)
                    ->where('direction', 'outbound')
                    ->whereNotNull('external_partner_id')
                    ->first();

                if ($row) {
                    $partnerId = (int) $row->external_partner_id;
                    $externalReceiverId = $row->external_receiver_id ?? $row->receiver_user_id;
                }
            }

            if ($partnerId <= 0) {
                // Nothing to push â€” this is a purely local message flagged
                // federated (rare). Not an error.
                return;
            }

            $payload = [
                'sender_id'         => $event->sender->id,
                'sender_user_id'    => $event->sender->id,
                'sender_tenant_id'  => $event->tenantId,
                'receiver_id'       => $externalReceiverId,
                'receiver_user_id'  => $externalReceiverId,
                'recipient_id'      => $externalReceiverId,
                'external_receiver_id' => $externalReceiverId,
                'subject'           => $message->subject ?? '',
                'body'              => $message->body ?? '',
                'message_id'        => $message->id,
                'conversation_id'   => $event->conversationId,
                'created_at'        => $message->created_at?->toISOString(),
            ];

            $result = FederationExternalApiClient::sendMessage($partnerId, $payload);

            if (empty($result['success'])) {
                Log::warning('PushMessageToFederatedPartner: partner rejected message', [
                    'partner_id' => $partnerId,
                    'tenant_id'  => $event->tenantId,
                    'message_id' => $message->id,
                    'error'      => $result['error'] ?? null,
                    'status_code' => $result['status_code'] ?? null,
                ]);

                if ($this->isRetryablePartnerFailure($result)) {
                    throw new \RuntimeException('Retryable federation message push failure: ' . ($result['error'] ?? 'unknown error'));
                }
            }
        } catch (\Throwable $e) {
            Log::error('PushMessageToFederatedPartner listener failed', [
                'tenant_id'  => $event->tenantId ?? null,
                'message_id' => $event->message->id ?? null,
                'error'      => $e->getMessage(),
            ]);

            throw $e;
        } finally {
            TenantContext::restoreAfterScopedListener($previousTenantId);
        }
    }

    /**
     * @param array<string,mixed> $result
     */
    private function isRetryablePartnerFailure(array $result): bool
    {
        // A push refused by the external federation kill switch is a deliberate
        // operator state, not a transient partner fault. Retrying cannot help:
        // it would burn the job's attempts and raise alerts on every queued
        // push until the switch is turned back on. The client reports these
        // with status_code 0, which would otherwise classify as retryable.
        if (! empty($result['blocked'])) {
            return false;
        }

        $statusCode = (int) ($result['status_code'] ?? $result['code'] ?? 0);

        return $statusCode === 0 || $statusCode >= 500;
    }
}
