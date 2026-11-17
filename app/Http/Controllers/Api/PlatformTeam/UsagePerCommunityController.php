<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\PlatformTeam;

use App\Http\Controllers\Api\BaseApiController;
use App\Http\Controllers\Api\PlatformTeam\Concerns\KeepsFigures;
use App\Services\PlatformTeam\UsagePerCommunityService;
use Illuminate\Http\JsonResponse;

/**
 * Platform team panel → Usage per community: one month's emails, AI chat and
 * the space groups' files take, per community. Counts only.
 *
 * 🔴 One method, and it only reads.
 */
final class UsagePerCommunityController extends BaseApiController
{
    use KeepsFigures;

    protected bool $isV2Api = true;

    /** GET /api/v2/platform-team/usage?month=YYYY-MM (default: this month) */
    public function index(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        $month = UsagePerCommunityService::parseMonth($this->getAllInput()['month'] ?? null);
        if ($month === null) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.platform_usage_month_invalid'), 'month', 422);
        }

        return $this->keptFigures('usage:' . $month->format('Y-m'), static fn (): array => (new UsagePerCommunityService())->report($month));
    }
}
