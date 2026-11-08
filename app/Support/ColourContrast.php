<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Support;

/**
 * WCAG 2.2 contrast ratio between two #rrggbb colours.
 *
 * Mirrors `getContrastRatio()` in react-frontend/src/lib/colorContrast.ts so a
 * colour the server accepts is one the admin screen also called readable.
 */
final class ColourContrast
{
    /** Minimum ratio for normal-size text (WCAG 2.2 AA, 1.4.3). */
    public const AA_NORMAL_TEXT = 4.5;

    public static function ratio(string $hexA, string $hexB): float
    {
        $a = self::relativeLuminance($hexA);
        $b = self::relativeLuminance($hexB);

        return (max($a, $b) + 0.05) / (min($a, $b) + 0.05);
    }

    private static function relativeLuminance(string $hex): float
    {
        $hex = ltrim(trim($hex), '#');
        if (preg_match('/^[0-9a-fA-F]{6}$/', $hex) !== 1) {
            throw new \InvalidArgumentException('Expected a #rrggbb colour');
        }

        $channels = array_map(
            static function (string $pair): float {
                $c = hexdec($pair) / 255;

                return $c <= 0.04045 ? $c / 12.92 : (($c + 0.055) / 1.055) ** 2.4;
            },
            str_split($hex, 2),
        );

        return 0.2126 * $channels[0] + 0.7152 * $channels[1] + 0.0722 * $channels[2];
    }
}
