<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\MemberImport;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\AuditLogService;
use App\Services\MemberImport\InvitationOutbox;
use App\Services\MemberImport\MemberImportRunner;
use App\Services\MemberImport\MemberImportSession;
use App\Services\TenantSettingsService;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Testing\TestResponse;
use Tests\Laravel\TestCase;

/**
 * The admin member import over HTTP: check the whole file, then import it in
 * batches the browser names by position (owner, 8 Oct 2026). Replaces
 * POST /v2/admin/users/import.
 */
final class AdminMemberImportEndpointsTest extends TestCase
{
    use DatabaseTransactions;

    private const HEADER = "first_name,last_name,email,phone,location,balance\n";

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        // The test addresses are @nexus.test; the mailer accepts a reserved domain only when it is a capture domain.
        config(['mail.capture_recipient_domains' => ['nexus.test']]);
        Cache::flush();
        Queue::fake();
        $this->admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active', 'is_approved' => true]);
    }

    /** @return array<string, string> */
    private function headers(?User $as = null, bool $fresh = true): array
    {
        $as ??= $this->admin;

        return ['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
            $as->id, $as->tenant_id, $fresh ? TwoFactorPolicy::claims('totp') : ['mfa_method' => 'totp', 'mfa_verified_at' => time() - 3600]
        )];
    }

    private function check(string $csv, ?User $as = null, bool $fresh = true): TestResponse
    {
        return $this->apiPost('/v2/admin/members/import/check', [
            'file_name' => 'members.csv', 'content_base64' => base64_encode($csv),
        ], $this->headers($as, $fresh));
    }

    /** @param array<string, mixed> $extra */
    private function batch(string $id, int $from, int $count, array $extra = [], ?User $as = null): TestResponse
    {
        return $this->apiPost("/v2/admin/members/import/{$id}/batch", ['from' => $from, 'count' => $count] + $extra, $this->headers($as));
    }

    private function csv(int $n, string $prefix): string
    {
        $out = self::HEADER;
        for ($i = 0; $i < $n; $i++) {
            $out .= "Member,{$i},{$prefix}-{$i}@nexus.test,,Town {$i},{$i}.5\n";
        }

        return $out;
    }

    /** The community's joining rules require an identity check. */
    private function requireIdentityCheck(): void
    {
        DB::table('tenant_registration_policies')->updateOrInsert(
            ['tenant_id' => $this->testTenantId],
            [
                'registration_mode' => 'government_id', 'verification_provider' => 'mi_test_idp',
                'verification_level' => 'document_only', 'post_verification' => 'admin_approval',
                'fallback_mode' => 'none', 'require_email_verify' => 0, 'provider_config' => null,
                'is_active' => 1, 'created_at' => now(), 'updated_at' => now(),
            ]
        );
        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);
        TenantContext::setById($this->testTenantId);
    }

    private function completionAudits(string $importId): int
    {
        return DB::table('org_audit_log')->where('tenant_id', $this->testTenantId)
            ->where('action', MemberImportRunner::ACTION_IMPORT_COMPLETED)
            ->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(details, '$.import_id')) = ?", [$importId])->count();
    }

    public function test_full_journey_imports_every_row_with_balances(): void
    {
        $prefix = 'mi-' . bin2hex(random_bytes(3));
        $check = $this->check($this->csv(25, $prefix))->assertOk();
        $this->assertSame('ready', $check->json('data.status'));
        $this->assertArrayNotHasKey('rows', $check->json('data'));
        $this->assertIsBool($check->json('data.admission.requires_identity_check'));
        $id = $check->json('data.import_id');
        $this->assertIsString($id);

        $next = 0;
        $r = null;
        while ($next < 25) {
            $r = $this->batch($id, $next, 10)->assertOk();
            $next = $r->json('data.next_index');
        }
        $this->assertSame('completed', $r->json('data.status'));
        $this->assertSame(25, $r->json('data.total'));
        $this->assertSame(25, $r->json('data.totals.created'));
        $this->assertSame(0, $r->json('data.totals.admission_incomplete'));
        $this->assertSame([], $r->json('data.admission_incomplete_rows'));
        $this->assertNull($r->json('data.stop'));
        $this->assertSame(25, DB::table('users')->where('tenant_id', $this->testTenantId)->where('email', 'like', $prefix . '-%')->count());
        $this->assertSame('312.50', $r->json('data.totals.balance')); // 0.5+1.5+…+24.5

        $audit = DB::table('org_audit_log')->where('tenant_id', $this->testTenantId)
            ->where('action', MemberImportRunner::ACTION_IMPORT_COMPLETED)
            ->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(details, '$.import_id')) = ?", [$id])->first();
        $this->assertNotNull($audit, 'the completed import is audited once, with its totals');
        $details = json_decode((string) $audit->details, true);
        $this->assertSame(25, $details['members_created']);
        $this->assertSame('312.50', $details['opening_balance_total']);
        $this->assertSame(0, $details['admission_incomplete']);
        $this->assertSame((int) $this->admin->id, (int) $audit->user_id);

        // Personal data is not held once the import is complete; the progress record stays.
        $state = MemberImportSession::load($id, $this->testTenantId, (int) $this->admin->id);
        $this->assertNotNull($state);
        $this->assertNull(MemberImportSession::rows($state));
    }

    public function test_a_file_with_one_problem_creates_no_session_and_no_members(): void
    {
        $prefix = 'mi-' . bin2hex(random_bytes(3));
        $csv = $this->csv(5, $prefix) . "Bad,Row,{$prefix}-x@nexus.test,,,lots\n";
        $r = $this->check($csv)->assertOk();
        $this->assertSame('problems', $r->json('data.status'));
        $this->assertNull($r->json('data.import_id'));
        $this->assertArrayNotHasKey('rows', $r->json('data'));
        $this->assertSame(0, DB::table('users')->where('email', 'like', $prefix . '-%')->count());
    }

    public function test_content_that_is_not_base64_is_refused(): void
    {
        $this->apiPost('/v2/admin/members/import/check', ['file_name' => 'members.csv', 'content_base64' => '***not base64***'], $this->headers())
            ->assertStatus(422)->assertJsonPath('errors.0.code', 'VALIDATION_ERROR');
    }

    public function test_replaying_a_batch_creates_nothing_extra(): void
    {
        $prefix = 'mi-' . bin2hex(random_bytes(3));
        $id = $this->check($this->csv(12, $prefix))->json('data.import_id');
        $this->batch($id, 0, 10)->assertOk()->assertJsonPath('data.next_index', 10);

        $this->batch($id, 0, 10)->assertOk()->assertJsonPath('data.next_index', 10)->assertJsonPath('data.batch.processed', 0);
        $this->assertSame(10, DB::table('users')->where('email', 'like', $prefix . '-%')->count());
    }

    public function test_skipping_ahead_is_refused(): void
    {
        $id = $this->check($this->csv(12, 'mi-' . bin2hex(random_bytes(3))))->json('data.import_id');
        $this->batch($id, 5, 10)->assertStatus(409)->assertJsonPath('errors.0.code', 'IMPORT_OUT_OF_ORDER');
    }

    public function test_a_bad_position_is_a_validation_error(): void
    {
        $id = $this->check($this->csv(3, 'mi-' . bin2hex(random_bytes(3))))->json('data.import_id');
        $this->batch($id, -1, 10)->assertStatus(422)->assertJsonPath('errors.0.code', 'VALIDATION_ERROR');
        $this->apiPost("/v2/admin/members/import/{$id}/batch", ['from' => 0], $this->headers())
            ->assertStatus(422)->assertJsonPath('errors.0.code', 'VALIDATION_ERROR');
    }

    public function test_a_concurrent_batch_is_told_to_wait(): void
    {
        $id = $this->check($this->csv(12, 'mi-' . bin2hex(random_bytes(3))))->json('data.import_id');
        $lock = MemberImportSession::lock($id);
        $this->assertTrue($lock->get());
        try {
            $this->batch($id, 0, 10)->assertStatus(409)->assertJsonPath('errors.0.code', 'IMPORT_BUSY');
        } finally {
            $lock->release();
        }
    }

    public function test_another_admin_cannot_use_the_import(): void
    {
        $id = $this->check($this->csv(3, 'mi-' . bin2hex(random_bytes(3))))->json('data.import_id');
        $other = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active', 'is_approved' => true]);
        $this->batch($id, 0, 10, [], $other)->assertStatus(404)->assertJsonPath('errors.0.code', 'IMPORT_NOT_FOUND');
    }

    public function test_an_unknown_import_is_not_found(): void
    {
        $this->batch('11111111-1111-4111-8111-111111111111', 0, 10)->assertStatus(404)->assertJsonPath('errors.0.code', 'IMPORT_NOT_FOUND');
    }

    public function test_rows_that_expired_mid_import_stop_it_without_writing(): void
    {
        $prefix = 'mi-' . bin2hex(random_bytes(3));
        $id = $this->check($this->csv(12, $prefix))->json('data.import_id');
        $this->batch($id, 0, 10)->assertOk();
        $state = MemberImportSession::load($id, $this->testTenantId, (int) $this->admin->id);
        MemberImportSession::discardRows($state);

        $this->batch($id, 10, 10)->assertStatus(404)->assertJsonPath('errors.0.code', 'IMPORT_NOT_FOUND');
        $this->assertSame(10, DB::table('users')->where('email', 'like', $prefix . '-%')->count());
    }

    public function test_a_stale_second_factor_is_asked_for_and_changes_nothing(): void
    {
        $prefix = 'mi-' . bin2hex(random_bytes(3));
        $this->check($this->csv(3, $prefix), null, false)->assertStatus(403)->assertJsonPath('errors.0.code', 'AUTH_STEP_UP_REQUIRED');

        $id = $this->check($this->csv(3, $prefix))->json('data.import_id');
        $this->apiPost("/v2/admin/members/import/{$id}/batch", ['from' => 0, 'count' => 10], $this->headers(null, false))
            ->assertStatus(403)->assertJsonPath('errors.0.code', 'AUTH_STEP_UP_REQUIRED');
        $this->assertSame(0, DB::table('users')->where('email', 'like', $prefix . '-%')->count());
    }

    public function test_members_and_brokers_are_refused(): void
    {
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active', 'is_approved' => true]);
        $member = User::factory()->forTenant($this->testTenantId)->create(['role' => 'member', 'status' => 'active', 'is_approved' => true]);
        $this->check($this->csv(1, 'mi-' . bin2hex(random_bytes(3))), $broker)->assertStatus(403);
        $this->check($this->csv(1, 'mi-' . bin2hex(random_bytes(3))), $member)->assertStatus(403);
        $this->get('/api/v2/admin/members/import/template', $this->withTenantHeader($this->headers($member)))->assertStatus(403);
    }

    public function test_a_broker_cannot_run_a_batch(): void
    {
        $prefix = 'mi-' . bin2hex(random_bytes(3));
        $id = $this->check($this->csv(3, $prefix))->json('data.import_id');
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active', 'is_approved' => true]);

        $this->batch($id, 0, 10, [], $broker)->assertStatus(403);
        $this->assertSame(0, DB::table('users')->where('email', 'like', $prefix . '-%')->count());
    }

    public function test_a_tiny_batch_is_raised_to_the_minimum(): void
    {
        $id = $this->check($this->csv(12, 'mi-' . bin2hex(random_bytes(3))))->json('data.import_id');
        $this->batch($id, 0, 1)->assertOk()->assertJsonPath('data.next_index', MemberImportRunner::MIN_BATCH);
    }

    public function test_replaying_a_completed_import_writes_no_second_completion_audit(): void
    {
        $id = $this->check($this->csv(3, 'mi-' . bin2hex(random_bytes(3))))->json('data.import_id');
        $this->batch($id, 0, 10)->assertOk()->assertJsonPath('data.status', 'completed');
        $this->batch($id, 0, 10)->assertOk()->assertJsonPath('data.status', 'completed')->assertJsonPath('data.batch.processed', 0);
        $this->batch($id, 3, 10)->assertOk()->assertJsonPath('data.status', 'completed');

        $this->assertSame(1, $this->completionAudits($id));
        $this->assertSame(1, DB::table('activity_log')->where('user_id', $this->admin->id)->where('action', 'admin_bulk_import_users')->count());
    }

    public function test_the_activity_feed_records_the_import_as_the_old_import_did(): void
    {
        $id = $this->check($this->csv(3, 'mi-' . bin2hex(random_bytes(3))))->json('data.import_id');
        $this->batch($id, 0, 10)->assertOk()->assertJsonPath('data.status', 'completed');

        $this->assertSame('Bulk imported 3 users (0 skipped)', DB::table('activity_log')
            ->where('user_id', $this->admin->id)->where('action', 'admin_bulk_import_users')->value('details'));
    }

    public function test_a_running_import_whose_last_member_was_written_completes_on_the_next_request(): void
    {
        $prefix = 'mi-' . bin2hex(random_bytes(3));
        $id = $this->check($this->csv(3, $prefix))->json('data.import_id');
        // The process died after writing the last member but before completing.
        $state = MemberImportSession::load($id, $this->testTenantId, (int) $this->admin->id);
        $state['status'] = 'running';
        $state['next_index'] = 3;
        $state['totals']['created'] = 3;
        MemberImportSession::save($state);

        // The browser retries the batch whose answer it never got.
        $this->batch($id, 0, 10)->assertOk()->assertJsonPath('data.status', 'completed')->assertJsonPath('data.batch.processed', 0);
        $this->assertSame(1, $this->completionAudits($id));
        $this->assertNull(MemberImportSession::rows(MemberImportSession::load($id, $this->testTenantId, (int) $this->admin->id)));
        $this->assertSame(0, DB::table('users')->where('email', 'like', $prefix . '-%')->count(), 'completing writes no member');
    }

    public function test_a_failing_bulk_import_record_does_not_undo_the_completion(): void
    {
        $this->app->instance(AuditLogService::class, new class extends AuditLogService {
            public function logBulkImport($adminUserId, $importedCount, $skippedCount, $totalRows)
            {
                throw new \RuntimeException('bulk import record failed');
            }
        });
        $id = $this->check($this->csv(3, 'mi-' . bin2hex(random_bytes(3))))->json('data.import_id');

        $this->batch($id, 0, 10)->assertOk()->assertJsonPath('data.status', 'completed');
        $this->batch($id, 3, 10)->assertOk()->assertJsonPath('data.status', 'completed');
        $this->assertSame(1, $this->completionAudits($id));
    }

    public function test_members_whose_identity_step_did_not_run_are_reported(): void
    {
        $this->requireIdentityCheck();
        // Seam (as in MemberImportWriterTest): the attestation record fails, so the
        // member is created but their identity step did not run.
        $this->app->instance(AuditLogService::class, new class extends AuditLogService {
            public function logAction(int $tenantId, string $action, ?int $userId = null, array $details = [], ?int $organizationId = null, ?int $targetUserId = null): int
            {
                if ($action === AuditLogService::ACTION_ADMIN_IDENTITY_ATTESTED) {
                    throw new \RuntimeException('attestation could not be recorded');
                }

                return parent::logAction($tenantId, $action, $userId, $details, $organizationId, $targetUserId);
            }
        });
        $id = $this->check($this->csv(3, 'mi-' . bin2hex(random_bytes(3))))->json('data.import_id');

        $r = $this->batch($id, 0, 10, ['identity_checked_by_admin' => true])->assertOk()->assertJsonPath('data.status', 'completed');
        $this->assertSame(3, $r->json('data.totals.admission_incomplete'));
        $this->assertSame([2, 3, 4], $r->json('data.admission_incomplete_rows'));
    }

    public function test_the_admission_decision_is_fixed_when_the_import_starts(): void
    {
        $prefix = 'mi-' . bin2hex(random_bytes(3));
        $id = $this->check($this->csv(12, $prefix))->json('data.import_id');
        $this->batch($id, 0, 10)->assertOk()->assertJsonPath('data.held', false);

        // The joining rules change mid-import; the rest of this import is admitted as it started.
        $this->requireIdentityCheck();
        $this->batch($id, 10, 10)->assertOk()->assertJsonPath('data.status', 'completed')->assertJsonPath('data.held', false);
        $this->assertSame(12, DB::table('users')->where('tenant_id', $this->testTenantId)
            ->where('email', 'like', $prefix . '-%')->where('status', 'active')->count());
    }

    public function test_a_new_check_discards_the_same_admins_never_started_import(): void
    {
        $first = $this->check($this->csv(3, 'mi-' . bin2hex(random_bytes(3))))->json('data.import_id');
        $firstState = MemberImportSession::load($first, $this->testTenantId, (int) $this->admin->id);

        $this->check($this->csv(3, 'mi-' . bin2hex(random_bytes(3))))->assertOk()->assertJsonPath('data.status', 'ready');

        $this->assertNull(MemberImportSession::load($first, $this->testTenantId, (int) $this->admin->id));
        $this->assertNull(MemberImportSession::rows($firstState));
        $this->batch($first, 0, 10)->assertStatus(404);
    }

    /** Runs a whole import over HTTP; returns the import id. */
    private function runImport(int $n, string $prefix): string
    {
        $id = $this->check($this->csv($n, $prefix))->assertOk()->json('data.import_id');
        $next = 0;
        while ($next < $n) {
            $next = $this->batch($id, $next, 10)->assertOk()->json('data.next_index');
        }

        return $id;
    }

    private function undo(string $id, bool $fresh = true): TestResponse
    {
        return $this->apiPost("/v2/admin/members/import/{$id}/undo", [], $this->headers(null, $fresh));
    }

    public function test_undo_removes_untouched_members_and_keeps_anyone_who_has_acted(): void
    {
        $prefix = 'mi-' . bin2hex(random_bytes(3));
        $id = $this->runImport(5, $prefix);
        $ids = DB::table('users')->where('tenant_id', $this->testTenantId)->where('email', 'like', $prefix . '-%')->orderBy('id')->pluck('id')->all();
        $this->assertCount(5, $ids);

        DB::table('users')->where('id', $ids[0])->update(['last_login_at' => now()]);          // signed in
        DB::table('transactions')->insert([                                                       // has activity
            'tenant_id' => $this->testTenantId, 'sender_id' => $ids[1], 'receiver_id' => $ids[2], 'amount' => 0.1,
            'description' => 't', 'status' => 'completed', 'transaction_type' => 'transfer', 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('users')->where('id', $ids[3])->update(['role' => 'admin', 'is_admin' => 1]);  // not a plain member

        $r = $this->undo($id)->assertOk();
        $this->assertSame(1, $r->json('data.removed'));                      // only ids[4]
        $this->assertSame(['signed_in' => 1, 'has_activity' => 2, 'not_plain_member' => 1], $r->json('data.kept'));

        $gone = DB::table('users')->where('id', $ids[4])->first();
        $this->assertNotNull($gone->anonymized_at ?? $gone->deleted_at ?? null);
        $this->assertStringNotContainsString($prefix, (string) $gone->email, 'the address is freed');
        $this->assertEquals(0, $gone->balance);
        $this->assertSame('cancelled', DB::table('transactions')->where('receiver_id', $ids[4])->value('status'));
        $this->assertTrue($r->json('data.done'));
        $this->assertSame(1, DB::table('org_audit_log')->where('tenant_id', $this->testTenantId)->where('action', 'member_import_undone')->count());

        // Run again: nothing more to remove, the removed member is just counted.
        $again = $this->undo($id)->assertOk();
        $this->assertSame(0, $again->json('data.removed'));
        $this->assertSame(1, $again->json('data.already_removed'));

        // The corrected file can use the freed address.
        $this->assertSame('ready', $this->check(self::HEADER . "Member,4,{$prefix}-4@nexus.test,,,1
")->json('data.status'));
    }

    public function test_undo_works_in_passes_the_browser_repeats_until_done(): void
    {
        $prefix = 'mi-' . bin2hex(random_bytes(3));
        $id = $this->runImport(4, $prefix);
        $undo = app(\App\Services\MemberImport\MemberImportUndo::class);

        // No time at all: exactly one member per pass, and the pass says it is not done.
        $first = $undo->undo($id, $this->testTenantId, (int) $this->admin->id, 0.0);
        $this->assertFalse($first['done']);
        $this->assertSame(3, $first['remaining']);
        $this->assertSame(1, $first['removed']);

        $second = $undo->undo($id, $this->testTenantId, (int) $this->admin->id, 0.0);
        $this->assertFalse($second['done']);
        $this->assertSame(1, $second['already_removed'], 'a member removed by an earlier pass is recognised, not failed');
        $this->assertSame(1, $second['removed']);

        // A pass with a real budget finishes the rest and reports the whole picture.
        $last = $undo->undo($id, $this->testTenantId, (int) $this->admin->id);
        $this->assertTrue($last['done']);
        $this->assertSame(0, $last['remaining']);
        $this->assertSame(2, $last['removed']);
        $this->assertSame(2, $last['already_removed']);
        $this->assertSame(0, DB::table('users')->where('email', 'like', $prefix . '-%')->whereNull('anonymized_at')->count());
        // Every pass is audited; together they are the record of the undo.
        $this->assertSame(3, DB::table('org_audit_log')->where('tenant_id', $this->testTenantId)->where('action', 'member_import_undone')
            ->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(details, '$.import_id')) = ?", [$id])->count());
    }

    public function test_undo_cancels_welcome_emails_that_have_not_gone(): void
    {
        $prefix = 'mi-' . bin2hex(random_bytes(3));
        $id = $this->check($this->csv(3, $prefix))->json('data.import_id');
        $this->batch($id, 0, 10, ['send_invitations' => true])->assertOk();
        $this->assertSame(3, DB::table('member_invitation_outbox')->where('request_key', $id)->where('status', 'pending')->count());

        $this->undo($id)->assertOk()->assertJsonPath('data.removed', 3);

        $this->assertSame(0, DB::table('member_invitation_outbox')->where('request_key', $id)->where('status', 'pending')->count());
        $this->assertSame(3, DB::table('member_invitation_outbox')->where('request_key', $id)->where('skip_reason', 'import_undone')->count());
    }

    public function test_undo_needs_a_fresh_second_factor_and_changes_nothing_without_it(): void
    {
        $prefix = 'mi-' . bin2hex(random_bytes(3));
        $id = $this->runImport(3, $prefix);

        $this->undo($id, false)->assertStatus(403)->assertJsonPath('errors.0.code', 'AUTH_STEP_UP_REQUIRED');
        $this->assertSame(3, DB::table('users')->where('email', 'like', $prefix . '-%')->count());
    }

    public function test_undo_is_refused_while_the_import_is_running_and_allowed_once_stopped(): void
    {
        $prefix = 'mi-' . bin2hex(random_bytes(3));
        $id = $this->check($this->csv(25, $prefix))->json('data.import_id');
        $this->batch($id, 0, 10)->assertOk();                       // running, 10 of 25 written

        $this->undo($id)->assertStatus(409)->assertJsonPath('errors.0.code', 'IMPORT_BUSY');
        $this->assertSame(10, DB::table('users')->where('email', 'like', $prefix . '-%')->count());

        // Stopped: now it can be undone, and what was left to import is gone.
        $this->batch($id, 10, 10, ['stop' => true])->assertOk();
        $this->undo($id)->assertOk()->assertJsonPath('data.removed', 10);
    }

    public function test_checking_the_same_file_again_finishes_an_interrupted_import(): void
    {
        $prefix = 'mi-' . bin2hex(random_bytes(3));
        $csv = $this->csv(25, $prefix);
        $id = $this->check($csv)->json('data.import_id');
        $this->batch($id, 0, 10)->assertOk();                          // 10 of 25 written ...
        $state = MemberImportSession::load($id, $this->testTenantId, (int) $this->admin->id);
        MemberImportSession::discardRows($state);                       // ... then the held rows are lost
        $this->batch($id, 10, 10)->assertStatus(404);

        $again = $this->check($csv)->assertOk();
        $this->assertSame('ready', $again->json('data.status'));
        $this->assertSame(15, $again->json('data.summary.rows'));
        $this->assertSame(10, $again->json('data.summary.already_imported'));
        $this->assertCount(15, $again->json('data.source_rows'));
        $this->assertSame([], $again->json('data.problems'));

        $id2 = $again->json('data.import_id');
        $next = 0;
        while ($next < 15) {
            $next = $this->batch($id2, $next, 10)->assertOk()->json('data.next_index');
        }
        $this->assertSame(25, DB::table('users')->where('tenant_id', $this->testTenantId)->where('email', 'like', $prefix . '-%')->count());

        // Everything is now in: the same file has nothing left to import.
        $done = $this->check($csv)->assertOk();
        $this->assertSame('problems', $done->json('data.status'));
        $this->assertSame('nothing_left_to_import', $done->json('data.problems.0.code'));
    }

    public function test_a_member_from_a_different_file_is_still_already_a_member(): void
    {
        $prefix = 'mi-' . bin2hex(random_bytes(3));
        $this->runImport(3, $prefix);

        $other = $this->check(self::HEADER . "Member,0,{$prefix}-0@nexus.test,,,1
")->assertOk();
        $this->assertSame('problems', $other->json('data.status'));
        $this->assertSame('already_member', $other->json('data.problems.0.code'));
    }

    public function test_a_new_check_leaves_other_admins_and_running_imports_alone(): void
    {
        $other = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active', 'is_approved' => true]);
        $othersImport = $this->check($this->csv(3, 'mi-' . bin2hex(random_bytes(3))), $other)->json('data.import_id');
        $running = $this->check($this->csv(12, 'mi-' . bin2hex(random_bytes(3))))->json('data.import_id');
        $this->batch($running, 0, 10)->assertOk()->assertJsonPath('data.status', 'running');

        $this->check($this->csv(3, 'mi-' . bin2hex(random_bytes(3))))->assertOk()->assertJsonPath('data.status', 'ready');

        $this->assertNotNull(MemberImportSession::load($othersImport, $this->testTenantId, (int) $other->id));
        $this->batch($running, 10, 10)->assertOk()->assertJsonPath('data.status', 'completed');
    }

    public function test_checks_are_limited_to_ten_a_minute(): void
    {
        $csv = $this->csv(1, 'mi-' . bin2hex(random_bytes(3)));
        for ($i = 0; $i < 10; $i++) {
            $this->check($csv)->assertOk();
        }
        $this->check($csv)->assertStatus(429)->assertJsonPath('code', 'RATE_LIMIT_EXCEEDED');

        // Counted per administrator, not per address: another admin is unaffected.
        $other = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active', 'is_approved' => true]);
        $this->check($csv, $other)->assertOk();
    }

    public function test_an_admin_stop_discards_the_held_rows_and_writes_nothing_more(): void
    {
        $prefix = 'mi-' . bin2hex(random_bytes(3));
        $id = $this->check($this->csv(25, $prefix))->json('data.import_id');
        $this->batch($id, 0, 10)->assertOk()->assertJsonPath('data.next_index', 10);

        $r = $this->batch($id, 10, 10, ['stop' => true])->assertOk();
        $this->assertSame('stopped', $r->json('data.status'));
        $this->assertSame(10, $r->json('data.next_index'));
        $this->assertSame(0, $r->json('data.batch.processed'));
        // Row 12 of the file (header + index 10) is the first one not imported.
        $this->assertSame(['row' => 12, 'code' => 'stopped_by_admin', 'params' => []], $r->json('data.stop'));
        $this->assertSame(10, DB::table('users')->where('email', 'like', $prefix . '-%')->count());

        $state = MemberImportSession::load($id, $this->testTenantId, (int) $this->admin->id);
        $this->assertNotNull($state, 'the progress record stays so a replay still answers');
        $this->assertNull(MemberImportSession::rows($state), 'the held member data is discarded at once');

        // Later batches, and a replayed stop, answer with the stopped state and write nothing.
        $this->batch($id, 10, 10)->assertOk()->assertJsonPath('data.status', 'stopped')->assertJsonPath('data.batch.processed', 0);
        $this->batch($id, 10, 10, ['stop' => true])->assertOk()
            ->assertJsonPath('data.status', 'stopped')->assertJsonPath('data.stop.code', 'stopped_by_admin');
        $this->assertSame(10, DB::table('users')->where('email', 'like', $prefix . '-%')->count());
        $this->assertSame(0, $this->completionAudits($id));
    }

    public function test_an_admin_stop_before_the_first_batch_writes_no_one(): void
    {
        $prefix = 'mi-' . bin2hex(random_bytes(3));
        $id = $this->check($this->csv(5, $prefix))->json('data.import_id');

        $r = $this->batch($id, 0, 10, ['stop' => true])->assertOk();
        $this->assertSame('stopped', $r->json('data.status'));
        $this->assertSame(['row' => 2, 'code' => 'stopped_by_admin', 'params' => []], $r->json('data.stop'));
        $this->assertSame(0, DB::table('users')->where('email', 'like', $prefix . '-%')->count());
        $state = MemberImportSession::load($id, $this->testTenantId, (int) $this->admin->id);
        $this->assertNull(MemberImportSession::rows($state));
    }

    public function test_a_stop_must_name_the_next_position(): void
    {
        $id = $this->check($this->csv(12, 'mi-' . bin2hex(random_bytes(3))))->json('data.import_id');
        $this->batch($id, 5, 10, ['stop' => true])->assertStatus(409)->assertJsonPath('errors.0.code', 'IMPORT_OUT_OF_ORDER');

        $state = MemberImportSession::load($id, $this->testTenantId, (int) $this->admin->id);
        $this->assertSame('ready', $state['status']);
        $this->assertNotNull(MemberImportSession::rows($state));
    }

    public function test_a_stop_on_a_completed_import_changes_nothing(): void
    {
        $prefix = 'mi-' . bin2hex(random_bytes(3));
        $id = $this->check($this->csv(12, $prefix))->json('data.import_id');
        $this->batch($id, 0, 200)->assertOk()->assertJsonPath('data.status', 'completed');

        $r = $this->batch($id, 12, 10, ['stop' => true])->assertOk();
        $this->assertSame('completed', $r->json('data.status'));
        $this->assertNull($r->json('data.stop'));
        $this->assertSame(12, $r->json('data.totals.created'));
        $this->assertSame(1, $this->completionAudits($id));
    }

    public function test_another_admin_cannot_stop_the_import(): void
    {
        $id = $this->check($this->csv(3, 'mi-' . bin2hex(random_bytes(3))))->json('data.import_id');
        $other = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active', 'is_approved' => true]);

        $this->batch($id, 0, 10, ['stop' => true], $other)->assertStatus(404)->assertJsonPath('errors.0.code', 'IMPORT_NOT_FOUND');

        $state = MemberImportSession::load($id, $this->testTenantId, (int) $this->admin->id);
        $this->assertSame('ready', $state['status']);
        $this->assertNotNull(MemberImportSession::rows($state), 'the owner can still run it');
    }

    public function test_an_email_taken_mid_import_stops_at_that_row(): void
    {
        $prefix = 'mi-' . bin2hex(random_bytes(3));
        $id = $this->check($this->csv(12, $prefix))->json('data.import_id');
        User::factory()->forTenant($this->testTenantId)->create(['email' => "{$prefix}-4@nexus.test"]);

        $r = $this->batch($id, 0, 10)->assertOk();
        $this->assertSame('stopped', $r->json('data.status'));
        $this->assertSame(4, $r->json('data.next_index'));
        $this->assertSame(['row' => 6, 'code' => 'email_now_taken', 'params' => []], $r->json('data.stop'));

        // A stop is final: the held rows are discarded at once.
        $state = MemberImportSession::load($id, $this->testTenantId, (int) $this->admin->id);
        $this->assertNull(MemberImportSession::rows($state));

        // A stopped import answers without writing anything more.
        $this->batch($id, 4, 10)->assertOk()->assertJsonPath('data.status', 'stopped')->assertJsonPath('data.batch.processed', 0);
        $this->assertSame(5, DB::table('users')->where('email', 'like', $prefix . '-%')->count());
    }

    public function test_the_identity_attestation_counts_only_on_the_first_batch(): void
    {
        $this->requireIdentityCheck();
        $prefix = 'mi-' . bin2hex(random_bytes(3));
        $check = $this->check($this->csv(12, $prefix))->assertOk();
        $this->assertTrue($check->json('data.admission.requires_identity_check'));
        $id = $check->json('data.import_id');

        $this->batch($id, 0, 10)->assertOk()->assertJsonPath('data.held', true);
        // Too late: the first batch already ran held.
        $this->batch($id, 10, 10, ['identity_checked_by_admin' => true])->assertOk()
            ->assertJsonPath('data.status', 'completed')->assertJsonPath('data.held', true);

        $this->assertSame(12, DB::table('users')->where('tenant_id', $this->testTenantId)
            ->where('email', 'like', $prefix . '-%')->where('status', 'pending')->count());
    }

    /** Invitations this import queued, as outbox rows linked by its id. */
    private function invitationsFor(string $importId): int
    {
        return DB::table('member_invitation_outbox')->where('tenant_id', $this->testTenantId)
            ->where('request_key', $importId)->count();
    }

    public function test_a_ready_check_says_how_long_its_invitations_would_take(): void
    {
        $r = $this->check($this->csv(25, 'mi-' . bin2hex(random_bytes(3))))->assertOk();
        $this->assertSame(InvitationOutbox::minutesToSend(25), $r->json('data.invitation_minutes'));
    }

    public function test_invitations_ticked_queue_one_per_new_member_linked_to_the_import(): void
    {
        $prefix = 'mi-' . bin2hex(random_bytes(3));
        $id = $this->check($this->csv(12, $prefix))->json('data.import_id');

        $first = $this->batch($id, 0, 10, ['send_invitations' => true])->assertOk();
        $this->assertSame(10, $first->json('data.totals.invitations_queued'));
        $r = $this->batch($id, 10, 10)->assertOk()->assertJsonPath('data.status', 'completed');

        $this->assertSame(12, $r->json('data.totals.invitations_queued'));
        $this->assertGreaterThanOrEqual(1, $r->json('data.invitations_eta_minutes'));
        $this->assertSame(12, $this->invitationsFor($id));
        $memberIds = DB::table('users')->where('tenant_id', $this->testTenantId)->where('email', 'like', $prefix . '-%')->pluck('id')->map('intval')->sort()->values()->all();
        $queuedIds = DB::table('member_invitation_outbox')->where('request_key', $id)->pluck('user_id')->map('intval')->sort()->values()->all();
        $this->assertSame($memberIds, $queuedIds, 'exactly one invitation per new member');
        $this->assertSame(12, DB::table('member_invitation_outbox')->where('request_key', $id)
            ->where('source', 'import')->where('requested_by', $this->admin->id)->where('status', 'pending')->count());

        $audit = DB::table('org_audit_log')->where('tenant_id', $this->testTenantId)
            ->where('action', MemberImportRunner::ACTION_IMPORT_COMPLETED)
            ->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(details, '$.import_id')) = ?", [$id])->first();
        $this->assertSame(12, json_decode((string) $audit->details, true)['invitations_queued']);
    }

    public function test_invitations_are_off_unless_the_first_batch_asks(): void
    {
        $id = $this->check($this->csv(12, 'mi-' . bin2hex(random_bytes(3))))->json('data.import_id');

        $r = $this->batch($id, 0, 10)->assertOk();
        $this->assertSame(0, $r->json('data.totals.invitations_queued'));
        $this->assertSame(0, $r->json('data.invitations_eta_minutes'));
        // Too late: the import started without invitations.
        $this->batch($id, 10, 10, ['send_invitations' => true])->assertOk()
            ->assertJsonPath('data.status', 'completed')->assertJsonPath('data.totals.invitations_queued', 0);

        $this->assertSame(0, $this->invitationsFor($id));
    }

    public function test_invitations_unticked_queue_nothing(): void
    {
        $id = $this->check($this->csv(5, 'mi-' . bin2hex(random_bytes(3))))->json('data.import_id');

        $this->batch($id, 0, 10, ['send_invitations' => false])->assertOk()
            ->assertJsonPath('data.status', 'completed')->assertJsonPath('data.totals.invitations_queued', 0);
        $this->assertSame(0, $this->invitationsFor($id));
    }

    public function test_members_held_for_an_identity_check_are_not_invited(): void
    {
        $this->requireIdentityCheck();
        $id = $this->check($this->csv(5, 'mi-' . bin2hex(random_bytes(3))))->json('data.import_id');

        $this->batch($id, 0, 10, ['send_invitations' => true])->assertOk()
            ->assertJsonPath('data.status', 'completed')->assertJsonPath('data.held', true)
            ->assertJsonPath('data.totals.invitations_queued', 0);
        $this->assertSame(0, $this->invitationsFor($id));
    }

    public function test_replaying_a_batch_queues_no_second_invitation(): void
    {
        $id = $this->check($this->csv(12, 'mi-' . bin2hex(random_bytes(3))))->json('data.import_id');
        $this->batch($id, 0, 10, ['send_invitations' => true])->assertOk();

        $this->batch($id, 0, 10, ['send_invitations' => true])->assertOk()
            ->assertJsonPath('data.batch.processed', 0)->assertJsonPath('data.totals.invitations_queued', 10);
        $this->assertSame(10, $this->invitationsFor($id));
    }

    public function test_the_template_is_the_header_only(): void
    {
        $response = $this->get('/api/v2/admin/members/import/template', $this->withTenantHeader($this->headers()))->assertOk();
        $this->assertSame("\xEF\xBB\xBF" . "first_name,last_name,email,phone,location,balance\n", (string) $response->getContent());
        $this->assertStringContainsString('member_import_template.csv', (string) $response->headers->get('Content-Disposition'));
        $this->assertStringStartsWith('text/csv', (string) $response->headers->get('Content-Type'));
    }

    public function test_the_old_endpoint_is_gone(): void
    {
        $status = $this->apiPost('/v2/admin/users/import', [], $this->headers())->status();
        $this->assertContains($status, [404, 405]);
        $status = $this->apiGet('/v2/admin/users/import/template', $this->headers())->status();
        $this->assertContains($status, [404, 405]);
    }
}
