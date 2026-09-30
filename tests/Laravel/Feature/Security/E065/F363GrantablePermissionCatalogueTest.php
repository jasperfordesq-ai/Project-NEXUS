<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E065;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-363 (E-065) — 66 of the 66 RBAC permission slugs the admin panel published
 * were read by no code, so a community administrator ticking one believed they
 * had delegated something and had not.
 *
 * The panel now publishes exactly the permissions the roles editor will accept,
 * and the roles editor accepts exactly the permissions the platform enforces.
 * This test pins the two ends together: whatever the catalogue offers must be
 * grantable, and a slug outside it must be refused rather than silently
 * attached or silently dropped.
 */
final class F363GrantablePermissionCatalogueTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT = 2;

    private int $adminId = 0;
    private int $roleId = 0;

    protected function setUp(): void
    {
        parent::setUp();

        // No schema guard here on purpose. `roles`, `role_permissions` and
        // `permissions` are all in the committed schema dump, so a guard would
        // never fire in CI and would only hide a broken fixture locally — which
        // is exactly what the schema-skip budget gate exists to prevent.

        TenantContext::setById(self::TENANT);

        $this->adminId = $this->makeAdmin();
        $this->roleId = (int) DB::table('roles')->insertGetId([
            'name' => 'f363_role_' . bin2hex(random_bytes(4)),
            'display_name' => 'F363 community role',
            'level' => 10,
            'is_system' => 0,
            'tenant_id' => self::TENANT,
        ]);

        Sanctum::actingAs(User::find($this->adminId));
    }

    /**
     * Every slug the panel publishes must be one the roles editor accepts.
     */
    public function test_every_published_permission_is_grantable(): void
    {
        $published = $this->publishedSlugs();
        $this->assertNotEmpty($published, 'the permissions catalogue is empty');

        foreach ($published as $slug) {
            DB::table('permissions')->insertOrIgnore([
                'name' => $slug,
                'display_name' => $slug,
                'category' => 'f363',
            ]);
        }

        $response = $this->putJson(
            '/api/v2/admin/enterprise/roles/' . $this->roleId,
            ['permissions' => $published],
            $this->withTenantHeader()
        );

        $this->assertSame(
            200,
            $response->getStatusCode(),
            'BAD OUTCOME: the panel publishes a permission the roles editor refuses. Body: '
            . $response->getContent()
        );
        $this->assertSame(
            count($published),
            DB::table('role_permissions')->where('role_id', $this->roleId)->count()
        );
    }

    /**
     * A slug the platform enforces nowhere must be refused, not silently
     * attached and not silently dropped.
     */
    public function test_a_permission_outside_the_catalogue_is_refused(): void
    {
        $published = $this->publishedSlugs();
        $this->assertNotContains(
            'users.delete',
            $published,
            'fixture assumption: users.delete is not a grantable permission'
        );

        DB::table('permissions')->insertOrIgnore([
            'name' => 'users.delete',
            'display_name' => 'Delete Users',
            'category' => 'users',
        ]);

        $response = $this->putJson(
            '/api/v2/admin/enterprise/roles/' . $this->roleId,
            ['permissions' => ['users.delete']],
            $this->withTenantHeader()
        );

        $this->assertSame(
            422,
            $response->getStatusCode(),
            'BAD OUTCOME: the roles editor accepted a permission the platform enforces '
            . 'nowhere. Body: ' . $response->getContent()
        );
        $this->assertSame(
            0,
            DB::table('role_permissions')->where('role_id', $this->roleId)->count()
        );
    }

    // ── fixtures ───────────────────────────────────────────────────────────

    /** @return string[] */
    private function publishedSlugs(): array
    {
        $response = $this->getJson('/api/v2/admin/enterprise/permissions', $this->withTenantHeader());
        $this->assertSame(200, $response->getStatusCode(), $response->getContent());

        $slugs = [];
        foreach ((array) $response->json('data') as $group) {
            foreach ((array) $group as $slug) {
                $slugs[] = (string) $slug;
            }
        }

        return array_values(array_unique($slugs));
    }

    private function makeAdmin(): int
    {
        $email = 'f363.admin.' . bin2hex(random_bytes(5)) . '@example.test';

        return (int) DB::table('users')->insertGetId([
            'tenant_id' => self::TENANT,
            'name' => 'F363 Admin',
            'first_name' => 'F363',
            'last_name' => 'Admin',
            'email' => $email,
            'username' => 'f363_' . substr(md5($email), 0, 10),
            'password' => password_hash('password', PASSWORD_BCRYPT),
            'role' => 'admin',
            'is_admin' => 1,
            'status' => 'active',
            'is_approved' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
