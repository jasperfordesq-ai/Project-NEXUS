<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\MemberImport;

/**
 * Turns the bytes of an uploaded member-import file into rows, or refuses the
 * whole file with a reason the admin can act on. Nothing is guessed: a file
 * that is not UTF-8 CSV in the template's columns is refused, never converted
 * (owner, 8 Oct 2026 — "if it hasn't got our values, the import is invalid").
 *
 * Refusal codes (each one tells the admin what to change):
 *   empty_file, too_large, spreadsheet_workbook, not_text, not_utf8,
 *   unsupported_delimiter, header_not_on_first_line, empty_column_heading,
 *   duplicate_columns, old_template, unknown_columns, missing_columns,
 *   no_data_rows, too_many_rows
 */
final class MemberImportFile
{
    public const COLUMNS = ['first_name', 'last_name', 'email', 'phone', 'location', 'balance'];
    public const MAX_BYTES = 2 * 1024 * 1024;
    public const MAX_ROWS = 5000;

    /** @return array<string, mixed> */
    public static function parse(string $bytes): array
    {
        if ($bytes === '') {
            return self::refuse('empty_file');
        }
        if (strlen($bytes) > self::MAX_BYTES) {
            return self::refuse('too_large', ['max_mb' => intdiv(self::MAX_BYTES, 1024 * 1024)]);
        }
        if (str_starts_with($bytes, "PK\x03\x04") || str_starts_with($bytes, "\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1")) {
            return self::refuse('spreadsheet_workbook');
        }
        if (str_starts_with($bytes, "\xFF\xFE") || str_starts_with($bytes, "\xFE\xFF")) {
            return self::refuse('not_utf8');
        }
        if (str_contains($bytes, "\0")) {
            return self::refuse('not_text');
        }
        if (!mb_check_encoding($bytes, 'UTF-8')) {
            return self::refuse('not_utf8');
        }

        $text = preg_replace('/^\xEF\xBB\xBF/', '', $bytes) ?? $bytes;
        $text = str_replace(["\r\n", "\r"], "\n", $text);

        if (trim($text) === '') {
            return self::refuse('empty_file');
        }
        // The delimiter is read from the same line the header is read from.
        $firstLine = explode("\n", $text, 2)[0];
        if (trim($firstLine) === '') {
            return self::refuse('header_not_on_first_line');
        }
        $delimiter = self::detectDelimiter($firstLine);
        if ($delimiter === null) {
            return self::refuse('unsupported_delimiter');
        }

        $handle = fopen('php://temp', 'r+');
        fwrite($handle, $text);
        rewind($handle);

        $rawHeader = fgetcsv($handle, null, $delimiter, '"', '');
        $rawHeader = is_array($rawHeader) ? array_map(static fn ($h) => (string) $h, $rawHeader) : [];
        $header = array_map([self::class, 'normaliseHeader'], $rawHeader);

        $emptyHeadings = array_keys($header, '', true);
        if ($emptyHeadings !== []) {
            fclose($handle);
            return self::refuse('empty_column_heading', [
                'positions' => array_map(static fn (int $i): int => $i + 1, $emptyHeadings),
            ]);
        }

        $duplicates = array_values(array_unique(array_diff_assoc($header, array_unique($header))));
        if ($duplicates !== []) {
            fclose($handle);
            return self::refuse('duplicate_columns', ['columns' => $duplicates]);
        }
        if (in_array('role', $header, true)) {
            fclose($handle);
            return self::refuse('old_template');
        }
        $unknown = array_values(array_diff($header, self::COLUMNS));
        if ($unknown !== []) {
            fclose($handle);
            return self::refuse('unknown_columns', ['columns' => $unknown]);
        }
        $missing = array_values(array_diff(self::COLUMNS, $header));
        if ($missing !== []) {
            fclose($handle);
            return self::refuse('missing_columns', ['columns' => $missing]);
        }

        // Spreadsheet row numbers: the header is row 1, and a quoted cell with a
        // line break spans several rows, so count physical lines, not records.
        $cursor = ftell($handle);
        $rowNumber = 1 + substr_count($text, "\n", 0, $cursor);

        $rows = [];
        $blank = 0;
        while (($record = fgetcsv($handle, null, $delimiter, '"', '')) !== false) {
            $end = ftell($handle);
            $row = $rowNumber;
            $rowNumber += substr_count($text, "\n", $cursor, $end - $cursor);
            $cursor = $end;

            $raw = array_map(static fn ($c) => (string) $c, $record);
            if (implode('', array_map('trim', $raw)) === '') {
                $blank++;
                continue;
            }
            if (count($rows) >= self::MAX_ROWS) {
                fclose($handle);
                return self::refuse('too_many_rows', ['max' => self::MAX_ROWS]);
            }
            $rows[] = [
                'row' => $row,
                'raw' => $raw,
                'cells' => count($raw) === count($header) ? array_combine($header, $raw) : null,
            ];
        }
        fclose($handle);

        if ($rows === []) {
            return self::refuse('no_data_rows');
        }

        return [
            'ok' => true,
            'delimiter' => $delimiter,
            'header' => $header,
            'raw_header' => $rawHeader,
            'blank_rows' => $blank,
            'rows' => $rows,
        ];
    }

    private static function normaliseHeader(string $name): string
    {
        $name = mb_strtolower(trim($name));
        $name = (string) preg_replace('/[\s\-]+/u', '_', $name);

        return trim((string) preg_replace('/_+/', '_', $name), '_');
    }

    /** Comma or semicolon, counted outside quotes on the header line. */
    private static function detectDelimiter(string $line): ?string
    {
        $unquoted = (string) preg_replace('/"[^"]*"/', '', $line);
        $commas = substr_count($unquoted, ',');
        $semicolons = substr_count($unquoted, ';');
        if ($commas === 0 && $semicolons === 0) {
            // A single column cannot be the template; a tab-separated file is
            // refused as such so the message tells the admin what to change.
            return str_contains($unquoted, "\t") ? null : ',';
        }

        return $semicolons > $commas ? ';' : ',';
    }

    /** @param array<string, mixed> $params @return array<string, mixed> */
    private static function refuse(string $code, array $params = []): array
    {
        return ['ok' => false, 'code' => $code, 'params' => $params];
    }
}
