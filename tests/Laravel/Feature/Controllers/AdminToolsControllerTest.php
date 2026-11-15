<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for AdminToolsController.
 *
 * Covers redirects CRUD, 404 errors, health check, WebP stats,
 * seed generator, blog backups, SEO audit, IP debug.
 */
class AdminToolsControllerTest extends TestCase
{
    use DatabaseTransactions;

    // ================================================================
    // REDIRECTS — GET /v2/admin/tools/redirects
    // ================================================================

    public function test_redirects_returns_200_for_the_platform_team(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/tools/redirects');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_redirects_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/tools/redirects');

        $response->assertStatus(403);
    }

    public function test_redirects_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/tools/redirects');

        $response->assertStatus(401);
    }

    // ================================================================
    // CREATE REDIRECT — POST /v2/admin/tools/redirects
    // ================================================================

    public function test_create_redirect_requires_from_url(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/tools/redirects', [
            'to_url' => '/new-page',
        ]);

        $response->assertStatus(422);
    }

    public function test_create_redirect_requires_to_url(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/tools/redirects', [
            'from_url' => '/old-page',
        ]);

        $response->assertStatus(422);
    }

    public function test_create_redirect_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPost('/v2/admin/tools/redirects', [
            'from_url' => '/old',
            'to_url' => '/new',
        ]);

        $response->assertStatus(403);
    }

    // ================================================================
    // 404 ERRORS — GET /v2/admin/tools/404-errors
    // ================================================================

    public function test_404_errors_returns_200_for_the_platform_team(): void
    {
        // get404Errors() reads the global, cross-tenant error_404_log and is
        // gated by requirePlatformSuperAdmin() — a tenant admin gets 403.
        $superAdmin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        Sanctum::actingAs($superAdmin);

        $response = $this->apiGet('/v2/admin/tools/404-errors');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_404_errors_returns_403_for_tenant_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/tools/404-errors');

        $response->assertStatus(403);
    }

    public function test_404_errors_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/tools/404-errors');

        $response->assertStatus(403);
    }

    // ================================================================
    // HEALTH CHECK — POST /v2/admin/tools/health-check
    // ================================================================

    public function test_health_check_returns_200_for_the_platform_team(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/tools/health-check');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'data' => ['tests', 'summary'],
        ]);
    }

    public function test_health_check_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPost('/v2/admin/tools/health-check');

        $response->assertStatus(403);
    }

    // ================================================================
    // WEBP STATS — GET /v2/admin/tools/webp-stats
    // ================================================================

    public function test_webp_stats_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/tools/webp-stats');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'data' => ['total_images', 'webp_images', 'pending_conversion'],
        ]);
    }

    // ================================================================
    // SEED GENERATOR — POST /v2/admin/tools/seed
    // ================================================================

    // runSeedGenerator() is gated by requirePlatformSuperAdmin(); a plain tenant
    // admin receives 403 before validation runs. These tests use a super admin.

    public function test_seed_generator_requires_types(): void
    {
        $superAdmin = User::factory()->forTenant($this->testTenantId)->admin()->create(['role' => 'super_admin']);
        Sanctum::actingAs($superAdmin);

        $response = $this->apiPost('/v2/admin/tools/seed', []);

        $response->assertStatus(422);
    }

    public function test_seed_generator_rejects_invalid_types(): void
    {
        $superAdmin = User::factory()->forTenant($this->testTenantId)->admin()->create(['role' => 'super_admin']);
        Sanctum::actingAs($superAdmin);

        $response = $this->apiPost('/v2/admin/tools/seed', [
            'types' => ['invalid_type'],
        ]);

        $response->assertStatus(422);
    }

    public function test_seed_generator_returns_200_for_valid_types(): void
    {
        $superAdmin = User::factory()->forTenant($this->testTenantId)->admin()->create(['role' => 'super_admin']);
        Sanctum::actingAs($superAdmin);

        $response = $this->apiPost('/v2/admin/tools/seed', [
            'types' => ['users', 'listings'],
            'counts' => ['users' => 10, 'listings' => 5],
        ]);

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'data' => ['started', 'message', 'types'],
        ]);
    }

    public function test_seed_generator_returns_403_for_tenant_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/tools/seed', [
            'types' => ['users'],
        ]);

        $response->assertStatus(403);
    }

    // ================================================================
    // BLOG BACKUPS — GET /v2/admin/tools/blog-backups
    // ================================================================

    public function test_blog_backups_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/tools/blog-backups');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // SEO AUDIT — GET /v2/admin/tools/seo-audit
    // ================================================================

    public function test_seo_audit_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/tools/seo-audit');

        $response->assertStatus(200);
    }

    public function test_seo_audit_returns_localisable_result_contract(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        DB::table('seo_audits')->insert([
            'tenant_id' => $this->testTenantId,
            'url' => '',
            'results' => json_encode([
                'checks' => [[
                    'code' => 'sitemap_coverage',
                    'params' => ['count' => 2],
                    'status' => 'warning',
                    'issues' => [[
                        'code' => 'sitemap_low_coverage',
                        'params' => ['count' => 2],
                    ]],
                    'issue_count' => 1,
                    'points' => 5,
                    'max_points' => 10,
                ]],
                'score' => 5,
                'max_score' => 10,
                'grade' => 'F',
                'run_at' => '2026-01-01T00:00:00+00:00',
            ]),
            'created_at' => now(),
        ]);

        $response = $this->apiGet('/v2/admin/tools/seo-audit');

        $response->assertStatus(200);
        $response->assertJsonPath('data.checks.0.code', 'sitemap_coverage');
        $response->assertJsonPath('data.checks.0.params.count', 2);
        $response->assertJsonPath('data.checks.0.issues.0.code', 'sitemap_low_coverage');
        $this->assertArrayNotHasKey('results', $response->json('data'));
        $this->assertArrayNotHasKey('name', $response->json('data.checks.0'));
        $this->assertArrayNotHasKey('description', $response->json('data.checks.0'));
    }

    // ================================================================
    // IP DEBUG — GET /v2/admin/tools/ip-debug
    // ================================================================

    public function test_ip_debug_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/tools/ip-debug');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_ip_debug_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/tools/ip-debug');

        $response->assertStatus(403);
    }

    public function test_ip_debug_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/tools/ip-debug');

        $response->assertStatus(401);
    }
}
