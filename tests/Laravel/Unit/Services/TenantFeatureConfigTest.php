<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\TenantFeatureConfig;

class TenantFeatureConfigTest extends TestCase
{
    public function test_mergeFeatures_returns_defaults_when_null(): void
    {
        $result = TenantFeatureConfig::mergeFeatures(null);

        $this->assertEquals(TenantFeatureConfig::FEATURE_DEFAULTS, $result);
    }

    public function test_mergeFeatures_overrides_with_db_values(): void
    {
        $result = TenantFeatureConfig::mergeFeatures(['events' => false, 'blog' => false]);

        $this->assertFalse($result['events']);
        $this->assertFalse($result['blog']);
        $this->assertTrue($result['groups']); // untouched default
    }

    public function test_mergeFeatures_preserves_unknown_keys(): void
    {
        $result = TenantFeatureConfig::mergeFeatures(['custom_feature' => true]);

        $this->assertTrue($result['custom_feature']);
        $this->assertTrue($result['events']); // default preserved
    }

    public function test_mergeFeatures_casts_values_to_bool(): void
    {
        $result = TenantFeatureConfig::mergeFeatures(['events' => 1, 'blog' => 0]);

        $this->assertTrue($result['events']);
        $this->assertFalse($result['blog']);
    }

    public function test_mergeModules_returns_defaults_when_null(): void
    {
        $result = TenantFeatureConfig::mergeModules(null);

        $this->assertEquals(TenantFeatureConfig::MODULE_DEFAULTS, $result);
    }

    public function test_mergeModules_overrides_with_db_values(): void
    {
        $result = TenantFeatureConfig::mergeModules(['wallet' => false]);

        $this->assertFalse($result['wallet']);
        $this->assertTrue($result['listings']); // untouched default
    }

    public function test_mergeModules_casts_values_to_bool(): void
    {
        $result = TenantFeatureConfig::mergeModules(['listings' => 0, 'wallet' => '1']);

        $this->assertFalse($result['listings']);
        $this->assertTrue($result['wallet']);
    }

    public function test_feature_defaults_has_expected_keys(): void
    {
        $expected = ['events', 'groups', 'gamification', 'goals', 'blog', 'resources',
            'volunteering', 'exchange_workflow', 'organisations', 'federation',
            'connections', 'reviews', 'polls', 'job_vacancies', 'ideation_challenges',
            'direct_messaging', 'group_exchanges', 'search', 'ai_chat',
            'fadp_compliance', 'local_advertising', 'identity_verification',
            'two_factor_authentication', 'biometric_login', 'appreciations'];

        foreach ($expected as $key) {
            $this->assertArrayHasKey($key, TenantFeatureConfig::FEATURE_DEFAULTS);
        }
    }

    public function test_thank_you_notes_default_on_and_can_be_switched_off(): void
    {
        // Default ON: communities already using thank-you notes lose nothing.
        $this->assertTrue(TenantFeatureConfig::FEATURE_DEFAULTS['appreciations']);
        $this->assertTrue(TenantFeatureConfig::mergeFeatures([])['appreciations']);
        $this->assertFalse(TenantFeatureConfig::mergeFeatures(['appreciations' => false])['appreciations']);
    }

    public function test_module_defaults_has_expected_keys(): void
    {
        $expected = ['listings', 'wallet', 'messages', 'dashboard', 'feed', 'notifications', 'profile', 'settings'];

        foreach ($expected as $key) {
            $this->assertArrayHasKey($key, TenantFeatureConfig::MODULE_DEFAULTS);
        }
    }

    public function test_all_defaults_are_booleans(): void
    {
        foreach (TenantFeatureConfig::FEATURE_DEFAULTS as $key => $value) {
            $this->assertIsBool($value, "Feature default for '{$key}' should be a boolean");
        }
        foreach (TenantFeatureConfig::MODULE_DEFAULTS as $key => $value) {
            $this->assertIsBool($value, "Module default for '{$key}' should be a boolean");
        }
    }

    public function test_core_modules_default_enabled(): void
    {
        // Core modules are always-on; opt-in/accessible features (caring_community,
        // marketplace, courses, etc.) intentionally default to false.
        foreach (TenantFeatureConfig::MODULE_DEFAULTS as $key => $value) {
            $this->assertTrue($value, "Module default for '{$key}' should be true");
        }
    }

    public function test_authentication_enrollment_features_default_enabled(): void
    {
        $this->assertTrue(TenantFeatureConfig::FEATURE_DEFAULTS['two_factor_authentication']);
        $this->assertTrue(TenantFeatureConfig::FEATURE_DEFAULTS['biometric_login']);
    }
}
