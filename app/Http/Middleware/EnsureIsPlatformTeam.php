<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Middleware;

use App\Support\Authorization\PlatformTeam;
use App\Support\Names\NameAudience;
use App\Support\Names\NameReason;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Admit the platform team only: `is_god` AND super admin (E-128).
 *
 * The route-group form of BaseApiController::requireGodPlatformAdmin(); both
 * ask App\Support\Authorization\PlatformTeam, which reads the flags from the
 * database on every request rather than trusting the loaded model.
 *
 * 🔴 Narrower than `super-admin`, which admits a global super admin who is not
 * on the platform team, and admits `is_god` on its own. Use this for the
 * endpoints behind the Platform team panel (`/platform-team`): anything that
 * acts on the whole installation, and the per-community pages the owner has
 * restricted to the platform team.
 */
class EnsureIsPlatformTeam
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (!$user) {
            return response()->json([
                'errors' => [
                    ['code' => 'auth_required', 'message' => 'Authentication required'],
                ],
                'success' => false,
            ], 401, [
                'API-Version' => '2.0',
            ]);
        }

        if (!PlatformTeam::includes((int) $user->id)) {
            return response()->json([
                'errors' => [
                    ['code' => 'forbidden', 'message' => __('api.platform_team_required')],
                ],
                'success' => false,
            ], 403, [
                'API-Version' => '2.0',
            ]);
        }

        // E-122: a caller this gate admits sees members' full names on the
        // screen it guards. Does nothing until the surname switch is on.
        NameAudience::grantForRequest($request, NameReason::ADMIN_ROUTE);

        return $next($request);
    }
}
