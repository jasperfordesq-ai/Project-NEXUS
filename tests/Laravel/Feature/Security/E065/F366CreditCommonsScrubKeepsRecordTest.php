<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E065;

use App\Services\Protocols\CreditCommonsAdapter;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Feature\Security\E065\Concerns\DrivesFederationPartnerApi;
use Tests\Laravel\TestCase;

/**
 * F-366 (E-065) — scrubbing a Credit Commons transaction hard-deleted the row.
 *
 * `PATCH /v2/federation/cc/transaction/{uuid}/X` ran an unconditional
 * `DB::table('federation_cc_entries')->delete()`. A relay-through record — the
 * row written on the remote-payee branch, `local_settlement: false` — moves no
 * local balance, so `C → E` needs no member approval, and `E → X` then erased
 * the only local evidence that the hop ever happened. The partner that created
 * the record could delete it, and `GET /cc/transaction/{uuid}` afterwards
 * reported it had never existed.
 *
 * The fix follows `AdminSafeguardingController::deleteAssignment`: revoke
 * rather than delete, keep an append-only trail, record who did it. The row is
 * moved to the protocol's own scrubbed state `X` and its member-authored
 * description is cleared, which is what "scrub" means in Credit Commons — the
 * payer, payee, amount and uuid survive as the evidence of the hop.
 *
 * Adapted from the E-065 slice-F reproduction
 * `.local-docs-archive/security-log/E-065/repro/slice-f/CreditCommonsPartnerSurfaceTest.php`
 * (`test_partner_can_erase_then_scrub_a_settled_federated_transaction_record`),
 * which PASSED while the bug existed — it asserted the row count became 0.
 * That assertion is inverted. Its companion test asserting the state machine
 * cannot run backwards or repeat is a sound control and is carried over intact.
 */
class F366CreditCommonsScrubKeepsRecordTest extends TestCase
{
    use DatabaseTransactions;
    use DrivesFederationPartnerApi;

