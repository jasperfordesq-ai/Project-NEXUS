<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Services\TenantBillingService;
use App\Support\Billing\BillingLock;
use App\Support\Billing\StandardPlans;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * The seven standard packages (DESIGN §11.1) and the active-member count they
 * are sized by.
 *
 * Every number is read from StandardPlans::TIERS, the same constant the
 * migration writes from, so a price cannot be right in one and wrong in the
 * other. What this proves on top is that the rows really are in the database
 * and that retiring the older plans changes nothing a community is billed.
 */
final class StandardPlansTest extends TestCase
{
    use DatabaseTransactions;

    private const MIGRATION = 'database/migrations/2026_11_20_200000_standard_billing_packages.php';

    protected function setUp(): void
    {
        parent::setUp();
        BillingLock::flush();
    }

    protected function tearDown(): void
    {
        // parent::tearDown() rolls the transaction back; it must always run.
        try {
            BillingLock::flush();
        } finally {
            parent::tearDown();
        }
    }

    private function migration(): object
    {
        return require base_path(self::MIGRATION);
    }

    private function makeCommunity(string $name, ?int $parentId = 1, ?string $parentPath = '/1/'): int
    {
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => 'std-plans-' . bin2hex(random_bytes(5)),
            'is_active' => 1,
            'parent_id' => $parentId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $id)->update([
            'path' => $parentPath === null ? '' : $parentPath . $id . '/',
        ]);

