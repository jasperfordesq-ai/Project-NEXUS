<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E065;

use App\Events\UserFederatedOptOut;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Concerns\FederationIntegrationHarness;
use Tests\Laravel\Feature\Security\E065\Concerns\SeedsInternalFederation;
use Tests\Laravel\TestCase;

/**
 * F-352 (E-065 slice K, K-2) — opting out of federation must END existing
 * cross-community connections.
 *
 * `FederationUserService::optOut()` flipped nine booleans on
 * `federation_user_settings` and touched nothing else — `grep -c
 * federation_connections` over that whole file returned 0 — so the partner
 * community kept reading the leaver's name and avatar from
 * `GET /v2/federation/connections`, and the status endpoint kept answering
 * "accepted". The `UserFederatedOptOut` listener is dispatched with the comment
 * "GDPR: propagate retraction to ALL federated partners", but it iterates
 * `federated_identities`, which exist only for EXTERNAL partners: internal
 * cross-community federation was never reached. Worse, opting out also removed
 * the member's own access to `DELETE /v2/federation/connections/{id}`, stripping
 * them of the ability to clean up the very connections the opt-out was meant
 * to end.
 *
 * 🔴 Owner decision, 30 September 2026: **sever the connections.** Switching off
 * cross-community visibility ends existing cross-community connections; a
 * notice was explicitly not chosen.
 *
 * Adapted from the E-065 reproduction
 * `.local-docs-archive/security-log/E-065/repro/k/FederationConnectionsOptInTest.php`,
 * which PASSES while the bug exists. Its assertions are INVERTED here; its
 * controls are kept.
 */
