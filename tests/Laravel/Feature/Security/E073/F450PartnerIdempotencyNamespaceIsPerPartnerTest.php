<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E073;

use App\Core\FederationApiMiddleware;
use App\Models\User;
use App\Services\SafeguardingInteractionPolicy;
use App\Support\SafeguardingInteractionDecision;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\Laravel\Concerns\EnablesExternalFederation;
use Tests\Laravel\TestCase;

/**
 * F-450 (E-073, slice F finding F-5) — one partner permanently poisoned
 * another partner's idempotency key.
 *
 * `FederationController::createTransaction()` de-duplicates inbound transfers
 * through `federation_webhook_nonces`, whose UNIQUE key is
 * `(partner_id, nonce)`. The partner column was filled with
 * `(int) $auth['platform_id']`, and `federation_api_keys.platform_id` is a
 * VARCHAR partner name — so `(int)` was **0** for every partner and all of
 * them shared one namespace keyed on a string the caller chooses. The first
 * caller to claim a key value owned it for ever; the rows are never pruned.
 *
 * The fix uses the authenticated key's own row id (`$auth['id']`), which is a
 * genuinely distinguishing integer, and fails closed if it cannot be resolved.
 *
 * The replay control that DOES work — a partner replaying its own key is
 * refused 409 and credited exactly once — is re-tested here so the fix cannot
 * have loosened it.
 */
final class F450PartnerIdempotencyNamespaceIsPerPartnerTest extends TestCase
{
    use DatabaseTransactions;
    use EnablesExternalFederation;

    private const SHARED_KEY = 'F450-LEDGER-TX-000199';

    protected function setUp(): void
    {
        parent::setUp();
        $this->enableExternalFederation();
        FederationApiMiddleware::reset();
        $this->allowSafeguarding();
        $this->selfCreditAgreement();
    }

    protected function tearDown(): void
    {
        FederationApiMiddleware::reset();
        unset($_SERVER['HTTP_X_API_KEY']);
        parent::tearDown();
    }

    // ------------------------------------------------------------------
    //  THE MECHANISM — two partners must not share one namespace
    // ------------------------------------------------------------------

    public function test_two_partners_write_their_dedup_rows_under_different_partner_ids(): void
    {
        $recipient = $this->federatedMember();

        $alpha = $this->partnerApiKey('f450-alpha');
        $beta = $this->partnerApiKey('f450-beta');

        $this->useKey($alpha);
        $this->apiPost('/v1/federation/transactions', [
            'sender_id' => 900001,
            'recipient_id' => (int) $recipient->id,
            'amount' => 1,
            'description' => 'alpha one',
            'idempotency_key' => 'f450-alpha-key',
        ], ['X-API-Key' => $alpha])->assertStatus(201);

        $this->useKey($beta);
        $this->apiPost('/v1/federation/transactions', [
            'sender_id' => 900002,
            'recipient_id' => (int) $recipient->id,
            'amount' => 1,
            'description' => 'beta one',
            'idempotency_key' => 'f450-beta-key',
        ], ['X-API-Key' => $beta])->assertStatus(201);

        $partnerIds = DB::table('federation_webhook_nonces')
            ->where('nonce', 'like', 'tx:' . $this->testTenantId . ':%')
            ->pluck('partner_id')
            ->map(static fn ($v): int => (int) $v)
            ->unique()
            ->values()
            ->all();

        $this->assertCount(2, $partnerIds, 'two distinct partners must own two distinct namespaces');
        $this->assertNotContains(0, $partnerIds, 'no partner may fall back to the shared namespace 0');
    }

    // ------------------------------------------------------------------
    //  THE HARM — it must no longer be possible
    // ------------------------------------------------------------------

    public function test_one_partner_cannot_swallow_another_partners_credit_transfer(): void
    {
        $alphaTarget = $this->federatedMember();
        $betaTarget = $this->federatedMember();

        $alpha = $this->partnerApiKey('f450b-alpha');
        $beta = $this->partnerApiKey('f450b-beta');

        $before = $this->balance($betaTarget);

        // Alpha claims the key value Beta is about to use.
        $this->useKey($alpha);
        $poison = $this->apiPost('/v1/federation/transactions', [
            'sender_id' => 900011,
            'recipient_id' => (int) $alphaTarget->id,
            'amount' => 1,
            'description' => 'f450 poison attempt',
            'idempotency_key' => self::SHARED_KEY,
        ], ['X-API-Key' => $alpha]);
        $this->assertSame(201, $poison->status(), (string) $poison->getContent());

        // Beta's genuine 40-hour transfer, to a different member, for a
        // different amount, from a different sender. The ONLY thing it shares
        // with Alpha's call is the key string.
        $this->useKey($beta);
        $genuine = $this->apiPost('/v1/federation/transactions', [
            'sender_id' => 900012,
            'recipient_id' => (int) $betaTarget->id,
            'amount' => 40,
            'description' => 'f450 genuine beta settlement',
            'idempotency_key' => self::SHARED_KEY,
        ], ['X-API-Key' => $beta]);

        $this->assertSame(201, $genuine->status(), (string) $genuine->getContent());
        $this->assertSame(
            $before + 40.0,
            $this->balance($betaTarget),
            'the intended recipient is credited — another partner cannot claim Beta key values',
        );
    }

