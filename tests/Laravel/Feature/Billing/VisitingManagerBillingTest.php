<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\EmailDispatchService;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use App\Support\Billing\BillingLock;
use App\Support\Billing\PlanTerms;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Laravel\TestCase;

/**
 * F-640 (engagement E-134, 22 November 2026).
 *
 * A manager of a parent community (a tenant super admin) may enter a community
 * below its own for every `/api/v2/admin/*` request. That let it use the lower
 * community's OWN card billing: change the plan on its card subscription
 * (Stripe puts the difference on that community's card), start a card
 * checkout, open Stripe's card portal on its customer record, read its
 * invoices, and message the platform team in its name.
 *
 * Branch payments refuses exactly these communities on purpose: one that pays
 * the platform (`PAYS_PLATFORM`) and one with a card subscription
 * (`HAS_CARD_SUBSCRIPTION`) are the platform team's alone. The community's own
 * billing endpoints were the way round both.
 *
 * Now: a visiting manager is refused on every one of them (403
 * `VISITING_MANAGER_NO_BILLING`) before anything is read or sent. It may still
 * read the standing, which says it is visiting. The community's own admin and
 * a platform-wide account are unchanged.
 *
 * Through the real HTTP stack with a real token, because the thing being
 * proved is what gets through the community door. No real Stripe call:
 * FakesStripeHttp answers from memory.
 */
final class VisitingManagerBillingTest extends TestCase
{
    use DatabaseTransactions;
    use FakesStripeHttp;

    private const REFUSAL = 'VISITING_MANAGER_NO_BILLING';

