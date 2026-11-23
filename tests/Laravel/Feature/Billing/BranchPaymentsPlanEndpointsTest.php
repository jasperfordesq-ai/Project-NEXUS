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
use App\Services\BillingStandingService;
use App\Services\TenantBillingService;
use App\Support\Billing\BillingLock;
use App\Support\Billing\PlanTerms;
use App\Support\Billing\StandardPlans;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * A hub's manager puts a child community (one that pays the hub) on a plan,
 * and Branch payments shows each community's plan and member usage.
 *
 * Allowed exactly where Branch payments already allows a write: in reach,
 * pays its parent, not exempt (BranchPayments::refusalFor). Pinned at both
 * ends, like BranchPaymentsEndpointsTest. Security record E-133.
 *
 * Tree:  hub ─ child ─ grandchild        other (a second hub, beside `hub`)
 *            └ sibling                        └ otherChild
 */
final class BranchPaymentsPlanEndpointsTest extends TestCase
{
    use DatabaseTransactions;

    /** Every key of one Branch payments row, in order: the React types copy it. */
    private const ROW_KEYS = [
        'id', 'name', 'depth', 'parent_id', 'parent_name', 'standing', 'days_late',
        'can_act', 'cannot_act_reason', 'paused_from_above', 'plan', 'members', 'plan_change_refusal',
        // Hub plans Stage 4: the rule for going over (OverLimitRuleEndpointsTest pins its keys).
        'over_limit', 'upgrade_allowed',
    ];

    private const TERMS_KEYS = [
        'plan_id', 'slug', 'name', 'description', 'max_users', 'currency',
        'price_monthly', 'price_yearly', 'setup_fee', 'terms', 'hub_tenant_id', 'is_standard',
    ];

    private int $hub;
    private int $child;
    private int $grandchild;
    private int $sibling;
    private int $other;
    private int $otherChild;
    private int $spark;
    private int $local;
    private int $community;

    protected function setUp(): void
    {
        parent::setUp();
        putenv('MAILER_PER_RECIPIENT_HOURLY_LIMIT=0');

        $this->hub = $this->makeCommunity('Plan hub', 1, '/1/', true);
        $this->child = $this->makeCommunity('Plan child', $this->hub, "/1/{$this->hub}/", true);
        $this->grandchild = $this->makeCommunity('Plan grandchild', $this->child, "/1/{$this->hub}/{$this->child}/");
        $this->sibling = $this->makeCommunity('Plan sibling', $this->hub, "/1/{$this->hub}/");
        $this->other = $this->makeCommunity('Plan other hub', 1, '/1/', true);
        $this->otherChild = $this->makeCommunity('Plan other child', $this->other, "/1/{$this->other}/");

        $this->spark = (int) DB::table('pay_plans')->where('slug', 'spark')->value('id');
        $this->local = (int) DB::table('pay_plans')->where('slug', 'local')->value('id');
        $this->community = (int) DB::table('pay_plans')->where('slug', 'community')->value('id');

        BillingLock::flush();
        PlanTerms::flush();
    }

