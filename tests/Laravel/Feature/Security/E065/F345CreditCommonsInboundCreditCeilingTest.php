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
 * F-345 (E-065) — inbound Credit Commons relay had no aggregate ceiling.
 *
 * `POST /v2/federation/cc/transaction/relay` credits a local member's balance
 * with no corresponding local debit (correctly — the debit is the remote node's
 * job), but nothing counted the total. The only bound was
 * `SecurityBounds::isAcceptableHourAmount()`, which caps a SINGLE transfer at
 * 24 hours, and a partner simply repeated the call with a fresh UUID: the
 * reviewer moved 120 hours into one member in five calls.
 *
 * The other two inbound protocols already bound this through
 * `federation_credit_agreements`: the legacy v1 path refuses outright without
 * an active agreement (`FederationController.php:910-919`) and Komunitin
 * derives its credit limit from `max_monthly_credits` on the same table
 * (`FederationKomunitinController.php:1127-1139`). Credit Commons read that
 * table nowhere. The fix makes it read the same table, so all three inbound
 * money paths share one boundary.
 *
 * Adapted from the E-065 slice-F reproduction
 * `.local-docs-archive/security-log/E-065/repro/slice-f/CreditCommonsPartnerSurfaceTest.php`
 * (`test_relay_credits_a_local_member_repeatedly_with_no_aggregate_ceiling`),
 * which PASSED while the bug existed — it asserted the balance reached 120.0.
 * That assertion is inverted here.
 */
class F345CreditCommonsInboundCreditCeilingTest extends TestCase
{
    use DatabaseTransactions;
    use DrivesFederationPartnerApi;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootFederationPartner(['*'], 'f345');
        $this->bootCreditCommonsNode();
    }

    protected function tearDown(): void
    {
        $this->tearDownFederationPartner();
        parent::tearDown();
    }

    /**
     * @return array{0: \Illuminate\Testing\TestResponse, 1: ?string}
     */
    private function relay(string $payeePath, float $quant, int $seq, ?string $lastHash): array
    {
        $response = $this->json('POST', '/api/v2/federation/cc/transaction/relay', [
            'uuid' => sprintf('f3450000-0000-4000-8000-%012d', $seq),
            'payer' => 'faraway-node/remote-payer',
            'payee' => $payeePath,
            'quant' => $quant,
            'description' => 'F345-RELAY-' . $seq,
        ], $this->partnerHeaders($lastHash === null ? [] : ['Last-hash' => $lastHash]));

        return [$response, $response->headers->get('Last-hash')];
    }

    public function test_repeated_relays_stop_at_the_communitys_inbound_credit_ceiling(): void
    {
        $this->grantInboundCreditAgreement(50.0);

        $bob = $this->makeMember(0.00);
        $this->optIn((int) $bob->id);
        $payeePath = $this->ccNodeSlug . '/' . $bob->username;

        // Within the ceiling: the partner may still move credit in. This is the
        // control — the fix is a limit, not a shutdown of the relay path.
        [$first, $hash] = $this->relay($payeePath, 24.0, 1, null);
        $first->assertStatus(201);
        $this->assertNotNull($hash, 'relay did not return a hashchain head');
        $this->assertSame(24.0, $this->balanceOf((int) $bob->id));

        [$second, $hash] = $this->relay($payeePath, 24.0, 2, $hash);
        $second->assertStatus(201);
        $this->assertSame(48.0, $this->balanceOf((int) $bob->id));

        // 48 + 24 exceeds the 50-hour monthly ceiling: refused, nothing credited.
        [$third] = $this->relay($payeePath, 24.0, 3, $hash);
        $third->assertStatus(403);
        $this->assertSame(
            48.0,
            $this->balanceOf((int) $bob->id),
            'A partner credited past the community inbound credit ceiling.'
        );

        // ...and it stays refused however many fresh UUIDs are tried.
        [$fourth] = $this->relay($payeePath, 24.0, 4, $hash);
        [$fifth] = $this->relay($payeePath, 24.0, 5, $hash);
        $fourth->assertStatus(403);
        $fifth->assertStatus(403);

        $this->assertSame(
            48.0,
            $this->balanceOf((int) $bob->id),
            'Five relays at 24 h each must not mint 120 hours into the community.'
        );
    }

    public function test_relay_is_refused_when_the_community_has_no_active_credit_agreement(): void
    {
        $bob = $this->makeMember(0.00);
        $this->optIn((int) $bob->id);

        [$response] = $this->relay($this->ccNodeSlug . '/' . $bob->username, 1.0, 11, null);

        $response->assertStatus(403);
        $this->assertSame(
            0.0,
            $this->balanceOf((int) $bob->id),
            'Credit Commons must refuse inbound credit without an agreement, exactly as the legacy v1 path does.'
        );
    }

    public function test_a_suspended_credit_agreement_does_not_authorise_inbound_credit(): void
    {
        $agreementId = $this->grantInboundCreditAgreement(50.0);
        DB::table('federation_credit_agreements')->where('id', $agreementId)
            ->update(['status' => 'suspended']);

        $bob = $this->makeMember(0.00);
        $this->optIn((int) $bob->id);

        [$response] = $this->relay($this->ccNodeSlug . '/' . $bob->username, 1.0, 21, null);

        $response->assertStatus(403);
        $this->assertSame(0.0, $this->balanceOf((int) $bob->id));
    }

    public function test_an_agreement_with_no_stated_limit_still_has_a_finite_ceiling(): void
    {
        // max_monthly_credits is nullable. "No number recorded" must not mean
        // "unlimited" — that is the finding restated.
        $this->grantInboundCreditAgreement(null);

        $bob = $this->makeMember(0.00);
        $this->optIn((int) $bob->id);
        $payeePath = $this->ccNodeSlug . '/' . $bob->username;

        $hash = null;
        $refused = false;
        for ($i = 0; $i < 40; $i++) {
            [$response, $newHash] = $this->relay($payeePath, 24.0, 100 + $i, $hash);
            if ($response->status() !== 201) {
                $response->assertStatus(403);
                $refused = true;
                break;
            }
            $hash = $newHash;
        }

        $this->assertTrue(
            $refused,
            'An agreement with no stated monthly limit must still fall back to a finite ceiling.'
        );
        $this->assertLessThan(
            960.0,
            $this->balanceOf((int) $bob->id),
            'Forty relays at 24 h each must not all land.'
        );
    }
}
