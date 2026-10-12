<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E065;

use App\Core\SuperPanelAccess;
use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * E-066 permanent control, brought forward from the E-065 slice-D reproduction
 * `.local-docs-archive/security-log/E-065/repro/d/RegionalSuperAdminSubtreeTest.php`.
 * It PASSES today and must keep passing: it pins the boundary the other E-066
 * admin/RBAC fixes must not disturb.
 *
 * E-065 slice D — the regional (network) super-admin cross-subtree test that
 * E-062 recorded as never having been built.
 *
 * Shape of the fixture (materialised `tenants.path`):
 *
 *   hub      /1/<H>/        allows_subtenants = 1   <- the attacker's community
 *   child    /1/<H>/<C>/                            <- legitimately theirs
 *   sibling  /1/<H2>/       where <H2> = <H> . '0'  <- must be unreachable
 *
 * The sibling is chosen so its path shares a *string* prefix with the hub's id
 * ("/1/779404" vs "/1/7794040"). A naive `LIKE '/1/779404%'` would match both;
 * the trailing slash in the stored path is the only thing that separates them.
 * That is the specific soundness question this file answers.
 */
final class RegionalSuperAdminSubtreeControlTest extends TestCase
{
    use DatabaseTransactions;

    private int $hubId = 0;
    private int $childId = 0;
    private int $siblingId = 0;
    private int $attackerId = 0;
    private int $victimInSiblingId = 0;
    private int $memberInChildId = 0;

    protected function setUp(): void
    {
        parent::setUp();
        SuperPanelAccess::reset();

        // Ids are picked so the sibling's id is the hub's id with a digit
        // appended — the string-prefix collision case.
        $base = 771000 + random_int(100, 899);
        $this->hubId = $base;
        $this->siblingId = (int) ($base . '0');
        $this->childId = $base + 90000;

        $this->makeTenant($this->hubId, 'e065d-hub', 1, '/1/' . $this->hubId . '/', 1, true);
        $this->makeTenant($this->childId, 'e065d-child', $this->hubId, '/1/' . $this->hubId . '/' . $this->childId . '/', 2, false);
        $this->makeTenant($this->siblingId, 'e065d-sibling', 1, '/1/' . $this->siblingId . '/', 1, true);

        $this->attackerId = $this->makeUser($this->hubId, 'e065d.regional', tenantSuperAdmin: true);
        $this->victimInSiblingId = $this->makeUser($this->siblingId, 'e065d.victim');
        $this->memberInChildId = $this->makeUser($this->childId, 'e065d.child.member');

        $this->withTenant($this->hubId);
    }

    protected function tearDown(): void
    {
        SuperPanelAccess::reset();
        parent::tearDown();
    }

    /** The prefix comparison itself, at unit level — no HTTP. */
    public function test_string_prefix_collision_does_not_place_sibling_in_subtree(): void
    {
        $hubPath = '/1/' . $this->hubId . '/';
        $siblingPath = '/1/' . $this->siblingId . '/';

        $this->assertStringStartsWith(
            '/1/' . $this->hubId,
            $siblingPath,
            'fixture sanity: the sibling path shares a string prefix with the hub id'
        );
        $this->assertFalse(
            str_starts_with($siblingPath, $hubPath),
            'CONTROL: the trailing slash is what stops /1/N0/ being read as a descendant of /1/N/.'
        );
    }

    /** ATTACK — read a sibling community's record from the hub's own panel. */
    public function test_regional_super_admin_cannot_read_a_sibling_community(): void
    {
        Sanctum::actingAs(User::find($this->attackerId));

        $response = $this->getJson(
            '/api/v2/admin/super/tenants/' . $this->siblingId,
            $this->withTenantHeader()
        );

        $this->assertNotSame(
            200,
            $response->getStatusCode(),
            'RED if 200: a hub super-admin read a sibling community outside its subtree.'
        );
        $response->assertDontSee('e065d-sibling');
    }

    /** CONTROL — the same call against its own descendant succeeds. */
    public function test_regional_super_admin_can_read_its_own_descendant(): void
    {
        Sanctum::actingAs(User::find($this->attackerId));

        $response = $this->getJson(
            '/api/v2/admin/super/tenants/' . $this->childId,
            $this->withTenantHeader()
        );

        $this->assertSame(
            200,
            $response->getStatusCode(),
            'CONTROL: the legitimate descendant read must succeed, or the attack case proves nothing.'
        );
        $response->assertSee('e065d-child');
    }

