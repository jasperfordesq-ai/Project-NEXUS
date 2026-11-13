<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support;

/**
 * Colours to suggest to a community's admin, taken from the community's own
 * logo (warmth phase 6, "Make it yours").
 *
 * A suggestion is only ever offered — the admin chooses, and the same
 * save endpoint and the same rule (readable as text on white, 4.5:1) apply as
 * for a colour typed by hand. So every colour returned here has already been
 * deepened until it passes that rule: an admin is never offered a colour the
 * server would then refuse.
 *
 * How a logo becomes colours: its pixels (or an SVG's written colours) are
 * sorted into slices of the colour wheel. Greys, near-white, near-black and
 * see-through pixels say nothing about a brand's colour and are left out.
 * The fullest slices win; each is represented by its average colour.
 */
final class LogoColours
{
    /** Slices of the colour wheel. 12 keeps "orange" apart from "red" and "yellow". */
    private const HUE_SLICES = 12;

    /** Below this saturation a pixel is a grey. */
    private const MIN_SATURATION = 0.25;

    /** A slice must hold this share of the coloured pixels to be a brand colour, not an anti-aliased edge. */
    private const MIN_SHARE = 0.06;

    /** The longest side a logo is shrunk to before its pixels are read. */
    private const SAMPLE_SIZE = 64;

    /** A logo file larger than this is not read at all (uploads are capped at 2 MB). */
    private const MAX_BYTES = 4 * 1024 * 1024;

    /**
     * @return list<string> up to `$max` lower-case #rrggbb colours, strongest first; empty when the
     *                      file cannot be read or holds no colour
     */
    public static function fromFile(string $path, int $max = 3): array
    {
        if ($max < 1 || !is_file($path) || !is_readable($path)) {
            return [];
        }
        $size = filesize($path);
        if ($size === false || $size === 0 || $size > self::MAX_BYTES) {
            return [];
        }
        $bytes = file_get_contents($path);
        if ($bytes === false) {
            return [];
        }

        if (self::looksLikeSvg($bytes)) {
            return self::fromSvg($bytes, $max);
        }

        return self::fromRaster($bytes, $max);
    }

    /**
     * The colours written in an SVG's markup (`#rgb` and `#rrggbb`). Each
     * counts once however large its shape is: an SVG says what its colours
     * are, not how much of the picture each one covers.
     *
     * @return list<string>
     */
    public static function fromSvg(string $svg, int $max = 3): array
    {
        if (preg_match_all('/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/', $svg, $matches) < 1) {
            return [];
        }
        $pixels = [];
        foreach ($matches[1] as $hex) {
            if (strlen($hex) === 3) {
                $hex = $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2];
            }
            $pixels[] = [hexdec(substr($hex, 0, 2)), hexdec(substr($hex, 2, 2)), hexdec(substr($hex, 4, 2))];
        }

