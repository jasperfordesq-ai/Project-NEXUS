<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Services\BillingStandingService;
use App\Support\Billing\BillingLock;
use App\Support\Billing\BillingSettings;
use App\Support\Billing\OverLimitRule;
use App\Support\Billing\PlanTerms;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * The rule for going over a plan's member number, at three levels: the
 * community's own, the default its hub set for the communities that pay it,
 * and the platform's. The action and the day count resolve independently.
 *
 * And "the count starts again": changing a rule restarts the days-over count
 * of every community it reaches, so a hub can never cause a pause the next
 * morning by changing a setting (DESIGN 6.4).
 *
 * Tree:  hub ─ child          platformPayer (pays the platform)
 *            └ sibling
 */
final class OverLimitRuleTest extends TestCase
{
    use DatabaseTransactions;
    use MakesBillingCommunities;

    private int $hub;
    private int $child;
    private int $sibling;
    private int $platformPayer;
    private int $actor;

    protected function setUp(): void
    {
        parent::setUp();
        BillingLock::flush();
        BillingSettings::flush();
        PlanTerms::flush();

        $this->hub = $this->makeCommunity('Rule hub', 1, '/1/', true);
        $this->child = $this->makeCommunity('Rule child', $this->hub, "/1/{$this->hub}/");
        $this->sibling = $this->makeCommunity('Rule sibling', $this->hub, "/1/{$this->hub}/");
        $this->platformPayer = $this->makeCommunity('Rule platform payer', 1, '/1/');
        $this->actor = (int) DB::table('users')->insertGetId([
            'tenant_id' => $this->testTenantId, 'first_name' => 'Rule', 'last_name' => 'Actor', 'name' => 'Rule Actor',
            'email' => 'rule.' . bin2hex(random_bytes(6)) . '@example.com', 'password_hash' => 'x',
            'role' => 'member', 'status' => 'active', 'created_at' => now(),
        ]);
    }

