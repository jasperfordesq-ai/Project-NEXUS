<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E065;

use App\Models\User;
use App\Services\BlockUserService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Concerns\FederationIntegrationHarness;
use Tests\Laravel\Feature\Security\E065\Concerns\SeedsInternalFederation;
use Tests\Laravel\TestCase;

/**
 * F-336 follow-up (E-066) — three call sites report a BLOCK as HTTP 400.
 *
 * Commit `04939c994` added blocking to `SafeguardingInteractionPolicy`, which
 * refuses with the decision code `BLOCKED`.
 * `BaseApiController::safeguardingPolicyError()` maps that code to 403. Three
 * call sites map codes through their own explicit `in_array()` list and did not
 * include it, so they answered 400 instead:
 * `FederationV2Controller::acceptConnection()`, and
 * `GroupExchangeController::start()` and `::complete()`.
 *
 * The request was always still refused — fail-closed held, no credits moved and
 * no contact was made — so this is precision, not a new exposure. But 400 says
 * "your request was malformed" for something that is a deliberate refusal, and
 * a client cannot tell a block from a validation error.
 *
 * Not a numbered finding: it is a consequence of a fix already committed in
 * this engagement.
 */
final class F336BlockedDecisionStatusMappingTest extends TestCase
{
    use DatabaseTransactions;
    use FederationIntegrationHarness;
    use SeedsInternalFederation;

    protected function setUp(): void
    {
        parent::setUp();
        $this->app['auth']->forgetGuards();
        Cache::flush();
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'balance' => 50,
        ]);
    }

    /**
     * A group exchange with one provider and one receiver, balanced, in the
     * given status and with every participant already confirmed.
     */
    private function seedExchange(User $organizer, User $other, string $status): int
    {
        $exchangeId = (int) DB::table('group_exchanges')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'title' => 'F336 follow-up exchange',
            'description' => 'E-066 fixture',
            'organizer_id' => (int) $organizer->id,
            'status' => $status,
            'split_type' => 'custom',
            'total_hours' => 2,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('group_exchange_participants')->insert([
            [
                'group_exchange_id' => $exchangeId,
                'user_id' => (int) $organizer->id,
                'role' => 'provider',
                'hours' => 2,
                'weight' => 1,
                'confirmed' => 1,
                'confirmed_at' => now(),
                'created_at' => now(),
            ],
            [
                'group_exchange_id' => $exchangeId,
                'user_id' => (int) $other->id,
                'role' => 'receiver',
                'hours' => 2,
                'weight' => 1,
                'confirmed' => 1,
                'confirmed_at' => now(),
                'created_at' => now(),
            ],
        ]);

        return $exchangeId;
    }

    public function test_accepting_a_federated_connection_from_a_blocked_member_answers_403(): void
    {
        $partner = $this->seedPartnerTenant('F336f Partner');
        $this->seedPartnership($partner);

        $acceptor = $this->seedFederatedUser($this->testTenantId);
        $requester = $this->seedFederatedUser($partner);

        // The block is made FIRST. F-284 made BlockUserService::block() delete
        // any federation_connections row for the pair, so a row that survives
        // alongside a block is one that predates that fix — or one whose
        // deletion failed, since that delete swallows its own exception. The
        // pending row below models exactly that, which is the only way
        // acceptRequest() can reach the policy and be told BLOCKED.
        BlockUserService::block((int) $acceptor->id, (int) $requester->id, 'F336 follow-up');

        $connectionId = (int) DB::table('federation_connections')->insertGetId([
            'requester_user_id' => (int) $requester->id,
            'requester_tenant_id' => $partner,
            'receiver_user_id' => (int) $acceptor->id,
            'receiver_tenant_id' => $this->testTenantId,
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Sanctum::actingAs($acceptor, ['*']);
        $response = $this->apiPost('/v2/federation/connections/' . $connectionId . '/accept');

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'BLOCKED');

        // Fail-closed held all along: the connection is still pending.
        $this->assertSame('pending', (string) DB::table('federation_connections')->where('id', $connectionId)->value('status'));
    }

    public function test_starting_a_group_exchange_with_a_blocked_pair_answers_403(): void
    {
        $organizer = $this->member();
        $other = $this->member();

        $exchangeId = $this->seedExchange($organizer, $other, 'draft');

        BlockUserService::block((int) $other->id, (int) $organizer->id, 'F336 follow-up');

        Sanctum::actingAs($organizer, ['*']);
        $response = $this->apiPost('/v2/group-exchanges/' . $exchangeId . '/start');

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'BLOCKED');

        $this->assertSame('draft', (string) DB::table('group_exchanges')->where('id', $exchangeId)->value('status'));
    }

    public function test_completing_a_group_exchange_with_a_blocked_pair_answers_403(): void
    {
        $organizer = $this->member();
        $other = $this->member();

        $exchangeId = $this->seedExchange($organizer, $other, 'pending_confirmation');

        BlockUserService::block((int) $other->id, (int) $organizer->id, 'F336 follow-up');

        Sanctum::actingAs($organizer, ['*']);
        $response = $this->apiPost('/v2/group-exchanges/' . $exchangeId . '/complete');

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'BLOCKED');

        $this->assertSame('pending_confirmation', (string) DB::table('group_exchanges')->where('id', $exchangeId)->value('status'));
    }
}