    // ------------------------------------------------------------------
    //  LEGITIMATE ACCESS / the replay control itself must still hold
    // ------------------------------------------------------------------

    public function test_control_a_partner_replaying_its_own_key_is_still_refused_and_credited_once(): void
    {
        $target = $this->federatedMember();
        $beta = $this->partnerApiKey('f450c-beta');

        $this->useKey($beta);
        $this->apiPost('/v1/federation/transactions', [
            'sender_id' => 900042,
            'recipient_id' => (int) $target->id,
            'amount' => 5,
            'description' => 'f450c first',
            'idempotency_key' => 'f450c-own-key',
        ], ['X-API-Key' => $beta])->assertStatus(201);

        $this->useKey($beta);
        $replay = $this->apiPost('/v1/federation/transactions', [
            'sender_id' => 900042,
            'recipient_id' => (int) $target->id,
            'amount' => 5,
            'description' => 'f450c first',
            'idempotency_key' => 'f450c-own-key',
        ], ['X-API-Key' => $beta]);

        $this->assertSame(409, $replay->status(), (string) $replay->getContent());
        $replay->assertJsonPath('code', 'DUPLICATE_REQUEST');
        $this->assertSame(5.0, $this->balance($target), 'credited exactly once');
    }

    public function test_control_a_partner_replaying_a_derived_key_is_still_refused(): void
    {
        $target = $this->federatedMember();
        $beta = $this->partnerApiKey('f450d-beta');

        // No idempotency_key at all: the key is derived from the payload, so an
        // identical retry must still be de-duplicated.
        $payload = [
            'sender_id' => 900052,
            'recipient_id' => (int) $target->id,
            'amount' => 3,
            'description' => 'f450d derived',
        ];

        $this->useKey($beta);
        $this->apiPost('/v1/federation/transactions', $payload, ['X-API-Key' => $beta])->assertStatus(201);

        $this->useKey($beta);
        $replay = $this->apiPost('/v1/federation/transactions', $payload, ['X-API-Key' => $beta]);

        $this->assertSame(409, $replay->status(), (string) $replay->getContent());
        $this->assertSame(3.0, $this->balance($target));
    }

    // ------------------------------------------------------------------
    //  Fixtures
    // ------------------------------------------------------------------

    private function balance(User $user): float
    {
        return (float) DB::table('users')->where('id', $user->id)->value('balance');
    }

    private function selfCreditAgreement(): void
    {
        DB::table('federation_credit_agreements')->insert([
            'from_tenant_id' => $this->testTenantId,
            'to_tenant_id' => $this->testTenantId,
            'status' => 'active',
            'max_monthly_credits' => 100000.0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function federatedMember(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'balance' => 0,
        ]);

        DB::table('federation_user_settings')->updateOrInsert(
            ['user_id' => (int) $user->id],
            [
                'federation_optin' => 1,
                'profile_visible_federated' => 1,
                'appear_in_federated_search' => 1,
                'messaging_enabled_federated' => 1,
                'transactions_enabled_federated' => 1,
                'show_reviews_federated' => 1,
                'updated_at' => now(),
            ],
        );

        return $user;
    }

    private function partnerApiKey(string $platformId): string
    {
        $apiKey = $platformId . '-' . bin2hex(random_bytes(10));
        DB::table('federation_api_keys')->insert([
            'tenant_id' => $this->testTenantId,
            'name' => 'F-450 ' . $platformId,
            'key_hash' => hash('sha256', $apiKey),
            'key_prefix' => substr($apiKey, 0, 8),
            'signing_enabled' => 0,
            'platform_id' => $platformId,
            'permissions' => json_encode(['transactions:write']),
            'rate_limit' => 100000,
            'status' => 'active',
            'created_by' => 1,
            'created_at' => now(),
            'updated_at' => now(),
            'hourly_request_count' => 0,
        ]);

        return $apiKey;
    }

    private function useKey(string $apiKey): void
    {
        FederationApiMiddleware::reset();
        $_SERVER['HTTP_X_API_KEY'] = $apiKey;
        $_SERVER['REQUEST_METHOD'] = 'POST';
        $_SERVER['REQUEST_URI'] = '/api/v1/federation/transactions';
        $_SERVER['REMOTE_ADDR'] = '127.0.0.1';
    }

    private function allowSafeguarding(): void
    {
        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('evaluateExternalContact')->andReturn($this->allowDecision());
        $policy->shouldReceive('evaluateCrossTenantContact')->andReturn($this->allowDecision());
        $policy->shouldReceive('evaluateLocalContact')->andReturn($this->allowDecision());
        $policy->shouldReceive('assertLocalContactAllowed')->andReturnNull();
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);
    }

    private function allowDecision(): SafeguardingInteractionDecision
    {
        return new SafeguardingInteractionDecision(
            status: SafeguardingInteractionDecision::ALLOW,
            code: 'ALLOWED',
            recipientTenantId: $this->testTenantId,
            purposeCode: 'safeguarded_member_contact',
            scopeType: 'tenant',
            scopeIdentifier: '',
            policyVersion: 'e074-e',
        );
    }
}
