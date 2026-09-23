<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Models;

use Tests\Laravel\TestCase;
use App\Models\AiSettings;
use App\Models\Concerns\HasTenantScope;

/**
 * AiSettings Model Tests
 *
 * Tests the AiSettings Eloquent model structure and available static methods:
 * getAllForTenant(), get(), has(), getMasked(), setMultiple().
 */
class AiSettingsTest extends \Tests\Laravel\TestCase
{
    // ==========================================
    // Model Structure Tests
    // ==========================================

    public function testTableName(): void
    {
        $model = new AiSettings();
        $this->assertEquals('ai_settings', $model->getTable());
    }

    public function testFillableContainsExpectedFields(): void
    {
        $model = new AiSettings();
        $expected = ['tenant_id', 'setting_key', 'setting_value', 'is_encrypted'];
        $this->assertEquals($expected, $model->getFillable());
    }

    public function testCastsContainIsEncrypted(): void
    {
        $model = new AiSettings();
        $casts = $model->getCasts();
        $this->assertEquals('boolean', $casts['is_encrypted']);
    }

    public function testUsesHasTenantScope(): void
    {
        $this->assertContains(
            HasTenantScope::class,
            class_uses_recursive(AiSettings::class)
        );
    }

    // ==========================================
    // Method Existence Tests
    // ==========================================

    public function testGetAllForTenantMethodExists(): void
    {
        $this->assertTrue(
            method_exists(AiSettings::class, 'getAllForTenant'),
            'AiSettings::getAllForTenant() should exist'
        );
    }

    public function testGetMethodExists(): void
    {
        $this->assertTrue(
            method_exists(AiSettings::class, 'get'),
            'AiSettings::get() should exist'
        );
    }

    public function testHasMethodExists(): void
    {
        $this->assertTrue(
            method_exists(AiSettings::class, 'has'),
            'AiSettings::has() should exist'
        );
    }

    public function testGetMaskedMethodExists(): void
    {
        $this->assertTrue(
            method_exists(AiSettings::class, 'getMasked'),
            'AiSettings::getMasked() should exist'
        );
    }

    public function testSetMultipleMethodExists(): void
    {
        $this->assertTrue(
            method_exists(AiSettings::class, 'setMultiple'),
            'AiSettings::setMultiple() should exist'
        );
    }

    // ==========================================
    // Return Type Tests
    // ==========================================

    public function testGetAllForTenantReturnsArray(): void
    {
        $result = AiSettings::getAllForTenant(99999);
        $this->assertIsArray($result);
    }

    public function testGetReturnsNullForNonExistentKey(): void
    {
        $result = AiSettings::get(99999, 'nonexistent_key_xyz');
        $this->assertNull($result);
    }

    public function testGetReturnsDefaultWhenNotFound(): void
    {
        $result = AiSettings::get(99999, 'nonexistent_key_xyz', 'my_default');
        $this->assertEquals('my_default', $result);
    }

    public function testHasReturnsFalseForNonExistentKey(): void
    {
        $result = AiSettings::has(99999, 'nonexistent_key_xyz');
        $this->assertFalse($result);
    }

    public function testGetMaskedReturnsNullForNonExistentKey(): void
    {
        $result = AiSettings::getMasked(99999, 'nonexistent_key_xyz');
        $this->assertNull($result);
    }

    public function testParseBooleanRecognizesExplicitValuesAndFailsClosed(): void
    {
        foreach (['1', 'true', 'on', 'yes', true, 1] as $value) {
            $this->assertTrue(AiSettings::parseBoolean($value));
        }
        foreach (['0', 'false', 'off', 'no', '', 'unexpected-value', false, 0, null] as $value) {
            $this->assertFalse(AiSettings::parseBoolean($value));
        }
    }
}