    protected function tearDown(): void
    {
        putenv('MAILER_PER_RECIPIENT_HOURLY_LIMIT=30');

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
            'slug' => 'planbr-' . bin2hex(random_bytes(5)),
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

    /** @param array<string, mixed> $extra */
    private function assign(int $tenantId, int $planId, array $extra = []): int
    {
        return (int) DB::table('tenant_plan_assignments')->insertGetId(array_merge([
            'tenant_id' => $tenantId,
            'pay_plan_id' => $planId,
            'status' => 'active',
        ], $extra));
    }

    private function planOf(int $tenantId): ?int
    {
        $id = DB::table('tenant_plan_assignments')->where('tenant_id', $tenantId)->where('status', 'active')->value('pay_plan_id');

        return $id !== null ? (int) $id : null;
    }

    /** @return list<object> */
    private function planAudit(int $tenantId): array
    {
        return DB::table('billing_audit_log')->where('tenant_id', $tenantId)->where('action', 'plan_changed')->orderBy('id')->get()->all();
    }

    /** @param array<string, mixed> $values */
    private function hubTerms(int $hubId, int $planId, array $values): void
    {
        DB::table('hub_plan_terms')->insert(array_merge([
            'hub_tenant_id' => $hubId,
            'pay_plan_id' => $planId,
            'is_offered' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ], $values));
        PlanTerms::flush();
    }

    private function activeMembers(int $tenantId, int $count): void
    {
        for ($i = 0; $i < $count; $i++) {
            User::factory()->forTenant($tenantId)->create([
                'status' => 'active',
                'is_approved' => true,
                'role' => 'member',
                'last_login_at' => now()->subDays(2),
            ]);
        }
    }

    // ── The door opens ──────────────────────────────────────────────────────

    public function test_a_manager_lists_the_plans_a_child_can_be_put_on_as_the_hub_offers_them(): void
    {
        $this->hubTerms($this->hub, $this->local, ['price_monthly' => 150.00]);
        $this->hubTerms($this->hub, $this->community, ['is_offered' => 0]);
        $this->asManagerOf($this->hub);

        $response = $this->apiGet("/v2/admin/super/branch-payments/{$this->child}/plans");

        $response->assertStatus(200);
        $plans = $response->json('data');
        // Equal, not identical: JSON writes 150.0 as 150.
        $this->assertEquals(PlanTerms::availableTo($this->child), $plans);
        $this->assertSame(self::TERMS_KEYS, array_keys($plans[0]));

        $ids = array_column($plans, 'plan_id');
        $this->assertNotContains($this->community, $ids, 'A plan the hub hides is not listed.');
        $local = collect($plans)->firstWhere('plan_id', $this->local);
        $this->assertEquals(150.0, $local['price_monthly'], 'The hub\'s price, not the default.');
        $this->assertSame('hub', $local['terms']);
    }

    public function test_a_first_assignment_creates_the_record_and_is_audited(): void
    {
        $manager = $this->asManagerOf($this->hub);
        $this->assertNull($this->planOf($this->child));

        $response = $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/plan", ['plan_id' => $this->local]);

        $response->assertStatus(200);
        $this->assertSame($this->local, $this->planOf($this->child));
        $this->assertSame($this->local, $response->json('data.plan.plan_id'));
        $this->assertSame(['active', 'total', 'window_days', 'max', 'percent'], array_keys($response->json('data.members')));

        $row = DB::table('tenant_plan_assignments')->where('tenant_id', $this->child)->first();
        $this->assertNull($row->custom_price_monthly);
        $this->assertNull($row->custom_price_yearly);
        $this->assertSame(0, (int) $row->discount_percentage);
        $this->assertSame(0, (int) $row->nonprofit_verified);

        $audit = $this->planAudit($this->child);
        $this->assertCount(1, $audit);
        $this->assertSame((int) $manager->id, (int) $audit[0]->acted_by_user_id);
        $this->assertSame('hub', json_decode((string) $audit[0]->new_value, true)['source']);
        $this->assertSame($this->local, json_decode((string) $audit[0]->new_value, true)['pay_plan_id']);
    }

    public function test_a_manager_puts_a_grandchild_on_a_plan(): void
    {
        $this->asManagerOf($this->hub);

        $this->apiPost("/v2/admin/super/branch-payments/{$this->grandchild}/plan", ['plan_id' => $this->spark])
            ->assertStatus(200);

        $this->assertSame($this->spark, $this->planOf($this->grandchild));
    }

    public function test_the_hubs_write_changes_the_plan_and_nothing_else(): void
    {
        $this->assign($this->child, $this->spark, [
            'custom_price_monthly' => 12.34,
            'custom_price_yearly' => 123.40,
            'discount_percentage' => 15,
            'discount_reason' => 'Agreed with the platform team',
            'nonprofit_verified' => 1,
            'notes' => 'Platform team note',
            'expires_at' => '2027-06-30 00:00:00',
        ]);
        $before = (array) DB::table('tenant_plan_assignments')->where('tenant_id', $this->child)->first();
        $this->asManagerOf($this->hub);

        $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/plan", ['plan_id' => $this->local])
            ->assertStatus(200);

        $rows = DB::table('tenant_plan_assignments')->where('tenant_id', $this->child)->get();
        $this->assertCount(1, $rows, 'The existing record is changed, not a second one added.');
        $after = (array) $rows[0];

        $this->assertSame($this->local, (int) $after['pay_plan_id']);
        foreach (['custom_price_monthly', 'custom_price_yearly', 'discount_percentage', 'discount_reason', 'nonprofit_verified', 'notes', 'expires_at', 'status', 'starts_at'] as $field) {
            $this->assertEquals($before[$field], $after[$field], "{$field} must be left exactly as it was");
        }
    }

    public function test_posting_the_plan_it_is_already_on_changes_nothing_and_tells_nobody(): void
    {
        $this->assign($this->child, $this->local);
        $admin = 'planbr.' . bin2hex(random_bytes(5)) . '@example.com';
        User::factory()->forTenant($this->child)->create(['email' => $admin, 'role' => 'admin', 'status' => 'active', 'is_approved' => true]);
        $this->asManagerOf($this->hub);

        $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/plan", ['plan_id' => $this->local])
            ->assertStatus(200);

        $this->assertCount(0, $this->planAudit($this->child));
        $this->assertSame(0, DB::table('email_log')->where('recipient_email', $admin)->count());
    }

    public function test_the_childs_admins_are_told_when_the_hub_changes_its_plan(): void
    {
        $admin = 'planbr.' . bin2hex(random_bytes(5)) . '@example.com';
        User::factory()->forTenant($this->child)->create(['email' => $admin, 'role' => 'admin', 'status' => 'active', 'is_approved' => true]);
        $this->asManagerOf($this->hub);

        $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/plan", ['plan_id' => $this->local])
            ->assertStatus(200);

        $mail = DB::table('email_log')->where('recipient_email', $admin)->get();
        $this->assertCount(1, $mail);
        $this->assertSame('billing', $mail[0]->category);
        $this->assertSame($this->child, (int) $mail[0]->tenant_id);
    }

    // ── Plans that are not offered ──────────────────────────────────────────

    public function test_a_plan_the_hub_hides_is_refused(): void
    {
        $this->assign($this->child, $this->spark);
        $this->hubTerms($this->hub, $this->community, ['is_offered' => 0]);
        $this->asManagerOf($this->hub);

        $response = $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/plan", ['plan_id' => $this->community]);

        $response->assertStatus(422);
        $this->assertSame('PLAN_NOT_OFFERED', $response->json('errors.0.code'));
        $this->assertSame('plan_id', $response->json('errors.0.field'));
        $this->assertSame($this->spark, $this->planOf($this->child));
        $this->assertCount(0, $this->planAudit($this->child));
    }

    public function test_a_plan_that_is_not_a_standard_plan_is_refused(): void
    {
        $custom = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Bespoke plan',
            'slug' => 'bespoke-' . bin2hex(random_bytes(4)),
            'price_monthly' => 1,
            'price_yearly' => 10,
            'is_active' => 1,
            'is_standard' => 0,
            'created_at' => now(),
        ]);
        $this->asManagerOf($this->hub);

