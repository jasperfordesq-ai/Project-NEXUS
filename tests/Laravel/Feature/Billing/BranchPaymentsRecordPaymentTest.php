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
use Tests\Laravel\TestCase;

/**
 * A parent community's manager records a payment from a community that pays
 * it, and reads that community's payment history.
 *
 * Until 22 November 2026 a hub could only set a paid-until date: the amount,
 * the reference and the method were recorded nowhere, and it had no history.
 *
 * The reach rule is the one every Branch payments endpoint follows (below the
 * caller's own community only, never one that pays the platform, never an
 * exempt one); those refusals are pinned for `record-payment` in
 * BranchPaymentsEndpointsTest. This file pins what is new: who the payment is
 * stored as paid to, and that a manager sees the payments made to that
 * community and no others.
 *
 * Tree:  hub ─ child ─ grandchild        other (a second hub, beside `hub`)
 *            └ sibling                        └ otherChild
 */
final class BranchPaymentsRecordPaymentTest extends TestCase
{
    use DatabaseTransactions;

    private int $hub;
    private int $child;
    private int $grandchild;
    private int $sibling;
    private int $other;
    private int $otherChild;

    protected function setUp(): void
    {
        parent::setUp();

        $this->hub = $this->makeCommunity('Record hub', 1, '/1/', true);
        $this->child = $this->makeCommunity('Record child', $this->hub, "/1/{$this->hub}/", true);
        $this->grandchild = $this->makeCommunity('Record grandchild', $this->child, "/1/{$this->hub}/{$this->child}/");
        $this->sibling = $this->makeCommunity('Record sibling', $this->hub, "/1/{$this->hub}/");
        $this->other = $this->makeCommunity('Record other hub', 1, '/1/', true);
        $this->otherChild = $this->makeCommunity('Record other child', $this->other, "/1/{$this->other}/");

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
            'slug' => 'record-' . bin2hex(random_bytes(5)),
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
        return $this->signInTo($tenantId, ['role' => 'admin', 'is_tenant_super_admin' => true, 'first_name' => 'Hana', 'last_name' => 'Manager', 'name' => 'Hana Manager']);
    }

    private function asPlatformTeam(): User
    {
        return $this->signInTo(1, ['role' => 'super_admin', 'is_super_admin' => true, 'is_god' => true, 'first_name' => 'Plat', 'last_name' => 'Team', 'name' => 'Plat Team']);
    }

    /**
     * @param array<string, mixed> $over
     * @return array<string, mixed>
     */
    private function payment(array $over = []): array
    {
        return array_merge([
            'paid_until' => '2027-06-30',
            'received_on' => now()->subDay()->toDateString(),
            'method' => 'bank_transfer',
            'reference' => 'HUB-INV-7',
            'amount' => 120,
            'currency' => 'EUR',
        ], $over);
    }

    /** @return list<object> */
    private function rows(int $tenantId): array
    {
        return DB::table('billing_payments')->where('tenant_id', $tenantId)->orderBy('id')->get()->all();
    }

    // ── The door opens ──────────────────────────────────────────────────────

    public function test_a_manager_records_a_payment_from_a_community_that_pays_it(): void
    {
        $manager = $this->asManagerOf($this->hub);

        $response = $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/record-payment", $this->payment());

        $response->assertStatus(200);
        $this->assertSame('2027-06-30', $response->json('data.standing.paid_until'));

        $rows = $this->rows($this->child);
        $this->assertCount(1, $rows);
        $this->assertSame((int) $response->json('data.payment_id'), (int) $rows[0]->id);
        $this->assertSame('bank_transfer', $rows[0]->method);
        $this->assertSame('HUB-INV-7', $rows[0]->reference);
        $this->assertSame('120.00', (string) $rows[0]->amount);
        $this->assertSame('EUR', $rows[0]->currency);
        $this->assertSame('2027-06-30', substr((string) $rows[0]->paid_until_after, 0, 10));
        $this->assertSame((int) $manager->id, (int) $rows[0]->recorded_by_user_id);
        $this->assertSame($this->hub, (int) $rows[0]->payee_tenant_id, 'paid to the hub, not to the platform');
        $this->assertNull($rows[0]->stripe_invoice_id);
    }

    public function test_a_grandchilds_payment_is_stored_as_paid_to_its_own_parent(): void
    {
        $this->asManagerOf($this->hub);

        $this->apiPost("/v2/admin/super/branch-payments/{$this->grandchild}/record-payment", $this->payment())->assertStatus(200);

        $rows = $this->rows($this->grandchild);
        $this->assertCount(1, $rows);
        $this->assertSame($this->child, (int) $rows[0]->payee_tenant_id, 'it pays the community directly above it');
    }

