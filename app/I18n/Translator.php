<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\I18n;

/**
 * Static JSON-file translator for PHP admin views.
 *
 * Usage:
 *   Translator::init('/path/to/lang');
 *   Translator::setLocale('ga');
 *   echo Translator::get('admin.label_total_members');
 *   // Or via global helper: __('admin.label_total_members')
 *
 * Translation files live at: {langDir}/{locale}/{namespace}.json
 * Falls back to 'en' if a key is missing in the current locale.
 */
class Translator
{
    private static string $langDir = '';
    private static string $locale = 'en';
    private static array $loaded = [];

    /**
     * Initialise with the base lang/ directory path.
     */
    public static function init(string $langDir): void
    {
        self::$langDir = rtrim($langDir, '/\\');
        self::$loaded = [];
    }

    /**
     * Set the active locale (e.g. 'en', 'ga').
     */
    public static function setLocale(string $locale): void
    {
        self::$locale = $locale;
    }

    /**
     * Get the active locale.
     */
    public static function getLocale(): string
    {
        return self::$locale;
    }

    /**
     * Translate a key.
     *
     * Key format: "namespace.key" (e.g. "admin.label_total_members")
     * or just "key" which uses namespace "common".
     *
     * @param string $key       Dot-separated namespace.key
     * @param array  $params    Named substitution params (e.g. ['name' => 'Alice'])
     * @return string Translated string, or the key if not found
     */
    public static function get(string $key, array $params = []): string
    {
        [$namespace, $dotKey] = self::parseKey($key);

        // Try current locale, then fall back to 'en'
        $value = self::lookup($namespace, $dotKey, self::$locale)
            ?? self::lookup($namespace, $dotKey, 'en')
            ?? $key;

        return self::interpolate($value, $params);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Private helpers
    // ──────────────────────────────────────────────────────────────────────────

    private static function parseKey(string $key): array
    {
        $pos = strpos($key, '.');
        if ($pos === false) {
            return ['common', $key];
        }
        return [substr($key, 0, $pos), substr($key, $pos + 1)];
    }

    private static function lookup(string $namespace, string $key, string $locale): ?string
    {
        $cacheKey = "{$locale}/{$namespace}";

        if (!array_key_exists($cacheKey, self::$loaded)) {
            self::$loaded[$cacheKey] = self::loadFile($locale, $namespace);
        }

        $strings = self::$loaded[$cacheKey];
        if ($strings === null) {
            return null;
        }

        // Support nested dot-notation within the JSON (e.g. "meta.title")
        $parts = explode('.', $key);
        $current = $strings;
        foreach ($parts as $part) {
            if (!is_array($current) || !array_key_exists($part, $current)) {
                return null;
            }
            $current = $current[$part];
        }

        return is_string($current) ? $current : null;
    }

    private static function loadFile(string $locale, string $namespace): ?array
    {
        if (self::$langDir === '') {
            return null;
        }

        $path = self::$langDir . '/' . $locale . '/' . $namespace . '.json';
        if (!file_exists($path)) {
            return null;
        }

        $contents = file_get_contents($path);
        if ($contents === false) {
            return null;
        }

        $decoded = json_decode($contents, true);
        return is_array($decoded) ? $decoded : null;
    }

    private static function interpolate(string $value, array $params): string
    {
        if (empty($params)) {
            return $value;
        }
        foreach ($params as $k => $v) {
            // Handle both {{var}} (i18next format, used in most lang JSON files)
            // and :var (Laravel format, used in some lang values that were
            // written Laravel-style). Without handling both, emails show the
            // raw placeholder.
            $value = str_replace('{{' . $k . '}}', (string) $v, $value);
            $value = str_replace(':' . $k, (string) $v, $value);
        }
        return $value;
    }
}
