<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

/**
 * Dump every lang/<locale>/<namespace>.php file as one flat JSON document.
 *
 * Node-side i18n gates need the *values* of the PHP translation files, not just
 * their key sets. Reading them the way check-php-lang-parity.mjs does — one
 * `php -r "echo json_encode(require ...)"` per file — costs one process start
 * per file, which at 462 files takes minutes on Windows. This does the same work
 * in a single process, in about a second.
 *
 * PHP is the only correct reader for these files: they are executable PHP, and
 * regex-parsing array syntax is exactly the sort of near-miss that lets a real
 * value through unexamined. So this is the reader, and Node only ever sees JSON.
 *
 * Usage:  php scripts/php/dump-lang.php [lang-dir]
 * Output: {"<locale>/<file>.php": {"<dotted.key>": "<value>", ...}, ...}
 *
 * Nested arrays are flattened with dots, matching how Laravel addresses them
 * (`__('api.federation.partnership_self')`). List values are flattened by index,
 * so each string leaf is dumped separately and can be compared on its own.
 * Non-string leaves (int, bool, null) are emitted as-is; callers decide whether
 * they are interesting.
 */

$langDir = $argv[1] ?? (dirname(__DIR__, 2) . '/lang');

if (! is_dir($langDir)) {
    fwrite(STDERR, "dump-lang: not a directory: $langDir\n");
    exit(1);
}

/**
 * @param array<array-key, mixed> $values
 * @return array<string, mixed>
 */
function flattenLangValues(array $values, string $prefix = ''): array
{
    $flat = [];

    foreach ($values as $key => $value) {
        $path = $prefix === '' ? (string) $key : $prefix . '.' . $key;

        if (is_array($value)) {
            foreach (flattenLangValues($value, $path) as $nestedKey => $nestedValue) {
                $flat[$nestedKey] = $nestedValue;
            }

            continue;
        }

        $flat[$path] = $value;
    }

    return $flat;
}

$locales = [];
foreach (scandir($langDir) ?: [] as $entry) {
    if ($entry === '.' || $entry === '..') {
        continue;
    }
    if (is_dir($langDir . '/' . $entry)) {
        $locales[] = $entry;
    }
}
sort($locales);

$dump = [];

foreach ($locales as $locale) {
    $localeDir = $langDir . '/' . $locale;

    $files = [];
    foreach (scandir($localeDir) ?: [] as $entry) {
        if (str_ends_with($entry, '.php')) {
            $files[] = $entry;
        }
    }
    sort($files);

    foreach ($files as $file) {
        $path = $localeDir . '/' . $file;

        // A lang file that does not return an array is a bug in that file, not
        // something to paper over: report it and stop, so the gate never
        // silently treats a broken namespace as "nothing untranslated here".
        $values = require $path;
        if (! is_array($values)) {
            fwrite(STDERR, "dump-lang: $locale/$file did not return an array\n");
            exit(1);
        }

        $dump[$locale . '/' . $file] = flattenLangValues($values);
    }
}

$json = json_encode($dump, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if ($json === false) {
    fwrite(STDERR, 'dump-lang: json_encode failed: ' . json_last_error_msg() . "\n");
    exit(1);
}

echo $json;