        return $id;
    }

    private function makeMember(int $tenantId, ?int $daysSinceLogin, string $status = 'active'): int
    {
        $uid = bin2hex(random_bytes(6));

        return (int) DB::table('users')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => 'Member ' . $uid,
            'first_name' => 'Member',
            'last_name' => 'Test',
            'email' => $uid . '@example.test',
            'status' => $status,
            'role' => 'member',
            'balance' => 0,
            'is_approved' => 1,
            'last_login_at' => $daysSinceLogin === null ? null : now()->subDays($daysSinceLogin),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function assertStandardRowsMatchTheTable(): void
    {
        $this->assertSame(7, DB::table('pay_plans')->where('is_standard', 1)->count());

        foreach (StandardPlans::TIERS as $slug => $tier) {
            $row = DB::table('pay_plans')->where('slug', $slug)->first();
            $this->assertNotNull($row, "standard package {$slug} exists");
            $this->assertSame(1, (int) $row->is_standard, "{$slug}.is_standard");
            $this->assertSame(1, (int) $row->is_active, "{$slug}.is_active");
            $this->assertSame($tier['name'], $row->name, "{$slug}.name");
            $this->assertSame($tier['tier_level'], (int) $row->tier_level, "{$slug}.tier_level");
            $this->assertSame($tier['max_users'], (int) $row->max_users, "{$slug}.max_users");
            $this->assertSame($tier['description'], $row->description, "{$slug}.description");
            $this->assertSame([], json_decode((string) $row->features, true), "{$slug}.features");

            foreach ([
                'price_monthly', 'price_yearly', 'setup_fee',
                'price_monthly_gbp', 'price_yearly_gbp', 'setup_fee_gbp',
            ] as $money) {
                $this->assertEqualsWithDelta((float) $tier[$money], (float) $row->{$money}, 0.001, "{$slug}.{$money}");
            }
            foreach (['max_communities', 'storage_gb', 'emails_per_month'] as $allowance) {
                $this->assertSame($tier[$allowance], (int) $row->{$allowance}, "{$slug}.{$allowance}");
            }
        }
    }

    public function test_the_table_is_the_published_one(): void
    {
        // Spot-check the constant against DESIGN §11.1 so a typo in the single
        // source is not silently copied into the database and the tests alike.
        $this->assertSame(['spark', 'local', 'community', 'growth', 'expansion', 'scale', 'network'], StandardPlans::slugs());
        $this->assertSame(
            [100, 300, 1000, 10000, 20000, 30000, 100000],
            array_values(array_map(fn (array $t) => $t['max_users'], StandardPlans::TIERS))
        );
        $this->assertSame(
            [150, 199, 349, 799, 1399, 1999, 2999],
            array_values(array_map(fn (array $t) => $t['price_monthly_gbp'], StandardPlans::TIERS))
        );
        $this->assertSame(
            [175, 229, 399, 929, 1649, 2299, 3499],
            array_values(array_map(fn (array $t) => $t['price_monthly'], StandardPlans::TIERS))
        );
        $this->assertSame(
            [0, 750, 2500, 4500, 6000, 8000, 10000],
            array_values(array_map(fn (array $t) => $t['setup_fee'], StandardPlans::TIERS))
        );
        $this->assertSame(
            [0, 645, 2150, 3850, 5150, 6900, 8600],
            array_values(array_map(fn (array $t) => $t['setup_fee_gbp'], StandardPlans::TIERS))
        );
        foreach (StandardPlans::TIERS as $slug => $tier) {
            // Annual is ten months' price, in both currencies.
            $this->assertSame($tier['price_monthly'] * 10, $tier['price_yearly'], "{$slug} € yearly");
            $this->assertSame($tier['price_monthly_gbp'] * 10, $tier['price_yearly_gbp'], "{$slug} £ yearly");
        }
        $this->assertSame(90, StandardPlans::ACTIVE_WINDOW_DAYS);
    }

    public function test_the_seven_packages_are_in_the_database_with_the_published_numbers(): void
    {
        $this->assertStandardRowsMatchTheTable();
    }

    public function test_running_the_migration_twice_inserts_nothing_twice(): void
    {
        $migration = $this->migration();
        $migration->up();
        $migration->up();

        $this->assertStandardRowsMatchTheTable();
        foreach (StandardPlans::slugs() as $slug) {
            $this->assertSame(1, DB::table('pay_plans')->where('slug', $slug)->count(), $slug);
        }
    }

    public function test_an_older_plan_is_retired_with_its_price_limit_and_assignment_untouched(): void
    {
        // Put the table back to how production looks before the migration:
        // the four older plans, no standard rows. Rolled back after the test.
        DB::table('pay_plans')->where('is_standard', 1)->delete();

        $oldCommunity = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Community', 'slug' => 'community', 'tier_level' => 1,
            'max_users' => 500, 'price_monthly' => 29, 'price_yearly' => 290,
            'is_active' => 1, 'features' => '[]', 'created_at' => now(),
        ]);
        $oldStarter = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Starter', 'slug' => 'starter', 'tier_level' => 0,
            'max_users' => 50, 'price_monthly' => 0, 'price_yearly' => 0,
            'is_active' => 1, 'features' => '[]', 'created_at' => now(),
        ]);
        $alreadyLegacy = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Old', 'slug' => 'legacy-old', 'tier_level' => 0,
            'max_users' => 10, 'price_monthly' => 1, 'price_yearly' => 10,
            'is_active' => 1, 'features' => '[]', 'created_at' => now(),
        ]);

        $tenantId = $this->makeCommunity('On the old Community plan');
        $assignmentId = (int) DB::table('tenant_plan_assignments')->insertGetId([
            'tenant_id' => $tenantId,
            'pay_plan_id' => $oldCommunity,
            'status' => 'active',
        ]);

        $this->migration()->up();

        $community = DB::table('pay_plans')->where('id', $oldCommunity)->first();
        $this->assertSame("legacy-community-{$oldCommunity}", $community->slug);
        $this->assertSame(0, (int) $community->is_active);
        $this->assertSame(0, (int) $community->is_standard);
        $this->assertSame('Community', $community->name);
        $this->assertSame(500, (int) $community->max_users);
        $this->assertEqualsWithDelta(29.0, (float) $community->price_monthly, 0.001);
        $this->assertEqualsWithDelta(290.0, (float) $community->price_yearly, 0.001);

        $starter = DB::table('pay_plans')->where('id', $oldStarter)->first();
        $this->assertSame('legacy-starter', $starter->slug);
        $this->assertSame(0, (int) $starter->is_active);
        $this->assertSame(50, (int) $starter->max_users);

        $legacy = DB::table('pay_plans')->where('id', $alreadyLegacy)->first();
        $this->assertSame('legacy-old', $legacy->slug, 'an already-legacy slug is not prefixed twice');
        $this->assertSame(0, (int) $legacy->is_active);

        $this->assertSame(
            $oldCommunity,
            (int) DB::table('tenant_plan_assignments')->where('id', $assignmentId)->value('pay_plan_id'),
            'the community keeps exactly the plan it had'
        );

        $this->assertStandardRowsMatchTheTable();
        $this->assertNotSame($oldCommunity, (int) DB::table('pay_plans')->where('slug', 'community')->value('id'));
    }

    /** @return array<string, array{int, ?string}> */
    public static function memberCounts(): array
    {
        return [
            'none' => [0, 'spark'],
            'spark limit' => [100, 'spark'],
            'one over spark' => [101, 'local'],
            'local limit' => [300, 'local'],
            'one over local' => [301, 'community'],
            'community limit' => [1000, 'community'],
            'one over community' => [1001, 'growth'],
            'network limit' => [100000, 'network'],
            'above every package' => [100001, null],
        ];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('memberCounts')]
    public function test_the_suggested_package_is_the_smallest_that_fits(int $members, ?string $expected): void
    {
        $this->assertSame($expected, StandardPlans::slugForMemberCount($members));
    }

    public function test_active_members_are_those_signed_in_within_ninety_days_across_the_branch(): void
    {
        $parent = $this->makeCommunity('Active count parent');
        $child = $this->makeCommunity('Active count child', $parent, "/1/{$parent}/");

        $this->makeMember($parent, 10);            // counts
        $this->makeMember($parent, 120);           // signed in too long ago
        $this->makeMember($parent, null);          // never signed in
        $this->makeMember($parent, 10, 'suspended'); // not an active account
        $this->makeMember($child, 5);              // counts: the parent pays for its branch

        $this->assertSame(2, TenantBillingService::getSubtreeActiveMemberCount($parent));
        $this->assertSame(1, TenantBillingService::getSubtreeActiveMemberCount($child));
        $this->assertSame(1, TenantBillingService::getSubtreeActiveMemberCount($parent, 7), 'the window is a parameter');
    }

    public function test_an_empty_path_counts_only_the_community_own_members(): void
    {
        $pathless = $this->makeCommunity('Pathless active count', 1, null);
        $this->makeMember($pathless, 3);

        // A stranger with a real path and recent members: an empty-prefix LIKE
        // would sweep these in and bill the pathless community for them.
        $stranger = $this->makeCommunity('Stranger with a path');
        $this->makeMember($stranger, 1);
        $this->makeMember($stranger, 2);

        $this->assertSame(1, TenantBillingService::getSubtreeActiveMemberCount($pathless));
    }

    public function test_the_snapshot_sizes_each_community_by_active_members(): void
    {
        $limited = $this->makeCommunity('Snapshot limited');
        $planId = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Two-member plan', 'slug' => 'two-member-' . bin2hex(random_bytes(4)),
            'max_users' => 2, 'price_monthly' => 10, 'price_yearly' => 100, 'created_at' => now(),
        ]);
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $limited, 'pay_plan_id' => $planId, 'status' => 'active',
        ]);
        // Three registered members, only one of them active: the limit is about
        // active members, so this community is NOT over it.
        $this->makeMember($limited, 1);
        $this->makeMember($limited, 200);
        $this->makeMember($limited, null);

        $over = $this->makeCommunity('Snapshot over');
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $over, 'pay_plan_id' => $planId, 'status' => 'active',
        ]);
        $this->makeMember($over, 1);
        $this->makeMember($over, 2);
        $this->makeMember($over, 3);

        $noPlan = $this->makeCommunity('Snapshot no plan');
        $this->makeMember($noPlan, 1);

        $rows = collect(TenantBillingService::getBillingSnapshot())->keyBy('id');

        $row = $rows[$limited];
        $this->assertSame(3, $row['subtree_user_count'], 'registered members are still reported');
        $this->assertSame(1, $row['active_member_count']);
        $this->assertSame(50, $row['usage_percent']);
        $this->assertFalse($row['over_limit']);
        $this->assertSame('spark', $row['suggested_plan']);
        $this->assertArrayHasKey('max_communities', $row['current_plan']);
        $this->assertArrayHasKey('is_standard', $row['current_plan']);
        $this->assertFalse($row['current_plan']['is_standard']);
        $this->assertNull($row['current_plan']['max_communities']);

        $this->assertSame(3, $rows[$over]['active_member_count']);
        $this->assertSame(150, $rows[$over]['usage_percent']);
        $this->assertTrue($rows[$over]['over_limit']);

        $this->assertSame(1, $rows[$noPlan]['active_member_count']);
        $this->assertNull($rows[$noPlan]['usage_percent'], 'no plan, no percentage');
        $this->assertFalse($rows[$noPlan]['over_limit']);
    }

    public function test_a_standard_plan_reports_its_allowances_in_the_snapshot(): void
    {
        $tenantId = $this->makeCommunity('On Local');
        $localId = (int) DB::table('pay_plans')->where('slug', 'local')->value('id');
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $tenantId, 'pay_plan_id' => $localId, 'status' => 'active',
        ]);

        $row = collect(TenantBillingService::getBillingSnapshot())->firstWhere('id', $tenantId);

        $this->assertTrue($row['current_plan']['is_standard']);
        $this->assertSame(1, $row['current_plan']['max_communities']);
        $this->assertSame(300, $row['current_plan']['max_users']);
        $this->assertSame(0, $row['usage_percent']);
    }
}
