<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Core\TenantContext;
use App\Support\Billing\BillingLock;
use App\Support\Billing\PlanTerms;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * The plan that applies to a community: the plan it is assigned to and, when
 * it pays its parent, that parent's changes on top. Only the direct parent's;
 * a community that pays the platform is always on the default terms.
 *
 * Tree:  hub ─ child ─ grandchild        platformPayer (directly under tenant 1)
 */
final class PlanTermsResolverTest extends TestCase
{
    use DatabaseTransactions;

    private int $hub;
    private int $child;
    private int $grandchild;
    private int $platformPayer;
    /** @var array<string, mixed> */
    private array $local;

    protected function setUp(): void
    {
        parent::setUp();
        BillingLock::flush();
        PlanTerms::flush();

        $this->hub = $this->makeCommunity('Terms hub', 1, '/1/', true);
        $this->child = $this->makeCommunity('Terms child', $this->hub, "/1/{$this->hub}/", true);
        $this->grandchild = $this->makeCommunity('Terms grandchild', $this->child, "/1/{$this->hub}/{$this->child}/");
        $this->platformPayer = $this->makeCommunity('Terms platform payer', 1, '/1/');

        $local = null;
        foreach (PlanTerms::defaults() as $plan) {
            if ($plan['slug'] === 'local') {
                $local = $plan;
            }
        }
        $this->assertNotNull($local, 'The seeded Local plan must exist.');
        $this->local = $local;
    }

    protected function tearDown(): void
    {
        // parent::tearDown() rolls the transaction back; it must always run.
        try {
            BillingLock::flush();
            PlanTerms::flush();
        } finally {
            parent::tearDown();
        }
    }

    private function makeCommunity(string $name, int $parentId, string $parentPath, bool $hub = false, ?string $currency = null): int
    {
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => 'terms-' . bin2hex(random_bytes(5)),
            'is_active' => 1,
            'parent_id' => $parentId,
            'allows_subtenants' => $hub ? 1 : 0,
            'depth' => substr_count($parentPath, '/') - 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $id)->update(['path' => "{$parentPath}{$id}/"]);

        if ($currency !== null) {
            DB::table('tenant_settings')->insert([
                'tenant_id' => $id,
                'setting_key' => 'general.default_currency',
                'setting_value' => $currency,
            ]);
        }

