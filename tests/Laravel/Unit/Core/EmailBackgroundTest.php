<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Core;

use App\Core\EmailBackground;
use PHPUnit\Framework\TestCase;

/**
 * Regression coverage for the invisible-CTA bug reported 2026-08-03.
 *
 * Outlook strips `background: linear-gradient(...)` outright. A button styled
 * with a gradient background and white text therefore arrived as white-on-white
 * — the recipient reported "there was not a link". EmailBackground splits the
 * declaration so the solid first stop survives independently of the gradient.
 */
class EmailBackgroundTest extends TestCase
{
    // -------------------------------------------------------
    // gradient()
    // -------------------------------------------------------

    public function test_emits_solid_colour_before_the_gradient(): void
    {
        $css = EmailBackground::gradient('linear-gradient(135deg, #6366f1, #8b5cf6)');

        $this->assertSame(
            'background-color: #6366f1; background-image: linear-gradient(135deg, #6366f1, #8b5cf6);',
            $css
        );
    }

    public function test_solid_colour_is_a_separate_declaration_from_the_gradient(): void
    {
        // The whole point: a sanitiser that drops the gradient declaration must
        // not be able to take the solid colour with it.
        $css = EmailBackground::gradient('linear-gradient(135deg, #10b981 0%, #059669 100%)');

        $this->assertStringContainsString('background-color: #10b981;', $css);
        $this->assertStringNotContainsString('background-color: #10b981 linear-gradient', $css);
    }

    public function test_ignores_the_leading_angle_when_picking_the_solid_colour(): void
    {
        $css = EmailBackground::gradient('linear-gradient(90deg, #f59e0b, #ef4444)');

        $this->assertStringStartsWith('background-color: #f59e0b;', $css);
    }

    public function test_strips_a_trailing_stop_position(): void
    {
        $css = EmailBackground::gradient('linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)');

        $this->assertStringStartsWith('background-color: #dc2626;', $css);
    }

    public function test_handles_radial_gradients(): void
    {
        $css = EmailBackground::gradient('radial-gradient(circle, #3b82f6, #2563eb)');

        $this->assertStringContainsString('background-color: #3b82f6;', $css);
        $this->assertStringContainsString('background-image: radial-gradient(circle, #3b82f6, #2563eb);', $css);
    }

    public function test_handles_rgb_colour_stops(): void
    {
        $css = EmailBackground::gradient('linear-gradient(135deg, rgb(99, 102, 241), rgb(139, 92, 246))');

        $this->assertStringStartsWith('background-color: rgb(99, 102, 241);', $css);
    }

    public function test_passes_a_plain_colour_through_untouched(): void
    {
        $this->assertSame('background: #6366f1;', EmailBackground::gradient('#6366f1'));
    }

    public function test_returns_empty_string_for_empty_input(): void
    {
        $this->assertSame('', EmailBackground::gradient('   '));
    }

    // -------------------------------------------------------
    // firstColor()
    // -------------------------------------------------------

    public function test_first_color_reads_the_opening_stop(): void
    {
        $this->assertSame('#22c55e', EmailBackground::firstColor('linear-gradient(135deg, #22c55e, #16a34a)'));
    }

    public function test_first_color_is_null_when_the_value_is_not_a_gradient(): void
    {
        $this->assertNull(EmailBackground::firstColor('#22c55e'));
    }
}
