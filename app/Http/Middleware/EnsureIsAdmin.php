<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Middleware;

use App\Support\Authorization\AdminTier;
use Closure;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Ensure the authenticated user has admin-level privileges.
 *
 * Checks is_admin, is_super_admin, is_tenant_super_admin, or is_god.
 * Returns 403 JSON response for non-admin users.
 */
class EnsureIsAdmin
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (!$user) {
            return response()->json([
                'errors' => [
                    ['code' => 'auth_required', 'message' => __('api.auth_required')],
                ],
                'success' => false,
            ], 401, [
                'API-Version' => '2.0',
            ]);
        }

        // The shared predicate explicitly rejects operational broker and
        // coordinator roles before considering legacy admin flags.
        if (! AdminTier::allows($user)) {
            if ($this->allowsScopedVereinAdmin($request, (int) $user->id, (int) ($user->tenant_id ?? 0))) {
                return $next($request);
            }

            return response()->json([
                'errors' => [
                    ['code' => 'forbidden', 'message' => __('api.admin_access_required')],
                ],
                'success' => false,
            ], 403, [
                'API-Version' => '2.0',
            ]);
        }

        return $next($request);
    }

    private function allowsScopedVereinAdmin(Request $request, int $userId, int $tenantId): bool
    {
        if (
            $tenantId <= 0
            || (
                !$request->is('api/v2/admin/caring-community/vereine/*/members/import*')
                && !$request->is('v2/admin/caring-community/vereine/*/members/import*')
                && !$request->is('api/v2/caring-community/vereine/*/members/import*')
                && !$request->is('v2/caring-community/vereine/*/members/import*')
            )
        ) {
            return false;
        }
        if (!Schema::hasTable('user_roles') || !Schema::hasColumn('user_roles', 'scope_organization_id')) {
            return false;
        }

        $organizationId = (int) ($request->route('organizationId') ?? 0);
        if ($organizationId <= 0) {
            return false;
        }

        return DB::table('user_roles as ur')
            ->join('role_permissions as rp', 'rp.role_id', '=', 'ur.role_id')
            ->join('permissions as p', 'p.id', '=', 'rp.permission_id')
            ->where('ur.user_id', $userId)
            ->where('p.name', 'verein.members.import')
            // ur.tenant_id MUST match the current tenant. assignVereinAdmin() always
            // writes a concrete tenant_id, so a NULL ('global') row here can only be a
            // malicious/misconfigured grant — it must not bypass tenant isolation.
            // (rp/p tenant_id keep orWhereNull: the migration seeds those rows with NULL.)
            ->where('ur.tenant_id', $tenantId)
            ->where(function ($query) use ($tenantId): void {
                $query->where('rp.tenant_id', $tenantId)->orWhereNull('rp.tenant_id');
            })
            ->where(function ($query) use ($tenantId): void {
                $query->where('p.tenant_id', $tenantId)->orWhereNull('p.tenant_id');
            })
            ->where(function ($query) use ($organizationId): void {
                $query->where('ur.scope_organization_id', $organizationId)->orWhereNull('ur.scope_organization_id');
            })
            ->where(function ($query): void {
                $query->whereNull('ur.expires_at')->orWhere('ur.expires_at', '>', now());
            })
            ->exists();
    }
}