    protected function tearDown(): void
    {
        // parent::tearDown() rolls the transaction back; it must always run.
        try {
            BillingLock::flush();
            BillingSettings::flush();
            PlanTerms::flush();
        } finally {
            parent::tearDown();
        }
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

    private function row(int $tenantId): ?object
    {
        return DB::table('tenant_billing_standing')->where('tenant_id', $tenantId)->first();
    }

    private function giveCardSubscription(int $tenantId): void
    {
        $plan = (int) DB::table('pay_plans')->where('slug', 'local')->value('id');
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $tenantId, 'pay_plan_id' => $plan, 'status' => 'active',
            'stripe_subscription_id' => 'sub_rule_' . bin2hex(random_bytes(4)),
        ]);
    }

    /** A clock that has been running: over for a while, notice sent, and a payment notice too. */
    private function runningClock(int $tenantId): void
    {
        $this->standing($tenantId, [
            'over_limit_since' => '2027-01-01',
            'limit_notice_stage' => 'over',
            'limit_notice_at' => '2027-01-01 08:00:00',
            'last_notice_stage' => 'due',
            'last_notice_at' => '2027-01-02 08:00:00',
        ]);
    }

    // ── Resolution ──────────────────────────────────────────────────────────

    public function test_with_nothing_set_the_platform_default_applies_and_it_is_pause_after_30_days(): void
    {
        $this->assertSame([
            'action' => 'pause',
            'effective_action' => 'pause',
            'grace_days' => 30,
            'action_source' => 'platform',
            'days_source' => 'platform',
        ], OverLimitRule::for($this->child));
    }

    public function test_the_hubs_default_applies_to_a_community_that_pays_it(): void
    {
        $this->standing($this->hub, ['children_over_limit_action' => 'none', 'children_over_limit_grace_days' => 45]);

        $rule = OverLimitRule::for($this->child);
        $this->assertSame('none', $rule['action']);
        $this->assertSame(45, $rule['grace_days']);
        $this->assertSame('hub', $rule['action_source']);
        $this->assertSame('hub', $rule['days_source']);

        // The hub's own rule is not its children's default, and the other way round.
        $this->assertSame('platform', OverLimitRule::for($this->hub)['action_source']);
    }

    public function test_the_communitys_own_rule_wins(): void
    {
        $this->standing($this->hub, ['children_over_limit_action' => 'none', 'children_over_limit_grace_days' => 45]);
        $this->standing($this->child, ['over_limit_action' => 'block_joining', 'over_limit_grace_days' => 10]);

        $rule = OverLimitRule::for($this->child);
        $this->assertSame(['block_joining', 10, 'community', 'community'], [$rule['action'], $rule['grace_days'], $rule['action_source'], $rule['days_source']]);
    }

    public function test_the_action_and_the_days_resolve_independently(): void
    {
        BillingSettings::setMany(['over_limit_action' => 'none', 'over_limit_grace_days' => 60], null);
        $this->standing($this->hub, ['children_over_limit_grace_days' => 45]);
        $this->standing($this->child, ['over_limit_action' => 'pause']);

        $rule = OverLimitRule::for($this->child);
        $this->assertSame('pause', $rule['action']);
        $this->assertSame('community', $rule['action_source']);
        $this->assertSame(45, $rule['grace_days']);
        $this->assertSame('hub', $rule['days_source']);

        // Only days set on the community: its action still comes from above.
        $this->standing($this->sibling, ['over_limit_grace_days' => 7]);
        $rule = OverLimitRule::for($this->sibling);
        $this->assertSame(['none', 'platform', 7, 'community'], [$rule['action'], $rule['action_source'], $rule['grace_days'], $rule['days_source']]);
    }

    public function test_a_community_that_pays_the_platform_never_takes_a_hub_default(): void
    {
        $this->standing($this->hub, ['children_over_limit_action' => 'none']);
        // Set to pay the platform: its hub's default no longer reaches it.
        $this->standing($this->child, ['payer' => 'platform_invoice']);

        $this->assertSame('platform', OverLimitRule::for($this->child)['action_source']);
        $this->assertSame('pause', OverLimitRule::for($this->child)['action']);

        // Flip it back to paying its parent: the hub's default applies again.
        $this->standing($this->child, ['payer' => 'parent']);
        $this->assertSame('none', OverLimitRule::for($this->child)['action']);
    }

    public function test_a_stored_platform_none_stays_none(): void
    {
        DB::table('platform_billing_settings')->insert([
            'setting_key' => 'over_limit_action', 'setting_value' => 'none', 'created_at' => now(), 'updated_at' => now(),
        ]);
        BillingSettings::flush();

        $this->assertSame('none', OverLimitRule::for($this->child)['action']);
    }

    // ── Move up and card payers ─────────────────────────────────────────────

    public function test_move_up_on_a_card_payer_is_treated_as_warn_only(): void
    {
        $this->giveCardSubscription($this->platformPayer);
        BillingSettings::set('over_limit_action', 'upgrade', null);

        $rule = OverLimitRule::for($this->platformPayer);
        $this->assertSame('upgrade', $rule['action']);
        $this->assertSame('none', $rule['effective_action']);

        // A community that pays the platform by invoice moves up.
        $invoice = $this->makeCommunity('Rule invoice payer', 1, '/1/');
        $this->assertSame('upgrade', OverLimitRule::for($invoice)['effective_action']);
    }

    public function test_a_child_with_a_live_card_subscription_is_not_moved_up_either(): void
    {
        // Since 22 Nov 2026 a live card subscription makes a community a card
        // payer by default, wherever it sits, and then it is not its hub's at
        // all. This is the case in between: the platform team has said it
        // pays its hub, and its card subscription has not been ended yet.
        BillingStandingService::setPayer($this->child, 'parent', 1);
        $this->standing($this->hub, ['children_over_limit_action' => 'upgrade']);
        $this->assertSame('upgrade', OverLimitRule::for($this->child)['effective_action']);

        $this->giveCardSubscription($this->child);
        $this->assertSame('none', OverLimitRule::for($this->child)['effective_action']);
    }

    public function test_a_child_that_pays_the_platform_by_card_follows_the_platforms_rule_not_its_hubs(): void
    {
        $this->standing($this->hub, ['children_over_limit_action' => 'block_joining']);
        $this->assertSame('block_joining', OverLimitRule::for($this->child)['effective_action'], 'While it pays its hub, its hub\'s default applies.');

        $this->giveCardSubscription($this->child);

        $this->assertSame('platform_card', BillingStandingService::get($this->child)['payer']);
        $this->assertNotSame('hub', OverLimitRule::for($this->child)['action_source'] ?? null, 'It pays the platform now: its hub\'s default is not its rule.');
    }

    public function test_move_up_cannot_be_chosen_for_a_card_payer(): void
    {
        $this->giveCardSubscription($this->platformPayer);

        $this->assertSame('RULE_NOT_ALLOWED', OverLimitRule::refusalFor($this->platformPayer, 'upgrade'));
        $this->assertNull(OverLimitRule::refusalFor($this->platformPayer, 'pause'));
        $this->assertNull(OverLimitRule::refusalFor($this->platformPayer, null));
        $this->assertNull(OverLimitRule::refusalFor($this->child, 'upgrade'));

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('over_limit_rule_not_allowed');
        BillingStandingService::setOverLimitRule($this->platformPayer, 'upgrade', null, $this->actor);
    }

    // ── Setting a rule ──────────────────────────────────────────────────────

    public function test_setting_a_communitys_rule_is_stored_audited_and_restarts_its_count(): void
    {
        $this->runningClock($this->child);

        BillingStandingService::setOverLimitRule($this->child, 'block_joining', 12, $this->actor);

        $row = $this->row($this->child);
        $this->assertSame('block_joining', $row->over_limit_action);
        $this->assertSame(12, (int) $row->over_limit_grace_days);
        $this->assertNull($row->over_limit_since);
        $this->assertNull($row->limit_notice_stage);
        $this->assertNull($row->limit_notice_at);
        $this->assertSame('due', $row->last_notice_stage, 'The payment clock is not touched.');
        $this->assertNotNull($row->last_notice_at);

        $audit = DB::table('billing_audit_log')->where('tenant_id', $this->child)->orderBy('id')->get();
        $this->assertCount(1, $audit);
        $this->assertSame('standing_over_limit_rule_set', $audit[0]->action);
        $this->assertSame($this->actor, (int) $audit[0]->acted_by_user_id);
        $this->assertSame(['action' => null, 'grace_days' => null], json_decode((string) $audit[0]->old_value, true));
        $this->assertSame(['action' => 'block_joining', 'grace_days' => 12], json_decode((string) $audit[0]->new_value, true));
    }

    public function test_setting_the_same_rule_again_changes_nothing_and_restarts_nothing(): void
    {
        BillingStandingService::setOverLimitRule($this->child, 'pause', 20, $this->actor);
        $this->runningClock($this->child);

        BillingStandingService::setOverLimitRule($this->child, 'pause', 20, $this->actor);

        $this->assertSame('over', $this->row($this->child)->limit_notice_stage);
        $this->assertSame(1, DB::table('billing_audit_log')->where('tenant_id', $this->child)->count());
    }

    /** @return array<string, array{0: mixed, 1: mixed, 2: string}> */
    public static function badRules(): array
    {
        return [
            'an unknown action' => ['delete', null, 'over_limit_action_invalid'],
            'zero days' => [null, 0, 'over_limit_days_invalid'],
            'too many days' => [null, 366, 'over_limit_days_invalid'],
        ];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('badRules')]
    public function test_a_bad_rule_is_refused_and_nothing_is_written(mixed $action, mixed $days, string $code): void
    {
        try {
            BillingStandingService::setOverLimitRule($this->child, $action, $days, $this->actor);
            $this->fail('Expected a refusal');
        } catch (\DomainException $e) {
            $this->assertSame($code, $e->getMessage());
        }

        $this->assertNull($this->row($this->child)?->over_limit_action);
        $this->assertSame(0, DB::table('billing_audit_log')->where('tenant_id', $this->child)->count());
    }

    public function test_the_platforms_own_community_has_no_rule(): void
    {
        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('platform_tenant_not_billable');

        BillingStandingService::setOverLimitRule(1, 'pause', null, $this->actor);
    }

    /**
     * Fix round 1: saving a hub default clears nobody's count. The daily check
     * sees from the terms key which children it changed, and restarts those
     * (BillingAutomationMemberLimitTest::test_a_hub_default_change_restarts_only_its_children_without_their_own_rule).
     */
    public function test_a_hubs_default_is_stored_and_audited_and_clears_no_count(): void
    {
        $this->runningClock($this->child);

        BillingStandingService::setChildrenOverLimitRule($this->hub, 'block_joining', null, $this->actor);

        $hub = $this->row($this->hub);
        $this->assertSame('block_joining', $hub->children_over_limit_action);
        $this->assertNull($hub->over_limit_action, 'The hub\x27s own rule is untouched.');
        $this->assertSame('over', $this->row($this->child)->limit_notice_stage);

        $audit = DB::table('billing_audit_log')->where('tenant_id', $this->hub)->get();
        $this->assertCount(1, $audit);
        $this->assertSame('standing_children_over_limit_rule_set', $audit[0]->action);
    }

    public function test_a_hub_may_default_its_children_to_move_up(): void
    {
        BillingStandingService::setChildrenOverLimitRule($this->hub, 'upgrade', 20, $this->actor);

        $this->assertSame('upgrade', OverLimitRule::for($this->child)['effective_action']);
    }

    public function test_restarting_the_count_never_lifts_or_makes_a_pause(): void
    {
        $this->runningClock($this->child);
        BillingStandingService::suspend($this->child, null, 'auto', null, 'over_limit');

        BillingStandingService::restartLimitClock([$this->child, $this->sibling]);

        $standing = BillingStandingService::get($this->child);
        $this->assertNotNull($standing['suspended_at']);
        $this->assertSame('over_limit', $standing['suspension_reason']);
        $this->assertNull($standing['over_limit_since']);
        $this->assertNull($this->row($this->sibling), 'No row is made where none was.');
        $this->assertNull($this->row($this->sibling)?->suspended_at);
    }

    /**
     * Fix round 1: was "restarts every count". A whole-table restart mailed
     * every watched community the next morning; the terms key restarts only
     * those whose terms changed (BillingAutomationMemberLimitTest).
     */
    public function test_changing_the_platform_default_clears_no_count(): void
    {
        $this->runningClock($this->child);

        BillingSettings::set('over_limit_grace_days', 40, null);

        $this->assertSame('over', $this->row($this->child)->limit_notice_stage);
        $this->assertSame('due', $this->row($this->child)->last_notice_stage);
    }

    public function test_the_terms_key_names_the_rule_the_days_the_member_number_and_the_plan(): void
    {
        $this->standing($this->child, ['over_limit_action' => 'block_joining', 'over_limit_grace_days' => 12]);

        $this->assertSame('block_joining|12|250|7', OverLimitRule::termsKey($this->child, ['plan_id' => 7, 'plan_name' => 'X', 'max_users' => 250]));
    }
}
