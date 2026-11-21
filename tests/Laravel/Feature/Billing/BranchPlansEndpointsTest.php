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
use App\Support\Billing\BillingLock;
use App\Support\Billing\PlanTerms;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * A hub's own version of the default plans, edited on Branch plans.
 *
 * The reach rule is the owner's (below, never above, never beside), with one
 * addition for these hub-level settings only: a manager may edit its OWN
 * community's version, because those terms are about the communities below
 * it. Tenant 1 has no version, for anyone. Pinned at both ends.
 *
 * Tree:  hub ─ child ─ grandchild        other (a second hub, beside `hub`)
 *            └ sibling                        └ otherChild
 */
final class BranchPlansEndpointsTest extends TestCase
{
    use DatabaseTransactions;

    private const HUB_PLAN_KEYS = [
        'plan_id', 'slug', 'name', 'description', 'max_users',
        'price_monthly', 'price_yearly', 'setup_fee',
        'price_monthly_gbp', 'price_yearly_gbp', 'setup_fee_gbp',
        'is_offered', 'changed', 'changed_fields', 'default', 'communities_on_plan',
    ];

    private const DEFAULT_KEYS = [
        'name', 'description', 'max_users',
        'price_monthly', 'price_yearly', 'setup_fee',
        'price_monthly_gbp', 'price_yearly_gbp', 'setup_fee_gbp',
    ];

    private int $hub;
    private int $child;
    private int $grandchild;
    private int $sibling;
    private int $other;
    private int $otherChild;
    private int $local;

    protected function setUp(): void
    {
        parent::setUp();

        $this->hub = $this->makeCommunity('Plans hub', 1, '/1/', true);
        $this->child = $this->makeCommunity('Plans child', $this->hub, "/1/{$this->hub}/", true);
        $this->grandchild = $this->makeCommunity('Plans grandchild', $this->child, "/1/{$this->hub}/{$this->child}/");
        $this->sibling = $this->makeCommunity('Plans sibling', $this->hub, "/1/{$this->hub}/", true);
        $this->other = $this->makeCommunity('Plans other hub', 1, '/1/', true);
        $this->otherChild = $this->makeCommunity('Plans other child', $this->other, "/1/{$this->other}/", true);
        $this->local = (int) DB::table('pay_plans')->where('slug', 'local')->value('id');

        BillingLock::flush();
        PlanTerms::flush();
    }

    protected function tearDown(): void
    {
        // parent::tearDown() rolls the transaction back; it must always run.
        try {
            BillingLock::flush();
            PlanTerms::flush();
            SuperPanelAccess::reset();
        } finally {
            parent::tearDown();
        }
    }

    private function makeCommunity(string $name, int $parentId, string $parentPath, bool $hub = false): int
    {
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => 'plans-' . bin2hex(random_bytes(5)),
            'is_active' => 1,
            'parent_id' => $parentId,
            'allows_subtenants' => $hub ? 1 : 0,
            'depth' => substr_count($parentPath, '/') - 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $id)->update(['path' => "{$parentPath}{$id}/"]);

