<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Migrations;

use App\Services\RedisCache;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * The five volunteer reminder settings moved from the vol_reminder_settings
 * table into the tenant's `volunteering.reminder_*` configuration on
 * 2026-10-18, so they sit beside every other volunteering setting in the
 * admin Module Configuration window. The migration copies what each
 * community had saved so nothing changes for them on the day.
 */
final class CopyVolReminderSettingsIntoTenantSettingsTest extends TestCase
{
    use DatabaseTransactions;

    private const MIGRATION = 'database/migrations/2026_10_18_120000_copy_vol_reminder_settings_into_tenant_settings.php';

    private const KEYS = [
        'volunteering.reminder_pre_shift_enabled',
        'volunteering.reminder_pre_shift_hours_before',
        'volunteering.reminder_post_shift_feedback_enabled',
        'volunteering.reminder_post_shift_feedback_hours_after',
        'volunteering.reminder_lapsed_volunteer_enabled',
        'volunteering.reminder_lapsed_volunteer_days_inactive',
        'volunteering.reminder_credential_expiry_enabled',
        'volunteering.reminder_credential_expiry_days_before',
        'volunteering.reminder_training_expiry_enabled',
        'volunteering.reminder_training_expiry_days_before',
    ];

    protected function setUp(): void
    {
        parent::setUp();
        DB::table('vol_reminder_settings')->where('tenant_id', $this->testTenantId)->delete();
        DB::table('tenant_settings')->where('tenant_id', $this->testTenantId)->whereIn('setting_key', self::KEYS)->delete();
    }

    private function oldRow(string $type, array $values): void
    {
        DB::table('vol_reminder_settings')->insert(array_merge([
            'tenant_id' => $this->testTenantId,
            'reminder_type' => $type,
            'enabled' => 1,
            'email_enabled' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ], $values));
    }

    private function stored(string $key): ?object
    {
        return DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', $key)
            ->first(['setting_value', 'setting_type']);
    }

    private function runMigration(): Mockery\MockInterface
    {
        $spy = Mockery::spy(RedisCache::class);
        $this->app->instance(RedisCache::class, $spy);

        $migration = require base_path(self::MIGRATION);
        $migration->up();

        return $spy;
    }

    public function test_each_saved_reminder_becomes_an_on_off_and_a_timing_setting(): void
    {
        $this->oldRow('pre_shift', ['enabled' => 1, 'email_enabled' => 1, 'hours_before' => 48]);
        $this->oldRow('post_shift_feedback', ['enabled' => 1, 'email_enabled' => 1, 'hours_after' => 6]);
        $this->oldRow('lapsed_volunteer', ['enabled' => 0, 'email_enabled' => 1, 'days_inactive' => 60]);
        $this->oldRow('credential_expiry', ['enabled' => 1, 'email_enabled' => 1, 'days_before_expiry' => 20]);
        $this->oldRow('training_expiry', ['enabled' => 1, 'email_enabled' => 1, 'days_before_expiry' => 7]);

        $spy = $this->runMigration();

        $this->assertSame(['true', 'boolean'], $this->pair('volunteering.reminder_pre_shift_enabled'));
        $this->assertSame(['48', 'integer'], $this->pair('volunteering.reminder_pre_shift_hours_before'));
        $this->assertSame(['true', 'boolean'], $this->pair('volunteering.reminder_post_shift_feedback_enabled'));
        $this->assertSame(['6', 'integer'], $this->pair('volunteering.reminder_post_shift_feedback_hours_after'));
        $this->assertSame(['false', 'boolean'], $this->pair('volunteering.reminder_lapsed_volunteer_enabled'));
        $this->assertSame(['60', 'integer'], $this->pair('volunteering.reminder_lapsed_volunteer_days_inactive'));
        $this->assertSame(['true', 'boolean'], $this->pair('volunteering.reminder_credential_expiry_enabled'));
        $this->assertSame(['20', 'integer'], $this->pair('volunteering.reminder_credential_expiry_days_before'));
        $this->assertSame(['true', 'boolean'], $this->pair('volunteering.reminder_training_expiry_enabled'));
        $this->assertSame(['7', 'integer'], $this->pair('volunteering.reminder_training_expiry_days_before'));

        $spy->shouldHaveReceived('delete')->with('tenant_bootstrap', $this->testTenantId)->atLeast()->once();
    }

    /**
     * The old page had two switches per reminder (on/off and email). Email was
     * the only channel, so "on but email off" sent nothing; that community
     * gets the reminder switched off, which is what it experienced.
     */
    public function test_a_reminder_with_email_switched_off_is_copied_as_switched_off(): void
    {
        $this->oldRow('pre_shift', ['enabled' => 1, 'email_enabled' => 0, 'hours_before' => 24]);

        $this->runMigration();

        $this->assertSame(['false', 'boolean'], $this->pair('volunteering.reminder_pre_shift_enabled'));
    }

    /**
     * A timing the old row never held (NULL) is not copied: the platform
     * default applies, exactly as it did before.
     */
    public function test_a_missing_timing_is_left_to_the_default(): void
    {
        $this->oldRow('lapsed_volunteer', ['enabled' => 1, 'days_inactive' => null]);

        $this->runMigration();

        $this->assertSame(['true', 'boolean'], $this->pair('volunteering.reminder_lapsed_volunteer_enabled'));
        $this->assertNull($this->stored('volunteering.reminder_lapsed_volunteer_days_inactive'));
    }

    /**
     * The old page had no limits on its number boxes, so a community may hold
     * a timing the new window refuses (it saves every key at once, so one
     * out-of-range value would block every save). Copy such a value clamped
     * to the range the server now enforces.
     */
    public function test_a_timing_outside_the_new_range_is_copied_clamped(): void
    {
        $this->oldRow('pre_shift', ['enabled' => 1, 'hours_before' => 300]);
        $this->oldRow('credential_expiry', ['enabled' => 1, 'days_before_expiry' => 120]);

        $this->runMigration();

        $this->assertSame(['168', 'integer'], $this->pair('volunteering.reminder_pre_shift_hours_before'));
        $this->assertSame(['90', 'integer'], $this->pair('volunteering.reminder_credential_expiry_days_before'));
    }

    /**
     * Blue/green runs the migration on each colour. A setting the community has
     * since saved through the new window must win over the old table.
     */
    public function test_running_twice_never_overwrites_a_setting_already_present(): void
    {
        $this->oldRow('pre_shift', ['enabled' => 1, 'hours_before' => 48]);
        DB::table('tenant_settings')->insert([
            'tenant_id' => $this->testTenantId,
            'setting_key' => 'volunteering.reminder_pre_shift_hours_before',
            'setting_value' => '12',
            'setting_type' => 'integer',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->runMigration();
        $this->runMigration();

        $this->assertSame(['12', 'integer'], $this->pair('volunteering.reminder_pre_shift_hours_before'));
        $this->assertSame(1, DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'volunteering.reminder_pre_shift_enabled')
            ->count());
    }

    /** @return array{0: string, 1: string} */
    private function pair(string $key): array
    {
        $row = $this->stored($key);
        $this->assertNotNull($row, "{$key} was not copied");

        return [(string) $row->setting_value, (string) $row->setting_type];
    }
}
