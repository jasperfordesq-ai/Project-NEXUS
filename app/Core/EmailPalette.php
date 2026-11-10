<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Core;

use App\Support\ColourContrast;

/**
 * Every colour an email needs, derived from one base colour.
 *
 * Since Nov 2026 (AWID feedback: "energy, warmth, and community") emails wear
 * the community's own colour — tenants.configuration.primary_color, chosen on
 * Admin → Settings → "Community colour" — as the member website does. A
 * community with no colour gets the standard one.
 *
 * The shading matches the website exactly (react-frontend/src/lib/colorContrast.ts
 * `ensureContrast`, used by ThemeContext for `accent-strong`): a colour that
 * cannot carry white text at 4.5:1 is mixed towards black in 5% steps until it
 * can, so it keeps its hue. EmailPaletteTest pins the two against each other.
 *
 * Only plain #rrggbb values are produced, because every one of them lands
 * inside an inline style or a `bgcolor` attribute.
 */
final class EmailPalette
{
    /**
     * The standard colour, as the website paints it on the light theme:
     * #6366f1 shaded to read at 5.12:1 under white text (ThemeContext
     * STANDARD_ACCENT_LIGHT_PAINT).
     */
    public const STANDARD = '#5b5ede';

    private const WHITE = '#ffffff';
    private const BLACK = '#000000';
    private const HEX = '/^#[0-9a-f]{6}$/';

    /**
     * @return array{
     *     button: string, buttonEnd: string, gradient: string,
     *     primary: string, primaryDark: string, accent: string,
     *     accentBg: string, accentBorder: string
     * }
     *  - button / buttonEnd / gradient: fills that carry white text (header band, buttons)
     *  - primary / primaryDark: coloured text, readable on white and on accentBg
     *  - accent: a lighter decorative shade
     *  - accentBg / accentBorder: soft panels and their borders
     */
    public static function fromColour(?string $colour): array
    {
        $base = self::normalise($colour) ?? self::STANDARD;

        $button = self::ensureContrast($base, self::WHITE, ColourContrast::AA_NORMAL_TEXT, self::BLACK);
        $buttonEnd = self::mix($button, self::BLACK, 0.18);
        $accentBg = self::mix($base, self::WHITE, 0.92);

        return [
            'button' => $button,
            'buttonEnd' => $buttonEnd,
            'gradient' => "linear-gradient(135deg, {$button} 0%, {$buttonEnd} 100%)",
            'primary' => self::ensureContrast($base, $accentBg, ColourContrast::AA_NORMAL_TEXT, self::BLACK),
            'primaryDark' => self::ensureContrast(self::mix($base, self::BLACK, 0.25), $accentBg, ColourContrast::AA_NORMAL_TEXT, self::BLACK),
            'accent' => self::mix($base, self::WHITE, 0.25),
            'accentBg' => $accentBg,
            'accentBorder' => self::mix($base, self::WHITE, 0.78),
        ];
    }

    /**
     * The palette for the community currently in context: its own colour,
     * else the standard one.
     *
     * @return array{
     *     button: string, buttonEnd: string, gradient: string,
     *     primary: string, primaryDark: string, accent: string,
     *     accentBg: string, accentBorder: string
     * }
     */
    public static function forCommunity(): array
    {
        return self::fromColour(self::communityColour());
    }

    /**
     * The current community's chosen colour as #rrggbb, or null when it has
     * none (or the stored value is not a plain six-digit hex colour). An email
     * still sends when no community is in context, in the standard colour.
     */
    public static function communityColour(): ?string
    {
        try {
            $value = TenantContext::getSetting('primary_color');
        } catch (\Throwable) {
            return null;
        }

        return is_string($value) ? self::normalise($value) : null;
    }

    /**
     * The colour itself when it already reads at `$minRatio` against
     * `$background`; otherwise the least-mixed shade towards `$towards` that
     * does. A port of `ensureContrast` in react-frontend/src/lib/colorContrast.ts.
     */
    public static function ensureContrast(
        string $colour,
        string $background,
        float $minRatio = ColourContrast::AA_NORMAL_TEXT,
        string $towards = self::WHITE,
    ): string {
        if (ColourContrast::ratio($colour, $background) >= $minRatio) {
            return $colour;
        }
        for ($step = 1; $step <= 20; $step++) {
            $candidate = self::mix($colour, $towards, $step / 20);
            if (ColourContrast::ratio($candidate, $background) >= $minRatio) {
                return $candidate;
            }
        }

        return $towards;
    }

    /** Mix two #rrggbb colours: `$amount` 0 is `$from`, 1 is `$to`. */
    public static function mix(string $from, string $to, float $amount): string
    {
        $a = array_map('hexdec', str_split(substr($from, 1), 2));
        $b = array_map('hexdec', str_split(substr($to, 1), 2));
        $out = '#';
        for ($i = 0; $i < 3; $i++) {
            $out .= sprintf('%02x', (int) round($a[$i] + ($b[$i] - $a[$i]) * $amount));
        }

        return $out;
    }

    private static function normalise(?string $colour): ?string
    {
        if ($colour === null) {
            return null;
        }
        $colour = strtolower(trim($colour));

        return preg_match(self::HEX, $colour) === 1 ? $colour : null;
    }
}
