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
use App\Support\Billing\BillingSettings;
use App\Support\Billing\PlanTerms;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Who may set the rule for going over a member number, at each level, and
 * the shapes the screens read (DESIGN 6.6):
 *
 * - one community's own rule: a hub's manager on a community in reach that
 *   pays its parent and is not exempt (Branch payments); the platform team on
 *   any community;
 * - a hub's default for its children: its own hub's, and any hub below it
 *   (Branch plans); never tenant 1.
 *
 * The refusals shared with every other Branch payments write (above, beside,
 * pays the platform, exempt, not a manager) run for `over-limit` in
 * BranchPaymentsEndpointsTest's providers.
 *
 * And every caller that changes the terms a community is held to restarts its
 * days-over count: a new plan (by a hub or the platform team), a hub's
 * changed member number, the platform team's changed default member number.
 *
 * Tree:  hub ─ child ─ grandchild        other (a second hub, beside `hub`)
 *            └ sibling                        └ otherChild
 */
final class OverLimitRuleEndpointsTest extends TestCase
{
    use DatabaseTransactions;

    /** The rule as Branch payments and Billing control carry it, key for key. */
    private const RULE_KEYS = [
        'action', 'effective_action', 'grace_days', 'action_source', 'days_source',
        'own_action', 'own_grace_days', 'acts_on',
    ];

    private int $hub;
    private int $child;
    private int $grandchild;
    private int $sibling;
    private int $other;
    private int $otherChild;
    private int $local;
    private int $spark;

    protected function setUp(): void
    {
        parent::setUp();
        putenv('MAILER_PER_RECIPIENT_HOURLY_LIMIT=0');

        $this->hub = $this->makeCommunity('Rule ep hub', 1, '/1/', true);
        $this->child = $this->makeCommunity('Rule ep child', $this->hub, "/1/{$this->hub}/", true);
        $this->grandchild = $this->makeCommunity('Rule ep grandchild', $this->child, "/1/{$this->hub}/{$this->child}/");
        $this->sibling = $this->makeCommunity('Rule ep sibling', $this->hub, "/1/{$this->hub}/");
        $this->other = $this->makeCommunity('Rule ep other hub', 1, '/1/', true);
        $this->otherChild = $this->makeCommunity('Rule ep other child', $this->other, "/1/{$this->other}/");
        $this->local = (int) DB::table('pay_plans')->where('slug', 'local')->value('id');
        $this->spark = (int) DB::table('pay_plans')->where('slug', 'spark')->value('id');

        BillingLock::flush();
        BillingSettings::flush();
        PlanTerms::flush();
    }

