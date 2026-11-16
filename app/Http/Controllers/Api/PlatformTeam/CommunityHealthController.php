<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\PlatformTeam;

use App\Http\Controllers\Api\BaseApiController;
use App\Services\PlatformTeam\CommunityHealthService;
use Illuminate\Http\JsonResponse;

/**
 * Platform team panel → Community health: counts per community (members,
 * activity, exchanges, listings) and which communities have gone quiet.
 *
 * 🔴 One method, and it only reads. Counts only: no member names.
 */
final class CommunityHealthController extends BaseApiController
{
    protected bool $isV2Api = true;

    /** GET /api/v2/platform-team/community-health */
    public function index(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        return $this->respondWithData((new CommunityHealthService())->overview());
    }
}
