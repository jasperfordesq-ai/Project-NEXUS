<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Volunteering;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Community administrators are recognised by their admin flags, not only by
 * the users.role string.
 *
 * The API grants admin authority through the boolean flags (is_admin,
 * is_super_admin, is_tenant_super_admin, is_god) and leaves users.role at
 * 'member'. Until 6 Oct 2026 the volunteering gates read only the role string,
 * so a flag-granted administrator was refused managing an opportunity or an
 * organisation they did not personally own. Brokers and coordinators stay
 * refused, as before — even when a stale admin flag remains on their row.
 */
class VolunteerCommunityAdminFlagsTest extends TestCase
{
    use DatabaseTransactions;

    private function enableVolunteering(): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['volunteering' => true, 'organisations' => true]),
        ]);
        TenantContext::setById($this->testTenantId);
    }

    private function member(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
        ], $overrides));
    }

    private function organisation(User $owner): int
    {
        return (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => 'Admin flags fixture organisation',
            'slug' => 'admin-flags-fixture-org-' . uniqid(),
            'status' => 'approved',
            'created_at' => now(),
        ]);
    }

    private function opportunity(User $owner): int
    {
        return (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $this->organisation($owner),
            'created_by' => $owner->id,
            'title' => 'Admin flags fixture opportunity',
            'description' => 'Something to manage.',
            'is_active' => 1,
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** @return array<string, array{array<string, mixed>}> */
    public static function flagAdmins(): array
    {
        return [
            'is_admin' => [['is_admin' => 1]],
            'is_tenant_super_admin' => [['is_tenant_super_admin' => 1]],
            'is_super_admin' => [['is_super_admin' => 1]],
            'is_god' => [['is_god' => 1]],
        ];
    }

    /** @return array<string, array{array<string, mixed>}> */
    public static function operationalRoles(): array
    {
        return [
            'broker' => [['role' => 'broker']],
            'broker with a stale is_admin flag' => [['role' => 'broker', 'is_admin' => 1]],
            'coordinator' => [['role' => 'coordinator']],
        ];
    }

    /** @dataProvider flagAdmins */
    public function test_a_flag_admin_with_member_role_can_close_an_opportunity(array $flags): void
    {
        $this->enableVolunteering();
        $oppId = $this->opportunity($this->member());
        Sanctum::actingAs($this->member($flags), ['*']);

        $this->apiPut("/v2/volunteering/opportunities/{$oppId}", ['status' => 'closed'])->assertOk();
        $this->assertSame('closed', DB::table('vol_opportunities')->where('id', $oppId)->value('status'));
    }

    /** @dataProvider operationalRoles */
    public function test_a_broker_or_coordinator_still_cannot_close_an_opportunity(array $overrides): void
    {
        $this->enableVolunteering();
        $oppId = $this->opportunity($this->member());
        Sanctum::actingAs($this->member($overrides), ['*']);

        $this->apiPut("/v2/volunteering/opportunities/{$oppId}", ['status' => 'closed'])->assertForbidden();
        $this->assertSame('open', DB::table('vol_opportunities')->where('id', $oppId)->value('status'));
    }

    /** @dataProvider flagAdmins */
    public function test_a_flag_admin_can_add_an_opportunity_to_an_organisation_they_do_not_own(array $flags): void
    {
        $this->enableVolunteering();
        $orgId = $this->organisation($this->member());
        Sanctum::actingAs($this->member($flags), ['*']);

        $this->apiPost('/v2/volunteering/opportunities', [
            'organization_id' => $orgId,
            'title' => 'Added by a community admin',
            'description' => 'A community admin adds this for the organisation.',
        ])->assertStatus(201);
        $this->assertTrue(DB::table('vol_opportunities')->where('organization_id', $orgId)->exists());
    }

    /** @dataProvider operationalRoles */
    public function test_a_broker_or_coordinator_still_cannot_add_an_opportunity_to_an_organisation(array $overrides): void
    {
        $this->enableVolunteering();
        $orgId = $this->organisation($this->member());
        Sanctum::actingAs($this->member($overrides), ['*']);

        $this->apiPost('/v2/volunteering/opportunities', [
            'organization_id' => $orgId,
            'title' => 'Added by a broker',
            'description' => 'A broker tries to add this for the organisation.',
        ])->assertForbidden();
        $this->assertFalse(DB::table('vol_opportunities')->where('organization_id', $orgId)->exists());
    }

    /** @dataProvider flagAdmins */
    public function test_a_flag_admin_can_open_an_organisation_dashboard(array $flags): void
    {
        $this->enableVolunteering();
        $orgId = $this->organisation($this->member());
        Sanctum::actingAs($this->member($flags), ['*']);

        $this->apiGet("/v2/volunteering/organisations/{$orgId}/stats")->assertOk();
    }

    /** @dataProvider operationalRoles */
    public function test_a_broker_or_coordinator_still_cannot_open_an_organisation_dashboard(array $overrides): void
    {
        $this->enableVolunteering();
        $orgId = $this->organisation($this->member());
        Sanctum::actingAs($this->member($overrides), ['*']);

        $this->apiGet("/v2/volunteering/organisations/{$orgId}/stats")->assertForbidden();
    }

    /** @dataProvider flagAdmins */
    public function test_a_flag_admin_can_list_wellbeing_alerts(array $flags): void
    {
        $this->enableVolunteering();
        Sanctum::actingAs($this->member($flags), ['*']);

        $this->apiGet('/v2/admin/volunteering/wellbeing/alerts')->assertOk();
    }

    /**
     * Changed 7 Oct 2026: brokers and coordinators are now told when a volunteer
     * says they are struggling, so they must be able to open the alert they are
     * told about (owner rule, 2 Oct: every broker function works for a broker).
     *
     * @dataProvider operationalRoles
     */
    public function test_a_broker_or_coordinator_can_list_wellbeing_alerts(array $overrides): void
    {
        $this->enableVolunteering();
        Sanctum::actingAs($this->member($overrides), ['*']);

        $this->apiGet('/v2/admin/volunteering/wellbeing/alerts')->assertOk();
    }

    public function test_an_ordinary_member_cannot_list_wellbeing_alerts(): void
    {
        $this->enableVolunteering();
        Sanctum::actingAs($this->member(), ['*']);

        $this->apiGet('/v2/admin/volunteering/wellbeing/alerts')->assertForbidden();
    }
}
