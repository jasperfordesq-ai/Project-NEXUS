<?php
// Copyright Â© 2024â€“2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Listeners;

use App\Core\TenantContext;
use App\Events\ReviewCreated;
use App\Models\FederatedIdentity;
use App\Models\Review;
use App\Services\FederationExternalApiClient;
use App\Services\FederationFeatureService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Log;

/**
 * PushReviewToFederatedPartner
 *
 * When a review is created locally and the receiver is a user who has a
 * `federated_identities` row (i.e. they came from an external federation
 * partner), push the review to that partner's API so reputation follows them.
 *
 * Local-only reviews (receiver has no federated identity) are a no-op â€” the
 * existing local review row is all that's needed.
 *
 * Feature-gated the same way as the other federation push listeners:
 *   1. Tenant-level `federation` feature flag
 *   2. System-level + whitelist gate via FederationFeatureService
 */
class PushReviewToFederatedPartner implements ShouldQueue
{
    /** Route to the standard federation queue (bulk, non-time-critical). */
    public string $queue = 'federation';

    public int $tries = 3;

    public array $backoff = [60, 300, 900];

    public function __construct(
        private readonly FederationFeatureService $federationFeatureService,
    ) {}

    public function handle(ReviewCreated $event): void
    {
        $previousTenantId = TenantContext::currentId();

        try {
            // Restore tenant context for the queued worker (no tenant is set
            // on queue boot â€” all DB reads below must be scoped correctly).
            if ($event->tenantId <= 0 || !TenantContext::setById($event->tenantId)) {
                Log::warning('PushReviewToFederatedPartner: tenant not found, skipping', [
                    'tenant_id' => $event->tenantId,
                    'review_id' => $event->review->id ?? null,
                ]);
                return;
            }

            // 1. Tenant-level feature gate
            if (! TenantContext::hasFeature('federation')) {
                return;
            }

            // 2. System-level + whitelist gate via FederationFeatureService
            if ($event->tenantId > 0
                && ! $this->federationFeatureService->isTenantFederationEnabled($event->tenantId)
            ) {
                return;
            }

            $review = $event->review;

            if (! $review instanceof Review) {
                return;
            }

            $receiverId = (int) ($review->receiver_id ?? 0);
            if ($receiverId <= 0) {
                return;
            }

            // Look up ANY federated identity rows for the receiver. A user
            // may be federated to multiple partners â€” push to each so the
            // review lands wherever they have a reputation presence.
            //
            // FederatedIdentity is deliberately NOT tenant-auto-scoped, so the
            // tenant_id filter is mandatory: without it a same-id user under a
            // different tenant could leak this review to the wrong network.
            $identities = FederatedIdentity::query()
                ->where('tenant_id', $event->tenantId)
                ->where('local_user_id', $receiverId)
                ->get();

            if ($identities->isEmpty()) {
                return; // Pure-local review, nothing to push.
            }

            $retryableFailures = [];
            foreach ($identities as $identity) {
                $failure = $this->pushToPartner($review, $identity);
                if ($failure !== null) {
                    $retryableFailures[] = $failure;
                }
            }

            if (!empty($retryableFailures)) {
                throw new \RuntimeException('Retryable federation review push failure: ' . implode('; ', $retryableFailures));
            }
        } catch (\Throwable $e) {
            Log::error('PushReviewToFederatedPartner failed', [
                'review_id' => $event->review->id ?? null,
                'tenant_id' => $event->tenantId ?? null,
                'error'     => $e->getMessage(),
            ]);

            throw $e;
        } finally {
            TenantContext::restoreAfterScopedListener($previousTenantId);
        }
    }

    /**
     * Send a single review to a single partner via the adapter-aware
     * FederationExternalApiClient::sendReview() helper, which resolves the
     * protocol adapter, runs transformOutboundReview(), and POSTs to the
     * protocol-specific endpoint from mapEndpoint('reviews').
     */
    private function pushToPartner(Review $review, FederatedIdentity $identity): ?string
    {
        $partnerId = (int) $identity->partner_id;

        $payload = [
            'rating'                    => (int) $review->rating,
            'comment'                   => $review->comment,
            'transaction_id'            => $review->transaction_id,
            'federation_transaction_id' => $review->federation_transaction_id ?? null,
            'reviewer_id'               => $review->reviewer_id,
            'reviewer_tenant'           => $review->tenant_id,
            'receiver_external_id'      => $identity->external_user_id,
            'external_id'               => (string) $review->id,
            'created_at'                => $review->created_at?->toIso8601String(),
        ];

        try {
            $result = FederationExternalApiClient::sendReview($partnerId, $payload);
            if (empty($result['success'])) {
                Log::warning('Federated review push to partner rejected', [
                    'partner_id' => $partnerId,
                    'review_id'  => $review->id,
                    'error'      => $result['error'] ?? null,
                    'status_code' => $result['status_code'] ?? null,
                ]);

                if ($this->isRetryablePartnerFailure($result)) {
                    return $partnerId . ':' . ($result['error'] ?? 'unknown error');
                }
            }
        } catch (\Throwable $e) {
            Log::warning('Federated review push to partner failed', [
                'partner_id' => $partnerId,
                'review_id'  => $review->id,
                'error'      => $e->getMessage(),
            ]);

            return $partnerId . ':' . $e->getMessage();
        }

        return null;
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
