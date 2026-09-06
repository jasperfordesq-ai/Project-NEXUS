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
 * The endpoint that restores the native-app install numbers the legacy admin
 * panel used to show. Its whole risk surface is the tenant boundary, so that
 * is what these tests are mostly about: a tenant admin must never be able to
 * see another community's members, and only `users.is_god` may unlock the
 * cross-tenant view.
 */
class AdminNativeAppInstallStatsTest extends TestCase
{
    use DatabaseTransactions;

    private const ENDPOINT = '/v2/admin/config/native-app/install-stats';

    /** The secondary tenant seeded by TestCase. */
    private const OTHER_TENANT_ID = 999;

    private function registerDevice(int $userId, int $tenantId, string $platform = 'android'): void
    {
        DB::table('fcm_device_tokens')->insert([
            'user_id' => $userId,
            'tenant_id' => $tenantId,
            'token' => 'tok-' . $tenantId . '-' . $userId . '-' . uniqid('', true),
            'platform' => $platform,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function makeGod(User $user): void
    {
        // Written straight to the column: is_god is a flag, never a role string,
        // and User::isGod() reads the column rather than the model instance.
        DB::table('users')->where('id', $user->id)->update(['is_god' => 1]);
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
            ->assertJsonPath('data.tenant.native_devices', 1)
            ->assertJsonPath('data.tenant.native_users', 1);
    }

    public function test_tenant_admin_cannot_see_another_tenants_devices(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $ourMember = User::factory()->forTenant($this->testTenantId)->create();
        $theirMember = User::factory()->forTenant(self::OTHER_TENANT_ID)->create([
            'first_name' => 'Ghost',
            'last_name' => 'Ofanothertenant',
        ]);

        $this->registerDevice($ourMember->id, $this->testTenantId);
        $this->registerDevice($theirMember->id, self::OTHER_TENANT_ID);
        $this->registerDevice($theirMember->id, self::OTHER_TENANT_ID, 'ios');

        Sanctum::actingAs($admin);
        $response = $this->apiGet(self::ENDPOINT)->assertOk();

        // Three devices exist platform-wide; this admin must see exactly one.
        $response->assertJsonPath('data.tenant.native_devices', 1);
        $response->assertJsonPath('data.tenant.native_users', 1);
        $response->assertJsonMissing(['display_name' => 'Ghost Ofanothertenant']);

        $userIds = array_column($response->json('data.tenant.recent_devices'), 'user_id');
        $this->assertSame([$ourMember->id], $userIds);
    }

    public function test_tenant_admin_recent_list_names_the_member(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => 'Aoife',
            'last_name' => 'Brennan',
        ]);
        $this->registerDevice($member->id, $this->testTenantId, 'ios');
        Sanctum::actingAs($admin);

        $this->apiGet(self::ENDPOINT)
            ->assertOk()
            ->assertJsonPath('data.tenant.recent_devices.0.display_name', 'Aoife Brennan')
            ->assertJsonPath('data.tenant.recent_devices.0.platform', 'ios')
            ->assertJsonPath('data.tenant.devices_by_platform.ios', 1)
            ->assertJsonPath('data.tenant.devices_by_platform.android', 0);
    }

    // ================================================================
    // God mode — cross-tenant
    // ================================================================

    public function test_god_gets_cross_tenant_platform_block(): void
    {
        $god = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->makeGod($god);

        $ourMember = User::factory()->forTenant($this->testTenantId)->create();
        $theirMember = User::factory()->forTenant(self::OTHER_TENANT_ID)->create([
            'first_name' => 'Ghost',
            'last_name' => 'Ofanothertenant',
        ]);
        $this->registerDevice($ourMember->id, $this->testTenantId);
        $this->registerDevice($theirMember->id, self::OTHER_TENANT_ID);

        Sanctum::actingAs($god);
        $response = $this->apiGet(self::ENDPOINT)->assertOk();

        $response->assertJsonPath('data.is_god', true);
        $response->assertJsonPath('data.scope', 'platform');
        $response->assertJsonPath('data.platform.native_devices', 2);
        $response->assertJsonPath('data.platform.native_users', 2);

        // The god view names members from other communities — that is the point.
        $names = array_column($response->json('data.platform.recent_devices'), 'display_name');
        $this->assertContains('Ghost Ofanothertenant', $names);

        // Its own tenant block stays scoped even for a god operator.
        $response->assertJsonPath('data.tenant.native_devices', 1);
    }

    public function test_god_by_tenant_breakdown_lists_each_community(): void
    {
        $god = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->makeGod($god);

        $ourMember = User::factory()->forTenant($this->testTenantId)->create();
        $theirMember = User::factory()->forTenant(self::OTHER_TENANT_ID)->create();
        $this->registerDevice($ourMember->id, $this->testTenantId);
        $this->registerDevice($theirMember->id, self::OTHER_TENANT_ID);
        $this->registerDevice($theirMember->id, self::OTHER_TENANT_ID, 'ios');

        Sanctum::actingAs($god);
        $byTenant = $this->apiGet(self::ENDPOINT)->assertOk()->json('data.platform.by_tenant');

        $rows = collect($byTenant)->keyBy('tenant_id');
        $this->assertSame(2, $rows[self::OTHER_TENANT_ID]['native_devices']);
        $this->assertSame(1, $rows[self::OTHER_TENANT_ID]['native_users']);
        $this->assertSame(1, $rows[$this->testTenantId]['native_devices']);
        $this->assertSame('Other Test Tenant', $rows[self::OTHER_TENANT_ID]['tenant_name']);
    }

    public function test_god_cross_tenant_list_omits_member_email(): void
    {
        // Data minimisation: a platform operator needs to know WHO installed the
        // app, not to accumulate contact details across communities they do not
        // administer. Email stays in the own-tenant block only.
        $god = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->makeGod($god);

        $theirMember = User::factory()->forTenant(self::OTHER_TENANT_ID)->create();
        $this->registerDevice($theirMember->id, self::OTHER_TENANT_ID);

        Sanctum::actingAs($god);
        $response = $this->apiGet(self::ENDPOINT)->assertOk();

        foreach ($response->json('data.platform.recent_devices') as $row) {
            $this->assertArrayNotHasKey('email', $row);
        }
    }

    public function test_tenant_super_admin_alone_does_not_unlock_the_platform_block(): void
    {
        // is_tenant_super_admin is a network admin confined to its own subtree.
        // The platform block is not subtree-filtered, so it must stay closed.
        $networkAdmin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        DB::table('users')->where('id', $networkAdmin->id)->update([
            'is_tenant_super_admin' => 1,
            'is_super_admin' => 1,
            'is_god' => 0,
        ]);
        Sanctum::actingAs($networkAdmin);

        $this->apiGet(self::ENDPOINT)
            ->assertOk()
            ->assertJsonPath('data.is_god', false)
            ->assertJsonPath('data.platform', null);
    }

    // ================================================================
    // Shape
    // ================================================================

    public function test_reports_zero_rather_than_failing_when_nobody_has_installed(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        DB::table('fcm_device_tokens')->where('tenant_id', $this->testTenantId)->delete();
        DB::table('push_subscriptions')->where('tenant_id', $this->testTenantId)->delete();
        Sanctum::actingAs($admin);

        $this->apiGet(self::ENDPOINT)
            ->assertOk()
            ->assertJsonPath('data.tenant.native_devices', 0)
            ->assertJsonPath('data.tenant.native_users', 0)
            ->assertJsonPath('data.tenant.push_enabled_users', 0)
            ->assertJsonPath('data.tenant.recent_devices', [])
            ->assertJsonPath('data.tenant.first_registered_at', null);
    }

    public function test_response_carries_the_not_store_installs_disclaimer(): void
    {
        // Pinned so no client can render these counts as Play Store installs.
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $this->apiGet(self::ENDPOINT)
            ->assertOk()
            ->assertJsonPath('data.disclaimer_key', 'push_registrations_not_store_installs');
    }

    public function test_push_enabled_users_counts_a_member_with_both_channels_once(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $member = User::factory()->forTenant($this->testTenantId)->create();
        DB::table('fcm_device_tokens')->where('tenant_id', $this->testTenantId)->delete();
        DB::table('push_subscriptions')->where('tenant_id', $this->testTenantId)->delete();

        $this->registerDevice($member->id, $this->testTenantId);
        DB::table('push_subscriptions')->insert([
            'user_id' => $member->id,
            'tenant_id' => $this->testTenantId,
            'endpoint' => 'https://example.test/push/' . uniqid('', true),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Sanctum::actingAs($admin);

        $this->apiGet(self::ENDPOINT)
            ->assertOk()
            ->assertJsonPath('data.tenant.native_users', 1)
            ->assertJsonPath('data.tenant.web_users', 1)
            ->assertJsonPath('data.tenant.push_enabled_users', 1);
    }
}
