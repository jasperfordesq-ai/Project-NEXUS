<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E073;

use App\Core\FederationApiMiddleware;
use App\Models\User;
use App\Services\SafeguardingInteractionPolicy;
use App\Services\WalletService;
use App\Support\SafeguardingInteractionDecision;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\Laravel\Concerns\EnablesExternalFederation;
use Tests\Laravel\TestCase;

/**
 * F-440 (E-073, slice D finding D-1) — the v1 partner API minted unbounded
 * time credits.
 *
 * `FederationController::createTransaction()` bounded a single transfer to
 * 1–100 whole hours and then checked only that an active
 * `federation_credit_agreements` row EXISTED — it never read
 * `max_monthly_credits` and never totalled what had already arrived. For an
 * external key there is no local sender to debit, so the credit was created
 * out of nothing: ten calls against a published 10-hour agreement put 1,000
 * hours into the community.
 *
 * The fix reads the same agreement column the other inbound protocols read and
 * enforces it as a real monthly total, copying
 * `FederationCreditCommonsController::inboundCreditCeilingRefusal()` — the
 * sound model. It deliberately does NOT copy the external-webhook version,
 * which filters its month-to-date sum by `status = 'completed'`; that is the
 * defect recorded as F-428 (a partner refunds its own budget by cancelling).
 *
 * Second facet, same method: `transactions.sender_id` was written verbatim
 * from the payload, so naming a real local member made their wallet summary
 * report spending they never did. An external partner's sender lives on the
 * remote server and has no local row, so the id is no longer stored at all.
 */
final class F440V1PartnerInboundCreditCeilingTest extends TestCase
{
    use DatabaseTransactions;
    use EnablesExternalFederation;

    protected function setUp(): void
    {
        parent::setUp();
        $this->enableExternalFederation();
        FederationApiMiddleware::reset();
        $this->allowSafeguarding();
    }

    protected function tearDown(): void
    {
        FederationApiMiddleware::reset();
        unset($_SERVER['HTTP_X_API_KEY']);
        parent::tearDown();
    }

    // ------------------------------------------------------------------
    //  THE HARM — the published monthly ceiling must bind
    // ------------------------------------------------------------------

    public function test_inbound_credit_stops_at_the_agreements_published_monthly_ceiling(): void
    {
        $this->creditAgreement(10.0);
        $recipient = $this->federatedMember();
        $apiKey = $this->partnerApiKey('f440-a');

        $stockBefore = $this->communityCreditStock();

        $accepted = 0;
        $refused = 0;
        for ($i = 0; $i < 10; $i++) {
            $this->useKey($apiKey);
            $response = $this->apiPost('/v1/federation/transactions', [
                'sender_id' => 900100 + $i,
                'recipient_id' => (int) $recipient->id,
                'amount' => 100,
                'description' => 'f440 mint attempt ' . $i,
                'idempotency_key' => 'f440-a-' . $i,
            ], ['X-API-Key' => $apiKey]);

            if ($response->status() === 201) {
                $accepted++;
                continue;
            }

            $refused++;
            $this->assertSame(403, $response->status(), (string) $response->getContent());
            $response->assertJsonPath('code', 'CREDIT_CEILING_EXCEEDED');
        }

        $this->assertSame(0, $accepted, 'a 100-hour transfer cannot fit inside a 10-hour monthly ceiling');
        $this->assertSame(10, $refused);

        $this->assertSame(0.0, $this->balance($recipient), 'nothing was credited');
        $this->assertSame(
            $stockBefore,
            $this->communityCreditStock(),
            'the community total time-credit stock did not grow',
        );
    }

    public function test_the_ceiling_is_a_running_monthly_total_not_a_per_transfer_bound(): void
    {
        $this->creditAgreement(12.0);
        $recipient = $this->federatedMember();
        $apiKey = $this->partnerApiKey('f440-b');

        // 5 + 5 = 10, inside the 12-hour ceiling.
        foreach ([1, 2] as $n) {
            $this->useKey($apiKey);
            $this->apiPost('/v1/federation/transactions', [
                'sender_id' => 900200 + $n,
                'recipient_id' => (int) $recipient->id,
                'amount' => 5,
                'description' => 'f440 within ceiling ' . $n,
                'idempotency_key' => 'f440-b-' . $n,
            ], ['X-API-Key' => $apiKey])->assertStatus(201);
        }
        $this->assertSame(10.0, $this->balance($recipient));

        // A third 5-hour transfer would reach 15 and must be refused.
        $this->useKey($apiKey);
        $third = $this->apiPost('/v1/federation/transactions', [
            'sender_id' => 900203,
            'recipient_id' => (int) $recipient->id,
            'amount' => 5,
            'description' => 'f440 over ceiling',
            'idempotency_key' => 'f440-b-3',
        ], ['X-API-Key' => $apiKey]);

        $this->assertSame(403, $third->status(), (string) $third->getContent());
        $third->assertJsonPath('code', 'CREDIT_CEILING_EXCEEDED');
        $this->assertSame(10.0, $this->balance($recipient), 'the running total is what binds');
    }