    public function test_recording_a_payment_reopens_a_community_the_system_paused(): void
    {
        BillingStandingService::setPaidUntil($this->child, now()->subDays(40)->toDateString(), null);
        BillingStandingService::suspend($this->child, null, 'auto');
        $this->assertTrue(BillingLock::isLocked($this->child));
        $this->asManagerOf($this->hub);

        $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/record-payment", $this->payment(['paid_until' => now()->addYear()->toDateString()]))->assertStatus(200);

        $this->assertFalse(BillingLock::isLocked($this->child));
    }

    public function test_a_refused_payment_is_a_422_with_its_code_and_writes_nothing(): void
    {
        $this->asManagerOf($this->hub);

        $cases = [
            'PAYMENT_PAID_UNTIL_REQUIRED' => ['paid_until' => null],
            'PAYMENT_RECEIVED_ON_INVALID' => ['received_on' => now()->addDays(5)->toDateString()],
            'PAYMENT_METHOD_INVALID' => ['method' => 'barter'],
            'PAYMENT_AMOUNT_INVALID' => ['amount' => '-5'],
            'PAYMENT_CURRENCY_INVALID' => ['currency' => 'euro'],
        ];
        foreach ($cases as $code => $over) {
            $response = $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/record-payment", $this->payment($over));

            $this->assertSame(422, $response->getStatusCode(), $code);
            $this->assertStringContainsString($code, (string) $response->getContent());
        }

        $this->assertCount(0, $this->rows($this->child));
        $this->assertNull(BillingStandingService::get($this->child)['paid_until']);
    }

    // ── The history ─────────────────────────────────────────────────────────

    public function test_a_manager_reads_the_payments_made_to_its_community_and_no_others(): void
    {
        // Before it paid the hub, this community paid the platform. That
        // payment is the platform's business and stays out of the hub's list.
        $platformPerson = (int) User::factory()->forTenant(1)->create(['is_god' => true, 'is_super_admin' => true, 'first_name' => 'Plat', 'last_name' => 'Team', 'name' => 'Plat Team'])->id;
        BillingStandingService::recordPayment($this->child, $this->payment(['paid_until' => '2026-12-31', 'reference' => 'PLATFORM-OLD', 'received_on' => now()->subDays(60)->toDateString()]), $platformPerson, null);
        // A payment the platform team recorded for the hub.
        BillingStandingService::recordPayment($this->child, $this->payment(['paid_until' => '2027-03-31', 'reference' => 'BY-PLATFORM-TEAM', 'received_on' => now()->subDays(30)->toDateString()]), $platformPerson, $this->hub);
        // Another community's payment to the same hub.
        BillingStandingService::recordPayment($this->sibling, $this->payment(['reference' => 'SIBLING']), $platformPerson, $this->hub);

        $manager = $this->asManagerOf($this->hub);
        $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/record-payment", $this->payment())->assertStatus(200);

        $response = $this->apiGet("/v2/admin/super/branch-payments/{$this->child}/payments");

        $response->assertStatus(200);
        $list = $response->json('data');
        $this->assertSame(['HUB-INV-7', 'BY-PLATFORM-TEAM'], array_column($list, 'reference'), 'newest first; nothing paid to the platform; nothing of the sibling');
        $this->assertSame(
            ['id', 'received_on', 'method', 'reference', 'amount', 'currency', 'paid_until_before', 'paid_until_after', 'recorded_by_user_id', 'recorded_by_name', 'created_at', 'source', 'payee_tenant_id', 'payee_name', 'recorded_by_platform_team', 'voided_at', 'voided_by_name', 'voided_by_platform_team', 'void_reason', 'can_void'],
            array_keys($list[0])
        );

        $this->assertSame('Hana Manager', $list[0]['recorded_by_name']);
        $this->assertSame((int) $manager->id, $list[0]['recorded_by_user_id']);
        $this->assertFalse($list[0]['recorded_by_platform_team']);
        $this->assertSame($this->hub, $list[0]['payee_tenant_id']);
        $this->assertSame('Record hub', $list[0]['payee_name']);

        // A platform team member is not named to a hub's manager.
        $this->assertTrue($list[1]['recorded_by_platform_team']);
        $this->assertNull($list[1]['recorded_by_name']);
        $this->assertNull($list[1]['recorded_by_user_id']);
    }

    public function test_the_platform_team_sees_every_payment_and_who_each_was_paid_to(): void
    {
        $platform = $this->asPlatformTeam();
        BillingStandingService::recordPayment($this->child, $this->payment(['paid_until' => '2026-12-31', 'reference' => 'TO-PLATFORM', 'received_on' => now()->subDays(60)->toDateString()]), (int) $platform->id, null);
        BillingStandingService::recordPayment($this->child, $this->payment(['reference' => 'TO-HUB']), (int) $platform->id, $this->hub);

        $list = $this->apiGet("/v2/admin/super/billing/standing/payments?tenant_id={$this->child}")->json('data');

        $this->assertSame(['TO-HUB', 'TO-PLATFORM'], array_column($list, 'reference'));
        $this->assertSame('Record hub', $list[0]['payee_name']);
        $this->assertNull($list[1]['payee_tenant_id']);
        $this->assertNull($list[1]['payee_name']);
        $this->assertSame('Plat Team', $list[0]['recorded_by_name'], 'the platform team sees its own names');
    }

