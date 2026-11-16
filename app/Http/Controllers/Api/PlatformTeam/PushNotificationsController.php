<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\PlatformTeam;

use App\Http\Controllers\Api\BaseApiController;
use App\Services\PlatformTeam\PushNotificationsService;
use Illuminate\Http\JsonResponse;

/**
 * Platform team panel → Push notifications: per day and per community, how
 * many recorded pushes were accepted, partly accepted, failed, or had nobody
 * to send to. Counts only.
 *
 * 🔴 One method, and it only reads.
 */
final class PushNotificationsController extends BaseApiController
{
    protected bool $isV2Api = true;

    /** GET /api/v2/platform-team/push-notifications?days=14 (1 to 30) */
    public function index(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        $days = PushNotificationsService::parseDays($this->getAllInput()['days'] ?? null);
        if ($days === null) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.platform_push_days_invalid'), 'days', 422);
        }

        return $this->respondWithData((new PushNotificationsService())->report($days));
    }
}
