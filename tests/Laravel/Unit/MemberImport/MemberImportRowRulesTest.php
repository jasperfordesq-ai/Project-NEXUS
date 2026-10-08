<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\MemberImport;

use App\Services\MemberImport\MemberImportRowRules;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Laravel\TestCase;

final class MemberImportRowRulesTest extends TestCase
{
    /** @param array<string,string> $over @return array<string,string> */
    private function cells(array $over = []): array
    {
        return array_merge([
            'first_name' => 'Ada', 'last_name' => 'Lovelace', 'email' => 'Ada@Nexus.test',
            'phone' => '', 'location' => '', 'balance' => '',
        ], $over);
    }

    private function rules(): MemberImportRowRules
    {
        return app(MemberImportRowRules::class);
    }

    public function test_a_good_row_is_normalised(): void
    {
        $r = $this->rules()->check($this->cells(['phone' => " '+353 1 234 5678 ", 'location' => ' Cork ', 'balance' => '12,5']));
        $this->assertSame([], $r['problems']);
        $this->assertSame('ada@nexus.test', $r['row']['email']);
        $this->assertSame('+353 1 234 5678', $r['row']['phone']);
        $this->assertSame('Cork', $r['row']['location']);
        $this->assertSame(1250, $r['row']['balance_cents']);
        $this->assertNull($r['row']['original_balance_cents']);
    }

    public function test_blank_optional_fields_become_null_and_zero(): void
    {
        $r = $this->rules()->check($this->cells());
        $this->assertNull($r['row']['phone']);
        $this->assertNull($r['row']['location']);
        $this->assertSame(0, $r['row']['balance_cents']);
    }

    public function test_our_own_export_escape_is_undone(): void
    {
        $r = $this->rules()->check($this->cells(['balance' => "'-3.00"]));
        $this->assertSame([], $r['problems']);
        $this->assertSame(0, $r['row']['balance_cents']);
        $this->assertSame(-300, $r['row']['original_balance_cents']);
        $this->assertSame([['column' => 'balance', 'code' => 'negative_balance_zeroed', 'params' => ['original' => '-3.00']]], $r['warnings']);
    }

    /** @return iterable<string, array{array<string,string>, string, string}> */
    public static function problems(): iterable
    {
        yield 'no first name' => [['first_name' => '  '], 'first_name', 'required'];
        yield 'long last name' => [['last_name' => str_repeat('a', 101)], 'last_name', 'too_long'];
        yield 'formula name' => [['first_name' => '=HYPERLINK("x")'], 'first_name', 'starts_with_formula_character'];
        yield 'control char' => [['location' => "Co\x07rk"], 'location', 'control_characters'];
        yield 'no email' => [['email' => ''], 'email', 'required'];
        yield 'bad email' => [['email' => 'ada@'], 'email', 'invalid_email'];
        yield 'template example' => [['email' => 'jane@example.com'], 'email', 'example_address'];
        yield 'bad phone' => [['phone' => 'call me'], 'phone', 'invalid_phone'];
        yield 'text balance' => [['balance' => 'abc'], 'balance', 'invalid_number'];
        yield 'three decimals' => [['balance' => '1.505'], 'balance', 'invalid_number'];
        yield 'thousands sep' => [['balance' => '1,000.00'], 'balance', 'invalid_number'];
        yield 'unit text' => [['balance' => '5 hours'], 'balance', 'invalid_number'];
        yield 'too large' => [['balance' => '100000.01'], 'balance', 'balance_too_large'];
        yield 'long location' => [['location' => str_repeat('a', 256)], 'location', 'too_long'];
        yield 'formula email =' => [['email' => '=a@b.co'], 'email', 'starts_with_formula_character'];
        yield 'formula email -' => [['email' => '-a@b.co'], 'email', 'starts_with_formula_character'];
        yield 'disposable email' => [['email' => 'x@mailinator.com'], 'email', 'disposable_email'];
        yield 'long email' => [['email' => str_repeat('a', 251) . '@b.co'], 'email', 'too_long'];
        yield 'long phone' => [['phone' => '+' . str_repeat('1', 50)], 'phone', 'invalid_phone'];
        yield 'phone starting with minus' => [['phone' => '-1234567'], 'phone', 'invalid_phone'];
        yield 'escaped formula name' => [['first_name' => "'=1+1"], 'first_name', 'starts_with_formula_character'];
        yield 'tab inside a value' => [['location' => "Co\trk"], 'location', 'control_characters'];
        yield 'C1 control in a name' => [['first_name' => "Ad\u{85}a"], 'first_name', 'control_characters'];
        yield 'plus balance' => [['balance' => '+5'], 'balance', 'invalid_number'];
        yield 'trailing point balance' => [['balance' => '12.'], 'balance', 'invalid_number'];
        yield 'leading point balance' => [['balance' => '.5'], 'balance', 'invalid_number'];
        yield 'exponent balance' => [['balance' => '1e3'], 'balance', 'invalid_number'];
        yield 'unicode minus balance' => [['balance' => "\u{2212}3"], 'balance', 'invalid_number'];
        yield 'bad encoding name' => [['first_name' => "\xFF"], 'first_name', 'invalid_encoding'];
        yield 'bad encoding balance' => [['balance' => "1\xFF"], 'balance', 'invalid_encoding'];
    }