    public function test_a_payment_the_platform_team_records_is_paid_to_whoever_the_community_pays(): void
    {
        $this->asPlatformTeam();

        // Pays its parent.
        $this->apiPost('/v2/admin/super/billing/standing/record-payment', ['tenant_id' => $this->child] + $this->payment())->assertStatus(200);
        // Pays the platform (directly under it).
        $this->apiPost('/v2/admin/super/billing/standing/record-payment', ['tenant_id' => $this->other] + $this->payment())->assertStatus(200);
        // Below a hub, but set to pay the platform by invoice.
        BillingStandingService::setPayer($this->sibling, 'platform_invoice', 1);
        $this->apiPost('/v2/admin/super/billing/standing/record-payment', ['tenant_id' => $this->sibling] + $this->payment())->assertStatus(200);

        $this->assertSame($this->hub, (int) $this->rows($this->child)[0]->payee_tenant_id);
        $this->assertNull($this->rows($this->other)[0]->payee_tenant_id);
        $this->assertNull($this->rows($this->sibling)[0]->payee_tenant_id);
    }

    // ── The door stays shut ─────────────────────────────────────────────────

    public function test_a_manager_cannot_read_the_history_of_anything_that_is_not_below_it(): void
    {
        $platformPerson = (int) User::factory()->forTenant(1)->create()->id;
        BillingStandingService::recordPayment($this->sibling, $this->payment(), $platformPerson, $this->hub);
        BillingStandingService::recordPayment($this->otherChild, $this->payment(), $platformPerson, $this->other);
        $this->asManagerOf($this->child);

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
            $response = $this->apiGet("/v2/admin/super/branch-payments/{$target}/payments");

            $this->assertSame(403, $response->getStatusCode(), "the history of {$what} must be refused");
            $this->assertStringNotContainsString('HUB-INV-7', (string) $response->getContent());
        }
    }

    public function test_the_history_of_a_community_that_pays_the_platform_or_is_exempt_is_refused(): void
    {
        $platformPerson = (int) User::factory()->forTenant(1)->create()->id;
        BillingStandingService::recordPayment($this->sibling, $this->payment(), $platformPerson, $this->hub);
        BillingStandingService::setPayer($this->sibling, 'platform_invoice', 1);
        BillingStandingService::recordPayment($this->child, $this->payment(), $platformPerson, $this->hub);
        BillingStandingService::setExempt($this->child, true, 1, 'Council contract');
        $this->asManagerOf($this->hub);

        $paysPlatform = $this->apiGet("/v2/admin/super/branch-payments/{$this->sibling}/payments");
        $paysPlatform->assertStatus(422);
        $this->assertStringContainsString('PAYS_PLATFORM', (string) $paysPlatform->getContent());
        $this->assertStringNotContainsString('HUB-INV-7', (string) $paysPlatform->getContent());

        $exempt = $this->apiGet("/v2/admin/super/branch-payments/{$this->child}/payments");
        $exempt->assertStatus(422);
        $this->assertStringContainsString('EXEMPT', (string) $exempt->getContent());
    }

    /**
     * Reach is checked at both ends. A community whose path says it is below
     * the caller while its parent is another hub must not let the caller
     * write into, or read from, that other hub's payment record.
     */
    public function test_a_community_whose_parent_is_out_of_reach_is_refused_at_the_payee_end(): void
    {
        $platformPerson = (int) User::factory()->forTenant(1)->create()->id;
        BillingStandingService::recordPayment($this->grandchild, $this->payment(['reference' => 'OTHER-HUBS-MONEY']), $platformPerson, $this->other);
        // The path still says "below hub"; the parent is now the other hub.
        DB::table('tenants')->where('id', $this->grandchild)->update(['parent_id' => $this->other]);
        BillingLock::flush();
        $this->asManagerOf($this->hub);

        $read = $this->apiGet("/v2/admin/super/branch-payments/{$this->grandchild}/payments");
        $this->assertSame(403, $read->getStatusCode());
        $this->assertStringNotContainsString('OTHER-HUBS-MONEY', (string) $read->getContent());

        $write = $this->apiPost("/v2/admin/super/branch-payments/{$this->grandchild}/record-payment", $this->payment(['paid_until' => '2028-01-31']));
        $this->assertSame(403, $write->getStatusCode());
        $this->assertCount(1, $this->rows($this->grandchild), 'nothing was added');
    }
}