    /** ATTACK — pull a member out of a sibling community (source end). */
    public function test_regional_super_admin_cannot_move_a_user_out_of_a_sibling(): void
    {
        Sanctum::actingAs(User::find($this->attackerId));

        $response = $this->postJson(
            '/api/v2/admin/super/users/' . $this->victimInSiblingId . '/move-tenant',
            ['new_tenant_id' => $this->hubId],
            $this->withTenantHeader()
        );

        $this->assertSame(403, $response->getStatusCode());
        $this->assertSame(
            $this->siblingId,
            (int) DB::table('users')->where('id', $this->victimInSiblingId)->value('tenant_id'),
            'RED if moved: a sibling community lost a member to the attacker.'
        );
    }

    /** ATTACK — push a member INTO a sibling community (destination end). */
    public function test_regional_super_admin_cannot_move_a_user_into_a_sibling(): void
    {
        Sanctum::actingAs(User::find($this->attackerId));

        $response = $this->postJson(
            '/api/v2/admin/super/users/' . $this->memberInChildId . '/move-tenant',
            ['new_tenant_id' => $this->siblingId],
            $this->withTenantHeader()
        );

        $this->assertSame(403, $response->getStatusCode());
        $this->assertSame(
            $this->childId,
            (int) DB::table('users')->where('id', $this->memberInChildId)->value('tenant_id'),
            'RED if moved: a member was planted in a community outside the attacker subtree.'
        );
    }

    /** CONTROL — a move wholly inside the subtree is allowed. */
    public function test_regional_super_admin_can_move_inside_its_own_subtree(): void
    {
        Sanctum::actingAs(User::find($this->attackerId));

        $response = $this->postJson(
            '/api/v2/admin/super/users/' . $this->memberInChildId . '/move-tenant',
            ['new_tenant_id' => $this->hubId],
            $this->withTenantHeader()
        );

        $this->assertSame(
            200,
            $response->getStatusCode(),
            'CONTROL: an in-subtree move must succeed (body: ' . $response->getContent() . ')'
        );
        $this->assertSame(
            $this->hubId,
            (int) DB::table('users')->where('id', $this->memberInChildId)->value('tenant_id')
        );
    }

    /** ATTACK — the tenant LIST must not enumerate the sibling. */
    public function test_regional_super_admin_tenant_list_excludes_the_sibling(): void
    {
        Sanctum::actingAs(User::find($this->attackerId));

        $response = $this->getJson('/api/v2/admin/super/tenants', $this->withTenantHeader());

        $this->assertSame(200, $response->getStatusCode());
        $response->assertSee('e065d-hub');
        $response->assertDontSee('e065d-sibling');
    }

    /** ATTACK — the user LIST must not disclose a sibling community's members. */
    public function test_regional_super_admin_user_list_excludes_sibling_members(): void
    {
        Sanctum::actingAs(User::find($this->attackerId));

        $victimEmail = (string) DB::table('users')->where('id', $this->victimInSiblingId)->value('email');

        $response = $this->getJson('/api/v2/admin/super/users?limit=200', $this->withTenantHeader());

        $this->assertSame(200, $response->getStatusCode());
        $response->assertDontSee($victimEmail);
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    private function makeTenant(int $id, string $slug, ?int $parentId, string $path, int $depth, bool $allowsSubtenants): void
    {
        DB::table('tenants')->updateOrInsert(['id' => $id], [
            'name' => $slug,
            'slug' => $slug . '-' . $id,
            'domain' => null,
            'is_active' => 1,
            'parent_id' => $parentId,
            'path' => $path,
            'depth' => $depth,
            'allows_subtenants' => $allowsSubtenants ? 1 : 0,
            'max_depth' => 5,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function makeUser(int $tenantId, string $prefix, bool $tenantSuperAdmin = false): int
    {
        $email = $prefix . '.' . bin2hex(random_bytes(5)) . '@example.test';

        return (int) DB::table('users')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => 'E065D User',
            'first_name' => 'E065D',
            'last_name' => 'User',
            'email' => $email,
            'username' => 'e065d_' . substr(md5($email), 0, 10),
            'password' => password_hash('password', PASSWORD_BCRYPT),
            'role' => $tenantSuperAdmin ? 'admin' : 'member',
            'is_admin' => $tenantSuperAdmin ? 1 : 0,
            'is_tenant_super_admin' => $tenantSuperAdmin ? 1 : 0,
            'is_super_admin' => 0,
            'is_god' => 0,
            'status' => 'active',
            'is_approved' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
