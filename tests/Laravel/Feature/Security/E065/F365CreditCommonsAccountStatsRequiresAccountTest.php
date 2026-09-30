<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E065;

use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Feature\Security\E065\Concerns\DrivesFederationPartnerApi;
use Tests\Laravel\TestCase;

/**
 * F-365 (E-065) — the account endpoint degraded into a community-wide aggregate.
 *
 * `GET /v2/federation/cc/account` with no `acc_id` left the resolved user null,
 * so the query fell back to `transactions WHERE tenant_id = ?` and reported the
 * community's total exchange count and total time-credit volume, with no
 * member's opt-in consulted — because no member was named. A partner could also
 * pass `?since=` to trend it.
 *
 * The un-named form is now refused, which is exactly what the sibling
 * `GET /cc/account/history` already did (`MissingParameter`, 400). The node
 * totals remain available at `GET /cc/account`'s protocol-mandated sibling
 * `GET /cc/about`, which is where the Credit Commons spec puts them — so the
 * fix removes a second, unfiltered route to the same figures rather than
 * withholding anything the protocol requires.
 *
 * Adapted from the E-065 slice-F reproduction
 * `.local-docs-archive/security-log/E-065/repro/slice-f/CreditCommonsPartnerSurfaceTest.php`
 * (`test_account_stats_without_an_account_reports_the_whole_communitys_internal_ledger`),
 * which PASSED while the bug existed. The attack assertion is inverted.
 */
class F365CreditCommonsAccountStatsRequiresAccountTest extends TestCase
{
    use DatabaseTransactions;
    use DrivesFederationPartnerApi;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootFederationPartner(['*'], 'f365');
        $this->bootCreditCommonsNode();
    }

    protected function tearDown(): void
    {
        $this->tearDownFederationPartner();
        parent::tearDown();
    }

    private function internalExchange(int $senderId, int $receiverId): void
    {
        DB::table('transactions')->insert([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $senderId,
            'receiver_id' => $receiverId,
            'amount' => 3.00,
            'description' => 'F365-INTERNAL-ONLY',
            'status' => 'completed',
            'is_federated' => 0,
            'transaction_type' => 'transfer',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_account_stats_without_an_account_is_refused(): void
    {
        $carol = $this->makeMember(10.00);
        $dave = $this->makeMember(0.00);
        $this->internalExchange((int) $carol->id, (int) $dave->id);

        $stats = $this->json('GET', '/api/v2/federation/cc/account', [], $this->partnerHeaders());

        $stats->assertStatus(400);
        $this->assertNull(
            $stats->json('trades'),
            'The account endpoint must not tell a partner how many exchanges the community has made.'
        );
        $this->assertNull(
            $stats->json('volume'),
            'The account endpoint must not tell a partner the community\'s total time-credit volume.'
        );
    }

    public function test_the_since_filter_cannot_be_used_to_trend_the_community_ledger(): void
    {
        $carol = $this->makeMember(10.00);
        $dave = $this->makeMember(0.00);
        $this->internalExchange((int) $carol->id, (int) $dave->id);

        $this->json(
            'GET',
            '/api/v2/federation/cc/account?since=' . now()->subYear()->toDateString(),
            [],
            $this->partnerHeaders()
        )->assertStatus(400);
    }

    public function test_the_protocol_mandated_node_summary_is_unaffected(): void
    {
        // /cc/about is required by the Credit Commons spec and publishes the
        // node's trade count, trader count and volume to a peer node. The fix
        // must not break it — it removes the second, account-shaped route to
        // those figures, not the protocol one.
        $about = $this->json('GET', '/api/v2/federation/cc/about', [], $this->partnerHeaders());

        $about->assertStatus(200);
        $about->assertJsonStructure(['format', 'rate', 'trades', 'traders', 'volume', 'accounts']);
    }

    public function test_a_named_opted_in_account_still_returns_its_own_stats(): void
    {
        $alice = $this->makeMember(6.00);
        $this->optIn((int) $alice->id);

        $stats = $this->json(
            'GET',
            '/api/v2/federation/cc/account/' . $alice->username,
            [],
            $this->partnerHeaders()
        );

        $stats->assertStatus(200);
        $this->assertSame(6.0, (float) $stats->json('balance'));
    }
}
