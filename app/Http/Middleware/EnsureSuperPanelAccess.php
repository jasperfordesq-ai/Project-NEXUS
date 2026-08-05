<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Middleware;

use App\Core\SuperPanelAccess;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Gate for the SUBTREE tier of the super panel.
 *
 * Admits two kinds of caller:
 *   - `master`   — a platform super-admin or god: sees the whole installation;
 *   - `regional` — a super-admin of a tenant that has children: sees its own
 *                  tenant and its descendants, and nothing else.
 *
 * 🔴 Why this exists, and what it is NOT for.
 *
 * `EnsureIsSuperAdmin` deliberately refuses `is_tenant_super_admin`, so every
 * `/v2/admin/super/*` endpoint was platform-only. That is correct for endpoints
 * whose powers are platform-wide — billing, platform revenue, federation kill
 * switches, granting platform super-admin — and it is why those endpoints never
 * needed a subtree check and mostly do not have one.
 *
 * This middleware exists for the other kind: endpoints that ALREADY confine
 * themselves to the caller's accessible subtree, via
 * `SuperPanelAccess::canAccessTenant()` or `subtreeFilter()`. Those can safely be
 * offered to a regional caller, and that is what makes a hub tenant's own panel
 * possible.
 *
 * 🔴 Do not move an endpoint behind this gate until it confines itself. The
 * one-line convenience of widening a gate is exactly how a regional admin would
 * end up setting another branch's billing plan: several endpoints take a
 * `tenant_id` straight from the request body and check only that the caller is a
 * super-admin. Harden first, then move.
 *
 * The `granted` decision, the master/regional split and the subtree boundary all
 * come from `App\Core\SuperPanelAccess`, which fails closed — an unusable
 * materialised path denies rather than matching everything.
 */
class EnsureSuperPanelAccess
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

        // Resolve explicitly for this user: the panel is reached by token auth, so
        // there is no session for SuperPanelAccess to read.
        SuperPanelAccess::reset();
        $access = SuperPanelAccess::getAccess((int) $user->id);

        if (empty($access['granted'])) {
            return response()->json([
                'errors' => [
                    [
                        'code' => 'forbidden',
                        // The reason is safe to return: it describes the caller's own
                        // account, never another tenant's data.
                        'message' => 'Super panel access required: ' . ($access['reason'] ?? 'denied'),
                    ],
                ],
                'success' => false,
            ], 403, [
                'API-Version' => '2.0',
            ]);
        }

        return $next($request);
    }
}
