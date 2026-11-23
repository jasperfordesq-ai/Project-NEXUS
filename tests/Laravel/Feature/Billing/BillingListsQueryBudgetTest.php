<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Core\SuperPanelAccess;
use App\Core\TenantContext;
use App\Models\User;
use App\Services\TenantBillingService;
use App\Support\Billing\BillingLock;
use App\Support\Billing\BillingSettings;
use App\Support\Billing\BranchPayments;
use App\Support\Billing\JoiningGate;
use App\Support\Billing\PlanTerms;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * The billing lists do not ask the database more per row than they need
 * (Stage 5 of the billing ease-of-use plan, 23 November 2026).
 *
 * Billing control and Branch payments build one row per community. Each row
 * counted the branch's members with its own queries (two for "active", two
 * for "all"), and Branch payments answered "may this person act on it?" twice.
 * Both member figures are now counted once for the whole list.
 *
 * Two things are pinned: the batched figures are the SAME figures the
 * one-community functions return, and the number of queries each extra row
 * costs does not creep back up. The budgets are what was measured after the
 * change; a change that raises one must say why here. Most of what is left
 * per row is each community's standing, plan terms, currency and over-limit
 * rule, each read on its own.
 */
final class BillingListsQueryBudgetTest extends TestCase
{
    use DatabaseTransactions;

    /** Queries one more community may add to Branch payments (measured: 22; it was 38). */
    private const BRANCH_PAYMENTS_PER_ROW = 22;

    /** Queries one more community may add to Billing control (measured: 24; it was 26). */
    private const BILLING_CONTROL_PER_ROW = 24;

    private int $hub;
    private int $plan;

