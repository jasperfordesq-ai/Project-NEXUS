<?php
// Copyright Â© 2024â€“2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Listeners;

use App\Core\TenantContext;
use App\Events\ListingCreated;
use App\Events\ListingUpdated;
use App\Services\FederationExternalApiClient;
use App\Services\FederationExternalPartnerService;
use App\Services\FederationFeatureService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Log;

/**
 * PushListingToFederatedPartners â€” broadcasts new local listings to active
 * external federation partners that have allow_listing_search=1.
 *
 * Runs asynchronously via the queue so local listing creation is never blocked
 * by outbound HTTP calls. The underlying FederationExternalApiClient handles
 * circuit breaking and retries, so failures here are logged but never rethrown.
 */
class PushListingToFederatedPartners implements ShouldQueue
{
    /** Route to the standard federation queue (bulk, non-time-critical). */
    public string $queue = 'federation';

    public function __construct(
        private readonly FederationFeatureService $federationFeatureService,
    ) {}

    public function handle(ListingCreated|ListingUpdated $event): void
    {
        $previousTenantId = TenantContext::currentId();

        try {
            // Ensure tenant context is set for queued execution.
            if (!TenantContext::setById($event->tenantId)) {
                Log::warning('PushListingToFederatedPartners: tenant not found, skipping', [
                    'tenant_id'  => $event->tenantId,
                    'listing_id' => $event->listing->id ?? null,
                ]);
                return;
            }

            // 1. Tenant-level feature gate â€” CLAUDE.md mandates TenantContext::hasFeature
            if (!TenantContext::hasFeature('federation')) {
                return;
            }

            // 2. System-level + whitelist gate via FederationFeatureService
            if (!$this->federationFeatureService->isTenantFederationEnabled($event->tenantId)) {
                return;
            }

            // 3. Only share published listings that passed moderation.
            $isPublished = ($event->listing->status ?? 'active') === 'active'
                && (($event->listing->moderation_status ?? 'approved') === 'approved');

            // 4. Only share listings whose federated_visibility allows it
            $visibility = $event->listing->federated_visibility ?? 'local';
            $isShared = in_array($visibility, ['listed', 'bookable'], true);

            // 5. F-413: and only when the OWNER consented to federation. Every
            // PULL path the platform offers a partner already requires this —
            // FederationController::getListings()/getListing() and
            // FederationInitialSyncJob::countActiveListings(), the platform's
            // own count of "listings shared with partners", all require
            // federation_optin = 1 AND profile_visible_federated = 1 AND
            // appear_in_federated_search = 1. The push path did not, so a
            // member who withdrew consent still had their listing's title,
            // description and local user id handed to every active partner on
            // the next edit.
            $ownerConsented = $this->ownerConsentedToFederation((int) ($event->user->id ?? 0));

            $shareable = $isPublished && $isShared && $ownerConsented;

            $action = $event instanceof ListingCreated ? 'created' : 'updated';

            if (!$shareable) {
                // F-414: a listing the partner ALREADY holds must be retracted
                // when it is un-shared, closed or deleted — not silently left
                // displayed on partner sites for ever. Same design as
                // PushVolunteerOpportunityToFederatedPartners:80-104: only an
                // UPDATE can retract, and only when the listing was shared
                // before this change. A never-shared listing has nothing to
                // retract.
                $wasShared = $event instanceof ListingUpdated
                    && in_array($event->previousFederatedVisibility ?? '', ['listed', 'bookable'], true);

                if (!$wasShared) {
                    return;
                }

                $action = 'deleted';
            }

            $partners = FederationExternalPartnerService::getActivePartnersForListings($event->tenantId);
            if (empty($partners)) {
                return;
            }

            $payload = $this->buildPayload($event, $action);

            foreach ($partners as $partner) {
                $partnerId = (int) ($partner['id'] ?? 0);
                if ($partnerId <= 0) {
                    continue;
                }

                try {
                    $result = FederationExternalApiClient::sendListing($partnerId, $payload);

                    if (empty($result['success'])) {
                        Log::warning('PushListingToFederatedPartners: partner rejected listing', [
                            'partner_id' => $partnerId,
                            'tenant_id'  => $event->tenantId,
                            'listing_id' => $event->listing->id,
                            'error'      => $result['error'] ?? null,
                        ]);
                    }
                } catch (\Throwable $e) {
                    // Circuit breaker in client already handles retries.
                    // Catch here so a single bad partner doesn't skip the rest.
                    Log::warning('PushListingToFederatedPartners: partner push failed', [
                        'partner_id' => $partnerId,
                        'tenant_id'  => $event->tenantId,
                        'listing_id' => $event->listing->id,
                        'error'      => $e->getMessage(),
                    ]);
                }
            }
        } catch (\Throwable $e) {
            Log::error('PushListingToFederatedPartners listener failed', [
                'tenant_id'  => $event->tenantId ?? null,
                'listing_id' => $event->listing->id ?? null,
                'error'      => $e->getMessage(),
            ]);
        } finally {
            TenantContext::restoreAfterScopedListener($previousTenantId);
        }
    }

    /**
     * Does the listing's owner still consent to federation?
     *
     * The predicate is the one five other paths already use — see
     * FederationInitialSyncJob::countActiveListings(). A member with no
     * `federation_user_settings` row has never opted in, so the absence of a
     * row is a refusal, not a default-allow.
     */
    private function ownerConsentedToFederation(int $ownerId): bool
    {
        if ($ownerId <= 0) {
            return false;
        }

        return \Illuminate\Support\Facades\DB::table('federation_user_settings')
            ->where('user_id', $ownerId)
            ->where('federation_optin', 1)
            ->where('profile_visible_federated', 1)
            ->where('appear_in_federated_search', 1)
            ->exists();
    }

    /**
     * Build a listing payload for outbound federation push.
     * Adapter transforms this into the wire format per partner protocol.
     */
    private function buildPayload(ListingCreated|ListingUpdated $event, string $action): array
    {
        $listing = $event->listing;

        // F-414: a retraction carries only what the partner needs to find the
        // row it already holds. It must not re-send the title and description —
        // the member may have reached this path precisely by withdrawing
        // federation consent (F-413).
        if ($action === 'deleted') {
            return [
                'action'    => 'deleted',
                'id'        => $listing->id,
                'tenant_id' => $event->tenantId,
            ];
        }

        return [
            'action'         => $action,
            'id'             => $listing->id,
            'title'          => $listing->title,
            'description'    => $listing->description,
            'type'           => $listing->type ?? null,
            'category_id'    => $listing->category_id ?? null,
            'user_id'        => $event->user->id,
            'tenant_id'      => $event->tenantId,
            'created_at'     => $listing->created_at?->toISOString(),
            'updated_at'     => $listing->updated_at?->toISOString(),
            'visibility'     => $listing->federated_visibility ?? 'listed',
        ];
    }
}
