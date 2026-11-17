<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\PlatformTeam;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * Platform team panel → Senior accounts: every account that can administer
 * more than one community (platform team, global super admins, tenant super
 * admins), with when it last signed in and whether two-step is on.
 *
 * The list itself only reads. Adding an account to the platform team and
 * removing one (17 Nov 2026) are separate requests with their own tests:
 * PlatformTeamMembershipTest.
 */
class SeniorAccountsTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    private const URI = '/v2/platform-team/senior-accounts';

    /** Exactly what the page shows. Anything else must not leave the server. */
    private const ROW_KEYS = [
        'id', 'name', 'email', 'level', 'incomplete_platform_team', 'community',
        'status', 'last_sign_in_at', 'two_step_on', 'has_passkey',
    ];

    /** @param array<string, mixed> $attributes */
    private function account(array $attributes): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $attributes));
    }

    /** @return array<int, array<string, mixed>> keyed by account id */
    private function rows(): array
    {
        $response = $this->apiGet(self::URI)->assertStatus(200);
        $rows = [];
        foreach ($response->json('data.accounts') as $row) {
            $rows[(int) $row['id']] = $row;
        }

        return $rows;
    }

    public function test_only_the_platform_team_may_read_it(): void
    {
        $this->assertPlatformTeamOnly('GET', self::URI);
    }

    public function test_it_lists_each_kind_of_senior_account_under_the_right_level(): void
    {
        $global = $this->account(['is_super_admin' => true, 'role' => 'super_admin']);
        $globalByRoleOnly = $this->account(['role' => 'super_admin']);
        $tenantSuper = $this->account(['role' => 'admin', 'is_tenant_super_admin' => true]);
        $flagOnly = $this->account(['is_god' => true]);
        $me = $this->actAsPlatformTeam();

        $rows = $this->rows();

        $this->assertSame('platform_team', $rows[$me->id]['level']);
        $this->assertSame('global_super_admin', $rows[$global->id]['level']);
        $this->assertSame('global_super_admin', $rows[$globalByRoleOnly->id]['level']);
        $this->assertSame('tenant_super_admin', $rows[$tenantSuper->id]['level']);
        // The platform team flag without super admin is NOT platform team
        // membership. It is listed, and it says so.
        $this->assertSame('platform_flag_only', $rows[$flagOnly->id]['level']);
        $this->assertTrue($rows[$flagOnly->id]['incomplete_platform_team']);
        $this->assertFalse($rows[$me->id]['incomplete_platform_team']);
    }

    public function test_ordinary_accounts_are_not_listed(): void
    {
        $member = $this->account(['role' => 'member']);
        $admin = $this->account(['role' => 'admin']);
        $broker = $this->account(['role' => 'broker']);
        // (A manager's stand-in, status 'delegate', cannot be planted with a
        // senior flag: the database's own trigger refuses the row.)
        $this->actAsPlatformTeam();

        $rows = $this->rows();

        foreach ([$member, $admin, $broker] as $account) {
            $this->assertArrayNotHasKey($account->id, $rows, "account {$account->id} ({$account->role}/{$account->status})");
        }
    }

    public function test_each_row_carries_only_what_the_page_shows(): void
    {
        $this->actAsPlatformTeam();
        $response = $this->apiGet(self::URI)->assertStatus(200);

        foreach ($response->json('data.accounts') as $row) {
            $keys = array_keys($row);
            sort($keys);
            $expected = self::ROW_KEYS;
            sort($expected);
            $this->assertSame($expected, $keys);
        }
        // Belt and braces: no secret can ride along under any name.
        $body = strtolower($response->getContent());
        foreach (['password', 'totp_secret', 'remember_token', 'recovery', 'public_key', 'credential_id'] as $needle) {
            $this->assertStringNotContainsString($needle, $body, $needle);
        }
    }

    public function test_it_says_who_has_two_step_and_who_has_a_passkey(): void
    {
        $on = $this->account(['is_super_admin' => true, 'role' => 'super_admin']);
        $off = $this->account(['is_super_admin' => true, 'role' => 'super_admin']);
        // Written straight to the column: the model does not let it be mass-assigned.
        DB::table('users')->where('id', $on->id)->update(['totp_enabled' => 1]);
        DB::table('users')->where('id', $off->id)->update(['totp_enabled' => 0]);
        DB::table('webauthn_credentials')->insert([
            'user_id' => $off->id,
            'tenant_id' => $this->testTenantId,
            'credential_id' => 'senior-accounts-test-' . $off->id,
            'public_key' => 'not-a-real-key',
            'user_handle' => 'senior-accounts-test-' . $off->id,
        ]);
        $this->actAsPlatformTeam();

        $rows = $this->rows();

        $this->assertTrue($rows[$on->id]['two_step_on']);
        $this->assertFalse($rows[$on->id]['has_passkey']);
        $this->assertFalse($rows[$off->id]['two_step_on']);
        $this->assertTrue($rows[$off->id]['has_passkey']);
    }

    public function test_it_gives_the_community_and_the_last_sign_in(): void
    {
        $account = $this->account(['role' => 'admin', 'is_tenant_super_admin' => true]);
        DB::table('users')->where('id', $account->id)->update(['last_login_at' => '2026-11-01 09:30:00']);
        $never = $this->account(['role' => 'admin', 'is_tenant_super_admin' => true]);
        DB::table('users')->where('id', $never->id)->update(['last_login_at' => null]);
        $this->actAsPlatformTeam();

        $rows = $this->rows();

        $this->assertSame($this->testTenantId, $rows[$account->id]['community']['id']);
        $this->assertSame(
            DB::table('tenants')->where('id', $this->testTenantId)->value('name'),
            $rows[$account->id]['community']['name'],
        );
        $this->assertStringStartsWith('2026-11-01T09:30:00', (string) $rows[$account->id]['last_sign_in_at']);
        $this->assertNull($rows[$never->id]['last_sign_in_at']);
    }

    public function test_the_counts_match_the_list(): void
    {
        $this->account(['is_super_admin' => true, 'role' => 'super_admin']);
        $this->account(['role' => 'admin', 'is_tenant_super_admin' => true]);
        $this->actAsPlatformTeam();

        $data = $this->apiGet(self::URI)->assertStatus(200)->json('data');

        $byLevel = array_count_values(array_column($data['accounts'], 'level'));
        foreach (['platform_team', 'global_super_admin', 'tenant_super_admin', 'platform_flag_only'] as $level) {
            $this->assertSame($byLevel[$level] ?? 0, $data['counts'][$level], $level);
        }
        $this->assertSame(count($data['accounts']), $data['total']);
        $this->assertFalse($data['truncated']);
    }

    /**
     * Review finding, 16 Nov 2026: the role string `god` is not platform team
     * membership, but `SuperPanelAccess` and `CrossTenantEntry` both treat it
     * as platform-wide. An account that can reach every community must be on
     * this page, and must not be described as harmless.
     */
    public function test_an_account_with_the_old_god_role_is_listed_as_platform_wide_but_not_on_the_team(): void
    {
        $account = $this->account(['role' => 'admin']);
        // Written straight to the column: no screen and no request writes this role.
        DB::table('users')->where('id', $account->id)->update(['role' => 'god']);
        $this->actAsPlatformTeam();

        $rows = $this->rows();

        $this->assertArrayHasKey($account->id, $rows);
        $this->assertSame('platform_flag_only', $rows[$account->id]['level']);
        $this->assertTrue($rows[$account->id]['incomplete_platform_team']);
    }

    /** `users.status` may be NULL; "is not a stand-in" must not drop such an account. */
    public function test_a_senior_account_with_no_status_recorded_is_still_listed(): void
    {
        $account = $this->account(['is_super_admin' => true, 'role' => 'super_admin']);
        DB::table('users')->where('id', $account->id)->update(['status' => null]);
        $this->actAsPlatformTeam();

        $this->assertArrayHasKey($account->id, $this->rows());
    }

    /** The list's own address changes nothing, whatever is sent to it. */
    public function test_nothing_can_be_changed_through_it(): void
    {
        $this->actAsPlatformTeam();

        foreach (['POST', 'PUT', 'DELETE'] as $method) {
            $status = $this->requestAs($method, self::URI, ['is_god' => true])->getStatusCode();
            $this->assertContains($status, [404, 405], "{$method} answered {$status}");
        }
    }
}
