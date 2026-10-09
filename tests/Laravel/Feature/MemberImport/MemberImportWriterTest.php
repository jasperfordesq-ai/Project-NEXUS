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
use App\Services\Identity\RegistrationPolicyService;
use App\Services\MemberImport\MemberImportRowRules;
use App\Services\MemberImport\MemberImportStopped;
use App\Services\MemberImport\MemberImportWriter;
use App\Services\TenantSettingsService;
use App\Support\Wallet\OpeningBalance;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
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

    public function test_an_email_taken_since_the_check_with_leading_spaces_stored_is_still_a_stop(): void
    {
        $row = $this->row();
        $user = User::factory()->forTenant($this->testTenantId)->create();
        DB::table('users')->where('id', $user->id)->update(['email' => '  ' . $row['email']]);
        $users = DB::table('users')->where('tenant_id', $this->testTenantId)->count();
        $before = DB::table('transactions')->count();

        try {
            $this->write($row);
            $this->fail('expected a stop');
        } catch (MemberImportStopped $e) {
            $this->assertSame('email_now_taken', $e->reason);
        }
        $this->assertSame($users, DB::table('users')->where('tenant_id', $this->testTenantId)->count());
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

    public function test_an_imported_member_cannot_sign_in_and_the_login_answers_normally(): void
    {
        $row = $this->row();
        $out = $this->write($row);

        // A normal, full-cost Argon2id hash (PHP's defaults, the same as the
        // dummy hash login verifies unknown emails against), so login timing
        // is identical to every other account.
        $hash = (string) DB::table('users')->where('id', $out['user_id'])->value('password_hash');
        $info = password_get_info($hash);
        $this->assertSame('argon2id', $info['algoName']);
        $this->assertSame(
            ['memory_cost' => PASSWORD_ARGON2_DEFAULT_MEMORY_COST, 'time_cost' => PASSWORD_ARGON2_DEFAULT_TIME_COST, 'threads' => PASSWORD_ARGON2_DEFAULT_THREADS],
            $info['options']
        );
        $this->assertSame([65536, 4, 1], [$info['options']['memory_cost'], $info['options']['time_cost'], $info['options']['threads']]);
        $this->assertFalse(password_verify('wrong-password', $hash));

        // The real login endpoint: the usual "invalid credentials" answer, not a server error.
        $response = $this->apiPost('/auth/login', ['email' => $row['email'], 'password' => 'wrong-password']);
        $response->assertStatus(401);
    }

    public function test_one_writer_shares_one_unusable_hash_and_each_writer_makes_its_own(): void
    {
        $decision = AdminCreatedAccountAdmission::decide($this->testTenantId, false);
        $hashOf = fn (int $userId): string => (string) DB::table('users')->where('id', $userId)->value('password_hash');
        $importId = '55555555-5555-4555-8555-555555555555';

        $writerA = app()->make(MemberImportWriter::class);
        $a1 = $writerA->write($this->row(), $this->testTenantId, $this->adminId, $decision, $importId);
        $a2 = $writerA->write($this->row(), $this->testTenantId, $this->adminId, $decision, $importId);
        $this->assertSame($hashOf($a1['user_id']), $hashOf($a2['user_id']));

        // Not a singleton: a second writer (the next batch request) has its own secret.
        $writerB = app()->make(MemberImportWriter::class);
        $this->assertNotSame($writerA, $writerB);
        $b1 = $writerB->write($this->row(), $this->testTenantId, $this->adminId, $decision, $importId);
        $this->assertNotSame($hashOf($a1['user_id']), $hashOf($b1['user_id']));
    }

    public function test_any_other_exception_inside_the_write_also_becomes_a_clean_stop(): void
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
                throw new \RuntimeException('not a database error');
            }
        };
        $writer = new MemberImportWriter(
            app(MemberImportRowRules::class),
            app(EmailConfirmationService::class),
            $failingAudit
        );

        try {
            $writer->write(
                $row, $this->testTenantId, $this->adminId,
                AdminCreatedAccountAdmission::decide($this->testTenantId, false),
                '66666666-6666-4666-8666-666666666666'
            );
            $this->fail('expected a stop');
        } catch (MemberImportStopped $e) {
            $this->assertSame('write_failed', $e->reason);
        }
        $this->assertFalse(DB::table('users')->where('email', $row['email'])->exists());
    }

    /**
     * Inserts a clashing member (same tenant, same email) the instant the
     * writer's "does this email exist yet?" lookup has come back empty: the
     * check has passed, so only the database's unique key can stop the
     * duplicate. (It has to happen BEFORE the writer's transaction starts, so
     * that, as with a real second request, the clash survives the rollback.)
     */
    private function clashJustBeforeTheUsersInsert(string $email, ?string $importIdOfClash): void
    {
        $armed = true;
        DB::listen(function (QueryExecuted $query) use (&$armed, $email, $importIdOfClash): void {
            if (!$armed || stripos($query->sql, 'select `id` from `users`') !== 0 || !in_array($email, $query->bindings, true)) {
                return;
            }
            $armed = false;
            $clashId = (int) DB::table('users')->insertGetId([
                'tenant_id' => $this->testTenantId, 'name' => 'Clash', 'email' => $email, 'created_at' => now(),
            ]);
            if ($importIdOfClash !== null) {
                DB::table('org_audit_log')->insert([
                    'tenant_id' => $this->testTenantId, 'user_id' => $this->adminId, 'target_user_id' => $clashId,
                    'action' => MemberImportWriter::ACTION_MEMBER_IMPORTED,
                    'details' => json_encode(['import_id' => $importIdOfClash]), 'created_at' => now(),
                ]);
            }
        });
    }

    public function test_the_unique_key_stops_a_member_who_appears_after_the_check_and_writes_no_ledger(): void
    {
        $row = $this->row();
        $this->clashJustBeforeTheUsersInsert($row['email'], null);
        $ledgerBefore = DB::table('transactions')->where('transaction_type', OpeningBalance::TYPE)->count();

        try {
            $this->write($row);
            $this->fail('expected a stop');
        } catch (MemberImportStopped $e) {
            $this->assertSame('email_now_taken', $e->reason);
        }

        $this->assertSame($ledgerBefore, DB::table('transactions')->where('transaction_type', OpeningBalance::TYPE)->count());
        $this->assertSame(1, DB::table('users')->where('tenant_id', $this->testTenantId)->where('email', $row['email'])->count());
    }

    public function test_a_duplicate_that_is_this_imports_own_member_is_recognised_as_already_created(): void
    {
        // Two overlapping requests for the same import: the other one won the race.
        $row = $this->row();
        $importId = '77777777-7777-4777-8777-777777777777';
        $this->clashJustBeforeTheUsersInsert($row['email'], $importId);

        $out = $this->write($row, $importId);

        $this->assertTrue($out['already']);
        $this->assertTrue($out['admission_complete']);
        $this->assertSame(
            (int) DB::table('users')->where('tenant_id', $this->testTenantId)->where('email', $row['email'])->value('id'),
            $out['user_id']
        );
    }

    public function test_a_normal_write_and_a_recognised_repeat_report_the_admission_as_complete(): void
    {
        $row = $this->row();
        $this->assertTrue($this->write($row)['admission_complete']);
        $this->assertTrue($this->write($row)['admission_complete']);
    }

    public function test_a_member_whose_attestation_record_fails_is_created_but_reported(): void
    {
        // Seam: afterCreate() resolves AuditLogService from the container, so a
        // service that fails only for the attestation entry reaches exactly that step.
        $this->app->instance(AuditLogService::class, new class extends AuditLogService {
            public function logAction(
                int $tenantId,
                string $action,
                ?int $userId = null,
                array $details = [],
                ?int $organizationId = null,
                ?int $targetUserId = null,
            ): int {
                if ($action === AuditLogService::ACTION_ADMIN_IDENTITY_ATTESTED) {
                    throw new \RuntimeException('attestation could not be recorded');
                }

                return parent::logAction($tenantId, $action, $userId, $details, $organizationId, $targetUserId);
            }
        });
        $log = Log::spy();
        $decision = [
            'requires_identity_check' => true, 'held' => false, 'attested' => true,
            'registration_mode' => 'verified_identity',
            'columns' => ['is_approved' => 1, 'status' => 'active'],
        ];

        $out = app()->make(MemberImportWriter::class)->write(
            $this->row(), $this->testTenantId, $this->adminId, $decision, '88888888-8888-4888-8888-888888888888'
        );

        $this->assertFalse($out['admission_complete']);
        $this->assertFalse($out['already']);
        $this->assertTrue(DB::table('users')->where('id', $out['user_id'])->exists());
        $this->assertSame(1, DB::table('transactions')->where('receiver_id', $out['user_id'])->count());
        $log->shouldHaveReceived('error')->withArgs(
            fn (string $message): bool => $message === 'member_import.admission_after_create_failed'
        )->once();
    }

    public function test_a_member_whose_identity_check_could_not_be_started_is_reported(): void
    {
        // Seam: a community whose joining rules require an identity check holds the
        // new member, and afterCreate() then marks the check as outstanding with an
        // UPDATE on the member. Failing exactly that statement reaches the "check not
        // started" branch, which logs it and (since this round) reports it.
        DB::table('tenant_settings')->where('tenant_id', $this->testTenantId)
            ->whereIn('setting_key', ['general.registration_mode', 'general.admin_approval', 'registration_mode', 'admin_approval'])
            ->delete();
        RegistrationPolicyService::upsertPolicy($this->testTenantId, [
            'registration_mode' => 'verified_identity', 'verification_provider' => 'stripe_identity',
            'require_email_verify' => 1,
        ]);
        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);
        $decision = AdminCreatedAccountAdmission::decide($this->testTenantId, false);
        $this->assertTrue($decision['held']);

        DB::beforeExecuting(function (string $query): void {
            if (stripos($query, "UPDATE users SET verification_status = 'pending'") === 0) {
                throw new \RuntimeException('the check could not be marked as outstanding');
            }
        });
        $log = Log::spy();

        $out = app()->make(MemberImportWriter::class)->write(
            $this->row(), $this->testTenantId, $this->adminId, $decision, '99999999-9999-4999-8999-999999999999'
        );

        $this->assertFalse($out['admission_complete']);
        $this->assertSame('pending', DB::table('users')->where('id', $out['user_id'])->value('status'));
        $log->shouldHaveReceived('error')->withArgs(
            fn (string $message): bool => $message === 'admin_created_account.identity_check_start_failed'
        )->once();
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
        $federationBefore = DB::table('federation_user_settings')->count();

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
        $this->assertSame($federationBefore, DB::table('federation_user_settings')->count());
    }
}
