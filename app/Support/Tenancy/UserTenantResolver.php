<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// No strict_types: moved verbatim from a non-strict controller, and must
// coerce exactly as it did there.

namespace App\Support\Tenancy;

use Illuminate\Support\Facades\DB;

/**
 * Where a member's own community lives: its name and the base URL its links
 * must point at.
 *
 * Emails about an account are built from the MEMBER's tenant, never from the
 * request's — an administrator acting from a parent community, or a background
 * sender with no request at all, must still send links the member can use.
 * Moved verbatim from AdminUsersController so the admin actions and the
 * welcome-invitation sender resolve links identically.
 */
final class UserTenantResolver
{
    /**
     * Resolve the tenant name and URL base for a user's tenant.
     *
     * @param array<string,mixed> $user User record from the database (needs tenant_id)
     * @return array{tenant_id: int, name: string, slug_prefix: string, frontend_url: string}
     * @throws \RuntimeException when the user has no tenant
     */
    public static function resolve(array $user): array
    {
        if (empty($user['tenant_id'])) {
            throw new \RuntimeException(__('api.user_missing_tenant_id'));
        }
        $userTenantId = (int) $user['tenant_id'];
        $tenantName   = 'Project NEXUS';
        $slugPrefix   = '';
        $frontendUrl  = \App\Core\Env::get('FRONTEND_URL', 'https://app.project-nexus.ie');

        $tenant = DB::selectOne(
            "SELECT t.name, t.slug, t.domain, p.domain AS parent_domain
             FROM tenants t
             LEFT JOIN tenants p ON p.id = t.parent_id AND p.is_active = 1
             WHERE t.id = ?",
            [$userTenantId]
        );

        if ($tenant) {
            $tenantName = $tenant->name;
            $slug       = $tenant->slug ?? '';

            if (!empty($tenant->domain)) {
                // Tenant owns its custom domain — no slug prefix in URLs
                $frontendUrl = 'https://' . rtrim((string) $tenant->domain, '/');
                $slugPrefix  = '';
            } elseif (!empty($tenant->parent_domain)) {
                // Sub-tenant sharing parent's custom domain (e.g. timebanking.uk/cardiff)
                $frontendUrl = 'https://' . rtrim((string) $tenant->parent_domain, '/');
                $slugPrefix  = $slug ? '/' . $slug : '';
            } else {
                // Shared platform host (app.project-nexus.ie/slug)
                $slugPrefix = $slug ? '/' . $slug : '';
            }
        }

        return [
            'tenant_id'    => $userTenantId,
            'name'         => $tenantName,
            'slug_prefix'  => $slugPrefix,
            'frontend_url' => $frontendUrl,
        ];
    }
}
