<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\PlatformTeam;

use App\Http\Controllers\Api\BaseApiController;
use App\Services\PlatformTeam\ConnectionsService;
use Illuminate\Http\JsonResponse;

/**
 * Platform team panel → Keys and connections: which outside services this
 * server has a key for. Yes or no only, never any part of a key.
 *
 * 🔴 One method, and it only reads.
 */
final class ConnectionsController extends BaseApiController
{
    protected bool $isV2Api = true;

    /** GET /api/v2/platform-team/connections */
    public function index(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        return $this->respondWithData((new ConnectionsService())->report());
    }
}
