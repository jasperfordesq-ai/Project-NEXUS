<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Verein;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

class MyDuesControllerTest extends TestCase
{
    use DatabaseTransactions;

    private int $organizationId;
    private int $otherOrganizationId;
    private User $subject;

    protected function setUp(): void
    {
        parent::setUp();

        $this->setCaringCommunityFeature(true);
        $this->organizationId = $this->makeOrganization('F-050 primary Verein');
        $this->otherOrganizationId = $this->makeOrganization('F-050 other Verein');
        $this->subject = User::factory()->forTenant($this->testTenantId)->create();

        $this->insertDue($this->organizationId, (int) date('Y'), 'paid', 7250, '2026-02-15');
        $this->insertDue($this->organizationId, (int) date('Y') - 1, 'overdue', 6400, null);
        $this->insertDue($this->otherOrganizationId, (int) date('Y'), 'paid', 9900, '2026-03-01');
    }

    public function test_unrelated_member_receives_only_current_badge_projection(): void
    {
        $viewer = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($viewer);

        $response = $this->membershipStatus($this->subject->id, $this->organizationId);

        $response->assertOk()
            ->assertJsonPath('data.user_id', $this->subject->id)
            ->assertJsonPath('data.organization_id', $this->organizationId)
            ->assertJsonPath('data.current.status', 'paid')
            ->assertJsonPath('data.is_current_member', true)
            ->assertJsonMissingPath('data.history')
            ->assertJsonMissingPath('data.current.amount_cents')
            ->assertJsonMissingPath('data.current.currency')
            ->assertJsonMissingPath('data.current.due_date')
            ->assertJsonMissingPath('data.current.paid_at');
    }

    public function test_subject_retains_full_current_record_and_history(): void
    {
        Sanctum::actingAs($this->subject);

        $response = $this->membershipStatus($this->subject->id, $this->organizationId);

        $response->assertOk()
            ->assertJsonPath('data.current.amount_cents', 7250)
            ->assertJsonPath('data.current.currency', 'CHF')
            ->assertJsonPath('data.history.' . ((int) date('Y') - 1) . '.amount_cents', 6400)
            ->assertJsonPath('data.history.' . ((int) date('Y') - 1) . '.status', 'overdue');
    }

    public function test_tenant_admin_retains_full_current_record_and_history(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->membershipStatus($this->subject->id, $this->organizationId);

        $response->assertOk()
            ->assertJsonPath('data.current.amount_cents', 7250)
            ->assertJsonPath('data.history.' . ((int) date('Y') - 1) . '.amount_cents', 6400);
    }

    public function test_scoped_verein_manager_sees_history_only_for_authorized_organization(): void
    {
        $manager = User::factory()->forTenant($this->testTenantId)->create();
        $this->grantScopedDuesPermission($manager->id, $this->organizationId);
        Sanctum::actingAs($manager);

        $authorized = $this->membershipStatus($this->subject->id, $this->organizationId);
        $authorized->assertOk()
            ->assertJsonPath('data.current.amount_cents', 7250)
            ->assertJsonPath('data.history.' . ((int) date('Y') - 1) . '.amount_cents', 6400);

        $unauthorized = $this->membershipStatus($this->subject->id, $this->otherOrganizationId);
        $unauthorized->assertOk()
            ->assertJsonPath('data.current.status', 'paid')
            ->assertJsonMissingPath('data.history')
            ->assertJsonMissingPath('data.current.amount_cents');
    }

