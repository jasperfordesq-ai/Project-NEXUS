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
 * F-351 (E-065 slice K, K-1) — a member who switched off "visible to other
 * communities" must not be reachable by a cross-community connection request,
 * and their name and avatar must not be handed to the other community.
 *
 * `FederatedConnectionService::sendRequest()` read the receiver's
 * `federation_optin` and `messaging_enabled_federated` ONLY — it never read
 * `profile_visible_federated` — and `getConnections()` LEFT JOINed the
 * counterparty's name and avatar with no federation filter at all. The same
 * controller's documented read surface does apply that flag: `member()`
 * answers 404 for exactly the member `sendConnectionRequest()` let through.
 *
 * Adapted from the E-065 reproduction
 * `.local-docs-archive/security-log/E-065/repro/k/FederationConnectionsOptInTest.php`,
 * which PASSES while the bug exists (it asserts the bad outcome succeeds). The
 * assertions here are INVERTED so this file is red before the fix and green
 * after it. The legitimate-access controls from that reproduction are kept as
 * they were.
 */
final class F351FederatedConnectionVisibilityTest extends TestCase
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

    /**
     * @param array<int,array<string,mixed>> $rows
     * @return array<string,mixed>|null
     */
    private function rowFor(array $rows, User $user): ?array
    {
        foreach ($rows as $row) {
            if ((int) ($row['user_id'] ?? 0) === (int) $user->id) {
                return $row;
            }
        }

        return null;
    }

    /* =====================================================================
     * The write path. A hidden member must not be reachable at all.
     * ================================================================== */
    public function test_a_member_hidden_from_federated_profiles_cannot_be_sent_a_connection_request(): void
    {
        $partner = $this->seedPartnerTenant('F351 Partner');
        $this->seedPartnership($partner);

        $viewer = $this->seedFederatedUser($this->testTenantId);

        // Opted into federation, but has switched OFF being visible to other
        // communities and off appearing in federated search.
        $hidden = $this->seedFederatedUser($partner, [
            'first_name' => 'Hidden',
            'last_name' => 'F351subject',
            'avatar_url' => '/uploads/f351-hidden-avatar.png',
        ], [
            'profile_visible_federated' => 0,
            'appear_in_federated_search' => 0,
        ]);

        // CONTROL — a fully visible member of the SAME partner community,
        // differing only in the flags under test.
        $visible = $this->seedFederatedUser($partner, [
            'first_name' => 'Visible',
            'last_name' => 'F351control',
        ]);

        Sanctum::actingAs($viewer, ['*']);
        $listed = $this->apiGet('/v2/federation/members')->assertOk()->json('data') ?? [];
        $listedIds = array_map(static fn ($r) => (int) ($r['id'] ?? 0), $listed);
        $this->assertContains((int) $visible->id, $listedIds, 'CONTROL: the visible partner member IS in federated search');
        $this->assertNotContains((int) $hidden->id, $listedIds, 'CONTROL: the hidden partner member is NOT in federated search');

        Sanctum::actingAs($viewer, ['*']);
        $this->apiGet('/v2/federation/members/' . $visible->id . '?tenant_id=' . $partner)
            ->assertOk()
            ->assertJsonPath('data.id', (int) $visible->id);

        Sanctum::actingAs($viewer, ['*']);
        $this->apiGet('/v2/federation/members/' . $hidden->id . '?tenant_id=' . $partner)
            ->assertStatus(404);

        // CONTROL — the legitimate request to the visible member still works.
        Sanctum::actingAs($viewer, ['*']);
        $this->apiPost('/v2/federation/connections', [
            'receiver_id' => (int) $visible->id,
            'receiver_tenant_id' => $partner,
            'message' => 'F-351 control',
        ])->assertStatus(201);

        // FIXED — the connection write path must apply the same rule the read
        // surface applies, and refuse the hidden member.
        Sanctum::actingAs($viewer, ['*']);
        $sent = $this->apiPost('/v2/federation/connections', [
            'receiver_id' => (int) $hidden->id,
            'receiver_tenant_id' => $partner,
            'message' => 'F-351 subject',
        ]);

        $this->assertNotSame(
            201,
            $sent->getStatusCode(),
            'a member who switched off "visible to other communities" must not be reachable by connection request',
        );

        $this->assertDatabaseMissing('federation_connections', [
            'requester_user_id' => (int) $viewer->id,
            'requester_tenant_id' => $this->testTenantId,
            'receiver_user_id' => (int) $hidden->id,
            'receiver_tenant_id' => $partner,
        ]);

        // FIXED — and nothing was told to the hidden member either.
        $this->assertDatabaseMissing('notifications', [
            'user_id' => (int) $hidden->id,
            'tenant_id' => $partner,
            'type' => 'federation_connection',
        ]);
    }

    /* =====================================================================
     * The read path. A member who becomes hidden AFTER the connection was
     * made must stop being named — but the row stays, so the other member can
     * still remove it.
     * ================================================================== */
    public function test_a_counterparty_who_becomes_hidden_is_no_longer_named_in_the_connection_list(): void
    {
        $partner = $this->seedPartnerTenant('F351b Partner');
        $this->seedPartnership($partner);

        $viewer = $this->seedFederatedUser($this->testTenantId);

        $hidden = $this->seedFederatedUser($partner, [
            'first_name' => 'Later',
            'last_name' => 'F351hidden',
            'avatar_url' => '/uploads/f351-later-avatar.png',
        ]);
        $visible = $this->seedFederatedUser($partner, [
            'first_name' => 'Still',
            'last_name' => 'F351visible',
            'avatar_url' => '/uploads/f351-visible-avatar.png',
        ]);

        foreach ([$hidden, $visible] as $other) {
            DB::table('federation_connections')->insert([
                'requester_user_id' => (int) $viewer->id,
                'requester_tenant_id' => $this->testTenantId,
                'receiver_user_id' => (int) $other->id,
                'receiver_tenant_id' => $partner,
                'status' => 'accepted',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        // The connection was made while both were visible; one of them now
        // switches off being visible to other communities.
        DB::table('federation_user_settings')
            ->where('user_id', (int) $hidden->id)
            ->update(['profile_visible_federated' => 0, 'updated_at' => now()]);

        Sanctum::actingAs($viewer, ['*']);
        $rows = $this->apiGet('/v2/federation/connections?status=accepted')->assertOk()->json('data') ?? [];

        // CONTROL — the member who is still visible is still named in full.
        $visibleRow = $this->rowFor($rows, $visible);
        $this->assertNotNull($visibleRow, 'CONTROL: the still-visible connection is listed');
        $this->assertSame('Still F351visible', $visibleRow['name'], 'CONTROL: a visible counterparty is still named');
        $this->assertSame('/uploads/f351-visible-avatar.png', $visibleRow['avatar_url'], 'CONTROL: and still shows their avatar');

        // FIXED — the hidden counterparty's row survives so the viewer can
        // still remove it, but their identity is no longer disclosed.
        $hiddenRow = $this->rowFor($rows, $hidden);
        $this->assertNotNull($hiddenRow, 'the connection itself stays so the member can still remove it');
        $this->assertNotSame(
            'Later F351hidden',
            $hiddenRow['name'],
            'a counterparty who switched off cross-community visibility must not have their name disclosed',
        );
        $this->assertNull(
            $hiddenRow['avatar_url'],
            'nor their avatar',
        );
    }
}
