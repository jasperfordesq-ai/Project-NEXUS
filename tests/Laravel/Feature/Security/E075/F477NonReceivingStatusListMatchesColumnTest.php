<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E075;

use App\Core\TenantContext;
use App\Models\MarketplaceOrder;
use App\Services\ExchangeWorkflowService;
use App\Services\MarketplaceTimeCreditSettlementService;
use App\Services\SafeguardingInteractionPolicy;
use App\Services\WalletService;
use App\Support\SafeguardingInteractionDecision;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * F-477 — the shared "may not be paid" list must match the column it guards,
 * and the paths that consult it must consult the SAME list.
 *
 * `WalletService::NON_RECEIVING_STATUSES` is the single source of truth every
 * credit path is supposed to read; its own docblock says it exists "so the rule
 * cannot drift between them (F-105/F-106)". It read:
 *
 *     ['banned', 'suspended', 'inactive', 'deactivated']
 *
 * `users`.`status` is an ENUM holding exactly:
 *
 *     'active','inactive','suspended','banned','pending','rejected'
 *
 * so the list named one value the column can never hold (`deactivated`) and
 * missed one it can: `rejected`, written only by `AdminUsersController::reject()`
 * — the community formally refusing an applicant. Three services had
 * hand-copied the same four strings and inherited both defects.
 *
 * `pending` is deliberately absent and stays absent: a newly registered member
 * sits at `pending` until verification and must still be able to receive their
 * welcome credits and ordinary transfers.
 */
final class F477NonReceivingStatusListMatchesColumnTest extends TestCase
{
    use DatabaseTransactions;

