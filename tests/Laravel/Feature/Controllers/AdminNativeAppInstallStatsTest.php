<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * GET /v2/admin/config/native-app/install-stats
 *
 * The figures at the top of the admin "Phone app" page. The endpoint's whole
 * risk surface is the tenant boundary, so that is what these tests are mostly
 * about: a tenant admin must never be able to see another community's members,
 * and only `users.is_god` may unlock the cross-tenant view.
 *
 * Since 13 Nov 2026 a member "has the app" when they have a registered phone
 * OR a live sign-in made through the phone app, so members who turned
 * notifications off are counted too. The list itself is
 * {@see AdminNativeAppMembersTest}.
 */
class AdminNativeAppInstallStatsTest extends TestCase
{
    use DatabaseTransactions;
    use NativeAppFixtures;

    private const ENDPOINT = '/v2/admin/config/native-app/install-stats';

    /**
     * The all-communities figures have their own request since 16 Nov 2026, in
     * the Platform team panel (platform team only: is_god AND super admin).
     * The tests below that are about those figures ask for them there.
     */
    private const ALL_COMMUNITIES = '/v2/platform-team/phone-app';

    protected function setUp(): void
    {
        parent::setUp();
        $this->clearPhoneAppRecords();
    }

    /**
     * The platform team: is_god AND super admin, as the panel requires. Written
     * straight to the columns: is_god is a flag, never a role string, and the
     * check reads the columns rather than the model instance.
     */
    private function makePlatformTeam(User $user): void
    {
        DB::table('users')->where('id', $user->id)->update(['is_god' => 1, 'is_super_admin' => 1]);
    }

    // ================================================================
    // Authorisation
    // ================================================================

    public function test_returns_401_for_unauthenticated(): void
    {
        $this->apiGet(self::ENDPOINT)->assertStatus(401);
    }

