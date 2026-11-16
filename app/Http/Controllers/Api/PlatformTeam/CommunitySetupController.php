<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\PlatformTeam;

use App\Http\Controllers\Api\BaseApiController;
use App\Services\PlatformTeam\CommunitySetupChecklistService;
use Illuminate\Http\JsonResponse;

/**
 * Platform team panel → Community setup: for each community, which of the
 * first steps of setting one up are done.
 *
 * 🔴 One method, and it only reads. Yes/no facts only: no person is named.
 */
final class CommunitySetupController extends BaseApiController
{
    protected bool $isV2Api = true;

    /** GET /api/v2/platform-team/community-setup */
    public function index(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        return $this->respondWithData(app(CommunitySetupChecklistService::class)->overview());
    }
}
