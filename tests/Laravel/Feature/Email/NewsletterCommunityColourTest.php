<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Email;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Services\NewsletterService;
use App\Support\ColourContrast;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * The newsletter's standard layout (richtext) wears the community colour a
 * community admin chose — header band, links, quote rule — shaded where needed
 * so its text reads at 4.5:1 (Warmth phase 6, B6). A community that never
 * chose a colour keeps exactly today's indigo.
 */
class NewsletterCommunityColourTest extends TestCase
{
    use DatabaseTransactions;

    private const OTHER_TENANT = 999;

    private function setColour(int $tenantId, ?string $colour): void
    {
        $raw = DB::table('tenants')->where('id', $tenantId)->value('configuration');
        $config = json_decode((string) $raw, true) ?: [];
        unset($config['primary_color']);
        if ($colour !== null) {
            $config['primary_color'] = $colour;
        }
        DB::table('tenants')->where('id', $tenantId)->update(['configuration' => json_encode($config)]);
    }

    private function render(int $tenantId, ?string $locale = null): string
    {
        $newsletter = [
            'content' => '<p>Hello community</p><blockquote>A quote</blockquote><p><a href="https://example.test/x">A link</a></p>',
            'subject' => 'November news',
            'content_format' => 'richtext',
        ];

        return LocaleContext::withLocale($locale, fn () => TenantContext::runForTenant(
            $tenantId,
            fn () => NewsletterService::renderEmail($newsletter, 'Alpha Timebank', 'unsub-token', null, 'track-token')
        ));
    }

    /** The solid colour behind the header's white community name. */
    private function headerFill(string $html): string
    {
        // The CSS inliner rewrites the attribute with single quotes.
        $this->assertSame(1, preg_match('/class="header" style=\'[^\']*background-color: (#[0-9a-f]{6});/', $html, $m), 'header fill not found');

        return $m[1];
    }

    /** The colour of the body link (wrapped for click tracking, styled by the inliner). */
    private function linkColour(string $html): string
    {
        $this->assertSame(1, preg_match('/<a href="[^"]*example\.test[^"]*" style=\'[^\']*color: (#[0-9a-f]{6});[^\']*\'>A link<\/a>/', $html, $m), 'body link not found');

        return $m[1];
    }

    public function test_a_community_that_never_chose_a_colour_keeps_todays_newsletter(): void
    {
        $this->setColour($this->testTenantId, null);

        $html = $this->render($this->testTenantId);

        $this->assertSame('#6366f1', $this->headerFill($html));
        $this->assertSame('#6366f1', $this->linkColour($html));
        $this->assertStringContainsString('linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)', $html);
        $this->assertStringContainsString('#f5f3ff', $html); // quote background unchanged
    }

    public function test_the_header_links_and_quote_take_the_chosen_colour(): void
    {
        $this->setColour($this->testTenantId, '#0f766e');

        $html = $this->render($this->testTenantId);

        $this->assertSame('#0f766e', $this->headerFill($html));
        $this->assertStringNotContainsString('#6366f1', $html);
        $this->assertStringNotContainsString('#4f46e5', $html);
        $this->assertStringNotContainsString('#f5f3ff', $html);
        // The link in the body carries the colour (the CSS inliner puts it on the tag).
        $this->assertSame('#0f766e', $this->linkColour($html));
    }

    public function test_a_pale_chosen_colour_is_shaded_until_its_text_reads(): void
    {
        $this->setColour($this->testTenantId, '#ffcc00');

        $html = $this->render($this->testTenantId);
        $fill = $this->headerFill($html);

        $this->assertNotSame('#6366f1', $fill);
        $this->assertGreaterThanOrEqual(ColourContrast::AA_NORMAL_TEXT, ColourContrast::ratio('#ffffff', $fill));
        preg_match_all('/linear-gradient\(135deg, (#[0-9a-f]{6}) 0%, (#[0-9a-f]{6}) 100%\)/', $html, $stops);
        foreach (array_merge($stops[1], $stops[2]) as $stop) {
            $this->assertGreaterThanOrEqual(ColourContrast::AA_NORMAL_TEXT, ColourContrast::ratio('#ffffff', $stop), $stop);
        }
        $this->assertGreaterThanOrEqual(ColourContrast::AA_NORMAL_TEXT, ColourContrast::ratio($this->linkColour($html), '#ffffff'));
    }

    public function test_each_community_gets_only_its_own_colour(): void
    {
        $this->setColour($this->testTenantId, '#0f766e');
        $this->setColour(self::OTHER_TENANT, null);

        $green = $this->render($this->testTenantId);
        $standard = $this->render(self::OTHER_TENANT);
        $greenAgain = $this->render($this->testTenantId);

        $this->assertSame('#0f766e', $this->headerFill($green));
        $this->assertSame('#6366f1', $this->headerFill($standard));
        $this->assertStringNotContainsString('#0f766e', $standard);
        $this->assertSame('#0f766e', $this->headerFill($greenAgain));
    }

    public function test_a_german_reader_gets_the_colour_and_german_footer(): void
    {
        $this->setColour($this->testTenantId, '#0f766e');

        $html = $this->render($this->testTenantId, 'de');

        $this->assertSame('#0f766e', $this->headerFill($html));
        $this->assertStringContainsString('Alle Rechte vorbehalten.', $html);
    }

    public function test_a_stored_value_that_is_not_a_plain_colour_is_ignored(): void
    {
        $this->setColour($this->testTenantId, 'red;background:url(x)');

        $this->assertSame('#6366f1', $this->headerFill($this->render($this->testTenantId)));
    }
}
