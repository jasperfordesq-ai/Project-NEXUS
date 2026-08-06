<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Ensure the caller is a super-admin OF SOMETHING — the platform, or their own
 * community.
 *
 * This sits between the two existing gates and exists because neither fits a
 * specific, real case:
 *
 *   - `EnsureIsAdmin` is too wide. It admits every ordinary community
 *     administrator, and the powers behind this gate are not ordinary.
 *   - `EnsureIsSuperAdmin` is too narrow. It deliberately refuses
 *     `is_tenant_super_admin`, which is correct for the installation-wide
 *     routes it guards but wrong for an action confined to the caller's own
 *     community.
 *   - `EnsureSuperPanelAccess` looks right and is not: a REGIONAL grant there
 *     additionally requires `allows_subtenants` and a populated materialised
 *     path, because it is about a hierarchy. Impersonating a member of your own
 *     community has nothing to do with hierarchy, so a super-admin of an
 *     ordinary community with no sub-communities would be refused for a reason
 *     that does not apply to them.
 *
 * 🔴 This gate is admission only. It establishes that the caller is a
 * super-admin somewhere; it does NOT establish that the target is theirs. Every
 * route behind it must still scope the target itself — `AdminUsersController`
 * confines the target to the caller's own tenant and requires a strictly higher
 * security tier, so a tenant super-admin can reach a member but not a peer
 * administrator.
 *
 * Introduced 2026-08-06: a tenant super-admin pressing "View as this member" on
 * a member of their own community received 403, because this route sat behind
 * `EnsureIsSuperAdmin`.
 */
class EnsureIsTenantSuperAdmin
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

        /*
         * Deliberately the same predicate as BaseApiController::requireSuperAdmin(),
         * which already admits all three capacities. If you change one, change
         * both — a gate that disagrees with the controller behind it produces
         * either a dead route or a hole.
         */
        $isSuperAdminOfSomething = ($user->is_super_admin ?? false)
            || ($user->is_god ?? false)
            || ($user->is_tenant_super_admin ?? false)
            || in_array($user->role ?? '', ['super_admin', 'god'], true);

        if (!$isSuperAdminOfSomething) {
            return response()->json([
                'errors' => [
                    ['code' => 'forbidden', 'message' => 'Super admin access required'],
                ],
                'success' => false,
            ], 403, [
                'API-Version' => '2.0',
            ]);
        }

        return $next($request);
    }
}
