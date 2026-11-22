<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Http\Controllers\Api\StripeWebhookController;
use App\Models\User;
use App\Services\BillingStandingService;
use App\Services\EmailDispatchService;
use App\Services\StripeSubscriptionService;
use App\Services\TenantBillingService;
use App\Support\Billing\BillingLock;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * A refund or a dispute Stripe reports on a community's card payment is
 * recorded against that payment, and the platform team is told.
 *
 * Until 22 November 2026 both did nothing at all: the money could leave and
 * nobody on the platform was told, and no record said so.
 *
 * Nothing is paused automatically and no paid-until date moves: that is a
 * person's decision. No real Stripe call: these handlers make none.
 */
final class CardPaymentRefundDisputeTest extends TestCase
{
    use DatabaseTransactions;

    private int $community;
    private int $paymentId;
    private string $teamEmail;

    /** @var EmailDispatchService&object{calls: array<int, array<string, mixed>>, accept: bool} */
    private EmailDispatchService $mailer;

    protected function setUp(): void
    {
        parent::setUp();

        BillingLock::flush();

        $this->community = $this->makeCommunity('Refund community');
        BillingStandingService::setPaidUntil($this->community, now()->addDays(20)->toDateString(), null);
        $this->paymentId = (int) BillingStandingService::recordCardPayment($this->community, [
            'stripe_invoice_id' => 'in_refund_test_1',
            'amount_paid' => 48000,
            'currency' => 'gbp',
            'stripe_payment_intent_id' => 'pi_refund_test_1',
            'stripe_charge_id' => 'ch_refund_test_1',
            'paid_until_after' => now()->addDays(20)->toDateString(),
        ]);

        // The platform team as far as this test is concerned: one person the
        // test made. Whoever else is on it in the test data is mailed too and
        // is not counted.
        $this->teamEmail = 'refund.team.' . bin2hex(random_bytes(5)) . '@example.com';
        User::factory()->forTenant(1)->create([
            'email' => $this->teamEmail,
            'status' => 'active',
            'is_approved' => true,
            'is_god' => true,
            'is_super_admin' => true,
            'role' => 'super_admin',
            'preferred_language' => 'en',
        ]);
        // A community admin, who must NOT be told: the refund was made in the
        // platform's own Stripe account.
        User::factory()->forTenant($this->community)->create([
            'email' => 'refund.admin.' . bin2hex(random_bytes(5)) . '@example.com',
            'role' => 'admin',
            'status' => 'active',
            'is_approved' => true,
        ]);

        $this->mailer = new class extends EmailDispatchService {
            /** @var array<int, array<string, mixed>> */
            public array $calls = [];
            public bool $accept = true;

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                $this->calls[] = compact('to', 'subject', 'body', 'options');

                return $this->accept;
            }
        };
        app()->instance(EmailDispatchService::class, $this->mailer);
    }

    protected function tearDown(): void
    {
        // parent::tearDown() rolls the transaction back; it must always run.
        try {
            BillingLock::flush();
        } finally {
            parent::tearDown();
        }
    }

    private function makeCommunity(string $name): int
    {
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => 'refund-' . bin2hex(random_bytes(5)),
            'is_active' => 1,
            'parent_id' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $id)->update(['path' => "/1/{$id}/"]);

        return $id;
    }

    private function row(?int $paymentId = null): object
    {
        return DB::table('billing_payments')->where('id', $paymentId ?? $this->paymentId)->first();
    }

    /** @return list<array<string, mixed>> mail to the platform team member this test made */
    private function mailToTeam(): array
    {
        return array_values(array_filter($this->mailer->calls, fn (array $c): bool => $c['to'] === $this->teamEmail));
    }

    /** @param array<string, mixed> $over */
    private function charge(array $over = []): object
    {
        return json_decode((string) json_encode(array_merge([
            'id' => 'ch_refund_test_1',
            'object' => 'charge',
            'payment_intent' => 'pi_refund_test_1',
            'amount' => 48000,
            'amount_refunded' => 12000,
            'currency' => 'gbp',
        ], $over)));
    }

    /** @param array<string, mixed> $over */
    private function dispute(array $over = []): object
    {
        return json_decode((string) json_encode(array_merge([
            'id' => 'dp_refund_test_1',
            'object' => 'dispute',
            'charge' => 'ch_refund_test_1',
            'payment_intent' => 'pi_refund_test_1',
            'amount' => 48000,
            'currency' => 'gbp',
            'status' => 'needs_response',
            'created' => now()->subDay()->getTimestamp(),
        ], $over)));
    }

    // ── Refunds ─────────────────────────────────────────────────────────────

    public function test_a_refund_is_recorded_against_the_payment_and_the_platform_team_is_told(): void
    {
        $paidUntil = BillingStandingService::get($this->community)['paid_until'];

        StripeSubscriptionService::handleChargeRefunded($this->charge());

        $row = $this->row();
        $this->assertSame('120.00', (string) $row->refunded_amount);
        $this->assertNotNull($row->refunded_at);
        $this->assertSame('480.00', (string) $row->amount, 'the payment itself is not changed');

        $mail = $this->mailToTeam();
        $this->assertCount(1, $mail);
        $this->assertSame('A card payment from Refund community was refunded', $mail[0]['subject']);
        $this->assertStringContainsString('in_refund_test_1', $mail[0]['body']);
        $this->assertStringContainsString('120', $mail[0]['body']);
        $this->assertStringContainsString('Nothing has been changed automatically', $mail[0]['body']);
        $this->assertSame('billing', $mail[0]['options']['category']);

        // Only the platform team: the refund was made in the platform's account.
        foreach ($this->mailer->calls as $call) {
            $this->assertStringNotContainsString('refund.admin.', $call['to']);
        }

        // Nothing automatic.
        $this->assertSame($paidUntil, BillingStandingService::get($this->community)['paid_until']);
        $this->assertFalse(BillingLock::isLocked($this->community));

        $audit = DB::table('billing_audit_log')->where('tenant_id', $this->community)->where('action', 'payment_refunded')->first();
        $this->assertNotNull($audit);
        $this->assertNull($audit->acted_by_user_id, 'the system recorded it');
    }

    public function test_the_same_refund_sent_again_changes_nothing_and_tells_nobody_twice(): void
    {
        StripeSubscriptionService::handleChargeRefunded($this->charge());
        $refundedAt = $this->row()->refunded_at;

        StripeSubscriptionService::handleChargeRefunded($this->charge());
        StripeSubscriptionService::handleChargeRefunded($this->charge());

        $this->assertCount(1, $this->mailToTeam());
        $this->assertSame($refundedAt, $this->row()->refunded_at);
        $this->assertSame(1, DB::table('billing_audit_log')->where('tenant_id', $this->community)->where('action', 'payment_refunded')->count());
    }

    public function test_a_further_refund_updates_the_amount_and_is_told_again(): void
    {
        StripeSubscriptionService::handleChargeRefunded($this->charge(['amount_refunded' => 12000]));
        StripeSubscriptionService::handleChargeRefunded($this->charge(['amount_refunded' => 48000]));

        $this->assertSame('480.00', (string) $this->row()->refunded_amount, 'Stripe reports the total refunded so far');
        $this->assertCount(2, $this->mailToTeam());
    }

    public function test_a_refund_is_matched_by_the_payment_intent_when_the_charge_is_not_on_record(): void
    {
        $other = $this->makeCommunity('Refund by intent');
        $paymentId = (int) BillingStandingService::recordCardPayment($other, [
            'stripe_invoice_id' => 'in_refund_test_2',
            'amount_paid' => 9900,
            'currency' => 'eur',
            'stripe_payment_intent_id' => 'pi_refund_test_2',
        ]);

        StripeSubscriptionService::handleChargeRefunded($this->charge([
            'id' => 'ch_never_seen_before', 'payment_intent' => 'pi_refund_test_2', 'amount' => 9900, 'amount_refunded' => 9900, 'currency' => 'eur',
        ]));

        $row = $this->row($paymentId);
        $this->assertSame('99.00', (string) $row->refunded_amount);
        $this->assertSame('ch_never_seen_before', $row->stripe_charge_id, 'the charge is learned for the next event');
        $this->assertNull($this->row()->refunded_amount, 'no other payment is touched');
    }

    public function test_a_refund_of_something_that_is_not_a_plan_payment_does_nothing(): void
    {
        StripeSubscriptionService::handleChargeRefunded($this->charge(['id' => 'ch_a_donation', 'payment_intent' => 'pi_a_donation']));
        StripeSubscriptionService::handleChargeRefunded($this->charge(['amount_refunded' => 0]));
        StripeSubscriptionService::handleChargeRefunded((object) []);

        $this->assertNull($this->row()->refunded_amount);
        $this->assertSame([], $this->mailer->calls);
    }

    public function test_a_payment_recorded_by_hand_is_never_matched(): void
    {
        $recorder = (int) User::factory()->forTenant($this->testTenantId)->create()->id;
        $manual = BillingStandingService::recordPayment($this->community, [
            'paid_until' => now()->addYear()->toDateString(),
            'received_on' => now()->toDateString(),
            'method' => 'card',
            'reference' => 'ch_refund_test_1',
        ], $recorder);
        // A hand payment cannot carry Stripe ids; even one given them is not a card payment.
        DB::table('billing_payments')->where('id', $manual)->update(['stripe_charge_id' => 'ch_typed_by_hand']);

        $this->assertNull(BillingStandingService::cardPaymentFor(['charge' => 'ch_typed_by_hand']));
        $this->assertFalse(BillingStandingService::recordCardRefund($manual, 1000));
        $this->assertFalse(BillingStandingService::recordCardDispute($manual, 'needs_response'));
        $this->assertNull($this->row($manual)->refunded_amount);
    }

    /**
     * Told before marked. If the mailer refuses, the handler throws (the
     * webhook answers 500 and Stripe sends the event again) and the payment
     * is NOT marked, so the retry still has something new to say.
     */
    public function test_a_refund_nobody_could_be_told_about_is_not_marked_and_is_told_on_the_retry(): void
    {
        $this->mailer->accept = false;

        try {
            StripeSubscriptionService::handleChargeRefunded($this->charge());
            $this->fail('A refused email must fail the webhook');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('could not be told', $e->getMessage());
        }
        $this->assertNull($this->row()->refunded_amount);

        $this->mailer->accept = true;
        $this->mailer->calls = [];
        StripeSubscriptionService::handleChargeRefunded($this->charge());

        $this->assertSame('120.00', (string) $this->row()->refunded_amount);
        $this->assertCount(1, $this->mailToTeam());
    }

    // ── Disputes ────────────────────────────────────────────────────────────

    public function test_a_dispute_is_recorded_and_the_platform_team_is_told_when_it_opens_and_when_it_ends(): void
    {
        $opened = now()->subDay();

        StripeSubscriptionService::handleChargeDispute($this->dispute(['created' => $opened->getTimestamp()]));

        $row = $this->row();
        $this->assertSame('needs_response', $row->dispute_status);
        $this->assertSame($opened->format('Y-m-d H:i:s'), (string) $row->disputed_at);
        $this->assertCount(1, $this->mailToTeam());
        $this->assertSame('A dispute on a card payment from Refund community', $this->mailToTeam()[0]['subject']);
        $this->assertStringContainsString('has opened a dispute', $this->mailToTeam()[0]['body']);
        $this->assertStringContainsString('Stripe dashboard', $this->mailToTeam()[0]['body']);

        // Stripe moves an open dispute to another word: recorded, no second email.
        StripeSubscriptionService::handleChargeDispute($this->dispute(['status' => 'under_review']));
        $this->assertSame('under_review', $this->row()->dispute_status);
        $this->assertCount(1, $this->mailToTeam());

        // It ends.
        StripeSubscriptionService::handleChargeDispute($this->dispute(['status' => 'lost']));
        $this->assertSame('lost', $this->row()->dispute_status);
        $this->assertSame($opened->format('Y-m-d H:i:s'), (string) $this->row()->disputed_at, 'when it was opened is kept');
        $this->assertCount(2, $this->mailToTeam());
        $this->assertStringContainsString('was lost', $this->mailToTeam()[1]['body']);

        // The same word again: nothing.
        StripeSubscriptionService::handleChargeDispute($this->dispute(['status' => 'lost']));
        $this->assertCount(2, $this->mailToTeam());

        $this->assertFalse(BillingLock::isLocked($this->community), 'nothing is paused automatically');
        $this->assertSame(3, DB::table('billing_audit_log')->where('tenant_id', $this->community)->where('action', 'payment_disputed')->count());
    }

    public function test_a_dispute_that_ends_with_the_payment_standing_says_so(): void
    {
        StripeSubscriptionService::handleChargeDispute($this->dispute());
        StripeSubscriptionService::handleChargeDispute($this->dispute(['status' => 'won']));

        $this->assertStringContainsString('the payment stands', $this->mailToTeam()[1]['body']);
        $this->assertSame('won', BillingStandingService::disputeState($this->row()->dispute_status));
    }

    public function test_a_dispute_on_something_that_is_not_a_plan_payment_does_nothing(): void
    {
        StripeSubscriptionService::handleChargeDispute($this->dispute(['charge' => 'ch_a_donation', 'payment_intent' => 'pi_a_donation']));
        StripeSubscriptionService::handleChargeDispute((object) []);

        $this->assertNull($this->row()->dispute_status);
        $this->assertSame([], $this->mailer->calls);
    }

    public function test_a_word_stripe_has_never_used_is_stored_as_unknown_and_read_as_open(): void
    {
        StripeSubscriptionService::handleChargeDispute($this->dispute(['status' => 'Something NEW; DROP']));

        $this->assertSame('unknown', $this->row()->dispute_status);
        $this->assertSame('open', BillingStandingService::disputeState('unknown'));
        $this->assertNull(BillingStandingService::disputeState(null));
        $this->assertSame('won', BillingStandingService::disputeState('warning_closed'));
    }

    public function test_a_dispute_nobody_could_be_told_about_is_not_marked(): void
    {
        $this->mailer->accept = false;

        try {
            StripeSubscriptionService::handleChargeDispute($this->dispute());
            $this->fail('A refused email must fail the webhook');
        } catch (\RuntimeException) {
            // expected
        }

        $this->assertNull($this->row()->dispute_status);
    }

    // ── Where it is shown ───────────────────────────────────────────────────

    public function test_the_history_says_what_was_refunded_and_how_the_dispute_stands(): void
    {
        StripeSubscriptionService::handleChargeRefunded($this->charge());
        StripeSubscriptionService::handleChargeDispute($this->dispute());

        $payment = BillingStandingService::payments($this->community)[0];

        $this->assertSame(
            ['id', 'received_on', 'method', 'reference', 'amount', 'currency', 'paid_until_before', 'paid_until_after', 'recorded_by_user_id', 'recorded_by_name', 'created_at', 'source', 'payee_tenant_id', 'payee_name', 'recorded_by_platform_team', 'voided_at', 'voided_by_name', 'voided_by_platform_team', 'void_reason', 'can_void', 'refunded_amount', 'refunded_at', 'dispute_state', 'disputed_at'],
            array_keys($payment)
        );
        $this->assertSame('120.00', $payment['refunded_amount']);
        $this->assertNotNull($payment['refunded_at']);
        $this->assertSame('open', $payment['dispute_state']);
        $this->assertNotNull($payment['disputed_at']);
    }

    public function test_billing_control_flags_a_recent_refund_and_an_open_dispute(): void
    {
        $find = fn (): array => collect(TenantBillingService::getBillingSnapshot())->firstWhere('id', $this->community);
        $this->assertSame(['refunded' => false, 'disputed' => false], $find()['payment_alerts']);

        StripeSubscriptionService::handleChargeRefunded($this->charge());
        $this->assertSame(['refunded' => true, 'disputed' => false], $find()['payment_alerts']);

        StripeSubscriptionService::handleChargeDispute($this->dispute());
        $this->assertSame(['refunded' => true, 'disputed' => true], $find()['payment_alerts']);
    }

    public function test_an_old_refund_and_a_long_closed_dispute_are_no_longer_flagged_but_an_open_one_always_is(): void
    {
        $longAgo = now()->subDays(BillingStandingService::PAYMENT_ALERT_DAYS + 5)->toDateTimeString();
        DB::table('billing_payments')->where('id', $this->paymentId)->update([
            'refunded_amount' => '120.00', 'refunded_at' => $longAgo, 'dispute_status' => 'lost', 'disputed_at' => $longAgo,
        ]);
        $this->assertSame([], BillingStandingService::paymentAlerts([$this->community]));

        DB::table('billing_payments')->where('id', $this->paymentId)->update(['dispute_status' => 'needs_response']);
        $this->assertSame([$this->community => ['refunded' => false, 'disputed' => true]], BillingStandingService::paymentAlerts([$this->community]));
    }

    // ── The webhook reaches these handlers ──────────────────────────────────

    public function test_the_webhook_passes_a_refund_and_a_dispute_on_and_the_other_handlers_leave_them_alone(): void
    {
        $controller = app(StripeWebhookController::class);

        $refund = new \ReflectionMethod($controller, 'handleChargeRefunded');
        $refund->setAccessible(true);
        $refund->invoke($controller, $this->charge());
        $this->assertSame('120.00', (string) $this->row()->refunded_amount);

        $dispute = new \ReflectionMethod($controller, 'handleDisputeUpdated');
        $dispute->setAccessible(true);
        $dispute->invoke($controller, $this->dispute());
        $this->assertSame('needs_response', $this->row()->dispute_status);

        // A plan payment's dispute is not a donation's.
        $this->assertSame(0, DB::table('donation_disputes')->where('stripe_dispute_id', 'dp_refund_test_1')->count());
    }
}