    public function test_a_cancelled_inbound_credit_does_not_refund_the_partners_budget(): void
    {
        $this->creditAgreement(10.0);
        $recipient = $this->federatedMember();
        $apiKey = $this->partnerApiKey('f440-c');

        $this->useKey($apiKey);
        $first = $this->apiPost('/v1/federation/transactions', [
            'sender_id' => 900301,
            'recipient_id' => (int) $recipient->id,
            'amount' => 8,
            'description' => 'f440c first',
            'idempotency_key' => 'f440-c-1',
        ], ['X-API-Key' => $apiKey]);
        $first->assertStatus(201);

        // The partner cancels its own row and tries again — F-428's shape.
        DB::table('transactions')
            ->where('id', (int) $first->json('transaction_id'))
            ->update(['status' => 'cancelled']);

        $this->useKey($apiKey);
        $second = $this->apiPost('/v1/federation/transactions', [
            'sender_id' => 900302,
            'recipient_id' => (int) $recipient->id,
            'amount' => 8,
            'description' => 'f440c second',
            'idempotency_key' => 'f440-c-2',
        ], ['X-API-Key' => $apiKey]);

        $this->assertSame(403, $second->status(), (string) $second->getContent());
        $second->assertJsonPath('code', 'CREDIT_CEILING_EXCEEDED');
    }

    // ------------------------------------------------------------------
    //  SECOND FACET — no local member is billed for a remote sender
    // ------------------------------------------------------------------

    public function test_an_external_partner_cannot_attribute_the_transfer_to_a_local_member(): void
    {
        $this->creditAgreement(100.0);
        $recipient = $this->federatedMember();
        $innocent = $this->federatedMember();
        $innocent->balance = 7;
        $innocent->save();

        $summaryBefore = app(WalletService::class)->getBalance((int) $innocent->id);

        $apiKey = $this->partnerApiKey('f440-d');
        $this->useKey($apiKey);
        $this->apiPost('/v1/federation/transactions', [
            'sender_id' => (int) $innocent->id,
            'recipient_id' => (int) $recipient->id,
            'amount' => 10,
            'description' => 'f440 attribution',
            'idempotency_key' => 'f440-d-1',
        ], ['X-API-Key' => $apiKey])->assertStatus(201);

        $this->assertDatabaseMissing('transactions', [
            'sender_id' => (int) $innocent->id,
            'description' => 'f440 attribution',
        ]);

        $summaryAfter = app(WalletService::class)->getBalance((int) $innocent->id);
        $this->assertSame(
            $summaryBefore['total_spent'],
            $summaryAfter['total_spent'],
            'an uninvolved member must not be shown as having spent hours',
        );
        $this->assertSame(7.0, $this->balance($innocent), 'their actual balance is untouched too');
    }

    // ------------------------------------------------------------------
    //  LEGITIMATE ACCESS — a transfer inside the ceiling still lands
    // ------------------------------------------------------------------

    public function test_control_a_transfer_within_the_ceiling_still_credits_the_member(): void
    {
        $this->creditAgreement(50.0);
        $recipient = $this->federatedMember();
        $apiKey = $this->partnerApiKey('f440-e');

        $this->useKey($apiKey);
        $response = $this->apiPost('/v1/federation/transactions', [
            'sender_id' => 900401,
            'recipient_id' => (int) $recipient->id,
            'amount' => 20,
            'description' => 'f440 legitimate settlement',
            'idempotency_key' => 'f440-e-1',
        ], ['X-API-Key' => $apiKey]);

        $this->assertSame(201, $response->status(), (string) $response->getContent());
        $response->assertJsonPath('status', 'completed');
        $this->assertSame(20.0, $this->balance($recipient), 'the feature still works inside the agreed bound');
    }

