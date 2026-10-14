<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Core\EmailTemplateBuilder;

class EmailTemplateBuilderTest extends \Tests\Laravel\TestCase
{
    public function testClassExists(): void
    {
        $this->assertTrue(class_exists(EmailTemplateBuilder::class));
    }

    public function testPublicMethodsExist(): void
    {
        $methods = ['theme', 'title', 'previewText', 'tenantName', 'greeting', 'paragraph', 'button', 'render'];

        foreach ($methods as $method) {
            $this->assertTrue(
                method_exists(EmailTemplateBuilder::class, $method),
                "Method {$method} should exist on EmailTemplateBuilder"
            );
        }
    }

    public function testThemeReturnsSelf(): void
    {
        $ref = new \ReflectionMethod(EmailTemplateBuilder::class, 'theme');
        $returnType = $ref->getReturnType();
        $this->assertNotNull($returnType);
        $this->assertEquals('self', $returnType->getName());
    }

    public function testPreviewTextReturnsSelf(): void
    {
        $ref = new \ReflectionMethod(EmailTemplateBuilder::class, 'previewText');
        $returnType = $ref->getReturnType();
        $this->assertNotNull($returnType);
        $this->assertEquals('self', $returnType->getName());
    }

    public function testMakeFactoryAndFluentRenderProducesHtml(): void
    {
        $html = EmailTemplateBuilder::make()
            ->theme('brand')
            ->title('Welcome')
            ->previewText('A short preview')
            ->greeting('John')
            ->paragraph('Thanks for joining.')
            ->render();

        $this->assertIsString($html);
        $this->assertNotEmpty($html);
    }

    /**
     * Some mail apps (Outlook, "block external content") hide or disable the
     * styled button, leaving the plain link beneath it as the only way through.
     * Members reported message emails "with no link" while every one sent had
     * the button, because that link was 11px light grey and easy to miss.
     */
    public function testButtonFallbackLinkIsReadable(): void
    {
        $url = 'https://example.test/messages/42';
        $html = EmailTemplateBuilder::make()
            ->tenantName('Test Community')
            ->title('New Message')
            ->button('View Conversation', $url)
            ->render();

        $fallback = __('emails.common.button_fallback_short');
        $this->assertSame(
            1,
            preg_match('~<p style="([^"]*)"[^>]*>\s*' . preg_quote($fallback, '~') . '<br>\s*<a href="'
                . preg_quote($url, '~') . '" style="([^"]*)">' . preg_quote($url, '~') . '</a>~', $html, $m),
            'The fallback paragraph must show the address as a link.'
        );
        [, $paragraphStyle, $linkStyle] = $m;

        $this->assertStringNotContainsString('#9ca3af', $paragraphStyle, 'The fallback text must not be faint grey.');
        $this->assertMatchesRegularExpression('~font-size: 1[4-9]px~', $paragraphStyle);
        $this->assertMatchesRegularExpression('~font-size: 1[4-9]px~', $linkStyle);
        $this->assertStringContainsString('text-decoration: underline', $linkStyle);
    }
}
