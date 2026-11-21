<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Support\Billing\BillingLock;
use App\Support\Billing\PlanTerms;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * The platform team's plan endpoints edit every part of a plan the table
 * holds: both currencies' prices, both setup fees, and the allowances.
 *
 * Until 21 November 2026 they edited the euro price and the member number
 * only, so pound prices and setup fees could be changed nowhere but the
 * database, and GET one / POST / PUT answered with fewer fields than the list.
 */
final class PlanEndpointsTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;
    use FakesStripeHttp;

    /** Every field the edit form reads off a plan. */
    private const EDITABLE = [
        'price_monthly_gbp', 'price_yearly_gbp', 'setup_fee', 'setup_fee_gbp',
        'max_communities', 'storage_gb', 'emails_per_month', 'max_users', 'description',
    ];

    private int $planId;

    protected function setUp(): void
    {
        parent::setUp();
        BillingLock::flush();
        PlanTerms::flush();
        $this->installFakeStripe();

        $this->planId = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Endpoint plan',
            'slug' => 'endpoint-plan-' . bin2hex(random_bytes(4)),
            'tier_level' => 9,
            'price_monthly' => 40,
            'price_yearly' => 400,
            'max_users' => 100,
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
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

    /** @return array<string, mixed> */
    private function fullPayload(): array
    {
        return [
            'price_monthly_gbp' => 120.50,
            'price_yearly_gbp' => 1205,
            'setup_fee' => 10,
            'setup_fee_gbp' => 9,
            'max_communities' => 2,
            'storage_gb' => 7,
            'emails_per_month' => 6000,
            'max_users' => 250,
            'description' => 'x',
        ];
    }

    private function assertHoldsFullPayload(array $plan): void
    {
        $this->assertEqualsWithDelta(120.50, (float) $plan['price_monthly_gbp'], 0.001);
        $this->assertEqualsWithDelta(1205.0, (float) $plan['price_yearly_gbp'], 0.001);
        $this->assertEqualsWithDelta(10.0, (float) $plan['setup_fee'], 0.001);
        $this->assertEqualsWithDelta(9.0, (float) $plan['setup_fee_gbp'], 0.001);
        $this->assertSame(2, (int) $plan['max_communities']);
        $this->assertSame(7, (int) $plan['storage_gb']);
        $this->assertSame(6000, (int) $plan['emails_per_month']);
        $this->assertSame(250, (int) $plan['max_users']);
        $this->assertSame('x', $plan['description']);
    }

    public function test_update_accepts_every_price_and_allowance_field(): void
    {
        $this->actAsPlatformTeam();

        $response = $this->apiPut("/v2/admin/plans/{$this->planId}", $this->fullPayload());

        $response->assertStatus(200);
        $this->assertHoldsFullPayload((array) DB::table('pay_plans')->where('id', $this->planId)->first());
        $data = $response->json('data');
        foreach (self::EDITABLE as $key) {
            $this->assertArrayHasKey($key, $data, "response.{$key}");
        }
        $this->assertHoldsFullPayload($data);
        // Allowances come back as numbers, as the list sends them.
        $this->assertSame(2, $data['max_communities']);
        $this->assertSame(6000, $data['emails_per_month']);
        $this->assertSame([], $data['stripe_price_warnings'], 'no Stripe price to replace, so nothing failed');
    }

    public function test_get_one_returns_the_same_fields_as_the_list(): void
    {
        $this->actAsPlatformTeam();

        $list = collect($this->apiGet('/v2/admin/plans')->assertStatus(200)->json('data'))
            ->firstWhere('id', $this->planId);
        $this->assertNotNull($list);

        $one = $this->apiGet("/v2/admin/plans/{$this->planId}")->assertStatus(200)->json('data');

        $listKeys = array_keys($list);
        $oneKeys = array_keys($one);
        sort($listKeys);
        sort($oneKeys);
        $this->assertSame($listKeys, $oneKeys);
        foreach (self::EDITABLE as $key) {
            $this->assertSame($list[$key], $one[$key], $key);
        }

        // The form's Stripe panel shows every stored id without a sync.
        DB::table('pay_plans')->where('id', $this->planId)->update([
            'stripe_product_id' => 'prod_panel',
            'stripe_price_id_monthly' => 'price_panel_eur_m',
            'stripe_price_id_yearly' => 'price_panel_eur_y',
            'stripe_price_id_monthly_gbp' => 'price_panel_gbp_m',
            'stripe_price_id_yearly_gbp' => 'price_panel_gbp_y',
        ]);
        $one = $this->apiGet("/v2/admin/plans/{$this->planId}")->assertStatus(200)->json('data');
        $this->assertSame('prod_panel', $one['stripe_product_id']);
        $this->assertSame('price_panel_eur_m', $one['stripe_price_id_monthly']);
        $this->assertSame('price_panel_eur_y', $one['stripe_price_id_yearly']);
        $this->assertSame('price_panel_gbp_m', $one['stripe_price_id_monthly_gbp']);
        $this->assertSame('price_panel_gbp_y', $one['stripe_price_id_yearly_gbp']);
    }

    public function test_stripe_price_warnings_sit_inside_data_beside_the_plan_fields(): void
    {
        $this->actAsPlatformTeam();

        $put = $this->apiPut("/v2/admin/plans/{$this->planId}", ['description' => 'y'])->assertStatus(200);
        $this->assertSame([], $put->json('data.stripe_price_warnings'));
        $this->assertSame($this->planId, $put->json('data.id'), 'beside the plan fields, not wrapped');
        $this->assertNull($put->json('stripe_price_warnings'), 'not at the top level');

        $post = $this->apiPost('/v2/admin/plans', ['name' => 'Warnings plan ' . bin2hex(random_bytes(3))])->assertStatus(201);
        $this->assertSame([], $post->json('data.stripe_price_warnings'));
        $this->assertIsInt($post->json('data.id'));
        $this->assertArrayHasKey('stripe_price_id_monthly_gbp', $post->json('data'));
        $this->assertNull($post->json('stripe_price_warnings'));
    }

    public function test_create_accepts_the_same_fields(): void
    {
        $this->actAsPlatformTeam();

        $response = $this->apiPost('/v2/admin/plans', ['name' => 'Created plan ' . bin2hex(random_bytes(3))] + $this->fullPayload());

        $response->assertStatus(201);
        $data = $response->json('data');
        $this->assertHoldsFullPayload($data);
        $this->assertHoldsFullPayload((array) DB::table('pay_plans')->where('id', $data['id'])->first());
        foreach (array_keys(collect($this->apiGet('/v2/admin/plans')->json('data'))->firstWhere('id', $data['id'])) as $key) {
            $this->assertArrayHasKey($key, $data, "create response.{$key}");
        }
    }

    public function test_negative_price_is_refused(): void
    {
        $this->actAsPlatformTeam();

        $response = $this->apiPut("/v2/admin/plans/{$this->planId}", ['price_monthly_gbp' => -1]);

        $response->assertStatus(422);
        $this->assertSame('VALIDATION_ERROR', $response->json('errors.0.code'));
        $this->assertSame('price_monthly_gbp', $response->json('errors.0.field'));
        $this->assertNull(DB::table('pay_plans')->where('id', $this->planId)->value('price_monthly_gbp'));

        $this->apiPost('/v2/admin/plans', ['name' => 'Refused plan', 'setup_fee' => -5])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'setup_fee');
    }

    public function test_member_number_below_one_is_refused(): void
    {
        $this->actAsPlatformTeam();

        foreach ([0, -3] as $bad) {
            $response = $this->apiPut("/v2/admin/plans/{$this->planId}", ['max_users' => $bad]);
            $response->assertStatus(422);
            $this->assertSame('VALIDATION_ERROR', $response->json('errors.0.code'));
            $this->assertSame('max_users', $response->json('errors.0.field'));
        }
        $this->assertSame(100, (int) DB::table('pay_plans')->where('id', $this->planId)->value('max_users'));

        // Empty means "no limit".
        foreach ([null, ''] as $none) {
            DB::table('pay_plans')->where('id', $this->planId)->update(['max_users' => 100]);
            $this->apiPut("/v2/admin/plans/{$this->planId}", ['max_users' => $none])->assertStatus(200);
            $this->assertNull(DB::table('pay_plans')->where('id', $this->planId)->value('max_users'));
        }
    }

    public function test_zero_communities_is_refused(): void
    {
        $this->actAsPlatformTeam();
        app()->setLocale('en');

        $response = $this->apiPut("/v2/admin/plans/{$this->planId}", ['max_communities' => 0]);

        $response->assertStatus(422);
        $this->assertSame('VALIDATION_ERROR', $response->json('errors.0.code'));
        $this->assertSame('max_communities', $response->json('errors.0.field'));
        $message = (string) $response->json('errors.0.message');
        $this->assertStringContainsString(__('api.plan_field_max_communities'), $message);
        $this->assertStringContainsString('1 or more', $message);
        $this->assertStringNotContainsString('max_communities', $message);

        // Empty means unlimited; storage and emails may still be 0.
        $this->apiPut("/v2/admin/plans/{$this->planId}", ['max_communities' => null, 'storage_gb' => 0, 'emails_per_month' => 0])
            ->assertStatus(200);
        $this->apiPut("/v2/admin/plans/{$this->planId}", ['max_communities' => 1])->assertStatus(200);
    }

    public function test_a_fractional_allowance_is_refused_in_the_readers_words(): void
    {
        $this->actAsPlatformTeam();
        app()->setLocale('en');

        $response = $this->apiPut("/v2/admin/plans/{$this->planId}", ['storage_gb' => 2.5]);

        $response->assertStatus(422);
        $this->assertSame('VALIDATION_ERROR', $response->json('errors.0.code'));
        $this->assertSame('storage_gb', $response->json('errors.0.field'), 'the field stays machine-readable for the form');
        $message = (string) $response->json('errors.0.message');
        $this->assertStringNotContainsString('storage_gb', $message);
        $this->assertStringContainsString(__('api.plan_field_storage_gb'), $message);

        // Every field's refusal names it in words, never by its column.
        foreach ([
            'price_monthly' => -1, 'price_yearly' => -1, 'setup_fee' => -1,
            'price_monthly_gbp' => -1, 'price_yearly_gbp' => -1, 'setup_fee_gbp' => -1,
            'max_communities' => 1.5, 'emails_per_month' => -2, 'max_users' => 0,
        ] as $field => $bad) {
            $refusal = $this->apiPut("/v2/admin/plans/{$this->planId}", [$field => $bad]);
            $refusal->assertStatus(422);
            $this->assertSame($field, $refusal->json('errors.0.field'));
            $text = (string) $refusal->json('errors.0.message');
            $this->assertStringNotContainsString($field, $text, "{$field} message names the column");
            $this->assertStringContainsString(__("api.plan_field_{$field}"), $text, "{$field} message names the field");
        }
    }

    public function test_a_community_admin_is_refused(): void
    {
        $this->actAsCommunityAdmin();

        $this->apiPut("/v2/admin/plans/{$this->planId}", $this->fullPayload())->assertStatus(403);
        $this->apiGet("/v2/admin/plans/{$this->planId}")->assertStatus(403);
        $this->apiPost('/v2/admin/plans', ['name' => 'Nope'] + $this->fullPayload())->assertStatus(403);
        $this->assertSame(100, (int) DB::table('pay_plans')->where('id', $this->planId)->value('max_users'));
    }
}
