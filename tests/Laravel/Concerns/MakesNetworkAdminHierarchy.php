<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Concerns;

use App\Models\Tenant;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Make a "network admin acting on a community it oversees" fixture real.
 *
 * The cross-tenant actor tests describe their subject as "the exact production
 * shape: role='admin', is_tenant_super_admin=1, home tenant elsewhere" — a
 * NETWORK admin, someone who legitimately administers a community other than the
 * one their own account row sits on. But they expressed it only as "an admin whose
 * tenant_id is 999", and tenant 999 had no row at all, let alone any relationship
 * to the tenant being acted on. That describes an unrelated stranger who happens
 * to hold an admin flag, which is not the same person.
 *
 * It passed anyway while admin authority was decided by AdminTier alone, because
 * AdminTier is tenant-unaware — the same gap that let any community's admin take
 * over any other community's events (see TenantAdminScope). Once authority became
 * tenant-scoped, the fixture stopped matching its own description and the tests
 * failed: correctly, because as written the actor oversaw nothing.
 *
 * This builds the hierarchy the description implies — the home tenant becomes the
 * PARENT of the tenant being acted on — so the actor really does oversee it and
 * the tests assert their stated intent rather than an escalation.
 *
 * 🔴 Do not "simplify" this by giving the actor `is_super_admin`. That is the
 * platform tier, which reaches every tenant unconditionally and would pass no
 * matter how broken the tenant scoping became — it would test nothing.
 *
 * 🔴 Since 11 October 2026 the hierarchy is used the other way round. The owner
 * decided a tenant super admin acts in its OWN community only, so overseeing a
 * sub-community no longer confers any authority over it. The fixture stays
 * because it is the closest relationship a tenant super admin can have to
 * another community: a refusal asserted on top of it is the strongest form of
 * that rule, not merely an unrelated stranger being turned away.
 */
trait MakesNetworkAdminHierarchy
{
    /**
     * Place $homeTenantId directly above $actingTenantId in the tenant tree.
     *
     * Safe inside DatabaseTransactions: both writes roll back with the test. The
     * acting tenant is usually the shared test tenant, so its path and parent are
     * restored automatically rather than leaking into the next test.
     */
    protected function makeHomeTenantOversee(int $homeTenantId, int $actingTenantId): void
    {
        $homePath = "/{$homeTenantId}/";

        if (Tenant::withoutGlobalScopes()->whereKey($homeTenantId)->exists()) {
            Tenant::withoutGlobalScopes()->whereKey($homeTenantId)->update([
                'path' => $homePath,
                'depth' => 0,
                'parent_id' => null,
                'allows_subtenants' => true,
                'is_active' => true,
            ]);
        } else {
            // The tests reference this tenant id without ever creating its row.
            $slug = 'network-hub-' . $homeTenantId . '-' . Str::lower(Str::random(6));
            DB::table('tenants')->insert([
                'id' => $homeTenantId,
                'name' => 'Network Hub ' . $homeTenantId,
                'slug' => $slug,
                'domain' => $slug . '.project-nexus.test',
                'configuration' => json_encode([]),
                'path' => $homePath,
                'depth' => 0,
                'parent_id' => null,
                'allows_subtenants' => true,
                'is_active' => 1,
            ]);
        }

        // The acting tenant becomes a branch beneath it, so a materialised-path
        // prefix test resolves the actor's authority over it.
        Tenant::withoutGlobalScopes()->whereKey($actingTenantId)->update([
            'parent_id' => $homeTenantId,
            'path' => $homePath . $actingTenantId . '/',
            'depth' => 1,
        ]);
    }
}
