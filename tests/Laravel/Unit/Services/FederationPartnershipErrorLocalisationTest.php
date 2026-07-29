<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use PHPUnit\Framework\TestCase;

/**
 * Guards the localisation of FederationPartnershipService refusal messages.
 *
 * These strings are not internal diagnostics: they travel to the tenant admin
 * verbatim. The service returns them as 'error', AdminFederationController
 * passes them straight through to respondWithError(), the React API client
 * copies the message into res.error, and the admin UI renders it in a toast.
 * That path has no translation step anywhere along it, so a hardcoded English
 * literal here is an English toast for every non-English admin — and it also
 * silently shadows the translated t() fallback sitting next to the call site.
 *
 * Regression origin: 44 call sites in this service returned hardcoded English
 * (2026-07-29). The key-set parity gate could not see it, because the problem
 * was the absence of keys rather than a mismatch between locales.
 */
class FederationPartnershipErrorLocalisationTest extends TestCase
{
    private string $servicePath;

    private string $source;

    protected function setUp(): void
    {
        parent::setUp();
        $this->servicePath = dirname(__DIR__, 4) . '/app/Services/FederationPartnershipService.php';
        $this->source = (string) file_get_contents($this->servicePath);
    }

    /**
     * The actual regression: a literal string assigned to 'error'.
     *
     * Matches both quote styles so that swapping quotes cannot smuggle one past.
     */
    public function test_no_error_value_is_a_hardcoded_string_literal(): void
    {
        preg_match_all("/'error'\s*=>\s*['\"]/", $this->source, $matches);

        self::assertSame(
            [],
            $matches[0],
            "FederationPartnershipService must not return hardcoded 'error' strings: they reach the "
            . "tenant admin untranslated. Use __('api.federation.<key>') and add the key to "
            . 'lang/en/api.php plus all 10 other locales.'
        );
    }

    /**
     * Every key the service references must exist, or __() silently renders the
     * dotted key name into the admin's toast instead of a sentence.
     */
    public function test_every_referenced_lang_key_exists_in_english(): void
    {
        preg_match_all("/__\('api\.federation\.([a-z0-9_]+)'/", $this->source, $matches);
        $referenced = array_values(array_unique($matches[1]));

        self::assertNotEmpty($referenced, 'Expected the service to reference api.federation.* keys.');

        $lang = require dirname(__DIR__, 4) . '/lang/en/api.php';
        $defined = $lang['federation'] ?? [];

        $missing = array_values(array_diff($referenced, array_keys($defined)));

        self::assertSame([], $missing, 'Referenced api.federation keys missing from lang/en/api.php.');
    }

    /**
     * The gate refusal message must be derived from the machine-readable 'level',
     * never from FederationFeatureService's English 'reason' diagnostic. The
     * reason text is deliberately English so operators reading logs and Sentry
     * see stable strings; branching on it would both localise the logs and break
     * the moment that wording is reworded.
     */
    public function test_gate_refusal_does_not_surface_the_english_reason_diagnostic(): void
    {
        self::assertStringNotContainsString(
            "'error' => \$check['reason']",
            $this->source,
            "The gate's English 'reason' diagnostic must not be shown to admins; "
            . "translate from \$check['level'] via blockedReasonMessage() instead."
        );

        self::assertStringContainsString(
            'blockedReasonMessage',
            $this->source,
            'Expected blockedReasonMessage() to map the gate level to a translated message.'
        );
    }

    /**
     * Interpolated messages are the easiest to break: renaming a placeholder in
     * lang/en without updating the __() call leaves a literal ":keys" on screen.
     */
    public function test_interpolated_messages_pass_the_placeholders_their_keys_declare(): void
    {
        $lang = require dirname(__DIR__, 4) . '/lang/en/api.php';
        $federation = $lang['federation'] ?? [];

        $expected = [
            'partnership_unknown_permission_keys' => 'keys',
            'partnership_permission_not_at_level' => 'permission',
        ];

        foreach ($expected as $key => $placeholder) {
            self::assertArrayHasKey($key, $federation, "lang/en/api.php is missing federation.$key");
            self::assertStringContainsString(
                ':' . $placeholder,
                (string) $federation[$key],
                "federation.$key must contain the :$placeholder placeholder"
            );
            self::assertStringContainsString(
                "'api.federation.$key', ['$placeholder' =>",
                $this->source,
                "The __() call for $key must pass the '$placeholder' replacement"
            );
        }
    }
}
