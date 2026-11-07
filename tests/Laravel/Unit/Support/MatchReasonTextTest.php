<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Support;

use App\I18n\LocaleContext;
use App\Support\Matching\MatchReasonText;
use Tests\Laravel\TestCase;

/**
 * AWID pilot feedback, Oct 2026: "why you matched" reasons were stored as
 * English phrases and shown in English on every client. They are now
 * rendered in the reader's language when read — which also covers rows
 * already in match_cache — and anything unrecognised is left as stored.
 */
class MatchReasonTextTest extends TestCase
{
    public function test_english_reasons_read_the_same_in_english(): void
    {
        $out = LocaleContext::withLocale('en', fn () => MatchReasonText::localize([
            'Same category: Gardening', 'Mutual exchange possible!', 'Nearby: 3.4 km away',
        ]));

        $this->assertSame(['Same category: Gardening', 'Mutual exchange possible!', 'Nearby: 3.4 km away'], $out);
    }

    public function test_reasons_are_translated_for_a_german_reader(): void
    {
        // Tests preload en, ga and de only (see the i18n notes), so German stands in.
        $out = LocaleContext::withLocale('de', fn () => MatchReasonText::localize([
            'Mutual exchange possible!',
            'Skills match your expertise',
            'Recently posted in your community',
        ]));

        $this->assertSame([
            'Gegenseitiger Austausch möglich!',
            'Passt zu Ihren Fähigkeiten',
            'Vor kurzem in Ihrer Gemeinschaft veröffentlicht',
        ], $out);
    }

    public function test_the_category_is_carried_across_and_can_be_shown_translated(): void
    {
        $plain = LocaleContext::withLocale('de', fn () => MatchReasonText::localize(['Same category: Gardening']));
        $mapped = LocaleContext::withLocale('de', fn () => MatchReasonText::localize(
            ['Related category: Gardening', 'Matches your interest in Gardening'],
            ['Gardening' => 'Gartenarbeit']
        ));

        $this->assertSame(['Gleiche Kategorie: Gardening'], $plain);
        $this->assertSame(['Verwandte Kategorie: Gartenarbeit', 'Passt zu Ihrem Interesse an Gartenarbeit'], $mapped);
    }

    public function test_a_distance_uses_the_readers_decimal_separator(): void
    {
        $out = LocaleContext::withLocale('de', fn () => MatchReasonText::localize(['Very close: 0.8 km away']));

        $this->assertSame(['Ganz in der Nähe: 0,8 km entfernt'], $out);
    }

    public function test_an_unknown_reason_is_left_exactly_as_stored(): void
    {
        $out = LocaleContext::withLocale('de', fn () => MatchReasonText::localize(['Shares your love of chess']));

        $this->assertSame(['Shares your love of chess'], $out);
    }

    public function test_a_stored_json_list_is_read_and_empty_entries_dropped(): void
    {
        $out = LocaleContext::withLocale('de', fn () => MatchReasonText::localize('["Posted recently", "", null]'));

        $this->assertSame(['Vor kurzem veröffentlicht'], $out);
    }
}
