<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\CommunityFundService;
use App\Services\Identity\IdentityVerificationPaymentService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * E-027 Low findings in the wallet / payments area (F-103 .. F-107).
 *
 * Every finding has an attack assertion and a control assertion showing the
 * rightful path still works.
 */
final class WalletLowFindingsTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
    }

    // ─────────────────────────────────────────────────────────────────────
    // F-103 — exchange ratings are readable only by the exchange's parties
    // ─────────────────────────────────────────────────────────────────────

    public function test_f103_outsider_cannot_read_an_exchanges_ratings(): void
    {
        $requester = $this->member(['last_name' => 'Requesterson']);
        $provider = $this->member(['last_name' => 'Providerson']);
        $exchangeId = $this->insertCompletedExchange($requester->id, $provider->id);
        $this->insertRating($exchangeId, $requester->id, $provider->id, 'requester', 'F103 private comment');

        Sanctum::actingAs($this->member(), ['*']);
        $response = $this->apiGet("/v2/exchanges/{$exchangeId}/ratings");

        $response->assertStatus(403);
        $this->assertStringNotContainsString('F103 private comment', (string) $response->getContent());
        $this->assertStringNotContainsString('Requesterson', (string) $response->getContent());
    }

    public function test_f103_parties_and_admins_still_read_ratings_and_unknown_exchange_is_404(): void
    {
        $requester = $this->member();
        $provider = $this->member();
        $exchangeId = $this->insertCompletedExchange($requester->id, $provider->id);
        $this->insertRating($exchangeId, $requester->id, $provider->id, 'requester', 'F103 visible comment');

        foreach ([$requester, $provider, $this->admin()] as $viewer) {
            Sanctum::actingAs($viewer, ['*']);
            $response = $this->apiGet("/v2/exchanges/{$exchangeId}/ratings");
            $response->assertStatus(200);
            $this->assertStringContainsString('F103 visible comment', (string) $response->getContent());
        }

        Sanctum::actingAs($requester, ['*']);
        $this->apiGet('/v2/exchanges/99999999/ratings')->assertStatus(404);
    }

    // ─────────────────────────────────────────────────────────────────────
    // F-104 — community-fund ledger hides grant recipients from members
    // ─────────────────────────────────────────────────────────────────────

    public function test_f104_member_sees_fund_totals_but_not_recipient_or_admin_reason(): void
    {
        $this->enableWalletModule();
        $admin = $this->admin();
        $recipient = $this->member(['first_name' => 'Grantina', 'last_name' => 'Recipientova']);
        $this->seedFund(20.0);

        TenantContext::setById($this->testTenantId);
        $grant = CommunityFundService::adminWithdraw($admin->id, $recipient->id, 5.0, 'F104 hardship: rent arrears');
        $this->assertTrue($grant['success'], 'Fixture grant must succeed.');

        Sanctum::actingAs($this->member(), ['*']);
        $response = $this->apiGet('/v2/wallet/community-fund/transactions');
        $response->assertStatus(200);
        $body = (string) $response->getContent();

        $this->assertStringNotContainsString('Recipientova', $body);
        $this->assertStringNotContainsString('Grantina', $body);
        $this->assertStringNotContainsString('rent arrears', $body);

        $withdrawal = collect($response->json('data'))->firstWhere('type', 'withdrawal');
        $this->assertNotNull($withdrawal, 'Members still see that a grant happened.');
        $this->assertEquals(5.0, $withdrawal['amount']);
        $this->assertNull($withdrawal['user_id']);
        $this->assertNull($withdrawal['admin_id']);
    }

    public function test_f104_admin_still_sees_full_fund_ledger(): void
    {
        $this->enableWalletModule();
        $admin = $this->admin();
        $recipient = $this->member(['first_name' => 'Grantina', 'last_name' => 'Recipientova']);
        $this->seedFund(20.0);

        TenantContext::setById($this->testTenantId);
        CommunityFundService::adminWithdraw($admin->id, $recipient->id, 5.0, 'F104 hardship: rent arrears');

        Sanctum::actingAs($admin, ['*']);
        $response = $this->apiGet('/v2/wallet/community-fund/transactions');
        $response->assertStatus(200);
        $body = (string) $response->getContent();

        $this->assertStringContainsString('Recipientova', $body);
        $this->assertStringContainsString('rent arrears', $body);
    }

    // ─────────────────────────────────────────────────────────────────────
    // F-105 — donations obey the same recipient and sender rules as transfer
    // ─────────────────────────────────────────────────────────────────────

    public function test_f105_donation_to_a_suspended_or_banned_member_is_refused(): void
    {
        $this->enableWalletModule();
        $donor = $this->member(['balance' => 10.0]);

        foreach (['suspended', 'banned'] as $status) {
            $recipient = $this->member(['status' => $status, 'balance' => 0.0]);

            Sanctum::actingAs($donor, ['*']);
            $response = $this->apiPost('/v2/wallet/donate', [
                'recipient_type' => 'user',
                'recipient_id' => $recipient->id,
                'amount' => 1.0,
            ]);

            $response->assertStatus(400);
            $this->assertEquals(0.0, (float) DB::table('users')->where('id', $recipient->id)->value('balance'), "A {$status} account must not receive credits.");
        }

        $this->assertEquals(10.0, (float) DB::table('users')->where('id', $donor->id)->value('balance'));
    }

    public function test_f105_donation_to_an_active_member_still_works(): void
    {
        $this->enableWalletModule();
        $donor = $this->member(['balance' => 10.0]);
        $recipient = $this->member(['balance' => 0.0]);

        Sanctum::actingAs($donor, ['*']);
        $this->apiPost('/v2/wallet/donate', [
            'recipient_type' => 'user',
            'recipient_id' => $recipient->id,
            'amount' => 2.0,
        ])->assertStatus(201);

        $this->assertEquals(2.0, (float) DB::table('users')->where('id', $recipient->id)->value('balance'));
    }

    public function test_f105_every_credit_moving_member_route_carries_the_transfer_gates(): void
    {
        $expected = $this->middlewareFor('POST', 'api/v2/wallet/transfer');
        $this->assertContains('onboarding-required', $expected, 'Control: the main transfer route is gated.');
        $this->assertContains('legal-acceptance', $expected, 'Control: the main transfer route is gated.');

        foreach (['api/wallet/transfer', 'api/v2/wallet/donate', 'api/v2/wallet/community-fund/donate'] as $uri) {
            $middleware = $this->middlewareFor('POST', $uri);
            $this->assertContains('onboarding-required', $middleware, "{$uri} skips the onboarding gate.");
            $this->assertContains('legal-acceptance', $middleware, "{$uri} skips the legal-acceptance gate.");
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // F-106 — fund withdraw validates the recipient before debiting
    // ─────────────────────────────────────────────────────────────────────

    public function test_f106_withdraw_to_missing_foreign_or_suspended_recipient_leaves_fund_untouched(): void
    {
        $admin = $this->admin();
        $this->seedFund(20.0);
        $foreign = User::factory()->forTenant(999)->create(['status' => 'active', 'balance' => 0.0]);
        $suspended = $this->member(['status' => 'suspended', 'balance' => 0.0]);

        TenantContext::setById($this->testTenantId);
        foreach ([99999999, (int) $foreign->id, (int) $suspended->id] as $recipientId) {
            $result = CommunityFundService::adminWithdraw($admin->id, $recipientId, 5.0, 'F106 grant');
            $this->assertFalse($result['success'], "Recipient {$recipientId} must be refused.");
        }

        $this->assertEquals(20.0, (float) CommunityFundService::getBalance()['balance']);
        $this->assertEquals(0.0, (float) DB::table('users')->where('id', $foreign->id)->value('balance'));
        $this->assertEquals(0.0, (float) DB::table('users')->where('id', $suspended->id)->value('balance'));
        $this->assertSame(0, DB::table('community_fund_transactions')
            ->where('tenant_id', $this->testTenantId)->where('type', 'withdrawal')
            ->where('description', 'F106 grant')->count());
    }

    public function test_f106_withdraw_to_active_member_still_works(): void
    {
        $admin = $this->admin();
        $this->seedFund(20.0);
        $recipient = $this->member(['balance' => 0.0]);

        TenantContext::setById($this->testTenantId);
        $result = CommunityFundService::adminWithdraw($admin->id, $recipient->id, 5.0, 'F106 grant');

        $this->assertTrue($result['success']);
        $this->assertEquals(15.0, (float) CommunityFundService::getBalance()['balance']);
        $this->assertEquals(5.0, (float) DB::table('users')->where('id', $recipient->id)->value('balance'));
    }

    // ─────────────────────────────────────────────────────────────────────
    // F-107 — a late "payment failed" webhook cannot undo a completed fee
    // ─────────────────────────────────────────────────────────────────────

    public function test_f107_late_failure_event_does_not_overwrite_completed_payment(): void
    {
        $user = $this->member();
        [$sessionId, $pi] = $this->insertFeeSession($user->id, 'pending');

        IdentityVerificationPaymentService::handlePaymentSucceeded($pi);
        IdentityVerificationPaymentService::handlePaymentFailed($pi);

        $this->assertSame('completed', DB::table('identity_verification_sessions')->where('id', $sessionId)->value('payment_status'));
        $this->assertTrue(IdentityVerificationPaymentService::hasCompletedPayment($this->testTenantId, $user->id));
    }

    public function test_f107_failure_event_still_fails_a_pending_payment(): void
    {
        $user = $this->member();
        [$sessionId, $pi] = $this->insertFeeSession($user->id, 'pending');

        IdentityVerificationPaymentService::handlePaymentFailed($pi);

        $this->assertSame('failed', DB::table('identity_verification_sessions')->where('id', $sessionId)->value('payment_status'));
    }

    public function test_f107_fee_currency_follows_the_tenant_not_a_hard_coded_eur(): void
    {
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'general.default_currency'],
            ['setting_value' => 'GBP']
        );
        app(\App\Services\TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);

        TenantContext::setById($this->testTenantId);
        $this->assertSame('gbp', TenantContext::getCurrency(), 'Fixture: the tenant currency is GBP.');

        Sanctum::actingAs($this->member(), ['*']);
        $response = $this->apiGet('/v2/identity/status');

        $response->assertStatus(200);
        $this->assertSame('gbp', strtolower((string) $response->json('data.fee_currency')));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────

    /** @param array<string,mixed> $overrides */
    private function member(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'onboarding_completed' => true,
        ], $overrides));
    }

    private function admin(): User
    {
        return User::factory()->forTenant($this->testTenantId)->admin()->create([
            'status' => 'active',
            'is_approved' => true,
            'onboarding_completed' => true,
        ]);
    }

    private function enableWalletModule(): void
    {
        $this->assertTrue(TenantContext::hasModule('wallet'), 'Fixture: the test tenant must have the wallet module.');
    }

    private function seedFund(float $balance): void
    {
        TenantContext::setById($this->testTenantId);
        $fund = CommunityFundService::getOrCreateFund();
        DB::table('community_fund_accounts')->where('id', $fund['id'])->update(['balance' => $balance]);
    }

    private function insertCompletedExchange(int $requesterId, int $providerId): int
    {
        $listingId = (int) DB::table('listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $providerId,
            'title' => 'F103 listing ' . uniqid(),
            'description' => 'F103',
            'type' => 'offer',
            'status' => 'active',
            'created_at' => now(),
        ]);

        return (int) DB::table('exchange_requests')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'listing_id' => $listingId,
            'requester_id' => $requesterId,
            'provider_id' => $providerId,
            'proposed_hours' => 1,
            'status' => 'completed',
            'created_at' => now(),
        ]);
    }

    private function insertRating(int $exchangeId, int $raterId, int $ratedId, string $role, string $comment): void
    {
        DB::table('exchange_ratings')->insert([
            'tenant_id' => $this->testTenantId,
            'exchange_id' => $exchangeId,
            'rater_id' => $raterId,
            'rated_id' => $ratedId,
            'rating' => 4,
            'comment' => $comment,
            'role' => $role,
            'created_at' => now(),
        ]);
    }

    /** @return array{0:int,1:object} */
    private function insertFeeSession(int $userId, string $paymentStatus): array
    {
        $piId = 'pi_f107_' . uniqid();
        $sessionId = (int) DB::table('identity_verification_sessions')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'provider_slug' => 'stripe_identity',
            'verification_level' => 'document_selfie',
            'status' => 'cancelled',
            'stripe_payment_intent_id' => $piId,
            'verification_fee_amount' => 500,
            'payment_status' => $paymentStatus,
            'created_at' => now(),
        ]);

        return [$sessionId, (object) [
            'id' => $piId,
            'metadata' => (object) ['nexus_type' => 'identity_verification'],
        ]];
    }

    /** @return list<string> */
    private function middlewareFor(string $method, string $uri): array
    {
        foreach (Route::getRoutes() as $route) {
            if ($route->uri() === $uri && in_array($method, $route->methods(), true)) {
                return array_values(array_filter($route->gatherMiddleware(), 'is_string'));
            }
        }

        $this->fail("Route {$method} {$uri} is not registered.");
    }
}
