<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\PlatformTeam;

use App\Http\Controllers\Api\BaseApiController;
use App\Jobs\ReindexTenantSearchJob;
use App\Services\PlatformTeam\SearchRebuildService;
use Illuminate\Http\JsonResponse;

/**
 * Platform team panel → Rebuild search: the list, and starting a rebuild of
 * one community's search as a background job.
 *
 * Platform team only (`is_god` AND super admin), twice over: the route group's
 * `platform-team` middleware and the check in every method. Starting a rebuild
 * changes no member data and can be run again, so it needs no second sign-in
 * step. Who started it is written to activity_log (tenant_id NULL).
 */
final class SearchRebuildController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(private readonly SearchRebuildService $rebuild)
    {
    }

    /** GET /api/v2/platform-team/search-rebuild */
    public function index(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        return $this->respondWithData($this->rebuild->overview());
    }

    /** POST /api/v2/platform-team/search-rebuild  body {tenant_id} */
    public function store(): JsonResponse
    {
        $actorId = $this->requireGodPlatformAdmin();
        $this->rateLimit('platform_team_search_rebuild', 6, 60);

        $raw = $this->getAllInput()['tenant_id'] ?? null;
        $tenantId = is_int($raw) || (is_string($raw) && ctype_digit($raw)) ? (int) $raw : 0;

        if (!$this->rebuild->communityExists($tenantId)) {
            return $this->respondWithError('NOT_FOUND', __('api.resource_not_found'), 'tenant_id', 404);
        }

        if ($this->rebuild->isBusy($tenantId)) {
            return $this->respondWithError('ALREADY_RUNNING', __('api.platform_search_rebuild_busy'), 'tenant_id', 409);
        }

        if (!$this->rebuild->reachable()) {
            return $this->respondWithError('SEARCH_UNAVAILABLE', __('api.platform_search_rebuild_unavailable'), null, 503);
        }

        $this->rebuild->markQueued($tenantId);
        ReindexTenantSearchJob::dispatch($tenantId, $actorId);
        $this->rebuild->record($actorId, $tenantId);

        return $this->respondWithData(['queued' => true, 'tenant_id' => $tenantId]);
    }
}
