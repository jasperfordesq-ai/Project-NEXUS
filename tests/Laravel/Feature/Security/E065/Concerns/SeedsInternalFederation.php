<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E065\Concerns;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\FederationFeatureService;
use Illuminate\Support\Facades\DB;

/**
 * SeedsInternalFederation — fixtures for INTERNAL cross-community federation
 * (two communities on one installation, joined by an active
 * `federation_partnerships` row). Internal federation is live and ungated by
 * design, so these fixtures model a reachable production configuration.
 *
 * Lifted from the E-065 slice K reproduction
 * `.local-docs-archive/security-log/E-065/repro/k/FederationConnectionsOptInTest.php`
 * so the E-066 regression tests for F-351, F-352, F-373 and F-377 build the
 * same world the findings were measured against.
 *
 * Requires the using test to also use `Tests\Laravel\Concerns\FederationIntegrationHarness`
 * (for `enableFederationForTenant()` and `columnExists()`).
 */
trait SeedsInternalFederation
{
    /**
     * Create a second community on this installation and switch federation on
     * for both it and the test tenant.
     */
    protected function seedPartnerTenant(string $name = 'E066 Partner'): int
    {
        $tenantId = (int) DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => 'e066-' . substr(uniqid(), -10),
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->enableFederationForTenant($this->testTenantId);
        $this->enableFederationForTenant($tenantId);
        $this->app->make(FederationFeatureService::class)->clearCache();
        TenantContext::setById($this->testTenantId);

        return $tenantId;
    }

    /** An active partnership between the test tenant and $partnerTenantId, every operation on. */
    protected function seedPartnership(int $partnerTenantId): int
    {
        $data = [
            'tenant_id' => $this->testTenantId,
            'partner_tenant_id' => $partnerTenantId,
            'status' => 'active',
            'federation_level' => 4,
            'profiles_enabled' => 1,
            'messaging_enabled' => 1,
            'transactions_enabled' => 1,
            'listings_enabled' => 1,
            'events_enabled' => 1,
            'groups_enabled' => 1,
            'requested_at' => now(),
            'approved_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ];

        if ($this->columnExists('federation_partnerships', 'canonical_pair')) {
            $data['canonical_pair'] = min($this->testTenantId, $partnerTenantId)
                . '-' . max($this->testTenantId, $partnerTenantId);
        }

        return (int) DB::table('federation_partnerships')->insertGetId($data);
    }

    /**
     * A member of $tenantId whose federation settings are fully open unless
     * $settings overrides them.
     */
    protected function seedFederatedUser(int $tenantId, array $attrs = [], array $settings = []): User
    {
        $user = User::factory()->forTenant($tenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $attrs));

        DB::table('federation_user_settings')->updateOrInsert(
            ['user_id' => $user->id],
            array_merge([
                'federation_optin' => 1,
                'profile_visible_federated' => 1,
                'messaging_enabled_federated' => 1,
                'transactions_enabled_federated' => 1,
                'appear_in_federated_search' => 1,
                'show_skills_federated' => 1,
                'show_location_federated' => 1,
                'show_reviews_federated' => 1,
                'service_reach' => 'remote_ok',
                'travel_radius_km' => 50,
                'email_notifications' => 0,
                'updated_at' => now(),
            ], $settings)
        );

        return $user;
    }
}
