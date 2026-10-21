<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Core;

use App\Core\EmailTemplate;
use App\Core\Mailer;
use Tests\Laravel\TestCase;

/**
 * The text/plain part every email carries when the caller supplies none.
 *
 * It used to be strip_tags() of the whole document, which kept the contents of
 * the <style> block and the preview-text padding characters, so every
 * notification's plain-text part opened with ~40 lines of CSS and a run of
 * invisible U+034F characters. Spam filters compare the two parts; a text part
 * that is mostly stylesheet reads as a disguised message.
 */
final class MailerPlainTextTest extends TestCase
{
    public function test_template_email_text_part_has_no_css_or_padding_characters(): void
    {
        $html = EmailTemplate::render(
            'New Listing Posted',
            'TimeBank Ireland',
            '<p>A new listing has been posted.</p>',
            'View Listing',
            'https://example.test/listings/554',
            'TimeBank Ireland'
        );

        $text = Mailer::plainTextFromHtml($html);

        $this->assertStringNotContainsString('{', $text);
        $this->assertStringNotContainsString('!important', $text);
        $this->assertStringNotContainsString('/* Reset */', $text);
        $this->assertStringNotContainsString("\u{034F}", $text);
        $this->assertStringContainsString('New Listing Posted', $text);
        $this->assertStringContainsString('A new listing has been posted.', $text);
        $this->assertStringContainsString('https://example.test/listings/554', $text);
    }

    public function test_links_keep_their_address_and_blocks_become_lines(): void
    {
        $html = '<html><head><title>T</title><style>p { color: red; }</style></head><body>'
            . '<!-- Preview text --><div style="display:none">Preview &#847; &#847; &#847;</div>'
            . '<h1>Hello</h1><p>First&nbsp;line</p><p>See <a href="https://example.test/x">the offer</a>.</p>'
            . '<p><a href="https://example.test/y">https://example.test/y</a></p>'
            . '</body></html>';

        $text = Mailer::plainTextFromHtml($html);

        $this->assertSame(
            "Preview\n\nHello\n\nFirst line\n\nSee the offer (https://example.test/x).\n\nhttps://example.test/y",
            $text
        );
    }
}
