<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Services\CaringCommunity\LeadNurtureService;
use Illuminate\Http\JsonResponse;

/**
 * Public/member capture endpoint for AG94 lead nurture.
 * No auth required (intentionally — this is top-of-funnel capture from the
 * marketing site). Validates email, segment, and explicit consent.
 */
class LeadCaptureController extends BaseApiController
{
    protected bool $isV2Api = true;

    private const TENANT_CAPTURES_PER_HOUR = 120;

    public function __construct(
        private readonly LeadNurtureService $service,
    ) {}

    public function capture(): JsonResponse
    {
        if (!TenantContext::hasFeature('caring_community')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }

        $tenantId = (int) TenantContext::getId();

        // Tenant-wide ceiling on top of the per-IP route throttle, so a flood
        // spread over many addresses cannot fill the lead list (F-131). The
        // tenant id comes from the resolved TenantContext, not the request.
        $this->rateLimit('caring_lead_capture', self::TENANT_CAPTURES_PER_HOUR, 3600, 'tenant:' . $tenantId);

        $payload = (array) request()->all();
        $sourceIp = (string) request()->ip();

        $result = $this->service->capture($tenantId, $payload, $sourceIp);

        if (isset($result['errors']) && $result['errors'] !== []) {
            return $this->respondWithErrors(array_map(
                fn ($e) => ['code' => 'VALIDATION_ERROR', 'message' => $e['message'], 'field' => $e['field']],
                $result['errors'],
            ), 422);
        }

        if (!empty($result['unavailable'])) {
            return $this->respondWithError('SERVICE_UNAVAILABLE', __('api.caring_lead_capture_unavailable'), null, 503);
        }

        // Identical answer for new and already-listed emails: never reveal
        // whether an address is on the list, or its segment/stage/id.
        return $this->respondWithData(['received' => true]);
    }
}

/*
 * Routes to register in routes/api.php (NO admin middleware):
 *   POST /v2/caring-community/leads/capture => capture (->withoutMiddleware EnsureIsAdmin)
 */