    /** @param array<string,string> $over */
    #[DataProvider('problems')]
    public function test_a_bad_value_is_a_problem(array $over, string $column, string $code): void
    {
        $r = $this->rules()->check($this->cells($over));
        $this->assertNull($r['row']);
        $this->assertContains(['column' => $column, 'code' => $code], array_map(
            static fn ($p) => ['column' => $p['column'], 'code' => $p['code']], $r['problems']
        ));
    }

    public function test_a_value_in_the_wrong_encoding_gets_only_that_problem(): void
    {
        $r = $this->rules()->check($this->cells(['first_name' => "\xFF"]));
        $this->assertSame([['column' => 'first_name', 'code' => 'invalid_encoding', 'params' => []]], $r['problems']);
    }

    public function test_unicode_spaces_and_invisible_marks_are_trimmed(): void
    {
        $r = $this->rules()->check($this->cells([
            'first_name' => "\u{A0}Ada\u{A0}", 'email' => "\u{3000}Ada@Nexus.test\u{200B}",
        ]));
        $this->assertSame([], $r['problems']);
        $this->assertSame('Ada', $r['row']['first_name']);
        $this->assertSame('ada@nexus.test', $r['row']['email']);
    }

    public function test_a_negative_balance_of_any_size_is_only_a_warning(): void
    {
        $r = $this->rules()->check($this->cells(['balance' => '-200000']));
        $this->assertSame([], $r['problems']);
        $this->assertSame(0, $r['row']['balance_cents']);
        $this->assertSame(-20_000_000, $r['row']['original_balance_cents']);
        $this->assertSame([['column' => 'balance', 'code' => 'negative_balance_zeroed', 'params' => ['original' => '-200000.00']]], $r['warnings']);
    }

    public function test_minus_zero_is_zero_without_a_warning(): void
    {
        $r = $this->rules()->check($this->cells(['balance' => '-0']));
        $this->assertSame(0, $r['row']['balance_cents']);
        $this->assertNull($r['row']['original_balance_cents']);
        $this->assertSame([], $r['warnings']);
    }

    public function test_the_same_cells_always_give_the_same_answer(): void
    {
        $cells = $this->cells(['phone' => '+353 1 234 5678', 'balance' => '-3,5']);
        $this->assertSame($this->rules()->check($cells), $this->rules()->check($cells));
    }

    public function test_the_maximum_balance_is_allowed(): void
    {
        $r = $this->rules()->check($this->cells(['balance' => '100000']));
        $this->assertSame(10_000_000, $r['row']['balance_cents']);
    }
}
