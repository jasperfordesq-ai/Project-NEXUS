<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Services\TenantBillingService;
use App\Support\Billing\BillingLock;
use App\Support\Billing\PlanTerms;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * Billing control, the platform team's list (audit of 21 November 2026,
 * B27, B28, B29 and the card payer gap in "Assign plan").
 *
 *  - every price was the euro one, pound communities included;
 *  - "Assign plan" could not show the notes and date already stored, so
 *    saving anything wiped them;
 *  - a community on a retired plan could not be edited ("Plan not found");
 *  - for a card payer, "Assign plan" changed the record but not the card.
 */
final class BillingControlEditingTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    private int $plan;
    private int $otherPlan;

    protected function setUp(): void
    {
        parent::setUp();
        BillingLock::flush();
        PlanTerms::flush();

        $this->plan = $this->makePlan('Editing plan', 1);
        $this->otherPlan = $this->makePlan('Editing other plan', 1);
    }

    protected function tearDown(): void
    {
        try {
            BillingLock::flush();
            PlanTerms::flush();
        } finally {
            parent::tearDown();
        }
    }

    private function makePlan(string $name, int $active): int
    {
        return (int) DB::table('pay_plans')->insertGetId([
            'name' => $name . ' ' . bin2hex(random_bytes(3)), 'slug' => 'editing-' . bin2hex(random_bytes(5)),
            'tier_level' => 9, 'price_monthly' => 100, 'price_yearly' => 1000,
            'price_monthly_gbp' => 85, 'price_yearly_gbp' => 850,
            'max_users' => 50, 'is_active' => $active, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function community(?string $currency = null): int
    {
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => 'Editing community ' . bin2hex(random_bytes(3)), 'slug' => 'editing-' . bin2hex(random_bytes(5)),
            'is_active' => 1, 'parent_id' => 1, 'depth' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $id)->update(['path' => "/1/{$id}/"]);
        if ($currency !== null) {
            DB::table('tenant_settings')->insert([
                'tenant_id' => $id, 'setting_key' => 'general.default_currency', 'setting_value' => $currency,
            ]);
        }

        return $id;
    }

    /** @param array<string, mixed> $extra */
    private function onPlan(int $tenantId, int $planId, array $extra = []): int
    {
        return (int) DB::table('tenant_plan_assignments')->insertGetId($extra + [
            'tenant_id' => $tenantId, 'pay_plan_id' => $planId, 'status' => 'active',
            'starts_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    /** @return array<string, mixed> */
    private function row(int $tenantId): array
    {
        return collect(TenantBillingService::getBillingSnapshot())->firstWhere('id', $tenantId);
    }

    public function test_a_pound_community_is_shown_its_pound_price_and_a_euro_one_its_euro_price(): void
    {
        $pound = $this->community('gbp');
        $this->onPlan($pound, $this->plan, ['discount_percentage' => 10]);
        $euro = $this->community();
        $this->onPlan($euro, $this->plan);

        $poundPlan = $this->row($pound)['current_plan'];
        $this->assertSame('gbp', $poundPlan['currency']);
        $this->assertSame(85.0, $poundPlan['price_monthly']);
        $this->assertSame(850.0, $poundPlan['price_yearly']);
        $this->assertSame(76.5, $poundPlan['effective_price']['monthly'], 'the discount comes off the pound price');

        $euroPlan = $this->row($euro)['current_plan'];
        $this->assertSame('eur', $euroPlan['currency']);
        $this->assertSame(100.0, $euroPlan['price_monthly']);
    }

    public function test_the_notes_and_review_date_already_stored_come_back_so_saving_does_not_wipe_them(): void
    {
        $community = $this->community();
        $this->onPlan($community, $this->plan, ['notes' => 'Agreed with the board in March.', 'expires_at' => '2027-03-01 00:00:00']);

        $plan = $this->row($community)['current_plan'];

        $this->assertSame('Agreed with the board in March.', $plan['notes']);
        $this->assertStringStartsWith('2027-03-01', (string) $plan['expires_at']);
        $this->assertNull($plan['billing_interval'], 'paid by hand: no card period');
    }

    public function test_a_community_on_a_retired_plan_can_still_have_its_price_edited(): void
    {
        $retired = $this->makePlan('Retired plan', 0);
        $community = $this->community();
        $record = $this->onPlan($community, $retired);
        $this->actAsPlatformTeam();

        $this->apiPost('/v2/admin/super/billing/assign-plan', [
            'tenant_id' => $community, 'pay_plan_id' => $retired, 'custom_price_monthly' => 20,
        ])->assertStatus(200);

        $this->assertSame(20.0, (float) DB::table('tenant_plan_assignments')->where('id', $record)->value('custom_price_monthly'));
        $this->assertFalse($this->row($community)['current_plan']['is_active'], 'the screen is told the plan is retired');

        // Nobody new is put on a retired plan.
        $other = $this->community();
        $this->apiPost('/v2/admin/super/billing/assign-plan', [
            'tenant_id' => $other, 'pay_plan_id' => $retired,
        ])->assertStatus(404);
    }

    public function test_a_review_date_that_is_not_a_date_is_refused(): void
    {
        $community = $this->community();
        $this->actAsPlatformTeam();

        $this->apiPost('/v2/admin/super/billing/assign-plan', [
            'tenant_id' => $community, 'pay_plan_id' => $this->plan, 'expires_at' => 'next spring',
        ])->assertStatus(422);
    }

    public function test_a_card_payers_plan_and_price_are_not_changed_here_but_its_notes_can_be(): void
    {
        // A failed renewal: the record is `expired`, Stripe is still collecting.
        $community = $this->community();
        $record = $this->onPlan($community, $this->plan, [
            'status' => 'expired', 'stripe_subscription_id' => 'sub_' . bin2hex(random_bytes(6)), 'stripe_status' => 'past_due',
        ]);
        $this->actAsPlatformTeam();

        // Another plan: the card would go on being charged for the old one.
        $this->apiPost('/v2/admin/super/billing/assign-plan', [
            'tenant_id' => $community, 'pay_plan_id' => $this->otherPlan,
        ])->assertStatus(422)->assertJsonPath('errors.0.code', 'CARD_PAYER');

        // A special price: shown, and never charged.
        $this->apiPost('/v2/admin/super/billing/assign-plan', [
            'tenant_id' => $community, 'pay_plan_id' => $this->plan, 'discount_percentage' => 25,
        ])->assertStatus(422)->assertJsonPath('errors.0.code', 'CARD_PAYER');

        $this->assertSame(1, DB::table('tenant_plan_assignments')->where('tenant_id', $community)->count());
        $this->assertSame($this->plan, (int) DB::table('tenant_plan_assignments')->where('id', $record)->value('pay_plan_id'));

        // Notes and the review date, on the same plan: saved on the record
        // the card is charged on, not on a second one beside it.
        $this->apiPost('/v2/admin/super/billing/assign-plan', [
            'tenant_id' => $community, 'pay_plan_id' => $this->plan, 'notes' => 'Card failed twice in November.', 'expires_at' => '2027-01-15',
        ])->assertStatus(200);

        $this->assertSame(1, DB::table('tenant_plan_assignments')->where('tenant_id', $community)->count());
        $saved = DB::table('tenant_plan_assignments')->where('id', $record)->first();
        $this->assertSame('Card failed twice in November.', $saved->notes);
        $this->assertSame('expired', $saved->status, 'the card record keeps its state');
    }

    public function test_the_export_lists_every_community_with_what_the_screen_shows(): void
    {
        $pound = $this->community('gbp');
        $this->onPlan($pound, $this->plan);
        $noPlan = $this->community();
        DB::table('tenant_billing_standing')->insert([
            'tenant_id' => $pound, 'paid_until' => '2027-02-01', 'created_at' => now(), 'updated_at' => now(),
        ]);
        BillingLock::flush();

        $lines = preg_split('/\r?\n/', trim(TenantBillingService::exportCsv())) ?: [];
        $header = str_getcsv($lines[0]);
        $byId = [];
        foreach (array_slice($lines, 1) as $line) {
            $cells = str_getcsv($line);
            $byId[(int) $cells[0]] = array_combine($header, $cells);
        }

        foreach (['active_members', 'currency', 'effective_monthly_price', 'pays', 'paid_until', 'standing'] as $column) {
            $this->assertContains($column, $header);
        }
        $this->assertNotContains('is_paused', $header, 'a column for a switch that does nothing');

        $this->assertSame('gbp', $byId[$pound]['currency']);
        $this->assertSame('85.00', $byId[$pound]['effective_monthly_price']);
        $this->assertSame('2027-02-01', $byId[$pound]['paid_until']);
        $this->assertSame('platform_invoice', $byId[$pound]['pays']);
        $this->assertSame('open', $byId[$pound]['standing']);

        // A community with no plan is in the file too: it is the one to chase.
        $this->assertArrayHasKey($noPlan, $byId);
        $this->assertSame('', $byId[$noPlan]['plan_name']);
    }
}
