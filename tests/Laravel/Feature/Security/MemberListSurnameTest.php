<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-084 (E-027) — surnames are private to administrators on the profile,
 * member search and directory, but other member lists printed full names.
 * This pins the group member list and the gamification leaderboard (the
 * connections list is pinned by ConnectionListPrivacyTest).
 */
class MemberListSurnameTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        TenantContext::setById($this->testTenantId);
    }

    public function test_group_member_list_shows_first_names_to_members(): void
    {
        $owner = $this->member();
        $viewer = $this->member();
        $other = $this->member(['first_name' => 'Gina', 'last_name' => 'Groupsurname', 'name' => 'Gina Groupsurname']);
        $org = $this->member([
            'first_name' => 'Contact',
            'last_name' => 'Personsurname',
            'profile_type' => 'organisation',
            'organization_name' => 'Helping Hands Ltd',
        ]);
        $groupId = $this->group($owner, [$viewer, $other, $org]);

        Sanctum::actingAs($viewer, ['*']);
        $response = $this->apiGet("/v2/groups/{$groupId}/members?per_page=100")->assertStatus(200);

        $byId = $this->indexById($response->json('data') ?? []);
        $this->assertSame('Gina', $byId[$other->id]['name']);
        $this->assertSame('Helping Hands Ltd', $byId[$org->id]['name'], 'An organisation keeps its trading name.');
        $body = (string) $response->getContent();
        $this->assertStringNotContainsString('Groupsurname', $body);
        $this->assertStringNotContainsString('Personsurname', $body);
    }

    public function test_admin_sees_full_names_in_group_member_list(): void
    {
        $owner = $this->member();
        $admin = $this->member(['role' => 'admin']);
        $other = $this->member(['first_name' => 'Gary', 'last_name' => 'Adminvisible', 'name' => 'Gary Adminvisible']);
        $groupId = $this->group($owner, [$other]);

        Sanctum::actingAs($admin, ['*']);
        $byId = $this->indexById($this->apiGet("/v2/groups/{$groupId}/members?per_page=100")->assertStatus(200)->json('data') ?? []);

        $this->assertSame('Gary Adminvisible', $byId[$other->id]['name']);
    }

    public function test_leaderboard_shows_first_names_to_members(): void
    {
        $leader = $this->member([
            'first_name' => 'Lara',
            'last_name' => 'Leadersurname',
            'name' => 'Lara Leadersurname',
            'xp' => 900000000,
            'show_on_leaderboard' => 1,
        ]);
        Sanctum::actingAs($this->member(), ['*']);

        $response = $this->apiGet('/v2/gamification/leaderboard?type=xp&period=all&limit=5')->assertStatus(200);

        $entry = collect($response->json('data') ?? [])->firstWhere('user.id', $leader->id);
        $this->assertNotNull($entry, 'The fixture tops the XP leaderboard.');
        $this->assertSame('Lara', $entry['user']['name']);
        $this->assertStringNotContainsString('Leadersurname', (string) $response->getContent());
    }

    // ------------------------------------------------------------------

    /** @param list<User> $members */
    private function group(User $owner, array $members): int
    {
        $groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $owner->id,
            'name' => 'Surname fixture ' . bin2hex(random_bytes(3)),
            'description' => 'F-084 fixture',
            'visibility' => 'public',
            'status' => 'active',
            'is_active' => 1,
            'created_at' => now(),
        ]);
        $rows = [['user' => $owner, 'role' => 'owner']];
        foreach ($members as $m) {
            $rows[] = ['user' => $m, 'role' => 'member'];
        }
        foreach ($rows as $row) {
            DB::table('group_members')->insert([
                'tenant_id' => $this->testTenantId,
                'group_id' => $groupId,
                'user_id' => $row['user']->id,
                'role' => $row['role'],
                'status' => 'active',
                'created_at' => now(),
            ]);
        }

        return $groupId;
    }

    /**
     * @param  list<array<string, mixed>> $rows
     * @return array<int, array<string, mixed>>
     */
    private function indexById(array $rows): array
    {
        $out = [];
        foreach ($rows as $row) {
            $out[(int) $row['id']] = (array) $row;
        }

        return $out;
    }

    /** @param array<string, mixed> $overrides */
    private function member(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
        TenantContext::setById($this->testTenantId);

        return $user;
    }
}
