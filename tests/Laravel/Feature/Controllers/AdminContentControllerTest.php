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
 * Feature tests for AdminContentController.
 *
 * Covers pages, menus, menu items, plans, and subscriptions.
 */
class AdminContentControllerTest extends TestCase
{
    use DatabaseTransactions;

    // ================================================================
    // PAGES — GET /v2/admin/pages
    // ================================================================

    public function test_get_pages_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/pages');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_get_pages_list_omits_large_editor_payloads(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        DB::table('pages')->insert([
            'tenant_id' => $this->testTenantId,
            'title' => 'Large Builder Page',
            'slug' => 'large-builder-page',
            'content' => str_repeat('<section>Large page section</section>', 1000),
            'content_format' => 'builder',
            'design_json' => json_encode([
                'pages' => [
                    [
                        'frames' => [
                            [
                                'component' => [
                                    'type' => 'wrapper',
                                    'components' => [
                                        ['tagName' => 'section', 'classes' => ['hero']],
                                    ],
                                ],
                            ],
                        ],
                    ],
                ],
                'assets' => [],
                'styles' => [],
            ], JSON_THROW_ON_ERROR),
            'meta_description' => 'List payload test',
            'is_published' => 0,
            'sort_order' => 0,
            'show_in_menu' => 0,
            'menu_location' => 'about',
            'menu_order' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->apiGet('/v2/admin/pages');

