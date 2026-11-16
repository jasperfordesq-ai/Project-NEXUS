<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\PlatformTeam;

use App\Http\Controllers\Api\BaseApiController;
use App\Services\NativeAppInstallStatsService;
use Illuminate\Http\JsonResponse;

/**
 * Platform team panel → Phone app: who has the app, across every community.
 *
 * Until 16 Nov 2026 these figures were a `platform` block inside the
 * community admin's own request (`AdminConfigController::getNativeAppInstallStats`),
 * sent to `is_god` accounts. They live here now, for the platform team only
 * (`is_god` AND super admin), and that request no longer carries them.
 *
 * 🔴 Cross-community on purpose: `NativeAppInstallStatsService::platformStats()`
 * names members of every community (no email addresses). Nothing below the
 * platform team may reach this.
 *
 * 🔴 Members signed in on the app, NOT app-store downloads. `disclaimer_key`
 * says so, so no screen can present them as store install counts.
 */
final class PhoneAppController extends BaseApiController
{
    protected bool $isV2Api = true;

    /** GET /api/v2/platform-team/phone-app */
    public function index(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        return $this->respondWithData(
            (new NativeAppInstallStatsService())->platformStats()
            + ['disclaimer_key' => 'app_members_not_store_installs']
        );
    }
}
