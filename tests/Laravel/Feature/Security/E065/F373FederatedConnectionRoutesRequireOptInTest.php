<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E065;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Concerns\FederationIntegrationHarness;
use Tests\Laravel\Feature\Security\E065\Concerns\SeedsInternalFederation;
use Tests\Laravel\TestCase;

/**
 * F-373 (E-065 slice K, K-3) — the five federated-connection WRITE routes must
 * refuse a member who has opted out of federation, the way every read route
 * already does.
 *
 * `connections()` (the GET) called `requireFederationOptIn()`; none of
 * `sendConnectionRequest()`, `acceptConnection()`, `rejectConnection()`,
 * `removeConnection()` or `connectionStatus()` did. So an account the platform
 * reports as not participating in federation could still create a
 * cross-community connection request and put a bell, a push and an email in
 * front of a member of another community.
 *
 * 🔴 `tests/Laravel/Feature/Controllers/FederationV2ControllerTest.php:1243-1255`
 * already asserts eight federated GET routes answer 403 for an opted-out
 * member, and lists `/v2/federation/connections` among them — the POST on the
 * same path was never added. This file adds it, and the other four.
 *
 * Adapted from the E-065 reproduction
 * `.local-docs-archive/security-log/E-065/repro/k/FederationConnectionsOptInTest.php`,
 * which PASSES while the bug exists. Its assertions are INVERTED here; its
 * three controls (GET connections, POST messages, POST transactions all 403)
 * are kept.
 */
final class F373FederatedConnectionRoutesRequireOptInTest extends TestCase
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

    private function seedConnection(User $requester, int $requesterTenant, User $receiver, int $receiverTenant, string $status): int
    {
        return (int) DB::table('federation_connections')->insertGetId([
            'requester_user_id' => (int) $requester->id,
            'requester_tenant_id' => $requesterTenant,
            'receiver_user_id' => (int) $receiver->id,
            'receiver_tenant_id' => $receiverTenant,
            'status' => $status,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_an_opted_out_member_cannot_send_a_cross_community_connection_request(): void
    {
        $partner = $this->seedPartnerTenant('F373 Partner');
        $this->seedPartnership($partner);

        $optedOut = $this->seedFederatedUser($this->testTenantId, [], ['federation_optin' => 0]);
        $target = $this->seedFederatedUser($partner);

        // CONTROL (kept from the reproduction) — every other federated channel
        // already refuses this member.
        Sanctum::actingAs($optedOut, ['*']);
        $this->apiGet('/v2/federation/connections')->assertStatus(403);

        Sanctum::actingAs($optedOut, ['*']);
        $this->apiPost('/v2/federation/messages', [
            'receiver_id' => (int) $target->id,
            'receiver_tenant_id' => $partner,
            'subject' => 'F373',
            'body' => 'F373 control',
        ])->assertStatus(403);

        Sanctum::actingAs($optedOut, ['*']);
        $this->apiPost('/v2/federation/transactions', [
            'receiver_id' => (int) $target->id,
            'receiver_tenant_id' => $partner,
            'amount' => 1,
            'description' => 'F373 control',
        ])->assertStatus(403);

        // FIXED — and so does the connection route.
        Sanctum::actingAs($optedOut, ['*']);
        $this->apiPost('/v2/federation/connections', [
            'receiver_id' => (int) $target->id,
            'receiver_tenant_id' => $partner,
            'message' => 'F-373',
        ])->assertStatus(403);

        $this->assertDatabaseMissing('federation_connections', [
            'requester_user_id' => (int) $optedOut->id,
            'requester_tenant_id' => $this->testTenantId,
            'receiver_user_id' => (int) $target->id,
            'receiver_tenant_id' => $partner,
        ]);

        // FIXED — and nobody in the other community was notified.
        $this->assertDatabaseMissing('notifications', [
            'user_id' => (int) $target->id,
            'tenant_id' => $partner,
            'type' => 'federation_connection',
        ]);
    }

    public function test_an_opted_out_member_cannot_accept_reject_remove_or_read_a_connection(): void
    {
        $partner = $this->seedPartnerTenant('F373b Partner');
        $this->seedPartnership($partner);

        $optedOut = $this->seedFederatedUser($this->testTenantId, [], ['federation_optin' => 0]);
        $other = $this->seedFederatedUser($partner);

        $incoming = $this->seedConnection($other, $partner, $optedOut, $this->testTenantId, 'pending');
        $accepted = $this->seedConnection($optedOut, $this->testTenantId, $other, $partner, 'accepted');

        Sanctum::actingAs($optedOut, ['*']);
        $this->apiPost('/v2/federation/connections/' . $incoming . '/accept')->assertStatus(403);

        Sanctum::actingAs($optedOut, ['*']);
        $this->apiPost('/v2/federation/connections/' . $incoming . '/reject')->assertStatus(403);

        Sanctum::actingAs($optedOut, ['*']);
        $this->apiDelete('/v2/federation/connections/' . $accepted)->assertStatus(403);

        Sanctum::actingAs($optedOut, ['*']);
        $this->apiGet('/v2/federation/connections/status/' . $other->id . '/' . $partner)->assertStatus(403);

        // Nothing changed state.
        $this->assertSame('pending', (string) DB::table('federation_connections')->where('id', $incoming)->value('status'));
        $this->assertSame('accepted', (string) DB::table('federation_connections')->where('id', $accepted)->value('status'));
    }

    /* =====================================================================
     * CONTROL — the same five routes still work for a member who IS opted in,
     * so the gate is a gate and not a wall.
     * ================================================================== */
    public function test_control_an_opted_in_member_can_still_use_every_connection_route(): void
    {
        $partner = $this->seedPartnerTenant('F373c Partner');
        $this->seedPartnership($partner);

        $member = $this->seedFederatedUser($this->testTenantId);
        $other = $this->seedFederatedUser($partner);

        Sanctum::actingAs($member, ['*']);
        $this->apiPost('/v2/federation/connections', [
            'receiver_id' => (int) $other->id,
            'receiver_tenant_id' => $partner,
            'message' => 'F-373 control',
        ])->assertStatus(201);

        Sanctum::actingAs($member, ['*']);
        $this->apiGet('/v2/federation/connections/status/' . $other->id . '/' . $partner)
            ->assertOk()
            ->assertJsonPath('data.status', 'pending');

        $pendingId = (int) DB::table('federation_connections')
            ->where('requester_user_id', (int) $member->id)
            ->where('receiver_user_id', (int) $other->id)
            ->value('id');

        // The recipient, in the other community, accepts it.
        $this->withTenant($partner);
        Sanctum::actingAs($other, ['*']);
        $this->apiPost('/v2/federation/connections/' . $pendingId . '/accept')->assertOk();

        $this->withTenant($partner);
        Sanctum::actingAs($other, ['*']);
        $this->apiDelete('/v2/federation/connections/' . $pendingId)->assertOk();

        $this->assertDatabaseMissing('federation_connections', ['id' => $pendingId]);
    }
}
