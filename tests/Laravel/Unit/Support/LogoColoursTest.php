<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Support;

use App\Support\ColourContrast;
use App\Support\LogoColours;
use PHPUnit\Framework\TestCase;

/**
 * Colours suggested from a community's logo (warmth phase 6, "Make it yours").
 *
 * The promise to an admin: every colour offered can be saved. The save
 * endpoint refuses a community colour that cannot be read as text on white
 * (4.5:1), so a suggestion under that would be an offer the server then
 * turns down.
 */
class LogoColoursTest extends TestCase
{
    /** @var list<string> */
    private array $files = [];

    protected function tearDown(): void
    {
        foreach ($this->files as $file) {
            @unlink($file);
        }
        parent::tearDown();
    }

    public function test_a_logo_of_two_colours_gives_both_with_the_larger_first(): void
    {
        // Three quarters raspberry, one quarter teal, on a white card.
        $path = $this->png(120, 80, [255, 255, 255], [
            [[163, 25, 91], 10, 10, 80, 60],
            [[15, 118, 110], 90, 10, 20, 60],
        ]);

        $colours = LogoColours::fromFile($path);

        $this->assertCount(2, $colours);
        $this->assertSame('red-pink', $this->family($colours[0]), 'the larger area comes first');
        $this->assertSame('green-cyan', $this->family($colours[1]));
    }

    public function test_every_suggestion_can_be_read_on_white_so_the_server_will_accept_it(): void
    {
        // A pale yellow and a light sky blue: both fail on white as they are.
        $path = $this->png(100, 50, [255, 255, 255], [
            [[250, 204, 21], 0, 0, 50, 50],
            [[125, 211, 252], 50, 0, 50, 50],
        ]);

        $colours = LogoColours::fromFile($path);

        $this->assertNotEmpty($colours);
        foreach ($colours as $colour) {
            $this->assertMatchesRegularExpression('/^#[0-9a-f]{6}$/', $colour);
            $this->assertGreaterThanOrEqual(
                ColourContrast::AA_NORMAL_TEXT,
                ColourContrast::ratio($colour, '#ffffff'),
                "{$colour} would be refused by the save endpoint",
            );
        }
        // Deepened, not replaced: the yellow is still a yellow.
        $this->assertContains('yellow-orange', array_map(fn (string $c): string => $this->family($c), $colours));
    }

    public function test_a_colour_that_already_reads_on_white_is_left_exactly_as_it_is(): void
    {
        $this->assertSame('#a3195b', LogoColours::readableOnWhite('#A3195B'));
        $this->assertSame('#1d4ed8', LogoColours::readableOnWhite('1d4ed8'));
    }

    public function test_a_black_white_or_grey_logo_gives_nothing(): void
    {
        $path = $this->png(60, 60, [255, 255, 255], [
            [[0, 0, 0], 5, 5, 20, 50],
            [[120, 120, 120], 30, 5, 25, 50],
        ]);

        $this->assertSame([], LogoColours::fromFile($path));
    }

    public function test_a_muted_almost_grey_background_is_not_offered(): void
    {
        // A large stone-beige card with a small vivid blue mark. The beige
        // covers nine times the area, but it is a neutral, not a brand colour.
        $path = $this->png(100, 100, [200, 190, 172], [
            [[37, 99, 235], 40, 40, 30, 30],
        ]);

        $colours = LogoColours::fromFile($path);

        $this->assertCount(1, $colours);
        $this->assertSame('blue-violet', $this->family($colours[0]));
    }

    public function test_see_through_areas_are_not_read_as_a_colour(): void
    {
        // A canvas that is four-fifths see-through, tinted bright green (a soft
        // shadow or glow behind a mark looks like this); one small solid red mark.
        $image = imagecreatetruecolor(60, 60);
        imagealphablending($image, false);
        imagesavealpha($image, true);
        imagefill($image, 0, 0, imagecolorallocatealpha($image, 0, 255, 0, 100));
        imagefilledrectangle($image, 20, 20, 39, 39, imagecolorallocatealpha($image, 200, 30, 30, 0));
        $path = $this->temp('png');
        imagepng($image, $path);

        $colours = LogoColours::fromFile($path);

        $this->assertCount(1, $colours);
        $this->assertSame('red-pink', $this->family($colours[0]));
    }

