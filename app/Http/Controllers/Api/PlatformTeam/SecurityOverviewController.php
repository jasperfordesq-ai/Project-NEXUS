<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\PlatformTeam;

use App\Http\Controllers\Api\BaseApiController;
use App\Services\PlatformTeam\SecurityOverviewService;
use Illuminate\Http\JsonResponse;

/**
 * Platform team panel → Security: senior access given and removed, who signed
 * in as another member, failed sign-ins, senior accounts without two-step.
 *
 * 🔴 One method, and it only reads. What it may and may not send is set out
 * on SecurityOverviewService.
 */
final class SecurityOverviewController extends BaseApiController
{
    protected bool $isV2Api = true;

    /** GET /api/v2/platform-team/security */
    public function index(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        return $this->respondWithData((new SecurityOverviewService())->overview());
    }
}
