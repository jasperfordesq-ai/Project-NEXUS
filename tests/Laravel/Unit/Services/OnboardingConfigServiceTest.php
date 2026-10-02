<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\OnboardingConfigService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

class OnboardingConfigServiceTest extends TestCase
{
    use DatabaseTransactions;

    public function test_getConfig_returns_defaults_when_no_settings_exist(): void
    {
        // Clear any seeded settings
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'LIKE', 'onboarding.%')
            ->delete();

        $config = OnboardingConfigService::getConfig($this->testTenantId);

        $this->assertTrue($config['enabled']);
        $this->assertTrue($config['mandatory']);
        $this->assertTrue($config['avatar_required']);
        $this->assertTrue($config['bio_required']);
        $this->assertEquals(10, $config['bio_min_length']);
        $this->assertEquals('disabled', $config['listing_creation_mode']);
        $this->assertTrue($config['step_safeguarding_enabled']);
        $this->assertFalse($config['require_completion_for_visibility']);
    }

    public function test_getConfig_reads_stored_values_over_defaults(): void
    {
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'onboarding.enabled'],
            ['setting_value' => '0', 'setting_type' => 'boolean']
        );
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'onboarding.bio_min_length'],
            ['setting_value' => '50', 'setting_type' => 'integer']
        );

        $config = OnboardingConfigService::getConfig($this->testTenantId);

        $this->assertFalse($config['enabled']);
        $this->assertEquals(50, $config['bio_min_length']);
    }

    public function test_getActiveSteps_returns_default_safeguarding_step(): void
    {
        $this->seedSafeguardingOption();

        $steps = OnboardingConfigService::getActiveSteps($this->testTenantId);

        $slugs = array_column($steps, 'slug');
        $this->assertContains('welcome', $slugs);
        $this->assertContains('profile', $slugs);
        $this->assertContains('interests', $slugs);
        $this->assertContains('skills', $slugs);
        $this->assertContains('confirm', $slugs);
        $this->assertContains('safeguarding', $slugs);
        foreach ($steps as $step) {
            $this->assertSame($step['slug'], $step['label_code']);
            $this->assertArrayNotHasKey('label', $step);
        }
    }

    public function test_getActiveSteps_includes_safeguarding_when_enabled(): void
    {
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'onboarding.step_safeguarding_enabled'],
            ['setting_value' => '1', 'setting_type' => 'boolean']
        );
        $this->seedSafeguardingOption();

        $steps = OnboardingConfigService::getActiveSteps($this->testTenantId);

        $slugs = array_column($steps, 'slug');
        $this->assertContains('safeguarding', $slugs);
    }

    public function test_getActiveSteps_hides_safeguarding_when_community_has_no_options(): void
    {
        // The step is switched on (the default), but the community has never
        // set up any safeguarding questions. Members must not be shown an
        // empty "Safeguarding" step that says nothing has been configured.
        DB::table('tenant_safeguarding_options')->where('tenant_id', $this->testTenantId)->delete();

        $slugs = array_column(OnboardingConfigService::getActiveSteps($this->testTenantId), 'slug');

        $this->assertNotContains('safeguarding', $slugs);
        $this->assertContains('confirm', $slugs);
    }

    public function test_getActiveSteps_hides_safeguarding_when_every_option_is_inactive(): void
    {
        DB::table('tenant_safeguarding_options')->where('tenant_id', $this->testTenantId)->delete();
        $this->seedSafeguardingOption(isActive: false);

        $slugs = array_column(OnboardingConfigService::getActiveSteps($this->testTenantId), 'slug');

        $this->assertNotContains('safeguarding', $slugs);
    }

    public function test_validateCompletion_does_not_demand_safeguarding_when_community_has_no_options(): void
    {
        DB::table('tenant_safeguarding_options')->where('tenant_id', $this->testTenantId)->delete();
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'onboarding.step_safeguarding_required'],
            ['setting_value' => '1', 'setting_type' => 'boolean']
        );
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'avatar_url' => 'https://example.com/photo.jpg',
            'bio' => 'A bio that is long enough to pass validation easily.',
        ]);
        TenantContext::setById($this->testTenantId);

        $unmet = OnboardingConfigService::validateCompletion($this->testTenantId, $user->id);

        $this->assertNotContains('safeguarding_required', $unmet);
    }

    private function seedSafeguardingOption(bool $isActive = true): void
    {
        DB::table('tenant_safeguarding_options')->insert([
            'tenant_id' => $this->testTenantId,
            'option_key' => 'test_option_' . bin2hex(random_bytes(4)),
            'option_type' => 'checkbox',
            'label' => 'Test safeguarding option',
            'is_active' => $isActive ? 1 : 0,
        ]);
    }

    public function test_getActiveSteps_excludes_disabled_steps(): void
    {
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'onboarding.step_interests_enabled'],
            ['setting_value' => '0', 'setting_type' => 'boolean']
        );

        $steps = OnboardingConfigService::getActiveSteps($this->testTenantId);

        $slugs = array_column($steps, 'slug');
        $this->assertNotContains('interests', $slugs);
    }

    public function test_validateCompletion_passes_with_avatar_and_bio(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'avatar_url' => 'https://example.com/photo.jpg',
            'bio' => 'A bio that is long enough to pass validation easily.',
        ]);
        // Factory creation fires the UserObserver (sync search/embedding jobs)
        // which leaves TenantContext pinned to tenant 1. Re-pin to the test
        // tenant so User::find()'s global tenant scope resolves the new user.
        TenantContext::setById($this->testTenantId);

        $unmet = OnboardingConfigService::validateCompletion($this->testTenantId, $user->id);

        $this->assertEmpty($unmet);
    }

    public function test_validateCompletion_fails_without_avatar(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'avatar_url' => null,
            'bio' => 'A bio that is long enough.',
        ]);
        TenantContext::setById($this->testTenantId);

        $unmet = OnboardingConfigService::validateCompletion($this->testTenantId, $user->id);

        $this->assertContains('avatar_required', $unmet);
    }

    public function test_validateCompletion_fails_without_bio(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'avatar_url' => 'https://example.com/photo.jpg',
            'bio' => null,
        ]);
        TenantContext::setById($this->testTenantId);

        $unmet = OnboardingConfigService::validateCompletion($this->testTenantId, $user->id);

        $this->assertContains('bio_required', $unmet);
    }

    public function test_isProfileVisible_returns_true_by_default(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'onboarding_completed' => false,
            'avatar_url' => null,
            'bio' => null,
        ]);
        TenantContext::setById($this->testTenantId);

        // Default gating settings are all false
        $this->assertTrue(OnboardingConfigService::isProfileVisible($this->testTenantId, $user->id));
    }

    public function test_isProfileVisible_respects_completion_gating(): void
    {
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'onboarding.require_completion_for_visibility'],
            ['setting_value' => '1', 'setting_type' => 'boolean']
        );

        $user = User::factory()->forTenant($this->testTenantId)->create([
            'onboarding_completed' => false,
        ]);
        TenantContext::setById($this->testTenantId);

        $this->assertFalse(OnboardingConfigService::isProfileVisible($this->testTenantId, $user->id));

        $user->update(['onboarding_completed' => true]);
        // update() re-fires the observer and resets the tenant context again.
        TenantContext::setById($this->testTenantId);
        $this->assertTrue(OnboardingConfigService::isProfileVisible($this->testTenantId, $user->id));
    }

    public function test_getListingCreationMode_returns_disabled_by_default(): void
    {
        $this->assertEquals('disabled', OnboardingConfigService::getListingCreationMode($this->testTenantId));
    }

    public function test_getListingCreationMode_returns_configured_mode(): void
    {
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'onboarding.listing_creation_mode'],
            ['setting_value' => 'draft', 'setting_type' => 'string']
        );

        $this->assertEquals('draft', OnboardingConfigService::getListingCreationMode($this->testTenantId));
    }

    public function test_getListingCreationMode_rejects_invalid_mode(): void
    {
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'onboarding.listing_creation_mode'],
            ['setting_value' => 'INVALID', 'setting_type' => 'string']
        );

        $this->assertEquals('disabled', OnboardingConfigService::getListingCreationMode($this->testTenantId));
    }
}
