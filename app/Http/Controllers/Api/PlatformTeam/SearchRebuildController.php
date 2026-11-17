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
use Illuminate\Contracts\Bus\Dispatcher;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

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

        // The busy check and the "queued" mark happen under one short lock for
        // this community, so two starts close together queue one job.
        $lock = SearchRebuildService::startLockKey($tenantId);
        if (!Cache::add($lock, 1, 30)) {
            return $this->respondWithError('ALREADY_RUNNING', __('api.platform_search_rebuild_busy'), 'tenant_id', 409);
        }

        try {
            if ($this->rebuild->isBusy($tenantId)) {
                return $this->respondWithError('ALREADY_RUNNING', __('api.platform_search_rebuild_busy'), 'tenant_id', 409);
            }

            if (!$this->rebuild->reachable()) {
                return $this->respondWithError('SEARCH_UNAVAILABLE', __('api.platform_search_rebuild_unavailable'), null, 503);
            }

            // Marked before the job is handed over, so a job that starts at
            // once is not overwritten by "queued" afterwards.
            $previous = $this->rebuild->read($tenantId);
            $runId = $this->rebuild->markQueued($tenantId);

            try {
                app(Dispatcher::class)->dispatch(new ReindexTenantSearchJob($tenantId, $actorId, $runId));
            } catch (\Throwable $e) {
                // Nothing was queued: put the record back as it was, so the
                // community is free to start again at once.
                $this->rebuild->restore($tenantId, $previous);
                Log::error('[PlatformTeam] search rebuild could not be queued', [
                    'tenant_id' => $tenantId,
                    'actor' => $actorId,
                    'exception' => $e::class,
                ]);

                return $this->respondWithError('SEARCH_UNAVAILABLE', __('api.platform_search_rebuild_unavailable'), null, 503);
            }

            $this->rebuild->record($actorId, $tenantId);
        } finally {
            Cache::forget($lock);
        }

        return $this->respondWithData(['queued' => true, 'tenant_id' => $tenantId]);
    }
}
