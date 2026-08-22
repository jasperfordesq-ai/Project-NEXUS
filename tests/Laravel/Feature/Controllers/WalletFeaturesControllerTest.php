<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use Tests\Laravel\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use App\Models\User;

/**
 * Feature tests for WalletFeaturesController — statement, categories, community fund, donations.
 */
class WalletFeaturesControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function authenticatedUser(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'balance' => 10.00,
        ]);

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    // ------------------------------------------------------------------
    //  GET /v2/wallet/statement
    // ------------------------------------------------------------------

    public function test_statement_requires_auth(): void
    {
        $response = $this->apiGet('/v2/wallet/statement');

        $response->assertStatus(401);
    }

    public function test_statement_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/wallet/statement');

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  GET /v2/wallet/categories
    // ------------------------------------------------------------------

    public function test_categories_requires_auth(): void
    {
        $response = $this->apiGet('/v2/wallet/categories');

        $response->assertStatus(401);
    }

    public function test_categories_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/wallet/categories');

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  POST /v2/wallet/categories
    // ------------------------------------------------------------------

    public function test_create_category_requires_auth(): void
    {
        $response = $this->apiPost('/v2/wallet/categories', ['name' => 'Groceries']);

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  GET /v2/wallet/community-fund
    // ------------------------------------------------------------------

    public function test_community_fund_requires_auth(): void
    {
        $response = $this->apiGet('/v2/wallet/community-fund');

        $response->assertStatus(401);
    }

    public function test_community_fund_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/wallet/community-fund');

        $response->assertStatus(200);
    }

    /**
     * 🔴 200 is not the same as an answer.
     *
     * `test_community_fund_returns_data()` above asserts only the status, and it passed for
     * as long as this endpoint has existed while the body was
     * `{"balance": 0, "enabled": false}` for EVERY tenant on the platform. The gate asked
     * `TenantContext::hasFeature('wallet')`, but `wallet` lives in
     * `TenantFeatureConfig::MODULE_DEFAULTS`, not `FEATURE_DEFAULTS` — so the feature lookup
     * could never be true, and no tenant writes a `wallet` key into its `features` JSON.
     *
     * Found by walking the mobile wallet on 2026-08-22: a member donated a credit, the fund
     * account recorded it, and the wallet screen showed FUND 0h / DONATED 0h. The credit had
     * left their balance. Nothing was lost — it was invisible.
     *
     * This test asserts the CONTENT after a real donation, which is what the status-only
     * test could not do.
     */
    public function test_community_fund_reports_a_donation_rather_than_reporting_itself_disabled(): void
    {
        $user = $this->authenticatedUser();

        $before = $this->apiGet('/v2/wallet/community-fund');
        $before->assertStatus(200);
        $this->assertArrayNotHasKey(
            'enabled',
            (array) $before->json('data'),
            'The fund answered with the feature-disabled shape. `wallet` is a MODULE, not a '
            . 'feature: use TenantContext::hasModule("wallet").'
        );
        $startingBalance = (float) ($before->json('data.balance') ?? 0);

        $donation = $this->apiPost('/v2/wallet/donate', [
            'recipient_type' => 'community_fund',
            'amount' => 2.0,
            'message' => 'Regression: the fund must show this',
        ]);
        $donation->assertStatus(201);

        $after = $this->apiGet('/v2/wallet/community-fund');
        $after->assertStatus(200);

        $this->assertSame(
            $startingBalance + 2.0,
            (float) $after->json('data.balance'),
            'The community fund balance did not move after a donation that debited the member.'
        );
        $this->assertGreaterThanOrEqual(
            2.0,
            (float) $after->json('data.total_donated'),
            'total_donated did not record the member donation.'
        );
    }

    /**
     * 🔴 A shape guard on the gate itself, because the wrong registry fails SILENTLY.
     *
     * Asking for a module in the feature registry does not error — it returns false, and the
     * endpoint answers with a polite "disabled" that looks like a tenant setting. Six
     * endpoints in this controller were dead that way. If a future edit reaches for
     * `hasFeature('wallet')` again, this says so immediately.
     */
    public function test_wallet_gates_ask_the_module_registry_not_the_feature_registry(): void
    {
        $source = file_get_contents(base_path('app/Http/Controllers/Api/WalletFeaturesController.php'));
        $this->assertIsString($source);

        // 🔴 Comments are stripped first. The controller's own explanation of this defect
        // quotes `hasFeature('wallet')` several times, and matching prose made this guard
        // fail against the very fix it is guarding.
        $code = preg_replace('~^\s*(//|\*|/\*).*$~m', '', $source) ?? $source;

        $this->assertStringNotContainsString(
            "hasFeature('wallet')",
            $code,
            '`wallet` is in MODULE_DEFAULTS, not FEATURE_DEFAULTS, so hasFeature("wallet") is '
            . 'false for every tenant and silently disables the community fund everywhere.'
        );
        $this->assertStringContainsString("hasModule('wallet')", $code);
    }

    // ------------------------------------------------------------------
    //  GET /v2/wallet/community-fund/transactions
    // ------------------------------------------------------------------

    public function test_community_fund_transactions_requires_auth(): void
    {
        $response = $this->apiGet('/v2/wallet/community-fund/transactions');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  POST /v2/wallet/donate
    // ------------------------------------------------------------------

    public function test_donate_requires_auth(): void
    {
        $response = $this->apiPost('/v2/wallet/donate', [
            'amount' => 1.0,
            'recipient_id' => 1,
        ]);

        $response->assertStatus(401);
    }

    public function test_can_donate_to_community_fund(): void
    {
        $user = $this->authenticatedUser();

        $response = $this->apiPost('/v2/wallet/donate', [
            'recipient_type' => 'community_fund',
            'amount' => 1.0,
            'message' => 'Test community gift',
        ]);

        $response->assertStatus(201);

        $this->assertDatabaseHas('community_fund_transactions', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'type' => 'donation',
            'amount' => 1.00,
            'description' => 'Test community gift',
        ]);

        $this->assertDatabaseHas('credit_donations', [
            'tenant_id' => $this->testTenantId,
            'donor_id' => $user->id,
            'recipient_type' => 'community_fund',
            'amount' => 1.00,
        ]);

        $this->assertEquals(
            9.0,
            (float) DB::table('users')->where('id', $user->id)->value('balance')
        );
    }

    // ------------------------------------------------------------------
    //  GET /v2/wallet/donations
    // ------------------------------------------------------------------

    public function test_donation_history_requires_auth(): void
    {
        $response = $this->apiGet('/v2/wallet/donations');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  GET /v2/wallet/starting-balance
    // ------------------------------------------------------------------

    public function test_starting_balance_requires_auth(): void
    {
        $response = $this->apiGet('/v2/wallet/starting-balance');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  GET /v2/users/{id}/rating
    // ------------------------------------------------------------------

    public function test_user_rating_requires_auth(): void
    {
        $response = $this->apiGet('/v2/users/1/rating');

        $response->assertStatus(401);
    }

    public function test_user_rating_returns_data(): void
    {
        $user = $this->authenticatedUser();

        $response = $this->apiGet("/v2/users/{$user->id}/rating");

        $response->assertStatus(200);
    }
}
