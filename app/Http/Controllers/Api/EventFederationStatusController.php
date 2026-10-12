<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Http\Resources\EventFederationStatusResource;
use App\Models\Event;
use App\Models\User;
use App\Policies\EventFederationPolicy;
use App\Services\EventFederationDiagnostics;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Schema;

/** Organizer/admin visibility into safe Event federation delivery state. */
final class EventFederationStatusController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly EventFederationDiagnostics $diagnostics,
        private readonly EventFederationPolicy $policy,
    ) {}

    public function show(int $id): JsonResponse
    {
        $tenantId = TenantContext::currentId();
        if ($tenantId === null) {
            return $this->noStore($this->respondWithError(
                'EVENT_FEDERATION_UNAVAILABLE',
                __('api.service_unavailable'),
                null,
                503,
            ));
        }
        $event = Event::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->find($id);
        if (! $event instanceof Event) {
            return $this->noStore($this->respondWithError(
                'EVENT_NOT_FOUND',
                __('api.event_not_found'),
                null,
                404,
            ));
        }
        $actor = User::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->find($this->getActingUserId());
        if (! $actor instanceof User || ! $this->policy->viewStatus($actor, $event)) {
            return $this->noStore($this->respondWithError(
                'EVENT_FEDERATION_FORBIDDEN',
                __('api.forbidden'),
                null,
                403,
            ));
        }
        if (! Schema::hasTable('event_federation_deliveries')) {
            return $this->noStore($this->respondWithError(
                'EVENT_FEDERATION_UNAVAILABLE',
                __('api.service_unavailable'),
                null,
                503,
            ));
        }

        return $this->noStore($this->respondWithData(
            EventFederationStatusResource::fromSummary($this->diagnostics->eventStatus($event)),
        ));
    }

    private function noStore(JsonResponse $response): JsonResponse
    {
        $response->headers->set('Cache-Control', 'private, no-store');
        $response->headers->set('Pragma', 'no-cache');
        $response->setVary(['Authorization', 'Cookie', 'X-Tenant-ID'], false);

        return $response;
    }
}
