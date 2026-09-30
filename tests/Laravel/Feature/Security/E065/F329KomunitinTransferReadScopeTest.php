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
 * F-329 (E-065) — the Komunitin transfer READ paths were scoped by tenant only.
 *
 * `GET /v2/federation/komunitin/{code}/transfers/{id}` and the collection
 * `GET .../{code}/transfers` resolved rows straight out of `transactions` on
 * `id` + `tenant_id`, so an external partner read every exchange in the
 * community — both parties, the amount and the member's own free-text
 * description — including wholly internal exchanges between members who never
 * opted into federation.
 *
 * The write paths on the identical route pair already carried the boundary:
 * `updateTransfer()` and `deleteTransfer()` both require
 * `transaction_type === 'komunitin_external'` AND `partnerOwnsTransfer()`.
 * The fix applies those same two checks to the reads.
 *
 * Adapted from the E-065 slice-A reproduction
 * `.local-docs-archive/security-log/E-065/repro/slice-a/KomunitinNestedOwnershipTest.php`
 * (`test_partner_can_read_a_purely_internal_member_to_member_transaction`),
 * which PASSED while the bug existed. Every attack assertion below is inverted:
 * the internal exchange must now be refused, and the partner's OWN transfer
 * must still be readable so the fix is a boundary and not a blanket refusal.
 */
class F329KomunitinTransferReadScopeTest extends TestCase
{
    use DatabaseTransactions;
    use DrivesFederationPartnerApi;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootFederationPartner(['*'], 'f329');
    }

    protected function tearDown(): void
    {
        $this->tearDownFederationPartner();
        parent::tearDown();
    }

    /** A wholly internal member-to-member exchange, not a federated transfer. */
    private function internalExchange(int $senderId, int $receiverId, string $marker): int
    {
        return (int) DB::table('transactions')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $senderId,
            'receiver_id' => $receiverId,
            'amount' => 2.50,
            'description' => $marker,
            'status' => 'completed',
            'is_federated' => 0,
            'transaction_type' => 'transfer',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** A komunitin transfer this partner created, recorded exactly as createTransfer() does. */
    private function partnerOwnedTransfer(int $payerId, int $payeeId, string $marker): int
    {
        $txId = (int) DB::table('transactions')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $payerId,
            'receiver_id' => $payeeId,
            'amount' => 1.00,
            'description' => $marker,
            'status' => 'pending',
            'is_federated' => 1,
            'transaction_type' => 'komunitin_external',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('federation_debit_approvals')->insert([
            'tenant_id' => $this->testTenantId,
            'protocol' => 'komunitin',
            'reference_id' => (string) $txId,
            'partner_key_id' => $this->partnerKeyId,
            'partner_request_id' => 'f329-' . $txId,
            'request_hash' => hash('sha256', 'f329-' . $txId),
            'payer_user_id' => $payerId,
            'payee_user_id' => $payeeId,
            'payee_label' => 'payee-' . $payeeId,
            'amount' => 1.0,
            'description' => $marker,
            'status' => 'pending',
            'expires_at' => now()->addDay(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $txId;
    }

    public function test_partner_cannot_read_a_purely_internal_member_to_member_transaction(): void
    {
        $code = $this->ownCurrencyCode();
        $alice = $this->makeMember(10.00);
        $bob = $this->makeMember(0.00);

        $txId = $this->internalExchange((int) $alice->id, (int) $bob->id, 'F329-INTERNAL-LEDGER-MARKER');

        $read = $this->json(
            'GET',
            "/api/v2/federation/komunitin/{$code}/transfers/{$txId}",
            [],
            $this->komunitinHeaders()
        );

        $read->assertStatus(404);
        $this->assertStringNotContainsString(
            'F329-INTERNAL-LEDGER-MARKER',
            (string) $read->getContent(),
            'The member-authored description of an internal exchange must never reach a federation partner.'
        );
    }

    public function test_partner_can_still_read_its_own_komunitin_transfer(): void
    {
        $code = $this->ownCurrencyCode();
        $payer = $this->makeMember(10.00);
        $payee = $this->makeMember(0.00);

        $txId = $this->partnerOwnedTransfer((int) $payer->id, (int) $payee->id, 'F329-OWN-TRANSFER');

        $read = $this->json(
            'GET',
            "/api/v2/federation/komunitin/{$code}/transfers/{$txId}",
            [],
            $this->komunitinHeaders()
        );

        $read->assertStatus(200);
        $this->assertSame((string) $txId, $read->json('data.id'));
        $this->assertSame('F329-OWN-TRANSFER', $read->json('data.attributes.meta'));
    }

    public function test_transfer_collection_returns_only_the_partners_own_transfers(): void
    {
        $code = $this->ownCurrencyCode();
        $alice = $this->makeMember(10.00);
        $bob = $this->makeMember(0.00);

        $internalId = $this->internalExchange((int) $alice->id, (int) $bob->id, 'F329-COLLECTION-INTERNAL');
        $ownId = $this->partnerOwnedTransfer((int) $alice->id, (int) $bob->id, 'F329-COLLECTION-OWN');

        $list = $this->json(
            'GET',
            "/api/v2/federation/komunitin/{$code}/transfers?page[size]=100",
            [],
            $this->komunitinHeaders()
        );

        $list->assertStatus(200);
        $ids = array_column((array) $list->json('data'), 'id');

        $this->assertNotContains(
            (string) $internalId,
            $ids,
            'The community ledger collection must not page an internal exchange out to a partner.'
        );
        $this->assertContains(
            (string) $ownId,
            $ids,
            'The partner must still see the transfers it created — the fix is a boundary, not a blanket refusal.'
        );
        $this->assertStringNotContainsString('F329-COLLECTION-INTERNAL', (string) $list->getContent());
    }

    public function test_another_partners_transfer_is_not_readable(): void
    {
        $code = $this->ownCurrencyCode();
        $payer = $this->makeMember(10.00);
        $payee = $this->makeMember(0.00);

        $txId = $this->partnerOwnedTransfer((int) $payer->id, (int) $payee->id, 'F329-OTHER-PARTNER');

        // Re-point the approval at a different partner key: the transfer is a
        // komunitin_external row, so only partnerOwnsTransfer() separates them.
        DB::table('federation_debit_approvals')
            ->where('tenant_id', $this->testTenantId)
            ->where('reference_id', (string) $txId)
            ->update(['partner_key_id' => $this->partnerKeyId + 100000]);

        $this->json(
            'GET',
            "/api/v2/federation/komunitin/{$code}/transfers/{$txId}",
            [],
            $this->komunitinHeaders()
        )->assertStatus(404);

        $list = $this->json(
            'GET',
            "/api/v2/federation/komunitin/{$code}/transfers?page[size]=100",
            [],
            $this->komunitinHeaders()
        );
        $list->assertStatus(200);
        $this->assertNotContains((string) $txId, array_column((array) $list->json('data'), 'id'));
    }
}
