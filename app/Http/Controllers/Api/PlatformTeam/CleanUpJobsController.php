<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\PlatformTeam;

use App\Http\Controllers\Api\BaseApiController;
use App\Services\PlatformTeam\CleanUpJobsService;
use Illuminate\Http\JsonResponse;

/**
 * Platform team panel → Clean-up jobs: the scheduled jobs that delete data,
 * when each last ran successfully, when it last failed, and its state.
 *
 * 🔴 One method, and it only reads.
 */
final class CleanUpJobsController extends BaseApiController
{
    protected bool $isV2Api = true;

    /** GET /api/v2/platform-team/clean-up-jobs */
    public function index(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        return $this->respondWithData((new CleanUpJobsService())->report());
    }
}
