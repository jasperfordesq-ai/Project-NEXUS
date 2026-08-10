<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

/**
 * Build deterministic Web UK locale catalogs from Laravel's authoritative
 * accessible-frontend translation arrays.
 *
 * Usage:
 *   php scripts/sync-laravel-locales.php [path-to-laravel-repository]
 */

const SUPPORTED_LOCALES = [
    'en', 'ga', 'de', 'fr', 'it', 'pt', 'es', 'nl', 'pl', 'ja', 'ar',
];

$defaultLaravelRoot = realpath(__DIR__ . '/../..');
$laravelRoot = $argv[1] ?? $defaultLaravelRoot;

if (! is_string($laravelRoot) || $laravelRoot === '' || ! is_dir($laravelRoot . '/lang')) {
    fwrite(STDERR, "Laravel language directory not found. Pass the Laravel repository path.\n");
    exit(1);
}

$outputDirectory = __DIR__ . '/../src/lib/localization/generated';
if (! is_dir($outputDirectory) && ! mkdir($outputDirectory, 0777, true) && ! is_dir($outputDirectory)) {
    fwrite(STDERR, "Could not create locale output directory: {$outputDirectory}\n");
    exit(1);
}

foreach (SUPPORTED_LOCALES as $locale) {
    $localeDirectory = rtrim($laravelRoot, '/\\') . '/lang/' . $locale;
    $files = array_merge(
        glob($localeDirectory . '/govuk_alpha*.php') ?: [],
        glob($localeDirectory . '/event_*.php') ?: [],
        glob($localeDirectory . '/safeguarding.php') ?: [],
    );
    if ($files === false || $files === []) {
        fwrite(STDERR, "No accessible locale files found for {$locale}.\n");
        exit(1);
    }

    sort($files, SORT_STRING);
    $namespaces = [];

    foreach ($files as $file) {
        $namespace = pathinfo($file, PATHINFO_FILENAME);
        $translations = require $file;
        if (! is_array($translations)) {
            fwrite(STDERR, "Locale source did not return an array: {$file}\n");
            exit(1);
        }

        $namespaces[$namespace] = $translations;
    }

    $catalog = [
        '_meta' => [
            'schema' => 1,
            'locale' => $locale,
            'source' => "lang/{$locale}/{govuk_alpha*,event_*,safeguarding}.php",
        ],
        'namespaces' => $namespaces,
    ];

    $json = json_encode(
        $catalog,
        JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR
    ) . "\n";

    $outputPath = $outputDirectory . '/' . $locale . '.json';
    if (file_put_contents($outputPath, $json) === false) {
        fwrite(STDERR, "Could not write locale catalog: {$outputPath}\n");
        exit(1);
    }

    fwrite(STDOUT, "{$locale}: " . count($namespaces) . " namespaces -> {$outputPath}\n");
}
