<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

class PwaManifestControllerTest extends TestCase
{
    use DatabaseTransactions;

    public function test_path_tenant_gets_unique_identity_scope_and_shortcuts(): void
    {
        $response = $this->apiGet('/v2/pwa/manifest?path=/hour-timebank/listings');

        $response->assertOk();
        $response->assertHeader('Content-Type', 'application/manifest+json; charset=UTF-8');
        $response->assertJsonPath('name', 'Hour Timebank');
        $response->assertJsonPath('id', '/hour-timebank/');
        $response->assertJsonPath('start_url', '/hour-timebank/');
        $response->assertJsonPath('scope', '/hour-timebank/');
        $response->assertJsonPath('shortcuts.0.url', '/hour-timebank/listings');
        $response->assertJsonPath('shortcuts.1.url', '/hour-timebank/messages');
        $response->assertJsonPath('shortcuts.2.url', '/hour-timebank/wallet');
    }

    public function test_shared_host_manifest_resolves_path_tenant_from_master_context(): void
    {
        TenantContext::reset();
        TenantContext::setById(1);

        $response = $this->apiGet('/v2/pwa/manifest?path=/hour-timebank/login');

        $response->assertOk();
        $response->assertJsonPath('name', 'Hour Timebank');
        $response->assertJsonPath('id', '/hour-timebank/');
        $response->assertJsonPath('start_url', '/hour-timebank/');
        $response->assertJsonPath('scope', '/hour-timebank/');
        $response->assertJsonPath('shortcuts.0.url', '/hour-timebank/listings');
    }

    /**
     * The platform host installs an app covering the whole site.
     *
     * Regression: the master tenant is id 1 with slug 'admin', and the prefix
     * used to come from TenantContext::getSlugPrefix(), which only returns ''
     * for custom-domain tenants with id > 1. So app.project-nexus.ie served
     * "scope": "/admin/" and an installed app that excluded every member page.
     */
    public function test_master_platform_host_scopes_the_whole_site_not_the_admin_slug(): void
    {
        DB::table('tenants')->where('id', 1)->update([
            'name' => 'NEXUS Timebanking',
            'slug' => 'admin',
            'is_active' => true,
        ]);
        $this->withTenant(1);

        $response = $this->apiGet('/v2/pwa/manifest?path=/');

        $response->assertOk();
        $response->assertHeader('Content-Type', 'application/manifest+json; charset=UTF-8');
        $response->assertJsonPath('name', 'NEXUS Timebanking');
        $response->assertJsonPath('id', '/');
        $response->assertJsonPath('start_url', '/');
        $response->assertJsonPath('scope', '/');
        $response->assertJsonPath('shortcuts.0.url', '/listings');
        $response->assertJsonPath('shortcuts.1.url', '/messages');
        $response->assertJsonPath('shortcuts.2.url', '/wallet');
    }

    /**
     * Installing while on an admin page must still scope the whole site. The
     * master tenant's slug matches the '/admin' path segment, so resolving it
     * as a path tenant would reintroduce the admin-only scope.
     */
    public function test_master_platform_host_keeps_root_scope_on_an_admin_path(): void
    {
        DB::table('tenants')->where('id', 1)->update([
            'name' => 'NEXUS Timebanking',
            'slug' => 'admin',
            'is_active' => true,
        ]);
        $this->withTenant(1);

        $response = $this->apiGet('/v2/pwa/manifest?path=/admin/dashboard');

        $response->assertOk();
        $response->assertJsonPath('id', '/');
        $response->assertJsonPath('start_url', '/');
        $response->assertJsonPath('scope', '/');
        $response->assertJsonPath('shortcuts.0.url', '/listings');
    }

