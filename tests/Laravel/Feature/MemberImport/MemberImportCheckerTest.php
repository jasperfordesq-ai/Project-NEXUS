<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\MemberImport;

use App\Models\User;
use App\Services\MemberImport\MemberImportChecker;
use App\Services\MemberImport\MemberImportSession;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

final class MemberImportCheckerTest extends TestCase
{
    use DatabaseTransactions;

    private const HEADER = "first_name,last_name,email,phone,location,balance\n";

    private function check(string $body): array
    {
        return app(MemberImportChecker::class)->check($this->testTenantId, self::HEADER . $body);
    }

    public function test_a_clean_file_is_ready_with_a_summary(): void
    {
        $r = $this->check("Ada,Lovelace,ada@nexus.test,,Cork,12.5\nAlan,Turing,alan@nexus.test,,,-3\n\n");
        $this->assertSame('ready', $r['status']);
        $this->assertSame(2, $r['summary']['rows']);
        $this->assertSame('12.50', $r['summary']['total_balance']);
        $this->assertSame(1, $r['summary']['negative_count']);
        $this->assertSame(1, $r['summary']['blank_rows_ignored']);
        $this->assertSame(1, $r['summary']['with_location']);
        $this->assertSame([['row' => 3, 'column' => 'balance', 'code' => 'negative_balance_zeroed', 'params' => ['original' => '-3.00']]], $r['warnings']);
        $this->assertSame(2, $r['rows'][0]['source_row']);
    }

    public function test_one_bad_row_makes_the_whole_file_problems_with_row_numbers(): void
    {
        $r = $this->check("Ada,Lovelace,ada@nexus.test,,,1\nAlan,Turing,alan@nexus.test,,,abc\n");
        $this->assertSame('problems', $r['status']);
        $this->assertArrayNotHasKey('rows', $r);
        $this->assertSame([['row' => 3, 'column' => 'balance', 'code' => 'invalid_number', 'params' => []]], $r['problems']);
    }

    public function test_the_same_email_twice_is_a_problem_on_the_later_row(): void
    {
        $r = $this->check("Ada,Lovelace,ada@nexus.test,,,\nAda,Again,ADA@nexus.test,,,\n");
        $this->assertSame([['row' => 3, 'column' => 'email', 'code' => 'duplicate_in_file', 'params' => ['first_row' => 2]]], $r['problems']);
    }

    public function test_an_existing_member_is_a_problem_and_listed_for_the_corrected_file(): void
    {
        $existing = User::factory()->forTenant($this->testTenantId)->create(['email' => 'grace@nexus.test']);
        $r = $this->check("Grace,Hopper,Grace@Nexus.test,,,\nAda,Lovelace,ada@nexus.test,,,\n");
        $this->assertSame('problems', $r['status']);
        $this->assertSame([2], $r['existing_member_rows']);
        $this->assertSame('already_member', $r['problems'][0]['code']);
        $this->assertSame($existing->email, 'grace@nexus.test');
    }

    public function test_a_member_of_another_community_with_that_email_is_not_a_problem(): void
    {
        User::factory()->forTenant($this->otherTenantId())->create(['email' => 'shared@nexus.test']);
        $this->assertSame('ready', $this->check("Sam,Shared,shared@nexus.test,,,\n")['status']);
    }

    public function test_a_row_with_too_few_cells_is_a_problem(): void
    {
        $r = $this->check("Ada,Lovelace,ada@nexus.test\n");
        $this->assertSame([['row' => 2, 'column' => null, 'code' => 'wrong_cell_count', 'params' => ['expected' => 6, 'found' => 3]]], $r['problems']);
    }

    public function test_a_file_error_is_passed_through(): void
    {
        $r = app(MemberImportChecker::class)->check($this->testTenantId, "PK\x03\x04xxxx");
        $this->assertSame(['status' => 'file_error', 'file_error' => ['code' => 'spreadsheet_workbook', 'params' => []]], $r);
    }

    public function test_a_session_is_bound_to_its_tenant_and_admin(): void
    {
        $id = MemberImportSession::create($this->testTenantId, 11, [['email' => 'a@nexus.test']], 'm.csv', str_repeat('a', 64));
        $this->assertNotNull(MemberImportSession::load($id, $this->testTenantId, 11));
        $this->assertNull(MemberImportSession::load($id, $this->testTenantId, 12));
        $this->assertNull(MemberImportSession::load($id, $this->otherTenantId(), 11));
        $this->assertSame(0, MemberImportSession::load($id, $this->testTenantId, 11)['next_index']);
    }

    /** A second community, created inside the test transaction. */
    private function otherTenantId(): int
    {
        return (int) DB::table('tenants')->insertGetId([
            'name' => 'Member Import Other Community',
            'slug' => 'member-import-other-' . bin2hex(random_bytes(4)),
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