    /**
     * The three services that previously hand-copied the status list.
     *
     * @var list<string>
     */
    private const COPIED_LIST_SERVICES = [
        'app/Services/MarketplaceTimeCreditSettlementService.php',
        'app/Services/MarketplaceCommunityDeliveryService.php',
        'app/Services/MarketplaceOrderService.php',
    ];

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        $this->allowSafeguarding();
    }

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }

    // ------------------------------------------------------------------
    //  The shared list must describe the column it guards
    // ------------------------------------------------------------------

    /**
     * CORRECT BEHAVIOUR — every entry in the shared list is a value the column
     * can really hold, and the status the community uses to refuse an applicant
     * is one of them.
     */
    public function test_the_shared_list_only_names_statuses_the_column_can_hold_and_includes_rejected(): void
    {
        $enum = (string) DB::selectOne(
            "SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'status'"
        )->t;

        foreach (WalletService::NON_RECEIVING_STATUSES as $status) {
            $this->assertStringContainsString(
                "'" . $status . "'",
                $enum,
                sprintf('the list names "%s", which users.status cannot hold — it guards nothing', $status),
            );
        }

        $this->assertContains(
            'rejected',
            WalletService::NON_RECEIVING_STATUSES,
            'an applicant the community formally refused may not be paid',
        );
        $this->assertFalse(WalletService::canReceiveCredits('rejected'));
        $this->assertFalse(WalletService::canReceiveCredits('suspended'));
        $this->assertFalse(WalletService::canReceiveCredits('banned'));
        $this->assertFalse(WalletService::canReceiveCredits('inactive'));
    }

    /**
     * CONTROL — the list must not grow past what it is for. An active member is
     * payable, and so is a newly registered member still awaiting verification:
     * `pending` is deliberately NOT in the list, because welcome credits and
     * ordinary transfers have to reach a new member before they verify.
     */
    public function test_control_active_and_pending_members_are_still_payable(): void
    {
        $this->assertTrue(WalletService::canReceiveCredits('active'));
        $this->assertTrue(
            WalletService::canReceiveCredits('pending'),
            'a newly registered member must still be able to receive credits',
        );
    }

    /**
     * CORRECT BEHAVIOUR — the three services that used to carry their own copy
     * of the four strings now read the shared constant, so the rule cannot
     * drift away from it again. This is the drift the constant's docblock says
     * it exists to prevent, and the way F-477 reached six credit paths at once.
     */
    public function test_the_marketplace_services_read_the_shared_list_instead_of_their_own_copy(): void
    {
        foreach (self::COPIED_LIST_SERVICES as $relativePath) {
            $source = (string) file_get_contents(base_path($relativePath));

            $this->assertStringContainsString(
                'WalletService::',
                $source,
                $relativePath . ' must consult the shared WalletService rule, not its own list',
            );
            $this->assertStringNotContainsString(
                "'deactivated'",
                $source,
                $relativePath . ' still carries a hand-copied status list',
            );
        }
    }

    // ------------------------------------------------------------------
    //  The behaviour, on three real credit paths
    // ------------------------------------------------------------------

    /**
     * CORRECT BEHAVIOUR — a member-to-member transfer must refuse an applicant
     * the community refused, and must move nothing.
     */
    public function test_a_wallet_transfer_refuses_an_applicant_the_community_refused(): void
    {
        $sender = $this->makeUser(20.0, 'active');
        $rejected = $this->makeRejectedApplicant();

        $refused = null;
        try {
            app(WalletService::class)->transfer($sender, [
                'recipient' => (string) $rejected,
                'amount' => 4.0,
                'description' => 'F477 transfer to a refused applicant',
            ]);
        } catch (\Throwable $e) {
            $refused = $e->getMessage();
        }

        $this->assertNotNull($refused, 'the transfer to a refused applicant was accepted');
        $this->assertSame(0.0, $this->balanceOf($rejected), 'nothing reached the refused applicant');
        $this->assertSame(20.0, $this->balanceOf($sender), 'the sender was not debited');
    }

    /**
     * CONTROL — the identical transfer, differing ONLY in the recipient's
     * status, still succeeds.
     */
    public function test_control_an_active_recipient_is_still_paid_by_the_same_transfer(): void
    {
        $sender = $this->makeUser(20.0, 'active');
        $recipient = $this->makeUser(0.0, 'active');

        app(WalletService::class)->transfer($sender, [
            'recipient' => (string) $recipient,
            'amount' => 4.0,
            'description' => 'F477 ordinary transfer',
        ]);

        $this->assertSame(4.0, $this->balanceOf($recipient));
        $this->assertSame(16.0, $this->balanceOf($sender));
    }

    /**
     * CORRECT BEHAVIOUR — exchange completion (the path E-074 hardened for
     * F-442) must refuse a refused applicant too, because it reads the same
     * shared rule.
     */
    public function test_exchange_completion_refuses_a_rejected_applicant(): void
    {
        $payer = $this->makeUser(20.0, 'active');
        $payee = $this->makeRejectedApplicant();
        $listingId = $this->makeListing($payee, 'offer');
        $exchangeId = $this->makeAwaitingProviderConfirmation($payer, $payee, $listingId);

        $refusal = $this->attemptConfirmation($exchangeId, $payee, 4.0);

        $this->assertNotNull($refusal, 'exchange completion paid a refused applicant');
        $this->assertStringContainsString('EXCHANGE_PARTY_CANNOT_RECEIVE', (string) $refusal);
        $this->assertSame(0.0, $this->balanceOf($payee));
        $this->assertSame(20.0, $this->balanceOf($payer));
    }

    /**
     * CORRECT BEHAVIOUR — marketplace time-credit settlement is one of the
     * three hand-copied lists. A refused seller must not be settled to.
     */
    public function test_marketplace_settlement_refuses_a_rejected_seller(): void
    {
        $buyer = $this->makeUser(20.0, 'active');
        $seller = $this->makeRejectedApplicant();
        $order = $this->makeTimeCreditOrder($buyer, $seller, 4.0);

        $refused = null;
        try {
            app(MarketplaceTimeCreditSettlementService::class)->settle($order);
        } catch (\Throwable $e) {
            $refused = $e->getMessage();
        }

        $this->assertNotNull($refused, 'the settlement paid a refused seller');
        $this->assertSame(0.0, $this->balanceOf($seller));
        $this->assertSame(20.0, $this->balanceOf($buyer));
        $this->assertSame(
            'pending_payment',
            (string) DB::table('marketplace_orders')->where('id', $order->id)->value('status'),
            'the order was not marked paid',
        );
    }

    /**
     * CONTROL — the same settlement, same amount, differing only in the
     * seller's status, still pays.
     */
    public function test_control_marketplace_settlement_still_pays_an_active_seller(): void
    {
        $buyer = $this->makeUser(20.0, 'active');
        $seller = $this->makeUser(0.0, 'active');
        $order = $this->makeTimeCreditOrder($buyer, $seller, 4.0);

        app(MarketplaceTimeCreditSettlementService::class)->settle($order);

        $this->assertSame(4.0, $this->balanceOf($seller));
        $this->assertSame(16.0, $this->balanceOf($buyer));
        $this->assertSame(
            'paid',
            (string) DB::table('marketplace_orders')->where('id', $order->id)->value('status'),
        );
    }

    /**
     * CONTROL — the statuses the list already named still work, so this change
     * extends the rule rather than replacing it.
     */
    public function test_control_a_suspended_recipient_is_still_refused(): void
    {
        $sender = $this->makeUser(20.0, 'active');
        $suspended = $this->makeUser(0.0, 'suspended');

        $refused = null;
        try {
            app(WalletService::class)->transfer($sender, [
                'recipient' => (string) $suspended,
                'amount' => 4.0,
                'description' => 'F477 transfer to a suspended member',
            ]);
        } catch (\Throwable $e) {
            $refused = $e->getMessage();
        }

        $this->assertNotNull($refused);
        $this->assertSame(0.0, $this->balanceOf($suspended));
        $this->assertSame(20.0, $this->balanceOf($sender));
    }

    // ------------------------------------------------------------------
    //  Fixtures
    // ------------------------------------------------------------------

    private function balanceOf(int $userId): float
    {
        return round((float) DB::table('users')->where('id', $userId)->value('balance'), 2);
    }

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

    private function makeTimeCreditOrder(int $buyerId, int $sellerId, float $credits): MarketplaceOrder
    {
        $suffix = bin2hex(random_bytes(6));
        $id = (int) DB::table('marketplace_orders')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'order_number' => 'F477-' . $suffix,
            'buyer_id' => $buyerId,
            'seller_id' => $sellerId,
            'quantity' => 1,
            'unit_price' => 0.00,
            'total_price' => 0.00,
            'currency' => 'EUR',
            'time_credits_used' => $credits,
            'status' => 'pending_payment',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        /** @var MarketplaceOrder $order */
        $order = MarketplaceOrder::withoutGlobalScopes()->whereKey($id)->firstOrFail();

        return $order;
    }

    /**
     * Exactly what `AdminUsersController::reject()` leaves behind: a pending
     * applicant the community refused.
     */
    private function makeRejectedApplicant(): int
    {
        $id = $this->makeUser(0.0, 'pending');
        DB::table('users')->where('id', $id)->update([
            'status' => 'rejected',
            'is_approved' => 0,
            'rejection_reason' => 'F477 fixture',
            'rejected_at' => now(),
        ]);

        return $id;
    }

    private function makeListing(int $ownerId, string $type): int
    {
        return (int) DB::table('listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'title' => 'F477 listing',
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

    private function makeUser(float $balance, string $status): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'F477 fixture',
            'email' => 'f477-' . bin2hex(random_bytes(10)) . '@example.test',
            'password_hash' => password_hash(bin2hex(random_bytes(16)), PASSWORD_BCRYPT),
            'balance' => $balance,
            'role' => 'member',
            'status' => $status,
            'is_active' => $status === 'active',
            'is_approved' => $status === 'active',
            'onboarding_completed' => true,
            'preferred_language' => 'en',
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
            policyVersion: 'e076-f477',
        );
    }
}
