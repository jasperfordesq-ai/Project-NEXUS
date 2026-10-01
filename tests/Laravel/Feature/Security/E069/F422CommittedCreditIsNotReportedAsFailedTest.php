<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E069;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\EmailDispatchService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\Concerns\EnablesExternalFederation;
use Tests\Laravel\TestCase;

/**
 * F-422 — a credit that has already been committed must not be reported to the
 * sending partner as a failed, retryable request.
 *
 * `handleTransactionCompleted()` and `handleTransactionRequested()` commit the
 * money and then call `ensureExternalTransactionDelivery()`. A false return
 * threw, and `receive()`'s generic `\Throwable` arm answers HTTP 500
 * PROCESSING_FAILED — the response the controller's own docblock reserves for
 * errors that "must stay retryable for the sending partner". So a partner that
 * treats 500 as "this transfer did not happen" and reissues under a fresh
 * `external_transaction_id` double-credits the member.
 *
 * The notification failing is not the transfer failing. The failure is already
 * recorded on the row (`email_failed_at`, `email_last_error`) and surfaces on
 * the admin email-deliverability page, and a later replay still repairs it.
 *
 * One deterministic trigger is the member's own federation opt-out:
 * `FederationEmailService::getUserWithEmail()` refuses a member whose
 * `federation_user_settings.email_notifications` is 0 — which is exactly what
 * `FederationUserService::optOut()` writes — and returns false BEFORE the
 * mailer is reached. E-069 could not separate that arm from a mail outage
 * because the container has no reachable SMTP host; these tests drive it with a
 * SUCCEEDING fake mailer in the container, so the member's own setting is the
 * only reason delivery fails.
 */
final class F422CommittedCreditIsNotReportedAsFailedTest extends TestCase
{
    use DatabaseTransactions;
    use EnablesExternalFederation;

    private const WEBHOOK_URL = '/api/v2/federation/external/webhooks/receive';

    private int $partnerId;
    private string $partnerToken;

    protected function setUp(): void
    {
        parent::setUp();
        $this->enableExternalFederation();

        $this->partnerToken = 'f422-token-' . bin2hex(random_bytes(8));

        $partnerRow = [
            'tenant_id' => $this->testTenantId,
            'name' => 'F422 Inbound Partner',
            'base_url' => 'https://f422-inbound.example.org',
            'api_path' => '/api/v1/federation',
            'signing_secret' => $this->partnerToken,
            'status' => 'active',
            'allow_transactions' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ];

        $this->partnerId = (int) DB::table('federation_external_partners')->insertGetId($partnerRow);

        TenantContext::setById($this->testTenantId);
        $this->activeCreditAgreement();
    }

    /**
     * CORRECT BEHAVIOUR — the notification could not be sent, but the money
     * moved. The partner is told the transfer was accepted, and the delivery
     * failure is recorded for an operator.
     */
    public function test_a_committed_credit_is_acknowledged_even_when_the_notification_fails(): void
    {
        $member = $this->member(emailNotifications: 1);
        $this->fakeEmailDispatchService(false);

        $response = $this->postWebhook('transaction.completed', $this->payload($member, 'f422-mail-down-1', 2.0));

        $response->assertStatus(200);
        $this->assertSame(
            'acknowledged',
            $response->json('data.result.status'),
            'the partner is told the transfer was accepted, not that the request failed'
        );
        $this->assertSame(2.0, $this->balance($member), 'the credit stands');

        $row = $this->transactionRow('f422-mail-down-1');
        $this->assertNotNull($row, 'the ledger row exists');
        $this->assertSame('completed', $row->status, 'the transfer is recorded as completed');
        $this->assertNotNull($row->email_failed_at, 'the delivery failure is recorded for an operator');
        $this->assertNull($row->email_sent_at, 'no email was sent');
    }

    /**
     * CORRECT BEHAVIOUR — the same, on the other money-moving arm.
     */
    public function test_the_transaction_requested_arm_is_acknowledged_too(): void
    {
        $member = $this->member(emailNotifications: 1);
        $this->fakeEmailDispatchService(false);

        $response = $this->postWebhook('transaction.requested', $this->payload($member, 'f422-mail-down-2', 3.0));

        $response->assertStatus(200);
        $this->assertSame(
            'completed',
            $response->json('data.result.status'),
            'the partner is told the transfer completed'
        );
        $this->assertSame(3.0, $this->balance($member), 'the credit stands');
        $this->assertNotNull($this->transactionRow('f422-mail-down-2')->email_failed_at);
    }

    /**
     * CORRECT BEHAVIOUR — a member's own federation opt-out is not an
     * infrastructure failure. The mailer here SUCCEEDS for everyone else, so the
     * member's recorded choice is the only reason delivery does not happen.
     */
    public function test_a_members_own_opt_out_does_not_make_the_transfer_look_failed(): void
    {
        $member = $this->member(emailNotifications: 0);
        $mailer = $this->fakeEmailDispatchService(true);

        $response = $this->postWebhook('transaction.completed', $this->payload($member, 'f422-optout-1', 4.0));

        $response->assertStatus(200);
        $this->assertSame('acknowledged', $response->json('data.result.status'));
        $this->assertSame(4.0, $this->balance($member), 'the credit stands');
        $this->assertCount(0, $mailer->sends, 'the member who opted out was not emailed');
        $this->assertNotNull($this->transactionRow('f422-optout-1')->email_failed_at);
    }

