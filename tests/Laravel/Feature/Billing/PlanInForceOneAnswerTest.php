<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Core\SuperPanelAccess;
use App\Services\BillingAutomationService;
use App\Services\BillingStandingService;
use App\Services\TenantBillingService;
use App\Support\Billing\BillingLock;
use App\Support\Billing\BillingSettings;
use App\Support\Billing\OverLimitRule;
use App\Support\Billing\PlanTerms;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * "Which plan record is in force" and "who does it pay" each have one answer
 * (Stage 5 of the billing ease-of-use plan, 23 November 2026).
 *
 * The plan in force is an active record, a trial, or a card payer's record
 * after a failed renewal (stored `expired` while Stripe still collects):
 * TenantBillingService::PLAN_IN_FORCE_SQL, read through
 * PlanTerms::assignmentInForce(). Several places still asked for
 * `status = 'active'` under a comment saying it was the same record:
 *
 *  - changing a plan (a parent's manager, the platform team, the daily
 *    check) put a SECOND, active record beside a trial or a failed-card one;
 *  - the "your plan changed" email quoted the list price, not the agreed one;
 *  - "move up to the next plan" did not see an agreed price and would have
 *    moved a community a person should decide for.
 *
 * And three counts of "the communities that pay this parent" still took a
 * community with no stored payer to pay its parent, after
 * BillingStandingService::defaultPayer() learned (22 Nov) that one with a
 * card pays the platform.
 */
final class PlanInForceOneAnswerTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    private int $hub;
    private int $community;
    private int $small;
    private int $big;

    protected function setUp(): void
    {
        parent::setUp();
        BillingLock::flush();
        BillingSettings::flush();
        PlanTerms::flush();

        $this->community = $this->makeCommunity('In force', 1, '/1/');
        $this->small = $this->makePlan('Small in force', 10, 10.00, 100.00, 1);
        $this->big = $this->makePlan('Big in force', 50, 40.00, 400.00, 2);
        PlanTerms::flush();
    }

    protected function tearDown(): void
    {
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
            'name' => $name . ' ' . bin2hex(random_bytes(3)), 'slug' => 'inforce-' . bin2hex(random_bytes(5)),
            'is_active' => 1, 'parent_id' => $parentId, 'allows_subtenants' => $hub ? 1 : 0,
            'depth' => substr_count($parentPath, '/') - 1, 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $id)->update(['path' => "{$parentPath}{$id}/"]);

        return $id;
    }

    private function makePlan(string $name, int $maxUsers, float $monthly, float $yearly, int $tier): int
    {
        return (int) DB::table('pay_plans')->insertGetId([
            'name' => $name, 'slug' => 'inforce-' . bin2hex(random_bytes(4)), 'tier_level' => $tier,
            'max_users' => $maxUsers, 'price_monthly' => $monthly, 'price_yearly' => $yearly,
            'is_active' => 1, 'is_standard' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    /** @param array<string, mixed> $values */
    private function record(int $tenantId, int $planId, array $values = []): int
    {
        $id = (int) DB::table('tenant_plan_assignments')->insertGetId($values + [
            'tenant_id' => $tenantId, 'pay_plan_id' => $planId, 'status' => 'active',
            'starts_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);
        PlanTerms::flush();

        return $id;
    }

    /** @return list<object> */
    private function records(int $tenantId): array
    {
        return DB::table('tenant_plan_assignments')->where('tenant_id', $tenantId)->orderBy('id')->get()->all();
    }

    // ── The one reader ──────────────────────────────────────────────────────

    public function test_the_record_in_force_is_an_active_one_a_trial_or_a_failed_card_one(): void
    {
        $this->assertNull(PlanTerms::assignmentInForce($this->community));

        $cancelled = $this->record($this->community, $this->small, ['status' => 'cancelled']);
        $this->assertNull(PlanTerms::assignmentInForce($this->community), 'a cancelled record is not a plan it is on');

        $failedCard = $this->record($this->community, $this->small, [
            'status' => 'expired', 'stripe_subscription_id' => 'sub_inforce', 'stripe_status' => 'past_due',
        ]);
        $this->assertSame($failedCard, (int) PlanTerms::assignmentInForce($this->community)->id);

        $trial = $this->record($this->community, $this->big, ['status' => 'trial']);
        $this->assertSame($trial, (int) PlanTerms::assignmentInForce($this->community)->id, 'a trial outranks a failed-card record');

        $active = $this->record($this->community, $this->big);
        $row = PlanTerms::assignmentInForce($this->community, ['id', 'pay_plan_id', 'status']);
        $this->assertSame($active, (int) $row->id, 'an active record outranks both');
        $this->assertSame(['id', 'pay_plan_id', 'status'], array_keys((array) $row), 'only the columns asked for');
        $this->assertSame($this->big, PlanTerms::forCommunity($this->community)['plan_id'], 'and forCommunity() reads the same record');
        $this->assertNotSame($cancelled, (int) $row->id);
    }

    public function test_a_column_name_that_is_not_a_plain_name_is_refused(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        PlanTerms::assignmentInForce($this->community, ['id; DROP TABLE users']);
    }

    // ── Changing a plan writes the record in force ──────────────────────────

    public function test_changing_the_plan_of_a_community_on_a_trial_changes_that_record(): void
    {
        $trial = $this->record($this->community, $this->small, ['status' => 'trial']);

        TenantBillingService::changePlanOnly($this->community, $this->big, null, 'platform');

        $records = $this->records($this->community);
        $this->assertCount(1, $records, 'no second record beside the trial');
        $this->assertSame($trial, (int) $records[0]->id);
        $this->assertSame($this->big, (int) $records[0]->pay_plan_id);
        $this->assertSame('trial', $records[0]->status, 'the trial is not ended by a plan change');
    }

    public function test_the_platform_team_changing_a_failed_card_payers_plan_changes_the_cards_record(): void
    {
        $card = $this->record($this->community, $this->small, [
            'status' => 'expired', 'stripe_subscription_id' => 'sub_inforce_change', 'stripe_status' => 'past_due',
        ]);

        TenantBillingService::changePlanOnly($this->community, $this->big, null, 'platform');

        $records = $this->records($this->community);
        $this->assertCount(1, $records, 'no second, active record beside the one the card is charged on');
        $this->assertSame($card, (int) $records[0]->id);
        $this->assertSame($this->big, (int) $records[0]->pay_plan_id);
        $this->assertSame('expired', $records[0]->status);
    }

    public function test_a_community_with_no_record_in_force_still_gets_a_new_active_one(): void
    {
        $this->record($this->community, $this->small, ['status' => 'cancelled']);

        TenantBillingService::changePlanOnly($this->community, $this->big, null, 'platform');

        $records = $this->records($this->community);
        $this->assertCount(2, $records);
        $this->assertSame('cancelled', $records[0]->status, 'the cancelled record is history and is left alone');
        $this->assertSame('active', $records[1]->status);
        $this->assertSame($this->big, (int) $records[1]->pay_plan_id);
    }

    // ── The "your plan changed" email quotes the agreed price ───────────────

    public function test_the_plan_changed_notice_quotes_the_agreed_price_of_a_trial_record(): void
    {
        $this->record($this->community, $this->small, ['status' => 'trial', 'custom_price_monthly' => 7.00, 'custom_price_yearly' => 70.00]);

        $facts = TenantBillingService::planChangedFacts($this->community, null);

        $this->assertSame(7.0, (float) $facts['price_monthly'], 'the agreed price, not the list price of 10');
        $this->assertSame(70.0, (float) $facts['price_yearly']);
    }

    // ── "Move up" sees an agreed price on a trial record ────────────────────

    public function test_move_up_asks_a_person_when_a_trial_record_has_an_agreed_price(): void
    {
        $this->record($this->community, $this->small, ['status' => 'trial', 'custom_price_monthly' => 7.00]);

        $outcome = BillingAutomationService::moveOutcome(
            $this->community,
            ['plan_id' => $this->small, 'plan_name' => 'Small in force', 'max_users' => 10],
            ['effective_action' => 'upgrade', 'grace_days' => 10],
            12
        );

        $this->assertSame('custom_price', $outcome['reason'], 'a person decides the plan and price; the check does not move it');
    }

    // ── A card payer under a parent is not one of the parent's payers ───────

    public function test_a_child_that_pays_the_platform_by_card_is_not_counted_as_paying_its_parent(): void
    {
        $this->hub = $this->makeCommunity('In force hub', 1, '/1/', true);
        $paysHub = $this->makeCommunity('Pays its parent', $this->hub, "/1/{$this->hub}/");
        $paysByCard = $this->makeCommunity('Pays by card', $this->hub, "/1/{$this->hub}/");
        $this->record($paysHub, $this->small);
        // No stored payer for either: the card decides (defaultPayer()).
        $this->record($paysByCard, $this->small, ['stripe_subscription_id' => 'sub_inforce_card', 'stripe_status' => 'active']);

        $this->assertSame('parent', BillingStandingService::get($paysHub)['payer']);
        $this->assertSame('platform_card', BillingStandingService::get($paysByCard)['payer']);

        $this->assertSame([$paysHub], OverLimitRule::communitiesPaying($this->hub), 'the card payer is the platform\'s, not the hub\'s');
        $this->assertSame([$paysHub], OverLimitRule::communitiesPaying($this->hub, $this->small));

        $offered = collect(PlanTerms::offeredBy($this->hub))->firstWhere('plan_id', $this->small);
        $this->assertSame(1, $offered['communities_on_plan'], 'one community pays this hub on the plan, not two');

        // Branch plans lists each hub with how many communities pay it.
        $this->actAsPlatformTeam();
        $hubs = $this->apiGet('/v2/admin/super/branch-plans')->assertOk()->json('data.hubs');
        $listed = collect($hubs)->firstWhere('id', $this->hub);
        $this->assertNotNull($listed, 'the hub is on Branch plans');
        $this->assertSame(1, $listed['children_paying']);
    }
}