    public function test_a_thin_edge_of_another_colour_is_not_offered(): void
    {
        // A 1-pixel orange outline round a large blue block: under the share a brand colour needs.
        $path = $this->png(200, 200, [29, 78, 216], [
            [[234, 88, 12], 0, 0, 200, 1],
        ]);

        $colours = LogoColours::fromFile($path);

        $this->assertCount(1, $colours);
        $this->assertSame('blue-violet', $this->family($colours[0]));
    }

    public function test_an_svg_gives_the_colours_written_in_it(): void
    {
        $svg = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
            . '<rect fill="#fff" width="10" height="10"/><circle fill="#BE123C" r="3"/>'
            . '<path stroke="#15803d" d="M0 0h10"/><text fill="#333">x</text></svg>';
        $path = $this->temp('svg');
        file_put_contents($path, $svg);

        $colours = LogoColours::fromFile($path);

        $this->assertEqualsCanonicalizing(['#be123c', '#15803d'], $colours);
    }

    public function test_no_more_than_the_number_asked_for(): void
    {
        $path = $this->png(120, 30, [255, 255, 255], [
            [[220, 38, 38], 0, 0, 30, 30],
            [[22, 163, 74], 30, 0, 30, 30],
            [[37, 99, 235], 60, 0, 30, 30],
            [[147, 51, 234], 90, 0, 30, 30],
        ]);

        $this->assertCount(3, LogoColours::fromFile($path));
        $this->assertCount(1, LogoColours::fromFile($path, 1));
        $this->assertSame([], LogoColours::fromFile($path, 0));
    }

    public function test_a_file_that_is_missing_or_is_not_a_picture_gives_nothing_and_raises_nothing(): void
    {
        $notAPicture = $this->temp('png');
        file_put_contents($notAPicture, 'this is not a picture');

        $this->assertSame([], LogoColours::fromFile($notAPicture));
        $this->assertSame([], LogoColours::fromFile(sys_get_temp_dir() . '/no-such-logo-' . uniqid() . '.png'));
        $this->assertSame([], LogoColours::fromFile(sys_get_temp_dir()));
    }

    /**
     * @param array{int, int, int} $background
     * @param list<array{array{int, int, int}, int, int, int, int}> $blocks each: colour, x, y, width, height
     */
    private function png(int $width, int $height, array $background, array $blocks): string
    {
        $image = imagecreatetruecolor($width, $height);
        imagefill($image, 0, 0, imagecolorallocate($image, ...$background));
        foreach ($blocks as [$colour, $x, $y, $w, $h]) {
            imagefilledrectangle($image, $x, $y, $x + $w - 1, $y + $h - 1, imagecolorallocate($image, ...$colour));
        }
        $path = $this->temp('png');
        imagepng($image, $path);

        return $path;
    }

    private function temp(string $extension): string
    {
        $path = sys_get_temp_dir() . '/logo-colours-' . uniqid('', true) . '.' . $extension;
        $this->files[] = $path;

        return $path;
    }

    /** A coarse name for where a colour sits on the wheel — enough to tell red from green from blue. */
    private function family(string $hex): string
    {
        $r = hexdec(substr($hex, 1, 2)) / 255;
        $g = hexdec(substr($hex, 3, 2)) / 255;
        $b = hexdec(substr($hex, 5, 2)) / 255;
        $max = max($r, $g, $b);
        $delta = $max - min($r, $g, $b);
        if ($delta < 0.0001) {
            return 'grey';
        }
        if ($max === $r) {
            $hue = 60 * fmod(($g - $b) / $delta, 6);
        } elseif ($max === $g) {
            $hue = 60 * (($b - $r) / $delta + 2);
        } else {
            $hue = 60 * (($r - $g) / $delta + 4);
        }
        $hue = $hue < 0 ? $hue + 360 : $hue;

        return match (true) {
            $hue < 20 || $hue >= 300 => 'red-pink',
            $hue < 70 => 'yellow-orange',
            $hue < 200 => 'green-cyan',
            default => 'blue-violet',
        };
    }
}
