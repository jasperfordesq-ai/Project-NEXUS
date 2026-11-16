<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\PlatformTeam;

use App\Http\Controllers\Api\BaseApiController;
use App\Services\PlatformTeam\RecentErrorsService;
use Illuminate\Http\JsonResponse;

/**
 * Platform team panel → Recent errors: three counts per part of the platform
 * from the error service. Switched off (no outside request) until a read-only
 * key is stored on the server. Kept five minutes; `?refresh=1` asks again,
 * six a minute per caller.
 *
 * 🔴 One method, and it only reads.
 */
final class RecentErrorsController extends BaseApiController
{
    protected bool $isV2Api = true;

    private const REFRESHES_PER_MINUTE = 6;

    /** GET /api/v2/platform-team/errors */
    public function index(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        $refresh = in_array($this->getAllInput()['refresh'] ?? null, ['1', 1, true], true);
        if ($refresh) {
            $this->rateLimit('platform_team_recent_errors_refresh', self::REFRESHES_PER_MINUTE, 60);
        }

        return $this->respondWithData(app(RecentErrorsService::class)->report($refresh));
    }
}
