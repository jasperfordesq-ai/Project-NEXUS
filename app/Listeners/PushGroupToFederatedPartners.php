<?php
// Copyright Â© 2024â€“2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Listeners;

use App\Core\TenantContext;
use App\Enums\GroupStatus;
use App\Events\GroupCreated;
use App\Events\GroupUpdated;
use App\Services\FederationExternalApiClient;
use App\Services\FederationExternalPartnerService;
use App\Services\FederationFeatureService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Log;

/**
 * PushGroupToFederatedPartners â€” broadcasts newly-created groups to external
 * federation partners that have `allow_groups = 1`.
 */
class PushGroupToFederatedPartners implements ShouldQueue
{
    /** Route to the standard federation queue (bulk, non-time-critical). */
    public string $queue = 'federation';

    public function __construct(
        private readonly FederationFeatureService $federationFeatureService,
    ) {}

    public function handle(GroupCreated|GroupUpdated $event): void
    {
        $group    = $event->group;
        $tenantId = $event->tenantId;
        $previousTenantId = TenantContext::currentId();

        try {
            if (!TenantContext::setById($tenantId)) {
                Log::warning('PushGroupToFederatedPartners: tenant not found, skipping', [
                    'tenant_id' => $tenantId,
                    'group_id'  => $group->id ?? null,
                ]);
                return;
            }

            if (!TenantContext::hasFeature('federation')) {
                return;
            }
            if (!$this->federationFeatureService->isTenantFederationEnabled($tenantId)) {
                return;
            }

            $storedStatus = $group->status;
            $status = $storedStatus instanceof GroupStatus ? $storedStatus : GroupStatus::tryFrom((string) $storedStatus);

            // F-386: a private or secret group is never published to external
            // partners — the rule the internal listing follows since F-377. A
            // group made private or secret after it was published is withdrawn.
            $isHidden = in_array((string) ($group->visibility ?? ''), ['private', 'secret'], true);
            $isRetraction = $event instanceof GroupUpdated && ($status !== GroupStatus::Active || $isHidden);

            if ($event instanceof GroupCreated && ($status !== GroupStatus::Active || $isHidden)) {
                return;
            }

            $visibility = $group->federated_visibility ?? 'none';
            if (! $isRetraction && ! in_array($visibility, ['listed', 'public'], true)) {
                return;
            }

            $partners = FederationExternalPartnerService::getActivePartnersWithFlag($tenantId, 'allow_groups');
            if (empty($partners)) {
                return;
            }

            $action = $isRetraction
                ? 'deleted'
                : ($event instanceof GroupUpdated ? 'updated' : 'created');

            $payload = [
                'action'      => $action,
                'id'          => $group->id,
                'external_id' => (string) $group->id,
                'name'        => $group->name ?? null,
                'description' => $group->description ?? null,
                'visibility'  => $group->visibility ?? null,
                'owner_id'    => $group->owner_id ?? null,
                'tenant_id'   => $tenantId,
                'created_at'  => $group->created_at?->toISOString(),
            ];
            if ($isHidden) {
                // Withdrawing a now-private group must not publish its details.
                $payload['name'] = null;
                $payload['description'] = null;
                $payload['visibility'] = null;
                $payload['owner_id'] = null;
            }

            foreach ($partners as $partner) {
                $partnerId = (int) ($partner['id'] ?? 0);
                if ($partnerId <= 0) {
                    continue;
                }
                try {
                    $result = FederationExternalApiClient::sendGroup($partnerId, $payload);

                    if (empty($result['success'])) {
                        Log::warning('PushGroupToFederatedPartners: partner rejected group', [
                            'partner_id' => $partnerId,
                            'tenant_id'  => $tenantId,
                            'group_id'   => $group->id,
                            'error'      => $result['error'] ?? null,
                        ]);
                    }
                } catch (\Throwable $e) {
                    Log::warning('PushGroupToFederatedPartners: partner push failed', [
                        'partner_id' => $partnerId,
                        'tenant_id'  => $tenantId,
                        'group_id'   => $group->id,
                        'error'      => $e->getMessage(),
                    ]);
                }
            }
        } catch (\Throwable $e) {
            Log::error('PushGroupToFederatedPartners listener failed', [
                'tenant_id' => $tenantId ?? null,
                'group_id'  => $group->id ?? null,
                'error'     => $e->getMessage(),
            ]);
        } finally {
            TenantContext::restoreAfterScopedListener($previousTenantId);
        }
    }
}