        return self::fromPixels($pixels, $max);
    }

    /**
     * @param list<array{int, int, int}> $pixels opaque pixels as [red, green, blue], each 0–255
     * @return list<string>
     */
    public static function fromPixels(array $pixels, int $max = 3): array
    {
        /** @var array<int, array{weight: float, r: float, g: float, b: float}> $slices */
        $slices = [];
        $total = 0.0;

        foreach ($pixels as [$r, $g, $b]) {
            [$hue, $saturation, $lightness] = self::toHsl($r, $g, $b);
            if ($saturation < self::MIN_SATURATION || $lightness < 0.12 || $lightness > 0.92) {
                continue;
            }
            // A vivid pixel says more about the brand than a washed-out one.
            $weight = $saturation;
            $slice = (int) floor($hue / (360 / self::HUE_SLICES)) % self::HUE_SLICES;
            $slices[$slice] ??= ['weight' => 0.0, 'r' => 0.0, 'g' => 0.0, 'b' => 0.0];
            $slices[$slice]['weight'] += $weight;
            $slices[$slice]['r'] += $r * $weight;
            $slices[$slice]['g'] += $g * $weight;
            $slices[$slice]['b'] += $b * $weight;
            $total += $weight;
        }

        if ($total <= 0.0) {
            return [];
        }

        uasort($slices, static fn (array $a, array $b): int => $b['weight'] <=> $a['weight']);

        $colours = [];
        foreach ($slices as $slice) {
            if ($slice['weight'] / $total < self::MIN_SHARE) {
                continue;
            }
            $hex = self::readableOnWhite(sprintf(
                '#%02x%02x%02x',
                (int) round($slice['r'] / $slice['weight']),
                (int) round($slice['g'] / $slice['weight']),
                (int) round($slice['b'] / $slice['weight']),
            ));
            if (!in_array($hex, $colours, true)) {
                $colours[] = $hex;
            }
            if (count($colours) >= $max) {
                break;
            }
        }

        return $colours;
    }

    /**
     * The same colour, deepened towards black only as far as it takes to be
     * read as text on white at 4.5:1 — the rule the save endpoint enforces.
     * A colour that already passes comes back unchanged.
     */
    public static function readableOnWhite(string $hex): string
    {
        $hex = '#' . strtolower(ltrim(trim($hex), '#'));
        $r = hexdec(substr($hex, 1, 2));
        $g = hexdec(substr($hex, 3, 2));
        $b = hexdec(substr($hex, 5, 2));

        for ($step = 0; $step <= 100; $step++) {
            $keep = 1 - $step / 100;
            $candidate = sprintf('#%02x%02x%02x', (int) round($r * $keep), (int) round($g * $keep), (int) round($b * $keep));
            if (ColourContrast::ratio($candidate, '#ffffff') >= ColourContrast::AA_NORMAL_TEXT) {
                return $candidate;
            }
        }

        return '#000000';
    }

    /** @return list<string> */
    private static function fromRaster(string $bytes, int $max): array
    {
        if (!function_exists('imagecreatefromstring')) {
            return [];
        }
        // A corrupt file makes GD raise a warning; it is not an error worth a log line.
        $image = @imagecreatefromstring($bytes);
        if ($image === false) {
            return [];
        }

        $width = imagesx($image);
        $height = imagesy($image);
        if ($width < 1 || $height < 1) {
            return [];
        }

        // Read a small copy: the answer is the same and a 4,000-pixel logo costs nothing.
        $scale = min(1, self::SAMPLE_SIZE / max($width, $height));
        $sampleWidth = max(1, (int) round($width * $scale));
        $sampleHeight = max(1, (int) round($height * $scale));
        $sample = imagecreatetruecolor($sampleWidth, $sampleHeight);
        imagealphablending($sample, false);
        imagesavealpha($sample, true);
        imagefill($sample, 0, 0, imagecolorallocatealpha($sample, 0, 0, 0, 127));
        imagecopyresampled($sample, $image, 0, 0, 0, 0, $sampleWidth, $sampleHeight, $width, $height);

        $pixels = [];
        for ($y = 0; $y < $sampleHeight; $y++) {
            for ($x = 0; $x < $sampleWidth; $x++) {
                $rgba = imagecolorat($sample, $x, $y);
                // GD's alpha runs 0 (solid) to 127 (clear). A mostly clear pixel is background.
                if ((($rgba >> 24) & 0x7F) > 63) {
                    continue;
                }
                $pixels[] = [($rgba >> 16) & 0xFF, ($rgba >> 8) & 0xFF, $rgba & 0xFF];
            }
        }

        return self::fromPixels($pixels, $max);
    }

    private static function looksLikeSvg(string $bytes): bool
    {
        return stripos(substr($bytes, 0, 2048), '<svg') !== false;
    }

    /** @return array{float, float, float} hue 0–360, saturation 0–1, lightness 0–1 */
    private static function toHsl(int $r, int $g, int $b): array
    {
        $r /= 255;
        $g /= 255;
        $b /= 255;
        $max = max($r, $g, $b);
        $min = min($r, $g, $b);
        $lightness = ($max + $min) / 2;
        $delta = $max - $min;
        if ($delta < 0.00001) {
            return [0.0, 0.0, $lightness];
        }
        $saturation = $delta / (1 - abs(2 * $lightness - 1));
        if ($max === $r) {
            $hue = 60 * fmod(($g - $b) / $delta, 6);
        } elseif ($max === $g) {
            $hue = 60 * (($b - $r) / $delta + 2);
        } else {
            $hue = 60 * (($r - $g) / $delta + 4);
        }
        if ($hue < 0) {
            $hue += 360;
        }

        return [$hue, min(1.0, $saturation), $lightness];
    }
}
