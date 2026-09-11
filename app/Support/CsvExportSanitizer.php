<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support;

/**
 * Neutralizes values that spreadsheet tools may interpret as executable formulas.
 */
final class CsvExportSanitizer
{
    public static function cell(mixed $value): string
    {
        if ($value === null) {
            return '';
        }

        if (is_bool($value)) {
            return $value ? '1' : '0';
        }

        if (is_int($value) || is_float($value)) {
            return (string) $value;
        }

        $cell = (string) $value;

        if ($cell !== '' && preg_match('/^[\s\x00-\x1F]*[=+\-@]/u', $cell) === 1) {
            return "'" . $cell;
        }

        return $cell;
    }

    /**
     * @param array<int, mixed> $values
     * @return array<int, string>
     */
    public static function row(array $values): array
    {
        return array_map([self::class, 'cell'], $values);
    }

    /**
     * Drop-in replacement for fputcsv() that neutralises every cell first.
     *
     * Same signature as fputcsv(), so a call site changes only its name. Added
     * 2026-09-11 when the security audit found nineteen exporters writing
     * member-controlled text (names, titles, descriptions) with a bare fputcsv()
     * while three others had their own private neutraliser — the shared one
     * existed but was used by only twelve files. A guard test now fails on any
     * file in app/ that calls fputcsv() without going through this class.
     *
     * @param resource $stream
     * @param array<int, mixed> $fields
     */
    public static function put($stream, array $fields, string $separator = ',', string $enclosure = '"', string $escape = '\\', string $eol = PHP_EOL): int|false
    {
        return fputcsv($stream, self::row($fields), $separator, $enclosure, $escape, $eol);
    }
}
