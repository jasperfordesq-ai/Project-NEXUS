<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Helpers;

use App\Helpers\HtmlSanitizer;
use PHPUnit\Framework\TestCase;

class HtmlSanitizerTest extends TestCase
{
    // -------------------------------------------------------
    // sanitize()
    // -------------------------------------------------------

    public function test_sanitize_returns_empty_for_empty_input(): void
    {
        $this->assertSame('', HtmlSanitizer::sanitize(''));
    }

    public function test_sanitize_preserves_allowed_tags(): void
    {
        $html = '<p>Hello <strong>World</strong></p>';
        $result = HtmlSanitizer::sanitize($html);
        $this->assertStringContainsString('<p>', $result);
        $this->assertStringContainsString('<strong>', $result);
    }

    public function test_sanitize_strips_script_tags(): void
    {
        $html = '<p>Hello</p><script>alert("xss")</script>';
        $result = HtmlSanitizer::sanitize($html);
        $this->assertStringNotContainsString('<script>', $result);
        $this->assertStringNotContainsString('alert', $result);
    }

    public function test_sanitize_removes_event_handlers(): void
    {
        $html = '<p onclick="alert(1)">Click me</p>';
        $result = HtmlSanitizer::sanitize($html);
        $this->assertStringNotContainsString('onclick', $result);
    }

    public function test_sanitize_removes_style_attributes(): void
    {
        $html = '<p style="color:red">Styled</p>';
        $result = HtmlSanitizer::sanitize($html);
        $this->assertStringNotContainsString('style=', $result);
    }

    public function test_sanitize_blocks_javascript_urls(): void
    {
        $html = '<a href="javascript:alert(1)">Click</a>';
        $result = HtmlSanitizer::sanitize($html);
        $this->assertStringNotContainsString('javascript:', $result);
    }

    public function test_sanitize_allows_http_urls(): void
    {
        $html = '<a href="https://example.com">Link</a>';
        $result = HtmlSanitizer::sanitize($html);
        $this->assertStringContainsString('https://example.com', $result);
    }

    public function test_sanitize_adds_rel_noopener_to_links(): void
    {
        $html = '<a href="https://example.com">Link</a>';
        $result = HtmlSanitizer::sanitize($html);
        $this->assertStringContainsString('rel="noopener noreferrer"', $result);
    }

    public function test_sanitize_strips_img_when_disabled(): void
    {
        $html = '<p>Text</p><img src="/image.jpg" alt="test">';
        $result = HtmlSanitizer::sanitize($html, false);
        $this->assertStringNotContainsString('<img', $result);
    }

    public function test_sanitize_allows_img_by_default(): void
    {
        $html = '<img src="/image.jpg" alt="test">';
        $result = HtmlSanitizer::sanitize($html, true);
        $this->assertStringContainsString('<img', $result);
    }

    // -------------------------------------------------------
    // stripAll()
    // -------------------------------------------------------

    public function test_stripAll_removes_all_html(): void
    {
        $html = '<p>Hello <strong>World</strong></p>';
        $result = HtmlSanitizer::stripAll($html);
        $this->assertStringNotContainsString('<', $result);
        $this->assertStringContainsString('Hello World', $result);
    }

    public function test_stripAll_preserves_special_chars_as_plain_text(): void
    {
        $result = HtmlSanitizer::stripAll('Test & "quotes" it\'s');
        $this->assertEquals('Test & "quotes" it\'s', $result);
    }

    // -------------------------------------------------------
    // sanitizeCms()
    // -------------------------------------------------------

    public function test_sanitizeCms_returns_empty_for_empty_input(): void
    {
        $this->assertSame('', HtmlSanitizer::sanitizeCms(''));
    }

    public function test_sanitizeCms_removes_null_bytes(): void
    {
        $html = "<p>Hello\0World</p>";
        $result = HtmlSanitizer::sanitizeCms($html);
        $this->assertStringNotContainsString("\0", $result);
    }

    public function test_sanitizeCms_strips_disallowed_tags(): void
    {
        $html = '<p>Good</p><iframe src="evil.com"></iframe>';
        $result = HtmlSanitizer::sanitizeCms($html);
        $this->assertStringNotContainsString('<iframe', $result);
    }

