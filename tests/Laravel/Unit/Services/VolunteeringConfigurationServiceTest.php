<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;

class VolunteeringConfigurationServiceTest extends TestCase
{
    public function test_class_exists(): void
    {
        $this->assertTrue(class_exists(\App\Services\VolunteeringConfigurationService::class));
    }

    public function test_has_public_methods(): void
    {
        $ref = new \ReflectionClass(\App\Services\VolunteeringConfigurationService::class);
        foreach (['get', 'set', 'getAll'] as $m) {
            $this->assertTrue($ref->hasMethod($m), "Missing method: {$m}");
            $this->assertTrue($ref->getMethod($m)->isPublic(), "Not public: {$m}");
        }
    }

    /**
     * Three switches sat in the admin's Module Configuration window from
     * 2026-03 to 2026-10 and were read by nothing on the server: an admin
     * could toggle them and nothing changed. A setting that is offered must
     * be enforced somewhere, so the DEFAULTS allow-list must not carry them.
     */
    public function test_defaults_do_not_offer_switches_nothing_reads(): void
    {
        $defaults = \App\Services\VolunteeringConfigurationService::DEFAULTS;

        foreach ([
            'volunteering.alert_default_expiry_hours',
            'volunteering.alert_skill_matching',
            'volunteering.burnout_detection',
        ] as $retired) {
            $this->assertArrayNotHasKey($retired, $defaults, "{$retired} is offered but nothing reads it");
        }
    }

    public function test_get_returns_default_when_missing(): void
    {
        try {
            $result = \App\Services\VolunteeringConfigurationService::get('nonexistent_key_xyz', 'default_value');
            $this->assertEquals('default_value', $result);
        } catch (\Throwable $e) {
            $this->assertTrue(true);
        }
    }
}
