<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E065;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-349 (E-065) — the same missing allowlist and the same NULL-scope hole,
 * reaching two further route families that slice D did not name:
 *
 *   - `VereinFederationAdminController::canAdministerVerein()` — 6 routes that
 *     strip `EnsureIsAdmin` (routes/api.php:2118-2129);
 *   - `VereinDuesAuthorizationService::canManageDues()` — 7 routes in a plain
 *     `auth:sanctum` group (routes/api.php:3095-3101), which accepted ANY of
 *     three permission slugs.
 *
 * `GET /v2/vereine/{org}/dues` returns every member's email address, name and
 * payment status (`VereinDuesService::listDues`). One save in the roles editor
 * handed that register — for every club — to a `role=member` account.
 *
 * Adapted from the E-065 slice-J reproduction
 * `.local-docs-archive/security-log/E-065/repro/j/VereinManageGrantScopeTest.php`,
 * which asserted the BAD outcome. The attack assertions are inverted.
 */
final class F349VereinManageGrantScopeTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT = 2;

    private int $attackerId = 0;
    private int $victimId = 0;
    private int $clubGrantedId = 0;
    private int $clubOtherId = 0;
    private int $roleId = 0;
    private int $permissionId = 0;
    private string $victimEmail = '';

    protected function setUp(): void
    {
        parent::setUp();

        // No schema guard here on purpose. Every table and column this test
        // touches is in the committed schema dump, so a guard could never fire
        // in CI and would only hide a broken fixture locally — which is what the
        // pre-commit schema-skip budget exists to prevent.

        $this->enableCaringCommunity();
        TenantContext::setById(self::TENANT);

        $this->attackerId = $this->makeMember('f349.attacker');
        $this->victimId = $this->makeMember('f349.victim');
        $this->victimEmail = (string) DB::table('users')->where('id', $this->victimId)->value('email');

        $this->clubGrantedId = $this->makeClub('F349 Granted Club');
        $this->clubOtherId = $this->makeClub('F349 Other Club');

        foreach ([$this->clubGrantedId, $this->clubOtherId] as $clubId) {
            DB::table('verein_member_dues')->insert([
                'organization_id' => $clubId,
                'tenant_id' => self::TENANT,
                'user_id' => $this->victimId,
                'membership_year' => (int) date('Y'),
                'amount_cents' => 5000,
                'currency' => 'CHF',
                'status' => 'pending',
                'due_date' => date('Y') . '-12-31',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        $this->permissionId = (int) DB::table('permissions')->insertGetId([
            'name' => 'verein.members.manage',
            'display_name' => 'Manage Verein Members',
            'category' => 'vereine',
            'tenant_id' => null,
        ]);

        $this->roleId = (int) DB::table('roles')->insertGetId([
            'name' => 'f349_role_' . bin2hex(random_bytes(4)),
            'display_name' => 'F349 community role',
            'level' => 10,
            'is_system' => 0,
            'tenant_id' => self::TENANT,
        ]);
    }

    /**
     * The roles editor must refuse `verein.members.manage`, so one admin save
     * cannot hand the dues register to a plain member.
     */
    public function test_rbac_role_save_cannot_attach_verein_members_manage(): void
    {
        $this->grantRole(tenantId: self::TENANT, scopeOrgId: null);

        $adminId = $this->makeAdmin();
        Sanctum::actingAs(User::find($adminId));
        $save = $this->putJson(
            '/api/v2/admin/enterprise/roles/' . $this->roleId,
            ['permissions' => ['verein.members.manage']],
            $this->withTenantHeader()
        );

        $this->assertSame(
            422,
            $save->getStatusCode(),
            'BAD OUTCOME: the RBAC editor accepted a permission outside its own published '
            . 'catalogue. Body: ' . $save->getContent()
        );

        Sanctum::actingAs(User::find($this->attackerId));
        $response = $this->getJson(
            '/api/v2/vereine/' . $this->clubOtherId . '/dues',
            $this->withTenantHeader()
        );

        $this->assertSame(
            403,
            $response->getStatusCode(),
            'BAD OUTCOME: a role=member account read a club dues register. Body: '
            . $response->getContent()
        );
        $this->assertStringNotContainsString($this->victimEmail, $response->getContent());
    }

    /**
     * Even with the permission attached directly, a grant naming no organisation
     * must not reach any club's dues register.
     */
    public function test_unscoped_grant_reaches_no_club_dues_register(): void
    {
        $this->attachPermissionToRole();
        $this->grantRole(tenantId: self::TENANT, scopeOrgId: null);

        Sanctum::actingAs(User::find($this->attackerId));

        foreach ([$this->clubGrantedId, $this->clubOtherId] as $clubId) {
            $response = $this->getJson(
                '/api/v2/vereine/' . $clubId . '/dues',
                $this->withTenantHeader()
            );

            $this->assertSame(
                403,
                $response->getStatusCode(),
                'BAD OUTCOME: an unscoped grant read the dues register of club ' . $clubId . '.'
            );
            $this->assertStringNotContainsString($this->victimEmail, $response->getContent());
        }
    }

    /**
     * The same unscoped grant must not change any club's federation sharing
     * consent — the setting that decides whether the club's events and member
     * invitations leave the club at all.
     */
    public function test_unscoped_grant_cannot_change_federation_consent(): void
    {
        $this->attachPermissionToRole();
        $this->grantRole(tenantId: self::TENANT, scopeOrgId: null);

        Sanctum::actingAs(User::find($this->attackerId));
        $response = $this->putJson(
            '/api/v2/vereine/' . $this->clubGrantedId . '/federation-consent',
            ['sharing_scope' => 'both', 'municipality_code' => 'F349'],
            $this->withTenantHeader()
        );

        $this->assertSame(403, $response->getStatusCode());
        $this->assertNull(
            DB::table('verein_federation_consents')
                ->where('tenant_id', self::TENANT)
                ->where('organization_id', $this->clubGrantedId)
                ->first(),
            'BAD OUTCOME: an unscoped grant wrote a federation consent row.'
        );
    }

    /**
     * CONTROL — the legitimate organisation-scoped grant (the shape the
     * admin-gated `assignVereinAdmin` endpoint writes) still reads its own
     * club's dues register.
     */
    public function test_control_concrete_scope_still_reads_its_own_club_register(): void
    {
        $this->attachPermissionToRole();
        $this->grantRole(tenantId: self::TENANT, scopeOrgId: $this->clubGrantedId);

        Sanctum::actingAs(User::find($this->attackerId));
        $response = $this->getJson(
            '/api/v2/vereine/' . $this->clubGrantedId . '/dues',
            $this->withTenantHeader()
        );

        $this->assertSame(
            200,
            $response->getStatusCode(),
            'CONTROL: a grant naming this club must still work. Body: ' . $response->getContent()
        );
    }

    /**
     * CONTROL — the same concrete grant still does NOT reach another club.
     */
    public function test_control_concrete_scope_does_not_reach_another_club(): void
    {
        $this->attachPermissionToRole();
        $this->grantRole(tenantId: self::TENANT, scopeOrgId: $this->clubGrantedId);

        Sanctum::actingAs(User::find($this->attackerId));
        $response = $this->getJson(
            '/api/v2/vereine/' . $this->clubOtherId . '/dues',
            $this->withTenantHeader()
        );

        $this->assertSame(403, $response->getStatusCode());
        $this->assertStringNotContainsString($this->victimEmail, $response->getContent());
    }

    /**
     * CONTROL — a member with no grant at all is refused both surfaces.
     */
    public function test_control_member_without_the_grant_is_refused(): void
    {
        Sanctum::actingAs(User::find($this->attackerId));

        $this->assertSame(
            403,
            $this->getJson('/api/v2/vereine/' . $this->clubOtherId . '/dues', $this->withTenantHeader())
                ->getStatusCode()
        );
        $this->assertSame(
            403,
            $this->putJson(
                '/api/v2/vereine/' . $this->clubGrantedId . '/federation-consent',
                ['sharing_scope' => 'both', 'municipality_code' => 'F349'],
                $this->withTenantHeader()
            )->getStatusCode()
        );
    }

    // ── fixtures ───────────────────────────────────────────────────────────

    private function attachPermissionToRole(): void
    {
        DB::table('role_permissions')->insert([
            'role_id' => $this->roleId,
            'permission_id' => $this->permissionId,
            'tenant_id' => self::TENANT,
        ]);
    }

    private function makeAdmin(): int
    {
        $id = $this->makeMember('f349.rbacadmin');
        DB::table('users')->where('id', $id)->update(['role' => 'admin', 'is_admin' => 1]);

        return $id;
    }

    private function grantRole(?int $tenantId, ?int $scopeOrgId): void
    {
        DB::table('user_roles')->insert([
            'user_id' => $this->attackerId,
            'role_id' => $this->roleId,
            'tenant_id' => $tenantId,
            'scope_organization_id' => $scopeOrgId,
            'assigned_by' => null,
            'expires_at' => null,
        ]);
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
            'name' => 'F349 Member',
            'first_name' => 'F349',
            'last_name' => 'Member',
            'email' => $email,
            'username' => 'f349_' . substr(md5($email), 0, 10),
            'password' => password_hash('password', PASSWORD_BCRYPT),
            'role' => 'member',
            'status' => 'active',
            'is_approved' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function makeClub(string $name): int
    {
        return (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => self::TENANT,
            'user_id' => $this->attackerId,
            'name' => $name . ' ' . bin2hex(random_bytes(3)),
            'org_type' => 'club',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
