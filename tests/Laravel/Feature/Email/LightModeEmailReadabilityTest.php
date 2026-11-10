<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Email;

use Illuminate\Foundation\Testing\DatabaseTransactions;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Laravel\TestCase;

/**
 * Every word in our emails reads at WCAG AA in the ordinary light look:
 * 4.5:1, or 3:1 for large text (24px, or 18.66px bold). Text with no letters
 * or digits (bullets, emoji) is decoration and not checked.
 *
 * Found 10 Nov 2026: white text on the hot-match orange (2.80:1) and the
 * mutual-match green (2.54:1), the same colours as text on white, and the
 * "you are a member" line under every builder email (2.43:1).
 * EmailColourReader works out every text colour.
 */
class LightModeEmailReadabilityTest extends TestCase
{
    use DatabaseTransactions;
    use RendersSampleEmails;

    public function test_the_checker_catches_white_text_on_orange(): void
    {
        $html = '<html><body><div style="background-color: #f97316;"><p style="color: #ffffff;">Hot match</p></div></body></html>';

        $failures = EmailColourReader::lightModeFailures($html);

        $this->assertCount(1, $failures);
        $this->assertStringContainsString('2.80:1', $failures[0]);
    }

    public function test_the_checker_allows_large_text_at_three_to_one(): void
    {
        $html = '<html><body><div style="background-color: #ffffff;">'
            . '<h1 style="font-size: 26px; color: #888888;">Large heading</h1>'
            . '<p style="font-size: 14px; color: #888888;">Small text</p></div></body></html>';

        $failures = EmailColourReader::lightModeFailures($html);

        $this->assertCount(1, $failures);
        $this->assertStringContainsString('Small text', $failures[0]);
    }

    /** @return array<string, array{string, string|null}> */
    public static function themesAndColours(): array
    {
        $cases = [];
        foreach (['brand', 'success', 'warning', 'danger', 'federation', 'achievement'] as $theme) {
            $cases["{$theme}, no community colour"] = [$theme, null];
        }
        foreach (['#0f766e', '#a3195b', '#ffcc00', '#000000', '#00ffff'] as $colour) {
            $cases["brand, {$colour}"] = ['brand', $colour];
        }

        return $cases;
    }

    #[DataProvider('themesAndColours')]
    public function test_every_builder_block_is_readable(string $theme, ?string $colour): void
    {
        $this->setCommunityColour($colour);

        $html = $this->everyBlock($theme);

        $this->assertNotEmpty(EmailColourReader::textSamples($html));
        $this->assertSame([], EmailColourReader::lightModeFailures($html));
    }

    /** @return array<string, array{'hot'|'mutual'|'digest', string|null}> */
    public static function matchEmails(): array
    {
        $cases = [];
        foreach (['hot', 'mutual', 'digest'] as $which) {
            $cases["{$which}, teal community"] = [$which, '#0f766e'];
            $cases["{$which}, no community colour"] = [$which, null];
        }

        return $cases;
    }

    /** @param 'hot'|'mutual'|'digest' $which */
    #[DataProvider('matchEmails')]
    public function test_match_emails_are_readable(string $which, ?string $colour): void
    {
        $this->setCommunityColour($colour);

        $html = $this->matchEmail($which);

        $this->assertNotEmpty(EmailColourReader::textSamples($html));
        $this->assertSame([], EmailColourReader::lightModeFailures($html));
    }
}
