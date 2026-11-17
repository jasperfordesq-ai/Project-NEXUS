<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\PlatformTeam;

use App\Http\Middleware\SetLocale;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * Platform team panel → Translations, the server half ("Server wording:
 * emails and messages").
 *
 * For each supported language other than English, over `lang/<locale>/`
 * against `lang/en/`: `keys` (phrases English has), `missing` (phrases the
 * language does not have, or has empty) and `same_as_english` (phrases whose
 * text is still word-for-word English).
 *
 * 🔴 Each phrase is counted ONCE, from the file that actually serves it.
 * `__()` (app/helpers.php) asks App\I18n\Translator first, which reads
 * `<ns>.json` for the language and then for English; only when the key is in
 * neither does Laravel's loader read `<ns>.php`. So for a namespace with both
 * files, a phrase in `en/<ns>.json` is served from the `.json` (a translation
 * that exists only in the language's `.php` is never shown), and a phrase only
 * in `en/<ns>.php` is served from the `.php`.
 *
 * Rules shared with react-frontend/scripts/build-translation-coverage.mjs:
 *   - nested arrays are flattened; only string leaves are phrases;
 *   - keys ending _zero/_one/_two/_few/_many/_other are one phrase per base
 *     key, and a language has it when it has any of its forms;
 *   - a phrase whose every English form is empty (after trimming) is not a
 *     phrase: it is left out of `keys` and is never missing or the same as
 *     English, whatever the language has there;
 *   - "same as English" = identical after trimming, and the English text has
 *     a letter once placeholders ({{x}}, {x}, :x, %s) and tags are removed.
 *
 * Unreadable English (no folder, no files, a broken file) is `available:
 * false`, never zeros, and is not cached. A broken language file counts its
 * phrases as missing (the reason is logged). Kept in the cache for an hour.
 *
 * Reads wording files only: nothing about a member or a community.
 */
final class TranslationCoverageService
{
    public const CACHE_KEY = 'platform_team:translation_coverage';

    public const CACHE_SECONDS = 3600;

    private const PLURAL_SUFFIX = '/_(zero|one|two|few|many|other)$/';

    private readonly string $langDir;

    public function __construct(?string $langDir = null)
    {
        $this->langDir = rtrim($langDir ?? lang_path(), '/\\');
    }

    /** @return array{available: bool, generated_at: string|null, locales: list<array{locale: string, keys: int, missing: int, same_as_english: int}>|null} */
    public function report(bool $refresh = false): array
    {
        if (!$refresh) {
            $cached = Cache::get(self::CACHE_KEY);
            if (is_array($cached) && ($cached['available'] ?? false) === true) {
                /** @var array{available: bool, generated_at: string|null, locales: list<array{locale: string, keys: int, missing: int, same_as_english: int}>|null} $cached */
                return $cached;
            }
        }

        $report = $this->compute();
        if ($report['available']) {
            Cache::put(self::CACHE_KEY, $report, self::CACHE_SECONDS);
        } else {
            Cache::forget(self::CACHE_KEY);
        }

        return $report;
    }

    /** @return array{available: bool, generated_at: string|null, locales: list<array{locale: string, keys: int, missing: int, same_as_english: int}>|null} */
    private function compute(): array
    {
        $unavailable = ['available' => false, 'generated_at' => null, 'locales' => null];

        $english = $this->englishPhrases();
        if ($english === null) {
            return $unavailable;
        }

        $total = 0;
        foreach ($english as $groups) {
            $total += count($groups);
        }
        if ($total === 0) {
            Log::error('Platform team translations page: lang/en holds no phrases', ['dir' => $this->langDir]);

            return $unavailable;
        }

        $rows = [];
        foreach (SetLocale::SUPPORTED_LOCALES as $locale) {
            if ($locale === 'en') {
                continue;
            }
            $rows[] = $this->countLocale($locale, $english, $total);
        }
        usort($rows, fn (array $a, array $b) => strcmp($a['locale'], $b['locale']));

        return ['available' => true, 'generated_at' => now()->toIso8601String(), 'locales' => $rows];
    }

    /**
     * English phrases, keyed "<ns>.json" / "<ns>.php" → base key → [full key → text],
     * each phrase under the file that serves it. Null when English cannot be read.
     *
     * @return array<string, array<string, array<string, string>>>|null
     */
    private function englishPhrases(): ?array
    {
        $dir = $this->langDir . '/en';
        if (!is_dir($dir)) {
            Log::error('Platform team translations page: lang/en is missing', ['dir' => $dir]);

            return null;
        }

        $namespaces = [];
        foreach (scandir($dir) ?: [] as $file) {
            if (preg_match('/^(.+)\.(json|php)$/', $file, $m) === 1) {
                $namespaces[$m[1]][$m[2]] = true;
            }
        }
        ksort($namespaces);

        $out = [];
        foreach ($namespaces as $namespace => $kinds) {
            $jsonFlat = [];
            if (isset($kinds['json'])) {
                $read = $this->read($dir . "/{$namespace}.json", 'json');
                if ($read === null) {
                    Log::error('Platform team translations page: an English file could not be read', ['file' => "en/{$namespace}.json"]);

                    return null;
                }
                $jsonFlat = $read;
                $out["{$namespace}.json"] = self::englishGroups($jsonFlat);
            }
            if (isset($kinds['php'])) {
                $read = $this->read($dir . "/{$namespace}.php", 'php');
                if ($read === null) {
                    Log::error('Platform team translations page: an English file could not be read', ['file' => "en/{$namespace}.php"]);

                    return null;
                }
                // Only what the .json does not already serve.
                $out["{$namespace}.php"] = self::englishGroups(array_diff_key($read, $jsonFlat));
            }
        }

        return $out;
    }

    /**
     * @param array<string, array<string, array<string, string>>> $english
     * @return array{locale: string, keys: int, missing: int, same_as_english: int}
     */
    private function countLocale(string $locale, array $english, int $total): array
    {
        $missing = 0;
        $same = 0;
        foreach ($english as $file => $groups) {
            $kind = substr($file, (int) strrpos($file, '.') + 1);
            $path = $this->langDir . "/{$locale}/{$file}";
            $flat = [];
            if (is_file($path)) {
                $read = $this->read($path, $kind);
                if ($read === null) {
                    // Counted as missing: the language really does not get these phrases.
                    Log::error('Platform team translations page: a language file could not be read', ['file' => "{$locale}/{$file}"]);
                }
                $flat = $read ?? [];
            }
            $filled = array_filter($flat, fn (string $text) => trim($text) !== '');
            $localeGroups = self::group($filled);

            foreach ($groups as $base => $forms) {
                if (!isset($localeGroups[$base])) {
                    $missing++;
                    continue;
                }
                $shared = array_intersect_key($forms, $filled);
                if ($shared === []) {
                    continue;
                }
                $allSame = true;
                foreach ($shared as $key => $englishText) {
                    if (!self::sameAsEnglish($filled[$key], $englishText)) {
                        $allSame = false;
                        break;
                    }
                }
                if ($allSame) {
                    $same++;
                }
            }
        }

        return ['locale' => $locale, 'keys' => $total, 'missing' => $missing, 'same_as_english' => $same];
    }

    public static function sameAsEnglish(string $localeText, string $englishText): bool
    {
        $a = trim($localeText);
        $b = trim($englishText);
        if ($a === '' || $a !== $b) {
            return false;
        }
        $stripped = (string) preg_replace(
            ['/\{\{[^}]*\}\}/u', '/\{[^}]*\}/u', '/:[A-Za-z_][A-Za-z0-9_]*/u', '/%[sd]/u', '/<[^>]*>/u'],
            '',
            $b
        );

        return preg_match('/\p{L}/u', $stripped) === 1;
    }

    /**
     * A file as a flat [dot.key => text] map of its string leaves, or null when
     * it cannot be read or is not an array.
     *
     * @return array<string, string>|null
     */
    private function read(string $path, string $kind): ?array
    {
        try {
            if ($kind === 'json') {
                $raw = @file_get_contents($path);
                $data = is_string($raw) ? json_decode($raw, true) : null;
            } else {
                // The same files Laravel's own loader includes.
                $data = (static fn (string $file): mixed => require $file)($path);
            }
        } catch (\Throwable $e) {
            // A broken wording file: counted as unreadable, the reason logged by the caller.
            return null;
        }

        if (!is_array($data)) {
            return null;
        }

        $flat = [];
        self::flatten($data, '', $flat);

        return $flat;
    }

    /**
     * @param array<array-key, mixed> $data
     * @param array<string, string> $out
     */
    private static function flatten(array $data, string $prefix, array &$out): void
    {
        foreach ($data as $key => $value) {
            $full = $prefix === '' ? (string) $key : $prefix . '.' . $key;
            if (is_string($value)) {
                $out[$full] = $value;
            } elseif (is_array($value)) {
                self::flatten($value, $full, $out);
            }
        }
    }

    /**
     * English phrase groups with the empty ones left out: a group whose every
     * English form is empty (after trimming) is not a phrase, so it can never
     * be missing or the same as English.
     *
     * @param array<string, string> $flat
     * @return array<string, array<string, string>>
     */
    private static function englishGroups(array $flat): array
    {
        return array_filter(
            self::group($flat),
            static fn (array $forms): bool => array_filter($forms, static fn (string $text): bool => trim($text) !== '') !== []
        );
    }

    /**
     * @param array<string, string> $flat
     * @return array<string, array<string, string>>
     */
    private static function group(array $flat): array
    {
        $groups = [];
        foreach ($flat as $key => $text) {
            $base = (string) preg_replace(self::PLURAL_SUFFIX, '', $key);
            $groups[$base][$key] = $text;
        }

        return $groups;
    }
}
