<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\PlatformTeam;

use App\Http\Controllers\Api\BaseApiController;
use App\Services\PlatformTeam\FailedJobsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;

/**
 * Platform team panel → Failed background jobs: list, run again, discard.
 *
 * Platform team only (`is_god` AND super admin), twice over: the route group's
 * `platform-team` middleware and the check in every method. The table covers
 * every community and has no community column.
 *
 * Running a job again or discarding one is written to the application log
 * with the account that did it.
 */
final class FailedJobsController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(private readonly FailedJobsService $failedJobs)
    {
    }

    /** GET /api/v2/platform-team/failed-jobs */
    public function index(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        return $this->respondWithData($this->failedJobs->list(
            (int) request()->query('page', '1'),
            (int) request()->query('per_page', '25'),
        ));
    }

    /** POST /api/v2/platform-team/failed-jobs/{uuid}/retry */
    public function retry(string $uuid): JsonResponse
    {
        $actorId = $this->requireGodPlatformAdmin();
        $this->rateLimit('platform_team_failed_job_action', 60, 60);

        if (!$this->failedJobs->exists($uuid)) {
            return $this->respondWithError('NOT_FOUND', __('api.resource_not_found'), null, 404);
        }

        if (!$this->failedJobs->retry($uuid)) {
            Log::error('[PlatformTeam] failed job could not be put back on its queue', ['uuid' => $uuid, 'actor' => $actorId]);

            return $this->respondWithError('RETRY_FAILED', __('api.server_error'), null, 500);
        }

        Log::info('[PlatformTeam] failed job put back on its queue', ['uuid' => $uuid, 'actor' => $actorId]);

        return $this->respondWithData(['retried' => true]);
    }

    /** DELETE /api/v2/platform-team/failed-jobs/{uuid} */
    public function destroy(string $uuid): JsonResponse
    {
        $actorId = $this->requireGodPlatformAdmin();
        $this->rateLimit('platform_team_failed_job_action', 60, 60);

        if (!$this->failedJobs->discard($uuid)) {
            return $this->respondWithError('NOT_FOUND', __('api.resource_not_found'), null, 404);
        }

        Log::info('[PlatformTeam] failed job discarded', ['uuid' => $uuid, 'actor' => $actorId]);

        return $this->respondWithData(['discarded' => true]);
    }
}