        $response = $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/plan", ['plan_id' => $custom]);

        $response->assertStatus(422);
        $this->assertSame('PLAN_NOT_OFFERED', $response->json('errors.0.code'));
        $this->assertNull($this->planOf($this->child));
    }

    public function test_an_inactive_standard_plan_is_refused(): void
    {
        $retired = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Retired standard plan',
            'slug' => 'retired-' . bin2hex(random_bytes(4)),
            'price_monthly' => 5,
            'price_yearly' => 50,
            'max_users' => 40,
            'is_active' => 0,
            'is_standard' => 1,
            'created_at' => now(),
        ]);
        $this->asManagerOf($this->hub);

        $response = $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/plan", ['plan_id' => $retired]);

        $response->assertStatus(422);
        $this->assertSame('PLAN_NOT_OFFERED', $response->json('errors.0.code'));
        $this->assertSame('plan_id', $response->json('errors.0.field'));
        $this->assertNull($this->planOf($this->child));
    }

    /** @return array<string, array{0: mixed, 1: string}> */
    public static function badPlanIds(): array
    {
        return [
            'missing' => [null, 'VALIDATION_ERROR'],
            'text' => ['local', 'VALIDATION_ERROR'],
            'a fraction' => [1.5, 'VALIDATION_ERROR'],
            'zero' => [0, 'VALIDATION_ERROR'],
            'below zero' => [-3, 'VALIDATION_ERROR'],
            'a plan that does not exist' => [999999991, 'PLAN_NOT_OFFERED'],
        ];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('badPlanIds')]
    public function test_a_plan_id_that_names_no_offered_plan_is_refused(mixed $planId, string $code): void
    {
        $this->asManagerOf($this->hub);

        $response = $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/plan", $planId === null ? [] : ['plan_id' => $planId]);

        $response->assertStatus(422);
        $this->assertSame($code, $response->json('errors.0.code'));
        $this->assertSame('plan_id', $response->json('errors.0.field'));
        $this->assertNull($this->planOf($this->child));
        $this->assertCount(0, $this->planAudit($this->child));
    }

    // ── The door stays shut ─────────────────────────────────────────────────

    /** @return array<string, array{0: string, 1: string}> */
    public static function calls(): array
    {
        return [
            'list the plans' => ['GET', 'plans'],
            'change the plan' => ['POST', 'plan'],
        ];
    }

    private function hit(string $method, int $target, string $action): \Illuminate\Testing\TestResponse
    {
        $path = "/v2/admin/super/branch-payments/{$target}/{$action}";

        return $method === 'GET' ? $this->apiGet($path) : $this->apiPost($path, ['plan_id' => $this->local]);
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('calls')]
    public function test_a_manager_cannot_act_on_anything_that_is_not_below_it(string $method, string $action): void
    {
        $this->asManagerOf($this->child);
        $this->assign($this->sibling, $this->spark);
        $this->assign($this->otherChild, $this->spark);

        $notBelow = [
            'its own community' => $this->child,
            'its parent' => $this->hub,
            'a sibling' => $this->sibling,
            'another hub' => $this->other,
            'another hub\'s child' => $this->otherChild,
            'the platform community' => 1,
            'a community that does not exist' => 999999991,
        ];

        foreach ($notBelow as $what => $target) {
            $planBefore = $this->planOf($target);
            $response = $this->hit($method, $target, $action);

            $this->assertSame(403, $response->getStatusCode(), "{$action} on {$what} must be refused with 403, got {$response->getStatusCode()}");
            $this->assertStringNotContainsString('plan_id', (string) $response->getContent(), "{$action} on {$what} leaked plans");
            $this->assertSame($planBefore, $this->planOf($target), "{$action} on {$what} changed a plan");
            $this->assertCount(0, $this->planAudit($target));
        }
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('calls')]
    public function test_a_manager_of_the_platform_community_cannot_act_on_a_community_that_pays_the_platform(string $method, string $action): void
    {
        DB::table('tenants')->where('id', 1)->update(['allows_subtenants' => 1, 'path' => '/1/']);
        $this->asManagerOf(1);
        $this->assign($this->hub, $this->spark);

        $response = $this->hit($method, $this->hub, $action);

        $response->assertStatus(422);
        $this->assertSame('PAYS_PLATFORM', $response->json('errors.0.code'));
        $this->assertSame($this->spark, $this->planOf($this->hub));
        $this->assertCount(0, $this->planAudit($this->hub));
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('calls')]
    public function test_a_manager_cannot_act_on_an_exempt_community(string $method, string $action): void
    {
        $this->asManagerOf($this->hub);
        BillingStandingService::setExempt($this->child, true, 1, 'Council contract');

        $response = $this->hit($method, $this->child, $action);

        $response->assertStatus(422);
        $this->assertSame('EXEMPT', $response->json('errors.0.code'));
        $this->assertNull($this->planOf($this->child));
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('calls')]
    public function test_a_child_that_pays_the_platform_is_refused_even_below_the_manager(string $method, string $action): void
    {
        BillingStandingService::setPayer($this->child, 'platform_invoice', 1);
        $this->asManagerOf($this->hub);

        $response = $this->hit($method, $this->child, $action);

        $response->assertStatus(422);
        $this->assertSame('PAYS_PLATFORM', $response->json('errors.0.code'));
        $this->assertNull($this->planOf($this->child));
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
    public function test_nobody_below_a_manager_can_see_or_change_a_plan(array $attributes): void
    {
        $this->signInTo($this->hub, $attributes);

        foreach (['plans' => 'GET', 'plan' => 'POST'] as $action => $method) {
            $status = $this->hit($method, $this->child, $action)->getStatusCode();
            $this->assertContains($status, [401, 403], "{$action} answered {$status}");
        }

        $this->assertNull($this->planOf($this->child));
        $this->assertCount(0, $this->planAudit($this->child));
    }

    // ── The list carries the plan and the member usage ──────────────────────

    public function test_each_row_carries_its_plan_and_member_usage_and_the_shape_is_pinned(): void
    {
        $this->assign($this->child, $this->local);
        $this->hubTerms($this->hub, $this->local, ['max_users' => 200]);
        // Members of a grandchild count towards its parent's number.
        $this->activeMembers($this->child, 3);
        $this->activeMembers($this->grandchild, 2);
        // Members who are not "active" in the plan's sense but are members all
        // the same: one who has never signed in, one who last signed in long
        // ago. And two who are not members: waiting for approval, and banned.
        $base = ['is_approved' => true, 'role' => 'member'];
        User::factory()->forTenant($this->child)->create($base + ['status' => 'active', 'last_login_at' => null]);
        User::factory()->forTenant($this->grandchild)->create($base + ['status' => 'active', 'last_login_at' => now()->subDays(200)]);
        User::factory()->forTenant($this->child)->create($base + ['status' => 'pending', 'last_login_at' => now()->subDays(2)]);
        User::factory()->forTenant($this->child)->create($base + ['status' => 'banned', 'last_login_at' => now()->subDays(2)]);
        $this->asManagerOf($this->hub);

        $response = $this->apiGet('/v2/admin/super/branch-payments');
        $response->assertStatus(200);
        $rows = collect($response->json('data'));

        foreach ($rows as $row) {
            $this->assertSame(self::ROW_KEYS, array_keys($row));
        }

        $child = $rows->firstWhere('id', $this->child);
        $this->assertSame(self::TERMS_KEYS, array_keys($child['plan']));
        $this->assertSame($this->local, $child['plan']['plan_id']);
        $this->assertSame(200, $child['plan']['max_users'], 'The hub\'s member number.');
        $this->assertSame('hub', $child['plan']['terms']);

        $active = TenantBillingService::getSubtreeActiveMemberCount($this->child);
        $this->assertSame(5, $active);
        // `total` is every member with an account in good standing in the
        // branch, signed in lately or not: the figure a manager thinks of as
        // "our members". The plan's number is checked against `active` only.
        $this->assertSame(
            ['active' => 5, 'total' => 7, 'window_days' => StandardPlans::ACTIVE_WINDOW_DAYS, 'max' => 200, 'percent' => 2],
            $child['members']
        );
        $this->assertSame(TenantBillingService::getSubtreeUserCount($this->child), $child['members']['total']);

        $grandchild = $rows->firstWhere('id', $this->grandchild);
        $this->assertNull($grandchild['plan']);
        $this->assertSame(
            ['active' => 2, 'total' => 3, 'window_days' => StandardPlans::ACTIVE_WINDOW_DAYS, 'max' => null, 'percent' => null],
            $grandchild['members']
        );
    }

    public function test_changePlanOnly_refuses_a_source_it_does_not_know(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        TenantBillingService::changePlanOnly($this->child, $this->local, null, 'somebody');
    }

    // ── A live card subscription is the platform team's (fix round 1) ───────

    public function test_a_child_with_a_live_card_subscription_and_no_stored_payer_is_not_its_hubs_at_all(): void
    {
        $this->onCard($this->child, $this->spark);
        $this->asManagerOf($this->hub);

        $row = collect($this->apiGet('/v2/admin/super/branch-payments')->json('data'))->firstWhere('id', $this->child);
        $this->assertFalse($row['can_act']);
        $this->assertSame('pays_platform', $row['cannot_act_reason']);
        $this->assertSame('platform_card', $row['standing']['payer']);

        $response = $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/plan", ['plan_id' => $this->local]);
        $response->assertStatus(422);
        $this->assertSame('PAYS_PLATFORM', $response->json('errors.0.code'));
        $this->assertSame($this->spark, $this->planOf($this->child));

        $pause = $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/suspend", []);
        $pause->assertStatus(422);
        $this->assertFalse(\App\Support\Billing\BillingLock::isLocked($this->child), 'A hub cannot pause a community that pays the platform by card.');
    }

    private function onCard(int $tenantId, int $planId, string $status = 'active'): void
    {
        $this->assign($tenantId, $planId, [
            'status' => $status,
            'stripe_subscription_id' => 'sub_test_' . bin2hex(random_bytes(6)),
        ]);
    }

    public function test_a_hub_cannot_change_the_plan_of_a_child_paying_the_platform_by_card(): void
    {
        // Since 22 Nov 2026 a live card subscription makes a community a card
        // payer by default, wherever it sits, and then it is not its hub's at
        // all. This is the case in between: the platform team has said it
        // pays its hub, and its card subscription has not been ended yet.
        BillingStandingService::setPayer($this->child, 'parent', 1);
        $this->onCard($this->child, $this->spark);
        $admin = 'planbr.' . bin2hex(random_bytes(5)) . '@example.com';
        User::factory()->forTenant($this->child)->create(['email' => $admin, 'role' => 'admin', 'status' => 'active', 'is_approved' => true]);
        $this->asManagerOf($this->hub);

        $response = $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/plan", ['plan_id' => $this->local]);

        $response->assertStatus(422);
        $this->assertSame('HAS_CARD_SUBSCRIPTION', $response->json('errors.0.code'));
        $this->assertStringNotContainsString('api.', (string) $response->json('errors.0.message'));
        $this->assertSame($this->spark, $this->planOf($this->child));
        $this->assertCount(0, $this->planAudit($this->child));
        $this->assertSame(0, DB::table('email_log')->where('recipient_email', $admin)->count(), 'Nobody is told of a change that did not happen.');
    }

    public function test_the_list_says_a_card_payer_s_plan_is_the_platform_team_s(): void
    {
        // Since 22 Nov 2026 a live card subscription makes a community a card
        // payer by default, wherever it sits, and then it is not its hub's at
        // all. This is the case in between: the platform team has said it
        // pays its hub, and its card subscription has not been ended yet.
        BillingStandingService::setPayer($this->child, 'parent', 1);
        $this->onCard($this->child, $this->spark);
        $this->assign($this->sibling, $this->spark);
        $this->asManagerOf($this->hub);

        $rows = collect($this->apiGet('/v2/admin/super/branch-payments')->json('data'));

        $child = $rows->firstWhere('id', $this->child);
        $this->assertTrue($child['can_act'], 'Payment standing is still the hub\'s to record.');
        $this->assertSame('card_subscription', $child['plan_change_refusal']);
        $this->assertNull($rows->firstWhere('id', $this->sibling)['plan_change_refusal']);
    }

    public function test_a_row_the_manager_cannot_act_on_carries_no_plan_change_refusal(): void
    {
        BillingStandingService::setExempt($this->child, true, 1, 'Council contract');
        $this->onCard($this->child, $this->spark);
        $this->asManagerOf($this->hub);

        $child = collect($this->apiGet('/v2/admin/super/branch-payments')->json('data'))->firstWhere('id', $this->child);

        $this->assertFalse($child['can_act']);
        $this->assertNull($child['plan_change_refusal'], 'cannot_act_reason already says why.');
    }

    /** @return array<string, array{0: string}> */
    public static function endedStatuses(): array
    {
        return ['expired' => ['expired'], 'cancelled' => ['cancelled']];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('endedStatuses')]
    public function test_an_ended_card_subscription_does_not_block_the_hub(string $status): void
    {
        $this->onCard($this->child, $this->spark, $status);
        $this->asManagerOf($this->hub);

        $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/plan", ['plan_id' => $this->local])
            ->assertStatus(200);

        $this->assertSame($this->local, $this->planOf($this->child));
    }

    public function test_the_automatic_check_cannot_change_a_card_payer_s_plan_but_the_platform_team_can(): void
    {
        $this->onCard($this->child, $this->spark);

        try {
            TenantBillingService::changePlanOnly($this->child, $this->local, null, 'auto');
            $this->fail('An automatic move of a card payer must be refused.');
        } catch (\DomainException $e) {
            $this->assertSame('billing_card_subscription', $e->getMessage());
        }
        $this->assertSame($this->spark, $this->planOf($this->child));

        TenantBillingService::changePlanOnly($this->child, $this->local, 1, 'platform');
        $this->assertSame($this->local, $this->planOf($this->child));

        TenantBillingService::assignPlan($this->child, $this->community, null, null, 1);
        $this->assertSame($this->community, $this->planOf($this->child));
    }

    public function test_with_two_active_records_the_newest_is_the_one_changed_and_named(): void
    {
        $older = $this->assign($this->child, $this->spark);
        $newer = $this->assign($this->child, $this->local);
        $this->assertGreaterThan($older, $newer);
        $this->assertSame($this->local, PlanTerms::forCommunity($this->child)['plan_id'], 'The plan in force is the newest record\'s.');
        $this->asManagerOf($this->hub);

        $response = $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/plan", ['plan_id' => $this->community]);

        $response->assertStatus(200);
        $this->assertSame($this->community, $response->json('data.plan.plan_id'));
        $this->assertSame($this->community, (int) DB::table('tenant_plan_assignments')->where('id', $newer)->value('pay_plan_id'));
        $this->assertSame($this->spark, (int) DB::table('tenant_plan_assignments')->where('id', $older)->value('pay_plan_id'));
        $audit = $this->planAudit($this->child);
        $this->assertSame($this->local, json_decode((string) $audit[0]->old_value, true)['pay_plan_id']);
    }
}