    public function test_custom_domain_tenant_keeps_root_scope(): void
    {
        DB::table('tenants')->where('id', 1)->update([
            'slug' => 'listings',
            'is_active' => true,
        ]);
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'domain' => 'tenant.example.test',
        ]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);

        $response = $this->apiGet('/v2/pwa/manifest?path=/listings');

        $response->assertOk();
        $response->assertJsonPath('id', '/');
        $response->assertJsonPath('name', 'Hour Timebank');
        $response->assertJsonPath('start_url', '/');
        $response->assertJsonPath('scope', '/');
        $response->assertJsonPath('shortcuts.0.url', '/listings');
    }

    // ─────────────────────────────────────────────────────────────────────
    // The community on the member's phone (warmth phase 6, A4)
    // ─────────────────────────────────────────────────────────────────────

    /** @param array<string, mixed> $configuration */
    private function seedCommunity(string $name, array $configuration): string
    {
        $slug = 'pwa-' . substr(uniqid(), -8);
        DB::table('tenants')->insert([
            'name' => $name,
            'slug' => $slug,
            'is_active' => 1,
            'configuration' => json_encode($configuration),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $slug;
    }

    public function test_chosen_colour_becomes_the_install_colour_in_its_button_shade(): void
    {
        // Already carries white text at 4.5:1, so it is used as it is.
        $deep = $this->seedCommunity('Deep Blue Timebank', ['primary_color' => '#1D4ED8']);
        // Too light for white text: deepened exactly as the browser bar is.
        $light = $this->seedCommunity('Sunny Timebank', ['primary_color' => '#ffd700']);

        $this->apiGet("/v2/pwa/manifest?path=/{$deep}/")->assertOk()
            ->assertJsonPath('theme_color', '#1d4ed8');

        $expected = \App\Core\EmailPalette::fromColour('#ffd700')['button'];
        $this->assertNotSame('#ffd700', $expected);
        $this->apiGet("/v2/pwa/manifest?path=/{$light}/")->assertOk()
            ->assertJsonPath('theme_color', $expected);
    }

    public function test_two_communities_never_see_each_others_colour_or_icon(): void
    {
        $a = $this->seedCommunity('Alpha Timebank', [
            'primary_color' => '#0f766e',
            'app_icon_url' => '/uploads/tenants/alpha/app-icon.png',
        ]);
        $b = $this->seedCommunity('Beta Timebank', ['primary_color' => '#7c2d12']);

        $ra = $this->apiGet("/v2/pwa/manifest?path=/{$a}/listings")->assertOk();
        $rb = $this->apiGet("/v2/pwa/manifest?path=/{$b}/listings")->assertOk();

        $ra->assertJsonPath('name', 'Alpha Timebank')->assertJsonPath('theme_color', '#0f766e');
        $rb->assertJsonPath('name', 'Beta Timebank')->assertJsonPath('theme_color', '#7c2d12');

        $this->assertStringContainsString('/uploads/tenants/alpha/app-icon.png', $ra->getContent());
        $this->assertStringNotContainsString('alpha', $rb->getContent());
        $rb->assertJsonPath('icons.0.src', '/icons/icon-192.png');
    }

    public function test_a_community_that_chose_nothing_gets_todays_manifest_values(): void
    {
        $plain = $this->seedCommunity('Plain Timebank', []);

        $response = $this->apiGet("/v2/pwa/manifest?path=/{$plain}/")->assertOk();

        $response->assertJsonPath('theme_color', '#6366f1');
        $response->assertJsonPath('short_name', 'Plain Timebank');
        $response->assertJsonPath('icons', [
            ['src' => '/icons/icon-192.png', 'sizes' => '192x192', 'type' => 'image/png', 'purpose' => 'any'],
            ['src' => '/icons/icon-192.png', 'sizes' => '192x192', 'type' => 'image/png', 'purpose' => 'maskable'],
            ['src' => '/icons/icon-512.png', 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'any'],
            ['src' => '/icons/icon-512.png', 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'maskable'],
        ]);
    }

    public function test_stored_values_that_are_not_a_plain_colour_or_an_uploaded_png_are_never_echoed(): void
    {
        $odd = $this->seedCommunity('Odd Timebank', [
            'primary_color' => 'red;}</style><script>',
            'app_icon_url' => 'javascript:alert(1)//.png',
        ]);
        $remote = $this->seedCommunity('Remote Timebank', [
            'app_icon_url' => 'https://evil.example/uploads/x.png',
        ]);
        $traversal = $this->seedCommunity('Dots Timebank', [
            'app_icon_url' => '/uploads/../../etc/x.png',
        ]);

        foreach ([$odd, $remote, $traversal] as $slug) {
            $response = $this->apiGet("/v2/pwa/manifest?path=/{$slug}/")->assertOk();
            $response->assertJsonPath('theme_color', '#6366f1');
            $response->assertJsonPath('icons.0.src', '/icons/icon-192.png');
            $this->assertStringNotContainsString('<script>', $response->getContent());
            $this->assertStringNotContainsString('javascript:', $response->getContent());
            $this->assertStringNotContainsString('evil', $response->getContent());
            $this->assertStringNotContainsString('..', $response->getContent());
        }
    }

    /**
     * A community's own picture is offered as an ordinary ("any") icon only,
     * never "maskable": a phone crops a maskable icon to a circle or squircle,
     * which would cut the corners off a logo drawn to the edge. Phones put an
     * "any" icon whole on a plain background instead.
     */
    public function test_an_app_icon_replaces_the_icons_and_is_never_cropped(): void
    {
        $slug = $this->seedCommunity('Icon Timebank', ['app_icon_url' => '/uploads/tenants/9/app-icon.png']);

        $response = $this->apiGet("/v2/pwa/manifest?path=/{$slug}/")->assertOk();

        $icons = $response->json('icons');
        $this->assertNotEmpty($icons);
        foreach ($icons as $icon) {
            $this->assertSame('/uploads/tenants/9/app-icon.png', $icon['src']);
            $this->assertSame('image/png', $icon['type']);
            $this->assertSame('any', $icon['purpose']);
        }
        $this->assertSame(['192x192', '512x512'], array_column($icons, 'sizes'));
    }

    public function test_a_jpeg_app_icon_is_declared_as_a_jpeg(): void
    {
        $slug = $this->seedCommunity('Jpeg Timebank', ['app_icon_url' => '/uploads/tenants/9/app-icon.jpg']);

        $this->apiGet("/v2/pwa/manifest?path=/{$slug}/")->assertOk()
            ->assertJsonPath('icons.0.type', 'image/jpeg');
    }

    public function test_unknown_community_path_falls_back_to_the_current_communitys_manifest(): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'configuration' => json_encode(['primary_color' => '#0f766e']),
        ]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);

        $response = $this->apiGet('/v2/pwa/manifest?path=/no-such-community-xyz/');

        $response->assertOk();
        $response->assertJsonPath('name', 'Hour Timebank');
        $response->assertJsonPath('theme_color', '#0f766e');
    }
}