    protected function setUp(): void
    {
        parent::setUp();
        $this->flushAll();

        $this->hub = $this->makeCommunity('Budget hub', 1, '/1/', true);
        $this->plan = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Budget plan', 'slug' => 'budget-' . bin2hex(random_bytes(4)), 'tier_level' => 1,
            'max_users' => 10, 'price_monthly' => 10, 'price_yearly' => 100,
            'is_active' => 1, 'is_standard' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);
        PlanTerms::flush();
    }

    protected function tearDown(): void
    {
        try {
            $this->flushAll();
        } finally {
            parent::tearDown();
        }
    }

    private function flushAll(): void
    {
        BillingLock::flush();
        BillingSettings::flush();
        PlanTerms::flush();
        JoiningGate::flush();
        SuperPanelAccess::reset();
    }

    private function makeCommunity(string $name, int $parentId, string $parentPath, bool $hub = false): int
    {
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => $name . ' ' . bin2hex(random_bytes(3)), 'slug' => 'budget-' . bin2hex(random_bytes(5)),
            'is_active' => 1, 'parent_id' => $parentId, 'allows_subtenants' => $hub ? 1 : 0,
            'depth' => substr_count($parentPath, '/') - 1, 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $id)->update(['path' => "{$parentPath}{$id}/"]);

        return $id;
    }

    /** A child of the hub on the plan, with members who signed in lately and some who did not. */
    private function addChild(int $active = 2, int $quiet = 1): int
    {
        $id = $this->makeCommunity('Budget child', $this->hub, "/1/{$this->hub}/");
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $id, 'pay_plan_id' => $this->plan, 'status' => 'active',
            'starts_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);
        for ($i = 0; $i < $active + $quiet; $i++) {
            $uid = bin2hex(random_bytes(6));
            DB::table('users')->insert([
                'tenant_id' => $id, 'name' => 'Member ' . $uid, 'first_name' => 'Member', 'last_name' => 'Test',
                'email' => $uid . '@example.test', 'status' => 'active', 'role' => 'member', 'balance' => 0, 'is_approved' => 1,
                'last_login_at' => $i < $active ? now()->subDay() : now()->subDays(400),
                'created_at' => now(), 'updated_at' => now(),
            ]);
        }
        PlanTerms::flush();

        return $id;
    }

    private function asManagerOfTheHub(): void
    {
        $this->testTenantId = $this->hub;
        $user = User::factory()->forTenant($this->hub)->create([
            'status' => 'active', 'is_approved' => true, 'role' => 'admin', 'is_tenant_super_admin' => true,
        ]);
        Sanctum::actingAs($user, ['*']);
        TenantContext::setById($this->hub);
        SuperPanelAccess::reset();
    }

    /** @return list<array<string, mixed>> the Branch payments list, as its page asks for it */
    private function branchRows(): array
    {
        return $this->apiGet('/v2/admin/super/branch-payments')->assertOk()->json('data');
    }

    /**
     * Queries one call makes, once whatever the platform caches between
     * requests is warm (the first call fills it; a real page load finds it
     * filled).
     */
    private function queriesOf(callable $work): int
    {
        $this->flushAll();
        $work();
        $this->flushAll();
        $count = 0;
        $counting = true;
        DB::listen(static function () use (&$count, &$counting): void {
            if ($counting) {
                $count++;
            }
        });
        try {
            $work();
        } finally {
            $counting = false;
        }

        return $count;
    }

    // ── The batched figures are the one-community figures ───────────────────

    public function test_the_lists_member_figures_are_the_one_community_figures(): void
    {
        $a = $this->addChild(3, 2);
        $b = $this->addChild(0, 4);
        $grandchild = $this->makeCommunity('Budget grandchild', $a, "/1/{$this->hub}/{$a}/");
        DB::table('users')->insert([
            'tenant_id' => $grandchild, 'name' => 'Deep member', 'first_name' => 'Deep', 'last_name' => 'Test',
            'email' => bin2hex(random_bytes(6)) . '@example.test', 'status' => 'active', 'role' => 'member', 'balance' => 0,
            'is_approved' => 1, 'last_login_at' => now()->subDay(), 'created_at' => now(), 'updated_at' => now(),
        ]);

        $ids = [$this->hub, $a, $b, $grandchild];
        $active = TenantBillingService::activeMemberCountsForBranches($ids);
        $all = TenantBillingService::allMemberCountsForBranches($ids);
        foreach ($ids as $id) {
            $this->assertSame(TenantBillingService::getSubtreeActiveMemberCount($id), $active[$id], "active members of #{$id}");
            $this->assertSame(TenantBillingService::getSubtreeUserCount($id), $all[$id], "all members of #{$id}");
        }
        $this->assertSame(4, $active[$a], 'a branch includes the communities below it');
        $this->assertSame(6, $all[$a]);
        $this->assertSame(0, $active[$b]);
        $this->assertSame(4, $all[$b]);

        // And each list shows exactly those.
        $this->asManagerOfTheHub();
        $rows = collect($this->branchRows())->keyBy('id');
        foreach ([$a, $b, $grandchild] as $id) {
            $this->assertSame(
                BranchPayments::members($id, $rows[$id]['plan']['max_users'] ?? null),
                $rows[$id]['members'],
                "Branch payments row #{$id}"
            );
        }

        $control = collect(TenantBillingService::getBillingSnapshot())->keyBy('id');
        foreach ($ids as $id) {
            $this->assertSame(TenantBillingService::getSubtreeUserCount($id), $control[$id]['subtree_user_count'], "Billing control row #{$id}");
            $this->assertSame(TenantBillingService::getSubtreeActiveMemberCount($id), $control[$id]['active_member_count']);
        }
    }

    public function test_the_plan_change_reason_on_a_row_is_the_one_the_write_refuses_with(): void
    {
        $plain = $this->addChild();
        $card = $this->addChild();
        // Stored as paying its parent, yet holding a card subscription with
        // the platform: the hub's manager may act on it but not change its plan.
        DB::table('tenant_billing_standing')->insert([
            'tenant_id' => $card, 'payer' => 'parent', 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('tenant_plan_assignments')->where('tenant_id', $card)->update([
            'stripe_subscription_id' => 'sub_budget_card', 'stripe_status' => 'active',
        ]);

        $this->asManagerOfTheHub();
        $rows = collect($this->branchRows())->keyBy('id');

        foreach ([$plain, $card] as $id) {
            $this->assertTrue($rows[$id]['can_act']);
            // The request above settled who is asking, as the write would.
            $this->assertSame(BranchPayments::planChangeRefusalFor($id), $rows[$id]['plan_change_refusal'], "row #{$id}");
        }
        $this->assertNull($rows[$plain]['plan_change_refusal']);
        $this->assertSame(BranchPayments::CARD_SUBSCRIPTION, $rows[$card]['plan_change_refusal']);
    }

    // ── The cost of one more row ────────────────────────────────────────────

    public function test_one_more_community_on_branch_payments_stays_within_its_budget(): void
    {
        $this->addChild();
        $this->addChild();
        $this->asManagerOfTheHub();
        $two = $this->queriesOf(fn () => $this->assertCount(2, $this->branchRows()));

        $this->addChild();
        $this->addChild();
        $this->addChild();
        $five = $this->queriesOf(fn () => $this->assertCount(5, $this->branchRows()));

        $perRow = ($five - $two) / 3;
        if (getenv('SHOW_QUERY_COUNTS')) {
            fwrite(STDERR, "\nBranch payments: {$two} queries for 2 rows, {$five} for 5, {$perRow} per extra row\n");
        }
        $this->assertLessThanOrEqual(self::BRANCH_PAYMENTS_PER_ROW, $perRow, "Branch payments asks {$perRow} queries per extra community");
    }

    public function test_one_more_community_on_billing_control_stays_within_its_budget(): void
    {
        $this->addChild();
        $this->addChild();
        $two = $this->queriesOf(static fn () => TenantBillingService::getBillingSnapshot());

        $this->addChild();
        $this->addChild();
        $this->addChild();
        $five = $this->queriesOf(static fn () => TenantBillingService::getBillingSnapshot());

        $perRow = ($five - $two) / 3;
        if (getenv('SHOW_QUERY_COUNTS')) {
            fwrite(STDERR, "\nBilling control: {$two} queries for 2 rows, {$five} for 5, {$perRow} per extra row\n");
        }
        $this->assertLessThanOrEqual(self::BILLING_CONTROL_PER_ROW, $perRow, "Billing control asks {$perRow} queries per extra community");
    }
}
