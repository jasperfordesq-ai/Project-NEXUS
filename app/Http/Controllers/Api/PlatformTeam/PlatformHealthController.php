<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\PlatformTeam;

use App\Http\Controllers\Api\BaseApiController;
use App\Services\PlatformTeam\PlatformHealthService;
use Illuminate\Http\JsonResponse;

/**
 * Platform team panel → home page: health at a glance.
 *
 * Platform team only (`is_god` AND super admin), twice over: the route sits in
 * the `platform-team` middleware group, and the method asks again. The
 * summary describes the whole installation and reads tables with no community
 * filter, so it must never be reachable by a community admin.
 */
final class PlatformHealthController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(private readonly PlatformHealthService $health)
    {
    }

    /** GET /api/v2/platform-team/health */
    public function summary(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        return $this->respondWithData($this->health->summary());
    }
}