    public function test_foreign_tenant_dues_are_not_returned(): void
    {
        $foreignUser = User::factory()->forTenant(999)->create();
        $foreignOrganizationId = $this->makeOrganization('F-050 foreign Verein', 999);
        DB::table('verein_member_dues')->insert([
            'organization_id' => $foreignOrganizationId,
            'tenant_id' => 999,
            'user_id' => $foreignUser->id,
            'membership_year' => (int) date('Y'),
            'amount_cents' => 123456,
            'currency' => 'EUR',
            'status' => 'paid',
            'due_date' => date('Y') . '-01-31',
            'paid_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $viewer = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($viewer);

        $response = $this->membershipStatus($foreignUser->id, $foreignOrganizationId);

        $response->assertOk()
            ->assertJsonPath('data.current', null)
            ->assertJsonPath('data.is_current_member', false)
            ->assertJsonMissingPath('data.history');
    }

    public function test_shared_dues_authorization_still_allows_scoped_manager_admin_route(): void
    {
        $manager = User::factory()->forTenant($this->testTenantId)->create();
        $this->grantScopedDuesPermission($manager->id, $this->organizationId);
        Sanctum::actingAs($manager);

        $this->apiGet("/v2/vereine/{$this->organizationId}/dues/fee-config")
            ->assertOk()
            ->assertJsonPath('data.fee_config', null);

        $this->apiGet("/v2/vereine/{$this->otherOrganizationId}/dues/fee-config")
            ->assertForbidden()
            ->assertJsonPath('errors.0.code', 'FORBIDDEN');
    }

    public function test_shared_dues_authorization_still_denies_regular_member_admin_route(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->create());

        $this->apiGet("/v2/vereine/{$this->organizationId}/dues/fee-config")
            ->assertForbidden()
            ->assertJsonPath('errors.0.code', 'FORBIDDEN');
    }

    public function test_membership_status_requires_authentication(): void
    {
        $this->membershipStatus($this->subject->id, $this->organizationId)->assertUnauthorized();
    }

    public function test_membership_status_respects_caring_community_feature_gate(): void
    {
        $this->setCaringCommunityFeature(false);
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->create());

        $this->membershipStatus($this->subject->id, $this->organizationId)
            ->assertForbidden()
            ->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');
    }

    private function membershipStatus(int $userId, int $organizationId): \Illuminate\Testing\TestResponse
    {
        return $this->apiGet(
            "/v2/users/{$userId}/verein-membership-status?organization_id={$organizationId}"
        );
    }

    private function setCaringCommunityFeature(bool $enabled): void
    {
        $tenant = DB::table('tenants')->where('id', $this->testTenantId)->first();
        $features = [];
        if ($tenant && !empty($tenant->features)) {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : $tenant->features;
            $features = is_array($decoded) ? $decoded : [];
        }
        $features['caring_community'] = $enabled;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);
    }

    private function makeOrganization(string $name, ?int $tenantId = null): int
    {
        return (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $tenantId ?? $this->testTenantId,
            'name' => $name . ' ' . uniqid('', true),
            'org_type' => 'club',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function insertDue(
        int $organizationId,
        int $year,
        string $status,
        int $amountCents,
        ?string $paidAt
    ): void {
        DB::table('verein_member_dues')->insert([
            'organization_id' => $organizationId,
            'tenant_id' => $this->testTenantId,
            'user_id' => $this->subject->id,
            'membership_year' => $year,
            'amount_cents' => $amountCents,
            'currency' => 'CHF',
            'status' => $status,
            'due_date' => $year . '-01-31',
            'paid_at' => $paidAt,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function grantScopedDuesPermission(int $userId, int $organizationId): void
    {
        DB::table('roles')->updateOrInsert(
            ['name' => 'verein_admin'],
            [
                'display_name' => 'Verein Admin',
                'description' => 'Scoped Verein administrator',
                'level' => 4,
                'is_system' => 1,
                'tenant_id' => null,
            ]
        );
        DB::table('permissions')->updateOrInsert(
            ['name' => 'verein.dues.manage'],
            [
                'display_name' => 'Manage Verein Dues',
                'description' => 'Manage dues for an authorized Verein',
                'category' => 'vereine',
                'tenant_id' => null,
            ]
        );

        $roleId = (int) DB::table('roles')->where('name', 'verein_admin')->value('id');
        $permissionId = (int) DB::table('permissions')->where('name', 'verein.dues.manage')->value('id');
        DB::table('role_permissions')->updateOrInsert(
            ['role_id' => $roleId, 'permission_id' => $permissionId],
            ['tenant_id' => null]
        );
        DB::table('user_roles')->insert([
            'user_id' => $userId,
            'role_id' => $roleId,
            'assigned_by' => $userId,
            'assigned_at' => now(),
            'expires_at' => null,
            'tenant_id' => $this->testTenantId,
            'scope_organization_id' => $organizationId,
        ]);
    }
}
