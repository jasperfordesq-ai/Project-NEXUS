<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use PHPUnit\Framework\TestCase;

/**
 * Guards the localisation of service refusal messages that reach an admin.
 *
 * This generalises FederationPartnershipErrorLocalisationTest (which stays as
 * the deeper, service-specific guard) to every service whose refusal text has
 * been cleaned. The path these strings travel has no translation step: the
 * service returns / throws the text, the controller hands it to
 * respondWithError() or passes $e->getMessage() through, the React API client
 * copies it into res.error, and the admin UI renders it in a toast. A hardcoded
 * English literal anywhere along it is an English toast for every non-English
 * admin — and it silently shadows the translated t() fallback beside the call
 * site, so the UI looks localised while never being localised.
 *
 * SCOPE IS DELIBERATELY AN ENUMERATED ALLOW-LIST, NOT A DIRECTORY SCAN.
 * 233 `respondWithError(..., $e->getMessage())` sites still exist across
 * app/Http/Controllers/Api/ fed by services with literal throws
 * (CaringHourGiftService, CaringHourTransferService, FederationPeerService, …).
 * That tail is a separate, larger piece of work. Scanning every service would
 * make this test fail on day one and it would be disabled instead of fixed.
 * When a service is cleaned, add it to CLEANED_SERVICES so it cannot regress.
 *
 * Regression origin: 44 hardcoded-English call sites in
 * FederationPartnershipService (2026-07-29, fixed in 5abb9bf03) and 2 literal
 * throws in CaringSubRegionService surfaced verbatim to the sub-regions admin
 * page. The key-set parity gate cannot see either: the problem is the absence
 * of keys, not a mismatch between locales.
 */
class ApiErrorLocalisationTest extends TestCase
{
    /**
     * Services whose admin-facing refusal text is fully translated.
     *
     * @var list<string>
     */
    private const CLEANED_SERVICES = [
        'app/Services/CaringCommunity/CaringSubRegionService.php',
        'app/Services/CaringCommunity/CivicDigestService.php',
        'app/Services/CaringCommunity/EmergencyAlertService.php',
        'app/Services/CaringCommunity/IsolatedNodeReadinessService.php',
        'app/Services/CaringCommunity/MunicipalityFeedbackService.php',
        'app/Services/FederationPartnershipService.php',
        'app/Services/RetentionPolicyService.php',
        'app/Services/VolunteerService.php',
        'app/Services/VolunteeringConfigurationService.php',
    ];

    /**
     * @return array<string, array{0: string}>
     */
    public static function cleanedServiceProvider(): array
    {
        $cases = [];
        foreach (self::CLEANED_SERVICES as $relativePath) {
            $cases[$relativePath] = [$relativePath];
        }

        return $cases;
    }

    private static function repositoryRoot(): string
    {
        return dirname(__DIR__, 4);
    }

    private static function readService(string $relativePath): string
    {
        $absolutePath = self::repositoryRoot() . '/' . $relativePath;
        self::assertFileExists(
            $absolutePath,
            "$relativePath is listed in CLEANED_SERVICES but does not exist. Rename or remove the entry."
        );

        return (string) file_get_contents($absolutePath);
    }

    /**
     * A literal string assigned to 'error' is returned to the caller verbatim.
     *
     * Both quote styles are matched so swapping quotes cannot smuggle one past.
     *
     * @dataProvider cleanedServiceProvider
     */
    public function test_no_error_value_is_a_hardcoded_string_literal(string $relativePath): void
    {
        preg_match_all("/'error'\s*=>\s*['\"]/", self::readService($relativePath), $matches);

        self::assertSame(
            [],
            $matches[0],
            "$relativePath must not return hardcoded 'error' strings: they reach the tenant admin "
            . "untranslated. Use __('api.<key>') and add the key to lang/en/api.php plus all 10 "
            . 'other locales.'
        );
    }

    /**
     * A literal exception message is surfaced by every controller that passes
     * $e->getMessage() into respondWithError().
     *
     * @dataProvider cleanedServiceProvider
     */
    public function test_no_exception_message_is_a_hardcoded_string_literal(string $relativePath): void
    {
        preg_match_all(
            '/throw new \\\\?[A-Za-z_\\\\]*(?:Exception|Error)\s*\(\s*[\'"]/',
            self::readService($relativePath),
            $matches
        );

        self::assertSame(
            [],
            $matches[0],
            "$relativePath must not throw hardcoded English exception messages: controllers pass "
            . '$e->getMessage() straight into respondWithError(), so the literal becomes the admin\'s '
            . "toast. Use throw new RuntimeException(__('api.<key>')) instead."
        );
    }

    /**
     * A missing key makes __() render the dotted key name itself into the
     * admin's toast, which reads as a bug rather than as a message.
     *
     * @dataProvider cleanedServiceProvider
     */
    public function test_every_referenced_api_lang_key_exists_in_english(string $relativePath): void
    {
        preg_match_all("/__\(\s*'(api\.[A-Za-z0-9_.]+)'/", self::readService($relativePath), $matches);
        $referenced = array_values(array_unique($matches[1]));

        if ($referenced === []) {
            self::assertTrue(true, "$relativePath references no api.* keys.");

            return;
        }

        $lang = require self::repositoryRoot() . '/lang/en/api.php';

        $missing = [];
        foreach ($referenced as $key) {
            if (! self::langKeyExists($lang, substr($key, strlen('api.')))) {
                $missing[] = $key;
            }
        }

        self::assertSame(
            [],
            $missing,
            "$relativePath references api.* keys that are missing from lang/en/api.php. Without the "
            . 'key, __() renders the dotted key name into the admin UI.'
        );
    }

    /**
     * lang/en/api.php mixes flat keys ('caring_sub_region_not_found') with
     * nested groups ('federation' => [...]). Laravel resolves the longest flat
     * key first, then walks the dotted path, so both shapes must be accepted.
     *
     * @param array<string, mixed> $lang
     */
    private static function langKeyExists(array $lang, string $key): bool
    {
        if (array_key_exists($key, $lang)) {
            return true;
        }

        $cursor = $lang;
        foreach (explode('.', $key) as $segment) {
            if (! is_array($cursor) || ! array_key_exists($segment, $cursor)) {
                return false;
            }
            $cursor = $cursor[$segment];
        }

        return true;
    }
}
