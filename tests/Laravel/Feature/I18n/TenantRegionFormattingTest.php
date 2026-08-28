<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\I18n;

use App\I18n\FormattingLocale;
use App\Services\TenantSettingsService;
use Carbon\Carbon;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Proves the per-community region setting actually reaches date rendering.
 *
 * The old `general.date_format` / `general.time_format` settings were writable
 * by admins and seeded at provisioning, but no code ever read them — they had no
 * effect for their entire existence. These tests exist so `general.region`
 * cannot quietly become the same kind of dead setting.
 */
class TenantRegionFormattingTest extends TestCase
{
    private const AUGUST_17 = '2026-08-17 15:04:00';
    private int $tenantId = 2;

    protected function setUp(): void
    {
        parent::setUp();
        App::setLocale('en');
        config(['app.region' => 'IE']);
        $this->clearRegionSetting();
        FormattingLocale::flush();
    }

    protected function tearDown(): void
    {
        $this->clearRegionSetting();
        parent::tearDown();
    }

    private function clearRegionSetting(): void
    {
        DB::table('tenant_settings')
            ->where('tenant_id', $this->tenantId)
            ->where('setting_key', 'general.region')
            ->delete();
        app(TenantSettingsService::class)->clearCacheForTenant($this->tenantId);
    }

    private function setRegionSetting(string $region): void
    {
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->tenantId, 'setting_key' => 'general.region'],
            ['setting_value' => $region],
        );
        app(TenantSettingsService::class)->clearCacheForTenant($this->tenantId);
    }

    public function testWithNoSettingTheCommunityFallsBackToThePlatformDefault(): void
    {
        $this->assertSame('en-IE', FormattingLocale::resolve('en', $this->tenantId));
    }

    public function testTheRegionSettingChangesTheRenderedDate(): void
    {
        $this->setRegionSetting('GB');
        FormattingLocale::flush();

        $this->assertSame('en-GB', FormattingLocale::resolve('en', $this->tenantId));
        $this->assertSame(
            '17/08/2026',
            Carbon::parse(self::AUGUST_17)
                ->locale(FormattingLocale::carbon('en', $this->tenantId))
                ->isoFormat('L'),
        );
    }

    public function testTheRegionSettingNeverProducesAnAmericanDate(): void
    {
        foreach (['IE', 'GB', 'CH', 'DE'] as $region) {
            $this->setRegionSetting($region);
            FormattingLocale::flush();

            $rendered = Carbon::parse(self::AUGUST_17)
                ->locale(FormattingLocale::carbon('en', $this->tenantId))
                ->isoFormat('LL');

            $this->assertStringContainsString(
                '17',
                $rendered,
                "Region {$region} lost the day of month",
            );
            $this->assertStringNotContainsString(
                'August 17',
                $rendered,
                "Region {$region} rendered an American date",
            );
        }
    }

    public function testAMalformedStoredRegionIsIgnoredRatherThanUsed(): void
    {
        $this->setRegionSetting('nonsense');
        FormattingLocale::flush();

        // Falls through to the tenant country code or the platform default;
        // either way the tag must stay well-formed.
        $this->assertMatchesRegularExpression(
            '/^en-[A-Z]{2}$/',
            FormattingLocale::resolve('en', $this->tenantId),
        );
    }

    public function testTheRegionAppliesToTheRecipientsOwnLanguage(): void
    {
        $this->setRegionSetting('GB');
        FormattingLocale::flush();

        $rendered = Carbon::parse(self::AUGUST_17)
            ->locale(FormattingLocale::carbon('ga', $this->tenantId))
            ->isoFormat('LL');

        // Irish language, day-first order — the region selects conventions,
        // it does not override the reader's language.
        $this->assertStringContainsString('Lúnasa', $rendered);
        $this->assertStringStartsWith('17 ', $rendered);
    }
}
