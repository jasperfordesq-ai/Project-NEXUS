<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Volunteering;

use App\Core\TenantContext;
use App\Services\VolunteeringConfigurationService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Group sign-ups is alpha and hidden on every community by default (owner
 * decision 2026-10-06). The admin switch stays, so a community can opt in,
 * and a stored `true` left behind by an earlier whole-form save is cleared by
 * the data migration so the new default actually takes effect.
 */
class GroupSignupsTabHiddenByDefaultTest extends TestCase
{
    private const KEY = VolunteeringConfigurationService::CONFIG_TAB_GROUP_SIGNUPS;

    private const MIGRATION = __DIR__ . '/../../../../database/migrations/2026_10_06_150000_switch_off_group_signups_tab_for_all_tenants.php';

    private int $tenantId = 2;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->tenantId);
        $this->clearStoredValue();
    }

    protected function tearDown(): void
    {
        $this->clearStoredValue();
        parent::tearDown();
    }

    public function test_group_signups_tab_is_off_by_default(): void
    {
        self::assertFalse(VolunteeringConfigurationService::DEFAULTS[self::KEY]);
        self::assertFalse((bool) VolunteeringConfigurationService::get(self::KEY));
        self::assertFalse((bool) VolunteeringConfigurationService::getAll()[self::KEY]);

        // Every other tab keeps its old default, so this is a targeted change.
        self::assertTrue(VolunteeringConfigurationService::DEFAULTS[VolunteeringConfigurationService::CONFIG_TAB_SWAPS]);
        self::assertTrue(VolunteeringConfigurationService::DEFAULTS[VolunteeringConfigurationService::CONFIG_TAB_WAITLIST]);
    }

    public function test_a_community_can_still_opt_in_through_the_admin_switch(): void
    {
        VolunteeringConfigurationService::set(self::KEY, true);

        self::assertTrue((bool) VolunteeringConfigurationService::get(self::KEY));
        self::assertTrue((bool) VolunteeringConfigurationService::getAll()[self::KEY]);
    }

    public function test_migration_clears_a_stored_true_so_the_default_governs(): void
    {
        // The admin modal re-saves every key, so a community whose admin ever
        // pressed Save holds an explicit 'true' row that outlives a default flip.
        VolunteeringConfigurationService::set(self::KEY, true);
        self::assertTrue((bool) VolunteeringConfigurationService::get(self::KEY));

        $migration = require self::MIGRATION;
        $migration->up();

        self::assertSame(0, DB::table('tenant_settings')
            ->where('tenant_id', $this->tenantId)
            ->where('setting_key', self::KEY)
            ->count());

        // The migration must also drop the cached copy, or the old value would
        // keep being served until the cache expired.
        self::assertFalse((bool) VolunteeringConfigurationService::get(self::KEY));
        self::assertFalse((bool) VolunteeringConfigurationService::getAll()[self::KEY]);
    }

    public function test_migration_leaves_other_volunteering_settings_alone(): void
    {
        VolunteeringConfigurationService::set(VolunteeringConfigurationService::CONFIG_TAB_SWAPS, false);
        VolunteeringConfigurationService::set(self::KEY, true);

        $migration = require self::MIGRATION;
        $migration->up();

        self::assertFalse((bool) VolunteeringConfigurationService::get(VolunteeringConfigurationService::CONFIG_TAB_SWAPS));
    }

    private function clearStoredValue(): void
    {
        DB::table('tenant_settings')
            ->where('tenant_id', $this->tenantId)
            ->whereIn('setting_key', [self::KEY, VolunteeringConfigurationService::CONFIG_TAB_SWAPS])
            ->delete();
        Cache::forget("volunteering_config:{$this->tenantId}");
    }
}
