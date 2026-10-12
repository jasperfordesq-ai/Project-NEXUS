<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\SuperAdmin;

use App\Core\SuperPanelAccess;
use App\Models\User;
use App\Services\SuperAdminAuditService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-593: the super-panel audit log was scoped by WHO acted, not WHAT was acted on.
 *
 * getLog()/getStats() kept rows whose actor_tenant_id was in the caller's
 * subtree. So a tenant super admin read rows about OTHER communities whenever
 * the actor's account happened to sit on its tenant (a platform admin homed
 * there), and missed rows about its own subtree written by a platform admin
 * homed elsewhere.
 *
 * Now a non-platform caller sees a row only when every tenant the action
 * affected is in its subtree, recorded at write time as target_tenant_id (the
 * single affected tenant, or for a move the lowest common ancestor of both ends;
 * bulk rows record none and are platform-only).
 *
 * Fixture: hub P (the tenant super admin's home) with child C; unrelated root O.
 */
class SuperAdminAuditLogSubtreeScopeTest extends TestCase
{
    use DatabaseTransactions;

    private int $parentId;
    private int $childId;
    private int $otherId;
    private User $tenantSuperAdmin;
    private User $platformAdminHomedOnParent;
    private User $platformAdminHomedElsewhere;

    protected function setUp(): void
    {
        parent::setUp();
        SuperPanelAccess::reset();

        $this->parentId = $this->makeTenant('Audit Scope Parent', null);
        $this->childId = $this->makeTenant('Audit Scope Child', $this->parentId);
        $this->otherId = $this->makeTenant('Audit Scope Other', null);

        $this->tenantSuperAdmin = $this->makeUser($this->parentId, [
            'is_tenant_super_admin' => 1, 'is_super_admin' => 0, 'is_god' => 0,
        ]);
        $this->platformAdminHomedOnParent = $this->makeUser($this->parentId, [
            'is_super_admin' => 1, 'is_tenant_super_admin' => 0, 'is_god' => 0,
        ]);
        $this->platformAdminHomedElsewhere = $this->makeUser($this->otherId, [
            'is_super_admin' => 1, 'is_tenant_super_admin' => 0, 'is_god' => 0,
        ]);
    }

    protected function tearDown(): void
    {
        SuperPanelAccess::reset();
        parent::tearDown();
    }

    private function makeTenant(string $name, ?int $parentId): int
    {
        $parentPath = $parentId !== null
            ? rtrim((string) DB::table('tenants')->where('id', $parentId)->value('path'), '/')
            : '';
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => strtolower(str_replace(' ', '-', $name)) . '-' . uniqid('', false),
            'is_active' => 1,
            'allows_subtenants' => 1,
            'parent_id' => $parentId,
            'depth' => $parentId !== null ? 1 : 0,
            'path' => null,
            'max_depth' => 3,
        ]);
        DB::table('tenants')->where('id', $id)->update(['path' => $parentPath . '/' . $id . '/']);

        return $id;
    }

    /** @param array<string,mixed> $flags */
    private function makeUser(int $tenantId, array $flags): User
    {
        $user = User::factory()->forTenant($tenantId)->admin()->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        if ($flags !== []) {
            DB::table('users')->where('id', $user->id)->update($flags);
        }
        $user->refresh();

        return $user;
    }

    private function logAs(User $actor, string $action, string $targetType, ?int $targetId, string $marker, ?array $old = null, ?array $new = null): void
    {
        SuperAdminAuditService::log(
            $action,
            $targetType,
            $targetId,
            $marker,
            $old,
            $new,
            $marker,
            ['user_id' => (int) $actor->id, 'tenant_id' => (int) $actor->tenant_id]
        );
    }

    /** @return list<string> */
    private function visibleMarkersFor(User $viewer): array
    {
        SuperPanelAccess::reset();
        SuperPanelAccess::getAccess((int) $viewer->id);

        $rows = SuperAdminAuditService::getLog(['search' => 'F593-', 'limit' => 100]);

        return array_values(array_map(static fn (array $r): string => (string) $r['target_name'], $rows));
    }

    public function test_a_platform_admin_homed_on_its_tenant_acting_elsewhere_is_not_shown(): void
    {
        $this->logAs($this->platformAdminHomedOnParent, 'tenant_updated', 'tenant', $this->otherId, 'F593-other-tenant');
        $otherMember = $this->makeUser($this->otherId, []);
        $this->logAs($this->platformAdminHomedOnParent, 'user_updated', 'user', (int) $otherMember->id, 'F593-other-user');

        $visible = $this->visibleMarkersFor($this->tenantSuperAdmin);

        $this->assertNotContains('F593-other-tenant', $visible);
        $this->assertNotContains('F593-other-user', $visible);
    }

    public function test_actions_on_its_subtree_are_shown_whoever_acted(): void
    {
        $this->logAs($this->platformAdminHomedElsewhere, 'tenant_updated', 'tenant', $this->childId, 'F593-child-tenant');
        $childMember = $this->makeUser($this->childId, []);
        $this->logAs($this->platformAdminHomedElsewhere, 'user_updated', 'user', (int) $childMember->id, 'F593-child-user');
        $this->logAs($this->tenantSuperAdmin, 'tenant_updated', 'tenant', $this->parentId, 'F593-own-tenant');

        $visible = $this->visibleMarkersFor($this->tenantSuperAdmin);

        $this->assertContains('F593-child-tenant', $visible);
        $this->assertContains('F593-child-user', $visible);
        $this->assertContains('F593-own-tenant', $visible);
    }

    public function test_a_move_is_shown_only_when_both_ends_are_in_its_subtree(): void
    {
        $member = $this->makeUser($this->childId, []);
        $this->logAs($this->platformAdminHomedElsewhere, 'user_moved', 'user', (int) $member->id, 'F593-move-inside',
            ['tenant_id' => $this->childId], ['tenant_id' => $this->parentId]);
        $this->logAs($this->platformAdminHomedOnParent, 'user_moved', 'user', (int) $member->id, 'F593-move-across',
            ['tenant_id' => $this->otherId], ['tenant_id' => $this->childId]);
        $this->logAs($this->platformAdminHomedOnParent, 'bulk_users_moved', 'bulk', null, 'F593-bulk');

        $visible = $this->visibleMarkersFor($this->tenantSuperAdmin);

        $this->assertContains('F593-move-inside', $visible);
        $this->assertNotContains('F593-move-across', $visible, 'One end is another root.');
        $this->assertNotContains('F593-bulk', $visible, 'A bulk row records no single tenant.');
    }

    public function test_a_community_move_is_scoped_by_both_its_old_and_new_position(): void
    {
        $p = $this->parentId;
        $c = $this->childId;
        $o = $this->otherId;
        $this->logAs($this->platformAdminHomedElsewhere, 'tenant_moved', 'tenant', 999001, 'F593-tmove-inside',
            ['parent_id' => $p, 'path' => "/{$p}/999001/"], ['parent_id' => $c, 'path' => "/{$p}/{$c}/999001/"]);
        $this->logAs($this->platformAdminHomedOnParent, 'tenant_moved', 'tenant', 999002, 'F593-tmove-in-from-outside',
            ['parent_id' => $o, 'path' => "/{$o}/999002/"], ['parent_id' => $c, 'path' => "/{$p}/{$c}/999002/"]);

        $this->assertSame($p, SuperAdminAuditService::resolveTargetTenantId(
            'tenant_moved', 'tenant', 999001, ['path' => "/{$p}/999001/"], ['path' => "/{$p}/{$c}/999001/"]
        ));
        $this->assertNull(SuperAdminAuditService::resolveTargetTenantId('bulk_users_moved', 'bulk', null, null, null));

        $visible = $this->visibleMarkersFor($this->tenantSuperAdmin);
        $this->assertContains('F593-tmove-inside', $visible);
        $this->assertNotContains('F593-tmove-in-from-outside', $visible, 'It came from another root.');
    }

    public function test_its_own_actions_outside_its_subtree_are_not_shown_either(): void
    {
        // Defence in depth: a tenant super admin cannot normally act outside its
        // subtree, but a row that says it did is still about another community.
        $this->logAs($this->tenantSuperAdmin, 'tenant_updated', 'tenant', $this->otherId, 'F593-own-action-elsewhere');

        $this->assertNotContains('F593-own-action-elsewhere', $this->visibleMarkersFor($this->tenantSuperAdmin));
    }

    public function test_stats_count_the_same_rows(): void
    {
        $this->logAs($this->platformAdminHomedOnParent, 'tenant_updated', 'tenant', $this->otherId, 'F593-stats-other');
        $this->logAs($this->platformAdminHomedElsewhere, 'hub_toggled', 'tenant', $this->childId, 'F593-stats-child');

        SuperPanelAccess::reset();
        SuperPanelAccess::getAccess((int) $this->tenantSuperAdmin->id);
        $stats = SuperAdminAuditService::getStats(1);
        $types = array_column($stats['by_type'], 'count', 'action_type');

        $this->assertSame(1, (int) ($types['hub_toggled'] ?? 0));
        $this->assertSame(0, (int) ($types['tenant_updated'] ?? 0));
        $actorIds = array_map('intval', array_column($stats['top_actors'], 'actor_user_id'));
        $this->assertNotContains((int) $this->platformAdminHomedOnParent->id, $actorIds);
    }

    public function test_the_platform_owner_still_sees_everything(): void
    {
        $this->logAs($this->platformAdminHomedOnParent, 'tenant_updated', 'tenant', $this->otherId, 'F593-owner-other');
        $this->logAs($this->platformAdminHomedOnParent, 'bulk_users_moved', 'bulk', null, 'F593-owner-bulk');

        $visible = $this->visibleMarkersFor($this->platformAdminHomedElsewhere);

        $this->assertContains('F593-owner-other', $visible);
        $this->assertContains('F593-owner-bulk', $visible);
    }

    public function test_the_audit_endpoint_applies_the_same_scope(): void
    {
        $this->logAs($this->platformAdminHomedOnParent, 'tenant_updated', 'tenant', $this->otherId, 'F593-http-other');
        $this->logAs($this->platformAdminHomedElsewhere, 'tenant_updated', 'tenant', $this->childId, 'F593-http-child');

        SuperPanelAccess::reset();
        $this->withTenant($this->parentId);
        Sanctum::actingAs($this->tenantSuperAdmin);
        $body = json_encode($this->apiGet('/v2/admin/super/audit?search=F593-http')->assertStatus(200)->json('data'));

        $this->assertStringContainsString('F593-http-child', (string) $body);
        $this->assertStringNotContainsString('F593-http-other', (string) $body);
    }
}
