<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\SuperAdmin;

use App\Core\SuperPanelAccess;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * An empty materialised path must DENY, never widen to the whole platform.
 *
 * 🔴 The defect this pins down. The subtree boundary for a hub-tenant super-admin
 * ("regional") is a string-prefix match on `tenants.path`, and that column is
 * nullable with no default. An empty prefix does not mean "no access" — it means
 * "everything":
 *
 *   - `str_starts_with($anything, '')` is TRUE in PHP, so canAccessTenant() would
 *     admit every tenant on the platform;
 *   - the list clause becomes `path LIKE '%'`, which matches every row;
 *   - and the six call sites in TenantVisibilityService / SuperAdminAuditService
 *     used `if (granted && regional && !empty(path)) { filter }`, so an empty path
 *     applied NO filter at all — the caller received the entire installation.
 *     Fail-open, in the one place that must fail closed.
 *
 * Not exploitable while `EnsureIsSuperAdmin` refuses `is_tenant_super_admin`, but
 * it would have become a cross-tenant data breach the moment a hierarchical panel
 * was switched on. These tests exist so that switching it on cannot resurrect it.
 */
class SubtreeBoundaryEmptyPathTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        SuperPanelAccess::reset();
    }

    protected function tearDown(): void
    {
        SuperPanelAccess::reset();
        parent::tearDown();
    }

    /** A hub tenant whose path is $path, plus a tenant super-admin on it. */
    private function hubWithPath(?string $path): User
    {
        $tenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Pathless Hub',
            'slug' => 'pathless-hub-' . uniqid('', false),
            'is_active' => 1,
            'allows_subtenants' => 1,
            'depth' => 0,
            'path' => $path,
            'max_depth' => 3,
        ]);

        $user = User::factory()->forTenant($tenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        DB::table('users')->where('id', $user->id)->update(['is_tenant_super_admin' => 1]);

        return $user;
    }

    /** @return array<int, array{0:?string}> */
    public static function emptyPathProvider(): array
    {
        return [
            'null path' => [null],
            'empty string path' => [''],
            'whitespace-only path' => ['   '],
        ];
    }

    /**
     * @dataProvider emptyPathProvider
     */
    public function test_access_is_refused_outright_when_the_path_is_unusable(?string $path): void
    {
        $user = $this->hubWithPath($path);
        SuperPanelAccess::reset();

        $access = SuperPanelAccess::getAccess((int) $user->id);

        $this->assertFalse(
            $access['granted'],
            'A regional grant without a usable path must be refused, not resolved to a wildcard.'
        );
        $this->assertSame('none', $access['level']);
        $this->assertStringContainsString('path', strtolower((string) $access['reason']));
    }

    /**
     * @dataProvider emptyPathProvider
     */
    public function test_no_tenant_is_accessible_when_the_path_is_unusable(?string $path): void
    {
        $user = $this->hubWithPath($path);
        SuperPanelAccess::reset();
        SuperPanelAccess::getAccess((int) $user->id);

        // Every other tenant on the installation must be refused. Before the fix
        // str_starts_with($anyPath, '') admitted all of them.
        foreach (DB::table('tenants')->pluck('id') as $tenantId) {
            $this->assertFalse(
                SuperPanelAccess::canAccessTenant((int) $tenantId),
                "Tenant {$tenantId} must not be accessible to a super-admin with no path."
            );
        }
    }

    /**
     * @dataProvider emptyPathProvider
     */
    public function test_the_query_scope_matches_nothing_rather_than_everything(?string $path): void
    {
        $user = $this->hubWithPath($path);
        SuperPanelAccess::reset();
        SuperPanelAccess::getAccess((int) $user->id);

        $clause = SuperPanelAccess::getScopeClause('tenants');

        // 🔴 The old code produced `path LIKE '%'` here.
        $this->assertSame('1 = 0', $clause['sql'], 'An unusable path must scope to nothing.');
        $this->assertSame([], $clause['params']);
        $this->assertStringNotContainsString('LIKE', $clause['sql']);
    }

    /**
     * @dataProvider emptyPathProvider
     */
    public function test_the_shared_subtree_filter_denies_instead_of_skipping(?string $path): void
    {
        // subtreeFilter() replaced the fail-open idiom at six call sites. `deny`
        // must be true — NOT simply "no filter", which is what let the whole
        // platform through.
        $user = $this->hubWithPath($path);
        SuperPanelAccess::reset();

        $filter = SuperPanelAccess::subtreeFilter((int) $user->id);

        $this->assertTrue($filter['deny'], 'An unusable path must deny, not fall through to no filter.');
        $this->assertFalse($filter['filter']);
        $this->assertNull($filter['prefix']);
    }

    public function test_a_hub_tenant_with_a_real_path_still_gets_its_own_subtree(): void
    {
        // The fix must not break the legitimate case.
        $user = $this->hubWithPath('/9001/');
        SuperPanelAccess::reset();

        $access = SuperPanelAccess::getAccess((int) $user->id);
        $this->assertTrue($access['granted']);
        $this->assertSame('regional', $access['level']);

        $filter = SuperPanelAccess::subtreeFilter((int) $user->id);
        $this->assertFalse($filter['deny']);
        $this->assertTrue($filter['filter']);
        $this->assertSame('/9001/', $filter['prefix']);

        $clause = SuperPanelAccess::getScopeClause('tenants');
        $this->assertStringContainsString('path LIKE ?', $clause['sql']);
        $this->assertSame(['/9001/%'], $clause['params']);
    }

    public function test_a_regional_admin_cannot_reach_a_sibling_branch(): void
    {
        // The boundary itself, stated as a test: /9001/ must not reach /9002/.
        $user = $this->hubWithPath('/9001/');
        $siblingId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Sibling Branch',
            'slug' => 'sibling-' . uniqid('', false),
            'is_active' => 1,
            'allows_subtenants' => 1,
            'depth' => 0,
            'path' => '/9002/',
            'max_depth' => 3,
        ]);
        $childId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Own Child',
            'slug' => 'own-child-' . uniqid('', false),
            'is_active' => 1,
            'allows_subtenants' => 0,
            'depth' => 1,
            'path' => '/9001/9003/',
            'max_depth' => 3,
        ]);

        SuperPanelAccess::reset();
        SuperPanelAccess::getAccess((int) $user->id);

        $this->assertTrue(SuperPanelAccess::canAccessTenant($childId), 'Own descendant must be reachable.');
        $this->assertFalse(SuperPanelAccess::canAccessTenant($siblingId), 'A sibling branch must not be reachable.');
    }

    public function test_a_prefix_must_not_match_a_merely_similar_path(): void
    {
        // /900/ must not match /9001/ — a real risk of prefix matching if the
        // separator convention is ever dropped. Documents the dependency.
        $user = $this->hubWithPath('/900/');
        $lookalikeId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Lookalike',
            'slug' => 'lookalike-' . uniqid('', false),
            'is_active' => 1,
            'allows_subtenants' => 0,
            'depth' => 0,
            'path' => '/9001/',
            'max_depth' => 3,
        ]);

        SuperPanelAccess::reset();
        SuperPanelAccess::getAccess((int) $user->id);

        $this->assertFalse(
            SuperPanelAccess::canAccessTenant($lookalikeId),
            'Path /900/ must not match /9001/ — trailing separators are what keep prefixes unambiguous.'
        );
    }
}
