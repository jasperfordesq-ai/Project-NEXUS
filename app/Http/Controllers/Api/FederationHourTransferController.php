<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Services\CaringCommunity\CaringHourTransferService;
use App\Services\CaringCommunity\FederationPeerService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;

/**
 * FederationHourTransferController — AG23 follow-up
 *
 * Inbound endpoint for cross-platform hour transfers from a registered
 * federation peer. The endpoint is open (no auth header), but every call
 * requires a valid HMAC signature against the per-pair shared secret stored
 * locally in `caring_federation_peers`. Idempotency is applied by
 * `(source_tenant_slug, source_transfer_id)` so retries are safe.
 *
 * The destination tenant is identified from the request payload's
 * `destination_tenant_slug`. The source peer is identified from
 * `source_tenant_slug`. If either is missing or unregistered, the request
 * is rejected.
 */
class FederationHourTransferController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly FederationPeerService $peers,
        private readonly CaringHourTransferService $transfers,
    ) {
    }

    /**
     * POST /api/v2/federation/hour-transfer/inbound
     *
     * Public route — auth is signature-based, not session-based.
     */
    public function inbound(): JsonResponse
    {
        $input = $this->getAllInput();
        $payload = is_array($input['payload'] ?? null) ? $input['payload'] : null;
        $signature = (string) ($input['signature'] ?? '');

        if (! is_array($payload) || $signature === '') {
            return $this->respondWithError('FEDERATION_PAYLOAD_INVALID', 'Missing payload or signature.', null, 400);
        }

        $sourceSlug = (string) ($payload['source_tenant_slug'] ?? '');
        $destinationSlug = (string) ($payload['destination_tenant_slug'] ?? '');
        if ($sourceSlug === '' || $destinationSlug === '') {
            return $this->respondWithError('FEDERATION_PAYLOAD_INVALID', 'Source and destination slugs are required.', null, 400);
        }

        $context = $this->peers->findInboundContext($destinationSlug, $sourceSlug);
        if (! $context) {
            // Do not reveal whether the destination tenant exists or whether
            // the peer is registered — both responses look identical.
            return $this->respondWithError('FEDERATION_PEER_UNKNOWN', 'Peer is not registered for this destination.', null, 404);
        }

        $peer = $context['peer'];
        if (($peer['status'] ?? '') !== 'active') {
            return $this->respondWithError('FEDERATION_PEER_INACTIVE', 'Peer is not active.', null, 403);
        }

        $destinationTenantId = (int) $context['tenant']['id'];

        // Run the transfer in the destination tenant's own scope. We don't
        // need TenantContext since the service takes the tenant id directly.
        try {
            $result = $this->transfers->acceptRemoteTransfer(
                destinationTenantId: $destinationTenantId,
                peer: $peer,
                payload: $payload,
                signature: $signature,
            );
        } catch (\Throwable $e) {
            Log::error('[Federation] inbound failure', [
                'source' => $sourceSlug,
                'destination' => $destinationSlug,
                'error' => $e->getMessage(),
            ]);
            return $this->respondWithError('FEDERATION_INBOUND_FAILED', 'Internal failure during inbound delivery.', null, 500);
        }

        if (! $result['accepted']) {
            $reason = $result['error'] ?? 'rejected';
            $status = $reason === CaringHourTransferService::REJECT_SIGNATURE_INVALID ? 401 : 422;
            return response()->json([
                'success'  => false,
                'accepted' => false,
                'error'    => $reason,
            ], $status);
        }

        // Update last_handshake_at for this peer
        try {
            $this->peers->recordHandshake($destinationTenantId, (int) $peer['id']);
        } catch (\Throwable $e) {
            // Non-fatal — the transfer succeeded; only the handshake log failed.
            Log::warning('[Federation] handshake log failed: ' . $e->getMessage());
        }

        return response()->json([
            'success'                 => true,
            'accepted'                => true,
            'destination_transfer_id' => $result['destination_transfer_id'],
            'duplicated'              => $result['duplicated'],
        ]);
    }

}
