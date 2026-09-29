<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Services\CaringCommunity\WarmthPassService;
use Illuminate\Http\JsonResponse;

/**
 * Warmth Pass — community trust credential for Tier 2+ members.
 *
 * GET /api/v2/caring-community/my-warmth-pass       — member endpoint
 * GET /api/v2/admin/caring-community/warmth-pass/{userId} — admin endpoint
 */
class WarmthPassController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly WarmthPassService $service,
    ) {
    }

    /**
     * GET /api/v2/caring-community/my-warmth-pass
     *
     * Returns the authenticated member's Warmth Pass data.
     * Members below Tier 2 receive the payload with eligible=false.
     */
    public function myPass(): JsonResponse
    {
        $userId   = $this->requireAuth();
        $tenantId = TenantContext::getId();

        if (!TenantContext::hasFeature('caring_community')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }

        try {
            $pass = $this->service->buildPass($userId, $tenantId);
        } catch (\Throwable $e) {
            return $this->respondWithError('SERVER_ERROR', __('api.server_error'), null, 500);
        }

        return $this->respondWithData($pass);
    }

    /**
     * GET /api/v2/admin/caring-community/warmth-pass/{userId}
     *
     * Returns the Warmth Pass data for any member.
     * Admin only.
     */
    public function adminViewPass(int $userId): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        if (!TenantContext::hasFeature('caring_community')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }

        try {
            // E-061 F-228: only members of this community can be looked up.
            if (!$this->service->memberExists($userId, $tenantId)) {
                return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
            }

            $pass = $this->service->buildPass($userId, $tenantId);
        } catch (\Throwable $e) {
            return $this->respondWithError('SERVER_ERROR', __('api.server_error'), null, 500);
        }

        return $this->respondWithData($pass);
    }
}
