<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\PlatformTeam;

use App\Http\Controllers\Api\BaseApiController;
use App\Services\PlatformTeam\DeploymentHistoryService;
use Illuminate\Http\JsonResponse;

/**
 * Platform team panel → Deployments: the last deployments and rollbacks this
 * server recorded, newest first, from the deploy record file.
 *
 * 🔴 One method, and it only reads.
 */
final class DeploymentsController extends BaseApiController
{
    protected bool $isV2Api = true;

    /** GET /api/v2/platform-team/deployments */
    public function index(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        return $this->respondWithData((new DeploymentHistoryService())->report());
    }
}
