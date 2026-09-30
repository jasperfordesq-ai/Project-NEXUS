<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E073;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\FederationFeatureService;
use App\Services\PrerenderContentInvalidator;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-461 (E-073 I-4) — switching Federation off on the System Config page must
 * actually switch federation off.
 *
 * Federation is enforced from the `federation_tenant_features` table, not from
 * the `tenants.features` JSON the admin switches write:
 * `FederationFeatureService::isTenantFederationEnabled()` (`:440-461`) ends in
 * `isTenantFeatureEnabled(TENANT_FEDERATION_ENABLED)` (`:467-500`), which reads
 * that table. Every outbound push listener and
 * `FederationPartnershipService` (`:49`, which tests the TARGET community) gate
 * on that method.
 *
 * `AdminConfigController::updateFeature()` knows this and keeps the two in step
 * (`:295-300`). `AdminEnterpriseController::updateFeatureFlag()` wrote only the
 * JSON, so the member-facing gate closed — the community LOOKED un-federated —
 * while the community carried on pushing listings, messages, transactions,
 * profile updates, groups and reviews outward and carried on answering as a
 * valid federation target for others.
 *
 * This test asserts the CORRECT behaviour on both edges:
 *   - switching federation OFF through the enterprise route clears the
 *     enforcement row and the predicate becomes false;
 *   - the legitimate-access control is the opposite edge — switching it back ON
 *     through the SAME route also syncs, so the fix is a sync in both
 *     directions and not a one-way kill switch.
 */
final class F461EnterpriseFederationToggleSyncsEnforcementTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);

        $this->mock(PrerenderContentInvalidator::class, function ($mock): void {
            $mock->shouldReceive('refreshTenantOrFail')->andReturn(9501);
            $mock->shouldReceive('refreshAllOrFail')->andReturn(9502);
        });

        // Platform federation on, no whitelist mode, no lockdown — so the only
        // thing deciding the answer is the per-community switch under test.
        DB::table('federation_system_control')->updateOrInsert(
            ['id' => 1],
            [
                'federation_enabled' => 1,
                'emergency_lockdown_active' => 0,
                'whitelist_mode_enabled' => 0,
            ],
        );

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders([
            'Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
                $admin->id,
                $admin->tenant_id,
                TwoFactorPolicy::claims('totp'),
            ),
        ]);
    }

    // ------------------------------------------------------------------
    //  THE FIX — off on the page means off in the enforcement table.
    // ------------------------------------------------------------------

    public function test_switching_federation_off_on_the_system_config_page_stops_federation(): void
    {
        $this->givenFederationIsOn();

        $this->apiPatch('/v2/admin/enterprise/config/features', [
            'key' => 'federation',
            'value' => false,
            'type' => 'feature',
        ])->assertStatus(200);

        $this->assertFalse($this->tenantFeatureValue('federation'), 'the administrator\'s switch saved');

        $this->assertSame(
            0,
            (int) DB::table('federation_tenant_features')
                ->where('tenant_id', $this->testTenantId)
                ->where('feature_key', FederationFeatureService::TENANT_FEDERATION_ENABLED)
                ->value('is_enabled'),
            'the row every federation decision is made from is cleared too',
        );
        $this->assertFalse(
            $this->federationPredicate(),
            'and every outbound push listener and the partnership check now see federation as off',
        );
    }

    // ------------------------------------------------------------------
    //  THE CONTROL — the same route, the same field, the opposite value.
    //  Switching federation back ON must also sync, so the fix is a sync and
    //  not a removal of the feature.
    // ------------------------------------------------------------------

    public function test_control_switching_federation_back_on_through_the_same_route_also_syncs(): void
    {
        $this->givenFederationIsOff();

        $this->apiPatch('/v2/admin/enterprise/config/features', [
            'key' => 'federation',
            'value' => true,
            'type' => 'feature',
        ])->assertStatus(200);

        $this->assertTrue($this->tenantFeatureValue('federation'));

        $this->assertSame(
            1,
            (int) DB::table('federation_tenant_features')
                ->where('tenant_id', $this->testTenantId)
                ->where('feature_key', FederationFeatureService::TENANT_FEDERATION_ENABLED)
                ->value('is_enabled'),
            'CONTROL: the enforcement row is written back on, not only cleared',
        );
        $this->assertTrue(
            $this->federationPredicate(),
            'CONTROL: and the community really can federate again',
        );
    }

    // ------------------------------------------------------------------

    private function givenFederationIsOn(): void
    {
        DB::table('federation_tenant_features')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'feature_key' => FederationFeatureService::TENANT_FEDERATION_ENABLED],
            ['is_enabled' => 1],
        );
        $this->setTenantFeature('federation', true);

        $this->assertTrue(
            $this->federationPredicate(),
            'precondition: cross-community federation is on for this community',
        );
    }

    private function givenFederationIsOff(): void
    {
        DB::table('federation_tenant_features')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'feature_key' => FederationFeatureService::TENANT_FEDERATION_ENABLED],
            ['is_enabled' => 0],
        );
        $this->setTenantFeature('federation', false);

        $this->assertFalse(
            $this->federationPredicate(),
            'precondition: cross-community federation is off for this community',
        );
    }

    /** A fresh service instance each time — the predicate memoises per instance. */
    private function federationPredicate(): bool
    {
        return app()->makeWith(FederationFeatureService::class, [])
            ->isTenantFederationEnabled($this->testTenantId);
    }

    private function apiPatch(string $uri, array $data): \Illuminate\Testing\TestResponse
    {
        return $this->json('PATCH', '/api' . $uri, $data, [
            'X-Tenant-ID' => (string) $this->testTenantId,
        ]);
    }

    private function setTenantFeature(string $key, bool $value): void
    {
        $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('features');
        $features = $raw ? (json_decode((string) $raw, true) ?: []) : [];
        $features[$key] = $value;
        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['features' => json_encode($features)]);
    }

    private function tenantFeatureValue(string $key): bool
    {
        $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('features');
        $features = $raw ? (json_decode((string) $raw, true) ?: []) : [];

        return (bool) ($features[$key] ?? false);
    }
}
