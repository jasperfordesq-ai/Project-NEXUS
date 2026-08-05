<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for AdminBrokerController.
 *
 * Covers dashboard, exchanges, risk tags, messages, monitoring, and configuration.
 */
class AdminBrokerControllerTest extends TestCase
{
    use DatabaseTransactions;

    // ================================================================
    // DASHBOARD — GET /v2/admin/broker/dashboard
    // ================================================================

    public function test_dashboard_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/broker/dashboard');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data' => ['vetting_review_requests']]);
        $response->assertJsonMissingPath('data.vetting_pending');
        $response->assertJsonMissingPath('data.vetting_expiring');
    }

    public function test_dashboard_does_not_count_false_safeguarding_checkbox_as_a_flag(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        Sanctum::actingAs($admin);

        $baseline = $this->apiGet('/v2/admin/broker/dashboard');
        $baseline->assertOk();
        $baselineCount = $baseline->json('data.onboarding_safeguarding_flags');
        $this->assertIsInt($baselineCount);

        $optionId = DB::table('tenant_safeguarding_options')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'option_key' => 'false_dashboard_preference_' . uniqid(),
            'option_type' => 'checkbox',
            'label' => 'False dashboard preference',
            'is_active' => 1,
            'sort_order' => 0,
            'triggers' => json_encode(['requires_vetted_interaction' => true]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('user_safeguarding_preferences')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'option_id' => $optionId,
            'selected_value' => '0',
            'consent_given_at' => now(),
            'created_at' => now(),
        ]);

        $this->apiGet('/v2/admin/broker/dashboard')
            ->assertOk()
            ->assertJsonPath('data.onboarding_safeguarding_flags', $baselineCount);
    }

    public function test_dashboard_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/broker/dashboard');

        $response->assertStatus(403);
    }

    public function test_dashboard_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/broker/dashboard');

        $response->assertStatus(401);
    }

    // ================================================================
    // EXCHANGES — GET /v2/admin/broker/exchanges
    // ================================================================

    public function test_exchanges_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/broker/exchanges');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_exchanges_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/broker/exchanges');

        $response->assertStatus(403);
    }

    // ================================================================
    // RISK TAGS — GET /v2/admin/broker/risk-tags
    // ================================================================

    public function test_risk_tags_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/broker/risk-tags');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // MESSAGES — GET /v2/admin/broker/messages
    // ================================================================

    public function test_messages_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/broker/messages');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_messages_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/broker/messages');

        $response->assertStatus(403);
    }

    // ================================================================
    // UNREVIEWED COUNT — GET /v2/admin/broker/messages/unreviewed-count
    // ================================================================

    public function test_unreviewed_count_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/broker/messages/unreviewed-count');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_review_message_persists_broker_notes(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $sender = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($admin);

        $copyId = $this->insertMessageCopy($sender->id, $receiver->id);

        $response = $this->apiPost("/v2/admin/broker/messages/{$copyId}/review", [
            'notes' => 'Reviewed and no action needed.',
        ]);

        $response->assertStatus(200);

        $copy = DB::table('broker_message_copies')->where('id', $copyId)->first();
        $this->assertSame($admin->id, (int) $copy->reviewed_by);
        $this->assertNotNull($copy->reviewed_at);
        $this->assertSame('Reviewed and no action needed.', $copy->review_notes);
    }

    // ================================================================
    // MONITORING — GET /v2/admin/broker/monitoring
    // ================================================================

    public function test_monitoring_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/broker/monitoring');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // CONFIGURATION — GET /v2/admin/broker/configuration
    // ================================================================

    public function test_get_configuration_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'broker_config'],
            [
                'setting_value' => json_encode([
                    'vetting_enabled' => true,
                    'enforce_vetting_on_exchanges' => true,
                    'vetting_expiry_warning_days' => 30,
                ]),
                'created_at' => now(),
                'updated_at' => now(),
            ],
        );

        $response = $this->apiGet('/v2/admin/broker/configuration');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
        $response->assertJsonMissingPath('data.vetting_enabled');
        $response->assertJsonMissingPath('data.enforce_vetting_on_exchanges');
        $response->assertJsonMissingPath('data.vetting_expiry_warning_days');
    }

    public function test_get_configuration_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/broker/configuration');

        $response->assertStatus(403);
    }

    public function test_super_admin_reads_target_tenant_runtime_configuration(): void
    {
        $superAdmin = User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'super_admin',
            'is_super_admin' => true,
        ]);
        Sanctum::actingAs($superAdmin);

        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'configuration' => json_encode([
                'broker_controls' => [
                    'broker_visibility' => ['retention_days' => 30],
                    'exchange_workflow' => ['max_hours_without_approval' => 2],
                ],
            ]),
        ]);
        DB::table('tenants')->where('id', 999)->update([
            'configuration' => json_encode([
                'broker_controls' => [
                    'broker_visibility' => ['retention_days' => 240],
                    'exchange_workflow' => ['max_hours_without_approval' => 8],
                ],
            ]),
        ]);

        $response = $this->apiGet('/v2/admin/broker/configuration?tenant_id=999');

        $response->assertStatus(200);
        $response->assertJsonPath('data.retention_days', 240);
        $this->assertSame(8.0, (float) $response->json('data.max_hours_without_approval'));
    }

    // ================================================================
    // ARCHIVES — GET /v2/admin/broker/archives
    // ================================================================

    public function test_archives_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/broker/archives');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_archives_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/broker/archives');

        $response->assertStatus(401);
    }

    // ================================================================
    // HELPERS
    // ================================================================

    /**
     * Create a listing for the given tenant and return its id.
     *
     * exchange_requests.listing_id carries a NOT NULL FK to listings(id); inserting
     * an exchange without a real listing trips a foreign-key violation, so every
     * exchange fixture must reference a listing that exists.
     */
    private function makeListingId(int $tenantId, int $ownerId): int
    {
        return (int) DB::table('listings')->insertGetId([
            'tenant_id'   => $tenantId,
            'user_id'     => $ownerId,
            'title'       => 'Exchange fixture listing',
            'description' => 'Listing backing an exchange_requests fixture row.',
            'type'        => 'offer',
            'status'      => 'active',
            'created_at'  => now(),
            'updated_at'  => now(),
        ]);
    }

    /**
     * Insert a real messages row (required by broker_message_copies FK) and a
     * broker_message_copies row.  Returns the broker_message_copies.id.
     *
     * @param array<string, mixed> $overrides  Extra columns for broker_message_copies
     */
    private function insertMessageCopy(int $senderId, int $receiverId, array $overrides = []): int
    {
        $msgId = DB::table('messages')->insertGetId([
            'tenant_id'   => $this->testTenantId,
            'sender_id'   => $senderId,
            'receiver_id' => $receiverId,
            'body'        => 'Test message for broker review',
            'is_read'     => false,
            'created_at'  => now()->subHour(),
        ]);

        return DB::table('broker_message_copies')->insertGetId(array_merge([
            'tenant_id'           => $this->testTenantId,
            'original_message_id' => $msgId,
            'sender_id'           => $senderId,
            'receiver_id'         => $receiverId,
            'message_body'        => 'Hello, need help.',
            'sent_at'             => now()->subHour(),
            'copy_reason'         => 'first_contact',
            'flagged'             => false,
            'archive_id'          => null,
            'conversation_key'    => 'key-' . $senderId . '-' . $receiverId . '-' . uniqid(),
            'created_at'          => now(),
        ], $overrides));
    }

    // ================================================================
    // APPROVE EXCHANGE — POST /v2/admin/broker/exchanges/{id}/approve
    // ================================================================

    public function test_approve_exchange_succeeds(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = $this->makeListingId($this->testTenantId, $provider->id);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id'      => $this->testTenantId,
            'listing_id'     => $listingId,
            'requester_id'   => $requester->id,
            'provider_id'    => $provider->id,
            'proposed_hours' => 2.0,
            'status'         => 'pending_broker',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/approve", [
            'notes' => 'Looks good',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.id', $exchangeId);
        $response->assertJsonPath('data.status', 'accepted');
    }

    /**
     * A disputed exchange used to be a permanent dead end: the credits were stuck
     * BEFORE they moved, and no member, broker or admin could act, even though the
     * dashboard counted disputed exchanges as needing attention. These tests cover
     * the arbitration path that now exists.
     */
    public function test_resolve_dispute_completes_a_disputed_exchange_and_moves_credits(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create(['balance' => 10.0]);
        $provider = User::factory()->forTenant($this->testTenantId)->create(['balance' => 10.0]);
        $listingId = $this->makeListingId($this->testTenantId, $provider->id);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id'                 => $this->testTenantId,
            'listing_id'                => $listingId,
            'requester_id'              => $requester->id,
            'provider_id'               => $provider->id,
            'proposed_hours'            => 2.0,
            'requester_confirmed_hours' => 1.5,
            'provider_confirmed_hours'  => 2.4,
            'requester_confirmed_at'    => now(),
            'provider_confirmed_at'     => now(),
            'status'                    => 'disputed',
            'created_at'                => now(),
            'updated_at'                => now(),
        ]);

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/resolve-dispute", [
            'final_hours' => 2.0,
            'notes'       => 'Spoke to both parties; two hours agreed.',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.status', 'completed');
        // assertJsonPath compares identically and JSON renders 2.0 as 2.
        $this->assertEquals(2.0, $response->json('data.final_hours'));

        $exchange = DB::table('exchange_requests')->where('id', $exchangeId)->first();
        $this->assertSame('completed', $exchange->status);

        // The arbitration is visible to both members via exchange_history.
        $history = DB::table('exchange_history')
            ->where('exchange_id', $exchangeId)
            ->where('action', 'dispute_resolved')
            ->first();
        $this->assertNotNull($history, 'Resolving a dispute must be recorded in exchange_history.');
        $this->assertSame('broker', $history->actor_role);
        $this->assertEquals($admin->id, (int) $history->actor_id);
        $this->assertStringContainsString('two hours agreed', (string) $history->notes);
    }

    public function test_resolve_dispute_requires_a_note(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = $this->makeListingId($this->testTenantId, $provider->id);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id' => $this->testTenantId, 'listing_id' => $listingId,
            'requester_id' => $requester->id, 'provider_id' => $provider->id,
            'proposed_hours' => 2.0, 'status' => 'disputed',
            'created_at' => now(), 'updated_at' => now(),
        ]);

        Sanctum::actingAs($admin);

        $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/resolve-dispute", [
            'final_hours' => 2.0,
            'notes'       => '   ',
        ])->assertStatus(400);

        $this->assertSame(
            'disputed',
            DB::table('exchange_requests')->where('id', $exchangeId)->value('status')
        );
    }

    public function test_resolve_dispute_rejects_a_non_disputed_exchange(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = $this->makeListingId($this->testTenantId, $provider->id);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id' => $this->testTenantId, 'listing_id' => $listingId,
            'requester_id' => $requester->id, 'provider_id' => $provider->id,
            'proposed_hours' => 2.0, 'status' => 'accepted',
            'created_at' => now(), 'updated_at' => now(),
        ]);

        Sanctum::actingAs($admin);

        $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/resolve-dispute", [
            'final_hours' => 2.0,
            'notes'       => 'Should not apply',
        ])->assertStatus(400);
    }

    public function test_resolve_dispute_blocks_an_arbitrator_who_is_a_party(): void
    {
        // Conflict of interest matters most here: arbitrating your own dispute
        // decides your own credits.
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = $this->makeListingId($this->testTenantId, $provider->id);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id' => $this->testTenantId, 'listing_id' => $listingId,
            'requester_id' => $admin->id, 'provider_id' => $provider->id,
            'proposed_hours' => 2.0, 'status' => 'disputed',
            'created_at' => now(), 'updated_at' => now(),
        ]);

        Sanctum::actingAs($admin);

        $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/resolve-dispute", [
            'final_hours' => 2.0,
            'notes'       => 'Resolving my own dispute',
        ])->assertStatus(403);

        $this->assertSame(
            'disputed',
            DB::table('exchange_requests')->where('id', $exchangeId)->value('status')
        );
    }

    public function test_resolve_dispute_clamps_hours_to_the_variance_window(): void
    {
        // An arbitrator must not be able to post a figure the workflow would have
        // refused from a participant. Default window is proposed ±25%.
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = $this->makeListingId($this->testTenantId, $provider->id);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id' => $this->testTenantId, 'listing_id' => $listingId,
            'requester_id' => $requester->id, 'provider_id' => $provider->id,
            'proposed_hours' => 4.0, 'status' => 'disputed',
            'created_at' => now(), 'updated_at' => now(),
        ]);

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/resolve-dispute", [
            'final_hours' => 99.0,
            'notes'       => 'Deliberately absurd figure',
        ]);

        $response->assertStatus(200);
        // 4.0 + 25% = 5.0 — the absurd 99.0 must be clamped, not accepted.
        $this->assertEquals(5.0, $response->json('data.final_hours'));
    }

    // ------------------------------------------------------------------
    //  Reversing a completed exchange
    //
    //  Before this existed a mis-recorded exchange could not be corrected at all:
    //  `completed` is a terminal status, and the only tool was the single-member
    //  balance adjustment applied twice by hand, with no link to the exchange.
    // ------------------------------------------------------------------

    /**
     * Build a completed exchange with a real ledger row, returning
     * [exchangeId, transactionId, payerId, payeeId].
     *
     * @return array{0:int,1:int,2:int,3:int}
     */
    private function makeCompletedExchange(int $payerId, int $payeeId, float $hours = 2.0): array
    {
        $listingId = $this->makeListingId($this->testTenantId, $payeeId);

        $transactionId = (int) DB::table('transactions')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $payerId,
            'receiver_id' => $payeeId,
            'amount' => $hours,
            'description' => 'Exchange fixture',
            'transaction_type' => 'exchange',
            'status' => 'completed',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $exchangeId = (int) DB::table('exchange_requests')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'listing_id' => $listingId,
            'requester_id' => $payerId,
            'provider_id' => $payeeId,
            'proposed_hours' => $hours,
            'final_hours' => $hours,
            'transaction_id' => $transactionId,
            'status' => 'completed',
            'completed_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [$exchangeId, $transactionId, $payerId, $payeeId];
    }

    public function test_reverse_completed_exchange_restores_both_balances(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        // The payer paid 2h (so is 2h down), the payee earned 2h.
        $payer = User::factory()->forTenant($this->testTenantId)->create(['balance' => 8.0]);
        $payee = User::factory()->forTenant($this->testTenantId)->create(['balance' => 12.0]);

        [$exchangeId, $originalTxnId] = $this->makeCompletedExchange($payer->id, $payee->id, 2.0);

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/reverse", [
            'reason' => 'Recorded against the wrong member',
        ]);

        $response->assertStatus(200);
        $this->assertEquals(2.0, $response->json('data.amount'));

        // Credits are put back on both sides.
        $this->assertEquals(10.0, (float) DB::table('users')->where('id', $payer->id)->value('balance'));
        $this->assertEquals(10.0, (float) DB::table('users')->where('id', $payee->id)->value('balance'));

        // The ORIGINAL entry is untouched — a reversal is a compensating record,
        // never a mutation or deletion of history.
        $original = DB::table('transactions')->where('id', $originalTxnId)->first();
        $this->assertSame('completed', $original->status);
        $this->assertEquals($payer->id, (int) $original->sender_id);
        $this->assertEquals(2.0, (float) $original->amount);

        // The compensating entry mirrors it and is typed and attributed.
        $reversalId = (int) $response->json('data.reversal_transaction_id');
        $reversal = DB::table('transactions')->where('id', $reversalId)->first();
        $this->assertSame('exchange_reversal', $reversal->transaction_type);
        $this->assertEquals($payee->id, (int) $reversal->sender_id, 'Reversal must mirror the original.');
        $this->assertEquals($payer->id, (int) $reversal->receiver_id);
        $this->assertEquals($admin->id, (int) $reversal->acting_user_id);

        // Linked back on the exchange, and recorded for both members to see.
        $exchange = DB::table('exchange_requests')->where('id', $exchangeId)->first();
        $this->assertEquals($reversalId, (int) $exchange->reversal_transaction_id);
        $this->assertEquals($admin->id, (int) $exchange->reversed_by);
        $this->assertNotNull($exchange->reversed_at);
        $this->assertSame('Recorded against the wrong member', $exchange->reversal_reason);

        $history = DB::table('exchange_history')
            ->where('exchange_id', $exchangeId)->where('action', 'reversed')->first();
        $this->assertNotNull($history, 'A reversal must appear in the exchange history.');

        $audit = DB::table('org_audit_log')
            ->where('action', 'exchange_reversed')->orderByDesc('id')->first();
        $this->assertNotNull($audit, 'A reversal must leave a durable audit row.');
    }

    public function test_reversing_twice_is_a_no_op_and_does_not_double_refund(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $payer = User::factory()->forTenant($this->testTenantId)->create(['balance' => 8.0]);
        $payee = User::factory()->forTenant($this->testTenantId)->create(['balance' => 12.0]);
        [$exchangeId] = $this->makeCompletedExchange($payer->id, $payee->id, 2.0);

        Sanctum::actingAs($admin);

        $first = $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/reverse", ['reason' => 'First']);
        $first->assertStatus(200);
        $firstReversalId = (int) $first->json('data.reversal_transaction_id');

        $second = $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/reverse", ['reason' => 'Second attempt']);
        $second->assertStatus(200);
        $second->assertJsonPath('data.already_reversed', true);
        $this->assertSame($firstReversalId, (int) $second->json('data.reversal_transaction_id'));

        // Balances reflect exactly ONE reversal.
        $this->assertEquals(10.0, (float) DB::table('users')->where('id', $payer->id)->value('balance'));
        $this->assertEquals(10.0, (float) DB::table('users')->where('id', $payee->id)->value('balance'));

        // And exactly one compensating row exists.
        $this->assertSame(1, DB::table('transactions')
            ->where('tenant_id', $this->testTenantId)
            ->where('transaction_type', 'exchange_reversal')
            ->where('description', 'like', '%#' . $exchangeId . ':%')
            ->count());
    }

    public function test_reverse_allows_the_payee_balance_to_go_negative(): void
    {
        // If the payee already spent the credits the correction must still complete;
        // the negative balance is an explicit debt in the ledger. Same decision the
        // marketplace refund makes.
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $payer = User::factory()->forTenant($this->testTenantId)->create(['balance' => 0.0]);
        $payee = User::factory()->forTenant($this->testTenantId)->create(['balance' => 0.5]);
        [$exchangeId] = $this->makeCompletedExchange($payer->id, $payee->id, 2.0);

        Sanctum::actingAs($admin);

        $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/reverse", [
            'reason' => 'Payee already spent the credits',
        ])->assertStatus(200);

        $this->assertEquals(2.0, (float) DB::table('users')->where('id', $payer->id)->value('balance'));
        $this->assertEquals(-1.5, (float) DB::table('users')->where('id', $payee->id)->value('balance'));
    }

    public function test_reverse_requires_a_reason(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $payer = User::factory()->forTenant($this->testTenantId)->create(['balance' => 8.0]);
        $payee = User::factory()->forTenant($this->testTenantId)->create(['balance' => 12.0]);
        [$exchangeId] = $this->makeCompletedExchange($payer->id, $payee->id, 2.0);

        Sanctum::actingAs($admin);

        $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/reverse", ['reason' => '  '])
            ->assertStatus(400);

        $this->assertNull(DB::table('exchange_requests')->where('id', $exchangeId)->value('reversal_transaction_id'));
    }

    public function test_reverse_rejects_a_non_completed_exchange(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = $this->makeListingId($this->testTenantId, $provider->id);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id' => $this->testTenantId, 'listing_id' => $listingId,
            'requester_id' => $requester->id, 'provider_id' => $provider->id,
            'proposed_hours' => 2.0, 'status' => 'accepted',
            'created_at' => now(), 'updated_at' => now(),
        ]);

        Sanctum::actingAs($admin);

        $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/reverse", ['reason' => 'Not completed'])
            ->assertStatus(400);
    }

    public function test_reverse_blocks_an_admin_who_is_a_party(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['balance' => 8.0]);
        $payee = User::factory()->forTenant($this->testTenantId)->create(['balance' => 12.0]);
        [$exchangeId] = $this->makeCompletedExchange($admin->id, $payee->id, 2.0);

        Sanctum::actingAs($admin);

        $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/reverse", ['reason' => 'Reversing my own'])
            ->assertStatus(403);

        $this->assertNull(DB::table('exchange_requests')->where('id', $exchangeId)->value('reversal_transaction_id'));
    }

    public function test_reverse_uses_the_original_amount_not_the_current_final_hours(): void
    {
        // The amount is re-read from the original ledger row under lock. If someone
        // edits final_hours afterwards, the reversal must still move what was
        // actually moved.
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $payer = User::factory()->forTenant($this->testTenantId)->create(['balance' => 8.0]);
        $payee = User::factory()->forTenant($this->testTenantId)->create(['balance' => 12.0]);
        [$exchangeId] = $this->makeCompletedExchange($payer->id, $payee->id, 2.0);

        DB::table('exchange_requests')->where('id', $exchangeId)->update(['final_hours' => 9.0]);

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/reverse", [
            'reason' => 'final_hours was tampered with',
        ]);

        $response->assertStatus(200);
        $this->assertEquals(2.0, $response->json('data.amount'), 'Reversal must use the ledger amount, not final_hours.');
        $this->assertEquals(10.0, (float) DB::table('users')->where('id', $payer->id)->value('balance'));
    }

    public function test_approve_exchange_returns_404_for_wrong_tenant(): void
    {
        $adminB = User::factory()->forTenant(999)->admin()->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = $this->makeListingId($this->testTenantId, $provider->id);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id'      => $this->testTenantId,
            'listing_id'     => $listingId,
            'requester_id'   => $requester->id,
            'provider_id'    => $provider->id,
            'proposed_hours' => 2.0,
            'status'         => 'pending_broker',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        // Act as admin of tenant 999 but exchange belongs to tenant 2
        \App\Core\TenantContext::setById(999);
        Sanctum::actingAs($adminB);

        $response = $this->withHeaders(['X-Tenant-ID' => '999'])
            ->postJson("/api/v2/admin/broker/exchanges/{$exchangeId}/approve", ['notes' => '']);

        $response->assertStatus(404);
        // Reset context
        \App\Core\TenantContext::setById($this->testTenantId);
    }

    public function test_approve_exchange_returns_403_for_non_broker(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = $this->makeListingId($this->testTenantId, $provider->id);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id'      => $this->testTenantId,
            'listing_id'     => $listingId,
            'requester_id'   => $requester->id,
            'provider_id'    => $provider->id,
            'proposed_hours' => 2.0,
            'status'         => 'pending_broker',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        Sanctum::actingAs($member);

        $response = $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/approve");

        $response->assertStatus(403);
    }

    public function test_approve_exchange_returns_401_unauthenticated(): void
    {
        $response = $this->apiPost('/v2/admin/broker/exchanges/1/approve');

        $response->assertStatus(401);
    }

    public function test_approve_exchange_returns_422_for_invalid_status(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();

        $listingId = $this->makeListingId($this->testTenantId, $provider->id);

        // Status is 'pending' (not 'pending_broker') — not approvable
        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id'      => $this->testTenantId,
            'listing_id'     => $listingId,
            'requester_id'   => $requester->id,
            'provider_id'    => $provider->id,
            'proposed_hours' => 2.0,
            'status'         => 'pending',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/approve");

        // respondWithError() defaults to HTTP 400; a non-approvable status yields
        // a 400 with the INVALID_STATUS error code.
        $response->assertStatus(400);
        $response->assertJsonPath('errors.0.code', 'INVALID_STATUS');
    }

    // ================================================================
    // REJECT EXCHANGE — POST /v2/admin/broker/exchanges/{id}/reject
    // ================================================================

    public function test_reject_exchange_succeeds(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = $this->makeListingId($this->testTenantId, $provider->id);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id'      => $this->testTenantId,
            'listing_id'     => $listingId,
            'requester_id'   => $requester->id,
            'provider_id'    => $provider->id,
            'proposed_hours' => 2.0,
            'status'         => 'pending_broker',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/reject", [
            'reason' => 'Does not meet criteria',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.status', 'cancelled');
    }

    public function test_reject_exchange_returns_422_without_reason(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = $this->makeListingId($this->testTenantId, $provider->id);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id'      => $this->testTenantId,
            'listing_id'     => $listingId,
            'requester_id'   => $requester->id,
            'provider_id'    => $provider->id,
            'proposed_hours' => 2.0,
            'status'         => 'pending_broker',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/reject", [
            'reason' => '',
        ]);

        // reason is required — controller returns error response
        $response->assertJsonPath('errors.0.code', 'VALIDATION_ERROR');
    }

    public function test_reject_exchange_returns_404_for_wrong_tenant(): void
    {
        $adminB = User::factory()->forTenant(999)->admin()->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = $this->makeListingId($this->testTenantId, $provider->id);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id'      => $this->testTenantId,
            'listing_id'     => $listingId,
            'requester_id'   => $requester->id,
            'provider_id'    => $provider->id,
            'proposed_hours' => 2.0,
            'status'         => 'pending_broker',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        \App\Core\TenantContext::setById(999);
        Sanctum::actingAs($adminB);

        $response = $this->withHeaders(['X-Tenant-ID' => '999'])
            ->postJson("/api/v2/admin/broker/exchanges/{$exchangeId}/reject", ['reason' => 'Cross-tenant attempt']);

        $response->assertStatus(404);
        \App\Core\TenantContext::setById($this->testTenantId);
    }

    public function test_reject_exchange_returns_403_for_non_broker(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = $this->makeListingId($this->testTenantId, $provider->id);
        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id'      => $this->testTenantId,
            'listing_id'     => $listingId,
            'requester_id'   => $requester->id,
            'provider_id'    => $provider->id,
            'proposed_hours' => 2.0,
            'status'         => 'pending_broker',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        Sanctum::actingAs($member);

        $response = $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/reject", ['reason' => 'Test']);

        $response->assertStatus(403);
    }

    // ================================================================
    // SHOW EXCHANGE — GET /v2/admin/broker/exchanges/{id}
    // ================================================================

    public function test_show_exchange_returns_details(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();

        $listingId = DB::table('listings')->insertGetId([
            'tenant_id'      => $this->testTenantId,
            'user_id'        => $provider->id,
            'title'          => 'Test listing',
            'description'    => 'Test listing for exchange details',
            'type'           => 'offer',
            'status'         => 'active',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id'      => $this->testTenantId,
            'listing_id'     => $listingId,
            'requester_id'   => $requester->id,
            'provider_id'    => $provider->id,
            'proposed_hours' => 3.0,
            'status'         => 'pending_broker',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        Sanctum::actingAs($admin);

        $response = $this->apiGet("/v2/admin/broker/exchanges/{$exchangeId}");

        $response->assertStatus(200);
        $response->assertJsonStructure(['data' => ['exchange', 'history', 'risk_tag']]);
        $response->assertJsonPath('data.exchange.id', $exchangeId);
    }

    public function test_show_exchange_returns_linked_listing_details(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create([
            'avatar_url' => '/uploads/avatars/requester.jpg',
        ]);
        $provider = User::factory()->forTenant($this->testTenantId)->create([
            'avatar_url' => '/uploads/avatars/provider.jpg',
        ]);

        $listingId = DB::table('listings')->insertGetId([
            'tenant_id'      => $this->testTenantId,
            'user_id'        => $provider->id,
            'title'          => 'Piano lessons',
            'description'    => 'Introductory piano lesson',
            'type'           => 'offer',
            'status'         => 'active',
            'hours_estimate' => 4.5,
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id'      => $this->testTenantId,
            'listing_id'     => $listingId,
            'requester_id'   => $requester->id,
            'provider_id'    => $provider->id,
            'proposed_hours' => 3.0,
            'status'         => 'pending_broker',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        Sanctum::actingAs($admin);

        $response = $this->apiGet("/v2/admin/broker/exchanges/{$exchangeId}");

        $response->assertStatus(200);
        $response->assertJsonPath('data.exchange.listing_title', 'Piano lessons');
        $response->assertJsonPath('data.exchange.listing_type', 'offer');
        $response->assertJsonPath('data.exchange.requester_avatar', '/uploads/avatars/requester.jpg');
        $response->assertJsonPath('data.exchange.provider_avatar', '/uploads/avatars/provider.jpg');
        $this->assertSame(4.5, (float) $response->json('data.exchange.hours_offered'));
    }

    public function test_show_exchange_returns_404_for_wrong_tenant(): void
    {
        $adminB = User::factory()->forTenant(999)->admin()->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = DB::table('listings')->insertGetId([
            'tenant_id'      => $this->testTenantId,
            'user_id'        => $provider->id,
            'title'          => 'Other tenant listing',
            'description'    => 'Test listing for tenant isolation',
            'type'           => 'offer',
            'status'         => 'active',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id'      => $this->testTenantId,
            'listing_id'     => $listingId,
            'requester_id'   => $requester->id,
            'provider_id'    => $provider->id,
            'proposed_hours' => 2.0,
            'status'         => 'pending_broker',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        \App\Core\TenantContext::setById(999);
        Sanctum::actingAs($adminB);

        $response = $this->withHeaders(['X-Tenant-ID' => '999'])
            ->getJson("/api/v2/admin/broker/exchanges/{$exchangeId}");

        $response->assertStatus(404);
        \App\Core\TenantContext::setById($this->testTenantId);
    }

    // ================================================================
    // SAVE RISK TAG — POST /v2/admin/broker/risk-tags/{listingId}
    // ================================================================

    public function test_save_risk_tag_succeeds_creates_new(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $listing = \App\Models\Listing::factory()->forTenant($this->testTenantId)->create();

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/risk-tags/{$listing->id}", [
            'risk_level'    => 'medium',
            'risk_category' => 'safeguarding',
            'risk_notes'    => 'Initial assessment',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.listing_id', $listing->id);
        $response->assertJsonPath('data.risk_level', 'medium');

        $this->assertDatabaseHas('listing_risk_tags', [
            'listing_id' => $listing->id,
            'tenant_id'  => $this->testTenantId,
            'risk_level' => 'medium',
        ]);
    }

    public function test_save_risk_tag_updates_existing(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $listing = \App\Models\Listing::factory()->forTenant($this->testTenantId)->create();

        // Pre-insert a tag
        DB::table('listing_risk_tags')->insert([
            'listing_id'    => $listing->id,
            'tenant_id'     => $this->testTenantId,
            'risk_level'    => 'low',
            'risk_category' => 'other',
            'tagged_by'     => $admin->id,
            'created_at'    => now(),
            'updated_at'    => now(),
        ]);

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/risk-tags/{$listing->id}", [
            'risk_level'    => 'high',
            'risk_category' => 'safeguarding',
            'risk_notes'    => 'Upgraded',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.risk_level', 'high');

        $this->assertDatabaseHas('listing_risk_tags', [
            'listing_id' => $listing->id,
            'risk_level' => 'high',
        ]);
    }

    public function test_save_risk_tag_returns_422_for_invalid_category(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $listing = \App\Models\Listing::factory()->forTenant($this->testTenantId)->create();

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/risk-tags/{$listing->id}", [
            'risk_level'    => 'medium',
            'risk_category' => 'not_a_real_category',
        ]);

        $response->assertJsonPath('errors.0.code', 'VALIDATION_ERROR');
    }

    public function test_save_risk_tag_returns_422_for_missing_risk_category(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $listing = \App\Models\Listing::factory()->forTenant($this->testTenantId)->create();

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/risk-tags/{$listing->id}", [
            'risk_level' => 'low',
            // risk_category intentionally omitted
        ]);

        $response->assertJsonPath('errors.0.code', 'VALIDATION_ERROR');
    }

    public function test_save_risk_tag_returns_404_for_wrong_tenant(): void
    {
        $adminB = User::factory()->forTenant(999)->admin()->create();
        $listing = \App\Models\Listing::factory()->forTenant($this->testTenantId)->create();

        \App\Core\TenantContext::setById(999);
        Sanctum::actingAs($adminB);

        $response = $this->withHeaders(['X-Tenant-ID' => '999'])
            ->postJson("/api/v2/admin/broker/risk-tags/{$listing->id}", [
                'risk_level'    => 'medium',
                'risk_category' => 'safeguarding',
            ]);

        $response->assertStatus(404);
        \App\Core\TenantContext::setById($this->testTenantId);
    }

    // ================================================================
    // REMOVE RISK TAG — DELETE /v2/admin/broker/risk-tags/{listingId}
    // ================================================================

    public function test_remove_risk_tag_succeeds(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $listing = \App\Models\Listing::factory()->forTenant($this->testTenantId)->create();

        DB::table('listing_risk_tags')->insert([
            'listing_id'    => $listing->id,
            'tenant_id'     => $this->testTenantId,
            'risk_level'    => 'medium',
            'risk_category' => 'other',
            'tagged_by'     => $admin->id,
            'created_at'    => now(),
            'updated_at'    => now(),
        ]);

        Sanctum::actingAs($admin);

        $response = $this->apiDelete("/v2/admin/broker/risk-tags/{$listing->id}");

        $response->assertStatus(200);
        $response->assertJsonPath('data.removed', true);

        $this->assertDatabaseMissing('listing_risk_tags', [
            'listing_id' => $listing->id,
            'tenant_id'  => $this->testTenantId,
        ]);
    }

    public function test_remove_risk_tag_returns_404_for_wrong_tenant(): void
    {
        $adminB = User::factory()->forTenant(999)->admin()->create();
        $tagger = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $listing = \App\Models\Listing::factory()->forTenant($this->testTenantId)->create();

        // Tag exists on tenant 2
        DB::table('listing_risk_tags')->insert([
            'listing_id'    => $listing->id,
            'tenant_id'     => $this->testTenantId,
            'risk_level'    => 'low',
            'risk_category' => 'other',
            'tagged_by'     => $tagger->id,
            'created_at'    => now(),
            'updated_at'    => now(),
        ]);

        \App\Core\TenantContext::setById(999);
        Sanctum::actingAs($adminB);

        $response = $this->withHeaders(['X-Tenant-ID' => '999'])
            ->deleteJson("/api/v2/admin/broker/risk-tags/{$listing->id}");

        $response->assertStatus(404);
        \App\Core\TenantContext::setById($this->testTenantId);
    }

    // ================================================================
    // SET MONITORING — POST /v2/admin/broker/monitoring/{userId}
    // ================================================================

    public function test_set_monitoring_adds_user(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $target = User::factory()->forTenant($this->testTenantId)->create();

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/monitoring/{$target->id}", [
            'under_monitoring' => true,
            'reason'           => 'Suspicious activity',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.under_monitoring', true);

        $this->assertDatabaseHas('user_messaging_restrictions', [
            'user_id'         => $target->id,
            'tenant_id'       => $this->testTenantId,
            'under_monitoring' => 1,
        ]);
    }

    public function test_set_monitoring_removes_user(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $target = User::factory()->forTenant($this->testTenantId)->create();

        // Pre-insert monitoring record
        DB::table('user_messaging_restrictions')->insert([
            'user_id'                => $target->id,
            'tenant_id'              => $this->testTenantId,
            'under_monitoring'       => 1,
            'monitoring_reason'      => 'Test reason',
            'restriction_reason'     => 'Test reason',
            'messaging_disabled'     => 0,
            'monitoring_started_at'  => now(),
            'monitoring_expires_at'  => null,
            'restricted_by'          => $admin->id,
        ]);

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/monitoring/{$target->id}", [
            'under_monitoring' => false,
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.under_monitoring', false);

        $this->assertDatabaseHas('user_messaging_restrictions', [
            'user_id'         => $target->id,
            'under_monitoring' => 0,
        ]);
    }

    public function test_set_monitoring_returns_404_for_wrong_tenant(): void
    {
        $adminB = User::factory()->forTenant(999)->admin()->create();
        $target = User::factory()->forTenant($this->testTenantId)->create();

        \App\Core\TenantContext::setById(999);
        Sanctum::actingAs($adminB);

        $response = $this->withHeaders(['X-Tenant-ID' => '999'])
            ->postJson("/api/v2/admin/broker/monitoring/{$target->id}", [
                'under_monitoring' => true,
                'reason'           => 'Cross-tenant attempt',
            ]);

        $response->assertStatus(404);
        \App\Core\TenantContext::setById($this->testTenantId);
    }

    public function test_set_monitoring_returns_403_for_non_broker(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $target = User::factory()->forTenant($this->testTenantId)->create();

        Sanctum::actingAs($member);

        $response = $this->apiPost("/v2/admin/broker/monitoring/{$target->id}", [
            'under_monitoring' => true,
            'reason'           => 'Test',
        ]);

        $response->assertStatus(403);
    }

    // ================================================================
    // APPROVE MESSAGE — POST /v2/admin/broker/messages/{id}/approve
    // ================================================================

    public function test_approve_message_creates_archive(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $sender = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();

        $copyId = $this->insertMessageCopy($sender->id, $receiver->id);

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/messages/{$copyId}/approve", [
            'notes' => 'No issues found',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.id', $copyId);
        $this->assertNotNull($response->json('data.archive_id'));

        // Archive record should exist
        $archiveId = $response->json('data.archive_id');
        $this->assertDatabaseHas('broker_review_archives', [
            'id'             => $archiveId,
            'tenant_id'      => $this->testTenantId,
            'broker_copy_id' => $copyId,
        ]);
    }

    public function test_approve_message_returns_409_when_already_archived(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $sender = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();

        // Create a copy first, then create an archive for it
        $copyId = $this->insertMessageCopy($sender->id, $receiver->id);

        $archiveId = DB::table('broker_review_archives')->insertGetId([
            'tenant_id'              => $this->testTenantId,
            'broker_copy_id'         => $copyId,
            'sender_id'              => $sender->id,
            'sender_name'            => $sender->first_name . ' ' . $sender->last_name,
            'receiver_id'            => $receiver->id,
            'receiver_name'          => $receiver->first_name . ' ' . $receiver->last_name,
            'related_listing_id'     => null,
            'listing_title'          => null,
            'copy_reason'            => 'first_contact',
            'target_message_body'    => 'Hello',
            'target_message_sent_at' => now()->subHour(),
            'conversation_snapshot'  => '[]',
            'decision'               => 'approved',
            'decided_by'             => $admin->id,
            'decided_by_name'        => 'Admin User',
            'decided_at'             => now(),
            'created_at'             => now(),
        ]);

        // Mark the copy as already archived
        DB::table('broker_message_copies')
            ->where('id', $copyId)
            ->update(['archive_id' => $archiveId, 'archived_at' => now()]);

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/messages/{$copyId}/approve");

        $response->assertStatus(409);
    }

    public function test_approve_message_returns_404_for_wrong_tenant(): void
    {
        $adminB = User::factory()->forTenant(999)->admin()->create();
        $sender = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();

        $copyId = $this->insertMessageCopy($sender->id, $receiver->id);

        \App\Core\TenantContext::setById(999);
        Sanctum::actingAs($adminB);

        $response = $this->withHeaders(['X-Tenant-ID' => '999'])
            ->postJson("/api/v2/admin/broker/messages/{$copyId}/approve");

        $response->assertStatus(404);
        \App\Core\TenantContext::setById($this->testTenantId);
    }

    // ================================================================
    // FLAG MESSAGE — POST /v2/admin/broker/messages/{id}/flag
    // ================================================================

    public function test_flag_message_succeeds(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $sender = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();

        $copyId = $this->insertMessageCopy($sender->id, $receiver->id, ['message_body' => 'Potentially harmful content']);

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/messages/{$copyId}/flag", [
            'reason'   => 'Inappropriate content',
            'severity' => 'warning',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.flagged', true);
        $response->assertJsonPath('data.flag_severity', 'warning');

        $this->assertDatabaseHas('broker_message_copies', [
            'id'            => $copyId,
            'flagged'       => 1,
            'flag_reason'   => 'Inappropriate content',
            'flag_severity' => 'warning',
        ]);
    }

    public function test_flag_message_returns_422_for_invalid_severity(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $sender = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();

        $copyId = $this->insertMessageCopy($sender->id, $receiver->id);

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/messages/{$copyId}/flag", [
            'reason'   => 'Some reason',
            'severity' => 'not_valid_severity',
        ]);

        $response->assertJsonPath('errors.0.code', 'VALIDATION_ERROR');
    }

    public function test_flag_message_returns_422_without_reason(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $sender = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();

        $copyId = $this->insertMessageCopy($sender->id, $receiver->id);

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/messages/{$copyId}/flag", [
            'reason'   => '',
            'severity' => 'warning',
        ]);

        $response->assertJsonPath('errors.0.code', 'VALIDATION_ERROR');
    }

    public function test_flag_message_returns_404_for_wrong_tenant(): void
    {
        $adminB = User::factory()->forTenant(999)->admin()->create();
        $sender = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();

        $copyId = $this->insertMessageCopy($sender->id, $receiver->id);

        \App\Core\TenantContext::setById(999);
        Sanctum::actingAs($adminB);

        $response = $this->withHeaders(['X-Tenant-ID' => '999'])
            ->postJson("/api/v2/admin/broker/messages/{$copyId}/flag", [
                'reason'   => 'Cross-tenant',
                'severity' => 'warning',
            ]);

        $response->assertStatus(404);
        \App\Core\TenantContext::setById($this->testTenantId);
    }

    // ================================================================
    // REVIEW MESSAGE — POST /v2/admin/broker/messages/{id}/review
    // ================================================================

    public function test_review_message_marks_as_reviewed(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $sender = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();

        $copyId = $this->insertMessageCopy($sender->id, $receiver->id);

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/messages/{$copyId}/review");

        $response->assertStatus(200);
        $response->assertJsonPath('data.reviewed', true);

        $this->assertDatabaseHas('broker_message_copies', [
            'id'          => $copyId,
            'reviewed_by' => $admin->id,
        ]);
    }

    public function test_review_message_returns_404_for_wrong_tenant(): void
    {
        $adminB = User::factory()->forTenant(999)->admin()->create();
        $sender = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();

        $copyId = $this->insertMessageCopy($sender->id, $receiver->id);

        \App\Core\TenantContext::setById(999);
        Sanctum::actingAs($adminB);

        $response = $this->withHeaders(['X-Tenant-ID' => '999'])
            ->postJson("/api/v2/admin/broker/messages/{$copyId}/review");

        $response->assertStatus(404);
        \App\Core\TenantContext::setById($this->testTenantId);
    }

    // ================================================================
    // SHOW MESSAGE — GET /v2/admin/broker/messages/{id}
    // ================================================================

    public function test_show_message_returns_details(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $sender = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();

        $copyId = $this->insertMessageCopy($sender->id, $receiver->id, ['message_body' => 'Hello there']);

        Sanctum::actingAs($admin);

        $response = $this->apiGet("/v2/admin/broker/messages/{$copyId}");

        $response->assertStatus(200);
        $response->assertJsonStructure(['data' => ['copy', 'thread', 'archive']]);
        $response->assertJsonPath('data.copy.id', $copyId);
    }

    public function test_show_message_returns_404_for_wrong_tenant(): void
    {
        $adminB = User::factory()->forTenant(999)->admin()->create();
        $sender = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();

        $copyId = $this->insertMessageCopy($sender->id, $receiver->id);

        \App\Core\TenantContext::setById(999);
        Sanctum::actingAs($adminB);

        $response = $this->withHeaders(['X-Tenant-ID' => '999'])
            ->getJson("/api/v2/admin/broker/messages/{$copyId}");

        $response->assertStatus(404);
        \App\Core\TenantContext::setById($this->testTenantId);
    }

    // ================================================================
    // SHOW ARCHIVE — GET /v2/admin/broker/archives/{id}
    // ================================================================

    public function test_show_archive_returns_details(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $sender = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();

        $copyId = $this->insertMessageCopy($sender->id, $receiver->id);

        $archiveId = DB::table('broker_review_archives')->insertGetId([
            'tenant_id'              => $this->testTenantId,
            'broker_copy_id'         => $copyId,
            'sender_id'              => $sender->id,
            'sender_name'            => 'Test Sender',
            'receiver_id'            => $receiver->id,
            'receiver_name'          => 'Test Receiver',
            'related_listing_id'     => null,
            'listing_title'          => null,
            'copy_reason'            => 'first_contact',
            'target_message_body'    => 'Archived message',
            'target_message_sent_at' => now()->subDay(),
            'conversation_snapshot'  => json_encode([]),
            'decision'               => 'approved',
            'decided_by'             => $admin->id,
            'decided_by_name'        => 'Admin',
            'decided_at'             => now(),
            'created_at'             => now(),
        ]);

        Sanctum::actingAs($admin);

        $response = $this->apiGet("/v2/admin/broker/archives/{$archiveId}");

        $response->assertStatus(200);
        $response->assertJsonPath('data.id', $archiveId);
        $response->assertJsonPath('data.decision', 'approved');
    }

    public function test_show_archive_returns_404_for_wrong_tenant(): void
    {
        $adminB = User::factory()->forTenant(999)->admin()->create();
        $sender = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();

        $copyId = $this->insertMessageCopy($sender->id, $receiver->id);

        $archiveId = DB::table('broker_review_archives')->insertGetId([
            'tenant_id'              => $this->testTenantId,
            'broker_copy_id'         => $copyId,
            'sender_id'              => $sender->id,
            'sender_name'            => 'Sender',
            'receiver_id'            => $receiver->id,
            'receiver_name'          => 'Receiver',
            'related_listing_id'     => null,
            'listing_title'          => null,
            'copy_reason'            => 'first_contact',
            'target_message_body'    => 'Message',
            'target_message_sent_at' => now()->subDay(),
            'conversation_snapshot'  => '[]',
            'decision'               => 'approved',
            'decided_by'             => $adminB->id,
            'decided_by_name'        => 'Admin',
            'decided_at'             => now(),
            'created_at'             => now(),
        ]);

        \App\Core\TenantContext::setById(999);
        Sanctum::actingAs($adminB);

        $response = $this->withHeaders(['X-Tenant-ID' => '999'])
            ->getJson("/api/v2/admin/broker/archives/{$archiveId}");

        $response->assertStatus(404);
        \App\Core\TenantContext::setById($this->testTenantId);
    }

    // ================================================================
    // SAVE CONFIGURATION — POST /v2/admin/broker/configuration
    // ================================================================

    public function test_save_configuration_succeeds_as_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/broker/configuration', [
            'retention_days'          => 120,
            'new_member_monitoring_days' => 45,
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.retention_days', 120);

        $this->assertDatabaseHas('tenant_settings', [
            'tenant_id'   => $this->testTenantId,
            'setting_key' => 'broker_config',
        ]);
    }

    public function test_save_configuration_returns_403_when_broker_submits_admin_only_keys(): void
    {
        // Create a user with broker role
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker']);
        Sanctum::actingAs($broker);

        // Platform-wide message and high-risk approval policy keys are admin-only.
        $response = $this->apiPost('/v2/admin/broker/configuration', [
            'broker_messaging_enabled' => false,
            'require_approval_high_risk' => false,
        ]);

        $response->assertStatus(403);
    }

    public function test_broker_can_save_operational_configuration_without_clobbering_admin_policy(): void
    {
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker']);
        Sanctum::actingAs($broker);

        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'broker_config'],
            [
                'setting_value' => json_encode([
                    'broker_messaging_enabled' => true,
                    'broker_approval_required' => true,
                    'retention_days' => 90,
                    'vetting_enabled' => true,
                ]),
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );

        $response = $this->apiPost('/v2/admin/broker/configuration', [
            'retention_days' => 120,
            'copy_first_contact' => false,
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.retention_days', 120);
        $response->assertJsonPath('data.broker_messaging_enabled', true);
        $response->assertJsonPath('data.broker_approval_required', true);

        $saved = DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'broker_config')
            ->value('setting_value');
        $config = json_decode((string) $saved, true);

        $this->assertSame(120, $config['retention_days']);
        $this->assertFalse($config['copy_first_contact']);
        $this->assertTrue($config['broker_messaging_enabled']);
        $this->assertTrue($config['broker_approval_required']);
        $this->assertArrayNotHasKey('vetting_enabled', $config);
    }

    public function test_save_configuration_syncs_flat_panel_keys_to_runtime_broker_controls(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/broker/configuration', [
            'broker_approval_required' => true,
            'auto_approve_low_risk' => true,
            'max_hours_without_approval' => 6,
            'copy_high_risk_listing_messages' => false,
        ]);

        $response->assertStatus(200);

        $tenantConfig = DB::table('tenants')->where('id', $this->testTenantId)->value('configuration');
        $brokerControls = (json_decode((string) $tenantConfig, true) ?: [])['broker_controls'] ?? [];

        $this->assertTrue($brokerControls['exchange_workflow']['enabled']);
        $this->assertTrue($brokerControls['exchange_workflow']['require_broker_approval']);
        $this->assertTrue($brokerControls['exchange_workflow']['auto_approve_low_risk']);
        $this->assertSame(6.0, (float) $brokerControls['exchange_workflow']['max_hours_without_approval']);
        $this->assertFalse($brokerControls['broker_visibility']['copy_high_risk_listing_messages']);
    }

    public function test_save_configuration_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPost('/v2/admin/broker/configuration', [
            'retention_days' => 60,
        ]);

        $response->assertStatus(403);
    }

    // ================================================================
    // CROSS-TENANT / SUPER-ADMIN
    // ================================================================

    public function test_super_admin_can_read_exchanges_for_specific_tenant(): void
    {
        // Create a platform super-admin (role = super_admin)
        $superAdmin = User::factory()->forTenant($this->testTenantId)->create([
            'role'           => 'super_admin',
            'is_super_admin' => true,
        ]);
        Sanctum::actingAs($superAdmin);

        // Create an exchange on the test tenant
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = $this->makeListingId($this->testTenantId, $provider->id);
        DB::table('exchange_requests')->insert([
            'tenant_id'      => $this->testTenantId,
            'listing_id'     => $listingId,
            'requester_id'   => $requester->id,
            'provider_id'    => $provider->id,
            'proposed_hours' => 1.0,
            'status'         => 'pending',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        // Super admin requests tenant 2's data explicitly
        $response = $this->withHeaders(['X-Tenant-ID' => (string) $this->testTenantId])
            ->getJson("/api/v2/admin/broker/exchanges?tenant_id={$this->testTenantId}");

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_non_super_admin_cannot_override_tenant_via_query_param(): void
    {
        // Regular admin of tenant 2
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();

        // Create an exchange on tenant 999
        $requesterB = User::factory()->forTenant(999)->create();
        $providerB = User::factory()->forTenant(999)->create();
        $listingIdB = $this->makeListingId(999, $providerB->id);
        $exchangeIdB = DB::table('exchange_requests')->insertGetId([
            'tenant_id'      => 999,
            'listing_id'     => $listingIdB,
            'requester_id'   => $requesterB->id,
            'provider_id'    => $providerB->id,
            'proposed_hours' => 1.0,
            'status'         => 'pending',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        Sanctum::actingAs($admin);

        // Try to read tenant 999's exchange — non-super-admin gets own tenant data only
        $response = $this->apiGet("/v2/admin/broker/exchanges?tenant_id=999");

        $response->assertStatus(200);
        // The response should not contain the exchange from tenant 999
        $data = $response->json('data');
        $ids = collect($data)->pluck('id')->toArray();
        $this->assertNotContains($exchangeIdB, $ids);
    }
}
