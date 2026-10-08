<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\MemberImport;

use App\Core\TenantContext;
use App\Models\User;
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

    public function test_an_email_taken_mid_import_stops_at_that_row(): void
    {
        $prefix = 'mi-' . bin2hex(random_bytes(3));
        $id = $this->check($this->csv(12, $prefix))->json('data.import_id');
        User::factory()->forTenant($this->testTenantId)->create(['email' => "{$prefix}-4@nexus.test"]);

        $r = $this->batch($id, 0, 10)->assertOk();
        $this->assertSame('stopped', $r->json('data.status'));
        $this->assertSame(4, $r->json('data.next_index'));
        $this->assertSame(['row' => 6, 'code' => 'email_now_taken', 'params' => []], $r->json('data.stop'));

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
