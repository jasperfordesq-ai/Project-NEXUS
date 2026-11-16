<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\PlatformTeam;

use App\Http\Controllers\Api\BaseApiController;
use App\Services\PlatformTeam\SeniorAccountsService;
use Illuminate\Http\JsonResponse;

/**
 * Platform team panel → Senior accounts: who can administer more than one
 * community, when each last signed in, and whether two-step is on.
 *
 * 🔴 One method, and it only reads. There is deliberately no request that
 * grants or removes platform team membership.
 */
final class SeniorAccountsController extends BaseApiController
{
    protected bool $isV2Api = true;

    /** GET /api/v2/platform-team/senior-accounts */
    public function index(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        return $this->respondWithData((new SeniorAccountsService())->list());
    }
}
