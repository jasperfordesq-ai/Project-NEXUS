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
use App\Services\StripeSubscriptionService;
use App\Services\TenantBillingService;
use App\Support\Billing\BillingLock;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * A payment recorded by hand can be voided, never deleted.
 *
 * Until 22 November 2026 a payment typed against the wrong community, or with
 * the wrong amount, stayed in the history for good with nothing to say it was
 * wrong.
 *
 * Voiding records who, when and why, keeps the row, and does not move the
 * paid-until date by itself: the person voiding may set the date in the same
 * step. A card payment Stripe reported is not voided here.
 *
 * Tree:  hub ─ child        other (a second hub, beside `hub`)
 */
final class BillingPaymentVoidTest extends TestCase
{
    use DatabaseTransactions;

    private int $hub;
    private int $child;
    private int $other;
    private int $recorder;

    protected function setUp(): void
    {
        parent::setUp();

        $this->hub = $this->makeCommunity('Void hub', 1, '/1/', true);
        $this->child = $this->makeCommunity('Void child', $this->hub, "/1/{$this->hub}/");
        $this->other = $this->makeCommunity('Void other hub', 1, '/1/', true);
        $this->recorder = (int) User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => 'Pat', 'last_name' => 'Recorder', 'name' => 'Pat Recorder',
        ])->id;

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
            'slug' => 'void-' . bin2hex(random_bytes(5)),
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

    private function asPlatformTeam(): User
    {
        return $this->signInTo(1, ['role' => 'super_admin', 'is_super_admin' => true, 'is_god' => true, 'first_name' => 'Plat', 'last_name' => 'Team', 'name' => 'Plat Team']);
    }

    private function asManagerOf(int $tenantId): User
    {
        return $this->signInTo($tenantId, ['role' => 'admin', 'is_tenant_super_admin' => true, 'first_name' => 'Hana', 'last_name' => 'Manager', 'name' => 'Hana Manager']);
    }

    /** @param array<string, mixed> $over */
    private function record(int $tenantId, array $over = [], ?int $payee = null): int
    {
        return BillingStandingService::recordPayment($tenantId, array_merge([
            'paid_until' => '2027-06-30',
            'received_on' => now()->subDay()->toDateString(),
            'method' => 'bank_transfer',
            'reference' => 'INV-VOID-1',
            'amount' => 480,
            'currency' => 'EUR',
        ], $over), $this->recorder, $payee);
    }

    private function row(int $paymentId): object
    {
        return DB::table('billing_payments')->where('id', $paymentId)->first();
    }

    private function assertRefused(string $code, callable $call): void
    {
        try {
            $call();
        } catch (\DomainException $e) {
            $this->assertSame($code, $e->getMessage());

            return;
        }

        $this->fail("Expected the refusal {$code}");
    }

    // ── The service ─────────────────────────────────────────────────────────

    public function test_a_voided_payment_is_kept_and_marked_with_who_when_and_why(): void
    {
        $paymentId = $this->record($this->hub);

        BillingStandingService::voidPayment($this->hub, $paymentId, $this->recorder, '  Recorded against the wrong community  ');

        $row = $this->row($paymentId);
        $this->assertNotNull($row, 'the row is still there');
        $this->assertNotNull($row->voided_at);
        $this->assertSame($this->recorder, (int) $row->voided_by_user_id);
        $this->assertSame('Recorded against the wrong community', $row->void_reason);
        $this->assertSame('480.00', (string) $row->amount, 'nothing about the payment itself is changed');

        $audit = DB::table('billing_audit_log')->where('tenant_id', $this->hub)->where('action', 'payment_voided')->first();
        $this->assertNotNull($audit);
        $this->assertSame($this->recorder, (int) $audit->acted_by_user_id);
        $this->assertSame('Recorded against the wrong community', $audit->notes);
        $this->assertSame($paymentId, json_decode((string) $audit->old_value, true)['payment_id']);
    }

    public function test_voiding_does_not_move_the_paid_until_date_by_itself(): void
    {
        $paymentId = $this->record($this->hub);
        $this->assertSame('2027-06-30', BillingStandingService::get($this->hub)['paid_until']);

        BillingStandingService::voidPayment($this->hub, $paymentId, $this->recorder, 'Wrong amount');

        $this->assertSame('2027-06-30', BillingStandingService::get($this->hub)['paid_until']);
        $this->assertSame(1, DB::table('billing_audit_log')->where('tenant_id', $this->hub)->where('action', 'standing_paid_until_set')->count(), 'only the recording set a date');
    }

    public function test_the_date_can_be_set_in_the_same_step(): void
    {
        BillingStandingService::setPaidUntil($this->hub, '2026-12-31', $this->recorder);
        $paymentId = $this->record($this->hub);

        BillingStandingService::voidPayment($this->hub, $paymentId, $this->recorder, 'The transfer was returned', ['paid_until' => '2026-12-31']);

        $this->assertSame('2026-12-31', BillingStandingService::get($this->hub)['paid_until']);
        $last = DB::table('billing_audit_log')->where('tenant_id', $this->hub)->where('action', 'standing_paid_until_set')->orderByDesc('id')->first();
        $this->assertSame("payment {$paymentId} voided", $last->notes);
    }

    public function test_the_date_can_be_cleared_in_the_same_step(): void
    {
        $paymentId = $this->record($this->hub);

        BillingStandingService::voidPayment($this->hub, $paymentId, $this->recorder, 'Never arrived', ['paid_until' => null]);

        $this->assertNull(BillingStandingService::get($this->hub)['paid_until']);
    }

    public function test_what_is_refused(): void
    {
        $paymentId = $this->record($this->hub);
        $elsewhere = $this->record($this->other, ['reference' => 'OTHERS']);
        $card = (int) BillingStandingService::recordCardPayment($this->hub, [
            'stripe_invoice_id' => 'in_void_test_1', 'amount_paid' => 4800, 'currency' => 'eur',
        ]);
        $this->assertGreaterThan(0, $card);

        $this->assertRefused('payment_void_reason_required', fn () => BillingStandingService::voidPayment($this->hub, $paymentId, $this->recorder, '   '));
        $this->assertRefused('payment_void_reason_required', fn () => BillingStandingService::voidPayment($this->hub, $paymentId, $this->recorder, null));
        $this->assertRefused('paid_until_invalid', fn () => BillingStandingService::voidPayment($this->hub, $paymentId, $this->recorder, 'Why', ['paid_until' => '31/12/2026']));
        $this->assertRefused('payment_not_found', fn () => BillingStandingService::voidPayment($this->hub, 999999991, $this->recorder, 'Why'));
        $this->assertRefused('payment_not_found', fn () => BillingStandingService::voidPayment($this->hub, $elsewhere, $this->recorder, 'Why'));
        $this->assertRefused('payment_card_not_voidable', fn () => BillingStandingService::voidPayment($this->hub, $card, $this->recorder, 'Why'));
        $this->assertRefused('platform_tenant_not_billable', fn () => BillingStandingService::voidPayment(1, $paymentId, $this->recorder, 'Why'));

        foreach ([$paymentId, $elsewhere, $card] as $id) {
            $this->assertNull($this->row($id)->voided_at, 'a refusal voids nothing');
        }

        BillingStandingService::voidPayment($this->hub, $paymentId, $this->recorder, 'Why');
        $this->assertRefused('payment_already_voided', fn () => BillingStandingService::voidPayment($this->hub, $paymentId, $this->recorder, 'Again'));
        $this->assertSame('Why', $this->row($paymentId)->void_reason);
    }

    public function test_the_history_keeps_a_voided_payment_and_says_what_can_still_be_voided(): void
    {
        $voided = $this->record($this->hub, ['received_on' => now()->subDays(30)->toDateString(), 'paid_until' => '2027-01-31']);
        $live = $this->record($this->hub, ['received_on' => now()->subDays(5)->toDateString(), 'paid_until' => '2027-06-30']);
        BillingStandingService::recordCardPayment($this->hub, ['stripe_invoice_id' => 'in_void_test_2', 'amount_paid' => 4800, 'currency' => 'eur']);
        BillingStandingService::voidPayment($this->hub, $voided, $this->recorder, 'Typed twice');

        $byId = array_column(BillingStandingService::payments($this->hub), null, 'id');

        $this->assertCount(3, $byId, 'the voided payment is still listed');
        $this->assertSame(
            ['id', 'received_on', 'method', 'reference', 'amount', 'currency', 'paid_until_before', 'paid_until_after', 'recorded_by_user_id', 'recorded_by_name', 'created_at', 'source', 'payee_tenant_id', 'payee_name', 'recorded_by_platform_team', 'voided_at', 'voided_by_name', 'voided_by_platform_team', 'void_reason', 'can_void'],
            array_keys($byId[$voided])
        );
        $this->assertNotNull($byId[$voided]['voided_at']);
        $this->assertSame('Pat Recorder', $byId[$voided]['voided_by_name']);
        $this->assertSame('Typed twice', $byId[$voided]['void_reason']);
        $this->assertFalse($byId[$voided]['can_void']);

        $this->assertNull($byId[$live]['voided_at']);
        $this->assertNull($byId[$live]['void_reason']);
        $this->assertTrue($byId[$live]['can_void']);

        $card = array_values(array_filter($byId, static fn (array $p): bool => $p['source'] === 'card'))[0];
        $this->assertFalse($card['can_void'], 'a card payment is undone in Stripe');
    }

    public function test_a_voided_payment_is_not_the_last_payment_on_billing_control(): void
    {
        $this->record($this->hub, ['received_on' => now()->subDays(30)->toDateString(), 'paid_until' => '2027-01-31', 'method' => 'cheque']);
        $mistake = $this->record($this->hub, ['received_on' => now()->subDays(2)->toDateString(), 'paid_until' => '2027-06-30', 'method' => 'cash']);

        $find = fn (): array => collect(TenantBillingService::getBillingSnapshot())->firstWhere('id', $this->hub);
        $this->assertSame('cash', $find()['last_payment']['method']);

        BillingStandingService::voidPayment($this->hub, $mistake, $this->recorder, 'Not this community');

        $this->assertSame('cheque', $find()['last_payment']['method']);
    }

    public function test_a_community_whose_only_payment_was_voided_has_not_paid_before(): void
    {
        $paymentId = $this->record($this->hub);
        $this->assertFalse(StripeSubscriptionService::setupFeeApplies($this->hub));

        BillingStandingService::voidPayment($this->hub, $paymentId, $this->recorder, 'Recorded by mistake');

        $this->assertTrue(StripeSubscriptionService::setupFeeApplies($this->hub));
    }

    // ── The platform team's endpoint ────────────────────────────────────────

    public function test_the_platform_team_voids_a_payment_and_may_set_the_date(): void
    {
        $paymentId = $this->record($this->hub);
        $actor = $this->asPlatformTeam();

        $response = $this->apiPost('/v2/admin/super/billing/standing/void-payment', [
            'tenant_id' => $this->hub,
            'payment_id' => $paymentId,
            'reason' => 'The transfer was returned',
            'paid_until' => '2026-12-31',
        ]);

        $response->assertStatus(200);
        $this->assertSame('2026-12-31', $response->json('data.standing.paid_until'));
        $this->assertSame((int) $actor->id, (int) $this->row($paymentId)->voided_by_user_id);
    }

    public function test_a_void_that_does_not_say_paid_until_leaves_the_date_alone(): void
    {
        $paymentId = $this->record($this->hub);
        $this->asPlatformTeam();

        $response = $this->apiPost('/v2/admin/super/billing/standing/void-payment', [
            'tenant_id' => $this->hub, 'payment_id' => $paymentId, 'reason' => 'Wrong amount',
        ]);

        $response->assertStatus(200);
        $this->assertSame('2027-06-30', $response->json('data.standing.paid_until'));
        $this->assertNotNull($this->row($paymentId)->voided_at);
    }

    public function test_a_refused_void_is_a_422_with_its_code(): void
    {
        $paymentId = $this->record($this->hub);
        $card = (int) BillingStandingService::recordCardPayment($this->hub, ['stripe_invoice_id' => 'in_void_test_3', 'amount_paid' => 4800, 'currency' => 'eur']);
        $this->asPlatformTeam();

        $cases = [
            'PAYMENT_VOID_REASON_REQUIRED' => ['payment_id' => $paymentId, 'reason' => ''],
            'PAYMENT_NOT_FOUND' => ['payment_id' => 999999991, 'reason' => 'Why'],
            'PAYMENT_CARD_NOT_VOIDABLE' => ['payment_id' => $card, 'reason' => 'Why'],
            'PAID_UNTIL_INVALID' => ['payment_id' => $paymentId, 'reason' => 'Why', 'paid_until' => 'tomorrow'],
        ];
        foreach ($cases as $code => $body) {
            $response = $this->apiPost('/v2/admin/super/billing/standing/void-payment', ['tenant_id' => $this->hub] + $body);

            $this->assertSame(422, $response->getStatusCode(), $code);
            $this->assertStringContainsString($code, (string) $response->getContent());
        }

        $this->assertNull($this->row($paymentId)->voided_at);
        $this->assertNull($this->row($card)->voided_at);
    }

    // ── A parent community's manager ────────────────────────────────────────

    public function test_a_manager_voids_a_payment_made_to_its_community(): void
    {
        $paymentId = $this->record($this->child, [], $this->hub);
        $manager = $this->asManagerOf($this->hub);

        $response = $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/void-payment", [
            'payment_id' => $paymentId, 'reason' => 'The cheque was returned unpaid', 'paid_until' => null,
        ]);

        $response->assertStatus(200);
        $this->assertNull($response->json('data.standing.paid_until'));
        $row = $this->row($paymentId);
        $this->assertSame((int) $manager->id, (int) $row->voided_by_user_id);
        $this->assertSame('The cheque was returned unpaid', $row->void_reason);

        $history = $this->apiGet("/v2/admin/super/branch-payments/{$this->child}/payments")->json('data');
        $this->assertSame('Hana Manager', $history[0]['voided_by_name']);
        $this->assertFalse($history[0]['can_void']);
    }

    public function test_a_manager_cannot_void_a_payment_the_community_made_to_the_platform(): void
    {
        // The same community, in the manager's reach, but this payment was
        // made to the platform: it is not the hub's to void.
        $toPlatform = $this->record($this->child, ['reference' => 'TO-PLATFORM'], null);
        $this->asManagerOf($this->hub);

        $response = $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/void-payment", [
            'payment_id' => $toPlatform, 'reason' => 'Why',
        ]);

        $response->assertStatus(422);
        $this->assertStringContainsString('PAYMENT_NOT_FOUND', (string) $response->getContent());
        $this->assertNull($this->row($toPlatform)->voided_at);
    }

    public function test_a_manager_cannot_void_through_one_community_a_payment_of_another(): void
    {
        $sibling = $this->makeCommunity('Void sibling', $this->hub, "/1/{$this->hub}/");
        $siblings = $this->record($sibling, ['reference' => 'SIBLING'], $this->hub);
        $outOfReach = $this->record($this->other, ['reference' => 'OTHER-HUB'], null);
        $this->asManagerOf($this->hub);

        foreach ([$siblings, $outOfReach] as $paymentId) {
            $response = $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/void-payment", [
                'payment_id' => $paymentId, 'reason' => 'Why',
            ]);

            $response->assertStatus(422);
            $this->assertStringContainsString('PAYMENT_NOT_FOUND', (string) $response->getContent());
            $this->assertNull($this->row($paymentId)->voided_at);
        }
    }

    public function test_a_platform_team_member_who_voided_is_not_named_to_a_manager(): void
    {
        $paymentId = $this->record($this->child, [], $this->hub);
        $platformPerson = (int) User::factory()->forTenant(1)->create(['is_god' => true, 'is_super_admin' => true, 'first_name' => 'Plat', 'last_name' => 'Team', 'name' => 'Plat Team'])->id;
        BillingStandingService::voidPayment($this->child, $paymentId, $platformPerson, 'Entered twice');
        $this->asManagerOf($this->hub);

        $history = $this->apiGet("/v2/admin/super/branch-payments/{$this->child}/payments")->json('data');

        $this->assertNotNull($history[0]['voided_at']);
        $this->assertNull($history[0]['voided_by_name']);
        $this->assertTrue($history[0]['voided_by_platform_team']);
        $this->assertSame('Entered twice', $history[0]['void_reason']);
    }
}
