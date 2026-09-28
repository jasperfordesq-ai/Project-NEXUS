<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Federation;

use App\Core\TenantContext;
use App\Http\Controllers\Api\FederationCreditCommonsController;
use App\Http\Controllers\Api\FederationDebitApprovalController;
use App\Models\User;
use App\Services\FederationDebitApprovalService;
use App\Services\Protocols\CreditCommonsAdapter;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Regression tests for Credit Commons ledger replay/concurrency safety.
 *
 * Bug history (2026-06-12 hunt): commitTransaction and the C→E erase path
 * read the entry without a lock and updated state keyed on id only — two
 * concurrent deliveries of the same UUID both passed the state gate and both
 * applied/reversed balances (double credit / double reverse). The fix claims
 * the state transition atomically (UPDATE ... WHERE state = <expected>)
 * BEFORE touching balances, so a losing racer affects 0 rows and returns the
 * standard InvalidStateTransition response. proposeTransaction also ignored
 * the caller-supplied UUID, so replays accumulated duplicate committable
 * PENDING proposals; it now answers idempotently. These tests pin the
 * observable contract: balances move exactly once and replays get the
 * idempotent/invalid-transition response, never a re-application.
 */
class CreditCommonsReplaySafetyTest extends TestCase
{
    use DatabaseTransactions;

    private int $tenantId;
    private object $payer;
    private object $payee;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenantId = (int) DB::table('tenants')->where('is_active', 1)->orderBy('id')->value('id');
        if (!$this->tenantId) {
            $this->markTestSkipped('Test DB lacks an active tenant');
        }
        TenantContext::setById($this->tenantId);

        $users = DB::table('users')
            ->where('tenant_id', $this->tenantId)
            ->where('status', 'active')
            ->whereNotNull('username')
            ->where('username', '!=', '')
            ->orderBy('id')
            ->limit(2)
            ->get(['id', 'username']);
        if ($users->count() < 2) {
            $this->markTestSkipped('Test DB lacks two active users with usernames');
        }
        [$this->payer, $this->payee] = [$users[0], $users[1]];

        DB::table('users')->whereIn('id', [$this->payer->id, $this->payee->id])->update([
            'federation_optin' => 1,
            'balance' => 100.00,
        ]);

