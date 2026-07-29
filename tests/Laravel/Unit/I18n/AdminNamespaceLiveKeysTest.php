<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\I18n;

use PHPUnit\Framework\TestCase;

/**
 * Guards the nine surviving keys of the `admin` translation namespace.
 *
 * `lang/<locale>/admin.php` used to be a 3,981-line copy of the React locales
 * and accounted for 93% of the whole untranslated-value ratchet, while only
 * nine of its keys were reachable from PHP at all: four `admin.mailer.gmail_*`
 * in app/Core/Mailer.php and five `admin.label_*` in AdminCrmController. It was
 * shrunk to exactly those nine on 2026-07-29 (owner-approved), and its two
 * sibling namespaces (`admin_nav`, `admin_dashboard`, zero call sites) deleted.
 *
 * Two things have to stay true after that shrink, and neither is covered by the
 * key-set parity gate or by the untranslated ratchet:
 *
 * 1. The nine keys must resolve. `__()` (app/helpers.php) asks the JSON
 *    Translator FIRST and only falls back to Laravel's .php loader, so the
 *    live values come from `lang/<locale>/admin.json`; `admin.php` is the
 *    fallback. Both have to carry all nine or a Gmail/CRM string turns into the
 *    dotted key name in an admin's UI.
 * 2. The nine values must actually be translated. They were hand-translated
 *    into all ten non-English locales in the same commit; before it, every
 *    locale's live JSON value was byte-identical English. The ratchet cannot
 *    see that regression because it only reads .php files.
 */
class AdminNamespaceLiveKeysTest extends TestCase
{
    /**
     * Every `admin.*` key reachable from PHP. Keep in sync with the call sites:
     * app/Core/Mailer.php and app/Http/Controllers/Api/AdminCrmController.php.
     *
     * @var list<string>
     */
    private const LIVE_KEYS = [
        'mailer.gmail_connected',
        'mailer.gmail_not_enabled',
        'mailer.gmail_token_failed',
        'mailer.gmail_verify_failed',
        'label_total_members',
        'label_active_members',
        'label_new_this_month',
        'label_pending_approvals',
        'label_retention_rate',
    ];

    /** @var list<string> */
    private const LOCALES = ['en', 'ga', 'de', 'fr', 'it', 'pt', 'es', 'nl', 'pl', 'ja', 'ar'];

    /** Namespaces deleted on 2026-07-29 — zero call sites, do not resurrect. */
    private const DELETED_NAMESPACES = ['admin_nav', 'admin_dashboard'];

    private static function langDir(): string
    {
        return dirname(__DIR__, 4) . '/lang';
    }

    /**
     * @return array<string, mixed>
     */
    private static function readJson(string $locale): array
    {
        $path = self::langDir() . "/$locale/admin.json";
        self::assertFileExists($path, "lang/$locale/admin.json is the live source for admin.* keys.");

        $decoded = json_decode((string) file_get_contents($path), true);
        self::assertIsArray($decoded, "lang/$locale/admin.json is not valid JSON.");

        return $decoded;
    }

    /**
     * @return array<string, mixed>
     */
    private static function readPhp(string $locale): array
    {
        $path = self::langDir() . "/$locale/admin.php";
        self::assertFileExists($path, "lang/$locale/admin.php is the fallback source for admin.* keys.");

        $loaded = require $path;
        self::assertIsArray($loaded, "lang/$locale/admin.php must return an array.");

        return $loaded;
    }

    /**
     * @param array<string, mixed> $tree
     */
    private static function lookup(array $tree, string $dottedKey): mixed
    {
        $current = $tree;
        foreach (explode('.', $dottedKey) as $segment) {
            if (!is_array($current) || !array_key_exists($segment, $current)) {
                return null;
            }
            $current = $current[$segment];
        }

        return $current;
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function localeProvider(): array
    {
        $cases = [];
        foreach (self::LOCALES as $locale) {
            $cases[$locale] = [$locale];
        }

        return $cases;
    }

    /**
     * @dataProvider localeProvider
     */
    public function test_live_json_carries_every_reachable_admin_key(string $locale): void
    {
        $tree = self::readJson($locale);

        foreach (self::LIVE_KEYS as $key) {
            $value = self::lookup($tree, $key);
            self::assertIsString(
                $value,
                "admin.$key is missing from lang/$locale/admin.json. __() reads that file first, so "
                . "the Mailer/CRM string would render as the literal text 'admin.$key'."
            );
            self::assertNotSame('', trim($value), "admin.$key is empty in lang/$locale/admin.json.");
        }
    }

    /**
     * @dataProvider localeProvider
     */
    public function test_php_fallback_carries_every_reachable_admin_key(string $locale): void
    {
        $tree = self::readPhp($locale);

        foreach (self::LIVE_KEYS as $key) {
            $value = self::lookup($tree, $key);
            self::assertIsString(
                $value,
                "admin.$key is missing from lang/$locale/admin.php. The shrink to nine keys must keep "
                . 'all nine: this file is the fallback when the JSON translator has no match.'
            );
        }
    }

    public function test_every_non_english_locale_actually_translates_the_nine_values(): void
    {
        $english = self::readJson('en');
        $untranslated = [];

        foreach (self::LOCALES as $locale) {
            if ($locale === 'en') {
                continue;
            }

            $tree = self::readJson($locale);
            foreach (self::LIVE_KEYS as $key) {
                if (self::lookup($tree, $key) === self::lookup($english, $key)) {
                    $untranslated[] = "$locale/admin.json: $key";
                }
            }
        }

        self::assertSame(
            [],
            $untranslated,
            'These admin.* values are still byte-identical English. They are the only nine keys in '
            . 'the namespace anyone reads, and the untranslated ratchet cannot see them because it '
            . 'only scans lang/**/*.php.'
        );
    }

    public function test_the_shrink_actually_happened(): void
    {
        foreach (self::LOCALES as $locale) {
            $keys = self::readPhp($locale);
            self::assertSame(
                ['label_active_members', 'label_new_this_month', 'label_pending_approvals', 'label_retention_rate', 'label_total_members', 'mailer'],
                array_keys($keys),
                "lang/$locale/admin.php must hold only the nine reachable keys. Anything else is a "
                . 'copy of the React admin locales and belongs in react-frontend/public/locales.'
            );
        }
    }

    public function test_deleted_namespaces_stay_deleted(): void
    {
        $resurrected = [];

        foreach (self::LOCALES as $locale) {
            foreach (self::DELETED_NAMESPACES as $namespace) {
                $path = self::langDir() . "/$locale/$namespace.php";
                if (file_exists($path)) {
                    $resurrected[] = "lang/$locale/$namespace.php";
                }
            }
        }

        self::assertSame(
            [],
            $resurrected,
            'These namespaces had zero PHP call sites and were deleted on 2026-07-29. If a call site '
            . 'now needs them, add the key to the admin namespace instead of restoring the dump.'
        );
    }
}
