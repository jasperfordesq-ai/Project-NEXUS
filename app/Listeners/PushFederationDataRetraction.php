<?php
// Copyright Â© 2024â€“2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Listeners;

use App\Core\TenantContext;
use App\Events\UserFederatedOptOut;
use App\Models\FederatedIdentity;
use App\Services\FederationExternalApiClient;
use App\Services\FederationFeatureService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Log;

/**
 * PushFederationDataRetraction â€” GDPR Article 17 enforcement for federated data.
 *
 * When a user deletes their account or opts out of federation, this listener
 * notifies every active federated partner that holds a linked identity for
 * this user, instructing them to retract (delete) the user's mirrored profile.
 *
 * Runs asynchronously on the queue to avoid blocking the HTTP response.
 */
class PushFederationDataRetraction implements ShouldQueue
{
    /** Route to the standard federation queue (bulk, non-time-critical). */
    public string $queue = 'federation';

    /**
     * GDPR erasure must not be fire-and-forget: if a partner API is down, the
     * retraction is retried (5 min / 30 min / 2 h) instead of silently lost.
     * Retraction is idempotent on the partner side, so re-sending to partners
     * that already succeeded on an earlier attempt is safe. The timeout stays
     * below the queue's retry_after (90s) so a slow run cannot be
     * double-delivered mid-flight.
     */
    public int $tries = 4;

    public int $timeout = 75;

    /** @return array<int,int> */
    public function backoff(): array
    {
        return [300, 1800, 7200];
    }

    public function __construct(
        private readonly FederationFeatureService $federationFeatureService,
    ) {}

