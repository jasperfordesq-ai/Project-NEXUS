<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Core\TenantContext;
use App\Models\User;
use App\Support\Billing\BillingLock;
use App\Support\Billing\PlanTerms;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * What a community's own billing pages read, key for key:
 *
 *  - GET /v2/admin/billing/subscription  → BillingPage, PlanSelector, CheckoutReturn
 *  - GET /v2/admin/billing/standing      → BillingPage (also the admin banner and sidebar)
 *  - GET /v2/admin/billing/invoices      → InvoiceHistory
 *
 * Types `SubscriptionDetails`, `OwnStanding` and `Invoice` in
 * react-frontend/src/admin/api/billingApi.ts. Rename a key here and it must be
 * renamed there in the same commit.
 *
 * Nothing pinned these before 21 November 2026. The pages read `plan_id`,
 * `current_period_end`, `user_count`, `plan.max_users`, and an invoice's
 * `number`, `date` and `amount`, none of which the server sent; their own
 * tests passed on invented data, and a real community saw "Unlimited Users",
 * "Unknown interval", a next payment of "--", and invoices with no date and
 * an amount of "NaN".
 *
 * No real Stripe call: FakesStripeHttp answers from memory.
 */
final class CommunityBillingPageContractTest extends TestCase
{
    use DatabaseTransactions;
    use FakesStripeHttp;

    private const SUBSCRIPTION_KEYS = [
        'id', 'pay_plan_id', 'plan_name', 'plan_slug', 'plan_tier_level', 'plan_description',
        'status', 'stripe_status', 'billing_interval',
        'starts_at', 'current_period_end', 'trial_ends_at',
        'stripe_subscription_id', 'has_card_subscription',
    ];

    private const INVOICE_KEYS = ['id', 'number', 'date', 'amount', 'currency', 'status', 'hosted_invoice_url', 'invoice_pdf'];

    private int $community;
    private int $spark;
    private int $local;