    protected function tearDown(): void
    {
        putenv('MAILER_PER_RECIPIENT_HOURLY_LIMIT=30');

        // parent::tearDown() rolls the transaction back; it must always run.
        try {
            BillingLock::flush();
            BillingSettings::flush();
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
            'slug' => 'ruleep-' . bin2hex(random_bytes(5)),
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

    private function asPlatformTeam(): User
    {
        return $this->signInTo($this->hub, ['role' => 'super_admin', 'is_super_admin' => true, 'is_god' => true]);
    }

    /** @param array<string, mixed> $values */
    private function standing(int $tenantId, array $values): void
    {
        if (DB::table('tenant_billing_standing')->where('tenant_id', $tenantId)->exists()) {
            DB::table('tenant_billing_standing')->where('tenant_id', $tenantId)->update($values);

            return;
        }
        DB::table('tenant_billing_standing')->insert($values + ['tenant_id' => $tenantId, 'created_at' => now(), 'updated_at' => now()]);
    }

    private function runningClock(int $tenantId): void
    {
        $this->standing($tenantId, ['over_limit_since' => '2027-01-01', 'limit_notice_stage' => 'over', 'limit_notice_at' => '2027-01-01 08:00:00']);
    }

    private function clockStage(int $tenantId): ?string
    {
        return DB::table('tenant_billing_standing')->where('tenant_id', $tenantId)->value('limit_notice_stage');
    }

    private function assign(int $tenantId, int $planId, array $extra = []): void
    {
        DB::table('tenant_plan_assignments')->insert(array_merge([
            'tenant_id' => $tenantId, 'pay_plan_id' => $planId, 'status' => 'active',
        ], $extra));
    }

    private function activeMembers(int $tenantId, int $count): void
    {
        $rows = [];
        for ($i = 0; $i < $count; $i++) {
            $rows[] = [
                'tenant_id' => $tenantId, 'first_name' => 'Active', 'last_name' => 'Member', 'name' => 'Active Member',
                'email' => 'ruleep.' . bin2hex(random_bytes(7)) . '@example.com', 'password_hash' => 'x',
                'role' => 'member', 'status' => 'active', 'is_approved' => 1,
                'last_login_at' => now()->subDays(5), 'created_at' => now(),
            ];
        }
        foreach (array_chunk($rows, 200) as $chunk) {
            DB::table('users')->insert($chunk);
        }
    }

    // ── A community's own rule, by its hub's manager ────────────────────────

    public function test_a_manager_sets_a_childs_rule_and_a_grandchilds(): void
    {
        $manager = $this->asManagerOf($this->hub);
        $this->runningClock($this->child);

        $response = $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/over-limit", ['action' => 'block_joining', 'grace_days' => 15]);
        $response->assertStatus(200);
        $this->assertSame(['over_limit', 'upgrade_allowed'], array_keys($response->json('data')));
        $this->assertSame(self::RULE_KEYS, array_keys($response->json('data.over_limit')));
        $this->assertSame('block_joining', $response->json('data.over_limit.action'));
        $this->assertSame('community', $response->json('data.over_limit.action_source'));
        $this->assertSame('block_joining', $response->json('data.over_limit.own_action'));
        $this->assertSame(15, $response->json('data.over_limit.own_grace_days'));
        $this->assertTrue($response->json('data.upgrade_allowed'));

        $this->assertNull($this->clockStage($this->child), 'The count starts again.');
        $audit = DB::table('billing_audit_log')->where('tenant_id', $this->child)->where('action', 'standing_over_limit_rule_set')->first();
        $this->assertSame((int) $manager->id, (int) $audit->acted_by_user_id);

        $this->apiPost("/v2/admin/super/branch-payments/{$this->grandchild}/over-limit", ['action' => 'upgrade', 'grace_days' => null])->assertStatus(200);
        $this->assertSame('upgrade', \App\Support\Billing\OverLimitRule::own($this->grandchild)['action']);
    }

    public function test_both_nulls_return_a_community_to_the_default(): void
    {
        $this->asManagerOf($this->hub);
        BillingStandingService::setOverLimitRule($this->child, 'none', 9, 1);

        $response = $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/over-limit", ['action' => null, 'grace_days' => null]);

        $response->assertStatus(200);
        $this->assertNull($response->json('data.over_limit.own_action'));
        $this->assertSame('platform', $response->json('data.over_limit.action_source'));
        $this->assertSame('pause', $response->json('data.over_limit.action'));
    }

    /** @return array<string, array{0: array<string, mixed>, 1: string}> */
    public static function badBodies(): array
    {
        return [
            'no action key' => [['grace_days' => 10], 'OVER_LIMIT_ACTION_INVALID'],
            'an unknown action' => [['action' => 'delete', 'grace_days' => null], 'OVER_LIMIT_ACTION_INVALID'],
            'no days key' => [['action' => 'pause'], 'OVER_LIMIT_DAYS_INVALID'],
            'zero days' => [['action' => 'pause', 'grace_days' => 0], 'OVER_LIMIT_DAYS_INVALID'],
            'too many days' => [['action' => 'pause', 'grace_days' => 366], 'OVER_LIMIT_DAYS_INVALID'],
            'a fraction of a day' => [['action' => 'pause', 'grace_days' => '2.5'], 'OVER_LIMIT_DAYS_INVALID'],
        ];
    }

    /** @param array<string, mixed> $body */
    #[\PHPUnit\Framework\Attributes\DataProvider('badBodies')]
    public function test_a_bad_rule_is_refused_and_nothing_is_written(array $body, string $code): void
    {
        $this->asManagerOf($this->hub);

        $response = $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/over-limit", $body);

        $response->assertStatus(422);
        $this->assertStringContainsString($code, (string) $response->getContent());
        $this->assertSame(0, DB::table('billing_audit_log')->where('tenant_id', $this->child)->count());
    }

    public function test_move_up_is_refused_for_a_child_with_a_card_subscription(): void
    {
        $this->assign($this->child, $this->local, ['stripe_subscription_id' => 'sub_ruleep_' . bin2hex(random_bytes(4))]);
        $this->asManagerOf($this->hub);

        $row = collect($this->apiGet('/v2/admin/super/branch-payments')->json('data'))->firstWhere('id', $this->child);
        $this->assertFalse($row['upgrade_allowed'], 'The list says so before the write refuses it.');

        $response = $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/over-limit", ['action' => 'upgrade', 'grace_days' => null]);
        $response->assertStatus(422);
        $this->assertStringContainsString('RULE_NOT_ALLOWED', (string) $response->getContent());
        $this->assertNull(\App\Support\Billing\OverLimitRule::own($this->child)['action']);

        $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/over-limit", ['action' => 'pause', 'grace_days' => null])->assertStatus(200);
    }

    // ── A hub's default for its children ────────────────────────────────────

    public function test_a_manager_sets_its_own_hubs_default_and_that_of_a_hub_below_it(): void
    {
        $this->asManagerOf($this->hub);
        $this->runningClock($this->sibling);

        $response = $this->apiPut("/v2/admin/super/branch-plans/{$this->hub}/over-limit", ['action' => 'upgrade', 'grace_days' => 20]);
        $response->assertStatus(200);
        $this->assertSame(['action', 'grace_days', 'platform_action', 'platform_grace_days', 'automation_enabled'], array_keys($response->json('data.over_limit')));
        $this->assertSame(['action' => 'upgrade', 'grace_days' => 20, 'platform_action' => 'pause', 'platform_grace_days' => 30, 'automation_enabled' => false], $response->json('data.over_limit'));
        // Fix round 1: nothing is cleared on save; the daily check restarts the
        // children whose terms changed (BillingAutomationMemberLimitTest).
        $this->assertSame('over', $this->clockStage($this->sibling));
        $this->assertSame('hub', \App\Support\Billing\OverLimitRule::for($this->sibling)['action_source']);

        $this->apiPut("/v2/admin/super/branch-plans/{$this->child}/over-limit", ['action' => 'none', 'grace_days' => null])->assertStatus(200);
        $this->assertSame('none', \App\Support\Billing\OverLimitRule::for($this->grandchild)['action']);

        $page = $this->apiGet("/v2/admin/super/branch-plans?hub_id={$this->hub}")->json('data');
        $this->assertSame(['action' => 'upgrade', 'grace_days' => 20, 'platform_action' => 'pause', 'platform_grace_days' => 30, 'automation_enabled' => false], $page['over_limit']);

        // The page can say plainly that nothing acts until the checks are on.
        BillingSettings::set('automation_enabled', true, null);
        $this->assertTrue($this->apiGet("/v2/admin/super/branch-plans?hub_id={$this->hub}")->json('data.over_limit.automation_enabled'));
    }

    public function test_a_manager_cannot_set_the_default_of_a_hub_above_or_beside_it_or_tenant_1(): void
    {
        $this->asManagerOf($this->child);

        foreach (['its parent' => $this->hub, 'a sibling' => $this->sibling, 'another hub' => $this->other, 'the platform community' => 1, 'a community that does not exist' => 999999991] as $what => $target) {
            $response = $this->apiPut("/v2/admin/super/branch-plans/{$target}/over-limit", ['action' => 'none', 'grace_days' => null]);
            $this->assertSame(404, $response->getStatusCode(), "{$what}: got {$response->getStatusCode()}");
            $this->assertNull(\App\Support\Billing\OverLimitRule::childrenDefault($target)['action'], "{$what} was written");
        }
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
    public function test_nobody_below_a_manager_can_set_a_hubs_default(array $attributes): void
    {
        $this->signInTo($this->hub, $attributes);

        $status = $this->apiPut("/v2/admin/super/branch-plans/{$this->hub}/over-limit", ['action' => 'none', 'grace_days' => null])->getStatusCode();

        $this->assertContains($status, [401, 403]);
        $this->assertNull(\App\Support\Billing\OverLimitRule::childrenDefault($this->hub)['action']);
    }

    // ── The platform team ───────────────────────────────────────────────────

    public function test_the_platform_team_sets_any_communitys_rule(): void
    {
        $this->asPlatformTeam();

        foreach ([$this->other, $this->child] as $target) {
            $response = $this->apiPost('/v2/admin/super/billing/standing/over-limit', ['tenant_id' => $target, 'action' => 'none', 'grace_days' => 60]);
            $response->assertStatus(200);
            $this->assertSame(self::RULE_KEYS, array_keys($response->json('data.over_limit')));
            $this->assertSame(60, $response->json('data.over_limit.grace_days'));
        }

        // An exempt community may carry a rule; nothing acts on it while exempt.
        BillingStandingService::setExempt($this->sibling, true, 1, 'Council contract');
        $this->apiPost('/v2/admin/super/billing/standing/over-limit', ['tenant_id' => $this->sibling, 'action' => 'pause', 'grace_days' => null])->assertStatus(200);
    }

    public function test_the_platform_team_cannot_choose_move_up_for_a_card_payer_or_set_tenant_1(): void
    {
        $this->assign($this->other, $this->local, ['stripe_subscription_id' => 'sub_ruleep_' . bin2hex(random_bytes(4))]);
        $this->asPlatformTeam();

        $card = $this->apiPost('/v2/admin/super/billing/standing/over-limit', ['tenant_id' => $this->other, 'action' => 'upgrade', 'grace_days' => null]);
        $card->assertStatus(422);
        $this->assertStringContainsString('RULE_NOT_ALLOWED', (string) $card->getContent());

        $platform = $this->apiPost('/v2/admin/super/billing/standing/over-limit', ['tenant_id' => 1, 'action' => 'pause', 'grace_days' => null]);
        $platform->assertStatus(422);
        $this->assertStringContainsString('PLATFORM_TENANT_NOT_BILLABLE', (string) $platform->getContent());

        $missing = $this->apiPost('/v2/admin/super/billing/standing/over-limit', ['action' => 'pause', 'grace_days' => null]);
        $missing->assertStatus(422);
    }

    public function test_the_platform_settings_accept_the_four_rules_and_refuse_others(): void
    {
        $this->asPlatformTeam();

        foreach (['none', 'block_joining', 'upgrade', 'pause'] as $action) {
            $this->apiPut('/v2/admin/super/billing/settings', ['over_limit_action' => $action])->assertStatus(200);
            $this->assertSame($action, BillingSettings::get('over_limit_action'));
        }
        $this->apiPut('/v2/admin/super/billing/settings', ['over_limit_action' => 'delete'])->assertStatus(422);
    }

    // ── The shapes the screens read ─────────────────────────────────────────

    public function test_the_branch_payments_row_carries_the_rule_and_the_pause_day(): void
    {
        BillingSettings::set('automation_enabled', true, null);
        $this->assign($this->child, $this->spark);
        $sparkMax = (int) DB::table('pay_plans')->where('id', $this->spark)->value('max_users');
        $this->activeMembers($this->child, $sparkMax + 1);
        $this->standing($this->hub, ['children_over_limit_grace_days' => 12]);
        $this->asManagerOf($this->hub);

        $rows = collect($this->apiGet('/v2/admin/super/branch-payments')->json('data'));
        $child = $rows->firstWhere('id', $this->child);

        $this->assertSame(self::RULE_KEYS, array_keys($child['over_limit']));
        $this->assertSame([
            'action' => 'pause', 'effective_action' => 'pause', 'grace_days' => 12,
            'action_source' => 'platform', 'days_source' => 'hub',
            'own_action' => null, 'own_grace_days' => null,
            'acts_on' => now()->addDays(12)->toDateString(),
        ], $child['over_limit']);
        $this->assertTrue($child['upgrade_allowed']);

        $sibling = $rows->firstWhere('id', $this->sibling);
        $this->assertNull($sibling['over_limit']['acts_on'], 'Not over: no day.');
    }

    public function test_the_billing_control_snapshot_carries_the_rule(): void
    {
        $this->assign($this->other, $this->local, ['stripe_subscription_id' => 'sub_ruleep_' . bin2hex(random_bytes(4))]);
        $this->asPlatformTeam();

        $rows = collect($this->apiGet('/v2/admin/super/billing/snapshot')->json('data'));
        $other = $rows->firstWhere('id', $this->other);
        $child = $rows->firstWhere('id', $this->child);

        foreach ([$other, $child] as $row) {
            $this->assertSame(self::RULE_KEYS, array_keys($row['over_limit_rule']));
            $this->assertIsBool($row['over_limit'], '`over_limit` stays the "over its limit now" flag.');
        }
        $this->assertFalse($other['upgrade_allowed']);
        $this->assertTrue($child['upgrade_allowed']);

        // The platform's own community has no rule: no row carries one for it.
        $platform = $rows->firstWhere('id', 1);
        if ($platform !== null) {
            $this->assertNull($platform['over_limit_rule']);
            $this->assertFalse($platform['upgrade_allowed']);
        }
    }

    public function test_the_snapshot_gives_tenant_1_no_rule(): void
    {
        // The snapshot leaves tenant 1 out today; the fields are guarded too,
        // so the page can never draw a rule button the server refuses.
        $this->asPlatformTeam();
        $this->assertNull(collect($this->apiGet('/v2/admin/super/billing/snapshot')->json('data'))->firstWhere('id', 1));
        $this->assertSame(['over_limit_rule' => null, 'upgrade_allowed' => false], TenantBillingService::overLimitFields(1, 0));
        $this->assertSame('pause', TenantBillingService::overLimitFields($this->child, 0)['over_limit_rule']['action']);
    }

    // ── The count starts again: every caller ────────────────────────────────

    public function test_a_hub_putting_a_child_on_a_plan_restarts_its_count(): void
    {
        $this->assign($this->child, $this->spark);
        $this->runningClock($this->child);
        $this->asManagerOf($this->hub);

        $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/plan", ['plan_id' => $this->local])->assertStatus(200);

        $this->assertNull($this->clockStage($this->child));
    }

    public function test_changing_a_plan_only_restarts_when_the_plan_changes(): void
    {
        $this->assign($this->child, $this->spark);
        $this->runningClock($this->child);

        TenantBillingService::changePlanOnly($this->child, $this->spark, null, 'platform');
        $this->assertSame('over', $this->clockStage($this->child), 'Same plan: nothing changed.');

        TenantBillingService::changePlanOnly($this->child, $this->local, null, 'platform');
        $this->assertNull($this->clockStage($this->child));
    }

    public function test_the_platform_team_assigning_a_plan_restarts_the_count_only_for_a_new_plan(): void
    {
        $this->assign($this->other, $this->spark);
        $this->runningClock($this->other);
        $actor = (int) $this->asPlatformTeam()->id;

        TenantBillingService::assignPlan($this->other, $this->spark, null, 'new price', $actor, 99.0);
        $this->assertSame('over', $this->clockStage($this->other), 'A new price is not new terms.');

        TenantBillingService::assignPlan($this->other, $this->local, null, null, $actor);
        $this->assertNull($this->clockStage($this->other));
    }

    public function test_a_hubs_member_number_restarts_only_the_children_on_that_plan_and_only_when_it_changes(): void
    {
        $this->assign($this->child, $this->local);
        $this->assign($this->sibling, $this->spark);
        $this->assign($this->otherChild, $this->local);
        foreach ([$this->child, $this->sibling, $this->otherChild] as $id) {
            $this->runningClock($id);
        }
        $this->asManagerOf($this->hub);

        // A new name only: the number is the same, nothing restarts.
        $this->apiPut("/v2/admin/super/branch-plans/{$this->hub}/plans/{$this->local}", ['name' => 'Hub local'])->assertStatus(200);
        $this->assertSame('over', $this->clockStage($this->child));

        $this->apiPut("/v2/admin/super/branch-plans/{$this->hub}/plans/{$this->local}", ['max_users' => 150])->assertStatus(200);
        $this->assertNull($this->clockStage($this->child), 'On that plan and paying the hub.');
        $this->assertSame('over', $this->clockStage($this->sibling), 'On another plan.');
        $this->assertSame('over', $this->clockStage($this->otherChild), 'Pays another hub.');

        // Putting the number back to the default is a change too.
        $this->runningClock($this->child);
        $this->apiDelete("/v2/admin/super/branch-plans/{$this->hub}/plans/{$this->local}")->assertStatus(200);
        $this->assertNull($this->clockStage($this->child));
    }

    public function test_the_platform_teams_new_default_member_number_restarts_communities_held_to_it(): void
    {
        $plan = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Rule ep plan', 'slug' => 'rule-ep-' . bin2hex(random_bytes(4)), 'tier_level' => 1,
            'max_users' => 100, 'is_standard' => 1, 'is_active' => 1, 'created_at' => now(),
        ]);
        PlanTerms::flush();
        $this->assign($this->other, $plan);
        $this->assign($this->child, $plan);
        $this->assign($this->sibling, $plan);
        // The hub holds its children on this plan to its own number.
        DB::table('hub_plan_terms')->insert(['hub_tenant_id' => $this->hub, 'pay_plan_id' => $plan, 'max_users' => 40, 'created_at' => now(), 'updated_at' => now()]);
        PlanTerms::flush();
        foreach ([$this->other, $this->child, $this->sibling] as $id) {
            $this->runningClock($id);
        }
        $this->asPlatformTeam();

        $this->apiPut("/v2/admin/plans/{$plan}", ['description' => 'Only words'])->assertStatus(200);
        $this->assertSame('over', $this->clockStage($this->other), 'Nothing about the number changed.');

        $this->apiPut("/v2/admin/plans/{$plan}", ['max_users' => 80])->assertStatus(200);
        $this->assertNull($this->clockStage($this->other), 'Held to the default number.');
        $this->assertSame('over', $this->clockStage($this->child), 'Held to its hub\'s number, which did not change.');
        $this->assertSame('over', $this->clockStage($this->sibling));
    }
}