        $response->assertStatus(200);
        $page = collect($response->json('data'))->firstWhere('slug', 'large-builder-page');
        $this->assertIsArray($page);
        $this->assertArrayNotHasKey('content', $page);
        $this->assertArrayNotHasKey('content_format', $page);
        $this->assertArrayNotHasKey('design_json', $page);
    }

    public function test_get_pages_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/pages');

        $response->assertStatus(403);
    }

    public function test_get_pages_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/pages');

        $response->assertStatus(401);
    }

    // ================================================================
    // CREATE PAGE — POST /v2/admin/pages
    // ================================================================

    public function test_create_page_returns_201_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/pages', [
            'title' => 'Test Page',
            'slug' => 'custom-test-page',
            'content' => '<p>Test content</p>',
            'status' => 'published',
        ]);

        // Accept 200 or 201 depending on implementation
        $this->assertContains($response->getStatusCode(), [200, 201]);
        $response->assertJsonStructure(['data']);
        $response->assertJsonPath('data.slug', 'custom-test-page');

        $pageId = (int) $response->json('data.id');
        $this->assertSame('custom-test-page', DB::table('pages')->where('id', $pageId)->value('slug'));
    }

    public function test_create_page_generates_slug_from_title_when_slug_is_blank(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/pages', [
            'title' => 'Title Derived Slug',
            'slug' => '',
            'content' => '<p>Test content</p>',
            'status' => 'draft',
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201]);
        $response->assertJsonPath('data.slug', 'title-derived-slug');
    }

    public function test_create_page_uses_existing_unique_slug_convention_for_duplicates(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $first = $this->apiPost('/v2/admin/pages', [
            'title' => 'Existing Slug',
            'slug' => 'shared-slug',
            'content' => '<p>One</p>',
            'status' => 'draft',
        ]);
        $this->assertContains($first->getStatusCode(), [200, 201]);

        $second = $this->apiPost('/v2/admin/pages', [
            'title' => 'Another Page',
            'slug' => 'shared-slug',
            'content' => '<p>Two</p>',
            'status' => 'draft',
        ]);

        $this->assertContains($second->getStatusCode(), [200, 201]);
        $second->assertJsonPath('data.slug', 'shared-slug-1');
    }

    public function test_create_page_returns_the_final_slug(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $payload = ['title' => 'Same Title', 'content' => '<p>x</p>', 'status' => 'draft'];
        $this->apiPost('/v2/admin/pages', $payload)->assertJsonPath('data.slug', 'same-title');

        $second = $this->apiPost('/v2/admin/pages', $payload);
        $this->assertContains($second->getStatusCode(), [200, 201]);
        $this->assertStringEndsWith('-1', (string) $second->json('data.slug'));
        $this->assertNotEmpty($second->json('data.id'));
    }

    public function test_update_page_returns_the_saved_slug(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $created = $this->apiPost('/v2/admin/pages', ['title' => 'Renamed Page', 'slug' => 'renamed-page-a', 'status' => 'draft']);
        $id = (int) $created->json('data.id');

        $response = $this->apiPut("/v2/admin/pages/{$id}", ['slug' => 'renamed-page-b']);
        $response->assertStatus(200);
        $response->assertJsonPath('data.slug', 'renamed-page-b');
    }

    public function test_create_page_with_non_latin_title_gets_a_generated_slug(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/pages', [
            'title' => '日本語ページ',
            'content' => '<p>Test content</p>',
            'status' => 'draft',
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201]);
        $this->assertMatchesRegularExpression('/^page-[0-9a-f]{6}$/', (string) $response->json('data.slug'));
    }

    public function test_create_page_accepts_formerly_reserved_slug_about(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/pages', [
            'title' => 'About',
            'slug' => 'about',
            'content' => '<p>Test content</p>',
            'status' => 'draft',
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201]);
        $this->assertStringStartsWith('about', (string) $response->json('data.slug'));
    }

    public function test_update_page_rejects_a_slug_with_spaces(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $created = $this->apiPost('/v2/admin/pages', ['title' => 'Spacey Page', 'slug' => 'spacey-page', 'status' => 'draft']);
        $id = (int) $created->json('data.id');

        $response = $this->apiPut("/v2/admin/pages/{$id}", ['slug' => 'has spaces in it']);

        $response->assertStatus(422);
        $response->assertJsonPath('errors.0.field', 'slug');
    }

    public function test_create_page_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPost('/v2/admin/pages', [
            'title' => 'Should Fail',
        ]);

        $response->assertStatus(403);
    }

    public function test_create_builder_page_rejects_invalid_design_json(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/pages', [
            'title' => 'Invalid Builder Page',
            'content' => '<section>Broken</section>',
            'content_format' => 'builder',
            'design_json' => '{not valid json',
        ]);

        $response->assertStatus(422);
        $response->assertJsonPath('errors.0.field', 'design_json');
    }

    public function test_create_builder_page_rejects_design_json_with_invalid_project_shape(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/pages', [
            'title' => 'Invalid Builder Shape',
            'content' => '<section>Broken shape</section>',
            'content_format' => 'builder',
            'design_json' => '{"notGrapesJs":"payload"}',
        ]);

        $response->assertStatus(422);
        $response->assertJsonPath('errors.0.field', 'design_json');

        $listResponse = $this->apiPost('/v2/admin/pages', [
            'title' => 'Invalid Builder List Shape',
            'content' => '<section>Broken list shape</section>',
            'content_format' => 'builder',
            'design_json' => '[{"pages":[]}]',
        ]);

        $listResponse->assertStatus(422);
        $listResponse->assertJsonPath('errors.0.field', 'design_json');
    }

    public function test_create_builder_page_rejects_oversized_design_json(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/pages', [
            'title' => 'Oversized Builder Page',
            'content' => '<section>Too big</section>',
            'content_format' => 'builder',
            'design_json' => str_repeat('x', 2_000_001),
        ]);

        $response->assertStatus(422);
        $response->assertJsonPath('errors.0.field', 'design_json');
    }

    public function test_builder_design_json_is_persisted_only_for_builder_pages(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $validDesignJson = json_encode([
            'pages' => [
                [
                    'frames' => [
                        [
                            'component' => [
                                'type' => 'wrapper',
                                'components' => [
                                    ['tagName' => 'section', 'classes' => ['hero']],
                                ],
                            ],
                        ],
                    ],
                ],
            ],
            'assets' => [],
            'styles' => [],
        ], JSON_THROW_ON_ERROR);

        $response = $this->apiPost('/v2/admin/pages', [
            'title' => 'Valid Builder Page',
            'content' => '<section>Builder</section>',
            'content_format' => 'builder',
            'design_json' => $validDesignJson,
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201]);
        $pageId = (int) $response->json('data.id');
        $this->assertSame($validDesignJson, DB::table('pages')->where('id', $pageId)->value('design_json'));

        $update = $this->apiPut("/v2/admin/pages/{$pageId}", [
            'content_format' => 'html',
            'content' => '<p>HTML now</p>',
            'design_json' => $validDesignJson,
        ]);

        $update->assertStatus(200);
        $this->assertNull(DB::table('pages')->where('id', $pageId)->value('design_json'));
    }

    // ================================================================
    // MENUS — GET /v2/admin/menus
    // ================================================================

    public function test_get_menus_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/menus');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_get_menus_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/menus');

        $response->assertStatus(403);
    }

    // ================================================================
    // CREATE MENU — POST /v2/admin/menus
    // ================================================================

    public function test_create_menu_returns_success_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/menus', [
            'name' => 'Test Menu',
            'location' => 'header',
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201]);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // PLANS — GET /v2/admin/plans
    // ================================================================

    public function test_get_plans_returns_200_for_admin(): void
    {
        // Plans management is platform-super-admin only (getPlans() calls
        // requirePlatformSuperAdmin()); a plain tenant admin gets 403.
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['is_super_admin' => true]);
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/plans');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_get_plans_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/plans');

        $response->assertStatus(403);
    }

    // ================================================================
    // SUBSCRIPTIONS — GET /v2/admin/subscriptions
    // ================================================================

    public function test_get_subscriptions_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/subscriptions');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_get_subscriptions_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/subscriptions');

        $response->assertStatus(401);
    }

    public function test_create_page_rejects_unknown_menu_location(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $this->apiPost('/v2/admin/pages', [
            'title' => 'Sidebar Page',
            'show_in_menu' => 1,
            'menu_location' => 'sidebar',
        ])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'VALIDATION_ERROR')
            ->assertJsonPath('errors.0.field', 'menu_location');
    }

    public function test_create_and_update_page_accept_header_menu_location(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $create = $this->apiPost('/v2/admin/pages', [
            'title' => 'Header Column Page',
            'show_in_menu' => 1,
            'menu_location' => 'header',
        ]);
        $create->assertStatus(201);
        $pageId = (int) $create->json('data.id');
        $this->assertSame('header', DB::table('pages')->where('id', $pageId)->value('menu_location'));

        $this->apiPut("/v2/admin/pages/{$pageId}", ['menu_location' => 'about'])->assertStatus(200);
        $this->assertSame('about', DB::table('pages')->where('id', $pageId)->value('menu_location'));

        $this->apiPut("/v2/admin/pages/{$pageId}", ['menu_location' => 'nowhere'])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'menu_location');
        $this->assertSame('about', DB::table('pages')->where('id', $pageId)->value('menu_location'));
    }

    public function test_create_page_rejects_footer_menu_location(): void
    {
        // The Footer placement was retired on 2026-10-17 (owner decision).
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $this->apiPost('/v2/admin/pages', [
            'title' => 'Footer Page',
            'show_in_menu' => 1,
            'menu_location' => 'footer',
        ])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'VALIDATION_ERROR')
            ->assertJsonPath('errors.0.field', 'menu_location');
    }

    public function test_update_page_rejects_footer_menu_location(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $create = $this->apiPost('/v2/admin/pages', [
            'title' => 'About Page To Move',
            'show_in_menu' => 1,
            'menu_location' => 'about',
        ]);
        $create->assertStatus(201);
        $pageId = (int) $create->json('data.id');

        $this->apiPut("/v2/admin/pages/{$pageId}", ['menu_location' => 'footer'])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'menu_location');
        $this->assertSame('about', DB::table('pages')->where('id', $pageId)->value('menu_location'));
    }
}
