<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\MemberImport;

use App\Core\TenantContext;
use App\Models\Tenant;
use App\Models\User;
use App\Services\MemberImport\MemberExportCsv;
use App\Services\MemberImport\MemberImportChecker;
use App\Services\MemberImport\MemberImportFile;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Laravel\TestCase;

/**
 * Export for re-import (9 Oct 2026): every member of a community in exactly
 * the import template's columns, so a file can leave one community and go
 * into another unchanged. Admin only, limited per admin, and recorded.
 */
final class AdminMemberExportTest extends TestCase
{
    use DatabaseTransactions;

    private const URL = '/v2/admin/members/export';
    private const BOM = "\xEF\xBB\xBF";

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        // The test addresses are @nexus.test; the mailer accepts a reserved domain only when it is a capture domain.
        config(['mail.capture_recipient_domains' => ['nexus.test']]);
        $this->admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active', 'is_approved' => true]);
    }

    /** @return array<string, string> */
    private function headers(?User $as = null): array
    {
        $as ??= $this->admin;

        return ['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken($as->id, $as->tenant_id, TwoFactorPolicy::claims('totp'))];
    }

    private function export(?User $as = null): TestResponse
    {
        return $this->apiGet(self::URL, $this->headers($as));
    }

    /** @param array<string, mixed> $extra */
    private function member(array $extra = [], ?int $tenantId = null): User
    {
        return User::factory()->forTenant($tenantId ?? $this->testTenantId)->create(array_merge([
            'email' => 'export-' . bin2hex(random_bytes(6)) . '@nexus.test',
            'role' => 'member', 'status' => 'active', 'is_approved' => 1,
        ], $extra));
    }

    /**
     * The file's data rows keyed by email (as the importer reads them).
     *
     * @return array<string, list<string>>
     */
    private function rowsByEmail(string $body): array
    {
        $rows = [];
        foreach (array_slice(explode("\n", rtrim($body, "\n")), 1) as $line) {
            $cells = str_getcsv($line, ',', '"', '');
            $rows[(string) $cells[2]] = array_map(static fn ($c): string => (string) $c, $cells);
        }

        return $rows;
    }

    private function body(TestResponse $response): string
    {
        return (string) $response->streamedContent();
    }

    // ------------------------------------------------------------ the file

    public function test_a_stale_second_factor_is_asked_for_and_nothing_is_sent_or_recorded(): void
    {
        $stale = ['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken($this->admin->id, $this->admin->tenant_id, ['mfa_method' => 'totp', 'mfa_verified_at' => time() - 3600])];
        $before = DB::table('org_audit_log')->where('tenant_id', $this->testTenantId)->where('action', 'member_export')->count();

        $this->apiGet(self::URL, $stale)->assertStatus(403)->assertJsonPath('errors.0.code', 'AUTH_STEP_UP_REQUIRED');

        $this->assertSame($before, DB::table('org_audit_log')->where('tenant_id', $this->testTenantId)->where('action', 'member_export')->count());
    }

    public function test_the_file_has_exactly_the_import_templates_columns_after_a_bom(): void
    {
        $m = $this->member(['first_name' => 'Ada', 'last_name' => 'Lovelace', 'phone' => null, 'location' => 'Cork', 'balance' => 12.5]);

        $r = $this->export()->assertOk();
        $this->assertStringStartsWith('text/csv', (string) $r->headers->get('Content-Type'));
        $this->assertStringContainsString(
            'members-for-import-' . now()->format('Y-m-d') . '.csv',
            (string) $r->headers->get('Content-Disposition')
        );

        $body = $this->body($r);
        $this->assertStringStartsWith(self::BOM . implode(',', MemberImportFile::COLUMNS) . "\n", $body);
        $this->assertSame('first_name,last_name,email,phone,location,balance', implode(',', MemberImportFile::COLUMNS));
        $this->assertSame(['Ada', 'Lovelace', $m->email, '', 'Cork', '12.50'], $this->rowsByEmail(substr($body, 3))[$m->email]);
    }

    public function test_values_a_spreadsheet_would_run_are_escaped(): void
    {
        $m = $this->member(['first_name' => '=x', 'last_name' => '@y', 'phone' => '+353 87 123 4567', 'location' => '-x', 'balance' => -3]);

        $row = $this->rowsByEmail(substr($this->body($this->export()->assertOk()), 3))[$m->email];
        $this->assertSame(["'=x", "'@y", $m->email, "'+353 87 123 4567", "'-x", "'-3.00"], $row);
    }

    public function test_a_quote_after_a_backslash_survives_the_importers_reader(): void
    {
        $m = $this->member(['location' => 'Unit 4\\"B", Main St']);

        $row = $this->rowsByEmail(substr($this->body($this->export()->assertOk()), 3))[$m->email];
        $this->assertSame('Unit 4\\"B", Main St', $row[4]);
    }

    public function test_names_fall_back_to_the_stored_name_only_when_both_parts_are_empty(): void
    {
        $split = $this->member(['first_name' => null, 'last_name' => null, 'name' => '  Mary Ann  Smith ']);
        $single = $this->member(['first_name' => '', 'last_name' => null, 'name' => 'Cher']);
        $partial = $this->member(['first_name' => 'Grace', 'last_name' => null, 'name' => 'Grace Brewster Hopper']);

        $rows = $this->rowsByEmail(substr($this->body($this->export()->assertOk()), 3));
        $this->assertSame(['Mary', 'Ann Smith'], array_slice($rows[$split->email], 0, 2));
        $this->assertSame(['Cher', ''], array_slice($rows[$single->email], 0, 2));
        $this->assertSame(['Grace', ''], array_slice($rows[$partial->email], 0, 2), 'a stored part is never replaced by a guess');
    }

    public function test_balances_are_plain_two_decimal_strings(): void
    {
        $whole = $this->member(['balance' => 7]);
        $zero = $this->member(['balance' => 0]);
        $cents = $this->member(['balance' => 0.05]);

        $rows = $this->rowsByEmail(substr($this->body($this->export()->assertOk()), 3));
        $this->assertSame('7.00', $rows[$whole->email][5]);
        $this->assertSame('0.00', $rows[$zero->email][5]);
        $this->assertSame('0.05', $rows[$cents->email][5]);
    }

    public function test_only_this_communitys_members_in_id_order(): void
    {
        $other = Tenant::factory()->create();
        $elsewhere = $this->member([], (int) $other->id);
        $first = $this->member();
        $second = $this->member();

        $body = $this->body($this->export()->assertOk());
        $this->assertStringNotContainsString($elsewhere->email, $body);
        $emails = array_keys($this->rowsByEmail(substr($body, 3)));
        $this->assertLessThan(array_search($second->email, $emails, true), array_search($first->email, $emails, true));

        $ids = DB::table('users')->where('tenant_id', $this->testTenantId)
            ->whereIn('email', $emails)->orderBy('id')->pluck('email')->all();
        $this->assertSame($ids, $emails, 'rows come out in id order');
    }

    public function test_deleted_and_anonymised_accounts_are_left_out_and_everyone_else_is_in(): void
    {
        $deleted = $this->member(['deleted_at' => now()]);
        $anonymised = $this->member(['anonymized_at' => now()]);
        $erasedLocal = $this->member(['email' => 'deleted_901_' . bin2hex(random_bytes(4)) . '@anonymized.local']);
        $erasedInvalid = $this->member(['email' => 'deleted_' . random_int(100000, 999999) . '@anonymized.invalid']);
        $suspended = $this->member(['status' => 'suspended']);
        $pending = $this->member(['status' => 'pending', 'is_approved' => 0]);
        $broker = $this->member(['role' => 'broker']);

        $body = $this->body($this->export()->assertOk());
        foreach ([$deleted, $anonymised, $erasedLocal, $erasedInvalid] as $gone) {
            $this->assertStringNotContainsString($gone->email, $body);
        }
        foreach ([$suspended, $pending, $broker, $this->admin] as $kept) {
            $this->assertStringContainsString($kept->email, $body, 'every account that is not deleted is a member of the list');
        }

        $expected = DB::table('users')->where('tenant_id', $this->testTenantId)
            ->whereNull('deleted_at')->whereNull('anonymized_at')
            ->where('email', 'not like', '%@anonymized.local')->where('email', 'not like', '%@anonymized.invalid')
            ->count();
        $this->assertSame($expected, count(explode("\n", rtrim($body, "\n"))) - 1);
    }

    // ------------------------------------------------------------ who may, how often, and the record

    public function test_the_export_is_recorded_with_its_row_count(): void
    {
        $this->member();
        $body = $this->body($this->export()->assertOk());
        $rows = count(explode("\n", rtrim($body, "\n"))) - 1;

        $audit = DB::table('org_audit_log')->where('tenant_id', $this->testTenantId)
            ->where('action', MemberExportCsv::AUDIT_ACTION)->where('user_id', $this->admin->id)->latest('id')->first();
        $this->assertNotNull($audit, 'personal data leaving the platform is audited');
        $this->assertSame(['rows' => $rows], json_decode((string) $audit->details, true));

        $log = DB::table('activity_log')->where('tenant_id', $this->testTenantId)->where('user_id', $this->admin->id)
            ->where('action', 'admin_member_export')->latest('id')->first();
        $this->assertNotNull($log);
        $this->assertStringNotContainsString('@', (string) $log->details, 'no addresses in the activity log');
    }

    public function test_a_member_and_a_broker_are_refused(): void
    {
        // First: the test client keeps the last request's signed-in user.
        $this->apiGet(self::URL)->assertStatus(401);
        $plain = $this->member();
        $broker = $this->member(['role' => 'broker']);
        foreach ([$plain, $broker] as $who) {
            $this->export($who)->assertStatus(403);
        }
        $this->assertSame(0, DB::table('org_audit_log')->where('tenant_id', $this->testTenantId)
            ->where('action', MemberExportCsv::AUDIT_ACTION)->whereIn('user_id', [$plain->id, $broker->id])->count());
    }

    public function test_ten_exports_per_five_minutes_per_admin(): void
    {
        for ($i = 0; $i < 10; $i++) {
            $this->export()->assertOk();
        }
        $this->export()->assertStatus(429);

        // Another administrator has their own allowance.
        $other = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        $this->export($other)->assertOk();
    }

    // ------------------------------------------------------------ round trip

    public function test_round_trip_into_another_community_is_ready_and_into_the_same_one_is_all_already_members(): void
    {
        $source = Tenant::factory()->create();
        $tid = (int) $source->id;
        $seed = bin2hex(random_bytes(4));
        $people = [
            ['first_name' => 'Ada', 'last_name' => 'Lovelace', 'phone' => '+353 87 123 4567', 'location' => 'Cork', 'balance' => 12.5],
            ['first_name' => 'Alan', 'last_name' => 'Turing', 'phone' => null, 'location' => null, 'balance' => -3],
            ['first_name' => null, 'last_name' => null, 'name' => 'Grace Brewster Hopper', 'phone' => '+1 555 123 4567', 'location' => 'Arlington', 'balance' => 0],
            ['first_name' => 'Mary', 'last_name' => "O'Brien", 'phone' => null, 'location' => 'Galway, Connacht', 'balance' => 99999.99],
        ];
        foreach ($people as $i => $p) {
            $this->member($p + ['email' => "rt{$i}-{$seed}@nexus.test"], $tid);
        }
        $this->member(['email' => "rt-gone-{$seed}@nexus.test", 'deleted_at' => now()], $tid);

        $stream = fopen('php://temp', 'w+b');
        $written = MemberExportCsv::write($stream, $tid);
        rewind($stream);
        $bytes = (string) stream_get_contents($stream);
        fclose($stream);
        $this->assertSame(4, $written);
        $this->assertSame(4, MemberExportCsv::count($tid));

        $checker = app(MemberImportChecker::class);

        $elsewhere = $checker->check($this->testTenantId, $bytes);
        $this->assertSame('ready', $elsewhere['status'], json_encode($elsewhere['problems'] ?? []));
        $this->assertSame(4, $elsewhere['summary']['rows']);
        $this->assertSame(1, $elsewhere['summary']['negative_count']);
        $this->assertSame([['row' => 3, 'column' => 'balance', 'code' => 'negative_balance_zeroed', 'params' => ['original' => '-3.00']]], $elsewhere['warnings']);
        $this->assertSame('100012.49', $elsewhere['summary']['total_balance']);
        $byEmail = array_column($elsewhere['rows'], null, 'email');
        $this->assertSame('+353 87 123 4567', $byEmail["rt0-{$seed}@nexus.test"]['phone'], 'the formula escape is undone on the way back in');
        $this->assertSame(['Grace', 'Brewster Hopper'], [$byEmail["rt2-{$seed}@nexus.test"]['first_name'], $byEmail["rt2-{$seed}@nexus.test"]['last_name']]);
        $this->assertSame('Galway, Connacht', $byEmail["rt3-{$seed}@nexus.test"]['location']);

        TenantContext::setById($tid);
        $same = $checker->check($tid, $bytes);
        $this->assertSame('problems', $same['status']);
        $this->assertSame([2, 3, 4, 5], $same['existing_member_rows']);
        $this->assertSame(['already_member'], array_values(array_unique(array_column($same['problems'], 'code'))));
    }
}
