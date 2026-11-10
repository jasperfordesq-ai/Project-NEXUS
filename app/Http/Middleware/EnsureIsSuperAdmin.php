<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Middleware;

use App\Support\Names\NameAudience;
use App\Support\Names\NameReason;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Ensure the authenticated user has PLATFORM-LEVEL super-admin or god-level privileges.
 *
 * This middleware gates cross-tenant platform routes (/v2/admin/super/...) such as
 * tenant CRUD, federation management, and cross-tenant user moves. It intentionally
 * rejects tenant super-admins (is_tenant_super_admin) because those accounts are
 * scoped to a single tenant — admitting them here would allow a compromised tenant
 * admin account to become a full platform compromise.
 *
 * For within-tenant admin operations use the 'admin' middleware instead, which
 * accepts both regular admins and tenant super-admins.
 *
 * Returns 403 JSON response for non-platform-super-admin users.
 */
class EnsureIsSuperAdmin
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

        // Explicitly NOT accepting is_tenant_super_admin — these are platform-level routes.
        $isPlatformSuperAdmin = ($user->is_super_admin ?? false) || ($user->is_god ?? false)
            || in_array($user->role ?? '', ['super_admin', 'god'], true);

        if (!$isPlatformSuperAdmin) {
            return response()->json([
                'errors' => [
                    ['code' => 'forbidden', 'message' => 'Super admin access required'],
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
