<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use App\Services\RedisCache;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * The community photo (Admin → Settings → "Community photo", Nov 2026, AWID
 * feedback "warmth, and community"): one photo of the community that the
 * website shows on the sign-in and join pages, the dashboard and the feed.
 *
 * AdminConfigController::uploadCommunityPhoto / removeCommunityPhoto store it
 * in tenants.configuration.community_photo_url; the tenant bootstrap publishes
 * it as branding.community_photo_url — but only an uploads path, never
 * whatever string happens to be in the configuration.
 */
class CommunityPhotoUploadTest extends TestCase
{
    use DatabaseTransactions;

    private function tenantConfig(): array
    {
        $row = DB::selectOne('SELECT configuration FROM tenants WHERE id = ?', [$this->testTenantId]);
        return ($row && !empty($row->configuration)) ? (json_decode($row->configuration, true) ?: []) : [];
    }

    private function setConfigKey(string $key, ?string $value): void
    {
        $config = $this->tenantConfig();
        if ($value === null) {
            unset($config[$key]);
        } else {
            $config[$key] = $value;
        }
        DB::update('UPDATE tenants SET configuration = ? WHERE id = ?', [json_encode($config), $this->testTenantId]);
        app(RedisCache::class)->delete('tenant_bootstrap', $this->testTenantId);
    }

    public function test_upload_requires_authentication(): void
    {
        $this->apiPost('/v2/admin/settings/community-photo')->assertStatus(401);
    }

    public function test_upload_is_refused_to_a_member(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->create());

        $this->apiPost('/v2/admin/settings/community-photo')->assertStatus(403);
    }

    public function test_remove_is_refused_to_a_member(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->create());

        $this->apiDelete('/v2/admin/settings/community-photo')->assertStatus(403);
    }

    public function test_upload_needs_a_file(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());

        $this->apiPost('/v2/admin/settings/community-photo')->assertStatus(400);
    }

    public function test_an_svg_is_not_a_photo(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());

        $svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
        $file = UploadedFile::fake()->createWithContent('photo.svg', $svg);

        $this->post('/api/v2/admin/settings/community-photo', ['photo' => $file], $this->withTenantHeader())
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'photo');
        $this->assertArrayNotHasKey('community_photo_url', $this->tenantConfig());
    }

    public function test_a_photo_over_eight_megabytes_is_refused(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());

        $file = UploadedFile::fake()->create('big.jpg', 9 * 1024, 'image/jpeg');

        $this->post('/api/v2/admin/settings/community-photo', ['photo' => $file], $this->withTenantHeader())
            ->assertStatus(422);
        $this->assertArrayNotHasKey('community_photo_url', $this->tenantConfig());
    }

    public function test_a_photo_is_stored_and_published_to_the_website(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());
        $this->setConfigKey('community_photo_url', null);

        $file = UploadedFile::fake()->image('our-community.jpg', 64, 40);
        $response = $this->post('/api/v2/admin/settings/community-photo', ['photo' => $file], $this->withTenantHeader());

        $response->assertStatus(200);
        $url = $response->json('data.url');
        $this->assertIsString($url);
        $this->assertStringStartsWith('/uploads/', $url);

        try {
            $this->assertSame($url, $this->tenantConfig()['community_photo_url'] ?? null);

            app(RedisCache::class)->delete('tenant_bootstrap', $this->testTenantId);
            $this->apiGet('/v2/tenant/bootstrap?slug=' . $this->testTenantSlug)
                ->assertOk()
                ->assertJsonPath('data.branding.community_photo_url', $url);
        } finally {
            // ImageUploader also writes a .webp copy of a JPEG/PNG.
            $abs = base_path('httpdocs' . $url);
            foreach ([$abs, preg_replace('/\.[a-z]+$/i', '.webp', $abs)] as $path) {
                if (is_string($path) && is_file($path)) {
                    @unlink($path);
                }
            }
            app(RedisCache::class)->delete('tenant_bootstrap', $this->testTenantId);
        }
    }

    public function test_remove_clears_the_photo_and_keeps_other_settings(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());
        $this->setConfigKey('community_photo_url', '/uploads/tenants/x/community-photos/seed.jpg');
        $this->setConfigKey('default_language', 'en');

        $this->apiDelete('/v2/admin/settings/community-photo')->assertStatus(200);

        $after = $this->tenantConfig();
        $this->assertArrayNotHasKey('community_photo_url', $after);
        $this->assertSame('en', $after['default_language'] ?? null);
    }

    public function test_the_website_is_never_given_a_photo_address_that_is_not_an_upload(): void
    {
        $this->setConfigKey('community_photo_url', 'javascript:alert(1)');

        try {
            $branding = $this->apiGet('/v2/tenant/bootstrap?slug=' . $this->testTenantSlug)
                ->assertOk()
                ->json('data.branding') ?? [];
            $this->assertArrayNotHasKey('community_photo_url', $branding);
        } finally {
            app(RedisCache::class)->delete('tenant_bootstrap', $this->testTenantId);
        }
    }
}
