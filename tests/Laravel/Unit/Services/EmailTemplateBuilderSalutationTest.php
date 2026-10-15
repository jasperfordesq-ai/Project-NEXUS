<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Core\EmailTemplateBuilder;
use Tests\Laravel\TestCase;

/**
 * greeting() takes a NAME and wraps it in the translated "Hi :name,".
 * salutation() takes a whole greeting line and prints it as written.
 *
 * Seventeen emails passed a complete translated sentence to greeting(), so
 * members read "Hi Great news, Sarah!," (approval), "Hi Hi Sarah, welcome to
 * Bridgwater Time Bank!," (email verification) and "Hi Important notice,
 * Sarah," (suspension). Reported from Bridgwater, 2026-10-15.
 */
class EmailTemplateBuilderSalutationTest extends TestCase
{
    public function test_salutation_prints_the_line_as_written(): void
    {
        $html = EmailTemplateBuilder::make()->salutation('Great news, Sarah!')->render();

        $this->assertStringContainsString('>Great news, Sarah!</p>', $html);
        $this->assertStringNotContainsString('Hi Great news', $html);
    }

    public function test_greeting_still_wraps_a_bare_name(): void
    {
        $html = EmailTemplateBuilder::make()->greeting('Sarah')->render();

        $this->assertStringContainsString('>Hi Sarah,</p>', $html);
    }

    public function test_salutation_keeps_an_already_escaped_name_readable(): void
    {
        // Callers escape the name before putting it into the sentence; it must
        // not be escaped a second time and show as "O&#039;Brien".
        $line = 'Welcome back, ' . htmlspecialchars("Seán O'Brien", ENT_QUOTES, 'UTF-8') . '!';
        $html = EmailTemplateBuilder::make()->salutation($line)->render();

        $this->assertStringContainsString('Welcome back, Seán O&#039;Brien!', $html);
        $this->assertStringNotContainsString('&amp;#039;', $html);
    }

    public function test_salutation_shows_markup_in_a_name_as_text(): void
    {
        $html = EmailTemplateBuilder::make()
            ->salutation('Welcome back, <img src=x onerror=alert(1)>!')
            ->render();

        $this->assertStringNotContainsString('<img', $html);
        $this->assertStringContainsString('&lt;img', $html);
    }

    /**
     * The data-request email used "{name}" / "{community}", which the
     * translator does not fill in, so members read "Hi {name},".
     */
    public function test_data_request_email_fills_in_name_and_community_in_every_language(): void
    {
        // Read the files, not __(): tests boot from a frozen translation cache
        // (AppServiceProvider::loadCachedJsonTranslations) and __() has no
        // locale argument.
        foreach (glob(base_path('lang/*/emails.json')) as $file) {
            $locale = basename(dirname($file));
            $block = json_decode((string) file_get_contents($file), true)['gdpr_request'] ?? [];

            $this->assertStringContainsString('{{name}}', (string) ($block['greeting'] ?? ''), "{$locale} greeting");
            $this->assertStringContainsString('{{community}}', (string) ($block['body'] ?? ''), "{$locale} body");
            foreach ($block as $field => $value) {
                $this->assertDoesNotMatchRegularExpression('/(?<!\{)\{\w+\}(?!\})/', (string) $value, "{$locale} gdpr_request.{$field} has a placeholder the translator never fills in");
            }
        }
    }

    /**
     * Guard: every `->greeting(__('key'…))` in app/ must point at a key whose
     * English text is a bare word (e.g. "there"), not a sentence with its own
     * name placeholder — those belong in salutation().
     */
    public function test_no_email_passes_a_whole_sentence_to_greeting(): void
    {
        $offenders = [];
        $files = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(base_path('app')));
        foreach ($files as $file) {
            if (!$file->isFile() || $file->getExtension() !== 'php') {
                continue;
            }
            $source = (string) file_get_contents($file->getPathname());
            if (!preg_match_all("/->greeting\(\s*__\(\s*'([^']+)'/", $source, $m)) {
                continue;
            }
            foreach ($m[1] as $key) {
                $english = (string) __($key, [], 'en');
                if (preg_match('/\{\{?\w+\}?\}|:\w+|[,!?.]/u', $english) === 1) {
                    $offenders[] = str_replace(base_path() . DIRECTORY_SEPARATOR, '', $file->getPathname()) . " → {$key} (\"{$english}\")";
                }
            }
        }

        $this->assertSame([], $offenders, "These pass a whole sentence to greeting(), which wraps it in \"Hi …,\". Use salutation():\n" . implode("\n", $offenders));
    }
}
