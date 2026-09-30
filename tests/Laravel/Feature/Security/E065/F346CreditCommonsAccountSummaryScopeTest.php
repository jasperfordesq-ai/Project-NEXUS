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
 * F-346 (E-065) — the Credit Commons account summaries covered the member's
 * whole internal exchange history.
 *
 * `GET /v2/federation/cc/account/{acc_id}` and
 * `GET /v2/federation/cc/account/history/{acc_id}` resolved the SUBJECT through
 * the opt-in filter but then summarised every row in `transactions` for that
 * member. A partner therefore obtained a timestamped internal balance curve
 * plus gross in/out and a counterparty count — including exchanges with members
 * who never opted into federation at all.
 *
 * A member's consent was to trade across communities, not to publish their
 * internal trading history to a third-party node, so both endpoints are now
 * restricted to the federated subset of the ledger.
 *
 * Adapted from the E-065 slice-F reproduction
 * `.local-docs-archive/security-log/E-065/repro/slice-f/CreditCommonsPartnerSurfaceTest.php`
 * (`test_account_history_publishes_a_members_internal_exchanges`), which PASSED
 * while the bug existed. Its attack assertions are inverted, its control (the
 * non-opted-in counterparty is refused) is kept, and a new control proves
 * genuinely federated activity is still reported.
 */
class F346CreditCommonsAccountSummaryScopeTest extends TestCase
{
    use DatabaseTransactions;
    use DrivesFederationPartnerApi;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootFederationPartner(['*'], 'f346');
        $this->bootCreditCommonsNode();
    }

    protected function tearDown(): void
    {
        $this->tearDownFederationPartner();
        parent::tearDown();
    }

    private function exchange(int $senderId, ?int $receiverId, float $amount, bool $federated, string $marker): void
    {
        DB::table('transactions')->insert([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $senderId,
            'receiver_id' => $receiverId,
            'amount' => $amount,
            'description' => $marker,
            'status' => 'completed',
            'is_federated' => $federated ? 1 : 0,
            'transaction_type' => 'transfer',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_account_history_does_not_publish_a_members_internal_exchanges(): void
    {
        $alice = $this->makeMember(10.00);
        $this->optIn((int) $alice->id);

        // The counterparty never opted into federation.
        $eve = $this->makeMember(0.00);
        $this->exchange((int) $alice->id, (int) $eve->id, 2.50, false, 'F346-INTERNAL-HISTORY');

        $history = $this->json(
            'GET',
            '/api/v2/federation/cc/account/history/' . $alice->username,
            [],
            $this->partnerHeaders()
        );

        $history->assertStatus(200);
        $this->assertSame(
            0,
            (int) $history->json('meta.points'),
            'A partner read the internal exchange timeline of a member.'
        );
        $this->assertSame(0, (int) $history->json('meta.min'));

        $stats = $this->json(
            'GET',
            '/api/v2/federation/cc/account/' . $alice->username,
            [],
            $this->partnerHeaders()
        );

        $stats->assertStatus(200);
        $this->assertSame(
            0.0,
            (float) $stats->json('gross_out'),
            'Gross out must not be computed over purely internal exchanges.'
        );
        $this->assertSame(
            0,
            (int) $stats->json('partners'),
            'A partner must not learn how many people a member exchanges with internally.'
        );
        $this->assertSame(0, (int) $stats->json('trades'));
    }

    public function test_federated_activity_is_still_reported(): void
    {
        $alice = $this->makeMember(10.00);
        $this->optIn((int) $alice->id);
        $partnerMember = $this->makeMember(0.00);
        $this->optIn((int) $partnerMember->id);

        $this->exchange((int) $alice->id, (int) $partnerMember->id, 4.00, true, 'F346-FEDERATED');

        $history = $this->json(
            'GET',
            '/api/v2/federation/cc/account/history/' . $alice->username,
            [],
            $this->partnerHeaders()
        );
        $history->assertStatus(200);
        $this->assertSame(
            1,
            (int) $history->json('meta.points'),
            'The fix is a scope, not a blackout — federated activity is still published.'
        );

        $stats = $this->json(
            'GET',
            '/api/v2/federation/cc/account/' . $alice->username,
            [],
            $this->partnerHeaders()
        );
        $stats->assertStatus(200);
        $this->assertSame(4.0, (float) $stats->json('gross_out'));
        $this->assertSame(1, (int) $stats->json('partners'));

        // The member's own current balance is still reported: that is the point
        // of a federated account resource and is not part of this finding.
        $this->assertSame(10.0, (float) $stats->json('balance'));
    }

    public function test_a_member_who_never_opted_in_still_cannot_be_addressed(): void
    {
        $eve = $this->makeMember(0.00);

        $this->json(
            'GET',
            '/api/v2/federation/cc/account/history/' . $eve->username,
            [],
            $this->partnerHeaders()
        )->assertStatus(400);

        $this->json(
            'GET',
            '/api/v2/federation/cc/account/' . $eve->username,
            [],
            $this->partnerHeaders()
        )->assertStatus(400);
    }
}