    protected function setUp(): void
    {
        parent::setUp();
        $this->installFakeStripe();

        $this->community = (int) DB::table('tenants')->insertGetId([
            'name' => 'Billing page community',
            'slug' => 'billing-page-' . bin2hex(random_bytes(5)),
            'is_active' => 1,
            'parent_id' => 1,
            'stripe_customer_id' => 'cus_page_' . bin2hex(random_bytes(5)),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $this->community)->update(['path' => "/1/{$this->community}/"]);
        DB::table('tenant_settings')->insert([
            'tenant_id' => $this->community, 'setting_key' => 'general.default_currency', 'setting_value' => 'gbp',
        ]);

        $this->spark = (int) DB::table('pay_plans')->where('slug', 'spark')->value('id');
        $this->local = (int) DB::table('pay_plans')->where('slug', 'local')->value('id');
        DB::table('pay_plans')->whereIn('id', [$this->spark, $this->local])->update(['is_active' => 1]);
        DB::table('pay_plans')->where('id', $this->local)->update([
            'max_users' => 300, 'price_monthly_gbp' => 199, 'price_yearly_gbp' => 1990, 'setup_fee_gbp' => 645,
        ]);

        BillingLock::flush();
        PlanTerms::flush();

        $this->testTenantId = $this->community;
        Sanctum::actingAs(User::factory()->forTenant($this->community)->create([
            'status' => 'active', 'is_approved' => true, 'role' => 'admin',
        ]), ['*']);
        TenantContext::setById($this->community);
    }

    protected function tearDown(): void
    {
        // parent::tearDown() rolls the transaction back; it must always run.
        try {
            $this->uninstallFakeStripe();
            BillingLock::flush();
            PlanTerms::flush();
        } finally {
            parent::tearDown();
        }
    }

    /** @param array<string, mixed> $values */
    private function record(array $values): int
    {
        return (int) DB::table('tenant_plan_assignments')->insertGetId($values + [
            'tenant_id' => $this->community,
            'pay_plan_id' => $this->local,
            'status' => 'active',
            'starts_at' => '2026-11-01 09:00:00',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    // ── /subscription ───────────────────────────────────────────────────────

    public function test_the_subscription_answer_carries_exactly_the_keys_the_pages_read(): void
    {
        $this->record([
            'stripe_subscription_id' => 'sub_page_1', 'stripe_status' => 'active',
            'billing_interval' => 'yearly', 'stripe_current_period_end' => '2027-11-01 09:00:00',
        ]);

        $data = $this->apiGet('/v2/admin/billing/subscription')->assertOk()->json('data');

        $this->assertSame(self::SUBSCRIPTION_KEYS, array_keys($data));
        $this->assertSame($this->local, $data['pay_plan_id']);
        $this->assertSame('Local', $data['plan_name']);
        $this->assertSame('active', $data['status']);
        $this->assertSame('active', $data['stripe_status']);
        $this->assertSame('yearly', $data['billing_interval']);
        $this->assertSame('sub_page_1', $data['stripe_subscription_id']);
        $this->assertTrue($data['has_card_subscription']);
        // ISO 8601, so the page can show a date: it showed "--" for everyone.
        $this->assertSame('2027-11-01', substr((string) $data['current_period_end'], 0, 10));
        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/', (string) $data['current_period_end']);
        $this->assertNull($data['trial_ends_at']);
    }

    public function test_a_plan_given_by_hand_has_no_card_facts(): void
    {
        $this->record([]);

        $data = $this->apiGet('/v2/admin/billing/subscription')->assertOk()->json('data');

        $this->assertSame(self::SUBSCRIPTION_KEYS, array_keys($data));
        $this->assertNull($data['stripe_subscription_id']);
        $this->assertNull($data['stripe_status']);
        $this->assertNull($data['billing_interval'], 'not known is null, never a made-up period');
        $this->assertNull($data['current_period_end']);
        $this->assertFalse($data['has_card_subscription']);
    }

    public function test_the_record_in_force_is_shown_not_the_newest_one(): void
    {
        // A plan given by hand is in force; a newer record is a cancelled
        // card subscription. "The most recently created" used to win.
        $inForce = $this->record(['pay_plan_id' => $this->local]);
        $this->record([
            'pay_plan_id' => $this->spark, 'status' => 'cancelled',
            'stripe_subscription_id' => 'sub_page_gone', 'stripe_status' => 'canceled',
            'created_at' => now()->addMinute(),
        ]);

        $data = $this->apiGet('/v2/admin/billing/subscription')->assertOk()->json('data');

        $this->assertSame($inForce, $data['id']);
        $this->assertSame('Local', $data['plan_name']);
        $this->assertSame('active', $data['status']);
    }

    public function test_a_community_with_no_plan_record_gets_no_data(): void
    {
        $response = $this->apiGet('/v2/admin/billing/subscription')->assertOk();

        $this->assertNull($response->json('data'));
    }

    // ── /standing ───────────────────────────────────────────────────────────

    public function test_the_standing_answer_carries_the_plan_as_it_applies_and_the_paid_until_date(): void
    {
        $this->record([]);
        DB::table('tenant_billing_standing')->insert([
            'tenant_id' => $this->community, 'paid_until' => '2026-12-01', 'created_at' => now(), 'updated_at' => now(),
        ]);
        BillingLock::flush();

        $data = $this->apiGet('/v2/admin/billing/standing')->assertOk()->json('data');

        $this->assertSame(
            ['paused', 'own', 'since', 'payee', 'payee_name', 'payer', 'paid_until', 'overdue_days', 'member_limit', 'plan'],
            array_keys($data)
        );
        $this->assertSame('2026-12-01', $data['paid_until']);
        $this->assertSame('platform_invoice', $data['payer']);

        $this->assertSame(
            ['name', 'description', 'max_users', 'price_monthly', 'price_yearly', 'setup_fee', 'currency', 'terms'],
            array_keys($data['plan'])
        );
        // A pound community: pounds, and the pound setup fee.
        $this->assertSame('gbp', $data['plan']['currency']);
        $this->assertSame(300, $data['plan']['max_users']);
        $this->assertSame(199.0, (float) $data['plan']['price_monthly']);
        $this->assertSame(1990.0, (float) $data['plan']['price_yearly']);
        $this->assertSame(645.0, (float) $data['plan']['setup_fee']);
        $this->assertNotSame('', (string) $data['plan']['description']);

        // Active members against the plan's number: what "Unlimited Users" hid.
        $this->assertSame(['used', 'max', 'percent', 'stage', 'rule', 'acts_on'], array_keys($data['member_limit']));
        $this->assertSame(300, $data['member_limit']['max']);
    }

    public function test_a_card_payer_whose_card_failed_is_still_told_it_pays_by_card(): void
    {
        $this->record(['status' => 'expired', 'stripe_subscription_id' => 'sub_page_due', 'stripe_status' => 'past_due']);

        $this->assertSame('platform_card', $this->apiGet('/v2/admin/billing/standing')->assertOk()->json('data.payer'));
        $this->assertTrue($this->apiGet('/v2/admin/billing/subscription')->assertOk()->json('data.has_card_subscription'));
    }

    // ── /invoices ───────────────────────────────────────────────────────────

    public function test_an_invoice_carries_its_number_its_date_and_its_amount_in_pounds_not_pence(): void
    {
        $this->stripe->invoices = [
            [
                'id' => 'in_page_1', 'object' => 'invoice', 'number' => 'NEXUS-0007',
                'created' => strtotime('2026-11-01 09:00:00'),
                'total' => 84400, 'amount_paid' => 84400, 'currency' => 'gbp', 'status' => 'paid',
                'hosted_invoice_url' => 'https://invoice.stripe.test/in_page_1',
                'invoice_pdf' => 'https://invoice.stripe.test/in_page_1.pdf',
            ],
            [
                // A draft: Stripe has not numbered it and has no links yet.
                'id' => 'in_page_2', 'object' => 'invoice', 'number' => null,
                'created' => strtotime('2026-12-01 09:00:00'),
                'total' => 19900, 'amount_paid' => 0, 'currency' => 'gbp', 'status' => 'draft',
                'hosted_invoice_url' => null, 'invoice_pdf' => null,
            ],
        ];

        $rows = $this->apiGet('/v2/admin/billing/invoices')->assertOk()->json('data');

        $this->assertCount(2, $rows);
        $this->assertSame(self::INVOICE_KEYS, array_keys($rows[0]));
        $this->assertSame('NEXUS-0007', $rows[0]['number']);
        $this->assertSame('2026-11-01', substr((string) $rows[0]['date'], 0, 10));
        // £844.00 (first month £199 + £645 setup), never 84400.
        $this->assertSame(844.0, (float) $rows[0]['amount']);
        $this->assertSame('GBP', $rows[0]['currency']);
        $this->assertSame('paid', $rows[0]['status']);
        $this->assertSame('https://invoice.stripe.test/in_page_1', $rows[0]['hosted_invoice_url']);

        $this->assertNull($rows[1]['number']);
        // What the invoice is for, even before any of it is paid.
        $this->assertSame(199.0, (float) $rows[1]['amount']);
        $this->assertSame('draft', $rows[1]['status']);
        $this->assertNull($rows[1]['invoice_pdf']);
    }

    public function test_a_community_that_has_never_paid_by_card_has_no_invoices_and_stripe_is_not_asked(): void
    {
        DB::table('tenants')->where('id', $this->community)->update(['stripe_customer_id' => null]);

        $this->assertSame([], $this->apiGet('/v2/admin/billing/invoices')->assertOk()->json('data'));
        $this->assertSame([], $this->stripe->requests);
    }

    // ── which plans card checkout sells ─────────────────────────────────────

    public function test_a_plan_made_for_one_community_is_not_listed_and_cannot_be_bought_by_another(): void
    {
        // A bespoke plan the platform team created, active, at Spark's tier
        // and sorting before it: it used to take Spark's place in the public
        // list, and any community's admin could buy it by posting its id.
        $bespoke = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'AAA Bespoke', 'slug' => 'aaa-bespoke-' . bin2hex(random_bytes(4)), 'tier_level' => 1,
            'price_monthly' => 5, 'price_yearly' => 50, 'is_active' => 1, 'is_standard' => 0,
            'created_at' => now(), 'updated_at' => now(),
        ]);

        $listed = array_column($this->apiGet('/v2/billing/plans')->assertOk()->json('data'), 'id');
        $this->assertNotContains($bespoke, $listed);
        $this->assertContains($this->spark, $listed);
        $this->assertContains($this->local, $listed);

        $response = $this->apiPost('/v2/admin/billing/checkout', ['plan_id' => $bespoke, 'billing_interval' => 'monthly']);

        $response->assertStatus(422);
        $this->assertSame('VALIDATION_ERROR', $response->json('errors.0.code'));
        $this->assertSame('plan_id', $response->json('errors.0.field'));
        $this->assertSame([], $this->checkoutSessionsCreated(), 'no checkout was started');
        $this->assertSame(0, DB::table('tenant_plan_assignments')->where('tenant_id', $this->community)->count());
    }

    public function test_a_no_charge_plan_that_is_not_standard_cannot_be_switched_on_by_a_community(): void
    {
        // It was activated on the spot, with no Stripe step and nobody asked.
        $free = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Sponsored', 'slug' => 'sponsored-' . bin2hex(random_bytes(4)), 'tier_level' => 0,
            'price_monthly' => 0, 'price_yearly' => 0, 'is_active' => 1, 'is_standard' => 0,
            'created_at' => now(), 'updated_at' => now(),
        ]);

        $this->apiPost('/v2/admin/billing/checkout', ['plan_id' => $free, 'billing_interval' => 'monthly'])->assertStatus(422);

        $this->assertSame(0, DB::table('tenant_plan_assignments')->where('tenant_id', $this->community)->count());
    }

    public function test_a_standard_plan_can_be_bought_and_the_checkout_records_the_period(): void
    {
        $response = $this->apiPost('/v2/admin/billing/checkout', ['plan_id' => $this->local, 'billing_interval' => 'yearly']);

        $response->assertOk();
        $sessions = $this->checkoutSessionsCreated();
        $this->assertCount(1, $sessions);
        $this->assertSame('yearly', $sessions[0]['metadata']['nexus_billing_interval'] ?? null);
        $this->assertSame((string) $this->local, $sessions[0]['metadata']['nexus_plan_id'] ?? null);
    }
}
