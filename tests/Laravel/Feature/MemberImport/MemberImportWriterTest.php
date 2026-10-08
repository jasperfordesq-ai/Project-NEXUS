<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\MemberImport;

use App\Models\User;
use App\Services\AuditLogService;
use App\Services\Auth\EmailConfirmationService;
use App\Services\Identity\AdminCreatedAccountAdmission;
use App\Services\MemberImport\MemberImportRowRules;
use App\Services\MemberImport\MemberImportStopped;
use App\Services\MemberImport\MemberImportWriter;
use App\Support\Wallet\OpeningBalance;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

final class MemberImportWriterTest extends TestCase
{
    use DatabaseTransactions;

    private int $adminId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->adminId = User::factory()->forTenant($this->testTenantId)->admin()->create()->id;
    }

    /** @return array<string, mixed> */
    private function row(array $over = []): array
    {
        return array_merge([
            'first_name' => 'Ada', 'last_name' => 'Lovelace',
            'email' => 'ada-' . bin2hex(random_bytes(4)) . '@nexus.test',
            'phone' => null, 'location' => 'Cork', 'balance_cents' => 1250,
            'original_balance_cents' => null, 'source_row' => 2,
        ], $over);
    }

    private function write(array $row, string $importId = '11111111-1111-4111-8111-111111111111'): array
    {
        return app(MemberImportWriter::class)->write(
            $row, $this->testTenantId, $this->adminId,
            AdminCreatedAccountAdmission::decide($this->testTenantId, false), $importId
        );
    }

    public function test_a_member_is_created_with_balance_ledger_and_location(): void
    {
        $row = $this->row();
        $out = $this->write($row);

        $user = DB::table('users')->where('id', $out['user_id'])->first();
        $this->assertSame((int) $this->testTenantId, (int) $user->tenant_id);
        $this->assertSame('Ada Lovelace', $user->name);
        $this->assertSame('Cork', $user->location);
        $this->assertSame('member', $user->role);
        $this->assertSame('12.50', (string) $user->balance);
        $this->assertNotNull($user->email_verified_at);

        $ledger = DB::table('transactions')->where('receiver_id', $out['user_id'])->get();
        $this->assertCount(1, $ledger);
        $this->assertSame(OpeningBalance::TYPE, $ledger[0]->transaction_type);
        $this->assertSame(0, (int) $ledger[0]->sender_id);
        $this->assertSame('12.50', (string) $ledger[0]->amount);
        $this->assertStringContainsString('(import 11111111', $ledger[0]->description);

        $this->assertTrue(DB::table('org_audit_log')->where('action', MemberImportWriter::ACTION_MEMBER_IMPORTED)
            ->where('target_user_id', $out['user_id'])->exists());
        $this->assertTrue(DB::table('federation_user_settings')->where('user_id', $out['user_id'])->exists());
    }

    public function test_balance_always_equals_the_sum_of_its_ledger(): void
    {
        $out = $this->write($this->row(['balance_cents' => 0, 'original_balance_cents' => -300]));

        $balance = (string) DB::table('users')->where('id', $out['user_id'])->value('balance');
        $sum = (string) DB::table('transactions')->where('receiver_id', $out['user_id'])->sum('amount');
        $this->assertSame('0.00', $balance);
        $this->assertEquals((float) $balance, (float) $sum);
        $this->assertTrue($out['zeroed']);
        $this->assertSame(-300, OpeningBalance::originalCentsFrom(
            DB::table('transactions')->where('receiver_id', $out['user_id'])->value('description')
        ));
    }

    public function test_an_email_taken_since_the_check_stops_cleanly_and_writes_nothing(): void
    {
        $row = $this->row();
        User::factory()->forTenant($this->testTenantId)->create(['email' => strtoupper($row['email'])]);
        $before = DB::table('transactions')->count();

        try {
            $this->write($row);
            $this->fail('expected a stop');
        } catch (MemberImportStopped $e) {
            $this->assertSame('email_now_taken', $e->reason);
        }
        $this->assertSame($before, DB::table('transactions')->count());
    }

    public function test_a_member_this_import_already_created_is_recognised_not_stopped(): void
    {
        // The server committed the member, then died before recording progress.
        $row = $this->row();
        $first = $this->write($row);

        $again = $this->write($row);

        $this->assertTrue($again['already']);
        $this->assertSame($first['user_id'], $again['user_id']);
        $this->assertSame(1, DB::table('transactions')->where('receiver_id', $first['user_id'])->count());
    }

    public function test_the_same_email_from_a_different_import_is_a_stop(): void
    {
        $row = $this->row();
        $this->write($row, '22222222-2222-4222-8222-222222222222');

        try {
            $this->write($row);
            $this->fail('expected a stop');
        } catch (MemberImportStopped $e) {
            $this->assertSame('email_now_taken', $e->reason);
        }
    }

    public function test_a_row_that_no_longer_passes_the_rules_is_refused(): void
    {
        try {
            $this->write($this->row(['first_name' => '=cmd|calc']));
            $this->fail('expected a stop');
        } catch (MemberImportStopped $e) {
            $this->assertSame('row_changed', $e->reason);
        }
    }

    public function test_a_failure_part_way_through_leaves_nothing_behind(): void
    {
        $row = $this->row();
        $failingAudit = new class extends AuditLogService {
            public function logAction(
                int $tenantId,
                string $action,
                ?int $userId = null,
                array $details = [],
                ?int $organizationId = null,
                ?int $targetUserId = null,
            ): int {
                throw new QueryException('mysql', 'insert into org_audit_log', [], new \Exception('simulated failure'));
            }
        };
        $writer = new MemberImportWriter(
            app(MemberImportRowRules::class),
            app(EmailConfirmationService::class),
            $failingAudit
        );
        $ledgerBefore = DB::table('transactions')->where('transaction_type', OpeningBalance::TYPE)->count();

        try {
            $writer->write(
                $row, $this->testTenantId, $this->adminId,
                AdminCreatedAccountAdmission::decide($this->testTenantId, false),
                '33333333-3333-4333-8333-333333333333'
            );
            $this->fail('expected a stop');
        } catch (MemberImportStopped $e) {
            $this->assertSame('write_failed', $e->reason);
        }

        // Account, ledger row, balance and federation settings are all gone together.
        $this->assertFalse(DB::table('users')->where('email', $row['email'])->exists());
        $this->assertSame($ledgerBefore, DB::table('transactions')->where('transaction_type', OpeningBalance::TYPE)->count());
    }
}
