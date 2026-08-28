<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for AdminOnboardingConfigController.
 *
 * Covers:
 *  - GET  /v2/admin/config/onboarding           get config (admin)
 *  - PUT  /v2/admin/config/onboarding           update config (admin)
 *  - GET  /v2/admin/config/onboarding/presets   list presets
 *  - POST /v2/admin/config/onboarding/apply-preset  apply preset
 */
class AdminOnboardingConfigControllerTest extends TestCase
{
    use DatabaseTransactions;

    public function test_get_config_requires_auth(): void
    {
        $response = $this->apiGet('/v2/admin/config/onboarding');

        $response->assertStatus(401);
    }

    public function test_get_config_rejects_non_admin(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/config/onboarding');

        $response->assertStatus(403);
    }

    public function test_apply_preset_rejects_non_admin(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPost('/v2/admin/config/onboarding/apply-preset', [
            'preset' => 'ireland',
        ]);

        $response->assertStatus(403);
    }

    public function test_presets_returns_list_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/config/onboarding/presets');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_update_config_rejects_non_admin(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPut('/v2/admin/config/onboarding', [
            'enabled' => true,
        ]);

        $response->assertStatus(403);
    }

    /**
     * A country preset installs options requiring vetting, so applying one to
     * a tenant with NO safeguarding jurisdiction must configure the matching
     * jurisdiction in the same action. Until 2026-08-28 this endpoint set
     * only onboarding.country_preset, which made the tenant LOOK configured
     * while the contact gate stayed permanently UNAVAILABLE and silently
     * emptied members' matches (Sentry 134069538).
     */
    public function test_apply_preset_configures_the_matching_jurisdiction_when_none_is_set(): void
    {
        DB::table('tenant_safeguarding_settings')->where('tenant_id', $this->testTenantId)->delete();
        app(\App\Services\SafeguardingJurisdictionService::class)->forget($this->testTenantId);

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $this->apiPost('/v2/admin/config/onboarding/apply-preset', ['preset' => 'ireland'])
            ->assertStatus(200)
            ->assertJsonPath('data.jurisdiction_configured', true)
            ->assertJsonPath('data.jurisdiction_warning', null);

        $this->assertDatabaseHas('tenant_safeguarding_settings', [
            'tenant_id' => $this->testTenantId,
            'jurisdiction' => 'ireland',
        ]);
    }

    /**
     * An already-configured jurisdiction is an explicit staff decision — the
     * preset must not overwrite it, but the admin must be told the two now
     * disagree (a preset's vetted options can't be satisfied by a different
     * jurisdiction's attestation).
     */
    public function test_apply_preset_warns_instead_of_overwriting_a_different_jurisdiction(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        app(\App\Services\SafeguardingJurisdictionService::class)
            ->configure($this->testTenantId, 'england_wales', $admin->id);

        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/config/onboarding/apply-preset', ['preset' => 'ireland'])
            ->assertStatus(200)
            ->assertJsonPath('data.jurisdiction_configured', false);

        $this->assertNotNull($response->json('data.jurisdiction_warning'));
        $this->assertDatabaseHas('tenant_safeguarding_settings', [
            'tenant_id' => $this->testTenantId,
            'jurisdiction' => 'england_wales',
        ]);
    }
}
