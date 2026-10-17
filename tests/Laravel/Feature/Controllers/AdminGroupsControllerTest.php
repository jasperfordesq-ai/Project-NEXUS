<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Enums\GroupStatus;
use App\Models\Group;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Routing\Route as LaravelRoute;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for AdminGroupsController.
 *
 * Covers index, analytics, approvals, moderation, group types, members,
 * recommendations, featured groups, and group CRUD.
 */
class AdminGroupsControllerTest extends TestCase
{
    use DatabaseTransactions;

    // ================================================================
    // INDEX — GET /v2/admin/groups
    // ================================================================

    public function test_index_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/groups');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_index_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/groups');

        $response->assertStatus(403);
    }

    public function test_index_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/groups');

        $response->assertStatus(401);
    }

    // ================================================================
    // ANALYTICS — GET /v2/admin/groups/analytics
    // ================================================================

    public function test_analytics_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/groups/analytics');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_analytics_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/groups/analytics');

        $response->assertStatus(403);
    }

    // ================================================================
    // APPROVALS — GET /v2/admin/groups/approvals
    // ================================================================

    public function test_approvals_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/groups/approvals');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // MODERATION — GET /v2/admin/groups/moderation
    // ================================================================

    public function test_moderation_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/groups/moderation');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // GROUP TYPES — GET /v2/admin/groups/types
    // ================================================================

    public function test_group_types_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/groups/types');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_group_types_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/groups/types');

        $response->assertStatus(403);
    }

    // ================================================================
    // FEATURED — GET /v2/admin/groups/featured
    // ================================================================

    public function test_featured_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/groups/featured');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // RECOMMENDATIONS — GET /v2/admin/groups/recommendations
    // ================================================================

    public function test_recommendations_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/groups/recommendations');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // SHOW — GET /v2/admin/groups/{id}
    // ================================================================

    public function test_show_returns_404_for_nonexistent_group(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/groups/99999');

        $response->assertStatus(404);
    }

    public function test_show_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/groups/1');

        $response->assertStatus(403);
    }

    // ================================================================
    // DELETE — DELETE /v2/admin/groups/{id}
    // ================================================================

    public function test_delete_returns_404_for_nonexistent_group(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiDelete('/v2/admin/groups/99999');

        $response->assertStatus(404);
    }

    public function test_delete_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiDelete('/v2/admin/groups/1');

        $response->assertStatus(401);
    }

    public function test_status_update_uses_canonical_lifecycle_and_mirror(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $group = Group::factory()->forTenant($this->testTenantId)->create(['owner_id' => $admin->id]);
        Sanctum::actingAs($admin);

        $this->apiPut('/v2/admin/groups/' . $group->id . '/status', [
            'status' => GroupStatus::Dormant->value,
        ])->assertOk()->assertJsonPath('data.status', GroupStatus::Dormant->value);

        $stored = DB::table('groups')->where('id', $group->id)->first(['status', 'is_active']);
        self::assertSame(GroupStatus::Dormant->value, $stored->status);
        self::assertSame(0, (int) $stored->is_active);
        self::assertSame(1, DB::table('group_audit_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('group_id', $group->id)
            ->where('action', 'group_status_changed')
            ->count());
    }

    public function test_status_update_conceals_a_group_from_another_tenant(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $foreignOwner = User::factory()->forTenant(999)->create();
        $foreign = Group::factory()->forTenant(999)->create(['owner_id' => $foreignOwner->id]);
        Sanctum::actingAs($admin);

        $this->apiPut('/v2/admin/groups/' . $foreign->id . '/status', [
            'status' => GroupStatus::Dormant->value,
        ])->assertNotFound();

        self::assertSame(
            GroupStatus::Active->value,
            DB::table('groups')->where('id', $foreign->id)->value('status'),
        );
    }

    public function test_audit_log_is_addressable_paginated_filtered_and_tenant_scoped(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $group = Group::factory()->forTenant($this->testTenantId)->create(['owner_id' => $admin->id]);
        foreach (['group_updated', 'member_joined', 'group_updated'] as $index => $action) {
            DB::table('group_audit_log')->insert([
                'tenant_id' => $this->testTenantId,
                'group_id' => $group->id,
                'user_id' => $admin->id,
                'action' => $action,
                'details' => json_encode(['index' => $index], JSON_THROW_ON_ERROR),
                'created_at' => now()->addSeconds($index),
            ]);
        }
        Sanctum::actingAs($admin);

        $response = $this->apiGet("/v2/admin/groups/{$group->id}/audit-log?action=group_updated&per_page=1")
            ->assertOk()
            ->assertJsonCount(1, 'data.items')
            ->assertJsonPath('data.items.0.action', 'group_updated')
            ->assertJsonPath('data.pagination.has_more', true);
        self::assertContains('member_joined', $response->json('data.actions'));

        $foreignOwner = User::factory()->forTenant(999)->create();
        $foreignGroup = Group::factory()->forTenant(999)->create(['owner_id' => $foreignOwner->id]);
        $this->apiGet("/v2/admin/groups/{$foreignGroup->id}/audit-log")->assertNotFound();
    }

    public function test_direct_admin_update_uses_canonical_validation_audit_and_tenant_scope(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $group = Group::factory()->forTenant($this->testTenantId)->create([
            'owner_id' => $admin->id,
            'name' => 'Original admin group',
            'description' => 'Original admin group description.',
            'visibility' => 'public',
        ]);
        Sanctum::actingAs($admin);

        foreach ([
            [['name' => ''], 'name'],
            [['description' => str_repeat('x', 5001)], 'description'],
            [['visibility' => 'hidden'], 'visibility'],
            [['location' => str_repeat('x', 256)], 'location'],
            [['federated_visibility' => 'global'], 'federated_visibility'],
            [['primary_color' => 'blue'], 'primary_color'],
            [['cover_image_url' => 'https://example.test/unsafe.jpg'], 'cover_image_url'],
            [['is_featured' => true], 'is_featured'],
        ] as [$payload, $field]) {
            $this->apiPut("/v2/admin/groups/{$group->id}", $payload)
                ->assertStatus(422)
                ->assertJsonPath('errors.0.code', 'VALIDATION_ERROR')
                ->assertJsonPath('errors.0.field', $field);
        }

        $this->assertDatabaseHas('groups', [
            'id' => $group->id,
            'name' => 'Original admin group',
            'visibility' => 'public',
        ]);
        self::assertSame(0, DB::table('group_audit_log')->where('group_id', $group->id)->count());

        $this->apiPut("/v2/admin/groups/{$group->id}", [
            'name' => 'Canonical admin update',
            'description' => 'A safely validated replacement description.',
            'visibility' => 'private',
            'location' => 'Dublin',
            'primary_color' => '#aabbcc',
            'federated_visibility' => 'listed',
        ])->assertOk()->assertJsonPath('data.updated', true);

        $this->assertDatabaseHas('groups', [
            'id' => $group->id,
            'name' => 'Canonical admin update',
            'visibility' => 'private',
            'primary_color' => '#AABBCC',
            'federated_visibility' => 'listed',
        ]);
        self::assertSame(1, DB::table('group_audit_log')
            ->where('group_id', $group->id)
            ->where('action', 'group_updated')
            ->count());

        $foreignOwner = User::factory()->forTenant(999)->create();
        $foreignGroup = Group::factory()->forTenant(999)->create(['owner_id' => $foreignOwner->id]);
        $this->apiPut("/v2/admin/groups/{$foreignGroup->id}", ['name' => 'Cross tenant overwrite'])
            ->assertNotFound();
        self::assertNotSame(
            'Cross tenant overwrite',
            DB::table('groups')->where('id', $foreignGroup->id)->value('name'),
        );
    }

    public function test_transfer_and_clone_endpoints_preserve_lifecycle_contract_and_conceal_foreign_source(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        $newOwner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $group = Group::factory()->forTenant($this->testTenantId)->create([
            'owner_id' => $admin->id,
            'status' => GroupStatus::Active->value,
            'is_active' => true,
        ]);
        DB::table('group_members')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'group_id' => $group->id,
                'user_id' => $admin->id,
                'role' => 'owner',
                'status' => 'active',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'group_id' => $group->id,
                'user_id' => $newOwner->id,
                'role' => 'member',
                'status' => 'active',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);
        Sanctum::actingAs($admin);

        $this->apiPost("/v2/admin/groups/{$group->id}/transfer-ownership", [])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'new_owner_id');
        $this->apiPost("/v2/admin/groups/{$group->id}/transfer-ownership", [
            'new_owner_id' => $newOwner->id,
        ])->assertOk();
        self::assertSame((int) $newOwner->id, (int) DB::table('groups')->where('id', $group->id)->value('owner_id'));

        $clone = $this->apiPost("/v2/admin/groups/{$group->id}/clone", [
            'name' => 'Controller lifecycle clone',
            'clone_members' => true,
        ])->assertOk();
        $cloneId = (int) $clone->json('data.id');
        $this->assertDatabaseHas('groups', [
            'id' => $cloneId,
            'tenant_id' => $this->testTenantId,
            'owner_id' => $admin->id,
            'name' => 'Controller lifecycle clone',
        ]);

        $foreignOwner = User::factory()->forTenant(999)->create();
        $foreignGroup = Group::factory()->forTenant(999)->create(['owner_id' => $foreignOwner->id]);
        $this->apiPost("/v2/admin/groups/{$foreignGroup->id}/clone", ['name' => 'Hidden clone'])
            ->assertNotFound();
        $this->apiPost("/v2/admin/groups/{$foreignGroup->id}/transfer-ownership", [
            'new_owner_id' => $newOwner->id,
        ])->assertNotFound();
    }

    public function test_admin_membership_routes_use_canonical_audited_services_and_protect_owner(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $approved = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $rejected = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $group = Group::factory()->forTenant($this->testTenantId)->create([
            'owner_id' => $owner->id,
            'status' => GroupStatus::Active->value,
            'is_active' => true,
            'cached_member_count' => 2,
        ]);
        $now = now();
        DB::table('group_members')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'group_id' => $group->id,
                'user_id' => $owner->id,
                'role' => 'owner',
                'status' => 'active',
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'tenant_id' => $this->testTenantId,
                'group_id' => $group->id,
                'user_id' => $member->id,
                'role' => 'member',
                'status' => 'active',
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'tenant_id' => $this->testTenantId,
                'group_id' => $group->id,
                'user_id' => $approved->id,
                'role' => 'member',
                'status' => 'pending',
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'tenant_id' => $this->testTenantId,
                'group_id' => $group->id,
                'user_id' => $rejected->id,
                'role' => 'member',
                'status' => 'pending',
                'created_at' => $now,
                'updated_at' => $now,
            ],
        ]);
        $approveMembershipId = (int) DB::table('group_members')
            ->where('group_id', $group->id)
            ->where('user_id', $approved->id)
            ->value('id');
        $rejectMembershipId = (int) DB::table('group_members')
            ->where('group_id', $group->id)
            ->where('user_id', $rejected->id)
            ->value('id');
        Sanctum::actingAs($admin);

        $this->apiPost("/v2/admin/groups/approvals/{$approveMembershipId}/approve")->assertOk();
        $this->assertDatabaseHas('group_members', [
            'id' => $approveMembershipId,
            'status' => 'active',
        ]);
        self::assertSame(3, (int) DB::table('groups')->where('id', $group->id)->value('cached_member_count'));

        $this->apiPost("/v2/admin/groups/approvals/{$rejectMembershipId}/reject")->assertOk();
        $this->assertDatabaseMissing('group_members', ['id' => $rejectMembershipId]);
        self::assertSame(3, (int) DB::table('groups')->where('id', $group->id)->value('cached_member_count'));

        $this->apiPost("/v2/admin/groups/{$group->id}/members/{$member->id}/promote")
            ->assertOk()
            ->assertJsonPath('data.role', 'admin');
        $this->apiPost("/v2/admin/groups/{$group->id}/members/{$member->id}/promote")
            ->assertOk()
            ->assertJsonPath('data.role', 'admin');
        self::assertSame('admin', DB::table('group_members')
            ->where('group_id', $group->id)->where('user_id', $member->id)->value('role'));

        $this->apiPost("/v2/admin/groups/{$group->id}/members/{$member->id}/demote")
            ->assertOk()
            ->assertJsonPath('data.role', 'member');
        $this->apiPost("/v2/admin/groups/{$group->id}/members/{$owner->id}/promote")->assertForbidden();
        $this->apiDelete("/v2/admin/groups/{$group->id}/members/{$owner->id}")->assertForbidden();
        self::assertSame('owner', DB::table('group_members')
            ->where('group_id', $group->id)->where('user_id', $owner->id)->value('role'));

        $this->apiDelete("/v2/admin/groups/{$group->id}/members/{$member->id}")->assertOk();
        $this->assertDatabaseMissing('group_members', [
            'group_id' => $group->id,
            'user_id' => $member->id,
        ]);
        self::assertSame(2, (int) DB::table('groups')->where('id', $group->id)->value('cached_member_count'));

        $audits = DB::table('group_audit_log')
            ->where('group_id', $group->id)
            ->whereIn('action', [
                'member_joined',
                'member_join_rejected',
                'member_role_changed',
                'member_removed',
            ])
            ->get();
        self::assertSame(5, $audits->count());
        self::assertTrue($audits->every(static fn (object $audit): bool => (int) $audit->user_id === (int) $admin->id));

        $foreignOwner = User::factory()->forTenant(999)->create(['status' => 'active']);
        $foreignMember = User::factory()->forTenant(999)->create(['status' => 'active']);
        $foreignGroup = Group::factory()->forTenant(999)->create(['owner_id' => $foreignOwner->id]);
        DB::table('group_members')->insert([
            'tenant_id' => 999,
            'group_id' => $foreignGroup->id,
            'user_id' => $foreignMember->id,
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->apiPost("/v2/admin/groups/{$foreignGroup->id}/members/{$foreignMember->id}/promote")
            ->assertNotFound();
        $this->apiDelete("/v2/admin/groups/{$foreignGroup->id}/members/{$foreignMember->id}")
            ->assertNotFound();
    }

    public function test_admin_group_type_mutations_have_durable_activity_logs(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);
        $suffix = bin2hex(random_bytes(4));

        $type = $this->apiPost('/v2/admin/groups/types', [
            'name' => "Audit type {$suffix}",
        ])->assertOk();
        $typeId = (int) $type->json('data.id');
        $this->apiPut("/v2/admin/groups/types/{$typeId}", [
            'name' => "Updated audit type {$suffix}",
        ])->assertOk();
        $this->apiDelete("/v2/admin/groups/types/{$typeId}")->assertOk();

        $expectedActions = [
            'admin_create_group_type',
            'admin_update_group_type',
            'admin_delete_group_type',
        ];
        $logs = DB::table('activity_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $admin->id)
            ->whereIn('action', $expectedActions)
            ->get();
        self::assertEqualsCanonicalizing($expectedActions, $logs->pluck('action')->all());
        foreach ($logs as $log) {
            self::assertSame('admin', (string) $log->action_type);
        }
    }

    public function test_admin_groups_numeric_identifiers_are_route_constrained(): void
    {
        $routes = array_values(array_filter(
            iterator_to_array(Route::getRoutes()),
            static fn (LaravelRoute $route): bool => str_starts_with(
                $route->getActionName(),
                \App\Http\Controllers\Api\AdminGroupsController::class . '@',
            ),
        ));

        self::assertCount(33, $routes, 'The Admin Groups route inventory changed.');
        $actionNames = array_map(static fn (LaravelRoute $route): string => $route->getActionName(), $routes);
        self::assertNotContains(
            \App\Http\Controllers\Api\AdminGroupsController::class . '@getPolicies',
            $actionNames,
        );
        self::assertNotContains(
            \App\Http\Controllers\Api\AdminGroupsController::class . '@setPolicy',
            $actionNames,
        );
        foreach ($routes as $route) {
            foreach ($route->parameterNames() as $parameter) {
                self::assertSame(
                    '[0-9]+',
                    $route->wheres[$parameter] ?? null,
                    sprintf('%s %s must constrain {%s}.', implode('|', $route->methods()), $route->uri(), $parameter),
                );
            }
        }
    }
}