        return $id;
    }

    private function assign(int $tenantId, int $planId, string $status = 'active'): void
    {
        DB::table('tenant_plan_assignments')->where('tenant_id', $tenantId)->delete();
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $tenantId,
            'pay_plan_id' => $planId,
            'status' => $status,
        ]);
    }

    /** @param array<string, mixed> $values */
    private function hubTerms(int $hubId, int $planId, array $values): void
    {
        DB::table('hub_plan_terms')->insert($values + [
            'hub_tenant_id' => $hubId,
            'pay_plan_id' => $planId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        PlanTerms::flush();
    }

    private function planId(string $slug): int
    {
        return (int) DB::table('pay_plans')->where('slug', $slug)->value('id');
    }

    public function test_a_community_with_no_hub_changes_is_on_the_default_terms(): void
    {
        $this->assign($this->child, $this->local['plan_id']);

        $terms = PlanTerms::forCommunity($this->child);

        $this->assertNotNull($terms);
        $this->assertSame([
            'plan_id', 'slug', 'name', 'description', 'max_users', 'currency',
            'price_monthly', 'price_yearly', 'setup_fee', 'terms', 'hub_tenant_id', 'is_standard',
        ], array_keys($terms));
        $this->assertSame('default', $terms['terms']);
        $this->assertNull($terms['hub_tenant_id']);
        $this->assertSame('eur', $terms['currency']);
        $this->assertSame($this->local['name'], $terms['name']);
        $this->assertSame($this->local['max_users'], $terms['max_users']);
        $this->assertSame($this->local['price_monthly'], $terms['price_monthly']);
        $this->assertSame($this->local['setup_fee'], $terms['setup_fee']);
        $this->assertTrue($terms['is_standard']);
    }

    public function test_the_hubs_changes_apply_field_by_field(): void
    {
        $this->assign($this->child, $this->local['plan_id']);
        $this->hubTerms($this->hub, $this->local['plan_id'], ['max_users' => 50]);

        $terms = PlanTerms::forCommunity($this->child);

        $this->assertSame('hub', $terms['terms']);
        $this->assertSame($this->hub, $terms['hub_tenant_id']);
        $this->assertSame(50, $terms['max_users']);
        // Only the member number was changed: everything else follows the default.
        $this->assertSame($this->local['name'], $terms['name']);
        $this->assertSame($this->local['description'], $terms['description']);
        $this->assertSame($this->local['price_monthly'], $terms['price_monthly']);
        $this->assertSame($this->local['price_yearly'], $terms['price_yearly']);
        $this->assertSame($this->local['setup_fee'], $terms['setup_fee']);

        DB::table('hub_plan_terms')->where('hub_tenant_id', $this->hub)->update([
            'name' => 'Hub local', 'price_monthly' => 12.5, 'description' => 'Ours',
        ]);
        PlanTerms::flush();

        $terms = PlanTerms::forCommunity($this->child);
        $this->assertSame('Hub local', $terms['name']);
        $this->assertSame('Ours', $terms['description']);
        $this->assertSame(12.5, $terms['price_monthly']);
        $this->assertSame($this->local['price_yearly'], $terms['price_yearly']);
        $this->assertSame(50, $terms['max_users']);
    }

    public function test_only_the_direct_parents_changes_apply(): void
    {
        $this->assign($this->grandchild, $this->local['plan_id']);
        // The grandparent (hub) changed Local; the direct parent (child) did not.
        $this->hubTerms($this->hub, $this->local['plan_id'], ['max_users' => 50, 'name' => 'Grandparent local']);

        $terms = PlanTerms::forCommunity($this->grandchild);
        $this->assertSame('default', $terms['terms']);
        $this->assertSame($this->local['max_users'], $terms['max_users']);
        $this->assertSame($this->local['name'], $terms['name']);

        // The direct parent's own change does apply.
        $this->hubTerms($this->child, $this->local['plan_id'], ['max_users' => 70]);
        $terms = PlanTerms::forCommunity($this->grandchild);
        $this->assertSame('hub', $terms['terms']);
        $this->assertSame($this->child, $terms['hub_tenant_id']);
        $this->assertSame(70, $terms['max_users']);
        $this->assertSame($this->local['name'], $terms['name'], 'Every hub starts from the defaults, not from the hub above it.');
    }

    public function test_a_community_that_pays_the_platform_is_never_on_hub_terms(): void
    {
        $this->assign($this->platformPayer, $this->local['plan_id']);
        // A row against tenant 1 (which has no hub terms) and a stored payer
        // of "parent" must not move a community directly under tenant 1.
        $this->hubTerms(1, $this->local['plan_id'], ['max_users' => 5]);
        DB::table('tenant_billing_standing')->insert([
            'tenant_id' => $this->platformPayer, 'payer' => 'parent', 'created_at' => now(), 'updated_at' => now(),
        ]);
        BillingLock::flush();

        $terms = PlanTerms::forCommunity($this->platformPayer);
        $this->assertSame('default', $terms['terms']);
        $this->assertSame($this->local['max_users'], $terms['max_users']);
    }

    public function test_a_community_that_stops_paying_its_parent_is_on_default_terms_at_once(): void
    {
        $this->assign($this->child, $this->local['plan_id']);
        $this->hubTerms($this->hub, $this->local['plan_id'], ['max_users' => 50]);
        $this->assertSame(50, PlanTerms::forCommunity($this->child)['max_users']);

        DB::table('tenant_billing_standing')->insert([
            'tenant_id' => $this->child, 'payer' => 'platform_invoice', 'created_at' => now(), 'updated_at' => now(),
        ]);
        BillingLock::flush();

        $terms = PlanTerms::forCommunity($this->child);
        $this->assertSame('default', $terms['terms']);
        $this->assertSame($this->local['max_users'], $terms['max_users']);
    }

    public function test_a_pound_community_gets_the_pound_values(): void
    {
        $poundChild = $this->makeCommunity('Terms pound child', $this->hub, "/1/{$this->hub}/", false, 'gbp');
        $this->assign($poundChild, $this->local['plan_id']);
        $this->hubTerms($this->hub, $this->local['plan_id'], ['price_monthly_gbp' => 99, 'price_monthly' => 111]);

        TenantContext::setById($this->hub);
        $terms = PlanTerms::forCommunity($poundChild);

        $this->assertSame('gbp', $terms['currency']);
        $this->assertSame(99.0, $terms['price_monthly']);
        $this->assertSame($this->local['price_yearly_gbp'], $terms['price_yearly']);
        $this->assertSame($this->local['setup_fee_gbp'], $terms['setup_fee']);
        $this->assertSame($this->hub, TenantContext::currentId(), 'The caller\'s community is left as it was.');
    }

    public function test_no_active_assignment_is_null(): void
    {
        $this->assertNull(PlanTerms::forCommunity($this->child));

        $this->assign($this->child, $this->local['plan_id'], 'cancelled');
        $this->assertNull(PlanTerms::forCommunity($this->child));
    }

    public function test_available_to_leaves_out_a_plan_the_hub_does_not_offer(): void
    {
        $growth = $this->planId('growth');
        $this->hubTerms($this->hub, $growth, ['is_offered' => 0]);

        $forChild = array_column(PlanTerms::availableTo($this->child), 'plan_id');
        $this->assertNotContains($growth, $forChild);
        $this->assertContains($this->local['plan_id'], $forChild);

        // A community that pays the platform is offered every default plan.
        $forPlatformPayer = array_column(PlanTerms::availableTo($this->platformPayer), 'plan_id');
        $this->assertSame(array_column(PlanTerms::defaults(), 'plan_id'), $forPlatformPayer);

        $first = PlanTerms::availableTo($this->child)[0];
        $this->assertArrayHasKey('currency', $first);
        $this->assertArrayNotHasKey('price_monthly_gbp', $first);
    }

    public function test_offered_by_marks_what_the_hub_changed(): void
    {
        $this->hubTerms($this->hub, $this->local['plan_id'], ['max_users' => 50, 'price_yearly_gbp' => 1000]);
        $this->hubTerms($this->hub, $this->planId('growth'), ['is_offered' => 0]);
        $this->assign($this->child, $this->local['plan_id']);

        $plans = [];
        foreach (PlanTerms::offeredBy($this->hub) as $plan) {
            $plans[$plan['slug']] = $plan;
        }

        $local = $plans['local'];
        $this->assertTrue($local['changed']);
        $this->assertSame(['max_users', 'price_yearly_gbp'], $local['changed_fields']);
        $this->assertSame(50, $local['max_users']);
        $this->assertSame(1000.0, $local['price_yearly_gbp']);
        $this->assertSame($this->local['max_users'], $local['default']['max_users']);
        $this->assertSame($this->local['price_yearly_gbp'], $local['default']['price_yearly_gbp']);
        $this->assertTrue($local['is_offered']);
        $this->assertSame(1, $local['communities_on_plan']);

        $this->assertFalse($plans['growth']['is_offered']);
        $this->assertTrue($plans['growth']['changed']);
        $this->assertSame(['is_offered'], $plans['growth']['changed_fields']);

        $this->assertFalse($plans['spark']['changed']);
        $this->assertSame([], $plans['spark']['changed_fields']);
        $this->assertSame(0, $plans['spark']['communities_on_plan']);
    }

    public function test_smallest_fitting_uses_the_hubs_member_numbers(): void
    {
        $spark = $this->planId('spark');
        // The hub allows 400 on Spark: 350 active members fit Spark for its child.
        $this->hubTerms($this->hub, $spark, ['max_users' => 400]);

        $this->assertSame($spark, PlanTerms::smallestFitting($this->child, 350)['plan_id']);
        $this->assertSame(400, PlanTerms::smallestFitting($this->child, 350)['max_users']);

        // On the defaults, 350 is past Spark (100) and Local (300).
        $this->assertSame($this->planId('community'), PlanTerms::smallestFitting($this->platformPayer, 350)['plan_id']);

        // Above the largest plan: nothing fits.
        $this->assertNull(PlanTerms::smallestFitting($this->platformPayer, PHP_INT_MAX));
    }
}