        foreach ([$this->payer->id, $this->payee->id] as $userId) {
            DB::table('federation_user_settings')->updateOrInsert(
                ['user_id' => $userId],
                [
                    'federation_optin' => 1,
                    'profile_visible_federated' => 1,
                    'messaging_enabled_federated' => 1,
                    'transactions_enabled_federated' => 1,
                    'appear_in_federated_search' => 1,
                    'show_skills_federated' => 1,
                    'show_location_federated' => 0,
                    'service_reach' => 'local_only',
                    'opted_in_at' => now(),
                    'updated_at' => now(),
                    'created_at' => now(),
                ]
            );
        }
    }

    protected function tearDown(): void
    {
        TenantContext::reset();
        parent::tearDown();
    }

    private function insertEntry(string $uuid, string $state): void
    {
        DB::table('federation_cc_entries')->insert([
            'tenant_id' => $this->tenantId,
            'transaction_uuid' => $uuid,
            'payer' => $this->payer->username,
            'payee' => $this->payee->username,
            'quant' => 5.00,
            'description' => 'replay-safety test',
            'state' => $state,
            'workflow' => '+|PPC-PE+CE-',
            'metadata' => json_encode([
                'local_payer_id' => (int) $this->payer->id,
                'local_payee_id' => (int) $this->payee->id,
                'local_settlement' => $state === CreditCommonsAdapter::STATE_COMPLETED,
            ]),
            'author' => $this->payer->username,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function approveEntry(string $uuid, float $amount = 5.00, string $description = 'replay-safety test'): void
    {
        $entryId = (int) DB::table('federation_cc_entries')->where('tenant_id', $this->tenantId)
            ->where('transaction_uuid', $uuid)->value('id');
        if (!DB::table('federation_debit_approvals')->where('tenant_id', $this->tenantId)
            ->where('protocol', 'credit_commons')->where('reference_id', (string) $entryId)->exists()) {
            app(FederationDebitApprovalService::class)->request(
                $this->tenantId, 'credit_commons', (string) $entryId, (int) $this->payer->id,
                (int) $this->payee->id, $this->payee->username, $amount, $description
            );
        }
        $approvalId = (int) DB::table('federation_debit_approvals')->where('reference_id', (string) $entryId)->value('id');
        $wrongMemberRequest = $this->jsonRequest(['decision' => 'approve']);
        $wrongMemberRequest->setUserResolver(fn () => User::find($this->payee->id));
        $wrongMemberResponse = app(FederationDebitApprovalController::class)->decide($wrongMemberRequest, $approvalId);
        $this->assertSame(404, $wrongMemberResponse->getStatusCode());
        $request = $this->jsonRequest(['decision' => 'approve']);
        $request->setUserResolver(fn () => User::find($this->payer->id));
        $response = app(FederationDebitApprovalController::class)->decide($request, $approvalId);
        $this->assertSame(200, $response->getStatusCode(), $response->getContent());
    }

    private function balances(): array
    {
        return [
            (float) DB::table('users')->where('id', $this->payer->id)->value('balance'),
            (float) DB::table('users')->where('id', $this->payee->id)->value('balance'),
        ];
    }

    private function replaySafetyLedgerRows(): int
    {
        return DB::table('transactions')
            ->where('tenant_id', $this->tenantId)
            ->where('sender_id', $this->payer->id)
            ->where('receiver_id', $this->payee->id)
            ->where('description', 'replay-safety test')
            ->where('is_federated', 1)
            ->count();
    }

    public function test_commit_applies_balances_once_and_replay_does_not_reapply(): void
    {
        $uuid = (string) \Illuminate\Support\Str::uuid();
        $this->insertEntry($uuid, CreditCommonsAdapter::STATE_VALIDATED);

        $controller = new FederationCreditCommonsController();

        $refused = $controller->commitTransaction(Request::create('/', 'POST'), $uuid);
        $this->assertSame(403, $refused->getStatusCode());
        $this->assertSame([100.0, 100.0], $this->balances());
        $this->assertSame(0, $this->replaySafetyLedgerRows());
        $this->approveEntry($uuid);

        $first = $controller->commitTransaction(Request::create('/', 'POST'), $uuid);
        $this->assertSame(200, $first->getStatusCode(), $first->getContent());
        $this->assertSame([95.0, 105.0], $this->balances(), 'Commit must move the amount exactly once');
        $this->assertSame(1, $this->replaySafetyLedgerRows(), 'Commit must write exactly one federated ledger row');

        // Replay (redelivery): must NOT re-apply balances.
        $second = $controller->commitTransaction(Request::create('/', 'POST'), $uuid);
        $this->assertSame(400, $second->getStatusCode(), 'Replayed commit must be rejected');
        $this->assertSame([95.0, 105.0], $this->balances(), 'Replayed commit must not double-apply balances');
        $this->assertSame(1, $this->replaySafetyLedgerRows(), 'Replayed commit must not duplicate the ledger row');
    }

    public function test_patch_to_completed_applies_balances_and_ledger_once(): void
    {
        $uuid = (string) \Illuminate\Support\Str::uuid();
        $this->insertEntry($uuid, CreditCommonsAdapter::STATE_PENDING);

        $controller = new FederationCreditCommonsController();

        $refused = $controller->transitionTransaction(Request::create('/', 'PATCH'), $uuid, 'C');
        $this->assertSame(403, $refused->getStatusCode());
        $this->assertSame([100.0, 100.0], $this->balances());
        $this->approveEntry($uuid);

        $first = $controller->transitionTransaction(Request::create('/', 'PATCH'), $uuid, 'C');
        $this->assertSame(201, $first->getStatusCode(), $first->getContent());
        $this->assertSame([95.0, 105.0], $this->balances(), 'PATCH-to-C must move the amount exactly once');
        $this->assertSame(1, $this->replaySafetyLedgerRows(), 'PATCH-to-C must write exactly one federated ledger row');

        $second = $controller->transitionTransaction(Request::create('/', 'PATCH'), $uuid, 'C');
        $this->assertSame(400, $second->getStatusCode(), 'Replayed PATCH-to-C must be rejected');
        $this->assertSame([95.0, 105.0], $this->balances(), 'Replayed PATCH-to-C must not double-apply balances');
        $this->assertSame(1, $this->replaySafetyLedgerRows(), 'Replayed PATCH-to-C must not duplicate the ledger row');
    }

    public function test_erase_reverses_balances_once_and_replay_does_not_rereverse(): void
    {
        $uuid = (string) \Illuminate\Support\Str::uuid();
        $this->insertEntry($uuid, CreditCommonsAdapter::STATE_COMPLETED);

        $controller = new FederationCreditCommonsController();

        $unapproved = $controller->transitionTransaction(Request::create('/', 'PATCH'), $uuid, 'E');
        $this->assertSame(403, $unapproved->getStatusCode());
        $this->assertSame([100.0, 100.0], $this->balances());
        $entryId = (int) DB::table('federation_cc_entries')->where('tenant_id', $this->tenantId)
            ->where('transaction_uuid', $uuid)->value('id');
        $approvalId = (int) DB::table('federation_debit_approvals')->where('tenant_id', $this->tenantId)
            ->where('protocol', 'credit_commons_reversal')->where('reference_id', (string) $entryId)->value('id');
        $approvalRequest = $this->jsonRequest(['decision' => 'approve']);
        $approvalRequest->setUserResolver(fn () => User::find($this->payee->id));
        $this->assertSame(200, app(FederationDebitApprovalController::class)
            ->decide($approvalRequest, $approvalId)->getStatusCode());

        $first = $controller->transitionTransaction(Request::create('/', 'PATCH'), $uuid, 'E');
        $this->assertSame(201, $first->getStatusCode(), $first->getContent());
        $this->assertSame([105.0, 95.0], $this->balances(), 'Erase must reverse the amount exactly once');

        $second = $controller->transitionTransaction(Request::create('/', 'PATCH'), $uuid, 'E');
        $this->assertSame(400, $second->getStatusCode(), 'Replayed erase must be rejected');
        $this->assertSame([105.0, 95.0], $this->balances(), 'Replayed erase must not double-reverse balances');
    }

    public function test_approved_erase_cannot_overdraw_original_payee(): void
    {
        $uuid = (string) \Illuminate\Support\Str::uuid();
        $this->insertEntry($uuid, CreditCommonsAdapter::STATE_COMPLETED);
        $controller = new FederationCreditCommonsController();
        $controller->transitionTransaction(Request::create('/', 'PATCH'), $uuid, 'E');
        $entryId = (int) DB::table('federation_cc_entries')->where('transaction_uuid', $uuid)
            ->where('tenant_id', $this->tenantId)->value('id');
        DB::table('federation_debit_approvals')->where('tenant_id', $this->tenantId)
            ->where('protocol', 'credit_commons_reversal')->where('reference_id', (string) $entryId)
            ->update(['status' => 'approved']);
        DB::table('users')->where('id', $this->payee->id)->update(['balance' => 1]);

        $response = $controller->transitionTransaction(Request::create('/', 'PATCH'), $uuid, 'E');
        $this->assertSame(400, $response->getStatusCode());
        $this->assertSame([100.0, 1.0], $this->balances());
        $this->assertSame('C', DB::table('federation_cc_entries')->where('id', $entryId)->value('state'));
        $this->assertSame('approved', DB::table('federation_debit_approvals')
            ->where('protocol', 'credit_commons_reversal')->where('reference_id', (string) $entryId)->value('status'));
    }

    public function test_inactive_payee_cannot_be_bypassed_on_erase(): void
    {
        $uuid = (string) \Illuminate\Support\Str::uuid();
        $this->insertEntry($uuid, CreditCommonsAdapter::STATE_COMPLETED);
        DB::table('users')->where('id', $this->payee->id)->update(['status' => 'inactive']);

        $response = (new FederationCreditCommonsController())->transitionTransaction(Request::create('/', 'PATCH'), $uuid, 'E');
        $this->assertSame(403, $response->getStatusCode());
        $this->assertSame([100.0, 100.0], $this->balances());
        $this->assertSame('C', DB::table('federation_cc_entries')->where('transaction_uuid', $uuid)->value('state'));
    }

    public function test_renamed_payee_still_controls_reversal_approval(): void
    {
        $uuid = (string) \Illuminate\Support\Str::uuid();
        $this->insertEntry($uuid, CreditCommonsAdapter::STATE_COMPLETED);
        DB::table('users')->where('id', $this->payee->id)->update(['username' => 'renamed-' . substr($uuid, 0, 8)]);
        $controller = new FederationCreditCommonsController();
        $this->assertSame(403, $controller->transitionTransaction(Request::create('/', 'PATCH'), $uuid, 'E')->getStatusCode());
        $approvalId = (int) DB::table('federation_debit_approvals')->where('tenant_id', $this->tenantId)
            ->where('protocol', 'credit_commons_reversal')->orderByDesc('id')->value('id');
        $request = $this->jsonRequest(['decision' => 'approve']);
        $request->setUserResolver(fn () => User::find($this->payee->id));
        $this->assertSame(200, app(FederationDebitApprovalController::class)->decide($request, $approvalId)->getStatusCode());
        $this->assertSame(201, $controller->transitionTransaction(Request::create('/', 'PATCH'), $uuid, 'E')->getStatusCode());
        $this->assertSame([105.0, 95.0], $this->balances());
    }

    public function test_completed_entry_without_settlement_provenance_cannot_reverse_balances(): void
    {
        $uuid = (string) \Illuminate\Support\Str::uuid();
        $this->insertEntry($uuid, CreditCommonsAdapter::STATE_COMPLETED);
        DB::table('federation_cc_entries')->where('transaction_uuid', $uuid)->update(['metadata' => null]);

        $response = (new FederationCreditCommonsController())->transitionTransaction(Request::create('/', 'PATCH'), $uuid, 'E');
        $this->assertSame(403, $response->getStatusCode());
        $this->assertSame([100.0, 100.0], $this->balances());
    }

    public function test_relay_rejects_a_local_payer_without_forwarding_or_crediting(): void
    {
        $controller = new FederationCreditCommonsController();
        $response = $controller->relayTransaction($this->jsonRequest([
            'payer' => $this->payer->username,
            'payee' => $this->payee->username,
            'quant' => 5,
        ]));
        $this->assertSame(403, $response->getStatusCode());
        $this->assertSame([100.0, 100.0], $this->balances());
    }

    public function test_propose_honours_caller_uuid_and_replays_idempotently(): void
    {
        $uuid = (string) \Illuminate\Support\Str::uuid();
        $payload = [
            'uuid' => $uuid,
            'payer' => $this->payer->username,
            'payee' => $this->payee->username,
            'quant' => 2.5,
            'description' => 'propose replay test',
        ];

        $controller = new FederationCreditCommonsController();

        $first = $controller->proposeTransaction($this->jsonRequest($payload));
        $this->assertSame(201, $first->getStatusCode(), $first->getContent());

        $second = $controller->proposeTransaction($this->jsonRequest($payload));
        $this->assertSame(200, $second->getStatusCode(), 'Replayed propose must answer idempotently');
        $this->assertTrue(
            (bool) (json_decode((string) $second->getContent(), true)['meta']['idempotent_replay'] ?? false)
        );

        $rows = DB::table('federation_cc_entries')
            ->where('tenant_id', $this->tenantId)
            ->where('transaction_uuid', $uuid)
            ->count();
        $this->assertSame(1, $rows, 'Replayed propose must not create duplicate PENDING proposals');
        $entryId = (int) DB::table('federation_cc_entries')->where('tenant_id', $this->tenantId)
            ->where('transaction_uuid', $uuid)->value('id');
        $this->assertDatabaseHas('federation_debit_approvals', [
            'tenant_id' => $this->tenantId,
            'protocol' => 'credit_commons',
            'reference_id' => (string) $entryId,
            'payer_user_id' => $this->payer->id,
            'status' => 'pending',
        ]);

        $blocked = $controller->transitionTransaction(Request::create('/', 'PATCH'), $uuid, 'C');
        $this->assertSame(403, $blocked->getStatusCode());
        $this->approveEntry($uuid, 2.5, 'propose replay test');
        $settled = $controller->transitionTransaction(Request::create('/', 'PATCH'), $uuid, 'C');
        $this->assertSame(201, $settled->getStatusCode(), $settled->getContent());
        $this->assertSame([97.5, 102.5], $this->balances());
    }

    public function test_direct_create_cannot_complete_from_partner_workflow_alone(): void
    {
        $uuid = (string) \Illuminate\Support\Str::uuid();
        $controller = new FederationCreditCommonsController();
        $created = $controller->createTransaction($this->jsonRequest([
            'uuid' => $uuid,
            'payer' => $this->payer->username,
            'payee' => $this->payee->username,
            'quant' => 5,
            'description' => 'replay-safety test',
            'workflow' => '0|PC-CE=',
        ]));

        $this->assertSame(201, $created->getStatusCode(), $created->getContent());
        $this->assertSame('P', json_decode($created->getContent(), true)['data']['state']);
        $this->assertSame([100.0, 100.0], $this->balances());
        $this->approveEntry($uuid);
        $settled = $controller->transitionTransaction(Request::create('/', 'PATCH'), $uuid, 'C');
        $this->assertSame(201, $settled->getStatusCode(), $settled->getContent());
        $this->assertSame([95.0, 105.0], $this->balances());
    }

    public function test_member_routes_scope_approval_to_the_payer(): void
    {
        $uuid = (string) \Illuminate\Support\Str::uuid();
        $controller = new FederationCreditCommonsController();
        $controller->proposeTransaction($this->jsonRequest([
            'uuid' => $uuid,
            'payer' => $this->payer->username,
            'payee' => $this->payee->username,
            'quant' => 3,
            'description' => 'member approval route',
        ]));
        $approvalId = (int) DB::table('federation_debit_approvals')->where('tenant_id', $this->tenantId)
            ->where('protocol', 'credit_commons')->orderByDesc('id')->value('id');
        $headers = ['X-Tenant-ID' => (string) $this->tenantId];

        $this->actingAs(User::find($this->payee->id));
        $this->getJson('/api/v2/federation/debit-approvals', $headers)
            ->assertOk()->assertJsonCount(0, 'data.approvals');
        $this->postJson("/api/v2/federation/debit-approvals/{$approvalId}/decision", [
            'decision' => 'approve',
        ], $headers)->assertNotFound();
        $this->assertSame('pending', DB::table('federation_debit_approvals')->where('id', $approvalId)->value('status'));

        $this->actingAs(User::find($this->payer->id));
        $this->getJson('/api/v2/federation/debit-approvals', $headers)
            ->assertOk()->assertJsonCount(1, 'data.approvals');
        $this->postJson("/api/v2/federation/debit-approvals/{$approvalId}/decision", [
            'decision' => 'approve',
        ], $headers)->assertOk();
        $this->assertSame('approved', DB::table('federation_debit_approvals')->where('id', $approvalId)->value('status'));
    }

    public function test_expired_or_changed_approval_cannot_settle(): void
    {
        $uuid = (string) \Illuminate\Support\Str::uuid();
        $this->insertEntry($uuid, CreditCommonsAdapter::STATE_PENDING);
        $this->approveEntry($uuid);
        $entryId = (int) DB::table('federation_cc_entries')->where('transaction_uuid', $uuid)
            ->where('tenant_id', $this->tenantId)->value('id');
        $controller = new FederationCreditCommonsController();

        DB::table('federation_debit_approvals')->where('tenant_id', $this->tenantId)
            ->where('protocol', 'credit_commons')->where('reference_id', (string) $entryId)
            ->update(['expires_at' => now()->subMinute()]);
        $this->assertSame(403, $controller->transitionTransaction(Request::create('/', 'PATCH'), $uuid, 'C')->getStatusCode());

        DB::table('federation_debit_approvals')->where('tenant_id', $this->tenantId)
            ->where('protocol', 'credit_commons')->where('reference_id', (string) $entryId)
            ->update(['expires_at' => now()->addHour()]);
        DB::table('federation_cc_entries')->where('id', $entryId)->update(['quant' => 6]);
        $this->assertSame(403, $controller->transitionTransaction(Request::create('/', 'PATCH'), $uuid, 'C')->getStatusCode());
        $this->assertSame([100.0, 100.0], $this->balances());
        $this->assertSame('P', DB::table('federation_cc_entries')->where('id', $entryId)->value('state'));
    }

    public function test_remote_node_prefix_cannot_resolve_to_a_same_named_local_payer(): void
    {
        $uuid = (string) \Illuminate\Support\Str::uuid();
        $controller = new FederationCreditCommonsController();
        $created = $controller->proposeTransaction($this->jsonRequest([
            'uuid' => $uuid,
            'payer' => 'remote-node/' . $this->payer->username,
            'payee' => $this->payee->username,
            'quant' => 5,
            'description' => 'remote account collision',
        ]));
        $this->assertSame(201, $created->getStatusCode(), $created->getContent());
        $entryId = (int) DB::table('federation_cc_entries')->where('tenant_id', $this->tenantId)
            ->where('transaction_uuid', $uuid)->value('id');
        $this->assertDatabaseMissing('federation_debit_approvals', [
            'tenant_id' => $this->tenantId,
            'protocol' => 'credit_commons',
            'reference_id' => (string) $entryId,
        ]);
        $response = $controller->transitionTransaction(Request::create('/', 'PATCH'), $uuid, 'C');
        $this->assertSame(403, $response->getStatusCode());
        $this->assertSame([100.0, 100.0], $this->balances());
    }

    private function jsonRequest(array $payload): Request
    {
        return Request::create('/', 'POST', [], [], [], ['CONTENT_TYPE' => 'application/json'], json_encode($payload));
    }
}