final class F352FederationOptOutSeversConnectionsTest extends TestCase
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

    private function connectionCountBetween(User $a, int $aTenant, User $b, int $bTenant): int
    {
        return (int) DB::table('federation_connections')
            ->where(function ($q) use ($a, $aTenant, $b, $bTenant) {
                $q->where('requester_user_id', (int) $a->id)
                    ->where('requester_tenant_id', $aTenant)
                    ->where('receiver_user_id', (int) $b->id)
                    ->where('receiver_tenant_id', $bTenant);
            })
            ->orWhere(function ($q) use ($a, $aTenant, $b, $bTenant) {
                $q->where('requester_user_id', (int) $b->id)
                    ->where('requester_tenant_id', $bTenant)
                    ->where('receiver_user_id', (int) $a->id)
                    ->where('receiver_tenant_id', $aTenant);
            })
            ->count();
    }

    private function seedConnection(User $requester, int $requesterTenant, User $receiver, int $receiverTenant, string $status): void
    {
        DB::table('federation_connections')->insert([
            'requester_user_id' => (int) $requester->id,
            'requester_tenant_id' => $requesterTenant,
            'receiver_user_id' => (int) $receiver->id,
            'receiver_tenant_id' => $receiverTenant,
            'status' => $status,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /* =====================================================================
     * The member opts out through the platform's own route.
     * ================================================================== */
    public function test_opting_out_of_federation_ends_existing_cross_community_connections(): void
    {
        $partner = $this->seedPartnerTenant('F352 Partner');
        $this->seedPartnership($partner);
        $home = $this->testTenantId;

        $leaver = $this->seedFederatedUser($home, [
            'first_name' => 'Leaver',
            'last_name' => 'F352quit',
            'avatar_url' => '/uploads/f352-leaver-avatar.png',
        ]);
        $counterparty = $this->seedFederatedUser($partner);

        // A connection the leaver started, and one started by the other side:
        // severing must work in BOTH directions.
        $this->seedConnection($leaver, $home, $counterparty, $partner, 'accepted');
        $this->seedConnection($counterparty, $partner, $leaver, $home, 'pending');

        // CONTROL — an unrelated pair in the same two communities, whose
        // connection must survive untouched.
        $bystander = $this->seedFederatedUser($home);
        $this->seedConnection($bystander, $home, $counterparty, $partner, 'accepted');

        $this->assertSame(2, $this->connectionCountBetween($leaver, $home, $counterparty, $partner), 'fixture: both connections exist first');

        // The member withdraws from federation through the platform's own route.
        Sanctum::actingAs($leaver, ['*']);
        $this->apiPost('/v2/federation/opt-out')->assertOk();

        $this->assertSame(0, (int) DB::table('federation_user_settings')
            ->where('user_id', (int) $leaver->id)
            ->value('federation_optin'), 'the opt-out was recorded');

        // FIXED — the connections are gone, in both directions.
        $this->assertSame(
            0,
            $this->connectionCountBetween($leaver, $home, $counterparty, $partner),
            'opting out of federation must end existing cross-community connections',
        );

        // CONTROL — the unrelated pair is untouched.
        $this->assertSame(
            1,
            $this->connectionCountBetween($bystander, $home, $counterparty, $partner),
            'CONTROL: another member\'s connection must not be severed',
        );

        // CONTROL (kept from the reproduction) — the opt-out is still enforced
        // on the read and write surfaces the leaver themselves uses.
        Sanctum::actingAs($leaver, ['*']);
        $this->apiGet('/v2/federation/connections')->assertStatus(403);

        Sanctum::actingAs($leaver, ['*']);
        $this->apiPost('/v2/federation/messages', [
            'receiver_id' => (int) $counterparty->id,
            'receiver_tenant_id' => $partner,
            'subject' => 'F352',
            'body' => 'F352 control',
        ])->assertStatus(403);

        // FIXED — the partner community no longer reads the leaver at all.
        $this->withTenant($partner);
        Sanctum::actingAs($counterparty, ['*']);
        $rows = $this->apiGet('/v2/federation/connections?status=accepted')->assertOk()->json('data') ?? [];
        $leaverIds = array_map(static fn ($r) => (int) ($r['user_id'] ?? 0), $rows);
        $this->assertNotContains(
            (int) $leaver->id,
            $leaverIds,
            'the opted-out member must no longer be listed to the partner community',
        );

        // CONTROL — the bystander's connection is still listed to the same
        // partner-community member, so the list itself still works.
        $this->withTenant($partner);
        Sanctum::actingAs($counterparty, ['*']);
        $rows = $this->apiGet('/v2/federation/connections?status=accepted')->assertOk()->json('data') ?? [];
        $this->assertContains(
            (int) $bystander->id,
            array_map(static fn ($r) => (int) ($r['user_id'] ?? 0), $rows),
            'CONTROL: the unrelated connection is still listed',
        );

        // FIXED — and the status endpoint no longer answers "accepted".
        $this->withTenant($partner);
        Sanctum::actingAs($counterparty, ['*']);
        $this->apiGet('/v2/federation/connections/status/' . $leaver->id . '/' . $home)
            ->assertOk()
            ->assertJsonPath('data.status', 'none');
    }

    /* =====================================================================
     * The GDPR erasure path. `UserFederatedOptOut` is also dispatched with
     * reason 'account_deleted' by GdprService and UserService, and its listener
     * claims to reach "all federated partners". Internal partners must now be
     * among them.
     * ================================================================== */
    public function test_the_retraction_listener_also_severs_internal_connections(): void
    {
        $partner = $this->seedPartnerTenant('F352b Partner');
        $this->seedPartnership($partner);
        $home = $this->testTenantId;

        $erased = $this->seedFederatedUser($home);
        $counterparty = $this->seedFederatedUser($partner);
        $bystander = $this->seedFederatedUser($home);

        $this->seedConnection($erased, $home, $counterparty, $partner, 'accepted');
        $this->seedConnection($bystander, $home, $counterparty, $partner, 'accepted');

        UserFederatedOptOut::dispatch((int) $erased->id, $home, 'account_deleted');

        $this->assertSame(
            0,
            $this->connectionCountBetween($erased, $home, $counterparty, $partner),
            'the GDPR retraction must reach internal cross-community connections too',
        );

        $this->assertSame(
            1,
            $this->connectionCountBetween($bystander, $home, $counterparty, $partner),
            'CONTROL: nobody else\'s connection is removed',
        );
    }
}
