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
 * Emails must stay readable when a mail app shows them dark (Apple Mail
 * honours the email's own `prefers-color-scheme: dark` rules).
 *
 * Found 10 Nov 2026 while checking the community-colour emails: dark mode
 * turned text near-white on the panels that stay pale (info cards, quotes),
 * left coloured links on the dark card, sat badge text on a see-through tint
 * over the dark card, and in the three match emails darkened the card while
 * most of the text stayed dark grey. EmailColourReader works out every
 * text colour in both looks; text dark mode changes must reach 4.5:1
 * (3:1 when large). The light look is LightModeEmailReadabilityTest's.
 */
class DarkModeEmailReadabilityTest extends TestCase
{
    use DatabaseTransactions;
    use RendersSampleEmails;

    public function test_the_checker_catches_pale_text_on_a_pale_panel(): void
    {
        // The builder's info-card value before the fix, reduced to its parts.
        $html = '<html><head><style>@media (prefers-color-scheme: dark) { .text-dark { color: #f3f4f6 !important; } }</style></head>'
            . '<body><div style="background: #f5f3ff;"><p class="text-dark" style="color: #111827;">Alex Example</p></div></body></html>';

        $failures = EmailColourReader::darkModeFailures($html);

        $this->assertCount(1, $failures);
        $this->assertStringContainsString('Alex Example', $failures[0]);
    }

    public function test_the_checker_catches_a_dark_card_under_dark_text(): void
    {
        // A match email before the fix: the card goes dark, the title stays #374151.
        $html = '<html><head><style>@media (prefers-color-scheme: dark) { .card-bg { background-color: #292524 !important; } }</style></head>'
            . '<body><table><tr><td class="card-bg" style="background-color: #ffffff;"><h2 style="color: #374151;">Gardening help</h2></td></tr></table></body></html>';

        $this->assertCount(1, EmailColourReader::darkModeFailures($html));
    }

    public function test_the_checker_ignores_text_dark_mode_leaves_alone(): void
    {
        $html = '<html><head><style>@media (prefers-color-scheme: dark) { .text-dark { color: #f3f4f6 !important; } }</style></head>'
            . '<body><p style="color: #d1d5db;">Faint but untouched by dark mode</p></body></html>';

        $this->assertSame([], EmailColourReader::darkModeFailures($html));
    }

    /** @return array<string, array{string, string|null}> */
    public static function themesAndColours(): array
    {
        $cases = [];
        foreach (['brand', 'success', 'warning', 'danger', 'federation', 'achievement'] as $theme) {
            $cases["{$theme}, no community colour"] = [$theme, null];
        }
        foreach (['#0f766e', '#a3195b', '#ffcc00', '#000000', '#1e3a8a'] as $colour) {
            $cases["brand, {$colour}"] = ['brand', $colour];
        }

        return $cases;
    }

    #[DataProvider('themesAndColours')]
    public function test_every_builder_block_stays_readable_in_dark_mode(string $theme, ?string $colour): void
    {
        $this->setCommunityColour($colour);

        $html = $this->everyBlock($theme);

        $this->assertNotEmpty(EmailColourReader::textSamples($html));
        $this->assertSame([], EmailColourReader::darkModeFailures($html));
    }

    public function test_dark_mode_still_darkens_the_card_and_lightens_its_text(): void
    {
        $this->setCommunityColour('#0f766e');

        $samples = EmailColourReader::textSamples($this->everyBlock('brand'));
        $greeting = array_values(array_filter($samples, static fn (array $s): bool => str_contains($s['text'], 'Sam')));

        $this->assertNotEmpty($greeting);
        $this->assertSame('#374151', $greeting[0]['dark']['bg']);
        $this->assertSame('#f3f4f6', $greeting[0]['dark']['fg']);
    }

    public function test_a_link_in_running_text_is_readable_on_the_dark_card(): void
    {
        $this->setCommunityColour('#0f766e');

        $samples = EmailColourReader::textSamples($this->everyBlock('brand'));
        $link = array_values(array_filter($samples, static fn (array $s): bool => $s['text'] === 'a link to the community'));

        $this->assertCount(1, $link);
        $this->assertSame('#0f766e', $link[0]['light']['fg']);
        $this->assertSame('#374151', $link[0]['dark']['bg']);
        $this->assertGreaterThanOrEqual(4.5, $link[0]['dark']['ratio']);
    }

    /** @return array<string, array{'hot'|'mutual'|'digest'}> */
    public static function matchEmails(): array
    {
        return ['hot' => ['hot'], 'mutual' => ['mutual'], 'digest' => ['digest']];
    }

    /** @param 'hot'|'mutual'|'digest' $which */
    #[DataProvider('matchEmails')]
    public function test_match_emails_stay_readable_in_dark_mode(string $which): void
    {
        $this->setCommunityColour('#0f766e');

        $html = $this->matchEmail($which);

        $this->assertNotEmpty(EmailColourReader::textSamples($html));
        $this->assertSame([], EmailColourReader::darkModeFailures($html));
    }
}
