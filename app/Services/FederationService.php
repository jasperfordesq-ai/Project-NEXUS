<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use Illuminate\Support\Facades\DB;
use App\Support\UserDisplayName;

/**
 * FederationService — Laravel DI-based service for federation/multi-community operations.
 *
 * Manages cross-timebank directory lookups for federated networks.
 */
class FederationService
{
    /**
     * Get all federated timebanks visible to a tenant.
     */
    public function getTimebanks(int $tenantId): array
    {
        // Use an explicit parameter binding for the CASE expression rather
        // than interpolating the tenant ID inline. Even though $tenantId is
        // int-typed, using bindings keeps the pattern consistent and makes
        // the query trivially safe under static analysis.
        return DB::table('federation_partnerships as fp')
            ->join('tenants as t', function ($join) use ($tenantId) {
                $join->on(
                    DB::raw('t.id'),
                    '=',
                    DB::raw('CASE WHEN fp.tenant_id = ? THEN fp.partner_tenant_id ELSE fp.tenant_id END')
                )->addBinding($tenantId, 'join');
            })
            ->where(function ($q) use ($tenantId) {
                $q->where('fp.tenant_id', $tenantId)
                  ->orWhere('fp.partner_tenant_id', $tenantId);
            })
            ->where('fp.status', 'active')
            ->select('t.id', 't.name', 't.slug', 'fp.approved_at')
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();
    }

    /**
     * Get members from a federated timebank.
     */
    public function getMembers(int $tenantId, int $partnerTenantId, int $limit = 20): array
    {
        // FED-009: Check profiles_enabled on partnership to enforce permission boundaries
        $partnershipActive = DB::table('federation_partnerships')
            ->where(function ($q) use ($tenantId, $partnerTenantId) {
                $q->where(function ($q2) use ($tenantId, $partnerTenantId) {
                    $q2->where('tenant_id', $tenantId)->where('partner_tenant_id', $partnerTenantId);
                })->orWhere(function ($q2) use ($tenantId, $partnerTenantId) {
                    $q2->where('tenant_id', $partnerTenantId)->where('partner_tenant_id', $tenantId);
                });
            })
            ->where('status', 'active')
            ->where('profiles_enabled', 1)
            ->exists();

        if (! $partnershipActive) {
            return [];
        }

        return DB::table('users as u')
            ->join('federation_user_settings as fus', 'u.id', '=', 'fus.user_id')
            ->where('u.tenant_id', $partnerTenantId)
            ->where('u.status', 'active')
            ->where('fus.federation_optin', 1)
            ->where('fus.appear_in_federated_search', 1)
            ->where('fus.profile_visible_federated', 1)
            ->select('u.id', DB::raw(UserDisplayName::sql('u', 'name')), 'u.location', 'u.bio', 'u.avatar_url as avatar')
            ->limit(min($limit, 100))
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();
    }

    /**
     * Get listings from a federated timebank.
     */
    public function getListings(int $tenantId, int $partnerTenantId, int $limit = 20): array
    {
        // Check listings_enabled on partnership
        $partnershipActive = DB::table('federation_partnerships')
            ->where(function ($q) use ($tenantId, $partnerTenantId) {
                $q->where(function ($q2) use ($tenantId, $partnerTenantId) {
                    $q2->where('tenant_id', $tenantId)->where('partner_tenant_id', $partnerTenantId);
                })->orWhere(function ($q2) use ($tenantId, $partnerTenantId) {
                    $q2->where('tenant_id', $partnerTenantId)->where('partner_tenant_id', $tenantId);
                });
            })
            ->where('status', 'active')
            ->where('listings_enabled', 1)
            ->exists();

        if (! $partnershipActive) {
            return [];
        }

        return DB::table('listings')
            ->where('tenant_id', $partnerTenantId)
            ->where('status', 'active')
            ->whereIn('federated_visibility', ['listed', 'bookable'])
            ->select('id', 'title', 'description', 'type', 'category_id', 'created_at')
            ->orderByDesc('created_at')
            ->limit(min($limit, 100))
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();
    }
}
