<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for admin onboarding configuration API endpoints.
 */
class AdminOnboardingConfigTest extends TestCase
{
    use DatabaseTransactions;

    private function actingAsAdmin(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'admin',
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);
        return $user;
    }

    private function actingAsMember(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'member',
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);
        return $user;
    }

    // =========================================================================
    // GET /v2/admin/config/onboarding
    // =========================================================================

    public function test_get_config_requires_admin(): void
    {
        $this->actingAsMember();
        $response = $this->apiGet('/v2/admin/config/onboarding');
        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    public function test_get_config_returns_defaults(): void
    {
        $this->actingAsAdmin();
        $response = $this->apiGet('/v2/admin/config/onboarding');
        $this->assertEquals(200, $response->getStatusCode());

        $data = $response->json('data') ?? $response->json();
        $config = $data['config'] ?? $data['data']['config'] ?? null;
        $this->assertNotNull($config);
        $this->assertTrue($config['enabled']);
        $this->assertTrue($config['mandatory']);
        // Retired 2026-10-02 — no longer part of the config at all.
        $this->assertArrayNotHasKey('listing_creation_mode', $config);
        $this->assertArrayNotHasKey('step_interests_enabled', $config);
    }

    public function test_get_config_returns_active_steps(): void
    {
        $this->actingAsAdmin();
        $response = $this->apiGet('/v2/admin/config/onboarding');
        $data = $response->json('data') ?? $response->json();
        $steps = $data['active_steps'] ?? $data['data']['active_steps'] ?? [];
        $this->assertNotEmpty($steps);
    }

    // =========================================================================
    // PUT /v2/admin/config/onboarding
    // =========================================================================

    public function test_update_config_requires_admin(): void
    {
        $this->actingAsMember();
        $response = $this->apiPut('/v2/admin/config/onboarding', ['enabled' => false]);
        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    public function test_update_config_saves_boolean_setting(): void
    {
        $this->actingAsAdmin();
        $response = $this->apiPut('/v2/admin/config/onboarding', [
            'enabled' => false,
        ]);
        $this->assertEquals(200, $response->getStatusCode());

        // Verify in DB
        $row = DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'onboarding.enabled')
            ->first();
        $this->assertNotNull($row);
        $this->assertEquals('0', $row->setting_value);
    }

    public function test_update_config_saves_integer_setting(): void
    {
        $this->actingAsAdmin();
        $response = $this->apiPut('/v2/admin/config/onboarding', [
            'bio_min_length' => 50,
        ]);
        $this->assertEquals(200, $response->getStatusCode());

        $row = DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'onboarding.bio_min_length')
            ->first();
        $this->assertEquals('50', $row->setting_value);
    }

    public function test_update_config_ignores_retired_settings(): void
    {
        $this->actingAsAdmin();
        $response = $this->apiPut('/v2/admin/config/onboarding', [
            'enabled' => true,
            'listing_creation_mode' => 'active',
            'listing_max_auto' => 5,
            'step_interests_enabled' => true,
        ]);
        $this->assertEquals(200, $response->getStatusCode());

        $data = $response->json('data') ?? $response->json();
        $updated = $data['updated_keys'] ?? $data['data']['updated_keys'] ?? [];
        $this->assertNotContains('listing_creation_mode', $updated);
        $this->assertNotContains('listing_max_auto', $updated);
        $this->assertNotContains('step_interests_enabled', $updated);
    }

    public function test_update_config_validates_bio_min_length_range(): void
    {
        $this->actingAsAdmin();
        $response = $this->apiPut('/v2/admin/config/onboarding', [
            'bio_min_length' => 999,
        ]);
        $this->assertEquals(422, $response->getStatusCode());
    }

    public function test_update_config_ignores_unknown_keys(): void
    {
        $this->actingAsAdmin();
        $response = $this->apiPut('/v2/admin/config/onboarding', [
            'enabled' => true,
            'unknown_key_xyz' => 'should be ignored',
        ]);
        $this->assertEquals(200, $response->getStatusCode());
    }

    public function test_update_config_saves_multiple_settings(): void
    {
        $this->actingAsAdmin();
        $response = $this->apiPut('/v2/admin/config/onboarding', [
            'enabled' => false,
            'mandatory' => false,
            'bio_min_length' => 25,
        ]);
        $this->assertEquals(200, $response->getStatusCode());

        $data = $response->json('data') ?? $response->json();
        $updated = $data['updated_keys'] ?? $data['data']['updated_keys'] ?? [];
        $this->assertContains('enabled', $updated);
        $this->assertContains('mandatory', $updated);
        $this->assertContains('bio_min_length', $updated);
    }

    // =========================================================================
    // GET /v2/admin/config/onboarding/presets
    // =========================================================================

    public function test_get_presets_returns_country_list(): void
    {
        $this->actingAsAdmin();
        $response = $this->apiGet('/v2/admin/config/onboarding/presets');
        $this->assertEquals(200, $response->getStatusCode());

        $data = $response->json('data') ?? $response->json();
        $presets = $data['data'] ?? $data;
        $this->assertIsArray($presets);

        $keys = array_column($presets, 'key');
        $this->assertContains('ireland', $keys);
        $this->assertContains('england_wales', $keys);
        $this->assertContains('scotland', $keys);
        $this->assertContains('northern_ireland', $keys);
        $this->assertContains('custom', $keys);
    }

    // =========================================================================
    // POST /v2/admin/config/onboarding/apply-preset
    // =========================================================================

    public function test_apply_preset_creates_safeguarding_options(): void
    {
        $this->actingAsAdmin();

        // Clear any existing options
        DB::table('tenant_safeguarding_options')
            ->where('tenant_id', $this->testTenantId)
            ->delete();

        $response = $this->apiPost('/v2/admin/config/onboarding/apply-preset', [
            'preset' => 'ireland',
        ]);
        $this->assertEquals(200, $response->getStatusCode());

        $data = $response->json('data') ?? $response->json();
        $created = $data['options_created'] ?? $data['data']['options_created'] ?? [];
        $this->assertNotEmpty($created);
        $this->assertContains('is_vulnerable_adult', $created);

        // Verify in DB
        $count = DB::table('tenant_safeguarding_options')
            ->where('tenant_id', $this->testTenantId)
            ->where('is_active', 1)
            ->count();
        $this->assertGreaterThan(0, $count);
    }

    public function test_apply_preset_refreshes_existing_preset_options(): void
    {
        $this->actingAsAdmin();

        // Apply Ireland preset first
        $this->apiPost('/v2/admin/config/onboarding/apply-preset', ['preset' => 'ireland']);

        // Modify an option
        DB::table('tenant_safeguarding_options')
            ->where('tenant_id', $this->testTenantId)
            ->where('option_key', 'is_vulnerable_adult')
            ->update(['label' => 'CUSTOM LABEL']);

        // Apply again
        $response = $this->apiPost('/v2/admin/config/onboarding/apply-preset', ['preset' => 'ireland']);
        $data = $response->json('data') ?? $response->json();
        $created = $data['options_created'] ?? $data['data']['options_created'] ?? [];
        $this->assertNotContains('is_vulnerable_adult', $created); // Not overwritten

        // Preset-owned rows are refreshed in place so stored wording cannot
        // drift away from the active jurisdiction policy.
        $label = DB::table('tenant_safeguarding_options')
            ->where('tenant_id', $this->testTenantId)
            ->where('option_key', 'is_vulnerable_adult')
            ->value('label');
        $this->assertEquals('safeguarding.presets.common.options.is_vulnerable_adult.label', $label);
    }

    public function test_apply_preset_rejects_invalid_preset(): void
    {
        $this->actingAsAdmin();
        $response = $this->apiPost('/v2/admin/config/onboarding/apply-preset', [
            'preset' => 'INVALID',
        ]);
        $this->assertEquals(422, $response->getStatusCode());
    }
}