    /**
     * CONTROL — legitimate access, and the whole point of the delivery step. A
     * member who has not opted out, with a working mailer, is credited AND
     * emailed, and the transfer is acknowledged.
     */
    public function test_control_a_deliverable_transfer_is_credited_emailed_and_acknowledged(): void
    {
        $member = $this->member(emailNotifications: 1);
        $mailer = $this->fakeEmailDispatchService(true);

        $response = $this->postWebhook('transaction.completed', $this->payload($member, 'f422-ok-1', 5.0));

        $response->assertStatus(200);
        $this->assertSame('acknowledged', $response->json('data.result.status'));
        $this->assertSame(5.0, $this->balance($member), 'control: the credit lands');
        $this->assertCount(1, $mailer->sends, 'control: the member is emailed');

        $row = $this->transactionRow('f422-ok-1');
        $this->assertNotNull($row->email_sent_at, 'control: the delivery is recorded as sent');
        $this->assertNull($row->email_failed_at, 'control: no failure is recorded');
    }

    /**
     * CONTROL — a payload that fails BEFORE the money moves is still refused and
     * still credits nothing. "Always answer 200" is not the fix.
     */
    public function test_control_a_transfer_over_the_single_transfer_limit_is_still_refused(): void
    {
        $member = $this->member(emailNotifications: 1);
        $this->fakeEmailDispatchService(true);

        $response = $this->postWebhook('transaction.completed', $this->payload($member, 'f422-too-big-1', 9999.0));

        $response->assertStatus(200);
        $this->assertSame('rejected', $response->json('data.result.status'), 'control: an over-limit transfer is refused');
        $this->assertSame(0.0, $this->balance($member), 'control: nothing was credited');
        $this->assertNull($this->transactionRow('f422-too-big-1'), 'control: no ledger row was written');
    }

    /**
     * CONTROL — the partner is not credited twice when it replays the same
     * identifier after a failed delivery, and the replay still repairs the
     * notification. This is the behaviour the 500 was being used for; it works
     * without the false failure.
     */
    public function test_control_a_replay_repairs_the_notification_without_double_crediting(): void
    {
        $member = $this->member(emailNotifications: 1);
        $this->fakeEmailDispatchService(false);

        $this->postWebhook('transaction.completed', $this->payload($member, 'f422-replay-1', 2.0))->assertStatus(200);
        $this->assertSame(2.0, $this->balance($member));

        $workingMailer = $this->fakeEmailDispatchService(true);
        $replay = $this->postWebhook('transaction.completed', $this->payload($member, 'f422-replay-1', 2.0));

        $replay->assertStatus(200);
        $this->assertSame('duplicate', $replay->json('data.result.status'), 'control: the replay is a duplicate');
        $this->assertSame(2.0, $this->balance($member), 'control: the member was credited exactly once');
        $this->assertCount(1, $workingMailer->sends, 'control: the replay repaired the notification');

        $row = $this->transactionRow('f422-replay-1');
        $this->assertNotNull($row->email_sent_at, 'control: the delivery is now recorded as sent');
        $this->assertNull($row->email_failed_at, 'control: the failure flag is cleared');
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    /** @param array<string,mixed> $data */
    private function postWebhook(string $event, array $data): \Illuminate\Testing\TestResponse
    {
        return $this->withHeaders([
            'Authorization' => 'Bearer ' . $this->partnerToken,
            'Content-Type' => 'application/json',
            'X-Federation-Nonce' => 'f422-nonce-' . bin2hex(random_bytes(16)),
        ])->postJson(self::WEBHOOK_URL, [
            'event' => $event,
            'data' => $data,
        ]);
    }

    /** @return array<string,mixed> */
    private function payload(User $member, string $externalTxId, float $amount): array
    {
        return [
            'external_transaction_id' => $externalTxId,
            'amount' => $amount,
            'recipient_id' => (int) $member->id,
            'sender_id' => 'remote-sender',
            'sender_name' => 'F422 remote sender',
            'reason' => 'F422 synthetic inbound credit',
            'description' => 'F422 synthetic inbound credit',
        ];
    }

    private function transactionRow(string $externalTxId): ?object
    {
        return DB::table('federation_transactions')
            ->where('external_partner_id', $this->partnerId)
            ->where('external_transaction_id', $externalTxId)
            ->first();
    }

    private function balance(User $member): float
    {
        return (float) DB::table('users')
            ->where('id', (int) $member->id)
            ->where('tenant_id', $this->testTenantId)
            ->value('balance');
    }

    private function activeCreditAgreement(): void
    {
        DB::table('federation_credit_agreements')->insert([
            'from_tenant_id' => 0,
            'to_tenant_id' => $this->testTenantId,
            'exchange_rate' => 1.0,
            'status' => 'active',
            'max_monthly_credits' => 100.0,
            'created_at' => now(),
        ]);
    }

    private function member(int $emailNotifications): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => 1,
            'balance' => 0,
            'preferred_language' => 'en',
            'email' => 'f422-' . bin2hex(random_bytes(6)) . '@f422-fixture.org',
        ]);

        DB::table('federation_user_settings')->updateOrInsert(
            ['user_id' => (int) $user->id],
            [
                // F-484: inbound external credit requires the member's own consent.
                'federation_optin' => 1,
                'transactions_enabled_federated' => 1,
                // The property under test in the opt-out arm: exactly what
                // FederationUserService::optOut() writes.
                'email_notifications' => $emailNotifications,
                'updated_at' => now(),
            ]
        );

        return $user;
    }

    private function fakeEmailDispatchService(bool $sendResult): EmailDispatchService
    {
        $mailer = new class ($sendResult) extends EmailDispatchService {
            /** @var list<array{to:string,subject:string,body:string,options:array<string,mixed>}> */
            public array $sends = [];

            public function __construct(private bool $sendResult)
            {
            }

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                $this->sends[] = [
                    'to' => $to,
                    'subject' => $subject,
                    'body' => $body,
                    'options' => $options,
                ];

                return $this->sendResult;
            }
        };

        app()->instance(EmailDispatchService::class, $mailer);

        return $mailer;
    }
}