        return $id;
    }

    /** @param array<string, mixed> $attributes */
    private function signInTo(int $tenantId, array $attributes): User
    {
        $this->testTenantId = $tenantId;

        $user = User::factory()->forTenant($tenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $attributes));
        Sanctum::actingAs($user, ['*']);
        TenantContext::setById($tenantId);
        SuperPanelAccess::reset();

        return $user;
    }

    private function asManagerOf(int $tenantId): User
    {
        return $this->signInTo($tenantId, ['role' => 'admin', 'is_tenant_super_admin' => true]);
    }

    private function row(int $hubId, int $planId): ?object
    {
        return DB::table('hub_plan_terms')->where('hub_tenant_id', $hubId)->where('pay_plan_id', $planId)->first();
    }

    /** @return list<object> */
    private function audit(int $tenantId): array
    {
        return DB::table('billing_audit_log')->where('tenant_id', $tenantId)->where('action', 'hub_plan_terms_changed')->orderBy('id')->get()->all();
    }

    private function assign(int $tenantId, int $planId): void
    {
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $tenantId,
            'pay_plan_id' => $planId,
            'status' => 'active',
        ]);
    }

    // ── The door opens ──────────────────────────────────────────────────────

    public function test_a_manager_edits_its_own_hubs_plans(): void
    {
        $manager = $this->asManagerOf($this->hub);

        $response = $this->apiPut("/v2/admin/super/branch-plans/{$this->hub}/plans/{$this->local}", [
            'max_users' => 50,
            'price_monthly_gbp' => '120.456',
            'name' => 'Our local',
        ]);

        $response->assertStatus(200);
        $row = $this->row($this->hub, $this->local);
        $this->assertNotNull($row);
        $this->assertSame(50, (int) $row->max_users);
        $this->assertSame('120.46', (string) $row->price_monthly_gbp);
        $this->assertSame('Our local', $row->name);
        $this->assertNull($row->price_monthly, 'A field not sent follows the default.');
        $this->assertSame((int) $manager->id, (int) $row->updated_by_user_id);

        $plan = $response->json('data.plan');
        $this->assertSame(50, $plan['max_users']);
        $this->assertTrue($plan['changed']);

        $audit = $this->audit($this->hub);
        $this->assertCount(1, $audit);
        $this->assertSame((int) $manager->id, (int) $audit[0]->acted_by_user_id);
        $this->assertNull($audit[0]->old_value);
        $this->assertSame(50, json_decode((string) $audit[0]->new_value, true)['max_users']);
    }

    public function test_a_manager_above_edits_a_hub_below_it(): void
    {
        $this->asManagerOf($this->hub);

        $this->apiPut("/v2/admin/super/branch-plans/{$this->child}/plans/{$this->local}", ['max_users' => 40])
            ->assertStatus(200);
        $this->assertSame(40, (int) $this->row($this->child, $this->local)->max_users);
    }

    public function test_the_platform_team_edits_any_hub(): void
    {
        $this->signInTo($this->hub, ['role' => 'admin', 'is_super_admin' => true, 'is_god' => true]);

        foreach ([$this->other, $this->otherChild, $this->hub] as $hubId) {
            $this->apiPut("/v2/admin/super/branch-plans/{$hubId}/plans/{$this->local}", ['max_users' => 77])
                ->assertStatus(200);
            $this->assertSame(77, (int) $this->row($hubId, $this->local)->max_users);
        }
    }

    // ── The door stays shut ─────────────────────────────────────────────────

    public function test_a_manager_cannot_edit_a_hub_that_is_not_its_own_or_below_it(): void
    {
        $this->asManagerOf($this->child);

        $notInReach = [
            'its parent' => $this->hub,
            'a sibling hub' => $this->sibling,
            'its parent\'s sibling' => $this->other,
            'another hub\'s child' => $this->otherChild,
            'the platform community' => 1,
            'a community that does not exist' => 999999991,
        ];

        foreach ($notInReach as $what => $target) {
            foreach (['put', 'delete', 'get'] as $verb) {
                $response = match ($verb) {
                    'put' => $this->apiPut("/v2/admin/super/branch-plans/{$target}/plans/{$this->local}", ['max_users' => 5]),
                    'delete' => $this->apiDelete("/v2/admin/super/branch-plans/{$target}/plans/{$this->local}"),
                    'get' => $this->apiGet("/v2/admin/super/branch-plans?hub_id={$target}"),
                };
                $this->assertSame(404, $response->getStatusCode(), "{$verb} on {$what}: got {$response->getStatusCode()}");
                $this->assertSame('NOT_IN_REACH', $response->json('errors.0.code'), "{$verb} on {$what}");
            }
            $this->assertNull($this->row($target, $this->local), "{$what} was written");
        }
    }

    public function test_out_of_reach_and_does_not_exist_are_answered_identically(): void
    {
        $this->asManagerOf($this->child);

        $outOfReach = $this->apiPut("/v2/admin/super/branch-plans/{$this->sibling}/plans/{$this->local}", ['max_users' => 5]);
        $missing = $this->apiPut("/v2/admin/super/branch-plans/999999991/plans/{$this->local}", ['max_users' => 5]);

        $this->assertSame($outOfReach->getStatusCode(), $missing->getStatusCode());
        $this->assertSame($outOfReach->json('errors'), $missing->json('errors'));
    }

    public function test_nobody_has_a_version_for_the_platform_community(): void
    {
        $this->signInTo($this->hub, ['role' => 'admin', 'is_super_admin' => true, 'is_god' => true]);

        $response = $this->apiPut("/v2/admin/super/branch-plans/1/plans/{$this->local}", ['max_users' => 5]);
        $response->assertStatus(404);
        $this->assertSame('NOT_IN_REACH', $response->json('errors.0.code'));
        $this->assertNull($this->row(1, $this->local));

        $this->assertNotContains(1, array_column($this->apiGet('/v2/admin/super/branch-plans')->json('data.hubs'), 'id'));
    }

    /** @return array<string, array{0: array<string, mixed>}> */
    public static function notManagers(): array
    {
        return [
            'a community admin' => [['role' => 'admin']],
            'a broker' => [['role' => 'broker']],
            'a member' => [['role' => 'member']],
        ];
    }

    /** @param array<string, mixed> $attributes */
    #[\PHPUnit\Framework\Attributes\DataProvider('notManagers')]
    public function test_nobody_below_a_manager_can_see_or_change_anything(array $attributes): void
    {
        $this->signInTo($this->hub, $attributes);

        $this->assertSame(403, $this->apiGet('/v2/admin/super/branch-plans')->getStatusCode());
        $this->assertSame(403, $this->apiPut("/v2/admin/super/branch-plans/{$this->hub}/plans/{$this->local}", ['max_users' => 5])->getStatusCode());
        $this->assertSame(403, $this->apiDelete("/v2/admin/super/branch-plans/{$this->hub}/plans/{$this->local}")->getStatusCode());
        $this->assertNull($this->row($this->hub, $this->local));
    }

    // ── What is stored ──────────────────────────────────────────────────────

    public function test_a_plan_that_is_not_an_active_standard_plan_is_not_found(): void
    {
        $this->asManagerOf($this->hub);
        $custom = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Custom plan', 'slug' => 'custom-' . bin2hex(random_bytes(4)),
            'is_standard' => 0, 'is_active' => 1, 'created_at' => now(),
        ]);
        $retired = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Retired plan', 'slug' => 'retired-' . bin2hex(random_bytes(4)),
            'is_standard' => 1, 'is_active' => 0, 'created_at' => now(),
        ]);
        PlanTerms::flush();

        foreach ([$custom, $retired, 999999991] as $planId) {
            $response = $this->apiPut("/v2/admin/super/branch-plans/{$this->hub}/plans/{$planId}", ['max_users' => 5]);
            $response->assertStatus(404);
            $this->assertSame('NOT_FOUND', $response->json('errors.0.code'));
        }
    }

    public function test_a_plan_a_paying_child_is_on_cannot_be_hidden(): void
    {
        $this->asManagerOf($this->hub);
        $this->assign($this->child, $this->local);

        $response = $this->apiPut("/v2/admin/super/branch-plans/{$this->hub}/plans/{$this->local}", ['is_offered' => false]);

        $response->assertStatus(422);
        $this->assertSame('PLAN_IN_USE', $response->json('errors.0.code'));
        $this->assertNull($this->row($this->hub, $this->local));

        // A plan nobody paying the hub is on can be hidden.
        $growth = (int) DB::table('pay_plans')->where('slug', 'growth')->value('id');
        $this->apiPut("/v2/admin/super/branch-plans/{$this->hub}/plans/{$growth}", ['is_offered' => false])->assertStatus(200);
        $this->assertSame(0, (int) $this->row($this->hub, $growth)->is_offered);
    }

    public function test_the_largest_allowed_values_are_stored(): void
    {
        $this->asManagerOf($this->hub);

        $this->apiPut("/v2/admin/super/branch-plans/{$this->hub}/plans/{$this->local}", [
            'max_users' => 10000000,
            'price_yearly' => '99999999.99',
            'name' => str_repeat('x', 100),
            'description' => str_repeat('y', 5000),
        ])->assertStatus(200);

        $row = $this->row($this->hub, $this->local);
        $this->assertSame(10000000, (int) $row->max_users);
        $this->assertSame('99999999.99', (string) $row->price_yearly);
    }

    public function test_the_write_itself_refuses_to_hide_a_plan_in_use(): void
    {
        // The check sits inside the write's transaction, not only in the
        // controller, so a child put on the plan meanwhile is still seen.
        $this->asManagerOf($this->hub);
        $this->assign($this->child, $this->local);

        try {
            \App\Support\Billing\BranchPlans::saveTerms($this->hub, $this->local, [], false, 1);
            $this->fail('Hiding a plan a paying child is on was allowed.');
        } catch (\DomainException $e) {
            $this->assertSame(\App\Support\Billing\BranchPlans::PLAN_IN_USE, $e->getMessage());
        }
        $this->assertNull($this->row($this->hub, $this->local));
        $this->assertCount(0, $this->audit($this->hub));
    }

    public function test_saving_over_an_existing_row_and_saving_a_new_one_both_audit_once(): void
    {
        $this->asManagerOf($this->hub);

        \App\Support\Billing\BranchPlans::saveTerms($this->hub, $this->local, ['max_users' => 40], null, 1);
        \App\Support\Billing\BranchPlans::saveTerms($this->hub, $this->local, ['price_monthly' => 9.5], null, 1);

        $row = $this->row($this->hub, $this->local);
        $this->assertSame(40, (int) $row->max_users);
        $this->assertSame('9.50', (string) $row->price_monthly);
        $audit = $this->audit($this->hub);
        $this->assertCount(2, $audit);
        $this->assertNull($audit[0]->old_value);
        $this->assertSame(40, json_decode((string) $audit[1]->old_value, true)['max_users']);
        $this->assertSame(1, DB::table('hub_plan_terms')->where('hub_tenant_id', $this->hub)->count());
    }

    public function test_a_row_with_nothing_changed_is_deleted_not_stored(): void
    {
        $this->asManagerOf($this->hub);
        $this->apiPut("/v2/admin/super/branch-plans/{$this->hub}/plans/{$this->local}", ['max_users' => 50])->assertStatus(200);
        $this->assertNotNull($this->row($this->hub, $this->local));

        $response = $this->apiPut("/v2/admin/super/branch-plans/{$this->hub}/plans/{$this->local}", ['max_users' => null, 'is_offered' => true]);

        $response->assertStatus(200);
        $this->assertNull($this->row($this->hub, $this->local));
        $this->assertFalse($response->json('data.plan.changed'));
        $this->assertCount(2, $this->audit($this->hub));
    }

    public function test_invalid_values_are_refused_and_nothing_is_written(): void
    {
        $this->asManagerOf($this->hub);

        foreach ([
            ['max_users' => 0],
            ['max_users' => 'many'],
            ['price_monthly' => -1],
            ['setup_fee_gbp' => 'free'],
            ['name' => str_repeat('x', 101)],
            ['description' => str_repeat('x', 5001)],
            ['max_users' => 10000001],
            ['price_yearly' => '100000000'],
            ['setup_fee_gbp' => 99999999.999],
            ['is_offered' => 'perhaps'],
        ] as $body) {
            $response = $this->apiPut("/v2/admin/super/branch-plans/{$this->hub}/plans/{$this->local}", $body);
            $this->assertSame(422, $response->getStatusCode(), json_encode($body));
            $this->assertSame((string) array_key_first($body), $response->json('errors.0.field'));
        }

        $this->assertSame(422, $this->apiPut("/v2/admin/super/branch-plans/{$this->hub}/plans/{$this->local}", [])->getStatusCode());
        $this->assertNull($this->row($this->hub, $this->local));
        $this->assertCount(0, $this->audit($this->hub));
    }

    public function test_delete_puts_the_plan_back_to_standard(): void
    {
        $this->asManagerOf($this->hub);
        $this->apiPut("/v2/admin/super/branch-plans/{$this->hub}/plans/{$this->local}", ['max_users' => 50])->assertStatus(200);

        $response = $this->apiDelete("/v2/admin/super/branch-plans/{$this->hub}/plans/{$this->local}");
        $response->assertStatus(200);
        $this->assertNull($this->row($this->hub, $this->local));
        $this->assertFalse($response->json('data.plan.changed'));
        $this->assertCount(2, $this->audit($this->hub));

        // Again: nothing to remove, nothing audited.
        $this->apiDelete("/v2/admin/super/branch-plans/{$this->hub}/plans/{$this->local}")->assertStatus(200);
        $this->assertCount(2, $this->audit($this->hub));
    }

    public function test_a_change_is_seen_at_once_by_the_resolver(): void
    {
        $this->asManagerOf($this->hub);
        $this->assign($this->child, $this->local);
        $before = PlanTerms::forCommunity($this->child);

        $this->apiPut("/v2/admin/super/branch-plans/{$this->hub}/plans/{$this->local}", ['max_users' => 55])->assertStatus(200);
        $this->assertSame(55, PlanTerms::forCommunity($this->child)['max_users']);

        $this->apiDelete("/v2/admin/super/branch-plans/{$this->hub}/plans/{$this->local}")->assertStatus(200);
        $this->assertSame($before['max_users'], PlanTerms::forCommunity($this->child)['max_users']);
    }

    // ── The list ────────────────────────────────────────────────────────────

    public function test_the_list_shape_is_pinned_key_for_key(): void
    {
        $this->asManagerOf($this->hub);
        $this->assign($this->child, $this->local);
        DB::table('hub_plan_terms')->insert([
            'hub_tenant_id' => $this->hub, 'pay_plan_id' => $this->local, 'max_users' => 50,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        PlanTerms::flush();

        $response = $this->apiGet('/v2/admin/super/branch-plans');
        $response->assertStatus(200);

        $this->assertSame(['hubs', 'hub_id', 'hub_currency', 'plans'], array_keys($response->json('data')));
        $this->assertSame($this->hub, $response->json('data.hub_id'), 'With no hub_id: the caller\'s own community.');
        $this->assertSame('eur', $response->json('data.hub_currency'));

        $hubs = $response->json('data.hubs');
        $this->assertSame([$this->hub, $this->child, $this->sibling], array_column($hubs, 'id'));
        foreach ($hubs as $hub) {
            $this->assertSame(['id', 'name', 'depth', 'children_paying'], array_keys($hub));
        }
        $this->assertSame(2, $hubs[0]['children_paying']);
        $this->assertSame(1, $hubs[1]['children_paying']);

        $plans = $response->json('data.plans');
        $this->assertSame(array_column(PlanTerms::defaults(), 'plan_id'), array_column($plans, 'plan_id'));
        foreach ($plans as $plan) {
            $this->assertSame(self::HUB_PLAN_KEYS, array_keys($plan));
            $this->assertSame(self::DEFAULT_KEYS, array_keys($plan['default']));
        }

        $local = collect($plans)->firstWhere('plan_id', $this->local);
        $this->assertSame(50, $local['max_users']);
        $this->assertSame(['max_users'], $local['changed_fields']);
        $this->assertSame(1, $local['communities_on_plan']);

        // Another hub in reach, by hub_id, led by that hub's own currency.
        DB::table('tenant_settings')->insert([
            'tenant_id' => $this->child, 'setting_key' => 'general.default_currency', 'setting_value' => 'GBP',
        ]);
        $forChild = $this->apiGet("/v2/admin/super/branch-plans?hub_id={$this->child}");
        $this->assertSame($this->child, $forChild->json('data.hub_id'));
        $this->assertSame('gbp', $forChild->json('data.hub_currency'));
    }

    public function test_a_hub_with_no_children_yet_still_has_its_own_page(): void
    {
        // A tenant super admin of a community with no children and no
        // sub-community capability has no super panel at all; one with the
        // capability but no children still sees its own community.
        $this->asManagerOf($this->grandchild);
        $this->assertSame(403, $this->apiGet('/v2/admin/super/branch-plans')->getStatusCode());

        $this->asManagerOf($this->sibling);
        $response = $this->apiGet('/v2/admin/super/branch-plans');
        $response->assertStatus(200);
        $this->assertSame($this->sibling, $response->json('data.hub_id'));
        $this->assertSame(0, $response->json('data.hubs.0.children_paying'));
    }
}
