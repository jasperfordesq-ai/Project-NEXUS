<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\MemberImport;

use App\Support\Wallet\OpeningBalance;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Checks a whole member-import file. Ready only when there is not a single
 * problem anywhere in it — one bad row means nothing is imported.
 */
final class MemberImportChecker
{
    public function __construct(private readonly MemberImportRowRules $rules)
    {
    }

    /**
     * The `summary` is meaningful only when status is 'ready': on a 'problems'
     * result it counts the rows that passed their own rules, not the file.
     *
     * @return array<string, mixed>
     */
    public function check(int $tenantId, string $bytes): array
    {
        $file = MemberImportFile::parse($bytes);
        if (!$file['ok']) {
            return ['status' => 'file_error', 'file_error' => ['code' => $file['code'], 'params' => $file['params']]];
        }

        $problems = [];
        $warnings = [];
        $rows = [];
        $firstRowByEmail = [];
        $expected = count($file['header']);

        foreach ($file['rows'] as $source) {
            if ($source['cells'] === null) {
                $problems[] = ['row' => $source['row'], 'column' => null, 'code' => 'wrong_cell_count',
                    'params' => ['expected' => $expected, 'found' => count($source['raw'])]];
                continue;
            }
            $result = $this->rules->check($source['cells']);
            foreach ($result['problems'] as $p) {
                $problems[] = ['row' => $source['row']] + $p;
            }
            foreach ($result['warnings'] as $w) {
                $warnings[] = ['row' => $source['row']] + $w;
            }
            if ($result['row'] === null) {
                continue;
            }
            $email = $result['row']['email'];
            if (isset($firstRowByEmail[$email])) {
                $problems[] = ['row' => $source['row'], 'column' => 'email', 'code' => 'duplicate_in_file',
                    'params' => ['first_row' => $firstRowByEmail[$email]]];
                continue;
            }
            $firstRowByEmail[$email] = $source['row'];
            $rows[] = $result['row'] + ['source_row' => $source['row']];
        }

        $existingRows = [];
        foreach (array_chunk(array_keys($firstRowByEmail), 500) as $chunk) {
            $placeholders = implode(',', array_fill(0, count($chunk), '?'));
            $found = DB::select(
                "SELECT email FROM users WHERE tenant_id = ? AND email IN ({$placeholders})",
                array_merge([$tenantId], $chunk)
            );
            foreach ($found as $f) {
                $row = $firstRowByEmail[mb_strtolower(trim((string) $f->email))] ?? null;
                if ($row === null) {
                    // The database matched an address no file row maps to (its collation can
                    // treat different spellings as equal). Never ignore it: the file is not ready.
                    Log::error('member_import.unmapped_existing_email', ['tenant_id' => $tenantId, 'chunk_size' => count($chunk)]);
                    $problems[] = ['row' => 0, 'column' => 'email', 'code' => 'already_member_unmatched', 'params' => []];
                    continue;
                }
                $existingRows[] = $row;
                $problems[] = ['row' => $row, 'column' => 'email', 'code' => 'already_member', 'params' => []];
            }
        }
        $existingRows = array_values(array_unique($existingRows));
        sort($existingRows);

        $columnOrder = array_flip(MemberImportFile::COLUMNS);
        usort($problems, static fn ($a, $b) => [$a['row'], $columnOrder[$a['column'] ?? ''] ?? -1]
            <=> [$b['row'], $columnOrder[$b['column'] ?? ''] ?? -1]);

        $result = [
            'status' => $problems === [] ? 'ready' : 'problems',
            'header' => $file['raw_header'],
            'source_rows' => array_map(static fn ($s) => ['row' => $s['row'], 'raw' => $s['raw']], $file['rows']),
            'problems' => $problems,
            'warnings' => $warnings,
            'existing_member_rows' => $existingRows,
            'summary' => [
                'rows' => count($file['rows']),
                'blank_rows_ignored' => $file['blank_rows'],
                'total_balance' => OpeningBalance::formatCents(array_sum(array_column($rows, 'balance_cents'))),
                'negative_count' => count(array_filter($rows, static fn ($r) => $r['original_balance_cents'] !== null)),
                'with_location' => count(array_filter($rows, static fn ($r) => $r['location'] !== null)),
                'without_location' => count(array_filter($rows, static fn ($r) => $r['location'] === null)),
            ],
        ];
        if ($problems === []) {
            $result['rows'] = $rows;
        }

        return $result;
    }
}
