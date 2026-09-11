<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Support;

use App\Support\CsvExportSanitizer;
use PHPUnit\Framework\TestCase;

/**
 * Two guarantees about CSV exports, kept as plain PHPUnit so they run without
 * the framework or a database.
 *
 * 1. `CsvExportSanitizer::put()` behaves like fputcsv() but neutralises every
 *    cell, so a call site changes only its function name.
 * 2. Every file under app/ that writes CSV goes through the sanitiser. On
 *    2026-09-11 the security audit found nineteen exporters calling fputcsv()
 *    directly with member-controlled text while the shared sanitiser existed and
 *    was used by twelve others. A file may write CSV another way only if it is
 *    named below with the reason.
 */
class CsvExportSanitizerCoverageTest extends TestCase
{
    /**
     * Files allowed to call fputcsv() without CsvExportSanitizer, each with why.
     * Shrink this list; never grow it without a reason a reviewer would accept.
     */
    private const ALLOWED_RAW_FPUTCSV = [
        // The wrapper itself.
        'app/Support/CsvExportSanitizer.php' => 'the sanitising wrapper around fputcsv()',
        // Own neutraliser, same rule (leading = + - @ tab CR).
        'app/Services/ReportExportService.php' => 'sanitizeCsvCell() neutralises every cell before fputcsv()',
        'app/Http/Controllers/Api/AdminLegalDocController.php' => 'sanitizeCsvValue() neutralises every cell before fputcsv()',
        // 🔴 Pending: this file was being edited by the concurrent MFA workstream
        // on 2026-09-11 and was off-limits to the audit. Convert its one fputcsv()
        // to CsvExportSanitizer::put() and delete this line.
        'app/Http/Controllers/Api/AdminUsersController.php' => 'PENDING — off-limits during the 2026-09-11 audit; convert and remove',
    ];

    public function test_put_writes_a_neutralised_row_with_fputcsv_semantics(): void
    {
        $stream = fopen('php://memory', 'w+');
        $this->assertNotFalse($stream);

        $written = CsvExportSanitizer::put($stream, ['=HYPERLINK("https://evil.example")', 'plain', 42, null, true, "-1+1", 'say "hi"']);
        $this->assertIsInt($written);

        rewind($stream);
        $line = stream_get_contents($stream);
        fclose($stream);

        // fputcsv() quotes only cells containing the separator, enclosure or
        // whitespace, so the neutralised `'-1+1` stays bare while the others are
        // quoted exactly as fputcsv() would.
        $this->assertSame(
            "\"'=HYPERLINK(\"\"https://evil.example\"\")\",plain,42,,1,'-1+1,\"say \"\"hi\"\"\"" . PHP_EOL,
            $line
        );
    }

    public function test_every_csv_writer_in_app_goes_through_the_sanitiser(): void
    {
        $root = dirname(__DIR__, 4);
        $offenders = [];

        foreach ($this->phpFilesUnder($root . '/app') as $path) {
            $source = (string) file_get_contents($path);
            if (! str_contains($source, 'fputcsv(')) {
                continue;
            }

            $relative = str_replace('\\', '/', substr($path, strlen($root) + 1));
            if (array_key_exists($relative, self::ALLOWED_RAW_FPUTCSV)) {
                continue;
            }

            // Strip the sanitised wrapper's own name so only bare fputcsv( remains.
            $bare = preg_replace('/CsvExportSanitizer::put\(/', '', $source);
            if (preg_match('/(?<![A-Za-z_])fputcsv\(/', (string) $bare) === 1) {
                $offenders[] = $relative;
            }
        }

        sort($offenders);
        $this->assertSame(
            [],
            $offenders,
            "These files write CSV with a bare fputcsv(). Use \\App\\Support\\CsvExportSanitizer::put() (same arguments), "
            . 'or name the file in ALLOWED_RAW_FPUTCSV with the reason it is safe.'
        );
    }

    public function test_the_allowlist_only_names_files_that_still_exist_and_still_write_csv(): void
    {
        $root = dirname(__DIR__, 4);
        foreach (array_keys(self::ALLOWED_RAW_FPUTCSV) as $relative) {
            $path = $root . '/' . $relative;
            $this->assertFileExists($path, "Allowlisted file no longer exists — delete its line: {$relative}");
            $this->assertStringContainsString('fputcsv(', (string) file_get_contents($path), "Allowlisted file no longer calls fputcsv() — delete its line: {$relative}");
        }
    }

    /** @return list<string> */
    private function phpFilesUnder(string $dir): array
    {
        $files = [];
        $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS));
        foreach ($iterator as $file) {
            if ($file->isFile() && $file->getExtension() === 'php') {
                $files[] = $file->getPathname();
            }
        }

        return $files;
    }
}
