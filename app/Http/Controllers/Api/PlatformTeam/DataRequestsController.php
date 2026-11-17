<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\PlatformTeam;

use App\Http\Controllers\Api\BaseApiController;
use App\Http\Controllers\Api\PlatformTeam\Concerns\KeepsFigures;
use App\Services\PlatformTeam\DataRequestsService;
use Illuminate\Http\JsonResponse;

/**
 * Platform team panel → Data requests: per community, how many data requests
 * are open, overdue (open for more than 30 days) or nearly due, and how many
 * were completed in the last 90 days.
 *
 * 🔴 One method, and it only reads. Counts only: no member, no request id.
 */
final class DataRequestsController extends BaseApiController
{
    use KeepsFigures;

    protected bool $isV2Api = true;

    /** GET /api/v2/platform-team/data-requests */
    public function index(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        return $this->keptFigures('data_requests', static fn (): array => (new DataRequestsService())->overview());
    }
}