    private int $hub;
    private int $community;
    private int $spark;
    private int $local;
    private int $record;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
        $this->installFakeStripe();
        app()->instance(EmailDispatchService::class, new class extends EmailDispatchService {
            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                return true;
            }
        });

        $this->hub = $this->makeCommunity('Visiting hub', 1, '/1/', true);
        $this->community = $this->makeCommunity('Card community below the hub', $this->hub, "/1/{$this->hub}/", false);
        DB::table('tenants')->where('id', $this->community)->update([
            'stripe_customer_id' => 'cus_visit_' . bin2hex(random_bytes(5)),
        ]);
        DB::table('tenant_settings')->insert([
            'tenant_id' => $this->community, 'setting_key' => 'general.default_currency', 'setting_value' => 'gbp',
        ]);

        $this->spark = (int) DB::table('pay_plans')->where('slug', 'spark')->value('id');
        $this->local = (int) DB::table('pay_plans')->where('slug', 'local')->value('id');
        DB::table('pay_plans')->where('id', $this->spark)->update(['is_active' => 1, 'max_users' => 100, 'price_monthly_gbp' => 150, 'price_yearly_gbp' => 1500]);
        DB::table('pay_plans')->where('id', $this->local)->update([
            'is_active' => 1, 'max_users' => 300, 'price_monthly_gbp' => 199, 'price_yearly_gbp' => 1990, 'setup_fee_gbp' => 645,
            'stripe_product_id' => 'prod_local', 'stripe_price_id_monthly_gbp' => 'price_local_month_gbp', 'stripe_price_id_yearly_gbp' => 'price_local_year_gbp',
        ]);

        $this->record = (int) DB::table('tenant_plan_assignments')->insertGetId([
            'tenant_id' => $this->community, 'pay_plan_id' => $this->spark, 'status' => 'active',
            'stripe_subscription_id' => 'sub_visit_1', 'stripe_status' => 'active', 'billing_interval' => 'monthly',
            'starts_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->stripe->subscription = [
            'status' => 'active', 'currency' => 'gbp',
            'items' => ['object' => 'list', 'data' => [['id' => 'si_visit_1', 'price' => ['id' => 'price_spark_month_gbp', 'currency' => 'gbp']]]],
        ];

        BillingLock::flush();
        PlanTerms::flush();
    }

    protected function tearDown(): void
    {
        try {
            unset($_SERVER['HTTP_AUTHORIZATION'], $_SERVER['HTTP_X_TENANT_ID'], $_SERVER['HTTP_X_TENANT_SLUG']);
            $this->uninstallFakeStripe();
            BillingLock::flush();
            PlanTerms::flush();
        } finally {
            parent::tearDown();
        }
    }

    private function makeCommunity(string $name, int $parentId, string $parentPath, bool $allowsSubtenants): int
    {
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => 'visit-' . bin2hex(random_bytes(5)),
            'is_active' => 1,
            'parent_id' => $parentId,
            'allows_subtenants' => $allowsSubtenants ? 1 : 0,
            'depth' => substr_count($parentPath, '/') - 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $id)->update(['path' => "{$parentPath}{$id}/"]);

        return $id;
    }

    /** @param array<string, mixed> $attributes */
    private function account(int $tenantId, array $attributes): User
    {
        $current = TenantContext::currentId();
        $user = User::factory()->forTenant($tenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 0,
            'is_god' => 0,
            'email_verified_at' => now(),
        ], $attributes));
        if ($current !== null) {
            TenantContext::setById($current);
        }

        return $user;
    }

    private function visitingManager(): User
    {
        return $this->account($this->hub, ['role' => 'admin', 'is_admin' => 1, 'is_tenant_super_admin' => 1]);
    }

    private function ownAdmin(): User
    {
        return $this->account($this->community, ['role' => 'admin', 'is_admin' => 1]);
    }

    /** @param array<string, mixed> $body */
    private function ask(string $method, string $uri, User $actor, array $body = []): TestResponse
    {
        // Carries second-factor assurance, so a refusal can only come from the
        // rule being tested, never from the two-step policy.
        $token = app(TokenService::class)->generateToken(
            (int) $actor->id,
            (int) $actor->tenant_id,
            TwoFactorPolicy::claims('totp'),
        );

        TenantContext::reset();
        unset($_SERVER['HTTP_X_TENANT_ID'], $_SERVER['HTTP_X_TENANT_SLUG']);
        app('auth')->forgetGuards();

        return $this->withHeaders([
            'X-Tenant-ID' => (string) $this->community,
            'Accept' => 'application/json',
            'Authorization' => 'Bearer ' . $token,
        ])->json($method, '/api' . $uri, $body);
    }

    private function row(): object
    {
        return DB::table('tenant_plan_assignments')->where('id', $this->record)->first();
    }

    /** Every request the Stripe stand-in was sent that would change something. */
    private function stripeWrites(): array
    {
        return array_values(array_filter(
            $this->stripe->requests,
            static fn (array $request): bool => strtolower((string) ($request['method'] ?? '')) !== 'get'
        ));
    }

    public function test_a_visiting_manager_cannot_change_the_plan_on_a_lower_communitys_card(): void
    {
        $response = $this->ask('POST', '/v2/admin/billing/change-plan', $this->visitingManager(), ['plan_id' => $this->local]);

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', self::REFUSAL);
        $this->assertSame([], $this->subscriptionUpdates(), 'nothing is sent to Stripe');
        $this->assertSame($this->spark, (int) $this->row()->pay_plan_id, 'the plan is as it was');
    }

    public function test_a_visiting_manager_cannot_start_a_card_checkout_for_a_lower_community(): void
    {
        // No card subscription yet. Whatever else would then be said to this
        // community, the visitor is refused first.
        DB::table('tenant_plan_assignments')->where('id', $this->record)->update([
            'stripe_subscription_id' => null, 'stripe_status' => null,
        ]);

        $response = $this->ask('POST', '/v2/admin/billing/checkout', $this->visitingManager(), [
            'plan_id' => $this->local, 'billing_interval' => 'monthly',
        ]);

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', self::REFUSAL);
        $this->assertSame([], $this->checkoutSessionsCreated());
        $this->assertSame([], $this->stripeWrites(), 'nothing is sent to Stripe');
    }

    public function test_a_visiting_manager_cannot_open_the_card_portal_of_a_lower_community(): void
    {
        $response = $this->ask('POST', '/v2/admin/billing/portal', $this->visitingManager());

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', self::REFUSAL);
        $this->assertSame([], $this->stripe->requests, 'nothing is asked of Stripe');
    }

    /**
     * @return array<string, array{0:string, 1:string}>
     */
    public static function refusedReadsAndMessages(): array
    {
        return [
            'the subscription' => ['GET', '/v2/admin/billing/subscription'],
            'the invoices' => ['GET', '/v2/admin/billing/invoices'],
            'a message to the platform team in its name' => ['POST', '/v2/admin/billing/upgrade-request'],
        ];
    }

    /** @dataProvider refusedReadsAndMessages */
    public function test_a_visiting_manager_is_refused_the_rest_of_the_communitys_own_billing(string $method, string $uri): void
    {
        $logBefore = DB::table('billing_audit_log')->where('tenant_id', $this->community)->count();

        $response = $this->ask($method, $uri, $this->visitingManager(), ['message' => 'Please move us to a bigger plan.']);

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', self::REFUSAL);
        $this->assertSame([], $this->stripe->requests, 'nothing is asked of Stripe');
        $this->assertSame($logBefore, DB::table('billing_audit_log')->where('tenant_id', $this->community)->count());
    }

    public function test_a_visiting_manager_may_read_the_standing_and_it_says_it_is_visiting(): void
    {
        $response = $this->ask('GET', '/v2/admin/billing/standing', $this->visitingManager());

        $response->assertOk();
        $response->assertJsonPath('data.visiting', true);
        $response->assertJsonPath('data.payer', 'platform_card');
    }

    public function test_the_communitys_own_admin_is_not_treated_as_a_visitor(): void
    {
        $admin = $this->ownAdmin();

        $standing = $this->ask('GET', '/v2/admin/billing/standing', $admin);
        $standing->assertOk();
        $standing->assertJsonPath('data.visiting', false);

        $change = $this->ask('POST', '/v2/admin/billing/change-plan', $admin, ['plan_id' => $this->local]);
        $change->assertOk();
        $this->assertCount(1, $this->subscriptionUpdates());
        $this->assertSame($this->local, (int) $this->row()->pay_plan_id);
    }

    /**
     * The rule is about a parent community's manager. A platform-wide account
     * is not a visitor anywhere, and what it may do with a community's card
     * is a separate question, left exactly as it was.
     */
    public function test_a_platform_wide_account_is_left_as_it_was(): void
    {
        $platform = $this->account(1, ['role' => 'admin', 'is_admin' => 1, 'is_super_admin' => 1]);

        $standing = $this->ask('GET', '/v2/admin/billing/standing', $platform);
        $standing->assertOk();
        $standing->assertJsonPath('data.visiting', false);

        $subscription = $this->ask('GET', '/v2/admin/billing/subscription', $platform);
        $this->assertNotSame(self::REFUSAL, $subscription->json('errors.0.code'));
    }

    /** Beside, not below: refused at the community door, as it always was. */
    public function test_a_manager_of_a_community_beside_it_does_not_get_in_at_all(): void
    {
        $other = $this->makeCommunity('Another hub', 1, '/1/', true);
        $outsider = $this->account($other, ['role' => 'admin', 'is_admin' => 1, 'is_tenant_super_admin' => 1]);

        $response = $this->ask('POST', '/v2/admin/billing/change-plan', $outsider, ['plan_id' => $this->local]);

        $this->assertContains($response->getStatusCode(), [401, 403]);
        $this->assertSame([], $this->subscriptionUpdates());
        $this->assertSame($this->spark, (int) $this->row()->pay_plan_id);
    }
}
