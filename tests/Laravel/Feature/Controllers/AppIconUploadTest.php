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
 * The community's square app icon (Admin → Make it yours → "App icon",
 * warmth phase 6, A4): the picture a phone puts on its home screen when a
 * member installs the community's site.
 *
 * AdminConfigController::uploadAppIcon / removeAppIcon store it in
 * tenants.configuration.app_icon_url; the tenant bootstrap publishes it as
 * branding.app_icon_url and the install manifest uses it for its icons — but
 * only an uploaded raster file, square and at least 512 pixels.
 */
class AppIconUploadTest extends TestCase
{
    use DatabaseTransactions;

    private const URL = '/api/v2/admin/settings/app-icon';

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

    private function actAsAdmin(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());
    }

    public function test_upload_requires_authentication(): void
    {
        $this->apiPost('/v2/admin/settings/app-icon')->assertStatus(401);
    }

    public function test_upload_and_remove_are_refused_to_a_member(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->create());

        $this->apiPost('/v2/admin/settings/app-icon')->assertStatus(403);
        $this->apiDelete('/v2/admin/settings/app-icon')->assertStatus(403);
    }

    public function test_upload_needs_a_file(): void
    {
        $this->actAsAdmin();

        $this->apiPost('/v2/admin/settings/app-icon')->assertStatus(400);
    }

    public function test_an_svg_is_refused(): void
    {
        $this->actAsAdmin();

        $svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
        $file = UploadedFile::fake()->createWithContent('icon.svg', $svg);

        $this->post(self::URL, ['icon' => $file], $this->withTenantHeader())
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'icon');
        $this->assertArrayNotHasKey('app_icon_url', $this->tenantConfig());
    }

    public function test_a_picture_that_is_not_square_is_refused(): void
    {
        $this->actAsAdmin();

        $file = UploadedFile::fake()->image('wide.png', 1024, 512);

        $this->post(self::URL, ['icon' => $file], $this->withTenantHeader())
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'icon');
        $this->assertArrayNotHasKey('app_icon_url', $this->tenantConfig());
    }

    public function test_a_square_picture_under_512_pixels_is_refused(): void
    {
        $this->actAsAdmin();

        $file = UploadedFile::fake()->image('small.png', 256, 256);

        $this->post(self::URL, ['icon' => $file], $this->withTenantHeader())
            ->assertStatus(422);
        $this->assertArrayNotHasKey('app_icon_url', $this->tenantConfig());
    }

    public function test_a_square_icon_is_stored_published_and_used_by_the_manifest(): void
    {
        $this->actAsAdmin();
        $this->setConfigKey('app_icon_url', null);

        $file = UploadedFile::fake()->image('icon.png', 512, 512);
        $response = $this->post(self::URL, ['icon' => $file], $this->withTenantHeader());

        $response->assertStatus(200);
        $url = $response->json('data.url');
        $this->assertIsString($url);
        $this->assertStringStartsWith('/uploads/', $url);

        try {
            $this->assertSame($url, $this->tenantConfig()['app_icon_url'] ?? null);

            app(RedisCache::class)->delete('tenant_bootstrap', $this->testTenantId);
            $this->apiGet('/v2/tenant/bootstrap?slug=' . $this->testTenantSlug)
                ->assertOk()
                ->assertJsonPath('data.branding.app_icon_url', $url);

            $this->apiGet('/v2/pwa/manifest?path=/' . $this->testTenantSlug . '/')
                ->assertOk()
                ->assertJsonPath('icons.0.src', $url);
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

    public function test_remove_clears_the_icon_and_keeps_other_settings(): void
    {
        $this->actAsAdmin();
        $this->setConfigKey('app_icon_url', '/uploads/tenants/x/app-icons/seed.png');
        $this->setConfigKey('default_language', 'en');

        $this->apiDelete('/v2/admin/settings/app-icon')->assertStatus(200);

        $after = $this->tenantConfig();
        $this->assertArrayNotHasKey('app_icon_url', $after);
        $this->assertSame('en', $after['default_language'] ?? null);
    }

    public function test_the_website_is_never_given_an_icon_address_that_is_not_an_uploaded_picture(): void
    {
        foreach (['javascript:alert(1)//.png', 'https://evil.example/uploads/x.png', '/uploads/x/icon.svg', '/uploads/../x.png'] as $bad) {
            $this->setConfigKey('app_icon_url', $bad);

            try {
                $branding = $this->apiGet('/v2/tenant/bootstrap?slug=' . $this->testTenantSlug)
                    ->assertOk()
                    ->json('data.branding') ?? [];
                $this->assertArrayNotHasKey('app_icon_url', $branding, $bad);
            } finally {
                app(RedisCache::class)->delete('tenant_bootstrap', $this->testTenantId);
            }
        }
    }
}