    private const UUID = 'f3660000-0000-4000-8000-000000000001';

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootFederationPartner(['*'], 'f366');
        $this->bootCreditCommonsNode();
    }

    protected function tearDown(): void
    {
        $this->tearDownFederationPartner();
        parent::tearDown();
    }

    /**
     * A COMPLETED relay-through record — exactly the row relayTransaction()
     * writes on its remote-payee branch, and the only local evidence the hop
     * happened. No local balance moved, so no member approval guards it.
     */
    private function relayThroughEntry(string $uuid = self::UUID): void
    {
        DB::table('federation_cc_entries')->insert([
            'tenant_id' => $this->testTenantId,
            'transaction_uuid' => $uuid,
            'payer' => 'faraway-node/remote-payer',
            'payee' => 'other-node/remote-payee',
            'quant' => 5.0,
            'description' => 'F366-MEMBER-AUTHORED-NOTE',
            'state' => CreditCommonsAdapter::STATE_COMPLETED,
            'workflow' => '0|PC-CE=',
            'metadata' => json_encode([
                'local_payer_id' => null,
                'local_payee_id' => null,
                'local_settlement' => false,
            ]),
            'author' => 'faraway-node/remote-payer',
            'written_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function entry(string $uuid = self::UUID): ?object
    {
        return DB::table('federation_cc_entries')
            ->where('tenant_id', $this->testTenantId)
            ->where('transaction_uuid', $uuid)
            ->first();
    }

    public function test_scrubbing_keeps_the_record_of_the_relay_hop(): void
    {
        $this->relayThroughEntry();

        // C → E is accepted with no approval, because nothing local settled.
        $this->json(
            'PATCH',
            '/api/v2/federation/cc/transaction/' . self::UUID . '/E',
            [],
            $this->partnerHeaders()
        )->assertStatus(201);

        $this->json(
            'PATCH',
            '/api/v2/federation/cc/transaction/' . self::UUID . '/X',
            [],
            $this->partnerHeaders()
        )->assertStatus(204);

        $entry = $this->entry();

        $this->assertNotNull(
            $entry,
            'The partner deleted the only record of a settled federated transaction.'
        );
        $this->assertSame(CreditCommonsAdapter::STATE_SCRUBBED, (string) $entry->state);

        // The evidence of the hop survives.
        $this->assertSame('faraway-node/remote-payer', (string) $entry->payer);
        $this->assertSame('other-node/remote-payee', (string) $entry->payee);
        $this->assertSame(5.0, (float) $entry->quant);

        // ...but the scrub really scrubs: the free-text note is gone.
        $this->assertStringNotContainsString(
            'F366-MEMBER-AUTHORED-NOTE',
            (string) ($entry->description ?? ''),
            'A scrub must clear the free-text description, not merely relabel the row.'
        );
    }

    public function test_the_scrub_records_who_did_it(): void
    {
        $this->relayThroughEntry();

        $this->json(
            'PATCH',
            '/api/v2/federation/cc/transaction/' . self::UUID . '/E',
            [],
            $this->partnerHeaders()
        )->assertStatus(201);
        $this->json(
            'PATCH',
            '/api/v2/federation/cc/transaction/' . self::UUID . '/X',
            [],
            $this->partnerHeaders()
        )->assertStatus(204);

        $metadata = json_decode((string) ($this->entry()->metadata ?? ''), true);

        $this->assertIsArray($metadata);
        $this->assertSame(
            $this->partnerKeyId,
            (int) ($metadata['scrubbed_by_partner_key_id'] ?? 0),
            'The scrub must record the partner key that performed it.'
        );
        $this->assertNotEmpty($metadata['scrubbed_at'] ?? null);
    }

    public function test_the_transaction_is_still_answerable_after_a_scrub(): void
    {
        $this->relayThroughEntry();

        $this->json('PATCH', '/api/v2/federation/cc/transaction/' . self::UUID . '/E', [], $this->partnerHeaders());
        $this->json('PATCH', '/api/v2/federation/cc/transaction/' . self::UUID . '/X', [], $this->partnerHeaders());

        $read = $this->json(
            'GET',
            '/api/v2/federation/cc/transaction/' . self::UUID,
            [],
            $this->partnerHeaders()
        );

        $read->assertStatus(200);
        $this->assertSame(CreditCommonsAdapter::STATE_SCRUBBED, (string) $read->json('data.state'));
    }

    public function test_state_transitions_still_cannot_run_backwards_or_repeat(): void
    {
        // Carried over from the E-065 reproduction: a sound control that must
        // survive the fix. X is terminal, so a scrub cannot be repeated.
        $bob = $this->makeMember(0.00);
        $this->optIn((int) $bob->id);

        $uuid = 'f3660000-0000-4000-8000-000000000002';
        DB::table('federation_cc_entries')->insert([
            'tenant_id' => $this->testTenantId,
            'transaction_uuid' => $uuid,
            'payer' => 'faraway-node/remote-payer',
            'payee' => $this->ccNodeSlug . '/' . $bob->username,
            'quant' => 1.0,
            'description' => 'F366-STATE-MACHINE',
            'state' => CreditCommonsAdapter::STATE_PENDING,
            'workflow' => '0|PC-CE=',
            'metadata' => json_encode([
                'local_payer_id' => null,
                'local_payee_id' => (int) $bob->id,
                'local_settlement' => false,
            ]),
            'author' => 'faraway-node/remote-payer',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $patch = fn (string $state, ?string $target = null) => $this->json(
            'PATCH',
            '/api/v2/federation/cc/transaction/' . ($target ?? $uuid) . '/' . $state,
            [],
            $this->partnerHeaders()
        );

        $patch('V')->assertStatus(201);
        $patch('P')->assertStatus(400);
        $patch('V')->assertStatus(400);
        $patch('Z')->assertStatus(400);
        $patch('V', 'f3660000-0000-4000-8000-000000009999')->assertStatus(400);

        $this->assertSame(
            CreditCommonsAdapter::STATE_VALIDATED,
            (string) $this->entry($uuid)->state
        );

        // A scrub straight from V is not a legal transition either.
        $patch('X')->assertStatus(400);
        $this->assertNotNull($this->entry($uuid));
    }
}
