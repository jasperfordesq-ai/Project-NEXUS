<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E067;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\TenantSettingsService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-382 (E-067) — the club (Verein) member import was the sixth account-creation
 * path the F-278 fix (8c295fdfb) did not convert. It consulted only the
 * admin-approval switch, so in a community whose joining rules require an
 * identity check it created LIVE accounts that never started the check. A
 * plain member holding the scoped club-import grant could do it.
 *
 * Imported accounts now follow the same AdminCreatedAccountAdmission rule as
 * the other five paths: in an identity-check community they are held and the
 * check is started. A club organiser cannot attest identity (that is the
 * community administrator's decision), so there is no attested variant here.
 *
 * Adapted from `.local-docs-archive/security-log/E-067/repro/b/VereinImportSkipsIdentityCheckTest.php`,
 * which asserted the bad outcome; the attack assertions are inverted.
 */
final class F382VereinImportIdentityCheckTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT = 2;

    private int $clubAdminId = 0;
    private int $clubId = 0;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);

        $this->enableCaringCommunity();
        $this->clubAdminId = $this->makeMember('f382.clubadmin');
        $this->clubId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => self::TENANT,
            'user_id' => $this->clubAdminId,
            'name' => 'F382 Club ' . bin2hex(random_bytes(3)),
            'org_type' => 'club',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // The legitimate grant written by assignVereinAdmin(): concrete tenant and club.
        $permId = (int) (DB::table('permissions')->where('name', 'verein.members.import')->value('id')
            ?: DB::table('permissions')->insertGetId([
                'name' => 'verein.members.import',
                'display_name' => 'Import Verein Members',
                'category' => 'vereine',
                'tenant_id' => null,
            ]));
        $roleId = (int) DB::table('roles')->insertGetId([
            'name' => 'f382_club_role_' . bin2hex(random_bytes(4)),
            'display_name' => 'F382 club role',
            'level' => 10,
            'is_system' => 0,
            'tenant_id' => self::TENANT,
        ]);
        DB::table('role_permissions')->insert([
            'role_id' => $roleId, 'permission_id' => $permId, 'tenant_id' => self::TENANT,
        ]);
        DB::table('user_roles')->insert([
            'user_id' => $this->clubAdminId,
            'role_id' => $roleId,
            'tenant_id' => self::TENANT,
            'scope_organization_id' => $this->clubId,
        ]);
    }

    public function test_club_import_in_an_identity_check_community_holds_the_account_for_the_check(): void
    {
        $this->setPolicy('verified_identity', adminApproval: false);

        $row = $this->importOne('f382.vimp');

        $this->assertSame('pending', (string) $row['status'], 'the imported account is held, not live');
        $this->assertSame('pending', (string) ($row['verification_status'] ?? ''), 'the identity check has been started');

        $row['email_verified_at'] = now()->toDateTimeString();
        $this->assertNotNull(
            app(TenantSettingsService::class)->checkLoginGatesForUser($row),
            'the imported account cannot sign in before the identity check'
        );
    }

    public function test_with_admin_approval_on_the_identity_check_is_still_started(): void
    {
        $this->setPolicy('government_id', adminApproval: true);

        $row = $this->importOne('f382.appr');

        $this->assertSame('pending', (string) $row['status']);
        $this->assertSame(0, (int) $row['is_approved'], 'the admin-approval rule still applies');
        $this->assertSame('pending', (string) ($row['verification_status'] ?? ''), 'approving it later cannot skip the check');
    }

    public function test_control_club_import_in_an_open_community_is_live(): void
    {
        $this->setPolicy('open', adminApproval: false);

        $row = $this->importOne('f382.open');

        $this->assertSame('active', (string) $row['status']);
        $this->assertSame(1, (int) $row['is_approved']);
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    /** @return array<string,mixed> */
    private function importOne(string $prefix): array
    {
        Sanctum::actingAs(User::find($this->clubAdminId));
        $email = $prefix . '.' . bin2hex(random_bytes(5)) . '@example.test';
        $res = $this->postJson(
            '/api/v2/caring-community/vereine/' . $this->clubId . '/members/import',
            ['csv' => "email,first_name,last_name\n{$email},Imported,Member\n"],
            ['X-Tenant-ID' => (string) self::TENANT]
        );
        $this->assertSame(201, $res->getStatusCode(), $res->getContent());

        $row = (array) DB::table('users')->where('tenant_id', self::TENANT)->where('email', $email)->first();
        $this->assertNotEmpty($row, 'precondition: the import created the account');

        return $row;
    }

    private function setPolicy(string $mode, bool $adminApproval): void
    {
        foreach (['admin_approval', 'general.admin_approval'] as $key) {
            DB::table('tenant_settings')->updateOrInsert(
                ['tenant_id' => self::TENANT, 'setting_key' => $key],
                ['setting_value' => $adminApproval ? 'true' : 'false', 'setting_type' => 'boolean', 'updated_at' => now()]
            );
        }
        foreach (['general.registration_mode', 'registration_mode'] as $key) {
            DB::table('tenant_settings')->updateOrInsert(
                ['tenant_id' => self::TENANT, 'setting_key' => $key],
                ['setting_value' => 'open', 'setting_type' => 'string', 'updated_at' => now()]
            );
        }
        $identity = in_array($mode, ['verified_identity', 'government_id'], true);
        DB::table('tenant_registration_policies')->where('tenant_id', self::TENANT)->delete();
        DB::table('tenant_registration_policies')->insert([
            'tenant_id' => self::TENANT,
            'registration_mode' => $mode,
            'verification_provider' => $identity ? 'f382_test_idp' : null,
            'verification_level' => $identity ? 'document_only' : 'none',
            'post_verification' => 'activate',
            'fallback_mode' => 'none',
            'require_email_verify' => 0,
            'provider_config' => null,
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        app(TenantSettingsService::class)->clearCacheForTenant(self::TENANT);
        TenantContext::reset();
        TenantContext::setById(self::TENANT);
    }

    private function enableCaringCommunity(): void
    {
        $tenant = DB::table('tenants')->where('id', self::TENANT)->first();
        $features = [];
        if ($tenant && ! empty($tenant->features)) {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : $tenant->features;
            $features = is_array($decoded) ? $decoded : [];
        }
        $features['caring_community'] = true;
        DB::table('tenants')->where('id', self::TENANT)->update(['features' => json_encode($features)]);
        TenantContext::reset();
        TenantContext::setById(self::TENANT);
    }

    private function makeMember(string $prefix): int
    {
        $email = $prefix . '.' . bin2hex(random_bytes(5)) . '@example.test';

        return (int) DB::table('users')->insertGetId([
            'tenant_id' => self::TENANT,
            'name' => 'F382 Member',
            'first_name' => 'F382',
            'last_name' => 'Member',
            'email' => $email,
            'username' => 'f382_' . substr(md5($email), 0, 10),
            'password' => password_hash('password', PASSWORD_BCRYPT),
            'role' => 'member',
            'status' => 'active',
            'is_approved' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
