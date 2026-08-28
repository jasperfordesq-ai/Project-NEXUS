<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Federation;

use App\Models\User;
use App\Services\CreditCommonsNodeService;
use App\Services\Protocols\CreditCommonsAdapter;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Outbound Credit Commons transactions must name accounts the way CC addresses
 * them: `<node-slug>/<account>`.
 *
 * 🔴 The defect this pins, found 2026-08-28. `transformOutboundTransaction()`
 * passed both sides through `toAccountPath($identifier)` with no node slug,
 * while the ONLY real caller — App\Listeners\PushTransactionToFederatedPartner —
 * sends `sender_user_id` / `receiver_user_id` and no `*_account_path`. So every
 * outbound transaction went out with a bare numeric id as payer and payee.
 * `generateEntries()`, the double-entry ledger payload for the same movement of
 * credit, had the identical bug.
 *
 * The unit test alongside this one only ever exercised pre-qualified paths
 * ("my-node/alice"), so it passed throughout — which is why this test uses the
 * production payload shape instead of a convenient one.
 */
class CreditCommonsOutboundAccountPathTest extends TestCase
{
    use DatabaseTransactions;

    private CreditCommonsAdapter $adapter;

    protected function setUp(): void
    {
        parent::setUp();
        $this->adapter = new CreditCommonsAdapter();
    }

    public function test_local_member_ids_are_qualified_with_the_node_slug(): void
    {
        $sender = $this->memberWithUsername('alice_cc');
        $receiver = $this->memberWithUsername('bob_cc');
        $nodeSlug = $this->nodeSlug();

        // Exactly the payload PushTransactionToFederatedPartner builds.
        $result = $this->adapter->transformOutboundTransaction([
            'amount' => 2.5,
            'description' => 'Tutoring session',
            'sender_user_id' => $sender->id,
            'receiver_user_id' => $receiver->id,
            'sender_tenant_id' => $this->testTenantId,
            'receiver_tenant_id' => $this->testTenantId,
        ], 1);

        self::assertSame("{$nodeSlug}/alice_cc", $result['payer']);
        self::assertSame("{$nodeSlug}/bob_cc", $result['payee']);

        // The regression in one assertion: a CC account path always has a node.
        self::assertStringContainsString('/', $result['payer']);
        self::assertStringContainsString('/', $result['payee']);
    }

    public function test_a_member_without_a_username_still_gets_a_qualified_path(): void
    {
        $sender = $this->memberWithUsername(null);
        $nodeSlug = $this->nodeSlug();

        $result = $this->adapter->transformOutboundTransaction([
            'amount' => 1.0,
            'sender_user_id' => $sender->id,
            'sender_tenant_id' => $this->testTenantId,
        ], 1);

        self::assertSame("{$nodeSlug}/user-{$sender->id}", $result['payer']);
    }

    public function test_an_explicit_account_path_is_left_alone(): void
    {
        // The caller knew the topology; we must not second-guess it, and in
        // particular must not re-qualify a partner's account with our slug.
        $result = $this->adapter->transformOutboundTransaction([
            'amount' => 2.5,
            'sender_account_path' => 'my-node/alice',
            'receiver_account_path' => 'other-node/bob',
        ], 1);

        self::assertSame('my-node/alice', $result['payer']);
        self::assertSame('other-node/bob', $result['payee']);
    }

    public function test_a_member_of_another_tenant_is_not_claimed_as_ours(): void
    {
        // Naming a remote account with OUR node slug would assert we hold it.
        // Better to emit the bare identifier than to misroute credit.
        $sender = $this->memberWithUsername('carol_cc');
        $nodeSlug = $this->nodeSlug();

        $result = $this->adapter->transformOutboundTransaction([
            'amount' => 1.0,
            'sender_user_id' => $sender->id,
            'sender_tenant_id' => $this->testTenantId + 9_999,
        ], 1);

        self::assertStringNotContainsString($nodeSlug, $result['payer']);
    }

    public function test_ledger_entries_agree_with_the_transaction(): void
    {
        $sender = $this->memberWithUsername('dave_cc');
        $receiver = $this->memberWithUsername('erin_cc');

        $payload = [
            'amount' => 3.0,
            'status' => 'pending',
            'sender_user_id' => $sender->id,
            'receiver_user_id' => $receiver->id,
            'sender_tenant_id' => $this->testTenantId,
            'receiver_tenant_id' => $this->testTenantId,
        ];

        $transaction = $this->adapter->transformOutboundTransaction($payload, 1);
        $entries = CreditCommonsAdapter::generateEntries($payload);

        self::assertSame($transaction['payer'], $entries[0]['payer']);
        self::assertSame($transaction['payee'], $entries[0]['payee']);
    }

    private function nodeSlug(): string
    {
        return (string) CreditCommonsNodeService::getNodeConfig($this->testTenantId)->node_slug;
    }

    private function memberWithUsername(?string $username): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();

        DB::table('users')->where('id', $user->id)->update(['username' => $username]);

        return $user;
    }
}
