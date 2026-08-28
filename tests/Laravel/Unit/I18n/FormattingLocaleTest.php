<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\I18n;

use App\I18n\FormattingLocale;
use App\I18n\LocaleContext;
use Carbon\Carbon;
use Illuminate\Support\Facades\App;
use Tests\Laravel\TestCase;

/**
 * Regression tests for the region half of the formatting locale.
 *
 * A bare language code carries no region, so Carbon resolves it to the
 * language's default one — the United States for English. Every date in every
 * email therefore rendered month-first ("August 17, 2026") for communities in
 * Ireland and the UK.
 *
 * These assertions deliberately check the RENDERED DATE rather than the locale
 * tag: a future rewrite of the resolution strategy must still produce day-first
 * output, and a test that only asserts `en-IE` would pass while the emails went
 * out wrong.
 */
class FormattingLocaleTest extends TestCase
{
    private const AUGUST_17 = '2026-08-17 15:04:00';

    protected function setUp(): void
    {
        parent::setUp();
        App::setLocale('en');
        FormattingLocale::flush();
    }

    public function testEnglishResolvesToARegionRatherThanABareTag(): void
    {
        $this->assertSame('en-IE', FormattingLocale::resolve('en'));
        $this->assertSame('en_IE', FormattingLocale::carbon('en'));
    }

    public function testEnglishDatesRenderDayFirstNotMonthFirst(): void
    {
        $rendered = Carbon::parse(self::AUGUST_17)
            ->locale(FormattingLocale::carbon('en'))
            ->isoFormat('LL');

        $this->assertSame('17 August 2026', $rendered);
        $this->assertStringNotContainsString('August 17', $rendered);
    }

    public function testTheAmericanRenderingIsWhatWeAreFixing(): void
    {
        // Control: proves the bug is real and that the fix is what moves it.
        $this->assertSame(
            'August 17, 2026',
            Carbon::parse(self::AUGUST_17)->locale('en')->isoFormat('LL'),
        );
    }

    public function testShortAndFullFormatsAreAlsoDayFirst(): void
    {
        $carbon = Carbon::parse(self::AUGUST_17)->locale(FormattingLocale::carbon('en'));

        $this->assertSame('17 Aug 2026', $carbon->isoFormat('ll'));
        $this->assertStringStartsWith('Monday 17 August 2026', $carbon->isoFormat('LLLL'));
    }

    public function testALanguageTagThatAlreadyCarriesARegionIsLeftAlone(): void
    {
        $this->assertSame('pt-BR', FormattingLocale::resolve('pt-BR'));
        $this->assertSame('pt_BR', FormattingLocale::carbon('pt_BR'));
    }

    public function testAnUnknownLanguageRegionPairKeepsTheLanguage(): void
    {
        // Carbon ships no ja_IE. Falling back to bare 'en' would render an
        // English date to a Japanese reader, so the language must survive.
        $this->assertStringStartsWith('ja', FormattingLocale::carbon('ja'));
    }

    public function testIrishRendersIrishMonthNamesDayFirst(): void
    {
        $rendered = Carbon::parse(self::AUGUST_17)
            ->locale(FormattingLocale::carbon('ga'))
            ->isoFormat('LL');

        $this->assertStringStartsWith('17 ', $rendered);
        $this->assertStringContainsString('Lúnasa', $rendered);
    }

    public function testLocaleContextSwitchesTheDateLocaleToTheRecipient(): void
    {
        $inside = LocaleContext::withLocale('ga', static fn (): string => Carbon::parse(self::AUGUST_17)
            ->isoFormat('LL'));

        $this->assertStringContainsString('Lúnasa', $inside);
        $this->assertStringStartsWith('17 ', $inside);
    }

    public function testLocaleContextRestoresTheDateLocaleAfterwards(): void
    {
        $before = Carbon::getLocale();
        LocaleContext::withLocale('ga', static fn (): string => 'done');

        $this->assertSame($before, Carbon::getLocale());
    }

    public function testLocaleContextRestoresTheDateLocaleAfterAnException(): void
    {
        $before = Carbon::getLocale();

        try {
            LocaleContext::withLocale('ga', static function (): void {
                throw new \RuntimeException('send failed');
            });
        } catch (\RuntimeException) {
            // expected
        }

        $this->assertSame($before, Carbon::getLocale());
    }

    public function testAMalformedRegionSettingFallsBackRatherThanCorrupting(): void
    {
        config(['app.region' => 'not-a-region']);
        FormattingLocale::flush();

        $this->assertSame('en-' . FormattingLocale::DEFAULT_REGION, FormattingLocale::resolve('en'));
    }

    public function testThePlatformRegionIsConfigurable(): void
    {
        config(['app.region' => 'GB']);
        FormattingLocale::flush();

        $this->assertSame('en-GB', FormattingLocale::resolve('en'));
        $this->assertSame(
            '17/08/2026',
            Carbon::parse(self::AUGUST_17)->locale(FormattingLocale::carbon('en'))->isoFormat('L'),
        );
    }
}
