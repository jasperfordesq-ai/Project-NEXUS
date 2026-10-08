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

    public function test_exactly_the_maximum_number_of_rows_is_accepted(): void
    {
        $lines = self::HEADER;
        for ($i = 1; $i <= MemberImportFile::MAX_ROWS; $i++) {
            $lines .= "A,B,a{$i}@nexus.test,,,\n";
        }

        $r = MemberImportFile::parse($lines);
        $this->assertTrue($r['ok']);
        $this->assertCount(MemberImportFile::MAX_ROWS, $r['rows']);
        $this->assertSame(MemberImportFile::MAX_ROWS + 1, $r['rows'][array_key_last($r['rows'])]['row']);
    }

    public function test_an_empty_column_heading_is_named_by_its_position(): void
    {
        $r = MemberImportFile::parse("first_name,last_name,email,phone,location,balance,\nA,B,a@nexus.test,,,,\n");
        $this->assertFalse($r['ok']);
        $this->assertSame('empty_column_heading', $r['code']);
        $this->assertSame([7], $r['params']['positions']);
    }

    public function test_every_empty_column_heading_is_listed(): void
    {
        $r = MemberImportFile::parse("first_name,,email,phone,location,balance,\nA,B,a@nexus.test,,,,\n");
        $this->assertSame('empty_column_heading', $r['code']);
        $this->assertSame([2, 7], $r['params']['positions']);
    }

    public function test_a_blank_first_line_says_the_header_is_not_on_the_first_line(): void
    {
        $r = MemberImportFile::parse("\n" . self::HEADER . "Ada,Lovelace,ada@nexus.test,,,\n");
        $this->assertFalse($r['ok']);
        $this->assertSame('header_not_on_first_line', $r['code']);

        $spaced = MemberImportFile::parse("   \r\n" . self::HEADER . "Ada,Lovelace,ada@nexus.test,,,\n");
        $this->assertSame('header_not_on_first_line', $spaced['code']);
    }

    public function test_a_file_of_only_blank_lines_is_an_empty_file(): void
    {
        foreach (["\n\n", " \r\n  \r\n", "\n", "\xEF\xBB\xBF", "\xEF\xBB\xBF\n"] as $bytes) {
            $r = MemberImportFile::parse($bytes);
            $this->assertFalse($r['ok']);
            $this->assertSame('empty_file', $r['code']);
        }
    }

    public function test_a_quoted_cell_with_a_comma_is_one_cell(): void
    {
        $r = MemberImportFile::parse(self::HEADER . "Ada,\"Lovelace, Jr\",ada@nexus.test,,,\n");
        $this->assertTrue($r['ok']);
        $this->assertCount(6, $r['rows'][0]['raw']);
        $this->assertSame('Lovelace, Jr', $r['rows'][0]['cells']['last_name']);
    }

    public function test_a_quoted_cell_with_a_line_break_is_one_cell_and_later_rows_keep_spreadsheet_numbers(): void
    {
        $r = MemberImportFile::parse(self::HEADER . "Ada,\"Lovelace\nJr\",ada@nexus.test,,,\nBob,Smith,bob@nexus.test,,,\n");
        $this->assertTrue($r['ok']);
        $this->assertCount(2, $r['rows']);
        $this->assertSame("Lovelace\nJr", $r['rows'][0]['cells']['last_name']);
        $this->assertSame(2, $r['rows'][0]['row']);
        // Ada's cell spans spreadsheet rows 2 and 3, so Bob is on row 4.
        $this->assertSame(4, $r['rows'][1]['row']);
    }

    public function test_a_file_with_only_carriage_returns_is_read_line_by_line(): void
    {
        $r = MemberImportFile::parse("first_name,last_name,email,phone,location,balance\rAda,Lovelace,ada@nexus.test,,Cork,1\r");
        $this->assertTrue($r['ok']);
        $this->assertSame(2, $r['rows'][0]['row']);
        $this->assertSame('Cork', $r['rows'][0]['cells']['location']);
    }

    public function test_a_last_line_without_a_newline_is_read(): void
    {
        $r = MemberImportFile::parse(self::HEADER . 'Ada,Lovelace,ada@nexus.test,,,');
        $this->assertTrue($r['ok']);
        $this->assertCount(1, $r['rows']);
        $this->assertSame('Ada', $r['rows'][0]['cells']['first_name']);
    }

    public function test_a_fully_quoted_semicolon_header_with_a_bom_is_accepted(): void
    {
        $r = MemberImportFile::parse("\xEF\xBB\xBF\"first_name\";\"last_name\";\"email\";\"phone\";\"location\";\"balance\"\nAda;Lovelace;ada@nexus.test;;Cork;12,5\n");
        $this->assertTrue($r['ok']);
        $this->assertSame(';', $r['delimiter']);
        $this->assertSame(MemberImportFile::COLUMNS, $r['header']);
        $this->assertSame('12,5', $r['rows'][0]['cells']['balance']);
    }
}
