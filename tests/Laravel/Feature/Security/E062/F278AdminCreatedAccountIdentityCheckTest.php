<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E062;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\CaringCommunity\PaperOnboardingIntakeService;
use App\Services\Identity\RegistrationOrchestrationService;
use App\Services\TenantSettingsService;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-278 (E-062) — every administrator-side account-creation path (single
 * create, CSV import, Caring assisted onboarding, paper onboarding,
 * super-admin create) created a live account whatever the community's joining
 * rules said. Owner decision, 29 Sep 2026:
 *
 *  - an administrator-created account is approved immediately;
 *  - where the community requires an identity check (verified_identity /
 *    government_id) it must still pass that check, unless the administrator
 *    explicitly attests they checked the person's identity themselves — and
 *    that attestation is recorded (who, when) in the audit log;
 *  - a CSV import creates ordinary members only;
 *  - every other mode keeps "active immediately".
 *
 * The CSV-import tests moved to /v2/admin/members/import on 8 Oct 2026 when
 * the old endpoint was replaced.
 */
class F278AdminCreatedAccountIdentityCheckTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
    }

    // ------------------------------------------------------------ fixtures

    private function setMode(string $mode, ?string $provider = 'f278_test_idp', string $postVerification = 'admin_approval'): void
    {
        foreach (['general.registration_mode', 'registration_mode'] as $key) {
            DB::table('tenant_settings')->updateOrInsert(
                ['tenant_id' => $this->testTenantId, 'setting_key' => $key],
                ['setting_value' => 'open', 'setting_type' => 'string', 'updated_at' => now()]
            );
        }
        $identity = in_array($mode, ['verified_identity', 'government_id'], true);
        DB::table('tenant_registration_policies')->updateOrInsert(
            ['tenant_id' => $this->testTenantId],
            [
                'registration_mode' => $mode,
                'verification_provider' => $identity ? $provider : null,
                'verification_level' => $identity ? 'document_only' : 'none',
                'post_verification' => $postVerification,
                'fallback_mode' => 'none',
                'require_email_verify' => 0,
                'provider_config' => null,
                'is_active' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);
        TenantContext::setById($this->testTenantId);
    }

    private function admin(): User
    {
        $admin = User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'admin', 'status' => 'active', 'is_approved' => 1,
        ]);
        Sanctum::actingAs($admin);

        return $admin;
    }

    private function email(string $tag): string
    {
        return 'f278-' . $tag . '-' . bin2hex(random_bytes(5)) . '@example.test';
    }

    /** @return array<string,mixed> */
    private function row(string $email): array
    {
        $r = DB::table('users')->where('tenant_id', $this->testTenantId)->where('email', $email)->first();
        $this->assertNotNull($r, "precondition: an account was created for {$email}");

        return (array) $r;
    }

    private function assertHeldForIdentity(string $email): void
    {
        $row = $this->row($email);
        $this->assertSame(1, (int) $row['is_approved'], 'an administrator-created account is approved immediately');
        $this->assertSame('pending', (string) $row['status'], 'it must not be live before the identity check');
        $this->assertSame('pending', (string) $row['verification_status'], 'the identity check must be outstanding');
        $this->assertNotNull(
            app(TenantSettingsService::class)->checkLoginGatesForUser($row),
            'a held account must not be able to sign in'
        );
    }

    private function assertLive(string $email): void
    {
        $row = $this->row($email);
        $this->assertSame('active', (string) $row['status']);
        $this->assertSame(1, (int) $row['is_approved']);
        $this->assertNotSame('pending', (string) $row['verification_status']);
    }

    private function assertAttestationRecorded(int $adminId, string $email, string $source): void
    {
        $userId = (int) $this->row($email)['id'];
        $audit = DB::table('org_audit_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('action', 'admin_identity_attested')
            ->where('user_id', $adminId)
            ->where('target_user_id', $userId)
            ->first();
        $this->assertNotNull($audit, 'the attestation must be in the audit log');
        $details = json_decode((string) $audit->details, true);
        $this->assertSame($source, $details['source'] ?? null);
        $this->assertSame($adminId, $details['attested_by'] ?? null, 'who attested');
        $this->assertNotEmpty($details['attested_at'] ?? null, 'when they attested');
    }

    private function storeUser(string $email, array $extra = []): \Illuminate\Testing\TestResponse
    {
        return $this->apiPost('/v2/admin/users', array_merge([
            'first_name' => 'F278', 'last_name' => 'Created', 'email' => $email,
            'password' => 'Str0ng-F278-passphrase!', 'role' => 'member',
        ], $extra));
    }

    /** The member import asks for a recently entered second factor (step-up). @return array<string,string> */
    private function freshSecondFactor(User $admin): array
    {
        return ['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, TwoFactorPolicy::claims('totp')
        )];
    }

    private function checkCsv(User $admin, string $csv, array $fields = []): \Illuminate\Testing\TestResponse
    {
        return $this->apiPost('/v2/admin/members/import/check', $fields + [
            'file_name' => 'members.csv', 'content_base64' => base64_encode($csv),
        ], $this->freshSecondFactor($admin));
    }

    /**
     * Checks the file (it must be ready) and runs every batch; $firstBatch is
     * sent with the first one. Returns the last batch.
     */
    private function importCsv(User $admin, string $csv, array $firstBatch = []): \Illuminate\Testing\TestResponse
    {
        $id = (string) $this->checkCsv($admin, $csv)->assertStatus(200)->assertJsonPath('data.status', 'ready')->json('data.import_id');
        $next = 0;
        $extra = $firstBatch;
        do {
            $res = $this->apiPost("/v2/admin/members/import/{$id}/batch", ['from' => $next, 'count' => 50] + $extra, $this->freshSecondFactor($admin))->assertStatus(200);
            $next = (int) $res->json('data.next_index');
            $extra = [];
        } while ($res->json('data.status') === 'running');

        return $res->assertJsonPath('data.status', 'completed');
    }

    private function enableCaringCommunity(): void
    {
        $tenant = DB::table('tenants')->where('id', $this->testTenantId)->first();
        $features = [];
        if ($tenant && !empty($tenant->features)) {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : $tenant->features;
            $features = is_array($decoded) ? $decoded : [];
        }
        $features['caring_community'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);
    }

    // ------------------------------------------------- single create (store)

    public function test_admin_create_in_an_identity_community_is_approved_but_held_for_the_check(): void
    {
        $this->setMode('government_id');
        $this->admin();
        $email = $this->email('store-held');

        $this->storeUser($email)->assertStatus(201);

        $this->assertHeldForIdentity($email);
    }

    public function test_admin_create_with_an_attestation_is_live_and_the_attestation_is_audited(): void
    {
        $this->setMode('verified_identity');
        $admin = $this->admin();
        $email = $this->email('store-attested');

        $this->storeUser($email, ['identity_checked_by_admin' => true])->assertStatus(201);

        $this->assertLive($email);
        $this->assertAttestationRecorded((int) $admin->id, $email, 'admin_create');
    }

    public function test_control_admin_create_in_an_approval_community_is_live_without_any_attestation(): void
    {
        $this->setMode('open_with_approval');
        $this->admin();
        $email = $this->email('store-approval');

        $this->storeUser($email)->assertStatus(201);

        $this->assertLive($email);
        $this->assertSame(
            0,
            DB::table('org_audit_log')->where('tenant_id', $this->testTenantId)->where('action', 'admin_identity_attested')->count(),
            'no attestation is recorded where no identity check is required'
        );
    }

    // ------------------------------------------------------------ CSV import

    /** Moved to /v2/admin/members/import on 8 Oct 2026 when the old endpoint was replaced. */
    public function test_csv_import_in_an_identity_community_holds_every_row_for_the_check(): void
    {
        $this->setMode('government_id');
        $admin = $this->admin();
        $a = $this->email('csv-a');
        $b = $this->email('csv-b');
        $csv = "first_name,last_name,email,phone,location,balance\nF278,Alpha,{$a},,,\nF278,Beta,{$b},,,\n";

        $this->checkCsv($admin, $csv)->assertJsonPath('data.admission.requires_identity_check', true);
        $this->importCsv($admin, $csv)->assertJsonPath('data.totals.created', 2)->assertJsonPath('data.held', true);

        $this->assertHeldForIdentity($a);
        $this->assertHeldForIdentity($b);
    }

    /** Moved to /v2/admin/members/import on 8 Oct 2026 when the old endpoint was replaced. */
    public function test_csv_import_with_an_attestation_is_live_and_audited_per_account(): void
    {
        $this->setMode('government_id');
        $admin = $this->admin();
        $a = $this->email('csv-attested');
        $csv = "first_name,last_name,email,phone,location,balance\nF278,Attested,{$a},,,\n";

        // The attestation is given once, with the first batch.
        $this->importCsv($admin, $csv, ['identity_checked_by_admin' => '1'])
            ->assertJsonPath('data.totals.created', 1)->assertJsonPath('data.held', false);

        $this->assertLive($a);
        $this->assertAttestationRecorded((int) $admin->id, $a, 'csv_import');
    }

    /** Moved to /v2/admin/members/import on 8 Oct 2026 when the old endpoint was replaced. */
    public function test_csv_import_creates_ordinary_members_only(): void
    {
        $this->setMode('open');
        $admin = $this->admin();
        $one = $this->email('csv-member-1');
        $two = $this->email('csv-member-2');
        $csv = "first_name,last_name,email,phone,location,balance\nF278,One,{$one},,,\nF278,Two,{$two},,,\n";

        // A role asked for in the request is not an input the import reads.
        $id = (string) $this->checkCsv($admin, $csv, ['role' => 'admin', 'default_role' => 'broker'])
            ->assertStatus(200)->assertJsonPath('data.status', 'ready')->json('data.import_id');
        $this->apiPost("/v2/admin/members/import/{$id}/batch", [
            'from' => 0, 'count' => 10, 'role' => 'admin', 'default_role' => 'broker',
        ], $this->freshSecondFactor($admin))->assertStatus(200)->assertJsonPath('data.status', 'completed');

        foreach ([$one, $two] as $email) {
            $this->assertLive($email);
            $this->assertSame('member', (string) $this->row($email)['role'], 'an import creates ordinary members only');
        }
    }

    /**
     * Replaces test_csv_import_refuses_a_non_member_default_role: the new
     * import has no default role, and a file with the old template's role
     * column is refused whole, so no row can ask for a staff role.
     *
     * Moved to /v2/admin/members/import on 8 Oct 2026 when the old endpoint was replaced.
     */
    public function test_csv_import_refuses_a_role_column(): void
    {
        $this->setMode('open');
        $admin = $this->admin();
        $member = $this->email('csv-member');
        $asAdmin = $this->email('csv-admin');
        $asBroker = $this->email('csv-broker');

        $res = $this->checkCsv($admin,
            "first_name,last_name,email,phone,role\n"
            . "F278,Member,{$member},,member\n"
            . "F278,Admin,{$asAdmin},,admin\n"
            . "F278,Broker,{$asBroker},,broker\n"
        )->assertStatus(200);

        $res->assertJsonPath('data.status', 'file_error')->assertJsonPath('data.file_error.code', 'old_template');
        $this->assertNull($res->json('data.import_id'), 'a refused file cannot be imported');
        $this->assertFalse(
            DB::table('users')->where('tenant_id', $this->testTenantId)->whereIn('email', [$member, $asAdmin, $asBroker])->exists(),
            'nothing is imported from a file that names roles'
        );
    }

    // --------------------------------------------- Caring assisted onboarding

    public function test_assisted_onboarding_holds_for_the_check_unless_attested(): void
    {
        $this->setMode('government_id');
        $this->enableCaringCommunity();
        $admin = $this->admin();

        $held = $this->email('assisted-held');
        $this->apiPost('/v2/admin/caring-community/assisted-onboarding', [
            'name' => 'F278 Assisted', 'email' => $held,
        ])->assertStatus(201);
        $this->assertHeldForIdentity($held);

        $attested = $this->email('assisted-attested');
        $this->apiPost('/v2/admin/caring-community/assisted-onboarding', [
            'name' => 'F278 Assisted', 'email' => $attested, 'identity_checked_by_admin' => true,
        ])->assertStatus(201);
        $this->assertLive($attested);
        $this->assertAttestationRecorded((int) $admin->id, $attested, 'assisted_onboarding');
    }

    // ------------------------------------------------------ paper onboarding

    private function intake(int $uploaderId): int
    {
        return (int) DB::table('caring_paper_onboarding_intakes')->insertGetId([
            'tenant_id' => $this->testTenantId, 'uploaded_by' => $uploaderId, 'status' => 'pending_review',
            'original_filename' => 'f278.pdf', 'stored_path' => 'caring-paper-onboarding/2/f278.pdf',
            'ocr_provider' => 'manual_review_stub', 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    public function test_paper_onboarding_holds_for_the_check_unless_attested(): void
    {
        $this->setMode('verified_identity');
        $admin = $this->admin();
        $service = app(PaperOnboardingIntakeService::class);

        $held = $this->email('paper-held');
        $result = $service->confirm($this->testTenantId, $this->intake((int) $admin->id), (int) $admin->id, [
            'name' => 'F278 Paper', 'email' => $held,
        ]);
        $this->assertTrue($result['success'] ?? false);
        $this->assertHeldForIdentity($held);

        $attested = $this->email('paper-attested');
        $result = $service->confirm($this->testTenantId, $this->intake((int) $admin->id), (int) $admin->id, [
            'name' => 'F278 Paper', 'email' => $attested, 'identity_checked_by_admin' => true,
        ]);
        $this->assertTrue($result['success'] ?? false);
        $this->assertLive($attested);
        $this->assertAttestationRecorded((int) $admin->id, $attested, 'paper_onboarding');
    }

    // --------------------------------------------------- super-admin create

    private function superAdmin(): User
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        DB::table('users')->where('id', $admin->id)->update(['is_super_admin' => 1, 'is_tenant_super_admin' => 1]);
        $path = DB::table('tenants')->where('id', $this->testTenantId)->value('path');
        if (trim((string) $path) === '') {
            DB::table('tenants')->where('id', $this->testTenantId)->update(['path' => '/' . $this->testTenantId . '/']);
        }
        $admin->refresh();
        Sanctum::actingAs($admin);

        return $admin;
    }

    public function test_super_admin_create_holds_for_the_check_unless_attested(): void
    {
        $this->setMode('government_id');
        $super = $this->superAdmin();

        $held = $this->email('super-held');
        $this->apiPost('/v2/admin/super/users', [
            'tenant_id' => $this->testTenantId, 'first_name' => 'F278', 'last_name' => 'Super',
            'email' => $held, 'password' => 'Str0ng-F278-passphrase!', 'role' => 'member',
        ])->assertStatus(201);
        $this->assertHeldForIdentity($held);

        $attested = $this->email('super-attested');
        $this->apiPost('/v2/admin/super/users', [
            'tenant_id' => $this->testTenantId, 'first_name' => 'F278', 'last_name' => 'Super',
            'email' => $attested, 'password' => 'Str0ng-F278-passphrase!', 'role' => 'member',
            'identity_checked_by_admin' => true,
        ])->assertStatus(201);
        $this->assertLive($attested);
        $this->assertAttestationRecorded((int) $super->id, $attested, 'super_admin_create');
    }

    // ------------------------------------------- passing the identity check

    public function test_a_held_admin_created_account_goes_live_when_the_identity_check_passes(): void
    {
        $this->setMode('government_id', 'f278_test_idp', 'admin_approval');
        $this->admin();
        $email = $this->email('store-passes');
        $this->storeUser($email)->assertStatus(201);
        $this->assertHeldForIdentity($email);
        $userId = (int) $this->row($email)['id'];
        DB::table('users')->where('id', $userId)->update(['email_verified_at' => now()]);

        RegistrationOrchestrationService::applyPostVerificationAction($userId, $this->testTenantId, 'passed');

        $row = $this->row($email);
        $this->assertSame('active', (string) $row['status'], 'the administrator already approved it; the check was the only thing outstanding');
        $this->assertSame('passed', (string) $row['verification_status']);
    }

    public function test_control_a_self_registered_account_still_waits_for_an_admin_after_the_check(): void
    {
        $this->setMode('government_id', 'f278_test_idp', 'admin_approval');
        $self = User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'member', 'status' => 'pending', 'is_approved' => 0,
            'verification_status' => 'pending', 'email_verified_at' => now(),
        ]);

        RegistrationOrchestrationService::applyPostVerificationAction((int) $self->id, $this->testTenantId, 'passed');

        $row = (array) DB::table('users')->where('id', $self->id)->first(['status', 'is_approved']);
        $this->assertSame('pending', (string) $row['status'], 'post_verification=admin_approval still holds a self-registered account');
        $this->assertSame(0, (int) $row['is_approved']);
    }
}
