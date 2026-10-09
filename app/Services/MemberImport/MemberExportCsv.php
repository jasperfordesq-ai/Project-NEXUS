<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\MemberImport;

use App\Support\CsvExportSanitizer;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Export for re-import (9 Oct 2026): every member of one community in exactly
 * the import template's columns (MemberImportFile::COLUMNS), so a file can go
 * out of one community and into another unchanged.
 *
 * Every account that is not deleted is a member of the list — staff included:
 * the import has no role column, so everyone it creates is a member. A deleted
 * account is one GDPR erasure has stamped (deleted_at / anonymized_at, as the
 * digest runner excludes them) or whose address erasure rewrote to the
 * @anonymized.local / @anonymized.invalid placeholder.
 *
 * Cells go through CsvExportSanitizer like every other export; the importer's
 * MemberImportRowRules::clean() undoes that escape on the way back in.
 */
final class MemberExportCsv
{
    public const AUDIT_ACTION = 'member_export';
    private const CHUNK = 1000;

    /** How many members write() would put in the file now. */
    public static function count(int $tenantId): int
    {
        return self::members($tenantId)->count();
    }

    /**
     * Write the whole file (BOM, header, one row per member in id order).
     *
     * @param resource $stream
     * @return int the number of member rows written
     */
    public static function write($stream, int $tenantId): int
    {
        fwrite($stream, "\xEF\xBB\xBF");
        // Escape character off, as the importer reads it: with PHP's default
        // backslash a value holding \" would come back split differently.
        CsvExportSanitizer::put($stream, MemberImportFile::COLUMNS, ',', '"', '', "\n");

        $written = 0;
        self::members($tenantId)
            ->select(['id', 'first_name', 'last_name', 'name', 'email', 'phone', 'location', 'balance'])
            ->chunkById(self::CHUNK, static function ($users) use ($stream, &$written): void {
                foreach ($users as $user) {
                    CsvExportSanitizer::put($stream, self::row($user), ',', '"', '', "\n");
                    $written++;
                }
            }, 'id');

        return $written;
    }

    /** @return list<string|null> in MemberImportFile::COLUMNS order */
    private static function row(object $user): array
    {
        $first = trim((string) ($user->first_name ?? ''));
        $last = trim((string) ($user->last_name ?? ''));
        if ($first === '' && $last === '') {
            // Only the full name is stored: first word, then the rest. Never invented.
            $parts = preg_split('/\s+/u', trim((string) ($user->name ?? '')), 2, PREG_SPLIT_NO_EMPTY) ?: [];
            $first = $parts[0] ?? '';
            $last = isset($parts[1]) ? (string) preg_replace('/\s+/u', ' ', $parts[1]) : '';
        }

        return [
            $first,
            $last,
            (string) $user->email,
            $user->phone,
            $user->location,
            self::balance($user->balance),
        ];
    }

    /** The decimal column as a plain 2-dp string; a negative stays negative (the importer zeroes it with a warning). */
    private static function balance(mixed $balance): string
    {
        if ($balance === null || $balance === '') {
            return '';
        }

        return number_format((float) $balance, 2, '.', '');
    }

    private static function members(int $tenantId): Builder
    {
        return DB::table('users')
            ->where('tenant_id', $tenantId)
            ->whereNull('deleted_at')
            ->whereNull('anonymized_at')
            ->where('email', 'not like', '%@anonymized.local')
            ->where('email', 'not like', '%@anonymized.invalid');
    }
}
