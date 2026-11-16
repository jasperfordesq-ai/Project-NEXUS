<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\PlatformTeam;

use App\Http\Controllers\Api\BaseApiController;
use App\Services\PlatformTeam\DomainCheckService;
use Illuminate\Http\JsonResponse;

/**
 * Platform team panel → Addresses and certificates: the list, and checking
 * one community's own addresses (or the platform's own) again now.
 *
 * Platform team only (`is_god` AND super admin), twice over: the route group's
 * `platform-team` middleware and the check in every method. The request names
 * a community, never a host: the hosts come from the tenants table. A check
 * changes no data, so it needs no second sign-in step. Who asked is written to
 * activity_log (tenant_id NULL).
 */
final class DomainCheckController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(private readonly DomainCheckService $domains)
    {
    }

    /** GET /api/v2/platform-team/domains */
    public function index(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        return $this->respondWithData($this->domains->overview());
    }

    /** POST /api/v2/platform-team/domains/check  body {tenant_id} or {platform: true} */
    public function check(): JsonResponse
    {
        $actorId = $this->requireGodPlatformAdmin();
        $this->rateLimit('platform_team_domain_check', 6, 60);

        $input = $this->getAllInput();

        if (($input['platform'] ?? null) === true) {
            $platform = $this->domains->checkPlatform();
            $this->domains->record($actorId, null);

            return $this->respondWithData(['platform' => $platform]);
        }

        $raw = $input['tenant_id'] ?? null;
        $tenantId = is_int($raw) || (is_string($raw) && ctype_digit($raw)) ? (int) $raw : 0;

        if (!$this->domains->communityExists($tenantId)) {
            return $this->respondWithError('NOT_FOUND', __('api.resource_not_found'), 'tenant_id', 404);
        }

        $row = $this->domains->checkCommunity($tenantId);
        if ($row === null) {
            return $this->respondWithError('NOT_FOUND', __('api.resource_not_found'), 'tenant_id', 404);
        }
        $this->domains->record($actorId, $tenantId);

        return $this->respondWithData($row);
    }
}
