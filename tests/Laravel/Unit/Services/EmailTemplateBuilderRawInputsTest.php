<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Core\EmailTemplateBuilder;
use Tests\Laravel\TestCase;

/**
 * F-322 — the two EmailTemplateBuilder inputs that were still emitted raw
 * after the F-038 fix: `statCards[]['icon']` and `badges[]['color']`.
 *
 * No shipped caller passes anything but a literal emoji / hex colour, so the
 * control half of each test proves those legitimate values still render
 * exactly as before.
 */
class EmailTemplateBuilderRawInputsTest extends TestCase
{
    private const PAYLOAD = '<a href="https://attacker.test/sign-in">Verify your account</a>';

    public function test_statcard_icon_is_escaped(): void
    {
        $html = EmailTemplateBuilder::make()
            ->statCards([['value' => '1', 'label' => 'Label', 'icon' => self::PAYLOAD]])
            ->render();

        $this->assertStringNotContainsString('<a href="https://attacker.test', $html);
        $this->assertStringContainsString('&lt;a href=&quot;https://attacker.test', $html);
    }

    public function test_control_statcard_emoji_icon_still_renders(): void
    {
        $html = EmailTemplateBuilder::make()
            ->statCards([['value' => '42', 'label' => 'Hours', 'icon' => '⏱️']])
            ->render();

        $this->assertStringContainsString('<div style="font-size: 24px; margin-bottom: 4px;">⏱️</div>', $html);
    }

    public function test_badge_colour_cannot_break_out_of_the_style_attribute(): void
    {
        $html = EmailTemplateBuilder::make()
            ->badges([['text' => 'Badge', 'color' => '#fff;" onmouseover="x']])
            ->render();

        $this->assertStringNotContainsString('onmouseover', $html);
        // Falls back to the builder's default colour.
        $this->assertStringContainsString('color: #6366f1;', $html);
    }

    public function test_control_hex_badge_colour_still_renders(): void
    {
        $html = EmailTemplateBuilder::make()
            ->badges([['text' => 'Badge', 'color' => '#8b5cf6']])
            ->render();

        $this->assertStringContainsString('background: #8b5cf61a; color: #8b5cf6;', $html);
        $this->assertStringContainsString('border: 1px solid #8b5cf633;', $html);
    }
}
