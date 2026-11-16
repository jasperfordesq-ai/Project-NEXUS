<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\PlatformTeam;

use App\Http\Controllers\Api\BaseApiController;
use App\Services\PlatformTeam\UnfinishedFeaturesService;
use Illuminate\Http\JsonResponse;

/**
 * Platform team panel → Unfinished features: the alpha and beta features and
 * the features that are off unless switched on, and which communities have
 * each one on.
 *
 * 🔴 One method, and it only reads. No switch: a feature is changed in that
 * community's own admin panel.
 */
final class UnfinishedFeaturesController extends BaseApiController
{
    protected bool $isV2Api = true;

    /** GET /api/v2/platform-team/unfinished-features */
    public function index(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        return $this->respondWithData((new UnfinishedFeaturesService())->overview());
    }
}
