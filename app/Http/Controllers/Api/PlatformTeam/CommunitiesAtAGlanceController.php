<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\PlatformTeam;

use App\Http\Controllers\Api\BaseApiController;
use App\Services\PlatformTeam\CommunitiesAtAGlanceService;
use Illuminate\Http\JsonResponse;

/**
 * Platform team panel → Communities at a glance: every community against
 * every feature and core part, on or off.
 *
 * 🔴 One method, and it only reads. Switches are changed in each community's
 * own admin panel, never here.
 */
final class CommunitiesAtAGlanceController extends BaseApiController
{
    protected bool $isV2Api = true;

    /** GET /api/v2/platform-team/communities */
    public function index(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        return $this->respondWithData((new CommunitiesAtAGlanceService())->grid());
    }
}
