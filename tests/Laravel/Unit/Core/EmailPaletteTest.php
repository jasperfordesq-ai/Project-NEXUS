<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Core;

use App\Core\EmailPalette;
use App\Support\ColourContrast;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Emails in a community's own colour (AWID feedback, Nov 2026).
 *
 * EmailPalette turns one colour into every shade an email needs. The rule
 * that matters most: white text on the header band and on buttons must read
 * at 4.5:1 (WCAG AA), whatever colour a community picked — the same rule the
 * member website applies with `ensureContrast` (react-frontend/src/lib/colorContrast.ts).
 */
class EmailPaletteTest extends TestCase
{
    /**
     * Button shades the website computes for the same colours
     * (`ensureContrast(colour, '#ffffff', 4.5, '#000000')`, measured with
     * node on 10 Nov 2026). Email and website must agree.
     *
     * @return array<string, array{string, string}>
     */
    public static function websiteButtonShades(): array
    {
        return [
            'standard indigo, just under 4.5' => ['#6366f1', '#5e61e5'],
            'standard paint, already passes' => ['#5b5ede', '#5b5ede'],
            'amber' => ['#f59e0b', '#9f6707'],
            'emerald' => ['#10b981', '#0b825a'],
            'pale yellow' => ['#ffcc00', '#8c7000'],
            'white' => ['#ffffff', '#737373'],
            'dark magenta, already passes' => ['#a3195b', '#a3195b'],
            'blue' => ['#3b82f6', '#326fd1'],
            'violet' => ['#8b5cf6', '#8457ea'],
        ];
    }

    #[DataProvider('websiteButtonShades')]
    public function test_button_shade_matches_the_website(string $colour, string $expected): void
    {
        $this->assertSame($expected, EmailPalette::fromColour($colour)['button']);
    }

    /** @return array<string, array{string|null}> */
    public static function colours(): array
    {
        return [
            'no community colour' => [null],
            'standard indigo' => ['#6366f1'],
            'teal' => ['#0f766e'],
            'magenta' => ['#a3195b'],
            'pale yellow' => ['#ffcc00'],
            'white' => ['#ffffff'],
            'black' => ['#000000'],
            'cyan' => ['#00ffff'],
            'amber' => ['#f59e0b'],
            'emerald' => ['#10b981'],
            'red' => ['#dc2626'],
            'upper-case hex' => ['#0F766E'],
        ];
    }

    #[DataProvider('colours')]
    public function test_white_text_reads_at_aa_on_the_button_and_header_shades(?string $colour): void
    {
        $palette = EmailPalette::fromColour($colour);

        foreach (['button', 'buttonEnd'] as $key) {
            $this->assertGreaterThanOrEqual(
                ColourContrast::AA_NORMAL_TEXT,
                ColourContrast::ratio('#ffffff', $palette[$key]),
                "White on {$key} {$palette[$key]} (from " . var_export($colour, true) . ') is below 4.5:1'
            );
        }
    }

    #[DataProvider('colours')]
    public function test_coloured_text_reads_at_aa_on_white_and_on_the_tint(?string $colour): void
    {
        $palette = EmailPalette::fromColour($colour);

        foreach (['primary', 'primaryDark'] as $key) {
            foreach (['#ffffff', $palette['accentBg']] as $background) {
                $this->assertGreaterThanOrEqual(
                    ColourContrast::AA_NORMAL_TEXT,
                    ColourContrast::ratio($palette[$key], $background),
                    "{$key} {$palette[$key]} on {$background} (from " . var_export($colour, true) . ') is below 4.5:1'
                );
            }
        }
    }

    public function test_a_readable_colour_is_used_as_it_is(): void
    {
        $palette = EmailPalette::fromColour('#0f766e');

        $this->assertSame('#0f766e', $palette['button']);
        $this->assertSame('linear-gradient(135deg, #0f766e 0%, ' . $palette['buttonEnd'] . ' 100%)', $palette['gradient']);
    }

    public function test_upper_case_input_is_normalised(): void
    {
        $this->assertSame(EmailPalette::fromColour('#0f766e'), EmailPalette::fromColour('#0F766E'));
    }

    public function test_no_colour_falls_back_to_the_standard_colour_the_website_paints(): void
    {
        $this->assertSame('#5b5ede', EmailPalette::STANDARD);
        $this->assertSame(EmailPalette::fromColour('#5b5ede'), EmailPalette::fromColour(null));
        $this->assertSame('#5b5ede', EmailPalette::fromColour(null)['button']);
    }

    /** @return array<string, array{string}> */
    public static function unusableValues(): array
    {
        return [
            'empty' => [''],
            'named colour' => ['red'],
            'three digits' => ['#fff'],
            'five digits' => ['#12345'],
            'attribute break-out' => ['#fff;" onmouseover="alert(1)'],
            'css injection' => ['#000000; background-image: url(https://attacker.test/x)'],
            'no hash' => ['0f766e'],
        ];
    }

    #[DataProvider('unusableValues')]
    public function test_an_unusable_value_falls_back_to_the_standard_colour(string $value): void
    {
        $this->assertSame(EmailPalette::fromColour(null), EmailPalette::fromColour($value));
    }

    #[DataProvider('colours')]
    public function test_every_shade_is_a_plain_six_digit_hex(?string $colour): void
    {
        foreach (EmailPalette::fromColour($colour) as $key => $value) {
            if ($key === 'gradient') {
                $this->assertMatchesRegularExpression(
                    '/^linear-gradient\(135deg, #[0-9a-f]{6} 0%, #[0-9a-f]{6} 100%\)$/',
                    $value
                );
                continue;
            }
            $this->assertMatchesRegularExpression('/^#[0-9a-f]{6}$/', $value, "{$key} is not #rrggbb");
        }
    }
}
