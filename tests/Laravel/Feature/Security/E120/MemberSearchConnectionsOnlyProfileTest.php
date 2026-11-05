<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E120;

use App\Models\User;
use App\Services\TokenService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * GHSA-5xvc-5v7p-7jh7 (reported against 86adbf339, 27 Sep 2026): an ORDINARY
 * member could find a same-community member who chose "connections only"
 * through GET /v2/users/search, with no accepted connection between them.
 *
 * Fixed by 336b6f1a1 (F-574), which added MemberProfileVisibility::applyToQuery
 * with the viewer id to UserService::search(). F-574's own test is framed as
 * the "unapproved admin" case; this pins the reporter's exact request: a
 * bearer token from TokenService, `?q=PrivateSearchTarget&limit=1`, a plain
 * member, and no `connections` row.
 */
class MemberSearchConnectionsOnlyProfileTest extends TestCase
{
    use DatabaseTransactions;

    private function bearer(User $user): array
    {
        return ['Authorization' => 'Bearer ' . app(TokenService::class)
            ->generateToken((int) $user->id, $this->testTenantId)];
    }

    private function viewer(string $role = 'member'): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'role' => $role, 'status' => 'active', 'is_approved' => true,
            'onboarding_completed' => true,
        ]);
    }

    private function target(string $firstName, string $privacy): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => $firstName,
            'last_name' => 'Hidden',
            'status' => 'active',
            'is_approved' => true,
            'privacy_profile' => $privacy,
            'privacy_search' => true,
            'onboarding_completed' => true,
            'bio' => 'GHSA-5xvc synthetic bio',
            'tagline' => 'GHSA-5xvc synthetic tagline',
            'location' => 'GHSA-5xvc synthetic location',
        ]);
    }

    /** @return list<int> */
    private function searchIds(User $viewer, string $q, int $limit = 1, bool $bearer = true): array
    {
        // A staff bearer token needs an MFA claim; staff sessions use Sanctum.
        if (!$bearer) {
            Sanctum::actingAs($viewer);
        }
        $response = $this->apiGet('/v2/users/search?q=' . urlencode($q) . '&limit=' . $limit,
            $bearer ? $this->bearer($viewer) : []);
        $response->assertStatus(200);

        return array_map('intval', array_column($response->json('data.items') ?? [], 'id'));
    }

    public function test_reporter_request_unconnected_member_cannot_find_connections_only_profile(): void
    {
        $target = $this->target('PrivateSearchTarget', 'connections');
        $requester = $this->viewer();
        $this->assertSame(0, DB::table('connections')
            ->where('tenant_id', $this->testTenantId)
            ->whereIn('requester_id', [$requester->id, $target->id])
            ->whereIn('receiver_id', [$requester->id, $target->id])
            ->count());

        $this->assertNotContains((int) $target->id, $this->searchIds($requester, 'PrivateSearchTarget'));
    }

    public function test_pending_connection_does_not_unlock_connections_only_profile(): void
    {
        $target = $this->target('PrivateSearchPending', 'connections');
        $requester = $this->viewer();
        DB::table('connections')->insert([
            'tenant_id' => $this->testTenantId, 'requester_id' => $requester->id,
            'receiver_id' => $target->id, 'status' => 'pending', 'created_at' => now(),
        ]);

        $this->assertNotContains((int) $target->id, $this->searchIds($requester, 'PrivateSearchPending'));
    }

    public function test_broker_is_not_an_admin_for_the_privacy_exemption(): void
    {
        $target = $this->target('PrivateSearchBroker', 'connections');

        $this->assertNotContains((int) $target->id, $this->searchIds($this->viewer('broker'), 'PrivateSearchBroker', 1, false));
    }

    public function test_control_accepted_connection_can_find_connections_only_profile(): void
    {
        $target = $this->target('PrivateSearchConnected', 'connections');
        $requester = $this->viewer();
        DB::table('connections')->insert([
            'tenant_id' => $this->testTenantId, 'requester_id' => $target->id,
            'receiver_id' => $requester->id, 'status' => 'accepted', 'created_at' => now(),
        ]);

        $this->assertSame([(int) $target->id], $this->searchIds($requester, 'PrivateSearchConnected'));
    }

    public function test_control_members_visibility_profile_is_found_by_unconnected_member(): void
    {
        $target = $this->target('MembersSearchTarget', 'members');

        $this->assertSame([(int) $target->id], $this->searchIds($this->viewer(), 'MembersSearchTarget'));
    }
}
