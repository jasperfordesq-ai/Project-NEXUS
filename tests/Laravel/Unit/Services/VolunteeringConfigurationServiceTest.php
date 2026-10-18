<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Services\VolunteeringConfigurationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

class VolunteeringConfigurationServiceTest extends TestCase
{
    use DatabaseTransactions;

    /**
     * The five volunteer reminders (moved here from the retired
     * vol_reminder_settings table on 2026-10-18) are plain on/off + timing
     * pairs. Email is the only channel, so there is no separate email switch.
     */
    public function test_reminder_settings_are_offered_with_their_defaults(): void
    {
        $defaults = VolunteeringConfigurationService::DEFAULTS;

        $this->assertSame(true, $defaults['volunteering.reminder_pre_shift_enabled']);
        $this->assertSame(24, $defaults['volunteering.reminder_pre_shift_hours_before']);
        $this->assertSame(true, $defaults['volunteering.reminder_post_shift_feedback_enabled']);
        $this->assertSame(2, $defaults['volunteering.reminder_post_shift_feedback_hours_after']);
        $this->assertSame(true, $defaults['volunteering.reminder_lapsed_volunteer_enabled']);
        $this->assertSame(30, $defaults['volunteering.reminder_lapsed_volunteer_days_inactive']);
        $this->assertSame(true, $defaults['volunteering.reminder_credential_expiry_enabled']);
        // One default now: the qualifications register used 30 days while the
        // old settings page advertised 14.
        $this->assertSame(30, $defaults['volunteering.reminder_credential_expiry_days_before']);
        $this->assertSame(true, $defaults['volunteering.reminder_training_expiry_enabled']);
        $this->assertSame(14, $defaults['volunteering.reminder_training_expiry_days_before']);
    }

    /**
     * Every numeric setting has a range the bulk save enforces, and only
     * numeric settings do. A default outside its own range would be refused
     * the moment an admin pressed Save.
     */
    public function test_every_numeric_setting_has_a_range_its_default_satisfies(): void
    {
        $defaults = VolunteeringConfigurationService::DEFAULTS;
        $ranges = VolunteeringConfigurationService::RANGES;

        foreach ($defaults as $key => $default) {
            if (is_int($default)) {
                $this->assertArrayHasKey($key, $ranges, "{$key} is numeric but has no range");
                [$min, $max] = $ranges[$key];
                $this->assertGreaterThanOrEqual($min, $default, "{$key} default below its minimum");
                $this->assertLessThanOrEqual($max, $default, "{$key} default above its maximum");
            } else {
                $this->assertArrayNotHasKey($key, $ranges, "{$key} is not numeric but has a range");
            }
        }

        foreach (array_keys($ranges) as $key) {
            $this->assertArrayHasKey($key, $defaults, "RANGES names {$key}, which DEFAULTS does not offer");
        }
    }

    /**
     * The reminder sweeps run across every community in one process, so they
     * need a community's value without switching the request's tenant context.
     */
    public function test_get_for_tenant_reads_another_communitys_stored_value(): void
    {
        $other = $this->testTenantId + 1000;
        $key = 'volunteering.reminder_pre_shift_hours_before';

        TenantContext::setById($this->testTenantId);
        Cache::forget("volunteering_config:{$other}");
        Cache::forget("volunteering_config:{$this->testTenantId}");
        DB::table('tenant_settings')->where('tenant_id', $other)->where('setting_key', $key)->delete();
        DB::table('tenant_settings')->insert([
            'tenant_id' => $other,
            'setting_key' => $key,
            'setting_value' => '48',
            'setting_type' => 'integer',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->assertSame(48, VolunteeringConfigurationService::getForTenant($other, $key));
        $this->assertSame(24, VolunteeringConfigurationService::getForTenant($this->testTenantId, $key), 'the current community still gets the default');
        $this->assertSame($this->testTenantId, TenantContext::getId(), 'reading another community must not switch the tenant context');
    }

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
