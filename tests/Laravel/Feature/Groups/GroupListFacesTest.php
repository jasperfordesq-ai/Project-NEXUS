<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Groups;

use App\Models\Group;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Faces on group cards (AWID feedback, Nov 2026: "community"). GET /v2/groups
 * adds `recent_members` — up to three of the most recent active members, never
 * the viewer — but ONLY on groups whose members the viewer may already see on
 * the group page (GroupAccessService::canViewMemberContent: a member, the
 * owner, or a community administrator). First names only for everyone else,
 * as on the group page itself (F-084).
 */
class GroupListFacesTest extends TestCase
{
    use DatabaseTransactions;

    private function member(string $first, array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'first_name' => $first,
            'last_name' => 'Surname' . $first,
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
    }

    private function group(string $visibility = 'public'): Group
    {
        return Group::factory()->create([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $this->member('Owner')->id,
            'visibility' => $visibility,
            'is_featured' => true, // listed whatever its parent
        ]);
    }

    private function join(Group $group, User $user, string $status = 'active', string $when = 'now'): void
    {
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $group->id,
            'user_id' => $user->id,
            'role' => 'member',
            'status' => $status,
            'created_at' => $when === 'now' ? now() : $when,
        ]);
    }

    /** @return array<int, array<string, mixed>> */
    private function listedGroups(): array
    {
        $rows = $this->apiGet('/v2/groups?limit=100')->assertOk()->json('data') ?? [];
        return collect($rows)->keyBy('id')->all();
    }

    public function test_a_member_sees_up_to_three_recent_faces_first_names_only_never_their_own(): void
    {
        $viewer = $this->member('Viewer');
        $group = $this->group();
        $this->join($group, $viewer, 'active', now()->toDateTimeString());
        $this->join($group, $this->member('Aine'), 'active', now()->subDays(4)->toDateTimeString());
        $this->join($group, $this->member('Brid'), 'active', now()->subDays(3)->toDateTimeString());
        $this->join($group, $this->member('Cian'), 'active', now()->subDays(2)->toDateTimeString());
        $this->join($group, $this->member('Dara'), 'active', now()->subDay()->toDateTimeString());
        Sanctum::actingAs($viewer, ['*']);

        $faces = $this->listedGroups()[$group->id]['recent_members'] ?? null;

        $this->assertIsArray($faces);
        $this->assertSame(['Dara', 'Cian', 'Brid'], array_column($faces, 'name'));
        foreach ($faces as $face) {
            $this->assertArrayNotHasKey('last_name', $face);
            $this->assertStringNotContainsString('Surname', json_encode($face));
        }
    }

    public function test_no_faces_on_a_group_the_viewer_is_not_in(): void
    {
        $viewer = $this->member('Viewer');
        $group = $this->group('public');
        $this->join($group, $this->member('Aine'));
        Sanctum::actingAs($viewer, ['*']);

        $listed = $this->listedGroups()[$group->id] ?? null;
        $this->assertNotNull($listed, 'a public group is listed');
        $this->assertSame([], $listed['recent_members'] ?? []);
    }

    public function test_waiting_and_suspended_members_are_not_shown(): void
    {
        $viewer = $this->member('Viewer');
        $group = $this->group();
        $this->join($group, $viewer);
        $this->join($group, $this->member('Pending'), 'pending');
        $this->join($group, $this->member('Gone', ['status' => 'suspended']));
        $this->join($group, $this->member('Here'));
        Sanctum::actingAs($viewer, ['*']);

        $faces = $this->listedGroups()[$group->id]['recent_members'] ?? [];
        $this->assertSame(['Here'], array_column($faces, 'name'));
    }

    public function test_the_owner_sees_faces_on_their_own_group(): void
    {
        $owner = $this->member('Ownerin');
        $group = Group::factory()->create([
            'tenant_id' => $this->testTenantId, 'owner_id' => $owner->id, 'visibility' => 'private', 'is_featured' => true,
        ]);
        $this->join($group, $this->member('Aine'));
        Sanctum::actingAs($owner, ['*']);

        $faces = $this->listedGroups()[$group->id]['recent_members'] ?? [];
        $this->assertSame(['Aine'], array_column($faces, 'name'));
    }
}
