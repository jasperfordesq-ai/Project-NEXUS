<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\PlatformTeam;

use App\Models\User;
use App\Services\PlatformTeam\SecurityOverviewService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * Platform team panel → Security: who was given or lost senior access, who
 * signed in as another member, failed sign-ins, and senior accounts without
 * two-step. Read-only, across every community.
 *
 * The records it reads hold email addresses, IP addresses and browser
 * details. None of those may leave the server: the page does not need them.
 */
class SecurityOverviewTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    private const URI = '/v2/platform-team/security';

    private const PLANTED_IP = '203.0.113.77';
    private const PLANTED_AGENT = 'SecurityOverviewTestBrowser/9.9';

    /** @param array<string, mixed> $attributes */
    private function account(array $attributes): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $attributes));
    }

    /** @return array<string, mixed> */
    private function data(): array
    {
        return $this->apiGet(self::URI)->assertStatus(200)->json('data');
    }

    private function communityName(): string
    {
        return (string) DB::table('tenants')->where('id', $this->testTenantId)->value('name');
    }

    public function test_only_the_platform_team_may_read_it(): void
    {
        $this->assertPlatformTeamOnly('GET', self::URI);
    }

    public function test_it_lists_senior_access_given_and_removed_from_both_logs(): void
    {
        $actor = $this->account(['is_super_admin' => true, 'role' => 'super_admin', 'first_name' => 'Actor', 'last_name' => 'Sample']);
        $target = $this->account(['role' => 'admin', 'first_name' => 'Target', 'last_name' => 'Sample']);

        // The super admin panel's log.
        DB::table('super_admin_audit_log')->insert([
            'actor_user_id' => $actor->id,
            'actor_tenant_id' => $this->testTenantId,
            'actor_name' => 'Actor Sample',
            'actor_email' => 'actor.planted@example.test',
            'action_type' => 'global_super_admin_granted',
            'target_type' => 'user',
            'target_id' => $target->id,
            'target_name' => 'Target Sample',
            'target_tenant_id' => $this->testTenantId,
            'old_values' => json_encode(['is_super_admin' => 0]),
            'new_values' => json_encode(['is_super_admin' => 1]),
            'description' => 'Granted global super admin to user planted-description',
            'ip_address' => self::PLANTED_IP,
            'user_agent' => self::PLANTED_AGENT,
            'created_at' => now()->subDay(),
        ]);
        // The community admin panel's log.
        DB::table('org_audit_log')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $actor->id,
            'target_user_id' => $target->id,
            'action' => 'revoke_tenant_super_admin',
            'details' => json_encode(['email' => 'target.planted@example.test']),
            'ip_address' => self::PLANTED_IP,
            'user_agent' => self::PLANTED_AGENT,
            'created_at' => now()->subHours(2),
        ]);
        $this->actAsPlatformTeam();

        $response = $this->apiGet(self::URI)->assertStatus(200);
        $section = $response->json('data.access_changes');

        $this->assertTrue($section['available']);
        $mine = array_values(array_filter(
            $section['items'],
            static fn (array $item): bool => $item['account'] === 'Target Sample',
        ));
        $this->assertCount(2, $mine);
        // Newest first.
        $this->assertSame('tenant_super_admin_removed', $mine[0]['change']);
        $this->assertSame('global_super_admin_granted', $mine[1]['change']);
        foreach ($mine as $item) {
            $this->assertSame(['account', 'at', 'by', 'change', 'community'], $this->sortedKeys($item));
            $this->assertSame('Actor Sample', $item['by']);
            $this->assertSame($this->communityName(), $item['community']);
        }

        $body = $response->getContent();
        foreach (['actor.planted@example.test', 'target.planted@example.test', self::PLANTED_IP, self::PLANTED_AGENT, 'planted-description'] as $needle) {
            $this->assertStringNotContainsString($needle, $body, $needle);
        }
    }

    public function test_it_lists_who_signed_in_as_another_member_without_the_members_email(): void
    {
        $admin = $this->account(['role' => 'admin', 'first_name' => 'Admin', 'last_name' => 'Sample']);
        $member = $this->account(['role' => 'member', 'first_name' => 'Member', 'last_name' => 'Sample']);
        DB::table('org_audit_log')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $admin->id,
            'target_user_id' => $member->id,
            'action' => 'admin_user_impersonated',
            'details' => json_encode(['impersonated_email' => 'member.planted@example.test']),
            'ip_address' => self::PLANTED_IP,
            'user_agent' => self::PLANTED_AGENT,
            'created_at' => now()->subHour(),
        ]);
        $this->actAsPlatformTeam();

        $response = $this->apiGet(self::URI)->assertStatus(200);
        $section = $response->json('data.impersonations');

        $this->assertTrue($section['available']);
        $mine = array_values(array_filter(
            $section['items'],
            static fn (array $item): bool => $item['member'] === 'Member Sample',
        ));
        $this->assertCount(1, $mine);
        $this->assertSame(['at', 'by', 'community', 'member'], $this->sortedKeys($mine[0]));
        $this->assertSame('Admin Sample', $mine[0]['by']);
        $this->assertSame($this->communityName(), $mine[0]['community']);

        $body = $response->getContent();
        foreach (['member.planted@example.test', $member->email, self::PLANTED_IP, self::PLANTED_AGENT] as $needle) {
            $this->assertStringNotContainsString($needle, $body, $needle);
        }
    }

    public function test_records_older_than_the_window_are_left_out(): void
    {
        $admin = $this->account(['role' => 'admin']);
        $member = $this->account(['role' => 'member', 'first_name' => 'Long Ago', 'last_name' => 'Member']);
        DB::table('org_audit_log')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $admin->id,
            'target_user_id' => $member->id,
            'action' => 'admin_user_impersonated',
            'created_at' => now()->subDays(SecurityOverviewService::WINDOW_DAYS + 5),
        ]);
        $this->actAsPlatformTeam();

        $data = $this->data();

        $this->assertSame(SecurityOverviewService::WINDOW_DAYS, $data['window_days']);
        $this->assertNotContains('Long Ago Member', array_column($data['impersonations']['items'], 'member'));
    }

    public function test_it_counts_failed_sign_ins_by_community_and_never_sends_an_address(): void
    {
        $digestA = hash('sha256', 'security-overview-a@example.test');
        $digestB = hash('sha256', 'security-overview-b@example.test');
        $rows = [];
        foreach ([[$digestA, 4], [$digestB, 2]] as [$digest, $times]) {
            for ($i = 0; $i < $times; $i++) {
                $rows[] = ['identifier' => "tenant:{$this->testTenantId}:email:{$digest}", 'type' => 'email', 'ip_address' => self::PLANTED_IP, 'success' => 0, 'attempted_at' => DB::raw('NOW()')];
                $rows[] = ['identifier' => self::PLANTED_IP, 'type' => 'ip', 'ip_address' => self::PLANTED_IP, 'success' => 0, 'attempted_at' => DB::raw('NOW()')];
            }
        }
        // A successful sign-in is not a failure.
        $rows[] = ['identifier' => "tenant:{$this->testTenantId}:email:{$digestA}", 'type' => 'email', 'ip_address' => self::PLANTED_IP, 'success' => 1, 'attempted_at' => DB::raw('NOW()')];
        DB::table('login_attempts')->insert($rows);
        $before = $this->baseline();
        $this->actAsPlatformTeam();

        $response = $this->apiGet(self::URI)->assertStatus(200);
        $section = $response->json('data.failed_sign_ins');

        $this->assertTrue($section['available']);
        $this->assertSame($before['last_24h'], $section['last_24h']);
        $this->assertSame($before['last_hour'], $section['last_hour']);
        $this->assertGreaterThanOrEqual(6, $section['last_24h']);
        // Six failed attempts came from the planted address.
        $this->assertGreaterThanOrEqual(6, $section['most_from_one_address_24h']);
        $this->assertGreaterThanOrEqual(1, $section['addresses_24h']);

        $mine = array_values(array_filter(
            $section['by_community'],
            fn (array $row): bool => ($row['community']['id'] ?? null) === $this->testTenantId,
        ));
        $this->assertCount(1, $mine);
        $this->assertSame(
            ['accounts_tried', 'community', 'failed', 'last_at', 'most_on_one_account'],
            $this->sortedKeys($mine[0]),
        );
        $this->assertGreaterThanOrEqual(6, $mine[0]['failed']);
        $this->assertGreaterThanOrEqual(2, $mine[0]['accounts_tried']);
        $this->assertGreaterThanOrEqual(4, $mine[0]['most_on_one_account']);
        $this->assertSame($this->communityName(), $mine[0]['community']['name']);

        $body = $response->getContent();
        foreach ([self::PLANTED_IP, $digestA, $digestB] as $needle) {
            $this->assertStringNotContainsString($needle, $body, $needle);
        }
    }

    public function test_it_counts_senior_accounts_without_two_step(): void
    {
        $off = $this->account(['is_super_admin' => true, 'role' => 'super_admin']);
        DB::table('users')->where('id', $off->id)->update(['totp_enabled' => 0]);
        $this->actAsPlatformTeam();

        $section = $this->data()['two_step'];

        $this->assertTrue($section['available']);
        $this->assertGreaterThanOrEqual(1, $section['without_two_step']);
        $this->assertGreaterThanOrEqual($section['without_two_step'], $section['senior_total']);
    }

    /**
     * Review finding, 16 Nov 2026: a community's admin panel can also give and
     * remove GLOBAL super admin, and a role change can do the same. The first
     * version read only the tenant super admin actions from that log, so the
     * most powerful grant was the one the page left out.
     */
    public function test_global_super_admin_given_or_removed_from_a_community_admin_panel_is_listed(): void
    {
        $actor = $this->account(['is_super_admin' => true, 'role' => 'super_admin', 'first_name' => 'Granting', 'last_name' => 'Actor']);
        $given = $this->account(['role' => 'admin', 'first_name' => 'Given', 'last_name' => 'Global']);
        $removed = $this->account(['role' => 'admin', 'first_name' => 'Removed', 'last_name' => 'Global']);
        $promoted = $this->account(['role' => 'admin', 'first_name' => 'Promoted', 'last_name' => 'ByRole']);
        $demoted = $this->account(['role' => 'admin', 'first_name' => 'Demoted', 'last_name' => 'ByRole']);
        $ordinary = $this->account(['role' => 'member', 'first_name' => 'Ordinary', 'last_name' => 'RoleChange']);

        $row = fn (int $target, string $action, ?array $details = null): array => [
            'tenant_id' => $this->testTenantId,
            'user_id' => $actor->id,
            'target_user_id' => $target,
            'action' => $action,
            'details' => $details !== null ? json_encode($details) : null,
            'created_at' => now()->subHour(),
        ];
        DB::table('org_audit_log')->insert([
            $row($given->id, 'grant_global_super_admin'),
            $row($removed->id, 'revoke_global_super_admin'),
            $row($promoted->id, 'admin_role_changed', ['old_role' => 'admin', 'new_role' => 'super_admin']),
            $row($demoted->id, 'admin_role_changed', ['old_role' => 'super_admin', 'new_role' => 'member']),
            // A role change that has nothing to do with senior access is not listed.
            $row($ordinary->id, 'admin_role_changed', ['old_role' => 'member', 'new_role' => 'admin']),
        ]);
        $this->actAsPlatformTeam();

        $changes = [];
        foreach ($this->data()['access_changes']['items'] as $item) {
            $changes[$item['account']] = $item['change'];
        }

        $this->assertSame('global_super_admin_granted', $changes['Given Global'] ?? null);
        $this->assertSame('global_super_admin_removed', $changes['Removed Global'] ?? null);
        $this->assertSame('global_super_admin_granted', $changes['Promoted ByRole'] ?? null);
        $this->assertSame('global_super_admin_removed', $changes['Demoted ByRole'] ?? null);
        $this->assertArrayNotHasKey('Ordinary RoleChange', $changes);
    }

    /**
     * The super admin panel can also give tenant super admin while creating an
     * account, and gives or takes it while moving one. Those are recorded as
     * `user_created` / `user_moved` with the flag in the before/after values.
     */
    public function test_senior_access_given_or_taken_while_creating_or_moving_an_account_is_listed(): void
    {
        $actor = $this->account(['is_super_admin' => true, 'role' => 'super_admin']);
        $created = $this->account(['role' => 'admin', 'first_name' => 'Created', 'last_name' => 'Senior']);
        $movedIn = $this->account(['role' => 'admin', 'first_name' => 'Moved', 'last_name' => 'Promoted']);
        $movedOut = $this->account(['role' => 'admin', 'first_name' => 'Moved', 'last_name' => 'Stripped']);
        $plain = $this->account(['role' => 'member', 'first_name' => 'Created', 'last_name' => 'Plain']);

        $row = fn (int $target, string $action, ?array $old, ?array $new): array => [
            'actor_user_id' => $actor->id,
            'actor_tenant_id' => $this->testTenantId,
            'actor_name' => 'x',
            'actor_email' => 'x@example.test',
            'action_type' => $action,
            'target_type' => 'user',
            'target_id' => $target,
            'target_name' => 'x',
            'target_tenant_id' => $this->testTenantId,
            'old_values' => $old !== null ? json_encode($old) : null,
            'new_values' => $new !== null ? json_encode($new) : null,
            'created_at' => now()->subHour(),
        ];
        DB::table('super_admin_audit_log')->insert([
            $row($created->id, 'user_created', null, ['role' => 'admin', 'is_tenant_super_admin' => true]),
            $row($movedIn->id, 'user_moved', ['is_tenant_super_admin' => 0], ['is_tenant_super_admin' => 1]),
            $row($movedOut->id, 'user_moved', ['is_tenant_super_admin' => 1], ['is_tenant_super_admin' => 0]),
            $row($plain->id, 'user_created', null, ['role' => 'member', 'is_tenant_super_admin' => false]),
        ]);
        $this->actAsPlatformTeam();

        $changes = [];
        foreach ($this->data()['access_changes']['items'] as $item) {
            $changes[$item['account']] = $item['change'];
        }

        $this->assertSame('tenant_super_admin_granted', $changes['Created Senior'] ?? null);
        $this->assertSame('tenant_super_admin_granted', $changes['Moved Promoted'] ?? null);
        $this->assertSame('tenant_super_admin_removed', $changes['Moved Stripped'] ?? null);
        $this->assertArrayNotHasKey('Created Plain', $changes);
    }

    /**
     * Review finding, 16 Nov 2026: `super_admin_audit_log` keeps a copy of each
     * person's name as text, and erasure does not scrub it. The page must show
     * the name the account has NOW (anonymised, for an erased account), never
     * the stored copy.
     */
    public function test_names_come_from_the_account_as_it_is_now_never_from_the_copy_kept_in_the_log(): void
    {
        $actor = $this->account(['is_super_admin' => true, 'role' => 'super_admin', 'first_name' => 'Current', 'last_name' => 'Actor']);
        $target = $this->account(['role' => 'admin', 'first_name' => 'Current', 'last_name' => 'Target']);
        $base = [
            'actor_user_id' => $actor->id,
            'actor_tenant_id' => $this->testTenantId,
            'actor_name' => 'Stored Actor Copy',
            'actor_email' => 'x@example.test',
            'action_type' => 'super_admin_granted',
            'target_type' => 'user',
            'target_tenant_id' => $this->testTenantId,
            'created_at' => now()->subHour(),
        ];
        DB::table('super_admin_audit_log')->insert([
            $base + ['target_id' => $target->id, 'target_name' => 'Stored Target Copy'],
            // An account that no longer exists has no name to show.
            $base + ['target_id' => 999999999, 'target_name' => 'Stored Gone Copy'],
        ]);
        $this->actAsPlatformTeam();

        $response = $this->apiGet(self::URI)->assertStatus(200);
        $items = $response->json('data.access_changes.items');

        $this->assertContains('Current Target', array_column($items, 'account'));
        $this->assertContains('Current Actor', array_column($items, 'by'));
        $this->assertContains(null, array_column($items, 'account'));
        foreach (['Stored Actor Copy', 'Stored Target Copy', 'Stored Gone Copy'] as $copy) {
            $this->assertStringNotContainsString($copy, $response->getContent(), $copy);
        }
    }

    /** A record that cannot be read is "could not be checked", never an empty list. */
    public function test_a_section_that_cannot_be_read_says_so_and_keeps_its_reason_on_the_server(): void
    {
        $result = (new SecurityOverviewService())->guarded('test', static function (): array {
            throw new \RuntimeException('planted reason with an address 203.0.113.77');
        });

        $this->assertSame(['available' => false], $result);
    }

    public function test_nothing_can_be_changed_through_it(): void
    {
        $this->actAsPlatformTeam();

        foreach (['POST', 'PUT', 'DELETE'] as $method) {
            $status = $this->requestAs($method, self::URI)->getStatusCode();
            $this->assertContains($status, [404, 405], "{$method} answered {$status}");
        }
    }

    /**
     * The shared local test database can already hold sign-in attempts, so the
     * totals are compared with a count made here, not with a fixed number.
     *
     * @return array{last_hour: int, last_24h: int}
     */
    private function baseline(): array
    {
        $count = static fn (string $interval): int => (int) DB::selectOne(
            "SELECT COUNT(*) AS c FROM login_attempts
             WHERE type = 'email' AND success = 0 AND attempted_at > (NOW() - INTERVAL {$interval})"
        )->c;

        return ['last_hour' => $count('1 HOUR'), 'last_24h' => $count('24 HOUR')];
    }

    /**
     * @param array<string, mixed> $row
     * @return array<int, string>
     */
    private function sortedKeys(array $row): array
    {
        $keys = array_keys($row);
        sort($keys);

        return $keys;
    }
}