    public function test_sanitizeCms_with_styles_allowed_preserves_safe_css(): void
    {
        $html = '<p style="color: red; font-size: 16px;">Styled</p>';
        $result = HtmlSanitizer::sanitizeCms($html, true);
        $this->assertStringContainsString('color: red', $result);
        $this->assertStringContainsString('font-size: 16px', $result);
    }

    public function test_sanitizeCms_strips_dangerous_css_expressions(): void
    {
        $html = '<p style="background: expression(alert(1));">Test</p>';
        $result = HtmlSanitizer::sanitizeCms($html, true);
        $this->assertStringNotContainsString('expression', $result);
    }

    // -------------------------------------------------------
    // sanitizeStyle()
    // -------------------------------------------------------

    public function test_sanitizeStyle_keeps_safe_properties(): void
    {
        $result = HtmlSanitizer::sanitizeStyle('color: red; font-size: 14px;');
        $this->assertStringContainsString('color: red', $result);
        $this->assertStringContainsString('font-size: 14px', $result);
    }

    public function test_sanitizeStyle_strips_expression(): void
    {
        $result = HtmlSanitizer::sanitizeStyle('background: expression(alert(1));');
        $this->assertStringNotContainsString('expression', $result);
    }

    public function test_sanitizeStyle_strips_moz_binding(): void
    {
        $result = HtmlSanitizer::sanitizeStyle('-moz-binding: url("evil.xml");');
        $this->assertStringNotContainsString('-moz-binding', $result);
    }

    public function test_sanitizeStyle_strips_behavior(): void
    {
        $result = HtmlSanitizer::sanitizeStyle('behavior: url("evil.htc");');
        $this->assertStringNotContainsString('behavior', $result);
    }

    public function test_sanitizeStyle_strips_javascript_url(): void
    {
        $result = HtmlSanitizer::sanitizeStyle('background: url(javascript:alert(1));');
        $this->assertStringNotContainsString('javascript:', $result);
    }

    public function test_sanitizeStyle_rejects_unsafe_properties(): void
    {
        $result = HtmlSanitizer::sanitizeStyle('position: absolute; z-index: 9999;');
        // position and z-index are not in the safe list
        $this->assertStringNotContainsString('position', $result);
        $this->assertStringNotContainsString('z-index', $result);
    }

    // -------------------------------------------------------
    // stripTags()
    // -------------------------------------------------------

    public function test_stripTags_removes_script_content(): void
    {
        $html = '<p>Before</p><script>alert(1);</script><p>After</p>';
        $result = HtmlSanitizer::stripTags($html);
        $this->assertStringNotContainsString('alert', $result);
        $this->assertStringContainsString('Before', $result);
        $this->assertStringContainsString('After', $result);
    }

    public function test_stripTags_removes_style_content(): void
    {
        $html = '<style>.evil { display: none; }</style><p>Content</p>';
        $result = HtmlSanitizer::stripTags($html);
        $this->assertStringNotContainsString('.evil', $result);
        $this->assertStringContainsString('Content', $result);
    }

    public function test_stripTags_normalizes_whitespace(): void
    {
        $html = "<p>Hello   \n\n  World</p>";
        $result = HtmlSanitizer::stripTags($html);
        $this->assertSame('Hello World', $result);
    }

    // -------------------------------------------------------
    // excerpt()
    // -------------------------------------------------------

    public function test_excerpt_returns_full_text_when_short(): void
    {
        $html = '<p>Short text</p>';
        $result = HtmlSanitizer::excerpt($html, 160);
        $this->assertSame('Short text', $result);
    }

    public function test_excerpt_truncates_long_text(): void
    {
        $html = '<p>' . str_repeat('word ', 100) . '</p>';
        $result = HtmlSanitizer::excerpt($html, 50);
        $this->assertStringEndsWith('...', $result);
        $this->assertLessThanOrEqual(53, strlen($result)); // 50 + "..."
    }

    public function test_excerpt_cuts_at_word_boundary(): void
    {
        $text = 'The quick brown fox jumps over the lazy dog and continues running';
        $result = HtmlSanitizer::excerpt($text, 30);
        // Should end with "..." and not cut mid-word
        $this->assertStringEndsWith('...', $result);
    }

    public function test_excerpt_strips_html_before_truncating(): void
    {
        $html = '<p><strong>Bold</strong> and <em>italic</em> text here</p>';
        $result = HtmlSanitizer::excerpt($html, 160);
        $this->assertStringNotContainsString('<', $result);
    }

