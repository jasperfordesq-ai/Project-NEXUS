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
use App\Support\Billing\BillingLock;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * The platform team records a payment by hand, reads a community's payment
 * history, and sets how a community pays (Stage 6, Task B).
 *
 * The lock is also pinned in AdminSuperControllerPlatformTeamLockTest; this
 * file proves the door opens for the platform team and what happens when it
 * does, and names the tiers the owner asked about.
 */
final class BillingPaymentsEndpointsTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    private int $hub;
    private int $child;

    protected function setUp(): void
    {
        parent::setUp();

        $this->hub = $this->makeCommunity('Payments hub', 1, '/1/', true);
        $this->child = $this->makeCommunity('Payments hub child', $this->hub, "/1/{$this->hub}/");

        BillingLock::flush();
    }

    protected function tearDown(): void
    {
        // parent::tearDown() rolls the transaction back; it must always run.
        try {
            BillingLock::flush();
            SuperPanelAccess::reset();
        } finally {
            parent::tearDown();
        }
    }

    private function makeCommunity(string $name, int $parentId, string $parentPath, bool $hub = false): int
    {
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => 'paybyhand-' . bin2hex(random_bytes(5)),
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

    /** @return array<string, mixed> */
    private function body(array $overrides = []): array
    {
        return array_merge([
            'tenant_id' => $this->hub,
            'paid_until' => now()->addYear()->toDateString(),
            'received_on' => now()->toDateString(),
            'method' => 'bank_transfer',
            'reference' => 'BT-889',
            'amount' => 240.5,
            'currency' => 'EUR',
        ], $overrides);
    }

    // ── The door opens ──────────────────────────────────────────────────────

    public function test_the_platform_team_records_a_payment(): void
    {
        $actor = $this->actAsPlatformTeam();
        $paidUntil = now()->addYear()->toDateString();

        $response = $this->apiPost('/v2/admin/super/billing/standing/record-payment', $this->body(['paid_until' => $paidUntil]));

        $response->assertStatus(200);
        $this->assertSame($paidUntil, $response->json('data.standing.paid_until'));
        $paymentId = $response->json('data.payment_id');
        $this->assertIsInt($paymentId);

        $row = DB::table('billing_payments')->where('id', $paymentId)->first();
        $this->assertSame($this->hub, (int) $row->tenant_id);
        $this->assertSame('240.50', (string) $row->amount);
        $this->assertSame('EUR', $row->currency);
        $this->assertSame((int) $actor->id, (int) $row->recorded_by_user_id);
    }

    public function test_recording_a_payment_reopens_a_community_the_system_paused(): void
    {
        $this->actAsPlatformTeam();
        BillingStandingService::setPaidUntil($this->hub, now()->subDays(20)->toDateString(), null);
        BillingStandingService::suspend($this->hub, null, 'auto');

        $response = $this->apiPost('/v2/admin/super/billing/standing/record-payment', $this->body());

        $response->assertStatus(200);
        $this->assertFalse($response->json('data.standing.locked'));
        $this->assertFalse(BillingLock::isLocked($this->hub));
    }

    public function test_a_refused_payment_is_a_422_with_its_code_and_writes_nothing(): void
    {
        $this->actAsPlatformTeam();

        $cases = [
            'PAYMENT_PAID_UNTIL_REQUIRED' => ['paid_until' => null],
            'PAID_UNTIL_INVALID' => ['paid_until' => 'soon'],
            'PAYMENT_RECEIVED_ON_INVALID' => ['received_on' => '2999-01-01'],
            'PAYMENT_METHOD_INVALID' => ['method' => 'barter'],
            'PAYMENT_AMOUNT_INVALID' => ['amount' => -5],
            'PAYMENT_CURRENCY_INVALID' => ['currency' => null],
            'PLATFORM_TENANT_NOT_BILLABLE' => ['tenant_id' => 1],
            'TENANT_NOT_FOUND' => ['tenant_id' => 999999991],
        ];

        foreach ($cases as $code => $overrides) {
            $response = $this->apiPost('/v2/admin/super/billing/standing/record-payment', $this->body($overrides));
            $this->assertSame(422, $response->getStatusCode(), $code);
            $this->assertSame($code, $response->json('errors.0.code'), $code);
            $this->assertNotSame('', (string) $response->json('errors.0.message'), $code);
        }

        $this->assertSame(0, DB::table('billing_payments')->where('tenant_id', $this->hub)->count());
        $this->assertNull(BillingStandingService::get($this->hub)['paid_until']);
    }

    public function test_a_missing_community_id_is_refused(): void
    {
        $this->actAsPlatformTeam();

        $this->apiPost('/v2/admin/super/billing/standing/record-payment', $this->body(['tenant_id' => null]))->assertStatus(422);
        $this->apiGet('/v2/admin/super/billing/standing/payments')->assertStatus(422);
        $this->apiPost('/v2/admin/super/billing/standing/payer', ['payer' => 'platform_card'])->assertStatus(422);
    }

    public function test_the_platform_team_reads_the_payment_history(): void
    {
        $this->actAsPlatformTeam();

        $empty = $this->apiGet("/v2/admin/super/billing/standing/payments?tenant_id={$this->hub}");
        $empty->assertStatus(200);
        $this->assertSame([], $empty->json('data'));

        $this->apiPost('/v2/admin/super/billing/standing/record-payment', $this->body(['paid_until' => '2027-05-31', 'received_on' => now()->subDays(3)->toDateString()]))->assertStatus(200);
        $this->apiPost('/v2/admin/super/billing/standing/record-payment', $this->body(['paid_until' => '2027-08-31', 'method' => 'cheque', 'amount' => null, 'currency' => null]))->assertStatus(200);

        $list = $this->apiGet("/v2/admin/super/billing/standing/payments?tenant_id={$this->hub}");
        $list->assertStatus(200);
        $rows = $list->json('data');
        $this->assertCount(2, $rows);
        $this->assertSame('cheque', $rows[0]['method']);
        $this->assertSame('2027-05-31', $rows[0]['paid_until_before']);
        $this->assertSame('2027-08-31', $rows[0]['paid_until_after']);
        $this->assertSame('240.50', $rows[1]['amount']);
        foreach (['id', 'received_on', 'method', 'reference', 'amount', 'currency', 'paid_until_before', 'paid_until_after', 'recorded_by_user_id', 'recorded_by_name', 'created_at'] as $key) {
            $this->assertArrayHasKey($key, $rows[0], $key);
        }
    }

    public function test_the_platform_team_sets_how_a_community_pays(): void
    {
        $this->actAsPlatformTeam();

        $set = $this->apiPost('/v2/admin/super/billing/standing/payer', ['tenant_id' => $this->hub, 'payer' => 'not_billed']);
        $set->assertStatus(200);
        $this->assertSame('not_billed', $set->json('data.standing.payer'));
        $this->assertFalse($set->json('data.standing.payer_is_default'));

        $reset = $this->apiPost('/v2/admin/super/billing/standing/payer', ['tenant_id' => $this->hub, 'payer' => null]);
        $reset->assertStatus(200);
        $this->assertSame('platform_invoice', $reset->json('data.standing.payer'));
        $this->assertTrue($reset->json('data.standing.payer_is_default'));
    }

    public function test_a_payer_request_that_does_not_say_payer_is_refused(): void
    {
        $actor = $this->actAsPlatformTeam();
        BillingStandingService::setPayer($this->hub, 'not_billed', (int) $actor->id);

        $response = $this->apiPost('/v2/admin/super/billing/standing/payer', ['tenant_id' => $this->hub]);

        $response->assertStatus(422);
        $this->assertSame('PAYER_INVALID', $response->json('errors.0.code'));
        $this->assertSame('not_billed', BillingStandingService::get($this->hub)['payer'], 'Nothing was reset.');
    }

    public function test_bad_payers_are_refused_with_their_codes(): void
    {
        $this->actAsPlatformTeam();

        $unknown = $this->apiPost('/v2/admin/super/billing/standing/payer', ['tenant_id' => $this->hub, 'payer' => 'someone']);
        $unknown->assertStatus(422);
        $this->assertSame('PAYER_INVALID', $unknown->json('errors.0.code'));

        $noParent = $this->apiPost('/v2/admin/super/billing/standing/payer', ['tenant_id' => $this->hub, 'payer' => 'parent']);
        $noParent->assertStatus(422);
        $this->assertSame('PAYER_NEEDS_PARENT', $noParent->json('errors.0.code'));
    }

    public function test_a_child_set_to_pay_the_platform_is_out_of_its_parents_branch_payments(): void
    {
        $this->actAsPlatformTeam();
        $this->apiPost('/v2/admin/super/billing/standing/payer', ['tenant_id' => $this->child, 'payer' => 'platform_invoice'])->assertStatus(200);

        // The hub's manager.
        $this->testTenantId = $this->hub;
        $manager = User::factory()->forTenant($this->hub)->create([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'admin',
            'is_tenant_super_admin' => true,
        ]);
        Sanctum::actingAs($manager, ['*']);
        TenantContext::setById($this->hub);
        SuperPanelAccess::reset();

        $response = $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/paid-until", ['paid_until' => '2027-01-31']);

        $response->assertStatus(422);
        $this->assertStringContainsString('PAYS_PLATFORM', (string) $response->getContent());
        $this->assertNull(BillingStandingService::get($this->child)['paid_until']);
    }

    // ── The door stays shut ─────────────────────────────────────────────────

    /** @return array<string, array{0: string, 1: string}> */
    public static function endpoints(): array
    {
        return [
            'record a payment' => ['POST', '/v2/admin/super/billing/standing/record-payment'],
            'payment history' => ['GET', '/v2/admin/super/billing/standing/payments'],
            'void a payment' => ['POST', '/v2/admin/super/billing/standing/void-payment'],
            'how it pays' => ['POST', '/v2/admin/super/billing/standing/payer'],
        ];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('endpoints')]
    public function test_nobody_below_the_platform_team_may_call(string $method, string $uri): void
    {
        $payload = $this->body() + ['payer' => 'not_billed'];
        if ($method === 'GET') {
            $uri .= "?tenant_id={$this->hub}";
        }

        $this->assertRefusedBelowPlatformTeam($method, $uri, $payload);

        $this->assertSame(0, DB::table('billing_payments')->where('tenant_id', $this->hub)->count());
        $this->assertNull(BillingStandingService::get($this->hub)['paid_until']);
        $this->assertSame('platform_invoice', BillingStandingService::get($this->hub)['payer']);
    }
}
