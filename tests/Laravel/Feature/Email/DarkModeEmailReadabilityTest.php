<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Email;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\Services\NotificationDispatcher;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
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
 * (3:1 when large).
 */
class DarkModeEmailReadabilityTest extends TestCase
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

    /** Every kind of block the builder has, with a link in running text. */
    private function everyBlock(string $theme): string
    {
        $ownLink = EmailTemplateBuilder::tenantUrl('/wallet');

        return EmailTemplateBuilder::make()
            ->theme($theme)
            ->title('Title')
            ->greeting('Sam')
            ->paragraph('Body text with <a href="' . $ownLink . '">a link to the community</a>.')
            ->infoCard(['From' => 'Alex Example', 'Hours' => '2'], 'Details')
            ->statCards([['value' => '12', 'label' => 'Hours', 'icon' => '⏱️']])
            ->bulletList(['First point', 'Second point'], 'What happens next')
            ->blockquote('Thank you so much!', 'Alex')
            ->highlight('A highlighted note', '💡')
            ->badges([['text' => 'Helper', 'color' => '#10b981'], ['text' => 'Pale', 'color' => '#fde047'], ['text' => 'Deep', 'color' => '#1e3a8a']])
            ->divider()
            ->button('Open', $ownLink)
            ->render();
    }

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

    /** @return array<string, array{string}> */
    public static function matchEmails(): array
    {
        return ['hot' => ['hot'], 'mutual' => ['mutual'], 'digest' => ['digest']];
    }

    #[DataProvider('matchEmails')]
    public function test_match_emails_stay_readable_in_dark_mode(string $which): void
    {
        $this->setCommunityColour('#0f766e');

        $match = ['title' => 'Gardening help', 'user_name' => 'Alex', 'match_score' => 90, 'listing_id' => 1, 'match_type' => 'mutual', 'distance_km' => 2.5];
        $html = match ($which) {
            'hot' => $this->invokeDispatcher('buildHotMatchEmail', [$match, 90]),
            'mutual' => $this->invokeDispatcher('buildMutualMatchEmail', [$match, ['they_offer' => 'Gardening', 'you_offer' => 'Bike repair']]),
            'digest' => $this->invokeDispatcher('buildMatchDigestEmail', [[$match, array_merge($match, ['match_score' => 72, 'match_type' => 'one_way'])], 'weekly', 1, 1, 0]),
        };

        $this->assertNotEmpty(EmailColourReader::textSamples($html));
        $this->assertSame([], EmailColourReader::darkModeFailures($html));
    }

    /** @param list<mixed> $args */
    private function invokeDispatcher(string $method, array $args): string
    {
        $ref = new \ReflectionMethod(NotificationDispatcher::class, $method);
        $ref->setAccessible(true);

        return (string) $ref->invoke(null, ...$args);
    }
}