    public function test_control_the_existing_gates_still_fire(): void
    {
        $recipient = $this->federatedMember();

        // No agreement at all → the pre-existing refusal, unchanged.
        $noAgreementKey = $this->partnerApiKey('f440-f');
        $this->useKey($noAgreementKey);
        $noAgreement = $this->apiPost('/v1/federation/transactions', [
            'sender_id' => 900501,
            'recipient_id' => (int) $recipient->id,
            'amount' => 1,
            'description' => 'f440f no agreement',
            'idempotency_key' => 'f440-f-1',
        ], ['X-API-Key' => $noAgreementKey]);
        $this->assertSame(403, $noAgreement->status(), (string) $noAgreement->getContent());
        $noAgreement->assertJsonPath('code', 'NO_CREDIT_AGREEMENT');

        // Per-transfer bound, unchanged.
        $this->creditAgreement(1000.0);
        $this->useKey($noAgreementKey);
        $tooBig = $this->apiPost('/v1/federation/transactions', [
            'sender_id' => 900502,
            'recipient_id' => (int) $recipient->id,
            'amount' => 101,
            'description' => 'f440f too big',
            'idempotency_key' => 'f440-f-2',
        ], ['X-API-Key' => $noAgreementKey]);
        $this->assertSame(400, $tooBig->status(), (string) $tooBig->getContent());
        $tooBig->assertJsonPath('code', 'INVALID_AMOUNT');

        $this->assertSame(0.0, $this->balance($recipient));
    }

    // ------------------------------------------------------------------
    //  Fixtures
    // ------------------------------------------------------------------

    private function balance(User $user): float
    {
        return (float) DB::table('users')->where('id', $user->id)->value('balance');
    }

    private function communityCreditStock(): float
    {
        return (float) DB::table('users')->where('tenant_id', $this->testTenantId)->sum('balance');
    }

    private function creditAgreement(?float $maxMonthlyCredits): void
    {
        DB::table('federation_credit_agreements')->insert([
            'from_tenant_id' => $this->testTenantId,
            'to_tenant_id' => $this->testTenantId,
            'status' => 'active',
            'max_monthly_credits' => $maxMonthlyCredits,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function federatedMember(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'balance' => 0,
        ]);

        DB::table('federation_user_settings')->updateOrInsert(
            ['user_id' => (int) $user->id],
            [
                'federation_optin' => 1,
                'profile_visible_federated' => 1,
                'appear_in_federated_search' => 1,
                'messaging_enabled_federated' => 1,
                'transactions_enabled_federated' => 1,
                'show_reviews_federated' => 1,
                'updated_at' => now(),
            ],
        );

        return $user;
    }

    private function partnerApiKey(string $platformId): string
    {
        $apiKey = $platformId . '-' . bin2hex(random_bytes(10));
        DB::table('federation_api_keys')->insert([
            'tenant_id' => $this->testTenantId,
            'name' => 'F-440 ' . $platformId,
            'key_hash' => hash('sha256', $apiKey),
            'key_prefix' => substr($apiKey, 0, 8),
            'signing_enabled' => 0,
            'platform_id' => $platformId,
            'permissions' => json_encode(['transactions:write']),
            'rate_limit' => 100000,
            'status' => 'active',
            'created_by' => 1,
            'created_at' => now(),
            'updated_at' => now(),
            'hourly_request_count' => 0,
        ]);

        return $apiKey;
    }

    private function useKey(string $apiKey): void
    {
        FederationApiMiddleware::reset();
        $_SERVER['HTTP_X_API_KEY'] = $apiKey;
        $_SERVER['REQUEST_METHOD'] = 'POST';
        $_SERVER['REQUEST_URI'] = '/api/v1/federation/transactions';
        $_SERVER['REMOTE_ADDR'] = '127.0.0.1';
    }

    private function allowSafeguarding(): void
    {
        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('evaluateExternalContact')->andReturn($this->allowDecision());
        $policy->shouldReceive('evaluateCrossTenantContact')->andReturn($this->allowDecision());
        $policy->shouldReceive('evaluateLocalContact')->andReturn($this->allowDecision());
        $policy->shouldReceive('assertLocalContactAllowed')->andReturnNull();
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);
    }

    private function allowDecision(): SafeguardingInteractionDecision
    {
        return new SafeguardingInteractionDecision(
            status: SafeguardingInteractionDecision::ALLOW,
            code: 'ALLOWED',
            recipientTenantId: $this->testTenantId,
            purposeCode: 'safeguarded_member_contact',
            scopeType: 'tenant',
            scopeIdentifier: '',
            policyVersion: 'e074-e',
        );
    }
}
