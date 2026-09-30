<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E073;

use App\Core\TenantContext;
use App\Services\ExchangeWorkflowService;
use App\Services\SafeguardingInteractionPolicy;
use App\Services\WalletService;
use App\Support\SafeguardingInteractionDecision;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * F-442 (E-073, slice D finding D-3) — exchange completion paid a suspended or
 * banned member.
 *
 * `WalletService::NON_RECEIVING_STATUSES` documents itself as shared by "every
 * path that moves credits to a member … so the rule cannot drift between them
 * (F-105/F-106)". Exchange completion is such a path and did not consult it:
 * `ExchangeWorkflowService::createTransaction()` locked and re-read both
 * parties' rows and never looked at `users.status`, so an account an
 * administrator had suspended or banned kept being paid.
 *
 * The fix calls the shared predicate — `WalletService::canReceiveCredits()` —
 * on the payee row that is ALREADY re-read under `lockForUpdate()` inside the
 * money transaction. Reading the status outside the lock is the separate
 * finding F-411 and is deliberately not repeated here.
 *
 * Refusal is outright: the typed `EXCHANGE_PARTY_CANNOT_RECEIVE` signal rolls
 * the whole completion back, so neither balance moves and the exchange stays at
 * `pending_confirmation` — recoverable the moment the suspension is lifted,
 * rather than trapped in a state neither party can clear.
 *
 * Every completion arm funnels through `createTransaction()`, so one guard
 * covers a party confirming, the counterparty confirming last, and a broker
 * resolving a dispute.
 */
