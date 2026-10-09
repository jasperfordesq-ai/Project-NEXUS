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

    public function test_the_session_state_and_the_held_rows_are_separate_records(): void
    {
        $rows = [['email' => 'a@nexus.test'], ['email' => 'b@nexus.test']];
        $id = MemberImportSession::create($this->testTenantId, 11, $rows, 'm.csv', str_repeat('a', 64));

        $state = MemberImportSession::load($id, $this->testTenantId, 11);
        $this->assertNotNull($state);
        $this->assertArrayNotHasKey('rows', $state);
        $this->assertSame(2, $state['total']);
        $this->assertSame($rows, MemberImportSession::rows($state));

        $state['next_index'] = 1;
        $state['rows'] = [['email' => 'tampered@nexus.test']];
        MemberImportSession::save($state);
        $reloaded = MemberImportSession::load($id, $this->testTenantId, 11);
        $this->assertSame(1, $reloaded['next_index']);
        $this->assertArrayNotHasKey('rows', $reloaded);
        $this->assertSame($rows, MemberImportSession::rows($reloaded));

        MemberImportSession::discardRows($reloaded);
        $this->assertNull(MemberImportSession::rows($reloaded));
        $this->assertNotNull(MemberImportSession::load($id, $this->testTenantId, 11));
    }

    public function test_a_session_id_that_is_not_a_uuid_loads_nothing(): void
    {
        $this->assertNull(MemberImportSession::load('../etc/passwd', $this->testTenantId, 11));
        $this->assertNull(MemberImportSession::load('', $this->testTenantId, 11));
    }

    public function test_a_problems_result_still_carries_the_header_and_every_source_row(): void
    {
        $r = $this->check("Ada,Lovelace,ada@nexus.test,,,abc
Alan,Turing,alan@nexus.test,,,1
");
        $this->assertSame('problems', $r['status']);
        $this->assertSame(['first_name', 'last_name', 'email', 'phone', 'location', 'balance'], $r['header']);
        $this->assertSame([
            ['row' => 2, 'raw' => ['Ada', 'Lovelace', 'ada@nexus.test', '', '', 'abc']],
            ['row' => 3, 'raw' => ['Alan', 'Turing', 'alan@nexus.test', '', '', '1']],
        ], $r['source_rows']);
    }

    public function test_an_existing_member_beyond_the_first_500_emails_is_still_found(): void
    {
        User::factory()->forTenant($this->testTenantId)->create(['email' => 'member501@nexus.test']);
        $body = '';
        for ($i = 1; $i <= 501; $i++) {
            $body .= "Test,Person{$i},member{$i}@nexus.test,,,
";
        }
        $r = $this->check($body);
        $this->assertSame('problems', $r['status']);
        $this->assertSame([502], $r['existing_member_rows']);
        $this->assertSame([['row' => 502, 'column' => 'email', 'code' => 'already_member', 'params' => []]], $r['problems']);
    }

    public function test_an_existing_member_whose_stored_email_has_stray_spaces_is_still_found(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        DB::table('users')->where('id', $user->id)->update(['email' => 'Grace@Nexus.test  ']);

        $r = $this->check("Grace,Hopper,grace@nexus.test,,,
Ada,Lovelace,ada@nexus.test,,,
");
        $this->assertSame('problems', $r['status']);
        $this->assertSame([2], $r['existing_member_rows']);
        $this->assertSame([['row' => 2, 'column' => 'email', 'code' => 'already_member', 'params' => []]], $r['problems']);
    }

    /** The collation ignores trailing spaces but not leading ones, so the lookup trims. */
    public function test_an_existing_member_whose_stored_email_has_leading_spaces_is_still_found(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        DB::table('users')->where('id', $user->id)->update(['email' => '  grace@nexus.test']);

        $r = $this->check("Ada,Lovelace,ada@nexus.test,,,
Grace,Hopper,grace@nexus.test,,,
");
        $this->assertSame('problems', $r['status']);
        $this->assertSame([3], $r['existing_member_rows']);
        $this->assertSame([['row' => 3, 'column' => 'email', 'code' => 'already_member', 'params' => []]], $r['problems']);
    }

    public function test_a_database_match_no_file_row_maps_to_blocks_the_file(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        DB::table('users')->where('id', $user->id)->update(['email' => 'adà@nexus.test']);
        $matches = DB::select("SELECT COUNT(*) AS n FROM users WHERE id = ? AND email IN ('ada@nexus.test')", [$user->id]);
        if ((int) $matches[0]->n !== 1) {
            $this->markTestSkipped('This database collation does not treat à and a as equal.');
        }

        $r = $this->check("Ada,Lovelace,ada@nexus.test,,,
");
        $this->assertSame('problems', $r['status']);
        $this->assertSame([['row' => 0, 'column' => 'email', 'code' => 'already_member_unmatched', 'params' => []]], $r['problems']);
        $this->assertSame([], $r['existing_member_rows']);
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