    public function handle(UserFederatedOptOut $event): void
    {
        $userId   = $event->userId;
        $tenantId = $event->tenantId;
        $previousTenantId = TenantContext::currentId();
        $failedPartners = [];

        // F-352: INTERNAL cross-community connections first, and before every
        // gate below. This listener's own comment promises retraction reaches
        // "all federated partners", but `federated_identities` rows exist only
        // for EXTERNAL partners, so internal cross-tenant federation — which is
        // live and ungated by design — was never reached and the partner
        // community carried on reading the member's name and avatar.
        //
        // It runs ahead of the tenant/feature checks deliberately: a community
        // that has since switched federation off, or lost the feature, still
        // holds connection rows that this member's opt-out or erasure must end.
        // The delete is idempotent, so running it here as well as in
        // FederationUserService::optOut() is safe.
        try {
            $severed = \App\Services\FederationUserService::severInternalFederatedConnections($userId, $tenantId);
            if ($severed > 0) {
                Log::info('PushFederationDataRetraction: internal cross-community connections severed', [
                    'tenant_id' => $tenantId,
                    'user_id'   => $userId,
                    'reason'    => $event->reason,
                    'severed'   => $severed,
                ]);
            }
        } catch (\Throwable $e) {
            // Not swallowed into a success: re-thrown so the queue retries and
            // `failed()` surfaces it if every retry is exhausted. A consent
            // withdrawal that silently did nothing is the defect being fixed.
            Log::error('PushFederationDataRetraction: internal connection severing failed', [
                'tenant_id' => $tenantId,
                'user_id'   => $userId,
                'error'     => $e->getMessage(),
            ]);
            throw $e;
        }

        try {
            if (!TenantContext::setById($tenantId)) {
                Log::warning('PushFederationDataRetraction: tenant not found, skipping', [
                    'tenant_id' => $tenantId,
                    'user_id'   => $userId,
                ]);
                return;
            }

            if (!TenantContext::hasFeature('federation')) {
                return;
            }

            if (!$this->federationFeatureService->isTenantFederationEnabled($tenantId)) {
                return;
            }

            // Find all federated identities for this user (cross-partner links)
            $identities = FederatedIdentity::query()
                ->where('tenant_id', $tenantId)
                ->where('local_user_id', $userId)
                ->get();

            if ($identities->isEmpty()) {
                return;
            }

            // Notify every linked partner, even if member-sync is currently disabled.
            foreach ($identities as $identity) {
                $partnerId = (int) $identity->partner_id;
                if ($partnerId <= 0) {
                    continue;
                }

                // F-485: a partner the operator has suspended or removed cannot
                // be dispatched to at all (FederationExternalApiClient::
                // getPartner() queries only 'active'/'failed'). That is an
                // operator state on THIS side, not a transient partner fault,
                // so it must not drive the retry loop — but the erasure really
                // was not propagated, so it is logged at error rather than
                // passing silently.
                $dispatchable = \Illuminate\Support\Facades\DB::table('federation_external_partners')
                    ->where('id', $partnerId)
                    ->where('tenant_id', $tenantId)
                    ->whereIn('status', ['active', 'failed'])
                    ->exists();

                if (! $dispatchable) {
                    Log::error('PushFederationDataRetraction: retraction NOT sent — partner is suspended or gone', [
                        'partner_id' => $partnerId,
                        'tenant_id'  => $tenantId,
                        'user_id'    => $userId,
                        'reason'     => $event->reason,
                    ]);
                    continue;
                }

                try {
                    $result = FederationExternalApiClient::retractMemberProfile($partnerId, $userId, [
                        'external_user_id' => $identity->external_user_id,
                        'reason'           => $event->reason,
                    ]);

                    // F-485: the client catches every transport exception
                    // itself and RETURNS ['success' => false, …] — it does not
                    // throw. Collecting a failure only in the catch below meant
                    // $failedPartners always stayed empty, so the declared
                    // retries never ran and failed() never fired: a refused
                    // GDPR erasure was recorded as a success. Inspect the
                    // returned array, exactly as
                    // PushTransactionToFederatedPartner (:91-103) does.
                    if (empty($result['success'])) {
                        if (! empty($result['blocked'])) {
                            // Refused by the external-federation kill switch —
                            // a deliberate operator state, not a partner fault.
                            // Retrying cannot help and would burn the attempts
                            // and alert on every queued retraction until the
                            // switch is turned back on (the same exception
                            // PushTransactionToFederatedPartner documents).
                            // Logged at error so it is still visible that an
                            // erasure was not propagated.
                            Log::error('PushFederationDataRetraction: retraction NOT sent — external federation is switched off', [
                                'partner_id' => $partnerId,
                                'tenant_id'  => $tenantId,
                                'user_id'    => $userId,
                                'reason'     => $event->reason,
                            ]);
                        } else {
                            $failedPartners[] = $partnerId;
                            Log::warning('PushFederationDataRetraction: partner refused the retraction', [
                                'partner_id'  => $partnerId,
                                'tenant_id'   => $tenantId,
                                'user_id'     => $userId,
                                'error'       => $result['error'] ?? null,
                                'status_code' => $result['status_code'] ?? null,
                            ]);
                        }
                    }
                } catch (\Throwable $e) {
                    $failedPartners[] = $partnerId;
                    Log::warning('PushFederationDataRetraction: retraction failed for partner', [
                        'partner_id' => $partnerId,
                        'tenant_id'  => $tenantId,
                        'user_id'    => $userId,
                        'error'      => $e->getMessage(),
                    ]);
                }
            }
        } catch (\Throwable $e) {
            Log::error('PushFederationDataRetraction listener failed', [
                'tenant_id' => $tenantId ?? null,
                'user_id'   => $userId ?? null,
                'error'     => $e->getMessage(),
            ]);
        } finally {
            TenantContext::restoreAfterScopedListener($previousTenantId);
        }

        // Throw OUTSIDE the try/finally so the queue re-delivers this listener
        // and the failed partners are attempted again (see $tries/backoff).
        if (!empty($failedPartners)) {
            throw new \RuntimeException(
                'Federation data retraction failed for partner(s) ' . implode(',', $failedPartners)
                . " (user {$userId}, tenant {$tenantId}) — will retry"
            );
        }
    }

    public function failed(UserFederatedOptOut $event, \Throwable $exception): void
    {
        // All retries exhausted — surface loudly so an operator can retract
        // manually from the federation admin; the user's GDPR erasure locally
        // has already completed regardless.
        Log::error('PushFederationDataRetraction: PERMANENT failure after retries — manual partner retraction needed', [
            'tenant_id' => $event->tenantId,
            'user_id'   => $event->userId,
            'reason'    => $event->reason,
            'error'     => $exception->getMessage(),
        ]);
    }
}