    // -------------------------------------------------------
    // toPlainText() — F-568 (E-093): plain-text boxes never carry markup
    // -------------------------------------------------------

    public function test_toPlainText_turns_an_injected_link_into_its_words(): void
    {
        $this->assertSame(
            'Click here to re-authenticate',
            HtmlSanitizer::toPlainText('<a href="https://google.com">Click here to re-authenticate</a>')
        );
    }

    public function test_toPlainText_removes_every_tag_but_keeps_the_members_line_breaks(): void
    {
        $in = "<h1>Your session has expired</h1>\n<img src=\"https://evil.example/x.png\" alt=\"Sign in\"><table><tr><td>Username</td></tr></table>\nThanks";
        $out = HtmlSanitizer::toPlainText($in);
        $this->assertStringNotContainsString('<', $out);
        $this->assertSame("Your session has expired\nUsername\nThanks", $out);
    }

    public function test_toPlainText_drops_script_and_style_bodies_entirely(): void
    {
        $this->assertSame('Hello', HtmlSanitizer::toPlainText('<script>alert(1)</script>Hello<style>p{}</style>'));
    }

    public function test_toPlainText_leaves_ordinary_prose_with_angle_brackets_alone(): void
    {
        $this->assertSame('I <3 timebanking & 2 > 1', HtmlSanitizer::toPlainText('I <3 timebanking & 2 > 1'));
    }

    // -------------------------------------------------------
    // sanitizeMemberPost() — F-569 (E-093): member posts keep only what
    // their editor can make; injected headings, images and tables go.
    // -------------------------------------------------------

    public function test_sanitizeMemberPost_keeps_only_what_the_post_editor_can_make(): void
    {
        $in = '<h1>Session expired</h1><h2>Sub</h2><img src="https://evil.example/x.png" alt="Sign in">'
            . '<table><tr><td>User</td></tr></table><div><hr><blockquote>Q</blockquote></div>'
            . '<p><strong>Bold</strong> <em>it</em> <u>u</u></p><ul><li>One</li></ul>'
            . '<a href="https://example.org/">Site</a>';
        $out = HtmlSanitizer::sanitizeMemberPost($in);

        foreach (['<h1', '<h2', '<img', '<table', '<td', '<div', '<hr', '<blockquote'] as $tag) {
            $this->assertStringNotContainsString($tag, $out, "$tag must not survive in a member post");
        }
        $this->assertStringContainsString('<p><strong>Bold</strong> <em>it</em> <u>u</u></p>', $out);
        $this->assertStringContainsString('<ul><li>One</li></ul>', $out);
        $this->assertStringContainsString('href="https://example.org/"', $out);
        $this->assertStringContainsString('Session expired', $out, 'The words of a removed tag are kept.');
        $this->assertStringContainsString('User', $out);
    }

    public function test_sanitizeMemberPost_with_headings_keeps_the_discussion_editors_headings_and_quotes(): void
    {
        $out = HtmlSanitizer::sanitizeMemberPost(
            '<h1>Big</h1><h2>Two</h2><h3>Three</h3><h4>Four</h4><blockquote>Quote</blockquote>'
            . '<img src="https://evil.example/x.png"><table><tr><td>Cell</td></tr></table>',
            true
        );

        $this->assertStringContainsString('<h2>Two</h2>', $out);
        $this->assertStringContainsString('<h3>Three</h3>', $out);
        $this->assertStringContainsString('<blockquote>Quote</blockquote>', $out);
        foreach (['<h1', '<h4', '<img', '<table'] as $tag) {
            $this->assertStringNotContainsString($tag, $out);
        }
        $this->assertStringContainsString('Big', $out);
        $this->assertStringContainsString('Cell', $out);
    }

    public function test_sanitizeMemberPost_still_drops_scripts_handlers_and_unsafe_links(): void
    {
        $out = HtmlSanitizer::sanitizeMemberPost('<p onclick="x()">Hi <a href="javascript:alert(1)">there</a></p><script>alert(2)</script>');

        $this->assertStringNotContainsString('onclick', $out);
        $this->assertStringNotContainsString('javascript:', $out);
        $this->assertStringNotContainsString('<script', $out);
        $this->assertStringNotContainsString('alert(2)', $out);
        $this->assertStringContainsString('Hi', $out);
    }
}
