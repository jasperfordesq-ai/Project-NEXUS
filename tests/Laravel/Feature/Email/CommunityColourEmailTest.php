<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Email;

use App\Core\EmailPalette;
use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\Services\NotificationDispatcher;
use App\Support\ColourContrast;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Laravel\TestCase;

/**
 * Emails carry the community's own colour (AWID feedback, Nov 2026), as the
 * member website does since 9 Nov: the header band and the main button use
 * the colour a community admin chose (tenants.configuration.primary_color),
 * shaded where needed so their white text reads at 4.5:1. A community with
 * no colour gets the standard one. Emails whose colour carries a meaning
 * (success, warning, danger, partner community, achievement) keep it.
 */
class CommunityColourEmailTest extends TestCase
{
    use DatabaseTransactions;

    private function setCommunityColour(?string $colour): void
    {
        $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('configuration');
        $config = json_decode((string) $raw, true) ?: [];
        if ($colour === null) {
            unset($config['primary_color']);
        } else {
            $config['primary_color'] = $colour;
        }
        DB::table('tenants')->where('id', $this->testTenantId)->update(['configuration' => json_encode($config)]);
        TenantContext::setById($this->testTenantId);
    }

    private function renderEmail(?string $theme): string
    {
        $builder = EmailTemplateBuilder::make();
        if ($theme !== null) {
            $builder->theme($theme);
        }

        return $builder
            ->title('Title')
            ->greeting('Sam')
            ->paragraph('Body')
            ->button('Open', 'https://example.test/x')
            ->render();
    }

    /** The solid fill behind the header title (the first `bgcolor`). */
    private function headerFill(string $html): string
    {
        $this->assertSame(1, preg_match('/<td bgcolor="(#[0-9a-f]{6})" style="padding: 32px 40px;/', $html, $m));

        return $m[1];
    }

    /** The solid fill behind the button label. */
    private function buttonFill(string $html): string
    {
        $this->assertSame(1, preg_match('/<td bgcolor="(#[0-9a-f]{6})" style="border-radius: 10px;/', $html, $m));

        return $m[1];
    }

    /**
     * Every colour white text sits on: each `bgcolor` and both stops of every
     * gradient.
     *
     * @return list<string>
     */
    private function whiteTextFills(string $html): array
    {
        preg_match_all('/bgcolor="(#[0-9a-fA-F]{6})"/', $html, $solid);
        preg_match_all('/linear-gradient\(135deg, (#[0-9a-fA-F]{6}) 0%, (#[0-9a-fA-F]{6}) 100%\)/', $html, $stops);

        return array_values(array_unique(array_merge($solid[1], $stops[1], $stops[2])));
    }

    public function test_the_header_and_button_use_the_community_colour(): void
    {
        $this->setCommunityColour('#0f766e');

        foreach (['brand', 'info', null] as $theme) {
            $html = $this->renderEmail($theme);
            $label = var_export($theme, true);

            $this->assertSame('#0f766e', $this->headerFill($html), "header, theme {$label}");
            $this->assertSame('#0f766e', $this->buttonFill($html), "button, theme {$label}");
            $this->assertStringNotContainsString('#6366f1', $html, "standard indigo left in theme {$label}");
        }
    }

    public function test_without_a_community_colour_the_standard_colour_is_used(): void
    {
        $this->setCommunityColour(null);

        $html = $this->renderEmail('brand');

        $this->assertSame(EmailPalette::STANDARD, $this->headerFill($html));
        $this->assertSame(EmailPalette::STANDARD, $this->buttonFill($html));
    }

    public function test_a_pale_colour_saved_before_the_contrast_check_is_shaded_for_white_text(): void
    {
        // The admin screen now refuses this colour, but a value stored before
        // that check (or by another path) must not produce an unreadable email.
        $this->setCommunityColour('#ffcc00');

        $html = $this->renderEmail('brand');

        $this->assertSame('#8c7000', $this->headerFill($html));
        $this->assertSame('#8c7000', $this->buttonFill($html));
    }

    public function test_an_unusable_stored_value_falls_back_and_never_reaches_the_html(): void
    {
        $this->setCommunityColour('#fff;" onmouseover="alert(1)');

        $html = $this->renderEmail('brand');

        $this->assertStringNotContainsString('onmouseover', $html);
        $this->assertSame(EmailPalette::STANDARD, $this->headerFill($html));
    }

    public function test_emails_whose_colour_has_a_meaning_keep_it(): void
    {
        $this->setCommunityColour('#0f766e');

        $this->assertSame('#0b825a', $this->buttonFill($this->renderEmail('success')));
        $this->assertSame('#9f6707', $this->buttonFill($this->renderEmail('warning')));
        $this->assertSame('#dc2626', $this->buttonFill($this->renderEmail('danger')));
        $this->assertSame('#326fd1', $this->buttonFill($this->renderEmail('federation')));
        $this->assertSame('#8457ea', $this->buttonFill($this->renderEmail('achievement')));
    }

    /** @return array<string, array{string|null, string}> */
    public static function themesAndColours(): array
    {
        $cases = [];
        foreach (['#0f766e', '#ffcc00', '#ffffff', '#00ffff'] as $colour) {
            foreach (['brand', 'success', 'warning', 'danger', 'federation', 'achievement', 'info'] as $theme) {
                $cases["{$theme} with {$colour}"] = [$colour, $theme];
            }
        }
        $cases['brand with no colour'] = [null, 'brand'];

        return $cases;
    }

    #[DataProvider('themesAndColours')]
    public function test_white_text_reads_at_aa_on_every_fill(?string $colour, string $theme): void
    {
        $this->setCommunityColour($colour);

        $fills = $this->whiteTextFills($this->renderEmail($theme));

        $this->assertNotEmpty($fills);
        foreach ($fills as $fill) {
            $this->assertGreaterThanOrEqual(
                ColourContrast::AA_NORMAL_TEXT,
                ColourContrast::ratio('#ffffff', $fill),
                "White text on {$fill} ({$theme}, community colour " . var_export($colour, true) . ') is below 4.5:1'
            );
        }
    }

    public function test_the_community_name_in_the_header_is_solid_white(): void
    {
        $this->setCommunityColour('#ffcc00');

        $html = $this->renderEmail('brand');

        // 85% white over the darkest permitted shade dropped below 4.5:1.
        $this->assertStringNotContainsString('rgba(255, 255, 255, 0.85)', $html);
    }

    public function test_the_match_digest_email_uses_the_community_colour(): void
    {
        $this->setCommunityColour('#0f766e');

        $method = new \ReflectionMethod(NotificationDispatcher::class, 'buildMatchDigestEmail');
        $method->setAccessible(true);
        $html = (string) $method->invoke(null, [[
            'title' => 'Gardening help',
            'user_name' => 'Alex',
            'match_score' => 72,
            'listing_id' => 1,
            'match_type' => 'one_way',
        ]], 'weekly', 0, 0, 0);

        $this->assertStringContainsString('background-color: #0f766e; background-image: linear-gradient(135deg, #0f766e 0%', $html);
        foreach (['#6366f1', '#4f46e5', '#8b5cf6', '#f5f3ff', '#c4b5fd', '#eef2ff', '#e0e7ff', '#ede9fe', '99, 102, 241'] as $standardPurple) {
            $this->assertStringNotContainsString($standardPurple, $html, "match digest still carries {$standardPurple}");
        }
    }
}
