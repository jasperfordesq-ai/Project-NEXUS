<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Concerns;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The three cross-community actors every "manager whose account lives elsewhere"
 * test needs, built the same way as the fixtures of 766b867d2 / 6adcd4ff6.
 *
 *  - AUTHORISED: a network admin whose home community really oversees the
 *    event's community (MakesNetworkAdminHierarchy), and a platform admin. The
 *    platform admin is the only cross-community actor the HTTP Authenticate
 *    middleware lets through (76fc2417a), so HTTP tests use it; service tests
 *    use the network admin, because the platform tier reaches every tenant
 *    unconditionally and would prove nothing about confinement on its own.
 *  - ORDINARY MEMBER of another community — must stay refused.
 *  - ADMIN OF AN UNRELATED COMMUNITY — role admin plus every tenant-level admin
 *    flag, but its community oversees nothing here. TenantAdminScope
 *    (f9b568a05) must keep refusing it once the actor lookup is global.
 */
trait MakesCrossTenantEventActors
{
    use MakesNetworkAdminHierarchy;

    /** The community the Event lives on. */
    protected int $eventTenantId = 2;

    /** Home community of the authorised network admin; oversees the event's. */
    protected int $networkHomeTenantId = 999;

    /** Home community of the unrelated actors; oversees nothing here. */
    protected int $unrelatedTenantId = 998;

    protected function makeNetworkOverseeEventTenant(): void
    {
        $this->makeHomeTenantOversee($this->networkHomeTenantId, $this->eventTenantId);
        TenantContext::setById($this->eventTenantId);
    }

    /** @param array<string,mixed> $overrides */
    protected function crossTenantActorUser(int $tenantId, array $overrides = []): User
    {
        $user = User::factory()->forTenant($tenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
        ], $overrides));
        TenantContext::setById($this->eventTenantId);

        return $user;
    }

    /** @param array<string,mixed> $overrides */
    protected function eventTenantUser(array $overrides = []): User
    {
        return $this->crossTenantActorUser($this->eventTenantId, $overrides);
    }

    /** role='admin', is_tenant_super_admin=1, home community oversees the event's. */
    protected function overseeingNetworkAdmin(): User
    {
        return $this->crossTenantActorUser($this->networkHomeTenantId, [
            'role' => 'admin',
            'is_admin' => 0,
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 1,
        ]);
    }

    /** A platform admin whose own account row lives on another community. */
    protected function crossTenantPlatformAdmin(): User
    {
        $this->ensureUnrelatedTenant();

        return $this->crossTenantActorUser($this->unrelatedTenantId, [
            'role' => 'admin',
            'is_super_admin' => 1,
        ]);
    }

    protected function crossTenantMember(): User
    {
        $this->ensureUnrelatedTenant();

        return $this->crossTenantActorUser($this->unrelatedTenantId, ['role' => 'member']);
    }

    /** Every tenant-level admin marker, on a community that oversees nothing here. */
    protected function unrelatedCommunityAdmin(): User
    {
        $this->ensureUnrelatedTenant();

        return $this->crossTenantActorUser($this->unrelatedTenantId, [
            'role' => 'admin',
            'is_admin' => 1,
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 1,
        ]);
    }

    /**
     * A stand-alone root community (its own tree, above and beside nothing
     * here). Rolls back with the test transaction.
     */
    protected function ensureUnrelatedTenant(): void
    {
        $id = $this->unrelatedTenantId;
        if (DB::table('tenants')->where('id', $id)->exists()) {
            DB::table('tenants')->where('id', $id)->update([
                'path' => "/{$id}/",
                'depth' => 0,
                'parent_id' => null,
                'is_active' => 1,
            ]);

            return;
        }

        $slug = 'unrelated-community-' . $id . '-' . Str::lower(Str::random(6));
        DB::table('tenants')->insert([
            'id' => $id,
            'name' => 'Unrelated Community ' . $id,
            'slug' => $slug,
            'domain' => $slug . '.project-nexus.test',
            'configuration' => json_encode([]),
            'path' => "/{$id}/",
            'depth' => 0,
            'parent_id' => null,
            'allows_subtenants' => true,
            'is_active' => 1,
        ]);
    }

    /** A published, scheduled, not-yet-started event on the event's community. */
    protected function crossTenantFixtureEvent(int $organizerId, array $overrides = []): int
    {
        $start = now()->addDays(3)->startOfMinute();

        return (int) DB::table('events')->insertGetId(array_merge([
            'tenant_id' => $this->eventTenantId,
            'user_id' => $organizerId,
            'title' => 'Cross-community manager fixture',
            'description' => 'Cross-community manager fixture.',
            'start_time' => $start,
            'end_time' => $start->copy()->addHours(2),
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 0,
            'is_recurring_template' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }
}
