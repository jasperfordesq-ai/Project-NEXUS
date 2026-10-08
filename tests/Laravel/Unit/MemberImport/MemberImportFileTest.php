<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\MemberImport;

use App\Services\MemberImport\MemberImportFile;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class MemberImportFileTest extends TestCase
{
    private const HEADER = "first_name,last_name,email,phone,location,balance\n";

    public function test_a_correct_file_parses(): void
    {
        $r = MemberImportFile::parse(self::HEADER . "Ada,Lovelace,ada@nexus.test,+353 1 234 5678,Cork,12.5\n");
        $this->assertTrue($r['ok']);
        $this->assertSame(',', $r['delimiter']);
        $this->assertSame(2, $r['rows'][0]['row']);
        $this->assertSame('Cork', $r['rows'][0]['cells']['location']);
    }

    public function test_bom_crlf_and_any_column_order_and_header_spelling_are_accepted(): void
    {
        $r = MemberImportFile::parse("\xEF\xBB\xBFEmail,First Name,last-name,BALANCE,phone,location\r\nada@nexus.test,Ada,Lovelace,3,,\r\n");
        $this->assertTrue($r['ok']);
        $this->assertSame('Ada', $r['rows'][0]['cells']['first_name']);
    }

    public function test_semicolon_files_from_european_excel_are_accepted(): void
    {
        $r = MemberImportFile::parse("first_name;last_name;email;phone;location;balance\nZoë;Müller;zoe@nexus.test;;Köln;12,5\n");
        $this->assertTrue($r['ok']);
        $this->assertSame(';', $r['delimiter']);
        $this->assertSame('12,5', $r['rows'][0]['cells']['balance']);
    }

    public function test_trailing_blank_and_delimiter_only_lines_are_ignored_and_counted(): void
    {
        $r = MemberImportFile::parse(self::HEADER . "Ada,Lovelace,ada@nexus.test,,,\n\n,,,,,\n   \n");
        $this->assertTrue($r['ok']);
        $this->assertCount(1, $r['rows']);
        $this->assertSame(3, $r['blank_rows']);
    }

    public function test_a_row_with_the_wrong_number_of_cells_is_kept_for_the_problem_list(): void
    {
        $r = MemberImportFile::parse(self::HEADER . "Ada,Lovelace,ada@nexus.test\n");
        $this->assertTrue($r['ok']);
        $this->assertNull($r['rows'][0]['cells']);
        $this->assertSame(['Ada', 'Lovelace', 'ada@nexus.test'], $r['rows'][0]['raw']);
    }

    /** @return iterable<string, array{string, string}> */
    public static function refusals(): iterable
    {
        yield 'empty' => ['', 'empty_file'];
        yield 'xlsx (zip)' => ["PK\x03\x04" . str_repeat('x', 40), 'spreadsheet_workbook'];
        yield 'xls (ole)' => ["\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1" . str_repeat('x', 40), 'spreadsheet_workbook'];
        yield 'png' => ["\x89PNG\r\n\x1a\n\0\0\0\rIHDR", 'not_text'];
        yield 'windows-1252 accents' => [self::HEADER . "Zo\xEB,M\xFCller,zoe@nexus.test,,,\n", 'not_utf8'];
        yield 'utf-16 bom' => ["\xFF\xFEf\0i\0", 'not_utf8'];
        yield 'tab separated' => ["first_name\tlast_name\temail\tphone\tlocation\tbalance\nA\tB\ta@nexus.test\t\t\t\n", 'unsupported_delimiter'];
        yield 'old template' => ["first_name,last_name,email,phone,role\nA,B,a@nexus.test,,member\n", 'old_template'];
        yield 'missing columns' => ["first_name,last_name,email\nA,B,a@nexus.test\n", 'missing_columns'];
        yield 'unknown column' => [rtrim(self::HEADER) . ",notes\nA,B,a@nexus.test,,,,x\n", 'unknown_columns'];
        yield 'duplicate column' => [rtrim(self::HEADER) . ",email\nA,B,a@nexus.test,,,,a@nexus.test\n", 'duplicate_columns'];
        yield 'header only' => [self::HEADER, 'no_data_rows'];
    }

    #[DataProvider('refusals')]
    public function test_a_wrong_file_is_refused_with_a_reason(string $bytes, string $code): void
    {
        $r = MemberImportFile::parse($bytes);
        $this->assertFalse($r['ok']);
        $this->assertSame($code, $r['code']);
    }

    public function test_missing_columns_are_named(): void
    {
        $r = MemberImportFile::parse("first_name,last_name,email\nA,B,a@nexus.test\n");
        $this->assertSame(['phone', 'location', 'balance'], $r['params']['columns']);
    }

    public function test_size_and_row_limits(): void
    {
        $big = MemberImportFile::parse(self::HEADER . str_repeat('x', MemberImportFile::MAX_BYTES));
        $this->assertSame('too_large', $big['code']);

        $lines = self::HEADER;
        for ($i = 0; $i <= MemberImportFile::MAX_ROWS; $i++) {
            $lines .= "A,B,a{$i}@nexus.test,,,\n";
        }
        $many = MemberImportFile::parse($lines);
        $this->assertSame('too_many_rows', $many['code']);
        $this->assertSame(MemberImportFile::MAX_ROWS, $many['params']['max']);
    }
}
