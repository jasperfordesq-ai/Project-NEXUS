<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use Tests\Laravel\TestCase;

/**
 * F-038 (E-024): paragraph, highlight and bullet-list text keeps simple
 * formatting but can never carry a link to another site, an image, or any
 * other markup — whatever the caller passed in.
 *
 * Every assertion looks only at the text between two markers, because the
 * surrounding template legitimately contains its own links and markup.
 */
class EmailTemplateBuilderFormattingTest extends TestCase
{
    private const HOSTILE_NAME = 'Anna<a href="https://evil.example/login">Verify your account</a>';

    /** Render one block and return only what the caller's text became. */
    private function block(string $type, string $text): string
    {
        $wrapped = '[[S]]' . $text . '[[E]]';
        $builder = EmailTemplateBuilder::make()->title('T');
        match ($type) {
            'paragraph' => $builder->paragraph($wrapped),
            'highlight' => $builder->highlight($wrapped),
            'icon' => $builder->highlight('Heads up', $wrapped),
            'bullet' => $builder->bulletList([$wrapped]),
        };
        $this->assertSame(1, preg_match('/\[\[S\]\](.*?)\[\[E\]\]/s', $builder->render(), $m));

        return $m[1];
    }

    private function assertNoMarkup(string $fragment): void
    {
        $this->assertDoesNotMatchRegularExpression('/<(?!\/?(strong|b|em|i|u|br|p|span|small|code)\b)[a-z]/i', $fragment, $fragment);
        $this->assertDoesNotMatchRegularExpression('/<[a-z][^>]*\bon[a-z]+\s*=/i', $fragment, $fragment);
        $this->assertDoesNotMatchRegularExpression('/<[a-z][^>]*url\(/i', $fragment, $fragment);
    }

    public function test_a_hostile_name_in_a_paragraph_is_shown_as_text(): void
    {
        $out = $this->block('paragraph', __('emails.appreciation.body', ['sender' => self::HOSTILE_NAME]));

        $this->assertNoMarkup($out);
        $this->assertStringContainsString('Anna&lt;a href="https://evil.example/login">Verify your account&lt;/a>', $out);
    }

    public function test_highlight_text_icon_and_bullet_items_are_filtered_too(): void
    {
        $this->assertNoMarkup($this->block('highlight', self::HOSTILE_NAME));
        $this->assertNoMarkup($this->block('icon', '<img src=x onerror=alert(1)>'));
        $this->assertNoMarkup($this->block('bullet', 'By: ' . self::HOSTILE_NAME));
        $this->assertNoMarkup($this->block('bullet', '<script>alert(1)</script>'));
    }

    public function test_images_scripts_handlers_and_bad_links_never_survive(): void
    {
        $this->assertNoMarkup($this->block('paragraph', '<img src="https://evil.example/p.gif">'));
        $this->assertNoMarkup($this->block('paragraph', '<scr<script>ipt>alert(1)</script>'));
        $this->assertNoMarkup($this->block('paragraph', '<a href="javascript:alert(1)">x</a><a>y</a></a>'));
        $this->assertNoMarkup($this->block('paragraph', '<a href=https://evil.example>x</a>'));
        $this->assertNoMarkup($this->block('paragraph', "<a\nhref='https://evil.example'>x</a>"));

        $out = $this->block('paragraph', '<strong onclick="x()" style="background:url(https://evil.example/t)">hi</strong>');
        $this->assertSame('<strong>hi</strong>', $out);
    }

    public function test_the_platforms_own_formatting_is_kept(): void
    {
        $this->assertSame(
            'Your request to <strong>Garden Group</strong> was <em>accepted</em>.<br>Thanks',
            $this->block('paragraph', 'Your request to <strong>Garden Group</strong> was <em>accepted</em>.<br/>Thanks'),
        );
        $this->assertSame(
            '<span style="font-size: 13px; color: #6b7280;">small print</span>',
            $this->block('paragraph', '<span style="font-size: 13px; color: #6b7280;">small print</span>'),
        );
        $this->assertSame(
            '<strong style="color: #16a34a;">+2 hours</strong>',
            $this->block('bullet', '<strong style="color: #16a34a;">+2 hours</strong>'),
        );
        $this->assertSame('<p>Next steps</p>', $this->block('paragraph', '<p>Next steps</p>'));
        $this->assertSame("\u{1F3C6}", $this->block('icon', "\u{1F3C6}"));
    }

    public function test_already_escaped_text_is_not_double_escaped(): void
    {
        $safe = htmlspecialchars('Tom & Jerry <3', ENT_QUOTES, 'UTF-8');

        $this->assertSame('Hello Tom &amp; Jerry &lt;3', $this->block('paragraph', 'Hello ' . $safe));
    }

    public function test_a_link_back_to_the_community_is_kept_and_any_other_link_is_not(): void
    {
        TenantContext::setById($this->testTenantId);
        $own = EmailTemplateBuilder::tenantUrl('/notifications');
        $this->assertMatchesRegularExpression('#^https?://#', $own);

        $this->assertSame(
            'Update your <a href="' . htmlspecialchars($own, ENT_QUOTES, 'UTF-8') . '">notification preferences</a>.',
            $this->block('paragraph', 'Update your <a href="' . $own . '">notification preferences</a>.'),
        );

        // A look-alike host that merely starts with the community's address.
        $lookAlike = rtrim(TenantContext::getFrontendUrl(), '/') . '.evil.example/';
        $this->assertNoMarkup($this->block('paragraph', '<a href="' . $lookAlike . '">x</a>'));
    }
}
