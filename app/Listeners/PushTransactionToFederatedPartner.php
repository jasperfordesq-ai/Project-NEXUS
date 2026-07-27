<?php
// Copyright Â© 2024â€“2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Listeners;

use App\Core\TenantContext;
use App\Events\TransactionCompleted;
use App\Services\FederationExternalApiClient;
use App\Services\FederationFeatureService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Log;

/**
 * PushTransactionToFederatedPartner â€” pushes a completed local transaction
 * to an external federation partner when either participant is federated.
 *
 * Queued so the local wallet flow is never blocked by outbound HTTP.
 * Client-side circuit breaker + retry handles transient failures.
 */
class PushTransactionToFederatedPartner implements ShouldQueue
{
    /** Process on the high-priority federation queue to minimise transaction latency. */
    public string $queue = 'federation-high';

    public int $tries = 3;

    public array $backoff = [60, 300, 900];

    public function __construct(
        private readonly FederationFeatureService $federationFeatureService,
    ) {}

    public function handle(TransactionCompleted $event): void
    {
        $previousTenantId = TenantContext::currentId();

        try {
            if (!TenantContext::setById($event->tenantId)) {
                Log::warning('PushTransactionToFederatedPartner: tenant not found, skipping', [
                    'tenant_id'      => $event->tenantId,
                    'transaction_id' => $event->transaction->id ?? null,
                ]);
                return;
            }

            if (!TenantContext::hasFeature('federation')) {
                return;
            }

            if (!$this->federationFeatureService->isTenantFederationEnabled($event->tenantId)) {
                return;
            }

            $transaction = $event->transaction;

            // Only forward federated transactions
            if (empty($transaction->is_federated)) {
                return;
            }

            $partnerId = (int) ($transaction->external_partner_id ?? 0);

            if ($partnerId <= 0) {
                // Nothing to push â€” transaction is flagged federated but has
                // no external partner linkage (purely cross-tenant internal).
                return;
            }

            $payload = [
                'id'              => $transaction->id,
                'amount'          => $transaction->amount,
                'description'     => $transaction->description,
                'sender_id'       => $event->sender->id,
                'receiver_id'     => $event->receiver->id,
                'recipient_id'    => $event->receiver->id,
                'sender_user_id'  => $event->sender->id,
                'receiver_user_id' => $event->receiver->id,
                'sender_tenant'   => $event->tenantId,
                'sender_tenant_id' => $event->tenantId,
                'receiver_tenant_id' => $transaction->receiver_tenant_id ?? $event->receiver->tenant_id ?? null,
                'created_at'      => $transaction->created_at?->toISOString(),
            ];

            $result = FederationExternalApiClient::createTransaction($partnerId, $payload);

            if (empty($result['success'])) {
                Log::warning('PushTransactionToFederatedPartner: partner rejected transaction', [
                    'partner_id'     => $partnerId,
                    'tenant_id'      => $event->tenantId,
                    'transaction_id' => $transaction->id,
                    'error'          => $result['error'] ?? null,
                    'status_code'    => $result['status_code'] ?? null,
                ]);

                if ($this->isRetryablePartnerFailure($result)) {
                    throw new \RuntimeException('Retryable federation transaction push failure: ' . ($result['error'] ?? 'unknown error'));
                }
            }
        } catch (\Throwable $e) {
            Log::error('PushTransactionToFederatedPartner listener failed', [
                'tenant_id'      => $event->tenantId ?? null,
                'transaction_id' => $event->transaction->id ?? null,
                'error'          => $e->getMessage(),
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