    public function test_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $this->apiGet(self::ENDPOINT)->assertStatus(403);
    }

    public function test_returns_403_for_broker(): void
    {
        // A broker is an operational role, not a junior admin — AdminTier
        // deliberately fails it closed.
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker']);
        Sanctum::actingAs($broker);

        $this->apiGet(self::ENDPOINT)->assertStatus(403);
    }

    // ================================================================
    // Tenant admin — own tenant only
    // ================================================================

    public function test_tenant_admin_gets_own_tenant_stats_without_platform_block(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $this->registerDevice($member->id, $this->testTenantId);
        Sanctum::actingAs($admin);

        $this->apiGet(self::ENDPOINT)
            ->assertOk()
            ->assertJsonPath('data.is_god', false)
            ->assertJsonPath('data.scope', 'tenant')
            ->assertJsonPath('data.platform', null)
            ->assertJsonPath('data.tenant.tenant_id', $this->testTenantId)
            ->assertJsonPath('data.tenant.members_with_app', 1)
            ->assertJsonPath('data.tenant.members_notifications_on', 1)
            ->assertJsonPath('data.tenant.native_devices', 1);
    }

    public function test_counts_members_signed_in_on_the_app_with_notifications_off(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $withPhone = User::factory()->forTenant($this->testTenantId)->create();
        $appOnly = User::factory()->forTenant($this->testTenantId)->create();
        $signedOut = User::factory()->forTenant($this->testTenantId)->create();
        $websiteOnly = User::factory()->forTenant($this->testTenantId)->create();

        $this->registerDevice($withPhone->id, $this->testTenantId, 'ios');
        $this->signIn($withPhone->id, $this->testTenantId);
        $this->signIn($appOnly->id, $this->testTenantId);
        $this->signIn($signedOut->id, $this->testTenantId, state: 'revoked');
        $this->signIn($websiteOnly->id, $this->testTenantId, fromPhoneApp: false);
        Sanctum::actingAs($admin);

        $this->apiGet(self::ENDPOINT)
            ->assertOk()
            ->assertJsonPath('data.tenant.members_with_app', 2)
            ->assertJsonPath('data.tenant.members_notifications_on', 1)
            ->assertJsonPath('data.tenant.native_devices', 1)
            ->assertJsonPath('data.tenant.devices_by_platform.ios', 1)
            ->assertJsonPath('data.tenant.devices_by_platform.android', 0);
    }

    public function test_tenant_admin_cannot_see_another_tenants_members(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $ourMember = User::factory()->forTenant($this->testTenantId)->create();
        $theirMember = User::factory()->forTenant(self::OTHER_TENANT_ID)->create([
            'first_name' => 'Ghost',
            'last_name' => 'Ofanothertenant',
        ]);
        $theirAppOnly = User::factory()->forTenant(self::OTHER_TENANT_ID)->create();

        $this->registerDevice($ourMember->id, $this->testTenantId);
        $this->registerDevice($theirMember->id, self::OTHER_TENANT_ID);
        $this->registerDevice($theirMember->id, self::OTHER_TENANT_ID, 'ios');
        $this->signIn($theirAppOnly->id, self::OTHER_TENANT_ID);

        Sanctum::actingAs($admin);
        $response = $this->apiGet(self::ENDPOINT)->assertOk();

        // Three phones and three members exist platform-wide; this admin must
        // see exactly one of each.
        $response->assertJsonPath('data.tenant.native_devices', 1);
        $response->assertJsonPath('data.tenant.members_with_app', 1);
        $response->assertJsonMissing(['display_name' => 'Ghost Ofanothertenant']);
    }

    public function test_a_phone_recorded_here_for_another_communitys_member_is_not_counted(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $outsider = User::factory()->forTenant(self::OTHER_TENANT_ID)->create();
        $this->registerDevice($outsider->id, $this->testTenantId);
        Sanctum::actingAs($admin);

        $this->apiGet(self::ENDPOINT)
            ->assertOk()
            ->assertJsonPath('data.tenant.members_with_app', 0)
            ->assertJsonPath('data.tenant.native_devices', 0);
    }

    public function test_tenant_block_carries_figures_only_never_a_list_of_members(): void
    {
        // The list is its own, paged endpoint. Keeping names out of this block
        // means a caller cannot widen it by accident.
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $this->registerDevice($member->id, $this->testTenantId);
        Sanctum::actingAs($admin);

        $tenant = $this->apiGet(self::ENDPOINT)->assertOk()->json('data.tenant');

        $this->assertSame(
            ['devices_by_platform', 'last_joined_at', 'members_notifications_on', 'members_with_app', 'native_devices', 'tenant_id'],
            collect(array_keys($tenant))->sort()->values()->all()
        );
    }

    // ================================================================
    // God mode — cross-tenant
    // ================================================================

    public function test_god_gets_cross_tenant_platform_block(): void
    {
        $god = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->makePlatformTeam($god);

        $ourMember = User::factory()->forTenant($this->testTenantId)->create();
        $theirMember = User::factory()->forTenant(self::OTHER_TENANT_ID)->create([
            'first_name' => 'Ghost',
            'last_name' => 'Ofanothertenant',
        ]);
        $theirAppOnly = User::factory()->forTenant(self::OTHER_TENANT_ID)->create();
        $this->registerDevice($ourMember->id, $this->testTenantId);
        $this->registerDevice($theirMember->id, self::OTHER_TENANT_ID);
        $this->signIn($theirAppOnly->id, self::OTHER_TENANT_ID);

        Sanctum::actingAs($god);
        $response = $this->apiGet(self::ALL_COMMUNITIES)->assertOk();

        // Other communities may hold rows from elsewhere in the test database,
        // so these are floors, not exact figures.
        $this->assertGreaterThanOrEqual(3, $response->json('data.members_with_app'));
        $this->assertGreaterThanOrEqual(2, $response->json('data.native_devices'));
        $this->assertGreaterThanOrEqual(2, $response->json('data.tenants_with_app'));

        // The platform team's view names members from other communities — that is the point.
        $names = array_column($response->json('data.recent_members'), 'display_name');
        $this->assertContains('Ghost Ofanothertenant', $names);

        // The community admin's own request stays scoped to this community even
        // for the platform team, and no longer carries the all-communities block.
        $own = $this->apiGet(self::ENDPOINT)->assertOk();
        $own->assertJsonPath('data.scope', 'tenant');
        $this->assertNull($own->json('data.platform'));
        $own->assertJsonPath('data.tenant.native_devices', 1);
        $own->assertJsonPath('data.tenant.members_with_app', 1);
    }

    public function test_god_by_tenant_breakdown_lists_each_community(): void
    {
        $god = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->makePlatformTeam($god);

        $ourMember = User::factory()->forTenant($this->testTenantId)->create();
        $theirMember = User::factory()->forTenant(self::OTHER_TENANT_ID)->create();
        $theirAppOnly = User::factory()->forTenant(self::OTHER_TENANT_ID)->create();
        $this->registerDevice($ourMember->id, $this->testTenantId);
        $this->registerDevice($theirMember->id, self::OTHER_TENANT_ID);
        $this->registerDevice($theirMember->id, self::OTHER_TENANT_ID, 'ios');
        $this->signIn($theirAppOnly->id, self::OTHER_TENANT_ID);

        Sanctum::actingAs($god);
        $byTenant = $this->apiGet(self::ALL_COMMUNITIES)->assertOk()->json('data.by_tenant');

        $rows = collect($byTenant)->keyBy('tenant_id');
        $this->assertSame(2, $rows[self::OTHER_TENANT_ID]['native_devices']);
        $this->assertSame(2, $rows[self::OTHER_TENANT_ID]['members_with_app']);
        $this->assertSame(1, $rows[$this->testTenantId]['native_devices']);
        $this->assertSame(1, $rows[$this->testTenantId]['members_with_app']);
        $this->assertSame('Other Test Tenant', $rows[self::OTHER_TENANT_ID]['tenant_name']);
    }

    public function test_god_cross_tenant_list_omits_member_email(): void
    {
        // Data minimisation: a platform operator needs to know WHO has the app,
        // not to accumulate contact details across communities they do not
        // administer. Email stays in the own-community list only.
        $god = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->makePlatformTeam($god);

        $theirMember = User::factory()->forTenant(self::OTHER_TENANT_ID)->create();
        $this->registerDevice($theirMember->id, self::OTHER_TENANT_ID);

        Sanctum::actingAs($god);
        $recent = $this->apiGet(self::ALL_COMMUNITIES)->assertOk()->json('data.recent_members');

        $this->assertNotEmpty($recent);
        foreach ($recent as $row) {
            $this->assertArrayNotHasKey('email', $row);
        }
    }

    public function test_tenant_super_admin_alone_does_not_unlock_the_platform_block(): void
    {
        // is_tenant_super_admin reaches its own community and those below it.
        // The platform block is not filtered that way, so it must stay closed.
        $tenantSuperAdmin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        DB::table('users')->where('id', $tenantSuperAdmin->id)->update([
            'is_tenant_super_admin' => 1,
            'is_super_admin' => 1,
            'is_god' => 0,
        ]);
        Sanctum::actingAs($tenantSuperAdmin);

        $this->apiGet(self::ENDPOINT)
            ->assertOk()
            ->assertJsonPath('data.is_god', false)
            ->assertJsonPath('data.platform', null);
    }

    // ================================================================
    // Shape
    // ================================================================

    public function test_reports_zero_rather_than_failing_when_nobody_has_the_app(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $this->apiGet(self::ENDPOINT)
            ->assertOk()
            ->assertJsonPath('data.tenant.members_with_app', 0)
            ->assertJsonPath('data.tenant.members_notifications_on', 0)
            ->assertJsonPath('data.tenant.native_devices', 0)
            ->assertJsonPath('data.tenant.devices_by_platform.android', 0)
            ->assertJsonPath('data.tenant.devices_by_platform.ios', 0)
            ->assertJsonPath('data.tenant.last_joined_at', null);
    }

    public function test_response_says_these_are_not_store_install_counts(): void
    {
        // Pinned so no client can render these figures as Play Store or App
        // Store downloads.
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $this->apiGet(self::ENDPOINT)
            ->assertOk()
            ->assertJsonPath('data.disclaimer_key', 'app_members_not_store_installs');
    }
}
