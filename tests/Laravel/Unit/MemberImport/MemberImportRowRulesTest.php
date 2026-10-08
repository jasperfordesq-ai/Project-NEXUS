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

    public function test_the_maximum_balance_is_allowed(): void
    {
        $r = $this->rules()->check($this->cells(['balance' => '100000']));
        $this->assertSame(10_000_000, $r['row']['balance_cents']);
    }
}
