<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use PHPUnit\Framework\TestCase;

/**
 * Source-level fence for the invisible-CTA bug reported 2026-08-03.
 *
 * A CEO of a partner timebank received a "New exchange request" email and
 * replied "there was not a link to accept this". The link WAS there: the CTA
 * was styled `background: linear-gradient(...); color: #ffffff`, Outlook dropped
 * the gradient declaration entirely, and the white label landed on the white
 * card. Same for the header title.
 *
 * There is no runtime signal for this — the HTML we send is valid and the send
 * succeeds — so the only durable guard is refusing the pattern in source. Every
 * gradient background in email-rendering code must be written as a separate
 * `background-color` (solid fallback) plus `background-image` (the gradient),
 * either literally or via App\Core\EmailBackground.
 */
class EmailGradientFallbackTest extends TestCase
{
    /**
     * Files that render HTML we hand to a mail transport.
     *
     * @return list<string>
     */
    private function emailRenderingFiles(): array
    {
        return [
            'app/Core/EmailTemplate.php',
            'app/Core/EmailTemplateBuilder.php',
            'app/Services/NotificationDispatcher.php',
            'app/Services/EventNotificationService.php',
            'app/Services/NewsletterService.php',
            // Still live: rendered by NotificationDispatcher's match emails.
            'views/emails/match_hot.php',
            'views/emails/match_mutual.php',
            'views/emails/match_digest.php',
        ];
    }

    public function test_no_email_template_sets_a_gradient_via_the_background_shorthand(): void
    {
        $offenders = [];

        foreach ($this->emailRenderingFiles() as $relative) {
            $path = dirname(__DIR__, 4) . '/' . $relative;
            $this->assertFileExists($path, "Guarded email file moved or was renamed: {$relative}");

            $lines = file($path, FILE_IGNORE_NEW_LINES) ?: [];
            foreach ($lines as $i => $line) {
                // `background:` (shorthand) carrying a gradient. Outlook drops the
                // whole declaration, so the colour must not live here.
                if (preg_match('/background\s*:\s*(?:[^;"]*\s)?(?:linear|radial)-gradient\(/i', $line) === 1) {
                    $offenders[] = $relative . ':' . ($i + 1);
                }
            }
        }

        $this->assertSame(
            [],
            $offenders,
            "Email HTML must not put a gradient in the `background` shorthand — Outlook strips it and\n"
            . "white text lands on a white card. Use `background-color: <first stop>; background-image: <gradient>;`\n"
            . "or App\\Core\\EmailBackground::gradient(). Offending lines:\n  - "
            . implode("\n  - ", $offenders)
        );
    }

    public function test_gradient_backgrounds_are_paired_with_a_solid_background_colour(): void
    {
        $offenders = [];

        foreach ($this->emailRenderingFiles() as $relative) {
            $path = dirname(__DIR__, 4) . '/' . $relative;
            $lines = file($path, FILE_IGNORE_NEW_LINES) ?: [];

            foreach ($lines as $i => $line) {
                if (stripos($line, 'background-image:') === false) {
                    continue;
                }
                if (preg_match('/(?:linear|radial)-gradient\(/i', $line) !== 1) {
                    continue;
                }
                if (stripos($line, 'background-color:') === false) {
                    $offenders[] = $relative . ':' . ($i + 1);
                }
            }
        }

        $this->assertSame(
            [],
            $offenders,
            "A gradient `background-image` in email HTML needs a `background-color` fallback on the same\n"
            . "declaration list. Offending lines:\n  - " . implode("\n  - ", $offenders)
        );
    }

    public function test_exchange_email_does_not_duplicate_the_hours_unit(): void
    {
        // The locale strings already carry the unit ("hour(s)", "Stunde(n)",
        // "時間"), so appending an English unit in PHP duplicated it in English
        // and leaked English into every other locale.
        $source = (string) file_get_contents(dirname(__DIR__, 4) . '/app/Services/NotificationDispatcher.php');

        $this->assertSame(
            0,
            preg_match('/\{\$\w*[Hh]ours\}\s*hour/', $source),
            'NotificationDispatcher must not append an hours unit to an interpolated hours value — '
            . 'the translated message already supplies the unit in the recipient\'s language.'
        );
    }
}