final class F442ExchangeCompletionRefusesSuspendedPayeeTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        $this->allowSafeguarding();
    }

    // ------------------------------------------------------------------
    //  The harm — completion must not pay a non-receiving account
    // ------------------------------------------------------------------

    public function test_a_suspended_payee_is_not_paid_and_no_credits_move(): void
    {
        $payer = $this->makeUser(20.0, 'active');
        $payee = $this->makeUser(0.0, 'suspended');
        $listingId = $this->makeOfferListing($payee);
        $exchangeId = $this->makeAwaitingProviderConfirmation($payer, $payee, $listingId);

        $refusal = $this->attemptConfirmation($exchangeId, $payee, 4.0);

        $this->assertNotNull($refusal, 'the completion must be refused, not accepted');
        $this->assertStringContainsString('EXCHANGE_PARTY_CANNOT_RECEIVE', $refusal);

        $this->assertSame(
            0.0,
            (float) DB::table('users')->where('id', $payee)->value('balance'),
            'a suspended account must not be credited',
        );
        $this->assertSame(
            20.0,
            (float) DB::table('users')->where('id', $payer)->value('balance'),
            'and the payer must not be debited — value must not vanish',
        );
        $this->assertDatabaseMissing('transactions', [
            'tenant_id' => $this->testTenantId,
            'sender_id' => $payer,
            'receiver_id' => $payee,
            'transaction_type' => 'exchange',
        ]);
        $this->assertSame(
            'pending_confirmation',
            (string) DB::table('exchange_requests')->where('id', $exchangeId)->value('status'),
            'the exchange stays confirmable, so lifting the suspension unblocks it',
        );
    }

    public function test_a_banned_payee_is_not_paid_and_no_credits_move(): void
    {
        $payer = $this->makeUser(20.0, 'active');
        $payee = $this->makeUser(0.0, 'banned');
        $listingId = $this->makeOfferListing($payee);
        $exchangeId = $this->makeAwaitingProviderConfirmation($payer, $payee, $listingId);

        $refusal = $this->attemptConfirmation($exchangeId, $payee, 4.0);

        $this->assertNotNull($refusal, 'the completion must be refused, not accepted');
        $this->assertSame(
            0.0,
            (float) DB::table('users')->where('id', $payee)->value('balance'),
            'a banned account must not be credited',
        );
        $this->assertSame(
            20.0,
            (float) DB::table('users')->where('id', $payer)->value('balance'),
        );
    }

    /**
     * The defect never depended on the suspended member being able to sign in:
     * the ACTIVE counterparty confirming last reached the same credit. This arm
     * must be refused too.
     */
    public function test_the_active_counterparty_confirming_last_cannot_pay_a_suspended_member(): void
    {
        $payer = $this->makeUser(20.0, 'active');
        $payee = $this->makeUser(0.0, 'suspended');
        $listingId = $this->makeOfferListing($payee);
        $exchangeId = $this->makeAwaitingRequesterConfirmation($payer, $payee, $listingId);

        $refusal = $this->attemptConfirmation($exchangeId, $payer, 4.0);

        $this->assertNotNull($refusal, 'the active requester must not be able to pay a suspended provider');
        $this->assertSame(
            0.0,
            (float) DB::table('users')->where('id', $payee)->value('balance'),
        );
        $this->assertSame(
            20.0,
            (float) DB::table('users')->where('id', $payer)->value('balance'),
        );
    }

    /**
     * On a `request` listing the credit runs the other way — the listing owner
     * (provider) pays the responder (requester). The guard must follow the
     * payee, not the role.
     */
    public function test_a_suspended_requester_is_not_paid_on_a_request_listing(): void
    {
        $payee = $this->makeUser(0.0, 'suspended');   // requester does the work
        $payer = $this->makeUser(20.0, 'active');     // provider asked for help
        $listingId = $this->makeRequestListing($payer);
        $exchangeId = $this->makeAwaitingProviderConfirmation($payee, $payer, $listingId);

        $refusal = $this->attemptConfirmation($exchangeId, $payer, 4.0);

        $this->assertNotNull($refusal, 'the direction-reversed arm must be refused too');
        $this->assertSame(
            0.0,
            (float) DB::table('users')->where('id', $payee)->value('balance'),
        );
        $this->assertSame(
            20.0,
            (float) DB::table('users')->where('id', $payer)->value('balance'),
        );
    }

    // ------------------------------------------------------------------
    //  Controls — the rightful case still works
    // ------------------------------------------------------------------

    public function test_control_the_same_exchange_with_an_active_payee_still_completes(): void
    {
        $payer = $this->makeUser(20.0, 'active');
        $payee = $this->makeUser(0.0, 'active');
        $listingId = $this->makeOfferListing($payee);
        $exchangeId = $this->makeAwaitingProviderConfirmation($payer, $payee, $listingId);

        $moved = ExchangeWorkflowService::confirmCompletion($exchangeId, $payee, 4.0);

        $this->assertTrue($moved, 'the legitimate case is identical but for users.status');
        $this->assertSame(
            4.0,
            (float) DB::table('users')->where('id', $payee)->value('balance'),
        );
        $this->assertSame(
            16.0,
            (float) DB::table('users')->where('id', $payer)->value('balance'),
        );
        $this->assertDatabaseHas('transactions', [
            'tenant_id' => $this->testTenantId,
            'sender_id' => $payer,
            'receiver_id' => $payee,
            'transaction_type' => 'exchange',
            'status' => 'completed',
        ]);
        $this->assertSame(
            'completed',
            (string) DB::table('exchange_requests')->where('id', $exchangeId)->value('status'),
        );
    }

    /**
     * Proves the shared rule is the one being used: the wallet transfer path
     * refuses the same recipient, and it refuses it on the same constant.
     */
    public function test_control_the_wallet_transfer_path_still_refuses_the_same_recipient(): void
    {
        $payer = $this->makeUser(20.0, 'active');
        $payee = $this->makeUser(0.0, 'suspended');

        $refused = null;
        try {
            app(WalletService::class)->transfer($payer, [
                'recipient' => (string) $payee,
                'amount' => 4.0,
                'description' => 'same recipient, different path',
            ]);
        } catch (\Throwable $e) {
            $refused = $e->getMessage();
        }

        $this->assertNotNull($refused, 'WalletService::transfer must refuse a suspended recipient');
        $this->assertSame(
            0.0,
            (float) DB::table('users')->where('id', $payee)->value('balance'),
        );
        $this->assertSame(
            20.0,
            (float) DB::table('users')->where('id', $payer)->value('balance'),
        );
        $this->assertFalse(
            WalletService::canReceiveCredits('suspended'),
            'the shared predicate both paths must consult',
        );
        $this->assertTrue(WalletService::canReceiveCredits('active'));
    }

    // ------------------------------------------------------------------
    //  Fixtures
    // ------------------------------------------------------------------

    /** Returns the refusal message, or null when the completion was accepted. */
    private function attemptConfirmation(int $exchangeId, int $userId, float $hours): ?string
    {
        try {
            ExchangeWorkflowService::confirmCompletion($exchangeId, $userId, $hours);
        } catch (\Throwable $e) {
            return $e->getMessage();
        }

        return null;
    }

    private function makeUser(float $balance, string $status): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'F442 fixture',
            'email' => 'f442-' . bin2hex(random_bytes(10)) . '@example.test',
            'password_hash' => password_hash(bin2hex(random_bytes(16)), PASSWORD_BCRYPT),
            'balance' => $balance,
            'role' => 'member',
            'status' => $status,
            'is_active' => true,
            'is_approved' => true,
            'preferred_language' => 'en',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function makeOfferListing(int $ownerId): int
    {
        return $this->makeListing($ownerId, 'offer');
    }

    private function makeRequestListing(int $ownerId): int
    {
        return $this->makeListing($ownerId, 'request');
    }

    private function makeListing(int $ownerId, string $type): int
    {
        return (int) DB::table('listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'title' => 'F442 listing',
            'type' => $type,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** Requester has already confirmed; the provider's confirmation completes it. */
    private function makeAwaitingProviderConfirmation(int $requesterId, int $providerId, int $listingId): int
    {
        return (int) DB::table('exchange_requests')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'listing_id' => $listingId,
            'requester_id' => $requesterId,
            'provider_id' => $providerId,
            'proposed_hours' => 4.00,
            'status' => 'pending_confirmation',
            'requester_confirmed_at' => now(),
            'requester_confirmed_hours' => 4.00,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** The provider has already confirmed; the requester's confirmation completes it. */
    private function makeAwaitingRequesterConfirmation(int $requesterId, int $providerId, int $listingId): int
    {
        return (int) DB::table('exchange_requests')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'listing_id' => $listingId,
            'requester_id' => $requesterId,
            'provider_id' => $providerId,
            'proposed_hours' => 4.00,
            'status' => 'pending_confirmation',
            'provider_confirmed_at' => now(),
            'provider_confirmed_hours' => 4.00,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function allowSafeguarding(): void
    {
        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('evaluateLocalContact')->andReturn($this->allowDecision());
        $policy->shouldReceive('evaluateCrossTenantContact')->andReturn($this->allowDecision());
        $policy->shouldReceive('evaluateExternalContact')->andReturn($this->allowDecision());
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
            policyVersion: 'e074-f442',
        );
    }
}
